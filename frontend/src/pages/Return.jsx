import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { CustomerPicker } from '../components/CustomerPicker';
import { bySite } from '../components/shared';
import { NO_SITE, SitePicker, siteIdOf } from '../components/SitePicker';
import { fmtAt, money, nowLocal } from '../format';
import { Card, Empty, Field, Loading, NoteField, PageHead, QtyInput, SaveBar, WhenField, useLoad, useToast } from '../ui';
import { workLink } from '../work';

const siteKey = (siteId) => (siteId ? String(siteId) : NO_SITE);

export default function Return() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const customers = useLoad(() => api('/customers'), []);
  const items = useLoad(() => api('/items'), []);

  const [customerId, setCustomerId] = useState(params.get('customer') || '');
  const account = useLoad(() => (customerId ? api(`/customers/${customerId}`) : Promise.resolve(null)), [customerId]);
  const [site, setSite] = useState(null);
  const [back, setBack] = useState({}); // item_id -> qty string
  const [lost, setLost] = useState({}); // item_id -> { open, qty, rate }
  const [at, setAt] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  if (!customers.data || !items.data) return <Loading error={customers.error || items.error} />;

  const all = account.data?.holdings || [];
  const groups = bySite(all);
  const chosenSite = site ?? (groups.length === 1 ? siteKey(groups[0][0]) : null);
  const holdings = chosenSite === null ? [] : all.filter((h) => siteKey(h.site_id) === chosenSite);
  const itemOf = (id) => items.data.find((i) => i.id === id);

  const n = (v) => Number(v) || 0;
  const lostOf = (h) => lost[h.item_id] || { open: false, qty: '', rate: String(itemOf(h.item_id)?.lost_rate ?? 0) };
  const setLostOf = (h, patch) => setLost((all) => ({ ...all, [h.item_id]: { ...lostOf(h), ...patch } }));
  const backTotal = holdings.reduce((s, h) => s + n(back[h.item_id]), 0);
  const lostTotal = holdings.reduce((s, h) => s + n(lostOf(h).qty), 0);
  const lostMoney = holdings.reduce((s, h) => s + n(lostOf(h).qty) * n(lostOf(h).rate), 0);
  const allBack = holdings.length > 0 && holdings.every((h) => n(back[h.item_id]) === h.qty);

  function reset() {
    setBack({});
    setLost({});
    setErr('');
  }

  function chooseCustomer(id) {
    setCustomerId(id);
    setSite(null);
    reset();
  }

  function returnEverything() {
    setLost({});
    setBack(allBack ? {} : Object.fromEntries(holdings.map((h) => [h.item_id, String(h.qty)])));
  }

  async function save() {
    setErr('');
    try {
      const lines = [];
      for (const h of holdings) {
        const q = n(back[h.item_id]);
        const l = lostOf(h);
        const lq = n(l.qty);
        if (!Number.isInteger(q) || q < 0 || !Number.isInteger(lq) || lq < 0)
          throw new Error(`${h.item_name}: quantity must be a whole number.`);
        if (q + lq > h.qty) throw new Error(`${h.item_name}: customer has only ${h.qty}, you entered ${q + lq}.`);
        if (q > 0) lines.push({ item_id: h.item_id, direction: 'in', qty: q });
        if (lq > 0) {
          if (l.rate === '' || !(Number(l.rate) >= 0)) throw new Error(`Price of lost ${h.item_name} is not valid.`);
          lines.push({ item_id: h.item_id, direction: 'in', qty: lq, lost: true, rate: Number(l.rate) });
        }
      }
      if (!lines.length) throw new Error('Enter how many of each item came back.');
      setBusy(true);
      const res = await api('/challans', {
        method: 'POST',
        body: {
          customer_id: Number(customerId),
          site_id: siteIdOf(chosenSite),
          at: at || nowLocal(),
          vehicle,
          note,
          lines,
        },
      });
      toast(lostTotal ? 'Saved. Returned items are back in store; lost ones will be on the next bill.' : 'Saved. Items are back in store.');
      navigate(`/challans/${res.id}?new=1`);
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }

  const siteOptions = groups.map(([id, name, hs]) => [
    siteKey(id),
    name || 'No site given',
    `${hs.reduce((s, h) => s + h.qty, 0)} pcs there`,
  ]);
  const showSites = groups.length > 1 || (groups.length === 1 && groups[0][1]);
  const nextStep = showSites ? '3' : '2';

  return (
    <>
      <PageHead work="return" sub="Customer brings items back. Rent stops from this time." />

      <Card title="Customer" step="1">
        <CustomerPicker
          customers={customers.data}
          value={customerId}
          onChange={chooseCustomer}
          onCreated={customers.reload}
          onlyHolding
        />
      </Card>

      {customerId && account.data && showSites && (
        <Card title="From which site?" step="2">
          <SitePicker
            options={siteOptions}
            value={chosenSite}
            onChange={(v) => {
              setSite(v);
              reset();
            }}
          />
        </Card>
      )}

      {customerId && (chosenSite !== null || !account.data || !all.length) && (
        <Card
          title="How many came back?"
          step={nextStep}
          actions={
            holdings.length > 0 && (
              <button type="button" className={`btn sm ${allBack ? '' : 'primary-soft'}`} onClick={returnEverything}>
                {allBack ? 'Clear' : 'Everything came back'}
              </button>
            )
          }
        >
          {!account.data ? (
            <Loading error={account.error} />
          ) : holdings.length === 0 ? (
            <Empty icon="return" title="This customer has no items right now">
              <Link to={workLink('issue', customerId)}>Issue items to them →</Link>
            </Empty>
          ) : (
            <div className="give-list">
              {holdings.map((h) => {
                const q = n(back[h.item_id]);
                const l = lostOf(h);
                const lq = n(l.qty);
                const over = q + lq > h.qty;
                return (
                  <div key={h.item_id} className={`give-row ${q > 0 || lq > 0 ? 'on green' : ''} ${over ? 'over' : ''}`}>
                    <div className="give-main">
                      <div className="give-name">{h.item_name}</div>
                      <div className="muted small">
                        Has <b>{h.qty} {h.unit}</b> · given {h.lots.map((x) => `${fmtAt(x.at)} (${x.qty})`).join(', ')}
                      </div>
                      {over && <div className="text-bad small strong">Customer has only {h.qty}!</div>}
                      {(q > 0 || lq > 0) && !over && q + lq < h.qty && (
                        <div className="small muted">Customer keeps {h.qty - q - lq}</div>
                      )}
                      {!l.open && (
                        <button type="button" className="link-btn small" onClick={() => setLostOf(h, { open: true })}>
                          Some are lost?
                        </button>
                      )}
                    </div>
                    <div className="give-qty">
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => setBack((b) => ({ ...b, [h.item_id]: String(Math.max(h.qty - lq, 0)) }))}
                      >
                        All {h.qty - lq}
                      </button>
                      <QtyInput
                        value={back[h.item_id] || ''}
                        onChange={(v) => setBack((b) => ({ ...b, [h.item_id]: v }))}
                        max={h.qty - lq}
                        bad={over}
                      />
                    </div>
                    {l.open && (
                      <div className="give-rent lost-line">
                        <span className="strong text-bad">Lost:</span>
                        <QtyInput value={l.qty} onChange={(v) => setLostOf(h, { qty: v })} max={h.qty - q} bad={over} />
                        <label>
                          Price ₹
                          <input
                            type="number"
                            min="0"
                            step="any"
                            inputMode="decimal"
                            value={l.rate}
                            onChange={(e) => setLostOf(h, { rate: e.target.value })}
                          />
                        </label>
                        <span className="muted small">
                          {lq > 0 ? `= ${money(lq * n(l.rate))} on the next bill` : 'per piece'}
                        </span>
                        <button
                          type="button"
                          className="link-btn small"
                          onClick={() => setLostOf(h, { open: false, qty: '' })}
                        >
                          None lost
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {holdings.length > 0 && (
            <p className="muted small hint-line">
              Customer swapped some items for others? Use <Link to={workLink('replace', customerId)}>Replace items</Link>{' '}
              instead.
            </p>
          )}
        </Card>
      )}

      {customerId && holdings.length > 0 && (
        <>
          <Card className="quiet">
            <WhenField value={at} onChange={setAt} />
            <Field label="Vehicle no. (optional)" className="narrow">
              <input value={vehicle} onChange={(e) => setVehicle(e.target.value.toUpperCase())} />
            </Field>
            <NoteField value={note} onChange={setNote} />
          </Card>

          {err && <div className="banner bad">{err}</div>}
          <SaveBar
            summary={
              backTotal || lostTotal ? (
                <>
                  {backTotal > 0 && <b>{backTotal} pcs coming back</b>}
                  {backTotal > 0 && lostTotal > 0 && ' · '}
                  {lostTotal > 0 && (
                    <span className="text-bad">
                      {lostTotal} lost ({money(lostMoney)})
                    </span>
                  )}
                </>
              ) : (
                <span className="muted">Nothing entered yet</span>
              )
            }
          >
            <button type="button" className="btn primary big" disabled={busy || !(backTotal || lostTotal)} onClick={save}>
              {busy ? 'Saving…' : 'Save return'}
            </button>
          </SaveBar>
        </>
      )}
    </>
  );
}
