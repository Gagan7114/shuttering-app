# Shuttering Store

Rental stock and billing for a shuttering store: keep your items, issue them to customers, take them back (or swap them for other items), and the bill is calculated automatically from day-wise or hour-wise rent.

**Tech:** PostgreSQL · Django 6 + Django REST Framework (`backend/`) · React 19 + Vite (`frontend/`)

## First-time setup

You need Python 3, Node.js and a running PostgreSQL.

```bash
./setup.sh
```

The script:
1. installs the Python packages into `backend/.venv`
2. asks for your PostgreSQL admin login, then creates a `shuttering` database and user and saves that login in `backend/.env`
3. creates the tables and builds the React app
4. asks you to create your own login (username + password)

## Daily use

```bash
./run.sh            # opens on http://localhost:8000 and on phones on the same Wi-Fi
./run.sh --local    # only this computer
./backup.sh         # full database backup into ./backups
./reset-password.sh # forgot a password and have no recovery key
```

### Logins and forgot password
- **Settings → Logins** (owner only): add logins (Owner or Staff), **Set password** for any login, switch a login off. Staff can do all daily work but can't manage logins or open the admin.
- Once, after logging in: **Settings → Make recovery key**. Write the key down and keep it safe.
- Forgot the password: on the login page tap **Forgot password?**, enter username, recovery key and a new password. The key is then used up and a new one is shown — write that one down.
- Nobody can log in: on the **shop computer itself**, the login page shows **Create a new login** (makes an owner login; phones on the Wi-Fi don't get this button). Then fix the old login in Settings → Logins. Or run `./reset-password.sh` in a terminal.
- Wrong recovery keys and new logins from the login page are limited to 10 tries an hour.

## How it works

| Screen | What it does |
|---|---|
| **Items** | Add each item once: name, total stock, and rent per **day** or per **hour**. |
| **Issue** | Give items to a customer. Stock goes down and rent starts at the date and time you enter. You can change the rent for that customer only. |
| **Return / Replace** | For each item the customer has, enter how many were **returned** and how many were **replaced**, and with which new item. Rent stops for returned items. Replacement items start their own rent from that time. |
| **Make bill** | Works out the rent up to the date and time you choose, then you add transport, damage or other charges and a discount. Printable. |
| **Customer page** | Items with the customer (per site), unbilled rent so far, sites, challans, bills, payments and balance due. |
| **Sites** | A customer can have several work sites (Customer page → Sites). Issue, Return and Replace ask which site; returns only use up what was sent to that site. Challans and bills show the site. |
| **Lost items** | On Return, tap “Some are lost?” for an item. Rent for those pieces stops, your stock goes down for good, and the lost price (set per item in Store) is added to the next bill. |
| **GST bills** | Settings → GST bills. With it on, bills print as Tax Invoice with your GSTIN, the customer's GSTIN, SAC code and CGST + SGST (same state) or IGST (other state, from the GSTIN's first two digits). Can be switched off for one bill. |
| **TDS** | Receive payment → “Customer deducted TDS?”. TDS clears the balance like money received. |
| **Reports** | Money due, Daily (items moved, bills, payments), Monthly (billed vs received), Who has the stock (by customer and site), GST sales with CSV download and missing bill numbers. |

### Example

Customer A takes item1 ×3 and item2 ×4. Two days later they return all of item1 and 2 of item2, and swap the other 2 item2 for 2 item3. The bill shows:

- item1: 3 × 2 days × item1 rent
- item2: 4 × 2 days × item2 rent (2 returned + 2 swapped back, all out for 2 days)
- item3: 2 × (days from the swap until returned, or until the bill date) × item3 rent

### Rules
- **Day counting** is set in Settings. The default counts by date: the issue day is counted and the return day is not, so 1st → 3rd = 2 days, and same day = 1 day. You can also count both days, or count every 24 hours with grace hours.
- **Hourly items** are charged for every started hour, with a minimum of 1 hour.
- **Monthly or part bills:** you can bill a customer while items are still out. The next bill starts where the last one ended, so no day is charged twice.
- Challans before a customer's latest bill are locked. To correct one, delete that bill first (only the latest bill can be deleted), fix the challan, and make the bill again.
- Changing an item's rent affects new issues only.
- Lost pieces are charged once, on the bill whose period contains the return challan. Deleting that challan (only possible before it is billed) puts the stock back.
- GST is worked out on rent + lost items + other charges − discount. e-Invoice (IRN) and e-Way Bill are not built in: they need a GST Suvidha Provider (GSP) account.

## For developers

```bash
# backend on :8001 (DEBUG on) + frontend with hot reload on http://localhost:5173 — one command
./dev.sh
# (port 8000 is used by another project here, so the dev setup uses 8001;
#  frontend/vite.config.js forwards /api to it. Error 502 on :5173 = backend not running.)
# tests (the DB user needs CREATEDB; or point DB_HOST/DB_PORT/DB_USER at a throwaway Postgres)
cd backend && .venv/bin/python manage.py test store
# after pulling changes: apply database changes, then restart the app
cd backend && .venv/bin/python manage.py migrate
```

- Rent logic: `backend/store/billing.py`. Returns use up the oldest issued items of that item at that site first, and each bill charges only the days added since the previous one.
- Reports API: `backend/store/reports.py` (`/api/reports/outstanding|daily|monthly|stock|gst`).
- API: `backend/store/views.py` (all under `/api/`, session login). Django admin is at `/admin/`; challans and bills are read-only there.
- In production, Django serves the built React app from `frontend/dist`, using WhiteNoise and the waitress server (`backend/serve.py`).
