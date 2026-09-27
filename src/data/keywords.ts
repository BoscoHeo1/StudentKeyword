export interface Keyword {
  id: string;
  text: string;
  isNegative?: boolean; // Keep track of warning/negative items if any, but default to false
}

export interface SubCategory {
  name: string;
  keywords: Keyword[];
}

export interface Domain {
  id: '생활' | '인성' | '학습';
  name: string;
  description: string;
  colorTheme: {
    primary: string;
    bg: string;
    text: string;
    border: string;
    badge: string;
    badgeSelected: string;
    accent: string;
  };
  subCategories: SubCategory[];
}

export const DOMAINS: Domain[] = [
  {
    id: '생활',
    name: '생활 (Life & Behavior)',
    description: '교우관계, 학급 규칙, 협동과 배려에 관한 키워드입니다.',
    colorTheme: {
      primary: 'amber',
      bg: 'bg-amber-50',
      text: 'text-amber-800',
      border: 'border-amber-200',
      badge: 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100',
      badgeSelected: 'bg-amber-500 text-white border-amber-500 shadow-md shadow-amber-200',
      accent: 'amber-500'
    },
    subCategories: [
      {
        name: '공동체 활동',
        keywords: [
          { id: 'life-1-1', text: '원만한 교우관계' },
          { id: 'life-1-2', text: '따뜻한 마음씨' },
          { id: 'life-1-3', text: '친구들에게 인기' },
          { id: 'life-1-4', text: '사교적이며 유쾌함' },
          { id: 'life-1-5', text: '뛰어난 의사소통 능력' },
          { id: 'life-1-6', text: '친구들의 의견 존중' },
          { id: 'life-1-7', text: '뛰어난 공감능력' },
          { id: 'life-1-8', text: '뛰어난 리더십' },
          { id: 'life-1-9', text: '밝은 에너지' },
          { id: 'life-1-10', text: '적극적인 참여' }
        ]
      },
      {
        name: '규범과 갈등 해소',
        keywords: [
          { id: 'life-2-1', text: '규범과 질서 준수' },
          { id: 'life-2-2', text: '학급 규칙 준수' },
          { id: 'life-2-3', text: '친절한 정의감' },
          { id: 'life-2-4', text: '바른 약속과 습관' },
          { id: 'life-2-5', text: '단정한 용모와 복장' },
          { id: 'life-2-6', text: '정직하고 올바른 태도' },
          { id: 'life-2-7', text: '갈등에 대한 중재역할' },
          { id: 'life-2-8', text: '잘못을 인정하는 태도' },
          { id: 'life-2-9', text: '감정관리 우수' },
          { id: 'life-2-10', text: '약자지향의 마음' }
        ]
      },
      {
        name: '나눔과 봉사',
        keywords: [
          { id: 'life-3-1', text: '좋은 일에 솔선수범' },
          { id: 'life-3-2', text: '적극적인 협력활동' },
          { id: 'life-3-3', text: '자발적인 배려' },
          { id: 'life-3-4', text: '따뜻한 봉사정신' },
          { id: 'life-3-5', text: '강한 이타심' },
          { id: 'life-3-6', text: '자발적인 학급활동' },
          { id: 'life-3-7', text: '나눔의 정신 실천' },
          { id: 'life-3-8', text: '타인에 대한 배려' },
          { id: 'life-3-9', text: '대가를 바라지 않는 마음' },
          { id: 'life-3-10', text: '도움과 친절' },
          { id: 'life-3-11', text: '긍정적인 영향력' }
        ]
      }
    ]
  },
  {
    id: '인성',
    name: '인성 (Character & Personality)',
    description: '긍정적 마음가짐, 친화력, 성실성에 관한 키워드입니다.',
    colorTheme: {
      primary: 'teal',
      bg: 'bg-teal-50',
      text: 'text-teal-800',
      border: 'border-teal-200',
      badge: 'bg-teal-50 text-teal-800 border-teal-200 hover:bg-teal-100',
      badgeSelected: 'bg-teal-500 text-white border-teal-500 shadow-md shadow-teal-200',
      accent: 'teal-500'
    },
    subCategories: [
      {
        name: '친화력',
        keywords: [
          { id: 'char-1-1', text: '재치있는 사고방식' },
          { id: 'char-1-2', text: '유쾌한 유머감각' },
          { id: 'char-1-3', text: '밝고 명랑한 성격' },
          { id: 'char-1-4', text: '따뜻하고 활발함' },
          { id: 'char-1-5', text: '흥과 끼가 많음' },
          { id: 'char-1-6', text: '솔직하고 엉뚱한 매력' },
          { id: 'char-1-7', text: '적극적인 에너지' },
          { id: 'char-1-8', text: '호기심과 창의성' },
          { id: 'char-1-9', text: '자유로운 자기개성' },
          { id: 'char-1-10', text: '타인의 잘못을 포용' },
          { id: 'char-1-11', text: '다양성 존중' },
          { id: 'char-1-12', text: '편견 없는 솔직함' },
          { id: 'char-1-13', text: '소신과 자신감' }
        ]
      },
      {
        name: '긍정',
        keywords: [
          { id: 'char-2-1', text: '밝고 긍정적인 태도' },
          { id: 'char-2-2', text: '늘 미소짓는 모습' },
          { id: 'char-2-3', text: '순수하고 고운 성품' },
          { id: 'char-2-4', text: '동물을 사랑하는 성격' },
          { id: 'char-2-5', text: '작은 일에도 자부심' },
          { id: 'char-2-6', text: '높은 자기 통제 능력' },
          { id: 'char-2-7', text: '최선을 다하는 태도' },
          { id: 'char-2-8', text: '믿음직한 태도' },
          { id: 'char-2-9', text: '뛰어난 도덕적 판단력' },
          { id: 'char-2-10', text: '뚜렷한 자기주관' },
          { id: 'char-2-11', text: '정직하고 성실함' }
        ]
      },
      {
        name: '성실과 도전',
        keywords: [
          { id: 'char-3-1', text: '끝까지 노력하는 자세' },
          { id: 'char-3-2', text: '끈기있고 도전적임' },
          { id: 'char-3-3', text: '뚜렷한 목표의식' },
          { id: 'char-3-4', text: '참을성이 강함' },
          { id: 'char-3-5', text: '차분하고 신중함' },
          { id: 'char-3-6', text: '진중하고 성숙함' },
          { id: 'char-3-7', text: '정직과 신뢰 중시' },
          { id: 'char-3-8', text: '책임감 있는 성품' },
          { id: 'char-3-9', text: '스스로 약속을 지킴' }
        ]
      }
    ]
  },
  {
    id: '학습',
    name: '학습 (Learning & Academics)',
    description: '수업 태도, 문제 해결력, 교과 흥미에 관한 키워드입니다.',
    colorTheme: {
      primary: 'indigo',
      bg: 'bg-indigo-50',
      text: 'text-indigo-800',
      border: 'border-indigo-200',
      badge: 'bg-indigo-50 text-indigo-800 border-indigo-200 hover:bg-indigo-100',
      badgeSelected: 'bg-indigo-500 text-white border-indigo-500 shadow-md shadow-indigo-200',
      accent: 'indigo-500'
    },
    subCategories: [
      {
        name: '수업 태도',
        keywords: [
          { id: 'learn-1-1', text: '학습 이해력 우수' },
          { id: 'learn-1-2', text: '수업 집중도가 높음' },
          { id: 'learn-1-3', text: '질문과 답변 활동 우수' },
          { id: 'learn-1-4', text: '학습 계획 수립 철저' },
          { id: 'learn-1-5', text: '선생님 말씀 경청' },
          { id: 'learn-1-6', text: '기본 개념 이해 우수' },
          { id: 'learn-1-7', text: '높은 학업 성취' },
          { id: 'learn-1-8', text: '성실한 학습 준비' },
          { id: 'learn-1-9', text: '배움에 대한 열정' }
        ]
      },
      {
        name: '문제 해결',
        keywords: [
          { id: 'learn-2-1', text: '성실한 과제 수행' },
          { id: 'learn-2-2', text: '높은 과제 집중도' },
          { id: 'learn-2-3', text: '문제에 대처하는 자세' },
          { id: 'learn-2-4', text: '높은 과제 해결력' },
          { id: 'learn-2-5', text: '문제 해결 성향 우수' },
          { id: 'learn-2-6', text: '자기주도적 학습태도' },
          { id: 'learn-2-7', text: '이해의 깊이가 남다름' },
          { id: 'learn-2-8', text: '높은 지적 탐구심' },
          { id: 'learn-2-9', text: '논리적인 사고' },
          { id: 'learn-2-10', text: '효율적인 문제해결' }
        ]
      },
      {
        name: '학습 흥미 및 성취',
        keywords: [
          { id: 'learn-3-1', text: '우수한 학업 적성' },
          { id: 'learn-3-2', text: '학습에 대한 적극성' },
          { id: 'learn-3-3', text: '전 교과 성적 우수' },
          { id: 'learn-3-4', text: '수업 참여의 적극성' },
          { id: 'learn-3-5', text: '높은 학업 성취도' },
          { id: 'learn-3-6', text: '학습의 깊이와 집중' },
          { id: 'learn-3-7', text: '높은 학습 의욕' }
        ]
      },
      {
        name: '독서와 교과 활동',
        keywords: [
          { id: 'learn-4-1', text: '다양한 장르의 독서' },
          { id: 'learn-4-2', text: '높은 독서 집중력' },
          { id: 'learn-4-3', text: '정독과 속독의 조화' },
          { id: 'learn-4-4', text: '깊은 책 탐구 성향' },
          { id: 'learn-4-5', text: '독서에 대한 깊은 관심' },
          { id: 'learn-4-6', text: '논리적인 글쓰기' },
          { id: 'learn-4-7', text: '창의적이고 유연한 글' },
          { id: 'learn-4-8', text: '뛰어난 어휘력과 표현력' },
          { id: 'learn-4-9', text: '뛰어난 수학적 능력' },
          { id: 'learn-4-10', text: '과학적 질문과 호기심' },
          { id: 'learn-4-11', text: '뛰어난 과학적 사고력' }
        ]
      },
      {
        name: '자기관리',
        keywords: [
          { id: 'learn-5-1', text: '완벽을 기하는 성품' },
          { id: 'learn-5-2', text: '철저한 자기관리' },
          { id: 'learn-5-3', text: '효율적인 시간관리' },
          { id: 'learn-5-4', text: '책임감 있는 자세' },
          { id: 'learn-5-5', text: '의견을 조화롭게 제안' },
          { id: 'learn-5-6', text: '친구에게 도움 주는 조언' },
          { id: 'learn-5-7', text: '스스로의 약속 준수' }
        ]
      }
    ]
  }
];

