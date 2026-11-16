// Run: node tests/nav.test.mjs
import { platform, webUrl, androidIntentUrl, iosAppUrl } from '../nav.js';

const q = '408 Spadina Road, Toronto';
const checks = [
  ['Android phone detected', platform('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/131 Mobile') === 'android'],
  ['iPhone detected', platform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari') === 'ios'],
  ['iPad (desktop mode) detected', platform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari', 5) === 'ios'],
  ['Computer -> web', platform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome', 0) === 'other'],
  ['Web URL', webUrl(q) === 'https://www.google.com/maps/dir/?api=1&destination=408%20Spadina%20Road%2C%20Toronto&travelmode=driving&dir_action=navigate'],
  ['Android intent targets Google Maps app', androidIntentUrl(q).includes(';package=com.google.android.apps.maps;')],
  ['Android intent falls back to web URL', decodeURIComponent(androidIntentUrl(q).match(/S\.browser_fallback_url=([^;]+)/)[1]) === webUrl(q)],
  ['Android intent is well formed', /^intent:\/\/www\.google\.com\/maps\/dir\/\?.*#Intent;scheme=https;.*;end$/.test(androidIntentUrl(q))],
  ['iOS app URL', iosAppUrl(q) === 'comgooglemaps://?daddr=408%20Spadina%20Road%2C%20Toronto&directionsmode=driving'],
];
let fail = 0;
for (const [name, ok] of checks) { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); }
console.log(fail ? `\n${fail} failing` : '\nAll passed');
process.exit(fail ? 1 : 0);
