import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { checkSafetyQuota, recordAction, SAFETY_LIMITS } from './safety_guard.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const PROFILE_DIR = path.join(rootDir, '.threads_chrome_profile');

// 부정적/슬픈 글 키워드 (하트 누르면 실례가 되는 글 필터링)
const DANGER_KEYWORDS = [
  '부고', '장례', '무지개다리', '삼가', '이별', '헤어', '우울증', '자살',
  '병원', '수술', '사기', '고소', '정치', '대통령', '국회', '탄핵', '사망', '교통사고'
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 팔로잉 피드 최신 글 순회 자동 하트(좋아요) 봇
 * @param {number} targetCount 목표 하트 수 (기본 10건)
 * @param {function} log 로깅 함수 (SSE 스트리밍 연동)
 */
export async function runFeedHeartBot(targetCount = 10, log = console.log) {
  // 1회 실행 상한으로 깎는다. 하루 한도가 300이어도 한 번에 300을 몰아치면
  // 시간당 260건 꼴이라 사람 손이 아니다. 나눠 누르게 강제하는 지점.
  const requested = targetCount;
  targetCount = Math.min(targetCount, SAFETY_LIMITS.MAX_HEARTS_PER_SESSION);
  if (requested > targetCount) {
    log(`🛡️ [세션 상한] 요청 ${requested}건 → 1회 실행 상한 ${targetCount}건으로 조정합니다. (하루 ${SAFETY_LIMITS.MAX_HEARTS_PER_DAY}건까지 나눠서 진행하세요)`);
  }

  log(`🚀 [팔로워 피드 하트 봇] 최신 피드 순회 하트(❤️) ${targetCount}건 작업을 시작합니다.`);

  const quotaCheck = checkSafetyQuota('heart');
  if (!quotaCheck.allowed) {
    log(`🛡️ [안전 중단] ${quotaCheck.reason}`);
    return { success: false, reason: quotaCheck.reason, count: 0 };
  }

  let successCount = 0;
  let context = null;
  let browser = null;

  try {
    const isHeadless = process.env.HEADLESS === 'true' || (!process.env.DISPLAY && process.platform !== 'win32');
    log(`🌐 브라우저 세션을 실행합니다. (Headless: ${isHeadless})`);

    const baseOpts = {
      headless: isHeadless,
      viewport: { width: 1280, height: 900 },
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    };

    try {
      browser = await chromium.launch({
        headless: isHeadless,
        args: baseOpts.args
      });
      context = await browser.newContext({
        viewport: baseOpts.viewport,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        locale: 'ko-KR',
        timezoneId: 'Asia/Seoul'
      });
    } catch (err) {
      log(`ℹ️ 브라우저 실행 대체 중 (${err.message})`);
      browser = await chromium.launch({ headless: true });
      context = await browser.newContext();
    }

    // 검증된 storage_state.json 세션 쿠키 자동 주입 (클라우드 & 로컬 로그인 세션 영구 보장)
    const statePath = path.join(rootDir, 'storage_state.json');
    if (fs.existsSync(statePath)) {
      try {
        const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        if (state.cookies && state.cookies.length > 0) {
          await context.addCookies(state.cookies);
        }
      } catch {}
    }

    const page = await context.newPage();

    // 1. 내 팔로잉 피드로 이동 (최신 팔로워 글 우선)
    log(`📲 [피드 접속] 팔로잉 피드(https://www.threads.net/following) 로딩 중...`);
    try {
      await page.goto('https://www.threads.net/following', { waitUntil: 'domcontentloaded', timeout: 25000 });
    } catch (e) {
      log(`   ⚠️ 팔로잉 피드 로드 지연, 메인 피드로 대체 시도...`);
      await page.goto('https://www.threads.net/', { waitUntil: 'domcontentloaded', timeout: 25000 });
    }
    await sleep(3500);

    // 스크롤하며 게시물 탐색 및 하트 클릭
    let scrollAttempts = 0;
    const maxScrollAttempts = 30;
    const processedPostIds = new Set();

    while (successCount < targetCount && scrollAttempts < maxScrollAttempts) {
      scrollAttempts++;

      // 화면에 노출된 포스트 요소 수집
      const posts = await page.locator('div[data-pressable-container="true"], article').all();
      log(`🔍 [피드 스캔] 현재 화면 내 감지된 게시글: ${posts.length}개 (진행: ${successCount}/${targetCount})`);

      for (const post of posts) {
        if (successCount >= targetCount) break;

        // 쿼터 재확인
        const currentQuota = checkSafetyQuota('heart');
        if (!currentQuota.allowed) {
          log(`🛡️ [일일 한도 도달] ${currentQuota.reason}`);
          return { success: true, count: successCount, reason: currentQuota.reason };
        }

        try {
          // 포스트 텍스트 추출 (감정 필터링용)
          const postText = await post.innerText().catch(() => '');
          if (!postText || postText.trim().length === 0) continue;

          // 고유 식별자 생성 (텍스트 앞 40자)
          const snippetId = postText.slice(0, 40).replace(/\s+/g, ' ');
          if (processedPostIds.has(snippetId)) continue;
          processedPostIds.add(snippetId);

          // 위험/부정적 키워드 필터링
          const hasDanger = DANGER_KEYWORDS.some(k => postText.includes(k));
          if (hasDanger) {
            log(`   ⚠️ [감정 필터] 부정/민감 키워드 감지 -> 하트 스킵`);
            continue;
          }

          // 좋아요 버튼 식별
          // 스레드의 좋아요 버튼은 svg[aria-label="좋아요"] 또는 svg[aria-label="Like"]
          const likeSvg = post.locator('svg[aria-label="좋아요"], svg[aria-label="Like"]').first();
          const unlikeSvg = post.locator('svg[aria-label="좋아요 취소"], svg[aria-label="Unlike"]').first();

          // 이미 좋아요가 눌려있으면 스킵
          if (await unlikeSvg.isVisible({ timeout: 500 }).catch(() => false)) {
            continue;
          }

          if (await likeSvg.isVisible({ timeout: 1000 }).catch(() => false)) {
            // 버튼 클릭 가능 컨테이너 찾기
            const likeBtn = likeSvg.locator('xpath=ancestor::div[@role="button"] | ancestor::button').first();
            const clickTarget = (await likeBtn.isVisible().catch(() => false)) ? likeBtn : likeSvg;

            // 시선 이동 효과 (살짝 스크롤 맞춤)
            await clickTarget.scrollIntoViewIfNeeded().catch(() => {});
            await sleep(randomBetween(500, 1000));

            // 클릭 수행
            await clickTarget.click({ force: true });
            await sleep(1000);

            successCount++;
            recordAction('heart', `피드 글 하트: ${snippetId.slice(0, 20)}...`);
            log(`   ❤️ [하트 성공 #${successCount}] "${snippetId.slice(0, 25)}..."`);

            // 인간형 가변 딜레이 (4초 ~ 8초)
            if (successCount < targetCount) {
              const waitSec = randomBetween(SAFETY_LIMITS.MIN_HEART_DELAY_SEC, SAFETY_LIMITS.MAX_HEART_DELAY_SEC);
              log(`   ⏳ 인간형 딜레이 대기 중 (${waitSec}초)...`);
              await sleep(waitSec * 1000);

              // 5건마다 롱 쿨다운 (계정 보호)
              if (successCount % SAFETY_LIMITS.COOLDOWN_EVERY_N === 0) {
                log(`   ☕ [계정 보호 쿨다운] ${SAFETY_LIMITS.COOLDOWN_TIME_SEC}초간 자연스러운 휴식 진행...`);
                await sleep(SAFETY_LIMITS.COOLDOWN_TIME_SEC * 1000);
              }
            }
          }
        } catch (itemErr) {
          // 개별 글 오류는 무시하고 다음 글로 진행
        }
      }

      // 피드 아래로 스크롤하여 새 글 로드
      log(`📜 [피드 스크롤] 추가 게시글 로딩 중...`);
      await page.mouse.wheel(0, 900);
      await sleep(randomBetween(2500, 3500));
    }

    log(`\n🎉 [피드 하트 완료] 총 ${successCount}건의 최신 글에 하트(좋아요)를 성공적으로 눌렀습니다!`);
  } catch (error) {
    log(`❌ 피드 하트 봇 실행 중 오류: ${error.message}`);
  } finally {
    if (context) {
      await sleep(1500);
      await context.close().catch(() => {});
    }
    if (browser) {
      await browser.close().catch(() => {});
    }
  }

  return { success: true, count: successCount };
}

// 직접 터미널 실행 지원
if (process.argv[1] && process.argv[1].endsWith('feed_heart_bot.mjs')) {
  const count = parseInt(process.argv[2], 10) || 5;
  runFeedHeartBot(count).then(res => {
    console.log('완료 결과:', res);
    process.exit(0);
  });
}
