'use client';
/**
 * Exam screen (core technical challenge, client side).
 *
 * - Timer: shows ONLY the server's remaining time. We store the server's remainingMs and
 *   count down with performance.now() (a monotonic clock), so changing the device clock
 *   has no effect. Re-synced from the server on every heartbeat (10 s).
 * - Every answer is sent to the server immediately (text answers after a short pause).
 *   If the connection drops, unsaved answers are queued and retried.
 * - Reload = GET /attempts/:id again: same questions, saved answers, correct remaining time.
 * - Leaving the tab (blur / hidden) is reported as LOST/REGAINED focus events.
 * - Warnings at 10 and 1 minute. At 0 the attempt is submitted with saved answers.
 */
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import type { QType } from '@/lib/types';
import { useToast } from '@/components/Toast';
import { Button, ErrorState, LangSwitch, Loading, Modal } from '@/components/ui';
import { Logo } from '@/components/Logo';

interface AnswerState {
  selectedOptionId: string | null;
  textAnswer: string | null;
  flagged: boolean;
}
interface PaperQuestion {
  attemptQuestionId: string;
  position: number;
  type: QType;
  text: string;
  imageUrl: string | null;
  marks: number;
  options: { id: string; text: string }[];
  answer: (AnswerState & { savedAt: string }) | null;
}
interface Attempt {
  id: string;
  status: 'IN_PROGRESS' | 'SUBMITTED' | 'AUTO_SUBMITTED';
  exam: { title: string; instructions: string; course: { code: string; name: string } };
  remainingMs: number;
  extraMinutes: number;
  tabSwitches: number;
  warn: boolean;
  questions: PaperQuestion[];
}
type Patch = Partial<AnswerState>;

const LETTERS = ['A', 'B', 'C', 'D', 'E'];

function formatClock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export default function ExamScreen() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const { user, ready } = useAuth();
  const { t, errorMessage } = useI18n();
  const toast = useToast();
  const router = useRouter();

  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  const [index, setIndex] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [finished, setFinished] = useState<null | 'SUBMITTED' | 'AUTO_SUBMITTED'>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'offline'>('saved');
  const [tabSwitches, setTabSwitches] = useState(0);
  const [tabWarn, setTabWarn] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  // Server time anchor: remaining at the moment we heard from the server, on the monotonic clock.
  const anchor = useRef<{ remaining: number; at: number } | null>(null);
  const pending = useRef<Map<string, Patch>>(new Map());
  const textTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const flushing = useRef(false);
  const finishedRef = useRef(false);
  const submittingRef = useRef(false);
  const warned = useRef({ ten: false, one: false });
  const lostAt = useRef<number | null>(null);
  const extraMinutes = useRef(0);

  const syncTimer = useCallback((remainingMs: number) => {
    anchor.current = { remaining: remainingMs, at: performance.now() };
    setRemaining(remainingMs);
  }, []);

  const finish = useCallback((status: 'SUBMITTED' | 'AUTO_SUBMITTED') => {
    finishedRef.current = true;
    setFinished(status);
  }, []);

  // ---- Load (also the resume path after reload / reconnect) ----
  const load = useCallback(async () => {
    try {
      const a = await api<Attempt>(`/attempts/${attemptId}`);
      if (a.status !== 'IN_PROGRESS') {
        finish(a.status);
        return;
      }
      setAttempt(a);
      setAnswers(
        Object.fromEntries(
          a.questions.map((q) => [q.attemptQuestionId, { selectedOptionId: q.answer?.selectedOptionId ?? null, textAnswer: q.answer?.textAnswer ?? null, flagged: q.answer?.flagged ?? false }]),
        ),
      );
      setTabSwitches(a.tabSwitches);
      setTabWarn(a.warn);
      extraMinutes.current = a.extraMinutes;
      syncTimer(a.remainingMs);
      try {
        const w = JSON.parse(sessionStorage.getItem(`warned.${attemptId}`) ?? 'null');
        if (w) warned.current = w;
      } catch {
        /* ignore */
      }
    } catch (err) {
      setLoadError(err);
    }
  }, [attemptId, finish, syncTimer]);

  useEffect(() => {
    if (ready && !user) router.replace('/login');
    if (ready && user) load();
  }, [ready, user, load, router]);

  // ---- Saving ----
  const flush = useCallback(async () => {
    if (flushing.current || finishedRef.current) return;
    flushing.current = true;
    try {
      while (pending.current.size > 0 && !finishedRef.current) {
        const [aqId, patch] = pending.current.entries().next().value as [string, Patch];
        pending.current.delete(aqId);
        setSaveState('saving');
        try {
          const res = await api<{ remainingMs: number }>(`/attempts/${attemptId}/answers`, { method: 'PUT', body: { attemptQuestionId: aqId, ...patch } });
          syncTimer(res.remainingMs);
        } catch (err) {
          if (err instanceof ApiError && (err.code === 'TIME_UP' || err.code === 'ATTEMPT_CLOSED')) {
            toast.error(t('lateRejected'));
            finish('AUTO_SUBMITTED');
            return;
          }
          // Network or server problem: put it back (newer edits win) and retry.
          pending.current.set(aqId, { ...patch, ...(pending.current.get(aqId) ?? {}) });
          setSaveState('offline');
          setTimeout(() => {
            flushing.current = false;
            flush();
          }, 3000);
          return;
        }
      }
      setSaveState('saved');
    } finally {
      flushing.current = false;
    }
  }, [attemptId, finish, syncTimer, t, toast]);

  const queue = useCallback(
    (aqId: string, patch: Patch, delay = 0) => {
      pending.current.set(aqId, { ...(pending.current.get(aqId) ?? {}), ...patch });
      setSaveState('saving');
      const existing = textTimers.current.get(aqId);
      if (existing) clearTimeout(existing);
      if (delay === 0) flush();
      else textTimers.current.set(aqId, setTimeout(() => flush(), delay));
    },
    [flush],
  );

  const update = (aqId: string, patch: Patch, delay = 0) => {
    if (finishedRef.current) return;
    setAnswers((prev) => ({ ...prev, [aqId]: { ...prev[aqId], ...patch } }));
    queue(aqId, patch, delay);
  };

  // ---- Submit ----
  const submit = useCallback(
    async (auto: boolean) => {
      if (finishedRef.current || submittingRef.current) return;
      submittingRef.current = true;
      setSubmitting(true);
      textTimers.current.forEach((h) => clearTimeout(h));
      await flush();
      try {
        const res = await api<{ status: 'SUBMITTED' | 'AUTO_SUBMITTED' }>(`/attempts/${attemptId}/submit`, { method: 'POST' });
        finish(auto ? 'AUTO_SUBMITTED' : res.status);
      } catch (err) {
        if (auto) finish('AUTO_SUBMITTED');
        else toast.error(errorMessage(err));
      } finally {
        submittingRef.current = false;
        setSubmitting(false);
        setConfirmSubmit(false);
      }
    },
    [attemptId, errorMessage, finish, flush, toast],
  );

  // ---- Timer tick (monotonic) + warnings + auto-submit at 0 ----
  useEffect(() => {
    if (!attempt) return;
    const id = setInterval(() => {
      if (!anchor.current || finishedRef.current) return;
      const left = anchor.current.remaining - (performance.now() - anchor.current.at);
      setRemaining(left);
      const w = warned.current;
      if (left <= 600_000 && left > 60_000 && !w.ten) {
        w.ten = true;
        setBanner(t('warn10'));
        toast.warning(t('warn10'));
      }
      if (left <= 60_000 && left > 0 && !w.one) {
        w.one = w.ten = true;
        setBanner(t('warn1'));
        toast.warning(t('warn1'));
      }
      try {
        sessionStorage.setItem(`warned.${attemptId}`, JSON.stringify(w));
      } catch {
        /* ignore */
      }
      if (left <= 0) submit(true);
    }, 250);
    return () => clearInterval(id);
  }, [attempt, attemptId, submit, t, toast]);

  // ---- Heartbeat: connection status + timer re-sync + extensions ----
  useEffect(() => {
    if (!attempt) return;
    const beat = async () => {
      if (finishedRef.current) return;
      try {
        const hb = await api<{ status: Attempt['status']; remainingMs: number; tabSwitches: number; warn: boolean; extraMinutes: number }>(`/attempts/${attemptId}/heartbeat`, { method: 'POST' });
        if (hb.status !== 'IN_PROGRESS') return finish(hb.status);
        syncTimer(hb.remainingMs);
        setTabSwitches(hb.tabSwitches);
        setTabWarn(hb.warn);
        if (hb.extraMinutes > extraMinutes.current) {
          extraMinutes.current = hb.extraMinutes;
          if (hb.remainingMs > 600_000) warned.current.ten = false;
          if (hb.remainingMs > 60_000) warned.current.one = false;
          toast.success(t('extraTimeAdded'));
        }
        if (saveState === 'offline') {
          toast.success(t('reconnected'));
          flush();
        }
      } catch {
        setSaveState('offline');
      }
    };
    const id = setInterval(beat, 10_000);
    return () => clearInterval(id);
  }, [attempt, attemptId, finish, flush, saveState, syncTimer, t, toast]);

  // ---- Tab-switch detection ----
  useEffect(() => {
    if (!attempt) return;
    const lost = () => {
      if (finishedRef.current || lostAt.current !== null) return;
      lostAt.current = performance.now();
      api(`/attempts/${attemptId}/focus`, { method: 'POST', body: { type: 'LOST' }, keepalive: true }).catch(() => {});
    };
    const back = async () => {
      if (finishedRef.current || lostAt.current === null) return;
      const durationMs = Math.round(performance.now() - lostAt.current);
      lostAt.current = null;
      try {
        const res = await api<{ tabSwitches: number; warn: boolean }>(`/attempts/${attemptId}/focus`, { method: 'POST', body: { type: 'REGAINED', durationMs } });
        setTabSwitches(res.tabSwitches);
        setTabWarn(res.warn);
        if (res.warn) toast.warning(t('tabWarning', { n: res.tabSwitches }));
      } catch {
        /* reported again on the next heartbeat */
      }
    };
    const onVisibility = () => (document.visibilityState === 'hidden' ? lost() : back());
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', lost);
    window.addEventListener('focus', back);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', lost);
      window.removeEventListener('focus', back);
    };
  }, [attempt, attemptId, t, toast]);

  // ---------- Render ----------
  if (finished) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-brand-50 px-4 text-center">
        <Logo size={56} />
        <h1 className="mt-4 text-2xl font-bold text-gray-900">{finished === 'AUTO_SUBMITTED' ? t('timeUp') : t('submitted')}</h1>
        <p className="mt-2 max-w-md text-gray-700">{finished === 'AUTO_SUBMITTED' ? t('autoSubmittedText') : t('submittedText')}</p>
        <Link href="/dashboard" className="mt-6">
          <Button size="lg">{t('backToDashboard')}</Button>
        </Link>
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <ErrorState error={loadError} onRetry={() => { setLoadError(null); load(); }} />
        <Link href="/student/exams" className="mt-4 block text-center text-sm text-brand-700">{t('back')}</Link>
      </div>
    );
  }
  if (!attempt) return <Loading />;

  const questions = attempt.questions;
  const q = questions[index];
  const a = answers[q.attemptQuestionId];
  const isAnswered = (x: AnswerState | undefined) => !!x && (!!x.selectedOptionId || !!x.textAnswer?.trim());
  const unanswered = questions.filter((x) => !isAnswered(answers[x.attemptQuestionId])).length;
  const low = remaining <= 60_000;
  const warnZone = remaining <= 600_000;

  const navigator = (
    <div>
      <div className="grid grid-cols-6 gap-2 sm:grid-cols-8 lg:grid-cols-5">
        {questions.map((x, i) => {
          const st = answers[x.attemptQuestionId];
          const cls = st?.flagged
            ? 'bg-amber-100 text-amber-900 border-amber-400'
            : isAnswered(st)
              ? 'bg-brand-700 text-white border-brand-700'
              : 'bg-white text-gray-700 border-gray-300';
          return (
            <button
              key={x.attemptQuestionId}
              onClick={() => {
                setIndex(i);
                setNavOpen(false);
              }}
              className={`relative h-10 rounded-lg border text-sm font-semibold ${cls} ${i === index ? 'ring-2 ring-brand-500 ring-offset-2' : ''}`}
              aria-label={`${t('question')} ${i + 1}`}
            >
              {i + 1}
              {st?.flagged && <span className="absolute -right-1 -top-1 text-xs">⚑</span>}
            </button>
          );
        })}
      </div>
      <ul className="mt-4 space-y-1 text-xs text-gray-600">
        <li className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-brand-700" /> {t('answered')}</li>
        <li className="flex items-center gap-2"><span className="h-3 w-3 rounded border border-gray-300 bg-white" /> {t('unanswered')}</li>
        <li className="flex items-center gap-2"><span className="h-3 w-3 rounded border border-amber-400 bg-amber-100" /> {t('flagged')}</li>
      </ul>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar with server timer */}
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold uppercase text-brand-700">{attempt.exam.course.code}</p>
            <p className="truncate text-sm font-semibold text-gray-900">{attempt.exam.title}</p>
          </div>
          <div className={`rounded-xl px-3 py-1.5 text-center ${low ? 'bg-red-600 text-white' : warnZone ? 'bg-amber-100 text-amber-900' : 'bg-brand-50 text-brand-900'}`} aria-live="polite">
            <p className="text-[10px] font-medium uppercase leading-3">{t('timeLeft')}</p>
            <p className="font-mono text-xl font-bold tabular-nums">{formatClock(remaining)}</p>
          </div>
          <LangSwitch compact />
        </div>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 pb-2 text-xs">
          <span className={saveState === 'offline' ? 'font-medium text-red-700' : 'text-gray-600'}>
            {saveState === 'saving' ? t('saving') : saveState === 'offline' ? t('offline') : `✓ ${t('allSaved')}`}
          </span>
          {tabSwitches > 0 && <span className={tabWarn ? 'font-semibold text-red-700' : 'text-gray-600'}>{t('tabWarningShort', { n: tabSwitches })}</span>}
        </div>
      </header>

      {(banner || tabWarn) && (
        <div className="mx-auto max-w-6xl space-y-2 px-4 pt-3">
          {banner && (
            <div className="flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900" role="alert">
              ⏰ {banner}
              <button onClick={() => setBanner(null)} className="ml-3 text-amber-800" aria-label={t('close')}>✕</button>
            </div>
          )}
          {tabWarn && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800" role="alert">
              ⚠ {t('tabWarning', { n: tabSwitches })}
            </div>
          )}
        </div>
      )}

      <div className="mx-auto grid max-w-6xl gap-4 px-4 py-4 lg:grid-cols-[1fr_260px]">
        {/* Question */}
        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-card sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-gray-600">
              {t('questionOf', { n: index + 1, total: questions.length })} · {t('marksN', { n: q.marks })}
            </p>
            <button
              onClick={() => update(q.attemptQuestionId, { flagged: !a?.flagged })}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${a?.flagged ? 'border-amber-400 bg-amber-100 text-amber-900' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
              aria-pressed={a?.flagged}
            >
              ⚑ {a?.flagged ? t('flagged') : t('flag')}
            </button>
          </div>
          <h2 className="whitespace-pre-line text-lg font-medium leading-relaxed text-gray-900">{q.text}</h2>
          {q.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={q.imageUrl} alt="" className="mt-4 max-h-80 rounded-lg border border-gray-200 object-contain" />
          )}

          <div className="mt-5">
            {(q.type === 'MCQ' || q.type === 'TRUE_FALSE') && (
              <div className="space-y-2" role="radiogroup">
                {q.options.map((o, i) => {
                  const selected = a?.selectedOptionId === o.id;
                  const label = q.type === 'TRUE_FALSE' ? (o.text === 'True' ? t('trueLabel') : t('falseLabel')) : o.text;
                  return (
                    <button
                      key={o.id}
                      role="radio"
                      aria-checked={selected}
                      onClick={() => update(q.attemptQuestionId, { selectedOptionId: o.id })}
                      className={`flex w-full items-center gap-3 rounded-xl border-2 px-4 py-3 text-left text-base transition ${selected ? 'border-brand-700 bg-brand-50' : 'border-gray-200 hover:border-gray-300'}`}
                    >
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${selected ? 'bg-brand-700 text-white' : 'bg-gray-100 text-gray-700'}`}>
                        {q.type === 'TRUE_FALSE' ? (i === 0 ? '✓' : '✗') : LETTERS[i]}
                      </span>
                      <span className="text-gray-900">{label}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {(q.type === 'SHORT_ANSWER' || q.type === 'ESSAY') && (
              <textarea
                key={q.attemptQuestionId}
                value={a?.textAnswer ?? ''}
                onChange={(e) => update(q.attemptQuestionId, { textAnswer: e.target.value }, 700)}
                onBlur={() => flush()}
                rows={q.type === 'ESSAY' ? 12 : 2}
                maxLength={20000}
                placeholder={t('typeAnswer')}
                className="block w-full rounded-xl border-2 border-gray-200 p-3 text-base focus:border-brand-600 focus:outline-none"
              />
            )}
          </div>

          <div className="mt-6 flex items-center justify-between gap-2 border-t border-gray-100 pt-4">
            <Button variant="secondary" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0}>
              ← {t('previous')}
            </Button>
            <Button variant="ghost" className="lg:hidden" onClick={() => setNavOpen(true)}>
              {t('navigator')}
            </Button>
            {index < questions.length - 1 ? (
              <Button onClick={() => setIndex((i) => Math.min(questions.length - 1, i + 1))}>{t('next')} →</Button>
            ) : (
              <Button onClick={() => setConfirmSubmit(true)}>{t('submit')}</Button>
            )}
          </div>
        </section>

        {/* Navigator (desktop) */}
        <aside className="hidden lg:block">
          <div className="sticky top-28 rounded-xl border border-gray-200 bg-white p-4 shadow-card">
            <h3 className="mb-3 text-sm font-semibold text-gray-900">{t('navigator')}</h3>
            {navigator}
            <Button className="mt-5 w-full" onClick={() => setConfirmSubmit(true)}>
              {t('submit')}
            </Button>
          </div>
        </aside>
      </div>

      <Modal open={navOpen} onClose={() => setNavOpen(false)} title={t('navigator')}>
        {navigator}
        <Button className="mt-5 w-full" onClick={() => { setNavOpen(false); setConfirmSubmit(true); }}>
          {t('submit')}
        </Button>
      </Modal>

      <Modal
        open={confirmSubmit}
        onClose={() => setConfirmSubmit(false)}
        title={t('submit')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmSubmit(false)}>{t('cancel')}</Button>
            <Button onClick={() => submit(false)} loading={submitting}>{t('submit')}</Button>
          </>
        }
      >
        <p className="text-sm text-gray-700">{unanswered > 0 ? t('submitConfirmUnanswered', { n: unanswered }) : t('submitConfirm')}</p>
      </Modal>
    </div>
  );
}
