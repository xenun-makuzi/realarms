import { supabase, configured } from './supabase-client.js';
import { getCart, setCart } from './cart.js';
import { enabled, METHODS, key as payKey, prefLine, parsePref } from './payments.js';
import { openChat } from './chat.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paras = t => String(t ?? '').split(/\n{2,}/).filter(p => p.trim()).map(p => `<p>${esc(p.trim())}</p>`).join('');
let cur = 'USD';
const money = (n, c = cur) => new Intl.NumberFormat(undefined, { style: 'currency', currency: c }).format(n);
const LABEL = { pending_review: 'Awaiting review', approved: 'Approved', rejected: 'Not approved', paid: 'Paid', fulfilled: 'Completed', cancelled: 'Cancelled', unpaid: 'Unpaid', pending: 'Payment pending', refunded: 'Refunded' };
const RANK = { ship: 0, licensed_transfer: 1, pickup_only: 2 };
const getSession = async () => (await supabase.auth.getSession()).data.session;
const setting = async keys => Object.fromEntries(((await supabase.from('site_settings').select('setting_key,setting_value').in('setting_key', keys)).data || []).map(r => [r.setting_key, r.setting_value]));
const bad = (el, m) => { el.className = 'notice bad'; el.textContent = m; };
const safe = e => (e?.code === 'P0001' ? e.message : 'Something went wrong. Please try again.');
const EMPTY = '<p>Your cart is empty. <a href="shop.html">Browse the shop</a>.</p>';

// "Contact support" buttons open the live chat with the order details attached.
document.addEventListener('click', e => {
  const b = e.target.closest('[data-chat]');
  if (b) { e.preventDefault(); openChat({ order: b.dataset.chat, total: b.dataset.chatTotal, payment: b.dataset.chatPay }); }
});

// Payment box for an unpaid order: the chosen method, any instructions set in Admin > Settings, and the chat button.
function payPanel(S, o) {
  const pref = parsePref(o.customer_notes), m = pref?.m, inPerson = o.payment_method === 'pay_on_collection';
  const txt = m && (S[payKey(m)] || (m.id === 'bank' && S.payment_instructions));
  const how = inPerson ? '<p>Pay when you collect or take transfer of your order.</p>' : txt ? paras(txt) : `<p>Contact support and we will send you the exact payment details${pref ? ' for ' + esc(pref.text) : ''}.</p>`;
  return `<div class="notice"><b>Pay for order #${esc(o.order_number)}${pref ? ' by ' + esc(pref.text) : ''}</b>${how}<p><button class="btn" type="button" data-chat="${esc(o.order_number)}" data-chat-total="${esc(money(Number(o.total)))}" data-chat-pay="${esc(pref?.text || '')}">${inPerson ? 'Contact support' : 'Contact support for payment details'}</button></p><p class="muted">${m?.final ? 'This payment cannot be reversed once sent. ' : ''}Only pay using the details shown here or given to you in our support chat.</p></div>`;
}

const pub = p => supabase.storage.from('public-media').getPublicUrl(p).data.publicUrl;
const HOW = { ship: 'Delivery where lawful', licensed_transfer: 'Licensed dealer transfer', pickup_only: 'Pickup only' };

async function cartPage(el) {
  let cart = getCart();
  const { data } = cart.length ? await supabase.from('products').select('id,name,slug,price,stock_status,image_path,fulfilment').in('id', cart.map(i => i.id)).eq('status', 'published') : { data: [] };
  const P = Object.fromEntries((data || []).map(p => [p.id, p]));
  cart = cart.filter(i => P[i.id]); setCart(cart);
  const gone = p => p.price == null || p.stock_status === 'out_of_stock';
  const line = i => {
    const p = P[i.id], u = `product.html?slug=${encodeURIComponent(p.slug)}`;
    const opts = [...Array(10)].map((_, n) => `<option ${n + 1 === i.qty ? 'selected' : ''}>${n + 1}</option>`).join('');
    return `<li class="line"><a class="lthumb" href="${u}" tabindex="-1" aria-hidden="true">${p.image_path ? `<img src="${esc(pub(p.image_path))}" alt="" loading="lazy">` : '<span class="ph">No image</span>'}</a>
<div><a class="lname" href="${u}">${esc(p.name)}</a><p class="muted">${HOW[p.fulfilment]}</p>${gone(p) ? '<span class="stock out">Unavailable</span>' : ''}</div>
<div class="lbuy"><label class="sr" for="q_${esc(i.id)}">Quantity for ${esc(p.name)}</label><select id="q_${esc(i.id)}" data-qty="${esc(i.id)}" style="width:auto">${opts}</select><b class="price">${p.price == null ? 'n/a' : money(p.price * i.qty)}</b><button class="btn sec" data-rm="${esc(i.id)}">Remove</button></div></li>`;
  };
  const draw = () => {
    if (!cart.length) { el.innerHTML = EMPTY; return; }
    const sub = cart.reduce((s, i) => s + (P[i.id].price ?? 0) * i.qty, 0), blocked = cart.some(i => gone(P[i.id]));
    el.innerHTML = `<div class="co"><ul class="lines">${cart.map(line).join('')}</ul>
<aside class="card"><h2>Order summary</h2><p class="row between"><span>Subtotal</span><b class="price">${money(sub)}</b></p><p class="muted">You choose delivery and a payment method at checkout.</p>${blocked ? '<p class="notice">Remove unavailable items to continue.</p>' : '<a class="btn block" href="checkout.html">Checkout</a>'}</aside></div>`;
  };
  el.onchange = e => { const id = e.target.dataset.qty; if (!id) return; cart.find(i => i.id === id).qty = Number(e.target.value); setCart(cart); draw(); };
  el.onclick = e => { const id = e.target.dataset.rm; if (!id) return; cart = cart.filter(i => i.id !== id); setCart(cart); draw(); };
  draw();
}

async function checkoutPage(el) {
  const s = await getSession();
  if (!s) { el.innerHTML = '<p>Please <a href="account.html?next=checkout.html">sign in or create an account</a> to check out.</p>'; return; }
  const cart = getCart();
  if (!cart.length) { el.innerHTML = EMPTY; return; }
  const [{ data: prods }, { data: ms, error: msErr }, { data: prof }] = await Promise.all([
    supabase.from('products').select('id,name,price,stock_status,fulfilment').in('id', cart.map(i => i.id)).eq('status', 'published'),
    supabase.from('shipping_methods').select('id,name,description,method_type,price').eq('status', 'published').order('display_order'),
    supabase.from('profiles').select('full_name,phone,address_line1,city,region,postal_code,country').eq('id', s.user.id).maybeSingle(),
  ]);
  const P = Object.fromEntries((prods || []).map(p => [p.id, p]));
  if (cart.some(i => !P[i.id] || P[i.id].price == null || P[i.id].stock_status === 'out_of_stock')) { el.innerHTML = '<p class="notice">Some items are unavailable. <a href="cart.html">Review your cart</a>.</p>'; return; }
  const need = Math.max(...cart.map(i => RANK[P[i.id].fulfilment]));
  const ok = (ms || []).filter(m => need === 0 || (need === 1 && m.method_type !== 'ship') || (need === 2 && m.method_type === 'pickup'));
  if (!ok.length) {
    const dev = ['localhost', '127.0.0.1'].includes(location.hostname);
    const why = msErr ? `the delivery methods could not be loaded (${esc(msErr.message)})` : (ms || []).length ? 'none of the published delivery methods fits these items (a "ship" method cannot carry licensed-transfer or pickup-only items)' : 'no delivery method is published';
    el.innerHTML = `<p class="notice">No delivery method is available for the items in your cart yet. <a href="contact.html">Contact us</a>.${dev ? `<br><small>Developer note: ${why}. In Admin > Delivery methods, or the shipping_methods table in Supabase, set "Store pickup" (fits every item) or "Licensed dealer transfer" to published.</small>` : ''}</p>`; return;
  }
  const sub = cart.reduce((t, i) => t + P[i.id].price * i.qty, 0), pr = prof || {};
  const PS = await setting(['payment_methods_enabled', 'payment_instructions', ...METHODS.map(payKey)]);
  const methods = enabled(PS);
  // Shipping is only offered when every item is marked "ship"; otherwise tell the customer which items stop it.
  const noShip = (ms || []).some(m => m.method_type === 'ship') && need > 0
    ? `<p class="notice">Direct shipping is not available for: ${cart.filter(i => P[i.id].fulfilment !== 'ship').map(i => `<b>${esc(P[i.id].name)}</b>`).join(', ')}. These items are collected in person or sent to a licensed dealer you choose.</p>` : '';
  el.innerHTML = `<div class="co"><form id="co" class="card" novalidate><h2>Your details</h2>
<label for="c_name">Full name</label><input id="c_name" name="name" autocomplete="name" required maxlength="100" value="${esc(pr.full_name)}">
<label for="c_phone">Phone</label><input id="c_phone" name="phone" type="tel" autocomplete="tel" maxlength="30" value="${esc(pr.phone)}">
<h2 style="margin-top:20px">Delivery</h2>${noShip}${ok.map((m, i) => `<label class="choice"><input type="radio" name="method" value="${esc(m.id)}" ${i ? '' : 'checked'}><span><b>${esc(m.name)}</b> (${Number(m.price) ? money(m.price) : 'Free'})<br><span class="muted">${esc(m.description)}</span></span></label>`).join('')}
<div id="ship-box" hidden>
<label for="c_a1">Street address</label><input id="c_a1" name="a1" autocomplete="address-line1" maxlength="120" value="${esc(pr.address_line1 || '')}">
<label for="c_a2">Apartment, suite or landmark (optional)</label><input id="c_a2" name="a2" autocomplete="address-line2" maxlength="60">
<div class="two"><div><label for="c_city">City</label><input id="c_city" name="city" autocomplete="address-level2" maxlength="60" value="${esc(pr.city || '')}"></div><div><label for="c_reg">State or region</label><input id="c_reg" name="region" autocomplete="address-level1" maxlength="50" value="${esc(pr.region || '')}"></div></div>
<div class="two"><div><label for="c_zip">Postal code (if your country uses one)</label><input id="c_zip" name="zip" autocomplete="postal-code" maxlength="20" value="${esc(pr.postal_code || '')}"></div><div><label for="c_cty">Country</label><input id="c_cty" name="country" autocomplete="country-name" maxlength="50" value="${esc(pr.country || '')}"></div></div></div>
<div id="dealer-box" hidden><label for="c_dealer">Receiving licensed dealer (name, address, licence reference)</label><textarea id="c_dealer" name="dealer" rows="4" maxlength="400"></textarea><p class="muted">Staff verify the dealer before anything is released.</p></div>
<h2 style="margin-top:20px">Payment</h2><p class="muted">Choose how you want to pay. After you place your order, contact support to get the payment details.</p>${methods.map((m, i) => `<label class="choice" data-pay="${m.id}"><input type="radio" name="pay" value="${m.id}" ${i ? '' : 'checked'}><span><b>${esc(m.label)}</b><br><span class="muted">${esc(m.blurb)}</span></span></label>`).join('')}<div id="coin-box" hidden><label for="c_coin">Coin</label><select id="c_coin" name="coin">${(METHODS.find(m => m.coins)?.coins || []).map(x => `<option>${esc(x)}</option>`).join('')}</select></div><p id="pay-warn" class="notice" hidden>This payment cannot be reversed once sent. Pay only with details shown in your account or given by our support chat.</p>
<label for="c_notes">Notes (optional)</label><textarea id="c_notes" name="notes" rows="3" maxlength="800"></textarea>
<label class="chk"><input type="checkbox" name="ack"> I am of legal age and eligible to buy these items where I live, and I understand my order is reviewed and may be declined.</label>
<button class="btn block" type="submit">Place order</button><p id="co-status" role="status"></p></form>
<aside class="card"><h2>Order summary</h2><ul>${cart.map(i => `<li>${esc(P[i.id].name)} x ${i.qty}: ${money(P[i.id].price * i.qty)}</li>`).join('')}</ul><p>Items: ${money(sub)}</p><p class="price" id="tot"></p></aside></div>`;
  const f = $('#co'), st = $('#co-status');
  const pick = () => ok.find(m => m.id === f.elements.method.value);
  const sync = () => {
    const m = pick(), ship = m?.method_type === 'ship';
    $('#ship-box').hidden = !ship; $('#dealer-box').hidden = m?.method_type !== 'licensed_transfer';
    $('#tot').textContent = `Total: ${money(sub + Number(m?.price ?? 0))}`;
    f.querySelectorAll('[data-pay="in_person"]').forEach(l => (l.hidden = ship));
    if (ship && f.elements.pay.value === 'in_person') f.querySelector('[data-pay]:not([hidden]) input').checked = true;
    const pm = methods.find(x => x.id === f.elements.pay.value);
    $('#coin-box').hidden = !pm?.coins; $('#pay-warn').hidden = !pm?.final;
  };
  f.addEventListener('change', sync); sync();
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f)), m = pick(), pm = methods.find(x => x.id === d.pay);
    if (!m) return bad(st, 'Choose a delivery method.');
    if (!pm) return bad(st, 'Choose a payment method.');
    if ((d.name || '').trim().length < 2) return bad(st, 'Enter your name.');
    const val = k => (d[k] || '').trim();
    const addr = [val('a1'), val('a2'), [val('city'), val('region'), val('zip')].filter(Boolean).join(', '), val('country')].filter(Boolean).join('\n');
    const note = [prefLine(pm, d.coin), (d.notes || '').trim()].filter(Boolean).join('\n\n');
    if (m.method_type === 'ship') {
      if (!val('a1') || !val('city') || !val('country')) return bad(st, 'Enter your street address, city and country for delivery.');
      if (addr.length < 10) return bad(st, 'That address looks too short. Add your street or landmark, city and country.');
    }
    if (m.method_type === 'licensed_transfer' && (d.dealer || '').trim().length < 10) return bad(st, 'Enter the receiving dealer details.');
    if (!d.ack) return bad(st, 'Please confirm the eligibility statement.');
    const btn = $('button[type=submit]', f); btn.disabled = true; st.className = ''; st.textContent = 'Placing your order…';
    const { data: oid, error } = await supabase.rpc('place_order', { p_items: cart.map(i => ({ id: i.id, qty: i.qty })), p_method: m.id, p_payment: pm.db, p_details: { name: d.name, phone: d.phone, ship_to: m.method_type === 'ship' ? addr : '', dealer: m.method_type === 'licensed_transfer' ? d.dealer : '', notes: note, ack: 'true' } });
    btn.disabled = false;
    if (error) return bad(st, safe(error));
    setCart([]);
    const { data: o } = await supabase.from('orders').select('order_number').eq('id', oid).maybeSingle();
    const num = o?.order_number ?? '', total = sub + Number(m.price ?? 0);
    el.innerHTML = `<h2>Order ${num ? '#' + esc(num) + ' ' : ''}received</h2><p>Thank you. Your order total is <b>${money(total)}</b>.</p>${payPanel(PS, { order_number: num, payment_method: pm.db, customer_notes: note, total })}<p><a class="btn dark" href="account.html">View my orders</a></p>`;
  });
}

const RECOVERY = /type=recovery/.test(location.hash); // read before supabase-js clears the URL hash

// Turns a Supabase auth error into a message that says what actually happened.
const authMsg = (e, what = 'sign in') => {
  const c = e?.code || '', m = (e?.message || '').toLowerCase();
  if (e?.status === 429 || c.includes('rate_limit') || m.includes('rate limit')) return 'Too many attempts or emails sent. Please wait a while, then try again.' + (['localhost', '127.0.0.1'].includes(location.hostname) ? ' Developer note: your Supabase email limit was reached. Set up custom SMTP, or turn off "Confirm email", in Supabase Authentication settings (see README).' : '');
  if (c === 'invalid_credentials' || m.includes('invalid login')) return 'Incorrect email or password.';
  if (c === 'email_not_confirmed' || m.includes('not confirmed')) return 'Please confirm your email first. Check your inbox for the confirmation link.';
  if (c === 'user_already_exists' || m.includes('already registered')) return 'An account with this email already exists. Sign in, or use "Forgot your password?".';
  if (c === 'weak_password') return e.message;
  if (c === 'email_address_not_authorized') return 'We cannot send email to that address yet. Please contact us.';
  if (c === 'email_address_invalid') return 'That email address was not accepted. Check it and try again.';
  return `Could not ${what}. Check your details and try again.`;
};

// Shown after the customer opens the reset link from their email.
function recoveryForm(el) {
  el.innerHTML = `<form id="rp" class="card" style="max-width:460px" novalidate><h2>Choose a new password</h2><label for="rp_pw">New password (at least 10 characters)</label><input id="rp_pw" type="password" autocomplete="new-password" required><label for="rp_pw2">Repeat new password</label><input id="rp_pw2" type="password" autocomplete="new-password" required><p><button class="btn dark" type="submit">Save password</button></p><p id="rp-st" role="status"></p></form>`;
  const st = $('#rp-st');
  $('#rp').onsubmit = async e => {
    e.preventDefault();
    const a = $('#rp_pw').value;
    if (a.length < 10) return bad(st, 'Use a password of at least 10 characters.');
    if (a !== $('#rp_pw2').value) return bad(st, 'The two passwords do not match.');
    const { error } = await supabase.auth.updateUser({ password: a });
    if (error) return bad(st, authMsg(error, 'save the password'));
    history.replaceState(null, '', location.pathname);
    st.className = 'notice ok'; st.textContent = 'Password updated. Loading your account…';
    setTimeout(() => location.reload(), 900);
  };
}

async function accountPage(el) {
  const s = await getSession();
  if (RECOVERY && s) return recoveryForm(el);
  const next = (/^[a-z-]+\.html$/.exec(new URLSearchParams(location.search).get('next') || '') || ['account.html'])[0];
  if (!s) {
    el.innerHTML = `<div class="tabs" role="tablist" aria-label="Account"><button type="button" role="tab" id="t_in" aria-selected="true" aria-controls="in">Sign in</button><button type="button" role="tab" id="t_up" aria-selected="false" aria-controls="up">Create account</button></div><div class="authbox"><form id="in" class="card" novalidate><h2>Sign in</h2><label for="i_email">Email</label><input id="i_email" name="email" type="email" autocomplete="username" required><label for="i_pw">Password</label><input id="i_pw" name="password" type="password" autocomplete="current-password" required><p><button class="btn dark" type="submit">Sign in</button></p></form>
<form id="up" class="card" novalidate hidden><h2>Create account</h2><label for="u_email">Email</label><input id="u_email" name="email" type="email" autocomplete="email" required><label for="u_pw">Password (at least 10 characters)</label><input id="u_pw" name="password" type="password" autocomplete="new-password" required minlength="10"><p><button class="btn dark" type="submit">Create account</button></p></form></div><details class="card" id="forgot"><summary>Forgot your password?</summary><form id="fp" novalidate><p class="muted">Enter your email and we will send you a link to choose a new password.</p><label for="fp_email">Email</label><input id="fp_email" type="email" autocomplete="email" required><p><button class="btn dark" type="submit">Send reset link</button></p></form></details><p id="auth-status" role="status"></p>`;
    const st = $('#auth-status');
    const show = up => {
      $('#in').hidden = up; $('#up').hidden = !up; $('#forgot').hidden = up;
      $('#t_in').setAttribute('aria-selected', String(!up)); $('#t_up').setAttribute('aria-selected', String(up));
      st.className = ''; st.textContent = '';
    };
    $('#t_in').onclick = () => show(false); $('#t_up').onclick = () => show(true);
    if (new URLSearchParams(location.search).get('mode') === 'signup') show(true);
    if (/error_code=/.test(location.hash)) bad(st, 'That email link has expired or was already used. Request a new one below.');
    $('#fp').onsubmit = async e => {
      e.preventDefault(); const em = $('#fp_email').value.trim();
      if (!em) return bad(st, 'Enter your email address.');
      st.className = ''; st.textContent = 'Sending…';
      const { error } = await supabase.auth.resetPasswordForEmail(em, { redirectTo: new URL('account.html', location.href).href });
      if (error) return bad(st, authMsg(error, 'send the reset link'));
      st.className = 'notice ok'; st.textContent = 'If an account exists for that email, a reset link is on its way. Check your inbox and spam folder.';
    };
    $('#in').onsubmit = async e => {
      e.preventDefault(); const f = e.target.elements; st.className = ''; st.textContent = 'Signing in…';
      const { error } = await supabase.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
      if (error) bad(st, authMsg(error, 'sign in')); else location.href = next;
    };
    $('#up').onsubmit = async e => {
      e.preventDefault(); const f = e.target.elements;
      if (f.password.value.length < 10) return bad(st, 'Use a password of at least 10 characters.');
      st.className = ''; st.textContent = 'Creating your account…';
      const { data, error } = await supabase.auth.signUp({ email: f.email.value.trim(), password: f.password.value, options: { emailRedirectTo: new URL('account.html', location.href).href } });
      if (error) return bad(st, authMsg(error, 'create the account'));
      if (data.session) location.href = next; else { st.className = 'notice ok'; st.textContent = 'Check your email to confirm your account, then sign in.'; }
    };
    return;
  }
  const [{ data: pr }, { data: os }, S] = await Promise.all([
    supabase.from('profiles').select('full_name,phone,address_line1,city,region,postal_code,country').eq('id', s.user.id).maybeSingle(),
    supabase.from('orders').select('order_number,status,payment_status,payment_method,total,currency,created_at,tracking_number,customer_notes,order_items(product_name,quantity)').order('created_at', { ascending: false }),
    setting(['payment_instructions', ...METHODS.map(payKey)]),
  ]);
  const f = pr || {}, F = ['full_name', 'phone', 'address_line1', 'city', 'region', 'postal_code', 'country'];
  el.innerHTML = `<p class="row"><span>Signed in as <b>${esc(s.user.email)}</b></span><button id="out" class="btn sec" type="button">Sign out</button></p>
<h2>My orders</h2>${os?.length ? os.map(o => `<article class="card" style="margin-bottom:12px"><h3>Order #${esc(o.order_number)}</h3><p class="muted">${new Date(o.created_at).toLocaleDateString()}</p><p><span class="badge">${LABEL[o.status]}</span> <span class="badge">${LABEL[o.payment_status]}</span></p><ul>${o.order_items.map(i => `<li>${esc(i.product_name)} x ${i.quantity}</li>`).join('')}</ul><p class="price">${money(o.total, o.currency)}</p>${o.tracking_number ? `<p>Tracking: ${esc(o.tracking_number)}</p>` : ''}${o.payment_status === 'unpaid' && !['rejected', 'cancelled'].includes(o.status) ? payPanel(S, o) : ''}</article>`).join('') : '<p class="muted">No orders yet.</p>'}
<h2>My details</h2><form id="prof" class="card">${F.map(n => `<label for="p_${n}">${n.replace(/_/g, ' ')}</label><input id="p_${n}" name="${n}" value="${esc(f[n])}" maxlength="150">`).join('')}<p><button class="btn dark" type="submit">Save details</button></p><p id="prof-status" role="status"></p></form>`;
  $('#out').onclick = async () => { await supabase.auth.signOut(); location.reload(); };
  $('#prof').onsubmit = async e => {
    e.preventDefault(); const out = {}; F.forEach(n => (out[n] = e.target.elements[n].value.trim() || null));
    const { error } = await supabase.from('profiles').update(out).eq('id', s.user.id), st = $('#prof-status');
    if (error) bad(st, 'Could not save your details.'); else { st.className = 'notice ok'; st.textContent = 'Details saved.'; }
  };
}

async function init() {
  const roots = [...document.querySelectorAll('[data-commerce]')]; if (!roots.length) return;
  if (!configured) { roots.forEach(el => (el.innerHTML = '<p class="notice">Supabase is not configured (see README).</p>')); return; }
  const { data: s } = await supabase.from('site_settings').select('setting_value').eq('setting_key', 'currency_code').maybeSingle();
  if (/^[A-Za-z]{3}$/.test(s?.setting_value || '')) cur = s.setting_value.toUpperCase();
  await Promise.all(roots.map(el => ({ cart: cartPage, checkout: checkoutPage, account: accountPage }[el.dataset.commerce])(el)));
}
init();
