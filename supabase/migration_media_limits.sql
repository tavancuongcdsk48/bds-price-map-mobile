-- Giới hạn media của app "Vũ Trụ Chuyển Nhượng" — chốt ở tầng DB để client không thể lách.
-- Quy tắc (khớp src/lib/mediaRules.ts): tối đa 8 ảnh + 1 video mỗi ghim, video ≤ 45 giây.
-- Chạy: docker exec -i supabase_db_AdIntel.dms psql -U postgres -d postgres -f - < supabase/migration_media_limits.sql

alter table public.pin_media add column if not exists sort_order int not null default 0;
alter table public.pin_media add column if not exists file_size_bytes bigint;

create index if not exists idx_pin_media_order on public.pin_media (pin_id, sort_order);

-- 1 video / ghim: bắt bằng unique index, đúng với mọi kiểu insert (kể cả multi-row)
create unique index if not exists pin_media_one_video_per_pin
  on public.pin_media (pin_id)
  where media_type = 'video';

-- ≤ 8 ảnh / ghim + video ≤ 45s
create or replace function public.enforce_pin_media_limits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  img_count int;
begin
  if new.media_type = 'video' then
    if coalesce(new.duration_seconds, 0) > 45 then
      raise exception 'video_too_long' using errcode = '22023';
    end if;
    return new;
  end if;

  -- AFTER trigger: dòng mới đã nằm trong bảng nên luôn trừ chính nó ra
  select count(*) into img_count
  from public.pin_media
  where pin_id = new.pin_id
    and media_type = 'image'
    and id <> new.id;

  if img_count >= 8 then
    raise exception 'image_limit_reached' using errcode = '22023';
  end if;

  return new;
end $$;

drop trigger if exists trg_pin_media_limits on public.pin_media;
create trigger trg_pin_media_limits
  after insert or update of media_type, duration_seconds on public.pin_media
  for each row execute function public.enforce_pin_media_limits();
