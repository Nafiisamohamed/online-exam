'use client';
/**
 * Create / edit a question (all four types). Client-side checks mirror the server rules
 * (the server validates again): MCQ 4-5 options with exactly one correct, rubric total = marks.
 * Editing a question used in past exams creates a new version on the server.
 */
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { Difficulty, QType, Question } from '@/lib/types';
import type { DictKey } from '@/lib/dictionary';
import { useToast } from './Toast';
import { Button, Field, Input, Modal, Select, Textarea } from './ui';

interface Props {
  courseId: string;
  question: Question | null; // null = new
  topics: string[];
  onClose: () => void;
  onSaved: () => void;
}

const TYPES: QType[] = ['MCQ', 'TRUE_FALSE', 'SHORT_ANSWER', 'ESSAY'];
const DIFFS: Difficulty[] = ['EASY', 'MEDIUM', 'HARD'];

export function QuestionEditor({ courseId, question, topics, onClose, onSaved }: Props) {
  const { t, errorMessage, questionError } = useI18n();
  const toast = useToast();
  const [type, setType] = useState<QType>(question?.type ?? 'MCQ');
  const [text, setText] = useState(question?.text ?? '');
  const [marks, setMarks] = useState(question?.marks ?? 2);
  const [topic, setTopic] = useState(question?.topic ?? topics[0] ?? '');
  const [difficulty, setDifficulty] = useState<Difficulty>(question?.difficulty ?? 'EASY');
  const [imageUrl, setImageUrl] = useState<string | null>(question?.imageUrl ?? null);
  const [options, setOptions] = useState<{ text: string; isCorrect: boolean }[]>(
    question?.type === 'MCQ' ? question.options.map((o) => ({ text: o.text, isCorrect: o.isCorrect })) : [0, 1, 2, 3].map((i) => ({ text: '', isCorrect: i === 0 })),
  );
  const [tfAnswer, setTfAnswer] = useState<boolean>(question?.type === 'TRUE_FALSE' ? question.options.find((o) => o.isCorrect)?.text === 'True' : true);
  const [accepted, setAccepted] = useState((question?.acceptedAnswers ?? []).join('\n'));
  const [rubric, setRubric] = useState<{ criterion: string; points: number }[]>(question?.rubric ?? []);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  function onImage(file: File | undefined) {
    if (!file) return;
    if (file.size > 700_000) {
      setErrors(['IMAGE_TOO_LARGE']);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImageUrl(String(reader.result));
    reader.readAsDataURL(file);
  }

  async function save() {
    setErrors([]);
    const body = {
      type,
      text,
      marks: Number(marks),
      topic,
      difficulty,
      imageUrl,
      options:
        type === 'MCQ'
          ? options
          : type === 'TRUE_FALSE'
            ? [{ text: 'True', isCorrect: tfAnswer }, { text: 'False', isCorrect: !tfAnswer }]
            : undefined,
      acceptedAnswers: type === 'SHORT_ANSWER' ? accepted.split('\n').map((s) => s.trim()).filter(Boolean) : undefined,
      rubric: type === 'ESSAY' && rubric.length ? rubric.map((r) => ({ criterion: r.criterion, points: Number(r.points) })) : null,
    };
    setBusy(true);
    try {
      const res = question
        ? await api<{ versioned?: boolean }>(`/questions/${question.id}`, { method: 'PUT', body })
        : await api(`/courses/${courseId}/questions`, { method: 'POST', body });
      toast.success((res as { versioned?: boolean }).versioned ? t('questionVersioned') : t('questionSaved'));
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'QUESTION_INVALID' && Array.isArray(err.details)) setErrors(err.details as string[]);
      else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const rubricTotal = rubric.reduce((s, r) => s + (Number(r.points) || 0), 0);

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={question ? `${t('editQuestion')} (${t('version')} ${question.version})` : t('newQuestion')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('cancel')}</Button>
          <Button onClick={save} loading={busy}>{t('save')}</Button>
        </>
      }
    >
      <div className="space-y-4">
        {errors.length > 0 && (
          <ul className="list-inside list-disc rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">
            {errors.map((e) => <li key={e}>{questionError(e)}</li>)}
          </ul>
        )}
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label={t('type')}>
            <Select value={type} onChange={(e) => setType(e.target.value as QType)}>
              {TYPES.map((x) => <option key={x} value={x}>{t(`type_${x}` as DictKey)}</option>)}
            </Select>
          </Field>
          <Field label={t('difficulty')}>
            <Select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
              {DIFFS.map((x) => <option key={x} value={x}>{t(`diff_${x}` as DictKey)}</option>)}
            </Select>
          </Field>
          <Field label={t('topic')} required>
            <Input list="topic-list" value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={60} />
            <datalist id="topic-list">{topics.map((x) => <option key={x} value={x} />)}</datalist>
          </Field>
          <Field label={t('marks')}>
            <Input type="number" min={0.5} max={100} step={0.5} value={marks} onChange={(e) => setMarks(Number(e.target.value))} />
          </Field>
        </div>
        <Field label={t('questionText')} required>
          <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} />
        </Field>
        <Field label={`${t('image')} (${t('optional')})`} hint={t('imageHelp')}>
          <div className="flex flex-wrap items-center gap-3">
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => onImage(e.target.files?.[0])} className="text-sm" />
            {imageUrl && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt="" className="h-16 rounded border" />
                <Button size="sm" variant="ghost" onClick={() => setImageUrl(null)}>{t('removeImage')}</Button>
              </>
            )}
          </div>
        </Field>

        {type === 'MCQ' && (
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-gray-800">{t('options')} · <span className="text-gray-500">{t('markCorrect')}</span></legend>
            <div className="space-y-2">
              {options.map((o, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input type="radio" name="correct" checked={o.isCorrect} onChange={() => setOptions(options.map((x, j) => ({ ...x, isCorrect: j === i })))} className="h-4 w-4 accent-brand-700" aria-label={t('correct')} />
                  <span className="w-5 text-sm font-semibold text-gray-500">{'ABCDE'[i]}</span>
                  <Input value={o.text} onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} maxLength={500} />
                  {options.length > 4 && <Button size="sm" variant="ghost" onClick={() => setOptions(options.filter((_, j) => j !== i))}>✕</Button>}
                </div>
              ))}
            </div>
            {options.length < 5 && <Button size="sm" variant="secondary" className="mt-2" onClick={() => setOptions([...options, { text: '', isCorrect: false }])}>{t('addOption')}</Button>}
          </fieldset>
        )}

        {type === 'TRUE_FALSE' && (
          <Field label={t('correctAnswer')}>
            <div className="flex gap-3">
              {[true, false].map((v) => (
                <button key={String(v)} type="button" onClick={() => setTfAnswer(v)} className={`rounded-lg border-2 px-4 py-2 text-sm font-medium ${tfAnswer === v ? 'border-brand-700 bg-brand-50' : 'border-gray-200'}`}>
                  {v ? t('trueLabel') : t('falseLabel')}
                </button>
              ))}
            </div>
          </Field>
        )}

        {type === 'SHORT_ANSWER' && (
          <Field label={t('acceptedAnswers')} hint={t('acceptedHelp')} required>
            <Textarea rows={3} value={accepted} onChange={(e) => setAccepted(e.target.value)} />
          </Field>
        )}

        {type === 'ESSAY' && (
          <fieldset>
            <legend className="mb-1 text-sm font-medium text-gray-800">{t('rubric')}</legend>
            <p className="mb-2 text-xs text-gray-500">{t('rubricHelp')} ({rubricTotal} / {marks})</p>
            <div className="space-y-2">
              {rubric.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input placeholder={t('criterion')} value={r.criterion} onChange={(e) => setRubric(rubric.map((x, j) => (j === i ? { ...x, criterion: e.target.value } : x)))} />
                  <Input type="number" className="w-24" min={0} step={0.5} value={r.points} onChange={(e) => setRubric(rubric.map((x, j) => (j === i ? { ...x, points: Number(e.target.value) } : x)))} aria-label={t('points')} />
                  <Button size="sm" variant="ghost" onClick={() => setRubric(rubric.filter((_, j) => j !== i))}>✕</Button>
                </div>
              ))}
            </div>
            <Button size="sm" variant="secondary" className="mt-2" onClick={() => setRubric([...rubric, { criterion: '', points: 1 }])}>{t('addCriterion')}</Button>
          </fieldset>
        )}
      </div>
    </Modal>
  );
}
