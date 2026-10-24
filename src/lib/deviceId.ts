import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

const KEY = 'vutru_device_id';

let cached: string | null = null;

/**
 * Định danh thiết bị — dùng để chứng minh "tôi là người đã ghim căn nhà này"
 * khi chưa đăng nhập Google. Lưu trong Keychain (iOS) / Keystore (Android),
 * mất khi xoá app, không đồng bộ giữa các máy.
 */
export async function getDeviceId(): Promise<string> {
  if (cached) return cached;

  try {
    const existing = await SecureStore.getItemAsync(KEY);
    if (existing) {
      cached = existing;
      return existing;
    }
  } catch (err) {
    console.warn('Không đọc được device id:', err);
  }

  const fresh = Crypto.randomUUID();
  try {
    await SecureStore.setItemAsync(KEY, fresh);
  } catch (err) {
    console.warn('Không lưu được device id:', err);
  }
  cached = fresh;
  return fresh;
}
