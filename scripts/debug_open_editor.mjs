import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const PROFILE_DIR = path.resolve(rootDir, '.threads_chrome_profile');

async function testEditor() {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1280, height: 860 },
    locale: 'ko-KR'
  });

  const page = context.pages()[0] || await context.newPage();
  console.log('🌐 threads.net 접속...');
  await page.goto('https://www.threads.net/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // 좌측 사이드바 '새로운 스레드' 클릭
  console.log('👆 좌측 사이드바 [새로운 스레드] 클릭 시도...');
  const sidebarBtn = page.locator('div[role="button"]:has-text("새로운 스레드"), span:has-text("새로운 스레드")').first();
  await sidebarBtn.click();
  await page.waitForTimeout(2000);

  await page.screenshot({ path: path.join(rootDir, 'test_modal_opened.png') });

  // 모달 안의 에디터 찾기
  const editor = page.locator('div[role="dialog"] div[contenteditable="true"], div[contenteditable="true"]').first();
  const isVisible = await editor.isVisible({ timeout: 5000 }).catch(() => false);
  console.log(`📝 에디터 창 보임 여부: ${isVisible}`);

  if (isVisible) {
    console.log('✍️ 타이핑 테스트 진행...');
    await editor.click();
    await editor.fill('안녕하세요! 스레드 자동화 테스트 중입니다. ✨');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(rootDir, 'test_typed.png') });
    console.log('📸 타이핑 후 스크린샷 캡처 완료');

    // 게시 버튼 확인
    const postBtns = await page.$$eval('div[role="dialog"] div[role="button"], div[role="dialog"] button', btns => {
      return btns.map(b => ({
        text: b.innerText ? b.innerText.trim() : '',
        role: b.getAttribute('role'),
        ariaDisabled: b.getAttribute('aria-disabled')
      })).filter(b => b.text.includes('게시'));
    });
    console.log('🔘 모달 내 게시 버튼 목록:', JSON.stringify(postBtns, null, 2));
  }

  await page.waitForTimeout(2000);
  await context.close();
}

testEditor().catch(console.error);
