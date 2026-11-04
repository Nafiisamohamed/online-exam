/** Shapes of API responses used by several screens. */
export type QType = 'MCQ' | 'TRUE_FALSE' | 'SHORT_ANSWER' | 'ESSAY';
export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';
export type ExamStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'SCHEDULED' | 'REJECTED';

export interface StudentExam {
  id: string;
  title: string;
  instructions: string;
  course: { code: string; name: string };
  windowStart: string | null;
  windowEnd: string | null;
  durationMinutes: number;
  questionCount: number;
  windowState: 'NOT_OPEN' | 'OPEN' | 'CLOSED';
  attempt: { id: string; status: 'IN_PROGRESS' | 'SUBMITTED' | 'AUTO_SUBMITTED'; submittedAt: string | null } | null;
  resultsPublished: boolean;
}

export interface Course {
  id: string;
  code: string;
  name: string;
  semester: string;
  facultyId: string;
  lecturerId: string | null;
  faculty: { id: string; name: string; code: string };
  lecturer: { id: string; fullName: string } | null;
  _count: { enrolments: number; questions: number; exams: number };
}

export interface Question {
  id: string;
  rootId: string;
  version: number;
  courseId: string;
  type: QType;
  text: string;
  imageUrl: string | null;
  marks: number;
  topic: string;
  difficulty: Difficulty;
  acceptedAnswers: string[];
  rubric: { criterion: string; points: number }[] | null;
  options: { id: string; text: string; isCorrect: boolean; position: number }[];
  _count?: { attemptQuestions: number };
}

export interface Rule {
  difficulty: Difficulty;
  count: number;
  topics: string[];
}

export interface Feasibility {
  ok: boolean;
  shortages: { ruleIndex: number; difficulty: Difficulty; topics: string[]; required: number; available: number }[];
  overlapProblem?: { ruleIndexes: number[]; required: number; available: number };
}

export interface Exam {
  id: string;
  courseId: string;
  title: string;
  instructions: string;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  status: ExamStatus;
  windowStart: string | null;
  windowEnd: string | null;
  durationMinutes: number;
  allowedNetworks: string[];
  allowReview: boolean;
  resultsPublished: boolean;
  rejectionReason: string | null;
  secondGraderId: string | null;
  course: { id: string; code: string; name: string; lecturerId: string | null };
  rules: (Rule & { id: string })[];
  rooms: { room: { id: string; name: string; building: string } }[];
  invigilators: { user: { id: string; fullName: string } }[];
  secondGrader: { id: string; fullName: string } | null;
  _count: { attempts: number };
  feasibility?: Feasibility;
  bankSize?: number;
}

/** Badge colour for each exam status. */
export const STATUS_TONE: Record<ExamStatus, 'gray' | 'amber' | 'green' | 'red'> = { DRAFT: 'gray', PENDING_APPROVAL: 'amber', SCHEDULED: 'green', REJECTED: 'red' };
