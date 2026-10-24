import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { AreaPricePoint, PriceHistoryPoint } from '../services/pinService';

/**
 * Sheet "Phân tích giá" — gom toàn bộ biểu đồ vào một chỗ, để thẻ ghim không bị rối.
 * Tab 1: lịch sử giá của căn đang xem (từng lần đổi giá).
 * Tab 2: giá/m² trung vị của khu vực theo tháng (dữ liệu neo vào vị trí, không mất khi chủ xoá ghim).
 */
export interface PriceAnalysisSheetProps {
  visible: boolean;
  onClose: () => void;
  initialTab?: 'pin' | 'area';
  pinTitle?: string | null;
  pinHistory: PriceHistoryPoint[];
  areaHistory: AreaPricePoint[];
  areaRadiusM?: number;
  areaLabel?: string | null;
  loading?: boolean;
}

const formatTy = (vnd: number): string => {
  if (!Number.isFinite(vnd) || vnd <= 0) return '—';
  const ty = vnd / 1_000_000_000;
  return `${ty.toFixed(ty >= 10 ? 1 : 2).replace('.', ',')} tỷ`;
};

const formatPpm2 = (vnd: number): string => {
  if (!Number.isFinite(vnd) || vnd <= 0) return '—';
  return `${Math.round(vnd / 1_000_000)} tr/m²`;
};

const pct = (from: number, to: number): number | null => {
  if (!from || !to) return null;
  return ((to - from) / from) * 100;
};

function TrendBadge({ value }: { value: number | null }) {
  if (value === null || !Number.isFinite(value)) return null;
  const up = value >= 0;
  return (
    <Text style={[styles.trendBadge, { color: up ? '#4ade80' : '#f87171' }]}>
      {up ? '▲' : '▼'} {Math.abs(value).toFixed(1).replace('.', ',')}%
    </Text>
  );
}

function Bars({
  values,
  labels,
  color,
  activeColor,
  format,
}: {
  values: number[];
  labels: string[];
  color: string;
  activeColor: string;
  format: (v: number) => string;
}) {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  return (
    <View style={styles.barsRow}>
      {values.map((v, idx) => {
        const isLast = idx === values.length - 1;
        const ratio = max === min ? 0.6 : 0.25 + ((v - min) / (max - min)) * 0.75;
        return (
          <View key={`${labels[idx]}-${idx}`} style={styles.barCol}>
            <Text style={[styles.barValue, isLast && { color: activeColor }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
              {format(v)}
            </Text>
            <View
              style={[
                styles.bar,
                { height: Math.round(110 * ratio), backgroundColor: isLast ? activeColor : color },
              ]}
            />
            <Text style={styles.barLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
              {labels[idx]}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export const PriceAnalysisSheet: React.FC<PriceAnalysisSheetProps> = ({
  visible,
  onClose,
  initialTab = 'pin',
  pinTitle,
  pinHistory,
  areaHistory,
  areaRadiusM = 400,
  areaLabel,
  loading,
}) => {
  const [tab, setTab] = useState<'pin' | 'area'>(initialTab);

  // Không có ghim nào đang mở (mở từ bản đồ) → chỉ có dữ liệu khu vực
  const pinTabDisabled = pinHistory.length === 0 && !pinTitle;

  // mở sheet với tab khác từ ngoài → đồng bộ lại
  React.useEffect(() => {
    if (visible) setTab(pinTabDisabled ? 'area' : initialTab);
  }, [visible, initialTab, pinTabDisabled]);

  const pinPoints = useMemo(
    () => [...pinHistory].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at)).slice(-6),
    [pinHistory]
  );
  const areaPoints = useMemo(() => areaHistory.slice(-6), [areaHistory]);

  const pinTrend = pinPoints.length >= 2 ? pct(pinPoints[0].price_vnd, pinPoints[pinPoints.length - 1].price_vnd) : null;
  const areaTrend =
    areaPoints.length >= 2 ? pct(areaPoints[0].median_ppm2, areaPoints[areaPoints.length - 1].median_ppm2) : null;

  const latestArea = areaPoints[areaPoints.length - 1];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.backdropTop} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Phân tích giá</Text>
              <Text style={styles.sub} numberOfLines={1}>
                {pinTitle || areaLabel || 'Khu vực đang xem'}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.close}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.tabs}>
            <TouchableOpacity
              style={[styles.tab, tab === 'pin' && styles.tabActive, pinTabDisabled && { opacity: 0.4 }]}
              onPress={() => !pinTabDisabled && setTab('pin')}
              disabled={pinTabDisabled}
            >
              <Text style={[styles.tabText, tab === 'pin' && styles.tabTextActive]}>Căn này</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, tab === 'area' && styles.tabActive]}
              onPress={() => setTab('area')}
            >
              <Text style={[styles.tabText, tab === 'area' && styles.tabTextActive]}>Khu vực {areaRadiusM} m</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
            {loading ? (
              <View style={styles.emptyBox}>
                <ActivityIndicator color="#38bdf8" />
                <Text style={styles.emptyText}>Đang tải dữ liệu giá…</Text>
              </View>
            ) : tab === 'pin' ? (
              pinPoints.length >= 2 ? (
                <View>
                  <View style={styles.summaryRow}>
                    <View>
                      <Text style={styles.summaryLabel}>Giá hiện tại</Text>
                      <Text style={styles.summaryValue}>{formatTy(pinPoints[pinPoints.length - 1].price_vnd)}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.summaryLabel}>So với mốc đầu</Text>
                      <TrendBadge value={pinTrend} />
                    </View>
                  </View>
                  <Bars
                    values={pinPoints.map((p) => p.price_vnd)}
                    labels={pinPoints.map((p) => {
                      const d = new Date(p.created_at);
                      return `${d.getDate()}/${d.getMonth() + 1}`;
                    })}
                    color="#334155"
                    activeColor="#22c55e"
                    format={formatTy}
                  />
                  <Text style={styles.note}>
                    {pinPoints.length} mốc giá · mỗi mốc là một lần chủ nhà đổi giá. Số cũ vẫn được giữ kể cả khi ghim bị xoá.
                  </Text>
                </View>
              ) : (
                <View style={styles.emptyBox}>
                  <Text style={styles.emptyIcon}>📉</Text>
                  <Text style={styles.emptyText}>
                    Căn này chưa có mốc giá thứ hai nên chưa vẽ được xu hướng. Xem tab “Khu vực” để biết mặt bằng giá xung quanh.
                  </Text>
                </View>
              )
            ) : areaPoints.length >= 2 ? (
              <View>
                <View style={styles.summaryRow}>
                  <View>
                    <Text style={styles.summaryLabel}>Trung vị khu vực</Text>
                    <Text style={styles.summaryValue}>{formatPpm2(latestArea?.median_ppm2 || 0)}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.summaryLabel}>{latestArea?.n_pins || 0} ghim đang treo</Text>
                    <TrendBadge value={areaTrend} />
                  </View>
                </View>
                <Bars
                  values={areaPoints.map((p) => p.median_ppm2)}
                  labels={areaPoints.map((p) => {
                    const [yy, mm] = p.month.split('-');
                    return `T${Number(mm)}/${yy.slice(2)}`;
                  })}
                  color="#1e3a5f"
                  activeColor="#38bdf8"
                  format={(v) => `${Math.round(v / 1_000_000)}tr`}
                />
                {latestArea && latestArea.p25 > 0 && latestArea.p75 > latestArea.p25 ? (
                  <Text style={styles.note}>
                    Tháng gần nhất: phổ biến từ {formatPpm2(latestArea.p25)} đến {formatPpm2(latestArea.p75)} (P25–P75).
                    Căn đã bán/xoá vẫn được tính tới hết tháng bị gỡ nên biểu đồ không bị “rơi” giả tạo.
                  </Text>
                ) : null}
              </View>
            ) : (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyIcon}>🗺️</Text>
                <Text style={styles.emptyText}>
                  Chưa đủ dữ liệu để vẽ giá khu vực (cần ít nhất 2 tháng có ghim trong bán kính {areaRadiusM} m).
                </Text>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(2, 6, 23, 0.6)' },
  backdropTop: { flex: 1 },
  sheet: {
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 8,
    maxHeight: '78%',
    minHeight: 420,
    borderTopWidth: 1,
    borderColor: '#1e293b',
  },
  handle: { alignSelf: 'center', width: 42, height: 4, borderRadius: 2, backgroundColor: '#334155', marginBottom: 10 },
  head: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  title: { color: '#f8fafc', fontSize: 17, fontWeight: '800' },
  sub: { color: '#64748b', fontSize: 12, marginTop: 2 },
  close: { color: '#94a3b8', fontSize: 18, fontWeight: '700', paddingHorizontal: 6 },
  tabs: {
    flexDirection: 'row',
    backgroundColor: '#111c33',
    borderRadius: 12,
    padding: 4,
    marginBottom: 14,
  },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: 'center' },
  tabActive: { backgroundColor: '#1e293b' },
  tabText: { color: '#64748b', fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: '#f8fafc' },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    backgroundColor: '#111c33',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  summaryLabel: { color: '#64748b', fontSize: 11, marginBottom: 4 },
  summaryValue: { color: '#f8fafc', fontSize: 18, fontWeight: '800' },
  trendBadge: { fontSize: 15, fontWeight: '800' },
  barsRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: 2 },
  barCol: { flex: 1, alignItems: 'center', paddingHorizontal: 2 },
  barValue: { color: '#94a3b8', fontSize: 10, fontWeight: '700', marginBottom: 4 },
  bar: { width: '72%', borderRadius: 6, minHeight: 8 },
  barLabel: { color: '#64748b', fontSize: 10, marginTop: 6 },
  note: { color: '#475569', fontSize: 11, lineHeight: 16, marginTop: 16 },
  emptyBox: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 12 },
  emptyIcon: { fontSize: 26, marginBottom: 8 },
  emptyText: { color: '#64748b', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 8 },
});
