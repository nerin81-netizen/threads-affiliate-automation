/**
 * 콘텐츠 볼트 생성기 — 사람이 쓴 것처럼, 거짓말은 없이
 *
 *   node scripts/vault_generator.mjs --demo      # 검출기 자체검증 (네트워크 불필요)
 *   node scripts/vault_generator.mjs --dry       # 생성만 하고 저장 안 함
 *   node scripts/vault_generator.mjs             # 생성 후 content_vault.json 병합
 *
 * 왜 이렇게 쓰는가:
 * AI에게 그냥 "절약 꿀팁 써줘" 하면 "알뜰폰 바꿔서 57만원 아꼈습니다" 같은 글을 쓴다.
 * 겪지도 않은 성과를 1인칭으로 주장하는 것이라, 댓글로 "어디서 바꾸셨어요?" 물어오면
 * 답할 수가 없다. 제휴 계정에서 이건 신뢰를 깎는다.
 *
 * 해법은 시점을 나누는 것이다.
 *   - 검증 가능한 사실(금액·브랜드·성과)  → 3인칭 전언체 "~한다더라고요"
 *   - 감정·망설임·귀찮음·일상 체감        → 1인칭 허용
 * 감정은 지어내도 아무에게도 거짓 정보를 주지 않는다. 막아야 할 건 "성과 주장"뿐이다.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import dotenv from 'dotenv';
import { personaPrompt } from './persona.mjs';
import { findAiTells, WRITING_RULES } from './post_quality.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(rootDir, '.env') });

const VAULT_FILE = path.join(rootDir, 'content_vault.json');
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

// 계획서 §1 기준: 성장일기 37% → 15%로 낮추고 그 자리를 꿀팁·일상·밸런스로 채운다.
// 맞팔 유도 글은 유령 팔로워를 불러 참여율을 떨어뜨린다.
const TARGET_MIX = {
  꿀팁정보: 25,
  일상공감: 25,
  밸런스게임: 20,
  마인드셋: 15,
  성장일기: 15
};

const CATEGORY_BRIEF = {
  꿀팁정보: '생활비·소비 관련 실용 정보. 사실은 반드시 전언체로.',
  일상공감: '소비하며 겪는 사소한 감정과 망설임. 정보보다 공감.',
  밸런스게임: 'A vs B 양자택일 질문. 댓글에 알파벳 하나만 남기면 되도록.',
  마인드셋: '돈과 소비에 대한 관점. 훈계조 금지, 혼잣말처럼.',
  성장일기: '스레드 소통·맞팔 이야기. 스하리/반하리/스친 은어 사용.'
};

const POV_RULE = `너는 한국 스레드(Threads) 계정 운영자다. 생활 소비·절약·가성비 주제로 글을 쓴다.

[시점 규칙 — 가장 중요]
절대 금지: 내가 무엇을 해서 얼마를 아꼈다/벌었다/줄였다는 성과 주장.
  (X) "알뜰폰 바꿔서 1년에 57만원 아꼈어요"
  (X) "제가 써보니 이게 제일 좋더라고요"
  → 댓글로 "어디서요?" 물어오면 답할 수 없는 글이라 신뢰를 깎는다.

사실은 3인칭 전언체로 돌린다.
  (O) "알뜰폰 넘어가면 만 몇천원선까지 준다더라고요"
  (O) "아는 사람은 배달앱 지우고 식비 꽤 아꼈다던데"

1인칭은 감정·망설임·귀찮음·일상 체감까지 허용한다.
  (O) "저는 몇 년째 밍기적거리는 중이에요"
  (O) "장바구니 몇 개 안 담았는데 금액 보고 놀랐어요"
  (O) "저만 그런가요 ㅋㅋ"

[문장 규칙 — 사람이 쓴 것처럼]
- 숫자는 어중간하게. "3만 8천원쯤", "한 5만원 넘게". 딱 떨어지는 수치 금지.
- 교훈이나 결론으로 마무리하지 마라. 질문으로 툭 던지고 끝낸다.
- 구어체 허용: ㅋㅋ, 말줄임(...), "아 진짜", "실화인가요"
- 180~330자. 문단 사이 빈 줄. 이모지 2~3개.
- 마지막 줄에 해시태그 3~4개.
- 훅 유형을 서로 다르게: 밸런스 / 고백 / 역설 / 숫자 / 빈칸 / 리스트 / 논쟁

${WRITING_RULES}`;

// ---------- 성과 주장 검출기 ----------
const FIRST_PERSON = /(저는|제가|나는|내가|저도|제)/;
const GAIN_VERB = /(아꼈|아꼈어|절약했|절약해|벌었|굳었|줄였|세이브|이득봤|덕봤)/;
const REVIEW_CLAIM = /(써보니|써봤는데|사봤는데|먹어봤는데|바꿔보니|해보니까|경험상)/;

/**
 * 성과 주장이 섞였는지 본다. 완화 기준이라 "장바구니가 비쌌다" 같은
 * 일상 체감은 통과시키고, "내가 얼마를 아꼈다" 류만 잡는다.
 */
export function findFabrication(text) {
  const hits = [];
  for (const sentence of String(text).split(/(?<=[.!?…\n])/)) {
    const s = sentence.trim();
    if (!s) continue;
    // 전언체로 끝나면 남의 얘기다. 1인칭 성과 주장이 아니다.
    const isHearsay = /(다더라|다던데|대요|다고 하|한대|낫대|준대|라던데|답니다)/.test(s);
    if (isHearsay) continue;
    if (FIRST_PERSON.test(s) && GAIN_VERB.test(s)) hits.push({ type: '성과주장', sentence: s });
    else if (GAIN_VERB.test(s) && /\d/.test(s)) hits.push({ type: '성과주장', sentence: s });
    else if (FIRST_PERSON.test(s) && REVIEW_CLAIM.test(s)) hits.push({ type: '사용후기', sentence: s });
  }
  return hits;
}

// ---------- 생성 ----------
async function generateBatch(category, count, avoidTexts) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY 가 .env 에 없습니다.');

  const avoid = avoidTexts.slice(-25).map(t => `- ${t.slice(0, 40)}`).join('\n');
  const persona = personaPrompt();
  const body = {
    systemInstruction: { parts: [{ text: persona ? persona + String.fromCharCode(10,10) + POV_RULE : POV_RULE }] },
    contents: [{ role: 'user', parts: [{ text:
      `카테고리: ${category}\n방향: ${CATEGORY_BRIEF[category]}\n개수: ${count}개\n\n` +
      `[이미 쓴 글 — 소재가 겹치면 안 됨]\n${avoid || '(없음)'}` }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: { posts: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
          hookType: { type: 'STRING' },
          postText: { type: 'STRING' },
          tags: { type: 'ARRAY', items: { type: 'STRING' } }
        }, required: ['hookType', 'postText', 'tags'] } } },
        required: ['posts']
      }
    }
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  const data = await res.json();
  if (data.error) throw new Error(`Gemini 오류: ${data.error.message}`);
  const text = data.candidates?.[0]?.content?.parts?.find(p => p.text)?.text;
  if (!text) throw new Error('응답에 본문이 없습니다.');
  return {
    posts: JSON.parse(text).posts || [],
    tokens: data.usageMetadata?.totalTokenCount || 0
  };
}

function demo() {
  const cases = [
    ['알뜰폰 바꿔서 1년에 57만원 아꼈어요', 1, '1인칭 성과 주장'],
    ['제가 써보니 이게 제일 낫더라고요', 1, '사용 후기 주장'],
    ['알뜰폰 넘어가면 만 몇천원까지 준다더라고요', 0, '전언체 사실'],
    ['아는 사람은 배달앱 지우고 식비 아꼈다던데', 0, '전언체 성과'],
    ['장바구니 몇 개 안 담았는데 2만원 넘게 나왔어요', 0, '일상 체감(완화 허용)'],
    ['저는 몇 년째 밍기적거리는 중이에요 ㅋㅋ', 0, '감정']
  ];
  let failed = 0;
  for (const [text, expected, label] of cases) {
    const got = findFabrication(text).length;
    const ok = (got > 0) === (expected > 0);
    if (!ok) failed++;
    console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(20)} → ${got ? '검출' : '통과'}`);
  }
  console.assert(failed === 0, `검출기 실패 ${failed}건`);
  if (failed === 0) console.log('\nself-check 통과 — 성과 주장만 잡고 일상 체감은 통과');
  return failed === 0;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--demo')) return void demo();
  const dryRun = args.includes('--dry');

  // 기존 볼트에서 고유 본문만 남긴다. 100건이지만 실제 고유 본문은 14종뿐이다.
  const existing = fs.existsSync(VAULT_FILE) ? Object.values(JSON.parse(fs.readFileSync(VAULT_FILE, 'utf-8'))) : [];
  const seen = new Set();
  const kept = existing.filter(item => {
    const fp = (item.postText || '').replace(/\s+/g, ' ').trim();
    if (!fp || seen.has(fp)) return false;
    seen.add(fp);
    return true;
  });
  console.log(`기존 볼트 ${existing.length}건 → 고유 ${kept.length}건 유지`);

  const keptByCat = {};
  kept.forEach(i => { keptByCat[i.category] = (keptByCat[i.category] || 0) + 1; });

  const generated = [];
  const avoidTexts = kept.map(i => i.postText);
  let totalTokens = 0;

  for (const [category, target] of Object.entries(TARGET_MIX)) {
    let need = target - (keptByCat[category] || 0);
    if (need <= 0) { console.log(`  ${category}: 이미 ${keptByCat[category]}건 — 생성 없음`); continue; }
    console.log(`  ${category}: ${need}건 생성 중...`);

    while (need > 0) {
      const batch = Math.min(5, need);
      const { posts, tokens } = await generateBatch(category, batch, avoidTexts);
      totalTokens += tokens;

      for (const post of posts) {
        const hits = [...findFabrication(post.postText), ...findAiTells(post.postText)];
        if (hits.length) {
          console.log(`    ⚠️ 폐기(${hits[0].type}): ${hits[0].sentence.slice(0, 34)}…`);
          continue;
        }
        const fp = post.postText.replace(/\s+/g, ' ').trim();
        if (seen.has(fp)) continue;
        seen.add(fp);
        avoidTexts.push(post.postText);
        generated.push({ category, hookType: post.hookType, postText: post.postText, tags: post.tags });
        need--;
        if (need <= 0) break;
      }
    }
  }

  console.log(`\n생성 ${generated.length}건 · 총 ${totalTokens.toLocaleString()} 토큰`);
  if (dryRun) {
    console.log('\n--dry 모드: 저장하지 않습니다. 샘플 2건:');
    generated.slice(0, 2).forEach(p => console.log(`\n[${p.category}/${p.hookType}]\n${p.postText}`));
    return;
  }

  // 원본을 먼저 백업한다. 되돌릴 길 없이 덮어쓰지 않는다.
  const backup = `${VAULT_FILE}.${new Date().toISOString().slice(0, 10)}.bak`;
  if (fs.existsSync(VAULT_FILE)) fs.copyFileSync(VAULT_FILE, backup);

  const merged = [...kept, ...generated].map((item, i) => ({
    id: item.id || `content_${Date.now()}_${i}`,
    index: i + 1,
    category: item.category,
    hookType: item.hookType || null,
    postText: item.postText,
    tags: item.tags || [],
    status: item.status || 'READY',
    postedAt: item.postedAt || null
  }));

  fs.writeFileSync(VAULT_FILE, JSON.stringify({ ...merged }, null, 2), 'utf-8');
  const finalMix = {};
  merged.forEach(m => { finalMix[m.category] = (finalMix[m.category] || 0) + 1; });
  console.log(`\n✅ 볼트 ${merged.length}건 저장 (백업: ${path.basename(backup)})`);
  console.log('   구성:', JSON.stringify(finalMix));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(`실패: ${e.message}`); process.exit(1); });
}
