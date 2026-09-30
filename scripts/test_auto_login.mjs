import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(rootDir, '.env') });

const PROFILE_DIR = path.join(rootDir, '.threads_chrome_profile');
const id = process.env.THREADS_ACCOUNT_ID || 'test_creator'; // 인스타 핸들
const email = process.env.THREADS_ID || 'test_user@example.com';
const pw = process.env.THREADS_PW;

if (!pw) {
  throw new Error('THREADS_PW가 설정되지 않았습니다. .env 또는 안전한 실행 환경 변수를 설정하세요.');
}

async function main() {
  console.log(`[Auto-Login Test] Target: ${id} / ${email}, Profile: ${PROFILE_DIR}`);
  const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    viewport: { width: 1280, height: 900 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });

  const page = await browser.newPage();
  await page.goto('https://www.threads.net/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  console.log('Login Page URL:', page.url());
  await page.screenshot({ path: path.join(rootDir, 'public', 'login_step1.png') });

  // 1. 'Continue with Instagram' 또는 'Instagram으로 계속하기' 또는 'Log in with username instead'
  const usernameLoginBtn = page.locator('text=Log in with username instead, text=사용자 이름으로 로그인').first();
  const instaBtn = page.locator('text=Continue with Instagram, text=Instagram으로 계속하기').first();

  if (await usernameLoginBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('Clicking "Log in with username instead"...');
    await usernameLoginBtn.click();
    await page.waitForTimeout(2000);
  } else if (await instaBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('Clicking "Continue with Instagram"...');
    await instaBtn.click();
    await page.waitForTimeout(3000);
  }

  await page.screenshot({ path: path.join(rootDir, 'public', 'login_step2.png') });

  // 2. 인풋 폼 찾기
  const usernameInput = page.locator('input[name="username"], input[name="email"], input[placeholder*="username"], input[placeholder*="이메일"], input[placeholder*="전화번호"]').first();
  const passwordInput = page.locator('input[name="password"], input[name="pass"], input[type="password"]').first();

  if (await usernameInput.isVisible({ timeout: 4000 }).catch(() => false)) {
    console.log('Typing credentials...');
    await usernameInput.fill(id); // yusanghag4 먼저 입력
    await page.waitForTimeout(500);
    await passwordInput.fill(pw);
    await page.waitForTimeout(800);

    await page.screenshot({ path: path.join(rootDir, 'public', 'login_step3.png') });

    // 로그인 버튼 클릭
    const submitBtn = page.locator('button[type="submit"], div[role="button"]:has-text("Log in"), div[role="button"]:has-text("로그인")').first();
    if (await submitBtn.isVisible().catch(() => false)) {
      console.log('Clicking submit button...');
      await submitBtn.click();
    } else {
      console.log('Pressing Enter...');
      await passwordInput.press('Enter');
    }

    await page.waitForTimeout(8000);
    await page.screenshot({ path: path.join(rootDir, 'public', 'login_step4.png') });
    console.log('Post-login URL:', page.url());
  } else {
    console.log('Inputs not found! Current page text:');
    console.log(await page.evaluate(() => document.body.innerText.slice(0, 300)));
  }

  await browser.close();
}

main().catch(console.error);
