import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { CustomerPicker } from '../components/CustomerPicker';
import { bySite } from '../components/shared';
import { NO_SITE, SitePicker, siteIdOf } from '../components/SitePicker';
import { money, nowLocal, per, rateText } from '../format';
import Icon from '../icons';
import { Card, Empty, Loading, NoteField, PageHead, QtyInput, SaveBar, Segmented, WhenField, useLoad, useToast } from '../ui';
import { workLink } from '../work';

const newSwap = () => ({
  key: Math.random().toString(36).slice(2),
  back_item: '',
  back_qty: '',
  give_item: '',
  give_qty: '',
  giveTouched: false,
  rate: '',
  basis: 'day',
  rentOpen: false,
});

export default function Replace() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const customers = useLoad(() => api('/customers'), []);
  const items = useLoad(() => api('/items'), []);

  const [customerId, setCustomerId] = useState(params.get('customer') || '');
  const account = useLoad(() => (customerId ? api(`/customers/${customerId}`) : Promise.resolve(null)), [customerId]);
  const [site, setSite] = useState(null);
  const [swaps, setSwaps] = useState([newSwap()]);
  const [at, setAt] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  if (!customers.data || !items.data) return <Loading error={customers.error || items.error} />;

  const siteKey = (siteId) => (siteId ? String(siteId) : NO_SITE);
  const all = account.data?.holdings || [];
  const groups = bySite(all);
  const chosenSite = site ?? (groups.length === 1 ? siteKey(groups[0][0]) : null);
  const holdings = chosenSite === null ? [] : all.filter((h) => siteKey(h.site_id) === chosenSite);
  const showSites = groups.length > 1 || (groups.length === 1 && groups[0][1]);
  const holding = (id) => holdings.find((h) => h.item_id === Number(id));
  const item = (id) => items.data.find((i) => i.id === Number(id));
  const int = (v) => (v === '' ? 0 : Number(v));

  // totals per item, to warn before saving
  const backBy = {};
  const giveBy = {};
  for (const s of swaps) {
    if (s.back_item) backBy[s.back_item] = (backBy[s.back_item] || 0) + int(s.back_qty);
    if (s.give_item) giveBy[s.give_item] = (giveBy[s.give_item] || 0) + int(s.give_qty);
  }
  const tooManyBack = (id) => (holding(id) ? backBy[id] > holding(id).qty : false);
  const tooManyGive = (id) => (item(id) ? (giveBy[id] || 0) - (backBy[id] || 0) > item(id).available : false);

  const update = (key, patch) => setSwaps((all) => all.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  function chooseCustomer(id) {
    setCustomerId(id);
    setSite(null);
    setSwaps([newSwap()]);
    setErr('');
  }

  function buildLines() {
    const used = swaps.filter((s) => s.back_item || s.give_item || s.back_qty || s.give_qty);
    if (!used.length) throw new Error('Choose the item coming back and the item given instead.');
    const inLines = {};
    const outLines = [];
    for (const s of used) {
      const h = holding(s.back_item);
      if (!h) throw new Error('Choose which item the customer gave back.');
      const bq = int(s.back_qty);
      if (!Number.isInteger(bq) || bq < 1) throw new Error(`Enter how many ${h.item_name} came back.`);
      const it = item(s.give_item);
      if (!it) throw new Error(`Choose the item given in place of ${h.item_name}.`);
      const gq = int(s.give_qty);
      if (!Number.isInteger(gq) || gq < 1) throw new Error(`Enter how many ${it.name} were given.`);
      if (s.rate === '' || !(Number(s.rate) >= 0)) throw new Error(`Rent for ${it.name} is not valid.`);
      inLines[h.item_id] = (inLines[h.item_id] || 0) + bq;
      outLines.push({
        item_id: it.id,
        direction: 'out',
        qty: gq,
        rate: Number(s.rate),
        basis: s.basis,
        replaces_item_id: h.item_id,
      });
    }
    for (const [id, q] of Object.entries(inLines)) {
      const h = holding(id);
      if (q > h.qty) throw new Error(`${h.item_name}: customer has only ${h.qty}, you entered ${q}.`);
    }
    for (const id of Object.keys(giveBy)) {
      if (tooManyGive(id)) throw new Error(`Only ${item(id).available} ${item(id).unit} of ${item(id).name} in store.`);
    }
    return [
      ...Object.entries(inLines).map(([id, q]) => ({ item_id: Number(id), direction: 'in', qty: q })),
      ...outLines,
    ];
  }

  async function save() {
    setErr('');
    try {
      const lines = buildLines();
      setBusy(true);
      const res = await api('/challans', {
        method: 'POST',
        body: { customer_id: Number(customerId), site_id: siteIdOf(chosenSite), at: at || nowLocal(), note, lines },
      });
      toast('Saved. Stock updated.');
      navigate(`/challans/${res.id}?new=1`);
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }

  const backTotal = swaps.reduce((s, x) => s + (x.back_item ? int(x.back_qty) : 0), 0);
  const giveTotal = swaps.reduce((s, x) => s + (x.give_item ? int(x.give_qty) : 0), 0);

  return (
    <>
      <PageHead
        work="replace"
        sub="Customer gives some items back and takes other items in their place. Old rent stops, new rent starts."
      />

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
        <Card title="At which site?" step="2">
          <SitePicker
            options={groups.map(([id, name, hs]) => [
              siteKey(id),
              name || 'No site given',
              `${hs.reduce((n, h) => n + h.qty, 0)} pcs there`,
            ])}
            value={chosenSite}
            onChange={(v) => {
              setSite(v);
              setSwaps([newSwap()]);
            }}
          />
        </Card>
      )}

      {customerId && (chosenSite !== null || !account.data || !all.length) && (
        <Card title="What is being replaced?" step={showSites ? '3' : '2'}>
          {!account.data ? (
            <Loading error={account.error} />
          ) : holdings.length === 0 ? (
            <Empty icon="replace" title="This customer has no items right now">
              <Link to={workLink('issue', customerId)}>Issue items to them →</Link>
            </Empty>
          ) : (
            <>
              {swaps.map((s, i) => {
                const h = holding(s.back_item);
                const it = item(s.give_item);
                return (
                  <div className="swap" key={s.key}>
                    <div className="swap-head">
                      <b>Replacement {swaps.length > 1 ? i + 1 : ''}</b>
                      {swaps.length > 1 && (
                        <button
                          type="button"
                          className="icon-btn"
                          title="Remove"
                          onClick={() => setSwaps((all) => all.filter((x) => x.key !== s.key))}
                        >
                          <Icon name="x" size={18} />
                        </button>
                      )}
                    </div>

                    <div className="swap-side back">
                      <div className="swap-label">
                        <Icon name="return" size={16} /> Comes back
                      </div>
                      <div className="swap-fields">
                        <select
                          value={s.back_item}
                          onChange={(e) => update(s.key, { back_item: e.target.value })}
                          className={!s.back_item ? 'placeholder' : ''}
                        >
                          <option value="">Choose item…</option>
                          {holdings.map((x) => (
                            <option key={x.item_id} value={x.item_id}>
                              {x.item_name} (has {x.qty})
                            </option>
                          ))}
                        </select>
                        <QtyInput
                          value={s.back_qty}
                          onChange={(v) => update(s.key, { back_qty: v, ...(s.giveTouched ? {} : { give_qty: v }) })}
                          max={h?.qty}
                          bad={h && tooManyBack(s.back_item)}
                        />
                      </div>
                      {h && tooManyBack(s.back_item) && (
                        <div className="text-bad small strong">Customer has only {h.qty} {h.item_name}.</div>
                      )}
                    </div>

                    <div className="swap-arrow">
                      <Icon name="arrow" size={18} />
                    </div>

                    <div className="swap-side give">
                      <div className="swap-label">
                        <Icon name="issue" size={16} /> Given instead
                      </div>
                      <div className="swap-fields">
                        <select
                          value={s.give_item}
                          className={!s.give_item ? 'placeholder' : ''}
                          onChange={(e) => {
                            const ni = item(e.target.value);
                            update(s.key, {
                              give_item: e.target.value,
                              rate: ni ? String(ni.rate) : '',
                              basis: ni ? ni.basis : 'day',
                            });
                          }}
                        >
                          <option value="">Choose item…</option>
                          {items.data.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name} ({x.available} in store)
                            </option>
                          ))}
                        </select>
                        <QtyInput
                          value={s.give_qty}
                          onChange={(v) => update(s.key, { give_qty: v, giveTouched: true })}
                          bad={it && tooManyGive(s.give_item)}
                        />
                      </div>
                      {it && tooManyGive(s.give_item) && (
                        <div className="text-bad small strong">Only {it.available} {it.name} in store.</div>
                      )}
                      {it && !s.rentOpen && (
                        <div className="muted small">
                          Rent {rateText(s.rate || 0, s.basis)} ·{' '}
                          <button type="button" className="link-btn" onClick={() => update(s.key, { rentOpen: true })}>
                            change rent
                          </button>
                        </div>
                      )}
                      {it && s.rentOpen && (
                        <div className="give-rent">
                          <label>
                            Rent ₹
                            <input
                              type="number"
                              min="0"
                              step="any"
                              inputMode="decimal"
                              value={s.rate}
                              onChange={(e) => update(s.key, { rate: e.target.value })}
                            />
                          </label>
                          <span>per</span>
                          <Segmented
                            options={[
                              ['day', 'Day'],
                              ['hour', 'Hour'],
                            ]}
                            value={s.basis}
                            onChange={(v) => update(s.key, { basis: v })}
                          />
                          {int(s.give_qty) > 0 && (
                            <span className="muted small">
                              = {money(int(s.give_qty) * (Number(s.rate) || 0))} per {per(s.basis)}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              <button type="button" className="btn" onClick={() => setSwaps((all) => [...all, newSwap()])}>
                <Icon name="plus" size={18} /> Replace another item
              </button>
            </>
          )}
        </Card>
      )}

      {customerId && holdings.length > 0 && (
        <>
          <Card className="quiet">
            <WhenField value={at} onChange={setAt} />
            <NoteField value={note} onChange={setNote} placeholder="e.g. 5 plates damaged" />
          </Card>

          {err && <div className="banner bad">{err}</div>}
          <SaveBar
            summary={
              backTotal || giveTotal ? (
                <>
                  <b>{backTotal}</b> back · <b>{giveTotal}</b> given
                </>
              ) : (
                <span className="muted">Nothing entered yet</span>
              )
            }
          >
            <button type="button" className="btn primary big" disabled={busy || !backTotal} onClick={save}>
              {busy ? 'Saving…' : 'Save replacement'}
            </button>
          </SaveBar>
        </>
      )}
    </>
  );
}
