'use client';
/** Student: one published result with question review (if allowed). Printable to PDF in the chosen language. */
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { useApi } from '@/lib/useApi';
import type { QType } from '@/lib/types';
import type { DictKey } from '@/lib/dictionary';
import { Badge, Button, Card, ErrorState, Loading, PageHeader } from '@/components/ui';
import { Logo } from '@/components/Logo';

interface Detail {
  attemptId: string;
  exam: { title: string; course: { code: string; name: string }; allowReview: boolean };
  score: number;
  maxScore: number;
  percentage: number;
  letter: string;
  submittedAt: string;
  questions: {
    position: number;
    type: QType;
    text: string;
    imageUrl: string | null;
    marks: number;
    options: { id: string; text: string; isCorrect: boolean }[];
    acceptedAnswers: string[];
    yourOptionId: string | null;
    yourText: string | null;
    awardedMarks: number;
    comment: string | null;
  }[];
}

export default function ResultDetailPage() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const { user } = useAuth();
  const { t, fmtDate } = useI18n();
  const { data, error, loading, reload } = useApi<Detail>(`/student/results/${attemptId}`);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorState error={error} onRetry={reload} />;
  const optLabel = (type: QType, text: string) => (type === 'TRUE_FALSE' ? (text === 'True' ? t('trueLabel') : t('falseLabel')) : text);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print">
        <PageHeader
          title={`${data.exam.course.code} · ${data.exam.title}`}
          actions={
            <>
              <Link href="/student/results">
                <Button variant="secondary">{t('back')}</Button>
              </Link>
              <Button onClick={() => window.print()}>{t('print')}</Button>
            </>
          }
        />
      </div>
      <div className="mb-4 hidden items-center gap-3 print:flex">
        <Logo size={40} />
        <div>
          <p className="text-lg font-bold">{t('appName')}</p>
          <p className="text-sm">
            {data.exam.course.code} · {data.exam.course.name} · {data.exam.title}
          </p>
        </div>
      </div>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm text-gray-500">{user?.fullName} {user?.studentId ? `(${user.studentId})` : ''}</p>
            <p className="text-sm text-gray-500">{t('submittedAt')}: {fmtDate(data.submittedAt)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase text-gray-500">{t('yourScore')}</p>
            <p className="text-3xl font-bold text-brand-800">
              {data.score} / {data.maxScore}
            </p>
            <p className="text-sm text-gray-700">
              {data.percentage}% · {t('grade')} <Badge tone={data.letter === 'F' ? 'red' : 'green'}>{data.letter}</Badge>
            </p>
          </div>
        </div>
      </Card>

      {!data.exam.allowReview ? (
        <p className="mt-4 rounded-lg bg-gray-50 p-4 text-sm text-gray-600">{t('reviewNotAllowed')}</p>
      ) : (
        <div className="mt-4 space-y-3">
          {data.questions.map((q) => {
            const full = q.awardedMarks >= q.marks;
            return (
              <Card key={q.position} className="break-inside-avoid">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-semibold text-gray-600">
                    {t('question')} {q.position} · {t(`type_${q.type}` as DictKey)}
                  </span>
                  <Badge tone={full ? 'green' : q.awardedMarks > 0 ? 'amber' : 'red'}>
                    {q.awardedMarks} / {q.marks}
                  </Badge>
                </div>
                <p className="whitespace-pre-line font-medium text-gray-900">{q.text}</p>
                {q.options.length > 0 && (
                  <ul className="mt-3 space-y-1.5 text-sm">
                    {q.options.map((o) => {
                      const mine = o.id === q.yourOptionId;
                      return (
                        <li key={o.id} className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${o.isCorrect ? 'border-brand-300 bg-brand-50' : mine ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}>
                          <span aria-hidden>{o.isCorrect ? '✓' : mine ? '✗' : '•'}</span>
                          <span>{optLabel(q.type, o.text)}</span>
                          {mine && <span className="ml-auto text-xs text-gray-600">{t('yourAnswer')}</span>}
                          {o.isCorrect && !mine && <span className="ml-auto text-xs text-brand-700">{t('correctAnswer')}</span>}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {(q.type === 'SHORT_ANSWER' || q.type === 'ESSAY') && (
                  <div className="mt-3 space-y-2 text-sm">
                    <p className="text-xs font-semibold uppercase text-gray-500">{t('yourAnswer')}</p>
                    <p className="whitespace-pre-line rounded-lg bg-gray-50 p-3">{q.yourText?.trim() || t('noAnswer')}</p>
                    {q.acceptedAnswers.length > 0 && <p className="text-brand-800">{t('acceptedWere', { list: q.acceptedAnswers.join(', ') })}</p>}
                  </div>
                )}
                {q.comment && (
                  <p className="mt-3 text-sm text-gray-700">
                    <span className="font-semibold">{t('comment')}:</span> {q.comment}
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
