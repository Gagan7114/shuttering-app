import { useEffect, useState } from 'react';
import { api } from '../api';
import { RecoveryKeyBox } from '../components/RecoveryKeyBox';
import { useShop } from '../components/shared';
import { DAY_MODES, fmtAt } from '../format';
import { Card, Field, Loading, PageHead, confirmAction, useLoad, useToast } from '../ui';

export default function Settings() {
  const { setShop } = useShop();
  const toast = useToast();
  const { data, error } = useLoad(() => api('/settings'), []);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) setF(data);
  }, [data]);

  if (!f) return <Loading error={error} />;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const saved = await api('/settings', { method: 'PUT', body: f });
      setShop(saved);
      toast('Settings saved');
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead work="settings" />
      <form onSubmit={save}>
        <Card title="Shop details (printed on challans and bills)">
          <Field label="Shop name">
            <input value={f.shop_name} onChange={set('shop_name')} />
          </Field>
          <div className="grid2">
            <Field label="Address">
              <input value={f.address} onChange={set('address')} />
            </Field>
            <Field label="Phone">
              <input value={f.phone} onChange={set('phone')} />
            </Field>
          </div>
          <Field label="Terms / message at the bottom of bills">
            <input value={f.bill_terms} onChange={set('bill_terms')} />
          </Field>
        </Card>

        <Card title="GST bills">
          <label className={`radio ${f.gst_enabled ? 'on' : ''}`}>
            <input
              type="checkbox"
              checked={!!f.gst_enabled}
              onChange={(e) => setF({ ...f, gst_enabled: e.target.checked })}
            />
            <div>
              <b>Add GST to bills</b>
              <div className="muted small">
                Turn on only if your shop is registered for GST. Bills then print as “Tax Invoice” with CGST + SGST (same
                state) or IGST (customer’s GSTIN is from another state). You can still switch GST off for one bill.
              </div>
            </div>
          </label>
          {f.gst_enabled && (
            <div className="grid2 mt">
              <Field label="Your shop GSTIN">
                <input
                  value={f.gstin}
                  maxLength={15}
                  placeholder="e.g. 03ABCDE1234F1Z5"
                  onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })}
                />
              </Field>
              <Field label="GST rate %" hint="Rent of shuttering / scaffolding is usually 18%">
                <input type="number" min="0" max="28" step="any" value={f.gst_rate} onChange={set('gst_rate')} />
              </Field>
              <Field label="SAC code on bills" hint="997314 = renting of construction equipment">
                <input value={f.sac_code} onChange={set('sac_code')} />
              </Field>
            </div>
          )}
        </Card>

        <Card title="How to count days (for items with rent per day)">
          <div className="radios">
            {Object.entries(DAY_MODES).map(([key, m]) => (
              <label key={key} className={`radio ${f.day_mode === key ? 'on' : ''}`}>
                <input type="radio" name="day_mode" value={key} checked={f.day_mode === key} onChange={set('day_mode')} />
                <div>
                  <b>{m.label}</b>
                  <div className="muted small">{m.example}</div>
                </div>
              </label>
            ))}
          </div>
          {f.day_mode === '24h' && (
            <Field label="Grace hours" hint="Extra hours allowed before another day is charged." className="narrow">
              <input type="number" min="0" max="23" step="1" value={f.grace_hours} onChange={set('grace_hours')} />
            </Field>
          )}
          <p className="muted small">
            Items with rent per hour are charged for every started hour (minimum 1 hour). Changing this rule only
            affects bills made from now on.
          </p>
        </Card>

        <div className="form-foot">
          <button className="btn primary big" disabled={busy}>
            {busy ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </form>

      <RecoveryKeyCard />

      <Card title="Backup & admin">
        <p>
          <a className="btn" href="/api/export">
            Download backup (JSON)
          </a>{' '}
          <a className="btn" href="/admin/" target="_blank" rel="noreferrer">
            Open Django admin
          </a>
        </p>
        <p className="muted small">
          Use the admin to add staff logins or change passwords. For a full database backup you can also run{' '}
          <code>./backup.sh</code> (uses pg_dump).
        </p>
      </Card>
    </>
  );
}

/** Make a key that lets this login set a new password from “Forgot password?”. */
function RecoveryKeyCard() {
  const toast = useToast();
  const status = useLoad(() => api('/auth/recovery-key'), []);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);

  async function make() {
    if (status.data?.has_key && !confirmAction('Make a new recovery key? The old key will stop working.')) return;
    setBusy(true);
    try {
      const res = await api('/auth/recovery-key', { method: 'POST' });
      setKey(res.key);
      status.reload();
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Forgot password? Recovery key">
      <p>
        If you forget your password, tap <b>Forgot password?</b> on the login page and enter this key to set a new
        password. Each login (owner or staff) makes its own key.
      </p>
      {key ? (
        <>
          <p className="strong">Your recovery key — write it down now. It will not be shown again:</p>
          <RecoveryKeyBox value={key} />
          <p className="muted small">
            Keep it somewhere safe, away from the shop computer. Anyone with your username and this key can change your
            password.
          </p>
        </>
      ) : !status.data ? (
        <Loading error={status.error} />
      ) : status.data.has_key ? (
        <p className="muted small">You made a recovery key on {fmtAt(status.data.created_at)}.</p>
      ) : (
        <div className="banner">You have no recovery key yet. Make one now so you never get locked out.</div>
      )}
      {!key && (
        <button type="button" className="btn" disabled={busy || !status.data} onClick={make}>
          {busy ? 'Making…' : status.data?.has_key ? 'Make a new key' : 'Make recovery key'}
        </button>
      )}
      <p className="muted small">
        No key? On the shop computer run <code>./reset-password.sh</code> in the <code>shuttring</code> folder.
      </p>
    </Card>
  );
}
