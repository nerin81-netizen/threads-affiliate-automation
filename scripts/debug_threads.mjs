import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const PROFILE_DIR = path.resolve(rootDir, '.threads_chrome_profile');

async function debugThreads() {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1280, height: 860 },
    locale: 'ko-KR'
  });

  const page = context.pages()[0] || await context.newPage();
  console.log('🌐 스레드 메인 접속...');
  await page.goto('https://www.threads.net/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  console.log('📸 현재 화면 캡처: debug_threads_main.png');
  await page.screenshot({ path: path.join(rootDir, 'debug_threads_main.png') });

  // 글쓰기 관련 요소들 검색
  const buttons = await page.$$eval('div[role="button"], button, svg, a', els => {
    return els.map(el => ({
      tag: el.tagName,
      role: el.getAttribute('role'),
      ariaLabel: el.getAttribute('aria-label'),
      text: el.innerText ? el.innerText.trim().slice(0, 30) : ''
    })).filter(item => item.ariaLabel || item.text.includes('스레드') || item.text.includes('새로운') || item.text.includes('게시') || item.text.includes('작성'));
  });

  console.log('🔍 검색된 관련 요소 목록:\n', JSON.stringify(buttons.slice(0, 20), null, 2));

  // 새로운 소식이 있나요? 또는 글쓰기 버튼 클릭 시도
  const trigger = page.locator('div:has-text("새로운 소식이 있나요?"), svg[aria-label="글쓰기"], svg[aria-label="Create"], div[role="button"]:has-text("새로운 스레드"), a:has-text("새로운 스레드")').first();
  if (await trigger.isVisible().catch(() => false)) {
    console.log('👆 글쓰기 트리거 클릭 시도...');
    await trigger.click();
    await page.waitForTimeout(3000);
    console.log('📸 트리거 클릭 후 캡처: debug_threads_editor.png');
    await page.screenshot({ path: path.join(rootDir, 'debug_threads_editor.png') });

    // 에디터 요소 조사
    const inputs = await page.$$eval('div[contenteditable], textarea, input, div[role="textbox"]', els => {
      return els.map(el => ({
        tag: el.tagName,
        contenteditable: el.getAttribute('contenteditable'),
        role: el.getAttribute('role'),
        ariaLabel: el.getAttribute('aria-label'),
        placeholder: el.getAttribute('placeholder')
      }));
    });
    console.log('📝 에디터 입력창 후보들:\n', JSON.stringify(inputs, null, 2));
  } else {
    console.log('⚠️ 글쓰기 트리거 요소를 찾지 못함!');
  }

  await page.waitForTimeout(3000);
  await context.close();
}

debugThreads().catch(console.error);
