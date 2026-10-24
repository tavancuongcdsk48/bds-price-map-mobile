-- Đơn vị hành chính cho ghim + bảng giá theo đơn vị hành chính nhỏ nhất (xóm/thôn/ấp/tổ dân phố).
-- Mục tiêu: nút "Phân tích giá" không còn lấy theo bán kính 400 m mà lấy theo
-- đơn vị hành chính nhỏ nhất có dữ liệu tại điểm đang xem (hamlet -> ward -> district -> city).

alter table public.pins
  add column if not exists admin_hamlet   text,
  add column if not exists admin_ward     text,
  add column if not exists admin_district text,
  add column if not exists admin_city     text;

alter table public.price_observations
  add column if not exists admin_hamlet   text,
  add column if not exists admin_ward     text,
  add column if not exists admin_district text,
  add column if not exists admin_city     text;

create index if not exists pins_admin_area_idx
  on public.pins (lower(admin_hamlet), lower(admin_ward), lower(admin_district));

create index if not exists price_obs_admin_area_idx
  on public.price_observations (lower(admin_hamlet), lower(admin_ward), lower(admin_district));

-- Giữ price_observations đồng bộ với pins mỗi khi ghim đổi đơn vị hành chính
create or replace function public.sync_admin_area_to_observations()
returns trigger language plpgsql as $$
begin
  update public.price_observations o
     set admin_hamlet   = new.admin_hamlet,
         admin_ward     = new.admin_ward,
         admin_district = new.admin_district,
         admin_city     = new.admin_city
   where o.pin_id = new.id
     and (o.admin_hamlet is distinct from new.admin_hamlet
       or o.admin_ward is distinct from new.admin_ward
       or o.admin_district is distinct from new.admin_district
       or o.admin_city is distinct from new.admin_city);
  return new;
end $$;

drop trigger if exists trg_sync_admin_area on public.pins;
create trigger trg_sync_admin_area
after insert or update of admin_hamlet, admin_ward, admin_district, admin_city on public.pins
for each row execute function public.sync_admin_area_to_observations();

-- Backfill tạm từ address_text (app sẽ ghi đè bằng dữ liệu reverse geocode chính xác)
with parts as (
  select id,
         string_to_array(address_text, ',') as a
    from public.pins
   where address_text is not null and position(',' in address_text) > 0
)
update public.pins p
   set admin_city     = nullif(btrim(parts.a[array_length(parts.a, 1)]), ''),
       admin_district = nullif(btrim(parts.a[array_length(parts.a, 1) - 1]), ''),
       admin_ward     = nullif(btrim(parts.a[array_length(parts.a, 1) - 2]), ''),
       admin_hamlet   = case when array_length(parts.a, 1) >= 4
                             then nullif(btrim(parts.a[array_length(parts.a, 1) - 3]), '')
                             else null end
  from parts
 where parts.id = p.id
   and p.admin_city is null;

update public.price_observations o
   set admin_hamlet = p.admin_hamlet,
       admin_ward = p.admin_ward,
       admin_district = p.admin_district,
       admin_city = p.admin_city
  from public.pins p
 where o.pin_id = p.id
   and o.admin_city is null;

-- Bảng giá theo đơn vị hành chính nhỏ nhất có dữ liệu
create or replace function public.get_admin_area_price_history(
  p_hamlet   text default null,
  p_ward     text default null,
  p_district text default null,
  p_city     text default null,
  p_type     text default null,
  p_months   integer default 12
)
returns table(
  area_level  text,
  area_name   text,
  month       date,
  n_pins      integer,
  median_ppm2 numeric,
  p25         numeric,
  p75         numeric,
  min_ppm2    numeric,
  max_ppm2    numeric
)
language sql stable security definer as $function$
  with base as (
    select o.*,
           lower(btrim(o.admin_hamlet))   as h,
           lower(btrim(o.admin_ward))     as w,
           lower(btrim(o.admin_district)) as d,
           lower(btrim(o.admin_city))     as c
      from public.price_observations o
     where (p_type is null or o.property_type = p_type)
  ),
  levels as (
    select 1 as pri, 'hamlet'::text as lvl, p_hamlet as nm, count(*) as n
      from base
     where p_hamlet is not null and btrim(p_hamlet) <> ''
       and h = lower(btrim(p_hamlet))
       and (p_ward is null or w = lower(btrim(p_ward)))
    union all
    select 2, 'ward', p_ward, count(*)
      from base
     where p_ward is not null and btrim(p_ward) <> ''
       and w = lower(btrim(p_ward))
       and (p_district is null or d = lower(btrim(p_district)))
    union all
    select 3, 'district', p_district, count(*)
      from base
     where p_district is not null and btrim(p_district) <> ''
       and d = lower(btrim(p_district))
       and (p_city is null or c = lower(btrim(p_city)))
    union all
    select 4, 'city', p_city, count(*)
      from base
     where p_city is not null and btrim(p_city) <> ''
       and c = lower(btrim(p_city))
  ),
  chosen as (
    select lvl, nm from levels where n > 0 order by pri limit 1
  ),
  months as (
    select generate_series(
             date_trunc('month', now())::date - ((p_months - 1) || ' month')::interval,
             date_trunc('month', now())::date,
             '1 month')::date as m
  ),
  keyed as (
    select o.*,
           coalesce(o.pin_id::text,
                    md5(coalesce(o.owner_id::text, '') || o.cell_id || coalesce(o.address_text, ''))
           ) as obs_key,
           ch.lvl, ch.nm
      from public.price_observations o
      cross join chosen ch
     where (p_type is null or o.property_type = p_type)
       and case ch.lvl
             when 'hamlet'   then lower(btrim(o.admin_hamlet))   = lower(btrim(p_hamlet))
             when 'ward'     then lower(btrim(o.admin_ward))     = lower(btrim(p_ward))
             when 'district' then lower(btrim(o.admin_district)) = lower(btrim(p_district))
             else                 lower(btrim(o.admin_city))     = lower(btrim(p_city))
           end
  ),
  removed as (
    select obs_key, min(observed_at) as removed_at
      from keyed
     where source = 'pin_removed'
     group by 1
  ),
  snap as (
    select mo.m as month, k.obs_key,
           (array_agg(k.price_per_m2 order by k.observed_at desc))[1] as ppm2
      from months mo
      join keyed k on k.observed_at < (mo.m + interval '1 month')
     group by 1, 2
  )
  select (select lvl from chosen), (select nm from chosen),
         s.month,
         count(*)::int,
         round(percentile_cont(0.5)  within group (order by s.ppm2)),
         round(percentile_cont(0.25) within group (order by s.ppm2)),
         round(percentile_cont(0.75) within group (order by s.ppm2)),
         min(s.ppm2), max(s.ppm2)
    from snap s
    left join removed r on r.obs_key = s.obs_key
   where r.removed_at is null
      or s.month <= date_trunc('month', r.removed_at)::date
   group by s.month
   order by s.month;
$function$;

grant execute on function public.get_admin_area_price_history(text, text, text, text, text, integer) to anon, authenticated;
