import { useState } from 'react';
import { money } from '../format';
import Icon from '../icons';
import { CustomerModal } from './Modals';

const initial = (name) => (name || '?').trim().charAt(0).toUpperCase();

export function CustomerBadge({ c, children }) {
  return (
    <div className="cust">
      <span className="avatar">{initial(c.name)}</span>
      <div className="cust-main">
        <div className="cust-name">{c.name}</div>
        <div className="muted small">{[c.phone, c.address].filter(Boolean).join(' · ') || 'No phone / site saved'}</div>
        {children}
      </div>
    </div>
  );
}

/**
 * Choose a customer by typing part of the name, phone or site.
 * onlyHolding: list only customers who have items right now (for Return / Replace).
 */
export function CustomerPicker({ customers, value, onChange, onCreated, onlyHolding = false }) {
  const [term, setTerm] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState(null);

  const list = customers || [];
  const chosen = list.find((c) => String(c.id) === String(value)) || (created && String(created.id) === String(value) ? created : null);

  if (value && chosen)
    return (
      <div className="picked">
        <CustomerBadge c={chosen}>
          <div className="cust-stats">
            <span className={chosen.pcs_out > 0 ? 'chip-stat blue' : 'chip-stat'}>
              {chosen.pcs_out || 0} pcs with them
            </span>
            <span className={chosen.balance > 0 ? 'chip-stat red' : 'chip-stat'}>
              {chosen.balance > 0 ? `${money(chosen.balance)} due` : 'Nothing due'}
            </span>
          </div>
        </CustomerBadge>
        <button type="button" className="btn sm" onClick={() => onChange('')}>
          Change
        </button>
      </div>
    );

  const t = term.trim().toLowerCase();
  const base = onlyHolding && !showAll ? list.filter((c) => c.pcs_out > 0) : list;
  const matches = base.filter(
    (c) =>
      !t ||
      c.name.toLowerCase().includes(t) ||
      (c.phone || '').includes(t) ||
      (c.address || '').toLowerCase().includes(t) ||
      (c.sites || []).some((x) => x.toLowerCase().includes(t)),
  );

  return (
    <div className="picker">
      <div className="search-box">
        <Icon name="search" size={18} />
        <input
          autoFocus
          placeholder="Type customer name, phone or site…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
      </div>

      <div className="pick-list">
        {matches.map((c) => (
          <button type="button" key={c.id} className="pick-row" onClick={() => onChange(String(c.id))}>
            <span className="avatar sm">{initial(c.name)}</span>
            <span className="pick-text">
              <b>{c.name}</b>
              <span className="muted small">{[c.phone, c.address].filter(Boolean).join(' · ')}</span>
            </span>
            {c.pcs_out > 0 && <span className="chip-stat blue">{c.pcs_out} pcs</span>}
            <Icon name="right" size={18} className="row-chev" />
          </button>
        ))}
        {!matches.length && (
          <p className="muted pad">
            {list.length === 0
              ? 'No customers yet.'
              : onlyHolding && !showAll && !t
                ? 'No customer has items right now.'
                : 'No customer found.'}
          </p>
        )}
      </div>

      <div className="picker-foot">
        <button type="button" className="btn" onClick={() => setAdding(true)}>
          <Icon name="plus" size={18} /> New customer
        </button>
        {onlyHolding && (
          <button type="button" className="link-btn" onClick={() => setShowAll((s) => !s)}>
            {showAll ? 'Show only customers who have items' : 'Show all customers'}
          </button>
        )}
      </div>

      {adding && (
        <CustomerModal
          prefill={/^[\d+\s-]+$/.test(term.trim()) ? { phone: term.trim() } : { name: term.trim() }}
          onClose={() => setAdding(false)}
          onSaved={(c) => {
            setAdding(false);
            setCreated({ ...c, pcs_out: 0, balance: 0 });
            onCreated?.(c);
            onChange(String(c.id));
          }}
        />
      )}
    </div>
  );
}
