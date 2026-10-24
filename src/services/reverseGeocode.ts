/**
 * Lấy địa chỉ ngược từ toạ độ (reverse geocoding) bằng dữ liệu mở OSM.
 * - Photon (komoot) làm nguồn chính: có tên toà nhà/POI, không cần API key.
 * - Nominatim làm dự phòng.
 * Không dùng Google Geocoding để tránh vi phạm ToS khi hiển thị trên bản đồ khác.
 */
export interface ReverseResult {
  /** Địa chỉ đầy đủ để hiển thị/lưu vào ghim */
  full: string;
  /** Tên toà nhà / khu / POI nếu có */
  building: string | null;
  street: string | null;
  ward: string | null;
  city: string | null;
  source: 'photon' | 'nominatim' | 'none';
}

const clean = (s?: string | null) => (s || '').trim();

function joinParts(parts: (string | null | undefined)[], sep = ', '): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of parts) {
    const p = clean(raw);
    if (!p) continue;
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    // bỏ phần đã nằm trong chuỗi trước (vd name = "Vinhomes Ocean Park" và locality = "Vinhomes Ocean Park")
    if (out.some((o) => o.toLowerCase().includes(key))) continue;
    seen.add(key);
    out.push(p);
  }
  return out.join(sep);
}

export async function reverseGeocode(lat: number, lng: number): Promise<ReverseResult> {
  // 1) Photon
  try {
    const url = `https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&limit=1`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (res.ok) {
      const data = await res.json();
      const f = data?.features?.[0]?.properties;
      if (f) {
        const building = clean(f.name) || null;
        const street = joinParts(
          [clean(f.housenumber), clean(f.street) || clean(f.street_name)],
          ' '
        ) || null;
        const ward = clean(f.locality) || clean(f.district) || null;
        const city = clean(f.city) || clean(f.state) || null;
        const full = joinParts([building, street, ward, city, clean(f.country)]);
        if (full) {
          return { full, building, street, ward, city, source: 'photon' };
        }
      }
    }
  } catch (err) {
    console.warn('Photon reverse lỗi:', err);
  }

  // 2) Nominatim dự phòng
  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}` +
      `&zoom=18&addressdetails=1&accept-language=vi`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'VuTruChuyenNhuong/1.0' },
    });
    if (res.ok) {
      const d = await res.json();
      const a = d?.address || {};
      const building = clean(a.building) || clean(a.amenity) || clean(d.name) || null;
      const street = joinParts([clean(a.house_number), clean(a.road)], ' ') || null;
      const ward = clean(a.suburb) || clean(a.quarter) || clean(a.city_district) || null;
      const city = clean(a.city) || clean(a.town) || clean(a.state) || null;
      const full =
        joinParts([building, street, ward, city, clean(a.country)]) || clean(d.display_name);
      if (full) return { full, building, street, ward, city, source: 'nominatim' };
    }
  } catch (err) {
    console.warn('Nominatim reverse lỗi:', err);
  }

  return { full: '', building: null, street: null, ward: null, city: null, source: 'none' };
}

/** Rút gọn để hiện trong thẻ ghim (bỏ ", Việt Nam") */
export function shortAddress(full: string): string {
  return clean(full).replace(/,\s*Việt\s*Nam$/i, '');
}
