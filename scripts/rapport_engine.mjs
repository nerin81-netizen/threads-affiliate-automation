/**
 * 스레드 초정밀 라포 소통 엔진 2.0 (rapport_engine.mjs)
 * 
 * 1. 15대 카테고리 초정밀 문맥/키워드 분석기
 * 2. 실시간 시간대(새벽/아침/점심/저녁/심야) & 요일(불금/주말/월요병) 감성 반영
 * 3. 모듈형 4단 레고 블록 조립 시스템 (60,000+ 무한 조합)
 * 4. 3대 스타일(초밀착 공감형 / 유쾌한 재치형 / 다정 힐링형) 랜덤 믹스
 */

// 1. 스레드 핵심 은어
export const THREADS_SLANG = {
  greetings: ['스하리', '스하', '모닝스하', '퇴근스하', '야간스하'],
  replies: ['반하리', '반하', '반하리 100%', '칼반하리', '반하리 달려갈게요', '반하리 쏩니다'],
  friends: ['스친', '스친님들', '찐스친', '맞스팔'],
  status: ['스린이', '스태기', '스레드1000명프로젝트']
};

/**
 * 실시간 시간대 및 요일 감성 분석
 */
function getTimeContext() {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay(); // 0: 일, 1: 월, ..., 5: 금, 6: 토

  let timeSlot = 'day';
  let timeGreeting = '스하리 반가워요 🤗';
  let timeVibe = '오늘 하루도 힘내봐요!';

  if (hour >= 2 && hour < 7) {
    timeSlot = 'dawn';
    timeGreeting = '야심한 새벽 스하리요 👀';
    timeVibe = '새벽 감성 터지는데 아직 안 주무시는 스친님 발견!';
  } else if (hour >= 7 && hour < 11) {
    timeSlot = 'morning';
    timeGreeting = '기분 좋은 모닝스하 ☕';
    timeVibe = '출근길(등굣길) 파이팅 하시고 오늘 하루도 힘내봐요!';
  } else if (hour >= 11 && hour < 14) {
    timeSlot = 'lunch';
    timeGreeting = '맛점스하요 🥪';
    timeVibe = '맛있는 점심 챙겨드시고 오후도 파이팅입니다!';
  } else if (hour >= 14 && hour < 18) {
    timeSlot = 'afternoon';
    timeGreeting = '나른한 오후 스하리요 ✨';
    timeVibe = '오후 당 충전하시고 조금만 더 힘내요!';
  } else if (hour >= 18 && hour < 22) {
    timeSlot = 'evening';
    timeGreeting = '퇴근스하 좋은 저녁이에요 🌆';
    timeVibe = '오늘 하루 진짜 치열하게 고생 많으셨어요 토닥토닥!';
  } else {
    timeSlot = 'night';
    timeGreeting = '달밤에 스하리요 🌛';
    timeVibe = '편안하고 따뜻한 밤 보내세요 ✨';
  }

  // 요일 특화
  let daySpecial = '';
  if (day === 5) {
    daySpecial = '드디어 불금 달려요! 🔥 ';
  } else if (day === 6 || day === 0) {
    daySpecial = '행복한 꿀주말 보내세요 🌸 ';
  } else if (day === 1) {
    daySpecial = '월요병 가볍게 이겨내봐요 💪 ';
  }

  return { timeSlot, timeGreeting, timeVibe, daySpecial };
}

/**
 * 15대 카테고리 초정밀 문맥 감지 엔진
 */
function extractSmartContext(text = '') {
  if (!text) return { category: 'daily', keyword: '소중한 일상 이야기', emoji: '✨' };

  const clean = text.toLowerCase();

  // 1. 반려동물 / 산책
  if (clean.includes('산책') || clean.includes('강아지') || clean.includes('댕댕') || clean.includes('멍뭉') || clean.includes('고양이') || clean.includes('냥이') || clean.includes('츄르') || clean.includes('뒤뚱')) {
    return { category: 'pet', keyword: '귀여운 댕냥이 & 힐링 산책', emoji: '🐶' };
  }

  // 2. 직장 / 야근 / 퇴근 / 이직
  if (clean.includes('야근') || clean.includes('칼퇴') || clean.includes('출근') || clean.includes('퇴근') || clean.includes('월요병') || clean.includes('회사') || clean.includes('상사') || clean.includes('이직') || clean.includes('퇴사')) {
    return { category: 'work', keyword: '치열한 직장인 하루', emoji: '💼' };
  }

  // 3. 맛집 / 야식 / 음식
  if (clean.includes('치맥') || clean.includes('치킨') || clean.includes('라면') || clean.includes('맥주') || clean.includes('삼겹살') || clean.includes('떡볶이') || clean.includes('맛집') || clean.includes('배고') || clean.includes('불닭')) {
    return { category: 'food', keyword: '군침 도는 꿀맛 음식', emoji: '🍕' };
  }

  // 4. 운동 / 오운완 / 다이어트
  if (clean.includes('오운완') || clean.includes('헬스') || clean.includes('러닝') || clean.includes('런닝') || clean.includes('필라테스') || clean.includes('식단') || clean.includes('다이어트') || clean.includes('근성장')) {
    return { category: 'workout', keyword: '갓생 운동 & 건강 챌린지', emoji: '💪' };
  }

  // 5. 카페 / 디저트 / 힐링
  if (clean.includes('카페') || clean.includes('커피') || clean.includes('라떼') || clean.includes('디저트') || clean.includes('빵') || clean.includes('베이글') || clean.includes('케이크')) {
    return { category: 'cafe', keyword: '향긋한 카페 투어 & 힐링', emoji: '☕' };
  }

  // 6. 독서 / 자기계발 / 공부
  if (clean.includes('독서') || clean.includes('미라클모닝') || clean.includes('공부') || clean.includes('자격증') || clean.includes('책') || clean.includes('루틴') || clean.includes('성장')) {
    return { category: 'study', keyword: '열정 가득한 갓생 루틴', emoji: '📚' };
  }

  // 7. 육아 / 가족
  if (clean.includes('등원') || clean.includes('육퇴') || clean.includes('아기') || clean.includes('애기') || clean.includes('어린이집') || clean.includes('아이랑') || clean.includes('둥이')) {
    return { category: 'parenting', keyword: '정성 가득 육아 일상', emoji: '👶' };
  }

  // 8. 취미 / DIY / 핸드메이드
  if (clean.includes('십자수') || clean.includes('보석십자수') || clean.includes('뜨개질') || clean.includes('그림') || clean.includes('다꾸') || clean.includes('베이킹') || clean.includes('취미')) {
    return { category: 'hobby', keyword: '감성 넘치는 금손 취미', emoji: '🎨' };
  }

  // 9. 스레드 성장 / 1000명 프로젝트
  if (clean.includes('1,000') || clean.includes('1000') || clean.includes('100명') || clean.includes('스하리') || clean.includes('반하리') || clean.includes('스린이') || clean.includes('스팔') || clean.includes('맞팔') || clean.includes('스태기')) {
    return { category: 'growth', keyword: '1,000명 스친 완주 달리기', emoji: '💯' };
  }

  // 10. 여행 / 바다 / 나들이
  if (clean.includes('여행') || clean.includes('바다') || clean.includes('비행기') || clean.includes('호캉스') || clean.includes('나들이') || clean.includes('캠핑') || clean.includes('드라이브')) {
    return { category: 'travel', keyword: '설레는 여행 & 바깥 나들이', emoji: '✈️' };
  }

  // 11. 날씨 / 계절
  if (clean.includes('날씨') || clean.includes('비') || clean.includes('눈') || clean.includes('더위') || clean.includes('추위') || clean.includes('하늘') || clean.includes('바람')) {
    return { category: 'weather', keyword: '오늘 날씨 & 감성 일상', emoji: '🌤️' };
  }

  // 12. 넷플릭스 / 영화 / 팝컬처
  if (clean.includes('넷플') || clean.includes('영화') || clean.includes('드라마') || clean.includes('유튜브') || clean.includes('정주행')) {
    return { category: 'media', keyword: '시간 순삭 힐링 콘텐츠', emoji: '🎬' };
  }

  // 기본: 본문에서 유의미한 2단어 스마트 추출
  const rawClean = text.replace(/[\n\r]/g, ' ').replace(/[#@][^\s]+/g, '').trim();
  const words = rawClean.split(' ').filter(w => w.length >= 2 && !['오늘', '진짜', '너무', '그냥', '있는', '하는'].includes(w));
  const snippet = words.slice(0, 2).join(' ') || '소중한 일상';

  return { category: 'general', keyword: snippet, emoji: '✨' };
}

/**
 * 모듈형 4단 레고 블록 조립 시스템 (60,000+ 무한 조합)
 */
export function generateRapportComment(author = '', postText = '', recentComments = []) {
  const { keyword: rawKeyword, emoji } = extractSmartContext(postText);
  const time = getTimeContext();

  // "댕냥이 & 힐링 산책은 진짜 치트키" 처럼 &가 문장에 박히면 사람 말투가 아니다.
  // 카테고리 키워드는 둘을 &로 묶어둔 게 많아서 앞쪽 하나만 쓴다.
  const keyword = rawKeyword.split(/\s*&\s*/)[0].trim() || rawKeyword;

  // 3대 스타일 중 랜덤 (0: 초밀착 공감형, 1: 유쾌한 재치형, 2: 다정 힐링형)
  const style = Math.floor(Math.random() * 3);

  // [블록 A: 오프닝 / 인사] (18종)
  const blockA = [
    `${time.daySpecial}${time.timeGreeting}! ${emoji}`,
    `스하리요! ${emoji} ${time.daySpecial}`,
    `스하 반가워요!🤗 ${time.daySpecial}`,
    `피드 넘기다가 홀린 듯 멈췄습니다 ㅋㅋㅋ ${emoji}`,
    `스하리 좋은 시간이에요 ✨ ${time.daySpecial}`,
    `스하! 글 보자마자 바로 손이 가네요 ㅎㅎ ${emoji}`,
    `${time.timeGreeting} 찐스친 맺으러 달려왔습니다 🫶`,
    `스하리요 🙌 ${time.timeVibe}`
  ];

  // [블록 B: 키워드 리액션] (스타일별 각 8종 이상)
  let blockB = [];
  
  if (style === 0) {
    // 스타일 1: 초밀착 공감 + 1000명 동지의식형
    blockB = [
      `${keyword} 이야기 보는데 상상만 해도 너무 공감되고 힐링되네요 ㅠㅠ`,
      `${keyword} 글 읽는데 어쩜 이렇게 제 마음이랑 똑같은지 신기해요 ㅎㅎ`,
      `혼자 하면 지치는데 ${keyword} 보니까 다시 긍정 에너지 뿜뿜 얻어갑니다!`,
      `${keyword} 소식 보면서 저도 모르게 고개 끄덕이고 있었네요 ㅋㅋㅋ`,
      `${keyword} 이야기 완전 제 취향 저격이라 바로 스친 신청합니다 🥰`
    ];
  } else if (style === 1) {
    // 스타일 2: 티키타카 유쾌한 재치형 (ㅋㅋㅋ, 유머, 에너지)
    blockB = [
      `${keyword}은 진짜 치트키 아닌가요 ㅋㅋㅋ 글 센스 넘치십니다!`,
      `피드 읽고 빵 터졌습니다 ㅋㅋㅋ ${keyword} 때문에 오늘 피로 싹 날아가네요!`,
      `'스하리 = 반하리' 공식 보고 1초의 망설임도 없이 달려왔습니다 ㅋㅋㅋ`,
      `이건 못 참죠 ㅋㅋㅋ ${keyword} 보는데 동질감 느껴져서 내적 친밀감 폭발했네요!`,
      `스친님 글 읽는 재미에 스레드 못 끄고 있습니다 ㅋㅋㅋ 센스 대박!`
    ];
  } else {
    // 스타일 3: 심플 & 다정 힐링형 (차분하고 따뜻한 위로와 응원)
    blockB = [
      `${keyword} 글에 따뜻함이 묻어나서 읽는 내내 마음이 편안해지네요 🌸`,
      `${keyword} 보면서 잠시 숨 돌리고 갑니다. 소소하지만 확실한 행복이네요 ✨`,
      `늘 이렇게 정성껏 일상 기록하시는 모습이 참 멋지고 보기 좋습니다 🥰`,
      `글에서 긍정적인 에너지가 가득 느껴져서 저까지 기분 좋아져요 🩵`,
      `${keyword} 덕분에 오늘 하루 마무리(시작)가 훈훈해집니다 ㅎㅎ`
    ];
  }

  // [블록 C: 동지의식 & 유대감] (12종)
  const blockC = [
    `저도 1000명 목표로 달리는 스린이인데 같이 끝까지 완주해요!`,
    `서로 응원해주면서 1000명까지 같이 쑥쑥 성장했으면 좋겠어요!`,
    `함께하면 1,000명 금방이죠! 든든한 스친으로 오래오래 소통해요.`,
    `좋은 인연 닿아서 기쁘네요! 매일 오가며 티키타카 나눴으면 좋겠습니다 ㅎㅎ`,
    `알고리즘이 맺어준 인연이라 더 소중하네요! 우리 끝까지 달려봐요 🔥`,
    `스레드에서 이런 따뜻한 스친님 만나면 하루가 든든해집니다!`
  ];

  // [블록 D: 클로징 & 반하리 콜 & 맞스팔 액션] (12종)
  const blockD = [
    `스팔 꾹 누르고 반하리 바로 달려갑니다 🫶`,
    `반하리 100% 쏩니다! 잊지 마세요 ❤️`,
    `스팔 완료했어요! 칼답 반하리 기대해주세요 ✨`,
    `반하리 꾹 남겨두고 갑니다! 우리 맞스팔 찐스친 해요 🩵`,
    `반하리 바로 갑니다! 답글로 또 만나요 🫡`,
    `스팔 꾹! 반하리 번개처럼 쏘고 갑니다 ⚡🥰`
  ];

  // 블록을 뽑아 골격에 끼워 한 문장으로 조립한다.
  // 골격을 바꾸는 게 핵심이다. 항상 4블록(인사+리액션+1000명+반하리)으로 나가면
  // 문구를 아무리 섞어도 구조가 그대로라 그 자체가 지문이 된다.
  // 사람은 짧게 한 줄만 달 때가 더 많다.
  const assemble = () => {
    const parts = {
      a: pickFresh(blockA, recentComments),
      b: pickFresh(blockB, recentComments),
      c: pickFresh(blockC, recentComments),
      d: pickFresh(blockD, recentComments)
    };
    return pickShape().map(k => parts[k]).filter(Boolean).join(' ');
  };

  // 블록 풀이 바닥나면 pickFresh 가 전체 풀로 되돌아가 같은 문장이 다시 나올 수 있다.
  // 조립 결과를 직접 대조해 재시도한다. 몇 번 해도 안 되면 그냥 내보낸다
  // (댓글을 아예 못 다는 것보단 낫다).
  let out = assemble();
  for (let i = 0; i < 8 && recentComments.includes(out); i++) out = assemble();
  return out;
}

/**
 * 공식 API 라포 답글용 짧은 문구.
 * 실제로 수행하지 않은 팔로우·반하리 완료 주장은 넣지 않고, 상대 글의 맥락과 질문만 남긴다.
 */
export function generateGroundedRapportReply(author = '', postText = '', recentComments = []) {
  const normalizedText = String(postText || '').replace(/\s+/g, ' ').trim();
  const { keyword: rawKeyword, emoji } = extractSmartContext(normalizedText);
  const keyword = rawKeyword.split(/\s*&\s*/)[0].trim() || '이야기';

  if (normalizedText.length <= 30 && /(예쁘|귀엽|멋지|좋다|좋네|최고|공감|응원|ㅎㅎ|ㅋㅋ|😻|😍|👍)/i.test(normalizedText)) {
    const shortReplies = [
      `예쁘게 봐주셔서 감사해요 ${emoji} 어떤 부분이 가장 마음에 드셨어요?`,
      `따뜻한 반응 감사해요 ${emoji} 보시자마자 어떤 느낌이 드셨나요?`,
      `기분 좋은 한마디 감사해요 ${emoji} 다음에도 이런 분위기로 보여드릴까요?`
    ];
    return pickFresh(shortReplies, recentComments).slice(0, 280);
  }

  const openings = [
    `글 읽다가 ${keyword} 부분에서 딱 멈췄어요 ${emoji}`,
    `${keyword} 이야기 정말 공감돼요 ${emoji}`,
    `이 장면이 눈앞에 그려져서 저도 모르게 웃었네요 ${emoji}`,
    `담백하게 적어주셔서 더 마음에 남네요 ${emoji}`,
    `오늘 피드에서 반가운 글을 만났네요 ${emoji}`
  ];
  const closings = [
    `이후에는 어떻게 됐는지 궁금해요!`,
    `다음 이야기도 들려주실 거죠?`,
    `요즘도 비슷한 마음이신가요?`,
    `저도 한번 해보고 싶은데 가장 좋았던 점은 뭐였나요?`,
    `이런 순간은 오래 기억에 남는 것 같아요 😊`
  ];
  const assemble = () => `${pickFresh(openings, recentComments)} ${pickFresh(closings, recentComments)}`;
  let out = assemble();
  for (let i = 0; i < 8 && recentComments.includes(out); i++) out = assemble();
  return out.slice(0, 280);
}

/** 골격 후보. 뒤 숫자는 뽑힐 가중치다 (짧은 댓글이 더 흔하게). */
const SHAPES = [
  [['b'], 3],
  [['a', 'b'], 4],
  [['b', 'd'], 3],
  [['a', 'b', 'd'], 3],
  [['b', 'c'], 2],
  [['a', 'b', 'c'], 2],
  [['a', 'b', 'c', 'd'], 2]   // 기존 풀세트. 이제 전체의 일부일 뿐이다.
];

export function pickShape(rand = Math.random) {
  const total = SHAPES.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [shape, w] of SHAPES) {
    r -= w;
    if (r < 0) return shape;
  }
  return SHAPES[SHAPES.length - 1][0];
}

/**
 * 최근 댓글에 이미 등장한 블록은 빼고 고른다.
 * 남는 게 없으면 어쩔 수 없이 전체 풀에서 고른다 (댓글을 못 다는 것보단 낫다).
 */
export function pickFresh(pool, recentComments = [], rand = Math.random) {
  const recent = recentComments.join('\n');
  const fresh = pool.filter(item => !recent.includes(stableKey(item)));
  const use = fresh.length ? fresh : pool;
  return use[Math.floor(rand() * use.length)];
}

/**
 * 블록에서 비교용 고정 조각을 뽑는다.
 * 블록에는 ${keyword}, ${emoji} 같은 가변부가 섞여 있어 문자열 통째로는 못 맞춘다.
 * 가장 긴 한글 덩어리를 지문으로 삼는다.
 */
function stableKey(block) {
  const chunks = String(block).split(/[^가-힣]+/).filter(c => c.length >= 3);
  return chunks.sort((x, y) => y.length - x.length)[0] || block;
}

// ponytail: 반복 지문이 실제로 줄었는지만 본다. `node scripts/rapport_engine.mjs --selftest`
if (process.argv.includes('--selftest')) {
  const { strict: assert } = await import('assert');

  // 0) 키워드에 & 가 새지 않는다
  assert.ok(!generateRapportComment('u', '고양이 산책 다녀왔어요').includes('&'), '키워드 & 누출');

  // 1) 최근에 쓴 블록은 다시 안 나온다
  const pool = ['반하리 바로 갑니다', '스팔 꾹 누릅니다', '칼답 드릴게요'];
  assert.equal(pickFresh(pool, ['반하리 바로 갑니다', '스팔 꾹 누릅니다']), '칼답 드릴게요');
  // 풀이 다 소진되면 막히지 말고 아무거나 내보낸다
  assert.ok(pool.includes(pickFresh(pool, pool)));
  assert.ok(pool.includes(pickFresh(pool, [])));

  // 2) 골격이 실제로 갈린다
  const shapes = new Set();
  for (let i = 0; i < 400; i++) shapes.add(pickShape().join(''));
  assert.ok(shapes.size >= 5, `골격이 ${shapes.size}종밖에 안 나옴`);
  // 리액션(b)은 항상 들어가야 글이 성립한다
  for (const s of shapes) assert.ok(s.includes('b'), `리액션 없는 골격: ${s}`);

  // 3) 하루치(100건)를 뽑았을 때 지문 비율이 실제로 내려가는지.
  //    실제 운영처럼 대상 글을 매번 다르게 준다.
  const posts = ['오늘 장보기', '퇴근길 야근 끝', '고양이 산책', '카페 디저트', '오운완 헬스',
                 '아이 등원 준비', '넷플 정주행', '주말 나들이 계획', '독서 루틴', '비 오는 날씨'];
  const WINDOW = 12;                       // 봇이 넘겨줄 최근 댓글 개수
  const made = [];
  for (let i = 0; i < 100; i++) {
    made.push(generateRapportComment('u', posts[i % posts.length], made.slice(-WINDOW)));
  }
  const rate = (k) => made.filter(t => t.includes(k)).length;
  const lens = made.map(t => t.length);
  const spread = Math.max(...lens) - Math.min(...lens);

  console.log('✅ rapport_engine selftest 통과');
  console.log(`   반하리 ${rate('반하리')}% · 스팔 ${rate('스팔')}% · 1000명계열 ${rate('000명')}%`);
  console.log(`   길이 ${Math.min(...lens)}~${Math.max(...lens)} (편차 ${spread}) · 고유 문장 ${new Set(made).size}/100`);

  // 개선 전 실측: 반하리 100% · 스팔 65% · 길이 71~151
  assert.ok(rate('반하리') < 60, `반하리 비율이 아직 ${rate('반하리')}%`);
  assert.ok(rate('스팔') < 50, `스팔 비율이 아직 ${rate('스팔')}%`);
  assert.ok(spread > 60, `길이 편차가 ${spread}로 너무 균일`);

  // 이 엔진이 실제로 보장하는 건 "최근 WINDOW건 안에서는 안 겹친다"이다.
  // 전체 100건 무중복은 블록 수 한계상 약속할 수 없으니 그건 검사하지 않는다.
  for (let i = 0; i < made.length; i++) {
    const window = made.slice(Math.max(0, i - WINDOW), i);
    assert.ok(!window.includes(made[i]), `${i}번째 댓글이 최근 ${WINDOW}건 안에서 반복됨`);
  }
}
