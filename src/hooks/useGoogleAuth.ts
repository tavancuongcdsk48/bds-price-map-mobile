import { useState, useEffect } from 'react';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { supabase } from '../lib/supabase';
import { Session, User } from '@supabase/supabase-js';

// Cần gọi để đóng trình duyệt auth sau khi nhận callback
WebBrowser.maybeCompleteAuthSession();

const SCHEME = 'vutruchuyennhuong';

export function useGoogleAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  // Lấy session hiện tại khi mở app
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Hàm kích hoạt đăng nhập Google 1 chạm. Trả về true nếu đăng nhập thành công.
  const signInWithGoogle = async (): Promise<boolean> => {
    setAuthError(null);
    try {
      setLoading(true);
      const redirectUrl = AuthSession.makeRedirectUri({
        scheme: SCHEME,
        path: 'auth/callback',
      });

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          skipBrowserRedirect: true,
        },
      });

      if (error) throw error;
      if (!data?.url) throw new Error('Không nhận được URL xác thực từ Google.');

      // Mở trình duyệt Custom Tab / Safari View Controller
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);

      if (result.type === 'success' && result.url) {
        // Trích xuất mã xác thực từ redirect URL
        const hashPart = result.url.includes('#') ? result.url.split('#')[1] : '';
        const queryPart = result.url.includes('?') ? result.url.split('?')[1] : '';
        const params = new URLSearchParams(hashPart || queryPart);

        const accessToken = params.get('access_token');
        const refreshToken = params.get('refresh_token');
        const errorDescription = params.get('error_description');

        if (errorDescription) throw new Error(errorDescription);

        if (accessToken && refreshToken) {
          const { error: setSessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (setSessionError) throw setSessionError;
          return true;
        }
        throw new Error('Không nhận được token đăng nhập từ Google.');
      }

      if (result.type === 'cancel' || result.type === 'dismiss') {
        setAuthError('Bạn đã huỷ đăng nhập Google.');
        return false;
      }
      return false;
    } catch (err: any) {
      const msg = String(err?.message || err || '');
      const lower = msg.toLowerCase();
      const friendly =
        lower.includes('provider is not enabled') || lower.includes('unsupported provider')
          ? 'Google chưa được bật trong Supabase Auth. Cần thêm Client ID/Secret từ Google Cloud.'
          : msg || 'Đăng nhập Google thất bại.';
      console.warn('Lỗi đăng nhập Google:', friendly);
      setAuthError(friendly);
      return false;
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    try {
      setLoading(true);
      await supabase.auth.signOut();
    } catch (err) {
      console.warn('Lỗi đăng xuất:', err);
    } finally {
      setLoading(false);
    }
  };

  return {
    session,
    user,
    loading,
    authError,
    signInWithGoogle,
    signOut,
    isAuthenticated: !!user,
  };
}
