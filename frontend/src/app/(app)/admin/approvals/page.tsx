'use client';
/** Registrar: approve or reject exam schedules requested by lecturers (with clash information). */
import { useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useApi } from '@/lib/useApi';
import type { Exam } from '@/lib/types';
import { useToast } from '@/components/Toast';
import { Badge, Button, Card, Empty, ErrorState, Field, Loading, Modal, PageHeader, Textarea } from '@/components/ui';

type Pending = Exam & { createdBy: { fullName: string }; clashes: { courseCode: string; title: string; sharedStudents: number }[] };

export default function ApprovalsPage() {
  const { t, fmtDate, errorMessage } = useI18n();
  const toast = useToast();
  const list = useApi<Pending[]>('/exams/approvals');
  const [rejecting, setRejecting] = useState<Pending | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  async function approve(e: Pending) {
    setBusy(e.id);
    try {
      await api(`/exams/${e.id}/approve`, { method: 'POST' });
      toast.success(t('approved'));
      list.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }
  async function reject() {
    if (!rejecting) return;
    setBusy(rejecting.id);
    try {
      await api(`/exams/${rejecting.id}/reject`, { method: 'POST', body: { reason } });
      toast.success(t('rejected'));
      setRejecting(null);
      setReason('');
      list.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (list.loading) return <Loading />;
  if (list.error) return <ErrorState error={list.error} onRetry={list.reload} />;
  return (
    <div>
      <PageHeader title={t('approvals')} />
      {!list.data?.length ? (
        <Empty text={t('noApprovals')} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {list.data.map((e) => (
            <Card key={e.id}>
              <p className="text-xs font-semibold uppercase text-brand-700">{e.course.code} · {e.course.name}</p>
              <h2 className="text-lg font-semibold">{e.title}</h2>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div><dt className="text-gray-500">{t('windowStart')}</dt><dd>{fmtDate(e.windowStart)}</dd></div>
                <div><dt className="text-gray-500">{t('windowEnd')}</dt><dd>{fmtDate(e.windowEnd)}</dd></div>
                <div><dt className="text-gray-500">{t('duration')}</dt><dd>{e.durationMinutes}</dd></div>
                <div><dt className="text-gray-500">{t('questions')}</dt><dd>{e.rules.reduce((s, r) => s + r.count, 0)}</dd></div>
                <div><dt className="text-gray-500">{t('rooms')}</dt><dd>{e.rooms.map((r) => r.room.name).join(', ') || '-'}</dd></div>
                <div><dt className="text-gray-500">{t('invigilators')}</dt><dd>{e.invigilators.map((i) => i.user.fullName).join(', ') || '-'}</dd></div>
                <div className="col-span-2"><dt className="text-gray-500">{t('requestedBy')}</dt><dd>{e.createdBy.fullName}</dd></div>
              </dl>
              {e.clashes.length > 0 ? (
                <ul className="mt-3 space-y-1 rounded-lg bg-red-50 p-3 text-sm text-red-800">
                  {e.clashes.map((c, i) => <li key={i}>✗ {t('clashWith', { course: c.courseCode, title: c.title, n: c.sharedStudents })}</li>)}
                </ul>
              ) : (
                <p className="mt-3"><Badge tone="green">✓ {t('clashes')}: 0</Badge></p>
              )}
              <div className="mt-4 flex gap-2">
                <Button onClick={() => approve(e)} loading={busy === e.id} disabled={e.clashes.length > 0}>{t('approve')}</Button>
                <Button variant="secondary" onClick={() => setRejecting(e)}>{t('reject')}</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Modal open={!!rejecting} onClose={() => setRejecting(null)} title={t('reject')} footer={<><Button variant="secondary" onClick={() => setRejecting(null)}>{t('cancel')}</Button><Button variant="danger" onClick={reject} loading={!!busy} disabled={reason.trim().length < 3}>{t('reject')}</Button></>}>
        <Field label={t('rejectReason')}><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Modal>
    </div>
  );
}
