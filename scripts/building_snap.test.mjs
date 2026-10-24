// Kiểm chứng "bắt đúng toà" bằng API thật (Overpass/OSM + Photon) và toán thuần.
// node scripts/building_snap.test.mjs
import {
  haversineM,
  pickNearest,
  snapToBuilding,
  SNAP_RADIUS_M,
} from '../src/services/buildingSnap.ts';

let pass = 0;
let fail = 0;
function check(name, ok, info = '') {
  console.log(`${ok ? '✓' : '✗'} ${name}${info ? ' → ' + info : ''}`);
  ok ? pass++ : fail++;
}

// 1) Toán thuần
const hn = { latitude: 21.0278, longitude: 105.8342 };
const hcm = { latitude: 10.7769, longitude: 106.7009 };
const d = haversineM(hn, hcm);
check('haversine Hà Nội–TP.HCM ~1160km', d > 1100000 && d < 1200000, `${Math.round(d / 1000)} km`);

const near = pickNearest(
  { latitude: 21.0, longitude: 105.8 },
  [
    { latitude: 21.0001, longitude: 105.8, name: 'xa' },
    { latitude: 21.00004, longitude: 105.8, name: 'gan' },
    { latitude: 21.01, longitude: 105.8, name: 'ngoai-ban-kinh' },
  ],
  30
);
check('pickNearest chọn toà gần nhất trong bán kính', near?.candidate.name === 'gan', `${near?.candidate.name} @ ${near?.distanceM.toFixed(1)}m`);
check('pickNearest trả null khi mọi toà ở ngoài bán kính',
  pickNearest({ latitude: 21.0, longitude: 105.8 }, [{ latitude: 21.01, longitude: 105.8 }], 30) === null);

// 2) Gọi API thật — thả ghim lệch ~12m khỏi toà Landmark 81 (TP.HCM)
const LM81 = { latitude: 10.7948334, longitude: 106.7217218 };
const offset = { latitude: LM81.latitude + 0.00008, longitude: LM81.longitude + 0.00008 };
const r1 = await snapToBuilding(offset.latitude, offset.longitude);
check('Landmark 81: bắt được toà', r1.snapped, `${r1.source} · ${r1.name || '(không tên)'} · cách điểm thả ${r1.distanceM.toFixed(1)}m`);
check('Landmark 81: dùng dữ liệu toà nhà OSM', ['photon', 'overpass'].includes(r1.source), r1.source);
check('Landmark 81: tên toà đúng', /vincom|landmark/i.test(r1.name || ''), String(r1.name));
check('Landmark 81: toạ độ dóng về tâm toà thật (<10m)', haversineM({ latitude: r1.latitude, longitude: r1.longitude }, LM81) < 10,
  `${haversineM({ latitude: r1.latitude, longitude: r1.longitude }, LM81).toFixed(1)}m`);

// 3) Lotte Center Hà Nội, thả lệch ~9m
const LOTTE = { latitude: 21.0322733, longitude: 105.8126062 };
const r2 = await snapToBuilding(LOTTE.latitude - 0.00006, LOTTE.longitude + 0.00005);
check('Lotte Center: bắt được toà', r2.snapped, `${r2.source} · ${r2.name || '(không tên)'} · cách điểm thả ${r2.distanceM.toFixed(1)}m`);
check('Lotte Center: tên toà đúng', /lotte/i.test(r2.name || ''), String(r2.name));

// 3b) Nhà phố trong ngõ: Photon trả điểm "place house" kèm số nhà
const r2b = await snapToBuilding(21.04345, 105.8238);
check('Nhà phố 166 Thuỵ Khuê: bắt đúng số nhà', r2b.snapped && /166|Thụy Khuê/i.test(r2b.name || ''),
  `${r2b.snapped} · ${r2b.name || '(không tên)'} · ${r2b.distanceM.toFixed(1)}m`);

// 4) Giữa biển không có toà → không bắt bừa
const r3 = await snapToBuilding(0.0, 0.0);
check('Giữa biển: không bắt bừa (snapped=false)', r3.snapped === false && r3.source === 'none', `${r3.latitude},${r3.longitude}`);

// 5) Không kéo ghim quá bán kính
const far = await snapToBuilding(21.5000, 105.9000, SNAP_RADIUS_M);
check('Vị trí không có toà trong 30m: giữ nguyên toạ độ gốc',
  far.snapped === false || far.distanceM <= SNAP_RADIUS_M, `snapped=${far.snapped} · ${far.distanceM.toFixed(1)}m`);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
