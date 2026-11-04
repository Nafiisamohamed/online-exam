'use client';
/** Lecturer question bank: only the lecturer's own courses (enforced by the API). */
import { useEffect, useState } from 'react';
import { api, downloadFile } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useApi } from '@/lib/useApi';
import type { Course, Difficulty, QType, Question } from '@/lib/types';
import type { DictKey } from '@/lib/dictionary';
import { useToast } from '@/components/Toast';
import { QuestionEditor } from '@/components/QuestionEditor';
import { CsvImport, type ImportRow } from '@/components/CsvImport';
import { Badge, Button, Card, Empty, ErrorState, Input, Loading, PageHeader, Select } from '@/components/ui';

const DIFF_TONE: Record<Difficulty, 'green' | 'amber' | 'red'> = { EASY: 'green', MEDIUM: 'amber', HARD: 'red' };

export default function BankPage() {
  const { t, errorMessage } = useI18n();
  const toast = useToast();
  const courses = useApi<Course[]>('/courses');
  const [courseId, setCourseId] = useState('');
  const [type, setType] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [topic, setTopic] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Question | 'new' | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (!courseId && courses.data?.length) setCourseId(courses.data[0].id);
  }, [courses.data, courseId]);

  const qs = new URLSearchParams({ ...(type && { type }), ...(difficulty && { difficulty }), ...(topic && { topic }), ...(search && { search }) }).toString();
  const questions = useApi<Question[]>(courseId ? `/courses/${courseId}/questions${qs ? `?${qs}` : ''}` : null);
  const summary = useApi<{ topics: string[]; counts: { topic: string; difficulty: Difficulty; count: number }[] }>(courseId ? `/courses/${courseId}/bank-summary` : null);

  async function archive(q: Question) {
    if (!confirm(t('archiveConfirm'))) return;
    try {
      await api(`/questions/${q.id}`, { method: 'DELETE' });
      toast.success(t('questionArchived'));
      questions.reload();
      summary.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  if (courses.loading) return <Loading />;
  if (courses.error) return <ErrorState error={courses.error} onRetry={courses.reload} />;
  const totals = (d: Difficulty) => summary.data?.counts.filter((c) => c.difficulty === d).reduce((s, c) => s + c.count, 0) ?? 0;

  return (
    <div>
      <PageHeader
        title={t('questionBank')}
        actions={
          courseId && (
            <>
              <Button variant="secondary" onClick={() => setImporting(true)}>{t('importQuestions')}</Button>
              <Button onClick={() => setEditing('new')}>+ {t('newQuestion')}</Button>
            </>
          )
        }
      />
      {!courses.data?.length ? (
        <Empty />
      ) : (
        <>
          <div className="mb-4 grid gap-3 md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_minmax(0,2fr)]">
            <Select value={courseId} onChange={(e) => { setCourseId(e.target.value); setTopic(''); }} aria-label={t('course')}>
              {courses.data.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
            </Select>
            <Select value={type} onChange={(e) => setType(e.target.value)} aria-label={t('type')}>
              <option value="">{t('type')}: {t('filterAll')}</option>
              {(['MCQ', 'TRUE_FALSE', 'SHORT_ANSWER', 'ESSAY'] as QType[]).map((x) => <option key={x} value={x}>{t(`type_${x}` as DictKey)}</option>)}
            </Select>
            <Select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} aria-label={t('difficulty')}>
              <option value="">{t('difficulty')}: {t('filterAll')}</option>
              {(['EASY', 'MEDIUM', 'HARD'] as Difficulty[]).map((x) => <option key={x} value={x}>{t(`diff_${x}` as DictKey)}</option>)}
            </Select>
            <Select value={topic} onChange={(e) => setTopic(e.target.value)} aria-label={t('topic')}>
              <option value="">{t('topic')}: {t('filterAll')}</option>
              {summary.data?.topics.map((x) => <option key={x} value={x}>{x}</option>)}
            </Select>
            <Input placeholder={`${t('search')}...`} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="mb-4 flex flex-wrap gap-2 text-sm">
            {(['EASY', 'MEDIUM', 'HARD'] as Difficulty[]).map((d) => (
              <Badge key={d} tone={DIFF_TONE[d]}>{t(`diff_${d}` as DictKey)}: {totals(d)}</Badge>
            ))}
          </div>
          {questions.loading ? (
            <Loading />
          ) : questions.error ? (
            <ErrorState error={questions.error} onRetry={questions.reload} />
          ) : !questions.data?.length ? (
            <Empty text={t('noQuestions')} />
          ) : (
            <div className="space-y-3">
              {questions.data.map((q) => (
                <Card key={q.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                        <Badge tone="blue">{t(`type_${q.type}` as DictKey)}</Badge>
                        <Badge tone={DIFF_TONE[q.difficulty]}>{t(`diff_${q.difficulty}` as DictKey)}</Badge>
                        <Badge>{q.topic}</Badge>
                        <span className="text-gray-500">{t('marksN', { n: q.marks })}</span>
                        {q.version > 1 && <span className="text-gray-500">{t('version')} {q.version}</span>}
                        {!!q._count?.attemptQuestions && <span className="text-gray-500">· {t('usedInExams', { n: q._count.attemptQuestions })}</span>}
                      </div>
                      <p className="whitespace-pre-line text-gray-900">{q.text}</p>
                      {q.imageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={q.imageUrl} alt="" className="mt-2 max-h-32 rounded border" />
                      )}
                      {q.options.length > 0 && (
                        <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
                          {q.options.map((o, i) => (
                            <li key={o.id} className={o.isCorrect ? 'font-medium text-brand-800' : 'text-gray-600'}>
                              {q.type === 'MCQ' ? `${'ABCDE'[i]}. ` : ''}
                              {q.type === 'TRUE_FALSE' ? (o.text === 'True' ? t('trueLabel') : t('falseLabel')) : o.text} {o.isCorrect && '✓'}
                            </li>
                          ))}
                        </ul>
                      )}
                      {q.type === 'SHORT_ANSWER' && <p className="mt-2 text-sm text-brand-800">{t('acceptedWere', { list: q.acceptedAnswers.join(', ') })}</p>}
                      {q.type === 'ESSAY' && q.rubric && (
                        <p className="mt-2 text-sm text-gray-600">{t('rubric')}: {q.rubric.map((r) => `${r.criterion} (${r.points})`).join(' · ')}</p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setEditing(q)}>{t('edit')}</Button>
                      <Button size="sm" variant="ghost" onClick={() => archive(q)}>{t('delete')}</Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {editing && (
        <QuestionEditor
          courseId={courseId}
          question={editing === 'new' ? null : editing}
          topics={summary.data?.topics ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); questions.reload(); summary.reload(); }}
        />
      )}
      {importing && (
        <CsvImport
          title={t('importQuestions')}
          endpoint={`/courses/${courseId}/questions/import`}
          help="type, text, option_a..option_e, correct, accepted_answers, marks, topic, difficulty, image_url"
          templateHref={() => downloadFile('/questions/import/template', 'imtixaan-questions-template.csv')}
          columns={[
            { label: t('type'), render: (r: ImportRow) => String((r.question as { type?: string })?.type ?? '') },
            { label: t('question'), render: (r: ImportRow) => <span className="line-clamp-2">{String((r.question as { text?: string })?.text ?? '')}</span> },
            { label: t('topic'), render: (r: ImportRow) => String((r.question as { topic?: string })?.topic ?? '') },
            { label: t('difficulty'), render: (r: ImportRow) => String((r.question as { difficulty?: string })?.difficulty ?? '') },
          ]}
          onClose={() => setImporting(false)}
          onDone={() => { setImporting(false); questions.reload(); summary.reload(); }}
          doneText={(s) => t('importDone', { saved: s.saved ?? 0 })}
        />
      )}
    </div>
  );
}
