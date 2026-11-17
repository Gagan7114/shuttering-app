import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { CustomerModal } from '../components/Modals';
import { money } from '../format';
import Icon from '../icons';
import { Card, Empty, Loading, PageHead, Segmented, useLoad, useToast } from '../ui';

export default function Customers() {
  const { data, error } = useLoad(() => api('/customers'), []);
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
  const [show, setShow] = useState('all');
  const navigate = useNavigate();
  const toast = useToast();

  const list = data || [];
  const term = search.trim().toLowerCase();
  const rows = list
    .filter((c) => show !== 'items' || c.pcs_out > 0)
    .filter((c) => show !== 'due' || c.balance > 0)
    .filter(
      (c) =>
        !term ||
        c.name.toLowerCase().includes(term) ||
        (c.phone || '').includes(term) ||
        (c.address || '').toLowerCase().includes(term) ||
        (c.sites || []).some((x) => x.toLowerCase().includes(term)),
    );

  return (
    <>
      <PageHead work="customers" sub="Tap a customer to see their items, challans, bills and payments.">
        <button className="btn primary" onClick={() => setAdding(true)}>
          <Icon name="plus" size={18} /> New customer
        </button>
      </PageHead>

      {!data ? (
        <Loading error={error} />
      ) : list.length === 0 ? (
        <Card>
          <Empty icon="customers" title="No customers yet">
            Add one here, or while issuing items.
          </Empty>
        </Card>
      ) : (
        <Card>
          <div className="toolbar">
            <div className="search-box">
              <Icon name="search" size={18} />
              <input placeholder="Search name, phone or site…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Segmented
              options={[
                ['all', `All (${list.length})`],
                ['items', `Have items (${list.filter((c) => c.pcs_out > 0).length})`],
                ['due', `Money due (${list.filter((c) => c.balance > 0).length})`],
              ]}
              value={show}
              onChange={setShow}
            />
          </div>
          {rows.length === 0 ? (
            <p className="muted pad">No customer found.</p>
          ) : (
            <div className="rows">
              {rows.map((c) => (
                <Link key={c.id} to={`/customers/${c.id}`} className="row-link">
                  <span className="avatar sm">{c.name.trim().charAt(0).toUpperCase()}</span>
                  <div className="row-main">
                    <div className="row-title">{c.name}</div>
                    <div className="row-sub muted">
                      {[c.phone, c.address].filter(Boolean).join(' · ') || '—'}
                      {c.sites?.length > 0 && ` · ${c.sites.length} site${c.sites.length > 1 ? 's' : ''}`}
                    </div>
                  </div>
                  <div className="row-side">
                    {c.pcs_out > 0 && <span className="chip-stat blue">{c.pcs_out} pcs</span>}
                    {c.balance > 0 && <span className="chip-stat red">{money(c.balance)} due</span>}
                  </div>
                  <Icon name="right" size={18} className="row-chev" />
                </Link>
              ))}
            </div>
          )}
        </Card>
      )}

      {adding && (
        <CustomerModal
          onClose={() => setAdding(false)}
          onSaved={(c) => {
            toast('Customer added');
            navigate(`/customers/${c.id}`);
          }}
        />
      )}
    </>
  );
}
