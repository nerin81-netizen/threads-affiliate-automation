/**
 * 검색어 순위 -> 게시물 아이디어 생성기
 *
 * 종합점수(score)는 "쓸지 말지"만 알려준다. 무엇을 쓸지는 하위 신호의 조합이 정한다.
 *   naver  = 검색 수요 (사람들이 답을 찾고 있음)
 *   google = 시의성   (지금 화제, 내일이면 죽음)
 *   threads = 공급량  (스레드에 이미 깔린 글 수)
 *
 * 수요 대비 공급이 비어있는 자리(블루오션)가 최고의 아이디어 자리다.
 * buildOpportunities의 점수식은 threads.count가 낮으면 총점을 깎기 때문에,
 * 블루오션 키워드는 종합순위에서 오히려 아래로 밀린다. 이 스크립트가 그걸 건져낸다.
 *
 *   node scripts/idea_from_trends.mjs 가성비,핫딜,쿠폰,선물,특가
 *   node scripts/idea_from_trends.mjs --demo     # 네트워크 없이 분류 로직 자체검증
 */
import { pathToFileURL } from 'url';
import {
  getGoogleTrending,
  getNaverKeywordTrends,
  searchThreadsKeyword,
  buildOpportunities,
  normalizeKeywords
} from './trend_research.mjs';

// 스레드 검색 결과가 이 이상이면 포화, 이 미만이면 비어있음으로 본다.
// ponytail: 상수 2개로 시작. 실측 2주 뒤 카테고리별로 갈라야 하면 그때 나눈다.
const CROWDED = 15;
const EMPTY = 5;

const PLAYBOOK = {
  블루오션: {
    priority: 1,
    angle: '검색 수요는 있는데 스레드에 글이 없다. 정보를 통째로 정리해서 선점',
    hookType: '숫자',
    mediaType: '이미지',
    why: '경쟁 글이 없어 저장·공유가 그대로 내 계정에 쌓인다'
  },
  시의성: {
    priority: 2,
    angle: '지금 급상승 중. 오늘 안에 발행하지 않으면 가치 소멸',
    hookType: '리스트',
    mediaType: '텍스트',
    why: '속도가 전부라 제작비 낮은 텍스트로 즉시 발행'
  },
  레드오션: {
    priority: 3,
    angle: '수요도 경쟁도 많다. 같은 주제를 반대 각도로 비틀어야만 보인다',
    hookType: '역설',
    mediaType: '텍스트',
    why: '정보로는 못 이기고, 통념을 뒤집는 관점으로만 차별화된다'
  },
  틈새: {
    priority: 4,
    angle: '수요가 잔잔하다. 정보보다 공감으로 접근',
    hookType: '고백',
    mediaType: '텍스트',
    why: '검색 유입이 약하므로 댓글·라포로 도달을 만든다'
  },
  보류: {
    priority: 9,
    angle: '신호 부족. 이번 주는 쓰지 않는다',
    hookType: '-',
    mediaType: '-',
    why: '억지로 쓰면 참여율만 깎인다'
  }
};

const HOOK_SEEDS = {
  숫자: kw => `${kw} 관련해서 실제로 써보고 남은 것만 5개 정리했어요`,
  리스트: kw => `지금 ${kw} 상황 정리해봤어요, 필요한 분만 저장하세요`,
  역설: kw => `${kw} 열심히 따지다가 오히려 손해 본 이야기입니다`,
  고백: kw => `${kw} 때문에 저지른 실수 하나 고백할게요`,
  밸런스: kw => `${kw} 기준으로 A vs B, 여러분은 뭐 고르실래요?`,
  빈칸: kw => `저는 ______ 살 때만큼은 ${kw} 안 따집니다`,
  '-': () => '-'
};

/** 순위 항목 하나를 갭 타입으로 분류한다. */
export function classifyGap(op) {
  const naverHot = Boolean(op.naver && op.naver.change > 10);
  const naverKnown = Boolean(op.naver);
  const googleHot = Boolean(op.google);
  const count = op.threads ? op.threads.count : null;
  const crowded = count !== null && count >= CROWDED;
  const empty = count !== null && count < EMPTY;

  if (naverHot && empty) return '블루오션';
  if (googleHot && !crowded) return '시의성';
  if (naverHot && crowded) return '레드오션';
  if (naverKnown) return '틈새';
  return '보류';
}

/** buildOpportunities 결과 -> 발행 아이디어 목록 (우선순위 정렬) */
export function buildIdeas(opportunities) {
  return opportunities
    .map(op => {
      const gap = classifyGap(op);
      const play = PLAYBOOK[gap];
      return {
        keyword: op.keyword,
        score: op.score,
        grade: op.grade,
        gap,
        priority: play.priority,
        angle: play.angle,
        hookType: play.hookType,
        mediaType: play.mediaType,
        why: play.why,
        hookSeed: HOOK_SEEDS[play.hookType](op.keyword),
        signal: op.reason
      };
    })
    .sort((a, b) => a.priority - b.priority || b.score - a.score);
}

function render(ideas) {
  for (const idea of ideas) {
    console.log(`\n[${idea.gap}] ${idea.keyword}  (종합 ${idea.score} · ${idea.grade})`);
    console.log(`  신호   : ${idea.signal}`);
    console.log(`  앵글   : ${idea.angle}`);
    console.log(`  포맷   : ${idea.mediaType} × ${idea.hookType}형 — ${idea.why}`);
    console.log(`  훅 시드: ${idea.hookSeed}`);
  }
  console.log('\n※ 훅 시드는 초안입니다. 그대로 발행하지 말고 본인 경험으로 채워 쓰세요.');
}

function demo() {
  const fixture = [
    { keyword: '블루', score: 70, grade: '지금 작성', reason: 'x', naver: { change: 40 }, google: null, threads: { count: 2 } },
    { keyword: '레드', score: 80, grade: '지금 작성', reason: 'x', naver: { change: 40 }, google: null, threads: { count: 30 } },
    { keyword: '시의', score: 60, grade: '관찰 후보', reason: 'x', naver: null, google: { rank: 3 }, threads: { count: 6 } },
    { keyword: '틈새', score: 50, grade: '관찰 후보', reason: 'x', naver: { change: 2 }, google: null, threads: { count: 8 } },
    { keyword: '없음', score: 20, grade: '보류', reason: 'x', naver: null, google: null, threads: null }
  ];
  const got = fixture.map(classifyGap);
  const want = ['블루오션', '레드오션', '시의성', '틈새', '보류'];
  console.assert(JSON.stringify(got) === JSON.stringify(want), `분류 실패: ${got}`);

  // 종합점수가 낮아도 블루오션이 레드오션보다 위로 올라와야 한다 (이 스크립트의 존재 이유)
  const ideas = buildIdeas(fixture);
  console.assert(ideas[0].keyword === '블루', `우선순위 실패: 1위가 ${ideas[0].keyword}`);
  console.assert(ideas.at(-1).keyword === '없음', '보류가 마지막이 아님');

  console.log('self-check 통과 —', got.join(' / '));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--demo')) return demo();

  const keywords = normalizeKeywords(args.filter(a => !a.startsWith('--')).join(','));
  if (!keywords.length) {
    console.error('사용법: node scripts/idea_from_trends.mjs 가성비,핫딜,쿠폰 [--threads]');
    process.exit(1);
  }

  const [g, n] = await Promise.allSettled([getGoogleTrending(), getNaverKeywordTrends(keywords)]);
  const googleTrends = g.status === 'fulfilled' ? g.value : [];
  const naverTrends = n.status === 'fulfilled' ? n.value : [];
  if (g.status === 'rejected') console.error(`⚠ Google 조회 실패: ${g.reason.message}`);
  if (n.status === 'rejected') console.error(`⚠ NAVER 조회 실패: ${n.reason.message}`);

  // 스레드 공급량 조회는 브라우저를 띄우므로 느리다. 갭 판정의 핵심이라 기본 ON.
  let threadsResults = [];
  if (!args.includes('--no-threads')) {
    const checks = await Promise.allSettled(keywords.map(searchThreadsKeyword));
    threadsResults = checks.filter(c => c.status === 'fulfilled').map(c => c.value);
  } else {
    console.error('⚠ --no-threads: 공급량 미조회 → 블루/레드오션 구분 불가');
  }

  const ideas = buildIdeas(buildOpportunities(keywords, googleTrends, naverTrends, threadsResults));
  if (args.includes('--json')) console.log(JSON.stringify(ideas, null, 2));
  else render(ideas);
}

// 직접 실행할 때만 CLI를 돈다. 이 가드가 없으면 server.mjs 가 import 하는 순간
// CLI가 실행되면서 사용법을 찍고 process.exit 해버려 서버가 뜨지 않는다.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => {
    console.error(`실패: ${e.message}`);
    process.exit(1);
  });
}
