import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const PROFILE_DIR = path.resolve(rootDir, '.threads_chrome_profile');

async function checkFeed() {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    channel: 'chrome',
    viewport: { width: 1280, height: 900 },
    locale: 'ko-KR'
  });

  const page = context.pages()[0] || await context.newPage();
  console.log('🌐 홈 피드 접속...');
  await page.goto('https://www.threads.net/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  await page.screenshot({ path: path.join(rootDir, 'my_feed_top.png') });

  // 활동(알림) 페이지도 확인
  console.log('🌐 활동 페이지 접속...');
  await page.goto('https://www.threads.net/activity', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(rootDir, 'my_activity.png') });

  // 유령 게시물 또는 보관함 확인
  console.log('🌐 보관함 확인...');
  const archive = page.locator('span:has-text("보관함"), a:has-text("보관함")').first();
  if (await archive.isVisible().catch(() => false)) {
    await archive.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(rootDir, 'my_archive.png') });
  }

  await context.close();
}

checkFeed().catch(console.error);
