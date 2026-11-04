'use client';
/** Registrar: exam rooms with capacity and the lab network range used to restrict exam starts. */
import { useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useApi } from '@/lib/useApi';
import { useToast } from '@/components/Toast';
import { Button, Card, Empty, ErrorState, Field, Input, Loading, Modal, PageHeader, Table, Td, Th } from '@/components/ui';

interface Room {
  id: string;
  name: string;
  building: string;
  capacity: number;
  network: string | null;
}

export default function RoomsPage() {
  const { t, errorMessage } = useI18n();
  const toast = useToast();
  const rooms = useApi<Room[]>('/rooms');
  const [form, setForm] = useState<null | { id?: string; name: string; building: string; capacity: number; network: string }>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!form) return;
    setBusy(true);
    try {
      const { id, ...body } = form;
      const payload = { ...body, network: body.network.trim() || null };
      if (id) await api(`/rooms/${id}`, { method: 'PATCH', body: payload });
      else await api('/rooms', { method: 'POST', body: payload });
      toast.success(t('saved'));
      setForm(null);
      rooms.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title={t('rooms')} actions={<Button onClick={() => setForm({ name: '', building: '', capacity: 30, network: '' })}>+ {t('newRoom')}</Button>} />
      <Card>
        {rooms.loading ? (
          <Loading />
        ) : rooms.error ? (
          <ErrorState error={rooms.error} onRetry={rooms.reload} />
        ) : !rooms.data?.length ? (
          <Empty />
        ) : (
          <Table>
            <thead>
              <tr><Th>{t('room')}</Th><Th>{t('building')}</Th><Th>{t('capacity')}</Th><Th>{t('network')}</Th><Th /></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rooms.data.map((r) => (
                <tr key={r.id}>
                  <Td className="font-medium">{r.name}</Td>
                  <Td>{r.building}</Td>
                  <Td>{r.capacity}</Td>
                  <Td className="font-mono text-xs">{r.network ?? '-'}</Td>
                  <Td><button className="text-sm font-medium text-brand-700" onClick={() => setForm({ ...r, network: r.network ?? '' })}>{t('edit')}</button></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? t('edit') : t('newRoom')} footer={<><Button variant="secondary" onClick={() => setForm(null)}>{t('cancel')}</Button><Button onClick={save} loading={busy}>{t('save')}</Button></>}>
        {form && (
          <div className="space-y-4">
            <Field label={t('room')} required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label={t('building')} required><Input value={form.building} onChange={(e) => setForm({ ...form, building: e.target.value })} /></Field>
            <Field label={t('capacity')}><Input type="number" min={1} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })} /></Field>
            <Field label={t('network')} hint={t('networkHelp')}><Input className="font-mono" value={form.network} onChange={(e) => setForm({ ...form, network: e.target.value })} placeholder="192.168.10.0/24" /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
