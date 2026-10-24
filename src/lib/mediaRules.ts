// Quy tắc media dùng chung cho app (client) — khớp với giới hạn đã chốt trong tầng DB
// (trigger enforce_pin_media_limits) để UI và server không bao giờ lệch nhau.
export const MEDIA_LIMITS = {
  maxImages: 8,
  maxVideoSeconds: 45,
  maxVideoBytes: 25 * 1024 * 1024,
  maxImageBytes: 300 * 1024,
  maxImageWidth: 1920,
  maxImageHeight: 1080,
} as const;

export type MediaAsset = {
  uri: string;
  width?: number;
  height?: number;
  fileSize?: number;
  duration?: number; // ImagePicker trả về mili-giây
};

export function remainingImageSlots(current: number): number {
  return Math.max(0, MEDIA_LIMITS.maxImages - current);
}

export function clampImages<T>(list: T[], limit: number = MEDIA_LIMITS.maxImages): T[] {
  if (!Array.isArray(list)) return [];
  return list.slice(0, Math.max(0, limit));
}

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

/** ImagePicker: `duration` là ms với video, còn vài nền tảng trả thẳng giây. */
export function videoDurationSeconds(asset: MediaAsset | null | undefined): number {
  const raw = Number(asset?.duration || 0);
  if (!raw || raw <= 0) return 0;
  const seconds = raw > 1000 ? raw / 1000 : raw;
  return Math.round(seconds);
}

export function validateVideo(asset: MediaAsset | null | undefined): { ok: true } | { ok: false; reason: string } {
  if (!asset) return { ok: false, reason: 'Không đọc được video đã chọn.' };

  const seconds = videoDurationSeconds(asset);
  if (seconds > MEDIA_LIMITS.maxVideoSeconds) {
    return { ok: false, reason: `Video dài ${seconds}s, chỉ được tối đa ${MEDIA_LIMITS.maxVideoSeconds}s.` };
  }

  const bytes = Number(asset.fileSize || 0);
  if (bytes > MEDIA_LIMITS.maxVideoBytes) {
    return {
      ok: false,
      reason: `Video ${formatBytes(bytes)}, vượt giới hạn ${formatBytes(MEDIA_LIMITS.maxVideoBytes)}.`,
    };
  }

  return { ok: true };
}

/** Ẩn 4 số cuối với khách chưa đăng nhập: 0988123456 → 098812**** */
export function maskPhone(phone: string | null | undefined): string {
  const digits = String(phone || '').replace(/[^\d+]/g, '');
  if (digits.length < 7) return '••••••';
  return `${digits.slice(0, digits.length - 4)}****`;
}
