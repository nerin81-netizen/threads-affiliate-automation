/**
 * 게시물 품질 검사기 — AI 티와 유입 구조를 정적으로 점검한다.
 *
 * 근거 문서 2개를 규칙으로 옮긴 것이다.
 *   - 2026-07-26_리뷰-사람처럼-작성하기.md : AI 문체 감별 3종 (추상어 / 짧은 문장 나열 / 어미 반복)
 *   - 2026-07-20_스레드_조회수를_높이는_7단계_AI_글쓰기_구조.md : 댓글 유도 마무리, 저장 가치
 *
 * LLM을 부르지 않는다. 전부 정규식과 문장 통계라 공짜이고 즉시 끝난다.
 * ponytail: 문체 판정은 원래 애매한 일이라 정확도보다 재현성을 택했다.
 *           오탐이 거슬리면 임계값(THRESHOLD)만 올리면 된다.
 */

/**
 * 두 문서의 규칙을 프롬프트 문자열로 옮긴 것. story_writer 와 vault_generator 가 같이 쓴다.
 * 검사기(scorePost)와 짝이라서, 여기 규칙을 고치면 검사 규칙도 같이 봐야 한다.
 */
export const WRITING_RULES = `[AI 티 제거 — 2026-07-26 리뷰 문서 규칙]
- 추상어 금지: 품격, 새로운 기준, 진정한, 혁신, 가치를 더하다, 그 이상의.
  두루뭉술한 말 대신 읽는 사람이 원하는 구체적인 환상·돈·시간으로 바꿔라.
  (X) "당신의 품격을 위해"  (O) "20% 쿠폰이 붙어 있어서"
- 금지 문형: "A는 B가 아니라 C다", "이것은 ~가 아닙니다", "~의 시작입니다", "새로운 시대를 여는 선언".
- 짧은 문장을 3개 이상 연달아 나열하지 마라. 같은 대상을 가리키는 문장은 하나로 합쳐라.
  (X) "첫인상은 옷에서 결정됩니다. 소재 좋은 블랙 수트 한 벌. 준비하세요."
  (O) "좋은 소재 블랙 수트 한 벌이 첫인상을 결정하죠."
- 어미를 다양하게. "~입니다"만 반복하는 것도, "~해요"와 정확히 반반 섞는 것도 AI 티가 난다.
  "~죠", "~더라고요", "~네요", "~까요"를 섞어라.

[마무리 — 2026-07-20 7단계 문서 규칙]
- 마지막 줄은 반드시 읽는 사람이 자기 경험을 답할 수 있는 질문으로 닫는다.
  물음표 없이 끝나면 그 글은 실패다. 댓글이 붙어야 추천 피드가 돈다.
- 해시태그는 롱테일 소비어(#통신비절약) 말고 대형 정체성어(#직장인 #학부모 #40대)를 1개 이상 넣어라.`;

/**
 * 문장 단위로 자른다. 해시태그 줄은 문체 판정에서 제외한다.
 * "...어떠세요? 🥲" 처럼 물음표 뒤에 이모지가 오면 그 조각이 문장으로 세어져
 * 짧은 문장·어미 반복 판정을 둘 다 오염시킨다. 글자가 없는 조각은 버린다.
 */
function sentences(text) {
  return String(text || '')
    .split('\n')
    .filter(line => !/^\s*#/.test(line))
    .join('\n')
    .split(/(?<=[.!?…])\s+|\n+/)
    .map(s => s.trim())
    .filter(s => /[가-힣a-zA-Z0-9]/.test(s));
}

/** 문장의 종결 어미를 대표 형태로 뭉뚱그린다. */
function endingOf(sentence) {
  const s = sentence.replace(/[)\]"'`~!?.…\s]+$/g, '');
  if (/(습니다|입니다|ㅂ니다)$/.test(s)) return '입니다';
  if (/(했어요|해요|에요|예요|어요|아요|네요|세요|죠|고요)$/.test(s)) return '해요';
  if (/(다|라|냐|자)$/.test(s)) return '평서반말';
  if (/[가-힣]$/.test(s)) return '명사형';
  return '기타';
}

const RULES = [
  {
    type: 'ai_pattern',
    severity: 'block',
    hint: '"A가 아니라 B" · "~가 아닙니다" · <선언>형 마무리는 AI 문체의 대표 지문이다.',
    test: (s) => /(이것은|저것은|그것은).{0,30}(아니라|아닙니다)/.test(s)
      || /(가|이|은|는)\s*아니라,?\s*.{0,20}(입니다|이다)/.test(s)
      || /(선언|시작)입니다\s*$/.test(s)
      || /새로운\s*(시대|기준|장)/.test(s)
  },
  {
    type: 'abstract_word',
    severity: 'warn',
    hint: '두루뭉술한 단어는 읽는 사람이 원하는 구체적인 환상·돈·시간으로 바꾼다.',
    test: (s) => /(품격|새로운 기준|진정한|완벽한 |특별한 순간|그 이상의|혁신|가치를 더하)/.test(s)
  }
];

/** 짧은 문장이 연달아 나열되면 AI가 쉼표로 끊어 쓴 흔적이다. */
const SHORT_LEN = 20;
const SHORT_RUN = 3;

/** 한 어미가 이 비율을 넘게 반복되면 말맛이 죽는다. */
const ENDING_RATIO = 0.6;

/** 감점 폭. 합계가 곧 점수 손실이다. */
const PENALTY = { ai_pattern: 25, abstract_word: 10, short_run: 15, ending_repeat: 15, no_question: 20 };

/**
 * 글 하나를 점검한다.
 * @returns {{score:number, flags:Array<{type,severity,sentence,hint}>}}
 */
export function scorePost(text) {
  const flags = [];
  const list = sentences(text);

  for (const s of list) {
    for (const rule of RULES) {
      if (rule.test(s)) flags.push({ type: rule.type, severity: rule.severity, sentence: s, hint: rule.hint });
    }
  }

  // 짧은 문장 연속 나열
  let run = 0;
  for (const s of list) {
    run = s.length < SHORT_LEN ? run + 1 : 0;
    if (run >= SHORT_RUN) {
      flags.push({
        type: 'short_run', severity: 'warn', sentence: s,
        hint: `${SHORT_LEN}자 미만 문장이 ${SHORT_RUN}개 이상 이어진다. 같은 대상을 가리키는 문장끼리 한 문장으로 합쳐라.`
      });
      run = 0;
    }
  }

  // 어미 반복
  if (list.length >= 3) {
    const counts = {};
    for (const s of list) counts[endingOf(s)] = (counts[endingOf(s)] || 0) + 1;
    const [top, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (n / list.length >= ENDING_RATIO) {
      flags.push({
        type: 'ending_repeat', severity: 'warn', sentence: `'${top}' 계열 ${n}/${list.length}문장`,
        hint: '어미를 다양하게 섞어라. "~입니다"와 "~해요"를 반반 섞는 것도 여전히 AI틱하다.'
      });
    }
  }

  // 댓글 유도 마무리 — 추천 피드를 움직이는 건 댓글이다
  // 물음표 뒤에 이모지나 "ㅋㅋ"가 붙는 게 이 계정의 평소 말투라
  // 줄 끝 매칭 대신 "마지막 줄에 물음표가 있는가"로 본다.
  const bodyOnly = String(text || '').split('\n').filter(l => !/^\s*#/.test(l)).join('\n').trim();
  const lastLine = bodyOnly.split('\n').filter(Boolean).pop() || '';
  if (!/[?？]/.test(lastLine)) {
    flags.push({
      type: 'no_question', severity: 'warn', sentence: lastLine,
      hint: '마지막 줄을 답하기 쉬운 질문으로 닫아라. 댓글이 붙어야 추천 피드가 돈다.'
    });
  }

  const score = Math.max(0, 100 - flags.reduce((sum, f) => sum + (PENALTY[f.type] || 5), 0));
  return { score, flags };
}

/** story_writer 의 findFabrication 과 같은 모양. block 등급만 돌려준다. */
export function findAiTells(text) {
  return scorePost(text).flags.filter(f => f.severity === 'block');
}

/** 여러 글을 한 번에 진단하고 문제 유형별 집계를 낸다. */
export function auditPosts(posts) {
  const scored = posts.map(p => ({ ...p, ...scorePost(p.postText) }));
  const byType = {};
  for (const s of scored) {
    for (const f of s.flags) byType[f.type] = (byType[f.type] || 0) + 1;
  }
  const avg = scored.length ? Math.round(scored.reduce((a, s) => a + s.score, 0) / scored.length) : 0;
  return { scored, byType, avg, total: scored.length };
}

// ponytail: 검사 기준이 된 문서의 Before/After 예문을 그대로 정답지로 쓴다.
if (process.argv.includes('--selftest')) {
  const { strict: assert } = await import('assert');

  // 리뷰 문서의 실제 Before(AI) / After(사람) 쌍 — 사람 글이 더 높아야 한다
  const before = '중요한 자리일수록, 첫인상은 옷에서 결정됩니다. 소재 좋은 블랙 수트 한 벌. 이것은 단순한 구매가 아니라, 차란이 직접 검수한 품격의 시작입니다.';
  const after = '중요한 자리일수록, 좋은 소재의 블랙 수트 한 벌이 당신의 첫인상을 결정하죠. 차란이 직접 검수한 백화점 브랜드로 준비해 보시는 건 어떠세요?';
  assert.ok(scorePost(before).score < scorePost(after).score, '사람이 고친 글이 더 낮게 나옴');

  // 문서가 대표 지문으로 짚은 문장
  assert.ok(findAiTells('이것은 새로운 시대를 여는 선언입니다.').length > 0, '<선언>형 마무리 미탐지');
  assert.ok(findAiTells('이것은 소비가 아니라 투자입니다.').length > 0, '"A가 아니라 B" 미탐지');
  assert.equal(findAiTells('어제 마트에서 두부 값 보고 좀 놀랐어요. 다들 어떠세요?').length, 0, '정상 글 오탐');

  // 짧은 문장 나열
  const choppy = scorePost('첫인상이 중요해요.\n옷이 말해요.\n수트 한 벌.\n준비하세요.');
  assert.ok(choppy.flags.some(f => f.type === 'short_run'), '짧은 문장 나열 미탐지');
  // 물음표 뒤 이모지가 문장으로 세어지면 짧은 문장·어미 반복이 둘 다 오탐난다
  assert.equal(scorePost('어제 장 보고 왔어요.\n두부값 다들 어떠세요? 🥲\n\n#장보기').score, 100,
    '꼬리 이모지가 문장으로 세어짐');

  // 어미 반복
  const monotone = scorePost('오늘은 장을 봤습니다. 두부가 비쌌습니다. 그래서 그냥 나왔습니다.');
  assert.ok(monotone.flags.some(f => f.type === 'ending_repeat'), '어미 반복 미탐지');

  // 댓글 유도 질문 유무
  const noQ = (t) => scorePost(t).flags.some(f => f.type === 'no_question');
  assert.ok(noQ('장 보고 왔어요. 두부값이 올랐네요.'));
  assert.ok(!noQ('장 보고 왔어요.\n두부값 다들 어떠세요?\n\n#장보기'), '해시태그 줄 때문에 질문 판정이 깨짐');
  // 이 계정은 물음표 뒤에 이모지나 ㅋㅋ 를 붙인다. 줄 끝 매칭이면 여기서 오탐이 난다.
  assert.ok(!noQ('통신비 줄이려면 갈아타는 게 맞을까요? 📱\n\n#알뜰폰'), '물음표 뒤 이모지에서 오탐');
  assert.ok(!noQ('저만 이러는 거 아니죠? ㅋㅋ'), '물음표 뒤 ㅋㅋ 에서 오탐');

  // 집계
  const a = auditPosts([{ postText: before }, { postText: after }]);
  assert.equal(a.total, 2);
  assert.ok(a.avg > 0 && a.avg <= 100);
  assert.equal(auditPosts([]).avg, 0);

  console.log('✅ post_quality selftest 통과');
  console.log(`   Before(AI) ${scorePost(before).score}점 / After(사람) ${scorePost(after).score}점`);
}
