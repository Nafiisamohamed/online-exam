'use client';
/**
 * Essay / "Needs review" grading. The student's answer is shown beside the rubric; the
 * lecturer enters marks per criterion (or one mark) and a comment. Blind graders see
 * "Candidate N" instead of names.
 */
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useApi } from '@/lib/useApi';
import type { DictKey } from '@/lib/dictionary';
import { useToast } from '@/components/Toast';
import { Badge, Button, Card, Checkbox, Empty, ErrorState, Field, Input, Loading, PageHeader, Textarea } from '@/components/ui';

interface Item {
  answerId: string;
  status: 'NEEDS_REVIEW' | 'MANUALLY_GRADED';
  attemptId: string;
  student: string;
  question: { id: string; type: 'ESSAY' | 'SHORT_ANSWER'; text: string; marks: number; rubric: { criterion: string; points: number }[] | null; acceptedAnswers: string[] };
  textAnswer: string | null;
  awardedMarks: number | null;
  rubricScores: { criterion: string; points: number; awarded: number }[] | null;
  comment: string | null;
  gradedBy: string | null;
}
interface Queue {
  exam: { id: string; title: string; resultsPublished: boolean };
  blind: boolean;
  remaining: number;
  items: Item[];
}

export default function GradingPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const [all, setAll] = useState(false);
  const q = useApi<Queue>(`/exams/${id}/grading${all ? '?all=true' : ''}`);

  if (q.loading && !q.data) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={q.reload} />;
  const d = q.data;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={`${t('grading')}: ${d.exam.title}`}
        subtitle={t('gradingHelp')}
        actions={
          <Link href={`/exams/${id}/results`}>
            <Button variant="secondary">{t('openResults')}</Button>
          </Link>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <Badge tone={d.remaining ? 'amber' : 'green'}>{d.remaining ? t('remainingToGrade', { n: d.remaining }) : t('allGraded')}</Badge>
        {d.blind && <Badge tone="blue">{t('blindMode')}</Badge>}
        {d.exam.resultsPublished && <Badge tone="green">{t('published')}</Badge>}
        <Checkbox label={t('showGraded')} checked={all} onChange={setAll} />
      </div>
      {d.exam.resultsPublished && <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{t('gradingLocked')}</p>}
      {d.items.length === 0 ? (
        <Empty text={t('allGraded')} />
      ) : (
        <div className="space-y-4">
          {d.items.map((item) => (
            <GradeCard key={item.answerId} item={item} locked={d.exam.resultsPublished} onSaved={() => q.reload(true)} />
          ))}
        </div>
      )}
    </div>
  );
}

function GradeCard({ item, locked, onSaved }: { item: Item; locked: boolean; onSaved: () => void }) {
  const { t, errorMessage } = useI18n();
  const toast = useToast();
  const rubric = item.question.type === 'ESSAY' && item.question.rubric?.length ? item.question.rubric : null;
  const [scores, setScores] = useState<number[]>(rubric?.map((c, i) => item.rubricScores?.[i]?.awarded ?? 0) ?? []);
  const [marks, setMarks] = useState<number>(item.awardedMarks ?? 0);
  const [comment, setComment] = useState(item.comment ?? '');
  const [busy, setBusy] = useState(false);
  const total = rubric ? scores.reduce((s, x) => s + (Number(x) || 0), 0) : marks;

  async function save() {
    setBusy(true);
    try {
      await api(`/answers/${item.answerId}/grade`, {
        method: 'PUT',
        body: rubric
          ? { rubricScores: rubric.map((c, i) => ({ criterion: c.criterion, points: c.points, awarded: Number(scores[i]) || 0 })), comment: comment || null }
          : { awardedMarks: Number(marks), comment: comment || null },
      });
      toast.success(t('gradeSaved'));
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-semibold text-gray-900">{item.student}</span>
        <span className="flex items-center gap-2">
          <Badge tone="blue">{t(`type_${item.question.type}` as DictKey)}</Badge>
          <Badge tone={item.status === 'NEEDS_REVIEW' ? 'amber' : 'green'}>{item.status === 'NEEDS_REVIEW' ? t('needsReview') : `${t('graded')}${item.gradedBy ? ` · ${item.gradedBy}` : ''}`}</Badge>
        </span>
      </div>
      <p className="mb-3 font-medium text-gray-900">{item.question.text}</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase text-gray-500">{t('studentAnswer')}</p>
          <div className="max-h-72 overflow-y-auto whitespace-pre-line rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-900">{item.textAnswer?.trim() || t('noAnswer')}</div>
          {item.question.acceptedAnswers.length > 0 && <p className="mt-2 text-sm text-brand-800">{t('acceptedWere', { list: item.question.acceptedAnswers.join(', ') })}</p>}
        </div>
        <div className="space-y-3">
          {rubric ? (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase text-gray-500">{t('rubric')}</p>
              <ul className="space-y-2">
                {rubric.map((c, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <span className="flex-1 text-sm text-gray-800">{c.criterion}</span>
                    <Input type="number" min={0} max={c.points} step={0.5} value={scores[i]} disabled={locked} onChange={(e) => setScores(scores.map((s, j) => (j === i ? Number(e.target.value) : s)))} className="w-20" aria-label={c.criterion} />
                    <span className="w-10 text-sm text-gray-500">/ {c.points}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <Field label={`${t('awardMarks')} (0 - ${item.question.marks})`}>
              <Input type="number" min={0} max={item.question.marks} step={0.5} value={marks} disabled={locked} onChange={(e) => setMarks(Number(e.target.value))} className="w-32" />
            </Field>
          )}
          <p className="text-sm font-semibold text-gray-900">
            {t('total')}: {total} / {item.question.marks}
          </p>
          <Field label={t('comment')}>
            <Textarea rows={2} value={comment} disabled={locked} onChange={(e) => setComment(e.target.value)} maxLength={2000} />
          </Field>
          <Button onClick={save} loading={busy} disabled={locked}>{t('saveGrade')}</Button>
        </div>
      </div>
    </Card>
  );
}
