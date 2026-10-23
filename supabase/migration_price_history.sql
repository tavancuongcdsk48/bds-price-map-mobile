-- =========================================================================
-- LỊCH SỬ GIÁ + TÌM KIẾM ĐỊA ĐIỂM
-- Bảng lịch sử giá theo từng ghim, tự ghi mỗi lần chủ nhà đổi giá.
-- Dữ liệu này là nền cho biểu đồ giá theo tháng/năm về sau.
-- =========================================================================

-- 1. Bảng lịch sử giá
CREATE TABLE IF NOT EXISTS public.pin_price_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  pin_id UUID REFERENCES public.pins(id) ON DELETE CASCADE NOT NULL,
  price_vnd BIGINT NOT NULL CHECK (price_vnd > 0),
  price_per_m2 NUMERIC,
  changed_by UUID,
  source TEXT NOT NULL DEFAULT 'owner_edit' CHECK (source IN ('created', 'owner_edit')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_history_pin
  ON public.pin_price_history (pin_id, created_at DESC);

-- 2. Trigger: ghi lịch sử khi tạo ghim và mỗi lần đổi giá
CREATE OR REPLACE FUNCTION public.log_pin_price()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.pin_price_history (pin_id, price_vnd, price_per_m2, changed_by, source)
  VALUES (
    NEW.id,
    NEW.price_vnd,
    NEW.price_per_m2,
    NEW.user_id,
    CASE WHEN TG_OP = 'INSERT' THEN 'created' ELSE 'owner_edit' END
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_pin_price_history_insert ON public.pins;
CREATE TRIGGER trg_pin_price_history_insert
  AFTER INSERT ON public.pins
  FOR EACH ROW EXECUTE FUNCTION public.log_pin_price();

DROP TRIGGER IF EXISTS trg_pin_price_history_update ON public.pins;
CREATE TRIGGER trg_pin_price_history_update
  AFTER UPDATE OF price_vnd ON public.pins
  FOR EACH ROW
  WHEN (NEW.price_vnd IS DISTINCT FROM OLD.price_vnd)
  EXECUTE FUNCTION public.log_pin_price();

-- 3. RLS: ai cũng đọc được lịch sử giá; chỉ trigger ghi (SECURITY DEFINER)
ALTER TABLE public.pin_price_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Price history is public" ON public.pin_price_history;
CREATE POLICY "Price history is public" ON public.pin_price_history
  FOR SELECT USING (true);

-- 4. Cho khách chưa đăng nhập sửa giá ghim demo (dev)
DROP POLICY IF EXISTS "Anonymous demo can update own pins" ON public.pins;
CREATE POLICY "Anonymous demo can update own pins" ON public.pins
  FOR UPDATE TO anon
  USING (user_id = '361b7fe7-5586-4239-8329-54f8976b7f07'::uuid AND auth.uid() IS NULL)
  WITH CHECK (user_id = '361b7fe7-5586-4239-8329-54f8976b7f07'::uuid AND auth.uid() IS NULL);

-- 5. RPC trả thêm user_id để app biết ghim nào của mình
DROP FUNCTION IF EXISTS public.get_pins_in_bounds(double precision, double precision, double precision, double precision, text, boolean);
CREATE OR REPLACE FUNCTION public.get_pins_in_bounds(
  min_lng DOUBLE PRECISION,
  min_lat DOUBLE PRECISION,
  max_lng DOUBLE PRECISION,
  max_lat DOUBLE PRECISION,
  p_type TEXT DEFAULT NULL
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
  created_at TIMESTAMPTZ
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
    p.created_at
  FROM public.pins p
  WHERE p.status = 'active'
    AND p.public_geom && extensions.ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)
    AND (p_type IS NULL OR p.property_type = p_type)
  LIMIT 300;
END;
$$;

-- 6. RPC tìm ghim theo tên / địa chỉ (thanh tìm kiếm)
DROP FUNCTION IF EXISTS public.search_pins(text);
CREATE OR REPLACE FUNCTION public.search_pins(p_q TEXT)
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
  created_at TIMESTAMPTZ
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
    p.created_at
  FROM public.pins p
  WHERE p.status = 'active'
    AND (p.title ILIKE '%' || p_q || '%' OR p.address_text ILIKE '%' || p_q || '%')
  ORDER BY p.created_at DESC
  LIMIT 8;
END;
$$;

-- 7. Nạp lịch sử giá ban đầu cho các ghim đã có trước migration
INSERT INTO public.pin_price_history (pin_id, price_vnd, price_per_m2, changed_by, source, created_at)
SELECT p.id, p.price_vnd, p.price_per_m2, p.user_id, 'created', p.created_at
FROM public.pins p
WHERE NOT EXISTS (SELECT 1 FROM public.pin_price_history h WHERE h.pin_id = p.id);

-- 8. Tự cập nhật updated_at mỗi khi ghim thay đổi
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pins_touch_updated_at ON public.pins;
CREATE TRIGGER trg_pins_touch_updated_at
  BEFORE UPDATE ON public.pins
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
