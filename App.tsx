import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
  ScrollView,
  Alert,
  Linking,
  Platform
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, PROVIDER_DEFAULT, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { useGoogleAuth } from './src/hooks/useGoogleAuth';
import { CreatePinModal, NewPinData } from './src/components/CreatePinModal';
import { fetchPinsInBounds, createPinInSupabase, PinItem } from './src/services/pinService';

const SEED_PINS: PinItem[] = [
  {
    id: 'pin-1',
    title: 'Nhà 4 tầng ngõ 68 Cầu Giấy, ô tô đỗ cửa',
    price_vnd: 6800000000,
    price_display: '6.8 Tỷ',
    price_per_m2_display: '123 tr/m²',
    area_m2: 55,
    latitude: 21.0335,
    longitude: 105.7942,
    property_type: 'nha-pho',
    has_video: true,
    video_duration: '0:35',
    contact_phone: '0988123456',
    address_text: 'Ngõ 68 Cầu Giấy, Quan Hoa, Cầu Giấy, Hà Nội',
    is_verified: true,
  },
  {
    id: 'pin-2',
    title: 'Chung cư The Nine 2PN view Panorama',
    price_vnd: 4200000000,
    price_display: '4.2 Tỷ',
    price_per_m2_display: '84 tr/m²',
    area_m2: 50,
    latitude: 21.0315,
    longitude: 105.7985,
    property_type: 'can-ho',
    has_video: true,
    video_duration: '0:42',
    contact_phone: '0912345678',
    address_text: 'Số 9 Phạm Văn Đồng, Mai Dịch, Cầu Giấy, Hà Nội',
    is_verified: true,
  },
  {
    id: 'pin-3',
    title: 'Nhà ngõ Trần Thái Tông 38m2 x 3 tầng',
    price_vnd: 3600000000,
    price_display: '3.6 Tỷ',
    price_per_m2_display: '94 tr/m²',
    area_m2: 38,
    latitude: 21.0280,
    longitude: 105.7910,
    property_type: 'nha-pho',
    has_video: false,
    contact_phone: '0903456789',
    address_text: 'Ngõ 44 Trần Thái Tông, Dịch Vọng, Cầu Giấy, Hà Nội',
    is_verified: false,
  },
  {
    id: 'pin-4',
    title: 'Mặt ngõ kinh doanh phố Xuân Thủy',
    price_vnd: 9200000000,
    price_display: '9.2 Tỷ',
    price_per_m2_display: '153 tr/m²',
    area_m2: 60,
    latitude: 21.0380,
    longitude: 105.7930,
    property_type: 'nha-pho',
    has_video: true,
    video_duration: '0:45',
    contact_phone: '0977889900',
    address_text: 'Xuân Thủy, Dịch Vọng Hậu, Cầu Giấy, Hà Nội',
    is_verified: true,
  }
];

export default function App() {
  const mapRef = useRef<MapView>(null);
  const [location, setLocation] = useState<Location.LocationObjectCoords | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPin, setSelectedPin] = useState<PinItem | null>(null);
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [pinsList, setPinsList] = useState<PinItem[]>(SEED_PINS);

  // Supabase Google Auth Hook
  const { user, isAuthenticated, signInWithGoogle, signOut } = useGoogleAuth();

  // Khởi tạo GPS
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Quyền vị trí', 'Vui lòng cấp quyền vị trí để bản đồ tự động bay về khu vực của bạn.');
          setLoading(false);
          return;
        }
        const currentLoc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setLocation(currentLoc.coords);
      } catch (err) {
        console.warn('Lỗi GPS:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Tải danh sách ghim từ Supabase khi mở app hoặc đổi bộ lọc
  const loadPins = async (currentRegion?: Region) => {
    const lat = currentRegion ? currentRegion.latitude : (location ? location.latitude : 21.0335);
    const lng = currentRegion ? currentRegion.longitude : (location ? location.longitude : 105.7942);
    const latDelta = currentRegion ? currentRegion.latitudeDelta : 0.04;
    const lngDelta = currentRegion ? currentRegion.longitudeDelta : 0.04;

    const minLat = lat - latDelta / 2;
    const maxLat = lat + latDelta / 2;
    const minLng = lng - lngDelta / 2;
    const maxLng = lng + lngDelta / 2;

    const hasVideoOnly = activeFilter === 'video';
    const serverPins = await fetchPinsInBounds(minLng, minLat, maxLng, maxLat, activeFilter, hasVideoOnly);

    // null = lỗi kết nối (giữ dữ liệu cũ); [] = vùng này chưa có ghim (hiện trống)
    if (serverPins !== null) {
      setPinsList(serverPins);
    }
  };

  useEffect(() => {
    loadPins();
  }, [activeFilter, location]);

  const centerUserLocation = () => {
    if (location && mapRef.current) {
      mapRef.current.animateToRegion({
        latitude: location.latitude,
        longitude: location.longitude,
        latitudeDelta: 0.015,
        longitudeDelta: 0.015,
      }, 1000);
    } else {
      Alert.alert('Thông báo', 'Đang xác định toạ độ GPS của bạn...');
    }
  };

  const handleCreateNewPin = async (data: NewPinData) => {
    const baseLat = location ? location.latitude : 21.0335;
    const baseLng = location ? location.longitude : 105.7942;
    const defaultUserId = user?.id || '361b7fe7-5586-4239-8329-54f8976b7f07';

    // Lưu vào Supabase PostGIS
    await createPinInSupabase(data, baseLat, baseLng, defaultUserId);

    // Refresh lại ghim trên bản đồ
    await loadPins();
    Alert.alert('Thành công 🎉', 'Ghim bán nhà của bạn đã được lưu vĩnh viễn trên Supabase!');
  };

  const handleCallOwner = (phone: string) => {
    Linking.openURL(`tel:${phone}`);
  };

  const handleZaloOwner = (phone: string) => {
    Linking.openURL(`https://zalo.me/${phone}`);
  };

  const filteredPins = pinsList.filter(p => {
    if (activeFilter === 'video') return p.has_video;
    if (activeFilter === 'nha-pho') return p.property_type === 'nha-pho';
    if (activeFilter === 'can-ho') return p.property_type === 'can-ho';
    return true;
  });

  const initialRegion: Region = {
    latitude: location ? location.latitude : 21.0335,
    longitude: location ? location.longitude : 105.7942,
    latitudeDelta: 0.02,
    longitudeDelta: 0.02,
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Top Floating Header & Filter */}
      <View style={styles.topContainer}>
        <View style={styles.searchRow}>
          <View style={styles.searchBox}>
            <Text style={styles.searchIcon}>🔍</Text>
            <Text style={styles.searchText}>Bản đồ Giá BĐS Việt Nam</Text>
          </View>
          <TouchableOpacity
            style={[styles.avatarButton, isAuthenticated && styles.avatarButtonActive]}
            onPress={() => {
              if (isAuthenticated) {
                Alert.alert(
                  'Tài khoản Google',
                  `Đã đăng nhập: ${user?.email || 'Người dùng'}\nBạn có muốn đăng xuất không?`,
                  [
                    { text: 'Huỷ', style: 'cancel' },
                    { text: 'Đăng xuất', style: 'destructive', onPress: signOut }
                  ]
                );
              } else {
                signInWithGoogle();
              }
            }}
          >
            <Text style={styles.avatarText}>
              {isAuthenticated ? (user?.email?.charAt(0).toUpperCase() || 'U') : 'G'}
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
          <TouchableOpacity
            style={[styles.chip, activeFilter === 'all' && styles.chipActive]}
            onPress={() => setActiveFilter('all')}
          >
            <Text style={[styles.chipText, activeFilter === 'all' && styles.chipTextActive]}>📍 Tất cả</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.chip, activeFilter === 'video' && styles.chipVideoActive]}
            onPress={() => setActiveFilter('video')}
          >
            <Text style={[styles.chipText, activeFilter === 'video' && styles.chipTextActive]}>🎥 Có Video thật</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.chip, activeFilter === 'nha-pho' && styles.chipActive]}
            onPress={() => setActiveFilter('nha-pho')}
          >
            <Text style={[styles.chipText, activeFilter === 'nha-pho' && styles.chipTextActive]}>🏡 Nhà phố</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.chip, activeFilter === 'can-ho' && styles.chipActive]}
            onPress={() => setActiveFilter('can-ho')}
          >
            <Text style={[styles.chipText, activeFilter === 'can-ho' && styles.chipTextActive]}>🏢 Căn hộ</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* Map View */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#10b981" />
          <Text style={styles.loadingText}>Đang tải bản đồ vệ tinh...</Text>
        </View>
      ) : (
        <MapView
          ref={mapRef}
          provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : PROVIDER_DEFAULT}
          style={styles.map}
          initialRegion={initialRegion}
          onRegionChangeComplete={(region) => loadPins(region)}
          showsUserLocation={true}
          showsMyLocationButton={false}
          showsCompass={false}
        >
          {filteredPins.map((pin) => (
            <Marker
              key={pin.id}
              coordinate={{ latitude: pin.latitude, longitude: pin.longitude }}
              onPress={() => setSelectedPin(pin)}
            >
              <View style={[
                styles.pinContainer,
                pin.has_video && styles.pinWithVideo,
                selectedPin?.id === pin.id && styles.pinSelected
              ]}>
                {pin.has_video && <View style={styles.videoDot} />}
                <Text style={styles.pinPriceText}>{pin.price_display}</Text>
              </View>
            </Marker>
          ))}
        </MapView>
      )}

      {/* FAB: Nút định vị GPS và Thêm ghim */}
      <View style={styles.fabContainer}>
        <TouchableOpacity style={styles.fabGps} onPress={centerUserLocation}>
          <Text style={styles.fabGpsText}>🎯</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.fabAdd}
          onPress={() => setCreateModalVisible(true)}
        >
          <Text style={styles.fabAddText}>+</Text>
        </TouchableOpacity>
      </View>

      {/* Bottom Sheet Xem Chi Tiết Ghim */}
      {selectedPin && (
        <View style={styles.bottomSheet}>
          <View style={styles.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetTitle} numberOfLines={2}>{selectedPin.title}</Text>
              {selectedPin.is_verified ? (
                <View style={styles.badgeVerified}>
                  <Text style={styles.badgeText}>✓ Chính chủ xác thực</Text>
                </View>
              ) : null}
            </View>
            <TouchableOpacity onPress={() => setSelectedPin(null)} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Hộp Giá & Đơn Giá / m2 */}
          <View style={styles.priceRow}>
            <View style={styles.priceBox}>
              <Text style={styles.priceLabel}>GIÁ CHỦ NHÀ RAO</Text>
              <Text style={styles.priceValue}>{selectedPin.price_display}</Text>
            </View>
            <View style={styles.priceBox}>
              <Text style={styles.priceLabel}>ĐƠN GIÁ / M²</Text>
              <Text style={styles.unitPriceValue}>{selectedPin.price_per_m2_display}</Text>
            </View>
            <View style={styles.priceBox}>
              <Text style={styles.priceLabel}>DIỆN TÍCH</Text>
              <Text style={styles.areaValue}>{selectedPin.area_m2} m²</Text>
            </View>
          </View>

          <Text style={styles.addressText}>📍 {selectedPin.address_text}</Text>

          {selectedPin.has_video && (
            <TouchableOpacity
              style={styles.videoBanner}
              onPress={() => Alert.alert('Video thực tế', `Đang mở trình phát video thực tế căn nhà (${selectedPin.video_duration}).`)}
            >
              <Text style={styles.videoBannerText}>▶ Xem Video quay thực tế ({selectedPin.video_duration})</Text>
            </TouchableOpacity>
          )}

          {/* Action Call & Zalo */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.callBtn}
              onPress={() => handleCallOwner(selectedPin.contact_phone)}
            >
              <Text style={styles.btnText}>📞 Gọi chủ nhà</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.zaloBtn}
              onPress={() => handleZaloOwner(selectedPin.contact_phone)}
            >
              <Text style={styles.btnText}>💬 Nhắn Zalo</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Modal Đăng Ghim Cho Chủ Nhà (Ảnh & Video) */}
      <CreatePinModal
        visible={createModalVisible}
        onClose={() => setCreateModalVisible(false)}
        onSubmit={handleCreateNewPin}
        currentCoords={location}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  map: {
    width: '100%',
    height: '100%',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f172a',
  },
  loadingText: {
    color: '#94a3b8',
    marginTop: 12,
    fontSize: 14,
  },
  topContainer: {
    position: 'absolute',
    top: 40,
    left: 16,
    right: 16,
    zIndex: 10,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchBox: {
    flex: 1,
    height: 46,
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    borderRadius: 23,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    elevation: 4,
  },
  searchIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  searchText: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '600',
  },
  avatarButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#3b82f6',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
    borderWidth: 2,
    borderColor: '#ffffff',
    elevation: 4,
  },
  avatarButtonActive: {
    backgroundColor: '#10b981',
  },
  avatarText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  filterScroll: {
    marginTop: 10,
  },
  chip: {
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 18,
    marginRight: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  chipActive: {
    backgroundColor: '#2563eb',
    borderColor: '#3b82f6',
  },
  chipVideoActive: {
    backgroundColor: '#e11d48',
    borderColor: '#f43f5e',
  },
  chipText: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#ffffff',
  },
  pinContainer: {
    backgroundColor: '#0f172a',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 2,
    borderColor: '#3b82f6',
    flexDirection: 'row',
    alignItems: 'center',
    elevation: 5,
  },
  pinWithVideo: {
    borderColor: '#f43f5e',
  },
  pinSelected: {
    borderColor: '#10b981',
    transform: [{ scale: 1.15 }],
  },
  videoDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#f43f5e',
    marginRight: 5,
  },
  pinPriceText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 12,
  },
  fabContainer: {
    position: 'absolute',
    right: 16,
    bottom: 30,
    alignItems: 'center',
  },
  fabGps: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    marginBottom: 12,
    elevation: 4,
  },
  fabGpsText: {
    fontSize: 20,
  },
  fabAdd: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#10b981',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
  },
  fabAddText: {
    color: '#ffffff',
    fontSize: 30,
    fontWeight: '300',
    marginTop: -2,
  },
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
    elevation: 10,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  sheetTitle: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '700',
  },
  badgeVerified: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginTop: 4,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.4)',
  },
  badgeText: {
    color: '#10b981',
    fontSize: 11,
    fontWeight: '700',
  },
  closeBtn: {
    padding: 4,
    marginLeft: 8,
  },
  closeBtnText: {
    color: '#94a3b8',
    fontSize: 18,
  },
  priceRow: {
    flexDirection: 'row',
    backgroundColor: '#1e293b',
    borderRadius: 14,
    padding: 12,
    marginTop: 14,
    justifyContent: 'space-around',
  },
  priceBox: {
    alignItems: 'center',
  },
  priceLabel: {
    color: '#94a3b8',
    fontSize: 9,
    fontWeight: '700',
  },
  priceValue: {
    color: '#10b981',
    fontSize: 16,
    fontWeight: '800',
    marginTop: 2,
  },
  unitPriceValue: {
    color: '#38bdf8',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 2,
  },
  areaValue: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 2,
  },
  addressText: {
    color: '#cbd5e1',
    fontSize: 12,
    marginTop: 12,
  },
  videoBanner: {
    backgroundColor: 'rgba(225, 29, 72, 0.15)',
    borderWidth: 1,
    borderColor: '#f43f5e',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 10,
    alignItems: 'center',
  },
  videoBannerText: {
    color: '#fb7185',
    fontSize: 12,
    fontWeight: '700',
  },
  actionRow: {
    flexDirection: 'row',
    marginTop: 16,
    gap: 10,
  },
  callBtn: {
    flex: 1,
    height: 44,
    backgroundColor: '#2563eb',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zaloBtn: {
    flex: 1,
    height: 44,
    backgroundColor: '#0068ff',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
});
