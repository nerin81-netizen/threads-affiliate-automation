/**
 * 수동 발행 묶음 생성기 — 서버·API·자동 게시 없이 "후보 N개 + 카드 이미지"만 만든다.
 * 사용자가 결과 HTML에서 골라 Threads 앱/웹에 직접 복사·붙여넣기한다.
 *
 *   node scripts/manual_pack.mjs [--count 6] [--category 일상공감]
 *   node scripts/manual_pack.mjs --selftest
 *
 * 출력: manual_queue/YYYY-MM-DD/index.html (이미지는 base64로 내장, 파일 하나로 열림)
 * 이미 뽑은 글은 manual_queue/picked.json 에 기록해 다시 나오지 않게 한다.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { renderCard } from './card_render.mjs';
import { scorePost } from './post_quality.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const queueDir = path.join(rootDir, 'manual_queue');
const pickedFile = path.join(queueDir, 'picked.json');
const MIN_SCORE = 85;
const THEMES = ['night', 'ember', 'mint'];

// 링크·빈칸([     ]) 있는 글은 제외. 복구 기간엔 링크 금지(정지 원인 보고서 4주 로드맵).
export function isUsable(post) {
  const t = post.postText || '';
  return post.status === 'READY'
    && !/https?:\/\/|www\./i.test(t)
    && !/\[\s*\]/.test(t)
    && scorePost(t).score >= MIN_SCORE;
}

// 카테고리를 번갈아 뽑아 한 묶음이 한 주제로 쏠리지 않게 한다.
export function pick(posts, count, category) {
  const pool = posts.filter(p => isUsable(p) && (!category || p.category === category));
  const byCat = {};
  for (const p of pool.sort(() => Math.random() - 0.5)) (byCat[p.category] ||= []).push(p);
  const out = [];
  const cats = Object.keys(byCat);
  while (out.length < count && cats.some(c => byCat[c].length)) {
    for (const c of cats) if (byCat[c].length && out.length < count) out.push(byCat[c].shift());
  }
  return out;
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function buildHtml(date, items) {
  const cards = items.map((it, i) => `
  <article class="card" data-id="${esc(it.id)}">
    <img src="data:image/png;base64,${it.png}" alt="카드 ${i + 1}">
    <div class="body">
      <div class="meta">#${i + 1} · ${esc(it.category)} · 품질 ${it.score}점</div>
      <pre>${esc(it.postText)}</pre>
      <div class="btns">
        <button data-act="text">본문 복사</button>
        <button data-act="img">이미지 복사</button>
        <a download="card_${date}_${i + 1}.png" href="data:image/png;base64,${it.png}"><button>이미지 저장</button></a>
        <label><input type="checkbox" class="done"> 올렸음</label>
      </div>
    </div>
  </article>`).join('\n');

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>수동 발행 후보 ${date}</title>
<style>
:root{--bg:#f6f4ef;--ink:#1c1b22;--sub:#6b6875;--card:#fff;--line:#e4e0d6;--accent:#5b3fd6}
@media(prefers-color-scheme:dark){:root{--bg:#14131a;--ink:#f1eff7;--sub:#9a97a8;--card:#1d1c26;--line:#2d2b3a;--accent:#a78bfa}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 'Pretendard','Malgun Gothic',sans-serif}
header{max-width:960px;margin:0 auto;padding:32px 16px 8px}h1{margin:0 0 8px;font-size:26px}
.rules{color:var(--sub);font-size:14px;margin:0;padding-left:18px}
main{max-width:960px;margin:0 auto;padding:16px;display:grid;gap:20px}
.card{display:grid;grid-template-columns:280px 1fr;gap:20px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px}
.card.is-done{opacity:.45}.card img{width:100%;border-radius:10px;align-self:start}
.meta{font-size:13px;color:var(--sub);margin-bottom:6px}pre{white-space:pre-wrap;word-break:keep-all;font:inherit;margin:0 0 14px}
.btns{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
button{font:inherit;font-size:14px;padding:8px 14px;border-radius:8px;border:1px solid var(--accent);background:transparent;color:var(--accent);cursor:pointer}
button:hover,button:focus-visible{background:var(--accent);color:#fff;outline:none}
label{font-size:14px;color:var(--sub);margin-left:auto}
@media(max-width:640px){.card{grid-template-columns:1fr}}
</style></head><body>
<header><h1>수동 발행 후보 · ${date}</h1>
<ul class="rules">
<li>마음에 드는 것만 골라 올리세요. 하루 1~2개, 올리는 시간은 서로 6시간 이상 띄우세요.</li>
<li>링크·제휴 문구는 넣지 않았습니다. 복구 기간엔 그대로 올리세요.</li>
<li>올리기 전에 본문을 한 번 읽고, 본인 말투로 한두 군데 고치면 더 안전합니다.</li>
</ul></header>
<main>${cards}</main>
<script>
const KEY='manual_done_${date}';let done={};
try{done=JSON.parse(localStorage.getItem(KEY)||'{}')}catch(e){}
document.querySelectorAll('.card').forEach(c=>{
  const id=c.dataset.id,box=c.querySelector('.done');
  box.checked=!!done[id];c.classList.toggle('is-done',box.checked);
  box.onchange=()=>{done[id]=box.checked;c.classList.toggle('is-done',box.checked);try{localStorage.setItem(KEY,JSON.stringify(done))}catch(e){}};
  c.querySelector('[data-act=text]').onclick=async e=>{
    await navigator.clipboard.writeText(c.querySelector('pre').textContent);e.target.textContent='복사됨 ✓';
    setTimeout(()=>e.target.textContent='본문 복사',1500)};
  c.querySelector('[data-act=img]').onclick=async e=>{
    try{const b=await (await fetch(c.querySelector('img').src)).blob();
      await navigator.clipboard.write([new ClipboardItem({'image/png':b})]);e.target.textContent='복사됨 ✓'}
    catch(err){e.target.textContent='실패 → 저장 사용'}
    setTimeout(()=>e.target.textContent='이미지 복사',1800)};
});
</script></body></html>`;
}

async function main() {
  const arg = k => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : undefined; };
  const count = Number(arg('--count') || 6);
  const category = arg('--category');

  const vault = Object.values(JSON.parse(fs.readFileSync(path.join(rootDir, 'content_vault.json'), 'utf8')));
  fs.mkdirSync(queueDir, { recursive: true });
  const picked = fs.existsSync(pickedFile) ? JSON.parse(fs.readFileSync(pickedFile, 'utf8')) : [];
  const chosen = pick(vault.filter(p => !picked.includes(p.id)), count, category);
  if (!chosen.length) throw new Error('뽑을 수 있는 글이 없습니다(전부 사용했거나 조건 불일치).');

  const date = new Date().toISOString().slice(0, 10);
  const outDir = path.join(queueDir, date);
  fs.mkdirSync(outDir, { recursive: true });

  const items = [];
  for (const [i, p] of chosen.entries()) {
    const title = p.postText.split('\n')[0].trim();
    const png = path.join(outDir, `card_${i + 1}.png`);
    await renderCard({ badge: p.category, title, footer: '여러분은 어떠세요? 👇', theme: THEMES[i % THEMES.length] }, png);
    items.push({ ...p, score: scorePost(p.postText).score, png: fs.readFileSync(png).toString('base64') });
  }

  const html = path.join(outDir, 'index.html');
  fs.writeFileSync(html, buildHtml(date, items), 'utf8');
  fs.writeFileSync(pickedFile, JSON.stringify([...picked, ...chosen.map(p => p.id)], null, 2));
  console.log(`후보 ${items.length}개 생성 → ${html}`);
}

function selftest() {
  const mk = (id, category, postText, status = 'READY') => ({ id, category, postText: postText + '\n오늘 어떠셨나요?', status });
  const ok = '퇴근길에 마트에 들렀는데 저녁거리를 고르다가 한참 서 있었습니다. 다들 뭐 드세요?';
  const posts = [
    mk('a1', 'A', ok), mk('a2', 'A', ok + ' 둘째'), mk('b1', 'B', ok + ' 셋째'),
    mk('x1', 'A', '링크 https://toss.im/x ' + ok),
    mk('x2', 'B', '이번 달 [     ] 앱 결제일이 다가옵니다. 다들 어떠세요?'),
    mk('x3', 'A', ok, 'POSTED')
  ];
  console.assert(!isUsable(posts[3]), '링크 글이 통과함');
  console.assert(!isUsable(posts[4]), '빈칸 글이 통과함');
  console.assert(!isUsable(posts[5]), 'POSTED 글이 통과함');
  const got = pick(posts, 3);
  console.assert(got.length === 3 && new Set(got.map(p => p.id)).size === 3, '중복/부족');
  console.assert(new Set(got.slice(0, 2).map(p => p.category)).size === 2, '카테고리 번갈아 뽑기 실패');
  console.log('self-check 통과');
}

if (process.argv.includes('--selftest')) selftest();
else if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
