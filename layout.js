// Turns Tesseract's word positions into separate text regions (columns / boxes on the bill),
// so the address is never mixed with text sitting beside it on the same row.
// Pure function: works in the browser and in Node tests.

function wordsFromData(data) {
  const lines = [];
  for (const b of data?.blocks || [])
    for (const p of b.paragraphs || [])
      for (const l of p.lines || []) {
        const words = (l.words || []).filter((w) => w.text && w.text.trim() && w.bbox);
        if (words.length) lines.push(words);
      }
  return lines;
}

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

// Split each OCR line into segments wherever there is a wide horizontal gap (a column break).
function segmentLines(lines) {
  const segs = [];
  for (const words of lines) {
    const ws = [...words].sort((a, b) => a.bbox.x0 - b.bbox.x0);
    const h = median(ws.map((w) => w.bbox.y1 - w.bbox.y0)) || 10;
    let cur = [ws[0]];
    for (let i = 1; i < ws.length; i++) {
      const gap = ws[i].bbox.x0 - ws[i - 1].bbox.x1;
      if (gap > 1.8 * h) {
        segs.push(cur);
        cur = [];
      }
      cur.push(ws[i]);
    }
    segs.push(cur);
  }
  return segs.map((ws) => ({
    text: ws.map((w) => w.text).join(' '),
    x0: Math.min(...ws.map((w) => w.bbox.x0)),
    x1: Math.max(...ws.map((w) => w.bbox.x1)),
    y0: Math.min(...ws.map((w) => w.bbox.y0)),
    y1: Math.max(...ws.map((w) => w.bbox.y1)),
  }));
}

// A short segment like "Ship To:" or "Deliver to" that labels the text to its right.
const isLabel = (t) => /:\s*$/.test(t) && t.split(/\s+/).length <= 4;

export function regionsFromOcr(data) {
  const segs = segmentLines(wordsFromData(data));
  if (!segs.length) return [];
  const parent = segs.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a, b) => (parent[find(a)] = find(b));

  for (let i = 0; i < segs.length; i++) {
    const a = segs[i];
    const ha = a.y1 - a.y0;
    for (let j = 0; j < segs.length; j++) {
      if (i === j) continue;
      const b = segs[j];
      const hb = b.y1 - b.y0;
      const h = Math.max(ha, hb);
      const xOverlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const vGap = b.y0 - a.y1; // b below a
      // Stacked lines of the same column: overlapping horizontally, close vertically.
      if (vGap > -0.5 * h && vGap < 1.0 * h && b.y0 > a.y0 && (xOverlap > 0 || Math.abs(a.x0 - b.x0) < 2 * h))
        union(i, j);
      // Label to the left of its value on the same row ("Ship To:     Ravi Kumar").
      const sameRow = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.5 * Math.min(ha, hb);
      if (sameRow && b.x0 > a.x1 && isLabel(a.text)) {
        // If text is stacked directly under the label, the value is below it, not to the right.
        const hasBelow = segs.some(
          (c, k) => k !== i && c.y0 > a.y1 - 0.3 * ha && c.y0 - a.y1 < ha &&
            (Math.min(a.x1, c.x1) - Math.max(a.x0, c.x0) > 0 || Math.abs(a.x0 - c.x0) < 2 * ha)
        );
        const between = hasBelow || segs.some(
          (c, k) => k !== i && k !== j && c.x0 > a.x1 && c.x1 < b.x0 &&
            Math.min(a.y1, c.y1) - Math.max(a.y0, c.y0) > 0
        );
        if (!between) union(i, j);
      }
    }
  }

  const groups = new Map();
  segs.forEach((s, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(s);
  });

  return [...groups.values()]
    .map((g) => {
      // Rebuild rows inside the region (a label and its value share a row).
      g.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
      const rows = [];
      for (const s of g) {
        const row = rows.find(
          (r) => Math.min(r.y1, s.y1) - Math.max(r.y0, s.y0) > 0.5 * Math.min(r.y1 - r.y0, s.y1 - s.y0)
        );
        if (row) {
          row.items.push(s);
          row.y0 = Math.min(row.y0, s.y0);
          row.y1 = Math.max(row.y1, s.y1);
        } else rows.push({ y0: s.y0, y1: s.y1, items: [s] });
      }
      rows.sort((a, b) => a.y0 - b.y0);
      const text = rows
        .map((r) => r.items.sort((a, b) => a.x0 - b.x0).map((s) => s.text).join(' '))
        .join('\n');
      return { text, x0: Math.min(...g.map((s) => s.x0)), y0: Math.min(...g.map((s) => s.y0)) };
    })
    .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
}
