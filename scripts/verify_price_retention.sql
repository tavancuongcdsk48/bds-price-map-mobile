-- Kiểm chứng: xoá ghim KHÔNG làm mất lịch sử giá của vị trí đó khỏi biểu đồ khu vực / ô lưới.
-- Cách chạy: docker exec -i supabase_db_AdIntel.dms psql -U postgres -d postgres < scripts/verify_price_retention.sql
-- Toàn bộ dữ liệu test tự rollback.
do $$
declare
  uid uuid;
  pid uuid;
  lat double precision := 10.77690;
  lng double precision := 106.70090;
  m2ago date := date_trunc('month', now() - interval '2 months')::date;
  m1ago date := date_trunc('month', now() - interval '1 month')::date;
  mnow  date := date_trunc('month', now())::date;
  cell text;
  n_before int;
  n_after int;
  n_prev int;
  n_now int;
  n_index int;
begin
  select id into uid from public.profiles order by created_at limit 1;
  if uid is null then
    raise notice 'KHONG CO PROFILE DE TEST';
    return;
  end if;

  insert into public.pins (user_id, title, property_type, price_vnd, area_m2, public_geom, exact_geom, address_text, contact_phone)
  values (uid, '[TEST] giu lich su gia', 'nha-pho', 3000000000, 60,
          extensions.ST_SetSRID(extensions.ST_MakePoint(lng, lat), 4326)::extensions.geography,
          extensions.ST_SetSRID(extensions.ST_MakePoint(lng, lat), 4326)::extensions.geography,
          'Test giu lich su gia', '0900000009')
  returning id into pid;

  update public.pins set price_vnd = 3600000000 where id = pid;  -- thêm 1 mốc giá

  -- Đẩy các mốc "đang treo" về 2 tháng trước để mô phỏng lịch sử
  update public.price_observations
     set observed_at = now() - interval '2 months',
         month = date_trunc('month', now() - interval '2 months')::date
   where pin_id = pid and source <> 'pin_removed';

  select n_pins into n_before
    from public.get_area_price_history(lat, lng, 400, null, 6) h
   where h.month = m2ago;
  raise notice '1) Truoc khi xoa — thang % co % can', m2ago, n_before;

  -- Xoá ghim: trigger ghi mốc pin_removed + giữ nguyên lịch sử (pin_id -> null)
  delete from public.pins where id = pid;

  -- Mô phỏng căn bị gỡ từ tháng trước (để thấy rõ tháng sau khi gỡ không còn tính)
  update public.price_observations
     set observed_at = now() - interval '1 month',
         month = date_trunc('month', now() - interval '1 month')::date
   where pin_id is null and source = 'pin_removed' and address_text = 'Test giu lich su gia';

  select n_pins into n_after
    from public.get_area_price_history(lat, lng, 400, null, 6) h
   where h.month = m2ago;
  select n_pins into n_prev
    from public.get_area_price_history(lat, lng, 400, null, 6) h
   where h.month = m1ago;
  select coalesce(max(n_pins), 0) into n_now
    from public.get_area_price_history(lat, lng, 400, null, 6) h
   where h.month = mnow;

  raise notice '2) Sau khi xoa — thang % con % can (truoc do %)', m2ago, n_after, n_before;
  raise notice '3) Thang bi go % con % can', m1ago, n_prev;
  raise notice '4) Thang hien tai % con % can (phai la 0)', mnow, n_now;

  if n_after = n_before and n_after > 0 then
    raise notice 'PASS: lich su thang cu duoc giu lai sau khi xoa ghim';
  else
    raise notice 'FAIL: lich su thang cu bi mat';
  end if;

  if n_now = 0 then
    raise notice 'PASS: tu thang sau khi go, can da go khong con trong bieu do';
  else
    raise notice 'FAIL: can da go van tinh vao thang hien tai';
  end if;

  -- Ô lưới / chỉ số tháng: dựng lại rồi đọc ô chứa căn vừa gỡ
  perform public.refresh_price_index_monthly(6);
  select cell_id into cell from public.price_observations
   where source = 'pin_removed' and address_text = 'Test giu lich su gia' limit 1;

  select n_pins into n_index from public.price_index_monthly
   where cell_id = cell and property_type = 'nha-pho' and month = m2ago;
  raise notice '5) Chi so o luoi % thang % = % can', cell, m2ago, coalesce(n_index, 0);

  if coalesce(n_index, 0) > 0 then
    raise notice 'PASS: chi so gia o luoi van giu du lieu cua can da go';
  else
    raise notice 'FAIL: chi so o luoi mat du lieu';
  end if;

  raise exception 'rollback_test_data';
exception when others then
  if sqlerrm <> 'rollback_test_data' then raise; end if;
  raise notice 'Da rollback du lieu test';
end $$;
