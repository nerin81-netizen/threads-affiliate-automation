/**
 * 팔로잉 피드 아웃바운드 라포 답글 봇 (B안 / Playwright 경로).
 *
 * 공식 Threads API에는 "내가 팔로우한 사람들의 타임라인"을 읽는 엔드포인트가 없다.
 * 그래서 인바운드(rapport_reply_service.mjs, 공식 API)와 달리 로그인 세션 브라우저로
 * threads.net/following 을 직접 읽는다. 두 경로는 한도·기록·코드를 모두 분리해 둔다.
 * 아웃바운드가 밴을 유발해도 공식 API 기능은 살아남아야 하기 때문이다.
 *
 * 흐름은 2단계다. (1) 피드를 훑어 후보 글의 URL만 모으고 (2) 각 글 상세 페이지로 가서
 * 답글을 단다. 피드 안에서 인라인으로 답글을 달면 모달이 어느 글에 붙었는지 보증할 수
 * 없어 오발행 위험이 크다. 상세 페이지 경로는 test_post_comment_single.mjs 로 실발행이
 * 검증된 흐름이다.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { generateRapportComment } from './rapport_engine.mjs';
import {
  checkSafetyQuota,
  recordAction,
  SAFETY_LIMITS,
  sleep,
  randomBetween
} from './safety_guard.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const HISTORY_FILE = path.join(rootDir, 'comments_history.json');

// 답글을 달면 실례가 되거나 계정에 해가 되는 글. 하트봇의 목록보다 넓게 잡는다.
// 하트는 눌렀다 취소하면 그만이지만 답글은 텍스트가 남는다.
const SENSITIVE_PATTERN = /(부고|장례|무지개다리|삼가|조의|추모|사망|별세|자살|자해|극단적|우울증|수술|입원|투병|암\s*진단|이혼|파혼|사기|고소|고발|소송|정치|대통령|국회|탄핵|선거|전쟁|참사|교통사고|화재|지진|종교|혐오)/i;
const PROMOTION_PATTERN = /(구매\s*링크|공동\s*구매|공구\s*합니다|제휴|수수료|쿠팡\s*파트너스|오픈\s*채팅|오픈톡|텔레그램|무료\s*상담|DM\s*주세요|디엠\s*주세요|문의\s*주세요|입금|계좌)/i;

const now = () => Date.now();

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

// ponytail: 내 계정명은 .env 한 줄로만 읽는다. 팔로잉 피드에는 원래 내 글이 안 뜨므로
// 이 검사는 리포스트 등 예외 상황용 싸구려 보험이다. 없으면 그냥 건너뛴다.
function getMyUsername() {
  return String(process.env.THREADS_USERNAME || '').replace(/^@/, '').toLowerCase();
}

/** 최근 N일 안에 아웃바운드 답글을 단 계정 집합. 같은 사람에게 반복 접촉하면 괴롭힘 판정 대상이다. */
export function recentlyRepliedAuthors(history, days = SAFETY_LIMITS.OUTBOUND_REPEAT_BLOCK_DAYS) {
  const since = now() - days * 24 * 3600 * 1000;
  const set = new Set();
  for (const row of history) {
    if (row.direction !== 'outbound' || row.status !== 'SUCCESS') continue;
    if (!row.timestamp || new Date(row.timestamp).getTime() < since) continue;
    if (row.targetUser) set.add(String(row.targetUser).toLowerCase());
  }
  return set;
}

/**
 * 생성 문장이 최근 답글과 8자 이상 겹치는지 검사.
 * 겹치면 같은 템플릿이 연달아 나갔다는 뜻이고, 그게 봇 티가 가장 크게 나는 지점이다.
 */
export function isTooSimilar(text, recentTexts, window = 8) {
  const clean = String(text || '').replace(/\s+/g, '');
  if (clean.length < window) return false;
  for (const prev of recentTexts) {
    const prevClean = String(prev || '').replace(/\s+/g, '');
    for (let i = 0; i + window <= clean.length; i++) {
      if (prevClean.includes(clean.slice(i, i + window))) return true;
    }
  }
  return false;
}

/** 이 글에 답글을 달아도 되는지. 통과 못 하면 이유를 돌려준다. */
export function screenPost({ author, text }, { myName, blockedAuthors }) {
  const body = String(text || '').trim();
  if (!author) return '작성자 식별 실패';
  if (myName && author.toLowerCase() === myName) return '내 글';
  if (blockedAuthors.has(author.toLowerCase())) {
    return `최근 ${SAFETY_LIMITS.OUTBOUND_REPEAT_BLOCK_DAYS}일 내 답글 이력`;
  }
  if (body.replace(/\s+/g, '').length < SAFETY_LIMITS.MIN_OUTBOUND_POST_TEXT_LEN) {
    return '본문 너무 짧음(이미지 온리 추정)';
  }
  if (SENSITIVE_PATTERN.test(body)) return '민감/부정 키워드';
  if (PROMOTION_PATTERN.test(body)) return '홍보성 글';
  return null;
}

/** 피드 카드에서 작성자·본문·상세 URL을 뽑는다. 하나라도 없으면 후보에서 뺀다. */
async function extractCandidate(card) {
  const url = await card.evaluate(el => {
    const a = Array.from(el.querySelectorAll('a')).find(x => /\/post\//.test(x.href));
    return a ? a.href.split('?')[0] : '';
  }).catch(() => '');
  if (!url) return null;

  const match = url.match(/@([a-zA-Z0-9._]+)\/post\/([a-zA-Z0-9_-]+)/);
  if (!match) return null;

  const raw = await card.innerText().catch(() => '');
  // 첫 줄은 작성자명·시간 같은 메타라 본문에서 걷어낸다.
  const text = raw.split('\n').slice(1).join(' ').replace(/\s+/g, ' ').trim();
  return { author: match[1], postId: match[2], url, text };
}

/**
 * 팔로잉 피드를 훑어 답글 후보 글을 모은다. (발행하지 않음)
 */
async function collectCandidates(page, need, log) {
  const myName = getMyUsername();
  const blockedAuthors = recentlyRepliedAuthors(readHistory());
  const seen = new Set();
  const candidates = [];

  for (let scroll = 0; scroll < 30 && candidates.length < need; scroll++) {
    const cards = await page.locator('div[data-pressable-container="true"], article').all();
    log(`🔍 [피드 스캔] 화면 내 게시글 ${cards.length}개 (후보 확보: ${candidates.length}/${need})`);

    for (const card of cards) {
      if (candidates.length >= need) break;
      const cand = await extractCandidate(card);
      if (!cand || seen.has(cand.postId)) continue;
      seen.add(cand.postId);

      const reject = screenPost(cand, { myName, blockedAuthors });
      if (reject) {
        log(`   ⏭️ 제외 (@${cand.author}): ${reject}`);
        continue;
      }
      // 한 세션에서 같은 사람 글 두 개를 잡지 않는다.
      blockedAuthors.add(cand.author.toLowerCase());
      candidates.push(cand);
      log(`   ✅ 후보 추가 (@${cand.author}) "${cand.text.slice(0, 28)}..."`);
    }

    await page.mouse.wheel(0, 900);
    await sleep(randomBetween(2500, 3500));
  }

  return candidates;
}

/**
 * 글 상세 페이지에서 답글 1건 발행.
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
async function publishReplyOnPost(page, cand, comment, log) {
  await page.goto(cand.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(randomBetween(3000, 4500));

  const trigger = page.locator(
    'div[data-lexical-editor="true"], div[role="textbox"][contenteditable="true"], svg[aria-label="답글"], svg[aria-label="Reply"]'
  ).first();
  if (!await trigger.isVisible({ timeout: 5000 }).catch(() => false)) {
    return { ok: false, reason: '답글 입력창을 찾지 못함' };
  }
  await trigger.click({ force: true });
  await sleep(randomBetween(1200, 2000));

  // [오발행 방지 가드] 열린 모달이 정말 "답글" 창인지 확인한다. 최상위 글 작성창이
  // 열린 상태로 타이핑하면 남의 글 답글이 내 새 게시물로 나간다. 되돌릴 수 없는 사고다.
  const dialog = page.locator('div[role="dialog"]').last();
  const dialogText = await dialog.innerText({ timeout: 3000 }).catch(() => '');
  if (!/에게\s*답글|답글\s*남기기|답글\s*달기|Replying\s+to|Reply\s+to/i.test(dialogText)) {
    return { ok: false, reason: '답글 모달 확인 실패 (최상위 작성창 의심) → 발행 중단' };
  }

  const editor = dialog.locator(
    'div[data-lexical-editor="true"], div[role="textbox"][contenteditable="true"], div[contenteditable="true"]'
  ).last();
  await editor.click({ force: true });
  await sleep(randomBetween(400, 800));
  await editor.type(comment, { delay: randomBetween(40, 70) });
  await sleep(randomBetween(1200, 2000));

  // '게시물 옵션' 같은 버튼을 물지 않도록 정확히 '게시'만 매칭한다.
  const submitBtn = dialog.locator('div[role="button"]').filter({ hasText: /^(게시|Post)$/ }).last();
  if (await submitBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await submitBtn.click({ force: true });
  } else {
    log('   ⚠️ [게시] 버튼 미발견 → Ctrl+Enter 대체 시도');
    await page.keyboard.press('Control+Enter');
  }
  await sleep(4000);

  // 모달이 닫혔으면 발행된 것으로 본다. 열린 채면 실패로 처리해 히스토리를 오염시키지 않는다.
  const stillOpen = await dialog.isVisible({ timeout: 2000 }).catch(() => false);
  if (stillOpen) return { ok: false, reason: '발행 후에도 모달이 닫히지 않음' };
  return { ok: true };
}

/**
 * 팔로잉 피드 아웃바운드 라포 답글 실행.
 * @param {number} targetCount 목표 답글 수
 * @param {function} log 로깅 함수 (SSE 스트리밍 연동)
 * @param {{dryRun?: boolean}} opts dryRun=true 면 후보 선별·문장 생성까지만 하고 발행하지 않는다.
 */
export async function runFeedRapportBot(targetCount = 3, log = console.log, opts = {}) {
  const dryRun = opts.dryRun ?? process.env.DRY_RUN === 'true';

  const requested = targetCount;
  targetCount = Math.min(Math.max(1, targetCount), SAFETY_LIMITS.MAX_OUTBOUND_COMMENTS_PER_SESSION);
  if (requested > targetCount) {
    log(`🛡️ [세션 상한] 요청 ${requested}건 → 1회 실행 상한 ${targetCount}건으로 조정합니다. (하루 ${SAFETY_LIMITS.MAX_OUTBOUND_COMMENTS_PER_DAY}건까지 나눠서 진행하세요)`);
  }

  log(`🚀 [피드 라포 답글] 팔로잉 피드 아웃바운드 답글 ${targetCount}건${dryRun ? ' (DRY RUN · 발행 없음)' : ''} 작업을 시작합니다.`);
  if (!dryRun && targetCount > 1) {
    // 건당 45~120초 + N건마다 쿨다운. 대략적인 총 소요를 미리 알려 중간에 창을 닫지 않게 한다.
    const avgDelay = (SAFETY_LIMITS.MIN_OUTBOUND_COMMENT_DELAY_SEC + SAFETY_LIMITS.MAX_OUTBOUND_COMMENT_DELAY_SEC) / 2;
    const cooldowns = Math.floor((targetCount - 1) / SAFETY_LIMITS.OUTBOUND_COOLDOWN_EVERY_N);
    const etaMin = Math.round(((targetCount - 1) * avgDelay + cooldowns * SAFETY_LIMITS.OUTBOUND_COOLDOWN_TIME_SEC) / 60);
    log(`⏱️ 예상 소요 약 ${etaMin}분입니다. (건당 ${SAFETY_LIMITS.MIN_OUTBOUND_COMMENT_DELAY_SEC}~${SAFETY_LIMITS.MAX_OUTBOUND_COMMENT_DELAY_SEC}초 + ${SAFETY_LIMITS.OUTBOUND_COOLDOWN_EVERY_N}건마다 ${SAFETY_LIMITS.OUTBOUND_COOLDOWN_TIME_SEC / 60}분 쿨다운) 진행 중 창을 닫지 마세요.`);
  }

  const quota = checkSafetyQuota('outbound_comment');
  if (!quota.allowed) {
    log(`🛡️ [안전 중단] ${quota.reason}`);
    return { success: false, reason: quota.reason, count: 0 };
  }

  let successCount = 0;
  let context = null;
  let browser = null;

  try {
    const isHeadless = process.env.HEADLESS === 'true' || (!process.env.DISPLAY && process.platform !== 'win32');
    log(`🌐 브라우저 세션을 실행합니다. (Headless: ${isHeadless})`);

    browser = await chromium.launch({
      headless: isHeadless,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });
    context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul'
    });

    const statePath = path.join(rootDir, 'storage_state.json');
    if (fs.existsSync(statePath)) {
      try {
        const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        if (state.cookies?.length) await context.addCookies(state.cookies);
      } catch {}
    }

    const page = await context.newPage();

    log('📲 [피드 접속] 팔로잉 피드(https://www.threads.net/following) 로딩 중...');
    await page.goto('https://www.threads.net/following', { waitUntil: 'domcontentloaded', timeout: 25000 });
    await sleep(3500);

    // 1단계: 후보 수집. 필터 탈락을 감안해 목표의 2배까지 모아둔다.
    const candidates = await collectCandidates(page, targetCount * 2, log);
    if (candidates.length === 0) {
      log('ℹ️ 답글을 달 만한 후보 글을 찾지 못했습니다. (필터 전량 탈락 또는 로그인 세션 만료)');
      return { success: true, count: 0, reason: '후보 없음' };
    }
    log(`📋 [후보 확정] 총 ${candidates.length}건 확보. 발행 단계로 넘어갑니다.`);

    // 2단계: 발행
    const history = readHistory();
    const recentTexts = history.filter(r => r.direction === 'outbound').slice(0, 20).map(r => r.generatedComment);

    for (const cand of candidates) {
      if (successCount >= targetCount) break;

      const runningQuota = checkSafetyQuota('outbound_comment');
      if (!runningQuota.allowed) {
        log(`🛡️ [일일 한도 도달] ${runningQuota.reason}`);
        break;
      }

      // 문장 생성 — 어색하면 1회만 재생성하고 미련 없이 넘어간다.
      let comment = generateRapportComment(cand.author, cand.text, recentTexts);
      if (isTooSimilar(comment, recentTexts)) {
        comment = generateRapportComment(cand.author, cand.text, recentTexts);
        if (isTooSimilar(comment, recentTexts)) {
          log(`   ⏭️ 제외 (@${cand.author}): 최근 답글과 문장 중복`);
          continue;
        }
      }

      log(`💬 [@${cand.author}] "${cand.text.slice(0, 30)}..."`);
      log(`   → 생성 답글: "${comment}"`);

      if (dryRun) {
        log('   🧪 [DRY RUN] 발행하지 않고 건너뜁니다.');
        successCount++;
        recentTexts.unshift(comment);
        continue;
      }

      let result;
      try {
        result = await publishReplyOnPost(page, cand, comment, log);
      } catch (err) {
        result = { ok: false, reason: err.message };
      }

      if (!result.ok) {
        log(`   ❌ 발행 실패 (@${cand.author}): ${result.reason}`);
        history.unshift({
          id: `out_${Date.now()}`,
          timestamp: new Date().toISOString(),
          direction: 'outbound',
          targetUser: cand.author,
          targetPostUrl: cand.url,
          targetPostSnippet: cand.text.slice(0, 120),
          generatedComment: comment,
          status: 'FAILED',
          reason: result.reason
        });
        writeHistory(history);
        continue;
      }

      successCount++;
      recentTexts.unshift(comment);
      recordAction('outbound_comment', `피드 답글 @${cand.author}`);
      history.unshift({
        id: `out_${Date.now()}`,
        timestamp: new Date().toISOString(),
        direction: 'outbound',
        targetUser: cand.author,
        targetPostUrl: cand.url,
        targetPostSnippet: cand.text.slice(0, 120),
        generatedComment: comment,
        status: 'SUCCESS'
      });
      writeHistory(history);
      log(`   ✅ [발행 완료 #${successCount}] @${cand.author}`);

      if (successCount < targetCount) {
        const waitSec = randomBetween(SAFETY_LIMITS.MIN_OUTBOUND_COMMENT_DELAY_SEC, SAFETY_LIMITS.MAX_OUTBOUND_COMMENT_DELAY_SEC);
        log(`   ⏳ 인간형 딜레이 대기 중 (${waitSec}초)...`);
        await sleep(waitSec * 1000);

        if (successCount % SAFETY_LIMITS.OUTBOUND_COOLDOWN_EVERY_N === 0) {
          log(`   ☕ [계정 보호 쿨다운] ${SAFETY_LIMITS.OUTBOUND_COOLDOWN_TIME_SEC}초간 휴식합니다.`);
          await sleep(SAFETY_LIMITS.OUTBOUND_COOLDOWN_TIME_SEC * 1000);
        }
      }
    }

    log(`\n🎉 [피드 라포 답글 완료] 총 ${successCount}건${dryRun ? ' (DRY RUN)' : ''} 처리했습니다.`);
  } catch (error) {
    log(`❌ 피드 라포 답글 봇 실행 중 오류: ${error.message}`);
  } finally {
    if (context) {
      await sleep(1500);
      await context.close().catch(() => {});
    }
    if (browser) await browser.close().catch(() => {});
  }

  return { success: true, count: successCount, dryRun };
}

// 직접 터미널 실행 지원: node scripts/feed_rapport_bot.mjs 3
if (process.argv[1] && process.argv[1].endsWith('feed_rapport_bot.mjs')) {
  const count = parseInt(process.argv[2], 10) || 1;
  runFeedRapportBot(count).then(res => {
    console.log('완료 결과:', res);
    process.exit(0);
  });
}
