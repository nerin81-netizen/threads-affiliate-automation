import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(rootDir, '.env') });

const PROFILE_DIR = path.join(rootDir, '.threads_chrome_profile');
const id = process.env.THREADS_ID || 'your_threads_id'; // 스레드/인스타 핸들
const pw = process.env.THREADS_PW;

if (!pw) {
  throw new Error('THREADS_PW가 설정되지 않았습니다. .env 또는 안전한 실행 환경 변수를 설정하세요.');
}

async function main() {
  console.log(`[Auto-Login Execution] Logging in as ${id}...`);
  const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    viewport: { width: 1280, height: 900 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });

  const page = await browser.newPage();
  await page.goto('https://www.threads.net/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  // 'Log in with username instead' 버튼이 보이면 먼저 클릭
  const usernameLoginBtn = page.locator('text=/Log in with username instead|사용자 이름으로 로그인/').first();
  if (await usernameLoginBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('Clicking "Log in with username instead"...');
    await usernameLoginBtn.click();
    await page.waitForTimeout(1500);
  }

  // 아이디/비번 입력창 찾기
  const userInput = page.locator('input[type="text"], input[placeholder*="sername"], input[placeholder*="mail"]').first();
  const passInput = page.locator('input[type="password"]').first();

  console.log('Waiting for inputs...');
  await userInput.waitFor({ state: 'visible', timeout: 5000 });
  await passInput.waitFor({ state: 'visible', timeout: 5000 });

  console.log('Filling username and password...');
  await userInput.fill(id);
  await page.waitForTimeout(600);
  await passInput.fill(pw);
  await page.waitForTimeout(800);

  // Log in 버튼 클릭
  const loginBtn = page.locator('div[role="button"]:has-text("Log in"), button:has-text("Log in"), div[role="button"]:has-text("로그인"), button:has-text("로그인")').first();
  console.log('Clicking Log in button...');
  await loginBtn.click();

  // 로그인 처리 대기 (10초)
  console.log('Waiting for login to complete...');
  await page.waitForTimeout(10000);

  console.log('Current URL after login:', page.url());
  await page.screenshot({ path: path.join(rootDir, 'public', 'login_result.png') });

  // 팝업/저장 버튼이 있으면 클릭
  const popups = await page.locator('button:has-text("Save Info"), button:has-text("Not Now"), button:has-text("저장"), button:has-text("나중에")').all();
  for (const p of popups) {
    if (await p.isVisible().catch(() => false)) {
      console.log('Clicking dialog button:', await p.innerText());
      await p.click();
      await page.waitForTimeout(2000);
    }
  }

  // 홈 피드 이동 및 확인
  await page.goto('https://www.threads.net/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(rootDir, 'public', 'home_after_login.png') });

  const isHome = page.url().includes('threads.net') || page.url().includes('threads.com');
  const hasNav = await page.locator('svg[aria-label="Home"], svg[aria-label="홈"], svg[aria-label="Create"], svg[aria-label="글쓰기"]').first().isVisible({ timeout: 5000 }).catch(() => false);
  console.log(`Login Verification: isHome=${isHome}, hasNav=${hasNav}`);

  if (hasNav) {
    console.log('SUCCESS: Logged in and session saved to .threads_chrome_profile!');
  } else {
    console.log('FAILED or requires 2FA / checkpoint. Check public/login_result.png');
  }

  await browser.close();
}

main().catch(console.error);
