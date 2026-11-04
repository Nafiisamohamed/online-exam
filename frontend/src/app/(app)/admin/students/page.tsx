'use client';
/** Registrar: students list + enrolment by CSV (student ID, name, phone, course codes) with preview. */
import { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { useApi } from '@/lib/useApi';
import { CsvImport, type ImportRow } from '@/components/CsvImport';
import { Badge, Button, Card, Empty, ErrorState, Input, Loading, PageHeader, Table, Td, Th } from '@/components/ui';

interface Student {
  id: string;
  fullName: string;
  studentId: string;
  phone: string | null;
  isActive: boolean;
  enrolments: { course: { code: string } }[];
}

const TEMPLATE = 'student_id,name,phone,course_codes\nJB-25-101,Ayaan Abdi Farah,+252615551101,CS101;CS205\nJB-25-102,Mohamed Ali Nur,+252634551102,BA110\n';

export default function StudentsPage() {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [importing, setImporting] = useState(false);
  const list = useApi<Student[]>(`/students${search ? `?search=${encodeURIComponent(search)}` : ''}`);

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([TEMPLATE], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'imtixaan-students-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <PageHeader title={t('nav_students')} actions={<Button onClick={() => setImporting(true)}>{t('importStudents')}</Button>} />
      <div className="mb-4 max-w-sm">
        <Input placeholder={`${t('search')}: ${t('name')} / ${t('studentId')}`} value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <Card>
        {list.loading ? (
          <Loading />
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : !list.data?.length ? (
          <Empty />
        ) : (
          <Table>
            <thead>
              <tr><Th>{t('studentId')}</Th><Th>{t('name')}</Th><Th>{t('phone')}</Th><Th>{t('courses')}</Th><Th>{t('status')}</Th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {list.data.map((s) => (
                <tr key={s.id}>
                  <Td className="font-mono text-xs">{s.studentId}</Td>
                  <Td>{s.fullName}</Td>
                  <Td>{s.phone}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">{s.enrolments.map((e) => <Badge key={e.course.code}>{e.course.code}</Badge>)}</div>
                  </Td>
                  <Td>{s.isActive ? <Badge tone="green">{t('active')}</Badge> : <Badge>{t('inactive')}</Badge>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {importing && (
        <CsvImport
          title={t('importStudents')}
          endpoint="/enrolments/import"
          help={t('csvColumnsStudents')}
          templateHref={downloadTemplate}
          columns={[
            { label: t('studentId'), render: (r: ImportRow) => <span className="font-mono text-xs">{String(r.studentId)}</span> },
            { label: t('name'), render: (r: ImportRow) => String(r.name) },
            { label: t('phone'), render: (r: ImportRow) => String(r.phone) },
            { label: t('courses'), render: (r: ImportRow) => (r.courseCodes as string[]).join(', ') },
          ]}
          onClose={() => setImporting(false)}
          onDone={() => { setImporting(false); list.reload(); }}
          doneText={(s) => t('studentsImported', { created: s.created ?? 0, enrolments: s.enrolments ?? 0 })}
        />
      )}
    </div>
  );
}
