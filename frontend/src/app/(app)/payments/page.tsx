'use client';
/**
 * Simulated mobile money (EVC Plus, Zaad, eDahab): choose fee -> provider -> phone ->
 * simulated PIN confirmation -> printable receipt. Admins see every payment.
 */
import { useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { useApi } from '@/lib/useApi';
import { useToast } from '@/components/Toast';
import { Badge, Button, Card, Empty, ErrorState, Field, Input, Loading, Modal, PageHeader, Table, Td, Th } from '@/components/ui';
import { Logo } from '@/components/Logo';

type Provider = 'EVC_PLUS' | 'ZAAD' | 'EDAHAB';
const PROVIDERS: { id: Provider; name: string; color: string; hint: string }[] = [
  { id: 'EVC_PLUS', name: 'EVC Plus', color: 'bg-emerald-600', hint: '*712#' },
  { id: 'ZAAD', name: 'Zaad', color: 'bg-sky-600', hint: '*220#' },
  { id: 'EDAHAB', name: 'eDahab', color: 'bg-amber-500', hint: '*110#' },
];
interface Fee {
  code: string;
  amount: number;
  en: string;
  so: string;
}
interface Payment {
  id: string;
  provider: Provider;
  phone: string;
  amount: number;
  purpose: string;
  reference: string;
  status: string;
  createdAt: string;
  user: { fullName: string; studentId: string | null };
}

export default function PaymentsPage() {
  const { user } = useAuth();
  const { t, lang, fmtDate, errorMessage } = useI18n();
  const toast = useToast();
  const fees = useApi<Fee[]>('/payments/fees');
  const list = useApi<Payment[]>('/payments');
  const [fee, setFee] = useState<Fee | null>(null);
  const [provider, setProvider] = useState<Provider>('EVC_PLUS');
  const [phone, setPhone] = useState('');
  const [step, setStep] = useState<'form' | 'pin'>('form');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Payment | null>(null);

  const feeName = (code: string) => {
    const f = fees.data?.find((x) => x.code === code);
    return f ? (lang === 'so' ? f.so : f.en) : code;
  };

  async function pay() {
    if (!fee) return;
    setBusy(true);
    try {
      const p = await api<Payment>('/payments', { method: 'POST', body: { provider, phone, fee: fee.code } });
      setReceipt({ ...p, user: { fullName: user!.fullName, studentId: user!.studentId } });
      toast.success(t('paymentDone'));
      setFee(null);
      list.reload();
    } catch (err) {
      toast.error(errorMessage(err));
      setStep('form');
    } finally {
      setBusy(false);
      setPin('');
    }
  }

  const providerName = (p: Provider) => PROVIDERS.find((x) => x.id === p)?.name ?? p;

  return (
    <div>
      <PageHeader title={t('payments')} subtitle={t('simulatedNote')} />
      {user?.role !== 'ADMIN' && (
        <Card title={t('payFee')} className="mb-5">
          {fees.loading ? (
            <Loading />
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              {fees.data?.map((f) => (
                <button key={f.code} onClick={() => { setFee(f); setStep('form'); }} className="rounded-xl border border-gray-200 p-4 text-left hover:border-brand-600 hover:bg-brand-50">
                  <p className="font-medium text-gray-900">{lang === 'so' ? f.so : f.en}</p>
                  <p className="mt-1 text-2xl font-bold text-brand-800">${f.amount}</p>
                </button>
              ))}
            </div>
          )}
        </Card>
      )}

      <Card title={t('myPayments')}>
        {list.loading ? (
          <Loading />
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : !list.data?.length ? (
          <Empty />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t('date')}</Th>
                {user?.role === 'ADMIN' && <Th>{t('paidBy')}</Th>}
                <Th>{t('fee')}</Th>
                <Th>{t('provider')}</Th>
                <Th>{t('amount')}</Th>
                <Th>{t('reference')}</Th>
                <Th>{t('status')}</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {list.data.map((p) => (
                <tr key={p.id}>
                  <Td className="whitespace-nowrap">{fmtDate(p.createdAt)}</Td>
                  {user?.role === 'ADMIN' && <Td>{p.user.fullName} <span className="text-gray-500">{p.user.studentId}</span></Td>}
                  <Td>{feeName(p.purpose)}</Td>
                  <Td>{providerName(p.provider)}</Td>
                  <Td>${p.amount}</Td>
                  <Td className="font-mono text-xs">{p.reference}</Td>
                  <Td>
                    <Badge tone={p.status === 'SUCCESS' ? 'green' : 'red'}>{p.status === 'SUCCESS' ? t('paymentDone') : t('paymentFailed')}</Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* Payment flow */}
      <Modal
        open={!!fee}
        onClose={() => setFee(null)}
        title={fee ? `${lang === 'so' ? fee.so : fee.en} · $${fee.amount}` : ''}
        footer={
          step === 'form' ? (
            <>
              <Button variant="secondary" onClick={() => setFee(null)}>{t('cancel')}</Button>
              <Button onClick={() => setStep('pin')} disabled={!/^\+?[0-9 ]{7,16}$/.test(phone)}>{t('payNow')}</Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setStep('form')}>{t('back')}</Button>
              <Button onClick={pay} loading={busy} disabled={pin.length < 4}>{t('confirmPayment')}</Button>
            </>
          )
        }
      >
        {step === 'form' ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {PROVIDERS.map((p) => (
                <button key={p.id} onClick={() => setProvider(p.id)} className={`rounded-xl border-2 p-3 text-center ${provider === p.id ? 'border-brand-700 bg-brand-50' : 'border-gray-200'}`}>
                  <span className={`mx-auto mb-1 block h-8 w-8 rounded-full ${p.color}`} aria-hidden />
                  <span className="text-sm font-semibold">{p.name}</span>
                </button>
              ))}
            </div>
            <Field label={t('phone')} hint="+252 61 5123456">
              <Input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+25261..." />
            </Field>
            <p className="text-xs text-gray-500">{t('simulatedNote')}</p>
          </div>
        ) : (
          <div className="space-y-4 text-center">
            <div className="mx-auto w-56 rounded-3xl border-4 border-gray-800 bg-gray-900 p-4 text-left text-green-300">
              <p className="font-mono text-xs">{PROVIDERS.find((p) => p.id === provider)?.hint}</p>
              <p className="mt-2 font-mono text-sm">
                {providerName(provider)}: ${fee?.amount} → Imtixaan
              </p>
              <p className="mt-2 font-mono text-xs">{t('enterPin')}</p>
            </div>
            <Field label={t('pin')}>
              <Input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} className="text-center text-lg tracking-[0.5em]" />
            </Field>
          </div>
        )}
      </Modal>

      {/* Receipt */}
      <Modal open={!!receipt} onClose={() => setReceipt(null)} title={t('receipt')} footer={<Button onClick={() => window.print()}>{t('print')}</Button>}>
        {receipt && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <Logo size={32} />
              <span className="font-bold">{t('appName')}</span>
              <Badge tone="green">{t('paymentDone')}</Badge>
            </div>
            <dl className="grid grid-cols-2 gap-2">
              <dt className="text-gray-500">{t('paidBy')}</dt>
              <dd>{receipt.user.fullName} {receipt.user.studentId}</dd>
              <dt className="text-gray-500">{t('fee')}</dt>
              <dd>{feeName(receipt.purpose)}</dd>
              <dt className="text-gray-500">{t('provider')}</dt>
              <dd>{providerName(receipt.provider)} ({receipt.phone})</dd>
              <dt className="text-gray-500">{t('amount')}</dt>
              <dd className="font-bold">${receipt.amount}</dd>
              <dt className="text-gray-500">{t('reference')}</dt>
              <dd className="font-mono">{receipt.reference}</dd>
              <dt className="text-gray-500">{t('date')}</dt>
              <dd>{fmtDate(receipt.createdAt)}</dd>
            </dl>
            <p className="text-xs text-gray-500">{t('simulatedNote')}</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
