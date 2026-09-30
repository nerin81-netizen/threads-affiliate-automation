/**
 * 공식 Threads API 기반 인바운드 라포 답글 서비스.
 *
 * threads_keyword_search를 사용하지 않는다. 내 최상위 게시물의 conversation에서
 * 아직 내가 응답하지 않은 타인 댓글만 골라 분리된 threads_reply_api에 전달한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { callThreadsApi, getAccount, getTokenScopes } from './threads_api.mjs';
import { publishReply } from './threads_reply_api.mjs';
import { generateGroundedRapportReply } from './rapport_engine.mjs';
import { recordCommentActivity } from './db_adapter.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HISTORY_FILE = path.join(rootDir, 'comments_history.json');
const SENSITIVE_PATTERN = /(정치|선거|대통령|범죄|사망|장례|부고|종교|혐오|폭력|자해|극단적|전쟁|사고\s*현장)/i;
const PROMOTION_PATTERN = /(구매\s*링크|제휴|수수료|오픈채팅|텔레그램|무료\s*상담)/i;
const SAFE_HIDE_STATUSES = new Set(['', 'NOT_HUSHED', 'UNHUSHED']);
const REQUIRED_SCOPES = Object.freeze([
  'threads_basic',
  'threads_content_publish',
  'threads_read_replies'
]);

export const RAPPORT_LIMITS = Object.freeze({
  maxPerRun: 3,
  maxPerDay: 10,
  minDelayMs: 60_000,
  maxDelayMs: 180_000,
  rootPostLimit: 25,
  conversationLimit: 100,
  lookbackDays: 30
});

const relationId = value => String(typeof value === 'object' ? value?.id || '' : value || '');

function readHistory() {
  try {
    const rows = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function writeHistory(rows) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(rows, null, 2), 'utf8');
}

function kstDate(value = Date.now()) {
  return new Date(new Date(value).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export function getRapportUsage(history = readHistory(), now = Date.now()) {
  const today = kstDate(now);
  const todayCount = history.filter(row => row.timestamp && kstDate(row.timestamp) === today && row.status === 'SUCCESS').length;
  return {
    todayCount,
    dailyLimit: RAPPORT_LIMITS.maxPerDay,
    remaining: Math.max(0, RAPPORT_LIMITS.maxPerDay - todayCount)
  };
}

export async function getRapportPermissionStatus(scopeReader = getTokenScopes) {
  try {
    const token = await scopeReader();
    const scopes = new Set(token.scopes || []);
    const missing = REQUIRED_SCOPES.filter(scope => !scopes.has(scope));
    return {
      ready: token.isValid === true && missing.length === 0,
      isValid: token.isValid === true,
      basic: scopes.has('threads_basic'),
      contentPublish: scopes.has('threads_content_publish'),
      readReplies: scopes.has('threads_read_replies'),
      manageReplies: scopes.has('threads_manage_replies'),
      mode: 'OWNED_POST_INBOUND_REPLIES',
      missing
    };
  } catch (error) {
    return {
      ready: false,
      isValid: false,
      basic: false,
      contentPublish: false,
      readReplies: false,
      manageReplies: false,
      mode: 'OWNED_POST_INBOUND_REPLIES',
      missing: [],
      error: error.message
    };
  }
}

export async function fetchOwnRootPosts({
  account = null,
  limit = RAPPORT_LIMITS.rootPostLimit,
  api = callThreadsApi
} = {}) {
  const me = account || await getAccount();
  const result = await api(`/${me.id}/threads`, {
    fields: 'id,text,permalink,timestamp,username,is_reply,has_replies',
    limit: Math.min(RAPPORT_LIMITS.rootPostLimit, Math.max(1, Number(limit) || RAPPORT_LIMITS.rootPostLimit))
  }, 'GET');

  return (result.data || [])
    .filter(post => post?.id && post.is_reply !== true && (!post.username || post.username === me.username))
    .map(post => ({ ...post, username: post.username || me.username }));
}

export async function fetchOwnedThreadConversation({
  rootPost,
  limit = RAPPORT_LIMITS.conversationLimit,
  api = callThreadsApi
} = {}) {
  if (!rootPost?.id) throw new Error('대화를 조회할 내 게시물 ID가 필요합니다.');
  if (rootPost.has_replies === false) return [];

  const result = await api(`/${rootPost.id}/conversation`, {
    fields: 'id,text,username,permalink,timestamp,has_replies,root_post,replied_to,is_reply,is_reply_owned_by_me,hide_status',
    reverse: 'true',
    limit: Math.min(RAPPORT_LIMITS.conversationLimit, Math.max(1, Number(limit) || RAPPORT_LIMITS.conversationLimit))
  }, 'GET');
  return Array.isArray(result.data) ? result.data : [];
}

export function isSafeInboundReply(target, ownUsername, history = [], context = {}) {
  const text = String(target?.text || '').replace(/\s+/g, ' ').trim();
  const targetId = String(target?.id || '');
  const rootPostId = String(target?.rootPostId || relationId(target?.root_post));
  const parentId = relationId(target?.replied_to);
  const hideStatus = String(target?.hide_status || '');
  const ownNodeIds = context.ownNodeIds instanceof Set ? context.ownNodeIds : null;
  const ownReplyParentIds = context.ownReplyParentIds instanceof Set ? context.ownReplyParentIds : new Set();
  const now = Number(context.now || Date.now());

  if (!targetId || !rootPostId || !parentId || !target?.permalink || !target?.username) return false;
  if (target.is_reply !== true || target.is_reply_owned_by_me === true || target.username === ownUsername) return false;
  if (target.rootPostUsername && target.rootPostUsername !== ownUsername) return false;
  if (ownNodeIds && !ownNodeIds.has(parentId)) return false;
  if (ownReplyParentIds.has(targetId)) return false;
  if (!SAFE_HIDE_STATUSES.has(hideStatus)) return false;
  if (text.length < 2 || text.length > 500) return false;
  if (SENSITIVE_PATTERN.test(text) || PROMOTION_PATTERN.test(text)) return false;

  const timestamp = Date.parse(target.timestamp || '');
  if (!Number.isFinite(timestamp)) return false;
  const ageMs = now - timestamp;
  if (ageMs < -5 * 60_000 || ageMs > RAPPORT_LIMITS.lookbackDays * 24 * 60 * 60_000) return false;

  return !history.some(row =>
    String(row.targetPostId || row.targetReplyId || '') === targetId
    || (row.targetPostUrl && row.targetPostUrl === target.permalink)
  );
}

export const isSafeRapportTarget = isSafeInboundReply;

export async function searchInboundRapportTargets({
  desiredCount = 3,
  history = readHistory(),
  accountReader = getAccount,
  rootPostsReader = fetchOwnRootPosts,
  conversationReader = fetchOwnedThreadConversation,
  now = Date.now(),
  log = () => {}
} = {}) {
  const me = await accountReader();
  const roots = await rootPostsReader({ account: me, limit: RAPPORT_LIMITS.rootPostLimit });
  const candidates = [];
  const seenIds = new Set();

  for (const rootPost of roots) {
    if (!rootPost?.id || rootPost.is_reply === true || rootPost.username !== me.username) continue;

    let conversation;
    try {
      conversation = await conversationReader({ rootPost, limit: RAPPORT_LIMITS.conversationLimit });
    } catch (error) {
      log(`⚠️ 내 게시물 ${rootPost.id} 대화 조회 건너뜀: ${error.message}`);
      continue;
    }

    const rows = Array.isArray(conversation) ? conversation : [];
    const ownNodeIds = new Set([String(rootPost.id)]);
    const ownReplyParentIds = new Set();

    for (const row of rows) {
      if (row?.is_reply_owned_by_me === true || row?.username === me.username) {
        ownNodeIds.add(String(row.id));
        const parentId = relationId(row.replied_to);
        if (parentId) ownReplyParentIds.add(parentId);
      }
    }

    for (const row of rows) {
      const target = {
        ...row,
        rootPostId: String(rootPost.id),
        rootPostUrl: rootPost.permalink || null,
        rootPostText: String(rootPost.text || '').slice(0, 240),
        rootPostUsername: rootPost.username
      };
      const targetId = String(target.id || '');
      if (seenIds.has(targetId)) continue;
      if (!isSafeInboundReply(target, me.username, history, { ownNodeIds, ownReplyParentIds, now })) continue;
      seenIds.add(targetId);
      candidates.push(target);
    }
  }

  candidates.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  const selected = [];
  const seenUsers = new Set();
  for (const target of candidates) {
    if (selected.length >= desiredCount) break;
    if (seenUsers.has(target.username)) continue;
    seenUsers.add(target.username);
    selected.push(target);
  }
  return selected;
}

function validateReplyText(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length < 10 || clean.length > 300) throw new Error('라포 답글 길이는 10~300자여야 합니다.');
  if (/https?:\/\//i.test(clean) || PROMOTION_PATTERN.test(clean)) throw new Error('라포 답글에는 링크·홍보 문구를 넣을 수 없습니다.');
  if (/(스팔\s*완료|팔로우\s*완료|반하리\s*완료)/.test(clean)) throw new Error('실행하지 않은 팔로우 완료 주장을 넣을 수 없습니다.');
  return clean;
}

function saveSuccess({ target, comment, result, history }) {
  const row = {
    id: `cmt_api_${Date.now()}_${result.replyId}`,
    timestamp: new Date().toISOString(),
    targetPostId: String(target.id),
    targetReplyId: String(target.id),
    targetPostUrl: target.permalink,
    targetUser: target.username,
    targetPostSnippet: String(target.text || '').slice(0, 240),
    rootPostId: target.rootPostId,
    rootPostUrl: target.rootPostUrl || null,
    rootPostSnippet: target.rootPostText || '',
    keyword: '인바운드',
    generatedComment: comment,
    replyId: result.replyId,
    replyPermalink: result.permalink,
    verified: result.verified,
    relationVerified: result.relationVerified,
    category: '내 게시물 인바운드 AI 답글',
    status: 'SUCCESS',
    via: 'threads_reply_api'
  };
  history.unshift(row);
  writeHistory(history);
  return row;
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function runRapportReplyBatch({
  targetCount = 1,
  dryRun = false,
  explicitTargets = null,
  log = console.log,
  permissionReader = getRapportPermissionStatus,
  targetSearcher = searchInboundRapportTargets,
  replyPublisher = publishReply,
  commentGenerator = generateGroundedRapportReply,
  activityRecorder = recordCommentActivity,
  delay = wait,
  random = Math.random
} = {}) {
  const requested = Math.min(RAPPORT_LIMITS.maxPerRun, Math.max(1, Number(targetCount) || 1));
  const permission = await permissionReader();
  if (!permission.ready) {
    const error = new Error(`Threads 공식 API 권한이 부족합니다: ${permission.missing?.join(', ') || permission.error || '확인 실패'}`);
    error.code = 'THREADS_RAPPORT_PERMISSION_REQUIRED';
    error.permission = permission;
    throw error;
  }

  const history = readHistory();
  const usage = getRapportUsage(history);
  const allowed = Math.min(requested, usage.remaining);
  if (allowed < 1) {
    const error = new Error(`오늘 라포 답글 안전 한도 ${RAPPORT_LIMITS.maxPerDay}건에 도달했습니다.`);
    error.code = 'RAPPORT_DAILY_LIMIT';
    throw error;
  }

  const targets = Array.isArray(explicitTargets)
    ? explicitTargets.filter(target => isSafeInboundReply(target, target.ownUsername || '', history, {
      ownNodeIds: new Set([String(target.rootPostId || relationId(target.root_post))]),
      now: Date.now()
    })).slice(0, allowed)
    : await targetSearcher({ desiredCount: allowed, history, log });
  if (!targets.length) return { success: false, count: 0, reason: 'NO_UNANSWERED_INBOUND_REPLIES', usage };

  const recentComments = history.slice(0, 12).map(row => row.generatedComment).filter(Boolean);
  const previews = targets.map(target => ({
    target,
    comment: validateReplyText(commentGenerator(target.username, target.text, recentComments))
  }));
  if (dryRun) return { success: true, dryRun: true, count: previews.length, previews, usage };

  const completed = [];
  const errors = [];
  for (let index = 0; index < previews.length; index++) {
    const { target, comment } = previews[index];
    try {
      log(`💬 [${index + 1}/${previews.length}] @${target.username}의 인바운드 댓글에 공식 API 답글 발행`);
      const result = await replyPublisher({ replyToId: target.id, text: comment, ownPostsOnly: true, log });
      if (!result.relationVerified) {
        log(`⚠️ 답글 ${result.replyId}은 발행됐지만 부모 관계 재검증이 지연됐습니다.`);
      }
      const row = saveSuccess({ target, comment, result, history });
      completed.push(row);
      try {
        await activityRecorder({ postUrl: target.permalink, authorName: target.username, commentText: comment, followed: false });
      } catch (recordError) {
        log(`⚠️ 답글 발행은 완료됐지만 활동 DB 기록을 건너뜁니다: ${recordError.message}`);
      }
    } catch (error) {
      errors.push({ targetPostId: String(target.id), username: target.username, message: error.message });
      log(`⚠️ @${target.username} 인바운드 답글 실패: ${error.message}`);
    }
    if (index < previews.length - 1) {
      const delayMs = Math.round(RAPPORT_LIMITS.minDelayMs + random() * (RAPPORT_LIMITS.maxDelayMs - RAPPORT_LIMITS.minDelayMs));
      log(`⏳ 다음 인바운드 답글까지 ${Math.round(delayMs / 1000)}초 안전 대기`);
      await delay(delayMs);
    }
  }

  return {
    success: completed.length > 0,
    count: completed.length,
    requested,
    completed,
    errors,
    usage: getRapportUsage(history)
  };
}

/**
 * 내가 방금 발행한 게시물에 출처 링크를 첫 답글로 단다.
 *
 * 본문에 URL을 넣으면 스레드 알고리즘이 아웃링크 페널티로 도달을 억제한다.
 * 답글의 링크는 본문 도달에 영향이 없어, 링크를 살리면서 도달도 지킨다.
 *
 * 서버는 저수준 threads_reply_api를 직접 부르지 않는다(안전 회귀 규칙).
 * 답글 발행은 반드시 이 서비스를 경유하며, ownPostsOnly로 내 루트 게시물에만 달린다.
 */
export async function publishSourceLinkReply({ postId, link, log = console.log }) {
  const cleanLink = String(link || '').trim();
  if (!postId) throw new Error('링크 답글 대상 게시물 ID가 없습니다.');
  if (!cleanLink) throw new Error('첨부할 출처 링크가 비어 있습니다.');
  if (!/^https?:\/\//i.test(cleanLink)) {
    throw new Error(`출처 링크가 http(s) URL이 아닙니다: ${cleanLink.slice(0, 60)}`);
  }

  return publishReply({
    replyToId: postId,
    text: `🔗 기사 원문: ${cleanLink}`,
    ownPostsOnly: true,
    log
  });
}
