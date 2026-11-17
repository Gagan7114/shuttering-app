import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { DocHeader, LostTable, RentTable } from '../components/shared';
import { fmtAt, fmtDate, money } from '../format';
import Icon from '../icons';
import { Loading, PageHead, confirmAction, useLoad, useToast } from '../ui';

export default function BillView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data: b, error } = useLoad(() => api(`/bills/${id}`), [id]);
  if (!b) return <Loading error={error} />;

  const rent = b.lines.filter((l) => l.kind === 'rent');
  const lost = b.lines.filter((l) => l.kind === 'lost');
  const extras = b.lines.filter((l) => l.kind === 'extra');
  const gst = b.gst_type !== 'none';
  const shopForPrint = { ...b.shop, gst_enabled: gst || b.shop.gst_enabled };

  async function remove() {
    if (!confirmAction(`Delete Bill #${b.bill_no}? You can make it again afterwards.`)) return;
    try {
      await api(`/bills/${b.id}`, { method: 'DELETE' });
      toast('Bill deleted');
      navigate(`/customers/${b.customer_id}`);
    } catch (e) {
      toast(e.message, 'bad');
    }
  }

  return (
    <>
      <PageHead title={`Bill #${b.bill_no}`} sub={b.customer_name} work="bill" back={{ to: '/bills', label: 'All bills' }}>
        <button className="btn primary" onClick={() => window.print()}>
          <Icon name="printer" size={18} /> Print
        </button>
        <Link className="btn" to={`/payment?customer=${b.customer_id}`}>
          Receive payment
        </Link>
        <Link className="btn" to={`/customers/${b.customer_id}`}>
          Customer account
        </Link>
        {b.can_delete && (
          <button className="btn danger" onClick={remove}>
            <Icon name="trash" size={16} /> Delete
          </button>
        )}
      </PageHead>

      <div className="doc card">
        <DocHeader shop={shopForPrint} title={gst ? 'Tax Invoice' : 'Rent Bill'} />
        <div className="doc-meta">
          <div>
            <div className="muted small">Bill to</div>
            <b>{b.customer.name}</b>
            {b.customer.phone && <div>{b.customer.phone}</div>}
            {b.customer.address && <div>{b.customer.address}</div>}
            {b.customer_gstin && <div>GSTIN: {b.customer_gstin}</div>}
          </div>
          <div className="r">
            <div>
              Bill No: <b>{b.bill_no}</b>
            </div>
            <div>
              Date: <b>{fmtDate(b.upto_at)}</b>
            </div>
            <div className="small">
              Period: {b.from_at ? fmtAt(b.from_at) : 'from start'} → {fmtAt(b.upto_at)}
            </div>
            {gst && b.shop.sac_code && <div className="small">SAC: {b.shop.sac_code}</div>}
          </div>
        </div>

        <h3>Rent</h3>
        <RentTable lines={rent} empty="No rent in this bill." />

        {lost.length > 0 && (
          <>
            <h3>Lost items</h3>
            <LostTable lines={lost} />
          </>
        )}

        {extras.length > 0 && (
          <>
            <h3>Other charges</h3>
            <table className="tbl doc-tbl">
              <tbody>
                {extras.map((l) => (
                  <tr key={l.id}>
                    <td>{l.description}</td>
                    <td className="r">{money(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <div className="totals">
          <div>
            <span>Rent</span>
            <span>{money(b.rent_total)}</span>
          </div>
          {b.lost_total > 0 && (
            <div>
              <span>Lost items</span>
              <span>{money(b.lost_total)}</span>
            </div>
          )}
          {b.extras_total > 0 && (
            <div>
              <span>Other charges</span>
              <span>{money(b.extras_total)}</span>
            </div>
          )}
          {b.discount > 0 && (
            <div>
              <span>Discount</span>
              <span>− {money(b.discount)}</span>
            </div>
          )}
          {gst && (
            <>
              <div className="sub-total">
                <span>Taxable amount</span>
                <span>{money(b.taxable)}</span>
              </div>
              {b.gst_type === 'intra' ? (
                <>
                  <div>
                    <span>CGST {b.gst_rate / 2}%</span>
                    <span>{money(b.cgst)}</span>
                  </div>
                  <div>
                    <span>SGST {b.gst_rate / 2}%</span>
                    <span>{money(b.sgst)}</span>
                  </div>
                </>
              ) : (
                <div>
                  <span>IGST {b.gst_rate}%</span>
                  <span>{money(b.igst)}</span>
                </div>
              )}
            </>
          )}
          <div className="grand">
            <span>Total</span>
            <span>{money(b.total)}</span>
          </div>
        </div>

        {b.note && (
          <p>
            <b>Note:</b> {b.note}
          </p>
        )}
        {b.shop.bill_terms && <p className="muted small">{b.shop.bill_terms}</p>}
        <div className="signs">
          <div>Customer signature</div>
          <div>For {b.shop.shop_name}</div>
        </div>
      </div>
    </>
  );
}
