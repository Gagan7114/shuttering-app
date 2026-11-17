// Small fetch wrapper for the Django API (session login + CSRF token).

const FIELD_LABELS = {
  name: 'Name',
  unit: 'Unit',
  total_qty: 'Total stock',
  rate: 'Rent',
  basis: 'Rent per',
  phone: 'Phone',
  address: 'Address',
  amount: 'Amount',
  date: 'Date',
  mode: 'Mode',
  customer: 'Customer',
  grace_hours: 'Grace hours',
  shop_name: 'Shop name',
  non_field_errors: '',
};

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function getCookie(name) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : '';
}

function errorText(data) {
  if (data == null) return '';
  if (typeof data === 'string') return data.trim().startsWith('<') ? '' : data;
  if (Array.isArray(data)) return data.map(errorText).join(' ');
  if (data.detail) return errorText(data.detail);
  return Object.entries(data)
    .map(([k, v]) => {
      const label = FIELD_LABELS[k] ?? k;
      return label ? `${label}: ${errorText(v)}` : errorText(v);
    })
    .join(' ');
}

let authLost = () => {};
export function onAuthLost(fn) {
  authLost = fn;
}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRFToken'] = getCookie('csrftoken');

  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      headers,
      credentials: 'same-origin',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Cannot reach the server. Is it running?', 0);
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    // The dev server (port 5173) answers 502/504 when the Django app behind it is not running.
    if ([502, 503, 504].includes(res.status)) {
      throw new ApiError('Cannot reach the shop server. Make sure it is running, then try again.', res.status);
    }
    if (res.status === 403 && /credentials were not provided|not authenticated/i.test(data?.detail || '')) {
      authLost();
    }
    throw new ApiError(errorText(data) || `Something went wrong (error ${res.status}).`, res.status);
  }
  return data;
}

export const qs = (params) =>
  '?' +
  Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
