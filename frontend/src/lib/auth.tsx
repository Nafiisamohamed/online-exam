'use client';
/**
 * Login session. Stores the JWT, loads the current user from /auth/me and exposes
 * login/logout. The UI hides menu items by role, but the SERVER enforces permissions.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken, setToken, setUnauthorizedHandler } from './api';

export type Role = 'ADMIN' | 'LECTURER' | 'STUDENT' | 'INVIGILATOR';
export interface User {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  studentId: string | null;
}

interface AuthState {
  user: User | null;
  ready: boolean;
  login: (identifier: string, password: string) => Promise<User>;
  logout: () => void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const router = useRouter();

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    router.replace('/login');
  }, [router]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken(null);
      setUser(null);
      if (!window.location.pathname.startsWith('/login')) router.replace('/login');
    });
    if (!getToken()) {
      setReady(true);
      return;
    }
    api<User>('/auth/me')
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setReady(true));
    return () => setUnauthorizedHandler(null);
  }, [router]);

  const login = useCallback(async (identifier: string, password: string) => {
    const res = await api<{ token: string; user: User }>('/auth/login', { method: 'POST', body: { identifier, password } });
    setToken(res.token);
    setUser(res.user);
    return res.user;
  }, []);

  return <Ctx.Provider value={{ user, ready, login, logout }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
