import { createContext, useContext } from 'react';
import { Link } from 'react-router-dom';
import { KIND_LABEL, fmtAt, fmtDate, money, rateText, unitsText } from '../format';
import Icon from '../icons';
import { KIND_WORK, WORK } from '../work';

/* ---------- shop settings (name/address for headers & prints) ---------- */

export const ShopContext = createContext({ shop: {}, setShop: () => {} });
export const useShop = () => useContext(ShopContext);

export function DocHeader({ shop, title }) {
  return (
    <div className="doc-head">
      <div>
        <div className="doc-shop">{shop.shop_name}</div>
        {shop.address && <div className="muted">{shop.address}</div>}
        {shop.phone && <div className="muted">Phone: {shop.phone}</div>}
        {shop.gst_enabled && shop.gstin && <div className="muted">GSTIN: {shop.gstin}</div>}
      </div>
      <div className="doc-title">{title}</div>
    </div>
  );
}

/* ---------- challans ---------- */

export function KindPill({ kind }) {
  const w = WORK[KIND_WORK[kind]];
  return <span className={`pill tone-${w?.tone || 'slate'}`}>{KIND_LABEL[kind] || kind}</span>;
}

export function challanSummary(lines) {
  const back = lines.filter((l) => l.direction === 'in' && !l.lost);
  const lost = lines.filter((l) => l.lost);
  const given = lines.filter((l) => l.direction === 'out');
  const parts = [];
  const text = (ls) => ls.map((l) => `${l.item_name} × ${l.qty}`).join(', ');
  if (back.length) parts.push(['in', 'Back', text(back)]);
  if (lost.length) parts.push(['lost', 'Lost', text(lost)]);
  if (given.length) parts.push(['out', 'Given', text(given)]);
  return parts;
}

export function SiteTag({ name }) {
  if (!name) return null;
  return (
    <span className="site-tag">
      <Icon name="pin" size={13} />
      {name}
    </span>
  );
}

/** List of challans; each row opens the challan. */
export function ChallanList({ rows, showCustomer = true, empty = 'Nothing here yet.' }) {
  if (!rows.length) return <p className="muted pad">{empty}</p>;
  return (
    <div className="rows">
      {rows.map((t) => {
        const w = WORK[KIND_WORK[t.kind]];
        return (
          <Link key={t.id} to={`/challans/${t.id}`} className="row-link challan-row">
            <span className={`row-icon tone-${w.tone}`}>
              <Icon name={w.icon} size={18} />
            </span>
            <div className="row-main">
              <div className="row-title">
                {showCustomer ? t.customer_name : KIND_LABEL[t.kind]}
                <span className="muted small"> · Challan #{t.id}</span> <SiteTag name={t.site_name} />
              </div>
              {challanSummary(t.lines).map(([dir, label, text]) => (
                <div key={dir} className="row-sub">
                  <span className={`tag ${dir}`}>{label}</span> {text}
                </div>
              ))}
            </div>
            <div className="row-side">
              {showCustomer && <KindPill kind={t.kind} />}
              <div className="muted small nowrap">{fmtAt(t.at)}</div>
            </div>
            <Icon name="right" size={18} className="row-chev" />
          </Link>
        );
      })}
    </div>
  );
}

/** List of saved bills; each row opens the bill. */
export function BillList({ rows, showCustomer = true, empty = 'No bills yet.' }) {
  if (!rows.length) return <p className="muted pad">{empty}</p>;
  return (
    <div className="rows">
      {rows.map((b) => (
        <Link key={b.id} to={`/bills/${b.id}`} className="row-link">
          <span className="row-icon tone-violet">
            <Icon name="bill" size={18} />
          </span>
          <div className="row-main">
            <div className="row-title">
              {showCustomer ? b.customer_name : `Bill #${b.bill_no}`}
              {showCustomer && <span className="muted small"> · Bill #{b.bill_no}</span>}
            </div>
            <div className="row-sub muted">
              {b.from_at ? fmtDate(b.from_at) : 'Start'} → {fmtDate(b.upto_at)}
            </div>
          </div>
          <div className="row-side">
            <div className="strong">{money(b.total)}</div>
          </div>
          <Icon name="right" size={18} className="row-chev" />
        </Link>
      ))}
    </div>
  );
}

/* ---------- items with a customer ---------- */

/** Holdings grouped by site: [[siteId, siteName, holdings], ...] */
export function bySite(holdings) {
  const groups = new Map();
  for (const h of holdings) {
    const key = h.site_id ?? '';
    if (!groups.has(key)) groups.set(key, [key, h.site_name || '', []]);
    groups.get(key)[2].push(h);
  }
  return [...groups.values()];
}

export function HoldingsList({ holdings }) {
  if (!holdings.length) return <p className="muted pad">Nothing with this customer right now.</p>;
  const groups = bySite(holdings);
  const named = groups.some(([, name]) => name);
  return groups.map(([key, name, hs]) => (
    <div key={key} className="site-group">
      {named && (
        <div className="site-group-head">
          <Icon name="pin" size={16} /> {name || 'No site given'}
          <span className="muted small">· {hs.reduce((n, h) => n + h.qty, 0)} pcs</span>
        </div>
      )}
      <HoldingRows holdings={hs} />
    </div>
  ));
}

function HoldingRows({ holdings }) {
  return (
    <div className="rows">
      {holdings.map((h) => (
        <div key={`${h.site_id}-${h.item_id}`} className="row-link static">
          <span className="row-icon tone-orange">
            <Icon name="store" size={18} />
          </span>
          <div className="row-main">
            <div className="row-title">{h.item_name}</div>
            {h.lots.map((l, i) => (
              <div key={i} className="row-sub muted">
                {l.qty} given on {fmtAt(l.at)} · {rateText(l.rate, l.basis)}
              </div>
            ))}
          </div>
          <div className="row-side">
            <div className="big-num">{h.qty}</div>
            <div className="muted small">{h.unit}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------- rent lines (preview and saved bills) ---------- */

export function RentTable({ lines, empty = 'No rent in this period.' }) {
  if (!lines.length) return <p className="muted">{empty}</p>;
  return (
    <div className="table-wrap">
      <table className="tbl rent">
        <thead>
          <tr>
            <th>#</th>
            <th>Item</th>
            <th className="r">Qty</th>
            <th>From</th>
            <th>To</th>
            <th className="r">Time</th>
            <th className="r">Rent</th>
            <th className="r">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>
                {l.item_name}
                {l.site_name && (
                  <div>
                    <SiteTag name={l.site_name} />
                  </div>
                )}
                <div>
                  {l.status === 'out' ? (
                    <span className="pill warn">still with customer</span>
                  ) : l.status === 'lost' ? (
                    <span className="pill bad">lost — rent up to this day</span>
                  ) : (
                    <span className="pill ok">returned</span>
                  )}
                </div>
              </td>
              <td className="r nowrap">
                {l.qty} {l.unit}
              </td>
              <td className="nowrap">{fmtAt(l.from_at)}</td>
              <td className="nowrap">{fmtAt(l.to_at)}</td>
              <td className="r nowrap">
                {unitsText(l.units, l.basis)}
                {l.prev_units > 0 && (
                  <div className="muted xs">
                    {l.prev_units + l.units} total − {l.prev_units} billed before
                  </div>
                )}
              </td>
              <td className="r nowrap">{rateText(l.rate, l.basis)}</td>
              <td className="r nowrap">{money(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- lost pieces (charged once, at the lost price) ---------- */

export function LostTable({ lines }) {
  if (!lines.length) return null;
  return (
    <div className="table-wrap">
      <table className="tbl rent">
        <thead>
          <tr>
            <th>#</th>
            <th>Item lost</th>
            <th className="r">Qty</th>
            <th>Reported on</th>
            <th className="r">Price</th>
            <th className="r">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>
                {l.item_name}
                {l.site_name && (
                  <div>
                    <SiteTag name={l.site_name} />
                  </div>
                )}
              </td>
              <td className="r nowrap">
                {l.qty} {l.unit}
              </td>
              <td className="nowrap">{fmtAt(l.at || l.from_at)}</td>
              <td className="r nowrap">{money(l.rate)}</td>
              <td className="r nowrap">{money(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
