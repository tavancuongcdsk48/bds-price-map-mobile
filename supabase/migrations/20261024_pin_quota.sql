-- =============================================================================
-- 20261024_pin_quota.sql — Hạn mức ghim theo từng user
--
-- Triết lý: hạn mức KHÔNG phải bức tường, mà là CÁI THANG.
--   GHIM MIỄN PHÍ — không bao giờ bán hạn mức, không có gói VIP, không có ví.
--   Hạn mức chỉ để chống spam và luôn MỞ RỘNG BẰNG XÁC THỰC, không bằng tiền:
--     3 ghim (chưa xác thực) -> 10 (đã xác thực SĐT) -> 20 (có 1 ghim kèm ảnh sổ đỏ)
--     -> 50 (uy tín cao) -> 999 (admin/CTV).
--   Đây chính là chỗ đối thủ không theo được: họ bán lượt xem và hạn mức tin đăng.
--
-- Hai lớp chặn khác nhau, đừng nhầm:
--   *Hạn mức* (quota)  : số ghim ĐANG SỐNG cùng lúc. Xoá/ bán xong -> trả lại chỗ.
--   *Nhịp độ* (burst)  : số ghim TẠO MỚI trong 24h. Chặn kiểu tạo rồi xoá liên tục.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Cột trên profiles
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pin_quota_override int;   -- admin cấp tay

COMMENT ON COLUMN public.profiles.pin_quota_override IS
  'NULL = dùng bậc tự động theo độ tin cậy. Admin đặt số để cấp riêng (môi giới/CTV).';

-- -----------------------------------------------------------------------------
-- 2. Bậc hạn mức
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pin_quota_limit(p_profile_id uuid)
RETURNS int
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  p public.profiles%ROWTYPE;
  v_verified_pins int;
BEGIN
  SELECT * INTO p FROM public.profiles WHERE id = p_profile_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  IF p.pin_quota_override IS NOT NULL THEN RETURN greatest(0, p.pin_quota_override); END IF;
  IF p.role = 'admin' THEN RETURN 999; END IF;
  IF p.phone_verified_at IS NULL THEN RETURN 3; END IF;   -- chưa xác thực: 3 ghim miễn phí

  -- đã xác thực SĐT: xét thêm bằng chứng và uy tín
  SELECT count(*) INTO v_verified_pins
    FROM public.pins pn
   WHERE pn.user_id = p_profile_id AND pn.evidence_level >= 2;

  IF coalesce(p.trust_score, 10) >= 15 THEN RETURN 50; END IF;   -- người đóng góp tốt
  IF v_verified_pins >= 1 THEN RETURN 20; END IF;                -- đã có ghim kèm ảnh sổ đỏ
  RETURN 10;                                                     -- đã xác thực SĐT
END $$;

-- Số ghim đang chiếm chỗ: active + pending. Ghim sold/hidden quá 30 ngày thì trả lại chỗ.
CREATE OR REPLACE FUNCTION public.pin_quota_used(p_profile_id uuid)
RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT count(*)::int
    FROM public.pins p
   WHERE p.user_id = p_profile_id
     AND (
       p.status IN ('active', 'pending')
       OR (p.status IN ('sold', 'hidden') AND p.updated_at > now() - interval '30 days')
     );
$$;

-- -----------------------------------------------------------------------------
-- 3. Áp hạn mức + nhịp độ ngay ở tầng DB (không tin client)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_enforce_pin_quota()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_limit int; v_used int; v_today int;
BEGIN
  v_limit := public.pin_quota_limit(NEW.user_id);
  v_used  := public.pin_quota_used(NEW.user_id);

  IF v_used >= v_limit THEN
    RAISE EXCEPTION 'pin_quota_exceeded'
      USING HINT = format('Bạn đang dùng %s/%s ghim. Xoá bớt, đánh dấu đã bán, hoặc xác thực thêm để mở thêm hạn mức.',
                          v_used, v_limit),
            ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_today
    FROM public.pins p
   WHERE p.user_id = NEW.user_id
     AND p.created_at > now() - interval '24 hours';

  IF v_today >= 5 THEN
    RAISE EXCEPTION 'pin_rate_limited'
      USING HINT = 'Mỗi tài khoản tạo tối đa 5 ghim trong 24 giờ. Vui lòng thử lại sau.',
            ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_pins_enforce_quota ON public.pins;
CREATE TRIGGER trg_pins_enforce_quota
  BEFORE INSERT ON public.pins
  FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_pin_quota();

-- -----------------------------------------------------------------------------
-- 4. RPC cho app: còn bao nhiêu ghim + mở thêm bằng cách nào
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_pin_quota()
RETURNS TABLE (
  quota int, used int, remaining int, used_24h int,
  phone_verified boolean, next_step text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_uid uuid := auth.uid();
  p public.profiles%ROWTYPE;
  v_quota int; v_used int; v_24h int;
BEGIN
  SELECT * INTO p FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 0, 0, 0, 0, false, 'đăng nhập trước';
    RETURN;
  END IF;

  v_quota := public.pin_quota_limit(v_uid);
  v_used  := public.pin_quota_used(v_uid);
  SELECT count(*)::int INTO v_24h FROM public.pins
   WHERE user_id = v_uid AND created_at > now() - interval '24 hours';

  RETURN QUERY SELECT
    v_quota, v_used, greatest(0, v_quota - v_used), v_24h,
    (p.phone_verified_at IS NOT NULL),
    CASE
      WHEN p.phone_verified_at IS NULL THEN 'Xác thực số điện thoại (miễn phí) để mở 10 ghim'
      WHEN v_quota = 10 THEN 'Thêm ảnh sổ đỏ (che số) cho 1 ghim để mở 20 ghim'
      WHEN v_quota = 20 THEN 'Đóng góp đều và không bị báo sai để mở 50 ghim'
      ELSE 'Duy trì giá đúng để giữ hạn mức cao'
    END;
END $$;

GRANT EXECUTE ON FUNCTION public.my_pin_quota() TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. Xác thực SĐT (hook cho luồng OTP; hiện gọi tay/admin)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_phone_verified(p_profile_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_uid uuid := coalesce(p_profile_id, auth.uid());
BEGIN
  IF auth.uid() IS NOT NULL AND v_uid <> auth.uid()
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'không có quyền';
  END IF;
  UPDATE public.profiles SET phone_verified_at = now(), updated_at = now() WHERE id = v_uid;
  RETURN FOUND;
END $$;
