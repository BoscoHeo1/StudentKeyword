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
  const [classCode, setClassCode] = useState("");
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
  const handleInfoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!grade || !classNumber || !studentNumber || !name.trim() || !classCode.trim()) {
      setInfoError("모든 빈칸을 채워주세요! (학급 코드도 입력해야 해요)");
      return;
    }
    if (isNaN(Number(classNumber)) || isNaN(Number(studentNumber))) {
      setInfoError("반과 번호는 숫자만 입력할 수 있어요.");
      return;
    }

    try {
      const res = await fetch(`/api/classes/check/${encodeURIComponent(classCode.trim().toLowerCase())}`);
      const checkData = await res.json();
      if (!checkData.exists) {
        setInfoError("입력하신 학급 코드가 존재하지 않습니다. 선생님이 대시보드에서 등록하신 정확한 코드를 입력해주세요!");
        return;
      }
    } catch (err) {
      console.error("Failed to check class code", err);
      // Let it slide if there is an error
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
          keywords: selectedKeywords.map(k => k.text),
          classCode: classCode.trim().toLowerCase()
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
    setClassCode("");
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
            initial={{ opacity: 0, y: 25 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -25 }}
            transition={{ type: "spring", stiffness: 100, damping: 15 }}
            className="max-w-xl mx-auto bg-white/90 backdrop-blur-md rounded-3xl shadow-xl shadow-pink-100/30 border border-rose-100 overflow-hidden"
            id="info-step-card"
          >
            {/* Header banner */}
            <div className="bg-gradient-to-r from-rose-300 via-amber-200 to-indigo-300 h-2.5 animate-pulse" id="banner-rainbow" />
            
            <div className="p-8 sm:p-10" id="info-form-body">
              <div className="text-center space-y-3 mb-8" id="info-title-container">
                <span className="bg-rose-50 text-rose-600 text-[11px] font-black px-3.5 py-1.5 rounded-full uppercase tracking-wider border border-rose-100 inline-block shadow-sm" id="info-badge">
                  나의 반짝이는 키워드 💎
                </span>
                <h2 className="text-2xl sm:text-3xl font-sans font-black text-slate-800 tracking-tight" id="info-h2">
                  나를 표현하는 <span className="text-transparent bg-clip-text bg-gradient-to-r from-pink-500 to-indigo-600">열쇠고리</span> 만들기
                </h2>
                <p className="text-sm text-slate-500 font-medium" id="info-p">
                  내가 생각하는 나의 멋진 매력을 5가지 예쁜 보석 단어로 조립해 보세요!
                </p>
              </div>

              <form onSubmit={handleInfoSubmit} className="space-y-6" id="student-info-form">
                {/* Grade Selection */}
                <div className="space-y-3.5" id="input-group-grade">
                  <label className="text-sm font-bold text-slate-700 flex items-center space-x-1.5" id="label-grade">
                    <Star className="w-4 h-4 text-amber-400 fill-amber-400 animate-spin" style={{ animationDuration: '6s' }} id="star-icon" />
                    <span>나는 몇 학년인가요?</span>
                  </label>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2" id="grade-selectors">
                    {grades.map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setGrade(g)}
                        className={`py-3.5 rounded-2xl text-sm font-extrabold border transition-all duration-200 hover:scale-[1.03] active:scale-[0.97] ${
                          grade === g
                            ? "bg-gradient-to-br from-pink-500 to-indigo-600 text-white border-transparent shadow-md shadow-pink-100"
                            : "bg-rose-50/30 text-slate-600 border-rose-100/60 hover:bg-rose-50/60"
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
                  <div className="space-y-2.5" id="input-group-class">
                    <label className="text-sm font-bold text-slate-700" id="label-class">몇 반인가요?</label>
                    <div className="relative" id="class-input-wrapper">
                      <input
                        type="text"
                        pattern="[0-9]*"
                        placeholder="예) 3"
                        value={classNumber}
                        onChange={(e) => setClassNumber(e.target.value)}
                        className="w-full px-4 py-3.5 bg-rose-50/20 border border-rose-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-pink-400 focus:bg-white text-center text-lg font-black text-slate-800 transition-all shadow-inner"
                        id="class-input"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-pink-400 font-extrabold pointer-events-none" id="class-unit">반</span>
                    </div>
                  </div>

                  <div className="space-y-2.5" id="input-group-student-num">
                    <label className="text-sm font-bold text-slate-700" id="label-student-num">몇 번인가요?</label>
                    <div className="relative" id="student-num-input-wrapper">
                      <input
                        type="text"
                        pattern="[0-9]*"
                        placeholder="예) 15"
                        value={studentNumber}
                        onChange={(e) => setStudentNumber(e.target.value)}
                        className="w-full px-4 py-3.5 bg-rose-50/20 border border-rose-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-pink-400 focus:bg-white text-center text-lg font-black text-slate-800 transition-all shadow-inner"
                        id="student-num-input"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-pink-400 font-extrabold pointer-events-none" id="student-num-unit">번</span>
                    </div>
                  </div>
                </div>

                {/* Name Input */}
                <div className="space-y-2.5" id="input-group-name">
                  <label className="text-sm font-bold text-slate-700 flex items-center space-x-1.5" id="label-name">
                    <User className="w-4 h-4 text-indigo-500" id="name-icon" />
                    <span>이름이 무엇인가요?</span>
                  </label>
                  <input
                    type="text"
                    placeholder="이름을 예쁘게 적어주세요"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-5 py-4 bg-rose-50/20 border border-rose-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-pink-400 focus:bg-white text-lg font-black text-slate-800 transition-all shadow-inner"
                    id="name-input"
                  />
                </div>

                {/* Class Code Input */}
                <div className="space-y-2.5" id="input-group-class-code">
                  <label className="text-sm font-bold text-slate-700 flex items-center space-x-1.5" id="label-class-code">
                    <Key className="w-4 h-4 text-pink-500" id="class-code-icon" />
                    <span>학급 코드 (선생님이 알려주신 코드)</span>
                  </label>
                  <input
                    type="text"
                    placeholder="예) seoul301 (대소문자 구분 없음)"
                    value={classCode}
                    onChange={(e) => setClassCode(e.target.value)}
                    className="w-full px-5 py-4 bg-rose-50/20 border border-rose-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-pink-400 focus:bg-white text-lg font-black text-slate-800 transition-all shadow-inner"
                    id="class-code-input"
                  />
                </div>

                {/* Error message */}
                {infoError && (
                  <div className="flex items-center space-x-2 bg-rose-50 text-rose-600 px-4 py-3 rounded-2xl border border-rose-100 text-xs font-bold animate-shake" id="info-error-box">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-500" id="info-error-icon" />
                    <span>{infoError}</span>
                  </div>
                )}

                {/* Submit info button */}
                <button
                  type="submit"
                  className="w-full py-4.5 bg-gradient-to-r from-pink-500 via-rose-500 to-indigo-600 hover:opacity-95 text-white font-extrabold rounded-2xl shadow-lg shadow-pink-100/40 flex items-center justify-center space-x-2 transition-all duration-200 hover:scale-[1.01] active:scale-[0.98]"
                  id="info-submit-button"
                >
                  <span className="tracking-wide">키워드 고르러 출발하기 🚀</span>
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
                className="flex items-center space-x-2 text-sm text-pink-500 hover:text-pink-600 font-extrabold transition bg-white/60 px-4 py-2 rounded-2xl border border-rose-100 shadow-sm"
                id="back-to-info-button"
              >
                <ArrowLeft className="w-4 h-4" id="back-arrow-icon" />
                <span>정보 수정하기</span>
              </button>

              {/* Student Profile Overview */}
              <div className="bg-white/95 backdrop-blur-md rounded-3xl p-6 border border-rose-100 shadow-xl shadow-pink-100/30 space-y-5" id="student-summary-card">
                <div className="flex items-center space-x-3.5 pb-4 border-b border-rose-50" id="student-summary-profile">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-pink-400 to-indigo-500 flex items-center justify-center text-white font-black text-lg shadow-sm" id="student-summary-avatar">
                    {name.slice(0, 1)}
                  </div>
                  <div>
                    <h4 className="font-black text-slate-800 text-lg flex items-center gap-1" id="student-summary-name">
                      <span>{name}</span>
                      <span className="text-sm">어린이</span>
                    </h4>
                    <p className="text-xs text-indigo-500 font-bold" id="student-summary-details">
                      {grade}학년 {classNumber}반 {studentNumber}번
                    </p>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="space-y-2" id="selection-progress-container">
                  <div className="flex justify-between text-xs font-extrabold text-slate-500" id="selection-progress-label">
                    <span>키워드 모으기 🎒</span>
                    <span className={selectedKeywords.length === 5 ? "text-pink-500 font-black animate-bounce" : "text-slate-700 font-bold"}>
                      {selectedKeywords.length} / 5개 선택 완료
                    </span>
                  </div>
                  <div className="w-full bg-rose-50/50 border border-rose-100/50 rounded-full h-3 overflow-hidden p-0.5" id="selection-progress-track">
                    <div 
                      className="bg-gradient-to-r from-pink-500 via-rose-400 to-indigo-500 h-full transition-all duration-300 rounded-full animate-pulse"
                      style={{ width: `${(selectedKeywords.length / 5) * 100}%` }}
                      id="selection-progress-bar"
                    />
                  </div>
                </div>

                {/* Checklist Rules Validation */}
                <div className="space-y-3.5 pt-2" id="checklist-rules">
                  <p className="text-xs font-black text-slate-700 flex items-center space-x-1.5" id="checklist-title">
                    <HelpCircle className="w-4 h-4 text-pink-400" id="checklist-help-icon" />
                    <span>필수 미션 3가지 (전부 성공해야 해요!)</span>
                  </p>
                  
                  <div className="space-y-2 text-xs" id="checklist-items">
                    {/* Life rule */}
                    <div className={`flex items-center justify-between p-2.5 rounded-2xl border transition-all ${validationChecks.hasLife ? "bg-amber-50/70 border-amber-200" : "bg-slate-50 border-slate-100"}`} id="rule-life">
                      <div className="flex items-center space-x-2.5" id="rule-life-label">
                        <CheckCircle2 className={`w-4 h-4 ${validationChecks.hasLife ? "text-amber-500 fill-amber-100" : "text-slate-300"}`} id="rule-life-icon" />
                        <span className="font-extrabold text-slate-700">생활 🌟 영역 최소 1개</span>
                      </div>
                      <span className={`font-mono px-2 py-0.5 rounded-lg font-black text-xs ${validationChecks.hasLife ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-400"}`}>
                        {countsByDomain['생활']}개
                      </span>
                    </div>

                    {/* Character rule */}
                    <div className={`flex items-center justify-between p-2.5 rounded-2xl border transition-all ${validationChecks.hasChar ? "bg-teal-50/70 border-teal-200" : "bg-slate-50 border-slate-100"}`} id="rule-char">
                      <div className="flex items-center space-x-2.5" id="rule-char-label">
                        <CheckCircle2 className={`w-4 h-4 ${validationChecks.hasChar ? "text-teal-500 fill-teal-100" : "text-slate-300"}`} id="rule-char-icon" />
                        <span className="font-extrabold text-slate-700">인성 ❤️ 영역 최소 1개</span>
                      </div>
                      <span className={`font-mono px-2 py-0.5 rounded-lg font-black text-xs ${validationChecks.hasChar ? "bg-teal-100 text-teal-800" : "bg-slate-100 text-slate-400"}`}>
                        {countsByDomain['인성']}개
                      </span>
                    </div>

                    {/* Learning rule */}
                    <div className={`flex items-center justify-between p-2.5 rounded-2xl border transition-all ${validationChecks.hasLearn ? "bg-indigo-50/70 border-indigo-200" : "bg-slate-50 border-slate-100"}`} id="rule-learn">
                      <div className="flex items-center space-x-2.5" id="rule-learn-label">
                        <CheckCircle2 className={`w-4 h-4 ${validationChecks.hasLearn ? "text-indigo-500 fill-indigo-100" : "text-slate-300"}`} id="rule-learn-icon" />
                        <span className="font-extrabold text-slate-700">학습 📚 영역 최소 1개</span>
                      </div>
                      <span className={`font-mono px-2 py-0.5 rounded-lg font-black text-xs ${validationChecks.hasLearn ? "bg-indigo-100 text-indigo-800" : "bg-slate-100 text-slate-400"}`}>
                        {countsByDomain['학습']}개
                      </span>
                    </div>

                    {/* Total exact five rule */}
                    <div className={`flex items-center justify-between p-2.5 rounded-2xl border transition-all ${validationChecks.exactFive ? "bg-green-50/70 border-green-200" : "bg-slate-50 border-slate-100"}`} id="rule-total">
                      <div className="flex items-center space-x-2.5" id="rule-total-label">
                        <CheckCircle2 className={`w-4 h-4 ${validationChecks.exactFive ? "text-green-500 fill-green-100" : "text-slate-300"}`} id="rule-total-icon" />
                        <span className="font-extrabold text-slate-700">정확히 5개 모으기</span>
                      </div>
                      <span className={`font-mono px-2.5 py-0.5 rounded-lg font-black text-xs ${validationChecks.exactFive ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
                        {selectedKeywords.length} / 5
                      </span>
                    </div>
                  </div>
                </div>

                {/* Selected Keywords list as virtual keyring preview */}
                <div className="pt-4 border-t border-rose-50 space-y-3" id="keyring-preview-container">
                  <span className="text-xs font-black text-slate-700 flex items-center space-x-1.5" id="keyring-preview-title">
                    <Key className="w-4 h-4 text-pink-400 animate-bounce" id="key-icon" />
                    <span>나의 키워드 열쇠고리 실시간 프리뷰</span>
                  </span>
                  
                  {selectedKeywords.length === 0 ? (
                    <div className="py-8 px-4 text-center border-2 border-dashed border-rose-100 rounded-3xl bg-rose-50/10 space-y-2" id="keyring-empty-msg">
                      <p className="text-xs text-slate-400 font-bold">오른쪽 단어장에서 단어 카드를 눌러주세요!</p>
                      <p className="text-[10px] text-pink-400">멋진 나만의 열쇠고리가 여기에 매달릴 거예요 ✨</p>
                    </div>
                  ) : (
                    <div className="p-4 bg-gradient-to-br from-rose-50/30 to-indigo-50/20 rounded-3xl border border-rose-100/50 relative flex flex-col items-center" id="keyring-visual-box">
                      {/* Interactive Visual Keyring Wire Circle */}
                      <div className="w-12 h-12 rounded-full border-[4px] border-slate-300 bg-white shadow-inner flex items-center justify-center relative z-10 mb-2" id="preview-metal-ring">
                        <div className="w-6 h-6 rounded-full border border-dashed border-pink-200" />
                        {/* Little metal chain link connector */}
                        <div className="absolute top-[85%] left-1/2 -translate-x-1/2 w-2.5 h-5 bg-slate-300 border border-slate-400 rounded-full flex flex-col justify-between p-0.5">
                          <div className="w-full h-1 bg-white/40 rounded-full" />
                        </div>
                      </div>
                      
                      {/* Pendant Charms Dangling Container */}
                      <div className="w-full space-y-2 mt-2 pt-1 flex flex-col items-center" id="keyring-chips-container">
                        {selectedKeywords.map((k, index) => {
                          const domId = getKeywordDomain(k.id);
                          let badgeBg = "bg-slate-100 text-slate-700 border-slate-200";
                          if (domId === '생활') badgeBg = "bg-gradient-to-r from-amber-400 to-amber-500 text-white border-transparent shadow-sm shadow-amber-100";
                          if (domId === '인성') badgeBg = "bg-gradient-to-r from-teal-400 to-teal-500 text-white border-transparent shadow-sm shadow-teal-100";
                          if (domId === '학습') badgeBg = "bg-gradient-to-r from-indigo-400 to-indigo-500 text-white border-transparent shadow-sm shadow-indigo-100";
                          
                          return (
                            <motion.span
                              key={k.id}
                              initial={{ scale: 0.6, y: -20, opacity: 0 }}
                              animate={{ scale: 1, y: 0, opacity: 1, rotate: index % 2 === 0 ? 1.5 : -1.5 }}
                              transition={{ type: "spring", stiffness: 120, damping: 10 }}
                              whileHover={{ scale: 1.05, rotate: 0 }}
                              className={`text-xs font-black px-3.5 py-2 rounded-2xl border flex items-center space-x-2 select-none cursor-pointer hover:shadow-md transition-shadow ${badgeBg}`}
                              id={`preview-chip-${k.id}`}
                              onClick={() => handleKeywordToggle(k)}
                            >
                              <span>🎈 #{k.text}</span>
                              <span className="w-4 h-4 rounded-full bg-white/25 hover:bg-white/40 flex items-center justify-center font-black text-[9px] text-white">
                                ✕
                              </span>
                            </motion.span>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Large submit button inside left panel */}
                <button
                  onClick={handleSubmitSurvey}
                  disabled={!validationChecks.isPerfect || submitting}
                  className={`w-full py-4.5 rounded-2xl font-black flex items-center justify-center space-x-2 transition-all duration-300 ${
                    validationChecks.isPerfect && !submitting
                      ? "bg-gradient-to-r from-pink-500 via-rose-500 to-indigo-600 hover:opacity-95 text-white shadow-lg shadow-pink-100 hover:scale-[1.02] active:scale-[0.98]"
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
              <div className="relative bg-white/90 backdrop-blur-md rounded-2xl shadow-md shadow-pink-100/20 border border-rose-100 p-0.5" id="search-box-container">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none" id="search-icon-wrapper">
                  <Search className="h-5 w-5 text-pink-400" id="search-box-icon" />
                </div>
                <input
                  type="text"
                  placeholder="원하는 매력을 검색해 보세요! (예: 리더십, 끈기, 글쓰기)"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="block w-full pl-11 pr-4 py-4 text-sm bg-transparent border-0 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:rounded-2xl text-slate-700 font-bold placeholder:text-slate-400"
                  id="search-box-input"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute inset-y-0 right-0 pr-4 flex items-center text-xs text-pink-500 hover:text-pink-600 font-black"
                    id="search-box-clear"
                  >
                    지우기
                  </button>
                )}
              </div>

              {/* Keyword dictionary panels */}
              <div className="space-y-8" id="keyword-sections-wrapper">
                {filteredDomains.length === 0 ? (
                  <div className="bg-white/95 rounded-3xl p-12 border border-rose-100 text-center space-y-3 shadow-md shadow-pink-50/50" id="search-no-results">
                    <p className="text-slate-400 text-lg font-bold" id="no-match-text">맞는 단어가 단어장엔 아직 없나봐요 😿</p>
                    <p className="text-slate-400 text-xs font-semibold" id="no-match-sub">혹시 오타가 있는지 확인하거나, 아래 버튼을 눌러 다른 매력들을 찾아보세요!</p>
                    <button
                      onClick={() => setSearchQuery("")}
                      className="px-5 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-500 rounded-2xl text-xs font-black transition-all"
                      id="reset-search-button"
                    >
                      전체 단어장 펼치기 👀
                    </button>
                  </div>
                ) : (
                  filteredDomains.map((domain) => {
                    const domainColor = domain.colorTheme;
                    return (
                      <div 
                        key={domain.id} 
                        className="bg-white/90 backdrop-blur-sm rounded-3xl p-6 sm:p-8 border border-rose-100 shadow-lg shadow-pink-100/10 space-y-6"
                        id={`domain-section-${domain.id}`}
                      >
                        {/* Domain header banner */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-rose-50 pb-4" id={`domain-header-${domain.id}`}>
                          <div className="flex items-center space-x-3" id={`domain-title-wrapper-${domain.id}`}>
                            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center text-lg font-bold shadow-sm ${
                              domain.id === '생활' ? 'bg-amber-100 text-amber-600' : domain.id === '인성' ? 'bg-rose-100 text-rose-500' : 'bg-indigo-100 text-indigo-600'
                            }`} id={`domain-icon-box-${domain.id}`}>
                              {domain.id === '생활' ? '🌟' : domain.id === '인성' ? '❤️' : '📚'}
                            </div>
                            <div>
                              <h3 className="font-black text-slate-800 text-base" id={`domain-h3-${domain.id}`}>
                                {domain.name}
                              </h3>
                              <p className="text-xs text-slate-400 font-medium" id={`domain-desc-${domain.id}`}>
                                {domain.description}
                              </p>
                            </div>
                          </div>
                          
                          {/* Selection stats in domain header */}
                          <div className={`text-xs font-extrabold px-3.5 py-1.5 rounded-full border ${domainColor.bg} ${domainColor.text}`} id={`domain-stats-${domain.id}`}>
                            이 영역에서 {countsByDomain[domain.id]}개 선택 중
                          </div>
                        </div>

                        {/* Subcategories list */}
                        <div className="space-y-6" id={`subcategories-list-${domain.id}`}>
                          {domain.subCategories.map((sub, sIdx) => (
                            <div key={sub.name} className="space-y-3.5" id={`subcategory-${domain.id}-${sIdx}`}>
                              <h4 className="text-xs font-black text-slate-400 tracking-wider pl-1" id={`sub-title-${domain.id}-${sIdx}`}>
                                🎈 {sub.name}
                              </h4>
                              
                              <div className="flex flex-wrap gap-2.5" id={`keywords-wrapper-${domain.id}-${sIdx}`}>
                                {sub.keywords.map((keyword) => {
                                  const isSelected = selectedKeywords.some(k => k.id === keyword.id);
                                  return (
                                    <button
                                      key={keyword.id}
                                      onClick={() => handleKeywordToggle(keyword)}
                                      className={`text-sm font-bold px-4 py-3 rounded-2xl border transition-all duration-200 flex items-center space-x-1.5 hover:scale-[1.04] active:scale-[0.96] ${
                                        isSelected
                                          ? domainColor.badgeSelected + " ring-2 ring-offset-2 ring-pink-100 font-extrabold"
                                          : domainColor.badge + " border-rose-100/50 shadow-sm"
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
            <div className="bg-white/95 backdrop-blur-md rounded-3xl shadow-xl shadow-pink-100/30 border border-rose-100 overflow-hidden relative" id="digital-keyring-card">
              {/* Confetti Background header */}
              <div className="bg-gradient-to-r from-pink-400 via-rose-400 to-indigo-500 text-white p-8 text-center relative overflow-hidden" id="card-header">
                {/* Visual sparkles deco */}
                <div className="absolute top-2 right-2 opacity-10" id="deco-rings">
                  <Key className="w-40 h-40 transform rotate-45 text-white" id="deco-key" />
                </div>
                
                <div className="relative space-y-3" id="card-header-inner">
                  <div className="w-14 h-14 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center mx-auto shadow-inner animate-bounce" id="card-star-circle">
                    <Sparkles className="w-7 h-7 text-yellow-300 fill-yellow-300" id="sparkle-icon" />
                  </div>
                  <h3 className="text-2xl sm:text-3xl font-black tracking-tight" id="card-h3">
                    나의 보석 열쇠고리 완성! ✨
                  </h3>
                  <p className="text-xs text-rose-50 font-semibold" id="card-subtitle">
                    나의 소중한 반짝임이 제출되었어요. AI 마술사가 만든 따뜻한 격려장을 전해드려요.
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
                <div className="text-center pt-2 space-y-2" id="card-student-profile">
                  <span className="text-pink-600 font-extrabold text-xs tracking-widest bg-pink-50 px-4 py-1.5 rounded-full border border-pink-100 inline-block shadow-sm" id="card-meta">
                    {submittedData.grade}학년 {submittedData.classNumber}반 {submittedData.studentNumber}번
                  </span>
                  <h2 className="text-3xl font-sans font-black text-slate-800 flex items-center justify-center gap-1.5" id="card-name-title">
                    <span>{submittedData.name}</span>
                    <span className="text-lg text-slate-400 font-bold">어린이</span>
                  </h2>
                </div>

                {/* 5 glowing keywords keyring pendants */}
                <div className="space-y-3 pt-2" id="card-keyring-pendants-section">
                  <p className="text-xs font-black text-slate-400 text-center uppercase tracking-wider" id="card-pendant-label">
                    내가 모은 5가지 반짝이는 매력 보석 💎
                  </p>
                  
                  <div className="flex flex-wrap justify-center gap-2.5" id="card-pendant-chips">
                    {submittedData.keywords.map((kw, idx) => {
                      // Color theme loop based on index to keep it colorful
                      const colors = [
                        "bg-gradient-to-r from-amber-400 to-amber-500 text-white shadow-amber-100 border-transparent",
                        "bg-gradient-to-r from-teal-400 to-teal-500 text-white shadow-teal-100 border-transparent",
                        "bg-gradient-to-r from-indigo-400 to-indigo-500 text-white shadow-indigo-100 border-transparent",
                        "bg-gradient-to-r from-pink-400 to-pink-500 text-white shadow-pink-100 border-transparent",
                        "bg-gradient-to-r from-emerald-400 to-emerald-500 text-white shadow-emerald-100 border-transparent"
                      ];
                      return (
                        <motion.span
                          key={idx}
                          initial={{ scale: 0.7, opacity: 0, y: 15 }}
                          animate={{ scale: 1, opacity: 1, y: 0, rotate: idx % 2 === 0 ? [2, -2, 2] : [-2, 2, -2] }}
                          transition={{ delay: idx * 0.1, type: "spring", stiffness: 100 }}
                          whileHover={{ scale: 1.05 }}
                          className={`text-sm font-extrabold px-4 py-2.5 rounded-2xl border flex items-center space-x-1.5 shadow-md ${colors[idx % colors.length]}`}
                          id={`pendant-${idx}`}
                        >
                          <Star className="w-3.5 h-3.5 fill-white/85 text-transparent animate-pulse" id={`pendant-star-${idx}`} />
                          <span>#{kw}</span>
                        </motion.span>
                      );
                    })}
                  </div>
                </div>

                {/* AI generated encouraging card content */}
                {submittedData.aiFeedback && (
                  <div className="bg-rose-50/20 rounded-3xl p-6 sm:p-7 border border-rose-100 space-y-4 relative shadow-inner overflow-hidden" id="card-ai-feedback-box">
                    <div className="flex items-center space-x-2 text-pink-600 font-black text-sm" id="card-ai-feedback-title-box">
                      <Sparkles className="w-4 h-4 text-pink-500 fill-pink-100 animate-spin" style={{ animationDuration: '4s' }} id="feedback-sparkle" />
                      <span>AI 마술사의 꿈과 성장의 메세지 🔮</span>
                    </div>
                    <p className="text-sm font-extrabold text-slate-700 leading-relaxed" id="card-ai-feedback-text">
                      "{submittedData.aiFeedback}"
                    </p>

                    {/* Copy button */}
                    <div className="flex justify-end pt-1" id="card-copy-btn-wrapper">
                      <button
                        onClick={copyFeedback}
                        className="flex items-center space-x-1.5 text-xs text-pink-500 hover:text-pink-600 font-extrabold transition-all hover:scale-105"
                        id="copy-feedback-button"
                      >
                        <ClipboardCopy className="w-3.5 h-3.5" id="copy-feedback-icon" />
                        <span>{copied ? "복사가 잘 되었어요! ✨" : "이 따뜻한 글 복사하기"}</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Timestamp & seal stamp */}
                <div className="flex items-center justify-between pt-4 border-t border-rose-50 text-[11px] text-slate-400 font-semibold" id="card-footer">
                  <div className="flex items-center space-x-1" id="card-time-box">
                    <Calendar className="w-3.5 h-3.5" id="calendar-icon" />
                    <span>발행일시: {new Date(submittedData.timestamp).toLocaleString("ko-KR")}</span>
                  </div>
                  <span className="text-rose-300 font-bold tracking-wider" id="card-cert-code">
                    MAGIC-{submittedData.id.slice(-6).toUpperCase()}
                  </span>
                </div>
              </div>
            </div>

            {/* Success screen control actions */}
            <div className="flex flex-col sm:flex-row gap-4 pt-2" id="success-actions">
              <button
                onClick={handleResetForm}
                className="flex-1 py-4 bg-rose-50 hover:bg-rose-100/80 text-rose-600 font-extrabold rounded-2xl flex items-center justify-center space-x-2 border border-rose-100/50 transition-all hover:scale-[1.01] active:scale-[0.98] shadow-sm"
                id="survey-reset-button"
              >
                <RefreshCw className="w-5 h-5" id="refresh-icon" />
                <span>처음으로 돌아가 새로운 열쇠고리 만들기 🧸</span>
              </button>
              
              <button
                onClick={() => window.print()}
                className="flex-1 py-4 bg-gradient-to-r from-pink-500 via-rose-500 to-indigo-600 text-white font-extrabold rounded-2xl shadow-lg shadow-pink-100 flex items-center justify-center space-x-2 transition-all hover:scale-[1.01] active:scale-[0.98]"
                id="print-card-button"
              >
                <ClipboardCopy className="w-5 h-5" id="print-icon" />
                <span>이 예쁜 카드 인쇄 / PDF 저장하기 🖨️</span>
              </button>
            </div>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}
