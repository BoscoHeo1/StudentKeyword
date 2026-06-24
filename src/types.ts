export interface StudentSubmission {
  id: string;
  grade: string;         // 학년 (예: "3")
  classNumber: string;   // 반 (예: "2")
  studentNumber: string; // 번호 (예: "15")
  name: string;          // 이름
  keywords: string[];    // 선택한 5개 키워드
  timestamp: string;     // 제출 시각
  aiFeedback?: string;   // 아이에게 주는 따뜻한 격려 메시지
  reportCardDraft?: string; // 교사용 학교생활기록부(교과세특/행발) AI 초안 추천 문구
}

export interface SubmitResponse {
  success: boolean;
  submission: StudentSubmission;
}

export interface AnalyticsSummary {
  totalSubmissions: number;
  keywordCounts: Record<string, number>;
  domainCounts: Record<string, number>;
  submissionsByClass: Record<string, number>;
}
