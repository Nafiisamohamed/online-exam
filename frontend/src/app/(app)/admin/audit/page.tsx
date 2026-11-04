'use client';
/** Registrar: audit log of sensitive actions (who, what, when), paged and filterable. */
import { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { useApi } from '@/lib/useApi';
import { Button, Card, ErrorState, Input, Loading, PageHeader, Table, Td, Th } from '@/components/ui';

interface Entry {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  details: unknown;
  ip: string | null;
  createdAt: string;
  user: { fullName: string; username: string; role: string } | null;
}

export default function AuditPage() {
  const { t, fmtDate } = useI18n();
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const q = new URLSearchParams({ page: String(page), pageSize: '30', ...(action && { action }) });
  const { data, error, loading, reload } = useApi<{ items: Entry[]; total: number; page: number; pageSize: number }>(`/audit?${q}`);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      <PageHeader title={t('auditLog')} />
      <div className="mb-4 max-w-sm">
        <Input placeholder={`${t('search')}: ${t('action')} (LOGIN, EXAM_APPROVED...)`} value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} />
      </div>
      <Card>
        {loading && !data ? (
          <Loading />
        ) : error || !data ? (
          <ErrorState error={error} onRetry={reload} />
        ) : (
          <>
            <Table>
              <thead>
                <tr><Th>{t('when')}</Th><Th>{t('who')}</Th><Th>{t('action')}</Th><Th>{t('entity')}</Th><Th>{t('details')}</Th><Th>IP</Th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.items.map((e) => (
                  <tr key={e.id}>
                    <Td className="whitespace-nowrap text-gray-600">{fmtDate(e.createdAt)}</Td>
                    <Td>{e.user ? `${e.user.fullName}` : '-'}</Td>
                    <Td className="font-mono text-xs">{e.action}</Td>
                    <Td className="text-xs">{e.entity}</Td>
                    <Td className="max-w-xs truncate font-mono text-xs text-gray-500">{e.details ? JSON.stringify(e.details) : ''}</Td>
                    <Td className="font-mono text-xs">{e.ip}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="mt-4 flex items-center justify-between text-sm">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('prevPage')}</Button>
              <span>{t('page', { n: `${page} / ${pages}` })}</span>
              <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>{t('nextPage')}</Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
