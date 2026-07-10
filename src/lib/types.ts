// 공용 도메인 타입

export type SubmissionStatus =
  | "submitted"
  | "evaluating"
  | "evaluated"
  | "error";

export interface Teacher {
  id: string;
  name: string;
  email: string;
  created_at: string;
}

export interface Class {
  id: string;
  teacher_id: string;
  name: string;
  class_code: string;
  created_at: string;
}

export interface Student {
  id: string;
  class_id: string;
  name: string;
  number: number;
  pin_hash: string | null;
  created_at: string;
}

export interface Assignment {
  id: string;
  class_id: string;
  title: string;
  passage_text: string;
  sample_audio_url: string | null;
  due_date: string | null;
  max_attempts: number;
  created_at: string;
}

// Azure Pronunciation Assessment 요약 점수 (0~100)
export interface AzureScores {
  accuracy: number; // 정확도
  fluency: number; // 유창성
  completeness: number; // 완성도
  prosody?: number; // 억양/운율
  pronunciation: number; // 종합 발음 점수
  words?: Array<{
    word: string;
    accuracy: number;
    errorType?: string; // None | Mispronunciation | Omission | Insertion
  }>;
  recognizedText?: string;
}

export interface Submission {
  id: string;
  assignment_id: string;
  student_id: string;
  audio_path: string;
  attempt_count: number;
  status: SubmissionStatus;
  azure_scores: AzureScores | null;
  overall_score: number | null;
  student_feedback: string | null;
  teacher_feedback: string | null;
  teacher_reviewed: boolean;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

// 학생 세션 (반코드 로그인 후 서명 쿠키에 담기는 페이로드)
export interface StudentSession {
  studentId: string;
  classId: string;
  name: string;
  number: number;
}
