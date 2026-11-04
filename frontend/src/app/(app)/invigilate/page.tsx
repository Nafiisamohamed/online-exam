'use client';
/** Invigilator: list of assigned scheduled exams (lecturers/admins see their exams too). */
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';
import { useApi } from '@/lib/useApi';
import type { Exam } from '@/lib/types';
import { Badge, Button, Card, Empty, ErrorState, Loading, PageHeader } from '@/components/ui';

export default function InvigilateListPage() {
  const { t, fmtDate } = useI18n();
  const { data, error, loading, reload } = useApi<Exam[]>('/exams');
  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const now = Date.now();
  const exams = (data ?? []).filter((e) => e.status === 'SCHEDULED');
  return (
    <div>
      <PageHeader title={t('nav_invigilate')} />
      {!exams.length ? (
        <Empty text={t('noAssigned')} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {exams.map((e) => {
            const open = e.windowStart && e.windowEnd && new Date(e.windowStart).getTime() <= now && now < new Date(e.windowEnd).getTime();
            return (
              <Card key={e.id}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold uppercase text-brand-700">{e.course.code}</p>
                    <h2 className="text-lg font-semibold">{e.title}</h2>
                    <p className="mt-1 text-sm text-gray-600">
                      {fmtDate(e.windowStart)} - {fmtDate(e.windowEnd)}
                    </p>
                    <p className="text-sm text-gray-600">{e.rooms.map((r) => r.room.name).join(', ')}</p>
                  </div>
                  {open ? <Badge tone="green">{t('windowOpen')}</Badge> : <Badge>{t('windowClosed')}</Badge>}
                </div>
                <Link href={`/invigilate/${e.id}`} className="mt-4 inline-block">
                  <Button>{t('openLive')}</Button>
                </Link>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
