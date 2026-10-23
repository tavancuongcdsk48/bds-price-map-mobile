import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  ScrollView,
  Alert,
  Image
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';

interface CreatePinModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (pinData: NewPinData) => void;
  currentCoords: { latitude: number; longitude: number } | null;
  /** Toạ độ người dùng đã chọn thủ công trên bản đồ (null = dùng GPS) */
  pickedCoords?: { latitude: number; longitude: number } | null;
  /** Mở màn hình chọn vị trí trên bản đồ */
  onRequestPickLocation: () => void;
}

export interface NewPinData {
  title: string;
  price_vnd: number;
  area_m2: number;
  property_type: 'nha-pho' | 'can-ho' | 'dat-nen';
  contact_phone: string;
  address_text: string;
  images: string[];
  video_uri?: string;
}

export const CreatePinModal: React.FC<CreatePinModalProps> = ({
  visible,
  onClose,
  onSubmit,
  currentCoords,
  pickedCoords,
  onRequestPickLocation,
}) => {
  const [title, setTitle] = useState('');
  const [priceBillion, setPriceBillion] = useState('');
  const [area, setArea] = useState('');
  const [propertyType, setPropertyType] = useState<'nha-pho' | 'can-ho' | 'dat-nen'>('nha-pho');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [videoUri, setVideoUri] = useState<string | null>(null);

  // Chọn ảnh từ máy (Tối đa 6 ảnh)
  const pickImages = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Quyền truy cập', 'Vui lòng cấp quyền truy cập thư viện ảnh để đăng hình nhà.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: 6,
      quality: 0.8,
    });

    if (!result.canceled && result.assets) {
      const selectedUris = result.assets.map(a => a.uri);
      setImages(prev => [...prev, ...selectedUris].slice(0, 6));
    }
  };

  // Chọn video thực tế (Tối đa 45s)
  const pickVideo = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Quyền truy cập', 'Vui lòng cấp quyền truy cập để chọn video thực tế.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      videoMaxDuration: 45,
      quality: 0.7,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      setVideoUri(result.assets[0].uri);
    }
  };

  const handleSave = () => {
    const priceNum = parseFloat(priceBillion);
    const areaNum = parseFloat(area);

    if (!title.trim()) {
      Alert.alert('Thiếu thông tin', 'Vui lòng nhập tiêu đề ghim nhà.');
      return;
    }
    if (isNaN(priceNum) || priceNum <= 0) {
      Alert.alert('Sai giá bán', 'Vui lòng nhập giá bán hợp lệ (tính theo Tỷ VND).');
      return;
    }
    if (isNaN(areaNum) || areaNum <= 0) {
      Alert.alert('Sai diện tích', 'Vui lòng nhập diện tích hợp lệ (m²).');
      return;
    }
    if (!phone.trim() || phone.length < 9) {
      Alert.alert('Sai số điện thoại', 'Vui lòng nhập số điện thoại liên hệ chính xác.');
      return;
    }

    const priceVnd = Math.round(priceNum * 1000000000);

    onSubmit({
      title: title.trim(),
      price_vnd: priceVnd,
      area_m2: areaNum,
      property_type: propertyType,
      contact_phone: phone.trim(),
      address_text: address.trim() || 'Ghim theo toạ độ bản đồ',
      images: images,
      video_uri: videoUri || undefined,
    });

    // Reset Form
    setTitle('');
    setPriceBillion('');
    setArea('');
    setPhone('');
    setAddress('');
    setImages([]);
    setVideoUri(null);
    onClose();
  };

  // Tính nhẩm đơn giá triệu / m2
  const calcUnitPrice = () => {
    const p = parseFloat(priceBillion);
    const a = parseFloat(area);
    if (!isNaN(p) && !isNaN(a) && a > 0) {
      const unit = (p * 1000) / a;
      return unit.toFixed(1) + ' tr/m²';
    }
    return '0 tr/m²';
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Đăng Ghim Bán Nhà Mới</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} style={styles.formScroll}>
            <Text style={styles.label}>Tiêu đề mô tả căn nhà *</Text>
            <TextInput
              style={styles.input}
              placeholder="VD: Bán nhà 4 tầng Cầu Giấy, ngõ thông ô tô"
              placeholderTextColor="#64748b"
              value={title}
              onChangeText={setTitle}
            />

            <View style={styles.row}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.label}>Giá bán (Tỷ VND) *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="VD: 6.8"
                  placeholderTextColor="#64748b"
                  keyboardType="numeric"
                  value={priceBillion}
                  onChangeText={setPriceBillion}
                />
              </View>

              <View style={{ flex: 1, marginLeft: 8 }}>
                <Text style={styles.label}>Diện tích (m²) *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="VD: 55"
                  placeholderTextColor="#64748b"
                  keyboardType="numeric"
                  value={area}
                  onChangeText={setArea}
                />
              </View>
            </View>

            {/* Hiển thị tính nhẩm giá/m2 */}
            <View style={styles.calcBox}>
              <Text style={styles.calcLabel}>Ước tính đơn giá:</Text>
              <Text style={styles.calcValue}>{calcUnitPrice()}</Text>
            </View>

            <Text style={styles.label}>Loại hình bất động sản</Text>
            <View style={styles.typeSelector}>
              {(['nha-pho', 'can-ho', 'dat-nen'] as const).map(type => (
                <TouchableOpacity
                  key={type}
                  style={[styles.typeBtn, propertyType === type && styles.typeBtnActive]}
                  onPress={() => setPropertyType(type)}
                >
                  <Text style={[styles.typeBtnText, propertyType === type && styles.typeBtnTextActive]}>
                    {type === 'nha-pho' ? '🏡 Nhà phố' : type === 'can-ho' ? '🏢 Căn hộ' : '🌾 Đất nền'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Số điện thoại chính chủ (Zalo) *</Text>
            <TextInput
              style={styles.input}
              placeholder="VD: 0988123456"
              placeholderTextColor="#64748b"
              keyboardType="phone-pad"
              value={phone}
              onChangeText={setPhone}
            />

            <Text style={styles.label}>Địa chỉ đường phố (tuỳ chọn)</Text>
            <TextInput
              style={styles.input}
              placeholder="VD: Ngõ 68 Quan Hoa, Cầu Giấy"
              placeholderTextColor="#64748b"
              value={address}
              onChangeText={setAddress}
            />

            {/* Vị trí ghim: GPS hoặc tự đặt trên bản đồ */}
            <Text style={styles.label}>Vị trí ghim trên bản đồ</Text>
            <TouchableOpacity style={styles.locationRow} onPress={onRequestPickLocation}>
              <View style={{ flex: 1 }}>
                <Text style={styles.locationTitle}>
                  {pickedCoords ? '📌 Vị trí tự chọn' : '📍 Vị trí hiện tại (GPS)'}
                </Text>
                <Text style={styles.locationSub}>
                  {pickedCoords
                    ? `${pickedCoords.latitude.toFixed(6)}, ${pickedCoords.longitude.toFixed(6)}`
                    : currentCoords
                    ? `${currentCoords.latitude.toFixed(6)}, ${currentCoords.longitude.toFixed(6)}`
                    : 'Chưa có GPS — bấm để chọn trên bản đồ'}
                </Text>
              </View>
              <Text style={styles.locationAction}>
                {pickedCoords ? 'Đổi' : 'Chọn'}
              </Text>
            </TouchableOpacity>
            <Text style={styles.locationHint}>
              Không đứng tại căn nhà vẫn đặt được: bấm “Chọn” rồi kéo bản đồ cho tâm ngắm vào đúng vị trí.
            </Text>

            {/* Chọn Ảnh & Video */}
            <Text style={styles.label}>Ảnh thực tế căn nhà (Tối đa 6 ảnh)</Text>
            <View style={styles.mediaRow}>
              <TouchableOpacity style={styles.addMediaBtn} onPress={pickImages}>
                <Text style={styles.addMediaIcon}>📷</Text>
                <Text style={styles.addMediaText}>Thêm ảnh ({images.length}/6)</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.addMediaBtn, videoUri ? styles.addMediaBtnActive : null]}
                onPress={pickVideo}
              >
                <Text style={styles.addMediaIcon}>🎥</Text>
                <Text style={styles.addMediaText}>
                  {videoUri ? 'Đã có video 45s ✓' : 'Thêm video'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Thumbnail Preview */}
            {images.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbScroll}>
                {images.map((uri, idx) => (
                  <View key={idx} style={styles.thumbWrapper}>
                    <Image source={{ uri }} style={styles.thumbImage} />
                    <TouchableOpacity
                      style={styles.delThumbBtn}
                      onPress={() => setImages(images.filter((_, i) => i !== idx))}
                    >
                      <Text style={styles.delThumbText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            )}

            <View style={styles.privacyNote}>
              <Text style={styles.privacyText}>
                🛡️ Toạ độ hiển thị công khai sẽ được tự động làm mờ 50–100m để bảo vệ sự riêng tư của gia đình bạn theo quy định pháp lý.
              </Text>
            </View>

            <TouchableOpacity style={styles.submitBtn} onPress={handleSave}>
              <Text style={styles.submitBtnText}>Xác nhận Ghim lên Bản đồ</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    maxHeight: '90%',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '800',
  },
  closeBtn: {
    padding: 6,
  },
  closeBtnText: {
    color: '#94a3b8',
    fontSize: 20,
  },
  formScroll: {
    marginBottom: 20,
  },
  label: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#ffffff',
    fontSize: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  row: {
    flexDirection: 'row',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.35)',
    gap: 10,
  },
  locationTitle: { color: '#f1f5f9', fontSize: 13, fontWeight: '600' },
  locationSub: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 3,
    fontVariant: ['tabular-nums'],
  },
  locationAction: { color: '#22c55e', fontSize: 13, fontWeight: '700' },
  locationHint: { color: '#64748b', fontSize: 11, marginTop: 6, lineHeight: 16 },
  calcBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 8,
  },
  calcLabel: {
    color: '#94a3b8',
    fontSize: 12,
  },
  calcValue: {
    color: '#10b981',
    fontSize: 14,
    fontWeight: '800',
  },
  typeSelector: {
    flexDirection: 'row',
    gap: 8,
  },
  typeBtn: {
    flex: 1,
    paddingVertical: 10,
    backgroundColor: '#1e293b',
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  typeBtnActive: {
    backgroundColor: '#2563eb',
    borderColor: '#3b82f6',
  },
  typeBtnText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
  },
  typeBtnTextActive: {
    color: '#ffffff',
  },
  mediaRow: {
    flexDirection: 'row',
    gap: 10,
  },
  addMediaBtn: {
    flex: 1,
    height: 70,
    backgroundColor: '#1e293b',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addMediaBtnActive: {
    borderColor: '#f43f5e',
    backgroundColor: 'rgba(225, 29, 72, 0.15)',
  },
  addMediaIcon: {
    fontSize: 22,
  },
  addMediaText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
  },
  thumbScroll: {
    marginTop: 10,
  },
  thumbWrapper: {
    position: 'relative',
    marginRight: 10,
  },
  thumbImage: {
    width: 70,
    height: 70,
    borderRadius: 10,
  },
  delThumbBtn: {
    position: 'absolute',
    top: -5,
    right: -5,
    backgroundColor: '#ef4444',
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  delThumbText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
  },
  privacyNote: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderRadius: 10,
    padding: 10,
    marginTop: 14,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  privacyText: {
    color: '#fbbf24',
    fontSize: 11,
    lineHeight: 16,
  },
  submitBtn: {
    backgroundColor: '#10b981',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 18,
  },
  submitBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
});
