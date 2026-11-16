import { extractAddressFromRegions, cleanAddressText } from './address.js';
import { regionsFromOcr } from './layout.js';

const $ = (id) => document.getElementById(id);
const screens = ['home', 'processing', 'result'];
const show = (name) => screens.forEach((s) => $(s).classList.toggle('active', s === name));

let workerPromise = null;
let progressCb = () => {};
let photo = null; // full-colour canvas of the last photo (used for "select area")

// Lazily create one reusable OCR worker. Language data (~3 MB) is cached by the
// browser after the first load, so later scans work fast even on slow networks.
function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      while (!window.Tesseract) await new Promise((r) => setTimeout(r, 50));
      return window.Tesseract.createWorker('eng', 1, { logger: (m) => progressCb(m) });
    })();
    workerPromise.catch(() => (workerPromise = null));
  }
  return workerPromise;
}

// ---------- image helpers ----------

async function loadPhoto(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bitmap = await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = URL.createObjectURL(file);
    });
  }
  const MAX = 2400;
  const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bitmap.width * scale);
  c.height = Math.round(bitmap.height * scale);
  c.getContext('2d').drawImage(bitmap, 0, 0, c.width, c.height);
  return c;
}

// Copy a region of the photo, scaled so text is big enough for OCR, as grayscale.
function grayRegion(src, x = 0, y = 0, w = src.width, h = src.height, minWidth = 0, maxSide = 2000) {
  let scale = Math.min(maxSide / Math.max(w, h), 1);
  if (minWidth && w * scale < minWidth) scale = Math.min(minWidth / w, maxSide / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const px = img.data;
  let min = 255, max = 0;
  for (let i = 0; i < px.length; i += 4) {
    const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    px[i] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const range = Math.max(1, max - min);
  for (let i = 0; i < px.length; i += 4) px[i] = px[i + 1] = px[i + 2] = ((px[i] - min) * 255) / range;
  ctx.putImageData(img, 0, 0);
  return c;
}

// Adaptive black/white (Bradley): handles shadows and uneven light on phone photos.
function binarize(gray) {
  const { width: w, height: h } = gray;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(gray, 0, 0);
  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data;
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += px[(y * w + x) * 4];
      integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + row;
    }
  }
  const s = Math.max(8, Math.round(w / 16)) >> 1;
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - s), y1 = Math.min(h - 1, y + s);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - s), x1 = Math.min(w - 1, x + s);
      const count = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum =
        integral[(y1 + 1) * (w + 1) + x1 + 1] - integral[y0 * (w + 1) + x1 + 1] -
        integral[(y1 + 1) * (w + 1) + x0] + integral[y0 * (w + 1) + x0];
      const i = (y * w + x) * 4;
      const v = px[i] * count < sum * 0.85 ? 0 : 255;
      px[i] = px[i + 1] = px[i + 2] = v;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// psm 3 = automatic page layout, 6 = one block of text, 11 = scattered text (forms/notices)
async function ocr(canvas, psm) {
  const worker = await getWorker();
  await worker.setParameters({ tessedit_pageseg_mode: String(psm) });
  const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
  return data;
}

function setProgress(pct, text) {
  $('bar').style.width = `${Math.round(pct)}%`;
  if (text) $('status').textContent = text;
}

// ---------- result screen ----------

const mapEmbed = (q) => `https://maps.google.com/maps?q=${encodeURIComponent(q)}&z=16&output=embed`;
const navUrl = (q) =>
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}&travelmode=driving`;

let mapTimer;
function updateMap() {
  const q = $('addressBox').value.trim();
  $('confirmBtn').disabled = !q;
  if (q) $('notice').hidden = true;
  clearTimeout(mapTimer);
  mapTimer = setTimeout(() => {
    $('map').src = q ? mapEmbed(q) : 'about:blank';
  }, 600);
}

function showResult(r, rawText) {
  $('rawText').textContent = rawText.trim() || '(no text detected — try a sharper, well-lit photo)';
  $('addressBox').value = r.address;
  $('recipient').textContent = r.recipient ? `For: ${r.recipient}` : '';
  const conf = $('conf');
  conf.className = `conf ${r.confidence}`;
  conf.textContent = { high: 'Confident', medium: 'Please check', low: 'Please check', none: 'Not found' }[r.confidence];
  const found = !!r.address;
  $('notice').hidden = found;
  $('notice').textContent =
    'No address found. Drag a box around the address on the photo below, or type it in the box above.';
  $('map').src = 'about:blank';
  show('result');
  setCropMode(!found);
  updateMap();
}

// ---------- scan flow ----------

async function handleFile(file) {
  if (!file) return;
  show('processing');
  $('preview').src = URL.createObjectURL(file);
  setProgress(5, 'Preparing image…');

  try {
    let pass = 1;
    progressCb = (m) => {
      if (m.status === 'recognizing text') {
        const base = pass === 1 ? 30 : 65;
        setProgress(base + m.progress * 35, pass === 1 ? `Reading text… ${Math.round(m.progress * 100)}%` : `Looking more carefully… ${Math.round(m.progress * 100)}%`);
      } else if (m.status && pass === 1) setProgress(10 + (m.progress || 0) * 20, 'Loading text reader (first time only)…');
    };
    const [src] = await Promise.all([loadPhoto(file), getWorker()]);
    photo = src;
    const gray = grayRegion(src);

    // Pass 1: normal page layout.
    let data = await ocr(gray, 3);
    let r = extractAddressFromRegions(regionsFromOcr(data), data.text || '');
    let raw = data.text || '';

    // Pass 2 (only if needed): cleaned black/white image, scattered-text mode.
    if (!r.address) {
      pass = 2;
      const data2 = await ocr(binarize(gray), 11);
      const r2 = extractAddressFromRegions(regionsFromOcr(data2), data2.text || '');
      if (r2.address) {
        r = r2;
        raw = data2.text || '';
      }
    }
    setProgress(100, 'Done');
    showResult(r, raw);
  } catch (err) {
    console.error(err);
    alert('Could not read the photo. Please check your internet connection (needed the first time) and try again.');
    show('home');
  } finally {
    $('fileInput').value = '';
  }
}

// ---------- "select the address on the photo" ----------

let sel = null; // selection in photo pixels {x, y, w, h}

function setCropMode(on) {
  $('cropPanel').hidden = !on;
  $('mapWrap').hidden = on;
  $('selectBtn').textContent = on ? 'Show map' : '✂ Select the address on the photo';
  if (on && photo) {
    const c = $('cropCanvas');
    c.width = photo.width;
    c.height = photo.height;
    c.getContext('2d').drawImage(photo, 0, 0);
    sel = null;
    $('cropBox').hidden = true;
    $('readAreaBtn').disabled = true;
  }
}

function setupCrop() {
  const area = $('cropArea');
  const box = $('cropBox');
  let start = null;
  const pos = (e) => {
    const r = $('cropCanvas').getBoundingClientRect();
    return {
      x: Math.min(Math.max(e.clientX - r.left, 0), r.width),
      y: Math.min(Math.max(e.clientY - r.top, 0), r.height),
      r,
    };
  };
  const draw = (a, b) => {
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    const w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
    Object.assign(box.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    box.hidden = false;
    const k = photo.width / a.r.width;
    sel = { x: x * k, y: y * k, w: w * k, h: h * k };
    $('readAreaBtn').disabled = w < 20 || h < 10;
  };
  area.addEventListener('pointerdown', (e) => {
    if (!photo) return;
    area.setPointerCapture(e.pointerId);
    start = pos(e);
  });
  area.addEventListener('pointermove', (e) => start && draw(start, pos(e)));
  area.addEventListener('pointerup', (e) => {
    if (start) draw(start, pos(e));
    start = null;
  });
}

async function readSelectedArea() {
  if (!sel || !photo) return;
  const btn = $('readAreaBtn');
  btn.disabled = true;
  progressCb = (m) => {
    if (m.status === 'recognizing text') btn.textContent = `Reading… ${Math.round(m.progress * 100)}%`;
  };
  try {
    // Enlarge small selections so letters are big enough to read.
    const gray = grayRegion(photo, sel.x, sel.y, sel.w, sel.h, 1400, 3000);
    let data = await ocr(gray, 6);
    let r = cleanAddressText(data.text || '');
    if (!r.address) {
      data = await ocr(binarize(gray), 6);
      r = cleanAddressText(data.text || '');
    }
    btn.textContent = 'Read selected area';
    if (!r.address) {
      $('notice').hidden = false;
      $('notice').textContent =
        'Still could not read it. The text may be handwritten or blurry — retake a closer, sharper photo, or type the address above.';
      $('rawText').textContent = (data.text || '').trim();
      btn.disabled = false;
      return;
    }
    showResult({ ...r, confidence: r.confidence === 'none' ? 'low' : r.confidence }, data.text || '');
  } catch (err) {
    console.error(err);
    btn.textContent = 'Read selected area';
    btn.disabled = false;
  }
}

// ---------- wiring ----------

$('cameraBtn').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', (e) => handleFile(e.target.files[0]));
$('addressBox').addEventListener('input', updateMap);
$('retryBtn').addEventListener('click', () => {
  show('home');
  $('map').src = 'about:blank';
});
$('confirmBtn').addEventListener('click', () => {
  const q = $('addressBox').value.trim();
  if (q) window.location.href = navUrl(q);
});
$('selectBtn').addEventListener('click', () => setCropMode($('cropPanel').hidden));
$('readAreaBtn').addEventListener('click', readSelectedArea);
setupCrop();

// Warm up the OCR engine in the background so the first scan is quicker.
window.addEventListener('load', () => setTimeout(getWorker, 300));
