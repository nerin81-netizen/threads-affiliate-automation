import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const PROFILE_DIR = path.resolve(rootDir, '.threads_chrome_profile');

async function testSearchUI() {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1280, height: 900 },
    locale: 'ko-KR'
  });

  const page = context.pages()[0] || await context.newPage();
  console.log('🌐 threads.net 메인 접속...');
  await page.goto('https://www.threads.net/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  console.log('👆 좌측 [검색] 메뉴 클릭...');
  const searchNav = page.locator('div[role="button"]:has-text("검색"), span:has-text("검색"), svg[aria-label="검색"]').first();
  await searchNav.click();
  await page.waitForTimeout(2000);

  await page.screenshot({ path: path.join(rootDir, 'search_ui_clicked.png') });

  // 검색창 입력
  const searchInput = page.locator('input[placeholder*="검색"], input[type="search"], input').first();
  if (await searchInput.isVisible({ timeout: 4000 }).catch(() => false)) {
    console.log('⌨️ 검색창에 "맞팔" 입력 후 Enter...');
    await searchInput.fill('맞팔');
    await page.waitForTimeout(500);
    await searchInput.press('Enter');
    await page.waitForTimeout(3000);

    await page.screenshot({ path: path.join(rootDir, 'search_results.png') });

    // 팔로우 버튼들 찾기
    const followBtns = await page.$$eval('div[role="button"], button', btns => {
      return btns.map(b => ({
        text: b.innerText ? b.innerText.trim() : '',
        role: b.getAttribute('role')
      })).filter(b => b.text.includes('팔로우'));
    });
    console.log('👥 발견된 팔로우 버튼 목록:', JSON.stringify(followBtns, null, 2));
  } else {
    console.log('⚠️ 검색 입력창을 찾지 못함!');
  }

  await page.waitForTimeout(2000);
  await context.close();
}

testSearchUI().catch(console.error);
