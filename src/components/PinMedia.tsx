import React, { useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
  FlatList,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { PinMediaItem } from '../services/pinService';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

/** Dải thumbnail ảnh/video trong thẻ chi tiết ghim */
export const MediaStrip: React.FC<{
  items: PinMediaItem[];
  onOpen: (index: number) => void;
}> = ({ items, onOpen }) => {
  if (items.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.stripRow}
    >
      {items.map((m, idx) => (
        <TouchableOpacity key={m.id} activeOpacity={0.85} onPress={() => onOpen(idx)} style={styles.thumbWrap}>
          <Image
            source={{ uri: m.thumbnail_url || m.url }}
            style={styles.thumb}
            resizeMode="cover"
          />
          {m.media_type === 'video' && (
            <View style={styles.playOverlay}>
              <Text style={styles.playIcon}>▶</Text>
              {m.duration_seconds > 0 && <Text style={styles.duration}>{m.duration_seconds}s</Text>}
            </View>
          )}
          {m.media_type === 'image' && idx === 0 && items.length > 1 && (
            <View style={styles.countPill}>
              <Text style={styles.countText}>+{items.length - 1}</Text>
            </View>
          )}
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
};

const VideoSlide: React.FC<{ uri: string }> = ({ uri }) => {
  // expo-video chỉ có VideoView; dùng component riêng để tránh lỗi hook trong list
  const { VideoView, useVideoPlayer } = require('expo-video');
  const player = useVideoPlayer(uri, (p: any) => {
    p.loop = false;
    p.play();
  });
  return <VideoView style={styles.fullMedia} player={player} contentFit="contain" nativeControls />;
};

/** Xem full ảnh/video, vuốt ngang giữa các ảnh */
export const MediaViewer: React.FC<{
  visible: boolean;
  items: PinMediaItem[];
  startIndex: number;
  onClose: () => void;
}> = ({ visible, items, startIndex, onClose }) => {
  const [index, setIndex] = useState(startIndex);

  React.useEffect(() => {
    if (visible) setIndex(startIndex);
  }, [visible, startIndex]);

  if (!visible || items.length === 0) return null;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.viewerBackdrop}>
        <View style={styles.viewerTop}>
          <Text style={styles.viewerCount}>
            {index + 1}/{items.length}
          </Text>
          <TouchableOpacity onPress={onClose} style={styles.viewerClose}>
            <Text style={styles.viewerCloseText}>✕</Text>
          </TouchableOpacity>
        </View>

        <FlatList
          data={items}
          horizontal
          pagingEnabled
          initialScrollIndex={startIndex}
          getItemLayout={(_, i) => ({ length: SCREEN_W, offset: SCREEN_W * i, index: i })}
          keyExtractor={(m) => m.id}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / SCREEN_W))}
          renderItem={({ item }) =>
            item.media_type === 'video' ? (
              <VideoSlide uri={item.url} />
            ) : (
              <Image source={{ uri: item.url }} style={styles.fullMedia} resizeMode="contain" />
            )
          }
        />

        <Text style={styles.viewerHint}>Vuốt ngang để xem ảnh khác</Text>
      </View>
    </Modal>
  );
};

const THUMB = 96;

const styles = StyleSheet.create({
  stripRow: { gap: 8, paddingVertical: 4, paddingRight: 4 },
  thumbWrap: { width: THUMB, height: THUMB * 0.75, borderRadius: 10, overflow: 'hidden', backgroundColor: '#1e293b' },
  thumb: { width: '100%', height: '100%' },
  playOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(2,6,23,0.35)',
  },
  playIcon: { color: '#fff', fontSize: 20, fontWeight: '800' },
  duration: { color: '#e2e8f0', fontSize: 9, marginTop: 2 },
  countPill: {
    position: 'absolute',
    right: 5,
    bottom: 5,
    backgroundColor: 'rgba(2,6,23,0.75)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  countText: { color: '#fff', fontSize: 10, fontWeight: '700' },

  viewerBackdrop: { flex: 1, backgroundColor: 'rgba(2,6,23,0.97)' },
  viewerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 56,
    paddingBottom: 10,
  },
  viewerCount: { color: '#e2e8f0', fontSize: 13, fontWeight: '700' },
  viewerClose: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerCloseText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  fullMedia: { width: SCREEN_W, height: SCREEN_H * 0.62, backgroundColor: '#000' },
  viewerHint: { color: '#64748b', fontSize: 11, textAlign: 'center', marginTop: 12 },
});
