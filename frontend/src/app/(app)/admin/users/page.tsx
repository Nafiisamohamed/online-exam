'use client';
/** Registrar: staff and student accounts (create, enable/disable). */
import { useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useApi } from '@/lib/useApi';
import type { Role } from '@/lib/auth';
import type { DictKey } from '@/lib/dictionary';
import { useToast } from '@/components/Toast';
import { Badge, Button, Card, ErrorState, Field, Input, Loading, Modal, PageHeader, Select, Table, Td, Th } from '@/components/ui';

interface UserRow {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  phone: string | null;
  studentId: string | null;
  isActive: boolean;
}
const ROLES: Role[] = ['ADMIN', 'LECTURER', 'INVIGILATOR', 'STUDENT'];

export default function UsersPage() {
  const { t, errorMessage } = useI18n();
  const toast = useToast();
  const [role, setRole] = useState<Role | ''>('');
  const users = useApi<UserRow[]>(`/users${role ? `?role=${role}` : ''}`);
  const empty = { username: '', fullName: '', role: 'LECTURER' as Role, password: '', phone: '', studentId: '' };
  const [form, setForm] = useState<typeof empty | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!form) return;
    setBusy(true);
    try {
      await api('/users', { method: 'POST', body: { ...form, phone: form.phone || null, studentId: form.role === 'STUDENT' ? form.studentId : null } });
      toast.success(t('userCreated'));
      setForm(null);
      users.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  async function toggle(u: UserRow) {
    try {
      await api(`/users/${u.id}/active`, { method: 'PATCH', body: { isActive: !u.isActive } });
      users.reload(true);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div>
      <PageHeader title={t('nav_users')} actions={<Button onClick={() => setForm(empty)}>+ {t('newUser')}</Button>} />
      <div className="mb-4 max-w-xs">
        <Select value={role} onChange={(e) => setRole(e.target.value as Role | '')} aria-label={t('role')}>
          <option value="">{t('role')}: {t('all')}</option>
          {ROLES.map((r) => <option key={r} value={r}>{t(`role_${r}` as DictKey)}</option>)}
        </Select>
      </div>
      <Card>
        {users.loading ? (
          <Loading />
        ) : users.error ? (
          <ErrorState error={users.error} onRetry={users.reload} />
        ) : (
          <Table>
            <thead>
              <tr><Th>{t('fullName')}</Th><Th>{t('username')}</Th><Th>{t('role')}</Th><Th>{t('phone')}</Th><Th>{t('status')}</Th><Th /></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.data?.map((u) => (
                <tr key={u.id}>
                  <Td className="font-medium">{u.fullName}</Td>
                  <Td className="font-mono text-xs">{u.studentId ?? u.username}</Td>
                  <Td>{t(`role_${u.role}` as DictKey)}</Td>
                  <Td>{u.phone}</Td>
                  <Td>{u.isActive ? <Badge tone="green">{t('active')}</Badge> : <Badge>{t('inactive')}</Badge>}</Td>
                  <Td><Button size="sm" variant="ghost" onClick={() => toggle(u)}>{u.isActive ? t('disable') : t('enable')}</Button></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Modal open={!!form} onClose={() => setForm(null)} title={t('newUser')} footer={<><Button variant="secondary" onClick={() => setForm(null)}>{t('cancel')}</Button><Button onClick={create} loading={busy}>{t('create')}</Button></>}>
        {form && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2"><Field label={t('fullName')} required><Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></Field></div>
            <Field label={t('role')}>
              <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                {ROLES.map((r) => <option key={r} value={r}>{t(`role_${r}` as DictKey)}</option>)}
              </Select>
            </Field>
            <Field label={t('username')} required><Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></Field>
            {form.role === 'STUDENT' && <Field label={t('studentId')} required><Input value={form.studentId} onChange={(e) => setForm({ ...form, studentId: e.target.value })} /></Field>}
            <Field label={t('phone')}><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+25261..." /></Field>
            <Field label={t('password')} hint={t('passwordRules')} required><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
