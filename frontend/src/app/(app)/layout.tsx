'use client';
/**
 * Authenticated app shell: role-based sidebar (drawer on phones), top bar with
 * language switch, notifications and account menu. Redirects to /login when logged out.
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuth, type Role } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { useApi } from '@/lib/useApi';
import type { DictKey } from '@/lib/dictionary';
import { LangSwitch, Loading } from '@/components/ui';
import { Logo } from '@/components/Logo';

const NAV: Record<Role, { href: string; key: DictKey; icon: string }[]> = {
  ADMIN: [
    { href: '/dashboard', key: 'nav_dashboard', icon: '▦' },
    { href: '/admin/courses', key: 'nav_courses', icon: '📚' },
    { href: '/admin/students', key: 'nav_students', icon: '🎓' },
    { href: '/admin/rooms', key: 'nav_rooms', icon: '🏫' },
    { href: '/admin/users', key: 'nav_users', icon: '👥' },
    { href: '/admin/approvals', key: 'nav_approvals', icon: '✔' },
    { href: '/exams', key: 'nav_exams', icon: '📝' },
    { href: '/payments', key: 'nav_payments', icon: '💳' },
    { href: '/admin/outbox', key: 'nav_outbox', icon: '✉' },
    { href: '/admin/audit', key: 'nav_audit', icon: '🛡' },
  ],
  LECTURER: [
    { href: '/dashboard', key: 'nav_dashboard', icon: '▦' },
    { href: '/bank', key: 'nav_questionBank', icon: '🗂' },
    { href: '/exams', key: 'nav_exams', icon: '📝' },
  ],
  STUDENT: [
    { href: '/dashboard', key: 'nav_dashboard', icon: '▦' },
    { href: '/student/exams', key: 'nav_myExams', icon: '📝' },
    { href: '/student/results', key: 'nav_results', icon: '🏅' },
    { href: '/payments', key: 'nav_payments', icon: '💳' },
  ],
  INVIGILATOR: [
    { href: '/dashboard', key: 'nav_dashboard', icon: '▦' },
    { href: '/invigilate', key: 'nav_invigilate', icon: '👁' },
  ],
};

export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, ready, logout } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const notes = useApi<{ unread: number }>(user ? '/notifications' : null, 30_000);

  useEffect(() => {
    if (ready && !user) router.replace('/login');
  }, [ready, user, router]);
  useEffect(() => setOpen(false), [pathname]);

  if (!ready || !user) return <Loading />;
  const items = NAV[user.role];

  const nav = (
    <nav className="flex flex-col gap-1 p-3">
      {items.map((item) => {
        const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${active ? 'bg-brand-700 text-white' : 'text-gray-700 hover:bg-brand-50 hover:text-brand-900'}`}
          >
            <span className="w-5 text-center" aria-hidden>
              {item.icon}
            </span>
            {t(item.key)}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen bg-gray-50/60">
      <header className="no-print sticky top-0 z-30 border-b border-gray-200 bg-white">
        <div className="flex h-14 items-center gap-3 px-4">
          <button className="rounded-lg p-2 text-gray-700 hover:bg-gray-100 lg:hidden" onClick={() => setOpen(true)} aria-label={t('menu')}>
            ☰
          </button>
          <Link href="/dashboard" className="flex items-center gap-2">
            <Logo size={30} />
            <span className="text-lg font-bold text-brand-800">{t('appName')}</span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <LangSwitch compact />
            <Link href="/notifications" className="relative rounded-lg p-2 text-gray-700 hover:bg-gray-100" aria-label={t('nav_notifications')}>
              🔔
              {!!notes.data?.unread && (
                <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-red-600 px-1 text-center text-[10px] font-bold text-white">{notes.data.unread}</span>
              )}
            </Link>
            <Link href="/profile" className="hidden text-right sm:block">
              <span className="block text-sm font-medium leading-4 text-gray-900">{user.fullName}</span>
              <span className="text-xs text-gray-500">{t(`role_${user.role}` as DictKey)}</span>
            </Link>
            <button onClick={logout} className="rounded-lg px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-100">
              {t('logout')}
            </button>
          </div>
        </div>
      </header>

      <div className="flex">
        <aside className="no-print sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 overflow-y-auto border-r border-gray-200 bg-white lg:block">{nav}</aside>
        {open && (
          <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setOpen(false)}>
            <aside className="h-full w-72 max-w-[85vw] overflow-y-auto bg-white" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
                <Logo size={28} />
                <div>
                  <p className="text-sm font-semibold">{user.fullName}</p>
                  <p className="text-xs text-gray-500">{t(`role_${user.role}` as DictKey)}</p>
                </div>
              </div>
              {nav}
              <div className="border-t border-gray-100 p-3">
                <Link href="/profile" className="block rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-100">
                  {t('profile')}
                </Link>
              </div>
            </aside>
          </div>
        )}
        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
