// Tìm địa điểm (tỉnh/huyện/xã/đường/dự án) bằng Photon — OpenStreetMap, miễn phí, không cần API key.
// Giới hạn khung Việt Nam để kết quả không lẫn nước khác.

export interface PlaceResult {
  id: string;
  label: string;
  sub: string;
  latitude: number;
  longitude: number;
}

const VN_BBOX = '102.14,8.18,109.47,23.39'; // tây,nam,đông,bắc

export async function searchPlaces(query: string): Promise<PlaceResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  try {
    // Photon chỉ hỗ trợ lang=default/de/en/fr → không gửi lang=vi (sẽ bị HTTP 400)
    const url =
      'https://photon.komoot.io/api/?q=' +
      encodeURIComponent(q) +
      '&limit=8&bbox=' +
      VN_BBOX;

    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return [];

    const json: any = await res.json();
    const features: any[] = json?.features || [];

    return features
      .filter((f) => {
        const c = String(f.properties?.country || '').toLowerCase();
        return c.includes('việt') || c.includes('viet');
      })
      .map((f, idx) => {
        const p = f.properties || {};
        const [lng, lat] = f.geometry?.coordinates || [];
        const name = p.name || p.street || 'Không tên';
        const parts = [p.street, p.locality, p.district, p.city, p.state].filter(
          (v: any, i: number, arr: any[]) => v && arr.indexOf(v) === i && v !== name
        );
        return {
          id: `photon-${p.osm_id || idx}`,
          label: name,
          sub: parts.join(', '),
          latitude: Number(lat),
          longitude: Number(lng),
        };
      })
      .filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude));
  } catch (err) {
    console.warn('Lỗi tìm địa điểm:', err);
    return [];
  }
}
