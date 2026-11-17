import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api';
import { CustomerBadge } from '../components/CustomerPicker';
import { CustomerModal, SiteModal } from '../components/Modals';
import { BillList, ChallanList, HoldingsList, RentTable } from '../components/shared';
import { fmtAt, fmtDate, money, nowLocal } from '../format';
import Icon from '../icons';
import { Card, Loading, PageHead, Stat, confirmAction, useLoad, useToast } from '../ui';
import { DAILY, WORK, workLink } from '../work';

const TABS = [
  ['items', 'Items'],
  ['sites', 'Sites'],
  ['challans', 'Challans'],
  ['bills', 'Bills'],
  ['payments', 'Payments'],
];

export default function CustomerDetail() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'items';
  const navigate = useNavigate();
  const toast = useToast();
  const { data, error, reload } = useLoad(() => api(`/customers/${id}`), [id]);
  const [asOf] = useState(nowLocal());
  const preview = useLoad(() => api(`/customers/${id}/preview` + qs({ at: asOf })), [id, asOf, data]);
  const [editing, setEditing] = useState(false);
  const [siteEdit, setSiteEdit] = useState(null); // null | 'new' | site

  if (!data) return <Loading error={error} />;
  const c = data.customer;

  async function removePayment(p) {
    if (!confirmAction(`Delete payment of ${money(Number(p.amount) + Number(p.tds))} on ${fmtDate(p.date)}?`)) return;
    try {
      await api(`/payments/${p.id}`, { method: 'DELETE' });
      toast('Payment deleted');
      reload();
    } catch (e) {
      toast(e.message, 'bad');
    }
  }

  async function removeSite(st) {
    if (!confirmAction(`Delete site ${st.name}?`)) return;
    try {
      await api(`/sites/${st.id}`, { method: 'DELETE' });
      toast('Site deleted');
      reload();
    } catch (e) {
      toast(e.message, 'bad');
    }
  }

  async function removeCustomer() {
    if (!confirmAction(`Delete customer ${c.name}?`)) return;
    try {
      await api(`/customers/${c.id}`, { method: 'DELETE' });
      toast('Customer deleted');
      navigate('/customers');
    } catch (e) {
      toast(e.message, 'bad');
    }
  }

  const isEmpty = !data.challans.length && !data.bills.length && !data.payments.length;
  const count = {
    items: data.holdings.length,
    sites: data.sites.length,
    challans: data.challans.length,
    bills: data.bills.length,
    payments: data.payments.length,
  };

  return (
    <>
      <PageHead back={{ to: '/customers', label: 'All customers' }} />

      <Card className="cust-card">
        <div className="cust-top">
          <CustomerBadge c={c}>
            {c.gstin && <div className="muted small">GSTIN: {c.gstin}</div>}
            {c.note && <div className="muted small">{c.note}</div>}
          </CustomerBadge>
          <div className="actions">
            {c.phone && (
              <a className="btn sm" href={`tel:${c.phone}`}>
                <Icon name="phone" size={16} /> Call
              </a>
            )}
            <button className="btn sm" onClick={() => setEditing(true)}>
              <Icon name="edit" size={16} /> Edit
            </button>
            {isEmpty && (
              <button className="btn sm danger" onClick={removeCustomer}>
                <Icon name="trash" size={16} /> Delete
              </button>
            )}
          </div>
        </div>
        <div className="quick">
          {DAILY.map((k) => (
            <Link key={k} to={workLink(k, c.id)} className={`quick-btn tone-${WORK[k].tone}`}>
              <Icon name={WORK[k].icon} size={20} />
              <span>{WORK[k].short}</span>
            </Link>
          ))}
        </div>
      </Card>

      <div className="stats">
        <Stat label="Pieces with them" value={data.pcs_out} />
        <Stat label="Rent running, not billed" value={preview.data ? money(preview.data.rent_total) : '…'} />
        <Stat
          label={data.balance < 0 ? 'Advance paid' : 'Balance due'}
          value={money(Math.abs(data.balance))}
          tone={data.balance > 0 ? 'warn' : 'ok'}
          note={`Billed ${money(data.billed)} · Paid ${money(data.paid)}`}
        />
      </div>

      <div className="tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            className={tab === k ? 'on' : ''}
            onClick={() => setParams(k === 'items' ? {} : { tab: k }, { replace: true })}
          >
            {label}
            {count[k] > 0 && <span className="count">{count[k]}</span>}
          </button>
        ))}
      </div>

      {tab === 'items' && (
        <>
          <Card title="Items with them now">
            <HoldingsList holdings={data.holdings} />
          </Card>
          <Card
            title="Rent not billed yet"
            actions={
              <Link className="btn sm primary" to={workLink('bill', c.id)}>
                Make bill
              </Link>
            }
          >
            {data.last_bill && (
              <p className="muted small">
                Last bill #{data.last_bill.bill_no} was up to {fmtAt(data.last_bill.upto_at)}. Rent below is after that.
              </p>
            )}
            {!preview.data ? (
              <Loading error={preview.error} />
            ) : (
              <>
                <div className="rent-total">
                  <span>Up to now</span>
                  <b>{money(preview.data.rent_total)}</b>
                </div>
                {preview.data.lines.length > 0 && (
                  <details className="details">
                    <summary>See item-wise rent</summary>
                    <RentTable lines={preview.data.lines} />
                  </details>
                )}
              </>
            )}
          </Card>
        </>
      )}

      {tab === 'sites' && (
        <Card
          title="Work sites"
          actions={
            <button className="btn sm primary" onClick={() => setSiteEdit('new')}>
              <Icon name="plus" size={16} /> New site
            </button>
          }
        >
          {data.sites.length === 0 ? (
            <p className="muted pad">
              No sites yet. Add the customer's sites if they take items to more than one place — then every challan
              and bill shows which site the items are at.
            </p>
          ) : (
            <div className="rows">
              {data.sites.map((st) => (
                <div key={st.id} className="row-link static">
                  <span className="row-icon tone-orange">
                    <Icon name="pin" size={18} />
                  </span>
                  <div className="row-main">
                    <div className="row-title">{st.name}</div>
                    <div className="row-sub muted">{[st.address, st.note].filter(Boolean).join(' · ') || '—'}</div>
                  </div>
                  <div className="row-side">
                    {st.pcs_out > 0 ? (
                      <span className="chip-stat blue">{st.pcs_out} pcs there</span>
                    ) : (
                      <span className="muted small">nothing there</span>
                    )}
                  </div>
                  <button className="icon-btn" title="Edit site" onClick={() => setSiteEdit(st)}>
                    <Icon name="edit" size={17} />
                  </button>
                  {!st.used && (
                    <button className="icon-btn danger" title="Delete site" onClick={() => removeSite(st)}>
                      <Icon name="trash" size={17} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {data.pcs_no_site > 0 && data.sites.length > 0 && (
            <p className="muted small">{data.pcs_no_site} pcs were given without a site.</p>
          )}
        </Card>
      )}

      {tab === 'challans' && (
        <Card>
          <ChallanList rows={data.challans} showCustomer={false} empty="No challans yet." />
        </Card>
      )}

      {tab === 'bills' && (
        <Card
          actions={
            <Link className="btn sm primary" to={workLink('bill', c.id)}>
              Make bill
            </Link>
          }
          title="Bills"
        >
          <BillList rows={data.bills} showCustomer={false} />
        </Card>
      )}

      {tab === 'payments' && (
        <Card
          title="Payments received"
          actions={
            <Link className="btn sm primary" to={workLink('payment', c.id)}>
              Receive payment
            </Link>
          }
        >
          {data.payments.length === 0 ? (
            <p className="muted pad">No payments yet.</p>
          ) : (
            <div className="rows">
              {data.payments.map((p) => (
                <div key={p.id} className="row-link static">
                  <span className="row-icon tone-teal">
                    <Icon name="payment" size={18} />
                  </span>
                  <div className="row-main">
                    <div className="row-title">
                      {money(p.amount)}
                      {p.tds > 0 && <span className="muted small"> + TDS {money(p.tds)}</span>}
                    </div>
                    <div className="row-sub muted">
                      {p.mode} · {fmtDate(p.date)}
                      {p.note && ` · ${p.note}`}
                    </div>
                  </div>
                  <button className="icon-btn danger" title="Delete payment" onClick={() => removePayment(p)}>
                    <Icon name="trash" size={17} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {siteEdit && (
        <SiteModal
          customerId={c.id}
          site={siteEdit === 'new' ? null : siteEdit}
          onClose={() => setSiteEdit(null)}
          onSaved={() => {
            setSiteEdit(null);
            toast('Site saved');
            reload();
          }}
        />
      )}

      {editing && (
        <CustomerModal
          customer={c}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            toast('Saved');
            reload();
          }}
        />
      )}
    </>
  );
}
