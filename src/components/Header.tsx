import React, { useState, useEffect, useRef } from "react";
import { Shield, GraduationCap, LayoutDashboard } from "lucide-react";

interface HeaderProps {
  currentMode: "student" | "teacher";
  onChangeMode: (mode: "student" | "teacher") => void;
}

export default function Header({ currentMode, onChangeMode }: HeaderProps) {
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [classCodeInput, setClassCodeInput] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pendingClassCode, setPendingClassCode] = useState<string | null>(null);
  const [creationError, setCreationError] = useState("");
  const [creatingClass, setCreatingClass] = useState(false);
  const creatingRef = useRef(false);

  const [activeClassCode, setActiveClassCode] = useState<string | null>(null);

  const requestLogin = () => {
    localStorage.removeItem("teacher_class_code");
    setActiveClassCode(null);
    onChangeMode("student");
    setShowPasswordModal(true);
    setPendingClassCode(null);
    setCreationError("");
    setPassword("");
    setError("");
  };

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch("/api/classes/session", { credentials: "same-origin", cache: "no-store" });
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          if (cancelled) return;
          setActiveClassCode(data.classCode);
          localStorage.setItem("teacher_class_code", data.classCode);
        } else if (res.status === 401) {
          setActiveClassCode(null);
          localStorage.removeItem("teacher_class_code");
          if (currentMode === "teacher") requestLogin();
        }
      } catch { /* A network failure must not be treated as authenticated. */ }
    };
    check();
    const reauthenticate = () => requestLogin();
    window.addEventListener("teacher-session-expired", reauthenticate);
    return () => {
      cancelled = true;
      window.removeEventListener("teacher-session-expired", reauthenticate);
    };
  }, [currentMode]);

  const handleTeacherAccess = async () => {
    if (currentMode === "teacher") { onChangeMode("student"); return; }
    try {
      const res = await fetch("/api/classes/session", { credentials: "same-origin", cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setActiveClassCode(data.classCode);
        localStorage.setItem("teacher_class_code", data.classCode);
        onChangeMode("teacher");
      } else if (res.status === 401) {
        setClassCodeInput("");
        requestLogin();
      } else {
        alert("인증 정보를 확인할 수 없습니다. 잠시 후 다시 시도해주세요.");
      }
    } catch { alert("서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요."); }
  };

  const handleLogout = async () => {
    try {
      const res = await fetch("/api/classes/logout", { method: "POST", credentials: "same-origin" });
      if (!res.ok) throw new Error("Logout failed");
      localStorage.removeItem("teacher_class_code");
      setActiveClassCode(null);
      onChangeMode("student");
    } catch { alert("로그아웃을 완료하지 못했습니다. 다시 시도해주세요."); }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!classCodeInput.trim()) {
      setError("학급 코드를 입력해주세요.");
      return;
    }
    if (!password.trim()) {
      setError("비밀번호를 입력해주세요.");
      return;
    }

    try {
      const res = await fetch("/api/classes/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classCode: classCodeInput.trim().toLowerCase(),
          password: password.trim()
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        localStorage.setItem("teacher_class_code", data.classCode);
        setActiveClassCode(data.classCode);
        setPassword("");
        setShowPasswordModal(false);
        onChangeMode("teacher");
      } else if (res.status === 404 && data.code === "CLASS_NOT_FOUND") {
        setPendingClassCode(data.classCode || classCodeInput.trim().toLowerCase());
        setCreationError("");
        setShowPasswordModal(false);
      } else {
        setError(data.message || "비밀번호가 일치하지 않습니다.");
      }
    } catch (err) {
      console.error("Auth error", err);
      setError("서버와의 연결에 실패했습니다.");
    }
  };

  const handleCreateClass = async () => {
    if (!pendingClassCode || creatingRef.current) return;
    creatingRef.current = true;
    setCreatingClass(true);
    setCreationError("");
    try {
      const res = await fetch("/api/classes/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classCode: pendingClassCode, password: password.trim(), confirmCreate: true })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        localStorage.setItem("teacher_class_code", data.classCode);
        setActiveClassCode(data.classCode);
        setPassword("");
        setPendingClassCode(null);
        onChangeMode("teacher");
      } else if (res.status === 409 && data.code === "CLASS_ALREADY_EXISTS") {
        setPendingClassCode(null);
        setShowPasswordModal(true);
        setError(data.message);
      } else {
        setCreationError(data.message || "학급을 생성하지 못했습니다. 다시 시도해주세요.");
      }
    } catch {
      setCreationError("서버와의 연결에 실패했습니다.");
    } finally {
      creatingRef.current = false;
      setCreatingClass(false);
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
          <li className="text-slate-400 text-xs font-normal" id="nav-item-teacher-info">
            {activeClassCode ? (
              <span>학급: <strong className="text-indigo-600 font-bold uppercase">{activeClassCode}</strong></span>
            ) : (
              <span>지도교사용 모드</span>
            )}
          </li>
        </ul>

        {/* Action Button */}
        <div className="flex items-center space-x-2" id="header-actions">
          {currentMode === "teacher" && (
            <button
              onClick={handleLogout}
              className="px-3.5 py-2 bg-rose-50 text-rose-600 hover:bg-rose-100 border border-rose-200 rounded-xl text-xs font-bold transition-all shadow-sm"
              id="class-logout-button"
            >
              학급 로그아웃
            </button>
          )}
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
                <h3 className="text-lg font-bold text-gray-800" id="password-title">교사 수합대시보드 로그인</h3>
                <p className="text-xs text-gray-500 mt-1" id="password-desc">
                  선생님 고유의 학급 코드를 개설하거나 기존 대시보드로 로그인할 수 있습니다.
                </p>
                <p className="text-[10px] text-indigo-500 bg-indigo-50/50 px-2.5 py-1 rounded-lg mt-2 inline-block leading-relaxed" id="password-hint">
                  개설된 적 없는 학급 코드를 입력하시면<br/>
                  확인 후 입력하신 비밀번호로 <strong className="font-bold">신규 대시보드를 생성</strong>할 수 있습니다.
                </p>
              </div>

              <form onSubmit={handlePasswordSubmit} className="w-full space-y-3.5" id="password-form">
                <div className="space-y-1.5 text-left">
                  <label className="text-[11px] font-bold text-slate-500 ml-1">학급 코드 (선생님 고유 코드)</label>
                  <input
                    type="text"
                    placeholder="예) seoul301 (영문/숫자)"
                    value={classCodeInput}
                    onChange={(e) => setClassCodeInput(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-center text-base focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent uppercase font-semibold"
                    required
                    id="class-code-login-input"
                  />
                </div>

                <div className="space-y-1.5 text-left">
                  <label className="text-[11px] font-bold text-slate-500 ml-1">비밀번호</label>
                  <input
                    type="password"
                    placeholder="비밀번호를 입력해주세요"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setError("");
                    }}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-center text-base focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent tracking-widest font-mono"
                    required
                    id="password-input"
                  />
                </div>

                {error && (
                  <p className="text-xs text-rose-500 font-semibold animate-pulse" id="password-error">
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
                    접속하기
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {pendingClassCode && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50" id="create-class-modal-overlay">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-gray-100 text-center space-y-4" role="dialog" aria-modal="true" aria-labelledby="create-class-title">
            <h3 className="text-lg font-bold text-gray-800" id="create-class-title">새 학급으로 생성할까요?</h3>
            <p className="text-sm text-slate-600">
              <strong className="text-indigo-700 break-all">{pendingClassCode}</strong> 코드는 아직 등록되지 않았습니다.
              코드를 확인한 뒤 새 학급을 생성해주세요.
            </p>
            {creationError && <p className="text-xs text-rose-600 font-semibold" role="alert">{creationError}</p>}
            <div className="flex gap-2 pt-2">
              <button type="button" disabled={creatingClass} onClick={() => {
                setPendingClassCode(null);
                setCreationError("");
                setShowPasswordModal(true);
              }} className="flex-1 py-3 bg-gray-50 hover:bg-gray-100 text-gray-600 rounded-xl text-sm font-semibold disabled:opacity-50">
                코드 수정
              </button>
              <button type="button" disabled={creatingClass} onClick={handleCreateClass}
                className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold disabled:opacity-50">
                {creatingClass ? "생성 중..." : "새 학급 생성"}
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

