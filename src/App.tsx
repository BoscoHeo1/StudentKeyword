/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import Header from "./components/Header";
import StudentSurvey from "./components/StudentSurvey";
import TeacherDashboard from "./components/TeacherDashboard";

export default function App() {
  const [mode, setMode] = useState<"student" | "teacher">("student");
  const [lastUpdated, setLastUpdated] = useState<number>(Date.now());

  // Triggered when student successfully submits a survey, to refresh teacher dashboard data
  const handleSurveySubmitted = () => {
    setLastUpdated(Date.now());
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#fff5f5] via-[#f3f6ff] to-[#fffdf0] text-slate-800 font-sans antialiased flex flex-col justify-between" id="app-root">
      <div>
        {/* Universal header for navigation toggling */}
        <Header currentMode={mode} onChangeMode={(m) => setMode(m)} />

        <main className="pb-16 flex-1" id="app-main">
          {mode === "student" ? (
            <div className="animate-fade-in" id="student-view">
              <StudentSurvey onSurveySubmitted={handleSurveySubmitted} />
            </div>
          ) : (
            <div className="animate-fade-in" id="teacher-view">
              <TeacherDashboard lastUpdated={lastUpdated} />
            </div>
          )}
        </main>
      </div>

      {/* Sub Footer / Bottom Rail */}
      <div className="h-12 bg-[#1e1c31] px-4 sm:px-8 flex items-center justify-between text-white/75 text-xs shrink-0" id="bottom-rail">
        <div className="flex gap-4 sm:gap-6">
          <span className="hover:text-pink-300 cursor-pointer transition">학생 참여 가이드</span>
          <span className="hover:text-pink-300 cursor-pointer transition">교사용 매뉴얼</span>
          <span className="hover:text-pink-300 cursor-pointer transition">개인정보 처리방침</span>
        </div>
        <div className="font-medium text-white/60">
          최근 동기화: <span className="text-pink-200 font-semibold">실시간 동기화 중</span>
        </div>
      </div>
    </div>
  );
}
