import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { BillList } from '../components/shared';
import { money } from '../format';
import Icon from '../icons';
import { Card, Loading, PageHead, useLoad } from '../ui';

export default function Bills() {
  const { data, error } = useLoad(() => api('/bills'), []);
  const [search, setSearch] = useState('');

  const term = search.trim().toLowerCase();
  const rows = (data || []).filter(
    (b) => !term || b.customer_name.toLowerCase().includes(term) || String(b.bill_no) === term.replace('#', ''),
  );
  const total = rows.reduce((s, b) => s + Number(b.total), 0);

  return (
    <>
      <PageHead work="bills" sub="Every bill made so far. Tap one to see or print it.">
        <Link className="btn primary" to="/bill">
          <Icon name="plus" size={18} /> Make bill
        </Link>
      </PageHead>
      <Card>
        <div className="toolbar">
          <div className="search-box">
            <Icon name="search" size={18} />
            <input placeholder="Customer or bill no…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {rows.length > 0 && (
            <span className="muted">
              {rows.length} bill{rows.length > 1 ? 's' : ''} · <b>{money(total)}</b>
            </span>
          )}
        </div>
        {!data ? <Loading error={error} /> : <BillList rows={rows} empty="No bills found." />}
      </Card>
    </>
  );
}
