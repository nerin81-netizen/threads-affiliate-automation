import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');

const server = read('server.mjs');
const threadsApi = read('scripts/threads_api.mjs');
const replyApi = read('scripts/threads_reply_api.mjs');
const rapportService = read('scripts/rapport_reply_service.mjs');
const threadsBot = read('scripts/threads_bot.mjs');
const app = read('public/app.js');
const html = read('public/index.html');
const publishGuard = read('scripts/publish_guard.mjs');
const dbAdapter = read('scripts/db_adapter.mjs');

assert.equal(threadsApi.includes('reply_to_id'), false, '최상위 공식 API 코드에 reply_to_id가 들어갔습니다.');
assert.match(threadsApi, /export async function verifyPublishedThread/, '최상위 게시물의 사후 검증 함수가 없습니다.');
assert.match(threadsApi, /permalink: verified\?\.permalink \|\| null/, '발행 결과에 permalink가 반환되지 않습니다.');
assert.match(threadsApi, /verified: !!verified/, '발행 결과에 검증 상태가 반환되지 않습니다.');
assert.match(threadsApi, /err\.apiPath = pathname/, '공식 API 실패 단계가 오류에 기록되지 않습니다.');
assert.match(replyApi, /reply_to_id: replyToId/, '답글 전용 모듈에 reply_to_id가 없습니다.');
assert.match(replyApi, /ownPostsOnly = true/, '답글 대상의 내 루트 게시물 기본 제한이 없습니다.');
assert.match(replyApi, /target\.root_post/, '답글 대상의 루트 게시물 관계 확인이 없습니다.');
assert.match(replyApi, /root\.username !== me\.username/, '답글 루트 소유권 검증이 없습니다.');
assert.equal(server.includes('threads_reply_api.mjs'), false, '서버가 저수준 답글 모듈을 직접 가져오고 있습니다.');
assert.match(server, /from '\.\/scripts\/rapport_reply_service\.mjs'/,
  '서버가 공식 API 라포 안전 서비스를 가져오지 않습니다.');
assert.match(rapportService, /from '\.\/threads_reply_api\.mjs'/,
  '라포 서비스가 분리된 공식 답글 모듈을 사용하지 않습니다.');
assert.equal(rapportService.includes("from './threads_bot.mjs'"), false,
  '라포 서비스가 브라우저 게시 엔진과 혼합됐습니다.');
assert.equal(rapportService.includes("'/keyword_search'"), false,
  '포기한 threads_keyword_search 의존성이 라포 서비스에 남아 있습니다.');
assert.match(rapportService, /`\/\$\{rootPost\.id\}\/conversation`/,
  '라포 대상이 내 게시물의 공식 conversation에서 조회되지 않습니다.');
assert.match(rapportService, /threads_read_replies/,
  '인바운드 댓글 조회 권한 게이트가 없습니다.');
assert.match(rapportService, /ownPostsOnly: true/,
  '라포 서비스가 내 루트 게시물 제한을 해제하고 있습니다.');
assert.equal(rapportService.includes('ownPostsOnly: false'), false,
  '라포 서비스가 타인 루트 게시물 답글을 허용하고 있습니다.');
assert.match(server, /const NEWS_TARGET_COUNT = wantNews \? 5 : 0;/,
  '후보 생성의 뉴스 목표가 5개로 고정되지 않았습니다.');
assert.match(server, /const FLEX_TARGET_COUNT = TOTAL_CANDIDATE_COUNT - NEWS_TARGET_COUNT;/,
  '나머지 후보를 스토리·볼트 영역으로 분리하지 않았습니다.');
assert.match(server, /writeStoryPosts\(\[keyword\], 1\)/,
  '스토리 생성이 24개 순환 검색어별 1건 배분을 따르지 않습니다.');
assert.match(server, /FLEX_TARGET_COUNT - candidates\.length/,
  '스토리 부족분을 볼트가 보충하는 로직이 없습니다.');
assert.equal(server.includes("import { runAutoCommentBatch }"), false, '서버가 폐기된 브라우저 댓글 엔진을 다시 가져오고 있습니다.');
assert.equal(server.includes("pathname === '/api/run-auto-comment'"), false,
  '폐기된 자동 댓글 API가 서버에 남아 있습니다.');
assert.match(server, /pathname === '\/api\/run-rapport-replies'/,
  '공식 API 라포 답글 실행 라우트가 없습니다.');
assert.match(server, /pathname === '\/api\/rapport\/status'/,
  '라포 답글 권한·쿼터 상태 라우트가 없습니다.');
assert.match(threadsBot, /REPLY_COMPOSER_DETECTED/, '브라우저 발행의 답글 모달 감지 가드가 없습니다.');
assert.match(threadsBot, /TOP_LEVEL_COMPOSER_NOT_VERIFIED/, '새 글쓰기 모달의 긍정 검증 가드가 없습니다.');
assert.match(threadsBot, /composeDialog\.locator\('div\[contenteditable="true"\]'\)/,
  '브라우저 발행 에디터가 최상위 글쓰기 모달로 제한되지 않았습니다.');

const postSingleCardSource = threadsBot.slice(
  threadsBot.indexOf('export async function postSingleCard'),
  threadsBot.indexOf('export async function postHotDeal')
);
assert.equal(postSingleCardSource.includes('replyBtn'), false, '게시물 발행 경로에 답글 버튼 클릭이 남아 있습니다.');
assert.equal(postSingleCardSource.includes("keyboard.press('Control+Enter')"), false,
  '게시물 발행 경로에 범위가 불명확한 단축키 제출이 남아 있습니다.');
assert.equal((app.match(/addEventListener\('click', executePublish\)/g) || []).length, 1,
  '발행 핸들러가 중복 연결돼 있습니다.');
assert.equal(app.includes("fetch('/api/run-auto-comment'"), false, '프론트엔드에 폐기된 자동 댓글 API 호출이 남아 있습니다.');
assert.match(app, /fetch\('\/api\/run-rapport-replies'/,
  '프론트엔드가 공식 API 라포 답글을 호출하지 않습니다.');
assert.doesNotMatch(html, /id="btnRunAutoComment" disabled/,
  '라포 답글 버튼이 HTML에서 영구 비활성화되어 있습니다.');
assert.equal(html.includes('영구 차단'), false, 'UI에 영구 차단 문구가 남아 있습니다.');
assert.equal(html.includes('영구 비활성화'), false, 'UI에 영구 비활성화 문구가 남아 있습니다.');
assert.equal(server.includes('브라우저 방식으로 재시도합니다'), false,
  '공식 API 실패 뒤 브라우저 자동 재게시 문구가 남아 있습니다.');
assert.match(server, /status: 'verification_pending'/,
  '결과 불명 발행을 확인 대기로 보존하는 상태가 없습니다.');
assert.match(server, /maskCredential\(process\.env\.TOSS_SHARELINK_ACCESS_KEY\)/,
  '공개 설정 API가 제휴 API 키를 마스킹하지 않습니다.');
assert.match(server, /ALLOWED_ENV_KEYS\.has\(k\)/,
  '설정 저장 API의 환경변수 허용 목록이 없습니다.');
assert.match(publishGuard, /createHash\('sha256'\)/, '본문 기반 발행 중복 키가 없습니다.');
assert.match(publishGuard, /verification_pending/, '중단된 발행의 확인 대기 상태가 없습니다.');
assert.equal(/PG_PASSWORD\s*=\s*process\.env\.PGPASSWORD\s*\|\|\s*'[^']+'/.test(dbAdapter), false,
  'PostgreSQL 비밀번호 기본값이 소스에 남아 있습니다.');
assert.match(html, /id="pubFirstComment"[\s\S]{0,120}disabled/, '최상위 발행의 첫 댓글 입력창 분리가 해제됐습니다.');
assert.equal(fs.existsSync(path.join(rootDir, 'scripts/auto_comment_bot.mjs')), false,
  '폐기 대상인 브라우저 자동 댓글 차단 파일이 남아 있습니다.');

console.log('✅ 발행 안전 회귀 검사 통과: 최상위 게시·내 글 인바운드 답글 분리, 루트 소유권 제한, 브라우저 댓글 폐기');
