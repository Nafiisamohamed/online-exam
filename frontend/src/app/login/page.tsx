'use client';
/** Login screen (username or student ID + password). Shows the seeded demo accounts. */
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { Button, Field, Input, LangSwitch } from '@/components/ui';
import { Logo } from '@/components/Logo';

const DEMO = [
  { role: 'role_ADMIN', id: 'admin', pw: 'Admin@123' },
  { role: 'role_LECTURER', id: 'abdirahman', pw: 'Lecturer@123' },
  { role: 'role_INVIGILATOR', id: 'mohamed.jama', pw: 'Invigilator@123' },
  { role: 'role_STUDENT', id: 'JB-24-001', pw: 'Student@123' },
  { role: 'role_STUDENT', id: 'JB-24-002', pw: 'Student@123' },
] as const;

export default function LoginPage() {
  const { login, user, ready } = useAuth();
  const { t, errorMessage } = useI18n();
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && user) router.replace('/dashboard');
  }, [ready, user, router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(identifier, password);
      router.replace('/dashboard');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-brand-50 to-white">
      <div className="flex justify-end p-4">
        <LangSwitch />
      </div>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 pb-12">
        <div className="mb-6 flex flex-col items-center text-center">
          <Logo size={56} />
          <h1 className="mt-3 text-2xl font-bold text-gray-900">{t('loginTitle')}</h1>
          <p className="mt-1 text-sm text-gray-600">{t('appTagline')}</p>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-card">
          <p className="text-sm text-gray-600">{t('loginSubtitle')}</p>
          <Field label={t('identifier')}>
            <Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" required autoFocus />
          </Field>
          <Field label={t('password')}>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </Field>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}
          <Button type="submit" className="w-full" size="lg" loading={busy}>
            {busy ? t('loggingIn') : t('login')}
          </Button>
        </form>
        <details className="mt-5 rounded-xl border border-gray-200 bg-white p-4 text-sm">
          <summary className="cursor-pointer font-medium text-gray-800">{t('demoAccounts')}</summary>
          <ul className="mt-3 space-y-2">
            {DEMO.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => {
                    setIdentifier(d.id);
                    setPassword(d.pw);
                  }}
                  className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left hover:bg-brand-50"
                >
                  <span className="text-gray-600">{t(d.role)}</span>
                  <span className="font-mono text-xs text-gray-900">
                    {d.id} / {d.pw}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      </main>
    </div>
  );
}
