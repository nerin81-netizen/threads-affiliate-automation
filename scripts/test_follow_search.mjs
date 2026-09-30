import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const PROFILE_DIR = path.resolve(rootDir, '.threads_chrome_profile');

async function testSearch() {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    channel: 'chrome',
    viewport: { width: 1280, height: 900 },
    locale: 'ko-KR'
  });

  const page = context.pages()[0] || await context.newPage();
  console.log('🌐 검색 페이지 접속: #맞팔');
  await page.goto('https://www.threads.net/search?q=%23%EB%A7%9E%ED%8C%94&filter=recent', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  await page.screenshot({ path: path.join(rootDir, 'search_follow_test.png') });

  // 팔로우 버튼들 찾기
  const followBtns = await page.$$eval('div[role="button"], button', btns => {
    return btns.map(b => b.innerText ? b.innerText.trim() : '').filter(t => t.includes('팔로우') || t.includes('팔로잉'));
  });

  console.log('👥 발견된 팔로우 관련 버튼들:', followBtns);
  await context.close();
}

testSearch().catch(console.error);
