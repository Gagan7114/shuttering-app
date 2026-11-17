import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api';
import { CustomerPicker } from '../components/CustomerPicker';
import { LostTable, RentTable, useShop } from '../components/shared';
import { GST_TYPES, billTotals, fmtAt, gstState, money, nowLocal } from '../format';
import Icon from '../icons';
import { Card, Field, Loading, NoteField, PageHead, SaveBar, Segmented, useLoad, useToast } from '../ui';

const QUICK_EXTRAS = ['Transport / cartage', 'Loading / unloading', 'Damage / repair'];
const newExtra = (description = '') => ({ key: Math.random(), description, amount: '' });

export default function BillNew() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { shop } = useShop();
  const customers = useLoad(() => api('/customers'), []);

  const [customerId, setCustomerId] = useState(params.get('customer') || '');
  const [upto, setUpto] = useState(nowLocal());
  const [extras, setExtras] = useState([]);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discount, setDiscount] = useState('');
  const [note, setNote] = useState('');
  const [gstType, setGstType] = useState(null); // null = worked out from GSTINs
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const preview = useLoad(
    () => (customerId && upto ? api(`/customers/${customerId}/preview` + qs({ at: upto })) : Promise.resolve(null)),
    [customerId, upto],
  );

  if (!customers.data) return <Loading error={customers.error} />;

  const pv = preview.data;
  const rent = pv ? Number(pv.rent_total) : 0;
  const lost = pv ? Number(pv.lost_total) : 0;
  const extrasTotal = extras.reduce((s, x) => s + (Number(x.amount) || 0), 0);

  const cust = customers.data.find((c) => String(c.id) === String(customerId));
  const mine = gstState(shop.gstin);
  const theirs = gstState(cust?.gstin);
  const autoGst = !shop.gst_enabled ? 'none' : mine && theirs && mine !== theirs ? 'inter' : 'intra';
  const gst = gstType ?? autoGst;
  const t = billTotals({
    rent,
    lost,
    extras: extrasTotal,
    discount: Number(discount) || 0,
    gstType: gst,
    gstRate: shop.gst_rate || 0,
  });
  const total = t.total;

  const setExtra = (key, patch) => setExtras((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  async function save() {
    setErr('');
    try {
      if (!customerId) throw new Error('Choose the customer.');
      if (upto > nowLocal()) throw new Error('Bill time cannot be in the future.');
      for (const x of extras) {
        if (x.amount !== '' && !x.description.trim()) throw new Error('Write what each extra charge is for.');
      }
      setBusy(true);
      const res = await api('/bills', {
        method: 'POST',
        body: {
          customer_id: Number(customerId),
          upto,
          extras: extras.filter((x) => x.amount !== '').map(({ description, amount }) => ({ description, amount })),
          discount: discount || 0,
          gst_type: gst,
          note,
        },
      });
      toast(`Bill #${res.bill_no} saved`);
      navigate(`/bills/${res.id}`);
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead work="bill" sub="Rent is worked out from the challans: each item from the day it was given until it came back." />

      <Card title="Customer" step="1">
        <CustomerPicker
          customers={customers.data}
          value={customerId}
          onChange={(id) => {
            setCustomerId(id);
            setGstType(null);
          }}
          onCreated={customers.reload}
        />
      </Card>

      {customerId && (
        <>
          <Card
            title="Rent"
            step="2"
            actions={
              <label className="inline-field">
                Bill up to
                <input type="datetime-local" value={upto} onChange={(e) => e.target.value && setUpto(e.target.value)} />
              </label>
            }
          >
            {pv?.last_bill_no && (
              <p className="muted small">
                Last bill #{pv.last_bill_no} was up to {fmtAt(pv.from_at)}. This bill covers only the time after that.
              </p>
            )}
            {preview.error ? (
              <div className="banner bad">{preview.error.message}</div>
            ) : !pv ? (
              <div className="loading">Working out rent…</div>
            ) : (
              <>
                <div className="rent-total">
                  <span>Rent up to {fmtAt(upto)}</span>
                  <b>{money(rent)}</b>
                </div>
                {pv.lines.length > 0 && (
                  <details className="details">
                    <summary>See item-wise rent ({pv.lines.length} lines)</summary>
                    <RentTable lines={pv.lines} />
                  </details>
                )}
                {!pv.lines.length && <p className="muted">No rent to bill in this period.</p>}
                {pv.lost_lines.length > 0 && (
                  <>
                    <div className="rent-total lost">
                      <span>Lost items ({pv.lost_lines.reduce((n, l) => n + l.qty, 0)} pcs)</span>
                      <b>{money(lost)}</b>
                    </div>
                    <LostTable lines={pv.lost_lines} />
                  </>
                )}
              </>
            )}
          </Card>

          <Card title="Extra charges (optional)" step="3">
            {extras.map((x) => (
              <div className="extra-row" key={x.key}>
                <input
                  placeholder="What for?"
                  value={x.description}
                  onChange={(e) => setExtra(x.key, { description: e.target.value })}
                />
                <input
                  className="amount"
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  placeholder="₹ Amount"
                  value={x.amount}
                  onChange={(e) => setExtra(x.key, { amount: e.target.value })}
                />
                <button
                  type="button"
                  className="icon-btn"
                  title="Remove"
                  onClick={() => setExtras((xs) => xs.filter((y) => y.key !== x.key))}
                >
                  <Icon name="x" size={18} />
                </button>
              </div>
            ))}
            <div className="chips">
              {QUICK_EXTRAS.map((d) => (
                <button key={d} type="button" className="chip" onClick={() => setExtras((xs) => [...xs, newExtra(d)])}>
                  + {d}
                </button>
              ))}
              <button type="button" className="chip" onClick={() => setExtras((xs) => [...xs, newExtra()])}>
                + Other
              </button>
              {!discountOpen && (
                <button type="button" className="chip" onClick={() => setDiscountOpen(true)}>
                  − Discount
                </button>
              )}
            </div>
            {discountOpen && (
              <Field label="Discount ₹" className="narrow mt">
                <input
                  autoFocus
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                />
              </Field>
            )}
            <NoteField value={note} onChange={setNote} label="Note on bill" />
          </Card>

          {shop.gst_enabled && (
            <Card title="GST" step="4">
              <Segmented options={Object.entries(GST_TYPES)} value={gst} onChange={setGstType} />
              <p className="muted small">
                {gst === 'none'
                  ? 'This bill will have no GST.'
                  : gst === 'intra'
                    ? `CGST ${shop.gst_rate / 2}% + SGST ${shop.gst_rate / 2}% — customer in your state.`
                    : `IGST ${shop.gst_rate}% — customer in another state.`}{' '}
                {cust?.gstin ? `Customer GSTIN ${cust.gstin}.` : 'Customer has no GSTIN saved (B2C bill).'}
              </p>
            </Card>
          )}

          {(extrasTotal > 0 || Number(discount) > 0 || lost > 0 || gst !== 'none') && (
            <Card className="quiet">
              <div className="totals">
                <div>
                  <span>Rent</span>
                  <span>{money(rent)}</span>
                </div>
                {lost > 0 && (
                  <div>
                    <span>Lost items</span>
                    <span>{money(lost)}</span>
                  </div>
                )}
                {extrasTotal > 0 && (
                  <div>
                    <span>Extra charges</span>
                    <span>{money(extrasTotal)}</span>
                  </div>
                )}
                {Number(discount) > 0 && (
                  <div>
                    <span>Discount</span>
                    <span>− {money(discount)}</span>
                  </div>
                )}
                {gst !== 'none' && (
                  <>
                    <div className="sub-total">
                      <span>Taxable amount</span>
                      <span>{money(t.taxable)}</span>
                    </div>
                    {gst === 'intra' ? (
                      <>
                        <div>
                          <span>CGST {shop.gst_rate / 2}%</span>
                          <span>{money(t.cgst)}</span>
                        </div>
                        <div>
                          <span>SGST {shop.gst_rate / 2}%</span>
                          <span>{money(t.sgst)}</span>
                        </div>
                      </>
                    ) : (
                      <div>
                        <span>IGST {shop.gst_rate}%</span>
                        <span>{money(t.igst)}</span>
                      </div>
                    )}
                  </>
                )}
                <div className="grand">
                  <span>Bill total</span>
                  <span>{money(total)}</span>
                </div>
              </div>
            </Card>
          )}

          {err && <div className="banner bad">{err}</div>}
          <SaveBar
            summary={
              <>
                Bill total <b className="big-money">{money(total)}</b>
              </>
            }
          >
            <button type="button" className="btn primary big" disabled={busy || !pv} onClick={save}>
              {busy ? 'Saving…' : 'Save bill'}
            </button>
          </SaveBar>
        </>
      )}
    </>
  );
}
