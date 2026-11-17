import { useState } from 'react';
import { api } from '../api';
import { Field, Modal, Segmented } from '../ui';

const UNITS = ['pcs', 'nos', 'set', 'sqft', 'meter', 'kg'];

export function ItemModal({ item, categories = [], onClose, onSaved }) {
  const [f, setF] = useState({
    name: item?.name ?? '',
    unit: item?.unit ?? 'pcs',
    total_qty: item?.total_qty ?? '',
    rate: item?.rate ?? '',
    basis: item?.basis ?? 'day',
    category: item?.category ?? '',
    lost_rate: item?.lost_rate ?? '',
    note: item?.note ?? '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function save() {
    if (!f.name.trim()) throw new Error('Item name is required.');
    if (f.total_qty === '') throw new Error('Enter how many you own.');
    if (f.rate === '') throw new Error('Enter the rent.');
    const body = { ...f, lost_rate: f.lost_rate === '' ? 0 : f.lost_rate };
    const saved = item
      ? await api(`/items/${item.id}`, { method: 'PUT', body })
      : await api('/items', { method: 'POST', body });
    onSaved(saved);
  }

  return (
    <Modal title={item ? `Edit ${item.name}` : 'Add item to store'} onClose={onClose} onSubmit={save}>
      <Field label="Item name *">
        <input autoFocus value={f.name} onChange={set('name')} placeholder="e.g. Steel plate 3×2 ft" />
      </Field>
      <div className="grid2">
        <Field label="How many you own *" hint={item ? `${item.out_qty} are with customers right now` : ''}>
          <input type="number" min="0" step="1" inputMode="numeric" value={f.total_qty} onChange={set('total_qty')} />
        </Field>
        <Field label="Unit">
          <input list="unit-list" value={f.unit} onChange={set('unit')} />
          <datalist id="unit-list">
            {UNITS.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </Field>
      </div>
      <div className="grid2">
        <Field label="Rent ₹ for 1 piece *">
          <input type="number" min="0" step="any" inputMode="decimal" value={f.rate} onChange={set('rate')} />
        </Field>
        <Field label="Rent per">
          <Segmented
            options={[
              ['day', 'Day'],
              ['hour', 'Hour'],
            ]}
            value={f.basis}
            onChange={(v) => setF({ ...f, basis: v })}
          />
        </Field>
      </div>
      {item && <p className="muted small">New rent applies to new issues only. Items already given keep their old rent.</p>}
      <div className="grid2">
        <Field label="Category (optional)" hint="e.g. Plates, Props, Spans">
          <input list="category-list" value={f.category} onChange={set('category')} />
          <datalist id="category-list">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Price ₹ if 1 piece is lost" hint="Charged on the bill when a customer loses one">
          <input type="number" min="0" step="any" inputMode="decimal" value={f.lost_rate} onChange={set('lost_rate')} />
        </Field>
      </div>
      <Field label="Note (optional)">
        <input value={f.note} onChange={set('note')} />
      </Field>
    </Modal>
  );
}

/** Edit a customer, or add a new one (optionally with a name/phone already typed in). */
export function CustomerModal({ customer, prefill, onClose, onSaved }) {
  const start = customer || prefill || {};
  const [f, setF] = useState({
    name: start.name ?? '',
    phone: start.phone ?? '',
    address: start.address ?? '',
    gstin: start.gstin ?? '',
    note: start.note ?? '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function save() {
    if (!f.name.trim()) throw new Error('Customer name is required.');
    const saved = customer
      ? await api(`/customers/${customer.id}`, { method: 'PUT', body: f })
      : await api('/customers', { method: 'POST', body: f });
    onSaved(saved);
  }

  return (
    <Modal title={customer ? 'Edit customer' : 'New customer'} onClose={onClose} onSubmit={save}>
      <Field label="Name *">
        <input autoFocus value={f.name} onChange={set('name')} />
      </Field>
      <Field label="Phone">
        <input type="tel" inputMode="tel" value={f.phone} onChange={set('phone')} />
      </Field>
      <Field label="Address">
        <input value={f.address} onChange={set('address')} />
      </Field>
      <Field label="GSTIN (optional)" hint="Only if the customer wants a GST bill in their name">
        <input
          value={f.gstin}
          onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })}
          maxLength={15}
          placeholder="e.g. 03ABCDE1234F1Z5"
        />
      </Field>
      <Field label="Note">
        <input value={f.note} onChange={set('note')} />
      </Field>
      {!customer && <p className="muted small">You can add the customer's work sites from their page.</p>}
    </Modal>
  );
}

/** Add or edit a work site of a customer. */
export function SiteModal({ customerId, site, onClose, onSaved }) {
  const [f, setF] = useState({ name: site?.name ?? '', address: site?.address ?? '', note: site?.note ?? '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function save() {
    if (!f.name.trim()) throw new Error('Site name is required.');
    const saved = site
      ? await api(`/sites/${site.id}`, { method: 'PUT', body: f })
      : await api(`/customers/${customerId}/sites`, { method: 'POST', body: f });
    onSaved(saved);
  }

  return (
    <Modal title={site ? 'Edit site' : 'New site'} onClose={onClose} onSubmit={save}>
      <Field label="Site name *" hint="A short name you will recognise, e.g. Model Town house">
        <input autoFocus value={f.name} onChange={set('name')} />
      </Field>
      <Field label="Site address">
        <input value={f.address} onChange={set('address')} />
      </Field>
      <Field label="Note">
        <input value={f.note} onChange={set('note')} />
      </Field>
    </Modal>
  );
}
