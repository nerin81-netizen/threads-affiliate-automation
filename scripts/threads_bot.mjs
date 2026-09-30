import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';
import { getAccessToken, getBestSellingProducts, getTodayDeals, createShareLink } from './toss_openapi.mjs';
import { 
  SAFETY_LIMITS, 
  getDailyStats, 
  recordAction, 
  checkSafetyQuota, 
  humanType, 
  humanScroll, 
  humanClick, 
  sleep, 
  randomBetween 
} from './safety_guard.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(rootDir, '.env') });

const PROFILE_DIR = path.resolve(rootDir, '.threads_chrome_profile');
const CONFIG_PATH = path.resolve(rootDir, 'config.json');

// 설정 파일 읽기 헬퍼
export function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch (e) {}
  return {
    follow: {
      targetCount: 15,
      keywords: ['#스팔', '#맞팔', '#선팔하면맞팔', '#소통환영'],
      minDelaySeconds: 8,
      maxDelaySeconds: 16,
      filter: 'recent'
    },
    post: {
      source: 'best',
      itemRank: 1,
      bodyTemplate: "자취생 & 프로절약러 주목... 이건 안 쟁여두면 손해라 공유해요 🫢\n\n지금 토스에서 [{title}]\n역대급 특가로 {price}원에 풀렸네요!\n\n평소 눈여겨보셨거나 쟁여두실 분들은 품절되기 전에 꼭 챙겨두세요 🔥\n\n🔗 구매 좌표: {link}\n\n* 토스 제휴 활동의 일환으로 일정 수수료를 지급받을 수 있습니다.",
      commentTemplate: "",
      linkPosition: 'body'
    },
    browser: {
      headless: (process.platform === 'linux' && !process.env.DISPLAY) ? true : false
    },
    safety: {
      strictMode: true,
      maxDailyFollows: 40,
      maxDailyPosts: 5,
      cooldownInterval: 5,
      cooldownSeconds: 35
    }
  };
}

let currentContext = null;
let stopRequested = false;

export function stopBot() {
  stopRequested = true;
  if (currentContext) {
    currentContext.close().catch(() => {});
  }
}

/**
 * 1. 브라우저 실행 (메타 안티봇 탐지 우회 & 시스템 크롬 브라우저 정품 엔진 사용)
 */
async function launchBrowser(headless = false, log = console.log) {
  if (!fs.existsSync(PROFILE_DIR)) {
    fs.mkdirSync(PROFILE_DIR, { recursive: true });
  }

  // 🌟 클라우드 리눅스 서버(X11 디스플레이 부재)에서는 무조건 headless: true 강제 적용 (Missing X server 크래시 방지)
  const isHeadless = (process.platform === 'linux' && !process.env.DISPLAY) ? true : !!headless;

  const baseOpts = {
    headless: isHeadless,
    viewport: { width: 1280, height: 860 },
    permissions: ['clipboard-read', 'clipboard-write'],
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-infobars',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-position=120,80',
      '--lang=ko-KR,ko'
    ]
  };

  try {
    // 1. 시스템 정품 Google Chrome 엔진 우선 실행
    currentContext = await chromium.launchPersistentContext(PROFILE_DIR, {
      ...baseOpts,
      channel: 'chrome'
    });
  } catch (err) {
    log(`ℹ️ Chrome 채널 실패, 기본 Chromium 시도 중... (${err.message})`);
    currentContext = await chromium.launchPersistentContext(PROFILE_DIR, baseOpts);
  }

  // webdriver 플래그 숨기기
  await currentContext.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
  });

  // 검증된 storage_state.json 세션 쿠키 자동 주입 (리눅스 클라우드 & 로컬 크로스 플랫폼 세션 보장)
  const statePath = path.join(rootDir, 'storage_state.json');
  if (fs.existsSync(statePath)) {
    try {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      if (state.cookies && state.cookies.length > 0) {
        await currentContext.addCookies(state.cookies);
      }
    } catch {}
  }

  return currentContext;
}

/**
 * 2. 스레드 로그인 상태 확인 (오판정 없는 엄격한 검증)
 */
export async function checkLogin(page) {
  try {
    const currentUrl = page.url();
    if (currentUrl.includes('/login') || currentUrl.includes('/accounts/login')) {
      return false;
    }

    // 1. 게스트/미로그인 UI 요소가 화면에 나타나면 즉시 미로그인 판정
    const isGuest = await page.locator('text=/Log in or sign up|Continue with Instagram|Instagram으로 계속하기|Sign up to chime in|Log in with username/').first().isVisible({ timeout: 2000 }).catch(() => false);
    if (isGuest) {
      return false;
    }

    // 2. 로그인된 사용자 전용 화면 요소 확인 (인라인 작성 바, 피드 탭 등)
    const hasActiveFeed = await page.locator('text=/새로운 소식이 있나요|What\'s new|Start a thread|For you|추천/').first().isVisible({ timeout: 4000 }).catch(() => false);
    if (hasActiveFeed) {
      return true;
    }

    const hasNav = await page.locator('div[aria-label="프로필"], div[aria-label="Profile"], div:has-text("프로필 편집"), button:has-text("게시")').first().isVisible({ timeout: 3000 }).catch(() => false);
    return hasNav;
  } catch (e) {
    return false;
  }
}

/**
 * 3. .env 정보로 스레드 자동 로그인 시도 (Instagram SSO 대응)
 */
export async function tryAutoLogin(page, log = console.log) {
  dotenv.config({ path: path.join(rootDir, '.env'), override: true });
  const id = process.env.THREADS_ID || 'your_threads_id';
  const pw = process.env.THREADS_PW || '!!haki0527';

  log(`🔑 스레드 계정(${id})으로 자동 로그인을 시도합니다...`);

  await page.goto('https://www.threads.net/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(randomBetween(2500, 3500));

  // 1. 이미 로그인된 상태인지 확인
  if (await checkLogin(page)) {
    log('🎉 이미 로그인 세션이 활성화되어 있습니다.');
    return true;
  }

  // 2. 'Instagram으로 계속하기' 버튼이 있는지 확인
  const contBtn = page.locator('div[role="button"]:has-text("Instagram으로 계속하기"), button:has-text("Instagram으로 계속하기"), div[role="button"]:has-text("' + id + '")').first();
  if (await contBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
    log('👆 [Instagram으로 계속하기] 클릭...');
    await contBtn.click();
    await sleep(4000);
  }

  // 3. 인스타그램 로그인 페이지일 경우 폼 입력
  const emailInput = page.locator('input[name="email"], input[name="username"]').first();
  const passInput = page.locator('input[name="pass"], input[name="password"]').first();

  if (await emailInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    log('📝 인스타그램 계정 정보 입력 중...');
    await humanType(page, emailInput, id, log);
    await sleep(randomBetween(400, 800));

    await humanType(page, passInput, pw, log);
    await sleep(randomBetween(400, 800));

    log('⌨️ Enter 키로 로그인 제출...');
    await passInput.press('Enter');
    await sleep(10000);

    // 팝업 확인 (정보 저장 등)
    const popups = await page.locator('button:has-text("저장"), button:has-text("나중에"), button:has-text("확인"), div[role="button"]:has-text("저장")').all();
    for (const pop of popups) {
      if (await pop.isVisible().catch(() => false)) {
        await pop.click();
        await sleep(3000);
      }
    }
  }

  // 4. 스레드 복귀 후 계속하기 승인 버튼 다시 확인
  const confirmBtn = page.locator('div[role="button"]:has-text("Instagram으로 계속하기"), button:has-text("Instagram으로 계속하기"), div[role="button"]:has-text("' + id + '")').first();
  if (await confirmBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    log(`✅ [계속하기 ${id}] 연동 승인 클릭...`);
    await confirmBtn.click();
    await sleep(5000);
  }

  const loggedIn = await checkLogin(page);
  if (loggedIn) {
    log('🎉 스레드 로그인 성공! 세션이 안전하게 저장되었습니다.');
    return true;
  }

  return false;
}

/**
 * 4. 로그인 세션 설정 모드
 */
export async function loginSession(options = {}) {
  const log = options.log || console.log;
  stopRequested = false;
  log('\n🌐 스레드 브라우저 창을 띄웁니다 (로그인 화면)...');
  
  const context = await launchBrowser(false, log);
  const page = context.pages()[0] || await context.newPage();

  try {
    await page.goto('https://www.threads.net/login', { waitUntil: 'domcontentloaded' });
    await sleep(3000);

    const autoSuccess = await tryAutoLogin(page, log);
    if (autoSuccess) {
      await sleep(2500);
      await context.close();
      log('✅ 로그인 세션 저장 완료');
      return true;
    }

    log('\n👉 화면에 뜬 브라우저 창에서 로그인해 주세요 (최대 5분 대기).');
    log('💡 로그인이 완료되면 자동으로 감지하여 세션을 저장합니다.\n');

    for (let i = 0; i < 60; i++) {
      if (stopRequested) {
        log('🛑 사용자에 의해 작업이 중단되었습니다.');
        break;
      }
      await sleep(5000);
      const loggedIn = await checkLogin(page);
      if (loggedIn) {
        log('🎉 스레드 로그인 감지 완료! 세션이 성공적으로 저장되었습니다.');
        await sleep(2000);
        await context.close();
        return true;
      }
    }

    await context.close();
    return false;
  } catch (err) {
    log(`❌ 세션 설정 중 에러: ${err.message}`);
    await context.close().catch(() => {});
    return false;
  }
}

/**
 * 5. 맞팔 늘리기 (정지 방지 쉴드 적용: 인간형 클릭, 가변 딜레이, 롱 쿨다운, 1일 한도 제한)
 */
export async function growFollowers(customOptions = {}) {
  const log = customOptions.log || console.log;
  stopRequested = false;

  // 1. 계정 안전 쿼터 사전 점검
  const safetyCheck = checkSafetyQuota('follow');
  if (!safetyCheck.allowed) {
    log(`🛡️ [계정 보호 쉴드 작동] ${safetyCheck.reason}`);
    return { success: false, followedCount: 0, reason: 'SAFETY_LIMIT_REACHED' };
  }

  const config = { ...loadConfig(), ...customOptions };
  const followConf = config.follow || {};
  const requestedCount = customOptions.targetCount || followConf.targetCount || 15;
  // 1회 최대 안전 실행 수 제한 (최대 20명 이하)
  const maxCount = Math.min(requestedCount, SAFETY_LIMITS.MAX_FOLLOWS_PER_SESSION);
  const keywords = customOptions.keywords || followConf.keywords || ['#스팔', '#맞팔'];
  const minDelay = Math.max(followConf.minDelaySeconds || SAFETY_LIMITS.MIN_FOLLOW_DELAY_SEC, 6) * 1000;
  const maxDelay = Math.max(followConf.maxDelaySeconds || SAFETY_LIMITS.MAX_FOLLOW_DELAY_SEC, 12) * 1000;
  const isHeadless = customOptions.headless !== undefined ? customOptions.headless : (config.browser?.headless ?? false);

  const stats = getDailyStats();
  log(`\n🛡️ [스레드 안전 맞팔 봇 가동] (금일 누적: ${stats.followCount}/${SAFETY_LIMITS.MAX_FOLLOWS_PER_DAY}명)`);
  log(`🎯 금회 목표: 최대 ${maxCount}명 안전 선팔 (지정 딜레이: ${(minDelay/1000).toFixed(0)}~${(maxDelay/1000).toFixed(0)}초)`);
  log(`📋 타깃 키워드: ${keywords.join(', ')}`);

  const context = await launchBrowser(isHeadless, log);
  const page = context.pages()[0] || await context.newPage();

  try {
    await page.goto('https://www.threads.net/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(randomBetween(2500, 4500));

    let loggedIn = await checkLogin(page);
    if (!loggedIn) {
      log('🔑 저장된 계정으로 자동 로그인을 시도합니다...');
      loggedIn = await tryAutoLogin(page, log);
    }

    if (!loggedIn) {
      log('⚠️ 로그인이 필요합니다! 상단의 [스레드 로그인] 버튼을 먼저 실행해 주세요.');
      await context.close();
      return { success: false, followedCount: 0, reason: 'NOT_LOGGED_IN' };
    }

    log(`\n🔍 스레드 탐색 시작: 좌측 [검색] 및 추천 피드 진입...`);
    const searchNav = page.locator('div[role="button"]:has-text("검색"), span:has-text("검색"), svg[aria-label="검색"]').first();
    if (await searchNav.isVisible({ timeout: 5000 }).catch(() => false)) {
      await humanClick(page, searchNav);
      await sleep(randomBetween(2500, 4000));
    }

    let followedCount = 0;
    let consecutiveCount = 0;
    let scrollAttempts = 0;

    while (followedCount < maxCount && scrollAttempts < 15) {
      if (stopRequested) {
        log('🛑 사용자에 의해 맞팔 작업이 중단되었습니다.');
        break;
      }

      // 오늘 총 안전 한도 재점검
      const currentStats = getDailyStats();
      if (currentStats.followCount >= SAFETY_LIMITS.MAX_FOLLOWS_PER_DAY) {
        log(`🛡️ 오늘 총 안전 한도(${SAFETY_LIMITS.MAX_FOLLOWS_PER_DAY}명)에 도달하여 작업을 안전하게 마무리합니다.`);
        break;
      }

      const followButtons = await page.locator('div[role="button"]:has-text("팔로우"), button:has-text("팔로우")').all();
      log(`🔎 현재 화면에서 발견된 팔로우 대상 버튼: ${followButtons.length}개`);

      for (const btn of followButtons) {
        if (followedCount >= maxCount || stopRequested) break;

        const isVisible = await btn.isVisible().catch(() => false);
        if (!isVisible) continue;

        const text = await btn.innerText().catch(() => '');
        if (text.trim() === '팔로우') {
          try {
            // 유저 닉네임 탐색 (부모 컨테이너 등에서)
            log(`👉 팔로우 버튼 감지 -> 사람처럼 마우스 커서 이동 및 클릭...`);
            await humanClick(page, btn);
            followedCount++;
            consecutiveCount++;
            recordAction('follow', `추천/검색 피드 유저`);

            log(`✅ [${followedCount}/${maxCount}] 유저 팔로우 성공! (금일 누적: ${getDailyStats().followCount}명)`);

            // 5명 연속 팔로우 시 스팸 탐지 회피용 롱 쿨다운
            if (consecutiveCount % SAFETY_LIMITS.COOLDOWN_EVERY_N === 0) {
              const coolSec = randomBetween(25, 35);
              log(`   ☕ [안전 쿨다운] 봇 탐지 회피를 위해 ${coolSec}초간 잠시 피드를 감상합니다...`);
              await humanScroll(page);
              await sleep(coolSec * 1000);
            } else {
              const delay = randomBetween(minDelay, maxDelay);
              log(`   ⏳ 안전 딜레이 대기 (${(delay / 1000).toFixed(1)}초)...`);
              await sleep(delay);
            }
          } catch (e) {
            log(`   ⚠️ 클릭 재시도 중 오류 건너뜀: ${e.message}`);
          }
        }
      }

      // 사람처럼 자연스러운 스크롤로 추가 유저 로드
      log('📜 더 많은 추천 유저를 불러오기 위해 자연스럽게 스크롤합니다...');
      await humanScroll(page);
      await sleep(randomBetween(2500, 4000));
      scrollAttempts++;
    }

    log(`\n🎉 안전 맞팔 작업 완료! 총 ${followedCount}명에게 선팔을 보냈습니다.`);
    await sleep(2500);
    await context.close();
    return { success: true, followedCount };
  } catch (err) {
    log(`❌ 맞팔 작업 에러: ${err.message}`);
    await context.close().catch(() => {});
    return { success: false, followedCount: 0, error: err.message };
  }
}

/**
 * 6. 특정 카드 즉시 포스팅 (정지 방지: 인간형 타이핑 + 1일 포스팅 쿼터)
 */
export async function postSingleCard(card, options = {}) {
  const log = options.log || console.log;
  const isHeadless = options.headless !== undefined ? options.headless : false;
  stopRequested = false;

  // 안전 쿼터 체크
  const safetyCheck = checkSafetyQuota('post');
  if (!safetyCheck.allowed) {
    log(`🛡️ [계정 보호 쉴드 작동] ${safetyCheck.reason}`);
    return { success: false, error: 'SAFETY_LIMIT_REACHED' };
  }

  log(`\n🔥 [카드 안전 포스팅 시작: "${card.title}"]`);
  log(`📋 발행 스타일: ${card.tag || card.style || '추천'}`);

  const postBody = card.postBody;
  const context = await launchBrowser(isHeadless, log);
  const page = context.pages()[0] || await context.newPage();

  try {
    log('🌐 스레드 접속 중...');
    await page.goto('https://www.threads.net/', { waitUntil: 'domcontentloaded' });
    await sleep(randomBetween(2500, 4500));

    let loggedIn = await checkLogin(page);
    if (!loggedIn) {
      log('🔑 저장된 계정으로 자동 로그인 시도 중...');
      loggedIn = await tryAutoLogin(page, log);
    }

    if (!loggedIn) {
      log('⚠️ 로그인이 필요합니다! 상단의 [스레드 로그인] 버튼을 먼저 실행해 주세요.');
      await context.close();
      return { success: false, error: 'NOT_LOGGED_IN' };
    }

    if (stopRequested) {
      log('🛑 사용자에 의해 포스팅이 중단되었습니다.');
      await context.close();
      return { success: false, error: 'STOPPED' };
    }

    log('📝 스레드 글쓰기 창 열기...');
    // 글쓰기 모달을 여는 경로가 스레드 UI 버전마다 다르고 클릭이 빗나가면 모달이 안 뜼다.
    // 여러 방법을 순차 시도하고, 매 시도 후 모달 등장을 확인한다.
    async function isComposeDialogUp() {
      const dlg = page.locator('div[role="dialog"]').last();
      if (!await dlg.isVisible({ timeout: 1500 }).catch(() => false)) return false;
      const txt = await dlg.innerText().catch(() => '');
      // 답글 창이 아닌 새 스레드 작성 모달인지까지 가벼이 확인
      if (/에게\s*답글|답글\s*남기기|Replying\s+to|Reply\s+to/i.test(txt)) return false;
      return /(새로운\s*스레드|New\s+thread)/i.test(txt) || !!(await dlg.locator('div[contenteditable="true"]').count().catch(() => 0));
    }

    const openStrategies = [
      // 1) 좌측/상단 "새로운 스레드" 버튼
      async () => {
        const b = page.locator('div[role="button"]:has-text("새로운 스레드"), span:has-text("새로운 스레드"), svg[aria-label="새로운 스레드"], svg[aria-label="New thread"]').first();
        if (await b.isVisible({ timeout: 3000 }).catch(() => false)) { await humanClick(page, b); return true; }
        return false;
      },
      // 2) 상단 인라인 입력 트리거 (프로밀/스크린 문구)
      async () => {
        const t = page.locator('div[role="button"]:has-text("새로운 소식이 있나요"), div:has-text("새로운 소식이 있나요?")').first();
        if (await t.isVisible({ timeout: 2000 }).catch(() => false)) { await humanClick(page, t); return true; }
        return false;
      },
      // 3) 글쓰기 전용 URL로 직접 진입 (UI 변경에 가장 강건)
      async () => {
        await page.goto('https://www.threads.net/intent/post', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
        await sleep(randomBetween(1500, 2500));
        return true;
      }
    ];

    let composerOpened = false;
    for (let attempt = 0; attempt < openStrategies.length && !composerOpened; attempt++) {
      if (stopRequested) break;
      try {
        await openStrategies[attempt]();
      } catch (e) {
        log(`   ℹ️ 글쓰기 창 열기 시도 ${attempt + 1} 예외: ${e.message}`);
      }
      await sleep(randomBetween(1200, 2000));
      if (await isComposeDialogUp()) { composerOpened = true; break; }
      if (attempt < openStrategies.length - 1) {
        log(`   ↻ 글쓰기 창이 열리지 않아 다음 방법으로 재시도합니다...`);
      }
    }

    // 피드의 인라인 답글 입력창을 절대 집지 않도록 글쓰기 모달 내부만 허용한다.
    const composeDialog = page.locator('div[role="dialog"]').last();
    if (!composerOpened && !await composeDialog.isVisible({ timeout: 6000 }).catch(() => false)) {
      throw new Error('TOP_LEVEL_COMPOSER_NOT_FOUND');
    }
    const dialogText = await composeDialog.innerText().catch(() => '');
    // 답글 창은 절대 금지 — 오발행 방지의 핵심 안전장치다.
    if (/에게\s*답글|답글\s*남기기|Replying\s+to|Reply\s+to/i.test(dialogText)) {
      throw new Error('REPLY_COMPOSER_DETECTED');
    }
    // "새로운 스레드" 문구가 없어도(예: /intent/post 직접 진입) 편집 가능한 contenteditable가
    // 있고 답글 창이 아니면 최상위 작성 창으로 간주한다. (UI 변경 대응)
    const looksLikeNewThread = /(새로운\s*스레드|New\s+thread)/i.test(dialogText);
    const hasEditableArea = !!(await composeDialog.locator('div[contenteditable="true"]').count().catch(() => 0));
    if (!looksLikeNewThread && !hasEditableArea) {
      throw new Error('TOP_LEVEL_COMPOSER_NOT_VERIFIED');
    }

    const editor = composeDialog.locator('div[contenteditable="true"]').first();
    if (!await editor.isVisible({ timeout: 6000 }).catch(() => false)) {
      throw new Error('글쓰기 에디터 창을 찾지 못했습니다.');
    }

    log('✍️ 사람이 직접 작성하듯 본문 타이핑 중 (어뷰징 감지 우회)...');
    await humanType(page, editor, postBody, log);
    await sleep(randomBetween(1500, 2500));

    // 미디어 첨부 (이미지/영상). 스레드 작성 모달의 숨은 file input에 직접 주입한다.
    const mediaPaths = (card.mediaPaths || []).filter(p => p && fs.existsSync(p));
    if (mediaPaths.length) {
      log(`🖼️ 미디어 ${mediaPaths.length}개 첨부 중...`);
      const fileInput = composeDialog.locator('input[type="file"]').first();
      // 첨부 버튼이 눌리기 전까지 input이 DOM에 없는 경우가 있어 먼저 트리거를 시도한다.
      if (!await fileInput.count().catch(() => 0)) {
        const attachBtn = composeDialog.locator('svg[aria-label="첨부 파일 추가"], svg[aria-label="Attach media"], div[role="button"][aria-label*="미디어"]').first();
        if (await attachBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await attachBtn.click().catch(() => {});
          await sleep(randomBetween(600, 1200));
        }
      }

      if (await fileInput.count().catch(() => 0)) {
        await fileInput.setInputFiles(mediaPaths);
        // 업로드 썸네일이 실제로 붙을 때까지 대기 (붙지 않으면 본문만 나가는 사고 방지).
        // isVisible()은 즉시 현재 상태만 반환하므로 반드시 waitFor로 폴링해야 한다.
        const thumb = composeDialog.locator('img[src^="blob:"], video').first();
        const attached = await thumb.waitFor({ state: 'visible', timeout: 30000 })
          .then(() => true).catch(() => false);
        if (!attached) {
          await context.close();
          return { success: false, error: 'MEDIA_ATTACH_FAILED' };
        }
        log(`✅ 미디어 첨부 완료 (${mediaPaths.length}개)`);
        await sleep(randomBetween(1200, 2200));
      } else {
        await context.close();
        return { success: false, error: 'MEDIA_INPUT_NOT_FOUND' };
      }
    }

    // 검증된 최상위 글쓰기 모달의 게시 버튼만 허용한다. 단축키 폴백은 오발행 위험 때문에 사용하지 않는다.
    log('🚀 검증된 새 글쓰기 모달의 [게시] 버튼을 클릭합니다...');
    const postBtn = composeDialog.locator('div[role="button"]:has-text("게시"), button:has-text("게시"), div[role="button"]:has-text("Post"), button:has-text("Post")').first();
    if (await postBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await humanClick(page, postBtn);
    } else {
      throw new Error('TOP_LEVEL_PUBLISH_BUTTON_NOT_FOUND');
    }

    // 모달 닫힘 대기
    await editor.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    log('✅ 최상위 게시물 1건 발행 완료. 자동 댓글·답글은 안전 정책상 실행하지 않습니다.');

    recordAction('post', `상품: ${card.title}`);
    await sleep(4000);
    await context.close();
    log(`\n✨ 카드 [${card.title}] 안전 포스팅 완료! (금일 누적: ${getDailyStats().postCount}건)`);
    return { success: true };
  } catch (err) {
    log(`❌ 포스팅 에러: ${err.message}`);
    await context.close().catch(() => {});
    return { success: false, error: err.message };
  }
}

/**
 * 7. 토스 핫딜 자동 포스팅
 */
export async function postHotDeal(customOptions = {}) {
  const config = { ...loadConfig(), ...customOptions };
  const postConf = config.post || {};
  const targetRank = customOptions.itemRank || postConf.itemRank || 1;
  const log = customOptions.log || console.log;

  log('\n🔥 [토스 핫딜 스레드 자동 포스팅 준비]');
  try {
    const token = await getAccessToken();
    const bestData = await getBestSellingProducts(token, Math.max(5, targetRank));
    const items = bestData.success?.items || [];
    if (items.length === 0) throw new Error('베스트 상품 없음');

    const item = items[targetRank - 1] || items[0];
    const linkRes = await createShareLink(token, item.tacaItemId);
    const shortUrl = linkRes.success?.shortUrl;

    const card = {
      title: item.displayName,
      postBody: (postConf.bodyTemplate || '')
        .replace(/{title}/g, item.displayName)
        .replace(/{price}/g, item.displayPrice?.toLocaleString() || '')
        .replace(/{link}/g, shortUrl),
      firstComment: '',
      tag: '🔥 베스트 1위'
    };

    return await postSingleCard(card, customOptions);
  } catch (err) {
    log(`❌ 오류: ${err.message}`);
    return { success: false, error: err.message };
  }
}
