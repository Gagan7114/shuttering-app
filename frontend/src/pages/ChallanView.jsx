import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { DocHeader } from '../components/shared';
import { KIND_LABEL, fmtAt, money, rateText } from '../format';
import Icon from '../icons';
import { Loading, PageHead, confirmAction, useLoad, useToast } from '../ui';
import { KIND_WORK, WORK, workLink } from '../work';

const TITLES = { issue: 'Delivery Challan', return: 'Return Challan', swap: 'Return & Replace Challan' };

export default function ChallanView() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data: t, error } = useLoad(() => api(`/challans/${id}`), [id]);
  if (!t) return <Loading error={error} />;

  const given = t.lines.filter((l) => l.direction === 'out');
  const back = t.lines.filter((l) => l.direction === 'in' && !l.lost);
  const lost = t.lines.filter((l) => l.lost);
  // Other challans saved in the same go (a return from several sites makes one challan per site).
  const more = (params.get('more') || '').split(',').filter((x) => /^\d+$/.test(x));

  async function remove() {
    if (!confirmAction(`Delete challan #${t.id}? Stock will be put back as it was.`)) return;
    try {
      await api(`/challans/${t.id}`, { method: 'DELETE' });
      toast('Challan deleted');
      navigate(`/customers/${t.customer_id}`);
    } catch (e) {
      toast(e.message, 'bad');
    }
  }

  return (
    <>
      <PageHead
        title={`Challan #${t.id}`}
        sub={`${KIND_LABEL[t.kind]} · ${t.customer_name}`}
        work={KIND_WORK[t.kind]}
        back={{ to: '/challans', label: 'All challans' }}
      >
        <button className="btn primary" onClick={() => window.print()}>
          <Icon name="printer" size={18} /> Print
        </button>
        <Link className="btn" to={`/customers/${t.customer_id}`}>
          Customer account
        </Link>
        {t.locked ? (
          <span className="muted small">In Bill #{t.locked_by_bill}, can't delete.</span>
        ) : (
          <button className="btn danger" onClick={remove}>
            <Icon name="trash" size={16} /> Delete
          </button>
        )}
      </PageHead>

      {params.get('new') && (
        <div className="banner ok no-print done">
          <Icon name="check" size={20} />
          <span>Saved. Store stock is updated.</span>
          {more.length > 0 && (
            <span>
              One challan per site. Also made:{' '}
              {more.map((m, i) => (
                <span key={m}>
                  {i > 0 && ', '}
                  <Link to={`/challans/${m}`}>Challan #{m}</Link>
                </span>
              ))}
            </span>
          )}
          <span className="done-links">
            <Link to="/">Home</Link>
            {t.kind !== 'issue' && t.customer_pcs_out === 0 && (
              <Link to={workLink('bill', t.customer_id)}>All items are back — make bill now</Link>
            )}
            <Link to={workLink(KIND_WORK[t.kind])}>{WORK[KIND_WORK[t.kind]].label} again</Link>
          </span>
        </div>
      )}
      {params.get('new') && t.kind !== 'issue' && t.customer_pcs_out > 0 && (
        <div className="banner no-print">
          <b>
            {t.customer_name} still has {t.customer_pcs_out} pcs.
          </b>{' '}
          No bill needed yet: one bill will cover everything once all items are back.{' '}
          <Link to={workLink('bill', t.customer_id)}>Make a separate bill now</Link>
        </div>
      )}

      <div className="doc card">
        <DocHeader shop={t.shop} title={TITLES[t.kind]} />
        <div className="doc-meta">
          <div>
            <div className="muted small">To</div>
            <b>{t.customer.name}</b>
            {t.customer.phone && <div>{t.customer.phone}</div>}
            {t.customer.address && !t.site_name && <div>{t.customer.address}</div>}
            {t.site_name && (
              <div>
                Site: <b>{t.site_name}</b>
                {t.site_address && `, ${t.site_address}`}
              </div>
            )}
          </div>
          <div className="r">
            <div>
              Challan No: <b>{t.id}</b>
            </div>
            <div>
              Date: <b>{fmtAt(t.at)}</b>
            </div>
            {t.vehicle && (
              <div>
                Vehicle: <b>{t.vehicle}</b>
              </div>
            )}
          </div>
        </div>

        {back.length > 0 && (
          <>
            <h3>Items returned</h3>
            <table className="tbl doc-tbl">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Item</th>
                  <th className="r">Qty</th>
                </tr>
              </thead>
              <tbody>
                {back.map((l, i) => (
                  <tr key={l.id}>
                    <td>{i + 1}</td>
                    <td>{l.item_name}</td>
                    <td className="r">
                      {l.qty} {l.unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {lost.length > 0 && (
          <>
            <h3>Items lost by customer (charged on the bill)</h3>
            <table className="tbl doc-tbl">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Item</th>
                  <th className="r">Qty</th>
                  <th className="r">Price</th>
                  <th className="r">Amount</th>
                </tr>
              </thead>
              <tbody>
                {lost.map((l, i) => (
                  <tr key={l.id}>
                    <td>{i + 1}</td>
                    <td>{l.item_name}</td>
                    <td className="r">
                      {l.qty} {l.unit}
                    </td>
                    <td className="r">{money(l.rate)}</td>
                    <td className="r">{money(l.qty * l.rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {given.length > 0 && (
          <>
            <h3>Items given</h3>
            <table className="tbl doc-tbl">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Item</th>
                  <th className="r">Qty</th>
                  <th className="r">Rent</th>
                </tr>
              </thead>
              <tbody>
                {given.map((l, i) => (
                  <tr key={l.id}>
                    <td>{i + 1}</td>
                    <td>
                      {l.item_name}
                      {l.replaces_name && <div className="muted small">in place of {l.replaces_name}</div>}
                    </td>
                    <td className="r">
                      {l.qty} {l.unit}
                    </td>
                    <td className="r">{rateText(l.rate, l.basis)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {t.note && (
          <p>
            <b>Note:</b> {t.note}
          </p>
        )}
        <div className="signs">
          <div>Customer signature</div>
          <div>For {t.shop.shop_name}</div>
        </div>
      </div>
    </>
  );
}
