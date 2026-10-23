-- =========================================================================
-- FILE SQL MIGRATION CHO DỰ ÁN: BẢN ĐỒ GIÁ BẤT ĐỘNG SẢN VIỆT NAM (MOBILE APP)
-- Chạy script này trong SQL Editor của trang quản trị Supabase
-- =========================================================================

-- 1. Bật extension tính toán không gian địa lý PostGIS
CREATE EXTENSION IF NOT EXISTS postgis SCHEMA extensions;

-- 2. Bảng hồ sơ cá nhân (Profiles) liên kết với Google Auth
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  display_name TEXT,
  avatar_url TEXT,
  phone TEXT,
  trust_score INT DEFAULT 10,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger tự động tạo hồ sơ profile khi có user đăng nhập Google mới
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', 'Người dùng'),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. Bảng ghim bất động sản (Pins)
CREATE TABLE IF NOT EXISTS public.pins (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  property_type TEXT NOT NULL CHECK (property_type IN ('nha-pho', 'can-ho', 'dat-nen', 'biet-thu')),
  price_vnd BIGINT NOT NULL CHECK (price_vnd > 0),
  area_m2 NUMERIC NOT NULL CHECK (area_m2 > 0),
  price_per_m2 NUMERIC GENERATED ALWAYS AS (ROUND(price_vnd / area_m2)) STORED,
  
  -- Toạ độ công khai (đã làm mờ 50-100m để bảo vệ quyền riêng tư)
  public_geom extensions.geography(Point, 4326) NOT NULL,
  -- Toạ độ chính xác (chỉ chủ ghim hoặc người có thẩm quyền xem)
  exact_geom extensions.geography(Point, 4326) NOT NULL,
  
  address_text TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  contact_zalo TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'pending', 'sold', 'hidden')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chỉ mục không gian (Spatial Index) GIST để truy vấn khung nhìn (viewport) siêu nhanh
CREATE INDEX IF NOT EXISTS pins_public_geom_gist ON public.pins USING gist (public_geom);
CREATE INDEX IF NOT EXISTS pins_active_created ON public.pins (status, created_at DESC);

-- 4. Bảng đa phương tiện (Ảnh & Video 45s)
CREATE TABLE IF NOT EXISTS public.pin_media (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  pin_id UUID REFERENCES public.pins(id) ON DELETE CASCADE NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
  url TEXT NOT NULL,
  thumbnail_url TEXT,
  duration_seconds INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pin_media_pin_id ON public.pin_media(pin_id);

-- 5. Hàm RPC tìm kiếm ghim theo khung nhìn bản đồ (Bounding Box)
CREATE OR REPLACE FUNCTION public.get_pins_in_bounds(
  min_lng DOUBLE PRECISION,
  min_lat DOUBLE PRECISION,
  max_lng DOUBLE PRECISION,
  max_lat DOUBLE PRECISION,
  p_type TEXT DEFAULT NULL,
  has_video_only BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  id UUID,
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
    AND (NOT has_video_only OR EXISTS(SELECT 1 FROM public.pin_media m WHERE m.pin_id = p.id AND m.media_type = 'video'))
  LIMIT 300;
END;
$$;

-- 6. Phân quyền bảo mật (Row Level Security - RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pin_media ENABLE ROW LEVEL SECURITY;

-- Mọi người đều xem được profile công khai & ghim active
CREATE POLICY "Public profiles are viewable by everyone" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Active pins are viewable by everyone" ON public.pins FOR SELECT USING (status = 'active');
CREATE POLICY "Media is viewable by everyone" ON public.pin_media FOR SELECT USING (true);

-- Chỉ user đã đăng nhập mới được tạo ghim
CREATE POLICY "Users can insert their own pins" ON public.pins FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own pins" ON public.pins FOR UPDATE USING (auth.uid() = user_id);
