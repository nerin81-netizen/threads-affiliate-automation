import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const stateFile = path.join(os.tmpdir(), `threads-publish-guard-${process.pid}-${Date.now()}.json`);
process.env.PUBLISH_STATE_FILE = stateFile;

const { claimPublish, finishPublish } = await import('./publish_guard.mjs');

try {
  const first = claimPublish({ postBody: '같은 본문', mediaFiles: ['sample.png'] });
  assert.equal(first.allowed, true);

  const concurrent = claimPublish({ postBody: ' 같은   본문 ', mediaFiles: ['sample.png'] });
  assert.equal(concurrent.allowed, false, '진행 중인 동일 발행 요청이 다시 선점됐습니다.');
  assert.equal(concurrent.previous.status, 'verification_pending');

  assert.equal(finishPublish({
    key: first.key,
    attemptId: first.attemptId,
    status: 'published',
    postId: 'post-1',
    permalink: 'https://www.threads.net/@example/post/post-1'
  }), true);

  const duplicate = claimPublish({ postBody: '같은 본문', mediaFiles: ['sample.png'] });
  assert.equal(duplicate.allowed, false, '발행 완료된 동일 본문이 다시 선점됐습니다.');
  assert.equal(duplicate.previous.status, 'published');

  const held = claimPublish({ postBody: '인증 수정 뒤 재시도 가능한 본문' });
  assert.equal(held.allowed, true);
  finishPublish({ key: held.key, attemptId: held.attemptId, status: 'held_api', reason: '인증 보류' });
  assert.equal(claimPublish({ postBody: '인증 수정 뒤 재시도 가능한 본문' }).allowed, true);

  console.log('✅ 발행 가드 검사 통과: 동시 요청·완료·결과 불명 중복 차단, API 보류 수동 재시도 허용');
} finally {
  fs.rmSync(stateFile, { force: true });
  fs.rmSync(`${stateFile}.${process.pid}.tmp`, { force: true });
}
