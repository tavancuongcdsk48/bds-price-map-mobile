import { useState, useEffect } from 'react';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { supabase } from '../lib/supabase';
import { Session, User } from '@supabase/supabase-js';

// Cần gọi để đóng trình duyệt auth sau khi nhận callback
WebBrowser.maybeCompleteAuthSession();

export function useGoogleAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

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

  // Hàm kích hoạt đăng nhập Google 1 chạm
  const signInWithGoogle = async () => {
    try {
      setLoading(true);
      const redirectUrl = AuthSession.makeRedirectUri({
        scheme: 'bds-price-map',
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
        const params = new URLSearchParams(result.url.split('#')[1] || result.url.split('?')[1]);
        const accessToken = params.get('access_token');
        const refreshToken = params.get('refresh_token');

        if (accessToken && refreshToken) {
          const { error: setSessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (setSessionError) throw setSessionError;
        }
      }
    } catch (err: any) {
      console.warn('Lỗi đăng nhập Google:', err.message || err);
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
    signInWithGoogle,
    signOut,
    isAuthenticated: !!user,
  };
}
