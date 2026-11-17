import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { CustomerPicker } from '../components/CustomerPicker';
import { GiveList, picksSummary, picksToLines } from '../components/GiveList';
import { NO_SITE, SitePicker, siteIdOf } from '../components/SitePicker';
import { money, nowLocal, per } from '../format';
import { Card, Empty, Field, Loading, NoteField, PageHead, SaveBar, WhenField, useLoad, useToast } from '../ui';

export default function Issue() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const customers = useLoad(() => api('/customers'), []);
  const items = useLoad(() => api('/items'), []);

  const [customerId, setCustomerId] = useState(params.get('customer') || '');
  const account = useLoad(() => (customerId ? api(`/customers/${customerId}`) : Promise.resolve(null)), [customerId]);
  const [site, setSite] = useState(null); // null = not chosen yet
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

  const sum = picksSummary(picks, items.data);
  const sites = account.data?.sites || [];
  // one site: chosen for you; no sites: "no site"
  const chosenSite = site ?? (sites.length === 1 ? String(sites[0].id) : sites.length === 0 ? NO_SITE : null);
  const siteOptions = [
    ...sites.map((x) => [String(x.id), x.name, x.pcs_out ? `${x.pcs_out} pcs there now` : x.address]),
    [NO_SITE, sites.length ? 'No particular site' : 'No site', ''],
  ];

  function chooseCustomer(id) {
    setCustomerId(id);
    setSite(null);
  }

  async function save() {
    setErr('');
    try {
      if (!customerId) throw new Error('Choose the customer first.');
      if (chosenSite === null) throw new Error('Choose the site the items are going to.');
      const lines = picksToLines(picks, items.data);
      if (!lines.length) throw new Error('Enter how many of each item you are giving.');
      setBusy(true);
      const res = await api('/challans', {
        method: 'POST',
        body: {
          customer_id: Number(customerId),
          site_id: siteIdOf(chosenSite),
          at: at || nowLocal(),
          vehicle,
          note,
          lines,
        },
      });
      toast('Saved. Stock updated.');
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
        <CustomerPicker
          customers={customers.data}
          value={customerId}
          onChange={chooseCustomer}
          onCreated={customers.reload}
        />
      </Card>

      {customerId && account.data && (sites.length > 0 || site !== null) && (
        <Card title="Which site?" step="2">
          <SitePicker
            options={siteOptions}
            value={chosenSite}
            onChange={setSite}
            customerId={customerId}
            onCreated={account.reload}
          />
        </Card>
      )}

      {customerId && (
        <>
          <Card
            title="How many of each item?"
            step={sites.length > 0 || site !== null ? '3' : '2'}
            actions={
              account.data &&
              sites.length === 0 &&
              site === null && (
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
                  <b>
                    {sum.pcs} pcs
                  </b>{' '}
                  ({sum.n} item{sum.n > 1 ? 's' : ''}) · rent{' '}
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
      )}
    </>
  );
}
