import { useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, onAuthLost } from './api';
import { ShopContext } from './components/shared';
import Icon from './icons';
import { ToastProvider } from './ui';
import { DAILY, RECORDS, WORK } from './work';
import Login from './pages/Login';
import Home from './pages/Home';
import Store from './pages/Store';
import Customers from './pages/Customers';
import CustomerDetail from './pages/CustomerDetail';
import Issue from './pages/Issue';
import Return from './pages/Return';
import Replace from './pages/Replace';
import Payment from './pages/Payment';
import Challans from './pages/Challans';
import ChallanView from './pages/ChallanView';
import Bills from './pages/Bills';
import BillNew from './pages/BillNew';
import BillView from './pages/BillView';
import Settings from './pages/Settings';
import Reports from './pages/Reports';

export default function App() {
  const [auth, setAuth] = useState({ checked: false, user: null, shopComputer: false });
  const [shop, setShop] = useState({});

  useEffect(() => {
    onAuthLost(() => setAuth({ checked: true, user: null }));
    api('/auth/me')
      .then((d) => {
        setAuth({ checked: true, user: d.user, shopComputer: !!d.shop_computer });
        if (d.shop) setShop(d.shop);
      })
      .catch(() => setAuth({ checked: true, user: null }));
  }, []);

  useEffect(() => {
    document.title = shop.shop_name || 'Shuttering Store';
  }, [shop.shop_name]);

  if (!auth.checked) return <div className="loading">Loading…</div>;
  if (!auth.user)
    return (
      <Login
        shopComputer={auth.shopComputer}
        onLogin={(d) => {
          setAuth({ checked: true, user: d.user });
          setShop(d.shop || {});
        }}
      />
    );

  return (
    <ShopContext.Provider value={{ shop, setShop, user: auth.user }}>
      <ToastProvider>
        <Shell user={auth.user} shop={shop} onLogout={() => setAuth({ checked: true, user: null })}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/issue" element={<Issue />} />
            <Route path="/return" element={<Return />} />
            <Route path="/replace" element={<Replace />} />
            <Route path="/bill" element={<BillNew />} />
            <Route path="/payment" element={<Payment />} />
            <Route path="/store" element={<Store />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/customers/:id" element={<CustomerDetail />} />
            <Route path="/challans" element={<Challans />} />
            <Route path="/challans/:id" element={<ChallanView />} />
            <Route path="/bills" element={<Bills />} />
            <Route path="/bills/new" element={<BillNew />} />
            <Route path="/bills/:id" element={<BillView />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/settings" element={<Settings />} />
            {/* old addresses */}
            <Route path="/items" element={<Navigate to="/store" replace />} />
            <Route path="*" element={<div className="banner">Page not found.</div>} />
          </Routes>
        </Shell>
      </ToastProvider>
    </ShopContext.Provider>
  );
}

function NavItem({ k }) {
  const w = WORK[k];
  return (
    <NavLink to={w.path} className={`nav-item tone-${w.tone}`}>
      <span className="nav-icon">
        <Icon name={w.icon} size={19} />
      </span>
      {w.label}
    </NavLink>
  );
}

function Shell({ user, shop, onLogout, children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  // close the phone menu after moving to another page
  useEffect(() => setOpen(false), [location.pathname]);

  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      onLogout();
      navigate('/');
    }
  }

  const name = shop.shop_name || 'Shuttering Store';

  return (
    <div className={`app ${open ? 'menu-open' : ''}`}>
      <aside className="side no-print">
        <NavLink to="/" className="brand" end>
          <img src="/favicon.svg" alt="" width="30" height="30" />
          <span>{name}</span>
        </NavLink>

        <nav>
          <NavLink to="/" end className="nav-item tone-slate">
            <span className="nav-icon">
              <Icon name="home" size={19} />
            </span>
            Home
          </NavLink>

          <div className="nav-group">Daily work</div>
          {DAILY.map((k) => (
            <NavItem key={k} k={k} />
          ))}

          <div className="nav-group">Records</div>
          {RECORDS.map((k) => (
            <NavItem key={k} k={k} />
          ))}
        </nav>

        <div className="side-foot">
          <NavItem k="settings" />
          <button className="nav-item" onClick={logout}>
            <span className="nav-icon">
              <Icon name="logout" size={19} />
            </span>
            Log out <span className="muted-light">({user.username})</span>
          </button>
        </div>
      </aside>
      <div className="backdrop no-print" onClick={() => setOpen(false)} />

      <div className="content">
        <header className="mobile-top no-print">
          <button className="icon-btn light" onClick={() => setOpen(true)} aria-label="Open menu">
            <Icon name="menu" size={24} />
          </button>
          <NavLink to="/" className="brand" end>
            <img src="/favicon.svg" alt="" width="26" height="26" />
            <span>{name}</span>
          </NavLink>
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}
