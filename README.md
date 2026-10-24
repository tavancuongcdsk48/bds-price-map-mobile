# Vũ Trụ Chuyển Nhượng

Bản đồ giá bất động sản Việt Nam do chính chủ tự ghim. Người dùng mở app là thấy bản đồ quanh mình,
bong bóng giá từng căn, và đăng bán nhà của mình trong 60 giây.

## Tính năng MVP

- Bản đồ toàn quốc + tự động bay về vị trí hiện tại (GPS)
- Ghim giá do chủ nhà tự đăng: giá, diện tích, tự tính đơn giá tr/m², ảnh (tối đa 8, tự nén WebP ≤ 300KB/ảnh), video thực tế ≤ 45s và ≤ 25MB
- Giới hạn media chặn 2 lớp: client (`src/lib/mediaRules.ts`) + trigger DB (`supabase/migration_media_limits.sql`)
- Bộ lọc theo loại hình (nhà phố / căn hộ), lọc ghim có video thật
- Thẻ chi tiết: giá, diện tích, đơn giá/m², nút **Gọi** và **Nhắn Zalo** chủ nhà (khách chưa đăng nhập chỉ thấy số đã ẩn 4 số cuối, bấm vào sẽ được mời đăng nhập)
- Tự đặt ghim chính xác trên bản đồ (không cần đứng tại căn nhà) bằng tâm ngắm
- Làm mờ toạ độ công khai 50–100m để bảo vệ dữ liệu cá nhân; toạ độ chính xác chỉ lưu nội bộ
- Chỉ người đã ghim mới sửa được giá: database kiểm tra `auth.uid()` (RLS + RPC trả `not_pin_owner`), không dùng `device_id`
- Mỗi lần đổi giá được ghi thành một mốc lịch sử, sẵn sàng cho biểu đồ giá theo tháng/năm

## Kiến trúc

| Thành phần | Công nghệ |
|---|---|
| App | Expo SDK 58 + React Native + TypeScript |
| Bản đồ | `react-native-maps` — Apple Maps trên iOS, Google Maps trên Android |
| Backend | Supabase (Postgres + PostGIS + RLS) |
| Truy vấn ghim | RPC `get_pins_in_bounds` dùng `ST_MakeEnvelope` / `ST_Contains` |
| Xác thực | Supabase Auth (Google OAuth qua Custom Tab + SecureStore) |
| Build APK | GitHub Actions (Gradle release, không cần tài khoản Expo) |

## Chạy trên máy

```bash
npm install
npx expo start --lan
```

Mở bằng Expo Go, hoặc quét QR. Yêu cầu điện thoại và máy tính cùng một mạng LAN.

Biến môi trường trong `.env`:

```
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

## Cấu trúc

```
App.tsx                          màn hình bản đồ, bộ lọc, thẻ chi tiết, chế độ đặt ghim
src/components/CreatePinModal.tsx form đăng ghim + ảnh/video + tính giá/m²
src/services/pinService.ts       truy vấn & ghi ghim qua Supabase PostGIS
src/hooks/useGoogleAuth.ts       đăng nhập Google qua Supabase
src/lib/supabase.ts              Supabase client + SecureStore adapter
src/lib/mediaRules.ts            giới hạn media dùng chung (8 ảnh, 45s, 25MB) + mask số điện thoại
src/lib/imageCompress.ts         nén ảnh về WebP ≤ 300KB ngay trên máy
supabase_schema.sql              schema PostGIS, RPC, RLS
supabase/migration_media_limits.sql  trigger + unique index chặn 8 ảnh / 1 video / 45s ở DB
supabase/migration_rls_anon.sql  chính sách cho khách chưa đăng nhập (dev)
.github/workflows/build-apk.yml  build APK + gắn vào GitHub Release
```

## Ghi chú

- Android cần Google Maps API key thật trong `app.json` (`android.config.googleMaps.apiKey`), nếu không tile bản đồ sẽ trống.
- Google OAuth cần Client ID cấu hình trong Supabase Auth; hiện app chạy được ở chế độ khách.
