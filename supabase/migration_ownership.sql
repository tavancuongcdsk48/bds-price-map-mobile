-- =========================================================================
-- QUYỀN SỬA GIÁ: CHỈ NGƯỜI ĐÃ GHIM MỚI ĐƯỢC SỬA
-- Định danh theo thiết bị (device_id) cho khách chưa đăng nhập Google.
-- Khi bật Google OAuth, auth.uid() = user_id cũng được tính là chủ ghim.
-- =========================================================================

-- 1. Gắn định danh thiết bị cho từng ghim
ALTER TABLE public.pins ADD COLUMN IF NOT EXISTS device_id TEXT;
CREATE INDEX IF NOT EXISTS idx_pins_device_id ON public.pins (device_id);

-- 2. Bỏ quyền UPDATE trực tiếp của khách ẩn danh — sửa giá phải đi qua hàm kiểm tra chủ sở hữu
DROP POLICY IF EXISTS "Anonymous demo can update own pins" ON public.pins;

-- 3. Hàm sửa giá: chỉ chạy khi đúng thiết bị đã ghim (hoặc đúng tài khoản đã đăng nhập)
CREATE OR REPLACE FUNCTION public.update_pin_price(
  p_pin_id UUID,
  p_price BIGINT,
  p_device_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  affected INT;
BEGIN
  IF p_price IS NULL OR p_price <= 0 THEN
    RAISE EXCEPTION 'invalid_price';
  END IF;

  UPDATE public.pins p
  SET price_vnd = p_price
  WHERE p.id = p_pin_id
    AND p.status = 'active'
    AND (
      (p.device_id IS NOT NULL AND p.device_id = p_device_id)
      OR (auth.uid() IS NOT NULL AND auth.uid() = p.user_id)
    );

  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected = 0 THEN
    RAISE EXCEPTION 'not_pin_owner';
  END IF;

  RETURN TRUE;
END;
$$;

-- 4. Nhận các ghim cũ chưa có device_id về thiết bị hiện tại (chỉ ghim của hồ sơ demo)
CREATE OR REPLACE FUNCTION public.claim_legacy_pins(p_device_id TEXT)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  affected INT;
BEGIN
  IF p_device_id IS NULL OR length(p_device_id) < 8 THEN
    RETURN 0;
  END IF;

  UPDATE public.pins
  SET device_id = p_device_id
  WHERE device_id IS NULL
    AND user_id = '361b7fe7-5586-4239-8329-54f8976b7f07'::uuid;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

-- 5. RPC bản đồ: trả thêm cờ is_mine, không lộ device_id của người khác
DROP FUNCTION IF EXISTS public.get_pins_in_bounds(double precision, double precision, double precision, double precision, text);
CREATE OR REPLACE FUNCTION public.get_pins_in_bounds(
  min_lng DOUBLE PRECISION,
  min_lat DOUBLE PRECISION,
  max_lng DOUBLE PRECISION,
  max_lat DOUBLE PRECISION,
  p_type TEXT DEFAULT NULL,
  p_device_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  title TEXT,
  property_type TEXT,
  price_vnd BIGINT,
  area_m2 NUMERIC,
  price_per_m2 NUMERIC,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  has_video BOOLEAN,
  video_url TEXT,
  contact_phone TEXT,
  address_text TEXT,
  created_at TIMESTAMPTZ,
  is_mine BOOLEAN
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.user_id,
    p.title,
    p.property_type,
    p.price_vnd,
    p.area_m2,
    p.price_per_m2,
    extensions.ST_Y(p.public_geom::extensions.geometry) AS latitude,
    extensions.ST_X(p.public_geom::extensions.geometry) AS longitude,
    EXISTS(SELECT 1 FROM public.pin_media m WHERE m.pin_id = p.id AND m.media_type = 'video') AS has_video,
    (SELECT m.url FROM public.pin_media m WHERE m.pin_id = p.id AND m.media_type = 'video' LIMIT 1) AS video_url,
    p.contact_phone,
    p.address_text,
    p.created_at,
    (
      (p.device_id IS NOT NULL AND p_device_id IS NOT NULL AND p.device_id = p_device_id)
      OR (auth.uid() IS NOT NULL AND auth.uid() = p.user_id)
    ) AS is_mine
  FROM public.pins p
  WHERE p.status = 'active'
    AND p.public_geom && extensions.ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)
    AND (p_type IS NULL OR p.property_type = p_type)
  LIMIT 300;
END;
$$;

-- 6. RPC tìm kiếm: cũng trả cờ is_mine
DROP FUNCTION IF EXISTS public.search_pins(text);
CREATE OR REPLACE FUNCTION public.search_pins(p_q TEXT, p_device_id TEXT DEFAULT NULL)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  title TEXT,
  property_type TEXT,
  price_vnd BIGINT,
  area_m2 NUMERIC,
  price_per_m2 NUMERIC,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  has_video BOOLEAN,
  video_url TEXT,
  contact_phone TEXT,
  address_text TEXT,
  created_at TIMESTAMPTZ,
  is_mine BOOLEAN
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.user_id,
    p.title,
    p.property_type,
    p.price_vnd,
    p.area_m2,
    p.price_per_m2,
    extensions.ST_Y(p.public_geom::extensions.geometry) AS latitude,
    extensions.ST_X(p.public_geom::extensions.geometry) AS longitude,
    EXISTS(SELECT 1 FROM public.pin_media m WHERE m.pin_id = p.id AND m.media_type = 'video') AS has_video,
    (SELECT m.url FROM public.pin_media m WHERE m.pin_id = p.id AND m.media_type = 'video' LIMIT 1) AS video_url,
    p.contact_phone,
    p.address_text,
    p.created_at,
    (
      (p.device_id IS NOT NULL AND p_device_id IS NOT NULL AND p.device_id = p_device_id)
      OR (auth.uid() IS NOT NULL AND auth.uid() = p.user_id)
    ) AS is_mine
  FROM public.pins p
  WHERE p.status = 'active'
    AND (p.title ILIKE '%' || p_q || '%' OR p.address_text ILIKE '%' || p_q || '%')
  ORDER BY p.created_at DESC
  LIMIT 8;
END;
$$;
