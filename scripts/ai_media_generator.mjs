/**
 * AI 본문 맞춤 미디어(4:5 카드 이미지 및 모션 비디오) 자동 생성기
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { chromium } from 'playwright';
import { renderCard, CARD_WIDTH, CARD_HEIGHT, buildCardHtml } from './card_render.mjs';
import { generateSceneImage, SCENE_STYLES } from './scene_illustrator.mjs';
import { generateMotionVideo, generateVeoVideo, isVeoAvailable } from './video_generator.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(rootDir, '.env') });

const UPLOAD_DIR = path.join(rootDir, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

/** 본문에서 제목과 요약을 추출하는 로컬 폴백 */
function extractLocalSpec(text = '') {
  const clean = text.replace(/#[^\s#]+/g, '').trim();
  const lines = clean.split('\n').map(l => l.trim()).filter(Boolean);
  const firstLine = lines[0] || '스레드 꿀팁 & 일상 이야기';
  const secondLine = lines[1] || '';

  // 테마 추론
  let theme = 'night';
  if (/할인|특가|돈|가격|만원|쿠폰|결제|삼겹살|음식|찜닭/.test(text)) theme = 'ember';
  else if (/건강|선물|부모님|가족|일상|아이들|학원비/.test(text)) theme = 'mint';

  return {
    badge: 'THREADS INSIGHT',
    title: firstLine.length > 28 ? firstLine.slice(0, 26) + '…' : firstLine,
    subtitle: secondLine.length > 36 ? secondLine.slice(0, 34) + '…' : secondLine,
    bullets: lines.length > 2 ? [lines[2].slice(0, 32)] : [],
    footer: '더 많은 이야기는 본문 & 댓글에서 확인 👇',
    theme
  };
}

/** Gemini API를 통해 본문 내용에 최적화된 4:5 카드 문구 도출 */
export async function analyzePostForCard(text = '') {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return extractLocalSpec(text);

  const prompt = `너는 스레드(Threads) 카드뉴스 헤드라인 에디터다.
아래 본문 내용을 읽고, 피드에서 스크롤을 멈추게 할 4:5 카드뉴스용 텍스트를 JSON으로 만들어라.

[본문 내용]
${text.slice(0, 800)}

[반드시 지킬 규칙]
1. title: 18자 이내의 강렬한 한 문장 (본문의 핵심 훅). 절대 20자를 넘기지 마라.
2. subtitle: 28자 이내의 공감되는 보조 설명 또는 상황.
3. badge: 6~12자의 영문 대문자 배지 (예: HOT DEAL, FAMILY STORY, LIFE HACK, MONEY TALK, DAILY LIFE).
4. bullets: 카드 중앙에 들어갈 핵심 문장 1~2개 배열 (각 25자 이내).
5. theme: 'night' (진중/IT/기술/일상), 'ember' (음식/할인/소비/특가), 'mint' (건강/가족/선물/휴식) 중 1개.

JSON 형식으로만 답하라:
{"title": "...", "subtitle": "...", "badge": "...", "bullets": ["..."], "theme": "..."}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.7 }
      })
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
    const parsed = JSON.parse(raw);
    return {
      badge: parsed.badge || 'THREADS STORY',
      title: parsed.title || extractLocalSpec(text).title,
      subtitle: parsed.subtitle || '',
      bullets: Array.isArray(parsed.bullets) ? parsed.bullets.slice(0, 2) : [],
      footer: '당신의 생각은 어떠신가요? 댓글로 들려주세요 👇',
      theme: ['night', 'ember', 'mint'].includes(parsed.theme) ? parsed.theme : 'night'
    };
  } catch (err) {
    console.warn('[AI Card] Gemini 분석 폴백 사용:', err.message);
    return extractLocalSpec(text);
  }
}

/** 글씨 카드(폴백/레거시) 생성 — style='card'일 때 사용 */
async function generateCardImage(text = '') {
  const spec = await analyzePostForCard(text);
  const fileName = `card_ai_${Date.now()}.png`;
  const outPath = path.join(UPLOAD_DIR, fileName);

  await renderCard(spec, outPath);

  const stat = fs.statSync(outPath);
  return {
    success: true,
    fileName,
    filePath: outPath,
    fileSize: stat.size,
    type: 'image',
    style: 'card',
    title: spec.title,
    spec
  };
}

/**
 * 본문 맞춤 이미지 생성.
 * 기본은 스토리텔링 장면 이미지(일본 애니 / 한국 웹툰).
 * style='card'면 레거시 글씨 카드. 장면 생성 실패 시 카드로 자동 폴백.
 * @param {string} text 본문
 * @param {'anime'|'webtoon'|'card'} style
 * @param {string|null} character 고정 캐릭터 id (예: 'yuna'). 지정 시 해당 캐릭터가 주인공.
 * @param {object|null} sceneSpec 프롬프트 추출 화면에서 확정한 공통 장면 설계도
 */
export async function generateAiImage(text = '', style = 'anime', character = null, sceneSpec = null) {
  // 레거시 글씨 카드 명시 요청
  if (style === 'card') return generateCardImage(text);

  // 장면 스타일(anime/webtoon) — 알 수 없는 값은 anime로 처리
  const useStyle = SCENE_STYLES[style] ? style : 'anime';
  try {
    const r = await generateSceneImage(text, useStyle, character, sceneSpec);
    const charName = r.character ? '유나 ' : '';
    return {
      success: true,
      fileName: r.fileName,
      filePath: r.filePath,
      fileSize: r.fileSize,
      type: 'image',
      style: r.style,
      character: r.character,
      title: charName + r.styleLabel + ' 장면',
      spec: { title: charName + r.styleLabel + ' 장면', sceneDesc: r.sceneDesc, sceneSpec: r.sceneSpec, style: r.style, character: r.character, mood: r.mood }
    };
  } catch (err) {
    console.warn('[AI Image] 장면 생성 실패 → 글씨 카드 폴백:', err.message);
    const card = await generateCardImage(text);
    card.fallback = true;
    card.fallbackReason = err.message;
    return card;
  }
}

/** 4:5 글씨 카드 기반 모션 숏폼 (레거시/폴백) — 카드에 줌인 모션을 입혀 녹화 */
async function generateCardMotionVideo(text = '') {
  const spec = await analyzePostForCard(text);
  const tempDir = path.join(UPLOAD_DIR, `temp_rec_${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const finalFileName = `video_ai_${Date.now()}.webm`;
  const finalPath = path.join(UPLOAD_DIR, finalFileName);

  const html = buildCardHtml(spec);

  // 모션 애니메이션 주입 (부드러운 시네마틱 줌인 + 텍스트 페이드)
  const animatedHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { background:#000; overflow:hidden; display:flex; justify-content:center; align-items:center; width:${CARD_WIDTH}px; height:${CARD_HEIGHT}px; }
    .card-wrap {
      animation: zoomMotion 4.2s cubic-bezier(0.25, 1, 0.5, 1) forwards;
      transform-origin: center center;
    }
    @keyframes zoomMotion {
      0% { transform: scale(0.96); filter: brightness(0.92); }
      50% { transform: scale(1.02); filter: brightness(1.04); }
      100% { transform: scale(1.05); filter: brightness(1.0); }
    }
  </style>
</head>
<body>
  <div class="card-wrap">${html}</div>
</body>
</html>`;

  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  try {
    const context = await browser.newContext({
      recordVideo: {
        dir: tempDir,
        size: { width: CARD_WIDTH, height: CARD_HEIGHT }
      },
      viewport: { width: CARD_WIDTH, height: CARD_HEIGHT }
    });

    const page = await context.newPage();
    await page.setContent(animatedHtml, { waitUntil: 'domcontentloaded' });
    // 3.8초간 부드러운 모션 녹화
    await page.waitForTimeout(3800);
    await page.close();
    await context.close();

    // 녹화된 webm 파일 찾기
    const files = fs.readdirSync(tempDir).filter(f => f.endsWith('.webm'));
    if (!files.length) throw new Error('비디오 레코딩 파일 생성 실패');

    const recordedPath = path.join(tempDir, files[0]);
    fs.renameSync(recordedPath, finalPath);
    fs.rmSync(tempDir, { recursive: true, force: true });

    const stat = fs.statSync(finalPath);
    return {
      success: true,
      fileName: finalFileName,
      filePath: finalPath,
      fileSize: stat.size,
      type: 'video',
      mode: 'card-motion',
      spec
    };
  } finally {
    await browser.close();
  }
}

/**
 * 본문 맞춤 AI 숏폼 비디오 생성.
 *
 * 동작 방식:
 *  - style='card'  : 글씨 카드에 줌인 모션 (비용 0)
 *  - style=anime/webtoon:
 *      1) 먼저 장면 이미지를 생성(캐릭터 지정 시 유나 주인공)
 *      2) videoMode='veo'이고 VEO_API_KEY가 있으면 Veo I2V로 실제 움직이는 영상
 *      3) 그 외에는 Ken Burns 모션 영상(비용 0) — 기본값
 *
 * @param {string} text 본문
 * @param {'anime'|'webtoon'|'card'} style
 * @param {string|null} character 고정 캐릭터 id (예: 'yuna')
 * @param {'motion'|'veo'} videoMode 영상화 방식. 기본 'motion'(비용 0)
 * @param {object|null} sceneSpec 프롬프트 추출 화면에서 확정한 공통 장면 설계도
 */
export async function generateAiVideo(text = '', style = 'anime', character = null, videoMode = 'motion', sceneSpec = null) {
  // 레거시 글씨 카드 모션
  if (style === 'card') {
    const r = await generateCardMotionVideo(text);
    return { ...r, style: 'card', character: null, title: '글씨 카드 모션 영상' };
  }

  const useStyle = SCENE_STYLES[style] ? style : 'anime';

  // 1) 장면(또는 유나) 이미지 먼저 생성
  let sceneImg;
  try {
    sceneImg = await generateSceneImage(text, useStyle, character, sceneSpec);
  } catch (err) {
    console.warn('[AI Video] 장면 이미지 생성 실패 → 카드 모션 폴백:', err.message);
    const r = await generateCardMotionVideo(text);
    return { ...r, style: 'card', character: null, fallback: true, fallbackReason: err.message, title: '글씨 카드 모션 영상(폴백)' };
  }

  const charName = sceneImg.character ? '유나 ' : '';

  // 2) Veo 모드 요청 시 (키 있을 때만 실제 동작, 없으면 모션으로 폴백)
  if (videoMode === 'veo') {
    const veo = await generateVeoVideo(sceneImg.filePath, text);
    if (veo.success) {
      return {
        success: true,
        fileName: veo.fileName,
        filePath: veo.filePath,
        fileSize: veo.fileSize,
        type: 'video',
        mode: 'veo',
        style: useStyle,
        character: sceneImg.character,
        sourceImage: `/uploads/${sceneImg.fileName}`,
        title: charName + SCENE_STYLES[useStyle].label + ' Veo 영상'
      };
    }
    // Veo 불가 → 안내와 함께 Ken Burns 모션으로 폴백 (비용 0)
    console.warn('[AI Video] Veo 사용 불가 → Ken Burns 모션 폴백:', veo.reason);
  }

  // 3) Ken Burns 모션 영상 (기본, 비용 0)
  const motion = await generateMotionVideo(sceneImg.filePath, { durationMs: 4200 });
  return {
    success: true,
    fileName: motion.fileName,
    filePath: motion.filePath,
    fileSize: motion.fileSize,
    type: 'video',
    mode: 'motion',
    style: useStyle,
    character: sceneImg.character,
    sourceImage: `/uploads/${sceneImg.fileName}`,
    veoAvailable: isVeoAvailable(),
    title: charName + SCENE_STYLES[useStyle].label + ' 모션 영상'
  };
}
