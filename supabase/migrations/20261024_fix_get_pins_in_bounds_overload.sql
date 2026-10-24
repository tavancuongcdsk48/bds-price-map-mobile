-- Sửa lỗi "Could not choose the best candidate function" của get_pins_in_bounds.
--
-- Tồn tại 2 overload:
--   (min_lng, min_lat, max_lng, max_lat, p_type)                ← bản cũ
--   (min_lng, min_lat, max_lng, max_lat, p_type, has_video_only) ← bản thêm lọc video
-- Cả hai đều có DEFAULT ở p_type nên lời gọi 5 tham số bị Postgres coi là mơ hồ
-- → RPC lỗi, app không tải được ghim trong khung nhìn.
--
-- Cách sửa: bỏ bản 5 tham số. Bản 6 tham số đã có DEFAULT nên client cũ (gọi 5 tham số)
-- vẫn chạy bình thường, chỉ là resolve duy nhất về bản 6 tham số.

DROP FUNCTION IF EXISTS public.get_pins_in_bounds(
  double precision,
  double precision,
  double precision,
  double precision,
  text
);

-- Đảm bảo bản 6 tham số vẫn còn default cho has_video_only
ALTER FUNCTION public.get_pins_in_bounds(
  double precision,
  double precision,
  double precision,
  double precision,
  text,
  boolean
) SET SCHEMA public;

COMMENT ON FUNCTION public.get_pins_in_bounds(
  double precision,
  double precision,
  double precision,
  double precision,
  text,
  boolean
) IS 'Ghim trong khung nhìn; p_type NULL = tất cả, has_video_only = chỉ ghim có video thật.';
