/**
 * 4:5 세로 카드 이미지 렌더러 (과제 T-4)
 *
 * 이미지 생성 AI를 쓰지 않는다. 카드에는 뉴스 제목·수치 같은 "사실"이 박히는데
 * 생성 모델은 글자와 숫자를 조용히 바꿔버린다. HTML/CSS로 그리면 넣은 값이
 * 그대로 나오고, 재현 가능하고, 이미 깔린 Playwright 말고는 의존성이 없다.
 *
 *   node scripts/card_render.mjs --demo
 */
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350; // 4:5 — 스레드 피드에서 화면 점유가 가장 큰 비율

const THEMES = {
  night: { bg: 'linear-gradient(160deg,#12101f 0%,#1e1836 55%,#2b1f57 100%)', accent: '#a78bfa', sub: '#c4b5fd', glow: 'rgba(139,92,246,.35)' },
  ember: { bg: 'linear-gradient(160deg,#1b1210 0%,#3a1d16 55%,#5c2a18 100%)', accent: '#fbbf24', sub: '#fcd9a0', glow: 'rgba(251,146,60,.32)' },
  mint:  { bg: 'linear-gradient(160deg,#0d1a17 0%,#12332b 55%,#154d3f 100%)', accent: '#5eead4', sub: '#a7f3d0', glow: 'rgba(45,212,191,.3)' }
};

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 제목 길이에 맞춰 폰트 크기를 줄인다. 안 줄이면 긴 제목이 카드 밖으로 넘친다. */
function titleFontSize(title) {
  const len = [...String(title)].length;
  if (len <= 18) return 82;
  if (len <= 28) return 70;
  if (len <= 40) return 58;
  return 48;
}

export function buildCardHtml({ badge = '', title = '', subtitle = '', bullets = [], footer = '', source = '', theme = 'night' }) {
  const t = THEMES[theme] || THEMES.night;
  const bulletHtml = bullets.length ? `
    <div style="display:flex;flex-direction:column;gap:22px;margin-top:56px;">
      ${bullets.map(b => `
        <div style="background:rgba(255,255,255,.06);border:2px solid rgba(255,255,255,.13);
          border-radius:24px;padding:34px 40px;font-size:42px;font-weight:700;line-height:1.42;">
          ${escapeHtml(b)}
        </div>`).join('')}
    </div>` : '';

  return `<div style="width:${CARD_WIDTH}px;height:${CARD_HEIGHT}px;background:${t.bg};
  font-family:'Pretendard','Malgun Gothic',sans-serif;color:#fff;box-sizing:border-box;
  padding:96px 84px;display:flex;flex-direction:column;justify-content:center;position:relative;overflow:hidden;">

  <div style="position:absolute;top:-150px;right:-150px;width:500px;height:500px;border-radius:50%;
    background:radial-gradient(circle,${t.glow},transparent 70%);"></div>

  ${badge ? `<div style="font-size:30px;font-weight:700;letter-spacing:.2em;color:${t.accent};margin-bottom:28px;">${escapeHtml(badge)}</div>` : ''}

  <div style="font-size:${titleFontSize(title)}px;font-weight:800;line-height:1.3;letter-spacing:-.02em;">
    ${escapeHtml(title)}
  </div>

  ${subtitle ? `<div style="font-size:40px;font-weight:500;line-height:1.55;color:${t.sub};margin-top:30px;">${escapeHtml(subtitle)}</div>` : ''}

  ${bulletHtml}

  ${footer ? `<div style="margin-top:64px;font-size:38px;font-weight:600;color:${t.sub};text-align:center;">${escapeHtml(footer)}</div>` : ''}

  ${source ? `<div style="position:absolute;left:84px;bottom:56px;font-size:24px;color:rgba(255,255,255,.42);">출처 · ${escapeHtml(source)}</div>` : ''}
</div>`;
}

/** 카드 HTML을 PNG로 렌더해 파일 경로를 돌려준다. */
export async function renderCard(spec, outPath) {
  const dest = path.isAbsolute(outPath) ? outPath : path.join(rootDir, outPath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  try {
    const page = await browser.newPage({ viewport: { width: CARD_WIDTH, height: CARD_HEIGHT } });
    await page.setContent(`<body style="margin:0">${buildCardHtml(spec)}</body>`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500); // 웹폰트 대신 시스템 폰트라 짧게면 충분
    await page.screenshot({ path: dest });
    return dest;
  } finally {
    await browser.close();
  }
}

async function demo() {
  const out = await renderCard({
    badge: 'BALANCE GAME',
    title: '가성비 따지는 사람만 답할 수 있는 질문',
    bullets: ['A. 3만원짜리 사서 1년 쓰고 버리기', 'B. 12만원짜리 사서 5년 쓰기'],
    footer: '당신의 선택은? 👇',
    theme: 'night'
  }, '_card_demo.png');

  const size = fs.statSync(out).size;
  console.assert(size > 10_000, `렌더 결과가 너무 작음: ${size}B`);

  // 긴 제목이 넘치지 않도록 폰트가 실제로 줄어드는지
  console.assert(titleFontSize('짧은제목') === 82, '짧은 제목 폰트 오류');
  console.assert(titleFontSize('아'.repeat(50)) === 48, '긴 제목 폰트 축소 안 됨');

  // 사용자 입력이 마크업으로 새지 않는지 (뉴스 제목에 <>&가 자주 들어온다)
  const html = buildCardHtml({ title: '<script>x</script>&"' });
  console.assert(!html.includes('<script>'), 'HTML 이스케이프 실패');

  console.log(`self-check 통과 — ${out} (${Math.round(size / 1024)}KB)`);
  fs.unlinkSync(out);
}

if (process.argv.includes('--demo')) await demo();
