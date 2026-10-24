import { useState, useEffect, useRef } from 'react';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { supabase } from '../lib/supabase';
import { Session, User } from '@supabase/supabase-js';

// Cần gọi để đóng trình duyệt auth sau khi nhận callback
WebBrowser.maybeCompleteAuthSession();

// Trích access_token / refresh_token từ URL callback (dạng #... hoặc ?...)
function tokensFromUrl(url: string) {
  const hashPart = url.includes('#') ? url.split('#')[1] : '';
  const queryPart = url.includes('?') ? url.split('?')[1] : '';
  const params = new URLSearchParams(hashPart || queryPart);
  return {
    accessToken: params.get('access_token'),
    refreshToken: params.get('refresh_token'),
    errorDescription: params.get('error_description') || params.get('error'),
  };
}

export function useGoogleAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const waiter = useRef<((ok: boolean) => void) | null>(null);

  // Nhận token từ deep link: Chrome mở trang Google rồi quay lại app bằng exp://.../auth/callback
  useEffect(() => {
    const handle = async (url: string | null) => {
      if (!url || !url.includes('auth/callback')) return;
      const { accessToken, refreshToken, errorDescription } = tokensFromUrl(url);
      if (errorDescription) {
        setAuthError(errorDescription);
        waiter.current?.(false);
        return;
      }
      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (error) setAuthError(error.message);
        waiter.current?.(!error);
      }
    };
    // App có thể bị Expo Go khởi động lại bằng chính deep link đó
    Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener('url', (e) => handle(e.url));
    return () => sub.remove();
  }, []);

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
      // Expo Go trả về exp://192.168.x.x:8081/--/auth/callback, bản cài thật trả về
      // vutruchuyennhuong://auth/callback. Dùng Linking.createURL để tự chọn đúng.
      const redirectUrl = Linking.createURL('/auth/callback');

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          skipBrowserRedirect: true,
        },
      });

      if (error) throw error;
      if (!data?.url) throw new Error('Không nhận được URL xác thực từ Google.');

      // Mở trình duyệt thật (Custom Tab). KHÔNG dùng openAuthSessionAsync: URL authorize
      // của Supabase đã chứa redirect_to nên tab bị coi là "đã redirect" và đóng ngay lập tức.
      // Token quay về qua deep link, xử lý trong effect ở trên.
      const done = new Promise<boolean>((resolve) => {
        waiter.current = resolve;
        setTimeout(() => resolve(false), 5 * 60 * 1000);
      });

      // Mở bằng intent thường (tab Chrome đầy đủ). Custom Tab của expo-web-browser
      // bị đóng ngay trên một số máy/emulator nên không dùng.
      await Linking.openURL(data.url);
      const ok = await done;
      if (!ok) setAuthError((prev) => prev || 'Chưa hoàn tất đăng nhập Google. Thử lại giúp mình nhé.');
      return ok;
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
