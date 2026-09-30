/**
 * 분석 대시보드 HTML 생성기
 *
 *   node scripts/build_dashboard.mjs            # 실측 포함 (공식 API 호출)
 *   node scripts/build_dashboard.mjs --offline  # 볼트 진단만 (API 안 부름)
 *
 * 산출물: interim_reports/dashboard.html — 외부 의존성 없는 단일 파일.
 * ponytail: 템플릿 엔진을 넣지 않았다. 문자열 결합으로 충분하고,
 *           섹션이 열 개를 넘어가면 그때 갈아타면 된다.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { auditPosts } from './post_quality.mjs';
import { fetchPostInsights } from './threads_api.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const OUT = path.join(rootDir, 'interim_reports', 'dashboard.html');

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const kst = (iso) => new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(5, 16).replace('T', ' ');

const FLAG_LABEL = {
  ai_pattern: 'AI 문형',
  abstract_word: '추상어',
  short_run: '짧은 문장 나열',
  ending_repeat: '어미 반복',
  no_question: '질문 마무리 없음'
};

/** 실측 성과와 볼트 품질을 모아 대시보드에 필요한 값만 남긴다. */
export function buildModel({ insights, vault }) {
  const audit = auditPosts(Object.values(vault));

  // 발행된 글의 댓글률로 "어떤 구조가 댓글을 부르는가"를 본다
  const rows = insights?.rows || [];
  const withRate = rows.map(r => ({
    ...r,
    replyRate: r.views ? +(r.replies / r.views * 100).toFixed(1) : 0
  })).sort((a, b) => b.replyRate - a.replyRate);

  const totals = rows.reduce((a, r) => ({
    views: a.views + r.views, likes: a.likes + r.likes, replies: a.replies + r.replies
  }), { views: 0, likes: 0, replies: 0 });

  return {
    audit,
    insights: insights ? { ...insights, withRate, totals } : null,
    fixable: audit.scored.filter(p => p.score < 100).sort((a, b) => a.score - b.score),
    perfect: audit.scored.filter(p => p.score === 100).length
  };
}

function render(m) {
  const ins = m.insights;
  const byHour = ins?.byHour || [];
  const maxAvg = Math.max(...byHour.map(b => b.avgViews), 1);
  const maxReply = Math.max(...(ins?.withRate || []).map(r => r.replyRate), 1);

  const kpi = (k, v, unit, note, cls = '') =>
    `<div class="kpi"><div class="k">${k}</div><div class="v ${cls}">${v}<span class="u">${unit}</span></div><div class="n">${note}</div></div>`;

  return `<title>스레드 분석 대시보드</title>
<style>
:root{--bg:#0b0b10;--panel:#16161f;--panel2:#1c1c27;--line:#2a2a38;--soft:#21212c;
--tx:#ececf2;--tx2:#a9a9bb;--tx3:#6e6e84;--ac:#a855f7;--good:#34d399;--warn:#fbbf24;--bad:#f87171;
--mono:'SFMono-Regular',Consolas,Menlo,monospace;--sans:'Pretendard',-apple-system,'Segoe UI','Malgun Gothic',sans-serif}
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(1100px 600px at 12% -8%,rgba(99,102,241,.16),transparent 60%),radial-gradient(900px 500px at 92% 4%,rgba(168,85,247,.13),transparent 62%),var(--bg);color:var(--tx);font-family:var(--sans);line-height:1.7;-webkit-font-smoothing:antialiased}
.wrap{max-width:1080px;margin:0 auto;padding:0 22px 90px}
header.top{padding:62px 0 34px;border-bottom:1px solid var(--line)}
.eyebrow{display:inline-block;font-size:11.5px;font-weight:800;letter-spacing:.11em;color:#ddd0ff;text-transform:uppercase;background:linear-gradient(135deg,rgba(99,102,241,.24),rgba(168,85,247,.28));border:1px solid rgba(168,85,247,.45);padding:6px 13px;border-radius:999px}
h1{font-size:clamp(1.9rem,1.1rem+3vw,3rem);line-height:1.15;letter-spacing:-.035em;margin:20px 0 0;font-weight:800}
h1 em{font-style:normal;background:linear-gradient(100deg,#c4b5fd,#f0abfc);-webkit-background-clip:text;background-clip:text;color:transparent}
.sub{color:var(--tx2);font-size:16px;max-width:64ch;margin:16px 0 0}
.meta{margin-top:20px;font-size:12px;color:var(--tx3);font-family:var(--mono)}
section{padding-top:56px}
.sh{display:flex;align-items:baseline;gap:13px;margin-bottom:6px;flex-wrap:wrap}
.sn{font-family:var(--mono);font-size:12px;font-weight:700;color:var(--ac);border:1px solid rgba(168,85,247,.4);padding:3px 9px;border-radius:6px;background:rgba(168,85,247,.09)}
h2{font-size:clamp(1.3rem,1rem+1vw,1.75rem);margin:0;letter-spacing:-.025em;font-weight:800}
.lead{color:var(--tx2);font-size:14.5px;margin:4px 0 24px;max-width:76ch}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.kpi{background:linear-gradient(170deg,var(--panel2),var(--panel));border:1px solid var(--line);border-radius:14px;padding:16px}
.kpi .k{font-size:11.5px;color:var(--tx3);font-weight:700}
.kpi .v{font-size:30px;font-weight:800;letter-spacing:-.04em;margin:6px 0 2px;font-variant-numeric:tabular-nums}
.kpi .v .u{font-size:15px;color:var(--tx3);font-weight:700;margin-left:2px}
.kpi .n{font-size:11.5px;color:var(--tx3);line-height:1.5}
.v.good{color:var(--good)}.v.warn{color:var(--warn)}.v.bad{color:var(--bad)}
.card{background:var(--panel);border:1px solid var(--line);border-radius:13px;padding:20px 22px}
.bar-row{display:grid;grid-template-columns:52px 1fr auto;gap:11px;align-items:center;margin-bottom:7px}
.bl{font-size:12px;font-weight:700;color:var(--tx2);font-variant-numeric:tabular-nums}
.bt{height:22px;background:rgba(255,255,255,.05);border-radius:5px;overflow:hidden}
.bf{height:100%;border-radius:5px;background:linear-gradient(90deg,rgba(99,102,241,.85),rgba(168,85,247,.95))}
.bf.rep{background:linear-gradient(90deg,#059669,#34d399)}
.bv{font-size:11.5px;color:var(--tx3);white-space:nowrap;font-variant-numeric:tabular-nums}
.tw{overflow-x:auto;border:1px solid var(--line);border-radius:13px;background:var(--panel)}
table{border-collapse:collapse;width:100%;min-width:600px;font-size:13px}
th,td{padding:10px 14px;text-align:left;border-bottom:1px solid var(--soft)}
th{background:rgba(255,255,255,.035);font-size:11px;letter-spacing:.05em;color:var(--tx3);font-weight:800;text-transform:uppercase;white-space:nowrap}
tbody tr:last-child td{border-bottom:none}
td.num{font-family:var(--mono);font-variant-numeric:tabular-nums;white-space:nowrap}
a{color:var(--tx2);text-decoration:none}a:hover{color:#d8b4fe;text-decoration:underline}
.pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:800;white-space:nowrap}
.p-bad{background:rgba(248,113,113,.15);color:#fca5a5;border:1px solid rgba(248,113,113,.35)}
.p-warn{background:rgba(251,191,36,.14);color:#fcd34d;border:1px solid rgba(251,191,36,.32)}
.p-good{background:rgba(52,211,153,.14);color:#6ee7b7;border:1px solid rgba(52,211,153,.32)}
.rx{background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--sev,var(--ac));border-radius:13px;padding:19px 22px;margin-bottom:11px}
.rx h3{margin:0;font-size:16.5px;letter-spacing:-.02em}
.rx p{margin:9px 0 0;color:var(--tx2);font-size:14px}
.rx .why{margin-top:9px;font-size:12.5px;color:var(--tx3);border-left:2px solid rgba(168,85,247,.5);padding-left:11px}
.rx code,.mono{font-family:var(--mono);font-size:12px;color:#d8b4fe}
.note{margin-top:22px;padding:16px 18px;border-radius:11px;background:rgba(251,191,36,.06);border:1px solid rgba(251,191,36,.26);font-size:13px;color:#e6d8b4}
.note b{color:#fcd34d}
.note.ok{background:rgba(52,211,153,.06);border-color:rgba(52,211,153,.28);color:#c8f0e0}
.note.ok b{color:#6ee7b7}
footer{margin-top:64px;padding-top:22px;border-top:1px solid var(--line);font-size:12px;color:var(--tx3);font-family:var(--mono)}
@media(max-width:900px){.kpis{grid-template-columns:repeat(2,1fr)}header.top{padding-top:40px}}
</style>
<div class="wrap">

<header class="top">
  <span class="eyebrow">Threads Analytics · 실측</span>
  <h1>${ins ? `조회수는 시간대가 흔들고<br><em>댓글은 글 구조가 결정합니다</em>` : `볼트 품질 진단`}</h1>
  <p class="sub">공식 API로 회수한 게시물 성과와, 두 글쓰기 문서의 규칙으로 볼트 ${m.audit.total}건을 정적 검사한 결과입니다.</p>
  <div class="meta">생성 ${new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ')} KST ${ins ? `· @${esc(ins.username)} 최근 ${ins.rows.length}건` : '· 오프라인 모드'}</div>
</header>

${ins ? `
<section>
  <div class="sh"><span class="sn">01</span><h2>실측 성과</h2></div>
  <p class="lead">공식 Threads Graph API <span class="mono">/insights</span> 회수값. 브라우저로 올린 글도 같은 계정이라 함께 잡힙니다.</p>
  <div class="kpis">
    ${kpi('누적 조회', ins.totals.views.toLocaleString(), '회', `게시물 ${ins.rows.length}건 합계`)}
    ${kpi('게시물당 평균 조회', Math.round(ins.totals.views / (ins.rows.length || 1)).toLocaleString(), '회', '전체 평균')}
    ${kpi('누적 댓글', ins.totals.replies, '개', `평균 ${(ins.totals.replies / (ins.rows.length || 1)).toFixed(1)}개/글`)}
    ${kpi('최고 댓글률', ins.withRate[0]?.replyRate ?? 0, '%', `최저 ${ins.withRate.at(-1)?.replyRate ?? 0}% · ${(ins.withRate[0]?.replyRate / Math.max(ins.withRate.at(-1)?.replyRate, 0.1)).toFixed(0)}배 차이`, 'good')}
  </div>
</section>

<section>
  <div class="sh"><span class="sn">02</span><h2>시간대별 평균 조회 (KST)</h2></div>
  <p class="lead">표본이 ${ins.rows.length}건뿐이라 아직 결론이 아닙니다. 발행 30건이 쌓이면 다시 보세요.</p>
  <div class="card">
    ${byHour.map(b => `<div class="bar-row">
      <span class="bl">${String(b.hour).padStart(2, '0')}시</span>
      <div class="bt"><div class="bf" style="width:${Math.round(b.avgViews / maxAvg * 100)}%"></div></div>
      <span class="bv">${b.avgViews.toLocaleString()}회 · 댓글 ${b.avgReplies} · ${b.posts}건</span>
    </div>`).join('')}
  </div>
</section>

<section>
  <div class="sh"><span class="sn">03</span><h2>댓글률 순위 — 무엇이 댓글을 부르는가</h2></div>
  <p class="lead">조회수가 아니라 <b>조회 대비 댓글 비율</b>로 세운 순위입니다. 상위와 하위의 글 성격을 비교해 보세요.</p>
  <div class="card" style="margin-bottom:13px">
    ${ins.withRate.map(r => `<div class="bar-row">
      <span class="bl">${r.replyRate}%</span>
      <div class="bt"><div class="bf rep" style="width:${Math.round(r.replyRate / maxReply * 100)}%"></div></div>
      <span class="bv">조회 ${r.views.toLocaleString()} · 댓글 ${r.replies}</span>
    </div>`).join('')}
  </div>
  <div class="tw"><table>
    <thead><tr><th>발행(KST)</th><th>조회</th><th>좋아요</th><th>댓글</th><th>댓글률</th><th>첫 줄</th></tr></thead>
    <tbody>${ins.withRate.map(r => `<tr>
      <td class="num">${kst(r.timestamp)}</td>
      <td class="num"><b>${r.views.toLocaleString()}</b></td>
      <td class="num">${r.likes}</td>
      <td class="num">${r.replies}</td>
      <td class="num"><span class="pill ${r.replyRate >= 5 ? 'p-good' : r.replyRate >= 2 ? 'p-warn' : 'p-bad'}">${r.replyRate}%</span></td>
      <td><a href="${esc(r.permalink)}" target="_blank" rel="noopener">${esc(r.text) || '(본문 없음)'}</a></td>
    </tr>`).join('')}</tbody>
  </table></div>
</section>
` : ''}

<section>
  <div class="sh"><span class="sn">${ins ? '04' : '01'}</span><h2>볼트 품질 진단</h2></div>
  <p class="lead">
    <span class="mono">2026-07-26_리뷰-사람처럼-작성하기.md</span>의 AI 문체 감별 3종과
    <span class="mono">2026-07-20_스레드_조회수를_높이는_7단계.md</span>의 댓글 유도 규칙을 코드로 옮겨
    볼트 ${m.audit.total}건 전체를 검사했습니다. LLM을 부르지 않아 비용은 0입니다.
  </p>
  <div class="kpis">
    ${kpi('평균 점수', m.audit.avg, '점', '100점 만점', m.audit.avg >= 90 ? 'good' : m.audit.avg >= 70 ? 'warn' : 'bad')}
    ${kpi('무결점', m.perfect, '건', `전체 ${m.audit.total}건 중`, 'good')}
    ${kpi('손볼 글', m.fixable.length, '건', '한 곳 이상 걸림', m.fixable.length ? 'warn' : 'good')}
    ${kpi('AI 문형 검출', m.audit.byType.ai_pattern || 0, '건', '"A가 아니라 B" 류', (m.audit.byType.ai_pattern || 0) ? 'bad' : 'good')}
  </div>

  <div style="height:13px"></div>
  <div class="tw"><table>
    <thead><tr><th>문제 유형</th><th>건수</th><th>고치는 법</th></tr></thead>
    <tbody>${Object.entries(m.audit.byType).sort((a, b) => b[1] - a[1]).map(([t, n]) => `<tr>
      <td><b>${FLAG_LABEL[t] || t}</b></td>
      <td class="num">${n}건</td>
      <td style="color:var(--tx2)">${esc({
        ai_pattern: '"A는 B가 아니라 C다" 문형과 <선언>형 마무리를 지운다.',
        abstract_word: '품격·새로운 기준 같은 추상어를 구체적인 환상·돈·시간으로 바꾼다.',
        short_run: '20자 미만 문장이 3개 이상 이어진다. 같은 대상을 가리키는 문장을 한 문장으로 합친다.',
        ending_repeat: '한 어미가 60% 넘게 반복된다. ~죠 / ~더라고요 / ~네요를 섞는다.',
        no_question: '마지막 줄을 답하기 쉬운 질문으로 닫는다. 댓글이 붙어야 추천 피드가 돈다.'
      }[t] || '')}</td>
    </tr>`).join('') || '<tr><td colspan="3">검출된 문제 없음</td></tr>'}</tbody>
  </table></div>
</section>

${m.fixable.length ? `
<section>
  <div class="sh"><span class="sn">${ins ? '05' : '02'}</span><h2>먼저 손볼 글 ${Math.min(m.fixable.length, 15)}건</h2></div>
  <p class="lead">점수가 낮은 순입니다. 발행 전에 이것부터 고치면 같은 노력으로 댓글이 더 붙습니다.</p>
  <div class="tw"><table>
    <thead><tr><th>점수</th><th>훅</th><th>첫 줄</th><th>걸린 항목</th></tr></thead>
    <tbody>${m.fixable.slice(0, 15).map(p => `<tr>
      <td class="num"><span class="pill ${p.score < 70 ? 'p-bad' : 'p-warn'}">${p.score}점</span></td>
      <td>${esc(p.hookType || '-')}</td>
      <td style="color:var(--tx2)">${esc(p.postText.split('\n')[0].slice(0, 42))}</td>
      <td style="color:var(--tx3);font-size:12px">${p.flags.map(f => esc(FLAG_LABEL[f.type] || f.type)).join(' · ')}</td>
    </tr>`).join('')}</tbody>
  </table></div>
</section>` : ''}

<section>
  <div class="sh"><span class="sn">${ins ? '06' : '03'}</span><h2>지금 할 것</h2></div>
  <p class="lead">위 수치에서 바로 이어지는 행동만 적었습니다.</p>

  <div class="rx" style="--sev:#f87171">
    <h3>1 · 손볼 글 ${m.fixable.length}건을 고치고 발행 대기열에 올린다</h3>
    <p>새로 생성하지 마세요. 이미 있는 볼트 ${m.audit.total}건 중 ${m.perfect}건은 손댈 곳이 없습니다. 오늘 바로 나갈 수 있습니다.</p>
    <div class="why">근거 — 볼트 평균 ${m.audit.avg}점. 생성이 아니라 발행이 병목입니다.</div>
  </div>

  <div class="rx" style="--sev:#fbbf24">
    <h3>2 · 발행 전 <code>scorePost()</code>를 통과시킨다</h3>
    <p>생성기(<code>story_writer</code> · <code>vault_generator</code>)에 규칙을 넣었고, AI 문형이 잡히면 자동으로 폐기됩니다. 수동으로 쓴 글은 <code>node scripts/post_quality.mjs --selftest</code> 옆의 <code>scorePost</code>로 확인하세요.</p>
    <div class="why">근거 — 문서의 Before(AI) 예문 45점 / After(사람) 예문 100점으로 갈립니다.</div>
  </div>

  <div class="rx" style="--sev:#a855f7">
    <h3>3 · 매주 이 대시보드를 다시 만든다</h3>
    <p><code>node scripts/build_dashboard.mjs</code> 한 줄이면 최신 실측으로 갱신됩니다. 감이 아니라 이 숫자를 기준으로 판단하세요.</p>
    <div class="why">근거 — 지난번 "새벽 발행이 문제"라는 추측이 실측 한 번에 뒤집혔습니다.</div>
  </div>
</section>

<footer>
  생성 · scripts/build_dashboard.mjs · 검사 규칙 scripts/post_quality.mjs<br>
  근거 문서 · 2026-07-20_스레드_조회수를_높이는_7단계_AI_글쓰기_구조.md · 2026-07-26_리뷰-사람처럼-작성하기.md
</footer>
</div>`;
}

export async function build({ offline = false } = {}) {
  const vault = JSON.parse(fs.readFileSync(path.join(rootDir, 'content_vault.json'), 'utf8'));
  let insights = null;
  if (!offline) {
    try {
      insights = await fetchPostInsights({ limit: 25 });
    } catch (e) {
      console.warn(`⚠️ 실측 회수 실패, 볼트 진단만 넣습니다: ${e.message}`);
    }
  }
  const model = buildModel({ insights, vault });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, render(model), 'utf8');
  return { out: OUT, model };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--selftest')) {
    const { strict: assert } = await import('assert');
    const m = buildModel({
      vault: {
        0: { hookType: '고백', postText: '이것은 소비가 아니라 투자입니다.' },
        1: { hookType: '밸런스', postText: '어제 장 보고 왔어요.\n두부값 다들 어떠세요? 🥲\n\n#장보기' }
      },
      insights: {
        username: 't', byHour: [],
        rows: [
          { timestamp: '2026-09-05T23:00:00+0000', views: 100, likes: 3, replies: 10, text: 'a', permalink: '#' },
          { timestamp: '2026-09-06T23:00:00+0000', views: 200, likes: 5, replies: 2, text: 'b', permalink: '#' }
        ]
      }
    });
    assert.equal(m.audit.total, 2);
    assert.equal(m.perfect, 1, '정상 글 1건이 무결점으로 안 잡힘');
    assert.equal(m.fixable.length, 1);
    assert.equal(m.insights.withRate[0].replyRate, 10, '댓글률 내림차순 정렬 실패');
    assert.equal(m.insights.totals.views, 300);
    // 오프라인 모델도 깨지지 않아야 한다
    assert.equal(buildModel({ vault: {}, insights: null }).insights, null);
    // 렌더 결과에 스크립트 주입이 새지 않는지
    const html = render(buildModel({ vault: { 0: { hookType: '<script>', postText: '테스트 <b>x</b> 인가요?' } }, insights: null }));
    assert.ok(!html.includes('<script>'), 'HTML 이스케이프 누락');
    console.log('✅ build_dashboard selftest 통과');
  } else {
    const { out, model } = await build({ offline: process.argv.includes('--offline') });
    console.log(`✅ ${path.relative(rootDir, out)} 생성`);
    console.log(`   볼트 ${model.audit.total}건 · 평균 ${model.audit.avg}점 · 손볼 글 ${model.fixable.length}건`);
    if (model.insights) console.log(`   실측 ${model.insights.rows.length}건 · 누적 조회 ${model.insights.totals.views.toLocaleString()}회`);
  }
}
