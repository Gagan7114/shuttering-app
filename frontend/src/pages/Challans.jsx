import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../api';
import { ChallanList } from '../components/shared';
import Icon from '../icons';
import { Card, Loading, PageHead, Segmented, useLoad } from '../ui';

const KINDS = [
  ['all', 'All'],
  ['issue', 'Issue'],
  ['return', 'Return'],
  ['swap', 'Replace'],
];

export default function Challans() {
  const [params] = useSearchParams();
  const customer = params.get('customer') || '';
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const { data, error } = useLoad(() => api('/challans' + qs({ customer, from, to })), [customer, from, to]);
  const [kind, setKind] = useState('all');
  const [search, setSearch] = useState('');

  const term = search.trim().toLowerCase();
  const rows = (data || [])
    .filter((t) => kind === 'all' || t.kind === kind)
    .filter(
      (t) =>
        !term ||
        t.customer_name.toLowerCase().includes(term) ||
        (t.site_name || '').toLowerCase().includes(term) ||
        (t.vehicle || '').toLowerCase().includes(term) ||
        String(t.id) === term.replace('#', '') ||
        t.lines.some((l) => l.item_name.toLowerCase().includes(term)),
    );

  return (
    <>
      <PageHead work="challans" sub="Every issue, return and replacement. Tap one to see or print it." />
      <Card>
        <div className="toolbar">
          <div className="search-box">
            <Icon name="search" size={18} />
            <input
              placeholder="Customer, site, item, vehicle or challan no…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Segmented options={KINDS} value={kind} onChange={setKind} />
        </div>
        <div className="toolbar dates">
          <label className="inline-field">
            From
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="inline-field">
            To
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </label>
          {(from || to) && (
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setFrom('');
                setTo('');
              }}
            >
              Clear dates
            </button>
          )}
          {data && <span className="muted small">{rows.length} challan{rows.length === 1 ? '' : 's'}</span>}
        </div>
        {!data ? <Loading error={error} /> : <ChallanList rows={rows} empty="No challans found." />}
      </Card>
    </>
  );
}
