-- ============================================================
-- Tab "Ghim của tôi": liệt kê + đổi trạng thái ghim của chính mình
-- Chạy: docker exec -i supabase_db_AdIntel.dms psql -U postgres -d postgres < supabase/migration_my_pins.sql
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_my_pins()
RETURNS TABLE (
  id UUID,
  title TEXT,
  property_type TEXT,
  price_vnd BIGINT,
  area_m2 NUMERIC,
  price_per_m2 NUMERIC,
  address_text TEXT,
  status TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  images BIGINT,
  videos BIGINT,
  saves_count BIGINT,
  price_changes BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'auth'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id, p.title, p.property_type, p.price_vnd, p.area_m2, p.price_per_m2,
    p.address_text, COALESCE(p.status, 'active'),
    extensions.ST_Y(p.public_geom::extensions.geometry) AS latitude,
    extensions.ST_X(p.public_geom::extensions.geometry) AS longitude,
    (SELECT count(*) FROM public.pin_media m WHERE m.pin_id = p.id AND m.media_type = 'image') AS images,
    (SELECT count(*) FROM public.pin_media m WHERE m.pin_id = p.id AND m.media_type = 'video') AS videos,
    (SELECT count(*) FROM public.pin_saves s WHERE s.pin_id = p.id) AS saves_count,
    (SELECT count(*) FROM public.pin_price_history h WHERE h.pin_id = p.id) AS price_changes,
    p.created_at, p.updated_at
  FROM public.pins p
  WHERE p.user_id = auth.uid()
  ORDER BY (COALESCE(p.status, 'active') = 'active') DESC, p.updated_at DESC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_my_pins() TO authenticated;

-- Đổi trạng thái: active (đang bán) · pending (đang giao dịch) · sold (đã bán) · hidden (đã gỡ)
CREATE OR REPLACE FUNCTION public.set_pin_status(p_pin_id UUID, p_status TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'auth'
AS $function$
DECLARE
  v_owner UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_status NOT IN ('active', 'pending', 'sold', 'hidden') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  SELECT user_id INTO v_owner FROM public.pins WHERE id = p_pin_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'pin_not_found';
  END IF;
  IF v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'not_pin_owner';
  END IF;

  UPDATE public.pins SET status = p_status, updated_at = now() WHERE id = p_pin_id;
  RETURN TRUE;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.set_pin_status(UUID, TEXT) TO authenticated;
