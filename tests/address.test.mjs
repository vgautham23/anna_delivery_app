// Run: node tests/address.test.mjs
import { extractAddress } from '../address.js';

const cases = [
  {
    name: 'Indian courier label with Ship To + sender block',
    text: `DELHIVERY
AWB: 1234567890123
Ship To:
Ravi Kumar
Flat 302, Sai Residency
Road No 12, Banjara Hills
Hyderabad, Telangana 500034
Ph: +91 98765 43210
Order ID: 405-1234567
Return Address: ABC Retail Pvt Ltd, Plot 7, Sector 18, Gurugram 122015`,
    expect: ['Banjara Hills', '500034'],
    reject: ['Gurugram', '98765'],
  },
  {
    name: 'US label with sender first, To: second',
    text: `FROM:
ACME WAREHOUSE
1 Industrial Way
Reno NV 89502

TO:
JANE DOE
742 Evergreen Terrace
Springfield, IL 62704
USPS TRACKING # 9400 1000 0000 0000 0000 00`,
    expect: ['742 Evergreen Terrace', '62704'],
    reject: ['Reno', 'Industrial'],
  },
  {
    name: 'No labels, noisy OCR',
    text: `Invoice No: INV-2291   Date: 12/11/2026
~~ |||| ~~
Total Rs. 1,499
Suresh Babu
H.No 4-56, Gandhi Nagar
Near Bus Stand, Guntur
Andhra Pradesh - 522 002
Mob 9876543210`,
    expect: ['Gandhi Nagar', '522 002'],
    reject: ['1,499', 'INV'],
  },
  {
    name: 'Deliver to on same line',
    text: `Deliver to: 221B Baker Street, London NW1 6XE
Weight 1.2kg`,
    expect: ['221B Baker Street', 'NW1 6XE'],
    reject: ['Weight'],
  },
  {
    name: 'Blurry UPS notice (real scan) must not return garbage',
    text: `Eh ih\nVis A tf)\nups Sorry we Missed you.\nWhat now?\n. Biren k % pai : :\npet) ro ame es apc\noar a UPS.com/tra., x OR\nEAEEE nse pi\n0 el try ar ante ne acest ness day,\netre to aps Pic kup location ¢, keep itsecure\n= a ealiremeny, VPs Store`,
    expect: [],
    empty: true,
  },
  {
    name: 'Store receipt: "Address" label, stop before the item list, ignore store address',
    text: `PIZZA PALACE
796 Bloor St West
Toronto, ON M6G 1L5
Tel: 416-555-0199
Order #4521
Customer: John Lee
Address
408 Spadina Road
2 x Large Pepperoni 31.98
1 x Garlic Bread 5.99
Subtotal 37.97`,
    exact: '408 Spadina Road',
  },
  {
    name: '"Address:" on the same line, then phone and items',
    text: `796 Bloor St. W, Toronto ON M6G 1L5
Address: 408 Palmerston Avenue
Phone: 647-555-1234
Qty Item Price
1 Butter Chicken 16.99`,
    exact: '408 Palmerston Avenue',
  },
  {
    name: 'No label: store address ignored even with OCR typo, customer address picked',
    text: `THAI HOUSE
796 Bl0or Street West
Toronto, ON M6G 1L5
Order 4521
Jane Park
55 Harbord Street, Toronto
1 x Pad Thai 14.50`,
    exact: '55 Harbord Street, Toronto',
  },
  {
    name: 'Only the store address on the bill -> nothing',
    text: `PIZZA PALACE\n796 BLOOR ST. W\nToronto, ON M6G 1L5\n2 x Coke 3.00`,
    expect: [],
    empty: true,
  },
  { name: 'Nothing useful', text: `Thank you for shopping\nQty 1\nTotal $20.00`, expect: [], empty: true },
];

let fail = 0;
for (const c of cases) {
  const r = extractAddress(c.text);
  const ok =
    (c.empty ? r.address === '' : r.address !== '') &&
    (c.exact === undefined || r.address === c.exact) &&
    (c.expect || []).every((e) => r.address.includes(e)) &&
    (c.reject || []).every((e) => !r.address.includes(e));
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}\n      -> "${r.address}"  [${r.confidence}, ${r.method}]${r.recipient ? '  recipient: ' + r.recipient : ''}`);
}
console.log(fail ? `\n${fail} failing` : '\nAll passed');
process.exit(fail ? 1 : 0);
