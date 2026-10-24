-- =============================================================================
-- 20261024_anticheat.sql — chống đăng giá láo
--
-- Nguyên tắc: KHÔNG cố chứng minh một cái ghim là thật (không có API sổ đỏ).
-- Thay vào đó:
--   1. Làm cho nói dối TỐN KÉM  (bắt bằng chứng, 1 số điện thoại = 1 tài khoản)
--   2. Làm cho nói dối NHÌN THẤY (mức bằng chứng hiển thị công khai)
--   3. Làm cho nói dối VÔ NGHĨA  (trung vị có trọng số + lọc ngoại lai, một cái ghim
--      không thể kéo giá của cả ô lưới)
--   4. Cho người dùng QUYỀN PHỦ ĐỊNH (báo sai 3 người khác nhau -> ẩn ngay)
--
-- Thêm: giá cũ tự mất trọng số. 6 tháng không ai xác nhận thì không còn được coi là
-- "giá hiện tại" nữa (thay vì âm thầm nói dối bằng dữ liệu cũ).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Cột phục vụ chống gian lận trên pins
-- -----------------------------------------------------------------------------
ALTER TABLE public.pins ADD COLUMN IF NOT EXISTS evidence_level   int  NOT NULL DEFAULT 0;   -- 0..3
ALTER TABLE public.pins ADD COLUMN IF NOT EXISTS report_count     int  NOT NULL DEFAULT 0;
ALTER TABLE public.pins ADD COLUMN IF NOT EXISTS last_confirmed_at timestamptz;
ALTER TABLE public.pins ADD COLUMN IF NOT EXISTS shadow_hidden    boolean NOT NULL DEFAULT false;
ALTER TABLE public.pins ADD COLUMN IF NOT EXISTS flag_reason      text;

COMMENT ON COLUMN public.pins.evidence_level IS
  '0=chỉ tự khai, 1=có ảnh, 2=có ảnh sổ đỏ đã che số, 3=chủ đã xác nhận qua OTP';
COMMENT ON COLUMN public.pins.shadow_hidden IS
  'true = không hiện trên bản đồ công khai (ngoại lai hoặc bị 3 người báo sai). Chủ vẫn thấy trong "Ghim của tôi".';

-- -----------------------------------------------------------------------------
-- 2. Báo cáo giá sai
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pin_reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pin_id      uuid NOT NULL REFERENCES public.pins(id) ON DELETE CASCADE,
  reporter_id uuid,
  reason      text NOT NULL DEFAULT 'gia-sai',   -- gia-sai | khong-co-nha | trung-lap | coc
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pin_id, reporter_id)                   -- 1 người chỉ báo 1 lần / ghim
);
CREATE INDEX IF NOT EXISTS pin_reports_pin ON public.pin_reports (pin_id, created_at DESC);

ALTER TABLE public.pin_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reporter sees own reports" ON public.pin_reports;
CREATE POLICY "reporter sees own reports" ON public.pin_reports
  FOR SELECT USING (auth.uid() = reporter_id);

-- -----------------------------------------------------------------------------
-- 3. Trọng số và trung vị có trọng số
-- -----------------------------------------------------------------------------

-- Bằng chứng + độ mới + uy tín tài khoản -> trọng số của một lần quan sát giá.
CREATE OR REPLACE FUNCTION public.price_weight(
  p_evidence int,
  p_observed timestamptz,
  p_trust    int
) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT (1 + greatest(0, least(3, coalesce(p_evidence, 0))))::numeric
       * CASE
           WHEN p_observed > now() - interval '3 months'  THEN 1.0
           WHEN p_observed > now() - interval '6 months'  THEN 0.7
           WHEN p_observed > now() - interval '12 months' THEN 0.4
           ELSE 0.2
         END
       * (0.5 + greatest(0, least(20, coalesce(p_trust, 10))) / 20.0);
$$;

-- Trung vị có trọng số (không phụ thuộc extension nào)
CREATE OR REPLACE FUNCTION public.weighted_median(vals numeric[], wts numeric[])
RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  WITH t AS (
    SELECT v, w, sum(w) OVER (ORDER BY v, w) AS cum, sum(w) OVER () AS tot
      FROM unnest(vals, wts) AS u(v, w)
  )
  SELECT v FROM t WHERE cum >= tot / 2.0 ORDER BY v LIMIT 1;
$$;

-- -----------------------------------------------------------------------------
-- 4. Lọc ngoại lai (robust MAD) ngay khi ghi nhận giá
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.price_is_outlier(p_ppm2 numeric, p_cell text, p_type text)
RETURNS boolean
LANGUAGE plpgsql STABLE AS $$
DECLARE
  n int; med numeric; mad numeric;
BEGIN
  SELECT count(*), percentile_cont(0.5) WITHIN GROUP (ORDER BY price_per_m2)
    INTO n, med
    FROM public.price_observations
   WHERE cell_id = p_cell AND property_type = p_type
     AND observed_at > now() - interval '12 months'
     AND source <> 'pin_removed';

  IF n < 5 OR med IS NULL OR med = 0 THEN
    RETURN false;                     -- chưa đủ mẫu thì không kết luận
  END IF;

  SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY abs(price_per_m2 - med))
    INTO mad
    FROM public.price_observations
   WHERE cell_id = p_cell AND property_type = p_type
     AND observed_at > now() - interval '12 months'
     AND source <> 'pin_removed';

  -- Ngưỡng kép: phải vừa lệch khỏi đám đông (3*MAD) VỪA lệch >50% so với trung vị.
  -- Chỉ dùng MAD thì một ô lưới có giá rất sát nhau sẽ gắn cờ cả giá đúng (dương tính giả).
  IF mad IS NULL OR mad = 0 THEN
    RETURN abs(p_ppm2 - med) / med > 0.6;
  END IF;

  RETURN abs(p_ppm2 - med) > 3 * 1.4826 * mad
     AND abs(p_ppm2 - med) / med > 0.5;
END $$;

-- Gắn cờ ngoại lai vào ghim (không xoá dữ liệu — chỉ ẩn khỏi bản đồ công khai)
CREATE OR REPLACE FUNCTION public.trg_flag_outlier_price()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF public.price_is_outlier(NEW.price_per_m2, public.price_cell(NEW.exact_geom), NEW.property_type) THEN
    UPDATE public.pins
       SET shadow_hidden = true,
           flag_reason = 'ngoai-lai:gia-lech-xa-khu-vuc'
     WHERE id = NEW.id AND shadow_hidden = false;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_flag_outlier_price ON public.pins;
CREATE TRIGGER trg_flag_outlier_price
  AFTER INSERT OR UPDATE OF price_vnd, area_m2 ON public.pins
  FOR EACH ROW EXECUTE FUNCTION public.trg_flag_outlier_price();

-- -----------------------------------------------------------------------------
-- 5. RPC: báo sai + xác nhận lại giá + đặt mức bằng chứng
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_pin_price(p_pin_id uuid, p_reason text DEFAULT 'gia-sai', p_note text DEFAULT NULL)
RETURNS TABLE (reports int, hidden boolean)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_uid uuid := auth.uid(); v_count int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'cần đăng nhập';
  END IF;

  -- không cho tự báo cáo ghim của mình
  IF EXISTS (SELECT 1 FROM public.pins WHERE id = p_pin_id AND user_id = v_uid) THEN
    RAISE EXCEPTION 'không thể báo cáo ghim của chính bạn';
  END IF;

  INSERT INTO public.pin_reports (pin_id, reporter_id, reason, note)
  VALUES (p_pin_id, v_uid, coalesce(p_reason, 'gia-sai'), p_note)
  ON CONFLICT (pin_id, reporter_id) DO NOTHING;

  SELECT count(DISTINCT reporter_id) INTO v_count
    FROM public.pin_reports
   WHERE pin_id = p_pin_id AND created_at > now() - interval '90 days';

  UPDATE public.pins
     SET report_count = v_count,
         shadow_hidden = (v_count >= 3) OR shadow_hidden,
         flag_reason = CASE WHEN v_count >= 3 THEN 'bi-bao-sai-3-lan' ELSE flag_reason END
   WHERE id = p_pin_id;

  RETURN QUERY SELECT v_count, (SELECT shadow_hidden FROM public.pins WHERE id = p_pin_id);
END $$;

-- Chủ ghim xác nhận "giá này vẫn đúng" -> làm mới trọng số theo thời gian
CREATE OR REPLACE FUNCTION public.confirm_pin_price(p_pin_id uuid)
RETURNS TABLE (ok boolean, confirmed_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_uid uuid := auth.uid(); v_price bigint; v_area numeric; v_type text;
BEGIN
  SELECT price_vnd, area_m2, property_type INTO v_price, v_area, v_type
    FROM public.pins WHERE id = p_pin_id AND user_id = v_uid;

  IF v_price IS NULL THEN
    RAISE EXCEPTION 'not_pin_owner';
  END IF;

  UPDATE public.pins SET last_confirmed_at = now(), updated_at = now() WHERE id = p_pin_id;

  INSERT INTO public.price_observations
    (pin_id, owner_id, property_type, price_vnd, area_m2, price_per_m2,
     geom_public, geom_exact, cell_id, alley_key, address_text, source, observed_at, month)
  SELECT p.id, p.user_id, p.property_type, p.price_vnd, p.area_m2, p.price_per_m2,
         p.public_geom, p.exact_geom, public.price_cell(p.exact_geom),
         public.alley_key(p.address_text), p.address_text,
         'confirmed', clock_timestamp(), (date_trunc('month', clock_timestamp()))::date
    FROM public.pins p WHERE p.id = p_pin_id;

  RETURN QUERY SELECT true, now();
END $$;

-- Chủ ghim tự khai mức bằng chứng (ảnh sổ đỏ do admin duyệt tay ở giai đoạn 1)
CREATE OR REPLACE FUNCTION public.set_pin_evidence(p_pin_id uuid, p_level int)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.pins
     SET evidence_level = greatest(0, least(3, p_level))
   WHERE id = p_pin_id AND user_id = auth.uid();
  RETURN FOUND;
END $$;

GRANT EXECUTE ON FUNCTION public.report_pin_price(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_pin_price(uuid)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_pin_evidence(uuid, int)        TO authenticated;

-- -----------------------------------------------------------------------------
-- 6. Chỉ số tháng dùng TRUNG VỊ CÓ TRỌNG SỐ + gắn cờ ghim bị ẩn
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_price_index_monthly(p_months int DEFAULT 36)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_rows int;
BEGIN
  DELETE FROM public.price_index_monthly
   WHERE month >= (date_trunc('month', now())::date - ((p_months - 1) || ' month')::interval);

  WITH months AS (
    SELECT generate_series(
             date_trunc('month', now())::date - ((p_months - 1) || ' month')::interval,
             date_trunc('month', now())::date,
             '1 month')::date AS m
  ),
  keyed AS (
    SELECT o.*,
           coalesce(o.pin_id::text,
                    md5(coalesce(o.owner_id::text, '') || o.cell_id || coalesce(o.address_text, ''))
           ) AS obs_key,
           coalesce(p.evidence_level, 0) AS evidence_level,
           coalesce(pr.trust_score, 10)  AS trust_score,
           coalesce(p.shadow_hidden, false) AS shadow_hidden
      FROM public.price_observations o
      LEFT JOIN public.pins p     ON p.id = o.pin_id
      LEFT JOIN public.profiles pr ON pr.id = o.owner_id
  ),
  snap AS (
    SELECT mo.m AS month, k.cell_id, k.property_type, k.obs_key, k.evidence_level, k.trust_score, k.shadow_hidden,
           (array_agg(k.price_per_m2 ORDER BY k.observed_at DESC))[1] AS ppm2,
           (array_agg(k.price_vnd    ORDER BY k.observed_at DESC))[1] AS price_vnd,
           (array_agg(k.source       ORDER BY k.observed_at DESC))[1] AS last_source,
           (array_agg(k.observed_at  ORDER BY k.observed_at DESC))[1] AS last_at
      FROM months mo
      JOIN keyed k ON k.observed_at < (mo.m + interval '1 month')
     GROUP BY 1, 2, 3, 4, 5, 6, 7
  )
  INSERT INTO public.price_index_monthly
    (cell_id, property_type, month, n_pins, median_price_per_m2, p25, p75,
     min_ppm2, max_ppm2, median_price_vnd, updated_at)
  SELECT cell_id, property_type, month,
         count(*)::int,
         round(public.weighted_median(
                 array_agg(ppm2),
                 array_agg(public.price_weight(evidence_level, last_at, trust_score)))),
         round(percentile_cont(0.25) WITHIN GROUP (ORDER BY ppm2)),
         round(percentile_cont(0.75) WITHIN GROUP (ORDER BY ppm2)),
         min(ppm2), max(ppm2),
         round(percentile_cont(0.5) WITHIN GROUP (ORDER BY price_vnd)),
         now()
    FROM snap
   WHERE last_source <> 'pin_removed'
     AND shadow_hidden = false                 -- ghim bị ẩn không kéo giá khu vực
   GROUP BY 1, 2, 3
  ON CONFLICT (cell_id, property_type, month) DO UPDATE
    SET n_pins = EXCLUDED.n_pins,
        median_price_per_m2 = EXCLUDED.median_price_per_m2,
        p25 = EXCLUDED.p25, p75 = EXCLUDED.p75,
        min_ppm2 = EXCLUDED.min_ppm2, max_ppm2 = EXCLUDED.max_ppm2,
        median_price_vnd = EXCLUDED.median_price_vnd,
        updated_at = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END $$;

-- -----------------------------------------------------------------------------
-- 7. Bản đồ công khai: ẩn ghim bị cờ, trả thêm mức bằng chứng
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_pins_in_bounds(
  min_lng DOUBLE PRECISION,
  min_lat DOUBLE PRECISION,
  max_lng DOUBLE PRECISION,
  max_lat DOUBLE PRECISION,
  p_type TEXT DEFAULT NULL,
  has_video_only BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  id UUID, title TEXT, property_type TEXT, price_vnd BIGINT, area_m2 NUMERIC,
  price_per_m2 NUMERIC, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION,
  has_video BOOLEAN, video_url TEXT, contact_phone TEXT, address_text TEXT,
  created_at TIMESTAMPTZ, evidence_level INT, last_confirmed_at TIMESTAMPTZ
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT p.id, p.title, p.property_type, p.price_vnd, p.area_m2, p.price_per_m2,
         extensions.ST_Y(p.public_geom::extensions.geometry),
         extensions.ST_X(p.public_geom::extensions.geometry),
         EXISTS(SELECT 1 FROM public.pin_media m WHERE m.pin_id = p.id AND m.media_type = 'video'),
         (SELECT m.url FROM public.pin_media m WHERE m.pin_id = p.id AND m.media_type = 'video' LIMIT 1),
         p.contact_phone, p.address_text, p.created_at,
         coalesce(p.evidence_level, 0), p.last_confirmed_at
    FROM public.pins p
   WHERE p.status = 'active'
     AND p.shadow_hidden = false
     AND p.public_geom && extensions.ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)
     AND (p_type IS NULL OR p.property_type = p_type)
     AND (NOT has_video_only OR EXISTS(SELECT 1 FROM public.pin_media m WHERE m.pin_id = p.id AND m.media_type = 'video'))
   LIMIT 300;
END $$;
