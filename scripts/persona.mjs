/**
 * 계정 페르소나 로더
 *
 * 글·댓글 생성기가 제각각 톤을 정하면 계정이 여러 사람이 쓰는 것처럼 읽힌다.
 * persona.json 한 곳만 보게 해서 말투와 소재를 한 사람 것으로 묶는다.
 *
 *   node scripts/persona.mjs        # 현재 페르소나 프롬프트 확인
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PERSONA_FILE = path.join(path.resolve(__dirname, '..'), 'persona.json');

export function loadPersona() {
  if (!fs.existsSync(PERSONA_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(PERSONA_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * 프롬프트에 붙일 페르소나 블록을 만든다.
 * 파일이 없거나 깨져 있으면 빈 문자열을 돌려줘 생성 자체는 계속되게 한다.
 */
export function personaPrompt() {
  const p = loadPersona();
  if (!p) return '';

  const { profile = {}, mbtiTraits = {}, voice = {}, lifeContext = {}, rules = [] } = p;
  const lines = ['[글쓴이 — 이 사람이 쓴 것처럼 써라]'];

  if (profile.ageBand || profile.family) {
    lines.push(`- ${[profile.ageBand, profile.family].filter(Boolean).join(', ')}`);
  }
  if (profile.interests?.length) lines.push(`- 관심사: ${profile.interests.join(', ')}`);

  // 성향은 "이렇게 쓰라"는 지시로 풀어서 넣는다.
  // MBTI 코드만 던지면 모델이 유형 설명문 같은 글을 써버린다.
  const traits = Object.entries(mbtiTraits).filter(([k]) => !k.startsWith('_'));
  if (traits.length) {
    lines.push('- 성향 (유형 이름은 글에 절대 쓰지 마라):');
    traits.forEach(([, v]) => lines.push(`  · ${v}`));
  }
  if (voice.tone) lines.push(`- 말투: ${voice.tone}`);
  if (voice.allow?.length) lines.push(`- 허용: ${voice.allow.join(' / ')}`);
  if (voice.avoid?.length) lines.push(`- 금지: ${voice.avoid.join(' / ')}`);

  if (lifeContext.소비단위) lines.push(`- 소비 단위: ${lifeContext.소비단위}`);
  if (lifeContext['자주 겪는 일']?.length) {
    lines.push(`- 일상 소재: ${lifeContext['자주 겪는 일'].join(' / ')}`);
  }
  if (lifeContext['관심사 소재']?.length) {
    lines.push(`- 관심사 소재: ${lifeContext['관심사 소재'].join(' / ')}`);
  }
  if (rules.length) {
    lines.push('- 지킬 것:');
    rules.forEach(r => lines.push(`  · ${r}`));
  }

  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const block = personaPrompt();
  console.log(block || '⚠️ persona.json 을 읽지 못했습니다.');
}
