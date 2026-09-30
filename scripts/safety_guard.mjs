import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const STATS_FILE = path.join(rootDir, 'daily_stats.json');

// 1일 안전 권장 한도 (스레드 계정 보호용)
export const SAFETY_LIMITS = {
  MAX_FOLLOWS_PER_DAY: 40,   // 하루 최대 안전 팔로우 수
  MAX_POSTS_PER_DAY: 5,      // 하루 최대 안전 포스팅 수
  MAX_HEARTS_PER_DAY: 300,   // 하루 최대 안전 하트(좋아요) 수
  MAX_FOLLOWS_PER_SESSION: 15, // 1회 실행당 최대 팔로우
  // 하루 300건은 "한 번에 몰아치지 않는다"가 전제다. 1회 실행을 30건으로 묶어
  // 최소 10세션에 나눠 눌리게 강제한다. 이 상한이 없으면 300건이 한 시간 남짓에
  // 다 빠져나가 오히려 예전 80건보다 위험해진다.
  MAX_HEARTS_PER_SESSION: 30,
  MAX_COMMENTS_PER_DAY: 100, // 하루 최대 안전 댓글 수
  // 댓글은 하트보다 스팸 판정이 훨씬 빡세다. 1회 10건으로 묶어 최소 10세션에 나눈다.
  MAX_COMMENTS_PER_SESSION: 10,
  MIN_COMMENT_DELAY_SEC: 15, // 댓글 간 최소 딜레이 (초)
  MAX_COMMENT_DELAY_SEC: 30, // 댓글 간 최대 딜레이 (초)

  // [아웃바운드 전용] 남의 글에 먼저 말 거는 답글. 내 글에 온 댓글에 답하는 인바운드와
  // 스팸 판정 기준이 완전히 다르다. 한도를 섞어두면 아웃바운드가 인바운드 예산을
  // 잠식하고, 밴이 나도 어느 쪽이 원인인지 분리가 안 된다. 그래서 카운터부터 따로 둔다.
  MAX_OUTBOUND_COMMENTS_PER_DAY: 10,
  // 1회 10건. 건당 45~120초 + 3건마다 5분 쿨다운이라 한 세션이 25~30분에 걸쳐 진행된다.
  // 몰아치기가 아니라 "느리게 오래"라서, 짧은 세션을 여러 번 여는 것보다 로그인 흔적이 적다.
  MAX_OUTBOUND_COMMENTS_PER_SESSION: 10,
  MIN_OUTBOUND_COMMENT_DELAY_SEC: 45,  // 사람이 남의 글 읽고 답글 쓰는 최소 시간
  MAX_OUTBOUND_COMMENT_DELAY_SEC: 120,
  OUTBOUND_COOLDOWN_EVERY_N: 3,
  OUTBOUND_COOLDOWN_TIME_SEC: 300,
  OUTBOUND_REPEAT_BLOCK_DAYS: 7,       // 같은 계정에 재답글 금지 기간 (괴롭힘 판정 회피)
  MIN_OUTBOUND_POST_TEXT_LEN: 15,      // 본문이 이보다 짧으면 문맥 답글이 불가능하다
  MIN_FOLLOW_DELAY_SEC: 8,   // 팔로우 간 최소 딜레이 (초)
  MAX_FOLLOW_DELAY_SEC: 18,  // 팔로우 간 최대 딜레이 (초)
  MIN_HEART_DELAY_SEC: 4,    // 하트 클릭 간 최소 딜레이 (초)
  MAX_HEART_DELAY_SEC: 9,    // 하트 클릭 간 최대 딜레이 (초)
  COOLDOWN_EVERY_N: 5,       // N회 작업마다 롱 쿨다운
  COOLDOWN_TIME_SEC: 35      // 롱 쿨다운 시간 (초)
};

/**
 * 오늘 날짜 기준 통계 로드
 */
export function getDailyStats() {
  const today = new Date().toISOString().split('T')[0];
  let stats = { date: today, followCount: 0, postCount: 0, heartCount: 0, commentCount: 0, outboundCommentCount: 0, lastActionTime: null, history: [] };

  try {
    if (fs.existsSync(STATS_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
      if (data.date === today) {
        stats = { ...stats, ...data };
      }
    }
  } catch (e) {}

  return stats;
}

/**
 * 통계 저장
 */
export function recordAction(type, detail = '') {
  const stats = getDailyStats();
  if (type === 'follow') {
    stats.followCount = (stats.followCount || 0) + 1;
  } else if (type === 'post') {
    stats.postCount = (stats.postCount || 0) + 1;
  } else if (type === 'heart') {
    stats.heartCount = (stats.heartCount || 0) + 1;
  } else if (type === 'comment') {
    stats.commentCount = (stats.commentCount || 0) + 1;
  } else if (type === 'outbound_comment') {
    stats.outboundCommentCount = (stats.outboundCommentCount || 0) + 1;
  }
  stats.lastActionTime = new Date().toISOString();
  stats.history.push({
    type,
    time: new Date().toLocaleTimeString('ko-KR'),
    detail
  });

  if (stats.history.length > 50) {
    stats.history = stats.history.slice(-50);
  }

  fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2), 'utf8');
  return stats;
}

/**
 * 계정 안전 상태 점검
 */
export function checkSafetyQuota(type) {
  const stats = getDailyStats();
  if (type === 'follow' && (stats.followCount || 0) >= SAFETY_LIMITS.MAX_FOLLOWS_PER_DAY) {
    return {
      allowed: false,
      reason: `오늘 안전 팔로우 한도(${SAFETY_LIMITS.MAX_FOLLOWS_PER_DAY}명)에 도달했습니다. 계정 보호를 위해 내일 자정 이후 재개하세요.`
    };
  }
  if (type === 'post' && (stats.postCount || 0) >= SAFETY_LIMITS.MAX_POSTS_PER_DAY) {
    return {
      allowed: false,
      reason: `오늘 안전 포스팅 한도(${SAFETY_LIMITS.MAX_POSTS_PER_DAY}건)에 도달했습니다. 스팸 감지 방지를 위해 휴식이 필요합니다.`
    };
  }
  if (type === 'heart' && (stats.heartCount || 0) >= SAFETY_LIMITS.MAX_HEARTS_PER_DAY) {
    return {
      allowed: false,
      reason: `오늘 안전 하트(좋아요) 한도(${SAFETY_LIMITS.MAX_HEARTS_PER_DAY}건)에 도달했습니다. 메타 계정 보호를 위해 내일 자정 이후 재개하세요.`
    };
  }
  if (type === 'comment' && (stats.commentCount || 0) >= SAFETY_LIMITS.MAX_COMMENTS_PER_DAY) {
    return {
      allowed: false,
      reason: `오늘 안전 댓글 한도(${SAFETY_LIMITS.MAX_COMMENTS_PER_DAY}건)에 도달했습니다. 댓글은 스팸 판정이 가장 엄격하니 내일 자정 이후 재개하세요.`
    };
  }
  if (type === 'outbound_comment') {
    // 킬스위치: 계정 경고가 감지되면 코드 수정 없이 환경변수 하나로 즉시 정지시킨다.
    if (process.env.DISABLE_OUTBOUND === '1') {
      return { allowed: false, reason: 'DISABLE_OUTBOUND=1 킬스위치가 켜져 있어 아웃바운드 답글을 실행하지 않습니다.' };
    }
    if ((stats.outboundCommentCount || 0) >= SAFETY_LIMITS.MAX_OUTBOUND_COMMENTS_PER_DAY) {
      return {
        allowed: false,
        reason: `오늘 아웃바운드(피드) 답글 한도(${SAFETY_LIMITS.MAX_OUTBOUND_COMMENTS_PER_DAY}건)에 도달했습니다. 남의 글에 먼저 거는 답글은 스팸 판정이 가장 엄격하니 내일 자정 이후 재개하세요.`
      };
    }
  }
  return { allowed: true, current: stats };
}

/**
 * 사람처럼 자연스러운 인간 타이핑 시뮬레이션 (0ms 붙여넣기 봇 탐지 회피)
 */
export async function humanType(page, selectorOrLocator, text, log = console.log) {
  const locator = typeof selectorOrLocator === 'string' ? page.locator(selectorOrLocator).first() : selectorOrLocator;
  await locator.click();
  await sleep(randomBetween(300, 600));

  // 긴 텍스트의 경우 일부는 빠르게 입력하고 중간중간 멈칫하는 자연스러운 속도 구현.
  // for...of 는 코드포인트 단위로 순회한다. text[i] 로 인덱싱하면 이모지(서로게이트 쌍)가
  // 반쪽씩 잘려 나가 스레드에 U+FFFD(���)로 박힌다.
  for (const char of text) {
    if (char.codePointAt(0) > 0xFFFF) {
      // BMP 밖 문자(이모지)는 키 이벤트로 입력할 수 없어 직접 삽입한다.
      await page.keyboard.insertText(char);
      await sleep(randomBetween(35, 110));
    } else {
      await locator.pressSequentially(char, { delay: randomBetween(35, 110) });
    }

    // 쉼표, 마침표, 줄바꿈 뒤에는 사람이 생각하듯 멈칫
    if (char === '\n' || char === '.' || char === '!') {
      await sleep(randomBetween(300, 700));
    }
  }
  await sleep(randomBetween(500, 1000));
}

/**
 * 사람처럼 부드러운 스크롤 시뮬레이션
 */
export async function humanScroll(page) {
  const steps = randomBetween(3, 6);
  for (let i = 0; i < steps; i++) {
    const scrollAmount = randomBetween(150, 300);
    await page.mouse.wheel(0, scrollAmount);
    await sleep(randomBetween(200, 400));
  }
  // 스크롤 후 내용을 읽는 듯한 체류 시간
  await sleep(randomBetween(1500, 3000));
}

/**
 * 자연스러운 마우스 이동 및 클릭
 */
export async function humanClick(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  await sleep(randomBetween(400, 800));

  const box = await locator.boundingBox();
  if (box) {
    // 버튼 정중앙이 아닌 약간 오차를 둔 위치로 부드럽게 마우스 이동
    const x = box.x + box.width * (0.3 + Math.random() * 0.4);
    const y = box.y + box.height * (0.3 + Math.random() * 0.4);
    await page.mouse.move(x, y, { steps: randomBetween(5, 12) });
    await sleep(randomBetween(200, 500));
  }

  await locator.click();
  await sleep(randomBetween(400, 900));
}

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
export const randomBetween = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
