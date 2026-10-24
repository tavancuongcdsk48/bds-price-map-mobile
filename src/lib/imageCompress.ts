import * as ImageManipulator from 'expo-image-manipulator';
import { MEDIA_LIMITS, MediaAsset } from './mediaRules';

export type CompressedImage = {
  uri: string;
  width: number;
  height: number;
  bytes: number;
};

const QUALITY_STEPS = [0.8, 0.6, 0.45, 0.3];

async function bytesOf(uri: string): Promise<number> {
  try {
    const res = await fetch(uri);
    const blob = await res.blob();
    return blob.size || 0;
  } catch {
    return 0;
  }
}

function targetResize(asset: MediaAsset): ImageManipulator.Action | null {
  const w = asset.width || 0;
  const h = asset.height || 0;
  if (!w || !h) return null;

  const scaleW = MEDIA_LIMITS.maxImageWidth / w;
  const scaleH = MEDIA_LIMITS.maxImageHeight / h;
  const scale = Math.min(1, scaleW, scaleH);
  if (scale >= 1) return null;

  return { resize: { width: Math.round(w * scale) } };
}

/**
 * Nén ảnh về WebP ≤ 300KB, cạnh dài ≤ 1920px.
 * Luôn trả về ảnh (thu nhỏ + hạ quality dần); nếu mọi bước đều lỗi thì trả file gốc.
 */
export async function compressImageToLimit(asset: MediaAsset): Promise<CompressedImage> {
  let actions: ImageManipulator.Action[] = [];
  const resize = targetResize(asset);
  if (resize) actions = [resize];

  let best: CompressedImage | null = null;

  for (let round = 0; round < 3; round++) {
    for (const quality of QUALITY_STEPS) {
      try {
        const out = await ImageManipulator.manipulateAsync(asset.uri, actions, {
          compress: quality,
          format: ImageManipulator.SaveFormat.WEBP,
        });
        const bytes = await bytesOf(out.uri);
        best = { uri: out.uri, width: out.width, height: out.height, bytes };
        if (bytes > 0 && bytes <= MEDIA_LIMITS.maxImageBytes) return best;
      } catch {
        // thử quality thấp hơn
      }
    }

    // Vẫn quá 300KB → thu nhỏ thêm 25% rồi lặp lại.
    const baseWidth = best?.width || asset.width || 0;
    if (!baseWidth) break;
    actions = [{ resize: { width: Math.max(640, Math.round(baseWidth * 0.75)) } }];
  }

  return (
    best || {
      uri: asset.uri,
      width: asset.width || 0,
      height: asset.height || 0,
      bytes: asset.fileSize || 0,
    }
  );
}
