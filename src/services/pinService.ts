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
  owner_name?: string;
  /** true = chính thiết bị/tài khoản này đã ghim → được sửa giá */
  is_mine: boolean;
  /** true = người dùng đang đăng nhập đã lưu ghim này để theo dõi */
  is_saved?: boolean;
}

/** Một ghim người dùng đã lưu, kèm biến động giá so với lúc lưu */
export interface SavedPin {
  pin_id: string;
  title: string;
  property_type: string;
  price_vnd: number;
  saved_price_vnd: number;
  change_vnd: number;
  change_percent: number;
  area_m2: number;
  price_per_m2: number;
  latitude: number;
  longitude: number;
  address_text: string;
  contact_phone: string;
  pin_status: 'active' | 'pending' | 'sold' | 'hidden';
  price_changes: number;
  last_change_at: string | null;
  saved_at: string;
  note: string | null;
  saves_count: number;
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
    is_verified: Boolean(item.owner_verified),
    owner_name: item.owner_name || 'Người dùng',
    is_mine: Boolean(item.is_mine),
    is_saved: Boolean(item.is_saved),
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
): Promise<string | null> {
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
      return null;
    }

    return newPin?.id ?? null;
  } catch (err) {
    console.warn('Lỗi tạo pin:', err);
    return null;
  }
}

// 4. Chủ ghim sửa giá — database kiểm tra đúng thiết bị đã ghim mới cho sửa.
//    Trigger DB tự ghi vào lịch sử giá.
export type PriceUpdateResult = 'ok' | 'not_owner' | 'not_authenticated' | 'failed';

export async function updatePinPrice(pinId: string, priceVnd: number): Promise<PriceUpdateResult> {
  try {
    const { error } = await supabase.rpc('update_pin_price', {
      p_pin_id: pinId,
      p_price: Math.round(priceVnd),
    });

    if (error) {
      const msg = String(error.message || '');
      if (msg.includes('not_pin_owner')) return 'not_owner';
      if (msg.includes('not_authenticated')) return 'not_authenticated';
      console.warn('Lỗi sửa giá:', msg);
      return 'failed';
    }
    return 'ok';
  } catch (err) {
    console.warn('Lỗi cập nhật giá:', err);
    return 'failed';
  }
}

// 4b. Xoá ghim — chỉ chủ tài khoản Google đã đăng ghim
export async function deletePin(pinId: string): Promise<PriceUpdateResult> {
  try {
    const { error } = await supabase.rpc('delete_pin', { p_pin_id: pinId });
    if (error) {
      const msg = String(error.message || '');
      if (msg.includes('not_pin_owner')) return 'not_owner';
      if (msg.includes('not_authenticated')) return 'not_authenticated';
      console.warn('Lỗi xoá ghim:', msg);
      return 'failed';
    }
    return 'ok';
  } catch (err) {
    console.warn('Lỗi xoá ghim:', err);
    return 'failed';
  }
}

// 4c. Sau khi đăng nhập Google: nhận các ghim demo cũ về tài khoản này
export async function claimDemoPins(): Promise<number> {
  try {
    const { data, error } = await supabase.rpc('claim_demo_pins');
    if (error) {
      console.warn('Lỗi nhận ghim demo:', error.message);
      return 0;
    }
    return Number(data) || 0;
  } catch (err) {
    console.warn('Lỗi claim_demo_pins:', err);
    return 0;
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

// 6. Lưu / bỏ lưu một ghim để theo dõi biến động giá
export async function toggleSavePin(
  pinId: string
): Promise<{ saved: boolean; savesCount: number; error?: string }> {
  try {
    const { data, error } = await supabase.rpc('toggle_save_pin', { p_pin_id: pinId });
    if (error) {
      const msg = error.message || '';
      if (msg.includes('not_authenticated')) return { saved: false, savesCount: 0, error: 'not_authenticated' };
      if (msg.includes('pin_not_found')) return { saved: false, savesCount: 0, error: 'pin_not_found' };
      return { saved: false, savesCount: 0, error: msg };
    }
    const payload = (data || {}) as { saved?: boolean; saves_count?: number };
    return { saved: Boolean(payload.saved), savesCount: Number(payload.saves_count || 0) };
  } catch (err: any) {
    return { saved: false, savesCount: 0, error: String(err?.message || err) };
  }
}

// 7. Danh sách ghim tôi đã lưu, kèm giá lúc lưu và % biến động hiện tại
export async function fetchSavedPins(): Promise<SavedPin[] | null> {
  try {
    const { data, error } = await supabase.rpc('get_my_saved_pins');
    if (error) {
      console.warn('Lỗi lấy ghim đã lưu:', error.message);
      return error.message.includes('not_authenticated') ? [] : null;
    }
    return ((data as any[]) || []).map((r) => ({
      pin_id: r.pin_id,
      title: r.title,
      property_type: r.property_type,
      price_vnd: Number(r.price_vnd),
      saved_price_vnd: Number(r.saved_price_vnd),
      change_vnd: Number(r.change_vnd),
      change_percent: Number(r.change_percent || 0),
      area_m2: Number(r.area_m2),
      price_per_m2: Number(r.price_per_m2),
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      address_text: r.address_text,
      contact_phone: r.contact_phone,
      pin_status: r.pin_status,
      price_changes: Number(r.price_changes || 0),
      last_change_at: r.last_change_at,
      saved_at: r.saved_at,
      note: r.note,
      saves_count: Number(r.saves_count || 0),
    }));
  } catch (err) {
    console.warn('Lỗi ghim đã lưu:', err);
    return null;
  }
}

// 8. Ghi chú riêng cho ghim đã lưu
export async function setSaveNote(pinId: string, note: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('set_save_note', { p_pin_id: pinId, p_note: note });
    if (error) {
      console.warn('Lỗi lưu ghi chú:', error.message);
      return false;
    }
    return Boolean(data);
  } catch (err) {
    console.warn('Lỗi ghi chú:', err);
    return false;
  }
}

// 11. Tab "Ghim của tôi"
export interface MyPin {
  id: string;
  title: string;
  property_type: string;
  price_vnd: number;
  area_m2: number;
  price_per_m2: number;
  address_text: string;
  status: string;
  latitude: number;
  longitude: number;
  images: number;
  videos: number;
  saves_count: number;
  price_changes: number;
  created_at: string;
  updated_at: string;
}

export async function fetchMyPins(): Promise<MyPin[]> {
  try {
    const { data, error } = await supabase.rpc('get_my_pins');
    if (error) {
      console.warn('Lỗi lấy ghim của tôi:', error.message);
      return [];
    }
    return ((data as any[]) || []).map((r) => ({
      id: r.id,
      title: r.title,
      property_type: r.property_type,
      price_vnd: Number(r.price_vnd),
      area_m2: Number(r.area_m2),
      price_per_m2: Number(r.price_per_m2),
      address_text: r.address_text,
      status: r.status || 'active',
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      images: Number(r.images || 0),
      videos: Number(r.videos || 0),
      saves_count: Number(r.saves_count || 0),
      price_changes: Number(r.price_changes || 0),
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
  } catch (err) {
    console.warn('Lỗi ghim của tôi:', err);
    return [];
  }
}

export async function setPinStatus(pinId: string, status: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('set_pin_status', {
      p_pin_id: pinId,
      p_status: status,
    });
    if (error) {
      console.warn('Lỗi đổi trạng thái:', error.message);
      return false;
    }
    return Boolean(data);
  } catch (err) {
    console.warn('Lỗi đổi trạng thái:', err);
    return false;
  }
}

// 9. Ảnh/video của một ghim
export interface PinMediaItem {
  id: string;
  media_type: 'image' | 'video';
  url: string;
  thumbnail_url: string | null;
  duration_seconds: number;
}

export async function fetchPinMedia(pinId: string): Promise<PinMediaItem[]> {
  try {
    const { data, error } = await supabase.rpc('get_pin_media', { p_pin_id: pinId });
    if (error) {
      console.warn('Lỗi lấy media:', error.message);
      return [];
    }
    return ((data as any[]) || []).map((r) => ({
      id: r.id,
      media_type: r.media_type,
      url: r.url,
      thumbnail_url: r.thumbnail_url,
      duration_seconds: Number(r.duration_seconds || 0),
    }));
  } catch (err) {
    console.warn('Lỗi media:', err);
    return [];
  }
}

// 10. Tải ảnh/video từ máy lên bucket pin-media rồi gắn vào ghim
async function uploadOne(pinId: string, uri: string, kind: 'image' | 'video'): Promise<string | null> {
  try {
    const guessed = (uri.split('?')[0].split('.').pop() || '').toLowerCase();
    const ext = guessed && guessed.length <= 5 ? guessed : kind === 'video' ? 'mp4' : 'jpg';
    const path = `${pinId}/${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const res = await fetch(uri);
    const buf = await res.arrayBuffer();

    const mime =
      kind === 'video'
        ? ext === 'mov'
          ? 'video/quicktime'
          : 'video/mp4'
        : ext === 'png'
        ? 'image/png'
        : ext === 'webp'
        ? 'image/webp'
        : 'image/jpeg';

    const { error } = await supabase.storage.from('pin-media').upload(path, buf, {
      contentType: mime,
      upsert: true,
    });
    if (error) {
      console.warn('Lỗi upload media:', error.message);
      return null;
    }

    const { data } = supabase.storage.from('pin-media').getPublicUrl(path);
    return data?.publicUrl || null;
  } catch (err) {
    console.warn('Lỗi upload media:', err);
    return null;
  }
}

/** Tải toàn bộ ảnh (tối đa 8) + 1 video của ghim mới lên storage. Trả về số file thành công. */
export async function uploadPinMedia(
  pinId: string,
  images: string[],
  videoUri?: string
): Promise<number> {
  let ok = 0;
  const rows: { pin_id: string; media_type: string; url: string; duration_seconds: number }[] = [];

  for (const uri of images.slice(0, 8)) {
    const url = await uploadOne(pinId, uri, 'image');
    if (url) {
      rows.push({ pin_id: pinId, media_type: 'image', url, duration_seconds: 0 });
      ok += 1;
    }
  }

  if (videoUri) {
    const url = await uploadOne(pinId, videoUri, 'video');
    if (url) {
      rows.push({ pin_id: pinId, media_type: 'video', url, duration_seconds: 45 });
      ok += 1;
    }
  }

  if (rows.length > 0) {
    const { error } = await supabase.from('pin_media').insert(rows);
    if (error) {
      console.warn('Lỗi lưu media:', error.message);
      return 0;
    }
  }
  return ok;
}
