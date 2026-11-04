'use client';
/** In-app notifications (stored in both languages). */
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useApi } from '@/lib/useApi';
import { Button, Card, Empty, ErrorState, Loading, PageHeader } from '@/components/ui';

interface Note {
  id: string;
  title: string;
  titleSo: string;
  body: string;
  bodySo: string;
  read: boolean;
  createdAt: string;
}

export default function NotificationsPage() {
  const { t, lang, fmtDate } = useI18n();
  const { data, error, loading, reload } = useApi<{ items: Note[]; unread: number }>('/notifications');
  if (loading) return <Loading />;
  if (error || !data) return <ErrorState error={error} onRetry={reload} />;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={t('notifications')}
        actions={
          data.unread > 0 && (
            <Button variant="secondary" onClick={async () => { await api('/notifications/read', { method: 'POST' }); reload(); }}>
              {t('markAllRead')}
            </Button>
          )
        }
      />
      {data.items.length === 0 ? (
        <Empty text={t('noNotifications')} />
      ) : (
        <Card>
          <ul className="divide-y divide-gray-100">
            {data.items.map((n) => (
              <li key={n.id} className="flex gap-3 py-3">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? 'bg-gray-300' : 'bg-brand-600'}`} aria-hidden />
                <div className="min-w-0">
                  <p className="font-medium text-gray-900">{lang === 'so' && n.titleSo ? n.titleSo : n.title}</p>
                  <p className="text-sm text-gray-700">{lang === 'so' && n.bodySo ? n.bodySo : n.body}</p>
                  <p className="mt-1 text-xs text-gray-500">{fmtDate(n.createdAt)}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
