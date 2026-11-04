'use client';
/** Student: scheduled exams of enrolled courses with Start / Resume. */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useApi } from '@/lib/useApi';
import type { StudentExam } from '@/lib/types';
import { useToast } from '@/components/Toast';
import { Badge, Button, Card, Empty, ErrorState, Loading, Modal, PageHeader } from '@/components/ui';

export default function StudentExamsPage() {
  const { t, fmtDate, errorMessage } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const { data, error, loading, reload } = useApi<StudentExam[]>('/student/exams');
  const [confirm, setConfirm] = useState<StudentExam | null>(null);
  const [busy, setBusy] = useState(false);

  async function start(exam: StudentExam) {
    setBusy(true);
    try {
      const res = await api<{ attemptId: string }>(`/exams/${exam.id}/start`, { method: 'POST' });
      router.push(`/exam/${res.attemptId}`);
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
      reload();
    }
  }

  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  return (
    <div>
      <PageHeader title={t('myExams')} />
      {!data?.length ? (
        <Empty text={t('noExams')} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.map((e) => {
            const inProgress = e.attempt?.status === 'IN_PROGRESS';
            const done = e.attempt && !inProgress;
            return (
              <Card key={e.id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold uppercase text-brand-700">{e.course.code} · {e.course.name}</p>
                    <h2 className="mt-1 text-lg font-semibold text-gray-900">{e.title}</h2>
                  </div>
                  {done ? (
                    <Badge tone="green">{t('live_SUBMITTED')}</Badge>
                  ) : e.windowState === 'OPEN' ? (
                    <Badge tone="green">{t('windowOpen')}</Badge>
                  ) : e.windowState === 'CLOSED' ? (
                    <Badge>{t('windowClosed')}</Badge>
                  ) : (
                    <Badge tone="blue">{t('windowNotOpen')}</Badge>
                  )}
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <dt className="text-gray-500">{t('windowStart')}</dt>
                    <dd>{fmtDate(e.windowStart)}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">{t('windowEnd')}</dt>
                    <dd>{fmtDate(e.windowEnd)}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">{t('duration')}</dt>
                    <dd>{e.durationMinutes}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">{t('questions')}</dt>
                    <dd>{e.questionCount}</dd>
                  </div>
                </dl>
                {e.instructions && <p className="mt-3 whitespace-pre-line rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{e.instructions}</p>}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {inProgress && (
                    <Button onClick={() => start(e)} loading={busy}>
                      {t('resumeExam')}
                    </Button>
                  )}
                  {!e.attempt && e.windowState === 'OPEN' && <Button onClick={() => setConfirm(e)}>{t('startExam')}</Button>}
                  {done && <span className="text-sm text-gray-600">{t('submittedOn', { time: fmtDate(e.attempt!.submittedAt) })}</span>}
                  {done && e.resultsPublished && <Badge tone="green">{t('resultsPublishedTag')}</Badge>}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm ? `${confirm.course.code} · ${confirm.title}` : ''}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              {t('cancel')}
            </Button>
            <Button onClick={() => confirm && start(confirm)} loading={busy}>
              {t('startExam')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-700">{t('startConfirm')}</p>
      </Modal>
    </div>
  );
}
