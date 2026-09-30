import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function waitForServer(baseUrl, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  return (async function poll() {
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${baseUrl}/api/auth/status`, { cache: 'no-store' });
        if (res.status) return res;
      } catch {}
      await new Promise(r => setTimeout(r, 250));
    }
    throw new Error(`서버 기동 대기 시간 초과: ${baseUrl}`);
  })();
}

function startServer(env) {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: rootDir,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  return { child, getStderr: () => stderr };
}

async function stopServer(proc) {
  if (!proc || proc.exitCode !== null) return;
  proc.kill('SIGTERM');
  await new Promise(resolve => setTimeout(resolve, 300));
  if (proc.exitCode === null) proc.kill('SIGKILL');
}

async function withServer(env, fn) {
  const { child, getStderr } = startServer(env);
  try {
    const baseUrl = `http://127.0.0.1:${env.PORT}`;
    await waitForServer(baseUrl);
    await fn(baseUrl, getStderr);
  } finally {
    await stopServer(child);
  }
}

// ── 정적 구조 검사 (런타임 없이 소스 자체의 보안 경계 확인) ──
const serverSrc = fs.readFileSync(path.join(rootDir, 'server.mjs'), 'utf8');
const indexSrc = fs.readFileSync(path.join(rootDir, 'public', 'index.html'), 'utf8');
const envExample = fs.readFileSync(path.join(rootDir, '.env.example'), 'utf8');

assert.match(serverSrc, /DASHBOARD_ADMIN_PASSWORD/, '관리자 인증 환경변수 참조가 없습니다.');
assert.match(serverSrc, /SAFE_ROOT_HTML_FILES/, '프로젝트 루트 파일 허용 목록이 없습니다.');
assert.equal(serverSrc.includes('path.join(rootDir, pathname.replace'), false,
  '루트 파일을 임의로 정적 제공하는 기존 폴백이 남아 있습니다.');
assert.equal(indexSrc.includes('test_user@example.com'), false, '소스 HTML에 실제 계정 이메일이 노출돼 있습니다.');
assert.match(envExample, /DASHBOARD_ADMIN_PASSWORD/, '.env.example에 관리자 비밀번호 문서화가 없습니다.');

const runCase = async () => {
  const port = await getFreePort();
  const password = 'correct-horse-battery-staple-test';

  await withServer({
    PORT: String(port),
    DASHBOARD_ADMIN_PASSWORD: password,
    DASHBOARD_PUBLIC_ORIGIN: `http://127.0.0.1:${port}`
  }, async (baseUrl, getStderr) => {
    const get = async (p, headers = {}) => {
      const res = await fetch(`${baseUrl}${p}`, { headers, redirect: 'manual' });
      const text = await res.text();
      let body = null;
      try { body = JSON.parse(text); } catch {}
      return { status: res.status, text, headers: res.headers, body };
    };

    // 1. 미인증 API는 401, 코드를 명확히 반환
    const unauth = await get('/api/status');
    assert.equal(unauth.status, 401, `미인증 상태 API 401 기대, 실제 ${unauth.status}\n${getStderr()}`);
    assert.equal(unauth.body?.code, 'DASHBOARD_AUTH_REQUIRED', '미인증 코드가 명확하지 않습니다.');

    // 2. 프로젝트 루트 민감 파일은 정적 응답 대상이 아니어야 한다.
    for (const p of ['/package.json', '/content_vault.json', '/server.mjs', '/.env', '/CHANGELOG.md', '/system_logs.log', '/storage_state.json']) {
      const res = await get(p);
      assert.equal(res.status, 404, `${p}가 404가 아닌 ${res.status}로 노출됩니다.\n${getStderr()}`);
    }

    // 3. 정상 정적 경로와 허용 가이드는 그대로 제공
    assert.equal((await get('/')).status, 200, '대시보드 홈이 200이 아닙니다.');
    assert.equal((await get('/app.js')).status, 200, 'app.js가 200이 아닙니다.');
    assert.equal((await get('/INDEX_GUIDE.html')).status, 200, '허용 목록 가이드 HTML이 200이 아닙니다.');

    // 4. 보안 응답 헤더
    const home = await get('/');
    assert.equal(home.headers.get('x-content-type-options'), 'nosniff', 'nosniff 헤더가 없습니다.');
    assert.equal(home.headers.get('x-frame-options'), 'DENY', 'X-Frame-Options DENY가 없습니다.');
    assert.equal(home.text.includes('test_user@example.com'), false, '홈 HTML에 이메일이 노출됩니다.');

    // 5. 로그인 실패 → 401, 성공 → 세션 쿠키 + 인증 상태 200
    const badLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${port}` },
      body: JSON.stringify({ password: 'wrong' })
    });
    assert.equal(badLogin.status, 401, '잘못된 비밀번호는 401이어야 합니다.');

    const goodLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${port}` },
      body: JSON.stringify({ password })
    });
    assert.equal(goodLogin.status, 200, `올바른 로그인이 200이 아닙니다.\n${getStderr()}`);
    const setCookie = goodLogin.headers.get('set-cookie') || '';
    assert.match(setCookie, /threads_dashboard_session=/, '로그인 성공 시 세션 쿠키가 설정되지 않습니다.');
    assert.match(setCookie, /HttpOnly/, '세션 쿠키에 HttpOnly가 없습니다.');
    const sessionCookie = setCookie.split(';')[0];

    const authStatus = await get('/api/auth/status', { cookie: sessionCookie });
    assert.equal(authStatus.status, 200, '유효 세션 인증 상태 조회가 200이 아닙니다.');
    assert.equal(authStatus.body?.authenticated, true, '유효 세션이 authenticated로 판정되지 않습니다.');

    // 유효 세션이면 실제 제어 API도 200으로 열린다.
    const statusWithSession = await get('/api/status', { cookie: sessionCookie });
    assert.equal(statusWithSession.status, 200, '유효 세션으로 상태 API 접근이 200이 아닙니다.');

    // 6. 변경성 API는 출처(Origin)가 다르면 403
    const badOrigin = await fetch(`${baseUrl}/api/generate-image-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: sessionCookie, Origin: 'https://evil.example' },
      body: JSON.stringify({ postBody: '테스트' })
    });
    assert.equal(badOrigin.status, 403, '비허용 Origin 변경 요청이 403이 아닙니다.');

    // 7. JSON 본문 한도 초과는 413 (업로드 스트리밍과 무관한 애플리케이션 JSON 요청만)
    const hugeBody = 'a'.repeat(3 * 1024 * 1024);
    const tooLarge = await fetch(`${baseUrl}/api/generate-image-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: sessionCookie, Origin: `http://127.0.0.1:${port}` },
      body: hugeBody
    });
    assert.equal(tooLarge.status, 413, '초과 JSON 본문이 413이 아닙니다.');

    // 8. 로그인 속도 제한: 10회/15분 초과 시 429
    let sawRateLimit = false;
    for (let i = 0; i < 12; i++) {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${port}` },
        body: JSON.stringify({ password: 'wrong' })
      });
      if (res.status === 429) { sawRateLimit = true; break; }
    }
    assert.equal(sawRateLimit, true, '로그인 반복 시도가 429로 차단되지 않습니다.');
  });

  // ── 비밀번호 미설정 상태: 로컬 직접 접속만 허용, 프록시 헤드/원격은 503 ──
  const port2 = await getFreePort();
  await withServer({ PORT: String(port2), DASHBOARD_ADMIN_PASSWORD: '', DASHBOARD_PUBLIC_ORIGIN: '' }, async (baseUrl) => {
    const local = await fetch(`${baseUrl}/api/status`, { cache: 'no-store' });
    assert.equal(local.status, 200, '비밀번호 미설정 로컬 접속은 200이어야 합니다.');

    const spoofedRemote = await fetch(`${baseUrl}/api/status`, {
      cache: 'no-store',
      headers: { 'X-Forwarded-For': '203.0.113.9' }
    });
    assert.equal(spoofedRemote.status, 503, '프록시/원격 표식이 있는 요청은 503이어야 합니다.');

    const spoofedLocal = await fetch(`${baseUrl}/api/status`, {
      cache: 'no-store',
      headers: { 'X-Forwarded-For': '127.0.0.1' }
    });
    assert.equal(spoofedLocal.status, 503, 'X-Forwarded-For 위조로 로컬 우회가 허용됩니다.');
  });
};

await runCase();
console.log('✅ 대시보드 보안 회귀 검사 통과: 관리자 인증·세션·Origin, 루트 파일 비노출, XFF 위조 우회 차단, 본문 한도 413, 로그인 속도 제한');
