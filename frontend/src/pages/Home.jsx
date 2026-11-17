import { Link } from 'react-router-dom';
import { api, qs } from '../api';
import { ChallanList, useShop } from '../components/shared';
import { money, nowLocal } from '../format';
import Icon from '../icons';
import { Card, Loading, Stat, useLoad } from '../ui';
import { DAILY, WORK } from '../work';

export function WorkTile({ k, big }) {
  const w = WORK[k];
  return (
    <Link to={w.path} className={`tile tone-${w.tone} ${big ? 'big' : ''}`}>
      <span className="tile-icon">
        <Icon name={w.icon} size={big ? 28 : 22} />
      </span>
      <span className="tile-text">
        <b>{w.label}</b>
        <span>{w.hint}</span>
      </span>
    </Link>
  );
}

export default function Home() {
  const { shop } = useShop();
  const { data, error } = useLoad(() => api('/dashboard' + qs({ at: nowLocal() })), []);
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <>
      <div className="home-head">
        <div>
          <h1>{shop.shop_name || 'Shuttering Store'}</h1>
          <div className="muted">{today}</div>
        </div>
      </div>

      <div className="tiles">
        {DAILY.map((k) => (
          <WorkTile key={k} k={k} big />
        ))}
        <WorkTile k="store" big />
      </div>

      {!data ? (
        <Loading error={error} />
      ) : (
        <>
          {!data.items.length && (
            <div className="banner">
              <b>First step:</b> add the items in your store (name, how many, rent).{' '}
              <Link to="/store">Go to Store stock →</Link>
            </div>
          )}

          <div className="stats">
            <Stat label="Pieces with customers" value={data.pcs_out} to="/store" />
            <Stat label="Customers holding items" value={data.active_customers} to="/customers" />
            <Stat label="Rent running, not billed" value={money(data.running_rent)} to="/customers" />
            <Stat
              label="Money due from customers"
              value={money(data.total_due)}
              tone={data.total_due > 0 ? 'warn' : ''}
              to="/customers"
            />
          </div>

          <div className="home-grid">
            <Card
              title="Store stock"
              actions={
                <Link className="btn sm" to="/store">
                  Open store
                </Link>
              }
            >
              {data.items.length ? (
                <div className="mini-stock">
                  {data.items.map((i) => (
                    <div key={i.id} className="mini-row">
                      <span className="mini-name">{i.name}</span>
                      <span className={`mini-num ${i.available === 0 ? 'text-bad' : ''}`}>
                        {i.available} <small>in store</small>
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">No items yet.</p>
              )}
            </Card>

            <Card
              title="Recent work"
              actions={
                <Link className="btn sm" to="/challans">
                  See all
                </Link>
              }
            >
              <ChallanList rows={data.recent} empty="No challans yet. Start with “Issue items”." />
            </Card>
          </div>
        </>
      )}
    </>
  );
}
