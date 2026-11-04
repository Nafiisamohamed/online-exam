'use client';
/**
 * Exam builder (lecturer): details, difficulty rules with live bank check, sample-paper
 * preview, schedule request (window, duration, rooms, networks, invigilators), withdraw,
 * and optional blind second grader. The server blocks infeasible rules and clashes.
 */
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useApi } from '@/lib/useApi';
import { STATUS_TONE, type Difficulty, type Exam, type Feasibility, type Rule } from '@/lib/types';
import type { DictKey } from '@/lib/dictionary';
import { useToast } from '@/components/Toast';
import { Badge, Button, Card, Checkbox, ErrorState, Field, Input, Loading, Modal, PageHeader, Select, Textarea } from '@/components/ui';

interface Summary {
  topics: string[];
  counts: { topic: string; difficulty: Difficulty; count: number }[];
}
interface Room {
  id: string;
  name: string;
  building: string;
  network: string | null;
}
interface Person {
  id: string;
  fullName: string;
}
interface Clash {
  courseCode: string;
  title: string;
  sharedStudents: number;
}
interface Preview {
  profile: Record<Difficulty, number>;
  totalMarks: number;
  questions: { position: number; type: string; text: string; marks: number; topic: string; difficulty: Difficulty; acceptedAnswers: string[]; options: { id: string; text: string; isCorrect: boolean }[] }[];
}

/** <input type="datetime-local"> value in Mogadishu time (UTC+3, no daylight saving). */
const toLocalInput = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 3 * 3600_000).toISOString().slice(0, 16) : '');
const fromLocalInput = (v: string) => new Date(`${v}:00+03:00`).toISOString();

export default function ExamBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const { t, fmtDate, errorMessage } = useI18n();
  const toast = useToast();
  const exam = useApi<Exam>(`/exams/${id}`);
  const summary = useApi<Summary>(exam.data ? `/courses/${exam.data.courseId}/bank-summary` : null);
  const rooms = useApi<Room[]>('/rooms');
  const invigilators = useApi<Person[]>('/users?role=INVIGILATOR');
  const lecturers = useApi<Person[]>('/users?role=LECTURER');

  const [details, setDetails] = useState({ title: '', instructions: '', durationMinutes: 60, shuffleQuestions: true, shuffleOptions: true, allowReview: true });
  const [rules, setRules] = useState<Rule[]>([]);
  const [feasibility, setFeasibility] = useState<Feasibility | null>(null);
  const [sched, setSched] = useState({ windowStart: '', windowEnd: '', roomIds: [] as string[], networks: '', invigilatorIds: [] as string[] });
  const [clashes, setClashes] = useState<Clash[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const e = exam.data;
    if (!e) return;
    setDetails({ title: e.title, instructions: e.instructions, durationMinutes: e.durationMinutes, shuffleQuestions: e.shuffleQuestions, shuffleOptions: e.shuffleOptions, allowReview: e.allowReview });
    setRules(e.rules.map((r) => ({ difficulty: r.difficulty, count: r.count, topics: r.topics })));
    setFeasibility(e.feasibility ?? null);
    setSched({
      windowStart: toLocalInput(e.windowStart),
      windowEnd: toLocalInput(e.windowEnd),
      roomIds: e.rooms.map((r) => r.room.id),
      networks: e.allowedNetworks.join('\n'),
      invigilatorIds: e.invigilators.map((i) => i.user.id),
    });
  }, [exam.data]);

  // Live feasibility check while editing rules.
  useEffect(() => {
    if (!exam.data || rules.length === 0 || rules.some((r) => !(r.count > 0))) return;
    const h = setTimeout(() => {
      api<Feasibility>(`/exams/${id}/rules/check`, { method: 'POST', body: { rules } }).then(setFeasibility).catch(() => {});
    }, 400);
    return () => clearTimeout(h);
  }, [rules, id, exam.data]);

  const available = useMemo(() => {
    return (r: Rule) =>
      summary.data?.counts.filter((c) => c.difficulty === r.difficulty && (r.topics.length === 0 || r.topics.map((x) => x.toLowerCase()).includes(c.topic.toLowerCase()))).reduce((s, c) => s + c.count, 0) ?? 0;
  }, [summary.data]);

  if (exam.loading) return <Loading />;
  if (exam.error || !exam.data) return <ErrorState error={exam.error} onRetry={exam.reload} />;
  const e = exam.data;
  const editable = e.status === 'DRAFT' || e.status === 'REJECTED';

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SCHEDULE_CLASH') setClashes((err.details as Clash[]) ?? []);
      if (err instanceof ApiError && err.code === 'RULES_NOT_FEASIBLE') setFeasibility(err.details as Feasibility);
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const saveDetails = () =>
    run('details', async () => {
      await api(`/exams/${id}`, { method: 'PATCH', body: editable ? details : { allowReview: details.allowReview } });
      toast.success(t('examSaved'));
      exam.reload(true);
    });
  const saveRules = () =>
    run('rules', async () => {
      await api(`/exams/${id}/rules`, { method: 'PUT', body: { rules } });
      toast.success(t('rulesSaved'));
      exam.reload(true);
    });
  const doPreview = () => run('preview', async () => setPreview(await api<Preview>(`/exams/${id}/preview`, { method: 'POST' })));
  const requestSchedule = () =>
    run('schedule', async () => {
      setClashes([]);
      await api(`/exams/${id}/schedule`, {
        method: 'POST',
        body: {
          windowStart: fromLocalInput(sched.windowStart),
          windowEnd: fromLocalInput(sched.windowEnd),
          durationMinutes: details.durationMinutes,
          roomIds: sched.roomIds,
          allowedNetworks: sched.networks.split('\n').map((s) => s.trim()).filter(Boolean),
          invigilatorIds: sched.invigilatorIds,
        },
      });
      toast.success(t('scheduleRequested'));
      exam.reload(true);
    });
  const withdraw = () =>
    run('withdraw', async () => {
      await api(`/exams/${id}/withdraw`, { method: 'POST' });
      toast.success(t('withdrawn'));
      exam.reload(true);
    });
  const setSecond = (lecturerId: string) =>
    run('second', async () => {
      await api(`/exams/${id}/second-grader`, { method: 'PUT', body: { lecturerId: lecturerId || null } });
      toast.success(t('examSaved'));
      exam.reload(true);
    });

  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const totalQ = rules.reduce((s, r) => s + (Number(r.count) || 0), 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${e.course.code} · ${e.title}`}
        subtitle={<Badge tone={STATUS_TONE[e.status]}>{t(`examStatus_${e.status}` as DictKey)}</Badge>}
        actions={
          <>
            {(e.status === 'PENDING_APPROVAL' || (e.status === 'SCHEDULED' && e._count.attempts === 0)) && (
              <Button variant="secondary" onClick={withdraw} loading={busy === 'withdraw'}>{t('withdraw')}</Button>
            )}
            {e._count.attempts > 0 && (
              <>
                <Link href={`/exams/${id}/grading`}><Button variant="secondary">{t('openGrading')}</Button></Link>
                <Link href={`/exams/${id}/results`}><Button variant="secondary">{t('openResults')}</Button></Link>
              </>
            )}
            {e.status === 'SCHEDULED' && <Link href={`/invigilate/${id}`}><Button>{t('openLive')}</Button></Link>}
          </>
        }
      />
      {e.status === 'REJECTED' && e.rejectionReason && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{t('rejectedBecause', { reason: e.rejectionReason })}</p>}
      {!editable && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{t('lockedNote')}</p>}

      <Card title={t('details')} actions={<Button size="sm" onClick={saveDetails} loading={busy === 'details'}>{t('save')}</Button>}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t('title')} required>
            <Input value={details.title} disabled={!editable} onChange={(ev) => setDetails({ ...details, title: ev.target.value })} />
          </Field>
          <Field label={t('duration')}>
            <Input type="number" min={1} max={480} disabled={!editable} value={details.durationMinutes} onChange={(ev) => setDetails({ ...details, durationMinutes: Number(ev.target.value) })} />
          </Field>
          <div className="md:col-span-2">
            <Field label={t('instructions')}>
              <Textarea rows={3} disabled={!editable} value={details.instructions} onChange={(ev) => setDetails({ ...details, instructions: ev.target.value })} />
            </Field>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Checkbox label={t('shuffleQuestions')} checked={details.shuffleQuestions} disabled={!editable} onChange={(v) => setDetails({ ...details, shuffleQuestions: v })} />
            <Checkbox label={t('shuffleOptions')} checked={details.shuffleOptions} disabled={!editable} onChange={(v) => setDetails({ ...details, shuffleOptions: v })} />
            <Checkbox label={t('allowReview')} checked={details.allowReview} onChange={(v) => setDetails({ ...details, allowReview: v })} />
          </div>
        </div>
      </Card>

      <Card
        title={t('rules')}
        actions={
          <>
            <Button size="sm" variant="secondary" onClick={doPreview} loading={busy === 'preview'} disabled={e.rules.length === 0}>{t('preview')}</Button>
            {editable && <Button size="sm" onClick={saveRules} loading={busy === 'rules'} disabled={!feasibility?.ok || rules.length === 0}>{t('saveRules')}</Button>}
          </>
        }
      >
        <p className="mb-3 text-sm text-gray-600">{t('rulesHelp')}</p>
        <div className="space-y-3">
          {rules.map((r, i) => (
            <div key={i} className="rounded-lg border border-gray-200 p-3">
              <div className="grid gap-3 sm:grid-cols-[140px_110px_1fr_auto] sm:items-end">
                <Field label={t('difficulty')}>
                  <Select value={r.difficulty} disabled={!editable} onChange={(ev) => setRules(rules.map((x, j) => (j === i ? { ...x, difficulty: ev.target.value as Difficulty } : x)))}>
                    {(['EASY', 'MEDIUM', 'HARD'] as Difficulty[]).map((d) => <option key={d} value={d}>{t(`diff_${d}` as DictKey)}</option>)}
                  </Select>
                </Field>
                <Field label={t('count')}>
                  <Input type="number" min={1} max={100} disabled={!editable} value={r.count} onChange={(ev) => setRules(rules.map((x, j) => (j === i ? { ...x, count: Number(ev.target.value) } : x)))} />
                </Field>
                <div>
                  <span className="mb-1 block text-sm font-medium text-gray-800">{t('topics')}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {summary.data?.topics.map((tp) => {
                      const on = r.topics.includes(tp);
                      return (
                        <button key={tp} type="button" disabled={!editable} onClick={() => setRules(rules.map((x, j) => (j === i ? { ...x, topics: toggle(x.topics, tp) } : x)))} className={`rounded-full border px-2.5 py-1 text-xs ${on ? 'border-brand-700 bg-brand-700 text-white' : 'border-gray-300 text-gray-700'}`}>
                          {tp}
                        </button>
                      );
                    })}
                    {r.topics.length === 0 && <span className="py-1 text-xs text-gray-500">({t('anyTopic')})</span>}
                  </div>
                </div>
                {editable && <Button size="sm" variant="ghost" onClick={() => setRules(rules.filter((_, j) => j !== i))}>✕</Button>}
              </div>
              <p className={`mt-2 text-xs ${available(r) >= r.count ? 'text-gray-500' : 'font-medium text-red-600'}`}>
                {available(r)} {t('available')}
              </p>
            </div>
          ))}
        </div>
        {editable && <Button size="sm" variant="secondary" className="mt-3" onClick={() => setRules([...rules, { difficulty: 'EASY', count: 5, topics: [] }])}>+ {t('addRule')}</Button>}
        <div className="mt-4 text-sm">
          <p className="font-medium text-gray-800">{t('totalQuestions', { n: totalQ })}</p>
          {feasibility && rules.length > 0 && (
            feasibility.ok ? (
              <p className="mt-1 text-brand-800">✓ {t('rulesOk')}</p>
            ) : (
              <ul className="mt-1 space-y-1 text-red-700">
                {feasibility.shortages.map((s) => <li key={s.ruleIndex}>✗ {t('rulesShort', { n: s.ruleIndex + 1, required: s.required, available: s.available })}</li>)}
                {feasibility.overlapProblem && <li>✗ {t('rulesOverlap', { required: feasibility.overlapProblem.required, available: feasibility.overlapProblem.available })}</li>}
              </ul>
            )
          )}
        </div>
      </Card>

      <Card title={t('schedule')} actions={editable && <Button size="sm" onClick={requestSchedule} loading={busy === 'schedule'} disabled={!sched.windowStart || !sched.windowEnd || e.rules.length === 0}>{t('requestApproval')}</Button>}>
        <p className="mb-3 text-sm text-gray-600">{t('scheduleHelp')}</p>
        {e.windowStart && !editable && <p className="mb-3 text-sm font-medium">{fmtDate(e.windowStart)} - {fmtDate(e.windowEnd)} · {e.durationMinutes} {t('minutes')}</p>}
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t('windowStart')}>
            <Input type="datetime-local" disabled={!editable} value={sched.windowStart} onChange={(ev) => setSched({ ...sched, windowStart: ev.target.value })} />
          </Field>
          <Field label={t('windowEnd')}>
            <Input type="datetime-local" disabled={!editable} value={sched.windowEnd} onChange={(ev) => setSched({ ...sched, windowEnd: ev.target.value })} />
          </Field>
          <div>
            <span className="mb-1 block text-sm font-medium text-gray-800">{t('rooms')}</span>
            <div className="space-y-1.5">
              {rooms.data?.map((r) => (
                <Checkbox key={r.id} disabled={!editable} checked={sched.roomIds.includes(r.id)} onChange={() => setSched({ ...sched, roomIds: toggle(sched.roomIds, r.id) })} label={<span>{r.name} <span className="text-gray-500">· {r.building} {r.network && `· ${r.network}`}</span></span>} />
              ))}
            </div>
          </div>
          <div>
            <span className="mb-1 block text-sm font-medium text-gray-800">{t('invigilators')}</span>
            <div className="space-y-1.5">
              {invigilators.data?.map((p) => (
                <Checkbox key={p.id} disabled={!editable} checked={sched.invigilatorIds.includes(p.id)} onChange={() => setSched({ ...sched, invigilatorIds: toggle(sched.invigilatorIds, p.id) })} label={p.fullName} />
              ))}
            </div>
          </div>
          <div className="md:col-span-2">
            <Field label={t('allowedNetworks')} hint={t('allowedNetworksHelp')}>
              <Textarea rows={2} disabled={!editable} value={sched.networks} onChange={(ev) => setSched({ ...sched, networks: ev.target.value })} className="font-mono" />
            </Field>
          </div>
        </div>
        {clashes.length > 0 && (
          <ul className="mt-3 space-y-1 rounded-lg bg-red-50 p-3 text-sm text-red-800">
            {clashes.map((c, i) => <li key={i}>✗ {t('clashWith', { course: c.courseCode, title: c.title, n: c.sharedStudents })}</li>)}
          </ul>
        )}
      </Card>

      <Card title={t('secondGrader')}>
        <p className="mb-2 text-sm text-gray-600">{t('secondGraderHelp')}</p>
        <Select value={e.secondGraderId ?? ''} onChange={(ev) => setSecond(ev.target.value)} className="max-w-sm">
          <option value="">{t('none')}</option>
          {lecturers.data?.filter((l) => l.id !== e.course.lecturerId).map((l) => <option key={l.id} value={l.id}>{l.fullName}</option>)}
        </Select>
      </Card>

      <Modal open={!!preview} onClose={() => setPreview(null)} title={t('previewTitle')} wide>
        {preview && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">{t('previewNote')}</p>
            <div className="flex flex-wrap gap-2 text-sm">
              {(['EASY', 'MEDIUM', 'HARD'] as Difficulty[]).map((d) => <Badge key={d}>{t(`diff_${d}` as DictKey)}: {preview.profile[d]}</Badge>)}
              <Badge tone="green">{t('marks')}: {preview.totalMarks}</Badge>
            </div>
            <ol className="space-y-3">
              {preview.questions.map((q) => (
                <li key={q.position} className="rounded-lg border border-gray-200 p-3 text-sm">
                  <p className="mb-1 text-xs text-gray-500">{q.position}. {t(`type_${q.type}` as DictKey)} · {t(`diff_${q.difficulty}` as DictKey)} · {q.topic} · {t('marksN', { n: q.marks })}</p>
                  <p className="font-medium text-gray-900">{q.text}</p>
                  {q.options.length > 0 && (
                    <ul className="mt-1">
                      {q.options.map((o) => <li key={o.id} className={o.isCorrect ? 'font-medium text-brand-800' : 'text-gray-600'}>• {q.type === 'TRUE_FALSE' ? (o.text === 'True' ? t('trueLabel') : t('falseLabel')) : o.text} {o.isCorrect && '✓'}</li>)}
                    </ul>
                  )}
                  {q.acceptedAnswers.length > 0 && <p className="mt-1 text-brand-800">{t('acceptedWere', { list: q.acceptedAnswers.join(', ') })}</p>}
                </li>
              ))}
            </ol>
          </div>
        )}
      </Modal>
    </div>
  );
}
