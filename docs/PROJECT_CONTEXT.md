# PROJECT CONTEXT — Vũ Trụ Chuyển Nhượng (app mobile)

> File này là nguồn sự thật duy nhất về trạng thái dự án. Agent/session nào vào làm việc
> cũng đọc file này TRƯỚC khi sửa code. Cập nhật file này mỗi khi hạ tầng hoặc hành vi thay đổi.
> Cập nhật lần cuối: 2026-10-24.

## 1. Định danh

| Hạng mục | Giá trị |
|---|---|
| Tên app | Vũ Trụ Chuyển Nhượng |
| Repo code | `C:\Users\PC\projects\bds-price-map-mobile` |
| Repo tài liệu/spec | `C:\Users\PC\projects\bds-price-map\docs` (AGENT_TASK_PLAN.md, PLAN.md, PLAN-v2-web-mobile.md, MOBILE_MEDIA_PLAN.md, RD_FEASIBILITY_REPORT.md) |
| Workspace làm việc | Discord thread `1563407571266703510` (guild CoGlobal / #dms) — thread này là nhà của dự án |
| package name / slug | `com.cuongdms.vutruchuyennhuong` / `vu-tru-chuyen-nhuong` |
| Scheme | `vutruchuyennhuong` |

## 2. Hạ tầng (đã kiểm chứng 2026-10-24)

- **Supabase self-host (Docker) dùng chung cụm của AdIntel.dms**, không phải project cloud:
  - DB: container `supabase_db_AdIntel.dms` (postgres, expose 54322), schema `public` có cả bảng DMS và bảng app.
  - Auth: `supabase_auth_AdIntel.dms`, Storage: `supabase_storage_AdIntel.dms`, REST: `supabase_rest_AdIntel.dms`,
    Kong gateway: `supabase_kong_AdIntel.dms` → **http://localhost:54321** (LAN: http://192.168.2.22:54321).
  - JWT secret dev: `super-secret-jwt-token-with-at-least-32-characters-long` (dùng trong các script verify).
  - Postgres trực tiếp: `docker exec -it supabase_db_AdIntel.dms psql -U postgres -d postgres`.
- **Google OAuth**: bật bằng cách dựng lại riêng container auth với env-file → `scripts/enable_google_oauth.sh`.
  Redirect https lấy từ cloudflared quick tunnel (`C:\Users\PC\bin\cloudflared.exe`), URL hiện tại lưu ở `.tunnel-url`
  (`https://princess-history-crossing-based.trycloudflare.com`). Google từ chối `http://192.168.x.x` nên bắt buộc có tunnel.
  ⚠️ Quick tunnel đổi URL mỗi lần restart → phải cập nhật lại Redirect URL trong Google Console + Supabase Auth.
- **Metro dev server**: đang chạy, `http://localhost:8081/status` → `packager-status:running`.
- **Docker trên máy là binary Windows gốc**: `--env-file`/mount phải dùng path `C:/...`, KHÔNG dùng `/tmp` kiểu MSYS,
  nếu không container tạo mới fail và dịch vụ sụp (đã từng làm mất `supabase_auth_AdIntel.dms`).
- **Không có quyền admin Windows** → không cài dịch vụ hệ thống, không UAC.

## 3. Stack

- Expo **SDK 58** (`expo ~58.0.17`), React Native **0.88**, React 19.3, TypeScript 6.
  (README cũ ghi SDK 54 — đã lệch, tin `package.json`.)
- Bản đồ: `react-native-maps` 1.29.11 — provider Google, **không cần API key khi chạy Expo Go**;
  bản build native cần key thật ở `app.json → android.config.googleMaps.apiKey` (hiện vẫn là placeholder `GOOGLE_MAPS_KEY_PLACEHOLDER`,
  nên APK production sẽ trắng tile bản đồ cho tới khi thay key).
- Auth: Supabase Auth + `expo-auth-session` + `expo-web-browser` + `expo-secure-store`.
- Media: `expo-image-picker` + `expo-video` (ảnh + video ngắn).
- Không dùng Expo Router — toàn bộ UI nằm trong `App.tsx` (single screen + modal), điều hướng bằng state.
- Build APK: GitHub Actions `.github/workflows/build-apk.yml` (Gradle release, không cần tài khoản Expo), cấu hình `eas.json` có sẵn.

## 4. Dữ liệu

Bảng trong `public` thuộc app: `profiles`, `pins`, `pin_price_history`, `pin_media`, `pin_saves`.
Tất cả nằm chung DB với schema DMS (`ad_analyses`, `meta_ad_records`, …) — **đụng bảng nào chỉ sửa bảng đó**.

`pins` (cột chính): `id, user_id → profiles(id), title, description, property_type(nha-pho|can-ho|dat-nen|biet-thu),
price_vnd, area_m2, price_per_m2 (generated), public_geom/exact_geom geography(Point,4326), address_text,
contact_phone, contact_zalo, status(active|pending|sold|hidden), device_id (legacy), created_at, updated_at`.
Index: GiST trên `public_geom`, `(status, created_at desc)`, `device_id`.

RPC chính: `get_pins_in_bounds(min_lng,min_lat,max_lng,max_lat,p_type)`, `search_pins(p_q)`, `get_my_pins()`,
`update_pin_price(p_pin_id,p_price)`, `set_pin_status(p_pin_id,p_status)`, `delete_pin(p_pin_id)`,
`toggle_save_pin(p_pin_id)`, `get_my_saved_pins()`, `set_save_note(p_pin_id,p_note)`,
`get_pin_media(p_pin_id)`, `get_pin_media_counts(p_pin_ids)`, `log_pin_price()`.
Legacy: `claim_legacy_pins(p_device_id)`, `claim_demo_pins()` — **không dùng nữa**.

Storage: bucket công khai `pin-media` (ảnh/video ghim).

RLS: pins — select `status='active'` cho mọi người, insert/update/delete theo `user_id = auth.uid()`;
pin_saves — chỉ chủ sở hữu; profiles — đọc công khai, update chính mình.

## 5. Quy ước quyền (đã chốt, không đổi)

- Ghim/sửa/xoá bám **`auth.uid()` ở tầng DB** (RLS + RPC trả `'not_pin_owner'`), **không dùng `device_id`**.
- **Không tự claim ghim demo khi đăng nhập** — ghim chỉ thuộc tài khoản đã tạo ra nó.
- Toạ độ công khai (`public_geom`) làm mờ 50–100m; toạ độ thật giữ ở `exact_geom`.
- Mọi thay đổi giá ghi thành một mốc trong `pin_price_history` → nguồn của biểu đồ giá.

## 6. Đã hoàn thành (theo git log, mới nhất trước)

1. Tìm kiếm + bánh răng thay hàng nút, bỏ chip lọc ở "Ghim của tôi", tự bắt địa chỉ từ toạ độ (OSM), nút chỉ đường tới ghim.
2. Tab "Ghim của tôi": liệt kê, lọc theo trạng thái, sửa giá, đổi trạng thái, xoá.
3. Tên người đăng dưới tiêu đề + tích xanh theo xác thực tài khoản thật.
4. UI thẻ ghim: 3 ô giá/đơn giá/diện tích, gộp Sửa–Xoá–Lưu 1 dòng, bỏ ảnh placeholder.
5. Thumbnail ảnh/video trong thẻ ghim + viewer full, ghim của mình nổi bật.
6. Biểu đồ lịch sử giá (format `3,3 tỷ`), chỉ vẽ khi có ≥2 mốc.
7. Ghim demo không còn bị claim khi login + badge chủ sở hữu.
8. Lưu ghim theo tài khoản kèm theo dõi đổi giá (`pin_saves`, `toggle_save_pin`, `get_my_saved_pins`, `SavedPinsModal`).
9. Google sign-in bật thật (OAuth client + tunnel), script owner.
10. Ownership theo `auth.uid()`, AuthModal (Google + email fallback), xoá ghim.
11. Tìm kiếm khu vực/dự án/ghim, 4 tab lọc gọn, sửa giá + biểu đồ, đặt ghim bằng tâm ngắm, làm mờ toạ độ.

## 7. Giới hạn media đã chốt (chặn 2 lớp)

| Lớp | Nơi cài | Nội dung |
|---|---|---|
| Client | `src/lib/mediaRules.ts` + `src/lib/imageCompress.ts` | tối đa **8 ảnh**/ghim, nén **WebP ≤ 300KB**, cạnh dài ≤ 1920px; video **≤ 45s** và **≤ 25MB**; chặn/gia hạn trước khi gửi |
| DB | `supabase/migration_media_limits.sql` | trigger `trg_pin_media_limits` → `image_limit_reached`, `video_too_long`; unique index `pin_media_one_video_per_pin` (1 video/ghim); thêm cột `sort_order`, `file_size_bytes` |

Kiểm chứng: `docker exec -i supabase_db_AdIntel.dms psql -U postgres -d postgres < scripts/verify_media_limits.sql`
(8 ảnh 1 câu lệnh OK, ảnh 9 bị chặn, video 2 bị chặn, video 60s bị chặn — tự rollback)
+ `python scripts/verify_pin_media.py` (bước 9–13 kiểm qua REST API thật) + `node scripts/media_rules.test.mjs` (22 case logic).

## 8. Việc còn mở / nợ kỹ thuật

- `app.json` còn `android.config.googleMaps.apiKey` = placeholder → APK thật cần key.
- README đã sửa SDK 58, nhưng vẫn chưa mô tả hết `pin_saves`, `pin_media`, `get_my_pins`.
- Chưa có Cloudflare R2 (plan V2 §2.2): media hiện nằm ở bucket Supabase Storage `pin-media`, không có egress 0đ.
- Chưa sinh thumbnail từ frame giây thứ 2 của video (plan V2 §2.1); chưa có kiểm duyệt AI, chưa có OTP xác thực SĐT, chưa có phân hạng user (khách/thường/verified).
- Tunnel quick đổi URL: cần kịch bản cố định (named tunnel) hoặc script cập nhật redirect tự động.
- Chưa có test tự động cho UI; kiểm chứng hiện dựa vào script Python gọi thẳng REST (xem §9).
- Các script verify hardcode `BASE = http://192.168.2.22:54321` + JWT secret → đổi mạng/IP là phải sửa.
- `App.tsx` 1838 dòng: nên tách màn hình/lọc/thẻ chi tiết khi thêm tính năng lớn.

## 9. Chạy & kiểm chứng

```bash
cd C:/Users/PC/projects/bds-price-map-mobile
npm install
npx expo start --lan          # Metro đang chạy sẵn trên 8081
npx tsc --noEmit              # bắt buộc trước khi báo "xong"
npx expo-doctor               # khi nghi lệch version
```

Kiểm chứng bằng bằng chứng thật (không claim suông):

```bash
python scripts/verify_my_pins.py        # get_my_pins + set_pin_status + chặn đổi ghim người khác
python scripts/verify_owner_account.py  # tên chủ ghim + xác thực tài khoản
python scripts/verify_pin_media.py      # pin_media + get_pin_media_counts
node scripts/media_rules.test.mjs       # 22 case logic giới hạn media + mask SĐT
docker exec -i supabase_db_AdIntel.dms psql -U postgres -d postgres < scripts/verify_media_limits.sql  # trigger giới hạn media (tự rollback)
python scripts/verify_saved_pins.py     # toggle_save_pin + get_my_saved_pins
bash  scripts/enable_google_oauth.sh    # dựng lại container auth với Google provider
```

DB nhanh: `docker exec supabase_db_AdIntel.dms psql -U postgres -d postgres -c "select count(*) from pins;"`
(hiện: 17 pins, 4 users, 3 saves, 4 profiles).

## 10. Giao thức làm việc trong thread này

1. Đọc file này + `git log --oneline -10` trước khi sửa.
2. Sửa nhỏ, commit theo feature (message tiếng Việt không dấu như hiện tại).
3. Xong việc = `npx tsc --noEmit` sạch + một lần kiểm chứng thật (script hoặc psql/curl) đính kèm kết quả.
4. Hạ tầng hoặc quy ước thay đổi → cập nhật lại file này trong cùng commit.
