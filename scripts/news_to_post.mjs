/**
 * 검색어 → 뉴스 → 게시물 초안 파이프라인
 *
 *   node scripts/news_to_post.mjs 가성비
 *   node scripts/news_to_post.mjs 핫딜 --theme=ember
 *
 * 뉴스에서 가져오는 것은 "텍스트"뿐이다. 뉴스 이미지는 대부분 통신사 라이선스라
 * 재업로드하면 저작권 침해다. 카드는 card_render 로 직접 그린다.
 *
 * 본문은 뉴스 요약이 아니다. 사람들은 스레드에 뉴스를 읽으러 오지 않는다.
 * 뉴스는 훅으로만 쓰고 본문은 "내 반응 + 질문"으로 간다.
 *
 * 발행은 하지 않는다. 초안을 만들어 두면 대시보드 [게시물 발행]에서 확인 후 올린다.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import dotenv from 'dotenv';
import { renderCard } from './card_render.mjs';
import { personaPrompt } from './persona.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(rootDir, '.env') });

const DRAFT_DIR = path.join(rootDir, 'drafts');
const NEWS_ENDPOINT = 'https://naverapihub.apigw.ntruss.com/search/v1/news';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

const stripTags = (s = '') => String(s)
  .replace(/<[^>]*>/g, '')
  .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ').trim();

/** 네이버 뉴스 검색. 같은 사건 중복을 줄이려 언론사(originallink 호스트)당 1건만 남긴다. */
export async function searchNews(keyword, count = 12) {
  const id = process.env.NAVER_API_HUB_CLIENT_ID;
  const secret = process.env.NAVER_API_HUB_CLIENT_SECRET;
  if (!id || !secret) throw new Error('NAVER_API_HUB_CLIENT_ID / SECRET 이 .env 에 없습니다.');

  const url = `${NEWS_ENDPOINT}?query=${encodeURIComponent(keyword)}&display=${count * 3}&sort=date&format=json`;
  const res = await fetch(url, {
    headers: { 'X-NCP-APIGW-API-KEY-ID': id, 'X-NCP-APIGW-API-KEY': secret }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`뉴스 검색 실패 (HTTP ${res.status}): ${JSON.stringify(data).slice(0, 200)}`);

  const seen = new Set();
  return (data.items || [])
    .map(item => ({
      title: stripTags(item.title),
      description: stripTags(item.description),
      link: item.originallink || item.link,
      pubDate: item.pubDate
    }))
    .filter(item => {
      let host = '';
      try { host = new URL(item.link).hostname; } catch { host = item.link; }
      if (seen.has(host)) return false;
      seen.add(host);
      return true;
    })
    .slice(0, count);
}

/** 뉴스 목록을 게시물 초안으로 바꾼다. 사실은 뉴스에 있는 것만 쓰도록 강제한다. */
export async function draftFromNews(keyword, articles) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY 가 .env 에 없습니다.');

  const system = `너는 한국 스레드(Threads) 계정 운영자다. 이 계정은 1인 개발자이자 실속 있는 일상을 살아가는 아빠의 시선으로 다음 3가지 핵심 주제를 다룬다:
1. [AI & 테크]: 새로운 생성형 AI 소식, 업무·살림 생산성을 높여주는 AI 도구 트렌드
2. [창업 & 지원금]: 정부지원사업, 청년/1인 기업 지원금, 스타트업 및 소상공인 정책 지원 소식
3. [생활 경제]: 물가, 알뜰 소비 팁, 체감되는 할인 및 핫딜 정보

아래 뉴스 목록에서 위 3가지 핵심 주제 중 하나에 부합하는 기사를 골라 게시물 초안을 만든다.

[소재 선별 — 먼저 판단할 것]
- 다음은 이 계정 주제와 무관하므로 절대 고르지 마라:
  연예인 가십·방송 프로그램 이야기, 스포츠 경기 결과, 운세·점성술,
  단순 정치 공방·선거 비방, 사건사고·범죄, 부고, 특정 종교 이야기.
- [AI 소식], [창업·정부지원 소식], [생활소비·물가 소식] 중 하나와 확실히 이어지는 기사만 고른다.
- 쓸 만한 기사가 하나도 없으면 usable=false 로 두고 skipReason 에 이유를 적어라.
  억지로 고르지 마라. 주제에 안 맞는 글은 안 올리는 게 낫다.

[가장 중요한 규칙]
- 뉴스에 없는 수치·가격·날짜·회사명을 절대 만들어내지 마라. 기사에 있는 표현만 쓴다.
- 확신이 없으면 숫자를 아예 빼고 정성적으로 써라.

[본문 규칙]
- 뉴스 요약을 그대로 옮기지 마라. 뉴스는 첫 두 줄의 '훅'으로만 쓴다.
- 구조: 뉴스 사실 1~2줄 → 내 개인적인 솔직한 생각이나 체감하는 현실 1~2줄 → 답하기 쉬운 질문 1줄
- 180~350자. 문단 사이에 빈 줄을 넣어 여백을 만든다.
- 존댓말, 친근하고 담백한 말투. 훈계나 강의하려 하지 말고 '동료나 이웃에게 말하듯' 쓴다. 이모지는 2~4개만.
- 마지막 줄에 해시태그 3~5개. 검색어 "${keyword}" 관련 태그를 반드시 1개 포함. (예: #생성형AI, #정부지원사업, #1인개발, #생활비절약 등)
- 광고 문구나 구매 유도는 넣지 마라.
- 외부 URL 링크(http/https)는 본문에 절대 넣지 마라.

[카드 규칙]
- cardTitle: 18자 이내. 카드에 크게 박히는 한 문장.
- cardSubtitle: 30자 이내 보조 설명.
- cardBadge: 6~12자 영문 대문자 라벨 (예: AI TREND, STARTUP BIZ, TODAY NEWS, PRICE WATCH)`;

  const persona = personaPrompt();
  const newsBlock = articles
    .map((a, i) => `${i + 1}. ${a.title}\n   ${a.description}`)
    .join('\n');

  const body = {
    systemInstruction: { parts: [{ text: persona ? `${persona}\n\n${system}` : system }] },
    contents: [{ role: 'user', parts: [{ text: `검색어: ${keyword}\n\n[뉴스 목록]\n${newsBlock}` }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          usable: { type: 'BOOLEAN' },
          skipReason: { type: 'STRING' },
          pickedIndex: { type: 'INTEGER' },
          pickedReason: { type: 'STRING' },
          cardBadge: { type: 'STRING' },
          cardTitle: { type: 'STRING' },
          cardSubtitle: { type: 'STRING' },
          postBody: { type: 'STRING' }
        },
        required: ['usable', 'skipReason', 'pickedIndex', 'pickedReason', 'cardBadge', 'cardTitle', 'cardSubtitle', 'postBody']
      }
    }
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  const data = await res.json();
  if (data.error) throw new Error(`Gemini 오류: ${data.error.message}`);

  const text = data.candidates?.[0]?.content?.parts?.find(p => p.text)?.text;
  if (!text) throw new Error('Gemini 응답에 본문이 없습니다.');
  return JSON.parse(text);
}

/**
 * 본문 내용과 가장 잘 어울리는 실제 뉴스 기사를 네이버 뉴스에서 찾아 반환한다.
 * 1. Gemini로 본문 사건/팩트 검색 키워드 1개 정밀 추출 시도
 * 2. 실패 시 본문 첫 1~2줄에서 핵심 명사 추출
 * 3. 네이버 뉴스 검색 후 본문 단어들과의 유사도(Score)를 계산하여 최고점 기사 반환
 */
export async function findBestMatchingArticle(postBody, fallbackKeyword = '') {
  if (!postBody) return null;

  const key = process.env.GEMINI_API_KEY;
  let searchKeywords = [];

  // 1. Gemini로 본문 사건/사실에 딱 맞는 네이버 뉴스 검색 쿼리 1개 도출
  if (key) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      const prompt = `다음 스레드 게시물 본문의 '핵심 사실/뉴스 사건'과 정확히 일치하는 네이버 뉴스 검색어 1개를 단어 2~3개 조합으로만 작성해라. 다른 설명, 마크다운, 따옴표 없이 검색어 텍스트만 1줄로 출력해라.

[게시물 본문]
${postBody.slice(0, 500)}`;

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
          signal: controller.signal
        }
      );
      clearTimeout(timer);
      const data = await res.json();
      const extracted = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (extracted && extracted.length >= 2 && extracted.length <= 30) {
        searchKeywords.push(extracted.replace(/["'`#]/g, '').trim());
      }
    } catch (e) {
      // 타임아웃이나 오류 시 폴백 로직으로 진행
    }
  }

  // 2. 본문 첫 2줄에서 2글자 이상 명사 조합 추출
  const lines = postBody.split('\n').map(l => l.trim()).filter(Boolean);
  const firstLine = lines[0] || '';
  const cleanFirstLine = firstLine.replace(/#[^\s#]+/g, '').replace(/[^\w가-힣\s]/g, ' ');
  const candidateWords = cleanFirstLine.split(/\s+/).filter(w => w.length >= 2 && !['요즘', '오늘', '생각', '진짜', '정말', '관련', '내용', '이웃', '아이', '일터'].includes(w));
  if (candidateWords.length >= 2) {
    searchKeywords.push(candidateWords.slice(0, 3).join(' '));
  }

  // 3. 해시태그 중 유의미한 키워드
  const tags = (postBody.match(/#[^\s#]+/g) || []).map(t => t.replace('#', ''));
  if (tags.length > 0) {
    searchKeywords.push(tags.slice(0, 2).join(' '));
  }
  if (fallbackKeyword) {
    searchKeywords.push(fallbackKeyword);
  }

  // 중복 제거
  searchKeywords = Array.from(new Set(searchKeywords.filter(k => k && k.length >= 2)));

  // 본문 전체 단어 집합 (유사도 측정용)
  const bodyText = postBody.replace(/#[^\s#]+/g, '').replace(/[^\w가-힣\s]/g, ' ');
  const bodyWords = new Set(bodyText.split(/\s+/).filter(w => w.length >= 2));

  let bestArticle = null;
  let highestScore = -1;

  for (const query of searchKeywords.slice(0, 3)) {
    try {
      const articles = await searchNews(query, 10);
      if (!articles || !articles.length) continue;

      for (const article of articles) {
        let score = 0;
        const titleWords = article.title.replace(/[^\w가-힣\s]/g, ' ').split(/\s+/);
        const descWords = article.description.replace(/[^\w가-힣\s]/g, ' ').split(/\s+/);

        for (const tw of titleWords) {
          if (tw.length >= 2 && bodyWords.has(tw)) score += 3; // 제목 일치 가중치 3
        }
        for (const dw of descWords) {
          if (dw.length >= 2 && bodyWords.has(dw)) score += 1; // 설명 일치 가중치 1
        }

        if (score > highestScore) {
          highestScore = score;
          bestArticle = article;
        }
      }

      // 충분히 유의미한 매칭(점수 4 이상)을 찾았으면 다음 검색어 스킵
      if (highestScore >= 4) break;
    } catch (err) {
      // 다음 검색어로 시도
    }
  }

  return highestScore >= 2 ? bestArticle : null;
}

async function main() {
  const args = process.argv.slice(2);
  const keyword = args.find(a => !a.startsWith('--'));
  if (!keyword) {
    console.error('사용법: node scripts/news_to_post.mjs <검색어> [--theme=night|ember|mint]');
    process.exit(1);
  }
  const theme = (args.find(a => a.startsWith('--theme='))?.split('=')[1]) || 'night';

  console.log(`🔎 "${keyword}" 뉴스 검색 중...`);
  const articles = await searchNews(keyword);
  if (!articles.length) {
    console.error('뉴스를 찾지 못했습니다. 다른 검색어를 시도해 보세요.');
    process.exit(1);
  }
  console.log(`   후보 ${articles.length}건 확보`);
  articles.slice(0, 5).forEach((a, i) => console.log(`   ${i + 1}. ${a.title.slice(0, 46)}`));

  console.log('\n🤖 게시물 초안 생성 중...');
  const draft = await draftFromNews(keyword, articles);

  // 주제에 맞는 기사가 없으면 카드를 그리지 않고 끝낸다.
  // 억지로 만든 글은 광고 계정 학습만 부추긴다.
  if (!draft.usable) {
    console.log(`\n⏭️  이번 검색어는 건너뜁니다.\n   이유: ${draft.skipReason}`);
    console.log('   다른 검색어를 쓰거나, 잠시 후 새 기사로 다시 시도하세요.');
    return;
  }

  const picked = articles[draft.pickedIndex - 1] || articles[0];

  let source = '';
  try { source = new URL(picked.link).hostname.replace(/^www\./, ''); } catch { source = ''; }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const cardPath = await renderCard({
    badge: draft.cardBadge,
    title: draft.cardTitle,
    subtitle: draft.cardSubtitle,
    footer: '자세한 내용은 본문에 👇',
    source,
    theme
  }, path.join(DRAFT_DIR, `${stamp}_${keyword}.png`));

  const draftPath = path.join(DRAFT_DIR, `${stamp}_${keyword}.json`);
  fs.writeFileSync(draftPath, JSON.stringify({
    keyword, createdAt: new Date().toISOString(),
    postBody: draft.postBody,
    card: { ...draft, path: cardPath },
    sourceArticle: picked,
    candidates: articles
  }, null, 2), 'utf-8');

  console.log(`\n📰 선택: ${picked.title}`);
  console.log(`   이유: ${draft.pickedReason}`);
  console.log(`\n──────── 본문 초안 ────────\n${draft.postBody}\n───────────────────────────`);
  console.log(`\n🖼️  카드: ${cardPath}`);
  console.log(`📄 초안: ${draftPath}`);
  console.log('\n대시보드 [게시물 발행]에서 본문을 붙여넣고 카드를 첨부해 발행하세요.');
}

// 경로에 공백·드라이브 문자가 섞이는 Windows에서도 맞도록 pathToFileURL로 비교한다.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(`실패: ${e.message}`); process.exit(1); });
}
