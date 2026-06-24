import React, { useState, useMemo } from "react";
import { DOMAINS, Domain, Keyword } from "../data/keywords";
import { StudentSubmission } from "../types";
import { motion, AnimatePresence } from "motion/react";
import { 
  User, CheckCircle2, AlertCircle, Search, 
  Sparkles, ArrowRight, ArrowLeft, RefreshCw, 
  HelpCircle, ClipboardCopy, Star, Key, Calendar
} from "lucide-react";

interface StudentSurveyProps {
  onSurveySubmitted: (newSubmission: StudentSubmission) => void;
}

export default function StudentSurvey({ onSurveySubmitted }: StudentSurveyProps) {
  // Step: 'info' | 'keywords' | 'success'
  const [step, setStep] = useState<'info' | 'keywords' | 'success'>('info');

  // Student Info State
  const [grade, setGrade] = useState("3");
  const [classNumber, setClassNumber] = useState("");
  const [studentNumber, setStudentNumber] = useState("");
  const [name, setName] = useState("");
  const [infoError, setInfoError] = useState("");

  // Keyword Selection State
  const [selectedKeywords, setSelectedKeywords] = useState<Keyword[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Success State
  const [submittedData, setSubmittedData] = useState<StudentSubmission | null>(null);
  const [copied, setCopied] = useState(false);

  // Quick select lists for Grade
  const grades = ["1", "2", "3", "4", "5", "6"];

  // Form submission: Validate student info and move to keywords selection
  const handleInfoSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!grade || !classNumber || !studentNumber || !name.trim()) {
      setInfoError("모든 빈칸을 채워주세요!");
      return;
    }
    if (isNaN(Number(classNumber)) || isNaN(Number(studentNumber))) {
      setInfoError("반과 번호는 숫자만 입력할 수 있어요.");
      return;
    }
    setInfoError("");
    setStep('keywords');
  };

  // Check which domain a keyword belongs to
  const getKeywordDomain = (keywordId: string): '생활' | '인성' | '학습' | null => {
    for (const domain of DOMAINS) {
      for (const sub of domain.subCategories) {
        if (sub.keywords.some(k => k.id === keywordId)) {
          return domain.id;
        }
      }
    }
    return null;
  };

  // Helper stats for validator
  const countsByDomain = useMemo(() => {
    const counts = { '생활': 0, '인성': 0, '학습': 0 };
    selectedKeywords.forEach(k => {
      const d = getKeywordDomain(k.id);
      if (d) counts[d]++;
    });
    return counts;
  }, [selectedKeywords]);

  const validationChecks = useMemo(() => {
    return {
      hasLife: countsByDomain['생활'] >= 1,
      hasChar: countsByDomain['인성'] >= 1,
      hasLearn: countsByDomain['학습'] >= 1,
      exactFive: selectedKeywords.length === 5,
      isPerfect: countsByDomain['생활'] >= 1 && countsByDomain['인성'] >= 1 && countsByDomain['학습'] >= 1 && selectedKeywords.length === 5
    };
  }, [countsByDomain, selectedKeywords]);

  // Handle keyword tap
  const handleKeywordToggle = (keyword: Keyword) => {
    const isSelected = selectedKeywords.some(k => k.id === keyword.id);
    if (isSelected) {
      setSelectedKeywords(prev => prev.filter(k => k.id !== keyword.id));
    } else {
      if (selectedKeywords.length >= 5) {
        // Already selected 5 keywords, can't add more
        return;
      }
      setSelectedKeywords(prev => [...prev, keyword]);
    }
  };

  // Keyword Search Filter
  const filteredDomains = useMemo(() => {
    if (!searchQuery.trim()) return DOMAINS;
    return DOMAINS.map(domain => {
      const matchedSubs = domain.subCategories.map(sub => {
        const matchedKeywords = sub.keywords.filter(k => 
          k.text.toLowerCase().includes(searchQuery.toLowerCase())
        );
        return { ...sub, keywords: matchedKeywords };
      }).filter(sub => sub.keywords.length > 0);
      
      return { ...domain, subCategories: matchedSubs };
    }).filter(domain => domain.subCategories.length > 0);
  }, [searchQuery]);

  // Final submission of survey
  const handleSubmitSurvey = async () => {
    if (!validationChecks.isPerfect) return;
    setSubmitting(true);

    try {
      const response = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grade,
          classNumber,
          studentNumber,
          name: name.trim(),
          keywords: selectedKeywords.map(k => k.text)
        })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setSubmittedData(data.submission);
          setStep('success');
          onSurveySubmitted(data.submission);
        }
      } else {
        alert("제출에 실패했습니다. 다시 한번 시도해 주세요.");
      }
    } catch (e) {
      console.error("Failed to submit survey", e);
      alert("서버 연결에 실패했습니다. 오프라인 상태인지 확인해주세요.");
    } finally {
      setSubmitting(false);
    }
  };

  // Clipboard copy
  const copyFeedback = () => {
    if (!submittedData?.aiFeedback) return;
    navigator.clipboard.writeText(submittedData.aiFeedback);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleResetForm = () => {
    setSelectedKeywords([]);
    setName("");
    setClassNumber("");
    setStudentNumber("");
    setStep('info');
    setSubmittedData(null);
  };

  return (
    <div className="py-8 px-4 max-w-7xl mx-auto" id="survey-root">
      <AnimatePresence mode="wait">
        
        {/* STEP 1: Student Information Input */}
        {step === 'info' && (
          <motion.div
            key="info-step"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.3 }}
            className="max-w-xl mx-auto bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden"
            id="info-step-card"
          >
            {/* Header banner */}
            <div className="bg-indigo-600 h-2" id="banner-rainbow" />
            
            <div className="p-8 sm:p-10" id="info-form-body">
              <div className="text-center space-y-2 mb-8" id="info-title-container">
                <span className="bg-indigo-50 text-indigo-700 text-xs font-semibold px-3 py-1 rounded-full uppercase tracking-wider" id="info-badge">
                  Keyword Survey
                </span>
                <h2 className="text-2xl sm:text-3xl font-sans font-extrabold text-gray-800 tracking-tight" id="info-h2">
                  나를 잘 표현하는 키워드 찾기
                </h2>
                <p className="text-sm text-gray-500" id="info-p">
                  내가 생각하는 나의 멋진 모습을 5가지 단어로 보여주세요!
                </p>
              </div>

              <form onSubmit={handleInfoSubmit} className="space-y-6" id="student-info-form">
                {/* Grade Selection */}
                <div className="space-y-2" id="input-group-grade">
                  <label className="text-sm font-bold text-gray-700 flex items-center space-x-1" id="label-grade">
                    <Star className="w-4 h-4 text-amber-500 fill-amber-500" id="star-icon" />
                    <span>몇 학년인가요?</span>
                  </label>
                  <div className="grid grid-cols-6 gap-2" id="grade-selectors">
                    {grades.map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setGrade(g)}
                        className={`py-3 rounded-xl text-base font-bold border transition-all duration-200 ${
                          grade === g
                            ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                            : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                        }`}
                        id={`grade-${g}-button`}
                      >
                        {g}학년
                      </button>
                    ))}
                  </div>
                </div>

                {/* Class & Student Number Row */}
                <div className="grid grid-cols-2 gap-4" id="input-row-class-num">
                  <div className="space-y-2" id="input-group-class">
                    <label className="text-sm font-bold text-gray-700" id="label-class">몇 반인가요?</label>
                    <div className="relative" id="class-input-wrapper">
                      <input
                        type="text"
                        pattern="[0-9]*"
                        placeholder="예) 3"
                        value={classNumber}
                        onChange={(e) => setClassNumber(e.target.value)}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white text-center text-lg font-bold text-slate-800 transition-all"
                        id="class-input"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-slate-400 font-bold pointer-events-none" id="class-unit">반</span>
                    </div>
                  </div>

                  <div className="space-y-2" id="input-group-student-num">
                    <label className="text-sm font-bold text-slate-700" id="label-student-num">몇 번인가요?</label>
                    <div className="relative" id="student-num-input-wrapper">
                      <input
                        type="text"
                        pattern="[0-9]*"
                        placeholder="예) 15"
                        value={studentNumber}
                        onChange={(e) => setStudentNumber(e.target.value)}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white text-center text-lg font-bold text-slate-800 transition-all"
                        id="student-num-input"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-gray-400 font-bold pointer-events-none" id="student-num-unit">번</span>
                    </div>
                  </div>
                </div>

                {/* Name Input */}
                <div className="space-y-2" id="input-group-name">
                  <label className="text-sm font-bold text-gray-700 flex items-center space-x-1" id="label-name">
                    <User className="w-4 h-4 text-indigo-500" id="name-icon" />
                    <span>이름이 무엇인가요?</span>
                  </label>
                  <input
                    type="text"
                    placeholder="이름을 입력해주세요"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white text-lg font-bold text-slate-800 transition-all"
                    id="name-input"
                  />
                </div>

                {/* Error message */}
                {infoError && (
                  <div className="flex items-center space-x-2 bg-red-50 text-red-700 px-4 py-3 rounded-xl border border-red-200 text-xs font-semibold animate-shake" id="info-error-box">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" id="info-error-icon" />
                    <span>{infoError}</span>
                  </div>
                )}

                {/* Submit info button */}
                <button
                  type="submit"
                  className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-sm flex items-center justify-center space-x-2 transition-all"
                  id="info-submit-button"
                >
                  <span>키워드 고르러 가기</span>
                  <ArrowRight className="w-5 h-5" id="arrow-right-icon" />
                </button>
              </form>
            </div>
          </motion.div>
        )}

        {/* STEP 2: Keyword Picking Wizard */}
        {step === 'keywords' && (
          <motion.div
            key="keywords-step"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="grid grid-cols-1 lg:grid-cols-12 gap-8"
            id="keywords-step-grid"
          >
            {/* LEFT COLUMN: Student Info & Validation Status Checklist */}
            <div className="lg:col-span-4 lg:sticky lg:top-24 h-fit space-y-6" id="survey-left-panel">
              {/* Back Button */}
              <button
                onClick={() => setStep('info')}
                className="flex items-center space-x-1.5 text-sm text-gray-500 hover:text-gray-700 font-semibold transition"
                id="back-to-info-button"
              >
                <ArrowLeft className="w-4 h-4" id="back-arrow-icon" />
                <span>정보 수정하기</span>
              </button>

              {/* Student Profile Overview */}
              <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm space-y-4" id="student-summary-card">
                <div className="flex items-center space-x-3 pb-3 border-b border-slate-200" id="student-summary-profile">
                  <div className="w-12 h-12 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600 font-sans font-bold text-lg" id="student-summary-avatar">
                    {name.slice(0, 1)}
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-800 text-base" id="student-summary-name">{name}</h4>
                    <p className="text-xs text-slate-400 font-mono" id="student-summary-details">
                      {grade}학년 {classNumber}반 {studentNumber}번
                    </p>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="space-y-1.5" id="selection-progress-container">
                  <div className="flex justify-between text-xs font-bold text-slate-500" id="selection-progress-label">
                    <span>키워드 고르기</span>
                    <span className={selectedKeywords.length === 5 ? "text-indigo-600 font-bold" : "text-slate-700"}>
                      {selectedKeywords.length} / 5개 선택됨
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 rounded h-2 overflow-hidden" id="selection-progress-track">
                    <div 
                      className="bg-indigo-600 h-full transition-all duration-300 rounded"
                      style={{ width: `${(selectedKeywords.length / 5) * 100}%` }}
                      id="selection-progress-bar"
                    />
                  </div>
                </div>

                {/* Checklist Rules Validation */}
                <div className="space-y-3 pt-2" id="checklist-rules">
                  <p className="text-xs font-extrabold text-gray-700 flex items-center space-x-1" id="checklist-title">
                    <HelpCircle className="w-3.5 h-3.5 text-gray-400" id="checklist-help-icon" />
                    <span>통과 규칙 (전부 완수해야 제출 가능)</span>
                  </p>
                  
                  <div className="space-y-2 text-xs" id="checklist-items">
                    {/* Life rule */}
                    <div className="flex items-center justify-between p-2 rounded-lg border border-slate-150 bg-slate-50/50" id="rule-life">
                      <div className="flex items-center space-x-2" id="rule-life-label">
                        <CheckCircle2 className={`w-4 h-4 ${validationChecks.hasLife ? "text-amber-500" : "text-slate-300"}`} id="rule-life-icon" />
                        <span className="font-medium text-slate-700">생활 🌟 영역 최소 1개</span>
                      </div>
                      <span className="font-mono text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md font-bold">
                        {countsByDomain['생활']}개
                      </span>
                    </div>

                    {/* Character rule */}
                    <div className="flex items-center justify-between p-2 rounded-lg border border-slate-150 bg-slate-50/50" id="rule-char">
                      <div className="flex items-center space-x-2" id="rule-char-label">
                        <CheckCircle2 className={`w-4 h-4 ${validationChecks.hasChar ? "text-teal-500" : "text-slate-300"}`} id="rule-char-icon" />
                        <span className="font-medium text-slate-700">인성 ❤️ 영역 최소 1개</span>
                      </div>
                      <span className="font-mono text-teal-700 bg-teal-50 px-2 py-0.5 rounded-md font-bold">
                        {countsByDomain['인성']}개
                      </span>
                    </div>

                    {/* Learning rule */}
                    <div className="flex items-center justify-between p-2 rounded-lg border border-slate-150 bg-slate-50/50" id="rule-learn">
                      <div className="flex items-center space-x-2" id="rule-learn-label">
                        <CheckCircle2 className={`w-4 h-4 ${validationChecks.hasLearn ? "text-indigo-500" : "text-slate-300"}`} id="rule-learn-icon" />
                        <span className="font-medium text-slate-700">학습 📚 영역 최소 1개</span>
                      </div>
                      <span className="font-mono text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md font-bold">
                        {countsByDomain['학습']}개
                      </span>
                    </div>

                    {/* Total exact five rule */}
                    <div className="flex items-center justify-between p-2 rounded-lg border border-slate-150 bg-slate-50/50" id="rule-total">
                      <div className="flex items-center space-x-2" id="rule-total-label">
                        <CheckCircle2 className={`w-4 h-4 ${validationChecks.exactFive ? "text-green-500" : "text-slate-300"}`} id="rule-total-icon" />
                        <span className="font-medium text-slate-700">정확히 5가지 선택</span>
                      </div>
                      <span className={`font-mono px-2 py-0.5 rounded-md font-bold ${validationChecks.exactFive ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-500"}`}>
                        {selectedKeywords.length} / 5
                      </span>
                    </div>
                  </div>
                </div>

                {/* Selected Keywords list as virtual keyring preview */}
                <div className="pt-2 border-t border-gray-100 space-y-2" id="keyring-preview-container">
                  <span className="text-xs font-extrabold text-gray-700 flex items-center space-x-1" id="keyring-preview-title">
                    <Key className="w-3.5 h-3.5 text-gray-400" id="key-icon" />
                    <span>나의 키워드 열쇠고리 프리뷰</span>
                  </span>
                  
                  {selectedKeywords.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-4 italic border border-dashed border-gray-200 rounded-xl" id="keyring-empty-msg">
                      오른쪽 단어장에서 마음에 드는 단어를 눌러보세요!
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5 p-2 bg-slate-50 rounded-xl border border-slate-200 min-h-12" id="keyring-chips-container">
                      {selectedKeywords.map((k, index) => {
                        const domId = getKeywordDomain(k.id);
                        let badgeBg = "bg-slate-100 text-slate-700";
                        if (domId === '생활') badgeBg = "bg-amber-50 text-amber-800 border-amber-200";
                        if (domId === '인성') badgeBg = "bg-teal-50 text-teal-800 border-teal-200";
                        if (domId === '학습') badgeBg = "bg-indigo-50 text-indigo-800 border-indigo-200";
                        
                        return (
                          <motion.span
                            key={k.id}
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className={`text-xs font-bold px-2.5 py-1 rounded-lg border flex items-center space-x-1 ${badgeBg}`}
                            id={`preview-chip-${k.id}`}
                          >
                            <span>#{k.text}</span>
                            <button 
                              onClick={() => handleKeywordToggle(k)}
                              className="w-3.5 h-3.5 rounded-full hover:bg-black/10 flex items-center justify-center font-bold text-[9px]"
                              id={`remove-chip-${k.id}`}
                            >
                              ✕
                            </button>
                          </motion.span>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Large submit button inside left panel */}
                <button
                  onClick={handleSubmitSurvey}
                  disabled={!validationChecks.isPerfect || submitting}
                  className={`w-full py-4 rounded-xl font-bold flex items-center justify-center space-x-2 transition shadow-sm ${
                    validationChecks.isPerfect && !submitting
                      ? "bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
                      : "bg-slate-100 text-slate-400 cursor-not-allowed shadow-none"
                  }`}
                  id="submit-survey-button"
                >
                  {submitting ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" id="spin-icon" />
                      <span>제출 중...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-5 h-5" id="submit-check-icon" />
                      <span>열쇠고리 완성 및 제출하기</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* RIGHT COLUMN: Interactive Keyword Lists */}
            <div className="lg:col-span-8 space-y-6" id="survey-right-panel">
              {/* Search Box */}
              <div className="relative bg-white rounded-xl shadow-sm border border-slate-200" id="search-box-container">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none" id="search-icon-wrapper">
                  <Search className="h-5 h-5 text-slate-400" id="search-box-icon" />
                </div>
                <input
                  type="text"
                  placeholder="찾고 싶은 키워드가 있나요? 단어 검색하기... (예: 리더십, 끈기, 독서)"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="block w-full pl-11 pr-4 py-3.5 text-sm bg-transparent border-0 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:rounded-xl text-slate-700 font-medium"
                  id="search-box-input"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute inset-y-0 right-0 pr-4 flex items-center text-xs text-gray-400 hover:text-gray-600 font-bold"
                    id="search-box-clear"
                  >
                    지우기
                  </button>
                )}
              </div>

              {/* Keyword dictionary panels */}
              <div className="space-y-8" id="keyword-sections-wrapper">
                {filteredDomains.length === 0 ? (
                  <div className="bg-white rounded-3xl p-12 border border-gray-100 text-center space-y-3 shadow-sm" id="search-no-results">
                    <p className="text-gray-400 text-lg font-bold" id="no-match-text">검색 결과와 맞는 단어가 없어요.</p>
                    <p className="text-gray-400 text-sm" id="no-match-sub">글자를 다시 한번 확인해보거나 다른 단어를 입력해보세요!</p>
                    <button
                      onClick={() => setSearchQuery("")}
                      className="px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl text-xs font-bold transition"
                      id="reset-search-button"
                    >
                      전체 키워드 보기
                    </button>
                  </div>
                ) : (
                  filteredDomains.map((domain) => {
                    const domainColor = domain.colorTheme;
                    return (
                      <div 
                        key={domain.id} 
                        className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm space-y-6"
                        id={`domain-section-${domain.id}`}
                      >
                        {/* Domain header banner */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-4" id={`domain-header-${domain.id}`}>
                          <div className="flex items-center space-x-3" id={`domain-title-wrapper-${domain.id}`}>
                            <div className="w-10 h-10 rounded-lg flex items-center justify-center text-lg font-bold bg-slate-100 text-slate-800" id={`domain-icon-box-${domain.id}`}>
                              {domain.id === '생활' ? '🌟' : domain.id === '인성' ? '❤️' : '📚'}
                            </div>
                            <div>
                              <h3 className="font-bold text-lg text-slate-800" id={`domain-h3-${domain.id}`}>
                                {domain.name}
                              </h3>
                              <p className="text-xs text-slate-400" id={`domain-desc-${domain.id}`}>
                                {domain.description}
                              </p>
                            </div>
                          </div>
                          
                          {/* Selection stats in domain header */}
                          <div className={`text-xs font-bold px-3 py-1 rounded-full border ${domainColor.bg} ${domainColor.text}`} id={`domain-stats-${domain.id}`}>
                            이 영역에서 {countsByDomain[domain.id]}개 선택 중
                          </div>
                        </div>

                        {/* Subcategories list */}
                        <div className="space-y-6" id={`subcategories-list-${domain.id}`}>
                          {domain.subCategories.map((sub, sIdx) => (
                            <div key={sub.name} className="space-y-3" id={`subcategory-${domain.id}-${sIdx}`}>
                              <h4 className="text-xs font-extrabold text-gray-500 uppercase tracking-widest pl-1" id={`sub-title-${domain.id}-${sIdx}`}>
                                • {sub.name}
                              </h4>
                              
                              <div className="flex flex-wrap gap-2" id={`keywords-wrapper-${domain.id}-${sIdx}`}>
                                {sub.keywords.map((keyword) => {
                                  const isSelected = selectedKeywords.some(k => k.id === keyword.id);
                                  return (
                                    <button
                                      key={keyword.id}
                                      onClick={() => handleKeywordToggle(keyword)}
                                      className={`text-sm font-bold px-4 py-2.5 rounded-xl border transition-all duration-200 flex items-center space-x-1.5 ${
                                        isSelected
                                          ? domainColor.badgeSelected
                                          : domainColor.badge + " border-slate-200 shadow-sm"
                                      }`}
                                      id={`keyword-btn-${keyword.id}`}
                                    >
                                      <span>#{keyword.text}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </motion.div>
        )}

        {/* STEP 3: Submission Success Card */}
        {step === 'success' && submittedData && (
          <motion.div
            key="success-step"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -30 }}
            className="max-w-2xl mx-auto space-y-6"
            id="success-step-container"
          >
            {/* Main digital card frame */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden relative" id="digital-keyring-card">
              {/* Confetti Background header */}
              <div className="bg-indigo-900 text-white p-8 text-center relative overflow-hidden" id="card-header">
                {/* Visual sparkles deco */}
                <div className="absolute top-2 right-2 opacity-10" id="deco-rings">
                  <Key className="w-40 h-40 transform rotate-45" id="deco-key" />
                </div>
                
                <div className="relative space-y-2" id="card-header-inner">
                  <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center mx-auto" id="card-star-circle">
                    <Sparkles className="w-6 h-6 text-yellow-300 fill-yellow-300 animate-pulse" id="sparkle-icon" />
                  </div>
                  <h3 className="text-2xl font-bold tracking-tight" id="card-h3">
                    키워드 열쇠고리 제작 완료!
                  </h3>
                  <p className="text-xs text-indigo-100 font-medium" id="card-subtitle">
                    제출이 무사히 수합되었습니다. 아래는 AI가 추천해 주는 따뜻한 성장 카드입니다.
                  </p>
                </div>
              </div>

              {/* Keyring details section */}
              <div className="p-8 space-y-6 relative" id="card-body">
                {/* Metal ring deco */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-5 w-10 h-10 rounded-full border-4 border-slate-300 bg-white shadow-inner flex items-center justify-center z-10" id="metal-ring-deco">
                  <div className="w-4 h-4 rounded-full bg-slate-100 border border-slate-200" id="metal-ring-center" />
                </div>

                {/* Kid profile badge */}
                <div className="text-center pt-2 space-y-1" id="card-student-profile">
                  <span className="text-indigo-600 font-mono text-xs font-bold tracking-widest bg-indigo-50 px-3 py-1 rounded-full uppercase" id="card-meta">
                    {submittedData.grade}학년 {submittedData.classNumber}반 {submittedData.studentNumber}번
                  </span>
                  <h2 className="text-3xl font-sans font-black text-gray-800" id="card-name-title">
                    {submittedData.name}
                  </h2>
                </div>

                {/* 5 glowing keywords keyring pendants */}
                <div className="space-y-3 pt-2" id="card-keyring-pendants-section">
                  <p className="text-xs font-extrabold text-gray-400 text-center uppercase tracking-widest" id="card-pendant-label">
                    선택한 나의 5대 핵심 키워드
                  </p>
                  
                  <div className="flex flex-wrap justify-center gap-2" id="card-pendant-chips">
                    {submittedData.keywords.map((kw, idx) => {
                      // Color theme loop based on index to keep it colorful
                      const colors = [
                        "bg-amber-500 text-white shadow-amber-100 border-amber-500",
                        "bg-teal-500 text-white shadow-teal-100 border-teal-500",
                        "bg-indigo-500 text-white shadow-indigo-100 border-indigo-500",
                        "bg-pink-500 text-white shadow-pink-100 border-pink-500",
                        "bg-emerald-500 text-white shadow-emerald-100 border-emerald-500"
                      ];
                      return (
                        <motion.span
                          key={idx}
                          initial={{ scale: 0.7, opacity: 0, y: 10 }}
                          animate={{ scale: 1, opacity: 1, y: 0 }}
                          transition={{ delay: idx * 0.1, duration: 0.3 }}
                          className={`text-sm font-extrabold px-4 py-2 rounded-2xl border flex items-center space-x-1 shadow-md ${colors[idx % colors.length]}`}
                          id={`pendant-${idx}`}
                        >
                          <Star className="w-3.5 h-3.5 fill-white/80 text-transparent" id={`pendant-star-${idx}`} />
                          <span>#{kw}</span>
                        </motion.span>
                      );
                    })}
                  </div>
                </div>

                {/* AI generated encouraging card content */}
                {submittedData.aiFeedback && (
                  <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100 space-y-3 relative" id="card-ai-feedback-box">
                    <div className="flex items-center space-x-2 text-indigo-700 font-extrabold text-sm" id="card-ai-feedback-title-box">
                      <Sparkles className="w-4 h-4 text-indigo-600 fill-indigo-100" id="feedback-sparkle" />
                      <span>AI 마술사 피드백 카드 🔮</span>
                    </div>
                    <p className="text-sm font-semibold text-gray-700 leading-relaxed" id="card-ai-feedback-text">
                      "{submittedData.aiFeedback}"
                    </p>

                    {/* Copy button */}
                    <div className="flex justify-end pt-2" id="card-copy-btn-wrapper">
                      <button
                        onClick={copyFeedback}
                        className="flex items-center space-x-1.5 text-xs text-gray-500 hover:text-indigo-600 font-bold transition"
                        id="copy-feedback-button"
                      >
                        <ClipboardCopy className="w-3.5 h-3.5" id="copy-feedback-icon" />
                        <span>{copied ? "복사 성공!" : "격려글 복사하기"}</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Timestamp & seal stamp */}
                <div className="flex items-center justify-between pt-4 border-t border-gray-100 text-[11px] text-gray-400 font-semibold" id="card-footer">
                  <div className="flex items-center space-x-1" id="card-time-box">
                    <Calendar className="w-3.5 h-3.5" id="calendar-icon" />
                    <span>제출시각: {new Date(submittedData.timestamp).toLocaleString("ko-KR")}</span>
                  </div>
                  <span className="text-gray-300 font-mono tracking-wider" id="card-cert-code">
                    CERT-{submittedData.id.slice(-6)}
                  </span>
                </div>
              </div>
            </div>

            {/* Success screen control actions */}
            <div className="flex flex-col sm:flex-row gap-3 pt-2" id="success-actions">
              <button
                onClick={handleResetForm}
                className="flex-1 py-4 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-2xl flex items-center justify-center space-x-2 transition"
                id="survey-reset-button"
              >
                <RefreshCw className="w-5 h-5" id="refresh-icon" />
                <span>새로운 설문 참여하기 (처음으로)</span>
              </button>
              
              <button
                onClick={() => window.print()}
                className="flex-1 py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl shadow-lg shadow-indigo-100 flex items-center justify-center space-x-2 transition hover:scale-[1.01] active:scale-95"
                id="print-card-button"
              >
                <ClipboardCopy className="w-5 h-5" id="print-icon" />
                <span>이 화면 인쇄 / PDF 저장하기</span>
              </button>
            </div>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}
