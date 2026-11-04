'use client';
/**
 * Generic CSV import with preview: read file -> POST {csv, dryRun:true} -> show each row as
 * valid / error (with reasons) / duplicate -> POST {csv, dryRun:false} saves only valid rows.
 */
import { useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useToast } from './Toast';
import { Badge, Button, Modal, Table, Td, Th } from './ui';

export interface ImportRow {
  line: number;
  status: string; // VALID | ERROR | DUPLICATE | NEW | EXISTING
  errors: string[];
  [k: string]: unknown;
}
interface Result {
  rows: ImportRow[];
  summary: Record<string, number>;
}

export function CsvImport({
  title,
  endpoint,
  help,
  templateHref,
  columns,
  onDone,
  onClose,
  doneText,
}: {
  title: string;
  endpoint: string;
  help: ReactNode;
  templateHref?: () => void;
  columns: { label: string; render: (r: ImportRow) => ReactNode }[];
  onDone: () => void;
  onClose: () => void;
  doneText: (summary: Record<string, number>) => string;
}) {
  const { t, errorMessage, questionError } = useI18n();
  const toast = useToast();
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  async function read(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setPreview(null);
    const text = await file.text();
    setCsv(text);
    setBusy(true);
    try {
      setPreview(await api<Result>(endpoint, { method: 'POST', body: { csv: text, dryRun: true } }));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!csv) return;
    setBusy(true);
    try {
      const res = await api<Result>(endpoint, { method: 'POST', body: { csv, dryRun: false } });
      toast.success(doneText(res.summary));
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const tone = (s: string) => (s === 'ERROR' ? 'red' : s === 'DUPLICATE' ? 'amber' : 'green');
  const statusLabel = (s: string) =>
    ({ VALID: t('rowValid'), ERROR: t('rowError'), DUPLICATE: t('rowDuplicate'), NEW: t('rowNew'), EXISTING: t('rowExisting') })[s] ?? s;
  const validCount = preview?.rows.filter((r) => r.status !== 'ERROR' && r.status !== 'DUPLICATE').length ?? 0;

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('cancel')}</Button>
          <Button onClick={commit} loading={busy} disabled={!preview || validCount === 0}>
            {t('confirmImport')} ({validCount})
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600">{help}</p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium hover:bg-gray-50">
            📄 {t('chooseFile')}
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => read(e.target.files?.[0])} />
          </label>
          {fileName && <span className="text-sm text-gray-600">{fileName}</span>}
          {templateHref && <Button variant="ghost" size="sm" onClick={templateHref}>{t('downloadTemplate')}</Button>}
        </div>
        {busy && !preview && <p className="text-sm text-gray-500">{t('loading')}</p>}
        {preview && (
          <>
            <p className="text-sm font-medium text-gray-800">
              {t('importSummary', {
                valid: validCount,
                errors: preview.rows.filter((r) => r.status === 'ERROR').length,
                duplicates: preview.rows.filter((r) => r.status === 'DUPLICATE').length,
              })}
            </p>
            <Table>
              <thead>
                <tr>
                  <Th>{t('row')}</Th>
                  <Th>{t('status')}</Th>
                  {columns.map((c) => <Th key={c.label}>{c.label}</Th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {preview.rows.map((r) => (
                  <tr key={r.line} className={r.status === 'ERROR' ? 'bg-red-50/50' : r.status === 'DUPLICATE' ? 'bg-amber-50/50' : ''}>
                    <Td>{r.line}</Td>
                    <Td>
                      <Badge tone={tone(r.status)}>{statusLabel(r.status)}</Badge>
                      {r.errors.length > 0 && (
                        <ul className="mt-1 space-y-0.5 text-xs text-red-700">
                          {r.errors.map((e) => <li key={e}>{questionError(e)}</li>)}
                        </ul>
                      )}
                    </Td>
                    {columns.map((c) => <Td key={c.label}>{c.render(r)}</Td>)}
                  </tr>
                ))}
              </tbody>
            </Table>
          </>
        )}
      </div>
    </Modal>
  );
}
