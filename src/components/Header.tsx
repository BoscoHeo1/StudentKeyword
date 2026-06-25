import React, { useState } from "react";
import { Shield, GraduationCap, LayoutDashboard } from "lucide-react";

interface HeaderProps {
  currentMode: "student" | "teacher";
  onChangeMode: (mode: "student" | "teacher") => void;
}

export default function Header({ currentMode, onChangeMode }: HeaderProps) {
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [serverPassword, setServerPassword] = useState("1234");

  React.useEffect(() => {
    if (showPasswordModal) {
      fetch("/api/config")
        .then(res => res.json())
        .then(data => {
          if (data && data.adminPassword) {
            setServerPassword(data.adminPassword);
          }
        })
        .catch(err => console.error("Failed to fetch password configuration", err));
    }
  }, [showPasswordModal]);

  const handleTeacherAccess = () => {
    if (currentMode === "teacher") {
      onChangeMode("student");
    } else {
      setShowPasswordModal(true);
      setError("");
      setPassword("");
    }
  };

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === serverPassword) {
      setShowPasswordModal(false);
      onChangeMode("teacher");
    } else {
      setError("비밀번호가 올바르지 않습니다.");
    }
  };

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-40" id="header-container">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between" id="header-inner">
        {/* Brand / Logo */}
        <div className="flex items-center space-x-3 cursor-pointer select-none" onClick={() => onChangeMode("student")} id="header-brand">
          <div className="w-10 h-10 bg-gradient-to-tr from-pink-400 via-rose-400 to-indigo-500 rounded-[14px] flex items-center justify-center text-white font-black text-xl shadow-md shadow-pink-100 animate-pulse" id="header-logo-container">
            🧸
          </div>
          <div>
            <h1 className="font-sans font-black text-base text-slate-800 tracking-tight leading-tight" id="header-title">
              키워드 <span className="text-transparent bg-clip-text bg-gradient-to-r from-pink-500 to-indigo-600 font-extrabold">열쇠고리</span>
            </h1>
            <p className="font-sans text-[10px] text-slate-400 font-semibold uppercase tracking-wider" id="header-subtitle">
              나의 빛나는 조각 찾기 ✨
            </p>
          </div>
        </div>

        {/* Navigation list from Geometric Balance HTML */}
        <ul className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-500 h-full" id="header-nav-list">
          {currentMode === "student" ? (
            <>
              <li className="text-indigo-600 border-b-2 border-indigo-600 h-full flex items-center px-1" id="nav-item-survey">키워드 설문</li>
              <li className="hover:text-indigo-600 cursor-pointer h-full flex items-center px-1 transition" onClick={handleTeacherAccess} id="nav-item-dashboard-link">수합 대시보드</li>
            </>
          ) : (
            <>
              <li className="hover:text-indigo-600 cursor-pointer h-full flex items-center px-1 transition" onClick={() => onChangeMode("student")} id="nav-item-survey-link">키워드 설문</li>
              <li className="text-indigo-600 border-b-2 border-indigo-600 h-full flex items-center px-1" id="nav-item-dashboard">수합 대시보드</li>
            </>
          )}
          <li className="text-slate-300 pointer-events-none" id="nav-divider">|</li>
          <li className="text-slate-400 text-xs font-normal" id="nav-item-teacher-info">지도교사용 모드</li>
        </ul>

        {/* Action Button */}
        <button
          onClick={handleTeacherAccess}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-300 shadow-sm ${
            currentMode === "teacher"
              ? "bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200"
          }`}
          id="mode-toggle-button"
        >
          {currentMode === "teacher" ? (
            <>
              <GraduationCap className="w-4 h-4" id="mode-icon-student" />
              <span>학생 화면으로 가기</span>
            </>
          ) : (
            <>
              <Shield className="w-4 h-4" id="mode-icon-teacher" />
              <span>선생님 관리자 모드</span>
            </>
          )}
        </button>
      </div>

      {/* Password modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in" id="password-modal-overlay">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-gray-100 transition-all transform scale-100" id="password-modal">
            <div className="flex flex-col items-center text-center space-y-4" id="password-modal-content">
              <div className="w-12 h-12 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600" id="password-icon-container">
                <LayoutDashboard className="w-6 h-6" id="password-icon" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-800" id="password-title">교사용 관리자 인증</h3>
                <p className="text-xs text-gray-500 mt-1" id="password-desc">
                  학생들이 제출한 설문 수합 결과를 확인하기 위해 선생님 인증 비밀번호를 입력해주세요.
                </p>
                <p className="text-[11px] text-indigo-500 bg-indigo-50/50 px-2 py-0.5 rounded mt-2 inline-block" id="password-hint">
                  {serverPassword === "1234" ? (
                    <>기본 비밀번호: <strong className="font-bold">1234</strong></>
                  ) : (
                    <span>설정하신 전용 비밀번호를 입력해주세요.</span>
                  )}
                </p>
              </div>

              <form onSubmit={handlePasswordSubmit} className="w-full space-y-3" id="password-form">
                <input
                  type="password"
                  placeholder="비밀번호 입력"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError("");
                  }}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-center text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent tracking-widest font-mono"
                  autoFocus
                  id="password-input"
                />
                {error && (
                  <p className="text-xs text-red-500 font-medium animate-pulse" id="password-error">
                    {error}
                  </p>
                )}
                <div className="flex space-x-2 pt-2" id="password-buttons">
                  <button
                    type="button"
                    onClick={() => setShowPasswordModal(false)}
                    className="flex-1 py-3 bg-gray-50 hover:bg-gray-100 text-gray-600 rounded-xl text-sm font-semibold transition"
                    id="password-cancel"
                  >
                    취소
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold shadow-md shadow-indigo-100 transition"
                    id="password-confirm"
                  >
                    확인
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
