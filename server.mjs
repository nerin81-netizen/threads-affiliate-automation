import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { 
  loginSession, 
  growFollowers, 
  postHotDeal, 
  postSingleCard, 
  stopBot, 
  loadConfig 
} from './scripts/threads_bot.mjs';
import { 
  generateThreadCards, 
  getSavedCards, 
  updateCard, 
  deleteCard 
} from './scripts/card_generator.mjs';
import { getDailyStats, checkSafetyQuota, SAFETY_LIMITS } from './scripts/safety_guard.mjs';
import { runFeedHeartBot } from './scripts/feed_heart_bot.mjs';
import { runFeedRapportBot } from './scripts/feed_rapport_bot.mjs';
import { buildIdeas } from './scripts/idea_from_trends.mjs';
import { searchNews, draftFromNews, findBestMatchingArticle } from './scripts/news_to_post.mjs';
import { writeStoryPosts } from './scripts/story_writer.mjs';
import { publishText, publishMediaPost } from './scripts/threads_api.mjs';
import { 
  initPostgres, 
  initBlobStorage, 
  uploadMediaToBlob, 
  getVaultPosts, 
  markVaultAsPosted, 
  upsertVaultItem,
  deleteVaultItem,
  restoreVaultItem,
  savePublishedPost, 
  logToPostgres
} from './scripts/db_adapter.mjs';
import {
  getRapportPermissionStatus,
  getRapportUsage,
  RAPPORT_LIMITS,
  runRapportReplyBatch,
  publishSourceLinkReply
} from './scripts/rapport_reply_service.mjs';
import { generateAiImage, generateAiVideo } from './scripts/ai_media_generator.mjs';
import { generateEliteImagePrompt, fetchPromptDailySamples } from './scripts/prompt_daily_connector.mjs';
import { fetchPostInsights } from './scripts/threads_api.mjs';
import { claimPublish, finishPublish } from './scripts/publish_guard.mjs';
import {
  buildOpportunities,
  getGoogleTrending,
  getNaverKeywordTrends,
  getNaverTrendingOverview,
  getThreadsTrendingOverview,
  normalizeKeywords,
  searchThreadsKeyword
} from './scripts/trend_research.mjs';
import {
  initLoggerDb,
  saveLog,
  getRecentLogs,
  getLogStats,
  clearLogs
} from './scripts/logger_db.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = __dirname;
const publicDir = path.join(rootDir, 'public');

dotenv.config({ path: path.join(rootDir, '.env') });

const PORT = process.env.PORT || 3500;
const DASHBOARD_ADMIN_PASSWORD = String(process.env.DASHBOARD_ADMIN_PASSWORD || '');
const DASHBOARD_PUBLIC_ORIGIN = String(process.env.DASHBOARD_PUBLIC_ORIGIN || '').replace(/\/$/, '');
const AUTH_COOKIE_NAME = 'threads_dashboard_session';
const AUTH_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const authSessions = new Map();
const requestRateBuckets = new Map();

// 스레드 계정 핸들 — .env(THREADS_ACCOUNT_ID) 우선, 기본값은 your_threads_id
const THREADS_HANDLE = process.env.THREADS_ACCOUNT_ID || process.env.THREADS_ID || 'your_threads_id';
const THREADS_PROFILE_URL = `https://threads.net/@${THREADS_HANDLE}`;

// SSE 로그 브로드캐스터 & DB 연동
const sseClients = new Set();

// 25초 주기 Keep-Alive Heartbeat 전송 (네트워크 유휴 타임아웃 방지 및 좀비 소켓 자동 정리)
setInterval(() => {
  for (const res of sseClients) {
    try {
      res.write(': keep-alive\n\n');
    } catch {
      sseClients.delete(res);
    }
  }
}, 25000);

function broadcastLog(message, type = 'info', source = 'server') {
  console.log(`[${type.toUpperCase()}] ${message}`);
  // SQLite DB 및 파일에 영구 보관
  const logData = saveLog(message, type, source);
  logToPostgres(message, type, source).catch(() => {});

  const payload = `data: ${JSON.stringify(logData)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch (e) {
      sseClients.delete(res);
    }
  }
}

// 봇 실행 상태 관리
let isBotRunning = false;
let currentTaskName = null;

// ================= 무인 오토파일럿 (상시 백그라운드 러너) 엔진 =================
let autoPilotState = {
  enabled: false,
  mode: 'continuous', // 'continuous' (상시) | 'timed_3h' (3시간 집중 모드)
  intervalMinutes: 30,
  followsPerCycle: 5,
  enableAutoPost: true,
  cycleCount: 0,
  maxCycles: null,
  nextRunAt: null,
  timerId: null
};

function scheduleNextAutoPilot(delayMs) {
  if (autoPilotState.timerId) {
    clearTimeout(autoPilotState.timerId);
    autoPilotState.timerId = null;
  }
  if (!autoPilotState.enabled) return;

  autoPilotState.nextRunAt = new Date(Date.now() + delayMs).toISOString();
  broadcastLog(`⏰ [오토파일럿] 다음 실행 예약: ${new Date(Date.now() + delayMs).toLocaleTimeString('ko-KR')} (${Math.round(delayMs / 60000)}분 후)`, 'system');

  autoPilotState.timerId = setTimeout(async () => {
    if (!autoPilotState.enabled) return;
    await executeAutoPilotCycle();
  }, delayMs);
}

async function executeAutoPilotCycle() {
  if (!autoPilotState.enabled) return;
  if (isBotRunning) {
    broadcastLog('⏳ 이전 작업이 아직 실행 중이므로 3분 후 오토파일럿 사이클을 재시도합니다.', 'warning');
    scheduleNextAutoPilot(3 * 60 * 1000);
    return;
  }

  const logger = (msg) => broadcastLog(msg, 'info');
  autoPilotState.cycleCount++;
  const cycleInfo = autoPilotState.maxCycles ? `[${autoPilotState.cycleCount}/${autoPilotState.maxCycles}회차]` : `[${autoPilotState.cycleCount}회차]`;
  broadcastLog(`\n🤖 ======================================================`, 'system');
  broadcastLog(`🤖 [무인 오토파일럿 사이클 시작] ${cycleInfo} (${autoPilotState.mode === 'timed_3h' ? '3시간 집중 모드' : '24시간 상시 모드'})`, 'system');
  broadcastLog(`🤖 ======================================================`, 'system');

  // 1. 일일 안전 쿼터 체크
  const safetyCheck = checkSafetyQuota('follow');
  if (!safetyCheck.allowed) {
    broadcastLog(`🛡️ [오토파일럿 일일 안전 도달] ${safetyCheck.reason}`, 'warning');
    broadcastLog(`💤 계정 보호를 위해 오토파일럿을 오늘 안전하게 휴식 상태로 전환합니다.`, 'system');
    autoPilotState.enabled = false;
    autoPilotState.nextRunAt = null;
    return;
  }

  isBotRunning = true;
  currentTaskName = `오토파일럿 ${cycleInfo}`;

  try {
    // 1단계: 안전 맞팔 선팔 (무인 헤드리스 모드)
    broadcastLog(`👥 1단계: 추천 유저 ${autoPilotState.followsPerCycle}명 안전 맞팔 실행 중...`, 'info');
    await growFollowers({
      targetCount: autoPilotState.followsPerCycle,
      headless: true,
      log: logger
    });

    // 2단계: 2사이클마다 또는 timed 모드일 때 핫딜 1건 자동 발행
    if (autoPilotState.enableAutoPost && (autoPilotState.cycleCount % 2 === 1)) {
      const postQuota = checkSafetyQuota('post');
      if (postQuota.allowed) {
        broadcastLog('☕ 맞팔 완료 후 계정 휴식을 위해 20초 대기 후 핫딜 포스팅 진행...', 'info');
        await new Promise(r => setTimeout(r, 20000));
        broadcastLog('🔥 2단계: 실시간 핫딜 카드 자동 발행 중...', 'info');
        await postHotDeal({ headless: true, log: logger });
      }
    }

    broadcastLog(`✨ ${cycleInfo} 사이클이 성공적으로 완료되었습니다!`, 'success');
  } catch (err) {
    broadcastLog(`❌ 오토파일럿 사이클 중 오류: ${err.message}`, 'error');
  } finally {
    isBotRunning = false;
    currentTaskName = null;
  }

  // timed 모드 완료 검사
  if (autoPilotState.maxCycles && autoPilotState.cycleCount >= autoPilotState.maxCycles) {
    broadcastLog(`🎉 [3시간 모드 완주!] 설정된 모든 목표(${autoPilotState.cycleCount}회차, 총 선팔 완료)를 달성하여 오토파일럿을 종료합니다.`, 'success');
    autoPilotState.enabled = false;
    autoPilotState.nextRunAt = null;
    return;
  }

  // 다음 사이클 예약 (기본 intervalMinutes)
  if (autoPilotState.enabled) {
    scheduleNextAutoPilot(autoPilotState.intervalMinutes * 60 * 1000);
  }
}

// JSON 응답 헬퍼
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

/** 프록시 앞에서도 실제 접속자가 로컬인지 보수적으로 판별한다. */
function isLoopbackAddress(address = '') {
  const normalized = String(address).replace(/^::ffff:/, '');
  return normalized === '127.0.0.1' || normalized === '::1';
}

function getClientIp(req) {
  const socketIp = req.socket?.remoteAddress || '';
  if (isLoopbackAddress(socketIp)) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded.replace(/^::ffff:/, '');
  }
  return String(socketIp).replace(/^::ffff:/, '');
}

/** 소켓 주소만 본다. X-Forwarded-For는 위조할 수 있어 신뢰 판정에 쓸 수 없다. */
function getSocketIp(req) {
  return String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
}

/**
 * 직접 로컬 접속 판정. 소켓이 루프백이면서 프록시 헤드가 하나도 없어야 인정한다.
 * 같은 호스트의 nginx/App Service가 우회하면 소켓은 루프백이지만 운영 트래픽이기 때문이다.
 */
function isDirectLocalRequest(req) {
  if (!isLoopbackAddress(getSocketIp(req))) return false;
  if (req.headers['x-forwarded-for'] || req.headers['x-forwarded-proto'] || req.headers.via) return false;
  return true;
}

function parseCookies(req) {
  return String(req.headers.cookie || '').split(';').reduce((acc, part) => {
    const index = part.indexOf('=');
    if (index < 0) return acc;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) acc[key] = decodeURIComponent(value);
    return acc;
  }, {});
}

function cleanupAuthSessions() {
  const now = Date.now();
  for (const [token, session] of authSessions) {
    if (session.expiresAt <= now) authSessions.delete(token);
  }
}

function getAuthenticatedSession(req) {
  cleanupAuthSessions();
  const token = parseCookies(req)[AUTH_COOKIE_NAME];
  if (!token) return null;
  const session = authSessions.get(token);
  if (!session || session.expiresAt <= Date.now()) return null;
  return { token, ...session };
}

function passwordsMatch(input) {
  const expected = Buffer.from(DASHBOARD_ADMIN_PASSWORD);
  const received = Buffer.from(String(input || ''));
  return expected.length === received.length && expected.length > 0 && crypto.timingSafeEqual(expected, received);
}

function setAuthCookie(res, token, req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const secure = forwardedProto === 'https' || req.socket?.encrypted;
  const flags = [`${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${Math.floor(AUTH_SESSION_TTL_MS / 1000)}`];
  if (secure) flags.push('Secure');
  res.setHeader('Set-Cookie', flags.join('; '));
}

function clearAuthCookie(res, req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const secure = forwardedProto === 'https' || req.socket?.encrypted;
  const flags = [`${AUTH_COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (secure) flags.push('Secure');
  res.setHeader('Set-Cookie', flags.join('; '));
}

function consumeRateLimit(req, scope, maxCount, windowMs) {
  const now = Date.now();
  const key = `${scope}:${getSocketIp(req)}`;
  const current = requestRateBuckets.get(key);
  if (!current || current.resetAt <= now) {
    requestRateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }
  current.count += 1;
  if (current.count <= maxCount) return { allowed: true, retryAfter: 0 };
  return { allowed: false, retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
}

function expectedRequestOrigin(req) {
  if (DASHBOARD_PUBLIC_ORIGIN) return DASHBOARD_PUBLIC_ORIGIN;
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || (req.socket?.encrypted ? 'https' : 'http');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return host ? `${proto}://${host}` : '';
}

function hasValidRequestOrigin(req) {
  const origin = String(req.headers.origin || '').replace(/\/$/, '');
  if (!origin) return true;
  return origin === expectedRequestOrigin(req);
}

// 요청 본문 운영 한도 — 메모리 무한 누적과 과도한 페이로드를 막는다.
const MAX_JSON_BODY_BYTES = 2 * 1024 * 1024;

// 요청 바디 파서
function parseJsonBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let receivedBytes = 0;
    let aborted = false;
    req.on('data', chunk => {
      if (aborted) return;
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_JSON_BODY_BYTES) {
        aborted = true;
        console.warn(`[Body] 요청 본문 한도 초과로 파서를 종료합니다. (${receivedBytes} bytes)`);
        req.destroy();
        return resolve({});
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      const body = Buffer.concat(chunks).toString('utf8');
      if (!body || !body.trim()) {
        return resolve({});
      }
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

// MIME 타입 매핑
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4'
};

const VAULT_FILE = path.join(rootDir, 'content_vault.json');
const UPLOAD_DIR = path.join(rootDir, 'uploads');
const SAFE_ROOT_HTML_FILES = new Set([
  'INDEX_GUIDE.html',
  'GUIDE.html',
  'GUIDE_RAPPORT_COMMENT.html',
  'GUIDE_CONTENT_VAULT.html',
  'GUIDE_GITHUB_BACKUP.html',
  'REPORT_AND_PLAN.html',
  'COMMENT_STRATEGY_PLAN.html'
]);
const MAX_UPLOAD_BYTES = 60 * 1024 * 1024; // 스레드 영상 상한을 고려한 보수적 한도
const ALLOWED_MEDIA_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.mov', '.webm']);
const ALLOWED_ENV_KEYS = new Set([
  'THREADS_ID',
  'THREADS_PW',
  'TOSS_SHARELINK_ACCESS_KEY',
  'TOSS_SHARELINK_SECRET_KEY',
  'TOSS_SHARELINK_PUBLISHER_ID'
]);

/** 공개 설정 응답에는 값의 존재 여부만 알 수 있도록 일부만 남긴다. */
function maskCredential(value) {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= 4) return '********';
  return `${text.slice(0, 2)}****${text.slice(-2)}`;
}

/** 업로드 파일명을 경로 탈출 없이 안전한 이름으로 정규화한다. */
function safeUploadName(rawName) {
  let decoded = String(rawName || 'upload');
  try { decoded = decodeURIComponent(decoded); } catch { /* 인코딩이 아니면 원본 사용 */ }
  const base = path.basename(decoded).replace(/[^\w.\-가-힣]/g, '_');
  const ext = path.extname(base).toLowerCase();
  if (!ALLOWED_MEDIA_EXT.has(ext)) return null;
  return `${Date.now()}_${base}`;
}

/** 브라우저에서 편집한 장면 설계도는 허용 필드와 길이만 통과시킨다. */
function sanitizeSceneSpec(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const allowedFields = [
    'domainKey', 'theme', 'subject', 'action', 'setting', 'time_of_day',
    'props', 'emotion', 'light', 'camera', 'fashion', 'weather', 'texture', 'harmony'
  ];
  const sceneSpec = { version: 1 };
  for (const field of allowedFields) {
    if (raw[field] === undefined || raw[field] === null) continue;
    sceneSpec[field] = String(raw[field]).trim().slice(0, 500);
  }
  // 부분 편집본(항목별 잠금/재추첨)을 허용하기 위해 핵심 필드 필수 조건은 두지 않는다.
  // 최소한 하나의 허용 필드가 있어야 유효하며, 누락 필드는 생성 쪽 mergeSceneSpec이 채운다.
  if (Object.keys(sceneSpec).length <= 1) return null;
  return sceneSpec;
}

/** 콘텐츠 볼트를 배열로 읽는다. (파일은 "0".."99" 키를 가진 객체) */
function readVault() {
  if (!fs.existsSync(VAULT_FILE)) return [];
  return Object.values(JSON.parse(fs.readFileSync(VAULT_FILE, 'utf-8')));
}

const TRENDS_CACHE_FILE = path.join(rootDir, 'trends_cache.json');

function saveTrendsCache(payload) {
  try {
    fs.writeFileSync(TRENDS_CACHE_FILE, JSON.stringify(payload, null, 2), 'utf-8');
  } catch (e) {
    broadcastLog(`⚠️ 검색어 분석 결과 저장 실패: ${e.message}`, 'warning');
  }
}

function readTrendsCache() {
  if (!fs.existsSync(TRENDS_CACHE_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(TRENDS_CACHE_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

/** 발행 완료된 볼트 항목에 상태와 발행 시각을 기록한다. */
function markVaultPosted(vaultId) {
  if (!fs.existsSync(VAULT_FILE)) return;
  const vault = JSON.parse(fs.readFileSync(VAULT_FILE, 'utf-8'));
  const key = Object.keys(vault).find(k => vault[k].id === vaultId);
  if (!key) return;
  vault[key] = { ...vault[key], status: 'POSTED', postedAt: new Date().toISOString() };
  fs.writeFileSync(VAULT_FILE, JSON.stringify(vault, null, 2), 'utf-8');
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // CORS 프리플라이트 처리
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Allow': 'GET, POST, PUT, DELETE, OPTIONS'
    });
    return res.end();
  }

  // 공개 운영 제어면 인증. 비밀번호 미설정 상태는 직접 로컬 접속만 허용한다.
  if (pathname === '/api/auth/status' && req.method === 'GET') {
    const localBypass = !DASHBOARD_ADMIN_PASSWORD && isDirectLocalRequest(req);
    return sendJson(res, 200, {
      success: true,
      configured: !!DASHBOARD_ADMIN_PASSWORD,
      authenticated: localBypass || !!getAuthenticatedSession(req),
      localBypass
    });
  }

  if (pathname === '/api/auth/login' && req.method === 'POST') {
    const rate = consumeRateLimit(req, 'auth-login', 10, 15 * 60 * 1000);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfter));
      return sendJson(res, 429, { error: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.' });
    }
    if (!hasValidRequestOrigin(req)) {
      return sendJson(res, 403, { error: '허용되지 않은 요청 출처입니다.' });
    }
    if (!DASHBOARD_ADMIN_PASSWORD) {
      if (isDirectLocalRequest(req)) return sendJson(res, 200, { success: true, localBypass: true });
      return sendJson(res, 503, { error: '운영 관리자 비밀번호가 설정되지 않았습니다.' });
    }
    const body = await parseJsonBody(req);
    if (!passwordsMatch(body.password)) {
      return sendJson(res, 401, { error: '관리자 비밀번호가 올바르지 않습니다.' });
    }
    const token = crypto.randomBytes(32).toString('base64url');
    authSessions.set(token, { createdAt: Date.now(), expiresAt: Date.now() + AUTH_SESSION_TTL_MS, ip: getClientIp(req) });
    setAuthCookie(res, token, req);
    return sendJson(res, 200, { success: true, expiresInSeconds: Math.floor(AUTH_SESSION_TTL_MS / 1000) });
  }

  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    const session = getAuthenticatedSession(req);
    if (session) authSessions.delete(session.token);
    clearAuthCookie(res, req);
    return sendJson(res, 200, { success: true });
  }

  if (pathname.startsWith('/api/')) {
    const contentType = String(req.headers['content-type'] || '');
    const declaredLength = Number(req.headers['content-length'] || 0);
    // /api/upload은 raw 스트리밍(최대 60MB)이라 JSON 본문 한도 검사에서 제외한다.
    if (contentType.includes('application/json') && Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
      return sendJson(res, 413, { error: '요청 본문이 허용 크기를 초과했습니다.', code: 'PAYLOAD_TOO_LARGE' });
    }
    const localBypass = !DASHBOARD_ADMIN_PASSWORD && isDirectLocalRequest(req);
    if (!DASHBOARD_ADMIN_PASSWORD && !localBypass) {
      return sendJson(res, 503, { error: 'DASHBOARD_ADMIN_PASSWORD 설정 후 이용할 수 있습니다.', code: 'DASHBOARD_AUTH_NOT_CONFIGURED' });
    }
    if (!localBypass && !getAuthenticatedSession(req)) {
      return sendJson(res, 401, { error: '관리자 로그인이 필요합니다.', code: 'DASHBOARD_AUTH_REQUIRED' });
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      if (!hasValidRequestOrigin(req)) {
        return sendJson(res, 403, { error: '허용되지 않은 요청 출처입니다.', code: 'INVALID_REQUEST_ORIGIN' });
      }
      const rate = consumeRateLimit(req, 'api-mutation', 120, 60 * 1000);
      if (!rate.allowed) {
        res.setHeader('Retry-After', String(rate.retryAfter));
        return sendJson(res, 429, { error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' });
      }
    }
  }

  // 1. SSE 실시간 로그 스트림 엔드포인트
  if (pathname === '/api/logs/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff'
    });
    res.write(': connected\n\n');
    sseClients.add(res);

    const cleanup = () => sseClients.delete(res);
    req.on('close', cleanup);
    res.on('close', cleanup);
    res.on('finish', cleanup);
    res.on('error', cleanup);
    return;
  }

  // 1-1. DB 저장 로그 히스토리 조회 (GET /api/logs/history) - 새로고침 시 복원용
  if (pathname === '/api/logs/history' && req.method === 'GET') {
    const limit = Math.min(500, Math.max(10, parseInt(parsedUrl.searchParams.get('limit') || '150', 10)));
    const filterType = parsedUrl.searchParams.get('type') || null;
    const logs = getRecentLogs(limit, filterType);
    const stats = getLogStats();
    return sendJson(res, 200, {
      success: true,
      logs,
      stats
    });
  }

  // 1-2. 로그 통계 조회 (GET /api/logs/stats)
  if (pathname === '/api/logs/stats' && req.method === 'GET') {
    const stats = getLogStats();
    return sendJson(res, 200, { success: true, stats });
  }

  // 1-3. 로그 전체 비우기 (POST /api/logs/clear)
  if (pathname === '/api/logs/clear' && req.method === 'POST') {
    clearLogs();
    broadcastLog('🗑️ 사용자 요청으로 로그 데이터베이스가 초기화되었습니다.', 'system');
    return sendJson(res, 200, { success: true, message: '로그 데이터베이스가 비워졌습니다.' });
  }

  // 1-4. 전체 로그 텍스트 파일 다운로드 (GET /api/logs/download)
  if (pathname === '/api/logs/download' && req.method === 'GET') {
    const logFilePath = path.join(rootDir, 'system_logs.log');
    if (!fs.existsSync(logFilePath)) {
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': 'attachment; filename=system_logs.log'
      });
      return res.end('로그 기록이 아직 없습니다.\n');
    }
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': 'attachment; filename=system_logs.log'
    });
    return fs.createReadStream(logFilePath).pipe(res);
  }

  // 2. 시스템 및 계정 상태 조회
  if (pathname === '/api/status' && req.method === 'GET') {
    dotenv.config({ path: path.join(rootDir, '.env'), override: true });
    const dailyStats = getDailyStats();
    const hasThreadsAccount = !!(process.env.THREADS_ID && process.env.THREADS_PW);
    const hasTossApi = !!(process.env.TOSS_SHARELINK_ACCESS_KEY && process.env.TOSS_SHARELINK_SECRET_KEY);

    return sendJson(res, 200, {
      isRunning: isBotRunning,
      currentTask: currentTaskName,
      threadsId: maskCredential(process.env.THREADS_ID),
      hasAccount: hasThreadsAccount,
      hasTossApi,
      dailyStats,
      safetyLimits: SAFETY_LIMITS
    });
  }

  // 3. 설정 조회 (GET /api/config)
  if (pathname === '/api/config' && req.method === 'GET') {
    dotenv.config({ path: path.join(rootDir, '.env'), override: true });
    const config = loadConfig();
    return sendJson(res, 200, {
      config,
      env: {
        THREADS_ID: maskCredential(process.env.THREADS_ID),
        THREADS_PW: process.env.THREADS_PW ? '********' : '',
        TOSS_SHARELINK_ACCESS_KEY: maskCredential(process.env.TOSS_SHARELINK_ACCESS_KEY),
        TOSS_SHARELINK_SECRET_KEY: process.env.TOSS_SHARELINK_SECRET_KEY ? '********' : '',
        TOSS_SHARELINK_PUBLISHER_ID: maskCredential(process.env.TOSS_SHARELINK_PUBLISHER_ID)
      }
    });
  }

  // 4. 설정 저장 (POST /api/config)
  if (pathname === '/api/config' && req.method === 'POST') {
    try {
      const data = await parseJsonBody(req);
      const configPath = path.join(rootDir, 'config.json');
      const envPath = path.join(rootDir, '.env');

      if (data.config) {
        const safeConfig = {
          ...data.config,
          post: {
            ...(data.config.post || {}),
            commentTemplate: '',
            linkPosition: 'body'
          }
        };
        fs.writeFileSync(configPath, JSON.stringify(safeConfig, null, 2), 'utf8');
      }

      if (data.env) {
        let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
        for (const [k, v] of Object.entries(data.env)) {
          if (!ALLOWED_ENV_KEYS.has(k)) continue;
          if (typeof v !== 'string' || !v || v.includes('****') || /[\r\n]/.test(v)) continue; // 마스킹/줄 삽입 값은 보존·거부
          if (envContent.includes(`${k}=`)) {
            envContent = envContent.replace(new RegExp(`${k}=.*`, 'g'), `${k}=${v}`);
          } else {
            envContent += `\n${k}=${v}`;
          }
        }
        fs.writeFileSync(envPath, envContent.trim() + '\n', 'utf8');
      }

      broadcastLog('⚙️ 대시보드 및 자동화 설정이 성공적으로 저장되었습니다.', 'success');
      return sendJson(res, 200, { success: true });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // 5. 카드 목록 조회 (GET /api/cards)
  if (pathname === '/api/cards' && req.method === 'GET') {
    const cards = getSavedCards();
    return sendJson(res, 200, { cards });
  }

  // 6. 카드 자동 생성 (POST /api/cards/generate)
  if (pathname === '/api/cards/generate' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      broadcastLog('🎨 토스 실시간 핫딜 기반 스레드 포스팅 카드 생성 시작...', 'system');
      const cards = await generateThreadCards({
        count: body.count || 8,
        source: body.source || 'best'
      });
      broadcastLog(`✨ ${cards.length}개의 포스팅 카드가 준비되었습니다!`, 'success');
      return sendJson(res, 200, { success: true, cards });
    } catch (e) {
      broadcastLog(`❌ 카드 생성 실패: ${e.message}`, 'error');
      return sendJson(res, 500, { error: e.message });
    }
  }

  // 7. 카드 수정 (PUT /api/cards/:id)
  if (pathname.startsWith('/api/cards/') && req.method === 'PUT') {
    const cardId = pathname.replace('/api/cards/', '');
    try {
      const updates = { ...(await parseJsonBody(req)), firstComment: '' };
      const updated = updateCard(cardId, updates);
      return sendJson(res, 200, { success: !!updated, card: updated });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // 8. 카드 삭제 (DELETE /api/cards/:id)
  if (pathname.startsWith('/api/cards/') && req.method === 'DELETE') {
    const cardId = pathname.replace('/api/cards/', '');
    const cards = deleteCard(cardId);
    return sendJson(res, 200, { success: true, cards });
  }

  // 9. 특정 카드 단건 즉시 포스팅 (POST /api/cards/:id/post)
  if (pathname.includes('/api/cards/') && pathname.endsWith('/post') && req.method === 'POST') {
    if (isBotRunning) {
      return sendJson(res, 400, { error: '이미 다른 봇 작업이 실행 중입니다.' });
    }

    const cardId = pathname.split('/')[3];
    const cards = getSavedCards();
    const card = cards.find(c => c.id === cardId);

    if (!card) {
      return sendJson(res, 404, { error: '해당 카드를 찾을 수 없습니다.' });
    }

    const body = await parseJsonBody(req);
    const headless = body.headless !== undefined ? body.headless : false;

    isBotRunning = true;
    currentTaskName = `카드 포스팅 [${card.title.slice(0, 15)}...]`;

    // 비동기 작업 실행
    (async () => {
      try {
        broadcastLog(`🚀 [${card.title}] 카드 스레드 발행 시작...`, 'system');
        updateCard(cardId, { status: 'POSTING' });

        const result = await postSingleCard(card, {
          headless,
          log: (msg) => broadcastLog(msg, 'info')
        });

        if (result.success) {
          updateCard(cardId, { status: 'POSTED', postedAt: new Date().toISOString() });
          broadcastLog(`🎉 [${card.title}] 발행 성공!`, 'success');
        } else {
          updateCard(cardId, { status: 'FAILED' });
          broadcastLog(`❌ 발행 실패: ${result.error}`, 'error');
        }
      } catch (err) {
        updateCard(cardId, { status: 'FAILED' });
        broadcastLog(`❌ 예외 오류: ${err.message}`, 'error');
      } finally {
        isBotRunning = false;
        currentTaskName = null;
      }
    })();

    return sendJson(res, 200, { success: true, message: '포스팅 작업이 시작되었습니다.' });
  }

  // 10. 봇 동작 제어 (POST /api/bot/action)
  if (pathname === '/api/bot/action' && req.method === 'POST') {
    const { action, options = {} } = await parseJsonBody(req);
    const safeOptions = {
      ...options,
      headless: (process.platform === 'linux' && !process.env.DISPLAY) ? true : (options.headless ?? true)
    };

    if (action === 'stop') {
      broadcastLog('🛑 사용자 요청으로 봇 중단 시그널을 전달합니다...', 'warning');
      stopBot();
      isBotRunning = false;
      currentTaskName = null;
      return sendJson(res, 200, { success: true, message: '중단되었습니다.' });
    }

    if (isBotRunning) {
      return sendJson(res, 400, { error: `이미 '${currentTaskName}' 작업이 진행 중입니다.` });
    }

    isBotRunning = true;
    currentTaskName = action === 'grow' ? '맞팔 늘리기' : action === 'post' ? '핫딜 포스팅' : action === 'login' ? '스레드 로그인' : '올인원 자동화';

    // 백그라운드 태스크 실행
    (async () => {
      const logger = (msg) => broadcastLog(msg, 'info');
      try {
        if (action === 'login') {
          broadcastLog('🌐 스레드 브라우저 로그인 세션 창을 엽니다...', 'system');
          await loginSession({ ...safeOptions, log: logger });
        } else if (action === 'grow') {
          broadcastLog('🛡️ 스레드 안전 맞팔 늘리기 가동...', 'system');
          await growFollowers({ ...safeOptions, log: logger });
        } else if (action === 'post') {
          broadcastLog('🔥 토스 핫딜 자동 포스팅 가동...', 'system');
          await postHotDeal({ ...safeOptions, log: logger });
        } else if (action === 'all') {
          broadcastLog('🚀 올인원 (맞팔 + 핫딜) 자동화 가동...', 'system');
          await growFollowers({ ...safeOptions, targetCount: 12, log: logger });
          broadcastLog('☕ 계정 보호를 위해 포스팅 전 15초 휴식...', 'info');
          await new Promise(r => setTimeout(r, 15000));
          await postHotDeal({ ...safeOptions, log: logger });
        }
      } catch (err) {
        broadcastLog(`❌ 작업 에러: ${err.message}`, 'error');
      } finally {
        isBotRunning = false;
        currentTaskName = null;
        broadcastLog('✨ 작업 프로세스가 종료되었습니다.', 'system');
      }
    })();

    return sendJson(res, 200, { success: true, action, task: currentTaskName });
  }

  // 11. 무인 오토파일럿 상태 조회 (GET /api/autopilot)
  if (pathname === '/api/autopilot' && req.method === 'GET') {
    const { timerId, ...safeState } = autoPilotState;
    return sendJson(res, 200, {
      ...safeState,
      isBotRunning,
      currentTaskName,
      dailyStats: getDailyStats(),
      safetyLimits: SAFETY_LIMITS
    });
  }

  // 12. 무인 오토파일럿 제어 (POST /api/autopilot)
  if (pathname === '/api/autopilot' && req.method === 'POST') {
    const { action, mode = 'timed_3h', intervalMinutes = 30, followsPerCycle = 5, enableAutoPost = true } = await parseJsonBody(req);

    if (action === 'stop') {
      if (autoPilotState.timerId) {
        clearTimeout(autoPilotState.timerId);
        autoPilotState.timerId = null;
      }
      autoPilotState.enabled = false;
      autoPilotState.nextRunAt = null;
      broadcastLog('🛑 무인 오토파일럿이 사용자에 의해 정지되었습니다.', 'warning');
      return sendJson(res, 200, { success: true, autoPilotState });
    }

    if (action === 'start') {
      autoPilotState.enabled = true;
      autoPilotState.mode = mode;
      autoPilotState.intervalMinutes = Math.max(15, intervalMinutes);
      autoPilotState.followsPerCycle = Math.min(10, Math.max(3, followsPerCycle));
      autoPilotState.enableAutoPost = enableAutoPost;
      autoPilotState.cycleCount = 0;
      // timed_3h일 경우: 30분 간격 x 6사이클 = 3시간 (총 30명 선팔)
      autoPilotState.maxCycles = mode === 'timed_3h' ? 6 : null;

      broadcastLog(`🚀 [오토파일럿 가동] 모드: ${mode === 'timed_3h' ? '3시간 집중 모드 (총 6사이클, 약 30명)' : '24시간 상시 모드'}, 간격: ${autoPilotState.intervalMinutes}분마다`, 'system');

      // 즉시 첫 번째 사이클 시작
      executeAutoPilotCycle().catch(err => broadcastLog(`오토파일럿 실행 오류: ${err.message}`, 'error'));

      return sendJson(res, 200, { success: true, autoPilotState });
    }

    return sendJson(res, 400, { error: '유효하지 않은 액션입니다.' });
  }

  // 13. 댓글 히스토리 및 통계 조회 (GET /api/comments-history)
  if (pathname === '/api/comments-history' && req.method === 'GET') {
    const commentsPath = path.join(rootDir, 'comments_history.json');
    let history = [];
    try {
      if (fs.existsSync(commentsPath)) {
        history = JSON.parse(fs.readFileSync(commentsPath, 'utf8'));
      }
    } catch (e) {}

    const todayStr = new Date().toISOString().slice(0, 10);
    const todayComments = history.filter(c => c.timestamp && c.timestamp.startsWith(todayStr));

    return sendJson(res, 200, {
      totalCount: history.length,
      todayCount: todayComments.length,
      dailyLimit: RAPPORT_LIMITS.maxPerDay,
      history
    });
  }

  // 14. 현재 권한 기반 내 게시물 인바운드 라포 답글 상태 확인
  if (pathname === '/api/rapport/status' && req.method === 'GET') {
    const permission = await getRapportPermissionStatus();
    return sendJson(res, 200, {
      success: true,
      permission,
      limits: RAPPORT_LIMITS,
      usage: getRapportUsage()
    });
  }

  // 14-1. 내 게시물 인바운드 AI 답글 실행 — 최상위 게시 엔진·브라우저 자동화와 분리
  if (pathname === '/api/run-rapport-replies' && req.method === 'POST') {
    if (isBotRunning) {
      return sendJson(res, 409, { error: `이미 '${currentTaskName}' 작업이 실행 중입니다.` });
    }
    const body = await parseJsonBody(req);
    const targetCount = Math.min(RAPPORT_LIMITS.maxPerRun, Math.max(1, Number(body.count) || 1));
    const permission = await getRapportPermissionStatus();
    if (!permission.ready) {
      return sendJson(res, 403, {
        success: false,
        code: 'THREADS_RAPPORT_PERMISSION_REQUIRED',
        error: `Threads 공식 API 권한이 필요합니다: ${permission.missing.join(', ')}`,
        permission
      });
    }

    isBotRunning = true;
    currentTaskName = `인바운드 AI 라포 답글 ${targetCount}건`;
    (async () => {
      try {
        broadcastLog(`💬 [인바운드 라포 시작] 내 게시물의 미응답 댓글을 조회해 안전 대상 ${targetCount}건을 선별합니다.`, 'system');
        const result = await runRapportReplyBatch({
          targetCount,
          log: message => broadcastLog(message, 'info')
        });
        if (result.success) {
          broadcastLog(`🎉 [인바운드 라포 완료] ${result.count}건 발행·부모 관계 검증 완료`, 'success');
        } else {
          broadcastLog(`⚠️ [인바운드 라포 종료] ${result.reason || '응답할 안전한 미응답 댓글 없음'}`, 'warning');
        }
      } catch (error) {
        broadcastLog(`❌ 라포 답글 오류: ${error.message}`, 'error');
      } finally {
        isBotRunning = false;
        currentTaskName = null;
      }
    })();

    return sendJson(res, 202, {
      success: true,
      count: targetCount,
      message: `내 게시물의 미응답 댓글을 대상으로 AI 라포 답글 ${targetCount}건 작업을 시작했습니다.`
    });
  }

  // 14-2. 팔로워 피드 자동 하트(좋아요) 봇 실행 (POST /api/run-heart-bot)
  if (pathname === '/api/run-heart-bot' && req.method === 'POST') {
    if (isBotRunning) {
      return sendJson(res, 400, { error: `이미 '${currentTaskName}' 작업이 실행 중입니다.` });
    }

    const body = await parseJsonBody(req);
    // 1회 실행 상한은 safety_guard 한 곳에서만 정한다 (하루 한도와 짝이라 따로 놀면 안 된다)
    const count = Math.min(SAFETY_LIMITS.MAX_HEARTS_PER_SESSION, Math.max(3, body.count || 10));

    const quota = checkSafetyQuota('heart');
    if (!quota.allowed) {
      return sendJson(res, 429, { error: `계정 보호 쉴드: ${quota.reason}` });
    }

    isBotRunning = true;
    currentTaskName = `팔로워 피드 하트 (목표 ${count}건)`;

    // 비동기 백그라운드 실행
    (async () => {
      try {
        broadcastLog(`❤️ [팔로워 피드 하트 봇] 최신 피드 순회 하트 ${count}건 자동 클릭을 시작합니다...`, 'system');
        const resBot = await runFeedHeartBot(count, (msg) => broadcastLog(msg, 'info'));
        if (resBot.success) {
          broadcastLog(`🎉 [피드 하트 완료] 총 ${resBot.count}건의 최신 글에 하트(좋아요)를 성공적으로 눌렀습니다!`, 'success');
        } else {
          broadcastLog(`⚠️ [피드 하트 중단] ${resBot.reason || '작업이 완료되지 않았습니다.'}`, 'warning');
        }
      } catch (err) {
        broadcastLog(`❌ 피드 하트 봇 에러: ${err.message}`, 'error');
      } finally {
        isBotRunning = false;
        currentTaskName = null;
      }
    })();

    return sendJson(res, 200, { success: true, count, message: `${count}건 피드 하트 작업이 백그라운드에서 시작되었습니다.` });
  }

  // 14-2. 팔로잉 피드 아웃바운드 라포 답글 (브라우저 경로 — 공식 API에 팔로잉 피드 조회가 없다)
  if (pathname === '/api/run-feed-rapport' && req.method === 'POST') {
    if (isBotRunning) {
      return sendJson(res, 400, { error: `이미 '${currentTaskName}' 작업이 실행 중입니다.` });
    }

    const body = await parseJsonBody(req);
    const dryRun = body.dryRun === true;
    // 1회 실행 상한은 safety_guard 한 곳에서만 정한다 (하루 한도와 짝이라 따로 놀면 안 된다)
    const count = Math.min(SAFETY_LIMITS.MAX_OUTBOUND_COMMENTS_PER_SESSION, Math.max(1, body.count || 1));

    const quota = checkSafetyQuota('outbound_comment');
    if (!quota.allowed) {
      return sendJson(res, 429, { error: `계정 보호 쉴드: ${quota.reason}` });
    }

    isBotRunning = true;
    currentTaskName = `피드 라포 답글 (목표 ${count}건${dryRun ? ' · DRY RUN' : ''})`;

    (async () => {
      try {
        broadcastLog(`💬 [피드 라포 답글] 팔로잉 피드 아웃바운드 답글 ${count}건${dryRun ? ' (DRY RUN · 발행 없음)' : ''}을 시작합니다...`, 'system');
        const resBot = await runFeedRapportBot(count, (msg) => broadcastLog(msg, 'info'), { dryRun });
        if (resBot.success) {
          broadcastLog(`🎉 [피드 라포 답글 완료] 총 ${resBot.count}건${resBot.dryRun ? ' (DRY RUN · 실제 발행 없음)' : '을 발행했습니다.'}`, 'success');
        } else {
          broadcastLog(`⚠️ [피드 라포 답글 중단] ${resBot.reason || '작업이 완료되지 않았습니다.'}`, 'warning');
        }
      } catch (err) {
        broadcastLog(`❌ 피드 라포 답글 봇 에러: ${err.message}`, 'error');
      } finally {
        isBotRunning = false;
        currentTaskName = null;
      }
    })();

    return sendJson(res, 200, { success: true, count, dryRun, message: `${count}건 피드 답글 작업이 백그라운드에서 시작되었습니다.` });
  }

  // 15. 검색어 시장조사 초기 데이터 조회
  if (pathname === '/api/trends/overview' && req.method === 'GET') {
    try {
      const googleTrends = await getGoogleTrending();
      const naverTrends = getNaverTrendingOverview();
      const threadsTrends = getThreadsTrendingOverview();
      const updatedAt = new Date().toISOString();

      // 화면에 보이는 3개 플랫폼 × 8개 = 24개 검색어를 순위별로 교차 배열해 저장한다.
      // 플랫폼별로 묶어두면 앞 순서만 계속 쓰이므로 G1→N1→T1→G2 순으로 섞는다.
      const liveKeywords = [];
      for (let rankIndex = 0; rankIndex < 8; rankIndex++) {
        const rows = [
          { ...googleTrends[rankIndex], source: 'google' },
          { ...naverTrends[rankIndex], source: 'naver' },
          { ...threadsTrends[rankIndex], source: 'threads' }
        ];
        for (const row of rows) {
          if (row.keyword) liveKeywords.push({
            keyword: row.keyword,
            source: row.source,
            rank: row.rank || rankIndex + 1,
            score: row.score || row.traffic || 0
          });
        }
      }
      const previousCache = readTrendsCache() || {};
      saveTrendsCache({
        ...previousCache,
        updatedAt,
        liveKeywords,
        liveKeywordCount: liveKeywords.length
      });

      return sendJson(res, 200, {
        success: true,
        updatedAt,
        googleTrends,
        naverTrends,
        threadsTrends,
        sources: {
          google: { status: 'connected', label: '실시간 RSS 연결됨' },
          naver: { status: 'ready', label: 'Azure Key Vault 연동' },
          threads: { status: 'connected', label: 'Threads 실시간 검색 연결됨 (트랙 A)' }
        }
      });
    } catch (e) {
      return sendJson(res, 502, { error: `급상승 검색어를 불러오지 못했습니다: ${e.message}` });
    }
  }

  // 16. 후보 검색어 교차 분석
  if (pathname === '/api/trends/analyze' && req.method === 'POST') {
    const body = await parseJsonBody(req);
    const keywords = normalizeKeywords(body.keywords);
    if (!keywords.length) return sendJson(res, 400, { error: '분석할 검색어를 하나 이상 입력해 주세요.' });

    try {
      const [googleResult, naverResult] = await Promise.allSettled([
        getGoogleTrending(),
        getNaverKeywordTrends(keywords)
      ]);
      const googleTrends = googleResult.status === 'fulfilled' ? googleResult.value : [];
      const naverTrends = naverResult.status === 'fulfilled' ? naverResult.value : [];

      let threadsResults = [];
      let threadsStatus = { status: 'connected', label: 'Threads 실시간 검색 연결됨 (트랙 A)' };
      if (body.includeThreads !== false) {
        // 동일한 영속 Chrome 프로필을 동시에 열면 프로필 잠금으로 검색 프로세스가
        // 종료될 수 있다. 컨텍스트가 닫힌 뒤 다음 검색을 시작하도록 순차 처리한다.
        for (const keyword of keywords) {
          threadsResults.push(await searchThreadsKeyword(keyword));
        }

        const failedThreads = threadsResults.filter(result => result.error);
        if (failedThreads.length === keywords.length) {
          threadsStatus = { status: 'error', label: 'Threads 검색 확인 실패' };
        } else if (failedThreads.length) {
          threadsStatus = {
            status: 'warning',
            label: `Threads 일부 확인 실패 (${keywords.length - failedThreads.length}/${keywords.length} 완료)`
          };
        }
      }

      const opportunities = buildOpportunities(keywords, googleTrends, naverTrends, threadsResults);
      // 분석 결과를 기존 24개 실시간 검색어 캐시와 병합한다.
      // 분석할 때 liveKeywords를 덮어쓰면 후보 생성이 다시 상위 몇 개로 퇴행한다.
      const previousCache = readTrendsCache() || {};
      saveTrendsCache({
        ...previousCache,
        updatedAt: new Date().toISOString(),
        keywords,
        opportunities
      });
      broadcastLog(`🔎 검색어 시장조사 완료: ${keywords.join(', ')}`, 'success');
      return sendJson(res, 200, {
        success: true,
        updatedAt: new Date().toISOString(),
        keywords,
        googleTrends,
        naverTrends: getNaverTrendingOverview(),
        threadsTrends: getThreadsTrendingOverview(),
        threadsResults,
        analysis: {
          threads: {
            requested: body.includeThreads === false ? 0 : keywords.length,
            successful: threadsResults.filter(result => !result.error).length,
            failed: threadsResults.filter(result => result.error).length
          }
        },
        opportunities,
        sources: {
          google: googleResult.status === 'fulfilled'
            ? { status: 'connected', label: '실시간 RSS 연결됨' }
            : { status: 'error', label: googleResult.reason.message },
          naver: naverResult.status === 'fulfilled'
            ? { status: 'connected', label: 'NAVER API HUB 연결됨' }
            : { status: 'error', label: naverResult.reason.message },
          threads: threadsStatus
        }
      });
    } catch (e) {
      broadcastLog(`❌ 검색어 시장조사 실패: ${e.message}`, 'error');
      return sendJson(res, 500, { error: e.message });
    }
  }

  // 17. 콘텐츠 볼트 목록 조회 (GET /api/vault)
  if (pathname === '/api/vault' && req.method === 'GET') {
    try {
      const items = readVault();
      const category = parsedUrl.searchParams.get('category');
      const status = parsedUrl.searchParams.get('status');
      const filtered = items.filter(item => {
        const st = item.status || 'READY';
        // 기본 목록에서는 삭제함(DELETED) 항목을 숨긴다. status=DELETED로 명시적 요청 시에만 노출.
        if (status) {
          if (st !== status) return false;
        } else if (st === 'DELETED') {
          return false;
        }
        return !category || item.category === category;
      });
      // 카테고리 목록은 삭제되지 않은 항목 기준
      const categories = [...new Set(items.filter(i => (i.status || 'READY') !== 'DELETED').map(item => item.category).filter(Boolean))];
      const counts = {
        ready: items.filter(i => (i.status || 'READY') === 'READY').length,
        posted: items.filter(i => i.status === 'POSTED').length,
        deleted: items.filter(i => i.status === 'DELETED').length
      };
      return sendJson(res, 200, { success: true, total: items.length, counts, categories, items: filtered });
    } catch (e) {
      return sendJson(res, 500, { error: `콘텐츠 볼트를 읽지 못했습니다: ${e.message}` });
    }
  }

  // 17-A. 볼트 신규 항목 추가 (POST /api/vault)
  if (pathname === '/api/vault' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const postText = String(body.postText || '').trim();
      if (!postText) return sendJson(res, 400, { error: '본문 내용을 입력해 주세요.' });
      if (postText.length > 500) return sendJson(res, 400, { error: '스레드 본문은 500자를 넘을 수 없습니다.' });
      const tags = Array.isArray(body.tags)
        ? body.tags
        : String(body.tags || '').split(/[\s,]+/).filter(Boolean).map(t => t.startsWith('#') ? t : `#${t}`);
      const saved = await upsertVaultItem({
        category: body.category || '기타',
        hookType: body.hookType || '',
        postText,
        tags,
        status: 'READY'
      });
      broadcastLog(`📦 볼트에 새 원고를 추가했습니다: "${postText.replace(/\s+/g, ' ').slice(0, 20)}..."`, 'info');
      return sendJson(res, 200, { success: true, item: saved });
    } catch (e) {
      return sendJson(res, 500, { error: `볼트 추가 실패: ${e.message}` });
    }
  }

  // 17-B. 볼트 항목 수정 (PUT /api/vault/:id)
  if (pathname.startsWith('/api/vault/') && req.method === 'PUT') {
    const vaultId = decodeURIComponent(pathname.slice('/api/vault/'.length));
    try {
      const body = await parseJsonBody(req);
      const postText = String(body.postText || '').trim();
      if (!postText) return sendJson(res, 400, { error: '본문 내용을 입력해 주세요.' });
      if (postText.length > 500) return sendJson(res, 400, { error: '스레드 본문은 500자를 넘을 수 없습니다.' });
      const tags = Array.isArray(body.tags)
        ? body.tags
        : String(body.tags || '').split(/[\s,]+/).filter(Boolean).map(t => t.startsWith('#') ? t : `#${t}`);
      const patch = { id: vaultId, postText, tags };
      if (body.category !== undefined) patch.category = body.category;
      if (body.hookType !== undefined) patch.hookType = body.hookType;
      if (body.status !== undefined) patch.status = body.status;
      const saved = await upsertVaultItem(patch);
      broadcastLog(`✏️ 볼트 원고를 수정했습니다: ${vaultId}`, 'info');
      return sendJson(res, 200, { success: true, item: saved });
    } catch (e) {
      return sendJson(res, 500, { error: `볼트 수정 실패: ${e.message}` });
    }
  }

  // 17-C. 볼트 항목 복구 (POST /api/vault/:id/restore)
  if (pathname.startsWith('/api/vault/') && pathname.endsWith('/restore') && req.method === 'POST') {
    const vaultId = decodeURIComponent(pathname.slice('/api/vault/'.length, -('/restore'.length)));
    try {
      const ok = await restoreVaultItem(vaultId);
      if (!ok) return sendJson(res, 404, { error: '해당 볼트 항목을 찾지 못했습니다.' });
      broadcastLog(`♻️ 삭제된 볼트 원고를 복구했습니다: ${vaultId}`, 'info');
      return sendJson(res, 200, { success: true });
    } catch (e) {
      return sendJson(res, 500, { error: `볼트 복구 실패: ${e.message}` });
    }
  }

  // 17-D. 볼트 항목 삭제 (DELETE /api/vault/:id[?hard=1])
  if (pathname.startsWith('/api/vault/') && req.method === 'DELETE') {
    const vaultId = decodeURIComponent(pathname.slice('/api/vault/'.length));
    const hard = parsedUrl.searchParams.get('hard') === '1' || parsedUrl.searchParams.get('hard') === 'true';
    try {
      const ok = await deleteVaultItem(vaultId, { hard });
      if (!ok) return sendJson(res, 404, { error: '해당 볼트 항목을 찾지 못했습니다.' });
      broadcastLog(`🗑️ 볼트 원고를 ${hard ? '완전 삭제' : '삭제함으로 이동'}했습니다: ${vaultId}`, 'info');
      return sendJson(res, 200, { success: true, hard });
    } catch (e) {
      return sendJson(res, 500, { error: `볼트 삭제 실패: ${e.message}` });
    }
  }

  // 17-1. 미디어 파일 업로드 (POST /api/upload)
  // 본문을 그대로 디스크로 흘려보낸다. base64로 감싸면 33% 부풀고 메모리에 통째로 올라간다.
  if (pathname === '/api/upload' && req.method === 'POST') {
    const fileName = safeUploadName(req.headers['x-filename']);
    if (!fileName) {
      return sendJson(res, 400, { error: '허용되지 않는 파일 형식입니다. (이미지: png/jpg/webp/gif, 영상: mp4/mov/webm)' });
    }

    const declaredSize = Number(req.headers['content-length'] || 0);
    if (declaredSize > MAX_UPLOAD_BYTES) {
      return sendJson(res, 413, { error: `파일이 너무 큽니다. (최대 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB)` });
    }

    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const destPath = path.join(UPLOAD_DIR, fileName);
    const out = fs.createWriteStream(destPath);
    let written = 0;
    let aborted = false;

    req.on('data', chunk => {
      written += chunk.length;
      // content-length를 속인 경우를 대비해 실제 수신량으로도 막는다.
      if (written > MAX_UPLOAD_BYTES && !aborted) {
        aborted = true;
        out.destroy();
        fs.unlink(destPath, () => {});
        sendJson(res, 413, { error: '파일이 너무 큽니다.' });
        req.destroy();
      }
    });

    req.pipe(out);

    return new Promise((resolve) => {
      out.on('finish', () => {
        if (aborted) return resolve();
        broadcastLog(`📎 미디어 업로드 완료: ${fileName} (${Math.round(written / 1024)}KB)`, 'info');
        sendJson(res, 200, { success: true, fileName, size: written, url: `/uploads/${fileName}` });
        resolve();
      });
      out.on('error', (err) => {
        if (aborted) return resolve();
        fs.unlink(destPath, () => {});
        sendJson(res, 500, { error: `업로드 실패: ${err.message}` });
        resolve();
      });
    });
  }

  // 17-2. 발행 후보 10개 생성 (POST /api/candidates)
  // 뉴스 목표 5개 + 스토리·볼트 자동 배분 5개.
  // 외부 생성 실패로 목표가 모자라면 볼트가 최종 안전 보충한다.
  if (pathname === '/api/candidates' && req.method === 'POST') {
    const body = await parseJsonBody(req);
    const wantNews = body.includeNews !== false;
    const TOTAL_CANDIDATE_COUNT = 10;
    const NEWS_TARGET_COUNT = wantNews ? 5 : 0;
    const FLEX_TARGET_COUNT = TOTAL_CANDIDATE_COUNT - NEWS_TARGET_COUNT;

    const candidates = [];
    const vaultPool = []; // 스토리 생성 실패·뉴스 부족 시 메울 예비 후보

    // (0) 검색어 확보 — AI 신기술, 창업/정부지원, 생활경제를 골고루 순환한다.
    const cache = readTrendsCache();
    const defaultKeywords = ['생성형 AI', '정부지원사업', '가성비 핫딜', 'AI 도구', '창업지원금', '생활비 절약', '청년창업', '특가 꿀팁'];
    const liveKeywordPool = Array.isArray(cache?.liveKeywords)
      ? cache.liveKeywords.filter(item => item?.keyword)
      : [];
    const analyzedKeywordPool = Array.isArray(cache?.opportunities)
      ? cache.opportunities.map(item => ({
          keyword: item.keyword,
          source: 'analysis',
          rank: 0,
          gap: buildIdeas([item])[0]?.gap || item.grade || '분석'
        }))
      : [];
    const keywordPool = liveKeywordPool.length
      ? liveKeywordPool
      : analyzedKeywordPool.length
        ? analyzedKeywordPool
        : defaultKeywords.map((keyword, index) => ({ keyword, source: 'default', rank: index + 1 }));

    const poolSize = keywordPool.length;
    const keywordCursor = poolSize ? Math.abs(Number(cache?.candidateKeywordCursor) || 0) % poolSize : 0;
    const selectionCount = Math.min(TOTAL_CANDIDATE_COUNT, poolSize);
    const selectedKeywords = Array.from({ length: selectionCount }, (_, index) =>
      keywordPool[(keywordCursor + index) % poolSize]
    );
    const nextKeywordCursor = poolSize ? (keywordCursor + selectionCount) % poolSize : 0;
    if (cache && poolSize) {
      saveTrendsCache({
        ...cache,
        candidateKeywordCursor: nextKeywordCursor,
        lastCandidateKeywords: selectedKeywords,
        lastCandidateKeywordAt: new Date().toISOString()
      });
    }

    // 한 번의 후보 생성에서도 특정 플랫폼에 쏠리지 않도록 선택된 10개를 5개씩 분리한다.
    const storyKeywordEntries = selectedKeywords.slice(0, FLEX_TARGET_COUNT);
    const newsKeywordEntries = selectedKeywords.slice(FLEX_TARGET_COUNT, FLEX_TARGET_COUNT + NEWS_TARGET_COUNT);
    while (storyKeywordEntries.length < FLEX_TARGET_COUNT) {
      const index = storyKeywordEntries.length % defaultKeywords.length;
      storyKeywordEntries.push({ keyword: defaultKeywords[index], source: 'default', rank: index + 1 });
    }
    const storyKeywords = storyKeywordEntries.map(entry => entry.keyword);

    // 뉴스는 AI 기술 소식, 창업/정부지원, 생활소비 경제 뉴스가 골고루 섞이도록 풀을 구성한다.
    // 뉴스에 적합하지 않은 SNS 해시태그(#스하리, #스친 등)나 1~2글자 약어는 필터링한다.
    const newsKeywordPool = [];
    const seenNewsKeywords = new Set();
    const rotatedKeywordPool = Array.from({ length: poolSize }, (_, index) =>
      keywordPool[(keywordCursor + index) % poolSize]
    );
    // AI 기술 + 창업/정부지원 + 생활소비 3대 축 폴백 키워드
    const coreCategoryKeywords = [
      { keyword: '생성형 AI', source: 'ai_tech', rank: 1, gap: 'AI 신기술' },
      { keyword: '정부지원사업', source: 'startup', rank: 1, gap: '창업지원' },
      { keyword: 'AI 도구', source: 'ai_tech', rank: 2, gap: '생산성' },
      { keyword: '창업지원금', source: 'startup', rank: 2, gap: '정책지원' },
      { keyword: '생활비 절약', source: 'life', rank: 1, gap: '가계경제' },
      { keyword: '청년창업', source: 'startup', rank: 3, gap: '청년정책' },
      { keyword: '챗GPT 활용', source: 'ai_tech', rank: 3, gap: 'AI 트렌드' },
      { keyword: '가성비 핫딜', source: 'life', rank: 2, gap: '실속소비' }
    ];
    for (const entry of [
      ...coreCategoryKeywords,
      ...newsKeywordEntries,
      ...rotatedKeywordPool
    ]) {
      const key = String(entry.keyword || '').trim();
      const fingerprint = key.toLowerCase().replace(/^#/, '');
      if (!key || seenNewsKeywords.has(fingerprint)) continue;
      // SNS 해시태그는 뉴스 기사 검색에 부적합하므로 제외
      if (key.startsWith('#') || fingerprint.length < 2) continue;
      seenNewsKeywords.add(fingerprint);
      newsKeywordPool.push({ ...entry, keyword: key });
    }

    // (1) 스토리 5건은 검색어별로 1건씩 독립 생성해 첫 검색어만 반복되는 현상을 차단한다.
    let storyTask = Promise.resolve({ posts: [], rejected: [], tokens: 0 });
    if (storyKeywords.length) {
      broadcastLog(`✍️ 24개 순환 검색어 중 스토리 ${FLEX_TARGET_COUNT}건 생성: ${storyKeywords.join(', ')}`, 'info');
      storyTask = Promise.allSettled(
        storyKeywords.slice(0, FLEX_TARGET_COUNT).map(keyword => writeStoryPosts([keyword], 1))
      ).then(results => results.reduce((acc, result) => {
        if (result.status === 'fulfilled') {
          acc.posts.push(...(result.value.posts || []));
          acc.rejected.push(...(result.value.rejected || []));
          acc.tokens += result.value.tokens || 0;
        }
        return acc;
      }, { posts: [], rejected: [], tokens: 0 })).catch(e => {
        broadcastLog(`⚠️ 스토리 생성 실패, 볼트로 대체합니다: ${e.message}`, 'warning');
        return { posts: [], rejected: [], tokens: 0 };
      });
    }

    let newsTask = Promise.resolve([]);
    if (NEWS_TARGET_COUNT && newsKeywordPool.length) {
      broadcastLog(`📰 뉴스 후보 ${NEWS_TARGET_COUNT}건 생성 시작: ${newsKeywordPool.slice(0, NEWS_TARGET_COUNT).map(k => k.keyword).join(', ')}`, 'info');
      newsTask = (async () => {
        const results = [];
        let usableCount = 0;
        let cursor = 0;
        let batchAttempts = 0;
        const newsStartTime = Date.now();
        // 타임아웃 방지: 최대 2개 배치(최대 8~10개 키워드) 또는 12초 초과 시 신속히 중단하고 볼트로 보충
        while (usableCount < NEWS_TARGET_COUNT && cursor < newsKeywordPool.length && batchAttempts < 2) {
          if (Date.now() - newsStartTime > 12000) {
            broadcastLog(`⏱️ 뉴스 생성 12초 도달: 빠른 응답을 위해 수집된 뉴스만 반영하고 나머지는 볼트로 보충합니다.`, 'info');
            break;
          }
          batchAttempts++;
          const need = NEWS_TARGET_COUNT - usableCount;
          const batch = newsKeywordPool.slice(cursor, cursor + need);
          cursor += batch.length;
          const settled = await Promise.allSettled(batch.map(async (entry) => {
            const articles = await searchNews(entry.keyword);
            if (!articles.length) return null;
            const draft = await draftFromNews(entry.keyword, articles);
            if (!draft.usable) return { skipped: true, keyword: entry.keyword, reason: draft.skipReason };
            return { entry, draft, picked: articles[draft.pickedIndex - 1] || articles[0] };
          }));
          results.push(...settled);
          usableCount += settled.filter(r => r.status === 'fulfilled' && r.value && !r.value.skipped).length;
        }
        return results;
      })().catch(e => {
        broadcastLog(`⚠️ 뉴스 후보 생성 실패: ${e.message}`, 'warning');
        return [];
      });
    }

    // 병렬 실행 완료 대기
    const [storyResult, newsResults] = await Promise.all([storyTask, newsTask]);

    // (1-1) 스토리 결과 취합
    if (storyResult.posts && storyResult.posts.length) {
      if (storyResult.rejected?.length) broadcastLog(`   ⚠️ 성과 주장이 섞여 ${storyResult.rejected.length}건 폐기`, 'warning');
      broadcastLog(`   ✅ 스토리 ${storyResult.posts.length}건 생성 완료 (${storyResult.tokens.toLocaleString()} 토큰)`, 'info');
      storyResult.posts.forEach((p, i) => candidates.push({
        id: `story_${Date.now()}_${i}`,
        source: 'story',
        sourceLabel: `스토리 · ${p.keyword}`,
        postBody: p.postText,
        firstComment: '',
        scene: p.scene,
        card: { badge: p.cardBadge, title: p.cardTitle, subtitle: p.cardSubtitle }
      }));
    }

    // (1-2) 볼트 예비 풀 준비
    try {
      const seenText = new Set();
      const ready = readVault().filter(item => {
        if ((item.status || 'READY') !== 'READY') return false;
        const fingerprint = (item.postText || '').replace(/\s+/g, ' ').trim();
        if (!fingerprint || seenText.has(fingerprint)) return false;
        seenText.add(fingerprint);
        return true;
      });

      const byCategory = new Map();
      for (const item of ready) {
        const key = item.category || '기타';
        if (!byCategory.has(key)) byCategory.set(key, []);
        byCategory.get(key).push(item);
      }
      for (const list of byCategory.values()) list.sort(() => Math.random() - 0.5);

      const buckets = [...byCategory.values()];
      let round = 0;
      while (vaultPool.length < 10 && buckets.some(b => b.length > round)) {
        for (const bucket of buckets) {
          if (vaultPool.length >= 10) break;
          const item = bucket[round];
          if (!item) continue;
          const tags = (item.tags || []).join(' ');
          vaultPool.push({
            id: `vault_${item.id}`,
            source: 'vault',
            sourceLabel: `볼트 · ${item.category || '기타'}`,
            vaultId: item.id,
            postBody: (item.postText || '') + (tags && !/#[^\s#]+/.test(item.postText || '') ? `\n\n${tags}` : ''),
            firstComment: ''
          });
        }
        round++;
      }
      // 나머지 5자리에서 스토리가 통과한 만큼 쓰고 부족분만 볼트로 자동 배분한다.
      const vaultNeed = Math.max(0, FLEX_TARGET_COUNT - candidates.length);
      candidates.push(...vaultPool.splice(0, vaultNeed));
    } catch (e) {
      broadcastLog(`⚠️ 볼트 후보 준비 실패: ${e.message}`, 'warning');
    }

    // (1-3) 뉴스 결과 취합
    let newsAdded = 0;
    if (Array.isArray(newsResults)) {
      for (const r of newsResults) {
        if (newsAdded >= NEWS_TARGET_COUNT) break;
        if (r.status === 'rejected') continue;
        const value = r.value;
        if (!value) continue;
        if (value.skipped) {
          broadcastLog(`⏭️ "${value.keyword}" 건너뜀: ${value.reason}`, 'info');
          continue;
        }
        const articleLink = value.picked.link || '';
        // 스레드 알고리즘의 아웃링크 페널티(도달수 억제)를 방지하기 위해 본문 내 URL 직접 삽입을 배제하고 자체완결형 텍스트로 유지
        let newsPostBody = value.draft.postBody || '';

        const keywordContext = value.entry.gap
          || `${value.entry.source || 'market'}${value.entry.rank ? ` ${value.entry.rank}위` : ''}`;
        candidates.push({
          id: `news_${value.entry.keyword}_${Date.now()}_${candidates.length}`,
          source: 'news',
          sourceLabel: `뉴스 · ${value.entry.keyword} (${keywordContext})`,
          postBody: newsPostBody,
          firstComment: '',
          card: {
            badge: value.draft.cardBadge,
            title: value.draft.cardTitle,
            subtitle: value.draft.cardSubtitle
          },
          article: { title: value.picked.title, link: articleLink }
        });
        newsAdded++;
      }
    }
    if (NEWS_TARGET_COUNT && newsAdded < NEWS_TARGET_COUNT) {
      broadcastLog(`⚠️ 적합한 뉴스는 ${newsAdded}/${NEWS_TARGET_COUNT}건입니다. 부족분은 볼트로 안전 보충합니다.`, 'warning');
    }

    // 뉴스 외부 API가 부족해도 후보 목록이 비지 않도록 남은 자리를 볼트로 채운다.
    while (candidates.length < TOTAL_CANDIDATE_COUNT && vaultPool.length) candidates.push(vaultPool.shift());

    return sendJson(res, 200, {
      success: true,
      trendSource: cache ? {
        updatedAt: cache.updatedAt,
        poolSize,
        cursorStart: keywordCursor,
        cursorNext: nextKeywordCursor,
        keywords: selectedKeywords
      } : null,
      allocation: {
        total: candidates.length,
        newsTarget: NEWS_TARGET_COUNT,
        news: candidates.filter(item => item.source === 'news').length,
        story: candidates.filter(item => item.source === 'story').length,
        vault: candidates.filter(item => item.source === 'vault').length
      },
      candidates
    });
  }

  // 17-3. 본문 맞춤 AI 카드 이미지 / 비디오 생성 (POST /api/generate-ai-media)
  if (pathname === '/api/generate-ai-media' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const postBody = String(body.postBody || '').trim();
      const type = body.type === 'video' ? 'video' : 'image';
      const validStyles = ['photo', 'anime', 'webtoon', 'editorial', '3d_render', 'retro_film', 'card'];
      const style = validStyles.includes(body.style) ? body.style : 'anime';
      const character = body.character === 'yuna' ? 'yuna' : null;
      const videoMode = body.videoMode === 'veo' ? 'veo' : 'motion';
      const sceneSpec = sanitizeSceneSpec(body.sceneSpec);

      if (!postBody) {
        return sendJson(res, 400, { error: '본문 내용이 비어있습니다. 본문을 먼저 입력하거나 후보를 선택해주세요.' });
      }

      const STYLE_LABELS = {
        photo: '실사 사진',
        anime: '일본 애니',
        webtoon: '한국 웹툰',
        editorial: '킨포크 에디토리얼',
        '3d_render': '애플/픽사 3D',
        retro_film: '90s 레트로 필름',
        card: '글씨 카드'
      };
      const styleName = STYLE_LABELS[style] || style;
      const styleLabel = type === 'video' ? '모션 숏폼 비디오' : (style === 'card' ? '글씨 카드 이미지' : (character === 'yuna' ? '유나 ' : '') + `${styleName} 장면`);
      broadcastLog(`🎨 본문 맞춤 AI ${styleLabel} 생성 시작...`, 'system');

      const result = type === 'video'
        ? await generateAiVideo(postBody, style, character, videoMode, sceneSpec)
        : await generateAiImage(postBody, style, character, sceneSpec);

      if (result.spec?.sceneDesc) {
        broadcastLog(`🎬 [씬 연출] ${result.spec.sceneDesc.slice(0, 70)}...`, 'info');
      }

      broadcastLog(`✨ AI ${type === 'video' ? '비디오' : '이미지'} 생성 완료: ${result.fileName} (${Math.round(result.fileSize / 1024)}KB) - "${result.title || result.spec?.title || ''}"`, 'success');

      return sendJson(res, 200, {
        success: true,
        media: {
          fileName: result.fileName,
          size: result.fileSize,
          type: result.type,
          title: result.title || result.spec?.title || '',
          url: `/uploads/${result.fileName}`
        }
      });
    } catch (err) {
      broadcastLog(`❌ AI 미디어 생성 실패: ${err.message}`, 'error');
      return sendJson(res, 500, { error: `AI 미디어 생성 실패: ${err.message}` });
    }
  }

  // 17-4. PromptDaily 기반 AI 이미지 프롬프트 실시간 합성 (POST /api/generate-image-prompt)
  if (pathname === '/api/generate-image-prompt' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const postBody = String(body.postBody || '').trim();
      const sceneSpec = sanitizeSceneSpec(body.sceneSpec);

      if (!postBody) {
        return sendJson(res, 400, { error: '본문 내용이 비어있습니다. 본문을 먼저 입력하거나 후보를 선택해주세요.' });
      }

      broadcastLog('💡 PromptDaily & 글로벌 레퍼런스 기반 최상위 프롬프트 합성 중...', 'info');
      const promptResult = await generateEliteImagePrompt(postBody, sceneSpec);

      return sendJson(res, 200, {
        success: true,
        data: promptResult
      });
    } catch (err) {
      return sendJson(res, 500, { error: `프롬프트 생성 실패: ${err.message}` });
    }
  }

  // 17-5. 첫 댓글 맞춤 관련 링크 자동 추출 및 조립 (POST /api/generate-related-link)
  if (pathname === '/api/generate-related-link' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const postBody = String(body.postBody || '').trim();
      const directSourceLink = String(body.sourceLink || '').trim();
      const directArticleTitle = String(body.articleTitle || '').trim();

      if (!postBody) {
        return sendJson(res, 400, { error: '본문 내용이 필요합니다.' });
      }

      let topLink = '';
      let topTitle = '';
      let searchKeyword = '';

      // [1순위] 클라이언트에서 후보의 원본 뉴스 링크를 직접 넘겨준 경우 (100% 원본 일치 보장)
      if (directSourceLink && /^https?:\/\//i.test(directSourceLink)) {
        topLink = directSourceLink;
        topTitle = directArticleTitle || '관련 보도 원문';
        searchKeyword = directArticleTitle ? directArticleTitle.slice(0, 15) : '선택 기사';
        broadcastLog(`🎯 선택된 후보의 원문 기사 링크 즉시 연동: ${topTitle}`, 'success');
      } else {
        broadcastLog('🔗 본문 맞춤 관련 기사 탐색 중...', 'info');

        // [2순위] 본문 내용과 가장 잘 어울리는 실제 뉴스 기사 정밀 매칭
        const tags = (postBody.match(/#[^\s#]+/g) || []).map(t => t.replace('#', ''));
        const fallbackKeyword = tags[0] || '';

        try {
          const matchedArticle = await findBestMatchingArticle(postBody, fallbackKeyword);
          if (matchedArticle) {
            topLink = matchedArticle.link;
            topTitle = matchedArticle.title.replace(/<\/?b>/g, '');
            searchKeyword = topTitle.slice(0, 15);
            broadcastLog(`📰 본문 일치 기사 발굴: ${topTitle}`, 'success');
          }
        } catch (matchErr) {
          console.warn('정밀 기사 매칭 실패:', matchErr.message);
        }

        // [3순위] 뉴스가 없거나 매칭 실패 시 토스/제휴 맞춤 링크 템플릿 제공
        if (!topLink) {
          searchKeyword = fallbackKeyword || '가성비';
          topLink = THREADS_PROFILE_URL;
          topTitle = `${searchKeyword} 실시간 추천 좌표`;
        }
      }

      // 본문 링크 삽입 / 기존 링크 교체 (기존에 🔗 관련 링크가 이미 들어가 있다면 덮어쓰기)
      let postBodyWithLink = postBody;
      const existingLinkRegex = /\n*🔗\s*(?:관련 링크|바로가기):\s*https?:\/\/[^\s\n]+/i;

      if (topLink) {
        if (existingLinkRegex.test(postBody)) {
          postBodyWithLink = postBody.replace(existingLinkRegex, `\n\n🔗 관련 링크: ${topLink}`);
        } else {
          const tagMatch = postBody.match(/(#[^\s#]+)/);
          if (tagMatch) {
            const tagIdx = postBody.indexOf(tagMatch[0]);
            postBodyWithLink = postBody.slice(0, tagIdx).trim() + `\n\n🔗 관련 링크: ${topLink}\n\n` + postBody.slice(tagIdx).trim();
          } else {
            postBodyWithLink = postBody.trim() + `\n\n🔗 관련 링크: ${topLink}`;
          }
        }
      }

      broadcastLog(`✨ 관련 링크 생성 완료 (${topTitle})`, 'success');

      return sendJson(res, 200, {
        success: true,
        keyword: searchKeyword,
        articleTitle: topTitle,
        linkUrl: topLink,
        postBodyWithLink,
        firstComment: ''
      });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  // 17-6. 단건 발행 공통 실행 헬퍼 함수
  /**
   * 발행된 내 게시물에 출처 링크를 첫 답글로 단다.
   *
   * 본문에 URL을 넣으면 스레드 알고리즘이 아웃링크 페널티로 도달을 억제한다(25df592에서
   * 본문 삽입을 걷어낸 이유). 반면 답글의 링크는 본문 도달에 영향을 주지 않는다.
   * 공식 API의 ownPostsOnly 가드가 걸려 있어 내 루트 게시물이 아니면 발행되지 않는다.
   */
  async function attachSourceLinkReply({ postId, sourceLink, label }) {
    if (!postId || !sourceLink) return;
    try {
      // 본문 read-back 검증 직후라 컨테이너가 아직 안정화되지 않을 수 있다. 잠깐 둔다.
      await new Promise(resolve => setTimeout(resolve, 3000));
      const reply = await publishSourceLinkReply({
        postId,
        link: sourceLink,
        log: (msg) => broadcastLog(msg, 'info')
      });
      broadcastLog(`🔗 "${label}..." 출처 링크를 첫 답글로 등록했습니다. (${reply?.postId || 'ok'})`, 'success');
    } catch (err) {
      // 링크 답글 실패가 본문 발행 성공을 되돌리지는 않는다. 기록만 남기고 넘어간다.
      broadcastLog(`⚠️ 출처 링크 답글 실패 (본문은 정상 발행됨): ${err.message}`, 'warning');
    }
  }

  async function executeSinglePostPublish({ postBody, vaultId = null, mediaFiles = [], headless = false, sourceLink = '' }) {
    const label = postBody.replace(/\s+/g, ' ').slice(0, 20);
    const mediaPaths = (Array.isArray(mediaFiles) ? mediaFiles : [])
      .map(name => path.join(UPLOAD_DIR, path.basename(String(name))))
      .filter(p => fs.existsSync(p));

    const claim = claimPublish({ postBody, mediaFiles });
    if (!claim.allowed) {
      const previousStatus = claim.previous?.status || 'unknown';
      broadcastLog(`⛔ 동일 내용 발행 차단: 이전 상태가 ${previousStatus}입니다. 자동 재게시하지 않습니다.`, 'warning');
      return { success: false, status: 'duplicate_blocked', retryAllowed: false, error: 'DUPLICATE_PUBLISH_BLOCKED' };
    }

    broadcastLog(`🚀 게시물 발행 시작: "${label}..."`, 'system');

    let result = null;
    const hasMedia = mediaPaths.length > 0;
    let blobMediaUrl = null;

    // 1. 미디어가 있는 경우: Azure Blob Storage로 업로드하여 공개 URL 확보
    if (hasMedia && process.env.THREADS_ACCESS_TOKEN) {
      try {
        const firstMediaPath = mediaPaths[0];
        const fileName = path.basename(firstMediaPath);
        const ext = path.extname(firstMediaPath).toLowerCase();
        const isVideo = ext === '.mp4' || ext === '.mov' || ext === '.webm';
        const contentType = isVideo ? 'video/mp4' : (ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png');

        broadcastLog(`☁️ [Azure Blob] 미디어 클라우드 동기화 시작: ${fileName}...`, 'system');
        blobMediaUrl = await uploadMediaToBlob(firstMediaPath, fileName, contentType);
        broadcastLog(`✅ [Azure Blob] CDN 공개 URL 획득 완료: ${blobMediaUrl}`, 'info');

        // Meta 공식 API로 초고속 미디어 발행 시도
        result = await publishMediaPost({
          text: postBody,
          mediaUrl: blobMediaUrl,
          mediaType: isVideo ? 'VIDEO' : 'IMAGE',
          log: (msg) => broadcastLog(msg, 'info')
        });
      } catch (mediaErr) {
        const uncertain = String(mediaErr.apiPath || '').endsWith('/threads_publish');
        const status = uncertain ? 'verification_pending' : 'held_api';
        finishPublish({ key: claim.key, attemptId: claim.attemptId, status, reason: mediaErr.message });
        await savePublishedPost({
          title: label,
          body: postBody,
          mediaUrls: blobMediaUrl ? [blobMediaUrl] : [],
          status,
          errorMsg: mediaErr.message
        }).catch(() => {});
        broadcastLog(`⏸️ [공식 API 미디어 발행 보류] 브라우저로 자동 재게시하지 않습니다: ${mediaErr.message}`, 'warning');
        return { success: false, status, retryAllowed: !uncertain, error: mediaErr.message };
      }
    }

    // 2. 미디어가 없는 경우: 공식 API 텍스트 발행
    if (!hasMedia && process.env.THREADS_ACCESS_TOKEN && !result) {
      try {
        result = await publishText({
          text: postBody,
          log: (msg) => broadcastLog(msg, 'info')
        });
      } catch (apiErr) {
        const uncertain = String(apiErr.apiPath || '').endsWith('/threads_publish');
        const status = uncertain ? 'verification_pending' : 'held_api';
        finishPublish({ key: claim.key, attemptId: claim.attemptId, status, reason: apiErr.message });
        await savePublishedPost({
          title: label,
          body: postBody,
          status,
          errorMsg: apiErr.message
        }).catch(() => {});
        broadcastLog(`⏸️ [공식 API 텍스트 발행 보류] 브라우저로 자동 재게시하지 않습니다: ${apiErr.message}`, 'warning');
        return { success: false, status, retryAllowed: !uncertain, error: apiErr.message };
      }
    }

    // 3. 공식 API 토큰이 애초에 없을 때만 기존 브라우저 게시를 사용한다.
    if (!result) {
      if (hasMedia) {
        broadcastLog('🖼️ 브라우저 자동화 세션으로 미디어 발행을 진행합니다...', 'info');
      }
      result = await postSingleCard(
        { title: label, postBody, firstComment: '', tag: '직접 발행', mediaPaths },
        { headless, log: (msg) => broadcastLog(msg, 'info') }
      );
    }

    if (result?.success && result.via === 'threads_api' && result.verified === false) {
      if (vaultId) markVaultAsPosted(vaultId);
      finishPublish({
        key: claim.key,
        attemptId: claim.attemptId,
        status: 'verification_pending',
        postId: result.postId || null,
        reason: 'Threads API 게시 ID는 받았지만 본문·permalink read-back이 완료되지 않았습니다.'
      });
      await savePublishedPost({
        title: label,
        body: postBody,
        mediaUrls: blobMediaUrl ? [blobMediaUrl] : [],
        metaPostId: result.postId || null,
        status: 'verification_pending',
        errorMsg: 'read-back 검증 대기'
      }).catch(() => {});
      broadcastLog(`⏸️ "${label}..." 게시 ID는 생성됐지만 read-back 확인 전까지 재게시를 차단합니다.`, 'warning');
      return { success: false, status: 'verification_pending', retryAllowed: false, postId: result.postId || null };
    }

    if (result && result.success) {
      if (vaultId) markVaultAsPosted(vaultId);
      const isVerifiedApi = result.via === 'threads_api' && result.verified === true;
      finishPublish({
        key: claim.key,
        attemptId: claim.attemptId,
        status: isVerifiedApi ? 'published' : 'verification_pending',
        postId: result.postId || null,
        permalink: result.permalink || null,
        reason: isVerifiedApi ? null : '브라우저 게시 결과는 공식 API read-back이 필요합니다.'
      });
      // Azure PostgreSQL에 발행 이력 영구 보존
      await savePublishedPost({
        title: label,
        body: postBody,
        mediaUrls: blobMediaUrl ? [blobMediaUrl] : [],
        metaPostId: result.postId || null,
        status: isVerifiedApi ? 'success' : 'verification_pending'
      }).catch(() => {});
      if (!isVerifiedApi) {
        broadcastLog(`⏸️ "${label}..." 브라우저 게시 완료 신호를 받았지만 read-back 확인 전까지 재게시를 차단합니다.`, 'warning');
        return { success: false, status: 'verification_pending', retryAllowed: false, postId: result.postId || null };
      }
      broadcastLog(`🎉 "${label}..." 게시물 발행·read-back 검증 성공!`, 'success');
      // read-back으로 내 게시물임이 확인된 뒤에만 링크 답글을 단다.
      await attachSourceLinkReply({ postId: result.postId, sourceLink, label });
      return { success: true, status: 'published', postId: result.postId, permalink: result.permalink };
    } else {
      const errorMsg = result ? result.error : '발행 처리 실패';
      finishPublish({ key: claim.key, attemptId: claim.attemptId, status: 'verification_pending', reason: errorMsg });
      await savePublishedPost({
        title: label,
        body: postBody,
        mediaUrls: blobMediaUrl ? [blobMediaUrl] : [],
        metaPostId: null,
        status: 'verification_pending',
        errorMsg
      }).catch(() => {});
      broadcastLog(`⏸️ "${label}..." 결과가 불명확하여 자동 재게시를 차단합니다: ${errorMsg}`, 'warning');
      return { success: false, status: 'verification_pending', retryAllowed: false, error: errorMsg };
    }
  }

  // 18. 자유 게시물 즉시 발행 (POST /api/publish)
  if (pathname === '/api/publish' && req.method === 'POST') {
    if (isBotRunning) {
      return sendJson(res, 400, { error: '이미 다른 봇 작업이 실행 중입니다.' });
    }

    const body = await parseJsonBody(req);
    const postBody = String(body.postBody || '').trim();
    const vaultId = body.vaultId || null;
    const headless = body.headless !== undefined ? body.headless : false;
    const mediaFiles = Array.isArray(body.mediaFiles) ? body.mediaFiles : [];
    const sourceLink = String(body.sourceLink || '').trim();

    if (!postBody) {
      return sendJson(res, 400, { error: '본문 내용을 입력해 주세요.' });
    }
    if (postBody.length > 500) {
      return sendJson(res, 400, { error: '스레드 본문은 500자를 넘을 수 없습니다.' });
    }

    const quota = checkSafetyQuota('post');
    if (!quota.allowed) {
      return sendJson(res, 429, { error: `계정 보호 쉴드: ${quota.reason}` });
    }

    const label = postBody.replace(/\s+/g, ' ').slice(0, 20);
    isBotRunning = true;
    currentTaskName = `게시물 발행 [${label}...]`;

    (async () => {
      try {
        await executeSinglePostPublish({
          postBody,
          vaultId,
          mediaFiles,
          headless,
          sourceLink
        });
      } catch (err) {
        broadcastLog(`❌ 예외 오류: ${err.message}`, 'error');
      } finally {
        isBotRunning = false;
        currentTaskName = null;
      }
    })();

    return sendJson(res, 200, { success: true, message: '발행 작업이 시작되었습니다.' });
  }

  // 18-0. 선택한 후보 다건 일괄/순차 발행 (POST /api/publish-batch)
  if (pathname === '/api/publish-batch' && req.method === 'POST') {
    if (isBotRunning) {
      return sendJson(res, 400, { error: '이미 다른 봇 작업이 실행 중입니다.' });
    }

    const body = await parseJsonBody(req);
    const posts = Array.isArray(body.posts) ? body.posts : [];
    const headless = body.headless !== undefined ? body.headless : true;

    if (!posts.length) {
      return sendJson(res, 400, { error: '발행할 후보를 1개 이상 선택해 주세요.' });
    }

    isBotRunning = true;
    currentTaskName = `다건 순차 발행 (${posts.length}건)`;

    (async () => {
      try {
        broadcastLog(`🚀 [다건 순차 발행] 총 ${posts.length}건의 후보 발행을 순차적으로 시작합니다.`, 'system');
        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < posts.length; i++) {
          const item = posts[i];
          const postBody = String(item.postBody || '').trim();
          if (!postBody) continue;

          const quota = checkSafetyQuota('post');
          if (!quota.allowed) {
            broadcastLog(`⛔ [계정 보호 쉴드] 일일 한도에 도달하여 중단합니다 (${quota.reason})`, 'warning');
            break;
          }

          broadcastLog(`📌 [순차 진행 ${i + 1}/${posts.length}] ${item.sourceLabel || `#${i + 1} 후보`} 발행 처리 중...`, 'info');

          // 4:5 카드뉴스 생성 정보가 있고 첨부 파일이 없으면 자동 카드뉴스 렌더링 시도
          let mediaFiles = Array.isArray(item.mediaFiles) ? item.mediaFiles : [];
          if (!mediaFiles.length && item.card && item.autoCard !== false) {
            try {
              const cardRes = await generateAiImage(postBody, 'card', null);
              if (cardRes && cardRes.fileName) {
                mediaFiles = [cardRes.fileName];
              }
            } catch (cardErr) {
              console.warn('다건 발행 카드 생성 스킵:', cardErr.message);
            }
          }

          const resPub = await executeSinglePostPublish({
            postBody,
            vaultId: item.vaultId || null,
            mediaFiles,
            headless,
            sourceLink: String(item.sourceLink || '').trim()
          });

          if (resPub && resPub.success) {
            successCount++;
          } else {
            failCount++;
          }

          // 다음 글 발행 전 안전 인간형 쿨다운 (마지막 글 제외 4~7초 가변 딜레이)
          if (i < posts.length - 1) {
            const delaySec = Math.floor(Math.random() * 4) + 4;
            broadcastLog(`⏳ [안전 쿨다운] 다음 글 발행 전 ${delaySec}초 대기 중...`, 'info');
            await new Promise(r => setTimeout(r, delaySec * 1000));
          }
        }

        broadcastLog(`🎉 [다건 순차 발행 완료] 총 ${posts.length}건 중 성공: ${successCount}건, 실패: ${failCount}건`, 'success');
      } catch (err) {
        broadcastLog(`❌ 다건 순차 발행 예외: ${err.message}`, 'error');
      } finally {
        isBotRunning = false;
        currentTaskName = null;
      }
    })();

    return sendJson(res, 200, { success: true, count: posts.length, message: `${posts.length}건 순차 발행이 시작되었습니다.` });
  }

  // 18-2. 공식 API로 게시물 성과(조회·좋아요·댓글) 회수 (GET /api/insights)
  if (pathname === '/api/insights' && req.method === 'GET') {
    try {
      broadcastLog('📊 스레드 공식 API에서 게시물 성과를 회수합니다...', 'info');
      const data = await fetchPostInsights({ limit: 25 });
      broadcastLog(`📊 성과 회수 완료: ${data.rows.length}건`, 'success');
      return sendJson(res, 200, { success: true, ...data });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  // 18-3. PromptDaily 실시간 인기 프롬프트 샘플 피드 조회
  if (pathname === '/api/prompt-daily/samples' && req.method === 'GET') {
    try {
      const samples = await fetchPromptDailySamples(8);
      return sendJson(res, 200, { success: true, samples });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  // 19. 정적 파일은 public/, uploads/, 명시한 가이드 HTML만 제공한다.
  // 프로젝트 루트의 JSON·환경설정·로그·소스 파일은 절대 정적 응답으로 내보내지 않는다.
  const requestedPublicPath = path.resolve(publicDir, `.${pathname === '/' ? '/index.html' : pathname}`);
  const isInsidePublic = requestedPublicPath === publicDir || requestedPublicPath.startsWith(`${publicDir}${path.sep}`);
  let filePath = isInsidePublic ? requestedPublicPath : '';

  if (pathname.startsWith('/uploads/')) {
    filePath = path.join(UPLOAD_DIR, path.basename(pathname));
  } else if (pathname.startsWith('/guide_assets/')) {
    const assetName = path.basename(pathname);
    filePath = path.join(rootDir, 'guide_assets', assetName);
  } else {
    const rootFileName = pathname.replace(/^\//, '');
    if (SAFE_ROOT_HTML_FILES.has(rootFileName)) {
      filePath = path.join(rootDir, rootFileName);
    }
  }

  if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'text/plain';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
});

await initLoggerDb();
await initPostgres().catch(e => console.warn('Postgres init error:', e.message));
initBlobStorage();

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Threads Affiliate Automation Web Dashboard Started`);
  console.log(`🌐 대시보드 주소: http://localhost:${PORT}`);
  console.log(`======================================================\n`);
});

// 포트 충돌 등 리스닝 실패를 처리한다. 핸들러가 없으면 Node가 처리되지 않은 'error'로
// 스택을 토하며 즉시 죽는다(EADDRINUSE). 이미 띄운 서버를 해치지 않고 명확히 안내한다.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n⚠️  포트 ${PORT}이(가) 이미 사용 중입니다. 서버가 이미 실행 중이거나 다른 프로세스가 점유 중입니다.`);
    console.error(`   → 기존 서버를 그대로 사용하거나, 다른 포트로 실행하려면 .env의 PORT 값을 변경하세요.`);
    console.error(`   현재 대시보드: http://localhost:${PORT}\n`);
    process.exit(1);
  }
  console.error(`❌ 서버 리스닝 오류: ${err.message}`);
  process.exit(1);
});
