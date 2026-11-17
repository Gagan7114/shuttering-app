const pad = (n) => String(n).padStart(2, '0');

/** Current local time as 'YYYY-MM-DDTHH:MM' (value for <input type="datetime-local">). */
export function nowLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function todayLocal() {
  return nowLocal().slice(0, 10);
}

export function fmtDate(s) {
  if (!s) return '';
  const [y, m, d] = s.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
}

export function fmtTime(s) {
  const t = (s || '').slice(11, 16);
  if (!t) return '';
  let [h, mi] = t.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${pad(mi)} ${ap}`;
}

export function fmtAt(s) {
  if (!s) return '';
  return s.length > 10 ? `${fmtDate(s)} ${fmtTime(s)}` : fmtDate(s);
}

const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (n) => '₹' + inr.format(Number(n || 0));

export const per = (basis) => (basis === 'hour' ? 'hour' : 'day');
export const rateText = (rate, basis) => `${money(rate)} / ${per(basis)}`;

export function unitsText(n, basis) {
  if (basis === 'hour') return `${n} hr${n === 1 ? '' : 's'}`;
  return `${n} day${n === 1 ? '' : 's'}`;
}

export const KIND_LABEL = { issue: 'Issue', return: 'Return', swap: 'Return + Replace' };

export const DAY_MODES = {
  calendar: {
    label: 'By date (issue day counted, return day not)',
    example: '1st → 3rd = 2 days. Returned the same day = 1 day.',
  },
  inclusive: {
    label: 'By date (both issue day and return day counted)',
    example: '1st → 3rd = 3 days. Returned the same day = 1 day.',
  },
  '24h': {
    label: 'Every 24 hours from the issue time',
    example: '1st 10 AM → 3rd 11 AM = 2 days (with 2 grace hours); → 3rd 1 PM = 3 days.',
  },
};

export const GST_TYPES = {
  none: 'No GST',
  intra: 'CGST + SGST (same state)',
  inter: 'IGST (other state)',
};

/** Totals for a bill: GST on (rent + lost + extras − discount). */
export function billTotals({ rent = 0, lost = 0, extras = 0, discount = 0, gstType = 'none', gstRate = 0 }) {
  const r2 = (n) => Math.round(n * 100) / 100;
  const taxable = r2(Number(rent) + Number(lost) + Number(extras) - Number(discount));
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  if (gstType === 'intra') cgst = sgst = r2((taxable * Number(gstRate)) / 200);
  if (gstType === 'inter') igst = r2((taxable * Number(gstRate)) / 100);
  return { taxable, cgst, sgst, igst, total: r2(taxable + cgst + sgst + igst) };
}

/** First two digits of a GSTIN = state code. */
export const gstState = (gstin) => (/^\d{2}/.test(gstin || '') ? gstin.slice(0, 2) : '');
