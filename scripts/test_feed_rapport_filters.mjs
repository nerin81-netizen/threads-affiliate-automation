/**
 * 피드 라포 답글 봇의 순수 필터 로직 자체 검증.
 * 브라우저 없이 돌아간다. 필터가 깨지면 민감한 글에 답글이 나가므로 여기가 마지막 방어선이다.
 *
 *   node scripts/test_feed_rapport_filters.mjs
 */
import assert from 'node:assert/strict';
import { screenPost, isTooSimilar, recentlyRepliedAuthors } from './feed_rapport_bot.mjs';
import { checkSafetyQuota, SAFETY_LIMITS } from './safety_guard.mjs';

const ctx = { myName: 'sample_creator', blockedAuthors: new Set() };
const ok = { author: 'someone', text: '퇴근하고 두 시간씩 앱 만드는 중인데 오늘 드디어 배포까지 끝냈어요' };

// 1. 정상 글은 통과
assert.equal(screenPost(ok, ctx), null);

// 2. 민감/부정 글은 차단
for (const bad of ['오늘 강아지가 무지개다리를 건넜어요 너무 슬픕니다', '이번 선거 대통령 후보들 진짜 답이 없네요', '어머니가 수술 들어가셔서 병원에 와 있습니다']) {
  assert.equal(screenPost({ author: 'x', text: bad }, ctx), '민감/부정 키워드', `민감 글 통과됨: ${bad}`);
}

// 3. 홍보성 글은 차단
assert.equal(screenPost({ author: 'x', text: '이 제품 진짜 좋아요 구매 링크 아래에 남겨둘게요 확인해보세요' }, ctx), '홍보성 글');

// 4. 본문이 짧으면 차단 (이미지 온리 글에 문맥 답글은 불가능)
assert.equal(screenPost({ author: 'x', text: '좋아요 ㅎㅎ' }, ctx), '본문 너무 짧음(이미지 온리 추정)');

// 5. 내 글에는 답글 안 단다
assert.equal(screenPost({ ...ok, author: 'SampleCreator' }, ctx), '내 글');

// 6. 최근 답글 이력이 있는 계정은 차단 (대소문자 무관)
assert.equal(
  screenPost(ok, { ...ctx, blockedAuthors: new Set(['someone']) }),
  `최근 ${SAFETY_LIMITS.OUTBOUND_REPEAT_BLOCK_DAYS}일 내 답글 이력`
);

// 7. 재답글 차단 집합: 7일 이내 outbound SUCCESS만 잡고 인바운드/실패/오래된 건 무시
const day = 24 * 3600 * 1000;
const blocked = recentlyRepliedAuthors([
  { direction: 'outbound', status: 'SUCCESS', targetUser: 'recent', timestamp: new Date(Date.now() - 2 * day).toISOString() },
  { direction: 'outbound', status: 'SUCCESS', targetUser: 'old', timestamp: new Date(Date.now() - 30 * day).toISOString() },
  { direction: 'outbound', status: 'FAILED', targetUser: 'failed', timestamp: new Date().toISOString() },
  { direction: 'inbound', status: 'SUCCESS', targetUser: 'inbound', timestamp: new Date().toISOString() }
]);
assert.deepEqual([...blocked], ['recent']);

// 8. 문장 중복 검사: 8자 이상 겹치면 걸러내고, 공백 차이는 무시한다
assert.equal(isTooSimilar('스하리요 오늘 날씨 정말 좋네요', ['어제 얘기지만 오늘 날씨 정말 좋네요']), true);
assert.equal(isTooSimilar('스하리요 오늘   날씨 정말 좋네요', ['오늘 날씨 정말 좋네요']), true);
assert.equal(isTooSimilar('완전히 다른 문장을 씁니다 여기는', ['오늘 날씨 정말 좋네요']), false);
assert.equal(isTooSimilar('짧음', ['오늘 날씨 정말 좋네요']), false);

// 9. 아웃바운드 한도는 인바운드와 분리되어 있어야 한다
assert.ok(SAFETY_LIMITS.MAX_OUTBOUND_COMMENTS_PER_DAY < SAFETY_LIMITS.MAX_COMMENTS_PER_DAY);
assert.ok(SAFETY_LIMITS.MIN_OUTBOUND_COMMENT_DELAY_SEC > SAFETY_LIMITS.MAX_COMMENT_DELAY_SEC);

// 10. 킬스위치가 실제로 막는지
process.env.DISABLE_OUTBOUND = '1';
assert.equal(checkSafetyQuota('outbound_comment').allowed, false);
delete process.env.DISABLE_OUTBOUND;

console.log('✅ 피드 라포 답글 필터 검증 10종 전부 통과');
