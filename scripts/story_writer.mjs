/**
 * 검색어 기반 스토리텔링 게시물 작성기
 *
 *   node scripts/story_writer.mjs 가성비,핫딜,쿠폰 --count=10
 *
 * 볼트 글은 "정보 + 질문" 구조라 읽고 넘기기 쉽다. 스크롤을 멈추게 하는 건
 * 정보가 아니라 장면이다. 그래서 여기서는 이야기 골격을 강제한다.
 *
 *   장면 → 사소한 갈등 → 전환 → 여운을 남긴 질문
 *
 * 시점 규칙은 vault_generator 와 같다. 겪지도 않은 성과를 1인칭으로 주장하면
 * 댓글로 "어디서요?" 물어왔을 때 답할 수 없어 계정 신뢰가 깎인다.
 */
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import dotenv from 'dotenv';
import { findFabrication } from './vault_generator.mjs';
import { personaPrompt } from './persona.mjs';
import { findAiTells, WRITING_RULES } from './post_quality.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(rootDir, '.env') });

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

const STORY_RULE = `너는 한국 스레드(Threads) 계정 운영자다. 생활 소비·절약·가성비 주제로 글을 쓴다.

[이야기 골격 — 반드시 지킬 것]
정보를 나열하지 마라. 장면을 보여줘라. 네 단으로 쓴다.
1) 장면: 언제 어디서 무슨 일이 있었는지 구체적으로. ("퇴근길 편의점에서", "새벽 2시에 장바구니 열어놓고")
2) 갈등: 그때 마음속에서 부딪힌 사소한 모순. (사고 싶은데 아깝다, 알면서도 또 그런다)
3) 전환: 예상과 어긋난 지점이나 문득 든 생각. 교훈으로 정리하지 마라.
4) 질문: 답하기 쉬운 한 줄로 닫는다.

[시점 규칙 — 어기면 글을 버린다]
절대 금지: 내가 무엇을 해서 얼마를 아꼈다/벌었다/줄였다는 성과 주장.
  (X) "알뜰폰 바꿔서 1년에 57만원 아꼈어요"
  (X) "제가 써보니 이게 제일 좋더라고요"
사실은 3인칭 전언체로 돌린다.
  (O) "요즘 그거 만 몇천원대까지 내려간다더라고요"
1인칭은 감정·망설임·귀찮음·일상 체감까지만 허용한다.
  (O) "저는 몇 년째 밍기적거리는 중이에요"
  (O) "장바구니 몇 개 안 담았는데 금액 보고 멈칫했어요"

[문장 규칙]
- 숫자는 어중간하게. "3만 8천원쯤", "한 5만원 넘게". 딱 떨어지는 수치 금지.
- 교훈·정리·요약으로 끝내지 마라. 여운을 남기고 질문으로 툭 던진다.
- 구어체 허용: ㅋㅋ, 말줄임(...), "아 진짜", "실화인가요"
- 200~330자. 문단 사이 빈 줄. 이모지 2~3개.
- 마지막 줄에 해시태그 3~4개. 주어진 검색어 관련 태그를 1개 이상 포함.
- 광고 문구, 구매 유도, 링크 금지.

${WRITING_RULES}

[카드 문구]
- cardTitle: 16자 이내. 글의 장면이나 갈등을 한 문장으로. 요약이 아니라 훅.
- cardSubtitle: 28자 이내 보조 한 줄.
- cardBadge: 6~12자 영문 대문자 라벨.`;

/** 검색어 목록으로 스토리텔링 게시물을 만든다. 성과 주장이 섞인 글은 버린다. */
export async function writeStoryPosts(keywords, count = 10) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY 가 .env 에 없습니다.');
  if (!keywords.length) throw new Error('검색어가 비어 있습니다.');

  const accepted = [];
  const rejected = [];
  const written = [];
  let tokens = 0;
  let rounds = 0;

  // 한 번에 다 요구하면 뒤로 갈수록 글이 비슷해진다. 5개씩 나눠 받고
  // 이미 쓴 글을 넘겨 소재가 겹치지 않게 한다.
  while (accepted.length < count && rounds < 5) {
    rounds++;
    const need = Math.min(5, count - accepted.length);
    // 페르소나를 맨 앞에 둔다. 뒤에 두면 문장 규칙에 밀려 20대 자취생 톤으로 새어나간다.
    const persona = personaPrompt();
    const system = persona ? `${persona}\n\n${STORY_RULE}` : STORY_RULE;

    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text:
        `검색어: ${keywords.join(', ')}\n개수: ${need}개\n` +
        `검색어를 골고루 나눠 쓰고, 서로 다른 장면·시간대·감정으로 써라.\n\n` +
        `[이미 쓴 글 — 장면이 겹치면 안 됨]\n${written.map(t => `- ${t.slice(0, 40)}`).join('\n') || '(없음)'}` }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: { posts: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
            keyword: { type: 'STRING' },
            scene: { type: 'STRING' },
            cardBadge: { type: 'STRING' },
            cardTitle: { type: 'STRING' },
            cardSubtitle: { type: 'STRING' },
            postText: { type: 'STRING' }
          }, required: ['keyword', 'scene', 'cardBadge', 'cardTitle', 'cardSubtitle', 'postText'] } } },
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
    tokens += data.usageMetadata?.totalTokenCount || 0;

    const text = data.candidates?.[0]?.content?.parts?.find(p => p.text)?.text;
    if (!text) break;

    for (const post of JSON.parse(text).posts || []) {
      if (accepted.length >= count) break;
      // 성과 주장 + AI 문체 지문을 같은 자리에서 걸러낸다.
      const hits = [...findFabrication(post.postText), ...findAiTells(post.postText)];
      if (hits.length) {
        rejected.push({ reason: hits[0].type, sentence: hits[0].sentence });
        continue;
      }
      written.push(post.postText);
      accepted.push(post);
    }
  }

  return { posts: accepted, rejected, tokens };
}

async function main() {
  const args = process.argv.slice(2);
  const keywords = (args.find(a => !a.startsWith('--')) || '가성비,핫딜,쿠폰,선물,특가')
    .split(',').map(s => s.trim()).filter(Boolean);
  const count = Number(args.find(a => a.startsWith('--count='))?.split('=')[1]) || 10;

  console.log(`🔎 검색어: ${keywords.join(', ')} / ${count}건 작성 중...`);
  const { posts, rejected, tokens } = await writeStoryPosts(keywords, count);

  posts.forEach((p, i) => {
    console.log(`\n──── ${i + 1}. [${p.keyword}] ${p.cardTitle} ────`);
    console.log(`장면: ${p.scene}`);
    console.log(p.postText);
  });
  if (rejected.length) {
    console.log(`\n폐기 ${rejected.length}건:`);
    rejected.forEach(r => console.log(`  ⚠️ ${r.reason}: ${r.sentence.slice(0, 40)}…`));
  }
  console.log(`\n완료 ${posts.length}건 · ${tokens.toLocaleString()} 토큰`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(`실패: ${e.message}`); process.exit(1); });
}
