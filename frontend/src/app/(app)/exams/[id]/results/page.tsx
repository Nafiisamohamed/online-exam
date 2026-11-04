'use client';
/**
 * Results & analytics (lecturer / admin): results table with tab-switch counts, publish /
 * re-open, CSV export, exam statistics with a distribution chart, and per-question
 * difficulty index + discrimination (flagged under 20% / over 95%; "Not enough data" < 5).
 */
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { api, downloadFile } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useApi } from '@/lib/useApi';
import type { Difficulty } from '@/lib/types';
import type { DictKey } from '@/lib/dictionary';
import { useToast } from '@/components/Toast';
import { SimpleBarChart } from '@/components/Charts';
import { Badge, Button, Card, Empty, ErrorState, Field, Loading, Modal, PageHeader, Stat, Table, Tabs, Td, Textarea, Th } from '@/components/ui';

interface Results {
  exam: { id: string; title: string; courseCode: string; resultsPublished: boolean; publishedAt: string | null; allowReview: boolean };
  needsReview: number;
  inProgress: number;
  attempts: {
    attemptId: string;
    studentId: string | null;
    fullName: string;
    status: 'IN_PROGRESS' | 'SUBMITTED' | 'AUTO_SUBMITTED';
    gradingStatus: 'PENDING' | 'NEEDS_REVIEW' | 'GRADED';
    score: number | null;
    maxScore: number;
    percentage: number;
    letter: string;
    tabSwitches: number;
    submittedAt: string | null;
  }[];
}
interface Analytics {
  stats: { count: number; average: number | null; highest: number | null; lowest: number | null; distribution: { range: string; count: number }[] };
  passRate: number | null;
  passMark: number;
  flaggedStudents: number;
  questions: {
    questionId: string;
    version: number;
    text: string;
    type: string;
    topic: string;
    difficulty: Difficulty;
    marks: number;
    averageMarks: number | null;
    responses: number;
    enoughData: boolean;
    difficultyIndex: number | null;
    discrimination: number | null;
    flagged: boolean;
    flagReason: 'TOO_HARD' | 'TOO_EASY' | null;
  }[];
}

export default function ResultsPage() {
  const { id } = useParams<{ id: string }>();
  const { t, fmtDate, errorMessage } = useI18n();
  const toast = useToast();
  const [tab, setTab] = useState<'results' | 'analytics'>('results');
  const results = useApi<Results>(`/exams/${id}/results`);
  const analytics = useApi<Analytics>(tab === 'analytics' ? `/exams/${id}/analytics` : null);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  if (results.loading && !results.data) return <Loading />;
  if (results.error || !results.data) return <ErrorState error={results.error} onRetry={results.reload} />;
  const r = results.data;

  async function publish() {
    if (!confirm(t('publishConfirm'))) return;
    setBusy(true);
    try {
      const res = await api<{ published: number }>(`/exams/${id}/publish`, { method: 'POST' });
      toast.success(t('publishedOk', { n: res.published }));
      results.reload(true);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  async function reopen() {
    setBusy(true);
    try {
      await api(`/exams/${id}/reopen`, { method: 'POST', body: { reason } });
      toast.success(t('reopened'));
      setReopenOpen(false);
      setReason('');
      results.reload(true);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={`${r.exam.courseCode} · ${r.exam.title}`}
        subtitle={r.exam.resultsPublished ? `${t('published')} ${fmtDate(r.exam.publishedAt)}` : t('notPublished')}
        actions={
          <>
            <Link href={`/exams/${id}/grading`}><Button variant="secondary">{t('openGrading')}</Button></Link>
            <Button variant="secondary" onClick={() => downloadFile(`/exams/${id}/export.csv`, `grades-${r.exam.courseCode}.csv`).catch((e) => toast.error(errorMessage(e)))}>{t('exportCsv')}</Button>
            {r.exam.resultsPublished ? (
              <Button variant="warning" onClick={() => setReopenOpen(true)}>{t('reopen')}</Button>
            ) : (
              <Button onClick={publish} loading={busy} disabled={r.needsReview > 0 || r.inProgress > 0 || r.attempts.length === 0}>{t('publish')}</Button>
            )}
          </>
        }
      />
      {!r.exam.resultsPublished && (r.needsReview > 0 || r.inProgress > 0) && (
        <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          {r.needsReview > 0 && <>{t('remainingToGrade', { n: r.needsReview })}. </>}
          {r.inProgress > 0 && <>{t('live_IN_PROGRESS')}: {r.inProgress}.</>}
        </p>
      )}

      <Tabs tabs={[{ id: 'results', label: t('results') }, { id: 'analytics', label: t('analytics') }]} value={tab} onChange={setTab} />

      {tab === 'results' && (
        <Card>
          {r.attempts.length === 0 ? (
            <Empty />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('studentId')}</Th>
                  <Th>{t('name')}</Th>
                  <Th>{t('status')}</Th>
                  <Th>{t('score')}</Th>
                  <Th>{t('percentage')}</Th>
                  <Th>{t('grade')}</Th>
                  <Th>{t('tabSwitches')}</Th>
                  <Th>{t('submittedAt')}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {r.attempts.map((a) => (
                  <tr key={a.attemptId}>
                    <Td className="font-mono text-xs">{a.studentId}</Td>
                    <Td>{a.fullName}</Td>
                    <Td>
                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-gray-600">{t(`attemptStatus_${a.status}` as DictKey)}</span>
                        <Badge tone={a.gradingStatus === 'GRADED' ? 'green' : 'amber'}>{t(`gradingStatus_${a.gradingStatus}` as DictKey)}</Badge>
                      </div>
                    </Td>
                    <Td>{a.score ?? '-'} / {a.maxScore}</Td>
                    <Td>{a.percentage}%</Td>
                    <Td><Badge tone={a.letter === 'F' ? 'red' : 'green'}>{a.letter}</Badge></Td>
                    <Td>{a.tabSwitches >= 3 ? <Badge tone="red">⚠ {a.tabSwitches}</Badge> : a.tabSwitches}</Td>
                    <Td className="whitespace-nowrap text-gray-600">{fmtDate(a.submittedAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {tab === 'analytics' &&
        (analytics.loading ? (
          <Loading />
        ) : analytics.error || !analytics.data ? (
          <ErrorState error={analytics.error} onRetry={analytics.reload} />
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <Stat label={t('sat')} value={analytics.data.stats.count} tone="gray" />
              <Stat label={t('average')} value={analytics.data.stats.average !== null ? `${analytics.data.stats.average}%` : '-'} />
              <Stat label={t('highest')} value={analytics.data.stats.highest !== null ? `${analytics.data.stats.highest}%` : '-'} tone="gray" />
              <Stat label={t('lowest')} value={analytics.data.stats.lowest !== null ? `${analytics.data.stats.lowest}%` : '-'} tone="gray" />
              <Stat label={t('passRate')} value={analytics.data.passRate !== null ? `${analytics.data.passRate}%` : '-'} hint={`≥ ${analytics.data.passMark}%`} />
            </div>
            <Card title={t('distribution')}>
              <SimpleBarChart data={analytics.data.stats.distribution.map((d) => ({ label: d.range, value: d.count }))} valueLabel={t('students')} />
            </Card>
            <Card title={t('questionAnalysis')}>
              <p className="mb-3 text-sm text-gray-600">
                {t('reviewThese')} {t('difficultyIndex')}: {t('difficultyIndexHelp')}. {t('discrimination')}: {t('discriminationHelp')}.
              </p>
              <Table>
                <thead>
                  <tr>
                    <Th>{t('question')}</Th>
                    <Th>{t('difficulty')}</Th>
                    <Th>{t('responses')}</Th>
                    <Th>{t('difficultyIndex')}</Th>
                    <Th>{t('discrimination')}</Th>
                    <Th>{t('status')}</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {analytics.data.questions.map((q) => (
                    <tr key={q.questionId} className={q.flagged ? 'bg-red-50/60' : ''}>
                      <Td className="max-w-md">
                        <p className="line-clamp-2">{q.text}</p>
                        <p className="text-xs text-gray-500">{t(`type_${q.type}` as DictKey)} · {q.topic}{q.version > 1 ? ` · v${q.version}` : ''}</p>
                      </Td>
                      <Td>{t(`diff_${q.difficulty}` as DictKey)}</Td>
                      <Td>{q.responses}</Td>
                      <Td>{q.enoughData ? `${Math.round((q.difficultyIndex ?? 0) * 100)}%` : '-'}</Td>
                      <Td>{q.enoughData ? q.discrimination?.toFixed(2) : '-'}</Td>
                      <Td>
                        {!q.enoughData ? (
                          <Badge>{t('notEnoughData')}</Badge>
                        ) : q.flagReason === 'TOO_HARD' ? (
                          <Badge tone="red">⚠ {t('flagTooHard')}</Badge>
                        ) : q.flagReason === 'TOO_EASY' ? (
                          <Badge tone="amber">⚠ {t('flagTooEasy')}</Badge>
                        ) : (
                          <Badge tone="green">✓</Badge>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          </div>
        ))}

      <Modal
        open={reopenOpen}
        onClose={() => setReopenOpen(false)}
        title={t('reopen')}
        footer={<><Button variant="secondary" onClick={() => setReopenOpen(false)}>{t('cancel')}</Button><Button variant="warning" onClick={reopen} loading={busy} disabled={reason.trim().length < 3}>{t('reopen')}</Button></>}
      >
        <Field label={t('reopenReason')}>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Modal>
    </div>
  );
}
