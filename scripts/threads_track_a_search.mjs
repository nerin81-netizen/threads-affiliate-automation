import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROFILE_DIR = path.join(__dirname, '.threads_chrome_profile');

// 10분 TTL 인메모리 캐시
const searchCache = new Map();

export async function searchThreadsTrackA(keyword) {
  const cleanKeyword = String(keyword || '').trim();
  if (!cleanKeyword) return { keyword: '', count: 0, posts: [] };

  const cacheKey = cleanKeyword.toLowerCase();
  const cached = searchCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < 10 * 60 * 1000)) {
    return cached.data;
  }

  let browserContext = null;
  try {
    // 헤드리스 모드로 브라우저 실행 (빠른 백그라운드 크롤링)
    browserContext = await chromium.launchPersistentContext(PROFILE_DIR, {
      channel: 'chrome',
      headless: true, // 시장조사는 화면 없이 백그라운드에서 빠르게 실행
      viewport: { width: 1280, height: 800 },
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
    });

    const page = browserContext.pages()[0] || await browserContext.newPage();
    const searchUrl = `https://www.threads.com/search?q=${encodeURIComponent(cleanKeyword)}&filter=recent`;
    
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await new Promise(r => setTimeout(r, 2500));

    // 결과 글 카드들 및 링크 탐색
    const results = await page.evaluate(() => {
      const posts = [];
      const links = Array.from(document.querySelectorAll('a[href*="/post/"]'));
      
      for (const a of links) {
        const href = a.href.split('?')[0];
        const match = href.match(/@([a-zA-Z0-9._]+)\/post\/([a-zA-Z0-9_-]+)/);
        if (match) {
          const author = match[1];
          let card = a;
          for (let i = 0; i < 4; i++) {
            if (card.parentElement) card = card.parentElement;
          }
          const text = card ? (card.innerText || '').slice(0, 150).replace(/\n/g, ' ') : '';
          
          if (!posts.some(p => p.permalink === href)) {
            posts.push({
              id: match[2],
              username: author,
              text,
              permalink: href,
              timestamp: new Date().toISOString()
            });
          }
        }
      }
      return posts;
    });

    const count = results.length > 0 ? results.length : Math.floor(Math.random() * 8) + 4; // 최소 활성도
    const resultData = {
      keyword: cleanKeyword,
      count: results.length,
      posts: results.slice(0, 5),
      source: 'threads_track_a_browser'
    };

    searchCache.set(cacheKey, { timestamp: Date.now(), data: resultData });
    return resultData;
  } catch (err) {
    console.error(`[트랙 A 검색 오류]: ${err.message}`);
    // 폴백 반환
    return {
      keyword: cleanKeyword,
      count: 0,
      posts: [],
      error: err.message,
      source: 'threads_track_a_fallback'
    };
  } finally {
    if (browserContext) {
      await browserContext.close().catch(() => {});
    }
  }
}

// 단독 테스트
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('🔍 트랙 A 스레드 실시간 검색 테스트 시작 (키워드: 스하리)...');
  searchThreadsTrackA('스하리').then(res => {
    console.log('✅ 검색 결과:', JSON.stringify(res, null, 2));
  });
}
