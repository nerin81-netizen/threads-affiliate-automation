import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const PROFILE_DIR = path.join(rootDir, '.threads_chrome_profile');

async function main() {
  console.log('Testing reply click on profile:', PROFILE_DIR);
  const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });

  const page = await browser.newPage();
  const testUrl = 'https://www.threads.net/@interiordi8/post/DCcRHEZBcSf';
  console.log('Navigating to:', testUrl);
  await page.goto(testUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  // 말풍선 아이콘 찾기
  const commentSvg = page.locator('svg[aria-label="댓글"], svg[aria-label="답글"], svg[aria-label="Reply"], svg[aria-label="Comment"]').first();
  console.log('commentSvg visible:', await commentSvg.isVisible().catch(() => false));
  console.log('commentSvg aria-label:', await commentSvg.getAttribute('aria-label').catch(() => null));

  const commentBtn = commentSvg.locator('xpath=ancestor::div[@role="button"] | ancestor::button').first();
  const clickTarget = (await commentBtn.isVisible().catch(() => false)) ? commentBtn : commentSvg;

  await clickTarget.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(500);

  console.log('Clicking reply button...');
  await clickTarget.click({ force: true });
  await page.waitForTimeout(2500);

  // 클릭 후 활성화된 요소 조사
  const dump = await page.evaluate(() => {
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).map(d => ({
      text: d.innerText?.slice(0, 100),
      html: d.innerHTML?.slice(0, 200)
    }));

    const editables = Array.from(document.querySelectorAll('[contenteditable="true"], [role="textbox"], [data-lexical-editor="true"], textarea')).map(el => ({
      tag: el.tagName,
      role: el.getAttribute('role'),
      contenteditable: el.getAttribute('contenteditable'),
      lexical: el.getAttribute('data-lexical-editor'),
      placeholder: el.getAttribute('placeholder') || el.getAttribute('aria-placeholder'),
      ariaLabel: el.getAttribute('aria-label'),
      text: el.innerText?.slice(0, 50),
      parentRole: el.parentElement?.getAttribute('role')
    }));

    const buttons = Array.from(document.querySelectorAll('button, div[role="button"]')).map(b => ({
      text: b.innerText?.trim(),
      aria: b.getAttribute('aria-label')
    })).filter(b => b.text && /게시|Post|Reply|답글/i.test(b.text));

    return { dialogs, editables, buttons };
  });

  console.log('DUMP RESULT:', JSON.stringify(dump, null, 2));

  await page.screenshot({ path: path.join(rootDir, 'public', 'reply_debug_capture.png') });
  console.log('Saved screenshot to public/reply_debug_capture.png');

  await browser.close();
}

main().catch(console.error);
