// The jobs done in the shop. Used by the menu, home tiles, page headings and customer shortcuts,
// so every job has the same name, icon and colour everywhere.

export const WORK = {
  issue: { short: 'Issue', path: '/issue', label: 'Issue items', hint: 'Give items to a customer', icon: 'issue', tone: 'blue' },
  return: { short: 'Return', path: '/return', label: 'Return items', hint: 'Customer brings items back', icon: 'return', tone: 'green' },
  replace: { short: 'Replace', path: '/replace', label: 'Replace items', hint: 'Take some back, give others', icon: 'replace', tone: 'amber' },
  bill: { short: 'Make bill', path: '/bill', label: 'Make bill', hint: 'Work out rent and save a bill', icon: 'bill', tone: 'violet' },
  payment: { short: 'Payment', path: '/payment', label: 'Receive payment', hint: 'Money received from a customer', icon: 'payment', tone: 'teal' },
  store: { path: '/store', label: 'Store stock', hint: 'Your items, stock and rent', icon: 'store', tone: 'orange' },
  customers: { path: '/customers', label: 'Customers', hint: 'Accounts, items with them, dues', icon: 'customers', tone: 'slate' },
  challans: { path: '/challans', label: 'All challans', hint: 'Every issue, return and replace', icon: 'challan', tone: 'slate' },
  bills: { path: '/bills', label: 'All bills', hint: 'Bills made so far', icon: 'bill', tone: 'slate' },
  reports: { path: '/reports', label: 'Reports', hint: 'Dues, daily, monthly, stock, GST', icon: 'chart', tone: 'slate' },
  settings: { path: '/settings', label: 'Settings', hint: 'Shop details and day counting', icon: 'settings', tone: 'slate' },
};

export const DAILY = ['issue', 'return', 'replace', 'bill', 'payment'];
export const RECORDS = ['store', 'customers', 'challans', 'bills', 'reports'];

/** Link to a job page with the customer already chosen. */
export const workLink = (key, customerId) => WORK[key].path + (customerId ? `?customer=${customerId}` : '');

/** Challan kind (from the API) → job key. */
export const KIND_WORK = { issue: 'issue', return: 'return', swap: 'replace' };
