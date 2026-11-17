// Anonymous usage counts sent to GoatCounter (dashboard is private to the account owner).
// Sends only an event name: no photos, no addresses, no cookies.
import { GOATCOUNTER_CODE, COUNT_LOCAL_TESTS } from './config.js';

const queue = [];
let loaded = false;

function flush() {
  if (!window.goatcounter?.count) return;
  while (queue.length) window.goatcounter.count(queue.shift());
}

export function initAnalytics() {
  if (!GOATCOUNTER_CODE || loaded) return;
  loaded = true;
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://gc.zgo.at/count.js';
  s.dataset.goatcounter = `https://${GOATCOUNTER_CODE}.goatcounter.com/count`;
  if (COUNT_LOCAL_TESTS) s.dataset.goatcounterSettings = JSON.stringify({ allow_local: true });
  s.onload = flush;
  document.head.appendChild(s);
}

// name: short id shown in the dashboard, e.g. 'camera-scan'
export function track(name, title) {
  if (!GOATCOUNTER_CODE) return;
  queue.push({ path: name, title: title || name, event: true });
  flush();
}
