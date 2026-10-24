/**
 * Lấy địa chỉ ngược từ toạ độ (reverse geocoding).
 * Thứ tự ưu tiên:
 *   1. Google Geocoding (chính xác nhất, cần EXPO_PUBLIC_GOOGLE_GEOCODING_KEY)
 *   2. Photon (komoot) — có tên toà nhà/POI, không cần key
 *   3. Nominatim — địa chỉ hành chính đầy đủ, không cần key
 *
 * Mục tiêu: ghim luôn có địa chỉ chi tiết (số nhà + đường, phường/xã, quận/huyện, tỉnh/thành)
 * thay vì rơi về "Ghim theo toạ độ bản đồ".
 */
export interface ReverseResult {
  /** Địa chỉ đầy đủ để hiển thị/lưu vào ghim */
  full: string;
  /** Tên toà nhà / khu / POI nếu có */
  building: string | null;
  /** Số nhà + tên đường, ví dụ "32 An Đào" */
  street: string | null;
  /** Phường / xã */
  ward: string | null;
  /** Thôn / xóm / ấp / tổ dân phố — đơn vị hành chính nhỏ nhất có được */
  hamlet: string | null;
  /** Quận / huyện */
  district: string | null;
  /** Tỉnh / thành phố */
  city: string | null;
  /** Số nhà riêng (nếu tách được) */
  houseNumber: string | null;
  source: 'google' | 'photon' | 'nominatim' | 'none';
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
    if (out.some((o) => o.toLowerCase().includes(key))) continue;
    seen.add(key);
    out.push(p);
  }
  return out.join(sep);
}

const GOOGLE_KEY = (process.env.EXPO_PUBLIC_GOOGLE_GEOCODING_KEY || '').trim();

/** Google Geocoding — chuẩn nhất, có số nhà nếu Google có dữ liệu */
async function googleReverse(lat: number, lng: number): Promise<ReverseResult | null> {
  if (!GOOGLE_KEY) return null;
  try {
    const url =
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}` +
      `&key=${GOOGLE_KEY}&language=vi`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.status !== 'OK' || !data.results?.length) return null;

    const results: any[] = data.results;
    const best =
      results.find((r) =>
        (r.types || []).some((t: string) =>
          ['street_address', 'premise', 'subpremise', 'point_of_interest'].includes(t)
        )
      ) || results[0];

    const comps: any[] = best.address_components || [];
    const get = (type: string): string | null => {
      const c = comps.find((x) => (x.types || []).includes(type));
      return c ? clean(c.long_name) || null : null;
    };

    const houseNumber = get('street_number');
    const route = get('route');
    const building = get('premise') || get('point_of_interest') || null;
    const hamlet = get('neighborhood') || null;
    const ward =
      get('sublocality') ||
      get('sublocality_level_1') ||
      get('administrative_area_level_3') ||
      get('locality');
    const district = get('administrative_area_level_2');
    const city = get('administrative_area_level_1');

    const street = joinParts([houseNumber, route], ' ') || null;
    const full = joinParts([building, street, hamlet, ward, district, city]);
    if (!full) return null;
    return { full, building, street, ward, hamlet, district, city, houseNumber, source: 'google' };
  } catch (err) {
    console.warn('Google reverse lỗi:', err);
    return null;
  }
}

/** Photon — mạnh về tên toà nhà / POI */
async function photonReverse(lat: number, lng: number): Promise<ReverseResult | null> {
  try {
    const url = `https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&limit=1`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json();
    const f = data?.features?.[0]?.properties;
    if (!f) return null;

    const building = clean(f.name) || null;
    const houseNumber = clean(f.housenumber) || null;
    const street = joinParts([houseNumber, clean(f.street) || clean(f.street_name)], ' ') || null;
    // locality của Photon ở VN thường là xóm/thôn/khu dân cư
    const hamlet = clean(f.locality) || null;
    const ward = clean(f.district) || null;
    const district = clean(f.county) || null;
    const city = clean(f.city) || clean(f.state) || null;
    const full = joinParts([building, street, hamlet, ward, district, city]);
    if (!full) return null;
    return { full, building, street, ward, hamlet, district, city, houseNumber, source: 'photon' };
  } catch (err) {
    console.warn('Photon reverse lỗi:', err);
    return null;
  }
}

/** Nominatim — địa chỉ hành chính đầy đủ, có display_name dự phòng */
async function nominatimReverse(lat: number, lng: number): Promise<ReverseResult | null> {
  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}` +
      `&zoom=18&addressdetails=1&accept-language=vi`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'VuTruChuyenNhuong/1.0' },
    });
    if (!res.ok) return null;
    const d = await res.json();
    const a = d?.address || {};
    const building =
      clean(a.building) || clean(a.amenity) || clean(a.shop) || clean(d.name) || null;
    const houseNumber = clean(a.house_number) || null;
    const street = joinParts([houseNumber, clean(a.road)], ' ') || null;
    // neighbourhood/hamlet = xóm/thôn/ấp; suburb/quarter = phường/xã
    const hamlet = clean(a.neighbourhood) || clean(a.hamlet) || null;
    const ward = clean(a.suburb) || clean(a.quarter) || clean(a.village) || null;
    const district = clean(a.city_district) || clean(a.district) || clean(a.county) || null;
    const city = clean(a.city) || clean(a.town) || clean(a.state) || null;
    const full =
      joinParts([building, street, hamlet, ward, district, city]) ||
      clean(d.display_name)
        .replace(/,\s*\d{4,6}\s*,\s*Việt Nam$/i, '')
        .replace(/,\s*Việt Nam$/i, '');
    if (!full) return null;
    return { full, building, street, ward, hamlet, district, city, houseNumber, source: 'nominatim' };
  } catch (err) {
    console.warn('Nominatim reverse lỗi:', err);
    return null;
  }
}

export async function reverseGeocode(lat: number, lng: number): Promise<ReverseResult> {
  // 1) Google nếu có key
  const g = await googleReverse(lat, lng);
  if (g) return g;

  // 2) Photon (tên toà nhà)
  const p = await photonReverse(lat, lng);

  // 3) Nominatim (địa chỉ hành chính)
  const n = await nominatimReverse(lat, lng);

  if (p && n) {
    const street = n.houseNumber ? n.street : p.street || n.street;
    const full = joinParts([
      p.building,
      street,
      p.hamlet || n.hamlet,
      n.ward || p.ward,
      n.district || p.district,
      n.city || p.city,
    ]);
    return {
      full: full || p.full || n.full,
      building: p.building || n.building,
      street,
      ward: n.ward || p.ward,
      hamlet: p.hamlet || n.hamlet,
      district: n.district || p.district,
      city: n.city || p.city,
      houseNumber: n.houseNumber || p.houseNumber,
      source: n.houseNumber ? 'nominatim' : p.source,
    };
  }
  if (p) return p;
  if (n) return n;

  return {
    full: '',
    building: null,
    street: null,
    ward: null,
    hamlet: null,
    district: null,
    city: null,
    houseNumber: null,
    source: 'none',
  };
}

/** Rút gọn để hiện trong thẻ ghim (bỏ ", Việt Nam") */
export function shortAddress(full: string): string {
  return clean(full).replace(/,\s*Việt\s*Nam$/i, '');
}
