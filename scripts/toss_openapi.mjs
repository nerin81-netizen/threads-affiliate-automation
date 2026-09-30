import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(rootDir, '.env') });

const ACCESS_KEY = process.env.TOSS_SHARELINK_ACCESS_KEY;
const SECRET_KEY = process.env.TOSS_SHARELINK_SECRET_KEY;
const PUBLISHER_ID = process.env.TOSS_SHARELINK_PUBLISHER_ID;

const TOKEN_CACHE_FILE = path.join(rootDir, '.toss_token.json');

/**
 * 1. OAuth2 토큰 발급 및 캐시 관리
 */
export async function getAccessToken() {
  if (fs.existsSync(TOKEN_CACHE_FILE)) {
    try {
      const cached = JSON.parse(fs.readFileSync(TOKEN_CACHE_FILE, 'utf8'));
      const now = Math.floor(Date.now() / 1000);
      if (cached.access_token && cached.expires_at && cached.expires_at > now + 300) {
        return cached.access_token;
      }
    } catch (e) {}
  }

  if (!ACCESS_KEY || !SECRET_KEY) {
    throw new Error('.env에 TOSS_SHARELINK_ACCESS_KEY 및 TOSS_SHARELINK_SECRET_KEY 설정이 필요합니다.');
  }

  const tokenUrl = 'https://oauth2.cert.toss.im/token';
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: ACCESS_KEY,
    client_secret: SECRET_KEY,
    scope: 'sharelink:read sharelink:write'
  });

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`토큰 발급 실패 [HTTP ${res.status}]: ${errText}`);
  }

  const data = await res.json();
  const expiresAt = Math.floor(Date.now() / 1000) + (data.expires_in || 3600);

  fs.writeFileSync(TOKEN_CACHE_FILE, JSON.stringify({
    access_token: data.access_token,
    expires_at: expiresAt,
    issued_at: new Date().toISOString()
  }, null, 2));

  return data.access_token;
}

/**
 * 2. 헬스 체크
 */
export async function checkHealth(token) {
  const res = await fetch('https://sharelink.toss.im/openapi/health', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  return res.json();
}

/**
 * 3. 베스트 상품 목록 조회
 */
export async function getBestSellingProducts(token, size = 30) {
  const res = await fetch(`https://sharelink.toss.im/openapi/products/best-selling?size=${size}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) {
    throw new Error(`베스트 상품 조회 실패 [HTTP ${res.status}]: ${await res.text()}`);
  }
  return res.json();
}

/**
 * 4. 하루특가 상품 목록 조회
 */
export async function getTodayDeals(token) {
  const res = await fetch('https://sharelink.toss.im/openapi/products/today-deals', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) {
    throw new Error(`하루특가 상품 조회 실패 [HTTP ${res.status}]: ${await res.text()}`);
  }
  return res.json();
}

/**
 * 5. 쉐어링크 발급 (추적 단축 URL)
 */
export async function createShareLink(token, tacaItemId, publisherId = PUBLISHER_ID) {
  if (!publisherId) {
    throw new Error('publisherId (회원 연동 ID)가 지정되지 않았습니다.');
  }

  const res = await fetch('https://sharelink.toss.im/openapi/links', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      tacaItemId: Number(tacaItemId),
      publisherId: publisherId
    })
  });

  if (!res.ok) {
    throw new Error(`링크 발급 실패 [HTTP ${res.status}]: ${await res.text()}`);
  }
  return res.json();
}

// 직접 실행 시 테스트
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    try {
      console.log('🔑 1. 토스 쉐어링크 액세스 토큰 발급 중...');
      const token = await getAccessToken();
      console.log('✅ 토큰 발급 성공!');

      console.log('🏥 2. 헬스 체크 확인 중...');
      const health = await checkHealth(token);
      console.log('✅ 헬스 체크 결과:', JSON.stringify(health));

      console.log('🔥 3. 베스트 상품 10개 조회 중...');
      const best = await getBestSellingProducts(token, 10);
      console.log(`✅ 베스트 상품 ${best.success?.items?.length || 0}건 수신 완료`);

      if (best.success?.items?.length > 0) {
        const sampleItem = best.success.items[0];
        console.log(`\n📦 샘플 1위 상품: [${sampleItem.displayName}] (ID: ${sampleItem.tacaItemId}, 가격: ${sampleItem.displayPrice?.toLocaleString()}원)`);

        console.log('🔗 4. 샘플 상품 쉐어링크 발급 테스트...');
        const linkRes = await createShareLink(token, sampleItem.tacaItemId);
        console.log('🎉 쉐어링크 발급 성공!');
        console.log('   - 단축 URL (게시용):', linkRes.success?.shortUrl);
        console.log('   - 원본 URL:', linkRes.success?.originUrl);
      }
    } catch (e) {
      console.error('❌ 실행 중 오류 발생:', e.message);
    }
  })();
}
