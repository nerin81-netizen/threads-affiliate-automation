/**
 * Meta 공식 Threads Graph API 발행
 *
 *   node scripts/threads_api.mjs --check     # 토큰·계정 확인 (게시 안 함)
 *
 * 브라우저 자동화(threads_bot.mjs)와 비교:
 *   - 40~60초 → 1~2초. 크롬을 띄우지 않는다.
 *   - 스레드 UI가 바뀌어도 안 깨진다. 셀렉터가 없다.
 *   - 안티봇 감지 대상이 아니다.
 *   단, 이미지·영상은 "공개 URL"만 받는다. 로컬 파일을 못 올린다.
 *     그래서 미디어가 붙은 발행은 여전히 브라우저 경로를 쓴다.
 *
 * 발행은 2단계다. 컨테이너를 만들고(threads), 그 id로 게시한다(threads_publish).
 * 컨테이너만 만들고 게시하지 않으면 24시간 뒤 사라지므로, 권한 확인에 쓸 수 있다.
 */
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(rootDir, '.env') });

const API = 'https://graph.threads.net/v1.0';

function token() {
  const t = process.env.THREADS_ACCESS_TOKEN;
  if (!t) throw new Error('THREADS_ACCESS_TOKEN 이 .env 에 없습니다.');
  return t;
}

export async function callThreadsApi(pathname, params, method = 'POST') {
  const url = new URL(`${API}${pathname}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }
  url.searchParams.set('access_token', token());

  let res;
  try {
    res = await fetch(url, { method, signal: AbortSignal.timeout(30000) });
  } catch (err) {
    err.apiPath = pathname;
    err.requestMethod = method;
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const msg = data.error?.message || `HTTP ${res.status}`;
    const err = new Error(`Threads API: ${msg}`);
    err.code = data.error?.code;
    err.errorSubcode = data.error?.error_subcode;
    err.apiPath = pathname;
    err.requestMethod = method;
    throw err;
  }
  return data;
}

// 기존 내부 호출명을 유지하면서 답글 전용 모듈에는 명시적 이름으로만 공개한다.
const call = callThreadsApi;

/** 토큰이 가리키는 계정 정보. 실패하면 토큰이 죽은 것이다. */
export async function getAccount() {
  return call('/me', { fields: 'id,username' }, 'GET');
}

/** 현재 액세스 토큰의 유효성과 승인 scope를 값 노출 없이 확인한다. */
export async function getTokenScopes() {
  const result = await call('/debug_token', { input_token: token() }, 'GET');
  return {
    isValid: result.data?.is_valid === true,
    scopes: Array.isArray(result.data?.scopes) ? result.data.scopes : []
  };
}

/** 게시물/답글 1건의 공식 API 원본 정보를 조회한다. */
export async function fetchThread(threadId) {
  if (!threadId) throw new Error('조회할 Threads post id가 필요합니다.');
  return call(`/${threadId}`, {
    fields: 'id,text,permalink,timestamp,username,media_type,is_reply,replied_to,root_post'
  }, 'GET');
}

/**
 * publish 성공 후 실제 게시물과 permalink가 조회되는지 짧게 재검증한다.
 * 이미 threads_publish가 성공한 뒤이므로 검증 실패를 throw해서 브라우저 폴백(중복 게시)을
 * 유발하면 안 된다. 끝까지 조회되지 않아도 null을 반환하고 발행 성공 자체는 유지한다.
 */
export async function verifyPublishedThread({ threadId, expectedText = '', attempts = 5, delayMs = 1000, log = console.log }) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const row = await fetchThread(threadId);
      const textMatches = !expectedText || String(row.text || '').trim() === String(expectedText).trim();
      if (row.id === threadId && row.permalink && textMatches) return row;
      lastError = new Error(`응답 불일치(id=${row.id || '-'}, permalink=${!!row.permalink}, text=${textMatches})`);
    } catch (err) {
      lastError = err;
    }
    if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  log(`⚠️ 발행 post id는 확인됐지만 read-back 검증이 끝나지 않았습니다: ${lastError?.message || '조회 지연'}`);
  return null;
}

/**
 * 스레드는 게시물당 검색되는 태그(topic_tag)를 하나만 인정한다.
 * 본문에 여러 개를 써도 첫 번째만 실제 태그가 되고 나머지는 그냥 글자다.
 * 무엇이 태그가 될지 API에 맡기지 말고 첫 태그를 골라 명시적으로 넘긴다.
 */
export function extractTopicTag(text) {
  const m = String(text || '').match(/#([^\s#]+)/);
  return m ? m[1] : null;
}

/**
 * 텍스트 게시물을 최상위 게시물 1건으로만 발행한다.
 * 안전 정책상 이 모듈은 답글 컨테이너를 만들지 않는다.
 * 미디어는 지원하지 않는다 (공개 URL이 필요해 로컬 파일을 못 쓴다).
 */
export async function publishText({ text, log = console.log }) {
  if (!text || !text.trim()) throw new Error('본문이 비어 있습니다.');

  const me = await getAccount();
  log(`🔗 공식 API로 발행합니다 (@${me.username})`);

  const topicTag = extractTopicTag(text);
  if (topicTag) log(`   대표 태그: #${topicTag} (스레드는 게시물당 1개만 인정)`);

  const container = await call(`/${me.id}/threads`, { media_type: 'TEXT', text, topic_tag: topicTag });
  log(`   컨테이너 생성 완료 (${container.id})`);

  // 컨테이너가 서버에서 처리될 시간을 준다. 곧바로 publish 하면 간헐적으로 실패한다.
  await new Promise(r => setTimeout(r, 2000));

  const published = await call(`/${me.id}/threads_publish`, { creation_id: container.id });
  log(`🎉 발행 완료 (post id: ${published.id})`);

  const verified = await verifyPublishedThread({ threadId: published.id, expectedText: text, log });
  if (verified?.permalink) log(`🔎 공식 API 게시 검증 완료: ${verified.permalink}`);

  return {
    success: true,
    postId: published.id,
    permalink: verified?.permalink || null,
    verified: !!verified,
    via: 'threads_api'
  };
}

/**
 * Azure Blob Storage 공개 URL을 활용해 이미지 또는 비디오가 포함된 게시물을 공식 API로 발행
 * @param {Object} options
 * @param {string} options.text 본문
 * @param {string} options.mediaUrl Azure Blob Storage 등 공개 접근 가능한 이미지/영상 HTTPS URL
 * @param {'IMAGE'|'VIDEO'} [options.mediaType='IMAGE']
 * @param {Function} [options.log=console.log]
 */
export async function publishMediaPost({ text, mediaUrl, mediaType = 'IMAGE', log = console.log }) {
  if (!text || !text.trim()) throw new Error('본문이 비어 있습니다.');
  if (!mediaUrl) throw new Error('미디어 공개 URL이 필요합니다.');

  const me = await getAccount();
  log(`🔗 공식 API 미디어(${mediaType}) 발행 시작 (@${me.username})`);
  log(`   클라우드 미디어 URL: ${mediaUrl}`);

  const topicTag = extractTopicTag(text);
  if (topicTag) log(`   대표 태그: #${topicTag}`);

  const params = {
    media_type: mediaType === 'VIDEO' ? 'VIDEO' : 'IMAGE',
    text,
    topic_tag: topicTag
  };

  if (mediaType === 'VIDEO') {
    params.video_url = mediaUrl;
  } else {
    params.image_url = mediaUrl;
  }

  const container = await call(`/${me.id}/threads`, params);
  log(`   미디어 컨테이너 생성 완료 (${container.id})`);

  // 미디어 인코딩 및 처리 대기 (이미지 3초, 비디오 5초)
  const waitMs = mediaType === 'VIDEO' ? 6000 : 3000;
  await new Promise(r => setTimeout(r, waitMs));

  const published = await call(`/${me.id}/threads_publish`, { creation_id: container.id });
  log(`🎉 공식 API 미디어 게시 완료 (post id: ${published.id})`);

  const verified = await verifyPublishedThread({ threadId: published.id, expectedText: text, log });
  if (verified?.permalink) log(`🔎 공식 API 미디어 게시 검증 완료: ${verified.permalink}`);

  return {
    success: true,
    postId: published.id,
    permalink: verified?.permalink || null,
    verified: !!verified,
    via: 'threads_api'
  };
}

/**
 * 최근 게시물 성과를 회수한다.
 *
 * 로컬에 post id를 쌓아두지 않고 계정에서 목록을 통째로 받아온다.
 * 브라우저 자동화로 올린 글도 같은 계정에 있으므로 함께 잡힌다.
 * ponytail: 지표는 API가 원본이라 별도 저장을 두지 않았다.
 *           날짜별 추이가 필요해지면 그때 스냅샷 테이블을 붙인다.
 */
export async function fetchPostInsights({ limit = 25 } = {}) {
  const me = await getAccount();
  const list = await call(`/${me.id}/threads`, {
    fields: 'id,permalink,timestamp,text,media_type',
    limit
  }, 'GET');

  const posts = list.data || [];
  const rows = await Promise.all(posts.map(async (p) => {
    let metrics = {};
    try {
      const ins = await call(`/${p.id}/insights`, {
        metric: 'views,likes,replies,reposts,quotes'
      }, 'GET');
      // 응답은 [{name:'views', values:[{value:12}]}, ...] 형태다
      for (const m of ins.data || []) {
        metrics[m.name] = m.values?.[0]?.value ?? m.total_value?.value ?? 0;
      }
    } catch {
      // 발행 직후거나 답글이면 인사이트가 없을 수 있다. 0으로 두고 진행한다.
    }
    return {
      id: p.id,
      permalink: p.permalink,
      timestamp: p.timestamp,
      text: (p.text || '').split('\n')[0].slice(0, 60),
      views: metrics.views || 0,
      likes: metrics.likes || 0,
      replies: metrics.replies || 0,
      reposts: metrics.reposts || 0,
      quotes: metrics.quotes || 0
    };
  }));

  rows.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return { username: me.username, rows, byHour: summarizeByHour(rows) };
}

/**
 * 발행 시각(KST)별 평균 조회수를 낸다. "언제 올려야 하나"에 답하는 부분.
 * 조회수 0인 글은 아직 집계 전일 수 있어 평균을 왜곡하므로 제외한다.
 */
export function summarizeByHour(rows = []) {
  const buckets = new Map();
  for (const r of rows) {
    if (!r.timestamp || !r.views) continue;
    // UTC ISO 문자열 -> KST 시(hour). 서버 타임존에 의존하지 않게 +9시간을 직접 더한다.
    const hour = new Date(new Date(r.timestamp).getTime() + 9 * 3600 * 1000).getUTCHours();
    const b = buckets.get(hour) || { hour, posts: 0, views: 0, replies: 0 };
    b.posts += 1;
    b.views += r.views;
    b.replies += r.replies;
    buckets.set(hour, b);
  }
  return [...buckets.values()]
    .map(b => ({ ...b, avgViews: Math.round(b.views / b.posts), avgReplies: +(b.replies / b.posts).toFixed(1) }))
    .sort((a, b) => b.avgViews - a.avgViews);
}

async function main() {
  if (process.argv.includes('--check')) {
    const me = await getAccount();
    console.log(`✅ 토큰 정상 — @${me.username} (id: ${me.id})`);

    // 컨테이너만 만들어 발행 권한을 확인한다. 게시하지 않으므로 글은 올라가지 않는다.
    const c = await call(`/${me.id}/threads`, { media_type: 'TEXT', text: '권한 확인용 (게시되지 않음)' });
    console.log(`✅ 발행 권한 정상 — 컨테이너 ${c.id} 생성 (게시 안 함, 24시간 뒤 소멸)`);
    return;
  }
  if (process.argv.includes('--insights')) {
    const { username, rows, byHour } = await fetchPostInsights({ limit: 25 });
    console.log(`\n📊 @${username} 최근 ${rows.length}건 성과\n`);
    for (const r of rows) {
      const kst = new Date(new Date(r.timestamp).getTime() + 9 * 3600 * 1000).toISOString().slice(5, 16).replace('T', ' ');
      console.log(`${kst}  조회 ${String(r.views).padStart(6)}  좋아요 ${String(r.likes).padStart(4)}  댓글 ${String(r.replies).padStart(3)}  ${r.text}`);
    }
    console.log('\n⏰ 시간대별 평균 (조회수 높은 순)');
    for (const b of byHour) {
      console.log(`  ${String(b.hour).padStart(2, '0')}시  평균조회 ${String(b.avgViews).padStart(6)}  평균댓글 ${b.avgReplies}  (${b.posts}건)`);
    }
    return;
  }

  console.log('사용법: node scripts/threads_api.mjs --check | --insights');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(`실패: ${e.message}`); process.exit(1); });
}

// ponytail: 순수 집계 로직만 자체 점검. `node scripts/threads_api.mjs --selftest`
if (process.argv.includes('--selftest')) {
  const { strict: assert } = await import('assert');
  const rows = [
    { timestamp: '2026-09-05T23:00:00+0000', views: 100, replies: 2 }, // KST 08시
    { timestamp: '2026-09-06T23:30:00+0000', views: 300, replies: 8 }, // KST 08시
    { timestamp: '2026-09-06T17:00:00+0000', views: 10, replies: 0 },  // KST 02시
    { timestamp: '2026-09-07T17:00:00+0000', views: 0, replies: 0 }    // 집계 전 -> 제외
  ];
  const out = summarizeByHour(rows);
  assert.equal(out.length, 2, '조회수 0인 글이 버킷에 섞임');
  assert.equal(out[0].hour, 8, 'KST 변환 실패 (UTC 23시는 KST 08시)');
  assert.equal(out[0].avgViews, 200);
  assert.equal(out[0].posts, 2);
  assert.equal(out[1].hour, 2);
  assert.deepEqual(summarizeByHour([]), []);
  assert.equal(extractTopicTag('본문 #직장인 #출근'), '직장인');
  assert.equal(extractTopicTag('태그 없음'), null);
  console.log('✅ threads_api selftest 통과');
}
