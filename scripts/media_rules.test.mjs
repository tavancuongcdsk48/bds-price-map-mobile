// Kiểm chứng quy tắc media thuần (không cần thiết bị): node scripts/media_rules.test.mjs
// Node 24 tự bóc type của file .ts nên import trực tiếp từ src/.
import {
  MEDIA_LIMITS,
  clampImages,
  formatBytes,
  maskPhone,
  remainingImageSlots,
  validateVideo,
  videoDurationSeconds,
} from '../src/lib/mediaRules.ts';

let pass = 0;
let fail = 0;

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? '✓' : '✗'} ${name} → ${JSON.stringify(actual)}${ok ? '' : ` (mong đợi ${JSON.stringify(expected)})`}`);
  ok ? pass++ : fail++;
}

check('max ảnh / ghim', MEDIA_LIMITS.maxImages, 8);
check('video tối đa (s)', MEDIA_LIMITS.maxVideoSeconds, 45);
check('video tối đa (byte)', MEDIA_LIMITS.maxVideoBytes, 26214400);
check('ảnh tối đa (byte)', MEDIA_LIMITS.maxImageBytes, 307200);

check('clamp 10 ảnh → 8', clampImages([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).length, 8);
check('clamp giữ nguyên thứ tự', clampImages(['a', 'b', 'c']), ['a', 'b', 'c']);
check('clamp mảng rỗng', clampImages([]), []);

check('slot còn lại khi có 3 ảnh', remainingImageSlots(3), 5);
check('slot còn lại khi đã đủ 8', remainingImageSlots(8), 0);
check('slot không âm', remainingImageSlots(20), 0);

check('formatBytes 300KB', formatBytes(307200), '300 KB');
check('formatBytes 25MB', formatBytes(26214400), '25,0 MB');
check('formatBytes 0', formatBytes(0), '0 KB');

check('video 30s (ms → s)', videoDurationSeconds({ uri: 'x', duration: 30000 }), 30);
check('video 45s ok', validateVideo({ uri: 'x', duration: 45000, fileSize: 20 * 1024 * 1024 }), { ok: true });
check('video 46s bị chặn', validateVideo({ uri: 'x', duration: 46000 }).ok, false);
check('video 30MB bị chặn', validateVideo({ uri: 'x', duration: 20000, fileSize: 30 * 1024 * 1024 }).ok, false);
check('video null bị chặn', validateVideo(null).ok, false);
console.log('   lý do chặn 46s:', validateVideo({ uri: 'x', duration: 46000 }).reason);
console.log('   lý do chặn 30MB:', validateVideo({ uri: 'x', duration: 20000, fileSize: 30 * 1024 * 1024 }).reason);

check('mask 0988123456', maskPhone('0988123456'), '098812****');
check('mask số có dấu cách', maskPhone('098 812 3456'), '098812****');
check('mask số quá ngắn', maskPhone('123'), '••••••');
check('mask rỗng', maskPhone(''), '••••••');

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
