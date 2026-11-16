// Open turn-by-turn navigation: Google Maps app if installed, otherwise Google Maps in the browser.
// A website cannot list installed apps, so each platform uses the safest available check.

const enc = encodeURIComponent;

// Works everywhere (browser). dir_action=navigate starts navigation right away when it can.
export const webUrl = (q) =>
  `https://www.google.com/maps/dir/?api=1&destination=${enc(q)}&travelmode=driving&dir_action=navigate`;

// Android (Chrome): opens the Google Maps app if installed; if not, Chrome itself
// loads browser_fallback_url. No guessing needed.
export const androidIntentUrl = (q) =>
  `intent://www.google.com/maps/dir/?api=1&destination=${enc(q)}&travelmode=driving&dir_action=navigate` +
  `#Intent;scheme=https;package=com.google.android.apps.maps;S.browser_fallback_url=${enc(webUrl(q))};end`;

// iPhone/iPad: Google Maps app URL scheme.
export const iosAppUrl = (q) => `comgooglemaps://?daddr=${enc(q)}&directionsmode=driving`;

export function platform(ua = navigator.userAgent, touchPoints = navigator.maxTouchPoints || 0) {
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && touchPoints > 1)) return 'ios';
  return 'other';
}

const KEY = 'gmapsApp'; // remembers on iPhone whether the app opened last time: 'yes' | 'no'
const remember = {
  get: () => { try { return localStorage.getItem(KEY); } catch { return null; } },
  set: (v) => { try { localStorage.setItem(KEY, v); } catch {} },
};

export function openNavigation(q) {
  const p = platform();

  if (p === 'android') {
    window.location.href = androidIntentUrl(q);
    return;
  }

  if (p === 'ios') {
    if (remember.get() === 'no') {
      window.location.href = webUrl(q);
      return;
    }
    // Try the app. If the page is still visible ~1.5 s later, the app isn't installed.
    let left = false;
    const onHide = () => {
      if (document.hidden) {
        left = true;
        remember.set('yes');
      }
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    window.location.href = iosAppUrl(q);
    setTimeout(() => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
      if (!left && !document.hidden) {
        remember.set('no');
        window.location.href = webUrl(q);
      }
    }, 1500);
    return;
  }

  window.location.href = webUrl(q);
}
