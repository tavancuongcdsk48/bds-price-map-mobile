import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SavedPin } from '../services/pinService';

interface SavedPinsModalProps {
  visible: boolean;
  items: SavedPin[];
  loading: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onOpenPin: (item: SavedPin) => void;
  onUnsave: (item: SavedPin) => void;
}

const money = (v: number) => (v / 1_000_000_000).toFixed(2).replace(/\.00$/, '') + ' tỷ';
const day = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';

const statusLabel: Record<string, string> = {
  active: 'Đang bán',
  pending: 'Đang giao dịch',
  sold: 'Đã bán',
  hidden: 'Đã gỡ',
};

/**
 * Danh sách ghim người dùng đã lưu để theo dõi.
 * Mỗi dòng so sánh giá lúc lưu với giá hiện tại, kèm số lần chủ nhà đổi giá.
 */
export const SavedPinsModal: React.FC<SavedPinsModalProps> = ({
  visible,
  items,
  loading,
  onClose,
  onRefresh,
  onOpenPin,
  onUnsave,
}) => {
  if (!visible) return null;

  const increased = items.filter((i) => i.change_vnd > 0).length;
  const decreased = items.filter((i) => i.change_vnd < 0).length;

  return (
    <View style={styles.backdrop}>
      <View style={styles.sheet}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Ghim đã lưu ({items.length})</Text>
            <Text style={styles.subtitle}>
              {items.length === 0
                ? 'Chưa lưu ghim nào'
                : `${increased} ghim tăng giá · ${decreased} ghim giảm giá`}
            </Text>
          </View>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color="#22c55e" />
            <Text style={styles.loadingText}>Đang tải ghim đã lưu…</Text>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.emptyIcon}>❤</Text>
            <Text style={styles.emptyTitle}>Chưa lưu ghim nào</Text>
            <Text style={styles.emptyHint}>
              Bấm nút “Lưu ghim” trong thẻ chi tiết để theo dõi biến động giá của căn đó.
            </Text>
          </View>
        ) : (
          <ScrollView
            style={styles.list}
            contentContainerStyle={{ paddingBottom: 24 }}
            refreshControl={<RefreshControl refreshing={false} onRefresh={onRefresh} tintColor="#22c55e" />}
          >
            {items.map((item) => {
              const up = item.change_vnd > 0;
              const down = item.change_vnd < 0;
              return (
                <View key={item.pin_id} style={styles.card}>
                  <View style={styles.cardTop}>
                    <Text style={styles.cardTitle} numberOfLines={2}>
                      {item.title}
                    </Text>
                    <View style={[styles.statusChip, item.pin_status !== 'active' && styles.statusChipMuted]}>
                      <Text style={styles.statusText}>{statusLabel[item.pin_status] || item.pin_status}</Text>
                    </View>
                  </View>

                  <Text style={styles.address} numberOfLines={1}>
                    📍 {item.address_text}
                  </Text>

                  <View style={styles.priceRow}>
                    <Text style={styles.priceNow}>{money(item.price_vnd)}</Text>
                    <Text style={styles.priceMeta}>
                      lưu {money(item.saved_price_vnd)} · {item.area_m2} m²
                    </Text>
                    {item.change_vnd !== 0 && (
                      <View style={[styles.changeChip, up ? styles.chipUp : styles.chipDown]}>
                        <Text style={[styles.changeText, up ? styles.textUp : styles.textDown]}>
                          {up ? '▲' : '▼'} {Math.abs(item.change_percent).toFixed(1)}%
                        </Text>
                      </View>
                    )}
                  </View>

                  <Text style={styles.trackLine}>
                    🔔 {item.price_changes} lần đổi giá · cập nhật {day(item.last_change_at)} ·{' '}
                    {item.saves_count} người lưu
                  </Text>

                  {item.note ? <Text style={styles.note}>📝 {item.note}</Text> : null}

                  <View style={styles.actions}>
                    <TouchableOpacity style={styles.openBtn} onPress={() => onOpenPin(item)}>
                      <Text style={styles.openText}>Xem trên bản đồ</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.unsaveBtn} onPress={() => onUnsave(item)}>
                      <Text style={styles.unsaveText}>Bỏ lưu</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(2,6,23,0.9)',
    paddingTop: 60,
    paddingHorizontal: 14,
    zIndex: 420,
    elevation: 420,
  },
  sheet: { flex: 1, backgroundColor: '#0f172a', borderRadius: 18, borderWidth: 1, borderColor: '#1e293b' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  title: { color: '#f8fafc', fontSize: 16, fontWeight: '800' },
  subtitle: { color: '#94a3b8', fontSize: 11, marginTop: 3 },
  closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#1e293b', alignItems: 'center', justifyContent: 'center' },
  closeText: { color: '#e2e8f0', fontSize: 15, fontWeight: '700' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  loadingText: { color: '#94a3b8', fontSize: 12, marginTop: 10 },
  emptyIcon: { fontSize: 40, color: '#ef4444', marginBottom: 8 },
  emptyTitle: { color: '#f8fafc', fontSize: 15, fontWeight: '700' },
  emptyHint: { color: '#94a3b8', fontSize: 12, textAlign: 'center', marginTop: 8, lineHeight: 18 },

  list: { flex: 1, paddingHorizontal: 14 },
  card: {
    backgroundColor: '#111c33',
    borderRadius: 14,
    padding: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  cardTitle: { flex: 1, color: '#f8fafc', fontSize: 14, fontWeight: '700', lineHeight: 19 },
  statusChip: { backgroundColor: 'rgba(34,197,94,0.16)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  statusChipMuted: { backgroundColor: 'rgba(148,163,184,0.2)' },
  statusText: { color: '#e2e8f0', fontSize: 10, fontWeight: '700' },

  address: { color: '#94a3b8', fontSize: 11, marginTop: 6 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  priceNow: { color: '#22c55e', fontSize: 16, fontWeight: '800' },
  priceMeta: { color: '#64748b', fontSize: 11 },
  changeChip: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  chipUp: { backgroundColor: 'rgba(239,68,68,0.16)' },
  chipDown: { backgroundColor: 'rgba(34,197,94,0.16)' },
  changeText: { fontSize: 11, fontWeight: '800' },
  textUp: { color: '#f87171' },
  textDown: { color: '#4ade80' },

  trackLine: { color: '#94a3b8', fontSize: 11, marginTop: 8 },
  note: { color: '#fbbf24', fontSize: 11, marginTop: 6 },

  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  openBtn: { flex: 1, backgroundColor: '#1e293b', borderRadius: 10, paddingVertical: 9, alignItems: 'center' },
  openText: { color: '#e2e8f0', fontSize: 12, fontWeight: '700' },
  unsaveBtn: {
    paddingHorizontal: 14,
    borderRadius: 10,
    paddingVertical: 9,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  unsaveText: { color: '#f87171', fontSize: 12, fontWeight: '700' },
});
