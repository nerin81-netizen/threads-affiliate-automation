/**
 * 캐릭터 시트 — 고정 캐릭터를 게시글 주인공으로 쓰기 위한 정의.
 *
 * 매번 새 인물을 뽑으면 브랜드 정체성이 안 생긴다. "유나"라는 고정 캐릭터를
 * 참조 이미지 + Identity Lock으로 잠가두고, 장면(감정/상황)만 바꿔서
 * 항상 같은 주인공이 등장하게 한다.
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const ASSET_DIR = path.join(rootDir, 'assets', 'yuna');

/** 참조 이미지 파일 → mimeType 매핑 */
function mimeOf(file) {
  return file.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
}

export const CHARACTERS = {
  yuna: {
    id: 'yuna',
    name: '유나',
    label: '유나 (고정 캐릭터)',
    // 장면이 바뀌어도 유지할 정체성 규칙 (한국어 + 영어 혼합, 모델이 잘 따름)
    identityLock: `IDENTITY LOCK: 첨부한 참조 이미지의 인물 "유나(Yuna)"와 정확히 같은 사람으로 유지하라. 유나는 20대 초반의 창작 캐릭터다.
- 얼굴형: 작은 계란형, 뚜렷한 V라인 턱선.
- 눈: 크고 맑은 흑갈색 아몬드형 눈, 또렷한 쌍꺼풀과 자연스러운 애교살, 긴 속눈썹.
- 코: 반듯한 콧대에 둥글고 세련된 코끝. 입술: 작고 도톰한 핑크코랄 립.
- 피부: 맑고 투명한 아이보리 도자기 피부, 새틴-매트 질감 (물광/플라스틱 피부 금지).
- 머리: 흑갈색 긴 생머리, 자연스러운 가르마, 윤기 있는 실키 텍스처.
- 20대 초반 성인 여성 인상. 얼굴 골격/눈 간격/코/입/턱선/헤어라인/체형 비율을 모든 장면에서 반드시 동일하게 유지하라.
- 실존 인물/연예인과 닮게 하지 말 것. 유나의 고유 정체성을 100% 유지.`,
    // 본문 감정 키워드 → 참조 이미지. 감정에 맞는 표정 참조를 넣으면 일관성이 올라간다.
    referencesByMood: {
      surprised: 'yuna-ref-surprised.jpg', // 놀람/충격/특가
      happy: 'yuna-ref-happy.jpg',         // 신남/기쁨/행복
      thinking: 'yuna-ref-thinking.jpg',   // 고민/생각/질문
      smile: 'yuna-ref-smile.jpg',         // 잔잔한 미소/힐링
      default: 'yuna-ref-front.png'        // 전신 기준 (기본)
    },
    // 얼굴 정체성 보강용으로 항상 함께 넣는 기준 참조
    anchorReference: 'yuna-ref-portrait.jpg'
  }
};

/** 본문 텍스트로 감정 무드를 추정한다. */
export function detectMood(text = '') {
  const t = String(text);
  if (/놀|헐|대박|충격|실화|특가|반값|할인|이럴수가|미쳤/.test(t)) return 'surprised';
  if (/신나|행복|최고|좋아|기뻐|사랑|설레|꿀|이득|가성비/.test(t)) return 'happy';
  if (/고민|생각|왜|뭐가|어떻게|질문|궁금|밸런스|골라|선택/.test(t)) return 'thinking';
  return 'smile';
}

/**
 * 캐릭터 참조 이미지 파트를 만든다 (Gemini inlineData 형식 배열).
 * 감정 무드에 맞는 표정 참조 + 얼굴 앵커 참조를 함께 넣는다.
 * @returns {{parts: Array, mood: string, files: string[]}}
 */
export function buildCharacterReferenceParts(characterId = 'yuna', text = '') {
  const ch = CHARACTERS[characterId];
  if (!ch) return { parts: [], mood: 'none', files: [] };

  const mood = detectMood(text);
  const moodFile = ch.referencesByMood[mood] || ch.referencesByMood.default;
  const files = [moodFile];
  if (ch.anchorReference && ch.anchorReference !== moodFile) files.push(ch.anchorReference);

  const parts = [];
  for (const f of files) {
    const p = path.join(ASSET_DIR, f);
    if (!fs.existsSync(p)) continue;
    parts.push({ inlineData: { mimeType: mimeOf(f), data: fs.readFileSync(p).toString('base64') } });
  }
  return { parts, mood, files };
}

/** 캐릭터 존재 여부 */
export function hasCharacter(characterId) {
  return !!CHARACTERS[characterId];
}

export function getIdentityLock(characterId = 'yuna') {
  return CHARACTERS[characterId]?.identityLock || '';
}
