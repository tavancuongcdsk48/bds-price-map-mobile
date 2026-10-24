-- ============================================================
-- Tên người đăng + xác thực thật cho mỗi ghim
-- Chạy: docker exec -i supabase_db_AdIntel.dms psql -U postgres -d postgres < supabase/migration_pin_owner_info.sql
-- ============================================================

DROP FUNCTION IF EXISTS public.get_pins_in_bounds(double precision, double precision, double precision, double precision, text);
DROP FUNCTION IF EXISTS public.search_pins(text);

CREATE OR REPLACE FUNCTION public.get_pins_in_bounds(
  min_lng DOUBLE PRECISION,
  min_lat DOUBLE PRECISION,
  max_lng DOUBLE PRECISION,
  max_lat DOUBLE PRECISION,
  p_type TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID, user_id UUID, title TEXT, property_type TEXT,
  price_vnd BIGINT, area_m2 NUMERIC, price_per_m2 NUMERIC,
  latitude DOUBLE PRECISION, longitude DOUBLE PRECISION,
  has_video BOOLEAN, video_url TEXT,
  contact_phone TEXT, address_text TEXT, created_at TIMESTAMPTZ,
  is_mine BOOLEAN, is_saved BOOLEAN,
  owner_name TEXT, owner_verified BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'auth'
AS $function$
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
    EXISTS(SELECT 1 FROM public.pin_saves s WHERE s.pin_id = p.id AND s.user_id = auth.uid()) AS is_saved,
    COALESCE(NULLIF(pr.full_name, ''), split_part(pr.email, '@', 1), 'Người dùng') AS owner_name,
    (au.email_confirmed_at IS NOT NULL OR COALESCE(pr.role, 'user') = 'admin') AS owner_verified
  FROM public.pins p
  LEFT JOIN public.profiles pr ON pr.id = p.user_id
  LEFT JOIN auth.users au ON au.id = p.user_id
  WHERE p.status = 'active'
    AND p.public_geom && extensions.ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)
    AND (p_type IS NULL OR p.property_type = p_type)
  LIMIT 300;
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_pins(p_q TEXT)
RETURNS TABLE (
  id UUID, user_id UUID, title TEXT, property_type TEXT,
  price_vnd BIGINT, area_m2 NUMERIC, price_per_m2 NUMERIC,
  latitude DOUBLE PRECISION, longitude DOUBLE PRECISION,
  has_video BOOLEAN, video_url TEXT,
  contact_phone TEXT, address_text TEXT, created_at TIMESTAMPTZ,
  is_mine BOOLEAN, is_saved BOOLEAN,
  owner_name TEXT, owner_verified BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'auth'
AS $function$
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
    EXISTS(SELECT 1 FROM public.pin_saves s WHERE s.pin_id = p.id AND s.user_id = auth.uid()) AS is_saved,
    COALESCE(NULLIF(pr.full_name, ''), split_part(pr.email, '@', 1), 'Người dùng') AS owner_name,
    (au.email_confirmed_at IS NOT NULL OR COALESCE(pr.role, 'user') = 'admin') AS owner_verified
  FROM public.pins p
  LEFT JOIN public.profiles pr ON pr.id = p.user_id
  LEFT JOIN auth.users au ON au.id = p.user_id
  WHERE p.status = 'active'
    AND (p.title ILIKE '%' || p_q || '%' OR p.address_text ILIKE '%' || p_q || '%')
  ORDER BY p.created_at DESC
  LIMIT 8;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_pins_in_bounds(double precision, double precision, double precision, double precision, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_pins(text) TO anon, authenticated;
