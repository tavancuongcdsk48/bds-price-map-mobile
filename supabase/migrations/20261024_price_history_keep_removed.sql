-- Giữ lịch sử giá của căn đã gỡ khỏi bản đồ trong biểu đồ giá khu vực / ô lưới.
-- Trước bản này: mọi observation có mốc cuối là 'pin_removed' bị loại ở TẤT CẢ các tháng
-- → xoá ghim là lịch sử biến mất khỏi biểu đồ (dù vẫn nằm trong bảng).
-- Sau bản này: căn đã gỡ vẫn được tính cho tới HẾT tháng bị gỡ; từ tháng sau mới ra khỏi chỉ số.
-- Snapshot "đang treo" (get_price_at_location) vẫn loại căn đã gỡ — đúng nghĩa thị trường hiện tại.

create or replace function public.get_area_price_history(
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer default 400,
  p_type text default null,
  p_months integer default 12
)
returns table (
  month date,
  n_pins integer,
  median_ppm2 numeric,
  p25 numeric,
  p75 numeric,
  min_ppm2 numeric,
  max_ppm2 numeric
)
language sql
stable
security definer
as $$
  with months as (
    select generate_series(
             date_trunc('month', now())::date - ((p_months - 1) || ' month')::interval,
             date_trunc('month', now())::date,
             '1 month')::date as m
  ),
  keyed as (
    select o.*,
           coalesce(o.pin_id::text,
                    md5(coalesce(o.owner_id::text, '') || o.cell_id || coalesce(o.address_text, ''))
           ) as obs_key
      from public.price_observations o
     where (p_type is null or o.property_type = p_type)
       and extensions.ST_DWithin(
             o.geom_exact,
             extensions.ST_SetSRID(extensions.ST_MakePoint(p_lng, p_lat), 4326)::extensions.geography,
             p_radius_m)
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
  select s.month,
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
$$;

create or replace function public.refresh_price_index_monthly(p_months integer default 36)
returns integer
language plpgsql
security definer
as $$
declare v_rows int;
begin
  delete from public.price_index_monthly
   where month >= (date_trunc('month', now())::date - ((p_months - 1) || ' month')::interval);

  with months as (
    select generate_series(
             date_trunc('month', now())::date - ((p_months - 1) || ' month')::interval,
             date_trunc('month', now())::date,
             '1 month')::date as m
  ),
  keyed as (
    select o.*,
           coalesce(o.pin_id::text,
                    md5(coalesce(o.owner_id::text, '') || o.cell_id || coalesce(o.address_text, ''))
           ) as obs_key
      from public.price_observations o
  ),
  removed as (
    select obs_key, min(observed_at) as removed_at
      from keyed
     where source = 'pin_removed'
     group by 1
  ),
  snap as (
    select mo.m as month, k.cell_id, k.property_type, k.obs_key,
           (array_agg(k.price_per_m2 order by k.observed_at desc))[1] as ppm2,
           (array_agg(k.price_vnd    order by k.observed_at desc))[1] as price_vnd
      from months mo
      join keyed k on k.observed_at < (mo.m + interval '1 month')
     group by 1, 2, 3, 4
  )
  insert into public.price_index_monthly
    (cell_id, property_type, month, n_pins, median_price_per_m2, p25, p75,
     min_ppm2, max_ppm2, median_price_vnd, updated_at)
  select s.cell_id, s.property_type, s.month,
         count(*)::int,
         round(percentile_cont(0.5)  within group (order by s.ppm2)),
         round(percentile_cont(0.25) within group (order by s.ppm2)),
         round(percentile_cont(0.75) within group (order by s.ppm2)),
         min(s.ppm2), max(s.ppm2),
         round(percentile_cont(0.5)  within group (order by s.price_vnd)),
         now()
    from snap s
    left join removed r on r.obs_key = s.obs_key
   where r.removed_at is null
      or s.month <= date_trunc('month', r.removed_at)::date
   group by 1, 2, 3
  on conflict (cell_id, property_type, month) do update
    set n_pins = excluded.n_pins,
        median_price_per_m2 = excluded.median_price_per_m2,
        p25 = excluded.p25, p75 = excluded.p75,
        min_ppm2 = excluded.min_ppm2, max_ppm2 = excluded.max_ppm2,
        median_price_vnd = excluded.median_price_vnd,
        updated_at = now();

  get diagnostics v_rows = row_count;
  return v_rows;
end $$;

select public.refresh_price_index_monthly(36) as rebuilt_rows;
