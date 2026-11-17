import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { nowLocal } from './format';
import Icon from './icons';
import { WORK } from './work';

/* ---------- data loading ---------- */

export function useLoad(loader, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [tick, setTick] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    loaderRef.current().then(
      (data) => alive && setState({ loading: false, data, error: null }),
      (error) => alive && setState((s) => ({ ...s, loading: false, error })),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

export function Loading({ error }) {
  if (error) return <div className="banner bad">{error.message}</div>;
  return <div className="loading">Loading…</div>;
}

/* ---------- toasts ---------- */

const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const toast = useCallback((text, tone = 'ok') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="toasts no-print">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            {t.tone === 'ok' && <Icon name="check" size={18} />}
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- layout bits ---------- */

/** Page title. `work` (a key of WORK) adds the job's coloured icon. */
export function PageHead({ title, sub, work, back, children }) {
  const w = work && WORK[work];
  return (
    <div className="page-head no-print">
      {back && (
        <Link className="back-link" to={back.to}>
          <Icon name="back" size={16} /> {back.label}
        </Link>
      )}
      {(title || w) && (
      <div className="page-head-row">
        {w && (
          <span className={`work-icon tone-${w.tone}`}>
            <Icon name={w.icon} size={24} />
          </span>
        )}
        <div className="page-head-text">
          <h1>{title || w?.label}</h1>
          {(sub || w) && <div className="muted">{sub ?? w.hint}</div>}
        </div>
        {children && <div className="actions">{children}</div>}
      </div>
      )}
    </div>
  );
}

export function Card({ title, step, actions, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          {title && (
            <h2>
              {step && <span className="step">{step}</span>}
              {title}
            </h2>
          )}
          {actions && <div className="actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, tone = '', to, note }) {
  const body = (
    <>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {note && <div className="stat-note">{note}</div>}
    </>
  );
  return to ? (
    <Link to={to} className={`stat link ${tone}`}>
      {body}
    </Link>
  ) : (
    <div className={`stat ${tone}`}>{body}</div>
  );
}

export function Field({ label, children, className = '', hint }) {
  return (
    <label className={`f ${className}`}>
      {label && <span>{label}</span>}
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

export function Empty({ icon = 'store', title, children }) {
  return (
    <div className="empty">
      <Icon name={icon} size={34} />
      <b>{title}</b>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

/** Bottom bar with the summary and the main button of a form. Stays visible while scrolling. */
export function SaveBar({ children, summary }) {
  return (
    <div className="savebar no-print">
      <div className="savebar-sum">{summary}</div>
      <div className="savebar-btns">{children}</div>
    </div>
  );
}

/* ---------- inputs ---------- */

/** Number box with − and + buttons. `value` is a string ('' = nothing). */
export function QtyInput({ value, onChange, max, bad }) {
  const n = value === '' ? 0 : Number(value) || 0;
  const set = (v) => onChange(v <= 0 ? '' : String(v));
  return (
    <div className={`qty-input ${bad ? 'bad' : ''} ${n > 0 ? 'on' : ''}`}>
      <button type="button" onClick={() => set(n - 1)} disabled={n <= 0} aria-label="One less">
        <Icon name="minus" size={18} />
      </button>
      <input
        type="number"
        min="0"
        step="1"
        inputMode="numeric"
        placeholder="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => e.target.select()}
      />
      <button type="button" onClick={() => set(n + 1)} disabled={max !== undefined && n >= max} aria-label="One more">
        <Icon name="plus" size={18} />
      </button>
    </div>
  );
}

/** Row of buttons where one is chosen (like radio buttons). options: [[value, label], ...] */
export function Segmented({ options, value, onChange }) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          className={value === v ? 'on' : ''}
          onClick={() => onChange(v)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * Date & time of an entry. Empty value means "right now" (filled in when saving),
 * so most of the time nobody has to touch it.
 */
export function WhenField({ value, onChange, label = 'Date & time' }) {
  const [open, setOpen] = useState(!!value);
  if (!open)
    return (
      <div className="when">
        <Icon name="clock" size={18} />
        <span>
          {label}: <b>Right now</b>
        </span>
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            onChange(nowLocal());
            setOpen(true);
          }}
        >
          Change
        </button>
      </div>
    );
  return (
    <div className="when open">
      <Icon name="clock" size={18} />
      <span>{label}:</span>
      <input type="datetime-local" value={value} onChange={(e) => onChange(e.target.value)} />
      <button
        type="button"
        className="link-btn"
        onClick={() => {
          onChange('');
          setOpen(false);
        }}
      >
        Use now
      </button>
    </div>
  );
}

/** Small "+ Add note" link that turns into a text box. */
export function NoteField({ value, onChange, label = 'Note', placeholder }) {
  const [open, setOpen] = useState(!!value);
  if (!open)
    return (
      <button type="button" className="link-btn add-note" onClick={() => setOpen(true)}>
        <Icon name="plus" size={16} /> Add a note
      </button>
    );
  return (
    <Field label={label} className="note-field">
      <input autoFocus value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </Field>
  );
}

/* ---------- modal ---------- */

export function Modal({ title, onClose, onSubmit, submitLabel = 'Save', children, wide }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSubmit();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className={`modal ${wide ? 'wide' : ''}`} onSubmit={submit} noValidate>
        <div className="modal-head">
          <h3>{title}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {error && <div className="banner bad">{error}</div>}
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Saving…' : submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

export function confirmAction(message) {
  return window.confirm(message);
}
