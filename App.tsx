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
  Platform,
  TextInput
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, PROVIDER_DEFAULT, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { useGoogleAuth } from './src/hooks/useGoogleAuth';
import { CreatePinModal, NewPinData } from './src/components/CreatePinModal';
import {
  fetchPinsInBounds,
  searchPinsByText,
  createPinInSupabase,
  updatePinPrice,
  fetchPriceHistory,
  PinItem,
  PriceHistoryPoint
} from './src/services/pinService';
import { searchPlaces, PlaceResult } from './src/services/placeSearch';

type SearchRow = {
  key: string;
  kind: 'pin' | 'place';
  label: string;
  sub: string;
  latitude: number;
  longitude: number;
  pin?: PinItem;
};

const DEMO_USER_ID = '361b7fe7-5586-4239-8329-54f8976b7f07';

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
  // Toạ độ người đăng tự chọn trên bản đồ (null = dùng GPS)
  const [pickedCoords, setPickedCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  // Chế độ đặt ghim thủ công: dùng chính bản đồ chính, không mở bản đồ thứ hai
  const [pickMode, setPickMode] = useState(false);
  const [pickCenter, setPickCenter] = useState<{ latitude: number; longitude: number } | null>(null);

  // Thanh tìm kiếm: khu vực, dự án, xã/huyện/tỉnh + ghim trong hệ thống
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchRow[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<any>(null);

  // Lịch sử giá của ghim đang mở
  const [priceHistory, setPriceHistory] = useState<PriceHistoryPoint[]>([]);
  const [priceEditVisible, setPriceEditVisible] = useState(false);
  const [priceInput, setPriceInput] = useState('');
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

    const serverPins = await fetchPinsInBounds(minLng, minLat, maxLng, maxLat, activeFilter);

    // null = lỗi kết nối (giữ dữ liệu cũ); [] = vùng này chưa có ghim (hiện trống)
    if (serverPins !== null) {
      setPinsList(serverPins);
    }
  };

  useEffect(() => {
    loadPins();
  }, [activeFilter, location]);

  // Mỗi khi mở một ghim khác, nạp lịch sử giá của ghim đó
  useEffect(() => {
    if (selectedPin?.id) {
      loadPriceHistory(selectedPin.id);
    } else {
      setPriceHistory([]);
    }
  }, [selectedPin?.id]);

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
    // Ưu tiên toạ độ người đăng tự chọn, sau đó mới tới GPS
    const baseLat = pickedCoords?.latitude ?? (location ? location.latitude : 21.0335);
    const baseLng = pickedCoords?.longitude ?? (location ? location.longitude : 105.7942);
    const defaultUserId = user?.id || '361b7fe7-5586-4239-8329-54f8976b7f07';

    // Lưu vào Supabase PostGIS
    const saved = await createPinInSupabase(data, baseLat, baseLng, defaultUserId);

    // Refresh lại ghim trên bản đồ
    await loadPins();

    if (saved) {
      setPickedCoords(null);
      Alert.alert('Thành công 🎉', 'Ghim bán nhà của bạn đã được lưu vĩnh viễn trên Supabase!');
    } else {
      Alert.alert(
        'Chưa lưu được',
        'Máy chủ từ chối lưu ghim. Kiểm tra kết nối Wi-Fi tới Supabase rồi thử lại.'
      );
    }
  };

  const startPickMode = () => {
    const start =
      pickedCoords ??
      (location ? { latitude: location.latitude, longitude: location.longitude } : { latitude: 21.0335, longitude: 105.7942 });
    setPickCenter(start);
    setCreateModalVisible(false);
    setPickMode(true);
    mapRef.current?.animateToRegion(
      { latitude: start.latitude, longitude: start.longitude, latitudeDelta: 0.0025, longitudeDelta: 0.0025 },
      400
    );
  };

  const confirmPickMode = () => {
    if (pickCenter) setPickedCoords(pickCenter);
    setPickMode(false);
    setCreateModalVisible(true);
  };

  const cancelPickMode = () => {
    setPickMode(false);
    setCreateModalVisible(true);
  };

  // ---------- Tìm kiếm khu vực / dự án / ghim ----------
  const runSearch = async (q: string) => {
    if (q.trim().length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const [pins, places] = await Promise.all([searchPinsByText(q), searchPlaces(q)]);

    const rows: SearchRow[] = [
      ...pins.map((pin) => ({
        key: `pin-${pin.id}`,
        kind: 'pin' as const,
        label: pin.title,
        sub: `${pin.price_display} · ${pin.address_text}`,
        latitude: pin.latitude,
        longitude: pin.longitude,
        pin,
      })),
      ...places.map((pl: PlaceResult, i: number) => ({
        key: `place-${pl.id}-${i}`,
        kind: 'place' as const,
        label: pl.label,
        sub: pl.sub || 'Địa điểm',
        latitude: pl.latitude,
        longitude: pl.longitude,
      })),
    ];

    setSearchResults(rows);
    setSearching(false);
  };

  const handleSearchChange = (text: string) => {
    setSearchQuery(text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (text.trim().length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimer.current = setTimeout(() => runSearch(text), 450);
  };

  const clearSearch = () => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    setSearchQuery('');
    setSearchResults([]);
    setSearching(false);
  };

  const handleSelectSearchResult = (row: SearchRow) => {
    setSearchResults([]);
    setSearchQuery(row.label);
    const delta = row.kind === 'pin' ? 0.006 : 0.04;
    mapRef.current?.animateToRegion(
      {
        latitude: row.latitude,
        longitude: row.longitude,
        latitudeDelta: delta,
        longitudeDelta: delta,
      },
      600
    );
    if (row.pin) setSelectedPin(row.pin);
  };

  // ---------- Lịch sử giá ----------
  const loadPriceHistory = (pinId: string) => {
    fetchPriceHistory(pinId).then(setPriceHistory).catch(() => setPriceHistory([]));
  };

  const openPriceEditor = () => {
    if (!selectedPin) return;
    setPriceInput((selectedPin.price_vnd / 1000000000).toFixed(2));
    setPriceEditVisible(true);
  };

  const savePriceEdit = async () => {
    if (!selectedPin) return;
    const billions = parseFloat(priceInput.replace(',', '.'));
    if (isNaN(billions) || billions <= 0) {
      Alert.alert('Giá chưa hợp lệ', 'Nhập giá theo đơn vị tỷ, ví dụ 6.85');
      return;
    }
    const newPrice = Math.round(billions * 1000000000);
    const ok = await updatePinPrice(selectedPin.id, newPrice);
    if (!ok) {
      Alert.alert('Chưa lưu được', 'Máy chủ từ chối cập nhật giá. Kiểm tra kết nối rồi thử lại.');
      return;
    }

    const updated: PinItem = {
      ...selectedPin,
      price_vnd: newPrice,
      price_display: (newPrice / 1000000000).toFixed(1) + ' Tỷ',
      price_per_m2_display: Math.round(newPrice / selectedPin.area_m2 / 1000000) + ' tr/m²',
    };
    setPriceEditVisible(false);
    setSelectedPin(updated);
    setPinsList((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    loadPriceHistory(updated.id);
  };

  const handleCallOwner = (phone: string) => {
    Linking.openURL(`tel:${phone}`);
  };

  const handleZaloOwner = (phone: string) => {
    Linking.openURL(`https://zalo.me/${phone}`);
  };

  const filteredPins = pinsList.filter(p => {
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
      {!pickMode && (
      <View style={styles.topContainer}>
        <View style={styles.searchRow}>
          <View style={styles.searchBox}>
            <Text style={styles.searchIcon}>🔍</Text>
            <TextInput
              style={styles.searchInput}
              placeholder="Tìm khu vực, dự án, đường, xã/huyện/tỉnh..."
              placeholderTextColor="#7c8aa0"
              value={searchQuery}
              onChangeText={handleSearchChange}
              returnKeyType="search"
              autoCorrect={false}
              clearButtonMode="while-editing"
            />
            {searching && <ActivityIndicator size="small" color="#22c55e" />}
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

        {(searchResults.length > 0 || searchQuery.trim().length >= 2) && (
          <View style={styles.searchResults}>
            {searchResults.length === 0 ? (
              <Text style={styles.searchEmpty}>
                {searching ? 'Đang tìm...' : 'Không tìm thấy khu vực hoặc ghim nào khớp'}
              </Text>
            ) : (
              <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 300 }}>
                {searchResults.map((r) => (
                  <TouchableOpacity
                    key={r.key}
                    style={styles.searchResultRow}
                    onPress={() => handleSelectSearchResult(r)}
                  >
                    <Text style={styles.searchResultIcon}>{r.kind === 'pin' ? '📌' : '📍'}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.searchResultLabel} numberOfLines={1}>
                        {r.label}
                      </Text>
                      <Text style={styles.searchResultSub} numberOfLines={1}>
                        {r.sub}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
            <TouchableOpacity style={styles.searchClose} onPress={clearSearch}>
              <Text style={styles.searchCloseText}>Đóng</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.chipRow}>
          {[
            { key: 'all', label: 'Tất cả' },
            { key: 'nha-pho', label: 'Nhà phố' },
            { key: 'can-ho', label: 'Căn hộ' },
            { key: 'dat-nen', label: 'Đất nền' },
          ].map((tab) => (
            <TouchableOpacity
              key={tab.key}
              style={[styles.chipTab, activeFilter === tab.key && styles.chipActive]}
              onPress={() => setActiveFilter(tab.key)}
            >
              <Text
                style={[styles.chipText, activeFilter === tab.key && styles.chipTextActive]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.85}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      )}

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
          onRegionChangeComplete={(region) => {
            loadPins(region);
            if (pickMode) {
              setPickCenter({ latitude: region.latitude, longitude: region.longitude });
            }
          }}
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

      {/* Chế độ đặt ghim thủ công: tâm ngắm trên chính bản đồ chính */}
      {pickMode && (
        <>
          <View pointerEvents="none" style={styles.pickCrosshairWrap}>
            <View style={styles.pickCrosshairRing} />
            <View style={styles.pickCrosshairH} />
            <View style={styles.pickCrosshairV} />
          </View>

          <View style={styles.pickBanner}>
            <Text style={styles.pickBannerTitle}>Đặt ghim đúng căn nhà</Text>
            <Text style={styles.pickBannerHint}>
              Kéo bản đồ cho tâm ngắm xanh nằm đúng vị trí căn nhà. Không cần đứng tại đó.
            </Text>
          </View>

          <View style={styles.pickCard}>
            <Text style={styles.pickCoordLabel}>Toạ độ tâm ngắm</Text>
            <Text style={styles.pickCoordValue}>
              {pickCenter
                ? `${pickCenter.latitude.toFixed(6)}, ${pickCenter.longitude.toFixed(6)}`
                : 'Đang xác định...'}
            </Text>
            <Text style={styles.pickPrivacy}>
              🛡️ Bản công khai chỉ hiện vị trí đã làm mờ 50–100m.
            </Text>

            <View style={styles.pickBtnRow}>
              <TouchableOpacity style={styles.pickCancelBtn} onPress={cancelPickMode}>
                <Text style={styles.pickCancelText}>Huỷ</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.pickConfirmBtn} onPress={confirmPickMode}>
                <Text style={styles.pickConfirmText}>Chọn vị trí này</Text>
              </TouchableOpacity>
            </View>
          </View>
        </>
      )}

      {/* FAB: Nút định vị GPS và Thêm ghim */}
      {!pickMode && (
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
      )}

      {/* Bottom Sheet Xem Chi Tiết Ghim */}
      {selectedPin && !pickMode && (
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

          {/* Lịch sử giá — nền dữ liệu cho biểu đồ giá theo tháng/năm */}
          {priceHistory.length > 0 && (
            <View style={styles.historyBox}>
              <View style={styles.historyHead}>
                <Text style={styles.historyTitle}>Lịch sử giá</Text>
                <Text style={styles.historyCount}>{priceHistory.length} lần cập nhật</Text>
              </View>

              <View style={styles.chartRow}>
                {priceHistory.slice(-8).map((h, idx, arr) => {
                  const max = Math.max(...arr.map((x) => x.price_vnd));
                  const min = Math.min(...arr.map((x) => x.price_vnd));
                  const ratio = max === min ? 0.6 : 0.3 + ((h.price_vnd - min) / (max - min)) * 0.7;
                  const isLast = idx === arr.length - 1;
                  return (
                    <View key={`${h.created_at}-${idx}`} style={styles.chartCol}>
                      <Text style={styles.chartValue}>{(h.price_vnd / 1000000000).toFixed(1)}</Text>
                      <View
                        style={[
                          styles.chartBar,
                          { height: Math.round(46 * ratio), backgroundColor: isLast ? '#22c55e' : '#334155' },
                        ]}
                      />
                      <Text style={styles.chartLabel}>
                        {new Date(h.created_at).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* Chủ ghim được sửa giá */}
          {(selectedPin.user_id ?? DEMO_USER_ID) === (user?.id || DEMO_USER_ID) && (
            <TouchableOpacity style={styles.editPriceBtn} onPress={openPriceEditor}>
              <Text style={styles.editPriceText}>✏️ Cập nhật giá rao bán</Text>
            </TouchableOpacity>
          )}

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

      {/* Cập nhật giá — mỗi lần lưu là một mốc lịch sử giá */}
      {priceEditVisible && (
        <View style={styles.priceEditBackdrop}>
          <View style={styles.priceEditCard}>
            <Text style={styles.priceEditTitle}>Cập nhật giá rao bán</Text>
            <Text style={styles.priceEditSub}>
              Mỗi lần đổi giá được lưu thành một mốc lịch sử, sau này dựng biểu đồ giá theo tháng/năm cho
              chính vị trí này.
            </Text>

            <View style={styles.priceEditInputRow}>
              <TextInput
                style={styles.priceEditInput}
                keyboardType="decimal-pad"
                value={priceInput}
                onChangeText={setPriceInput}
                autoFocus
                selectTextOnFocus
              />
              <Text style={styles.priceEditUnit}>tỷ</Text>
            </View>

            <View style={styles.priceEditBtns}>
              <TouchableOpacity
                style={styles.priceEditCancel}
                onPress={() => setPriceEditVisible(false)}
              >
                <Text style={styles.priceEditCancelText}>Huỷ</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.priceEditSave} onPress={savePriceEdit}>
                <Text style={styles.priceEditSaveText}>Lưu giá mới</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* Modal Đăng Ghim Cho Chủ Nhà (Ảnh & Video) */}
      <CreatePinModal
        visible={createModalVisible && !pickMode}
        onClose={() => setCreateModalVisible(false)}
        onSubmit={handleCreateNewPin}
        currentCoords={location}
        pickedCoords={pickedCoords}
        onRequestPickLocation={startPickMode}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  chipRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 10,
  },
  chipTab: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 10,
    backgroundColor: 'rgba(30,41,59,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  searchInput: {
    flex: 1,
    color: '#f8fafc',
    fontSize: 14,
    paddingVertical: 0,
    marginLeft: 6,
  },
  searchResults: {
    marginTop: 8,
    backgroundColor: 'rgba(15,23,42,0.98)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1e293b',
    paddingVertical: 4,
    overflow: 'hidden',
  },
  searchEmpty: { color: '#94a3b8', fontSize: 13, paddingHorizontal: 14, paddingVertical: 12 },
  searchResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1e293b',
  },
  searchResultIcon: { fontSize: 14 },
  searchResultLabel: { color: '#f1f5f9', fontSize: 13, fontWeight: '600' },
  searchResultSub: { color: '#94a3b8', fontSize: 11, marginTop: 2 },
  searchClose: { alignItems: 'center', paddingVertical: 8 },
  searchCloseText: { color: '#64748b', fontSize: 12 },

  historyBox: {
    marginTop: 12,
    backgroundColor: 'rgba(15,23,42,0.6)',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  historyHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  historyTitle: { color: '#e2e8f0', fontSize: 12, fontWeight: '700' },
  historyCount: { color: '#64748b', fontSize: 11 },
  chartRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  chartCol: { alignItems: 'center', flex: 1 },
  chartValue: { color: '#94a3b8', fontSize: 9, marginBottom: 4 },
  chartBar: { width: '62%', borderRadius: 4, minHeight: 6 },
  chartLabel: { color: '#64748b', fontSize: 9, marginTop: 4 },

  editPriceBtn: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.5)',
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
    backgroundColor: 'rgba(34,197,94,0.12)',
  },
  editPriceText: { color: '#22c55e', fontSize: 13, fontWeight: '700' },

  priceEditBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(2,6,23,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    zIndex: 300,
    elevation: 300,
  },
  priceEditCard: {
    width: '100%',
    backgroundColor: '#111c33',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  priceEditTitle: { color: '#f8fafc', fontSize: 16, fontWeight: '700' },
  priceEditSub: { color: '#94a3b8', fontSize: 12, marginTop: 6, lineHeight: 17 },
  priceEditInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    backgroundColor: '#1e293b',
    borderRadius: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  priceEditInput: { flex: 1, color: '#ffffff', fontSize: 22, fontWeight: '700', paddingVertical: 12 },
  priceEditUnit: { color: '#94a3b8', fontSize: 14, fontWeight: '600' },
  priceEditBtns: { flexDirection: 'row', gap: 10, marginTop: 16 },
  priceEditCancel: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    backgroundColor: '#1e293b',
  },
  priceEditCancelText: { color: '#e2e8f0', fontSize: 13, fontWeight: '600' },
  priceEditSave: {
    flex: 1.5,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    backgroundColor: '#22c55e',
  },
  priceEditSaveText: { color: '#052e16', fontSize: 14, fontWeight: '800' },

  pickCrosshairWrap: {
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
  pickCrosshairRing: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: '#22c55e',
    backgroundColor: 'rgba(34,197,94,0.15)',
  },
  pickCrosshairH: { position: 'absolute', width: 56, height: 2, backgroundColor: '#22c55e' },
  pickCrosshairV: { position: 'absolute', height: 56, width: 2, backgroundColor: '#22c55e' },
  pickBanner: {
    position: 'absolute',
    top: 12,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(15,23,42,0.94)',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  pickBannerTitle: { color: '#f8fafc', fontSize: 15, fontWeight: '700' },
  pickBannerHint: { color: '#94a3b8', fontSize: 12, marginTop: 4, lineHeight: 17 },
  pickCard: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
    backgroundColor: '#111c33',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  pickCoordLabel: { color: '#94a3b8', fontSize: 11 },
  pickCoordValue: {
    color: '#f1f5f9',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  pickPrivacy: { color: '#64748b', fontSize: 11, marginTop: 8, lineHeight: 16 },
  pickBtnRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  pickCancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    backgroundColor: '#1e293b',
  },
  pickCancelText: { color: '#e2e8f0', fontSize: 13, fontWeight: '600' },
  pickConfirmBtn: {
    flex: 1.6,
    backgroundColor: '#22c55e',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  pickConfirmText: { color: '#052e16', fontSize: 14, fontWeight: '800' },
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
