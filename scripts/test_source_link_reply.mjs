/**
 * 출처 링크 첫 답글의 입력 가드 검증.
 * 잘못된 입력이 네트워크 호출까지 내려가면 엉뚱한 대상에 답글이 붙을 수 있으므로,
 * 호출 전에 전부 걸러지는지 확인한다. (모든 케이스가 API 호출 이전에 throw)
 *
 *   node scripts/test_source_link_reply.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishSourceLinkReply } from './rapport_reply_service.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(rootDir, p), 'utf8');

const ok = 'https://n.news.naver.com/article/001/0012345678';

// 1. 대상 게시물 ID가 없으면 발행하지 않는다
await assert.rejects(() => publishSourceLinkReply({ postId: '', link: ok }), /게시물 ID가 없습니다/);

// 2. 링크가 비었으면 발행하지 않는다 (빈 답글 방지)
await assert.rejects(() => publishSourceLinkReply({ postId: '123', link: '   ' }), /링크가 비어 있습니다/);

// 3. http(s)가 아닌 값은 거부한다 (본문 조각이 링크 자리에 새는 것 방지)
for (const bad of ['javascript:alert(1)', '기사 원문 참고', 'ftp://example.com/a']) {
  await assert.rejects(() => publishSourceLinkReply({ postId: '123', link: bad }), /http\(s\) URL이 아닙니다/);
}

// 4. 링크 답글은 반드시 내 루트 게시물로 제한된다
const service = read('scripts/rapport_reply_service.mjs');
const fn = service.slice(service.indexOf('export async function publishSourceLinkReply'));
assert.match(fn, /ownPostsOnly: true/, '링크 답글이 내 루트 게시물 제한 없이 발행됩니다.');

// 5. 본문에는 URL을 넣지 않는다 — 아웃링크 페널티 회피가 이 기능의 전제다
const server = read('server.mjs');
assert.equal(
  /newsPostBody\s*=\s*.*기사 원문/.test(server), false,
  '뉴스 본문에 기사 원문 URL이 다시 삽입되고 있습니다. (아웃링크 페널티)'
);
assert.match(server, /await attachSourceLinkReply\(\{ postId: result\.postId/,
  '링크 답글이 read-back 검증된 게시물 ID로 호출되지 않습니다.');

console.log('✅ 출처 링크 첫 답글 가드 검증 통과 (ID·빈값·스킴·소유권·본문 미삽입)');
