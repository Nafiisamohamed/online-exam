'use client';
/** Role-based dashboard. Admin/lecturer: totals and charts from /api/dashboard. Student: exams + results. Invigilator: assigned exams. */
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { useApi } from '@/lib/useApi';
import { Badge, Button, Card, Empty, ErrorState, Loading, PageHeader, Stat } from '@/components/ui';
import { PairBarChart, SimpleBarChart } from '@/components/Charts';
import type { DictKey } from '@/lib/dictionary';
import type { StudentExam } from '@/lib/types';

interface Dashboard {
  totals: { courses: number; students: number; exams: number; attempts: number; questions: number; pendingApprovals: number; needsReview: number; publishedResults: number };
  averageByCourse: { course: string; average: number; results: number }[];
  gradeDistribution: { letter: string; count: number }[];
  examStatus: { status: string; count: number }[];
  focusByExam: { exam: string; title: string; attempts: number; flagged: number }[];
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  if (!user) return null;
  return (
    <div>
      <PageHeader title={t('welcome', { name: user.fullName })} subtitle={t(`role_${user.role}` as DictKey)} />
      {user.role === 'ADMIN' || user.role === 'LECTURER' ? <StaffDashboard /> : user.role === 'STUDENT' ? <StudentDashboard /> : <InvigilatorDashboard />}
    </div>
  );
}

function StaffDashboard() {
  const { t } = useI18n();
  const { data, error, loading, reload } = useApi<Dashboard>('/dashboard');
  if (loading) return <Loading />;
  if (error || !data) return <ErrorState error={error} onRetry={reload} />;
  const s = data.totals;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t('stat_courses')} value={s.courses} />
        <Stat label={t('stat_students')} value={s.students} />
        <Stat label={t('stat_exams')} value={s.exams} />
        <Stat label={t('stat_attempts')} value={s.attempts} />
        <Stat label={t('stat_questions')} value={s.questions} tone="gray" />
        <Stat label={t('stat_pending')} value={s.pendingApprovals} tone={s.pendingApprovals ? 'amber' : 'gray'} />
        <Stat label={t('stat_review')} value={s.needsReview} tone={s.needsReview ? 'amber' : 'gray'} />
        <Stat label={t('stat_results')} value={s.publishedResults} tone="gray" />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={t('chart_avgByCourse')}>
          <SimpleBarChart data={data.averageByCourse.map((c) => ({ label: c.course, value: c.average }))} valueLabel={t('average')} maxY={100} unit="%" />
        </Card>
        <Card title={t('chart_gradeDist')}>
          <SimpleBarChart data={data.gradeDistribution.map((g) => ({ label: g.letter, value: g.count }))} valueLabel={t('students')} />
        </Card>
        <Card title={t('chart_focus')} className="lg:col-span-2">
          <PairBarChart
            data={data.focusByExam.map((e) => ({ label: `${e.exam} ${e.title}`, a: e.attempts, b: e.flagged }))}
            aLabel={t('chart_attempts')}
            bLabel={t('chart_flagged')}
          />
        </Card>
      </div>
    </div>
  );
}

function StudentDashboard() {
  const { t, fmtDate } = useI18n();
  const exams = useApi<StudentExam[]>('/student/exams');
  const results = useApi<{ attemptId: string; exam: { title: string; course: { code: string } }; percentage: number; letter: string }[]>('/student/results');
  const upcoming = (exams.data ?? []).filter((e) => e.windowState !== 'CLOSED' && (!e.attempt || e.attempt.status === 'IN_PROGRESS'));
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title={t('upcomingExams')} actions={<Link href="/student/exams" className="text-sm font-medium text-brand-700">{t('view')} →</Link>}>
        {exams.loading ? (
          <Loading />
        ) : exams.error ? (
          <ErrorState error={exams.error} onRetry={exams.reload} />
        ) : upcoming.length === 0 ? (
          <Empty text={t('noExams')} />
        ) : (
          <ul className="divide-y divide-gray-100">
            {upcoming.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <p className="font-medium text-gray-900">
                    {e.course.code} · {e.title}
                  </p>
                  <p className="text-xs text-gray-500">{fmtDate(e.windowStart)} · {e.durationMinutes} {t('minutes')}</p>
                </div>
                {e.windowState === 'OPEN' ? <Badge tone="green">{t('windowOpen')}</Badge> : <Badge>{t('windowNotOpen')}</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={t('latestResults')} actions={<Link href="/student/results" className="text-sm font-medium text-brand-700">{t('view')} →</Link>}>
        {results.loading ? (
          <Loading />
        ) : !results.data?.length ? (
          <Empty text={t('noResults')} />
        ) : (
          <ul className="divide-y divide-gray-100">
            {results.data.slice(0, 5).map((r) => (
              <li key={r.attemptId} className="flex items-center justify-between py-3">
                <Link href={`/student/results/${r.attemptId}`} className="font-medium text-gray-900 hover:text-brand-700">
                  {r.exam.course.code} · {r.exam.title}
                </Link>
                <span className="text-sm">
                  {r.percentage}% <Badge tone="green">{r.letter}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function InvigilatorDashboard() {
  const { t, fmtDate } = useI18n();
  const { data, loading, error, reload } = useApi<{ id: string; title: string; windowStart: string; windowEnd: string; course: { code: string } }[]>('/exams');
  return (
    <Card title={t('assignedExams')}>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !data?.length ? (
        <Empty text={t('noAssigned')} />
      ) : (
        <ul className="divide-y divide-gray-100">
          {data.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div>
                <p className="font-medium">
                  {e.course.code} · {e.title}
                </p>
                <p className="text-xs text-gray-500">
                  {fmtDate(e.windowStart)} - {fmtDate(e.windowEnd)}
                </p>
              </div>
              <Link href={`/invigilate/${e.id}`}>
                <Button size="sm">{t('openLive')}</Button>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
