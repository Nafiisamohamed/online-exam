'use client';
/** Account page: profile details and password change. */
import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useApi } from '@/lib/useApi';
import type { DictKey } from '@/lib/dictionary';
import { useToast } from '@/components/Toast';
import { Button, Card, Field, Input, LangSwitch, Loading, PageHeader } from '@/components/ui';

export default function ProfilePage() {
  const { t, errorMessage } = useI18n();
  const toast = useToast();
  const me = useApi<{ fullName: string; username: string; role: string; phone: string | null; email: string | null; studentId: string | null }>('/auth/me');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);

  async function change(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/auth/change-password', { method: 'POST', body: { currentPassword: current, newPassword: next } });
      toast.success(t('passwordChanged'));
      setCurrent('');
      setNext('');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (me.loading || !me.data) return <Loading />;
  const u = me.data;
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title={t('profile')} />
      <Card>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-gray-500">{t('fullName')}</dt><dd className="font-medium">{u.fullName}</dd></div>
          <div><dt className="text-gray-500">{t('role')}</dt><dd>{t(`role_${u.role}` as DictKey)}</dd></div>
          <div><dt className="text-gray-500">{t('username')}</dt><dd className="font-mono">{u.username}</dd></div>
          {u.studentId && <div><dt className="text-gray-500">{t('studentId')}</dt><dd className="font-mono">{u.studentId}</dd></div>}
          <div><dt className="text-gray-500">{t('phone')}</dt><dd>{u.phone ?? '-'}</dd></div>
          <div><dt className="text-gray-500">{t('language')}</dt><dd><LangSwitch /></dd></div>
        </dl>
      </Card>
      <Card title={t('changePassword')}>
        <form onSubmit={change} className="space-y-4">
          <Field label={t('currentPassword')}>
            <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" />
          </Field>
          <Field label={t('newPassword')} hint={t('passwordRules')}>
            <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} autoComplete="new-password" />
          </Field>
          <Button type="submit" loading={busy}>{t('save')}</Button>
        </form>
      </Card>
    </div>
  );
}
