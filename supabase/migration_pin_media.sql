-- ============================================================
-- Ảnh/video cho ghim: bucket lưu trữ + dữ liệu media
-- Chạy: docker exec -i supabase_db_AdIntel.dms psql -U postgres -d postgres < supabase/migration_pin_media.sql
-- ============================================================

-- 1) Bucket công khai cho ảnh/video ghim (25MB mỗi file, chỉ ảnh + video)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'pin-media', 'pin-media', TRUE, 26214400,
  ARRAY['image/jpeg','image/png','image/webp','video/mp4','video/quicktime']
)
ON CONFLICT (id) DO UPDATE
  SET public = TRUE,
      file_size_limit = 26214400,
      allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','video/mp4','video/quicktime'];

-- 2) Quyền: ai cũng xem được, chỉ tài khoản đăng nhập mới tải lên
DROP POLICY IF EXISTS "Public read pin media" ON storage.objects;
CREATE POLICY "Public read pin media" ON storage.objects
  FOR SELECT USING (bucket_id = 'pin-media');

DROP POLICY IF EXISTS "Authenticated upload pin media" ON storage.objects;
CREATE POLICY "Authenticated upload pin media" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'pin-media');

DROP POLICY IF EXISTS "Owner delete pin media objects" ON storage.objects;
CREATE POLICY "Owner delete pin media objects" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'pin-media' AND owner = auth.uid());

-- 2b) Chủ ghim được xoá media của chính mình
DROP POLICY IF EXISTS "Owners can delete media" ON public.pin_media;
CREATE POLICY "Owners can delete media" ON public.pin_media
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pins p WHERE p.id = pin_media.pin_id AND p.user_id = auth.uid()));

-- 3) Hàm lấy media của một ghim (ảnh trước, video sau)
CREATE OR REPLACE FUNCTION public.get_pin_media(p_pin_id UUID)
RETURNS TABLE (
  id UUID,
  media_type TEXT,
  url TEXT,
  thumbnail_url TEXT,
  duration_seconds INTEGER,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id, m.media_type, m.url, m.thumbnail_url, m.duration_seconds, m.created_at
  FROM public.pin_media m
  WHERE m.pin_id = p_pin_id
  ORDER BY (m.media_type = 'video'), m.created_at
  LIMIT 12;
$$;

GRANT EXECUTE ON FUNCTION public.get_pin_media(UUID) TO anon, authenticated;

-- 4) Số lượng media để hiện badge trên thẻ ghim
CREATE OR REPLACE FUNCTION public.get_pin_media_counts(p_pin_ids UUID[])
RETURNS TABLE (pin_id UUID, images BIGINT, videos BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.pin_id,
         count(*) FILTER (WHERE m.media_type = 'image') AS images,
         count(*) FILTER (WHERE m.media_type = 'video') AS videos
  FROM unnest(p_pin_ids) AS p(pin_id)
  LEFT JOIN public.pin_media m ON m.pin_id = p.pin_id
  GROUP BY p.pin_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_pin_media_counts(UUID[]) TO anon, authenticated;
