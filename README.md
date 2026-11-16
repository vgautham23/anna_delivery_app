# Delivery Address Scanner (web app)

Take a photo of a delivery bill, get the address, check it on a map, tap ✓, and Google Maps opens with directions.

## Running cost: $0

| Part | How | Cost |
|---|---|---|
| Hosting | Static files (GitHub Pages / Cloudflare Pages / Netlify) | Free |
| OCR | Tesseract.js runs **on the phone** | Free, no limits |
| Address detection | Rules in `address.js` (labels, postal codes, street words) | Free |
| Map preview | Google Maps embed (no API key) | Free |
| Navigation | `google.com/maps/dir/?api=1&destination=…` link | Free |

No server, no database, no API keys. Photos never leave the phone.

## Files
- `index.html`, `styles.css`, `app.js`: UI and flow (camera → OCR → result → navigate)
- `layout.js`: uses word positions to split the bill into separate regions (columns/boxes), so neighbouring text never mixes into the address
- `address.js`: picks the delivery address out of those regions. If the bill has an `Address` label, it reads from there and stops where the item list starts
- `config.js`: **addresses to ignore** (e.g. your store's own address `796 Bloor St West`). Add more, one per line
- `tests/`: `node tests/address.test.mjs && node tests/layout.test.mjs`

## Test on your phone (same Wi-Fi)
```sh
python3 -m http.server 8080
ipconfig getifaddr en0          # e.g. 192.168.1.20
```
Open `http://192.168.1.20:8080` on the phone. The camera button works over plain http
because it uses the phone's standard photo picker.

## Publish for free (GitHub Pages)
1. Create a GitHub repo and push these files.
2. Settings → Pages → Deploy from branch → `main` / root.
3. Open `https://<user>.github.io/<repo>/` on the phone → browser menu → **Add to Home screen**.

Or drag the folder into https://app.netlify.com/drop (no account setup beyond sign-in).

## Tips and limits
- The first scan downloads the OCR engine and English data (about 5 MB). Later scans use the cached copy.
- Fill the frame with the address label, use good light, and hold the phone steady.
- English/Latin script only. If a scan misses, the address box can be edited and the map updates as you type.
- If rule-based detection proves not good enough on your real bills, a paid AI step (a few cents per
  1,000 scans) can be added later as a fallback, only for scans that come back "Please check".

## Usage dashboard (private)
Counts of **camera scans** and **"select area"** uses are sent to [GoatCounter](https://www.goatcounter.com).
Only the event name is sent: no photos, addresses or cookies. The dashboard needs your login, so app users can't see it.

1. Sign up at goatcounter.com and pick a site code (e.g. `annadelivery`).
2. Put it in `config.js`: `export const GOATCOUNTER_CODE = 'annadelivery';`
3. Open `https://annadelivery.goatcounter.com`. Counts appear under **camera-scan** and **select-area**.

Note: GoatCounter's free plan is for non-commercial use. Some ad blockers block it, so counts can be slightly low.
