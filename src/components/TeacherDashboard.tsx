import React, { useState, useEffect, useMemo } from "react";
import { StudentSubmission, AnalyticsSummary } from "../types";
import { DOMAINS } from "../data/keywords";
import { 
  Users, BarChart2, PieChart, Download, 
  Trash2, RefreshCw, Search, Check, 
  Copy, ArrowUpDown, ChevronDown, HelpCircle, 
  Sparkles, SlidersHorizontal, BookOpen,
  Eye, Settings, X, Key, Star, Calendar, Printer
} from "lucide-react";

interface TeacherDashboardProps {
  lastUpdated: number;
}

export default function TeacherDashboard({ lastUpdated }: TeacherDashboardProps) {
  const [submissions, setSubmissions] = useState<StudentSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Active student for detailed keyring modal
  const [activeStudent, setActiveStudent] = useState<StudentSubmission | null>(null);

  // Password Settings modal states
  const [showPasswordSettings, setShowPasswordSettings] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [passwordChangeSuccess, setPasswordChangeSuccess] = useState(false);
  const [passwordChangeError, setPasswordChangeError] = useState("");

  // Gemini API Key state (saved only inside local teacher browser)
  const [localApiKey, setLocalApiKey] = useState<string>(() => localStorage.getItem("gemini_api_key") || "");
  const [newApiKeyInput, setNewApiKeyInput] = useState<string>("");

  // Filter / Search states
  const [searchName, setSearchName] = useState("");
  const [filterClass, setFilterClass] = useState("all");
  const [filterDomainKeyword, setFilterDomainKeyword] = useState("all");

  // Sorting state
  const [sortBy, setSortBy] = useState<'name' | 'class' | 'time'>('time');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Copy clip state
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedDraftId, setCopiedDraftId] = useState<string | null>(null);

  // Regeneration states
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);

  // Confirmation state for global clear
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  // Load submissions on mount and when refresh is triggered
  useEffect(() => {
    const fetchSubmissions = async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/submissions");
        if (res.ok) {
          const data = await res.json();
          setSubmissions(data);
          
          // Update active student modal data reactively if open
          if (activeStudent) {
            const updated = data.find((s: StudentSubmission) => s.id === activeStudent.id);
            if (updated) {
              setActiveStudent(updated);
            }
          }
        }
      } catch (e) {
        console.error("Failed to load submissions", e);
      } finally {
        setLoading(false);
      }
    };

    fetchSubmissions();
  }, [refreshTrigger, lastUpdated]);

  // Unique list of classes in current submissions
  const availableClasses = useMemo(() => {
    const classes = new Set<string>();
    submissions.forEach(s => {
      if (s.grade && s.classNumber) {
        classes.add(`${s.grade}학년 ${s.classNumber}반`);
      }
    });
    return Array.from(classes).sort();
  }, [submissions]);

  // Sort and filter submissions list
  const filteredSubmissions = useMemo(() => {
    let result = [...submissions];

    // Search by Name or single keyword
    if (searchName.trim()) {
      const q = searchName.toLowerCase().trim();
      result = result.filter(s => 
        s.name.toLowerCase().includes(q) || 
        s.keywords.some(k => k.toLowerCase().includes(q)) ||
        s.studentNumber.includes(q)
      );
    }

    // Filter by Class
    if (filterClass !== "all") {
      result = result.filter(s => `${s.grade}학년 ${s.classNumber}반` === filterClass);
    }

    // Filter by specific Domain
    if (filterDomainKeyword !== "all") {
      result = result.filter(s => {
        // Find which domain these keywords belong to
        return s.keywords.some(kw => {
          const dom = DOMAINS.find(d => d.id === filterDomainKeyword);
          return dom?.subCategories.some(sub => sub.keywords.some(k => k.text === kw));
        });
      });
    }

    // Apply Sorting
    result.sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'name') {
        comparison = a.name.localeCompare(b.name, 'ko-KR');
      } else if (sortBy === 'class') {
        const aClass = `${a.grade}-${a.classNumber.padStart(2, '0')}-${a.studentNumber.padStart(2, '0')}`;
        const bClass = `${b.grade}-${b.classNumber.padStart(2, '0')}-${b.studentNumber.padStart(2, '0')}`;
        comparison = aClass.localeCompare(bClass);
      } else {
        // time
        comparison = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [submissions, searchName, filterClass, filterDomainKeyword, sortBy, sortOrder]);

  // 1. Keyword Counts (Top Selected Keywords)
  const keywordStats = useMemo(() => {
    const counts: Record<string, { count: number; domainId: string }> = {};
    submissions.forEach(s => {
      s.keywords.forEach(kw => {
        // Find domain for this keyword
        let foundDomain = "기타";
        for (const d of DOMAINS) {
          if (d.subCategories.some(sub => sub.keywords.some(k => k.text === kw))) {
            foundDomain = d.id;
            break;
          }
        }

        if (!counts[kw]) {
          counts[kw] = { count: 0, domainId: foundDomain };
        }
        counts[kw].count++;
      });
    });

    return Object.entries(counts)
      .map(([keyword, data]) => ({ keyword, count: data.count, domainId: data.domainId }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10); // Top 10
  }, [submissions]);

  // 2. Domain selection distribution stats
  const domainStats = useMemo(() => {
    const counts = { '생활': 0, '인성': 0, '학습': 0 };
    submissions.forEach(s => {
      s.keywords.forEach(kw => {
        for (const d of DOMAINS) {
          if (d.subCategories.some(sub => sub.keywords.some(k => k.text === kw))) {
            counts[d.id]++;
            break;
          }
        }
      });
    });

    const total = counts['생활'] + counts['인성'] + counts['학습'];
    return {
      '생활': { count: counts['생활'], percentage: total > 0 ? Math.round((counts['생활'] / total) * 100) : 0 },
      '인성': { count: counts['인성'], percentage: total > 0 ? Math.round((counts['인성'] / total) * 100) : 0 },
      '학습': { count: counts['학습'], percentage: total > 0 ? Math.round((counts['학습'] / total) * 100) : 0 },
      total
    };
  }, [submissions]);

  const handleSort = (field: 'name' | 'class' | 'time') => {
    if (sortBy === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  const handleCopyText = (text: string, id: string, type: 'feedback' | 'draft') => {
    navigator.clipboard.writeText(text);
    if (type === 'feedback') {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } else {
      setCopiedDraftId(id);
      setTimeout(() => setCopiedDraftId(null), 2000);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("정말 이 학생의 설문 제출을 삭제하시겠습니까?")) return;
    try {
      const res = await fetch(`/api/submissions/${id}`, { method: "DELETE" });
      if (res.ok) {
        setRefreshTrigger(prev => prev + 1);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleRegenerateAI = async (id: string) => {
    if (!localApiKey) {
      alert("선생님의 개인 Gemini API 키가 설정되어 있지 않습니다.\n우측 상단의 '비밀번호 및 API 설정'에서 본인의 API 키를 입력해주시면 AI 추천문구를 실시간으로 생성할 수 있습니다.");
      setNewApiKeyInput("");
      setShowPasswordSettings(true);
      return;
    }
    setRegeneratingId(id);
    try {
      const res = await fetch(`/api/submissions/${id}/regenerate-ai`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-gemini-api-key": localApiKey
        }
      });
      if (res.ok) {
        setRefreshTrigger(prev => prev + 1);
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.message || "AI 문구 재생성에 실패했습니다. 입력하신 API 키가 올바른지 확인해주세요.");
      }
    } catch (e) {
      console.error(e);
      alert("네트워크 오류가 발생했습니다.");
    } finally {
      setRegeneratingId(null);
    }
  };

  const handleClearAll = async () => {
    if (confirmText !== "삭제") {
      alert("'삭제'라고 입력해야 전체 초기화가 가능합니다.");
      return;
    }
    try {
      const res = await fetch("/api/submissions/reset", { method: "POST" });
      if (res.ok) {
        setSubmissions([]);
        setShowClearConfirm(false);
        setConfirmText("");
        setRefreshTrigger(prev => prev + 1);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // CSV Downloader with correct UTF-8 BOM
  const downloadCSV = () => {
    if (submissions.length === 0) {
      alert("다운로드할 데이터가 없습니다.");
      return;
    }

    // Build header row
    const headers = ["학년", "반", "번호", "이름", "키워드1", "키워드2", "키워드3", "키워드4", "키워드5", "격려 피드백 문구", "생활기록부 추천초안"];
    
    // Build rows
    const rows = submissions.map(s => [
      s.grade,
      s.classNumber,
      s.studentNumber,
      s.name,
      s.keywords[0] || "",
      s.keywords[1] || "",
      s.keywords[2] || "",
      s.keywords[3] || "",
      s.keywords[4] || "",
      s.aiFeedback || "",
      s.reportCardDraft || ""
    ]);

    const csvContent = [headers, ...rows]
      .map(e => e.map(val => `"${val.replace(/"/g, '""')}"`).join(","))
      .join("\n");

    // Add UTF-8 BOM so Excel opens it with correct Korean letters
    const blob = new Blob([new Uint8Array([0xef, 0xbb, 0xbf]), csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `설문수합결과_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Settings Change handler (Password & Gemini API Key)
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordChangeError("");
    setPasswordChangeSuccess(false);

    // 1. If password is typed, update it on the server
    if (newPassword.trim()) {
      try {
        const res = await fetch("/api/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ adminPassword: newPassword.trim() })
        });

        if (!res.ok) {
          const errData = await res.json();
          setPasswordChangeError(errData.message || "비밀번호 변경에 실패했습니다.");
          return;
        }
      } catch (err) {
        console.error("Failed to change password", err);
        setPasswordChangeError("서버와 연결할 수 없어 비밀번호를 변경하지 못했습니다.");
        return;
      }
    }

    // 2. Always update local Gemini API Key in localStorage
    const cleanedKey = newApiKeyInput.trim();
    localStorage.setItem("gemini_api_key", cleanedKey);
    setLocalApiKey(cleanedKey);

    setPasswordChangeSuccess(true);
    setTimeout(() => setShowPasswordSettings(false), 1500);
  };

  return (
    <div className="py-8 px-4 max-w-7xl mx-auto space-y-8" id="teacher-dashboard-container">
      {/* Overview stats cards */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4" id="dashboard-header-panel">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-800 tracking-tight" id="dashboard-title">
            설문 수합 & 분석 대시보드 📊
          </h2>
          <p className="text-sm text-slate-500" id="dashboard-subtitle">
            우리 아이들이 스스로 탐색한 소중한 열쇠고리 키워드가 실시간으로 수합되고 있습니다.
          </p>
        </div>

        {/* Dashboard top action bar */}
        <div className="flex flex-wrap items-center gap-2" id="dashboard-top-actions">
          <button
            onClick={() => setRefreshTrigger(prev => prev + 1)}
            className="p-3 bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 rounded-xl flex items-center justify-center transition shadow-sm"
            title="새로고침"
            id="refresh-data-button"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} id="refresh-icon" />
          </button>
          
          {localApiKey ? (
            <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-150 px-3 py-2.5 rounded-xl flex items-center gap-1.5 shadow-sm" id="api-status-connected">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Gemini AI 연동됨</span>
            </span>
          ) : (
            <span className="text-xs font-bold text-slate-500 bg-slate-50 border border-slate-200 px-3 py-2.5 rounded-xl flex items-center gap-1.5 shadow-sm" id="api-status-disconnected">
              <span className="w-2 h-2 rounded-full bg-slate-300" />
              <span>기본 피드백 (API 미연동)</span>
            </span>
          )}
          
          <button
            onClick={() => {
              setShowPasswordSettings(true);
              setNewPassword("");
              setNewApiKeyInput(localApiKey);
              setPasswordChangeSuccess(false);
              setPasswordChangeError("");
            }}
            className="px-4 py-3 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-xl text-sm font-bold flex items-center space-x-2 shadow-sm transition"
            id="change-password-button"
          >
            <Settings className="w-4 h-4 text-slate-500" id="settings-icon" />
            <span>설정 및 API 관리</span>
          </button>

          <button
            onClick={downloadCSV}
            className="px-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold flex items-center space-x-2 shadow-sm transition"
            id="export-csv-button"
          >
            <Download className="w-4 h-4" id="download-icon" />
            <span>엑셀(CSV) 다운로드</span>
          </button>

          <button
            onClick={() => setShowClearConfirm(true)}
            className="px-4 py-3 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl text-sm font-semibold transition flex items-center space-x-1.5"
            id="clear-all-trigger-btn"
          >
            <Trash2 className="w-4 h-4" id="trash-icon" />
            <span>설문 전체 비우기</span>
          </button>
        </div>
      </div>

      {/* Grid of stats summary metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6" id="summary-metrics-grid">
        {/* Metric 1 */}
        <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm flex items-center space-x-4" id="metric-sub-total">
          <div className="w-12 h-12 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600" id="metric-icon-1-box">
            <Users className="w-6 h-6" id="metric-icon-1" />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest" id="metric-label-1">총 참여 학생수</p>
            <h4 className="text-2xl font-bold text-slate-800" id="metric-value-1">{submissions.length}명</h4>
          </div>
        </div>

        {/* Metric 2 */}
        <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm flex items-center space-x-4" id="metric-life">
          <div className="w-12 h-12 rounded-lg bg-amber-50 flex items-center justify-center text-amber-600 font-bold text-lg" id="metric-icon-2-box">
            🌟
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest" id="metric-label-2">생활영역 선택수</p>
            <h4 className="text-2xl font-bold text-slate-800" id="metric-value-2">{domainStats['생활'].count}회</h4>
          </div>
        </div>

        {/* Metric 3 */}
        <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm flex items-center space-x-4" id="metric-char">
          <div className="w-12 h-12 rounded-lg bg-teal-50 flex items-center justify-center text-teal-600 font-bold text-lg" id="metric-icon-3-box">
            ❤️
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest" id="metric-label-3">인성영역 선택수</p>
            <h4 className="text-2xl font-bold text-slate-800" id="metric-value-3">{domainStats['인성'].count}회</h4>
          </div>
        </div>

        {/* Metric 4 */}
        <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm flex items-center space-x-4" id="metric-learn">
          <div className="w-12 h-12 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600 font-bold text-lg" id="metric-icon-4-box">
            📚
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest" id="metric-label-4">학습영역 선택수</p>
            <h4 className="text-2xl font-bold text-slate-800" id="metric-value-4">{domainStats['학습'].count}회</h4>
          </div>
        </div>
      </div>

      {/* Visual Analytics Charts Section (Custom SVG and HTML components for flawless loading) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8" id="visual-charts-section">
        
        {/* Left chart: Bar chart of top keywords */}
        <div className="lg:col-span-8 bg-white rounded-xl p-6 border border-slate-200 shadow-sm space-y-6" id="top-keywords-chart-card">
          <div className="flex items-center space-x-2 border-b border-slate-200 pb-3" id="top-keywords-chart-header">
            <BarChart2 className="w-5 h-5 text-indigo-600" id="keywords-chart-icon" />
            <h3 className="text-base font-bold text-slate-800" id="keywords-chart-title">가장 많이 선택된 인기 키워드 (Top 10)</h3>
          </div>

          {submissions.length === 0 ? (
            <div className="py-20 text-center text-gray-400 font-medium" id="keywords-chart-empty">
              수합 완료된 설문이 없습니다.
            </div>
          ) : (
            <div className="space-y-4" id="custom-bar-chart-container">
              {keywordStats.map((stat, idx) => {
                // Determine bar color based on domain
                let barBg = "bg-indigo-500";
                let domainBadge = "학습";
                if (stat.domainId === '생활') {
                  barBg = "bg-amber-400";
                  domainBadge = "생활";
                } else if (stat.domainId === '인성') {
                  barBg = "bg-teal-400";
                  domainBadge = "인성";
                }

                const maxCount = keywordStats[0]?.count || 1;
                const widthPercent = Math.max((stat.count / maxCount) * 100, 4);

                return (
                  <div key={stat.keyword} className="flex items-center space-x-3 text-sm" id={`bar-item-${idx}`}>
                    {/* Rank */}
                    <span className="w-5 font-mono font-bold text-gray-400 text-right" id={`bar-rank-${idx}`}>
                      {idx + 1}
                    </span>
                    {/* Tag keyword */}
                    <span className="w-24 font-bold text-gray-700 truncate" id={`bar-keyword-${idx}`}>
                      #{stat.keyword}
                    </span>
                    {/* Domain label */}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-extrabold ${
                      domainBadge === '생활' ? "bg-amber-50 text-amber-700" : domainBadge === '인성' ? "bg-teal-50 text-teal-700" : "bg-indigo-50 text-indigo-700"
                    }`} id={`bar-domain-label-${idx}`}>
                      {domainBadge}
                    </span>
                    {/* Simulated Bar */}
                    <div className="flex-1 bg-gray-50 rounded-lg h-7 overflow-hidden relative flex items-center px-2" id={`bar-track-${idx}`}>
                      <div 
                        className={`absolute left-0 top-0 bottom-0 ${barBg} rounded-r-lg opacity-80 transition-all duration-500`}
                        style={{ width: `${widthPercent}%` }}
                        id={`bar-fill-${idx}`}
                      />
                      <span className="relative font-bold text-xs text-gray-700 z-10" id={`bar-count-label-${idx}`}>
                        {stat.count}회
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right chart: Domain pie / progress distribution card */}
        <div className="lg:col-span-4 bg-white rounded-xl p-6 border border-slate-200 shadow-sm space-y-6" id="domain-distribution-chart-card">
          <div className="flex items-center space-x-2 border-b border-slate-200 pb-3" id="domain-chart-header">
            <PieChart className="w-5 h-5 text-indigo-600" id="domain-chart-icon" />
            <h3 className="text-base font-bold text-slate-800" id="domain-chart-title">영역별 가중치 분포</h3>
          </div>

          {submissions.length === 0 ? (
            <div className="py-20 text-center text-gray-400 font-medium" id="domain-chart-empty">
              분석 가능한 데이터가 없습니다.
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center space-y-6 py-4" id="domain-chart-content">
              {/* Custom SVG Donut / Pie representing three domains */}
              <div className="relative w-36 h-36" id="donut-svg-wrapper">
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100" id="donut-svg">
                  {/* Outer circle track */}
                  <circle cx="50" cy="50" r="40" fill="transparent" stroke="#f1f5f9" strokeWidth="12" id="donut-track" />
                  
                  {/* Segment 1: 생활 (Amber) */}
                  <circle 
                    cx="50" 
                    cy="50" 
                    r="40" 
                    fill="transparent" 
                    stroke="#f59e0b" 
                    strokeWidth="12" 
                    strokeDasharray={`${(domainStats['생활'].percentage / 100) * 251.2} 251.2`}
                    id="donut-segment-life"
                  />
                  
                  {/* Segment 2: 인성 (Teal) */}
                  <circle 
                    cx="50" 
                    cy="50" 
                    r="40" 
                    fill="transparent" 
                    stroke="#14b8a6" 
                    strokeWidth="12" 
                    strokeDasharray={`${(domainStats['인성'].percentage / 100) * 251.2} 251.2`}
                    strokeDashoffset={`-${(domainStats['생활'].percentage / 100) * 251.2}`}
                    id="donut-segment-char"
                  />

                  {/* Segment 3: 학습 (Indigo) */}
                  <circle 
                    cx="50" 
                    cy="50" 
                    r="40" 
                    fill="transparent" 
                    stroke="#6366f1" 
                    strokeWidth="12" 
                    strokeDasharray={`${(domainStats['학습'].percentage / 100) * 251.2} 251.2`}
                    strokeDashoffset={`-${((domainStats['생활'].percentage + domainStats['인성'].percentage) / 100) * 251.2}`}
                    id="donut-segment-learn"
                  />
                </svg>
                {/* Donut center label */}
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-white rounded-full m-[22px] shadow-inner" id="donut-center-label">
                  <span className="text-[10px] text-gray-400 font-extrabold uppercase tracking-wider" id="donut-center-title">전체 선택</span>
                  <span className="text-xl font-extrabold text-gray-800" id="donut-center-value">{domainStats.total}회</span>
                </div>
              </div>

              {/* Legend with percentages */}
              <div className="w-full space-y-3" id="donut-legend">
                {/* 생활 legend */}
                <div className="flex items-center justify-between p-2 rounded-xl bg-amber-50/50 border border-amber-100 text-xs" id="legend-item-life">
                  <div className="flex items-center space-x-2" id="legend-item-life-label">
                    <span className="w-3 h-3 rounded-full bg-amber-500" />
                    <span className="font-bold text-amber-800">생활 (Life)</span>
                  </div>
                  <span className="font-mono font-bold text-amber-800">{domainStats['생활'].percentage}% ({domainStats['생활'].count}회)</span>
                </div>

                {/* 인성 legend */}
                <div className="flex items-center justify-between p-2 rounded-xl bg-teal-50/50 border border-teal-100 text-xs" id="legend-item-char">
                  <div className="flex items-center space-x-2" id="legend-item-char-label">
                    <span className="w-3 h-3 rounded-full bg-teal-500" />
                    <span className="font-bold text-teal-800">인성 (Character)</span>
                  </div>
                  <span className="font-mono font-bold text-teal-800">{domainStats['인성'].percentage}% ({domainStats['인성'].count}회)</span>
                </div>

                {/* 학습 legend */}
                <div className="flex items-center justify-between p-2 rounded-xl bg-indigo-50/50 border border-indigo-100 text-xs" id="legend-item-learn">
                  <div className="flex items-center space-x-2" id="legend-item-learn-label">
                    <span className="w-3 h-3 rounded-full bg-indigo-500" />
                    <span className="font-bold text-indigo-800">학습 (Learning)</span>
                  </div>
                  <span className="font-mono font-bold text-indigo-800">{domainStats['학습'].percentage}% ({domainStats['학습'].count}회)</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* FILTER PANEL AND MAIN SUBMISSIONS LIST TABLE */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden space-y-6 p-6" id="submissions-list-card">
        
        {/* Table title bar */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-200 pb-4" id="table-title-panel">
          <div className="flex items-center space-x-2" id="table-title-box">
            <BookOpen className="w-5 h-5 text-indigo-600" id="table-title-icon" />
            <h3 className="text-base font-bold text-slate-800" id="table-title-h3">학생별 수합 결과 일람표</h3>
            <span className="bg-slate-100 text-slate-600 text-xs px-2.5 py-0.5 rounded-full font-bold" id="table-filtered-count">
              검색결과: {filteredSubmissions.length}명 / 전체 {submissions.length}명
            </span>
          </div>
        </div>

        {/* Filter controls row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" id="filters-controls-grid">
          {/* Filter 1: Search Name/Keyword */}
          <div className="relative" id="filter-search-box-wrapper">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" id="filter-search-icon" />
            <input
              type="text"
              placeholder="학생 이름 또는 키워드로 찾기..."
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white text-slate-700"
              id="filter-search-input"
            />
          </div>

          {/* Filter 2: Class filter */}
          <div className="flex items-center space-x-2" id="filter-class-wrapper">
            <SlidersHorizontal className="w-4 h-4 text-slate-400 flex-shrink-0" id="filter-class-icon" />
            <select
              value={filterClass}
              onChange={(e) => setFilterClass(e.target.value)}
              className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white text-slate-700 font-medium"
              id="filter-class-select"
            >
              <option value="all">모든 학급 보기</option>
              {availableClasses.map(cls => (
                <option key={cls} value={cls}>{cls}</option>
              ))}
            </select>
          </div>

          {/* Filter 3: Domain filter */}
          <div className="flex items-center space-x-2" id="filter-domain-wrapper">
            <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" id="filter-domain-icon" />
            <select
              value={filterDomainKeyword}
              onChange={(e) => setFilterDomainKeyword(e.target.value)}
              className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white text-slate-700 font-medium"
              id="filter-domain-select"
            >
              <option value="all">모든 영역 키워드 포함</option>
              <option value="생활">생활 영역 키워드가 포함된 학생</option>
              <option value="인성">인성 영역 키워드가 포함된 학생</option>
              <option value="학습">학습 영역 키워드가 포함된 학생</option>
            </select>
          </div>
        </div>

        {/* Table viewport */}
        {loading ? (
          <div className="py-20 text-center" id="table-loading-container">
            <RefreshCw className="w-8 h-8 animate-spin text-indigo-500 mx-auto mb-3" id="table-loading-spinner" />
            <p className="text-gray-400 font-bold" id="table-loading-text">데이터를 불러오는 중입니다...</p>
          </div>
        ) : filteredSubmissions.length === 0 ? (
          <div className="py-20 border border-dashed border-gray-100 rounded-2xl text-center text-gray-400 font-semibold" id="table-empty-container">
            조건에 부합하는 수합 결과가 존재하지 않습니다.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200" id="table-scroll-viewport">
            <table className="min-w-full divide-y divide-slate-200 text-sm text-left" id="submissions-table">
              <thead className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider text-xs" id="table-thead">
                <tr id="table-header-row">
                  <th scope="col" className="px-4 py-3.5 cursor-pointer hover:bg-slate-100 hover:text-slate-700 transition" onClick={() => handleSort('class')} id="th-class">
                    <div className="flex items-center space-x-1" id="th-class-inner">
                      <span>학급/번호</span>
                      <ArrowUpDown className="w-3 h-3" id="th-class-arrow" />
                    </div>
                  </th>
                  <th scope="col" className="px-4 py-3.5 cursor-pointer hover:bg-slate-100 hover:text-slate-700 transition" onClick={() => handleSort('name')} id="th-name">
                    <div className="flex items-center space-x-1" id="th-name-inner">
                      <span>이름</span>
                      <ArrowUpDown className="w-3 h-3" id="th-name-arrow" />
                    </div>
                  </th>
                  <th scope="col" className="px-4 py-3.5" id="th-keywords">선택한 5대 키워드</th>
                  <th scope="col" className="px-4 py-3.5 text-indigo-600 font-bold flex items-center space-x-1" id="th-ai-draft">
                    <Sparkles className="w-3.5 h-3.5 fill-indigo-100 text-indigo-600" id="ai-draft-icon" />
                    <span>AI 생기부 추천 초안 문구 (교과세특/행발용)</span>
                  </th>
                  <th scope="col" className="px-4 py-3.5 text-right" id="th-actions">관리</th>
                </tr>
              </thead>
              
              <tbody className="divide-y divide-slate-200 bg-white" id="table-tbody">
                {filteredSubmissions.map((student) => (
                  <tr key={student.id} className="hover:bg-slate-50/50 transition-all duration-150" id={`student-row-${student.id}`}>
                    {/* Class & Number */}
                    <td className="px-4 py-4 whitespace-nowrap font-mono font-semibold text-gray-500" id={`student-cell-class-${student.id}`}>
                      {student.grade}학년 {student.classNumber}반 {student.studentNumber}번
                    </td>
                    
                    {/* Name */}
                    <td className="px-4 py-4 whitespace-nowrap font-extrabold text-gray-800" id={`student-cell-name-${student.id}`}>
                      {student.name}
                    </td>
                    
                    {/* Selected 5 keywords */}
                    <td className="px-4 py-4" id={`student-cell-keywords-${student.id}`}>
                      <div className="flex flex-wrap gap-1 max-w-[280px]" id={`student-keywords-container-${student.id}`}>
                        {student.keywords.map((kw, idx) => {
                          // Try to identify color domain dynamically
                          let themeClasses = "bg-gray-100 text-gray-700 border-gray-200";
                          for (const d of DOMAINS) {
                            if (d.subCategories.some(sub => sub.keywords.some(k => k.text === kw))) {
                              if (d.id === '생활') themeClasses = "bg-amber-50 text-amber-800 border-amber-100";
                              else if (d.id === '인성') themeClasses = "bg-teal-50 text-teal-800 border-teal-100";
                              else if (d.id === '학습') themeClasses = "bg-indigo-50 text-indigo-800 border-indigo-100";
                              break;
                            }
                          }

                          return (
                            <span 
                              key={idx} 
                              className={`text-[11px] font-extrabold px-2 py-0.5 rounded-lg border ${themeClasses}`}
                              id={`kw-badge-${student.id}-${idx}`}
                            >
                              #{kw}
                            </span>
                          );
                        })}
                      </div>
                    </td>

                    {/* AI drafted School Report description */}
                    <td className="px-4 py-4" id={`student-cell-ai-draft-${student.id}`}>
                      <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl space-y-2 max-w-lg" id={`ai-draft-box-${student.id}`}>
                        <p className="text-xs text-gray-600 leading-relaxed font-medium" id={`ai-draft-text-${student.id}`}>
                          {student.reportCardDraft || "추천 초안 생성이 필요합니다."}
                        </p>
                        
                        <div className="flex items-center justify-between pt-1" id={`ai-draft-controls-${student.id}`}>
                          {/* Copy copy buttons */}
                          <div className="flex space-x-2" id={`copy-buttons-row-${student.id}`}>
                            <button
                              onClick={() => handleCopyText(student.reportCardDraft || "", student.id, 'draft')}
                              className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center space-x-1.5 transition"
                              title="생기부 추천문구 복사하기"
                              id={`copy-draft-btn-${student.id}`}
                            >
                              {copiedDraftId === student.id ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-green-500" id={`copy-draft-check-icon-${student.id}`} />
                                  <span className="text-green-600">복사 완료!</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5" id={`copy-draft-icon-${student.id}`} />
                                  <span>생기부용 복사</span>
                                </>
                              )}
                            </button>

                            <button
                              onClick={() => handleCopyText(student.aiFeedback || "", student.id, 'feedback')}
                              className="text-[11px] font-bold text-gray-500 hover:text-gray-700 flex items-center space-x-1.5 transition"
                              title="학생 격려피드백 문구 복사하기"
                              id={`copy-feedback-btn-${student.id}`}
                            >
                              {copiedId === student.id ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-green-500" id={`copy-feedback-check-icon-${student.id}`} />
                                  <span className="text-green-600">복사 완료!</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5" id={`copy-feedback-icon-${student.id}`} />
                                  <span>격려 피드백 복사</span>
                                </>
                              )}
                            </button>
                          </div>

                          {/* Regenerate AI */}
                          <button
                            onClick={() => handleRegenerateAI(student.id)}
                            disabled={regeneratingId === student.id}
                            className="text-[10px] font-bold text-slate-400 hover:text-slate-600 flex items-center space-x-1 transition disabled:opacity-50"
                            id={`regen-ai-btn-${student.id}`}
                          >
                            <RefreshCw className={`w-3 h-3 ${regeneratingId === student.id ? "animate-spin" : ""}`} id={`regen-ai-icon-${student.id}`} />
                            <span>AI 재생성</span>
                          </button>
                        </div>
                      </div>
                    </td>

                    {/* Individual Actions */}
                    <td className="px-4 py-4 text-right whitespace-nowrap space-x-1" id={`student-cell-actions-${student.id}`}>
                      <button
                        onClick={() => setActiveStudent(student)}
                        className="p-2 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-lg transition inline-flex items-center gap-1 text-xs font-bold"
                        title="아이별 선택 상세 보기"
                        id={`detail-btn-${student.id}`}
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>상세보기</span>
                      </button>
                      <button
                        onClick={() => handleDelete(student.id)}
                        className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition inline-flex items-center"
                        title="이 데이터 삭제"
                        id={`delete-btn-${student.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" id={`delete-icon-${student.id}`} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Global Clear Confirmation Modal Dialog */}
      {showClearConfirm && (
         <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in" id="clear-modal-overlay">
          <div className="bg-white rounded-xl max-w-sm w-full p-6 shadow-md border border-slate-200" id="clear-modal">
            <div className="text-center space-y-4" id="clear-modal-content">
              <div className="w-12 h-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center mx-auto" id="clear-modal-icon-box">
                <Trash2 className="w-6 h-6" id="clear-modal-icon" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-800" id="clear-modal-title">수합 결과 전체 비우기</h3>
                <p className="text-xs text-gray-500 mt-2 leading-relaxed" id="clear-modal-desc">
                  현재 수합된 모든 학생의 설문 데이터와 AI 초안 문구가 영구 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
                </p>
                <p className="text-xs font-semibold text-red-600 mt-2" id="clear-modal-warning">
                  삭제를 진행하려면 아래 칸에 <strong className="font-extrabold text-sm border-b-2 border-red-500">삭제</strong> 라고 입력하세요.
                </p>
              </div>

              <div className="space-y-3" id="clear-modal-form-wrapper">
                <input
                  type="text"
                  placeholder="삭제"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-center text-sm font-bold tracking-wider"
                  id="clear-modal-input"
                />

                <div className="flex space-x-2 pt-2" id="clear-modal-buttons">
                  <button
                    onClick={() => {
                      setShowClearConfirm(false);
                      setConfirmText("");
                    }}
                    className="flex-1 py-3 bg-gray-50 hover:bg-gray-100 text-gray-600 rounded-xl text-xs font-bold transition"
                    id="clear-modal-cancel"
                  >
                    취소
                  </button>
                  <button
                    onClick={handleClearAll}
                    disabled={confirmText !== "삭제"}
                    className={`flex-1 py-3 rounded-xl text-xs font-bold transition ${
                      confirmText === "삭제"
                        ? "bg-red-600 hover:bg-red-700 text-white shadow-md shadow-red-100"
                        : "bg-gray-100 text-gray-400 cursor-not-allowed"
                    }`}
                    id="clear-modal-confirm"
                  >
                    데이터 전체삭제
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Password & API Settings Modal */}
      {showPasswordSettings && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in" id="password-settings-modal-overlay">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-xl border border-slate-100" id="password-settings-modal">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3 mb-4" id="password-settings-header">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <Settings className="w-4 h-4 text-indigo-600" />
                <span>환경설정 및 API 관리</span>
              </h3>
              <button 
                onClick={() => setShowPasswordSettings(false)} 
                className="text-slate-400 hover:text-slate-600 transition p-1 hover:bg-slate-50 rounded-full"
                id="close-password-settings-btn"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {passwordChangeSuccess ? (
              <div className="text-center py-6 space-y-3" id="password-success-view">
                <div className="w-12 h-12 bg-green-50 text-green-500 rounded-full flex items-center justify-center mx-auto" id="password-success-icon-box">
                  <Check className="w-6 h-6" />
                </div>
                <p className="text-sm font-bold text-slate-700">설정이 성공적으로 저장되었습니다!</p>
                <p className="text-xs text-slate-400">잠시 후 창이 자동으로 닫힙니다.</p>
              </div>
            ) : (
              <form onSubmit={handleSaveSettings} className="space-y-4" id="password-settings-form">
                <p className="text-xs text-slate-500 leading-relaxed">
                  비밀번호를 바꿀 수 있으며, 개인 Gemini API 키를 로컬 브라우저에 직접 등록하여 사용하실 수 있습니다.
                </p>

                {/* Password Input */}
                <div className="space-y-1.5" id="password-input-group">
                  <label className="text-xs font-bold text-slate-600">대시보드 비밀번호 변경 (선택)</label>
                  <input
                    type="text"
                    placeholder="새 비밀번호 (미입력 시 유지)"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    id="new-password-input"
                  />
                </div>

                {/* Gemini API Key Input */}
                <div className="space-y-1.5" id="api-key-input-group">
                  <label className="text-xs font-bold text-slate-600 flex items-center gap-1">
                    <Key className="w-3.5 h-3.5 text-indigo-500" />
                    <span>Gemini API Key 등록 (선택)</span>
                  </label>
                  <input
                    type="password"
                    placeholder="AIzaSy로 시작하는 API 키 입력"
                    value={newApiKeyInput}
                    onChange={(e) => setNewApiKeyInput(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                    id="gemini-api-key-input"
                  />
                  <p className="text-[10px] text-slate-400 leading-normal">
                    ※ API 키는 서버에 저장되지 않고 <strong>선생님의 개인 브라우저(LocalStorage)에만 안전하게 보관</strong>되어 AI 문구 실시간 생성/재생성 시에만 직접 대입되어 작동됩니다.
                  </p>
                </div>

                {passwordChangeError && (
                  <p className="text-xs text-red-500 font-semibold" id="password-change-error">
                    {passwordChangeError}
                  </p>
                )}

                <div className="flex space-x-2 pt-2" id="password-change-buttons">
                  <button
                    type="button"
                    onClick={() => setShowPasswordSettings(false)}
                    className="flex-1 py-2.5 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-xl text-xs font-bold transition"
                    id="cancel-password-change"
                  >
                    취소
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition shadow-sm"
                    id="save-password-change"
                  >
                    저장하기
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Student Detail Modal (Digital Keyring Viewer) */}
      {activeStudent && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in" id="detail-modal-overlay">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-100 max-h-[90vh] overflow-y-auto" id="detail-modal">
            
            {/* Header */}
            <div className="flex justify-between items-center border-b border-slate-200 pb-3 mb-6" id="detail-modal-header">
              <div className="flex items-center space-x-2" id="detail-modal-title-box">
                <Sparkles className="w-5 h-5 text-indigo-600 fill-indigo-100" />
                <h3 className="text-base font-bold text-slate-800">
                  {activeStudent.grade}학년 {activeStudent.classNumber}반 {activeStudent.studentNumber}번 <span className="text-indigo-600 font-extrabold">{activeStudent.name}</span> 학생 상세 카드
                </h3>
              </div>
              <button 
                onClick={() => setActiveStudent(null)}
                className="text-slate-400 hover:text-slate-600 transition p-1 hover:bg-slate-100 rounded-full"
                id="close-detail-modal-btn"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content Body */}
            <div className="space-y-6" id="detail-modal-body">
              
              {/* Digital Keyring Pendant Simulation Box */}
              <div className="bg-slate-900 rounded-xl p-6 text-white text-center relative overflow-hidden shadow-inner border border-slate-800" id="detail-keyring-simulation">
                <div className="absolute top-2 right-2 opacity-10">
                  <Key className="w-32 h-32 transform rotate-45" />
                </div>
                
                {/* Simulated keyring connector */}
                <div className="w-8 h-8 rounded-full border-4 border-slate-300 bg-white mx-auto shadow-inner flex items-center justify-center -mt-2 mb-4">
                  <div className="w-3 h-3 rounded-full bg-slate-400" />
                </div>

                <p className="text-xs font-bold text-indigo-350 uppercase tracking-widest mb-3">
                  아이의 소중한 키워드 열쇠고리 🗝️
                </p>

                <div className="flex flex-wrap justify-center gap-2" id="detail-pendant-chips">
                  {activeStudent.keywords.map((kw, idx) => {
                    const colors = [
                      "bg-amber-500/10 text-amber-300 border-amber-500/30",
                      "bg-teal-500/10 text-teal-300 border-teal-500/30",
                      "bg-indigo-500/10 text-indigo-300 border-indigo-500/30",
                      "bg-pink-500/10 text-pink-300 border-pink-500/30",
                      "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                    ];
                    return (
                      <span
                        key={idx}
                        className={`text-sm font-extrabold px-3 py-1.5 rounded-xl border flex items-center space-x-1 shadow-sm ${colors[idx % colors.length]}`}
                        id={`detail-pendant-${idx}`}
                      >
                        <Star className="w-3 h-3 fill-current" />
                        <span>#{kw}</span>
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* Categorization & Domain breakdown */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4" id="detail-domains-breakdown">
                {['생활', '인성', '학습'].map(domainId => {
                  const matchedKeywords = activeStudent.keywords.filter(kw => {
                    const dom = DOMAINS.find(d => d.id === domainId);
                    return dom?.subCategories.some(sub => sub.keywords.some(k => k.text === kw));
                  });

                  let bgClass = "bg-slate-50 border-slate-100 text-slate-700";
                  let label = "";

                  if (domainId === '생활') {
                    bgClass = "bg-amber-50/40 border-amber-100 text-amber-800";
                    label = "🌟 생활 영역";
                  } else if (domainId === '인성') {
                    bgClass = "bg-teal-50/40 border-teal-100 text-teal-800";
                    label = "❤️ 인성 영역";
                  } else if (domainId === '학습') {
                    bgClass = "bg-indigo-50/40 border-indigo-100 text-indigo-800";
                    label = "📚 학습 영역";
                  }

                  return (
                    <div key={domainId} className={`border rounded-xl p-4 space-y-2 ${bgClass}`} id={`detail-domain-box-${domainId}`}>
                      <h4 className="text-xs font-extrabold uppercase tracking-wider">{label}</h4>
                      {matchedKeywords.length === 0 ? (
                        <p className="text-xs text-slate-400 italic">선택된 키워드 없음</p>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {matchedKeywords.map((kw, i) => (
                            <span key={i} className="text-xs bg-white border border-current/10 px-2 py-0.5 rounded-lg font-bold">
                              {kw}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* AI Feedback & Copy */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3" id="detail-feedback-card">
                <div className="flex justify-between items-center border-b border-slate-200 pb-2">
                  <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-600 fill-indigo-100" />
                    <span>학생 성장 격려 문구 (아이 전달용)</span>
                  </span>
                  <button
                    onClick={() => handleCopyText(activeStudent.aiFeedback || "", activeStudent.id, 'feedback')}
                    className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center space-x-1"
                    id="detail-copy-feedback"
                  >
                    {copiedId === activeStudent.id ? (
                      <>
                        <Check className="w-3 h-3 text-green-500" />
                        <span className="text-green-600">복사 완료!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>복사하기</span>
                      </>
                    )}
                  </button>
                </div>
                <p className="text-sm text-slate-600 leading-relaxed font-medium">
                  {activeStudent.aiFeedback || "격려 문구가 존재하지 않습니다."}
                </p>
              </div>

              {/* AI Draft & Copy */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3" id="detail-draft-card">
                <div className="flex justify-between items-center border-b border-slate-200 pb-2">
                  <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-600 fill-indigo-100" />
                    <span>생활기록부 추천 초안 문구 (교과세특/행발용)</span>
                  </span>
                  <button
                    onClick={() => handleCopyText(activeStudent.reportCardDraft || "", activeStudent.id, 'draft')}
                    className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center space-x-1"
                    id="detail-copy-draft"
                  >
                    {copiedDraftId === activeStudent.id ? (
                      <>
                        <Check className="w-3 h-3 text-green-500" />
                        <span className="text-green-600">복사 완료!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>복사하기</span>
                      </>
                    )}
                  </button>
                </div>
                <p className="text-sm text-slate-600 leading-relaxed font-medium">
                  {activeStudent.reportCardDraft || "추천 문구가 존재하지 않습니다."}
                </p>
              </div>

            </div>

            {/* Footer buttons */}
            <div className="flex justify-end space-x-2 pt-4 mt-6 border-t border-slate-200" id="detail-modal-footer">
              <button
                onClick={() => handleRegenerateAI(activeStudent.id)}
                disabled={regeneratingId === activeStudent.id}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl flex items-center space-x-1.5 transition disabled:opacity-50"
                id="detail-modal-regen-ai"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${regeneratingId === activeStudent.id ? "animate-spin" : ""}`} />
                <span>AI 추천문구 재생성</span>
              </button>
              <button
                onClick={() => setActiveStudent(null)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition"
                id="detail-modal-confirm"
              >
                닫기
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
