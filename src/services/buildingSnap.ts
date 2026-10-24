/**
 * "Bắt đúng toà": khi người dùng thả ghim, tự dóng về tâm toà nhà gần nhất nếu dữ liệu bản đồ có.
 *
 * Nguồn (đều miễn phí, không cần API key):
 *  1) Photon (komoot, dữ liệu OSM) — nguồn chính: nhanh, trả toà nhà có tên trong bán kính.
 *     Overpass chỉ cho 2 slot/IP và chặn IP khi gọi dồn dập (đã gặp thật) nên không làm nguồn chính.
 *  2) Overpass API (OpenStreetMap) — dự phòng: lấy polygon `building=*` khi Photon không thấy toà.
 *
 * Chỉ bắt khi toà nằm trong bán kính cho phép (mặc định 40m) để không kéo ghim đi quá xa
 * vị trí người dùng chỉ. Không tìm được thì trả về nguyên toạ độ gốc (snapped=false).
 */
export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface SnapResult extends LatLng {
  snapped: boolean;
  name: string | null;
  distanceM: number;
  source: 'overpass' | 'photon' | 'none';
}

export const SNAP_RADIUS_M = 40;

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/** Khoảng cách mặt đất (m) giữa 2 toạ độ — công thức haversine. */
export function haversineM(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface BuildingCandidate extends LatLng {
  name?: string | null;
}

/** Chọn toà gần nhất trong bán kính; trả null nếu không có ứng viên nào đủ gần. */
export function pickNearest(
  point: LatLng,
  candidates: BuildingCandidate[],
  radiusM: number = SNAP_RADIUS_M
): { candidate: BuildingCandidate; distanceM: number } | null {
  let best: { candidate: BuildingCandidate; distanceM: number } | null = null;
  for (const c of candidates) {
    if (!Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) continue;
    const d = haversineM(point, c);
    if (d > radiusM) continue;
    if (!best || d < best.distanceM) best = { candidate: c, distanceM: d };
  }
  return best;
}

function withTimeout(ms: number): AbortSignal | undefined {
  try {
    return AbortSignal.timeout(ms);
  } catch {
    return undefined;
  }
}

interface OverpassElement {
  type?: string;
  tags?: Record<string, string>;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
}

async function fromOverpass(point: LatLng, radiusM: number): Promise<SnapResult | null> {
  const query = `[out:json][timeout:6];
    (way(around:${radiusM},${point.latitude},${point.longitude})["building"];
     relation(around:${radiusM},${point.latitude},${point.longitude})["building"];);
    out center;`;

  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          // Overpass trả 406 nếu thiếu User-Agent
          'User-Agent': 'VuTruChuyenNhuong/1.0 (bds-price-map-mobile)',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: withTimeout(7000),
      });
      if (!res.ok) continue;
      const json: { elements?: OverpassElement[] } = await res.json();
      const candidates: BuildingCandidate[] = (json.elements || [])
        .map((el): BuildingCandidate | null => {
          const lat = el.center?.lat ?? el.lat;
          const lon = el.center?.lon ?? el.lon;
          if (typeof lat !== 'number' || typeof lon !== 'number') return null;
          const tags = el.tags || {};
          const name = tags['name:vi'] || tags.name || tags['addr:housename'] || null;
          return { latitude: lat, longitude: lon, name };
        })
        .filter((c): c is BuildingCandidate => c !== null);

      const nearest = pickNearest(point, candidates, radiusM);
      if (nearest) {
        return {
          latitude: nearest.candidate.latitude,
          longitude: nearest.candidate.longitude,
          snapped: true,
          name: nearest.candidate.name || null,
          distanceM: nearest.distanceM,
          source: 'overpass',
        };
      }
      return null;
    } catch {
      // thử endpoint kế tiếp
    }
  }
  return null;
}

const BUILDING_VALUES = new Set([
  'house',
  'apartments',
  'residential',
  'commercial',
  'retail',
  'office',
  'hotel',
  'school',
  'university',
  'hospital',
  'supermarket',
  'yes',
]);

/** Chỉ nhận ứng viên thật sự là toà nhà (bỏ quán ăn, cửa hàng, ga tàu... nằm gần). */
export function isBuildingLike(props: any): boolean {
  const key = String(props?.osm_key || '').toLowerCase();
  const value = String(props?.osm_value || '').toLowerCase();
  if (key === 'building') return true;
  if (key === 'amenity' && BUILDING_VALUES.has(value)) return true;
  return BUILDING_VALUES.has(value);
}

async function fromPhoton(point: LatLng, radiusM: number): Promise<SnapResult | null> {
  try {
    const url = `https://photon.komoot.io/reverse?lat=${point.latitude}&lon=${point.longitude}&limit=10`;
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: withTimeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    const features: any[] = data?.features || [];
    const candidates: BuildingCandidate[] = features
      .filter((f) => isBuildingLike(f?.properties))
      .map((f): BuildingCandidate | null => {
        const coords = f?.geometry?.coordinates;
        if (!Array.isArray(coords) || coords.length < 2) return null;
        const p = f?.properties || {};
        return {
          longitude: Number(coords[0]),
          latitude: Number(coords[1]),
          name: p.name || [p.housenumber, p.street].filter(Boolean).join(' ') || null,
        };
      })
      .filter((c): c is BuildingCandidate => c !== null);

    const nearest = pickNearest(point, candidates, radiusM);
    if (!nearest) return null;
    return {
      latitude: nearest.candidate.latitude,
      longitude: nearest.candidate.longitude,
      snapped: true,
      name: nearest.candidate.name || null,
      distanceM: nearest.distanceM,
      source: 'photon',
    };
  } catch {
    return null;
  }
}

// Cache theo ô ~11m: thả nhiều ghim quanh một toà chỉ gọi API 1 lần
const snapCache = new Map<string, SnapResult>();
const CACHE_LIMIT = 300;

/** Bắt toà nhà gần nhất quanh toạ độ người dùng thả ghim. */
export async function snapToBuilding(
  latitude: number,
  longitude: number,
  radiusM: number = SNAP_RADIUS_M
): Promise<SnapResult> {
  const point = { latitude, longitude };
  const raw: SnapResult = {
    ...point,
    snapped: false,
    name: null,
    distanceM: 0,
    source: 'none',
  };

  const key = `${point.latitude.toFixed(4)},${point.longitude.toFixed(4)}`;
  const cached = snapCache.get(key);
  if (cached) return cached;

  // Photon trước (nhanh, không giới hạn slot); Overpass chỉ khi Photon không thấy toà nào
  let result = await fromPhoton(point, radiusM);
  if (!result) result = await fromOverpass(point, radiusM);

  const final = result ?? raw;
  if (snapCache.size >= CACHE_LIMIT) snapCache.clear();
  snapCache.set(key, final);
  return final;
}
