import assert from 'node:assert/strict';
import {
  getRapportPermissionStatus,
  isSafeInboundReply,
  RAPPORT_LIMITS,
  runRapportReplyBatch,
  searchInboundRapportTargets
} from './rapport_reply_service.mjs';
import { generateGroundedRapportReply } from './rapport_engine.mjs';

const ready = await getRapportPermissionStatus(async () => ({
  isValid: true,
  scopes: ['threads_basic', 'threads_content_publish', 'threads_read_replies', 'threads_manage_replies']
}));
assert.equal(ready.ready, true);
assert.equal(ready.readReplies, true);
assert.equal(ready.manageReplies, true);
assert.deepEqual(ready.missing, []);
assert.equal(ready.mode, 'OWNED_POST_INBOUND_REPLIES');

const missing = await getRapportPermissionStatus(async () => ({
  isValid: true,
  scopes: ['threads_basic', 'threads_content_publish']
}));
assert.equal(missing.ready, false);
assert.deepEqual(missing.missing, ['threads_read_replies']);

const now = Date.now();
const rootPost = {
  id: 'own-root-1001',
  username: 'sample_creator',
  text: '오늘 업무 자동화에서 가장 줄이고 싶은 반복 작업은 무엇인가요?',
  permalink: 'https://www.threads.com/@sample_creator/post/own-root-1001',
  timestamp: new Date(now - 60_000).toISOString(),
  is_reply: false,
  has_replies: true
};
const safeTarget = {
  id: 'inbound-reply-1001',
  username: 'other_user',
  text: '저는 매일 반복되는 보고서 정리가 제일 힘들어요. 어떤 방식으로 줄이셨나요?',
  permalink: 'https://www.threads.com/@other_user/post/inbound-reply-1001',
  timestamp: new Date(now - 30_000).toISOString(),
  is_reply: true,
  is_reply_owned_by_me: false,
  hide_status: 'NOT_HUSHED',
  root_post: { id: rootPost.id },
  replied_to: { id: rootPost.id },
  rootPostId: rootPost.id,
  rootPostUrl: rootPost.permalink,
  rootPostText: rootPost.text,
  rootPostUsername: rootPost.username,
  ownUsername: rootPost.username
};
const safetyContext = {
  ownNodeIds: new Set([rootPost.id]),
  ownReplyParentIds: new Set(),
  now
};
assert.equal(isSafeInboundReply(safeTarget, 'sample_creator', [], safetyContext), true);
assert.equal(isSafeInboundReply({ ...safeTarget, username: 'sample_creator', is_reply_owned_by_me: true }, 'sample_creator', [], safetyContext), false);
assert.equal(isSafeInboundReply({ ...safeTarget, hide_status: 'HIDDEN' }, 'sample_creator', [], safetyContext), false);
assert.equal(isSafeInboundReply({ ...safeTarget, text: '선거 정치 이야기입니다.' }, 'sample_creator', [], safetyContext), false);
assert.equal(isSafeInboundReply(safeTarget, 'sample_creator', [{ targetPostId: safeTarget.id }], safetyContext), false);
assert.equal(isSafeInboundReply(safeTarget, 'sample_creator', [], { ...safetyContext, ownReplyParentIds: new Set([safeTarget.id]) }), false);
assert.equal(isSafeInboundReply({ ...safeTarget, replied_to: { id: 'another-users-reply' } }, 'sample_creator', [], safetyContext), false);

const myExistingReply = {
  id: 'my-reply-2001',
  username: 'sample_creator',
  text: '기존 수동 응답입니다.',
  permalink: 'https://www.threads.com/@sample_creator/post/my-reply-2001',
  timestamp: new Date(now - 20_000).toISOString(),
  is_reply: true,
  is_reply_owned_by_me: true,
  root_post: { id: rootPost.id },
  replied_to: { id: safeTarget.id },
  hide_status: 'NOT_HUSHED'
};
const unanswered = { ...safeTarget, id: 'inbound-reply-1002', permalink: 'https://www.threads.com/@other_user/post/inbound-reply-1002' };
const userToUserReply = {
  ...safeTarget,
  id: 'inbound-reply-1003',
  username: 'third_user',
  permalink: 'https://www.threads.com/@third_user/post/inbound-reply-1003',
  replied_to: { id: safeTarget.id }
};
let rootsRead = 0;
let conversationsRead = 0;
const searched = await searchInboundRapportTargets({
  desiredCount: 3,
  history: [],
  now,
  accountReader: async () => ({ id: 'me-id', username: 'sample_creator' }),
  rootPostsReader: async ({ account }) => {
    rootsRead += 1;
    assert.equal(account.id, 'me-id');
    return [rootPost, { ...rootPost, id: 'foreign-root', username: 'not-me' }];
  },
  conversationReader: async ({ rootPost: selectedRoot }) => {
    conversationsRead += 1;
    assert.equal(selectedRoot.id, rootPost.id);
    return [safeTarget, unanswered, userToUserReply, myExistingReply];
  }
});
assert.equal(rootsRead, 1);
assert.equal(conversationsRead, 1);
assert.deepEqual(searched.map(row => row.id), [unanswered.id]);

let publishCalled = false;
const dryRun = await runRapportReplyBatch({
  targetCount: 1,
  explicitTargets: [{ ...unanswered, ownUsername: 'sample_creator' }],
  dryRun: true,
  permissionReader: async () => ({ ready: true, missing: [] }),
  replyPublisher: async () => { publishCalled = true; throw new Error('dry-run에서 호출되면 안 됨'); },
  commentGenerator: generateGroundedRapportReply
});
assert.equal(dryRun.success, true);
assert.equal(dryRun.dryRun, true);
assert.equal(dryRun.count, 1);
assert.equal(publishCalled, false);
assert.ok(dryRun.previews[0].comment.length >= 10 && dryRun.previews[0].comment.length <= 300);
assert.doesNotMatch(dryRun.previews[0].comment, /https?:\/\/|스팔\s*완료|팔로우\s*완료|반하리\s*완료/);

await assert.rejects(
  () => runRapportReplyBatch({ permissionReader: async () => ({ ready: false, missing: ['threads_read_replies'] }) }),
  error => error.code === 'THREADS_RAPPORT_PERMISSION_REQUIRED'
);

assert.equal(RAPPORT_LIMITS.maxPerRun, 3);
assert.equal(RAPPORT_LIMITS.maxPerDay, 10);
assert.ok(RAPPORT_LIMITS.minDelayMs >= 60_000);
assert.ok(RAPPORT_LIMITS.lookbackDays <= 30);

console.log('✅ 인바운드 라포 단위 검사 통과: 현재 권한 게이트, 내 루트 관계, 기응답·타인 대화·중복·민감 댓글 제외, dry-run 무발행');
