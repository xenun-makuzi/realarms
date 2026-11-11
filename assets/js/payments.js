// Customer-facing payment methods.
// The database only accepts three values in orders.payment_method (pay_on_collection, bank_transfer, payment_link),
// and the SQL is not changed, so each method maps to one of them via `db`. The exact choice is also written as the
// first line of the order notes ("Payment preference: ...") so staff and the customer's account page can see it.
//   on:    shown at checkout by default.  final: payment cannot be reversed once sent.
// To change what is shown without editing code, add a setting in Admin > Settings:
//   payment_methods_enabled = bank,wire,crypto,in_person        (comma-separated ids from this list)
//   payment_instructions_<id> = text shown to the customer on their order page after they place an order (e.g. payment_instructions_wire)
export const METHODS = [
  { id: 'bank', label: 'ACH bank transfer', db: 'bank_transfer', on: 1, blurb: 'Send a bank transfer to the account details we give you after you place your order.' },
  { id: 'wire', label: 'Wire transfer', db: 'bank_transfer', on: 1, final: 1, blurb: 'Domestic or international wire. Your bank may charge a fee.' },
  { id: 'crypto', label: 'Cryptocurrency', db: 'payment_link', on: 1, final: 1, coins: ['Bitcoin (BTC)', 'Ethereum (ETH)', 'Litecoin (LTC)'], blurb: 'After you place your order, support sends a wallet address and the exact amount for your coin.' },
  { id: 'zelle', label: 'Zelle', db: 'bank_transfer', final: 1, blurb: 'Send from your bank app to the Zelle details we give you after you place your order.' },
  { id: 'chime', label: 'Chime', db: 'bank_transfer', final: 1, blurb: 'Send from your Chime account to the details we give you after you place your order.' },
  { id: 'paypal', label: 'PayPal', db: 'payment_link', blurb: 'We send a PayPal invoice after you place your order.' },
  { id: 'applepay', label: 'Apple Pay', db: 'payment_link', blurb: 'Pay with Apple Pay through a link we send after you place your order.' },
  { id: 'in_person', label: 'Pay on collection or transfer', db: 'pay_on_collection', on: 1, blurb: 'Pay in person when you collect or take transfer. Not available for delivery.' },
];

export const key = m => `payment_instructions_${m.id}`;

/** Methods to offer, from the payment_methods_enabled setting (falls back to the defaults above). */
export function enabled(S = {}) {
  const ids = (S.payment_methods_enabled || '').split(',').map(x => x.trim()).filter(Boolean);
  const list = METHODS.filter(m => ids.includes(m.id));
  return list.length ? list : METHODS.filter(m => m.on);
}

/** First line of the order notes, e.g. "Payment preference: Cryptocurrency (Bitcoin (BTC))". Empty for pay-in-person. */
export const prefLine = (m, coin) => (m.db === 'pay_on_collection' ? '' : `Payment preference: ${m.label}${coin ? ` (${coin})` : ''}`);

/** Reads the preference back from an order's notes: { text, m } or null. */
export function parsePref(notes) {
  const t = /^Payment preference: (.+)$/m.exec(notes || '');
  return t ? { text: t[1], m: METHODS.find(m => t[1] === m.label || t[1].startsWith(m.label + ' (')) } : null;
}
