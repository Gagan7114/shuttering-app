import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api';
import { ChallanList, DocHeader, SiteTag, useShop } from '../components/shared';
import { fmtDate, money, todayLocal } from '../format';
import Icon from '../icons';
import { Card, Loading, PageHead, Stat, useLoad } from '../ui';

const TABS = [
  ['due', 'Money due'],
  ['daily', 'Daily'],
  ['monthly', 'Monthly'],
  ['stock', 'Who has the stock'],
  ['gst', 'GST sales'],
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthName = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

export default function Reports() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'due';
  const { shop } = useShop();
  const title = TABS.find(([k]) => k === tab)?.[1];

  return (
    <>
      <PageHead work="reports" sub="Money due, day and month totals, where your stock is, and GST sales.">
        <button className="btn" onClick={() => window.print()}>
          <Icon name="printer" size={18} /> Print
        </button>
      </PageHead>

      <div className="tabs no-print" role="tablist">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            className={tab === k ? 'on' : ''}
            onClick={() => setParams(k === 'due' ? {} : { tab: k }, { replace: true })}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="print-only">
        <DocHeader shop={shop} title={title} />
      </div>

      {tab === 'due' && <DueReport />}
      {tab === 'daily' && <DailyReport />}
      {tab === 'monthly' && <MonthlyReport />}
      {tab === 'stock' && <StockReport />}
      {tab === 'gst' && <GstReport shop={shop} />}
    </>
  );
}

/* ---------------------------------------------------------------- money due */

function DueReport() {
  const { data, error } = useLoad(() => api('/reports/outstanding'), []);
  if (!data) return <Loading error={error} />;
  const due = data.rows.filter((r) => r.balance > 0);
  return (
    <>
      <div className="stats">
        <Stat label="Total money due (billed, not paid)" value={money(data.total_balance)} tone={data.total_balance > 0 ? 'warn' : ''} />
        <Stat label="Customers who owe money" value={due.length} />
        <Stat label="Rent running, not billed yet" value={money(data.total_running)} />
      </div>
      <Card>
        {!data.rows.length ? (
          <p className="muted pad">Nobody owes anything and nothing is out. 👍</p>
        ) : (
          <div className="table-wrap">
            <table className="tbl report">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th className="r">Pcs out</th>
                  <th className="r">Billed</th>
                  <th className="r">Received</th>
                  <th className="r">TDS</th>
                  <th className="r">Balance due</th>
                  <th className="r">Rent not billed</th>
                  <th>Last payment</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.customer_id}>
                    <td>
                      <Link to={`/customers/${r.customer_id}`}>{r.name}</Link>
                      {r.phone && <div className="muted xs">{r.phone}</div>}
                    </td>
                    <td className="r">{r.pcs_out || '—'}</td>
                    <td className="r">{money(r.billed)}</td>
                    <td className="r">{money(r.received)}</td>
                    <td className="r">{r.tds > 0 ? money(r.tds) : '—'}</td>
                    <td className={`r strong ${r.balance > 0 ? 'text-bad' : ''}`}>
                      {r.balance < 0 ? `${money(-r.balance)} adv.` : money(r.balance)}
                    </td>
                    <td className="r">{r.running_rent > 0 ? money(r.running_rent) : '—'}</td>
                    <td className="nowrap">{r.last_payment ? fmtDate(r.last_payment) : <span className="muted">never</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

/* ---------------------------------------------------------------- daily */

function DailyReport() {
  const [date, setDate] = useState(todayLocal());
  const { data, error } = useLoad(() => api('/reports/daily' + qs({ date })), [date]);

  return (
    <>
      <Card className="no-print">
        <label className="inline-field">
          Day
          <input type="date" value={date} max={todayLocal()} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
      </Card>
      <h2 className="print-only">{fmtDate(date)}</h2>
      {!data ? (
        <Loading error={error} />
      ) : (
        <>
          <div className="stats">
            <Stat label="Challans" value={data.challans.length} />
            <Stat label="Bills made" value={money(data.billed)} note={plural(data.bills.length, 'bill')} />
            <Stat
              label="Money received"
              value={money(data.received)}
              note={data.tds > 0 ? `+ TDS ${money(data.tds)}` : plural(data.payments.length, 'payment')}
            />
          </div>

          <Card title="Items moved">
            {!data.moves.length ? (
              <p className="muted pad">No items went out or came back on this day.</p>
            ) : (
              <div className="table-wrap">
                <table className="tbl report">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="r">Given</th>
                      <th className="r">Came back</th>
                      <th className="r">Lost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.moves.map((m) => (
                      <tr key={m.item_name}>
                        <td>{m.item_name}</td>
                        <td className="r">{m.given ? `${m.given} ${m.unit}` : '—'}</td>
                        <td className="r">{m.back ? `${m.back} ${m.unit}` : '—'}</td>
                        <td className={`r ${m.lost ? 'text-bad strong' : ''}`}>{m.lost ? `${m.lost} ${m.unit}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Challans">
            <ChallanList rows={data.challans} empty="No challans on this day." />
          </Card>

          <div className="home-grid">
            <Card title="Bills">
              {!data.bills.length ? (
                <p className="muted pad">No bills.</p>
              ) : (
                <table className="tbl report">
                  <tbody>
                    {data.bills.map((b) => (
                      <tr key={b.id}>
                        <td>
                          <Link to={`/bills/${b.id}`}>Bill #{b.bill_no}</Link>
                        </td>
                        <td>{b.customer_name}</td>
                        <td className="r">{money(b.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
            <Card title="Payments">
              {!data.payments.length ? (
                <p className="muted pad">No payments.</p>
              ) : (
                <table className="tbl report">
                  <tbody>
                    {data.payments.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <Link to={`/customers/${p.customer_id}?tab=payments`}>{p.customer_name}</Link>
                          <div className="muted xs">{[p.mode, p.note].filter(Boolean).join(' · ')}</div>
                        </td>
                        <td className="r">
                          {money(p.amount)}
                          {p.tds > 0 && <div className="muted xs">+ TDS {money(p.tds)}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- monthly */

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// optional columns of the monthly table: shown only when the year has some
const MONTH_COLS = [
  ['lost', 'Lost items'],
  ['extras', 'Other charges'],
  ['discount', 'Discount'],
  ['gst', 'GST'],
];

function MonthlyReport() {
  const [year, setYear] = useState(new Date().getFullYear());
  const { data, error } = useLoad(() => api('/reports/monthly' + qs({ year })), [year]);
  const cell = (v, empty) => (empty || !v ? '—' : money(v));

  return (
    <>
      <Card className="no-print">
        <div className="year-pick">
          <button className="icon-btn" aria-label="Previous year" onClick={() => setYear((y) => y - 1)}>
            <Icon name="back" size={18} />
          </button>
          <b>{year}</b>
          <button
            className="icon-btn"
            aria-label="Next year"
            disabled={year >= new Date().getFullYear()}
            onClick={() => setYear((y) => y + 1)}
          >
            <Icon name="right" size={18} />
          </button>
        </div>
      </Card>
      {!data ? (
        <Loading error={error} />
      ) : (
        <>
          <div className="stats">
            <Stat label={`Billed in ${data.year}`} value={money(data.totals.billed)} note={plural(data.totals.bills, 'bill')} />
            <Stat
              label={`Received in ${data.year}`}
              value={money(data.totals.received)}
              note={data.totals.tds > 0 ? `+ TDS ${money(data.totals.tds)}` : undefined}
            />
            <Stat label="GST on bills" value={money(data.totals.gst)} />
          </div>
          <Card title={`Billing vs payments, ${data.year}`}>
            <div className="table-wrap">
              <table className="tbl report">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th className="r">Bills</th>
                    <th className="r">Rent</th>
                    {MONTH_COLS.filter(([k]) => data.totals[k]).map(([k, label]) => (
                      <th key={k} className="r">
                        {label}
                      </th>
                    ))}
                    <th className="r">Billed</th>
                    <th className="r">Received</th>
                    {data.totals.tds > 0 && <th className="r">TDS</th>}
                    <th className="r">Billed − paid</th>
                  </tr>
                </thead>
                <tbody>
                  {data.months.map((m) => {
                    const gap = m.billed - m.received - m.tds;
                    const empty = !m.bills && !m.received && !m.tds;
                    return (
                      <tr key={m.month} className={empty ? 'dim' : ''}>
                        <td className="nowrap">{monthName(m.month)}</td>
                        <td className="r">{m.bills || '—'}</td>
                        <td className="r">{cell(m.rent, !m.bills)}</td>
                        {MONTH_COLS.filter(([k]) => data.totals[k]).map(([k]) => (
                          <td key={k} className="r">
                            {k === 'discount' && m[k] ? '− ' : ''}
                            {cell(m[k])}
                          </td>
                        ))}
                        <td className="r strong">{cell(m.billed)}</td>
                        <td className="r strong">{cell(m.received)}</td>
                        {data.totals.tds > 0 && <td className="r">{cell(m.tds)}</td>}
                        <td className={`r ${gap > 0 ? 'text-bad' : ''}`}>{empty ? '—' : money(gap)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total</td>
                    <td className="r">{data.totals.bills}</td>
                    <td className="r">{money(data.totals.rent)}</td>
                    {MONTH_COLS.filter(([k]) => data.totals[k]).map(([k]) => (
                      <td key={k} className="r">
                        {k === 'discount' ? '− ' : ''}
                        {money(data.totals[k])}
                      </td>
                    ))}
                    <td className="r">{money(data.totals.billed)}</td>
                    <td className="r">{money(data.totals.received)}</td>
                    {data.totals.tds > 0 && <td className="r">{money(data.totals.tds)}</td>}
                    <td className="r">{money(data.totals.billed - data.totals.received - data.totals.tds)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="muted small">
              A bill counts in the month of its “bill up to” date. “Billed − paid” is only for that month; see Money due
              for what each customer owes in total.
            </p>
          </Card>
        </>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- stock */

function StockReport() {
  const { data, error } = useLoad(() => api('/reports/stock'), []);
  if (!data) return <Loading error={error} />;
  if (!data.rows.length) return <p className="muted">No items yet.</p>;
  return (
    <Card>
      <div className="table-wrap">
        <table className="tbl report">
          <thead>
            <tr>
              <th>Item</th>
              <th className="r">Own now</th>
              <th className="r">In store</th>
              <th className="r">With customers</th>
              <th className="r">Lost so far</th>
              <th>Who has them</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.item_id}>
                <td>
                  <b>{r.item_name}</b>
                  {r.category && <div className="muted xs">{r.category}</div>}
                </td>
                <td className="r">
                  {r.total_qty} {r.unit}
                </td>
                <td className={`r strong ${r.in_store <= 0 ? 'text-bad' : ''}`}>{r.in_store}</td>
                <td className="r">{r.out_qty || '—'}</td>
                <td className={`r ${r.lost_qty ? 'text-bad' : ''}`}>{r.lost_qty || '—'}</td>
                <td>
                  {r.holders.length === 0 ? (
                    <span className="muted">all in store</span>
                  ) : (
                    r.holders.map((h, i) => (
                      <div key={i} className="holder">
                        <Link to={`/customers/${h.customer_id}`}>{h.customer_name}</Link> <SiteTag name={h.site_name} />{' '}
                        <b>{h.qty}</b>
                      </div>
                    ))
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------- GST */

function GstReport({ shop }) {
  const [month, setMonth] = useState(todayLocal().slice(0, 7));
  const { data, error } = useLoad(() => api('/reports/gst' + qs({ month })), [month]);

  return (
    <>
      <Card className="no-print">
        <div className="toolbar">
          <label className="inline-field">
            Month
            <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          </label>
          <a className="btn" href={`/api/reports/gst${qs({ month, download: 'csv' })}`}>
            Download for accountant (CSV)
          </a>
        </div>
        {!shop.gst_enabled && (
          <p className="muted small">
            GST is off in Settings, so bills have no GST. This list still shows every bill of the month.
          </p>
        )}
      </Card>
      {!data ? (
        <Loading error={error} />
      ) : (
        <>
          {data.missing_bill_nos.length > 0 && (
            <div className="banner bad">
              <b>Missing bill numbers:</b> {data.missing_bill_nos.join(', ')}. These bills were deleted. Your accountant
              may ask about them.
            </div>
          )}
          <Card title={`Bills of ${monthName(data.month)}`}>
            <div className="table-wrap">
              <table className="tbl report">
                <thead>
                  <tr>
                    <th>Bill</th>
                    <th>Date</th>
                    <th>Customer</th>
                    <th>GSTIN</th>
                    <th className="r">Taxable</th>
                    <th className="r">CGST</th>
                    <th className="r">SGST</th>
                    <th className="r">IGST</th>
                    <th className="r">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link to={`/bills/${r.id}`}>#{r.bill_no}</Link>
                      </td>
                      <td className="nowrap">{fmtDate(r.date)}</td>
                      <td>{r.customer_name}</td>
                      <td className="nowrap">{r.gstin || <span className="muted">B2C</span>}</td>
                      <td className="r">{money(r.taxable)}</td>
                      <td className="r">{r.cgst ? money(r.cgst) : '—'}</td>
                      <td className="r">{r.sgst ? money(r.sgst) : '—'}</td>
                      <td className="r">{r.igst ? money(r.igst) : '—'}</td>
                      <td className="r strong">{money(r.total)}</td>
                    </tr>
                  ))}
                  {!data.rows.length && (
                    <tr>
                      <td colSpan={9} className="muted">
                        No bills in this month.
                      </td>
                    </tr>
                  )}
                </tbody>
                {data.rows.length > 0 && (
                  <tfoot>
                    {[
                      ['B2B (customer has GSTIN)', data.summary.B2B],
                      ['B2C (no GSTIN)', data.summary.B2C],
                      ['Total', data.summary.all],
                    ]
                      .filter(([, g]) => g.bills)
                      .map(([label, g]) => (
                        <tr key={label}>
                          <td colSpan={4}>
                            {label} · {g.bills} bill{g.bills > 1 ? 's' : ''}
                          </td>
                          <td className="r">{money(g.taxable)}</td>
                          <td className="r">{money(g.cgst)}</td>
                          <td className="r">{money(g.sgst)}</td>
                          <td className="r">{money(g.igst)}</td>
                          <td className="r">{money(g.total)}</td>
                        </tr>
                      ))}
                  </tfoot>
                )}
              </table>
            </div>
            {data.shop_gstin && (
              <p className="muted small">
                Your GSTIN {data.shop_gstin} · SAC {data.sac_code || '—'}. Give the CSV to your accountant for GSTR-1.
              </p>
            )}
          </Card>
        </>
      )}
    </>
  );
}

