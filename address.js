// Address extraction from raw OCR text — pure heuristics, runs offline, zero cost.
// Works in the browser (ES module) and in Node (for tests).
import { IGNORE_ADDRESSES } from './config.js';

const POSITIVE_LABEL =
  /\b(ship(?:ping)?\s*to|deliver(?:y)?\s*(?:to|address)|consignee(?:\s*address)?|recipient|receiver|bill(?:ing)?\s*to|customer\s*address|buyer|to)\s*[:\-–]?/i;
// "To" alone is only a label when it starts the line followed by ":" or end of line.
const TO_ONLY = /^\s*to\b\s*[:\-–]?\s*/i;
// "Address", "Delivery address", "Customer address", "Drop-off address" at the start of a line.
const ADDRESS_LABEL = /^\s*(?:delivery\s*|customer\s*|drop[\s-]*off\s*|shipping\s*)?(?:address|addr\.?)\b\s*[:\-–]?\s*/i;

const NEGATIVE_LABEL =
  /\b(from|sender|shipper|return\s*(?:to|address)|if\s*undelivered|seller|sold\s*by|dispatched?\s*from|origin|warehouse|registered\s*office|gstin?|pan\s*no|store|restaurant|merchant|outlet|kitchen)\b/i;

// Start of the item list / order details: the address ends before this.
const ITEM_LINE =
  /^\s*\d+\s*[x×]\s*\S|^\s*[x×]\s*\d+\b|\d+[.,]\d{2}\s*$|^\s*(items?|order\s*(details|summary|items)?|qty|quantity|sub\s*-?\s*total|total|description|(special\s*|delivery\s*)?instructions?|notes?|payment|tip)\b/i;
// Any other "Field:" line (Phone:, Buzzer:, Customer:, …)
const FIELD_LINE = /^\s*[A-Za-z][A-Za-z .#]{1,24}:/;

const POSTAL = [
  /\b[1-9]\d{2}\s?\d{3}\b/, // India PIN (560001 / 560 001)
  /\b\d{5}(?:-\d{4})?\b/, // US ZIP / DE / FR / etc.
  /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/, // UK
  /\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b/, // Canada
  /\b\d{4}\s+[A-Z][a-zA-Z]+/, // 4-digit + city (NL, BE, AT, CH, AU…)
];

const STREET_WORDS =
  /\b(street|st|road|rd|avenue|ave|lane|ln|drive|dr|blvd|boulevard|way|court|ct|place|pl|highway|hwy|nagar|colony|sector|block|floor|flr|flat|apt|apartment|house|h\.?\s?no|d\.?\s?no|door|plot|layout|main|cross|marg|gali|chowk|near|opp|opposite|behind|village|vill|district|dist|taluk|mandal|tehsil|tower|building|bldg|phase|suite|ste|unit|residency|enclave|society|estate|park|circle|square|sq|terrace|terr|crescent|close|alley|parkway|pkwy|trail|bazar|bazaar|market)\b\.?/i;

const REGIONS =
  /\b(andhra\s*pradesh|telangana|karnataka|tamil\s*nadu|kerala|maharashtra|gujarat|rajasthan|delhi|uttar\s*pradesh|madhya\s*pradesh|west\s*bengal|bihar|odisha|punjab|haryana|goa|assam|jharkhand|chhattisgarh|uttarakhand|himachal|india|usa|united\s*states|uk|united\s*kingdom|canada|germany|australia|[A-Z]{2}\s+\d{5})\b/i;

const NOISE =
  /\b(order|invoice|awb|tracking|track|weight|wt|qty|quantity|amount|total|price|cod|prepaid|paid|date|dimensions|barcode|ref|reference|sku|item|product|hsn|tax|gst|courier|service|routing|batch|signature)\b|[₹$€£]|\brs\.?\s?\d/i;

const PHONE_LABELLED = /\b(ph|phone|mob|mobile|tel|cell|contact|mo)\b\.?\s*(no\.?)?\s*[:\-]?\s*[+\d][\d\s\-()]{6,}\d/gi;
const PHONE_RUN = /\+?\d[\d\s\-()]{8,}\d/g;
const EMAIL = /\S+@\S+\.\S+/g;
const URL = /\b(?:https?:\/\/|www\.)\S+/gi;

function stripContact(line) {
  return line
    .replace(PHONE_LABELLED, ' ')
    .replace(EMAIL, ' ')
    .replace(URL, ' ')
    .replace(PHONE_RUN, (m) => (m.replace(/\D/g, '').length >= 10 ? ' ' : m))
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,;:.\-–|]+|[\s,;|\-–]+$/g, '')
    .trim();
}

function normalizeLines(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/[|_~`^{}\[\]<>]/g, ' ').replace(/\s+/g, ' ').trim());
}

function alnumRatio(s) {
  if (!s) return 0;
  const a = (s.match(/[A-Za-z0-9]/g) || []).length;
  return a / s.length;
}

function isJunk(line) {
  if (!line) return true;
  if (line.length < 3) return true;
  if (alnumRatio(line) < 0.5) return true;
  // Long runs with no vowels are usually barcode/OCR garbage
  if (line.length > 6 && !/[aeiou]/i.test(line) && !/\d{4,}/.test(line)) return true;
  return false;
}

const hasPostal = (l) => POSTAL.some((r) => r.test(l));

// ---------- ignore list (e.g. the store's own address) ----------
const ABBR = { street: 'st', west: 'w', east: 'e', north: 'n', south: 's', road: 'rd', avenue: 'ave',
  drive: 'dr', boulevard: 'blvd', lane: 'ln', court: 'ct', place: 'pl', crescent: 'cres', square: 'sq' };
const SHORT = new Set(Object.values(ABBR));
const toks = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).map((t) => ABBR[t] || t);
function within1(a, b) {
  // true if edit distance <= 1 (tolerates one OCR mistake, e.g. "Bl0or")
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
function matchesIgnored(line, ignore) {
  const L = toks(line);
  return ignore.some((addr) => {
    const A = toks(addr);
    const num = A.find((t) => /^\d+[a-z]?$/.test(t));
    const name = A.find((t) => /^[a-z]{3,}$/.test(t) && !SHORT.has(t));
    if (!num || !name) return L.join(' ').includes(A.join(' '));
    const i = L.indexOf(num);
    return i >= 0 && L.slice(i + 1, i + 4).some((t) => t === name || (name.length >= 4 && within1(t, name)));
  });
}
// Blank out ignored address lines plus the city / postal-code lines printed right under them.
function removeIgnored(lines, ignore) {
  if (!ignore || !ignore.length) return lines;
  const out = [...lines];
  for (let i = 0; i < out.length; i++) {
    if (!out[i] || !matchesIgnored(out[i], ignore)) continue;
    out[i] = '';
    for (let k = i + 1; k <= i + 2 && k < out.length; k++) {
      const l = out[k];
      if (!l || /^\s*#?\d/.test(l) || FIELD_LINE.test(l) || ITEM_LINE.test(l) || ADDRESS_LABEL.test(l)) break;
      if (hasPostal(l) || REGIONS.test(l) || (l.split(/\s+/).length <= 4 && !/\d/.test(l) && /,|\b[A-Z]{2}\b/.test(l))) out[k] = '';
      else break;
    }
  }
  return out;
}

// Share of tokens that look like real words/numbers (garbled OCR scores low).
function wordQuality(s) {
  const toks = s.split(/[\s,]+/).filter(Boolean);
  if (!toks.length) return 0;
  const good = toks.filter(
    (t) =>
      /\d/.test(t) && /^[#\w./-]+$/.test(t) || // numbers, 4-56, 221B, H.No
      /^[A-Za-z][A-Za-z.'-]{2,}$/.test(t) && /[aeiouy]/i.test(t) || // words
      /^(st|rd|dr|ln|no|nr|po|ps|nw|ne|sw|se|[A-Z]{2})\.?$/i.test(t) // short address tokens
  ).length;
  return good / toks.length;
}

function lineScore(raw) {
  const l = stripContact(raw);
  if (isJunk(l)) return -3;
  let s = 0;
  if (hasPostal(l)) s += 3;
  if (STREET_WORDS.test(l)) s += 2;
  if (REGIONS.test(l)) s += 2;
  if (/^\s*#?\d+[A-Za-z]?[\s,/-]/.test(l)) s += 1; // starts with a house number
  if (/,/.test(l)) s += 0.5;
  if (NOISE.test(raw)) s -= 3;
  if (ITEM_LINE.test(raw)) s -= 4;
  if (NEGATIVE_LABEL.test(raw)) s -= 4;
  return s;
}

function looksLikeName(l) {
  return (
    !/\d/.test(l) &&
    !STREET_WORDS.test(l) &&
    !REGIONS.test(l) &&
    !/,/.test(l) &&
    /^([A-Z][a-zA-Z.'\-]*\s?){1,4}$/.test(l.trim())
  );
}

// Collect up to `max` address-like lines starting at index i.
function collectBlock(lines, i, firstLineRemainder, max = 6) {
  const out = [];
  if (firstLineRemainder) {
    const r = stripContact(firstLineRemainder);
    if (!isJunk(r)) out.push(r);
  }
  let blankRun = 0;
  for (let j = i; j < lines.length && out.length < max; j++) {
    const raw = lines[j];
    if (!raw) {
      if (out.length && ++blankRun >= 2) break;
      continue;
    }
    blankRun = 0;
    if (NEGATIVE_LABEL.test(raw)) break;
    if (ITEM_LINE.test(raw)) break; // item list starts: address is over
    if (out.length && POSITIVE_LABEL.test(raw) && /:/.test(raw)) break;
    if (out.length && FIELD_LINE.test(raw) && !STREET_WORDS.test(raw) && !hasPostal(raw)) break;
    if (NOISE.test(raw) && !hasPostal(stripContact(raw))) {
      if (out.length) break;
      continue;
    }
    const clean = stripContact(raw);
    if (isJunk(clean)) continue;
    out.push(clean);
    // Stop shortly after the postal code line (allow one trailing region/country line)
    if (hasPostal(clean)) {
      const next = lines[j + 1] && stripContact(lines[j + 1]);
      if (next && REGIONS.test(next) && !hasPostal(next) && next.length < 40) out.push(next);
      break;
    }
  }
  return out;
}

function finalize(block, method, score = 0) {
  let lines = block.filter(Boolean);
  let recipient = '';
  const nameAboveHouseNumber =
    lines.length >= 2 && !/[\d,]/.test(lines[0]) && lines[0].split(/\s+/).length <= 4 &&
    /^\s*#?\d+[A-Za-z]?\b/.test(lines[1]);
  if (nameAboveHouseNumber || (lines.length >= 2 && looksLikeName(lines[0]) && lines.slice(1).some((l) => /\d/.test(l)))) {
    recipient = lines.shift();
  }
  const address = lines
    .join(', ')
    .replace(/\s*,\s*,+/g, ',')
    .replace(/\s+,/g, ',')
    .replace(/,\s*$/, '')
    .trim();
  const hasPin = hasPostal(address);
  const confidence =
    method === 'label' && hasPin ? 'high' : hasPin || method === 'label' ? 'medium' : 'low';
  return { address, recipient, lines, confidence, method, score };
}

export function extractAddress(text, ignore = IGNORE_ADDRESSES) {
  const lines = removeIgnored(normalizeLines(text), ignore);

  // 1) Label-anchored: "Ship to:", "Deliver to", "Consignee", "To:" …
  const candidates = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l || NEGATIVE_LABEL.test(l.split(':')[0])) continue;
    let m = l.match(ADDRESS_LABEL) || l.match(POSITIVE_LABEL);
    let isLabel = false;
    if (m && (m[1] || '').toLowerCase() !== 'to') isLabel = true;
    else if (TO_ONLY.test(l) && (/^\s*to\s*[:\-–]/i.test(l) || /^\s*to\s*$/i.test(l))) {
      m = l.match(TO_ONLY);
      isLabel = true;
    }
    if (!isLabel) continue;
    const rest = l.slice(m.index + m[0].length).replace(/^\s*(address)?\s*[:\-–]?\s*/i, '');
    const block = collectBlock(lines, i + 1, rest);
    if (block.length) {
      const score = block.reduce((s, b) => s + Math.max(0, lineScore(b)), 0);
      candidates.push({ block, score: score + 5, label: true });
    }
  }

  // 2) Fallback: best-scoring window of consecutive lines
  for (let i = 0; i < lines.length; i++) {
    for (let len = 1; len <= 5 && i + len <= lines.length; len++) {
      const win = lines.slice(i, i + len);
      if (win.some((w) => !w)) break;
      const scores = win.map(lineScore);
      if (scores.some((s) => s < -2)) break;
      const last = stripContact(win[win.length - 1]);
      let score = scores.reduce((a, b) => a + b, 0);
      if (hasPostal(last)) score += 2; // addresses usually end with the postal code
      // Look one line above for a recipient name
      const above = i > 0 ? stripContact(lines[i - 1]) : '';
      const block = win.map(stripContact).filter((w) => !isJunk(w));
      if (above && looksLikeName(above) && !NEGATIVE_LABEL.test(lines[i - 1])) block.unshift(above);
      // Penalise windows sitting right under a "From/Sender" label
      for (let k = Math.max(0, i - 3); k < i; k++) if (NEGATIVE_LABEL.test(lines[k])) score -= 4;
      if (block.length) candidates.push({ block, score, fallback: true });
    }
  }

  // A real address needs hard evidence: a postal code, or a house/plot number plus a
  // street word (e.g. "H.No 4-56, Gandhi Nagar"). Garbled OCR text never qualifies.
  const valid = candidates.filter(({ block, label }) => {
    const joined = block.join(', ');
    if (hasPostal(joined)) return wordQuality(joined) >= 0.5;
    // Number and street word must sit on the same line, like a real address line.
    const streetLine = block.some((l) => /\d/.test(l) && STREET_WORDS.test(l));
    const houseNumberUnderLabel = label && block.some((l) => /^\s*#?\d+[A-Za-z]?\b\s+[A-Za-z]/.test(l));
    return (streetLine || houseNumberUnderLabel) && wordQuality(joined) >= 0.6;
  });
  const none = { address: '', recipient: '', lines: [], confidence: 'none', method: 'none', score: 0 };
  if (!valid.length) return none;
  valid.sort((a, b) => !!b.label - !!a.label || b.score - a.score || b.block.length - a.block.length);
  const best = valid[0];
  if (best.score <= 1) return none;
  return finalize(best.block, best.fallback ? 'heuristic' : 'label', best.score);
}

// Pick the address from separate layout regions (see layout.js), so text from
// neighbouring columns on the bill never leaks into the address.
export function extractAddressFromRegions(regions, fullText = '', ignore = IGNORE_ADDRESSES) {
  const results = (regions || [])
    .map((r) => extractAddress(r.text, ignore))
    .filter((r) => r.address);
  const rank = { high: 3, medium: 2, low: 1, none: 0 };
  results.sort(
    (a, b) =>
      (b.method === 'label') - (a.method === 'label') ||
      rank[b.confidence] - rank[a.confidence] ||
      b.score - a.score ||
      a.address.length - b.address.length
  );
  if (results.length) return results[0];
  return extractAddress(fullText, ignore);
}

// Used when the person has boxed the address on the photo themselves: keep every
// readable line (minus phone numbers, emails and OCR garbage) even without a postal code.
export function cleanAddressText(text, ignore = IGNORE_ADDRESSES) {
  const found = extractAddress(text, ignore);
  if (found.address) return found;
  const lines = removeIgnored(normalizeLines(text), ignore)
    .map(stripContact)
    .filter((l) => !isJunk(l) && wordQuality(l) >= 0.5 && !NOISE.test(l) && !ITEM_LINE.test(l));
  const address = lines.join(', ');
  return { address, recipient: '', lines, confidence: address ? 'low' : 'none', method: 'manual', score: 0 };
}
