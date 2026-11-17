import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { CustomerBadge } from '../components/CustomerPicker';
import { GiveList, picksSummary, picksToLines } from '../components/GiveList';
import { NO_SITE, SitePicker, siteIdOf } from '../components/SitePicker';
import { money, nowLocal, per } from '../format';
import Icon from '../icons';
import { Card, Empty, Field, Loading, NoteField, PageHead, SaveBar, WhenField, useLoad, useToast } from '../ui';

const digitsOf = (s) => (s || '').replace(/\D/g, '');
// Compare the last 10 digits, so "+91 98765 43210" and "9876543210" are the same number.
const samePhone = (a, b) => {
  const x = digitsOf(a).slice(-10);
  return x.length >= 6 && x === digitsOf(b).slice(-10);
};
const initial = (name) => (name || '?').trim().charAt(0).toUpperCase();
const subLine = (c) => [c.phone, c.sites?.length ? c.sites.join(', ') : c.address].filter(Boolean).join(' · ');

/*
 * Issue items. The page opens on one "New entry" box (customer name + phone) with two lists below it:
 * customers who have items right now, and the stock left in the store. A new customer is saved
 * together with the challan, so nobody has to be added as a customer first.
 */
export default function Issue() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const customers = useLoad(() => api('/customers'), []);
  const items = useLoad(() => api('/items'), []);

  // Who the entry is for: an existing customer (customerId) or a new one typed in (newCust).
  const [customerId, setCustomerId] = useState(params.get('customer') || '');
  const [newCust, setNewCust] = useState(null); // { name, phone }
  const [draft, setDraft] = useState({ name: '', phone: '' }); // what is typed in the New entry box
  const account = useLoad(() => (customerId ? api(`/customers/${customerId}`) : Promise.resolve(null)), [customerId]);
  const [site, setSite] = useState(null); // null = not chosen yet
  const [newSite, setNewSite] = useState(''); // site name for a new customer
  const [picks, setPicks] = useState({});
  const [at, setAt] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  if (!customers.data || !items.data) return <Loading error={customers.error || items.error} />;

  if (!items.data.length)
    return (
      <>
        <PageHead work="issue" />
        <Card>
          <Empty title="No items in the store yet">
            Add your items first (name, how many you own, rent).{' '}
            <Link to="/store">Go to Store stock →</Link>
          </Empty>
        </Card>
      </>
    );

  const existing = customerId ? customers.data.find((c) => String(c.id) === String(customerId)) : null;

  function pickCustomer(id) {
    setCustomerId(String(id));
    setNewCust(null);
    setSite(null);
    setErr('');
    window.scrollTo(0, 0);
  }

  function startNew(c) {
    setCustomerId('');
    setNewCust(c);
    setSite(null);
    setErr('');
  }

  function backToStart() {
    if (newCust) setDraft(newCust);
    setCustomerId('');
    setNewCust(null);
    setSite(null);
    setErr('');
  }

  if (!existing && !newCust)
    return (
      <>
        <PageHead work="issue" sub="Give items to a customer. Rent starts from this time." />
        <Card title="New entry">
          <EntryStart customers={customers.data} draft={draft} setDraft={setDraft} onUse={pickCustomer} onNew={startNew} />
        </Card>
        <div className="issue-lists">
          <HoldingList customers={customers.data} onUse={pickCustomer} />
          <StockList items={items.data} />
        </div>
      </>
    );

  const sum = picksSummary(picks, items.data);
  const sites = account.data?.sites || [];
  // one site: chosen for you; no sites: "no site"
  const chosenSite = site ?? (sites.length === 1 ? String(sites[0].id) : sites.length === 0 ? NO_SITE : null);
  const siteOptions = [
    ...sites.map((x) => [String(x.id), x.name, x.pcs_out ? `${x.pcs_out} pcs there now` : x.address]),
    [NO_SITE, sites.length ? 'No particular site' : 'No site', ''],
  ];
  const showSites = newCust || (account.data && (sites.length > 0 || site !== null));

  async function save() {
    setErr('');
    try {
      const body = { at: at || nowLocal(), vehicle, note };
      if (newCust) {
        body.new_customer = newCust;
        body.new_site = newSite.trim();
      } else {
        if (!account.data) throw new Error('Still loading the customer. Try again in a moment.');
        if (chosenSite === null) throw new Error('Choose the site the items are going to.');
        body.customer_id = Number(customerId);
        body.site_id = siteIdOf(chosenSite);
      }
      body.lines = picksToLines(picks, items.data);
      if (!body.lines.length) throw new Error('Enter how many of each item you are giving.');
      setBusy(true);
      const res = await api('/challans', { method: 'POST', body });
      toast(newCust ? `Saved. ${newCust.name} added as a customer.` : 'Saved. Stock updated.');
      navigate(`/challans/${res.id}?new=1`);
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead work="issue" sub="Give items to a customer. Rent starts from this time." />

      <Card title="Customer" step="1">
        <div className="picked">
          <CustomerBadge c={existing || newCust}>
            <div className="cust-stats">
              {newCust ? (
                <span className="chip-stat blue">New customer · saved with this entry</span>
              ) : (
                <>
                  <span className={existing.pcs_out > 0 ? 'chip-stat blue' : 'chip-stat'}>
                    {existing.pcs_out || 0} pcs with them
                  </span>
                  <span className={existing.balance > 0 ? 'chip-stat red' : 'chip-stat'}>
                    {existing.balance > 0 ? `${money(existing.balance)} due` : 'Nothing due'}
                  </span>
                </>
              )}
            </div>
          </CustomerBadge>
          <button type="button" className="btn sm" onClick={backToStart}>
            Change
          </button>
        </div>
      </Card>

      {showSites && (
        <Card title="Which site?" step="2">
          {newCust ? (
            <Field label="Site name (optional)" hint="Where the items are going, e.g. Model Town house. Leave empty if there is no site.">
              <input value={newSite} onChange={(e) => setNewSite(e.target.value)} maxLength={120} />
            </Field>
          ) : (
            <SitePicker
              options={siteOptions}
              value={chosenSite}
              onChange={setSite}
              customerId={customerId}
              onCreated={account.reload}
            />
          )}
        </Card>
      )}

      <Card
        title="How many of each item?"
        step={showSites ? '3' : '2'}
        actions={
          !showSites &&
          account.data && (
            <button type="button" className="link-btn" onClick={() => setSite(NO_SITE)}>
              + Add a site
            </button>
          )
        }
      >
        <GiveList items={items.data} picks={picks} setPicks={setPicks} />
      </Card>

      <Card className="quiet">
        <WhenField value={at} onChange={setAt} />
        <Field label="Vehicle no. (optional)" className="narrow">
          <input value={vehicle} onChange={(e) => setVehicle(e.target.value.toUpperCase())} placeholder="e.g. PB10 AB 1234" />
        </Field>
        <NoteField value={note} onChange={setNote} />
      </Card>

      {err && <div className="banner bad">{err}</div>}
      <SaveBar
        summary={
          sum.n ? (
            <>
              <b>{sum.pcs} pcs</b> ({sum.n} item{sum.n > 1 ? 's' : ''}) · rent{' '}
              {Object.entries(sum.rent)
                .map(([b, v]) => `${money(v)}/${per(b)}`)
                .join(' + ')}
            </>
          ) : (
            <span className="muted">Nothing chosen yet</span>
          )
        }
      >
        <button type="button" className="btn primary big" disabled={busy || !sum.n} onClick={save}>
          {busy ? 'Saving…' : 'Save & make challan'}
        </button>
      </SaveBar>
    </>
  );
}

function CustomerRow({ c, onClick }) {
  return (
    <button type="button" className="pick-row" onClick={onClick}>
      <span className="avatar sm">{initial(c.name)}</span>
      <span className="pick-text">
        <b>{c.name}</b>
        <span className="muted small">{subLine(c) || 'No phone saved'}</span>
      </span>
      {c.pcs_out > 0 && <span className="chip-stat blue">{c.pcs_out} pcs</span>}
      <Icon name="right" size={18} className="row-chev" />
    </button>
  );
}

/**
 * Type the customer's name and phone, then Next. Customers that match what is typed are shown,
 * and an exact name or phone match is asked about, so the same person is not added twice.
 */
function EntryStart({ customers, draft, setDraft, onUse, onNew }) {
  const [alike, setAlike] = useState(null); // customers with the same name or phone, waiting for "same person?"
  const [err, setErr] = useState('');
  const set = (k) => (e) => {
    setDraft({ ...draft, [k]: e.target.value });
    setAlike(null);
    setErr('');
  };

  const name = draft.name.trim();
  const n = name.toLowerCase();
  const d = digitsOf(draft.phone);
  const matches =
    n.length >= 2 || d.length >= 3
      ? customers
          .filter((c) => (n.length >= 2 && c.name.toLowerCase().includes(n)) || (d.length >= 3 && digitsOf(c.phone).includes(d)))
          .slice(0, 5)
      : [];
  const addNew = () => onNew({ name, phone: draft.phone.trim() });

  function next(e) {
    e.preventDefault();
    if (!name) {
      setErr('Type the customer name.');
      return;
    }
    if (!alike) {
      const same = customers.filter((c) => c.name.trim().toLowerCase() === n || samePhone(c.phone, draft.phone));
      if (same.length) {
        setAlike(same);
        return;
      }
    }
    addNew();
  }

  return (
    <form onSubmit={next} noValidate>
      <div className="entry-fields">
        <Field label="Customer name *">
          <input autoFocus value={draft.name} onChange={set('name')} placeholder="e.g. Ravi Kumar" autoComplete="off" maxLength={120} />
        </Field>
        <Field label="Phone">
          <input
            type="tel"
            inputMode="tel"
            value={draft.phone}
            onChange={set('phone')}
            placeholder="e.g. 98765 43210"
            autoComplete="off"
            maxLength={30}
          />
        </Field>
        <button type="submit" className="btn primary entry-next">
          Next <Icon name="arrow" size={18} />
        </button>
      </div>
      {err && <div className="text-bad small strong mt-s">{err}</div>}

      {alike ? (
        <div className="entry-alike">
          <b>{alike.length > 1 ? 'These customers are' : 'This customer is'} already saved. Is it the same person?</b>
          <div className="pick-list">
            {alike.map((c) => (
              <CustomerRow key={c.id} c={c} onClick={() => onUse(c.id)} />
            ))}
          </div>
          <button type="button" className="btn" onClick={addNew}>
            No, add {name} as a new customer
          </button>
        </div>
      ) : (
        matches.length > 0 && (
          <div className="entry-matches">
            <div className="muted small">Already a customer? Tap to choose:</div>
            <div className="pick-list">
              {matches.map((c) => (
                <CustomerRow key={c.id} c={c} onClick={() => onUse(c.id)} />
              ))}
            </div>
          </div>
        )
      )}
    </form>
  );
}

/** Customers who have items with them right now. Tap one to give them more. */
function HoldingList({ customers, onUse }) {
  const [term, setTerm] = useState('');
  const holding = customers.filter((c) => c.pcs_out > 0);
  const t = term.trim().toLowerCase();
  const shown = holding.filter(
    (c) =>
      !t ||
      c.name.toLowerCase().includes(t) ||
      (c.phone || '').includes(t) ||
      (c.sites || []).some((x) => x.toLowerCase().includes(t)),
  );

  return (
    <Card title={`Customers who have items (${holding.length})`}>
      {holding.length === 0 ? (
        <p className="muted pad">No customer has items right now.</p>
      ) : (
        <>
          {holding.length > 8 && (
            <div className="search-box mb">
              <Icon name="search" size={18} />
              <input placeholder="Find customer…" value={term} onChange={(e) => setTerm(e.target.value)} />
            </div>
          )}
          <p className="muted small pad">Tap a customer to give them more items.</p>
          <div className="pick-list open">
            {shown.map((c) => (
              <CustomerRow key={c.id} c={c} onClick={() => onUse(c.id)} />
            ))}
            {!shown.length && <p className="muted pad">No customer found.</p>}
          </div>
        </>
      )}
    </Card>
  );
}

/** How many of each item are in the store right now. */
function StockList({ items }) {
  return (
    <Card
      title="Available stock"
      actions={
        <Link className="btn sm" to="/store">
          Open store
        </Link>
      }
    >
      <div className="mini-stock">
        {items.map((i) => (
          <div key={i.id} className="mini-row">
            <span className="mini-name">{i.name}</span>
            <span className={`mini-num ${i.available === 0 ? 'text-bad' : ''}`}>
              {i.available} <small>of {i.total_qty} {i.unit} in store</small>
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
