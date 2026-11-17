import { useState } from 'react';
import Icon from '../icons';
import { SiteModal } from './Modals';

export const NO_SITE = 'none';

/**
 * Choose the customer's work site.
 * options: [[value, name, sub]]  (value = site id as string, or NO_SITE)
 * customerId + onCreated: show a "New site" button.
 */
export function SitePicker({ options, value, onChange, customerId, onCreated }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="site-pick">
      {options.map(([v, name, sub]) => (
        <button
          key={v}
          type="button"
          className={`site-opt ${value === v ? 'on' : ''}`}
          aria-pressed={value === v}
          onClick={() => onChange(v)}
        >
          <Icon name="pin" size={16} />
          <span>
            <b>{name}</b>
            {sub && <span className="muted small">{sub}</span>}
          </span>
        </button>
      ))}
      {customerId && (
        <button type="button" className="site-opt add" onClick={() => setAdding(true)}>
          <Icon name="plus" size={16} /> New site
        </button>
      )}
      {adding && (
        <SiteModal
          customerId={customerId}
          onClose={() => setAdding(false)}
          onSaved={(s) => {
            setAdding(false);
            onCreated?.(s);
            onChange(String(s.id));
          }}
        />
      )}
    </div>
  );
}

/** Site of a challan for the API: id, or null for "no site". */
export const siteIdOf = (value) => (value && value !== NO_SITE ? Number(value) : null);
