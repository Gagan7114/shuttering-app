import { useState } from 'react';
import { api } from '../api';
import { ItemModal } from '../components/Modals';
import { money, rateText } from '../format';
import Icon from '../icons';
import { Card, Empty, Loading, PageHead, Stat, confirmAction, useLoad, useToast } from '../ui';

export default function Store() {
  const { data, error, reload } = useLoad(() => api('/items'), []);
  const [editing, setEditing] = useState(null); // null | 'new' | item
  const [term, setTerm] = useState('');
  const toast = useToast();

  async function remove(item) {
    if (!confirmAction(`Delete ${item.name}?`)) return;
    try {
      await api(`/items/${item.id}`, { method: 'DELETE' });
      toast('Item deleted');
      reload();
    } catch (e) {
      toast(e.message, 'bad');
    }
  }

  const items = data || [];
  const t = term.trim().toLowerCase();
  const shown = items.filter(
    (i) => !t || i.name.toLowerCase().includes(t) || (i.category || '').toLowerCase().includes(t),
  );
  const inStore = items.reduce((s, i) => s + i.available, 0);
  const out = items.reduce((s, i) => s + i.out_qty, 0);
  const categories = [...new Set(items.map((i) => i.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const groups = categories.length
    ? [...categories.map((c) => [c, shown.filter((i) => i.category === c)]), ['Other items', shown.filter((i) => !i.category)]]
    : [['', shown]];

  return (
    <>
      <PageHead work="store" sub="Everything you rent out: how many you own, how many are in the store, and the rent.">
        <button className="btn primary" onClick={() => setEditing('new')}>
          <Icon name="plus" size={18} /> Add item
        </button>
      </PageHead>

      {!data ? (
        <Loading error={error} />
      ) : items.length === 0 ? (
        <Card>
          <Empty title="No items yet">
            Add each kind of material you rent out — plates, props, jacks, spans…
            <div className="mt">
              <button className="btn primary big" onClick={() => setEditing('new')}>
                <Icon name="plus" size={18} /> Add your first item
              </button>
            </div>
          </Empty>
        </Card>
      ) : (
        <>
          <div className="stats">
            <Stat label="Kinds of items" value={items.length} />
            <Stat label="Pieces in store" value={inStore} />
            <Stat label="Pieces with customers" value={out} />
          </div>

          {items.length > 6 && (
            <div className="search-box mb">
              <Icon name="search" size={18} />
              <input placeholder="Find item…" value={term} onChange={(e) => setTerm(e.target.value)} />
            </div>
          )}

          {groups
            .filter(([, list]) => list.length)
            .map(([cat, list]) => (
          <div key={cat} className="stock-group">
          {cat && <h2 className="group-title">{cat}</h2>}
          <div className="stock-grid">
            {list.map((i) => {
              const pct = i.total_qty > 0 ? Math.min(100, Math.round((i.available / i.total_qty) * 100)) : 0;
              return (
                <div key={i.id} className={`stock-card ${i.available === 0 ? 'empty-stock' : ''}`}>
                  <div className="stock-top">
                    <div>
                      <div className="stock-name">{i.name}</div>
                      <div className="muted small">{rateText(i.rate, i.basis)} per piece</div>
                    </div>
                    <div className="stock-btns">
                      <button className="icon-btn" title="Edit" onClick={() => setEditing(i)}>
                        <Icon name="edit" size={17} />
                      </button>
                      {!i.used && (
                        <button className="icon-btn danger" title="Delete" onClick={() => remove(i)}>
                          <Icon name="trash" size={17} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="stock-nums">
                    <div>
                      <div className={`stock-big ${i.available === 0 ? 'text-bad' : ''}`}>{i.available}</div>
                      <div className="muted small">in store</div>
                    </div>
                    <div className="stock-side">
                      <div>
                        <b>{i.out_qty}</b> with customers
                      </div>
                      <div>
                        <b>{i.total_qty}</b> total {i.unit}
                      </div>
                    </div>
                  </div>
                  <div className="bar" title={`${pct}% in store`}>
                    <span style={{ width: `${pct}%` }} />
                  </div>
                  {(i.lost_qty > 0 || Number(i.lost_rate) > 0) && (
                    <div className="muted small mt-s">
                      {Number(i.lost_rate) > 0 && <>If lost: {money(i.lost_rate)} each</>}
                      {i.lost_qty > 0 && Number(i.lost_rate) > 0 && ' · '}
                      {i.lost_qty > 0 && <span className="text-bad">{i.lost_qty} lost so far</span>}
                    </div>
                  )}
                  {i.note && <div className="muted small mt-s">{i.note}</div>}
                </div>
              );
            })}
          </div>
          </div>
            ))}
          {!shown.length && <p className="muted">No item found.</p>}
        </>
      )}

      {editing && (
        <ItemModal
          item={editing === 'new' ? null : editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            toast('Item saved');
            reload();
          }}
        />
      )}
    </>
  );
}
