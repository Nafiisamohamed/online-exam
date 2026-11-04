'use client';
/** Student: list of published results only (unpublished results are never returned by the API). */
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';
import { useApi } from '@/lib/useApi';
import { Badge, Card, Empty, ErrorState, Loading, PageHeader, Table, Td, Th } from '@/components/ui';

interface MyResult {
  attemptId: string;
  exam: { id: string; title: string; course: { code: string; name: string }; publishedAt: string };
  score: number;
  maxScore: number;
  percentage: number;
  letter: string;
  updatedAt: string;
}

export default function MyResultsPage() {
  const { t, fmtDate } = useI18n();
  const { data, error, loading, reload } = useApi<MyResult[]>('/student/results');
  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  return (
    <div>
      <PageHeader title={t('myResults')} subtitle={t('resultChangedNote')} />
      {!data?.length ? (
        <Empty text={t('noResults')} />
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>{t('course')}</Th>
                <Th>{t('exam')}</Th>
                <Th>{t('score')}</Th>
                <Th>{t('percentage')}</Th>
                <Th>{t('grade')}</Th>
                <Th>{t('updatedAt')}</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.map((r) => (
                <tr key={r.attemptId}>
                  <Td className="font-medium">{r.exam.course.code}</Td>
                  <Td>{r.exam.title}</Td>
                  <Td>
                    {r.score} / {r.maxScore}
                  </Td>
                  <Td>{r.percentage}%</Td>
                  <Td>
                    <Badge tone={r.letter === 'F' ? 'red' : 'green'}>{r.letter}</Badge>
                  </Td>
                  <Td className="text-gray-500">{fmtDate(r.updatedAt)}</Td>
                  <Td>
                    <Link href={`/student/results/${r.attemptId}`} className="font-medium text-brand-700 hover:underline">
                      {t('view')}
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
