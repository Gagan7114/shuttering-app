import { useState } from 'react';
import { api } from '../api';
import { RecoveryKeyBox } from '../components/RecoveryKeyBox';
import { Field } from '../ui';

export default function Login({ onLogin }) {
  const [mode, setMode] = useState('login'); // login | forgot | done
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [key, setKey] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function go(next) {
    setMode(next);
    setError('');
  }

  async function login(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onLogin(await api('/auth/login', { method: 'POST', body: { username: username.trim(), password } }));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function reset(e) {
    e.preventDefault();
    setError('');
    if (!username.trim()) return setError('Enter your username.');
    if (!key.trim()) return setError('Enter your recovery key.');
    if (newPassword.length < 6) return setError('New password must be at least 6 characters.');
    if (newPassword !== repeat) return setError('The two new passwords are not the same.');
    setBusy(true);
    try {
      const data = await api('/auth/reset-password', {
        method: 'POST',
        body: { username: username.trim(), key, new_password: newPassword },
      });
      setResult(data);
      setPassword('');
      setNewPassword('');
      setRepeat('');
      setKey('');
      go('done');
    } catch (err) {
      setError(err.status === 429 ? 'Too many tries. Wait an hour and try again.' : err.message);
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'done')
    return (
      <div className="login-page">
        <div className="card login">
          <img src="/favicon.svg" alt="" width="52" height="52" />
          <h1>Password changed</h1>
          <p className="muted">
            You are logged in as <b>{result.user.username}</b>. Your old recovery key is used up. This is your{' '}
            <b>new recovery key</b> — write it down and keep it safe:
          </p>
          <RecoveryKeyBox value={result.recovery_key} />
          <button type="button" className="btn primary big" onClick={() => onLogin(result)}>
            I have written it down — continue
          </button>
        </div>
      </div>
    );

  if (mode === 'forgot')
    return (
      <div className="login-page">
        <form className="card login" onSubmit={reset} noValidate>
          <img src="/favicon.svg" alt="" width="52" height="52" />
          <h1>Forgot password</h1>
          <p className="muted">Use the recovery key you made in Settings to set a new password.</p>
          <Field label="Username">
            <input
              autoFocus={!username}
              autoComplete="username"
              autoCapitalize="none"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </Field>
          <Field label="Recovery key" hint="16 letters and numbers, like ABCD-EFGH-JKMN-PQRS">
            <input
              autoFocus={!!username}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              className="key-input"
              value={key}
              onChange={(e) => setKey(e.target.value.toUpperCase())}
            />
          </Field>
          <Field label="New password">
            <input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </Field>
          <Field label="New password again">
            <input type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
          </Field>
          {error && <div className="banner bad">{error}</div>}
          <button className="btn primary big" disabled={busy}>
            {busy ? 'Saving…' : 'Set new password'}
          </button>
          <div className="login-help">
            <b>No recovery key?</b> On the shop computer, open the <code>shuttring</code> folder in a terminal and run{' '}
            <code>./reset-password.sh</code>. It asks for the login and a new password.
          </div>
          <button type="button" className="link-btn login-switch" onClick={() => go('login')}>
            ← Back to log in
          </button>
        </form>
      </div>
    );

  return (
    <div className="login-page">
      <form className="card login" onSubmit={login}>
        <img src="/favicon.svg" alt="" width="52" height="52" />
        <h1>Shuttering Store</h1>
        <p className="muted">Log in to manage stock, challans and bills.</p>
        <Field label="Username">
          <input
            autoFocus
            autoComplete="username"
            autoCapitalize="none"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </Field>
        <Field label="Password">
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {error && <div className="banner bad">{error}</div>}
        <button className="btn primary big" disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
        <button type="button" className="link-btn login-switch" onClick={() => go('forgot')}>
          Forgot password?
        </button>
      </form>
    </div>
  );
}
