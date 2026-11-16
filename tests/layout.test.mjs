// Run: node tests/layout.test.mjs
// Simulates Tesseract output (words with positions) for bills with columns side by side.
import { regionsFromOcr } from '../layout.js';
import { extractAddress, extractAddressFromRegions } from '../address.js';

const CW = 10, H = 20, PITCH = 28;
// rows: array of [ [xStart, "text"], ... ] ; each row is one OCR line read straight across the page
function fakeOcr(rows) {
  const lines = rows.map((segs, r) => {
    const words = [];
    for (const [x, t] of segs) {
      let cx = x;
      for (const w of t.split(' ')) {
        words.push({ text: w, bbox: { x0: cx, y0: r * PITCH, x1: cx + w.length * CW, y1: r * PITCH + H } });
        cx += (w.length + 1) * CW;
      }
    }
    return { words };
  });
  const text = rows.map((segs) => segs.map((s) => s[1]).join(' ')).join('\n');
  return { data: { text, blocks: [{ paragraphs: [{ lines }] }] }, text };
}

const cases = [
  {
    name: 'Two columns: address left, invoice details right',
    rows: [
      [[0, 'TAX INVOICE']],
      [],
      [[0, 'Ship To:'], [500, 'Invoice No: INV-88213']],
      [[0, 'Ravi Kumar'], [500, 'Invoice Date: 14-11-2026']],
      [[0, 'Flat 302, Sai Residency'], [500, 'Order ID: 405-1234567']],
      [[0, 'Road No 12, Banjara Hills'], [500, 'Payment: Prepaid']],
      [[0, 'Hyderabad, Telangana 500034'], [500, 'Total Rs 1,499']],
      [[0, 'Ph: 9876543210'], [500, 'Courier: Delhivery']],
    ],
    expect: 'Flat 302, Sai Residency, Road No 12, Banjara Hills, Hyderabad, Telangana 500034',
  },
  {
    name: 'Sender left, recipient right',
    rows: [
      [[0, 'From:'], [520, 'Deliver To:']],
      [[0, 'ABC Retail Pvt Ltd'], [520, 'Priya Sharma']],
      [[0, 'Plot 7, Sector 18'], [520, '12 MG Road, Indiranagar']],
      [[0, 'Gurugram 122015'], [520, 'Bengaluru, Karnataka 560038']],
    ],
    expect: '12 MG Road, Indiranagar, Bengaluru, Karnataka 560038',
  },
  {
    name: 'Label left of value on the same row',
    rows: [
      [[0, 'Consignee:'], [200, 'John Smith'], [600, 'AWB 1234567890']],
      [[200, '742 Evergreen Terrace']],
      [[200, 'Springfield, IL 62704'], [600, 'Weight 2 kg']],
    ],
    expect: '742 Evergreen Terrace, Springfield, IL 62704',
  },
];

let fail = 0;
for (const c of cases) {
  const { data, text } = fakeOcr(c.rows);
  const before = extractAddress(text).address;
  const r = extractAddressFromRegions(regionsFromOcr(data), text);
  const ok = r.address === c.expect;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}\n      before: "${before}"\n      after:  "${r.address}"  [${r.confidence}]`);
}
console.log(fail ? `\n${fail} failing` : '\nAll passed');
process.exit(fail ? 1 : 0);
