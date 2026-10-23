-- Cho phép khách chưa đăng nhập đăng ghim dưới hồ sơ demo (dev only)
-- Khi Google OAuth được cấu hình, policy auth.uid() = user_id sẽ áp dụng cho user thật.

DROP POLICY IF EXISTS "Users can insert their own pins" ON public.pins;

-- User đã đăng nhập: chỉ được tạo ghim của chính mình
CREATE POLICY "Users can insert their own pins" ON public.pins
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Khách ẩn danh: chỉ được tạo ghim gắn với hồ sơ demo
CREATE POLICY "Anonymous demo can insert pins" ON public.pins
  FOR INSERT TO anon
  WITH CHECK (user_id = '361b7fe7-5586-4239-8329-54f8976b7f07'::uuid AND auth.uid() IS NULL);

-- Media của ghim demo
DROP POLICY IF EXISTS "Anonymous demo can insert media" ON public.pin_media;
CREATE POLICY "Anonymous demo can insert media" ON public.pin_media
  FOR INSERT TO anon
  WITH CHECK (
    auth.uid() IS NULL
    AND EXISTS (
      SELECT 1 FROM public.pins p
      WHERE p.id = pin_media.pin_id
        AND p.user_id = '361b7fe7-5586-4239-8329-54f8976b7f07'::uuid
    )
  );
