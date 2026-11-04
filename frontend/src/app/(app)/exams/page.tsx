'use client';
/** Exams list (lecturer: own courses; admin: all) and "new exam" form. */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { useApi } from '@/lib/useApi';
import { STATUS_TONE, type Course, type Exam } from '@/lib/types';
import type { DictKey } from '@/lib/dictionary';
import { useToast } from '@/components/Toast';
import { Badge, Button, Card, Empty, ErrorState, Field, Input, Loading, Modal, PageHeader, Select, Table, Td, Th } from '@/components/ui';


export default function ExamsPage() {
  const { user } = useAuth();
  const { t, fmtDate, errorMessage } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const exams = useApi<Exam[]>('/exams');
  const courses = useApi<Course[]>(user?.role === 'LECTURER' || user?.role === 'ADMIN' ? '/courses' : null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ courseId: '', title: '', durationMinutes: 60 });
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const exam = await api<{ id: string }>('/exams', { method: 'POST', body: { ...form, courseId: form.courseId || courses.data?.[0]?.id } });
      toast.success(t('examCreated'));
      router.push(`/exams/${exam.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
    }
  }

  if (exams.loading) return <Loading />;
  if (exams.error) return <ErrorState error={exams.error} onRetry={exams.reload} />;

  return (
    <div>
      <PageHeader title={t('exams')} actions={<Button onClick={() => setOpen(true)}>+ {t('newExam')}</Button>} />
      {!exams.data?.length ? (
        <Empty />
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>{t('course')}</Th>
                <Th>{t('title')}</Th>
                <Th>{t('status')}</Th>
                <Th>{t('window')}</Th>
                <Th>{t('duration')}</Th>
                <Th>{t('stat_attempts')}</Th>
                <Th>{t('actions')}</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {exams.data.map((e) => {
                const isOwner = user?.role === 'ADMIN' || e.course.lecturerId === user?.id;
                return (
                  <tr key={e.id}>
                    <Td className="font-medium">{e.course.code}</Td>
                    <Td>
                      {e.title}
                      {e.resultsPublished && <span className="ml-2"><Badge tone="green">{t('published')}</Badge></span>}
                    </Td>
                    <Td><Badge tone={STATUS_TONE[e.status]}>{t(`examStatus_${e.status}` as DictKey)}</Badge></Td>
                    <Td className="whitespace-nowrap text-gray-600">{e.windowStart ? fmtDate(e.windowStart) : t('notScheduled')}</Td>
                    <Td>{e.durationMinutes}</Td>
                    <Td>{e._count.attempts}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm font-medium text-brand-700">
                        {isOwner && <Link href={`/exams/${e.id}`}>{t('edit')}</Link>}
                        {e._count.attempts > 0 && <Link href={`/exams/${e.id}/grading`}>{t('openGrading')}</Link>}
                        {isOwner && e._count.attempts > 0 && <Link href={`/exams/${e.id}/results`}>{t('openResults')}</Link>}
                        {isOwner && e.status === 'SCHEDULED' && <Link href={`/invigilate/${e.id}`}>{t('openLive')}</Link>}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('newExam')}
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>{t('cancel')}</Button><Button onClick={create} loading={busy} disabled={form.title.trim().length < 3}>{t('create')}</Button></>}
      >
        <div className="space-y-4">
          <Field label={t('course')}>
            <Select value={form.courseId} onChange={(e) => setForm({ ...form, courseId: e.target.value })}>
              {courses.data?.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
            </Select>
          </Field>
          <Field label={t('title')} required>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={150} />
          </Field>
          <Field label={t('duration')}>
            <Input type="number" min={1} max={480} value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: Number(e.target.value) })} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
