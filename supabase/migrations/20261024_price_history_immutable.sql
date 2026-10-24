-- =============================================================================
-- 20261024_price_history_immutable.sql
-- Mục tiêu: lịch sử giá phải thuộc về VỊ TRÍ, không thuộc về cái ghim.
--
-- Vấn đề của thiết kế cũ: public.pin_price_history.pin_id -> pins(id) ON DELETE CASCADE
--   => chủ nhà xoá ghim là toàn bộ lịch sử giá của vị trí đó biến mất.
--   => đăng lại cùng vị trí là một "tài sản" mới, lịch sử đứt đoạn.
--
-- Thiết kế mới:
--   1. price_observations  = sổ cái BẤT BIẾN, append-only. Không sửa, không xoá.
--      - ghim bị xoá  -> chỉ ghi thêm 1 dòng 'pin_removed', dữ liệu cũ còn nguyên.
--      - pin_id ON DELETE SET NULL (không cascade).
--      - mỗi dòng neo vào cell (ô lưới ~130m tính từ toạ độ THẬT) + alley_key + loại hình.
--   2. price_index_monthly = ảnh chụp cuối mỗi tháng theo (ô, loại hình):
--      số ghim, trung vị giá/m², p25, p75, min, max.
--      Có carry-forward: tháng không ai đổi giá vẫn có 1 điểm → biểu đồ không bị đứt.
--   3. RPC đọc: get_area_price_history (theo bán kính), get_price_at_location,
--      get_cell_price_history, get_pin_price_timeline.
--
-- Quyền riêng tư: price_observations chứa toạ độ thật + địa chỉ -> KHÔNG có policy
-- SELECT nào. Chỉ đọc được qua RPC SECURITY DEFINER và RPC chỉ trả số liệu tổng hợp,
-- không trả toạ độ.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Hàm phụ trợ
-- -----------------------------------------------------------------------------

-- Ô lưới ~133m (0.0012° vĩ độ). Tính từ toạ độ THẬT để ghim đăng lại ở cùng nhà
-- rơi đúng vào cùng ô (toạ độ công khai đã bị làm mờ nên không dùng được).
CREATE OR REPLACE FUNCTION public.price_cell(geom extensions.geography)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT format('%s_%s',
    round(extensions.ST_Y(geom::extensions.geometry) / 0.0012)::bigint,
    round(extensions.ST_X(geom::extensions.geometry) / 0.0012)::bigint);
$$;

-- Khoá tuyến/ngõ: bỏ dấu, bỏ ký tự lạ, gộp khoảng trắng.
-- "Ngõ 68 Cầu Giấy, Hà Nội" -> "ngo 68 cau giay ha noi"
CREATE OR REPLACE FUNCTION public.alley_key(addr text)
RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT left(regexp_replace(extensions.unaccent(lower(coalesce(addr, ''))), '[^a-z0-9]+', ' ', 'g'), 60);
$$;

-- -----------------------------------------------------------------------------
-- 1. Sổ cái giá bất biến
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.price_observations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- KHÔNG cascade: ghim chết, dòng này sống
  pin_id        uuid REFERENCES public.pins(id) ON DELETE SET NULL,
  owner_id      uuid,                        -- giữ lại kể cả khi tài khoản bị xoá
  property_type text NOT NULL,
  price_vnd     bigint NOT NULL CHECK (price_vnd > 0),
  area_m2       numeric,
  price_per_m2  numeric NOT NULL CHECK (price_per_m2 > 0),
  geom_public   extensions.geography(Point, 4326) NOT NULL,
  geom_exact    extensions.geography(Point, 4326) NOT NULL,
  cell_id       text NOT NULL,
  alley_key     text NOT NULL,
  address_text  text,
  -- created | owner_edit | marked_sold | pin_removed | backfill | seed
  source        text NOT NULL DEFAULT 'unknown',
  observed_at   timestamptz NOT NULL DEFAULT now(),
  month         date NOT NULL DEFAULT (date_trunc('month', now()))::date
);

CREATE INDEX IF NOT EXISTS price_obs_cell_type_time
  ON public.price_observations (cell_id, property_type, observed_at DESC);
CREATE INDEX IF NOT EXISTS price_obs_pin
  ON public.price_observations (pin_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS price_obs_exact_geom
  ON public.price_observations USING gist (geom_exact);
CREATE INDEX IF NOT EXISTS price_obs_alley
  ON public.price_observations (alley_key, property_type, observed_at DESC);

COMMENT ON TABLE public.price_observations IS
  'Sổ cái giá bất biến. Append-only: không UPDATE, không DELETE. Neo vào vị trí (cell/alley), không neo vào ghim.';

-- -----------------------------------------------------------------------------
-- 2. Trigger ghi nhận giá từ pins
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_capture_price_observation()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_source text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_source := 'created';
  ELSIF NEW.status = 'sold' AND OLD.status IS DISTINCT FROM 'sold' THEN
    v_source := 'marked_sold';
  ELSIF NEW.price_vnd IS DISTINCT FROM OLD.price_vnd
     OR NEW.area_m2   IS DISTINCT FROM OLD.area_m2 THEN
    v_source := 'owner_edit';
  ELSE
    RETURN NEW;                                   -- không liên quan tới giá
  END IF;

  INSERT INTO public.price_observations (
    pin_id, owner_id, property_type, price_vnd, area_m2, price_per_m2,
    geom_public, geom_exact, cell_id, alley_key, address_text, source, observed_at, month
  ) VALUES (
    NEW.id, NEW.user_id, NEW.property_type, NEW.price_vnd, NEW.area_m2, NEW.price_per_m2,
    NEW.public_geom, NEW.exact_geom,
    public.price_cell(NEW.exact_geom), public.alley_key(NEW.address_text), NEW.address_text,
    v_source, clock_timestamp(), (date_trunc('month', clock_timestamp()))::date
  );
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.trg_capture_price_on_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Không xoá gì cả: chỉ ghi thêm một mốc "đã gỡ", để biểu đồ biết căn này
  -- treo đến tháng nào. Giá cuối cùng vẫn nằm trong sổ.
  INSERT INTO public.price_observations (
    pin_id, owner_id, property_type, price_vnd, area_m2, price_per_m2,
    geom_public, geom_exact, cell_id, alley_key, address_text, source, observed_at, month
  ) VALUES (
    NULL, OLD.user_id, OLD.property_type, OLD.price_vnd, OLD.area_m2, OLD.price_per_m2,
    OLD.public_geom, OLD.exact_geom,
    public.price_cell(OLD.exact_geom), public.alley_key(OLD.address_text), OLD.address_text,
    'pin_removed', clock_timestamp(), (date_trunc('month', clock_timestamp()))::date
  );
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_capture_price_ins ON public.pins;
CREATE TRIGGER trg_capture_price_ins
  AFTER INSERT ON public.pins
  FOR EACH ROW EXECUTE FUNCTION public.trg_capture_price_observation();

DROP TRIGGER IF EXISTS trg_capture_price_upd ON public.pins;
CREATE TRIGGER trg_capture_price_upd
  AFTER UPDATE ON public.pins
  FOR EACH ROW EXECUTE FUNCTION public.trg_capture_price_observation();

DROP TRIGGER IF EXISTS trg_capture_price_del ON public.pins;
CREATE TRIGGER trg_capture_price_del
  BEFORE DELETE ON public.pins
  FOR EACH ROW EXECUTE FUNCTION public.trg_capture_price_on_delete();

-- Bảng cũ: đổi FK sang SET NULL để không mất dữ liệu lịch sử khi xoá ghim
ALTER TABLE public.pin_price_history ALTER COLUMN pin_id DROP NOT NULL;
ALTER TABLE public.pin_price_history DROP CONSTRAINT IF EXISTS pin_price_history_pin_id_fkey;
ALTER TABLE public.pin_price_history
  ADD CONSTRAINT pin_price_history_pin_id_fkey
  FOREIGN KEY (pin_id) REFERENCES public.pins(id) ON DELETE SET NULL;

-- -----------------------------------------------------------------------------
-- 3. Ảnh chụp theo tháng (carry-forward)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.price_index_monthly (
  cell_id             text        NOT NULL,
  property_type       text        NOT NULL,
  month               date        NOT NULL,
  n_pins              int         NOT NULL,
  median_price_per_m2 numeric,
  p25                 numeric,
  p75                 numeric,
  min_ppm2            numeric,
  max_ppm2            numeric,
  median_price_vnd    numeric,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cell_id, property_type, month)
);

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
           ) AS obs_key
      FROM public.price_observations o
  ),
  snap AS (
    SELECT mo.m AS month, k.cell_id, k.property_type, k.obs_key,
           (array_agg(k.price_per_m2 ORDER BY k.observed_at DESC))[1] AS ppm2,
           (array_agg(k.price_vnd    ORDER BY k.observed_at DESC))[1] AS price_vnd,
           (array_agg(k.source       ORDER BY k.observed_at DESC))[1] AS last_source
      FROM months mo
      JOIN keyed k ON k.observed_at < (mo.m + interval '1 month')
     GROUP BY 1, 2, 3, 4
  )
  INSERT INTO public.price_index_monthly
    (cell_id, property_type, month, n_pins, median_price_per_m2, p25, p75,
     min_ppm2, max_ppm2, median_price_vnd, updated_at)
  SELECT cell_id, property_type, month,
         count(*)::int,
         round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY ppm2)),
         round(percentile_cont(0.25) WITHIN GROUP (ORDER BY ppm2)),
         round(percentile_cont(0.75) WITHIN GROUP (ORDER BY ppm2)),
         min(ppm2), max(ppm2),
         round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY price_vnd)),
         now()
    FROM snap
   WHERE last_source <> 'pin_removed'      -- căn đã gỡ không còn tính vào "đang treo"
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
-- 4. RPC cho app (chỉ trả số tổng hợp, không trả toạ độ)
-- -----------------------------------------------------------------------------

-- 4.1 Chuỗi giá theo tháng của khu vực quanh một điểm.
--     Vẫn trả về dữ liệu của những căn đã bị xoá (miễn là còn trong khung tháng).
CREATE OR REPLACE FUNCTION public.get_area_price_history(
  p_lat      double precision,
  p_lng      double precision,
  p_radius_m int    DEFAULT 400,
  p_type     text   DEFAULT NULL,
  p_months   int    DEFAULT 12
)
RETURNS TABLE (
  month      date,
  n_pins     int,
  median_ppm2 numeric,
  p25        numeric,
  p75        numeric,
  min_ppm2   numeric,
  max_ppm2   numeric
)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
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
           ) AS obs_key
      FROM public.price_observations o
     WHERE (p_type IS NULL OR o.property_type = p_type)
       AND extensions.ST_DWithin(
             o.geom_exact,
             extensions.ST_SetSRID(extensions.ST_MakePoint(p_lng, p_lat), 4326)::extensions.geography,
             p_radius_m)
  ),
  snap AS (
    SELECT mo.m AS month, k.obs_key,
           (array_agg(k.price_per_m2 ORDER BY k.observed_at DESC))[1] AS ppm2,
           (array_agg(k.source       ORDER BY k.observed_at DESC))[1] AS last_source
      FROM months mo
      JOIN keyed k ON k.observed_at < (mo.m + interval '1 month')
     GROUP BY 1, 2
  )
  SELECT month,
         count(*)::int,
         round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY ppm2)),
         round(percentile_cont(0.25) WITHIN GROUP (ORDER BY ppm2)),
         round(percentile_cont(0.75) WITHIN GROUP (ORDER BY ppm2)),
         min(ppm2), max(ppm2)
    FROM snap
   WHERE last_source <> 'pin_removed'
   GROUP BY month
   ORDER BY month;
$$;

-- 4.2 Giá tham khảo hiện tại của khu vực (dùng cho lớp "khoảng lệch giá" sau này)
CREATE OR REPLACE FUNCTION public.get_price_at_location(
  p_lat double precision,
  p_lng double precision,
  p_radius_m int DEFAULT 400,
  p_type text DEFAULT NULL
)
RETURNS TABLE (
  n_pins int,
  median_ppm2 numeric,
  p25 numeric,
  p75 numeric,
  last_observed timestamptz
)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  WITH k AS (
    SELECT DISTINCT ON (t.obs_key) t.price_per_m2, t.observed_at, t.source
      FROM (
        SELECT o.price_per_m2, o.observed_at, o.source,
               coalesce(o.pin_id::text,
                        md5(coalesce(o.owner_id::text, '') || o.cell_id || coalesce(o.address_text, ''))
               ) AS obs_key
          FROM public.price_observations o
         WHERE (p_type IS NULL OR o.property_type = p_type)
           AND extensions.ST_DWithin(
                 o.geom_exact,
                 extensions.ST_SetSRID(extensions.ST_MakePoint(p_lng, p_lat), 4326)::extensions.geography,
                 p_radius_m)
      ) t
     ORDER BY t.obs_key, t.observed_at DESC
  )
  SELECT count(*)::int,
         round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY price_per_m2)),
         round(percentile_cont(0.25) WITHIN GROUP (ORDER BY price_per_m2)),
         round(percentile_cont(0.75) WITHIN GROUP (ORDER BY price_per_m2)),
         max(observed_at)
    FROM k
   WHERE source <> 'pin_removed';
$$;

-- 4.3 Chuỗi giá theo tháng của một ô lưới (~130m) — dùng cho biểu đồ "khu vực này"
CREATE OR REPLACE FUNCTION public.get_cell_price_history(
  p_cell_id text,
  p_type    text DEFAULT NULL,
  p_months  int  DEFAULT 12
)
RETURNS TABLE (month date, n_pins int, median_ppm2 numeric, p25 numeric, p75 numeric)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT month, n_pins, median_price_per_m2, p25, p75
    FROM public.price_index_monthly
   WHERE cell_id = p_cell_id
     AND (p_type IS NULL OR property_type = p_type)
     AND month >= (date_trunc('month', now())::date - ((p_months - 1) || ' month')::interval)
   ORDER BY month;
$$;

-- 4.4 Toàn bộ mốc giá của một ghim (kể cả mốc 'đã gỡ')
CREATE OR REPLACE FUNCTION public.get_pin_price_timeline(p_pin_id uuid)
RETURNS TABLE (
  observed_at timestamptz,
  price_vnd bigint,
  price_per_m2 numeric,
  source text
)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT observed_at, price_vnd, price_per_m2, source
    FROM public.price_observations
   WHERE pin_id = p_pin_id
   ORDER BY observed_at;
$$;

-- -----------------------------------------------------------------------------
-- 5. Bảo mật: sổ cái không đọc trực tiếp được từ client
-- -----------------------------------------------------------------------------
ALTER TABLE public.price_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_index_monthly ENABLE ROW LEVEL SECURITY;
-- KHÔNG tạo policy nào => anon/authenticated không SELECT được; chỉ RPC SECURITY DEFINER.

GRANT EXECUTE ON FUNCTION public.get_area_price_history(double precision, double precision, int, text, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_price_at_location(double precision, double precision, int, text)      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_cell_price_history(text, text, int)                                    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_pin_price_timeline(uuid)                                               TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_price_index_monthly(int)                                           TO service_role;

-- -----------------------------------------------------------------------------
-- 6. Lịch chạy: cập nhật ảnh chụp tháng mỗi ngày 00:20
-- -----------------------------------------------------------------------------
SELECT cron.unschedule('price_index_monthly_refresh')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'price_index_monthly_refresh');

SELECT cron.schedule(
  'price_index_monthly_refresh',
  '20 0 * * *',
  $$SELECT public.refresh_price_index_monthly(36)$$
);
