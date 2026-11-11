// Live chat (Tawk.to). The widget address lives here only; set CHAT_SRC to '' to switch chat off.
const CHAT_SRC = 'https://embed.tawk.to/6af09c4c8bd7e53c4b3871e2/default';
window.Tawk_API = window.Tawk_API || {};
window.Tawk_LoadStart = new Date();
let ready;

export function loadChat() {
  if (!CHAT_SRC) return Promise.reject(new Error('chat is off'));
  ready ??= new Promise((ok, no) => {
    const s = document.createElement('script');
    s.async = true; s.src = CHAT_SRC; s.charset = 'UTF-8'; s.setAttribute('crossorigin', '*');
    s.onerror = () => { ready = null; no(new Error('chat blocked')); };
    window.Tawk_API.onLoad = ok;
    document.head.appendChild(s);
  });
  return ready;
}

/** Opens the chat window. `info` (order, total, payment) is added to the visitor timeline so staff can see it. */
export async function openChat(info = {}) {
  try {
    await Promise.race([loadChat(), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 8000))]);
    const api = window.Tawk_API;
    if (info.order && api.addEvent) api.addEvent('order-placed', Object.fromEntries(Object.entries(info).filter(([, v]) => v).map(([k, v]) => [k, String(v)])), () => {});
    api.maximize?.();
  } catch { location.href = 'contact.html'; }
}

// Load the widget shortly after the page is ready so it does not slow the first paint.
if (CHAT_SRC) addEventListener('load', () => setTimeout(() => loadChat().catch(() => {}), 1500));
