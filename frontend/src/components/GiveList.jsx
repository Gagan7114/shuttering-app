import { useState } from 'react';
import { money, per, rateText } from '../format';
import Icon from '../icons';
import { QtyInput, Segmented } from '../ui';

/*
 * All store items in a list with a quantity box each — type how many you give.
 * picks = { [itemId]: { qty, rate, basis, rentOpen } }  (strings, '' = not set)
 */

const pickOf = (picks, it) => picks[it.id] || { qty: '', rate: String(it.rate), basis: it.basis, rentOpen: false };

export function GiveList({ items, picks, setPicks }) {
  const [term, setTerm] = useState('');
  const update = (it, patch) => setPicks((all) => ({ ...all, [it.id]: { ...pickOf(all, it), ...patch } }));

  const t = term.trim().toLowerCase();
  const shown = items.filter((it) => !t || it.name.toLowerCase().includes(t) || Number(picks[it.id]?.qty) > 0);

  return (
    <div>
      {items.length > 8 && (
        <div className="search-box mb">
          <Icon name="search" size={18} />
          <input placeholder="Find item…" value={term} onChange={(e) => setTerm(e.target.value)} />
        </div>
      )}
      <div className="give-list">
        {shown.map((it) => {
          const p = pickOf(picks, it);
          const qty = Number(p.qty) || 0;
          const over = qty > it.available;
          const rentChanged = p.rate !== String(it.rate) || p.basis !== it.basis;
          return (
            <div key={it.id} className={`give-row ${qty > 0 ? 'on' : ''} ${over ? 'over' : ''}`}>
              <div className="give-main">
                <div className="give-name">{it.name}</div>
                <div className="muted small">
                  <span className={it.available === 0 ? 'text-bad strong' : ''}>
                    {it.available === 0 ? 'None in store' : `In store: ${it.available} ${it.unit}`}
                  </span>
                  {' · '}
                  <span className={rentChanged ? 'strong' : ''}>{rateText(p.rate === '' ? 0 : p.rate, p.basis)}</span>
                  {qty > 0 && !p.rentOpen && (
                    <>
                      {' · '}
                      <button type="button" className="link-btn" onClick={() => update(it, { rentOpen: true })}>
                        change rent
                      </button>
                    </>
                  )}
                </div>
                {over && <div className="text-bad small strong">Only {it.available} in store!</div>}
              </div>
              <QtyInput value={p.qty} onChange={(v) => update(it, { qty: v })} max={it.available} bad={over} />
              {qty > 0 && p.rentOpen && (
                <div className="give-rent">
                  <label>
                    Rent ₹
                    <input
                      type="number"
                      min="0"
                      step="any"
                      inputMode="decimal"
                      value={p.rate}
                      onChange={(e) => update(it, { rate: e.target.value })}
                    />
                  </label>
                  <span>per</span>
                  <Segmented
                    options={[
                      ['day', 'Day'],
                      ['hour', 'Hour'],
                    ]}
                    value={p.basis}
                    onChange={(v) => update(it, { basis: v })}
                  />
                  <span className="muted small">
                    = {money(qty * (Number(p.rate) || 0))} per {per(p.basis)} for {qty}
                  </span>
                </div>
              )}
            </div>
          );
        })}
        {!shown.length && <p className="muted pad">No item found.</p>}
      </div>
    </div>
  );
}

/** Chosen items → API lines. Throws a readable Error for bad input. */
export function picksToLines(picks, items) {
  const lines = [];
  for (const it of items) {
    const p = picks[it.id];
    if (!p || p.qty === '') continue;
    const qty = Number(p.qty);
    if (!Number.isInteger(qty) || qty < 0) throw new Error(`${it.name}: quantity must be a whole number.`);
    if (qty === 0) continue;
    if (qty > it.available) throw new Error(`Only ${it.available} ${it.unit} of ${it.name} in store.`);
    if (p.rate === '' || !(Number(p.rate) >= 0)) throw new Error(`Rent for ${it.name} is not valid.`);
    lines.push({ item_id: it.id, direction: 'out', qty, rate: Number(p.rate), basis: p.basis });
  }
  return lines;
}

/** e.g. "3 items · 45 pcs · ₹250 per day" */
export function picksSummary(picks, items) {
  let n = 0;
  let pcs = 0;
  const rent = {};
  for (const it of items) {
    const p = picks[it.id];
    const q = Number(p?.qty) || 0;
    if (q <= 0) continue;
    n += 1;
    pcs += q;
    rent[p.basis] = (rent[p.basis] || 0) + q * (Number(p.rate) || 0);
  }
  return { n, pcs, rent };
}
