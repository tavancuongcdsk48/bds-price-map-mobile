import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import MapView, { PROVIDER_DEFAULT, PROVIDER_GOOGLE, Region } from 'react-native-maps';

export interface LatLng {
  latitude: number;
  longitude: number;
}

interface LocationPickerProps {
  visible: boolean;
  /** Toạ độ khởi điểm: vị trí đã chọn trước đó, hoặc GPS, hoặc mặc định */
  initial: LatLng;
  /** Vị trí GPS thật của người đăng (nếu có quyền) */
  userLocation: LatLng | null;
  onCancel: () => void;
  onConfirm: (coords: LatLng) => void;
}

/** Khoảng cách 2 toạ độ theo mét (công thức haversine) */
function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const LocationPicker: React.FC<LocationPickerProps> = ({
  visible,
  initial,
  userLocation,
  onCancel,
  onConfirm,
}) => {
  const mapRef = useRef<MapView | null>(null);
  const [center, setCenter] = useState<LatLng>(initial);
  const [ready, setReady] = useState(false);

  // Mỗi lần mở lại: đặt tâm về toạ độ khởi điểm mới nhất
  useEffect(() => {
    if (visible) {
      setCenter(initial);
      setReady(false);
      const t = setTimeout(() => {
        mapRef.current?.animateToRegion(
          {
            latitude: initial.latitude,
            longitude: initial.longitude,
            latitudeDelta: 0.0025,
            longitudeDelta: 0.0025,
          },
          350
        );
        setReady(true);
      }, 250);
      return () => clearTimeout(t);
    }
  }, [visible, initial.latitude, initial.longitude]);

  const recenterToGps = () => {
    if (!userLocation) return;
    setCenter(userLocation);
    mapRef.current?.animateToRegion(
      {
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
        latitudeDelta: 0.0025,
        longitudeDelta: 0.0025,
      },
      450
    );
  };

  // Độ lệch so với GPS — giúp người đăng biết mình đã kéo đi bao xa
  const offsetFromGps = userLocation ? Math.round(distanceMeters(center, userLocation)) : null;
  const offsetText =
    offsetFromGps === null
      ? 'Chưa có GPS để đối chiếu'
      : offsetFromGps < 30
      ? `Cách vị trí hiện tại ${offsetFromGps}m`
      : offsetFromGps < 1000
      ? `Cách vị trí hiện tại ${offsetFromGps}m — kiểm tra lại cho chắc`
      : `Cách vị trí hiện tại ${(offsetFromGps / 1000).toFixed(1)}km — khác xa nơi đang đứng`;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <View style={styles.container}>
        <MapView
          ref={mapRef}
          provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : PROVIDER_DEFAULT}
          style={styles.map}
          initialRegion={{
            latitude: initial.latitude,
            longitude: initial.longitude,
            latitudeDelta: 0.0025,
            longitudeDelta: 0.0025,
          }}
          showsUserLocation={true}
          showsMyLocationButton={false}
          showsCompass={false}
          toolbarEnabled={false}
          onRegionChangeComplete={(r: Region) => {
            setCenter({ latitude: r.latitude, longitude: r.longitude });
            if (!ready) setReady(true);
          }}
        />

        {/* Tâm ngắm cố định ở giữa màn hình */}
        <View pointerEvents="none" style={styles.crosshairWrap}>
          <View style={styles.crosshairRing} />
          <View style={styles.crosshairH} />
          <View style={styles.crosshairV} />
        </View>

        <SafeAreaView pointerEvents="box-none" style={styles.overlay}>
          <View style={styles.headerCard}>
            <Text style={styles.headerTitle}>Đặt ghim đúng căn nhà</Text>
            <Text style={styles.headerHint}>
              Kéo bản đồ cho tâm ngắm nằm đúng vị trí căn nhà. Không cần đứng tại đó.
            </Text>
          </View>

          <View style={styles.bottomCard}>
            <View style={styles.coordRow}>
              <Text style={styles.coordLabel}>Toạ độ đã chọn</Text>
              <Text style={styles.coordValue}>
                {ready
                  ? `${center.latitude.toFixed(6)}, ${center.longitude.toFixed(6)}`
                  : 'Đang xác định...'}
              </Text>
            </View>

            <View style={styles.offsetRow}>
              {userLocation ? <Text style={styles.offsetIcon}>📍</Text> : <ActivityIndicator size="small" color="#64748b" />}
              <Text style={styles.offsetText}>{offsetText}</Text>
            </View>

            <Text style={styles.privacyNote}>
              🛡️ Bản công khai chỉ hiện vị trí đã làm mờ 50–100m. Toạ độ chính xác anh vừa đặt chỉ dùng để
              đối chiếu nội bộ, không hiện cho người xem khác.
            </Text>

            <View style={styles.btnRow}>
              <TouchableOpacity
                style={[styles.gpsBtn, !userLocation && styles.btnDisabled]}
                onPress={recenterToGps}
                disabled={!userLocation}
              >
                <Text style={styles.gpsBtnText}>Vị trí của tôi</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.confirmBtn} onPress={() => onConfirm(center)}>
                <Text style={styles.confirmBtnText}>Chọn vị trí này</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
              <Text style={styles.cancelBtnText}>Huỷ</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  map: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },

  crosshairWrap: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 56,
    height: 56,
    marginLeft: -28,
    marginTop: -28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crosshairRing: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: '#22c55e',
    backgroundColor: 'rgba(34,197,94,0.15)',
  },
  crosshairH: { position: 'absolute', width: 56, height: 2, backgroundColor: '#22c55e' },
  crosshairV: { position: 'absolute', height: 56, width: 2, backgroundColor: '#22c55e' },

  overlay: { flex: 1, justifyContent: 'space-between' },

  headerCard: {
    marginHorizontal: 16,
    marginTop: 8,
    backgroundColor: 'rgba(15,23,42,0.92)',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  headerTitle: { color: '#f8fafc', fontSize: 16, fontWeight: '700' },
  headerHint: { color: '#94a3b8', fontSize: 12, marginTop: 4, lineHeight: 17 },

  bottomCard: {
    margin: 16,
    backgroundColor: '#111c33',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  coordRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  coordLabel: { color: '#94a3b8', fontSize: 12 },
  coordValue: { color: '#f1f5f9', fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },

  offsetRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  offsetIcon: { fontSize: 12 },
  offsetText: { color: '#cbd5e1', fontSize: 12, flex: 1 },

  privacyNote: { color: '#64748b', fontSize: 11, lineHeight: 16, marginTop: 10 },

  btnRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  gpsBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    backgroundColor: '#1e293b',
  },
  gpsBtnText: { color: '#e2e8f0', fontSize: 13, fontWeight: '600' },
  btnDisabled: { opacity: 0.4 },

  confirmBtn: {
    flex: 1.4,
    backgroundColor: '#22c55e',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  confirmBtnText: { color: '#052e16', fontSize: 14, fontWeight: '800' },

  cancelBtn: { alignItems: 'center', paddingTop: 12 },
  cancelBtnText: { color: '#64748b', fontSize: 13 },
});
