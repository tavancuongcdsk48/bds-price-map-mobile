-- ============================================================
-- Lưu ghim (bookmark) + theo dõi biến động giá cho từng người dùng
-- Chạy: docker exec -i supabase_db_AdIntel.dms psql -U postgres -d postgres < supabase/migration_saved_pins.sql
-- ============================================================

-- 1) Bảng lưu ghim: mỗi người dùng đánh dấu một ghim, kèm giá tại thời điểm lưu
CREATE TABLE IF NOT EXISTS public.pin_saves (
  user_id            UUID NOT NULL REFERENCES auth.users(id)   ON DELETE CASCADE,
  pin_id             UUID NOT NULL REFERENCES public.pins(id)  ON DELETE CASCADE,
  saved_price_vnd    BIGINT NOT NULL,                 -- giá lúc bấm lưu, để tính % biến động
  saved_price_per_m2 NUMERIC,
  note               TEXT,                            -- ghi chú riêng: "cần xem sổ đỏ", "chờ giảm giá"…
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, pin_id)
);

CREATE INDEX IF NOT EXISTS idx_pin_saves_user ON public.pin_saves (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pin_saves_pin  ON public.pin_saves (pin_id);

ALTER TABLE public.pin_saves ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own saves"   ON public.pin_saves;
DROP POLICY IF EXISTS "Users insert own saves" ON public.pin_saves;
DROP POLICY IF EXISTS "Users delete own saves" ON public.pin_saves;

CREATE POLICY "Users read own saves" ON public.pin_saves
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own saves" ON public.pin_saves
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own saves" ON public.pin_saves
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

GRANT SELECT, INSERT, DELETE ON public.pin_saves TO authenticated;

-- 2) Bật/tắt lưu ghim, trả về trạng thái sau khi bấm
CREATE OR REPLACE FUNCTION public.toggle_save_pin(p_pin_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_price BIGINT;
  v_ppm   NUMERIC;
  v_saved BOOLEAN;
  v_note  TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT price_vnd, price_per_m2 INTO v_price, v_ppm
  FROM public.pins WHERE id = p_pin_id AND status <> 'hidden';
  IF v_price IS NULL THEN
    RAISE EXCEPTION 'pin_not_found';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.pin_saves WHERE user_id = v_uid AND pin_id = p_pin_id
  ) INTO v_saved;

  IF v_saved THEN
    DELETE FROM public.pin_saves WHERE user_id = v_uid AND pin_id = p_pin_id;
    RETURN jsonb_build_object('saved', false, 'saves_count', (SELECT count(*) FROM public.pin_saves WHERE pin_id = p_pin_id));
  END IF;

  INSERT INTO public.pin_saves (user_id, pin_id, saved_price_vnd, saved_price_per_m2)
  VALUES (v_uid, p_pin_id, v_price, v_ppm)
  ON CONFLICT (user_id, pin_id) DO NOTHING;

  RETURN jsonb_build_object('saved', true, 'saves_count', (SELECT count(*) FROM public.pin_saves WHERE pin_id = p_pin_id));
END;
$$;

GRANT EXECUTE ON FUNCTION public.toggle_save_pin(UUID) TO authenticated;

-- 3) Danh sách ghim tôi đã lưu, kèm biến động giá so với lúc lưu
DROP FUNCTION IF EXISTS public.get_my_saved_pins();
CREATE FUNCTION public.get_my_saved_pins()
RETURNS TABLE (
  pin_id             UUID,
  title              TEXT,
  property_type      TEXT,
  price_vnd          BIGINT,
  saved_price_vnd    BIGINT,
  change_vnd         BIGINT,
  change_percent     NUMERIC,
  area_m2            NUMERIC,
  price_per_m2       NUMERIC,
  latitude           DOUBLE PRECISION,
  longitude          DOUBLE PRECISION,
  address_text       TEXT,
  contact_phone      TEXT,
  pin_status         TEXT,
  price_changes      BIGINT,
  last_change_at     TIMESTAMPTZ,
  saved_at           TIMESTAMPTZ,
  note               TEXT,
  saves_count        BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  RETURN QUERY
  SELECT
    s.pin_id,
    p.title,
    p.property_type,
    p.price_vnd,
    s.saved_price_vnd,
    p.price_vnd - s.saved_price_vnd,
    round((p.price_vnd - s.saved_price_vnd)::numeric * 100.0 / NULLIF(s.saved_price_vnd, 0), 1),
    p.area_m2,
    p.price_per_m2,
    extensions.ST_Y(p.public_geom::extensions.geometry),
    extensions.ST_X(p.public_geom::extensions.geometry),
    p.address_text,
    p.contact_phone,
    p.status,
    (SELECT count(*) FROM public.pin_price_history h WHERE h.pin_id = p.id),
    (SELECT max(h.created_at) FROM public.pin_price_history h WHERE h.pin_id = p.id),
    s.created_at,
    s.note,
    (SELECT count(*) FROM public.pin_saves x WHERE x.pin_id = p.id)
  FROM public.pin_saves s
  JOIN public.pins p ON p.id = s.pin_id
  WHERE s.user_id = auth.uid()
    AND p.status <> 'hidden'
  ORDER BY s.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_saved_pins() TO authenticated;

-- 4) Ghi chú riêng cho một ghim đã lưu
CREATE OR REPLACE FUNCTION public.set_save_note(p_pin_id UUID, p_note TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  UPDATE public.pin_saves SET note = p_note WHERE user_id = v_uid AND pin_id = p_pin_id;
  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_save_note(UUID, TEXT) TO authenticated;

-- 5) Bổ sung is_saved vào 2 hàm bản đồ/tìm kiếm (phải DROP vì đổi kiểu trả về)
DROP FUNCTION IF EXISTS public.get_pins_in_bounds(numeric, numeric, numeric, numeric, text);
DROP FUNCTION IF EXISTS public.get_pins_in_bounds(double precision, double precision, double precision, double precision, text);
CREATE FUNCTION public.get_pins_in_bounds(
  min_lng DOUBLE PRECISION, min_lat DOUBLE PRECISION, max_lng DOUBLE PRECISION, max_lat DOUBLE PRECISION,
  p_type TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID, user_id UUID, title TEXT, property_type TEXT, price_vnd BIGINT, area_m2 NUMERIC,
  price_per_m2 NUMERIC, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION,
  has_video BOOLEAN, video_url TEXT, contact_phone TEXT, address_text TEXT,
  created_at TIMESTAMPTZ, is_mine BOOLEAN, is_saved BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id, p.user_id, p.title, p.property_type, p.price_vnd, p.area_m2, p.price_per_m2,
    extensions.ST_Y(p.public_geom::extensions.geometry) AS latitude,
    extensions.ST_X(p.public_geom::extensions.geometry) AS longitude,
    EXISTS(SELECT 1 FROM public.pin_media m WHERE m.pin_id = p.id AND m.media_type = 'video') AS has_video,
    (SELECT m.url FROM public.pin_media m WHERE m.pin_id = p.id AND m.media_type = 'video' LIMIT 1) AS video_url,
    p.contact_phone, p.address_text, p.created_at,
    (auth.uid() IS NOT NULL AND auth.uid() = p.user_id) AS is_mine,
    EXISTS(SELECT 1 FROM public.pin_saves s WHERE s.pin_id = p.id AND s.user_id = auth.uid()) AS is_saved
  FROM public.pins p
  WHERE p.status = 'active'
    AND p.public_geom && extensions.ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)
    AND (p_type IS NULL OR p.property_type = p_type)
  LIMIT 300;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_pins_in_bounds(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TEXT) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.search_pins(text);
DROP FUNCTION IF EXISTS public.search_pins(text, text);
CREATE FUNCTION public.search_pins(p_q TEXT)
RETURNS TABLE (
  id UUID, user_id UUID, title TEXT, property_type TEXT, price_vnd BIGINT, area_m2 NUMERIC,
  price_per_m2 NUMERIC, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION,
  has_video BOOLEAN, video_url TEXT, contact_phone TEXT, address_text TEXT,
  created_at TIMESTAMPTZ, is_mine BOOLEAN, is_saved BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id, p.user_id, p.title, p.property_type, p.price_vnd, p.area_m2, p.price_per_m2,
    extensions.ST_Y(p.public_geom::extensions.geometry) AS latitude,
    extensions.ST_X(p.public_geom::extensions.geometry) AS longitude,
    EXISTS(SELECT 1 FROM public.pin_media m WHERE m.pin_id = p.id AND m.media_type = 'video') AS has_video,
    (SELECT m.url FROM public.pin_media m WHERE m.pin_id = p.id AND m.media_type = 'video' LIMIT 1) AS video_url,
    p.contact_phone, p.address_text, p.created_at,
    (auth.uid() IS NOT NULL AND auth.uid() = p.user_id) AS is_mine,
    EXISTS(SELECT 1 FROM public.pin_saves s WHERE s.pin_id = p.id AND s.user_id = auth.uid()) AS is_saved
  FROM public.pins p
  WHERE p.status = 'active'
    AND (p.title ILIKE '%' || p_q || '%' OR p.address_text ILIKE '%' || p_q || '%')
  ORDER BY p.created_at DESC
  LIMIT 8;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_pins(TEXT) TO anon, authenticated;
