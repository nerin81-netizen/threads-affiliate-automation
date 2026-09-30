/**
 * 발행 요청의 로컬 영속 중복 방지 장치.
 *
 * 본문과 첨부 파일명이 같은 요청은 하나의 키로 묶는다. 프로세스가 발행 도중
 * 종료되면 다음 기동에서 해당 요청을 자동 재발행하지 않고 확인 대기로 남긴다.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE_FILE = process.env.PUBLISH_STATE_FILE
  ? path.resolve(process.env.PUBLISH_STATE_FILE)
  : path.join(rootDir, '.publish_attempts.json');
const ACTIVE_STATES = new Set(['publishing', 'published', 'verification_pending']);

function readState() {
  if (!fs.existsSync(STATE_FILE)) return { version: 1, attempts: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return parsed && parsed.attempts ? parsed : { version: 1, attempts: {} };
  } catch {
    return { version: 1, attempts: {} };
  }
}

function writeState(state) {
  const tempPath = `${STATE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tempPath, STATE_FILE);
}

export function createPublishKey(postBody, mediaFiles = []) {
  const normalizedBody = String(postBody || '').trim().replace(/\s+/g, ' ');
  const normalizedMedia = [...mediaFiles]
    .map(file => path.basename(String(file || '')).toLowerCase())
    .filter(Boolean)
    .sort();
  return crypto.createHash('sha256')
    .update(JSON.stringify({ body: normalizedBody, media: normalizedMedia }))
    .digest('hex');
}

export function claimPublish({ postBody, mediaFiles = [] }) {
  const state = readState();
  const key = createPublishKey(postBody, mediaFiles);
  const previous = state.attempts[key];

  if (previous?.status === 'publishing') {
    previous.status = 'verification_pending';
    previous.updatedAt = new Date().toISOString();
    previous.reason = '이전 프로세스가 발행 결과를 확정하지 못했습니다.';
    writeState(state);
  }

  if (previous && ACTIVE_STATES.has(previous.status)) {
    return { allowed: false, key, previous };
  }

  const attemptId = crypto.randomUUID();
  state.attempts[key] = {
    attemptId,
    status: 'publishing',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    bodyPreview: String(postBody || '').trim().replace(/\s+/g, ' ').slice(0, 80)
  };
  writeState(state);
  return { allowed: true, key, attemptId };
}

export function finishPublish({ key, attemptId, status, postId = null, permalink = null, reason = null }) {
  const state = readState();
  const current = state.attempts[key];
  if (!current || current.attemptId !== attemptId) return false;

  state.attempts[key] = {
    ...current,
    status,
    postId,
    permalink,
    reason,
    updatedAt: new Date().toISOString()
  };
  writeState(state);
  return true;
}
