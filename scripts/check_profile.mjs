import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const PROFILE_DIR = path.resolve(rootDir, '.threads_chrome_profile');

async function checkProfile() {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    channel: 'chrome',
    viewport: { width: 1280, height: 900 },
    locale: 'ko-KR'
  });

  const page = context.pages()[0] || await context.newPage();
  console.log('🌐 프로필 페이지 접속...');
  await page.goto('https://www.threads.net/@your_threads_id', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // 스크롤 다운
  await page.evaluate(() => window.scrollBy(0, 600));
  await page.waitForTimeout(2000);

  await page.screenshot({ path: path.join(rootDir, 'my_profile_scrolled.png') });
  console.log('📸 스크롤 캡처 완료: my_profile_scrolled.png');

  await context.close();
}

checkProfile().catch(console.error);
