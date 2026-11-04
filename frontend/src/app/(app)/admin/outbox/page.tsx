'use client';
/** Registrar: simulated SMS outbox (messages the SMS adapter "sent"). */
import { useI18n } from '@/lib/i18n';
import { useApi } from '@/lib/useApi';
import { Badge, Button, Card, Empty, ErrorState, Loading, PageHeader, Table, Td, Th } from '@/components/ui';

interface Sms {
  id: string;
  toPhone: string;
  message: string;
  status: string;
  createdAt: string;
}

export default function OutboxPage() {
  const { t, fmtDate } = useI18n();
  const { data, error, loading, reload } = useApi<Sms[]>('/outbox');
  return (
    <div>
      <PageHeader title={t('outbox')} subtitle={t('outboxHelp')} actions={<Button variant="secondary" onClick={() => reload()}>{t('refresh')}</Button>} />
      <Card>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : !data?.length ? (
          <Empty />
        ) : (
          <Table>
            <thead>
              <tr><Th>{t('when')}</Th><Th>{t('to')}</Th><Th>{t('message')}</Th><Th>{t('status')}</Th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.map((m) => (
                <tr key={m.id}>
                  <Td className="whitespace-nowrap text-gray-600">{fmtDate(m.createdAt)}</Td>
                  <Td className="whitespace-nowrap font-mono text-xs">{m.toPhone}</Td>
                  <Td className="min-w-[280px]">{m.message}</Td>
                  <Td><Badge tone="green">{m.status}</Badge></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
