/**
 * Threads 공식 API 답글 전용 모듈
 *
 * 최상위 게시 엔진(threads_api.mjs)과 의도적으로 분리한다.
 * 서버 자동 발행 경로에서는 import하지 않으며, 명시적 답글 작업에서만 호출한다.
 */
import {
  callThreadsApi,
  fetchThread,
  getAccount,
  verifyPublishedThread
} from './threads_api.mjs';

/**
 * 특정 게시물 또는 답글에 텍스트 답글 1건을 발행한다.
 * 기본값은 대상의 루트 게시물이 내 계정 소유일 때만 허용하여 타인 글 자동 댓글로
 * 변질되는 것을 막는다. 내 글에 달린 타인 댓글에는 안전하게 응답할 수 있다.
 */
export async function publishReply({
  replyToId,
  text,
  ownPostsOnly = true,
  log = console.log
}) {
  const cleanText = String(text || '').trim();
  if (!replyToId) throw new Error('replyToId가 필요합니다.');
  if (!cleanText) throw new Error('답글 본문이 비어 있습니다.');
  if (cleanText.length > 500) throw new Error('Threads 답글은 500자를 넘을 수 없습니다.');

  const me = await getAccount();
  const target = await fetchThread(replyToId);
  let verifiedRootId = target.is_reply === true
    ? (typeof target.root_post === 'string' ? target.root_post : target.root_post?.id)
    : target.id;

  if (ownPostsOnly) {
    if (!verifiedRootId) {
      throw new Error('답글 대상의 루트 게시물 관계를 확인할 수 없어 발행하지 않습니다.');
    }
    const root = String(verifiedRootId) === String(target.id)
      ? target
      : await fetchThread(verifiedRootId);
    if (root.is_reply === true || !root.username || root.username !== me.username) {
      throw new Error(`내 루트 게시물이 아닌 대화에는 답글을 발행하지 않습니다. (@${root.username || 'unknown'})`);
    }
    verifiedRootId = root.id;
  }

  log(`💬 공식 API 답글 발행 시작 (@${me.username} → ${replyToId})`);
  const container = await callThreadsApi(`/${me.id}/threads`, {
    media_type: 'TEXT',
    text: cleanText,
    reply_to_id: replyToId
  });
  log(`   답글 컨테이너 생성 완료 (${container.id})`);

  await new Promise(resolve => setTimeout(resolve, 2500));
  const published = await callThreadsApi(`/${me.id}/threads_publish`, {
    creation_id: container.id
  });
  log(`🎉 공식 API 답글 발행 완료 (reply id: ${published.id})`);

  const verified = await verifyPublishedThread({
    threadId: published.id,
    expectedText: cleanText,
    log
  });
  if (verified?.permalink) log(`🔎 공식 API 답글 검증 완료: ${verified.permalink}`);

  const repliedToId = typeof verified?.replied_to === 'string'
    ? verified.replied_to
    : verified?.replied_to?.id;

  return {
    success: true,
    replyId: published.id,
    replyToId,
    rootPostId: verifiedRootId || null,
    containerId: container.id,
    permalink: verified?.permalink || null,
    verified: !!verified,
    relationVerified: verified?.is_reply === true && repliedToId === replyToId,
    via: 'threads_reply_api'
  };
}
