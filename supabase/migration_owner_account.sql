-- =========================================================================
-- QUYỀN THEO TÀI KHOẢN GOOGLE: tạo / sửa / xoá ghim đều thuộc về tài khoản
-- Thay cơ chế device_id trước đó bằng auth.uid() của Supabase Auth.
-- =========================================================================

-- 0. Trigger tạo profile khớp cấu trúc bảng profiles hiện có của máy
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 1. Sửa giá: chỉ tài khoản đã đăng nhập và là chủ ghim
DROP FUNCTION IF EXISTS public.update_pin_price(uuid, bigint, text);
CREATE OR REPLACE FUNCTION public.update_pin_price(p_pin_id UUID, p_price BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  affected INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_price IS NULL OR p_price <= 0 THEN
    RAISE EXCEPTION 'invalid_price';
  END IF;

  UPDATE public.pins p
  SET price_vnd = p_price
  WHERE p.id = p_pin_id
    AND p.status = 'active'
    AND p.user_id = auth.uid();

  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected = 0 THEN
    RAISE EXCEPTION 'not_pin_owner';
  END IF;
  RETURN TRUE;
END;
$$;

-- 2. Xoá ghim (ẩn khỏi bản đồ, giữ lịch sử giá): chỉ chủ tài khoản
CREATE OR REPLACE FUNCTION public.delete_pin(p_pin_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  affected INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  UPDATE public.pins p
  SET status = 'hidden'
  WHERE p.id = p_pin_id
    AND p.user_id = auth.uid()
    AND p.status <> 'hidden';

  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected = 0 THEN
    RAISE EXCEPTION 'not_pin_owner';
  END IF;
  RETURN TRUE;
END;
$$;

-- 3. Nhận các ghim demo cũ về tài khoản đang đăng nhập (chạy 1 lần sau khi login)
CREATE OR REPLACE FUNCTION public.claim_demo_pins()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  affected INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.pins
  SET user_id = auth.uid()
  WHERE user_id = '361b7fe7-5586-4239-8329-54f8976b7f07'::uuid
    AND device_id IS DISTINCT FROM 'other-device-demo-0001';

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

-- 4. RPC bản đồ: is_mine tính theo tài khoản
DROP FUNCTION IF EXISTS public.get_pins_in_bounds(double precision, double precision, double precision, double precision, text, text);
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
  created_at TIMESTAMPTZ,
  is_mine BOOLEAN
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id, p.user_id, p.title, p.property_type, p.price_vnd, p.area_m2, p.price_per_m2,
    extensions.ST_Y(p.public_geom::extensions.geometry) AS latitude,
    extensions.ST_X(p.public_geom::extensions.geometry) AS longitude,
    EXISTS(SELECT 1 FROM public.pin_media m WHERE m.pin_id = p.id AND m.media_type = 'video') AS has_video,
    (SELECT m.url FROM public.pin_media m WHERE m.pin_id = p.id AND m.media_type = 'video' LIMIT 1) AS video_url,
    p.contact_phone, p.address_text, p.created_at,
    (auth.uid() IS NOT NULL AND auth.uid() = p.user_id) AS is_mine
  FROM public.pins p
  WHERE p.status = 'active'
    AND p.public_geom && extensions.ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)
    AND (p_type IS NULL OR p.property_type = p_type)
  LIMIT 300;
END;
$$;

-- 5. RPC tìm kiếm: is_mine tính theo tài khoản
DROP FUNCTION IF EXISTS public.search_pins(text, text);
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
    p.id, p.user_id, p.title, p.property_type, p.price_vnd, p.area_m2, p.price_per_m2,
    extensions.ST_Y(p.public_geom::extensions.geometry) AS latitude,
    extensions.ST_X(p.public_geom::extensions.geometry) AS longitude,
    EXISTS(SELECT 1 FROM public.pin_media m WHERE m.pin_id = p.id AND m.media_type = 'video') AS has_video,
    (SELECT m.url FROM public.pin_media m WHERE m.pin_id = p.id AND m.media_type = 'video' LIMIT 1) AS video_url,
    p.contact_phone, p.address_text, p.created_at,
    (auth.uid() IS NOT NULL AND auth.uid() = p.user_id) AS is_mine
  FROM public.pins p
  WHERE p.status = 'active'
    AND (p.title ILIKE '%' || p_q || '%' OR p.address_text ILIKE '%' || p_q || '%')
  ORDER BY p.created_at DESC
  LIMIT 8;
END;
$$;

-- 6. RLS: bỏ mọi quyền ghi trực tiếp của khách — chỉ tài khoản đã đăng nhập, qua RPC kiểm tra chủ sở hữu
DROP POLICY IF EXISTS "Anonymous demo can insert pins" ON public.pins;
DROP POLICY IF EXISTS "Users can insert their own pins" ON public.pins;
CREATE POLICY "Users can insert their own pins" ON public.pins
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own pins" ON public.pins;
CREATE POLICY "Users can update their own pins" ON public.pins
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Anonymous demo can insert media" ON public.pin_media;
CREATE POLICY "Owners can insert media" ON public.pin_media
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.pins p WHERE p.id = pin_media.pin_id AND p.user_id = auth.uid()));
