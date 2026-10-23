import { supabase } from '../lib/supabase';
import { NewPinData } from '../components/CreatePinModal';

export interface PinItem {
  id: string;
  user_id?: string;
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
function formatPin(item: any): PinItem {
  return {
    id: item.id,
    user_id: item.user_id,
    title: item.title,
    price_vnd: Number(item.price_vnd),
    price_display: (Number(item.price_vnd) / 1000000000).toFixed(1) + ' Tỷ',
    price_per_m2_display: (Number(item.price_per_m2) / 1000000).toFixed(0) + ' tr/m²',
    area_m2: Number(item.area_m2),
    latitude: Number(item.latitude),
    longitude: Number(item.longitude),
    property_type: item.property_type,
    has_video: item.has_video,
    video_duration: item.has_video ? '0:45' : undefined,
    contact_phone: item.contact_phone,
    address_text: item.address_text,
    is_verified: true,
  };
}

export async function fetchPinsInBounds(
  minLng: number,
  minLat: number,
  maxLng: number,
  maxLat: number,
  propertyType?: string
): Promise<PinItem[] | null> {
  try {
    const { data, error } = await supabase.rpc('get_pins_in_bounds', {
      min_lng: minLng,
      min_lat: minLat,
      max_lng: maxLng,
      max_lat: maxLat,
      p_type: propertyType && propertyType !== 'all' ? propertyType : null,
    });

    if (error) {
      console.warn('Supabase RPC Error:', error.message);
      return null;
    }

    if (!data) return [];
    return (data as any[]).map(formatPin);
  } catch (err) {
    console.warn('Lỗi kết nối fetchPinsInBounds:', err);
    return null;
  }
}

// 2. Tìm ghim theo tên / địa chỉ cho thanh tìm kiếm
export async function searchPinsByText(q: string): Promise<PinItem[]> {
  const keyword = q.trim();
  if (keyword.length < 2) return [];
  try {
    const { data, error } = await supabase.rpc('search_pins', { p_q: keyword });
    if (error) {
      console.warn('Lỗi search_pins:', error.message);
      return [];
    }
    return ((data as any[]) || []).map(formatPin);
  } catch (err) {
    console.warn('Lỗi tìm ghim:', err);
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

// 4. Chủ ghim sửa giá — trigger DB tự ghi vào lịch sử giá
export async function updatePinPrice(pinId: string, priceVnd: number): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('pins')
      .update({ price_vnd: Math.round(priceVnd) })
      .eq('id', pinId);

    if (error) {
      console.warn('Lỗi sửa giá:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('Lỗi cập nhật giá:', err);
    return false;
  }
}

// 5. Lịch sử giá của một ghim (cũ → mới), nền cho biểu đồ giá theo tháng/năm
export interface PriceHistoryPoint {
  price_vnd: number;
  price_per_m2: number;
  source: 'created' | 'owner_edit';
  created_at: string;
}

export async function fetchPriceHistory(pinId: string): Promise<PriceHistoryPoint[]> {
  try {
    const { data, error } = await supabase
      .from('pin_price_history')
      .select('price_vnd, price_per_m2, source, created_at')
      .eq('pin_id', pinId)
      .order('created_at', { ascending: true })
      .limit(24);

    if (error) {
      console.warn('Lỗi lấy lịch sử giá:', error.message);
      return [];
    }

    return ((data as any[]) || []).map((r) => ({
      price_vnd: Number(r.price_vnd),
      price_per_m2: Number(r.price_per_m2 || 0),
      source: r.source,
      created_at: r.created_at,
    }));
  } catch (err) {
    console.warn('Lỗi lịch sử giá:', err);
    return [];
  }
}
