-- Backfill sổ cái giá từ dữ liệu đang có (chạy 1 lần)
INSERT INTO public.price_observations
  (pin_id, owner_id, property_type, price_vnd, area_m2, price_per_m2,
   geom_public, geom_exact, cell_id, alley_key, address_text, source, observed_at, month)
SELECT p.id, p.user_id, p.property_type, h.price_vnd, p.area_m2,
       coalesce(nullif(h.price_per_m2, 0), round(h.price_vnd / nullif(p.area_m2, 0))),
       p.public_geom, p.exact_geom,
       public.price_cell(p.exact_geom), public.alley_key(p.address_text), p.address_text,
       CASE WHEN h.source = 'created' THEN 'backfill' ELSE 'owner_edit' END,
       h.created_at, date_trunc('month', h.created_at)::date
  FROM public.pin_price_history h
  JOIN public.pins p ON p.id = h.pin_id
 WHERE NOT EXISTS (
   SELECT 1 FROM public.price_observations o
    WHERE o.pin_id = p.id AND o.observed_at = h.created_at);

-- Ghim nào chưa có mốc nào thì tạo 1 mốc 'seed' tại thời điểm tạo ghim
INSERT INTO public.price_observations
  (pin_id, owner_id, property_type, price_vnd, area_m2, price_per_m2,
   geom_public, geom_exact, cell_id, alley_key, address_text, source, observed_at, month)
SELECT p.id, p.user_id, p.property_type, p.price_vnd, p.area_m2, p.price_per_m2,
       p.public_geom, p.exact_geom,
       public.price_cell(p.exact_geom), public.alley_key(p.address_text), p.address_text,
       'seed', p.created_at, date_trunc('month', p.created_at)::date
  FROM public.pins p
 WHERE NOT EXISTS (SELECT 1 FROM public.price_observations o WHERE o.pin_id = p.id);

SELECT public.refresh_price_index_monthly(36) AS rows_built;
