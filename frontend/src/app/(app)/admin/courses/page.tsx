'use client';
/** Registrar: faculties, courses (code, name, semester, lecturer) and per-course enrolment (enrol / drop). */
import { useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useApi } from '@/lib/useApi';
import type { Course } from '@/lib/types';
import { useToast } from '@/components/Toast';
import { Badge, Button, Card, Empty, ErrorState, Field, Input, Loading, Modal, PageHeader, Select, Table, Td, Th } from '@/components/ui';

interface Faculty {
  id: string;
  code: string;
  name: string;
  _count: { courses: number };
}
interface Person {
  id: string;
  fullName: string;
  studentId?: string | null;
}
interface Enrolment {
  id: string;
  status: 'ACTIVE' | 'DROPPED';
  enrolledAt: string;
  droppedAt: string | null;
  student: { id: string; fullName: string; studentId: string; phone: string | null };
}

export default function CoursesPage() {
  const { t, fmtDate, errorMessage } = useI18n();
  const toast = useToast();
  const courses = useApi<Course[]>('/courses');
  const faculties = useApi<Faculty[]>('/faculties');
  const lecturers = useApi<Person[]>('/users?role=LECTURER');
  const students = useApi<Person[]>('/students');
  const [courseForm, setCourseForm] = useState<null | { id?: string; code: string; name: string; semester: string; facultyId: string; lecturerId: string }>(null);
  const [facultyForm, setFacultyForm] = useState<null | { code: string; name: string }>(null);
  const [enrolFor, setEnrolFor] = useState<Course | null>(null);
  const enrolments = useApi<Enrolment[]>(enrolFor ? `/courses/${enrolFor.id}/enrolments` : null);
  const [studentToAdd, setStudentToAdd] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const saveCourse = () =>
    run(async () => {
      if (!courseForm) return;
      const { id, ...body } = courseForm;
      const payload = { ...body, lecturerId: body.lecturerId || null };
      if (id) await api(`/courses/${id}`, { method: 'PATCH', body: payload });
      else await api('/courses', { method: 'POST', body: payload });
      toast.success(t('saved'));
      setCourseForm(null);
      courses.reload();
    });
  const saveFaculty = () =>
    run(async () => {
      await api('/faculties', { method: 'POST', body: facultyForm });
      toast.success(t('saved'));
      setFacultyForm(null);
      faculties.reload();
    });
  const enrol = () =>
    run(async () => {
      await api(`/courses/${enrolFor!.id}/enrolments`, { method: 'POST', body: { studentUserId: studentToAdd } });
      toast.success(t('studentEnrolled'));
      setStudentToAdd('');
      enrolments.reload(true);
      courses.reload(true);
    });
  const drop = (e: Enrolment) => {
    if (!confirm(t('dropConfirm'))) return;
    run(async () => {
      await api(`/courses/${enrolFor!.id}/enrolments/${e.student.id}`, { method: 'DELETE' });
      toast.success(t('studentDropped'));
      enrolments.reload(true);
      courses.reload(true);
    });
  };

  if (courses.loading) return <Loading />;
  if (courses.error) return <ErrorState error={courses.error} onRetry={courses.reload} />;
  const enrolledIds = new Set(enrolments.data?.filter((e) => e.status === 'ACTIVE').map((e) => e.student.id));

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('courses')}
        actions={
          <>
            <Button variant="secondary" onClick={() => setFacultyForm({ code: '', name: '' })}>+ {t('newFaculty')}</Button>
            <Button onClick={() => setCourseForm({ code: '', name: '', semester: 'Fall 2026', facultyId: faculties.data?.[0]?.id ?? '', lecturerId: '' })}>+ {t('newCourse')}</Button>
          </>
        }
      />
      <Card title={t('faculties')}>
        <div className="flex flex-wrap gap-2">
          {faculties.data?.map((f) => <Badge key={f.id} tone="green">{f.code} · {f.name} ({f._count.courses})</Badge>)}
        </div>
      </Card>
      <Card>
        {!courses.data?.length ? (
          <Empty />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t('code')}</Th>
                <Th>{t('name')}</Th>
                <Th>{t('faculty')}</Th>
                <Th>{t('semester')}</Th>
                <Th>{t('lecturer')}</Th>
                <Th>{t('enrolled')}</Th>
                <Th>{t('questionsCount')}</Th>
                <Th>{t('actions')}</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {courses.data.map((c) => (
                <tr key={c.id}>
                  <Td className="font-semibold">{c.code}</Td>
                  <Td>{c.name}</Td>
                  <Td>{c.faculty.code}</Td>
                  <Td>{c.semester}</Td>
                  <Td>{c.lecturer?.fullName ?? <span className="text-gray-400">{t('noLecturer')}</span>}</Td>
                  <Td>{c._count.enrolments}</Td>
                  <Td>{c._count.questions}</Td>
                  <Td>
                    <div className="flex gap-3 text-sm font-medium text-brand-700">
                      <button onClick={() => setEnrolFor(c)}>{t('manageEnrolment')}</button>
                      <button onClick={() => setCourseForm({ id: c.id, code: c.code, name: c.name, semester: c.semester, facultyId: c.facultyId, lecturerId: c.lecturerId ?? '' })}>{t('edit')}</button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal
        open={!!courseForm}
        onClose={() => setCourseForm(null)}
        title={courseForm?.id ? t('edit') : t('newCourse')}
        footer={<><Button variant="secondary" onClick={() => setCourseForm(null)}>{t('cancel')}</Button><Button onClick={saveCourse} loading={busy}>{t('save')}</Button></>}
      >
        {courseForm && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('code')} required><Input value={courseForm.code} onChange={(e) => setCourseForm({ ...courseForm, code: e.target.value })} placeholder="CS101" /></Field>
            <Field label={t('semester')} required><Input value={courseForm.semester} onChange={(e) => setCourseForm({ ...courseForm, semester: e.target.value })} /></Field>
            <div className="sm:col-span-2"><Field label={t('name')} required><Input value={courseForm.name} onChange={(e) => setCourseForm({ ...courseForm, name: e.target.value })} /></Field></div>
            <Field label={t('faculty')}>
              <Select value={courseForm.facultyId} onChange={(e) => setCourseForm({ ...courseForm, facultyId: e.target.value })}>
                {faculties.data?.map((f) => <option key={f.id} value={f.id}>{f.code} · {f.name}</option>)}
              </Select>
            </Field>
            <Field label={t('lecturer')}>
              <Select value={courseForm.lecturerId} onChange={(e) => setCourseForm({ ...courseForm, lecturerId: e.target.value })}>
                <option value="">{t('noLecturer')}</option>
                {lecturers.data?.map((l) => <option key={l.id} value={l.id}>{l.fullName}</option>)}
              </Select>
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={!!facultyForm}
        onClose={() => setFacultyForm(null)}
        title={t('newFaculty')}
        footer={<><Button variant="secondary" onClick={() => setFacultyForm(null)}>{t('cancel')}</Button><Button onClick={saveFaculty} loading={busy}>{t('save')}</Button></>}
      >
        {facultyForm && (
          <div className="space-y-4">
            <Field label={t('code')} required><Input value={facultyForm.code} onChange={(e) => setFacultyForm({ ...facultyForm, code: e.target.value })} placeholder="FENG" /></Field>
            <Field label={t('name')} required><Input value={facultyForm.name} onChange={(e) => setFacultyForm({ ...facultyForm, name: e.target.value })} /></Field>
          </div>
        )}
      </Modal>

      <Modal open={!!enrolFor} onClose={() => setEnrolFor(null)} title={`${t('enrolments')}: ${enrolFor?.code ?? ''}`} wide>
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <div className="min-w-[240px] flex-1">
            <Field label={t('enrolStudent')}>
              <Select value={studentToAdd} onChange={(e) => setStudentToAdd(e.target.value)}>
                <option value="">-</option>
                {students.data?.filter((s) => !enrolledIds.has(s.id)).map((s) => <option key={s.id} value={s.id}>{s.studentId} · {s.fullName}</option>)}
              </Select>
            </Field>
          </div>
          <Button onClick={enrol} disabled={!studentToAdd} loading={busy}>{t('add')}</Button>
        </div>
        {enrolments.loading ? (
          <Loading />
        ) : (
          <Table>
            <thead>
              <tr><Th>{t('studentId')}</Th><Th>{t('name')}</Th><Th>{t('status')}</Th><Th>{t('date')}</Th><Th /></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {enrolments.data?.map((e) => (
                <tr key={e.id}>
                  <Td className="font-mono text-xs">{e.student.studentId}</Td>
                  <Td>{e.student.fullName}</Td>
                  <Td>{e.status === 'ACTIVE' ? <Badge tone="green">{t('active')}</Badge> : <Badge>{t('dropped')}</Badge>}</Td>
                  <Td className="text-gray-500">{fmtDate(e.status === 'DROPPED' ? e.droppedAt : e.enrolledAt, false)}</Td>
                  <Td>{e.status === 'ACTIVE' && <Button size="sm" variant="ghost" onClick={() => drop(e)}>{t('drop')}</Button>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Modal>
    </div>
  );
}
