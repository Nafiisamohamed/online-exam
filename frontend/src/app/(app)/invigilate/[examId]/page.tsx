'use client';
/**
 * Invigilator live view. Polls the API every 5 s. Shows Not started / In progress
 * (answered/total) / Submitted / Disconnected (orange, no contact for 30 s) and the
 * tab-switch count (red from 3). Actions: note, extend time (max 15 min), focus log.
 */
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useApi } from '@/lib/useApi';
import type { DictKey } from '@/lib/dictionary';
import { useToast } from '@/components/Toast';
import { Badge, Button, Card, Empty, ErrorState, Field, Input, Loading, Modal, PageHeader, Stat, Textarea } from '@/components/ui';

type LiveStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED' | 'DISCONNECTED';
interface Row {
  studentUserId: string;
  studentId: string | null;
  fullName: string;
  status: LiveStatus;
  attemptId: string | null;
  answered: number;
  total: number;
  tabSwitches: number;
  remainingMs: number | null;
  extraMinutes: number;
  lastSeenAt: string | null;
  ipAddress: string | null;
}
interface Live {
  exam: { id: string; title: string; courseCode: string; windowStart: string; windowEnd: string; durationMinutes: number };
  serverNow: string;
  summary: { total: number; notStarted: number; inProgress: number; submitted: number; disconnected: number; flagged: number };
  students: Row[];
  notes: { id: string; attemptId: string | null; text: string; author: string; createdAt: string }[];
}
interface FocusEvent {
  id: string;
  lostAt: string;
  regainedAt: string | null;
  durationMs: number | null;
  counted: boolean;
}

const ROW_STYLE: Record<LiveStatus, string> = {
  NOT_STARTED: 'border-gray-200 bg-white',
  IN_PROGRESS: 'border-brand-200 bg-white',
  SUBMITTED: 'border-gray-200 bg-gray-50',
  DISCONNECTED: 'border-orange-400 bg-orange-50',
};
const BADGE: Record<LiveStatus, 'gray' | 'green' | 'blue' | 'orange'> = { NOT_STARTED: 'gray', IN_PROGRESS: 'green', SUBMITTED: 'blue', DISCONNECTED: 'orange' };

const mmss = (ms: number | null) => {
  if (ms === null) return '-';
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export default function LiveViewPage() {
  const { examId } = useParams<{ examId: string }>();
  const { t, fmtDate, fmtTime, errorMessage } = useI18n();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<Live>(`/exams/${examId}/live`, 5000);
  const [filter, setFilter] = useState<LiveStatus | 'ALL' | 'FLAGGED'>('ALL');
  const [noteFor, setNoteFor] = useState<Row | 'EXAM' | null>(null);
  const [noteText, setNoteText] = useState('');
  const [extendFor, setExtendFor] = useState<Row | null>(null);
  const [minutes, setMinutes] = useState(5);
  const [reason, setReason] = useState('');
  const [focusFor, setFocusFor] = useState<Row | null>(null);
  const [events, setEvents] = useState<FocusEvent[] | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;

  const rows = data.students.filter((r) => (filter === 'ALL' ? true : filter === 'FLAGGED' ? r.tabSwitches >= 3 : r.status === filter));

  async function saveNote() {
    setBusy(true);
    try {
      await api(`/exams/${examId}/notes`, { method: 'POST', body: { text: noteText, attemptId: noteFor !== 'EXAM' ? noteFor?.attemptId : null } });
      toast.success(t('noteAdded'));
      setNoteFor(null);
      setNoteText('');
      reload(true);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function extend() {
    if (!extendFor?.attemptId) return;
    setBusy(true);
    try {
      await api(`/attempts/${extendFor.attemptId}/extend`, { method: 'POST', body: { minutes, reason } });
      toast.success(t('timeExtended'));
      setExtendFor(null);
      setReason('');
      reload(true);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function openFocus(r: Row) {
    setFocusFor(r);
    setEvents(null);
    try {
      setEvents(await api<FocusEvent[]>(`/attempts/${r.attemptId}/focus-events`));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const filters: { id: typeof filter; label: string; n: number }[] = [
    { id: 'ALL', label: t('all'), n: data.summary.total },
    { id: 'IN_PROGRESS', label: t('live_IN_PROGRESS'), n: data.summary.inProgress },
    { id: 'DISCONNECTED', label: t('live_DISCONNECTED'), n: data.summary.disconnected },
    { id: 'SUBMITTED', label: t('live_SUBMITTED'), n: data.summary.submitted },
    { id: 'NOT_STARTED', label: t('live_NOT_STARTED'), n: data.summary.notStarted },
    { id: 'FLAGGED', label: t('summaryFlagged'), n: data.summary.flagged },
  ];

  return (
    <div>
      <PageHeader
        title={`${t('liveView')}: ${data.exam.courseCode} · ${data.exam.title}`}
        subtitle={`${fmtDate(data.exam.windowStart)} - ${fmtTime(data.exam.windowEnd)} · ${t('liveUpdates')}`}
        actions={<Button variant="secondary" onClick={() => setNoteFor('EXAM')}>{t('addNote')}</Button>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label={t('live_NOT_STARTED')} value={data.summary.notStarted} tone="gray" />
        <Stat label={t('live_IN_PROGRESS')} value={data.summary.inProgress} />
        <Stat label={t('live_DISCONNECTED')} value={data.summary.disconnected} tone={data.summary.disconnected ? 'amber' : 'gray'} />
        <Stat label={t('live_SUBMITTED')} value={data.summary.submitted} tone="gray" />
        <Stat label={t('summaryFlagged')} value={data.summary.flagged} tone={data.summary.flagged ? 'red' : 'gray'} />
      </div>

      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {filters.map((f) => (
          <button key={f.id} onClick={() => setFilter(f.id)} className={`whitespace-nowrap rounded-full border px-3 py-1 text-sm ${filter === f.id ? 'border-brand-700 bg-brand-700 text-white' : 'border-gray-300 bg-white text-gray-700'}`}>
            {f.label} ({f.n})
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <Empty />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => (
            <div key={r.studentUserId} className={`rounded-xl border-2 p-4 ${ROW_STYLE[r.status]}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-gray-900">{r.fullName}</p>
                  <p className="font-mono text-xs text-gray-500">{r.studentId}</p>
                </div>
                <Badge tone={BADGE[r.status]}>{t(`live_${r.status}` as DictKey)}</Badge>
              </div>
              {r.attemptId && (
                <>
                  <div className="mt-3">
                    <div className="flex justify-between text-xs text-gray-600">
                      <span>{t('progress')}</span>
                      <span>{r.answered} / {r.total}</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-100">
                      <div className="h-full rounded-full bg-brand-600" style={{ width: `${r.total ? (r.answered / r.total) * 100 : 0}%` }} />
                    </div>
                  </div>
                  <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <dt className="text-gray-500">{t('tabSwitches')}</dt>
                      <dd className={`text-base font-bold ${r.tabSwitches >= 3 ? 'text-red-600' : 'text-gray-900'}`}>
                        {r.tabSwitches >= 3 && '⚠ '}
                        {r.tabSwitches}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">{t('remaining')}</dt>
                      <dd className="font-mono text-base font-bold">{r.status === 'SUBMITTED' ? '-' : mmss(r.remainingMs)}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">{t('lastSeen')}</dt>
                      <dd className="text-sm">{fmtTime(r.lastSeenAt)}</dd>
                    </div>
                  </dl>
                  {r.extraMinutes > 0 && <p className="mt-2 text-xs text-brand-800">+{r.extraMinutes} {t('minShort')}</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setNoteFor(r)}>{t('addNote')}</Button>
                    {(r.status === 'IN_PROGRESS' || r.status === 'DISCONNECTED') && r.extraMinutes < 15 && (
                      <Button size="sm" variant="secondary" onClick={() => { setExtendFor(r); setMinutes(Math.min(5, 15 - r.extraMinutes)); }}>
                        {t('extendTime')}
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => openFocus(r)}>{t('focusLog')}</Button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <Card title={t('notes')} className="mt-5">
        {data.notes.length === 0 ? (
          <p className="text-sm text-gray-500">{t('noData')}</p>
        ) : (
          <ul className="divide-y divide-gray-100 text-sm">
            {data.notes.map((n) => {
              const who = n.attemptId ? data.students.find((s) => s.attemptId === n.attemptId)?.fullName : null;
              return (
                <li key={n.id} className="py-2">
                  <p className="text-gray-900">{who && <span className="font-semibold">{who}: </span>}{n.text}</p>
                  <p className="text-xs text-gray-500">{n.author} · {fmtDate(n.createdAt)}</p>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Modal
        open={!!noteFor}
        onClose={() => setNoteFor(null)}
        title={noteFor === 'EXAM' ? t('generalNote') : `${t('aboutStudent')}: ${noteFor?.fullName ?? ''}`}
        footer={<><Button variant="secondary" onClick={() => setNoteFor(null)}>{t('cancel')}</Button><Button onClick={saveNote} loading={busy} disabled={noteText.trim().length < 2}>{t('save')}</Button></>}
      >
        <Field label={t('noteText')}>
          <Textarea rows={4} value={noteText} onChange={(e) => setNoteText(e.target.value)} maxLength={1000} />
        </Field>
      </Modal>

      <Modal
        open={!!extendFor}
        onClose={() => setExtendFor(null)}
        title={`${t('extendTime')}: ${extendFor?.fullName ?? ''}`}
        footer={<><Button variant="secondary" onClick={() => setExtendFor(null)}>{t('cancel')}</Button><Button onClick={extend} loading={busy} disabled={reason.trim().length < 3}>{t('extendTime')}</Button></>}
      >
        <div className="space-y-4">
          <Field label={t('extendMinutes')}>
            <Input type="number" min={1} max={15 - (extendFor?.extraMinutes ?? 0)} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
          </Field>
          <Field label={t('reason')} required>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </Field>
        </div>
      </Modal>

      <Modal open={!!focusFor} onClose={() => setFocusFor(null)} title={`${t('focusLog')}: ${focusFor?.fullName ?? ''}`}>
        {!events ? (
          <Loading />
        ) : events.length === 0 ? (
          <p className="text-sm text-gray-500">{t('noData')}</p>
        ) : (
          <ul className="divide-y divide-gray-100 text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex items-center justify-between py-2">
                <span>{t('lostAt')} {fmtTime(e.lostAt)}</span>
                <span>{e.durationMs !== null ? `${(e.durationMs / 1000).toFixed(1)} s` : '…'}</span>
                {e.counted ? <Badge tone="red">{t('counted')}</Badge> : <Badge>{t('notCounted')}</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}
