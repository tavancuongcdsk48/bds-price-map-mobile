// Kiểm tra tìm địa điểm bằng Photon (API thật).
// node scripts/place_search.test.mjs
import { searchPlaces } from '../src/services/placeSearch.ts';

let pass = 0;
let fail = 0;
function check(name, ok, info = '') {
  console.log(`${ok ? '✓' : '✗'} ${name}${info ? ' → ' + info : ''}`);
  ok ? pass++ : fail++;
}

const lotte = await searchPlaces('Lotte Center');
const first = lotte[0];
check('Tìm "Lotte Center" có kết quả', lotte.length > 0, `${lotte.length} kết quả`);
check(
  'Kết quả đầu đúng toà Lotte Center Hà Nội',
  !!first && /lotte/i.test(first.label) && Math.abs(first.latitude - 21.0322) < 0.01,
  first ? `${first.label} · ${first.latitude.toFixed(4)},${first.longitude.toFixed(4)}` : 'không có'
);
check('Chỉ trả kết quả ở Việt Nam', lotte.every((r) => r.latitude > 8 && r.latitude < 24 && r.longitude > 102 && r.longitude < 110),
  `${lotte.length} dòng trong khung VN`);

const short = await searchPlaces('a');
check('Từ khoá 1 ký tự trả rỗng (không gọi API)', short.length === 0);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
