import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { MyPin } from '../services/pinService';

const money = (v: number) => {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(v >= 10_000_000_000 ? 0 : 1).replace('.', ',')} tỷ`;
  return `${Math.round(v / 1_000_000)} tr`;
};

const perM2 = (v: number) => `${(v / 1_000_000).toFixed(0)} tr/m²`;

const STATUS: Record<string, { label: string; color: string; bg: string }> = {
  active: { label: 'Đang bán', color: '#4ade80', bg: 'rgba(34,197,94,0.14)' },
  pending: { label: 'Đang giao dịch', color: '#fbbf24', bg: 'rgba(251,191,36,0.14)' },
  sold: { label: 'Đã bán', color: '#94a3b8', bg: 'rgba(148,163,184,0.16)' },
  hidden: { label: 'Đã gỡ', color: '#f87171', bg: 'rgba(239,68,68,0.14)' },
};

const FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: 'Tất cả' },
  { key: 'active', label: 'Đang bán' },
  { key: 'pending', label: 'Giao dịch' },
  { key: 'sold', label: 'Đã bán' },
  { key: 'hidden', label: 'Đã gỡ' },
];

interface Props {
  visible: boolean;
  pins: MyPin[];
  loading: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onOpenOnMap: (pin: MyPin) => void;
  onEditPrice: (pin: MyPin) => void;
  onDelete: (pin: MyPin) => void;
  onChangeStatus: (pin: MyPin, status: string) => void;
}

export const MyPinsModal: React.FC<Props> = ({
  visible,
  pins,
  loading,
  onClose,
  onRefresh,
  onOpenOnMap,
  onEditPrice,
  onDelete,
  onChangeStatus,
}) => {
  const [filter, setFilter] = useState('all');

  const list = filter === 'all' ? pins : pins.filter((p) => (p.status || 'active') === filter);
  const countOf = (k: string) =>
    k === 'all' ? pins.length : pins.filter((p) => (p.status || 'active') === k).length;

  const askStatus = (pin: MyPin) => {
    Alert.alert(
      'Cập nhật trạng thái',
      pin.title,
      [
        { text: 'Đang bán', onPress: () => onChangeStatus(pin, 'active') },
        { text: 'Đang giao dịch', onPress: () => onChangeStatus(pin, 'pending') },
        { text: 'Đã bán', onPress: () => onChangeStatus(pin, 'sold') },
        { text: 'Gỡ khỏi bản đồ', style: 'destructive', onPress: () => onChangeStatus(pin, 'hidden') },
        { text: 'Huỷ', style: 'cancel' },
      ],
      { cancelable: true }
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Ghim của tôi</Text>
            <Text style={styles.headerCount}>{pins.length} ghim</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            horizontal
            data={FILTERS}
            keyExtractor={(f) => f.key}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
            renderItem={({ item }) => {
              const active = filter === item.key;
              return (
                <TouchableOpacity
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => setFilter(item.key)}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {item.label} {countOf(item.key) > 0 ? `(${countOf(item.key)})` : ''}
                  </Text>
                </TouchableOpacity>
              );
            }}
          />

          {loading && pins.length === 0 ? (
            <ActivityIndicator color="#22c55e" style={{ marginTop: 40 }} />
          ) : (
            <FlatList
              data={list}
              keyExtractor={(p) => p.id}
              contentContainerStyle={styles.listContent}
              refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor="#22c55e" />}
              ListEmptyComponent={
                <Text style={styles.empty}>
                  {pins.length === 0
                    ? 'Bạn chưa đăng ghim nào.\nBấm ➕ trên bản đồ để đăng căn đầu tiên.'
                    : 'Không có ghim ở trạng thái này.'}
                </Text>
              }
              renderItem={({ item }) => {
                const st = STATUS[item.status || 'active'] || STATUS.active;
                return (
                  <View style={styles.card}>
                    <View style={styles.cardTop}>
                      <Text style={styles.cardTitle} numberOfLines={2}>
                        {item.title}
                      </Text>
                      <View style={[styles.statusChip, { backgroundColor: st.bg }]}>
                        <Text style={[styles.statusChipText, { color: st.color }]}>{st.label}</Text>
                      </View>
                    </View>

                    <View style={styles.metaRow}>
                      <Text style={styles.price}>{money(item.price_vnd)}</Text>
                      <Text style={styles.dot}>·</Text>
                      <Text style={styles.meta}>{item.area_m2} m²</Text>
                      <Text style={styles.dot}>·</Text>
                      <Text style={styles.meta}>{perM2(item.price_per_m2)}</Text>
                    </View>

                    <Text style={styles.address} numberOfLines={1}>
                      📍 {item.address_text}
                    </Text>

                    <View style={styles.statsRow}>
                      <Text style={styles.stat}>🖼 {item.images}</Text>
                      <Text style={styles.stat}>👁 {item.saves_count} lưu</Text>
                      <Text style={styles.stat}>📈 {item.price_changes} lần đổi giá</Text>
                    </View>

                    <View style={styles.btnRow}>
                      <TouchableOpacity
                        style={[styles.btn, styles.btnGhost]}
                        onPress={() => onOpenOnMap(item)}
                      >
                        <Text style={styles.btnGhostText}>Xem</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.btn, styles.btnGhost]}
                        onPress={() => onEditPrice(item)}
                      >
                        <Text style={styles.btnGhostText}>Sửa giá</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.btn, styles.btnGhost]}
                        onPress={() => askStatus(item)}
                      >
                        <Text style={styles.btnGhostText}>Trạng thái</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.btn, styles.btnDanger]}
                        onPress={() => onDelete(item)}
                      >
                        <Text style={styles.btnDangerText}>Xoá</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(2,6,23,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    height: '88%',
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18 },
  headerTitle: { color: '#f8fafc', fontSize: 18, fontWeight: '800' },
  headerCount: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 8,
    backgroundColor: '#1e293b',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  closeBtn: { marginLeft: 'auto', padding: 6 },
  closeBtnText: { color: '#94a3b8', fontSize: 17 },

  filterRow: { gap: 8, paddingHorizontal: 18, paddingVertical: 12 },
  chip: {
    backgroundColor: '#1e293b',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipActive: { backgroundColor: 'rgba(34,197,94,0.16)', borderColor: '#22c55e' },
  chipText: { color: '#94a3b8', fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: '#4ade80' },

  listContent: { paddingHorizontal: 16, paddingBottom: 28, gap: 10 },
  empty: { color: '#64748b', fontSize: 13, textAlign: 'center', marginTop: 40, lineHeight: 20 },

  card: {
    backgroundColor: '#111c30',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  cardTitle: { color: '#f1f5f9', fontSize: 14, fontWeight: '700', flex: 1, lineHeight: 19 },
  statusChip: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  statusChipText: { fontSize: 10.5, fontWeight: '800' },

  metaRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 7 },
  price: { color: '#22c55e', fontSize: 16, fontWeight: '900' },
  meta: { color: '#cbd5e1', fontSize: 12, fontWeight: '600' },
  dot: { color: '#475569', fontSize: 12 },
  address: { color: '#94a3b8', fontSize: 11.5, marginTop: 5 },

  statsRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  stat: { color: '#64748b', fontSize: 10.5, fontWeight: '600' },

  btnRow: { flexDirection: 'row', gap: 7, marginTop: 11 },
  btn: { flex: 1, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  btnGhost: { backgroundColor: '#1e293b', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  btnGhostText: { color: '#e2e8f0', fontSize: 11.5, fontWeight: '700' },
  btnDanger: { backgroundColor: 'rgba(239,68,68,0.12)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.5)' },
  btnDangerText: { color: '#f87171', fontSize: 11.5, fontWeight: '700' },
});
