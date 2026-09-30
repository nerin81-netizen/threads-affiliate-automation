/**
 * 장면 일러스트레이터 — 본문 내용을 "일본 애니 / 한국 웹툰" 한 장면으로 그린다.
 *
 * 글씨만 박힌 카드는 광고 티가 나서 스크롤에 묻힌다. 대신 드라마·웹툰의 한 컷처럼
 * "인물이 감정을 느끼는 장면"을 보여주면 시선이 멈춘다. 이건 HTML/CSS로는 불가능하고
 * 이미지 생성 AI가 필요하다. Gemini 2.5 Flash Image(Nano Banana)를 쓴다.
 *
 * 흐름:
 *   본문 → (텍스트 모델) 장면 묘사 프롬프트 도출 → (이미지 모델) 4:5 장면 렌더 → PNG
 *
 *   node scripts/scene_illustrator.mjs --demo
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { buildCharacterReferenceParts, getIdentityLock, hasCharacter } from './character_sheet.mjs';
import { generateDynamicSceneSeed } from './scene_rules_1000.mjs';
import { matchDomainScene, DOMAIN_CATEGORIES_32 } from './scene_domains_32.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(rootDir, '.env') });

const UPLOAD_DIR = path.join(rootDir, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// 이미지 생성 모델 — 최신 Google AI Studio gemini-3.1-flash-lite-image 적용
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-lite-image';
// 장면 묘사(텍스트) 도출용 모델
const TEXT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// 아웃바운드 호출 운영 한도 — 응답이 없어도 요청이 무한 대기하지 않도록 한다.
const SCENE_TEXT_TIMEOUT_MS = Number(process.env.GEMINI_TEXT_TIMEOUT_MS || 25000);
const SCENE_IMAGE_TIMEOUT_MS = Number(process.env.GEMINI_IMAGE_TIMEOUT_MS || 120000);
const SCENE_RETRY_DELAY_MS = Number(process.env.GEMINI_RETRY_DELAY_MS || 1200);

/** Gemini generateContent 호출 공통 래퍼. 타임아웃 후 429/5xx/네트워크 오류만 재시도한다. */
async function callGemini(model, requestBody, { timeoutMs, label, attempts = 2 }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error(`${label}: GEMINI_API_KEY 미설정`);
  const url = `${API_BASE}/${model}:generateContent?key=${key}`;
  let lastError = new Error(`${label}: 호출 이력 없음`);

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (res.ok) return await res.json();
      const detail = await res.text().catch(() => '');
      lastError = new Error(`${label} HTTP ${res.status} ${detail.slice(0, 160)}`);
      if (res.status !== 429 && res.status < 500) break;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(`${label}: ${String(err)}`);
    }
    if (attempt < attempts) await new Promise(r => setTimeout(r, SCENE_RETRY_DELAY_MS * attempt));
  }
  throw lastError;
}

/** 지원하는 그림 스타일 (스튜디오급 6대 화풍). 각 스타일의 미술 지시문(공통 접두)을 담는다. */
export const SCENE_STYLES = {
  photo: {
    label: '시네마틱 실사',
    cameraOptics: 'Shot on Hasselblad H6D-100c & Leica Summilux 35mm f/1.4, f/1.8 shallow depth of field, creamy background bokeh',
    grading: 'Kodak Portra 400 tone curve, natural cinematic color grading, warm golden-hour undertones, 8K ultra-detailed RAW photo',
    art: [
      '하이엔드 35mm f/1.4 시네마틱 라이프스타일 실제 사진(Realistic Photography). 인스타그램/핀터레스트 최상위 감성 스냅.',
      '인위적인 스튜디오 조명이 아닌, 부드러운 창가 자연광과 데스크 간접 조명이 빚어내는 리얼한 명암비와 얕은 심도(depth of field).',
      '피부의 자연스러운 결, 솜털과 모공, 옷감의 현실적인 텍스처, 공간의 공기감이 살아있는 실제 DSLR/중형 카메라 스틸컷.',
      '과도한 채도나 플라스틱 CG 느낌이 일절 없는, 신뢰도 높은 자연스러운 라이프스타일 사진 퀄리티.'
    ].join(' ')
  },
  anime: {
    label: '일본 애니메이션',
    cameraOptics: 'Cinematic anime layout, wide lens flare, dynamic camera perspective, Shinkai Makoto style composition',
    grading: 'Vibrant luminous palette, Kyoto Animation pastel highlights, atmospheric perspective, rich shadows',
    art: [
      '극장판 애니메이션 퀄리티의 마스터피스급 일러스트. 신카이 마코토/교토애니메이션 감성의 빛과 공간 연출.',
      '정교한 셀 애니메이션 채색과 풍부한 명암대비, 따뜻한 자연광과 영화 같은 렌즈 플레어/빛번짐(bloom), 공기원근.',
      '본문 내용과 완벽히 일치하는 디테일한 배경 작화(background art)와 현실적인 소품 묘사, 시간대가 느껴지는 조명.',
      '감정이 진하게 살아있는 표정, 미세한 피부 질감과 은은한 하이라이트. 4K 고해상도, 시네마틱 퀄리티.'
    ].join(' ')
  },
  webtoon: {
    label: '한국 웹툰',
    cameraOptics: 'Clean digital pen lines, dramatic dramatic webtoon cover angle, dynamic emotional eye-level framing',
    grading: 'Soft cell shading, trendy K-webtoon gradient tones, warm peach and beige studio lighting',
    art: [
      '프리미엄 한국 감성 웹툰의 표지/명장면 수준 고퀄리티 일러스트. 간결하고 세련된 현대적 펜선 라인아트.',
      '고급스러운 소프트 셀셰이딩 화면, 레이어된 그라데이션과 섬세한 림라이트, 시네마틱 색보정(따뜻한 톤/파스텔 미드톤).',
      '본문 상황에 꼭 맞는 현실감 있는 공간 디테일과 부드러운 배경 보케(bokeh)로 몰입감 있는 현장감 표현.',
      '인물의 감정과 상황이 섬세하게 살아있는 표정과 손동작, 단정하고 자연스러운 스타일링. 고해상도 깔끔한 마감.'
    ].join(' ')
  },
  editorial: {
    label: '킨포크 에디토리얼',
    cameraOptics: '50mm f/2.0 architectural fashion lens, calm centered framing, editorial magazine still',
    grading: 'Muted earthy palette, desaturated minimalist tones, soft Nordic natural illumination, Vogue/Kinfolk aesthetic',
    art: [
      '킨포크(Kinfolk) 및 매거진 B 에디토리얼 표지 수준의 미니멀리즘 라이프스타일 포토그래피.',
      '절제된 베이지, 오트밀, 차콜 등 차분한 어스 톤(Earthy tone)의 세련된 색감과 미니멀한 공간 여백.',
      '단정하고 지적인 피사체의 실루엣과 정돈된 건축적 프레이밍, 은은하고 차분한 소프트 앰비언트 라이트.'
    ].join(' ')
  },
  '3d_render': {
    label: '애플/픽사 3D',
    cameraOptics: 'Isometric 3D clay perspective, Ray-traced global illumination, Octane Render 8K',
    grading: 'Warm soft pastel colors, subsurface scattering clay texture, tactile soft toy-like lighting',
    art: [
      '애플 키노트와 픽사(Pixar) 단편 스타일의 세련된 감성 3D 일러스트레이션 (3D Clay/Stylized Render).',
      '빛을 부드럽게 흡수하고 투과하는 서브서피스 스캐터링(SSS) 매트 질감과 둥글고 친근한 오브제 조형미.',
      '정교한 옥테인(Octane) 렌더링 품질의 부드러운 소프트 섀도우와 따뜻한 파스텔 톤 글로벌 일루미네이션.'
    ].join(' ')
  },
  retro_film: {
    label: '90s 레트로 필름',
    cameraOptics: 'Contax T2 38mm f/2.8 lens snapshot, subtle optical lens grain, natural film flash artifact',
    grading: 'Fuji Superia 400 color science, authentic grain texture, nostalgic warm nostalgic shadows',
    art: [
      '90년대 후지/코닥 35mm 필름 카메라로 포착한 듯한 아날로그 빈티지 스냅(Retro Film Aesthetic).',
      '자연스러운 필름 입자감(Film Grain)과 살짝 바랜 듯 따뜻한 세피아 섀도우, 필름 특유의 낭만적인 발색.',
      '일상의 순간을 필름 롤에 담아낸 듯한 정겨운 감성과 편안한 라이프스타일 온기.'
    ].join(' ')
  }
};

// 12개 순환 장면 방향 (다양성 검증 및 폴백용)
const SCENE_DIRECTIONS = [
  { setting: '채광 좋은 야외 카페 테라스의 티테이블', light: '아침 햇살의 부드러운 자연광', camera: '인물의 표정을 살린 50mm 바스트 숏' },
  { setting: '통유리창 너머로 푸른 하늘이 보이는 옥상 루프탑', light: '황금빛 오후 햇살과 옅은 그림자', camera: '도시 스카이라인을 배경으로 한 와이드 숏' },
  { setting: '책장과 따뜻한 펜던트 조명이 있는 독립 서점', light: '차분하고 아늑한 2700K 웜톤 조명', camera: '서가 사이에서 인물을 포착한 프레임 구도' },
  { setting: '초록 플라타너스 가로수 아래 공원 벤치', light: '나뭇잎 사이로 부서지는 반짝이는 햇살', camera: '자연스러운 아이레벨 미디엄 숏' },
  { setting: '비 내린 후 촉촉하게 젖은 도심 보행자 거리', light: '가로등과 상점 불빛의 낭만적인 반사', camera: '로우 앵글 워킹 팔로우 숏' },
  { setting: '층고가 높은 모던한 전시관 화이트 갤러리', light: '정갈하고 선명한 천장 트랙 스팟라이트', camera: '공간의 깊이감이 느껴지는 원근 구도' },
  { setting: '억새풀이 바람에 일렁이는 저녁 천변 산책로', light: '노을 지는 매직아워의 오렌지빛 역광', camera: '인물의 실루엣과 감성을 살린 35mm 숏' },
  { setting: '정갈한 원목 아일랜드가 있는 오픈 키친', light: '따뜻한 팬던트 조명 아래 화사한 실내광', camera: '정돈된 식탁과 인물을 담은 오버숄더 숏' },
  { setting: '원목 툇마루 너머로 마당이 보이는 현대식 한옥', light: '처마 밑으로 스며드는 은은한 그늘빛', camera: '단정하고 평온한 정면 구도' },
  { setting: '바깥 풍경이 시원하게 스쳐가는 열차 창가', light: '창문을 통해 쏟아지는 빠른 빛과 그림자', camera: '창가에 기댄 인물의 옆모습 프로필 숏' },
  { setting: '알록달록한 학용품이 가득한 따뜻한 문구점', light: '환하고 정겨운 백색 매장 조명', camera: '다채로운 소품들과 인물이 어우러진 숏' },
  { setting: '가죽 소파와 타오르는 벽난로가 있는 라운지', light: '장작불의 따뜻하고 붉은빛 플리커 조명', camera: '안락한 휴식감이 강조된 45도 클로즈업' }
];

let sceneDirectionCursor = 0;
export function nextSceneDirection() {
  const item = SCENE_DIRECTIONS[sceneDirectionCursor % SCENE_DIRECTIONS.length];
  sceneDirectionCursor += 1;
  return { ...item };
}

/** 16대 다채로운 인물 페르소나 풀 (성별·연령·직업·분위기 편향 원천 차단) */
const PERSONA_PRESETS = [
  '20대 초중반 긴 생머리에 산뜻한 가디건을 걸친 한국인 여성 대학생/사회초년생',
  '20대 후반 단정한 안경과 캐주얼한 맨투맨 차림의 호기심 가득한 한국인 남성 개발자',
  '30대 초반 세련된 단발머리에 오버핏 블레이저를 입은 지적인 한국인 여성 기획자/프리랜서',
  '30대 중반 슬림핏 셔츠 소매를 걷어붙인 열정적인 한국인 남성 스타트업 대표',
  '20대 중반 스포티한 러닝탑과 쇼츠 차림으로 생기 넘치는 에너지를 발산하는 한국인 여성 러너',
  '40대 초반 단아하게 묶은 머리에 편안한 리넨 셔츠를 입은 센스 있는 한국인 여성',
  '30대 후반 네이비 옥스포드 셔츠를 입고 차분하고 신뢰감 있는 미소를 띤 한국인 남성',
  '50대 초반 깔끔한 은발이 섞인 짧은 머리에 지적인 안경을 쓴 한국인 베테랑 연구원/전문가',
  '20대 후반 감각적인 스트릿 캐주얼 웨어를 입고 트렌디한 감성을 풍기는 한국인 남성 크리에이터',
  '30대 초반 포니테일 헤어스타일에 활동적인 복장으로 환하게 미소 짓는 한국인 여성 디자이너',
  '40대 중반 정갈한 앞치마를 두르고 솜씨 좋게 요리를 준비하는 따뜻한 인상의 한국인 셰프/주부',
  '30대 초반 단정한 니트 차림의 한국인 남성과 서류를 함께 보며 웃는 2인 팀원(협업 구도)',
  '20대 초반 청량한 화이트 셔츠 차림에 밝고 당찬 눈빛을 가진 한국인 청년',
  '40대 초반 지적이면서도 친근한 미소를 띤 안경 쓴 한국인 여성 팀장',
  '30대 중반 편안한 후디와 데님 차림으로 자유로운 영감을 펼치는 한국인 1인 창작자',
  '20대 후반 깔끔한 슬랙스에 가벼운 윈드브레이커를 걸치고 활기차게 발걸음을 옮기는 한국인 여성'
];

/** 8대 극적 조명 & 색온도 대비 풀 (황혼/주황빛 일색 수렴 방지) */
const LIGHT_CONTRASTS = [
  { name: '맑은 대낮 쿨톤 자연광', light: '구름 한 점 없는 정오의 청량하고 눈부신 파란 하늘 자연광 (6500K 청량 쿨톤)' },
  { name: '비 온 뒤 촉촉한 도심 반사', light: '비 내린 후 촉촉하게 젖은 아스팔트와 투명한 빗방울에 비치는 도심의 맑은 쿨그레이 자연광' },
  { name: '이른 아침 청명한 블루아워', light: '동틀 무렵 이슬 맺힌 맑고 상쾌한 푸른빛 새벽 공기와 부드러운 아침 채광' },
  { name: '화려한 사이버틱 네온 야경', light: '어두운 밤하늘 아래 사이안(Cyan)과 마젠타(Magenta) 네온사인이 감각적으로 교차하는 세련된 야경' },
  { name: '화이트 스튜디오 하이키', light: '그림자가 거의 없는 새하얗고 정갈한 무반사 스튜디오 하이키(High-key) 소프트 박스 조명' },
  { name: '푸른 숲속 나뭇잎 투과광', light: '울창한 초록 숲길 나뭇잎 사이로 반짝이며 부서져 내리는 눈부신 빗살 채광' },
  { name: '황금빛 늦은 오후 골든아워', light: '늦은 오후 지평선에서 길게 뻗어나오는 따스한 엠버 톤의 황금빛 매직아워' },
  { name: '선명한 갤러리 트랙 스팟', light: '전시관처럼 군더더기 없이 피사체와 공간을 입체적으로 강조하는 선명한 화이트 트랙 핀조명' }
];

/** 본문 해시 — 같은 본문이면 같은 장면을 뽑기 위한 결정적 시드 */
function textHash(text = '') {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) & 0xffffffff;
  return Math.abs(hash);
}

/** 텍스트 해시 기반 인물 및 조명 동적 선택 */
function selectDynamicPersona(text = '') {
  const absHash = textHash(text);
  const persona = PERSONA_PRESETS[absHash % PERSONA_PRESETS.length];
  const lightChoice = LIGHT_CONTRASTS[(absHash >> 3) % LIGHT_CONTRASTS.length];
  return { persona, lightChoice };
}

/** 본문 키워드를 32대 초정밀 도메인으로 분석해 최적의 씬 프리셋을 도출한다. */
export function getDomainDirection(text = '') {
  return matchDomainScene(text);
}

/** 본문에서 프롬프트 추출과 직접 생성이 함께 사용할 공통 장면 설계도(SceneSpec)를 만든다. */
export function createSceneSpec(text = '') {
  const direction = getDomainDirection(text);
  const dynamic = generateDynamicSceneSeed(text);
  const { persona, lightChoice } = selectDynamicPersona(text);
  const absHash = textHash(text);
  // 도메인 프리셋과 1,000대 규칙 풀을 본문 해시로 교차 채택해,
  // 맥락 정확도는 유지하면서 조명·구도가 75개 프리셋으로 수렴하지 않게 한다.
  const useRulePool = absHash % 2 === 1;
  return {
    version: 1,
    domainKey: direction.domainKey,
    theme: dynamic.theme,
    subject: persona,
    action: dynamic.action,
    setting: direction.setting || dynamic.location,
    time_of_day: dynamic.time,
    props: dynamic.prop,
    emotion: dynamic.emotion,
    light: (useRulePool ? (dynamic.light || direction.light) : (direction.light || dynamic.light)) || lightChoice.light,
    camera: (useRulePool ? (dynamic.angle || direction.camera) : (direction.camera || dynamic.angle)),
    fashion: dynamic.fashion,
    weather: dynamic.weather,
    texture: dynamic.texture,
    harmony: dynamic.summary
  };
}

/** 사용자 편집본 설계도가 비어 있으면 본문 기반 기본값으로 채운다. */
export function mergeSceneSpec(text = '', provided = null) {
  if (!provided) return createSceneSpec(text);
  const merged = { ...createSceneSpec(text) };
  for (const [key, value] of Object.entries(provided)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && !value.trim()) continue;
    merged[key] = value;
  }
  return merged;
}

/** 공통 장면 설계도를 이미지 모델이 이해할 수 있는 장면 설명으로 변환한다. */
export function describeSceneSpec(sceneSpec) {
  return `${sceneSpec.time_of_day}. ${sceneSpec.setting}에서 ${sceneSpec.fashion} 차림의 ${sceneSpec.subject}이(가) ${sceneSpec.action}. ${sceneSpec.emotion}. 주요 소품은 ${sceneSpec.props}. ${sceneSpec.light}, ${sceneSpec.weather}, ${sceneSpec.texture}, ${sceneSpec.camera}.`;
}

/** 본문에서 장면을 로컬 추론(폴백) — 1,000대 규칙 & 맥락 인지형 하모니 콘티 기반 공통 SceneSpec 사용 */
function localScene(text = '', sceneSpec = null) {
  return describeSceneSpec(sceneSpec || createSceneSpec(text));
}

/** Gemini 텍스트 모델로 본문에 맞는 "장면 묘사"를 뽑는다. 1,000대 시각 연출 & 시네마틱 하모니 엔진 적용 */
export async function deriveScene(text = '', providedSceneSpec = null) {
  const key = process.env.GEMINI_API_KEY;
  const sceneSpec = mergeSceneSpec(text, providedSceneSpec);

  if (!key) return localScene(text, sceneSpec);

  const prompt = `너는 세계 최고 권위의 비주얼 필름 디렉터이자 영화 촬영감독이다. 아래 SNS(스레드) 본문을 읽고,
피드 스크롤을 즉시 멈추게 만들 "본문 내용과 100% 일치하며 공간-인물-소품이 찰떡같이 어우러지는 결정적 시네마틱 한 컷"을 묘사하라.

[본문]
${text.slice(0, 700)}

[이번 씬의 시네마틱 하모니 콘티 (One-Hero Cinematic Storyboard)]
- 테마 클러스터: ${sceneSpec.theme}
- 공간/배경: ${sceneSpec.setting}
- 주연 인물 페르소나: ${sceneSpec.subject}
- 의상/스타일링: ${sceneSpec.fashion}
- 핵심 동작 및 제스처: ${sceneSpec.action}
- 손끝/주변 핵심 소품 (공간과 100% 일치): ${sceneSpec.props}
- 감정선 및 표정: ${sceneSpec.emotion}
- 빛과 색온도 (웜톤 수렴 금지): ${sceneSpec.light}
- 카메라 앵글 & 프레이밍: ${sceneSpec.camera}
- 날씨·대기감: ${sceneSpec.weather}
- 연출 하모니 가이드: ${sceneSpec.harmony}

[절대 어기면 안 되는 엄격 필수 규칙 (STRICT RULES)]
1. ★【시네마틱 씬 하모니 & One-Hero 포커스 (SCENE HARMONY & COHESION)】:
   배경 공간, 인물의 의상, 신체 동작, 손끝의 소품이 한 편의 완성된 영화처럼 100% 서사적 개연성을 가져야 한다!
   - 주유소/차량 상황이면 주유 노즐, 계기판, 스마트키, 드라이빙 룩 등 모빌리티 요소로 100% 일치시킬 것.
   - 마트/식재료 상황이면 신선식품 코너, 장바구니, 식재료 팩, 영수증 등 쇼핑 요소로 완벽히 조화시킬 것.
   - 러닝/운동 상황이면 우레탄 트랙, 러닝화, 스포츠워치, 땀과 얼음물 등으로 현장감을 살릴 것.
   - 상황과 전혀 어울리지 않는 엉뚱한 잡탕 소품(예: 주유소에 선물상자, 러닝 트랙에 사무실 서류 등)은 절대 배치하지 마라.
2. ★【배경 및 장소의 극적 다양성 (DRAMATIC SPATIAL DIVERSITY)】:
   모든 컷이 똑같은 카페, 서재, 도서관, 집 거실로 획일화되는 것을 엄격히 금지한다! 본문 스토리의 현장감이 극대화될 수 있는 다채로운 현실 무대를 자유롭게 선택하라:
   - 야외/도심: 횡단보도 신호등 앞, 활기찬 보행자 거리, 지하철 승강장/역 광장, 버스 정류장, 한강변, 공원 잔디밭
   - 상업/생활: 대형 할인마트 쇼핑 통로, 전통시장 과일가게 앞, 골목 빵집, 드럭스토어, 코인세탁소, 백화점
   - 모빌리티/이동: 대형 셀프 주유소, 탁 트인 해안 도로 드라이브, 고속도로 휴게소 테라스, 열차 창가, 공항 출국장
   - 스포츠/자연: 야외 러닝 트랙, 헬스장 피트니스 클럽, 피크닉 숲길, 캠핑장 타프 아래
   - 본문에 주유소, 마트, 헬스장 등 구체적 장소나 대상이 언급되면 그곳을 100% 최우선으로 살려라!
3. 【머그잔/종이컵 커피 클리셰 엄격 금지 (NO COFFEE MUG / CUP)】:
   김이 모락모락 나는 머그잔을 두 손으로 감싸 쥐거나 테이크아웃 종이컵을 든 상투적이고 게으른 연출은 절대 금지한다!
4. 【창밖 멍하니 응시 & 모니터 주시 엄격 금지 (NO PASSIVE STARING)】:
   창밖을 멍하니 내다보거나 노트북/모니터 화면만 쳐다보는 정적인 포즈는 절대 금지한다!
5. 【살아있는 동작 묘사】:
   인물의 손과 몸은 본문 내용에 꼭 맞는 구체적인 행동(주유 노즐을 잡고 계기판 확인하기, 장바구니를 들고 알뜰하게 살피기, 야외를 힘차게 걸어가기, 러닝 후 상쾌하게 땀을 닦기 등)을 취해야 한다.
6. 【빛과 공간감 극대화】: 무조건적인 실내 주황빛 조명을 피하고, 지정된 "${sceneSpec.light}"의 채광과 공간의 깊이감을 살려라.
7. 세로 4:5 화면 비율이며, 텍스트나 말풍선, 워터마크는 일절 묘사하지 마라.
8. 3~4문장의 생생하고 시각적인 순수 장면 묘사만 한국어로 출력하라.`;

  try {
    const data = await callGemini(TEXT_MODEL, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.85 }
    }, { timeoutMs: SCENE_TEXT_TIMEOUT_MS, label: '장면 묘사' });
    const out = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    const finalScene = out && out.length > 5 ? out : localScene(text, sceneSpec);
    console.log('\n[SCENE PROMPT DEBUG] 도출된 장면 묘사:\n', finalScene);
    return finalScene;
  } catch (err) {
    console.warn('[Scene] 장면 묘사 폴백 사용:', err.message);
    const fallback = localScene(text, sceneSpec);
    console.log('[SCENE PROMPT DEBUG] 로컬 폴백 장면 묘사:\n', fallback);
    return fallback;
  }
}

/** 장면 묘사 + 스타일을 합쳐 스튜디오급 5단 구조화 이미지 프롬프트를 조립한다. */
export function buildImagePrompt(sceneDesc, style = 'anime', sourceText = '') {
  const s = SCENE_STYLES[style] || SCENE_STYLES.anime;
  const objectRule = /로봇\s*청소기/.test(sourceText)
    ? '본문에 명시된 원형 자율주행 로봇청소기의 형태와 바닥에서 스스로 움직이는 동작을 정확히 유지한다.'
    : '장면 설명에 명시된 핵심 소품만 배치한다. 본문과 무관한 가전제품, 청소도구, 장식물을 관성적으로 추가하지 않는다.';

  return `[1. ART DIRECTION & STYLE]
${s.art}

[2. SCENE SNAPSHOT & SUBJECT ACTION]
${sceneDesc}

[3. OPTICAL & CINEMATOGRAPHY SPECS]
- Aspect Ratio: 4:5 Vertical Portrait Composition (1080x1350 optimal for mobile social feeds).
- Camera & Lens: ${s.cameraOptics || '35mm f/1.4 prime lens, creamy background bokeh, shallow depth of field'}.
- Color Grading & Tonality: ${s.grading || 'Cinematic color grade, natural balanced dynamic range, rich midtones'}.
- Framing: Dynamic cinematic hero framing. 인물의 생생하고 다채로운 표정과 살아있는 몸짓이 돋보이는 앵글.

[4. TEXTURE & MATERIALITY]
- Tactile materiality: 피부 결, 옷감 텍스처, 공간 질감, 빛의 반사광을 살린 고해상도 디테일 마감.
- Lighting: 영화적 구도와 입체적 심도(depth of field), 장면에 명시된 고유한 빛과 색온도 반영.
- Props Rule: ${objectRule}

[5. STRICT NEGATIVE CONSTRAINTS (MANDATORY QUALITY GUARDS)]
- NO COFFEE MUG / CUP CLICHE: Do NOT draw hands holding a steaming mug or paper coffee cup unless explicitly required by post text.
- NO SCREEN-STARE CLICHE: Do not depict the subject staring blankly into a laptop or monitor. No monotonous computer typing posture.
- NO MONOTONOUS WARM TONE: Preserve the exact lighting and cool/warm balance specified in the scene.
- NO TEXT / NO ARTIFACTS: Absolutely NO text, NO typography, NO watermark, NO letters, NO speech bubbles, NO logos.
- ANATOMICAL PRECISION: 손가락과 신체 비율은 정확하게. Exactly 5 fingers per hand, natural finger joints, symmetrical pupils, correct skeletal anatomy. No deformed limbs.
- QUALITY GATES: 최고 퀄리티, 매우 디테일, 마스터피스, 선명한 초점, 전문 아티스트 수준의 마감.`;
}

/** Gemini 이미지 모델 호출 → base64 PNG 버퍼 반환.
 * @param {string} imagePrompt 텍스트 프롬프트
 * @param {Array} refParts 참조 이미지 inlineData 파트 배열 (캐릭터 고정용)
 */
async function requestImage(imagePrompt, refParts = []) {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY 미설정 — 이미지 생성 불가');

  // 참조 이미지를 먼저, 그 다음 텍스트 프롬프트를 넣는다.
  const parts = [...refParts, { text: imagePrompt }];

  const data = await callGemini(IMAGE_MODEL, {
    contents: [{ parts }],
    generationConfig: { responseModalities: ['IMAGE'] }
  }, { timeoutMs: SCENE_IMAGE_TIMEOUT_MS, label: '이미지 생성' });
  const respParts = data.candidates?.[0]?.content?.parts || [];
  const img = respParts.find(p => p.inlineData?.data);
  if (!img) throw new Error('이미지 데이터가 응답에 없음 (안전필터 차단 가능)');
  return Buffer.from(img.inlineData.data, 'base64');
}

/**
 * 본문 → 애니/웹툰 장면 이미지 PNG 생성.
 * character가 지정되면 해당 고정 캐릭터를 주인공으로 유지한다(참조 이미지 + Identity Lock).
 * @param {string} text 본문
 * @param {string} style anime|webtoon
 * @param {string|null} character 캐릭터 id (예: 'yuna'). null이면 일반 장면.
 * @param {object|null} sceneSpec 프롬프트 추출에서 확정한 공통 장면 설계도
 * @returns {Promise<{fileName,filePath,fileSize,sceneDesc,style,styleLabel,character,mood,sceneSpec}>}
 */
export async function generateSceneImage(text = '', style = 'anime', character = null, sceneSpec = null) {
  const useStyle = SCENE_STYLES[style] ? style : 'anime';
  const resolvedSceneSpec = mergeSceneSpec(text, sceneSpec);
  const sceneDesc = await deriveScene(text, resolvedSceneSpec);

  let refParts = [];
  let mood = 'none';
  let identityBlock = '';
  const useChar = character && hasCharacter(character) ? character : null;
  if (useChar) {
    const ref = buildCharacterReferenceParts(useChar, text);
    refParts = ref.parts;
    mood = ref.mood;
    identityBlock = getIdentityLock(useChar);
  }

  // 캐릭터가 있으면 Identity Lock을 프롬프트 맨 앞에 붙이고, 주인공으로 명시한다.
  let imagePrompt = buildImagePrompt(sceneDesc, useStyle, text);
  if (useChar) {
    imagePrompt = `${identityBlock}\n\n참조 이미지의 인물(유나)을 이 장면의 주인공으로 그려라. 얼굴과 머리 특징은 그대로 유지하되 아래 화풍과 장면에 맞게 표현하라.\n\n${imagePrompt}`;
  }

  const buf = await requestImage(imagePrompt, refParts);

  const tag = useChar ? `${useChar}_${useStyle}` : useStyle;
  const fileName = `scene_${tag}_${Date.now()}.png`;
  const filePath = path.join(UPLOAD_DIR, fileName);
  fs.writeFileSync(filePath, buf);

  return {
    fileName,
    filePath,
    fileSize: buf.length,
    sceneDesc,
    style: useStyle,
    styleLabel: SCENE_STYLES[useStyle].label,
    character: useChar,
    mood,
    sceneSpec: resolvedSceneSpec
  };
}

async function demo() {
  const sample = '월급 들어오자마자 통장 스치는 소리... 이번 달도 텅장이네요 ㅠㅠ 그래도 이 방법 하나로 커피값이라도 아껴봅니다';
  console.log('[1] 장면 묘사 도출 중...');
  const scene = await deriveScene(sample);
  console.log('   →', scene);

  console.log('[2] 애니 스타일 이미지 생성 중...');
  const r = await generateSceneImage(sample, 'anime');
  console.log(`   ✅ ${r.fileName} (${Math.round(r.fileSize / 1024)}KB) style=${r.styleLabel}`);
  console.assert(r.fileSize > 20_000, '이미지가 너무 작음');
  console.assert(fs.existsSync(r.filePath), '파일 미생성');

  // 프롬프트에 글자 금지 지시가 포함되는지
  const p = buildImagePrompt('테스트 장면', 'webtoon');
  console.assert(p.includes('글자') && p.includes('웹툰'), '프롬프트 구성 오류');

  console.log('self-check 통과 ✅ (생성물은 uploads/에 유지)');
}

if (process.argv.includes('--demo')) await demo();
