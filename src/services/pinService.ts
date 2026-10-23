import { supabase } from '../lib/supabase';
import { NewPinData } from '../components/CreatePinModal';

export interface PinItem {
  id: string;
  title: string;
  price_vnd: number;
  price_display: string;
  price_per_m2_display: string;
  area_m2: number;
  latitude: number;
  longitude: number;
  property_type: 'nha-pho' | 'can-ho' | 'dat-nen';
  has_video: boolean;
  video_duration?: string;
  contact_phone: string;
  address_text: string;
  is_verified: boolean;
}

// 1. Lấy danh sách ghim trong khung nhìn (Viewport Bounding Box)
export async function fetchPinsInBounds(
  minLng: number,
  minLat: number,
  maxLng: number,
  maxLat: number,
  propertyType?: string,
  hasVideoOnly?: boolean
): Promise<PinItem[]> {
  try {
    const { data, error } = await supabase.rpc('get_pins_in_bounds', {
      min_lng: minLng,
      min_lat: minLat,
      max_lng: maxLng,
      max_lat: maxLat,
      p_type: propertyType && propertyType !== 'all' && propertyType !== 'video' ? propertyType : null,
      has_video_only: hasVideoOnly || false,
    });

    if (error) {
      console.warn('Supabase RPC Error:', error.message);
      return [];
    }

    if (!data) return [];

    return data.map((item: any) => ({
      id: item.id,
      title: item.title,
      price_vnd: item.price_vnd,
      price_display: (Number(item.price_vnd) / 1000000000).toFixed(1) + ' Tỷ',
      price_per_m2_display: (Number(item.price_per_m2) / 1000000).toFixed(0) + ' tr/m²',
      area_m2: Number(item.area_m2),
      latitude: item.latitude,
      longitude: item.longitude,
      property_type: item.property_type,
      has_video: item.has_video,
      video_duration: item.has_video ? '0:45' : undefined,
      contact_phone: item.contact_phone,
      address_text: item.address_text,
      is_verified: true,
    }));
  } catch (err) {
    console.warn('Lỗi kết nối fetchPinsInBounds:', err);
    return [];
  }
}

// 2. Thêm ghim mới vào Database Supabase PostGIS
export async function createPinInSupabase(
  data: NewPinData,
  lat: number,
  lng: number,
  userId: string
): Promise<boolean> {
  try {
    // Làm mờ toạ độ công khai 50-80m để bảo vệ quyền riêng tư
    const jitterLat = (Math.random() - 0.5) * 0.001;
    const jitterLng = (Math.random() - 0.5) * 0.001;
    const publicLat = lat + jitterLat;
    const publicLng = lng + jitterLng;

    // Chèn vào bảng pins dùng hàm ST_SetSRID(ST_MakePoint)
    const { data: newPin, error } = await supabase
      .from('pins')
      .insert({
        user_id: userId,
        title: data.title,
        property_type: data.property_type,
        price_vnd: data.price_vnd,
        area_m2: data.area_m2,
        address_text: data.address_text,
        contact_phone: data.contact_phone,
        contact_zalo: data.contact_phone,
        public_geom: `POINT(${publicLng} ${publicLat})`,
        exact_geom: `POINT(${lng} ${lat})`,
      })
      .select('id')
      .single();

    if (error) {
      console.warn('Lỗi insert pin:', error.message);
      return false;
    }

    // Nếu có video, thêm vào bảng pin_media
    if (data.video_uri && newPin?.id) {
      await supabase.from('pin_media').insert({
        pin_id: newPin.id,
        media_type: 'video',
        url: data.video_uri,
        duration_seconds: 45,
      });
    }

    return true;
  } catch (err) {
    console.warn('Lỗi tạo pin:', err);
    return false;
  }
}
