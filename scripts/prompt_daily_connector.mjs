/**
 * PromptDaily (https://example-prompt-engine.com) 및 글로벌 최상위 레퍼런스 연동 엔진
 * 본문 내용을 분석해 미드저니/DALL-E/Flux용 최고 품질의 이미지 프롬프트를 자동 생성한다.
 *
 * v2 개선점
 *  - 스타일 매칭: 첫 히트 → 키워드 가중 점수 방식 (오탐 감소)
 *  - 장면 분석: 문장 1개 → 구조화 JSON(주제/행동/배경/시간대/소품/감정)
 *  - 촬영 스펙: 고정 문자열 → 렌즈·조명·구도 변주 로테이션 (매번 다른 결과)
 *  - 출력: 단일 문자열 → 엔진별 3종(Midjourney / DALL-E·Gemini / Flux) 최적화 변형
 *  - 공통 네거티브: AI 이미지 최대 약점인 글자·워터마크·기형 손 차단
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { mergeSceneSpec } from './scene_illustrator.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(rootDir, '.env') });

const PROMPT_DAILY_URL = 'https://example-prompt-engine.com';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

/** 모든 스타일 공통 차단 요소 (한글 간판/자막 깨짐, 워터마크, 기형 손) */
const GLOBAL_NEGATIVES = [
  'text', 'letters', 'korean captions', 'watermark', 'logo', 'signature',
  'deformed hands', 'extra fingers', 'plastic skin', 'oversaturated', 'stock photo look'
];

/** 글로벌 상위 플랫폼(PromptHero, Civitai, Lexica) 검증 스타일 팩 */
export const VISUAL_STYLE_PACKS = {
  food_lifestyle: {
    name: '감성 라이프스타일 음식 스냅',
    keywords: ['찜닭', '치킨', '음식', '요리', '식구', '저녁', '외식', '배달', '마트', '장보기', '삼겹살', '반찬', '한상', '맛집'],
    look: 'authentic candid food photography, appetizing steam and texture, cozy Korean home dining table, no studio staging',
    cameras: [
      'shot on 35mm f/1.8, shallow depth of field',
      'shot on 50mm macro f/2.8, close crop on texture',
      'overhead flat lay, 24mm, slight tilt'
    ],
    lights: [
      'natural warm evening dining light spilling from a pendant lamp',
      'soft window backlight with gentle rim glow on the steam',
      'low-key candlelit ambience, warm amber falloff'
    ],
    grade: 'hyper-realistic, rich warm color grade, film-like contrast',
    negatives: ['cartoon', 'illustration', 'artificial plastic food']
  },
  family_candid: {
    name: '40대 가장 시네마틱 일상',
    keywords: ['부모님', '아이들', '학원비', '퇴근길', '가족', '선물', '아빠', '엄마', '일상', '집', '주말', '육아'],
    look: 'cinematic slice-of-life photo of everyday Korean life in Seoul, authentic emotional storytelling, unposed candid moment',
    cameras: [
      'shot on 50mm f/1.4, subject slightly off-center',
      'shot on 85mm f/2, compressed background, over-the-shoulder framing',
      'handheld 35mm, natural motion, documentary framing'
    ],
    lights: [
      'warm golden hour light through apartment windows',
      'soft blue evening ambience with warm indoor lamp contrast',
      'overcast diffused daylight, gentle shadows'
    ],
    grade: 'Kodak Portra 400 tone, subtle film grain, natural skin tones',
    negatives: ['posed studio portrait', 'fashion model look']
  },
  tech_money_3d: {
    name: '미니멀 3D 클레이모피즘 (재테크/절약)',
    keywords: ['쿠폰', '할인', '알뜰폰', '통신비', '가계부', '돈', '결제', '영수증', '포인트', '특가', '적금', '카드', '요금', '캐시백'],
    look: 'cute 3D isometric illustration, soft claymation style, rounded friendly shapes, minimal aesthetic',
    cameras: [
      'isometric three-quarter view, centered composition, generous negative space',
      'slight top-down angle, single hero object on a pedestal',
      'floating objects arrangement with soft depth blur'
    ],
    lights: [
      'clean three-point studio lighting with soft shadows',
      'soft gradient backdrop lighting, gentle ambient occlusion',
      'diffused pastel key light with subtle rim'
    ],
    grade: 'pastel color palette, Blender Cycles render, high detail, clean 8k finish',
    negatives: ['photorealistic humans', 'harsh shadows', 'cluttered background']
  },
  general: {
    name: '모던 에디토리얼 비주얼',
    keywords: [],
    look: 'modern editorial lifestyle photography, clean composition, authentic atmosphere',
    cameras: [
      'shot on 35mm f/2, rule-of-thirds framing',
      'shot on 50mm f/1.8, centered subject with breathing room',
      'wide 24mm environmental shot'
    ],
    lights: [
      'natural soft daylight, gentle falloff',
      'warm side light with soft shadow gradient',
      'bright airy diffused light'
    ],
    grade: 'sharp focus, refined color grade, magazine quality',
    negatives: ['busy background', 'harsh flash']
  }
};

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** PromptDaily(example-prompt-engine.com)에서 최신 프롬프트 샘플을 가져온다 */
export async function fetchPromptDailySamples(limit = 6) {
  try {
    const res = await fetch(`${PROMPT_DAILY_URL}/api/prompts?limit=${limit}`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.prompts || []).map(p => ({
      id: p.id,
      title: p.title,
      summary: p.summary,
      model: p.model,
      score: p.effectiveness_score,
      url: `${PROMPT_DAILY_URL}/p/${p.slug}`
    }));
  } catch {
    return [];
  }
}

/**
 * 본문 텍스트에 가장 적합한 비주얼 스타일 매칭.
 * 첫 히트가 아니라 키워드 적중 개수로 점수를 매겨 가장 강한 팩을 고른다.
 */
export function matchStylePack(text = '') {
  let best = { key: 'general', score: 0 };
  for (const [key, pack] of Object.entries(VISUAL_STYLE_PACKS)) {
    const score = pack.keywords.filter(k => text.includes(k)).length;
    if (score > best.score) best = { key, score };
  }
  return { key: best.key, matchScore: best.score, ...VISUAL_STYLE_PACKS[best.key] };
}

/**
 * 공통 SceneSpec(한국어)를 Midjourney/DALL·E/Flux가 가장 잘 따르는 영어 장면 서술로 바꾼다.
 * 직접 생성과 복사용 프롬프트가 같은 주제·장소·소품을 쓰는 것이 목적이다.
 */
async function describeSceneForEngines(sceneSpec) {
  const local = {
    subject: sceneSpec.subject,
    action: sceneSpec.action,
    setting: sceneSpec.setting,
    time_of_day: sceneSpec.time_of_day,
    props: sceneSpec.props,
    emotion: sceneSpec.emotion
  };
  const key = process.env.GEMINI_API_KEY;
  if (!key) return local;

  const productRule = /로봇\s*청소기/.test(String(sceneSpec.harmony || '') + String(sceneSpec.props || ''))
    ? 'The post explicitly features a robot vacuum: depict one modern circular autonomous device moving on the floor.'
    : 'Do not invent appliances, cleaning devices, or products absent from the scene; props must come only from the given scene spec.';
  const instruction = `You are a photo director. Convert this Korean scene spec of a social post into an English scene description.
Return ONLY minified JSON with these exact keys, all values in English:
{"subject":"main subject, incl. approximate age/gender if a person","action":"what they are doing, present participle","setting":"specific place","time_of_day":"e.g. late evening","props":"1-3 key objects in frame","emotion":"the felt mood"}
Rules:
- Describe ONLY what is visible. No quality words, camera terms, or lighting terms.
- Each value must be under 15 words.
- Stay faithful to the given spec. Do not substitute a different place, person, or object.
- Do not default to a Korean apartment interior unless the spec says home.
- ${productRule}

Scene spec:
인물: ${local.subject}
동작: ${local.action}
장소: ${local.setting}
시간대: ${local.time_of_day}
소품: ${local.props}
감정: ${local.emotion}
하모니: ${sceneSpec.harmony || ''}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: instruction }] }],
        generationConfig: { temperature: 0.6, responseMimeType: 'application/json' }
      }),
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) return local;
    const data = await res.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    const parsed = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, ''));
    const merged = { ...local };
    for (const field of Object.keys(local)) {
      if (typeof parsed[field] === 'string' && parsed[field].trim()) merged[field] = parsed[field].trim();
    }
    return merged;
  } catch {
    return local;
  }
}

/** 본문 내용을 분석해 엔진별 최적화 프롬프트 세트를 조립 */
export async function generateEliteImagePrompt(postText = '', providedSceneSpec = null) {
  const matched = matchStylePack(postText);
  const sceneSpec = mergeSceneSpec(postText, providedSceneSpec);
  const scene = await describeSceneForEngines(sceneSpec);

  const camera = pick(matched.cameras);
  const light = pick(matched.lights);
  const negatives = [...GLOBAL_NEGATIVES, ...(matched.negatives || [])];

  // 장면 서술: 주제 → 행동 → 배경 → 시간대 → 소품 → 감정 순 (이미지 모델이 가장 잘 따르는 순서)
  const sceneLine = [
    scene.subject,
    scene.action,
    `in ${scene.setting}`,
    scene.time_of_day,
    scene.props ? `with ${scene.props}` : '',
    `${scene.emotion} mood`
  ].filter(Boolean).join(', ');

  const midjourney = `${sceneLine}, ${matched.look}, ${camera}, ${light}, ${matched.grade} --ar 4:5 --style raw --v 6.1 --no ${negatives.join(', ')}`;

  // DALL-E 3 / Gemini 계열은 --ar 같은 플래그를 이해하지 못하므로 완전한 서술 문장으로 변환
  const dalle = `A vertical 4:5 photograph. ${sceneLine.charAt(0).toUpperCase()}${sceneLine.slice(1)}. ${matched.look}. ${camera}. ${light}. ${matched.grade}. Important: absolutely no text, letters, captions, watermarks or logos anywhere in the image. Natural, believably Korean faces and hands.`;

  const flux = `${sceneLine}. ${matched.look}, ${camera}, ${light}. ${matched.grade}. No text or watermark. Aspect ratio 4:5.`;

  return {
    styleName: matched.name,
    styleKey: matched.key,
    matchScore: matched.matchScore,
    scene,
    sceneSpec,
    subjectDescription: sceneLine,
    negatives,
    variants: {
      midjourney: { label: 'Midjourney v6.1', prompt: midjourney },
      dalle: { label: 'DALL·E 3 / Gemini', prompt: dalle },
      flux: { label: 'Flux.1 / Recraft', prompt: flux }
    },
    fullPrompt: midjourney, // 하위 호환
    aspectRatio: '4:5 (스레드 세로 최적 규격)',
    recommendedEngines: ['Midjourney v6.1', 'DALL-E 3', 'Flux.1', 'Recraft.ai']
  };
}

// ponytail: 프레임워크 없이 자체 점검. `node scripts/prompt_daily_connector.mjs --selftest`
if (process.argv.includes('--selftest')) {
  const { strict: assert } = await import('assert');
  assert.equal(matchStylePack('오늘 저녁 찜닭 시켰는데 음식이 최고').key, 'food_lifestyle');
  assert.equal(matchStylePack('알뜰폰 통신비 할인 쿠폰 정리').key, 'tech_money_3d');
  assert.equal(matchStylePack('별 내용 없는 잡담').key, 'general');
  // 음식 키워드 1개 vs 재테크 키워드 3개 → 점수 높은 쪽 승리 (기존 버전은 음식이 무조건 이겼음)
  assert.equal(matchStylePack('저녁에 쿠폰 할인 포인트 다 털었다').key, 'tech_money_3d');
  const out = await generateEliteImagePrompt('퇴근길에 아이들 학원비 생각하니 한숨이 나온다');
  assert.ok(out.variants.midjourney.prompt.includes('--ar 4:5'));
  assert.ok(!out.variants.dalle.prompt.includes('--ar'), 'DALL-E 변형에 MJ 플래그가 새면 안 됨');
  assert.ok(out.variants.dalle.prompt.includes('no text'));
  assert.ok(out.negatives.includes('watermark'));
  console.log('✅ prompt_daily_connector selftest 통과');
  console.log('\n[MJ] ' + out.variants.midjourney.prompt);
  console.log('\n[DALLE] ' + out.variants.dalle.prompt);
}
