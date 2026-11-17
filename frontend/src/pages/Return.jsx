import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { CustomerPicker } from '../components/CustomerPicker';
import { bySite } from '../components/shared';
import { NO_SITE, siteIdOf } from '../components/SitePicker';
import { fmtAt, money, nowLocal } from '../format';
import Icon from '../icons';
import { Card, Empty, Field, Loading, NoteField, PageHead, QtyInput, SaveBar, WhenField, useLoad, useToast } from '../ui';
import { workLink } from '../work';

const siteKey = (siteId) => (siteId ? String(siteId) : NO_SITE);
// One row per item per site: the same item can be at two sites of one customer.
const rowKey = (h) => `${siteKey(h.site_id)}:${h.item_id}`;
const pcsOf = (hs) => hs.reduce((s, h) => s + h.qty, 0);

/*
 * Return items. Everything the customer has is on one page, grouped by site, so items coming back
 * from more than one site are entered together. Saving makes one return challan per site.
 */

export default function Return() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const customers = useLoad(() => api('/customers'), []);
  const items = useLoad(() => api('/items'), []);

  const [customerId, setCustomerId] = useState(params.get('customer') || '');
  const account = useLoad(() => (customerId ? api(`/customers/${customerId}`) : Promise.resolve(null)), [customerId]);
  const [back, setBack] = useState({}); // rowKey -> qty string
  const [lost, setLost] = useState({}); // rowKey -> { open, qty, rate }
  const [at, setAt] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  if (!customers.data || !items.data) return <Loading error={customers.error || items.error} />;

  const holdings = account.data?.holdings || [];
  const groups = bySite(holdings);
  // Site headings only when there is more than one site (or the one site has a name).
  const showSites = groups.length > 1 || (groups.length === 1 && !!groups[0][1]);
  const itemOf = (id) => items.data.find((i) => i.id === id);

  const n = (v) => Number(v) || 0;
  const backOf = (h) => back[rowKey(h)] || '';
  const setBackOf = (h, v) => setBack((b) => ({ ...b, [rowKey(h)]: v }));
  const lostOf = (h) => lost[rowKey(h)] || { open: false, qty: '', rate: String(itemOf(h.item_id)?.lost_rate ?? 0) };
  const setLostOf = (h, patch) => setLost((all) => ({ ...all, [rowKey(h)]: { ...lostOf(h), ...patch } }));
  const backTotal = holdings.reduce((s, h) => s + n(backOf(h)), 0);
  const lostTotal = holdings.reduce((s, h) => s + n(lostOf(h).qty), 0);
  const lostMoney = holdings.reduce((s, h) => s + n(lostOf(h).qty) * n(lostOf(h).rate), 0);
  const allBackIn = (hs) => hs.length > 0 && hs.every((h) => n(backOf(h)) === h.qty);
  const allBack = allBackIn(holdings);
  const sitesInUse = groups.filter(([, , hs]) => hs.some((h) => n(backOf(h)) || n(lostOf(h).qty)));

  function reset() {
    setBack({});
    setLost({});
    setErr('');
  }

  function chooseCustomer(id) {
    setCustomerId(id);
    reset();
  }

  /** Fill in (or clear) "all came back" for these rows: the whole customer, or one site. */
  function returnAll(hs) {
    const full = allBackIn(hs);
    const keys = new Set(hs.map(rowKey));
    setLost((l) => Object.fromEntries(Object.entries(l).filter(([k]) => !keys.has(k))));
    setBack((b) => ({ ...b, ...Object.fromEntries(hs.map((h) => [rowKey(h), full ? '' : String(h.qty)])) }));
  }

  async function save() {
    setErr('');
    try {
      const bySiteLines = new Map(); // siteKey -> lines
      for (const h of holdings) {
        const k = siteKey(h.site_id);
        if (!bySiteLines.has(k)) bySiteLines.set(k, []);
        const lines = bySiteLines.get(k);
        const q = n(backOf(h));
        const l = lostOf(h);
        const lq = n(l.qty);
        const what = h.item_name + (h.site_name && groups.length > 1 ? ` at ${h.site_name}` : '');
        if (!Number.isInteger(q) || q < 0 || !Number.isInteger(lq) || lq < 0)
          throw new Error(`${what}: quantity must be a whole number.`);
        if (q + lq > h.qty) throw new Error(`${what}: customer has only ${h.qty}, you entered ${q + lq}.`);
        if (q > 0) lines.push({ item_id: h.item_id, direction: 'in', qty: q });
        if (lq > 0) {
          if (l.rate === '' || !(Number(l.rate) >= 0)) throw new Error(`Price of lost ${h.item_name} is not valid.`);
          lines.push({ item_id: h.item_id, direction: 'in', qty: lq, lost: true, rate: Number(l.rate) });
        }
      }
      const groupsToSave = [...bySiteLines]
        .filter(([, lines]) => lines.length)
        .map(([k, lines]) => ({ site_id: siteIdOf(k), lines }));
      if (!groupsToSave.length) throw new Error('Enter how many of each item came back.');
      setBusy(true);
      const res = await api('/challans', {
        method: 'POST',
        body: { customer_id: Number(customerId), at: at || nowLocal(), vehicle, note, groups: groupsToSave },
      });
      const many = res.ids.length > 1 ? ` ${res.ids.length} return challans made, one for each site.` : '';
      toast(
        (lostTotal ? 'Saved. Returned items are back in store; lost ones will be on the next bill.' : 'Saved. Items are back in store.') +
          many,
      );
      const more = res.ids.slice(1);
      navigate(`/challans/${res.id}?new=1${more.length ? `&more=${more.join(',')}` : ''}`);
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }

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

      {customerId && (
        <Card
          title="How many came back?"
          step="2"
          actions={
            holdings.length > 0 && (
              <button type="button" className={`btn sm ${allBack ? '' : 'primary-soft'}`} onClick={() => returnAll(holdings)}>
                {allBack ? 'Clear' : showSites && groups.length > 1 ? 'Everything came back (all sites)' : 'Everything came back'}
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
            <div className="return-sites">
              {groups.map(([siteId, siteName, hs]) => (
                <div key={siteKey(siteId)} className="return-site">
                  {showSites && (
                    <div className="return-site-head">
                      <Icon name="pin" size={16} />
                      <b>{siteName || 'No site given'}</b>
                      <span className="muted small">{pcsOf(hs)} pcs there</span>
                      {groups.length > 1 && (
                        <button type="button" className="link-btn small" onClick={() => returnAll(hs)}>
                          {allBackIn(hs) ? 'Clear' : 'All from this site'}
                        </button>
                      )}
                    </div>
                  )}
                  <div className="give-list">
                    {hs.map((h) => {
                      const q = n(backOf(h));
                      const l = lostOf(h);
                      const lq = n(l.qty);
                      const over = q + lq > h.qty;
                      return (
                        <div key={rowKey(h)} className={`give-row ${q > 0 || lq > 0 ? 'on green' : ''} ${over ? 'over' : ''}`}>
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
                              onClick={() => setBackOf(h, String(Math.max(h.qty - lq, 0)))}
                            >
                              All {h.qty - lq}
                            </button>
                            <QtyInput
                              value={backOf(h)}
                              onChange={(v) => setBackOf(h, v)}
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
                </div>
              ))}
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
                  {sitesInUse.length > 1 && ` from ${sitesInUse.length} sites`}
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
