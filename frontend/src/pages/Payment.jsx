import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { CustomerPicker } from '../components/CustomerPicker';
import { fmtDate, money, todayLocal } from '../format';
import { Card, Field, Loading, NoteField, PageHead, SaveBar, Segmented, useLoad, useToast } from '../ui';

const MODES = [
  ['Cash', 'Cash'],
  ['UPI', 'UPI'],
  ['Bank', 'Bank'],
  ['Cheque', 'Cheque'],
  ['Other', 'Other'],
];

export default function Payment() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const customers = useLoad(() => api('/customers'), []);

  const [customerId, setCustomerId] = useState(params.get('customer') || '');
  const [amount, setAmount] = useState('');
  const [tds, setTds] = useState('');
  const [tdsOpen, setTdsOpen] = useState(false);
  const [mode, setMode] = useState('Cash');
  const [date, setDate] = useState(todayLocal());
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  if (!customers.data) return <Loading error={customers.error} />;
  const c = customers.data.find((x) => String(x.id) === customerId);
  const due = c ? Number(c.balance) : 0;
  const cleared = (Number(amount) || 0) + (Number(tds) || 0);

  async function save() {
    setErr('');
    try {
      if (!customerId) throw new Error('Choose the customer.');
      if (Number(amount) < 0 || Number(tds) < 0) throw new Error('Amounts cannot be negative.');
      if (!(cleared > 0)) throw new Error('Enter the amount received.');
      if (!date) throw new Error('Enter the date.');
      setBusy(true);
      await api('/payments', {
        method: 'POST',
        body: { customer: Number(customerId), amount: amount || 0, tds: tds || 0, mode, date, note },
      });
      toast(`${money(cleared)} received from ${c?.name || 'customer'}`);
      navigate(`/customers/${customerId}?tab=payments`);
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead work="payment" />

      <Card title="Customer" step="1">
        <CustomerPicker
          customers={customers.data}
          value={customerId}
          onChange={setCustomerId}
          onCreated={customers.reload}
        />
      </Card>

      {customerId && (
        <>
          <Card title="Payment" step="2">
            <div className="grid2">
              <Field label="Amount received ₹ *">
                <input
                  autoFocus
                  className="big-input"
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </Field>
              <div className="due-box">
                {due > 0 ? (
                  <>
                    <div className="muted small">Balance due</div>
                    <div className="due">{money(due)}</div>
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => setAmount(String(Math.max(due - (Number(tds) || 0), 0)))}
                    >
                      Full amount
                    </button>
                  </>
                ) : (
                  <div className="muted">Nothing due right now. This will be kept as advance.</div>
                )}
              </div>
            </div>
            {tdsOpen ? (
              <Field
                label="TDS deducted by customer ₹"
                className="narrow"
                hint="Tax the customer cut and paid to the government for you. It also clears their balance."
              >
                <input
                  autoFocus
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={tds}
                  onChange={(e) => setTds(e.target.value)}
                />
              </Field>
            ) : (
              <button type="button" className="link-btn add-note" onClick={() => setTdsOpen(true)}>
                + Customer deducted TDS?
              </button>
            )}
            <Field label="Paid by">
              <Segmented options={MODES} value={mode} onChange={setMode} />
            </Field>
            <div className="grid2">
              <Field label="Date">
                <input type="date" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} />
              </Field>
            </div>
            <NoteField value={note} onChange={setNote} placeholder="e.g. cheque no., UPI ref." />
          </Card>

          {err && <div className="banner bad">{err}</div>}
          <SaveBar
            summary={
              cleared > 0 ? (
                <>
                  <b>{money(amount || 0)}</b> by {mode}
                  {Number(tds) > 0 && <> + TDS {money(tds)}</>} on {fmtDate(date)}
                  {due > 0 && <span className="muted"> · still due after this: {money(Math.max(due - cleared, 0))}</span>}
                </>
              ) : (
                <span className="muted">Enter the amount</span>
              )
            }
          >
            <button type="button" className="btn primary big" disabled={busy || !(cleared > 0)} onClick={save}>
              {busy ? 'Saving…' : 'Save payment'}
            </button>
          </SaveBar>
        </>
      )}
    </>
  );
}
