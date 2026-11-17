import { useEffect, useState } from 'react';
import { api } from '../api';
import { RecoveryKeyBox } from '../components/RecoveryKeyBox';
import { useShop } from '../components/shared';
import { DAY_MODES, fmtAt } from '../format';
import Icon from '../icons';
import { Card, Field, Loading, Modal, PageHead, Segmented, confirmAction, useLoad, useToast } from '../ui';

export default function Settings() {
  const { setShop, user } = useShop();
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

      {user?.is_owner && <LoginsCard me={user.username} />}

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
          Logins are managed above (owner only). For a full database backup you can also run{' '}
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

const ROLE_TEXT = { owner: 'Owner', staff: 'Staff' };

/** Owner only: add logins, set passwords, switch logins off. */
function LoginsCard({ me }) {
  const toast = useToast();
  const { data, error, reload } = useLoad(() => api('/logins'), []);
  const [adding, setAdding] = useState(false);
  const [pwFor, setPwFor] = useState(null);

  async function toggle(u) {
    const off = u.is_active;
    if (off && !confirmAction(`Switch off ${u.username}? They will not be able to log in until you switch it on again.`))
      return;
    try {
      await api(`/logins/${u.id}`, { method: 'PUT', body: { is_active: !off } });
      toast(off ? `${u.username} switched off` : `${u.username} can log in again`);
      reload();
    } catch (e) {
      toast(e.message, 'bad');
    }
  }

  return (
    <Card
      title="Logins"
      actions={
        <button type="button" className="btn sm primary" onClick={() => setAdding(true)}>
          <Icon name="plus" size={16} /> Add login
        </button>
      }
    >
      <p className="muted small">
        <b>Owner</b> logins can do everything, including this list. <b>Staff</b> logins can do the daily work and see
        all records, but cannot add logins or open the admin.
      </p>
      {!data ? (
        <Loading error={error} />
      ) : (
        <div className="rows">
          {data.map((u) => (
            <div key={u.id} className={`row-link static login-row ${u.is_active ? '' : 'off'}`}>
              <span className="avatar sm">{u.username.charAt(0).toUpperCase()}</span>
              <div className="row-main">
                <div className="row-title">
                  {u.username} {u.username === me && <span className="muted small">(you)</span>}{' '}
                  <span className={`pill ${u.role === 'owner' ? 'tone-orange' : ''}`}>{ROLE_TEXT[u.role]}</span>{' '}
                  {!u.is_active && <span className="pill bad">switched off</span>}
                </div>
                <div className="row-sub muted">
                  {u.last_login ? `Last login ${fmtAt(u.last_login)}` : 'Never logged in'} ·{' '}
                  {u.has_key ? 'has recovery key' : 'no recovery key'}
                </div>
              </div>
              <div className="row-btns">
                <button type="button" className="btn sm" onClick={() => setPwFor(u)}>
                  Set password
                </button>
                {u.username !== me && (
                  <button type="button" className={`btn sm ${u.is_active ? 'danger' : ''}`} onClick={() => toggle(u)}>
                    {u.is_active ? 'Switch off' : 'Switch on'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <AddLoginModal
          onClose={() => setAdding(false)}
          onSaved={(u) => {
            setAdding(false);
            toast(`Login ${u.username} added`);
            reload();
          }}
        />
      )}
      {pwFor && (
        <PasswordModal
          login={pwFor}
          onClose={() => setPwFor(null)}
          onSaved={() => {
            setPwFor(null);
            toast(`New password saved for ${pwFor.username}`);
            reload();
          }}
        />
      )}
    </Card>
  );
}

function AddLoginModal({ onClose, onSaved }) {
  const [f, setF] = useState({ username: '', password: '', repeat: '', role: 'staff' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function save() {
    if (!f.username.trim()) throw new Error('Choose a username.');
    if (/\s/.test(f.username.trim())) throw new Error('Username cannot have spaces.');
    if (f.password.length < 6) throw new Error('Password must be at least 6 characters.');
    if (f.password !== f.repeat) throw new Error('The two passwords are not the same.');
    onSaved(await api('/logins', { method: 'POST', body: { username: f.username.trim(), password: f.password, role: f.role } }));
  }

  return (
    <Modal title="Add login" onClose={onClose} onSubmit={save} submitLabel="Add login">
      <Field label="Username *" hint="No spaces, e.g. harpreet">
        <input autoFocus autoCapitalize="none" autoComplete="off" value={f.username} onChange={set('username')} />
      </Field>
      <div className="grid2">
        <Field label="Password *" hint="At least 6 characters">
          <input type="password" autoComplete="new-password" value={f.password} onChange={set('password')} />
        </Field>
        <Field label="Password again *">
          <input type="password" autoComplete="new-password" value={f.repeat} onChange={set('repeat')} />
        </Field>
      </div>
      <Field label="This login is for">
        <Segmented
          options={[
            ['staff', 'Staff'],
            ['owner', 'Owner'],
          ]}
          value={f.role}
          onChange={(role) => setF({ ...f, role })}
        />
      </Field>
      <p className="muted small">Tell them the password. They can make their own recovery key in Settings.</p>
    </Modal>
  );
}

function PasswordModal({ login, onClose, onSaved }) {
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');

  async function save() {
    if (password.length < 6) throw new Error('Password must be at least 6 characters.');
    if (password !== repeat) throw new Error('The two passwords are not the same.');
    await api(`/logins/${login.id}`, { method: 'PUT', body: { password } });
    onSaved();
  }

  return (
    <Modal title={`New password for ${login.username}`} onClose={onClose} onSubmit={save} submitLabel="Save password">
      <Field label="New password" hint="At least 6 characters">
        <input autoFocus type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Field label="New password again">
        <input type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
      </Field>
    </Modal>
  );
}
