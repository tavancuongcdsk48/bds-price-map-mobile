import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { supabase } from '../lib/supabase';

interface AuthModalProps {
  visible: boolean;
  onClose: () => void;
  onGoogle: () => Promise<boolean>;
  onSignedIn: () => void;
}

/**
 * Đăng nhập tài khoản cho app.
 * - Google OAuth: đường chính (cần cấu hình Client ID trong Supabase).
 * - Email + mật khẩu: đường dự phòng để dùng được ngay, cùng một hệ tài khoản Supabase
 *   nên quyền tạo/sửa/xoá ghim vẫn gắn đúng người.
 */
export const AuthModal: React.FC<AuthModalProps> = ({ visible, onClose, onGoogle, onSignedIn }) => {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  if (!visible) return null;

  const submit = async () => {
    if (!email.includes('@') || password.length < 6) {
      Alert.alert('Chưa hợp lệ', 'Nhập email và mật khẩu tối thiểu 6 ký tự.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        if (!data.session) {
          Alert.alert(
            'Cần xác nhận email',
            'Hệ thống đã gửi email xác nhận. Nếu đang chạy Supabase local, mở hộp thư tại http://127.0.0.1:54324 để xác nhận rồi đăng nhập lại.'
          );
          setMode('signin');
          setBusy(false);
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      }
      setBusy(false);
      setEmail('');
      setPassword('');
      onSignedIn();
    } catch (err: any) {
      setBusy(false);
      Alert.alert('Đăng nhập thất bại', String(err?.message || err));
    }
  };

  return (
    <View style={styles.backdrop}>
      <View style={styles.card}>
        <Text style={styles.title}>
          {mode === 'signin' ? 'Đăng nhập để ghim nhà' : 'Tạo tài khoản mới'}
        </Text>
        <Text style={styles.sub}>
          Ghim, sửa giá và xoá ghim đều thuộc về tài khoản đăng nhập. Muốn quản lý nhà mình thì phải đăng
          nhập đúng tài khoản đã đăng.
        </Text>

        <TouchableOpacity
          style={styles.googleBtn}
          onPress={async () => {
            const ok = await onGoogle();
            if (ok) onSignedIn();
          }}
        >
          <Text style={styles.googleText}>G  Đăng nhập bằng Google</Text>
        </TouchableOpacity>

        <View style={styles.dividerRow}>
          <View style={styles.divider} />
          <Text style={styles.dividerText}>hoặc</Text>
          <View style={styles.divider} />
        </View>

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#64748b"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder="Mật khẩu"
          placeholderTextColor="#64748b"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        <TouchableOpacity style={styles.primaryBtn} onPress={submit} disabled={busy}>
          {busy ? (
            <ActivityIndicator color="#052e16" />
          ) : (
            <Text style={styles.primaryText}>
              {mode === 'signin' ? 'Đăng nhập' : 'Tạo tài khoản'}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.switchBtn}
          onPress={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
        >
          <Text style={styles.switchText}>
            {mode === 'signin' ? 'Chưa có tài khoản? Tạo mới' : 'Đã có tài khoản? Đăng nhập'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <Text style={styles.closeText}>Để sau</Text>
        </TouchableOpacity>
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
    backgroundColor: 'rgba(2,6,23,0.82)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    zIndex: 400,
    elevation: 400,
  },
  card: {
    width: '100%',
    backgroundColor: '#111c33',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  title: { color: '#f8fafc', fontSize: 17, fontWeight: '800' },
  sub: { color: '#94a3b8', fontSize: 12, marginTop: 6, lineHeight: 17 },

  googleBtn: {
    marginTop: 14,
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  googleText: { color: '#0f172a', fontSize: 14, fontWeight: '800' },

  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 14 },
  divider: { flex: 1, height: 1, backgroundColor: '#1e293b' },
  dividerText: { color: '#64748b', fontSize: 11 },

  input: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: '#ffffff',
    fontSize: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    marginBottom: 10,
  },

  primaryBtn: {
    backgroundColor: '#22c55e',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryText: { color: '#052e16', fontSize: 14, fontWeight: '800' },

  switchBtn: { alignItems: 'center', paddingTop: 12 },
  switchText: { color: '#22c55e', fontSize: 12 },
  closeBtn: { alignItems: 'center', paddingTop: 10 },
  closeText: { color: '#64748b', fontSize: 12 },
});
