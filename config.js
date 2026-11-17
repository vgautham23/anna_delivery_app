// Addresses printed on every bill that are NOT the delivery address
// (for example your store's own address). Add one per line, in any normal spelling:
// "796 Bloor St West" also ignores "796 Bloor Street W.", "796 BLOOR ST. W", etc.
export const IGNORE_ADDRESSES = [
  '796 Bloor St West',
];

// Usage counter (GoatCounter). Put your site code here, e.g. 'annadelivery' for
// https://annadelivery.goatcounter.com — leave empty to turn counting off.
// Only these counts are sent: "camera scan" and "select area". No photos or addresses.
export const GOATCOUNTER_CODE = '';

// Also count uses from your own computer / home Wi-Fi (localhost, 192.168.x.x).
// Handy for testing the dashboard; set to false later to keep your own tests out of the numbers.
export const COUNT_LOCAL_TESTS = true;
