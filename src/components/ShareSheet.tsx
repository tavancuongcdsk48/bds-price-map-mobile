import React from 'react';
import {
  Alert,
  Linking,
  Modal,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';

/**
 * Chọn nơi chia sẻ ghim: Zalo / Facebook / Telegram / Messenger / SMS / Copy / Khác.
 * Dùng deep link hệ thống của từng nền tảng, không phụ thuộc share sheet của máy.
 */
export interface ShareSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Deep link tới ghim, vd vutruchuyennhuong://pin/<id> */
  url: string;
  /** Nội dung đầy đủ (giá, địa chỉ, lời nhắn tải app) */
  message: string;
}

type Target = {
  key: string;
  label: string;
  glyph: string;
  color: string;
  run: (url: string, message: string) => Promise<void>;
};

const open = async (link: string) => {
  const ok = await Linking.canOpenURL(link).catch(() => false);
  if (ok) {
    await Linking.openURL(link);
    return;
  }
  await Linking.openURL(link).catch(() => {
    Alert.alert('Không mở được', 'Máy chưa cài ứng dụng này. Hãy chọn “Khác” để dùng khay chia sẻ của máy.');
  });
};

const TARGETS: Target[] = [
  {
    key: 'zalo',
    label: 'Zalo',
    glyph: 'Z',
    color: '#0068FF',
    run: async (url, message) => {
      await open(`https://zalo.me/share?u=${encodeURIComponent(url)}&t=${encodeURIComponent(message)}`);
    },
  },
  {
    key: 'facebook',
    label: 'Facebook',
    glyph: 'f',
    color: '#1877F2',
    run: async (url, message) => {
      await open(
        `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}&quote=${encodeURIComponent(message)}`
      );
    },
  },
  {
    key: 'telegram',
    label: 'Telegram',
    glyph: '✈',
    color: '#229ED9',
    run: async (url, message) => {
      await open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(message)}`);
    },
  },
  {
    key: 'messenger',
    label: 'Messenger',
    glyph: 'm',
    color: '#0084FF',
    run: async (url) => {
      await open(`fb-messenger://share?link=${encodeURIComponent(url)}`);
    },
  },
  {
    key: 'sms',
    label: 'Tin nhắn',
    glyph: '💬',
    color: '#22c55e',
    run: async (_url, message) => {
      await open(`sms:?body=${encodeURIComponent(message)}`);
    },
  },
  {
    key: 'copy',
    label: 'Sao chép',
    glyph: '⧉',
    color: '#475569',
    run: async (_url, message) => {
      await Clipboard.setStringAsync(message);
      Alert.alert('Đã sao chép', 'Nội dung ghim đã được sao chép, dán vào đâu cũng được.');
    },
  },
  {
    key: 'more',
    label: 'Khác',
    glyph: '⋯',
    color: '#334155',
    run: async (url, message) => {
      await Share.share({ title: 'Chia sẻ ghim', message, url });
    },
  },
];

export const ShareSheet: React.FC<ShareSheetProps> = ({ visible, onClose, url, message }) => {
  const handle = async (t: Target) => {
    try {
      await t.run(url, message);
      onClose();
    } catch {
      Alert.alert('Không chia sẻ được', 'Thử chọn “Khác” để dùng khay chia sẻ của máy.');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Chia sẻ ghim qua</Text>
          <Text style={styles.sub} numberOfLines={2}>
            {message.split('\n')[0]}
          </Text>

          <View style={styles.grid}>
            {TARGETS.map((t) => (
              <TouchableOpacity key={t.key} style={styles.item} onPress={() => handle(t)}>
                <View style={[styles.iconWrap, { backgroundColor: t.color }]}>
                  <Text style={styles.iconGlyph}>{t.glyph}</Text>
                </View>
                <Text style={styles.itemLabel} numberOfLines={1}>
                  {t.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity style={styles.cancel} onPress={onClose}>
            <Text style={styles.cancelText}>Huỷ</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(2,6,23,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 22,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignSelf: 'center',
    marginBottom: 12,
  },
  title: { color: '#e2e8f0', fontSize: 16, fontWeight: '800' },
  sub: { color: '#64748b', fontSize: 12, marginTop: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 16 },
  item: { width: '25%', alignItems: 'center', marginBottom: 16 },
  iconWrap: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' },
  iconGlyph: { color: '#ffffff', fontSize: 24, fontWeight: '900' },
  itemLabel: { color: '#cbd5e1', fontSize: 11.5, fontWeight: '600', marginTop: 6 },
  cancel: {
    marginTop: 4,
    minHeight: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1e293b',
  },
  cancelText: { color: '#e2e8f0', fontSize: 14, fontWeight: '700' },
});
