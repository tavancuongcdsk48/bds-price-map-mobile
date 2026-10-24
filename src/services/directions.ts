import { Linking, Platform, Alert } from 'react-native';

/** Khoảng cách đường chim bay (km) giữa 2 toạ độ */
export function distanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function formatDistance(km: number): string {
  if (!isFinite(km)) return '';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1).replace('.', ',')} km`;
  return `${Math.round(km)} km`;
}

/**
 * Mở app bản đồ có sẵn trên máy để chỉ đường tới ghim.
 * - iOS: Apple Maps (maps://) → fallback Google Maps app → fallback web
 * - Android: Google Maps navigation (google.navigation:q=)
 */
export async function openDirections(lat: number, lng: number, label?: string): Promise<void> {
  const dest = `${lat},${lng}`;
  const name = encodeURIComponent(label || 'Ghim nhà');

  const candidates: string[] =
    Platform.OS === 'ios'
      ? [
          `maps://?daddr=${dest}&q=${name}&dirflg=d`,
          `comgooglemaps://?daddr=${dest}&directionsmode=driving`,
          `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`,
        ]
      : [
          `google.navigation:q=${dest}&mode=d`,
          `geo:${dest}?q=${dest}(${name})`,
          `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`,
        ];

  for (const url of candidates) {
    try {
      const ok = await Linking.canOpenURL(url);
      if (ok) {
        await Linking.openURL(url);
        return;
      }
    } catch {
      // thử URL kế tiếp
    }
  }

  Alert.alert('Không mở được bản đồ', 'Máy chưa có ứng dụng bản đồ phù hợp để chỉ đường.');
}
