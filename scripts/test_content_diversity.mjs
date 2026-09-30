import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildImagePrompt, nextSceneDirection, createSceneSpec } from './scene_illustrator.mjs';

/** SceneSpec 다양성을 검증할 서로 다른 주제 본문들 */
const DIVERSITY_TOPICS = [
  '오늘 퇴근길에 편의점 들러 아이스크림 사고 기분 좋아짐',
  '주유소 가서 기름 채웠는데 가격 또 올랐네요',
  '로봇청소기 들인 후 바닥 청소가 확 줄었어요',
  '알뜰폰으로 통신비 월 3만원 아꼈습니다',
  '아침 러닝 5km 성공하고 스트레칭으로 마무리',
  '아이 학원비 카드값 보고 한숨 쉬는 중',
  '전세 사기 위험 대비해서 등기부등본 확인하기',
  '새 노트북 샀는데 개발 환경 세팅 반나절 걸림',
  '장보기 앱으로 마트보다 저렴한 거 확인함',
  '주말에 한강 나가서 피크닉하고 사진 찍음',
  '적립금 포인트 모아서 커피 한 잔 무료 교환',
  '야근 후 탕비실에서 라면 끓여 먹은 이야기',
  '자동차 보험 비교 견적으로 12만원 절약',
  '반려동물 용품 정기배송 신청함',
  '운동 루틴 30일 연속 달성해서 인증',
  '새벽 5시 기상 도전 3일차 눈과의 싸움',
  '전기요금 누진제 폭탄 맞는 중',
  '동네 빵집 마감할인 시간 공략법',
  '국제전화 앱으로 가족과 통화비용 절감',
  '재택근무 1년 차 책상 정리 후기'
];

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = fs.readFileSync(path.join(rootDir, 'server.mjs'), 'utf8');
const promptConnector = fs.readFileSync(path.join(rootDir, 'scripts/prompt_daily_connector.mjs'), 'utf8');

assert.match(server, /rankIndex < 8/, '플랫폼별 8개 검색어 수집 범위가 없습니다.');
assert.match(server, /source: 'google'/, 'Google 검색어 출처 저장이 없습니다.');
assert.match(server, /source: 'naver'/, 'Naver 검색어 출처 저장이 없습니다.');
assert.match(server, /source: 'threads'/, 'Threads 검색어 출처 저장이 없습니다.');
assert.match(server, /candidateKeywordCursor/, '24개 검색어 순환 커서가 없습니다.');
assert.match(server, /writeStoryPosts\(\[keyword\], 1\)/,
  '스토리 후보가 검색어별 1건으로 분리 생성되지 않습니다.');
assert.equal(server.includes('.slice(0, 5)\n        .map(idea'), false,
  '후보 생성이 다시 상위 5개 검색어로 제한됐습니다.');

const directions = Array.from({ length: 12 }, () => nextSceneDirection());
assert.equal(new Set(directions.map(item => item.setting)).size, 12, '12회 안에 배경이 반복됩니다.');
assert.equal(new Set(directions.map(item => item.camera)).size, 12, '12회 안에 카메라 구도가 반복됩니다.');

const genericPrompt = buildImagePrompt('비 내린 버스정류장에서 퇴근 후 잠시 숨을 고르는 장면', 'anime', '퇴근길 위로 이야기');
assert.equal(/로봇\s*청소기/.test(genericPrompt), false,
  '로봇청소기가 없는 본문 프롬프트에 로봇청소기 문구가 주입됩니다.');
const robotPrompt = buildImagePrompt('현대적인 집에서 바닥 청소가 진행되는 장면', 'webtoon', '로봇청소기 사용 이야기');
assert.match(robotPrompt, /원형 자율주행 로봇청소기/,
  '본문이 로봇청소기일 때 필요한 형태 보존 규칙이 없습니다.');

// 프롬프트 추출과 직접 생성이 하나의 공통 SceneSpec을 공유하는 구조인지 확인한다.
assert.match(promptConnector, /import \{ mergeSceneSpec \} from '\.\/scene_illustrator\.mjs'/,
  '프롬프트 추출기가 공통 SceneSpec을 불러오지 않습니다.');
assert.match(promptConnector, /generateEliteImagePrompt\(postText = '', providedSceneSpec = null\)/,
  '프롬프트 추출기가 확정된 SceneSpec을 받지 못해 직접 생성과 다른 장면을 봅니다.');
assert.match(promptConnector, /Do not default to a Korean apartment interior/,
  '프롬프트 추출기가 아파트 실내 기본값을 차단하지 않습니다.');

const specSamples = Array.from({ length: 40 }, (_, i) => createSceneSpec(`${DIVERSITY_TOPICS[i % DIVERSITY_TOPICS.length]} ${i}번째 기록`));
const uniqueCount = (key) => new Set(specSamples.map(spec => spec[key]).filter(Boolean)).size;
assert.ok(uniqueCount('setting') >= 18, `장면 배경 다양성이 부족합니다: ${uniqueCount('setting')}`);
assert.ok(uniqueCount('light') >= 25, `조명 다양성이 부족합니다: ${uniqueCount('light')}`);
assert.ok(uniqueCount('camera') >= 25, `카메라 구도 다양성이 부족합니다: ${uniqueCount('camera')}`);
assert.equal(specSamples.every(spec => spec.harmony && spec.props && spec.emotion), true,
  'SceneSpec 핵심 필드가 본문 해시와 무관하게 채워지지 않습니다.');

console.log('✅ 콘텐츠 다양성 회귀 검사 통과: 24개 검색어 순환, 검색어별 생성, 12개 장면 순환, 공통 SceneSpec 배경·조명·구도 다양성, 로봇청소기 조건부 노출');
