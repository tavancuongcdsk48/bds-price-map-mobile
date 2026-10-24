-- Kiểm chứng giới hạn media ở tầng DB (chạy trong transaction tự rollback, không để lại dữ liệu).
-- docker exec -i supabase_db_AdIntel.dms psql -U postgres -d postgres < scripts/verify_media_limits.sql
do $$
declare
  uid uuid;
  pid uuid;
  pid2 uuid;
begin
  select id into uid from public.profiles order by created_at limit 1;
  if uid is null then
    raise notice 'KHONG CO PROFILE NAO DE TEST';
    return;
  end if;

  insert into public.pins (user_id, title, property_type, price_vnd, area_m2, public_geom, exact_geom, address_text, contact_phone)
  values (uid, '[TEST] media limits', 'nha-pho', 5000000000, 60,
          extensions.ST_SetSRID(extensions.ST_MakePoint(105.8, 21.03), 4326)::extensions.geography,
          extensions.ST_SetSRID(extensions.ST_MakePoint(105.8, 21.03), 4326)::extensions.geography,
          'test media limits', '0900000000')
  returning id into pid;

  -- 1) 8 ảnh trong MỘT câu lệnh multi-row phải lọt
  insert into public.pin_media (pin_id, media_type, url, sort_order)
  select pid, 'image', 'https://test/img-' || g || '.webp', g from generate_series(1, 8) g;
  raise notice '1) 8 anh / 1 cau lenh: OK (dang co %)', (select count(*) from public.pin_media where pin_id = pid);

  -- 2) ảnh thứ 9 phải bị chặn
  begin
    insert into public.pin_media (pin_id, media_type, url) values (pid, 'image', 'https://test/img-9.webp');
    raise notice '2) anh thu 9: KHONG BI CHAN -> SAI';
  exception when others then
    raise notice '2) anh thu 9: BI CHAN -> %', sqlerrm;
  end;

  -- 3) video 30s phải lọt
  begin
    insert into public.pin_media (pin_id, media_type, url, duration_seconds) values (pid, 'video', 'https://test/v1.mp4', 30);
    raise notice '3) video 30s: OK';
  exception when others then
    raise notice '3) video 30s: LOI -> %', sqlerrm;
  end;

  -- 4) video thứ 2 phải bị chặn
  begin
    insert into public.pin_media (pin_id, media_type, url, duration_seconds) values (pid, 'video', 'https://test/v2.mp4', 20);
    raise notice '4) video thu 2: KHONG BI CHAN -> SAI';
  exception when others then
    raise notice '4) video thu 2: BI CHAN -> %', sqlerrm;
  end;

  -- 5) video 60s phải bị chặn
  insert into public.pins (user_id, title, property_type, price_vnd, area_m2, public_geom, exact_geom, address_text, contact_phone)
  values (uid, '[TEST] media limits 2', 'nha-pho', 4000000000, 50,
          extensions.ST_SetSRID(extensions.ST_MakePoint(105.81, 21.04), 4326)::extensions.geography,
          extensions.ST_SetSRID(extensions.ST_MakePoint(105.81, 21.04), 4326)::extensions.geography,
          'test media limits 2', '0900000001')
  returning id into pid2;

  begin
    insert into public.pin_media (pin_id, media_type, url, duration_seconds) values (pid2, 'video', 'https://test/v3.mp4', 60);
    raise notice '5) video 60s: KHONG BI CHAN -> SAI';
  exception when others then
    raise notice '5) video 60s: BI CHAN -> %', sqlerrm;
  end;

  raise exception 'rollback_test_data';
exception when others then
  if sqlerrm <> 'rollback_test_data' then
    raise;
  end if;
  raise notice 'Da rollback toan bo du lieu test';
end $$;
