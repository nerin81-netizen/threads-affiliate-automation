/**
 * Azure PostgreSQL Flexible Server & Azure Blob Storage 통합 어댑터
 * - PostgreSQL: 볼트, 발행 포스트, 라포 댓글, 실시간 로그 영구 관리
 * - Blob Storage: 4:5 카드 이미지 및 비디오 에셋 CDN 영구 저장 및 Threads 공식 Graph API 공개 URL 제공
 */
import pg from 'pg';
import { BlobServiceClient } from '@azure/storage-blob';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(rootDir, '.env') });

const { Pool } = pg;

// 1. PostgreSQL 설정
const PG_HOST = process.env.PGHOST || 'psql-hermes-azure.postgres.database.azure.com';
const PG_USER = process.env.PGUSER || 'hermesadmin';
const PG_DB = process.env.PGDATABASE || 'prompt_daily';
const PG_PASSWORD = process.env.PGPASSWORD || '';
const PG_PORT = parseInt(process.env.PGPORT || '5432', 10);

let pool = null;
let isPgConnected = false;

// 2. Azure Blob Storage 설정
// 연결문자열은 .env(AZURE_STORAGE_CONNECTION_STRING)에서만 읽는다.
// 소스에 키를 두지 않는다 — Key Vault: kv-hermes-azure / AZURE-STORAGE-CONNECTION-STRING
const STORAGE_CONN_STR = process.env.AZURE_STORAGE_CONNECTION_STRING || '';
const CONTAINER_NAME = process.env.AZURE_STORAGE_CONTAINER || 'threads-media';

let blobServiceClient = null;
let containerClient = null;

/** Azure Blob Storage 클라이언트 초기화 */
export function initBlobStorage() {
  try {
    if (!STORAGE_CONN_STR) {
      console.error('[Blob] AZURE_STORAGE_CONNECTION_STRING 미설정 — Blob 업로드가 비활성화됩니다.');
      return null;
    }
    if (!blobServiceClient) {
      blobServiceClient = BlobServiceClient.fromConnectionString(STORAGE_CONN_STR);
      containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
    }
    return containerClient;
  } catch (err) {
    console.error('[Blob] Azure Blob Storage 초기화 실패:', err.message);
    return null;
  }
}

/** 
 * 로컬 미디어 파일 또는 버퍼를 Azure Blob Storage에 업로드하고 공개 URL을 반환
 * Meta 공식 Threads Graph API는 공개 URL을 필수로 요구함
 */
export async function uploadMediaToBlob(filePathOrBuffer, fileName, contentType = 'image/png') {
  const container = initBlobStorage();
  if (!container) throw new Error('Blob Storage 클라이언트가 준비되지 않았습니다.');

  try {
    // 컨테이너가 없으면 공개 blob 읽기 권한으로 생성
    await container.createIfNotExists({ access: 'blob' });

    const blobClient = container.getBlockBlobClient(fileName);

    let dataBuffer;
    if (Buffer.isBuffer(filePathOrBuffer)) {
      dataBuffer = filePathOrBuffer;
    } else {
      dataBuffer = fs.readFileSync(filePathOrBuffer);
    }

    await blobClient.uploadData(dataBuffer, {
      blobHTTPHeaders: {
        blobContentType: contentType,
        blobCacheControl: 'public, max-age=31536000'
      }
    });

    console.log(`☁️ [Azure Blob] 미디어 업로드 성공: ${blobClient.url}`);
    return blobClient.url;
  } catch (err) {
    console.error(`❌ [Azure Blob] 업로드 오류 (${fileName}):`, err.message);
    throw err;
  }
}

/** PostgreSQL 연결 및 스키마 초기화 */
export async function initPostgres() {
  if (pool) return isPgConnected;

  if (!PG_PASSWORD) {
    console.warn('⚠️ [Azure PostgreSQL] PGPASSWORD 미설정 — 로컬 파일 시스템 모드로 유지합니다.');
    return false;
  }

  try {
    pool = new Pool({
      host: PG_HOST,
      user: PG_USER,
      database: PG_DB,
      password: PG_PASSWORD,
      port: PG_PORT,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 8000
    });

    const client = await pool.connect();
    console.log(`🗄️ [Azure PostgreSQL] DB 연결 성공 (${PG_HOST}/${PG_DB})`);
    isPgConnected = true;

    // 테이블 자동 생성
    await client.query(`
      CREATE TABLE IF NOT EXISTS threads_vault (
        id VARCHAR(64) PRIMARY KEY,
        category VARCHAR(64) NOT NULL,
        hook TEXT NOT NULL,
        body TEXT NOT NULL,
        topic_tag VARCHAR(64),
        posted BOOLEAN DEFAULT false,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS threads_posts (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255),
        body TEXT NOT NULL,
        media_urls TEXT[],
        meta_post_id VARCHAR(128),
        status VARCHAR(32) DEFAULT 'success',
        error_msg TEXT,
        published_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS threads_comments (
        id SERIAL PRIMARY KEY,
        post_url TEXT,
        author_name VARCHAR(128),
        comment_text TEXT NOT NULL,
        followed BOOLEAN DEFAULT false,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS threads_system_logs (
        id SERIAL PRIMARY KEY,
        message TEXT NOT NULL,
        type VARCHAR(32) DEFAULT 'info',
        source VARCHAR(64) DEFAULT 'server',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS threads_safety_stats (
        stat_date DATE PRIMARY KEY,
        follow_count INT DEFAULT 0,
        post_count INT DEFAULT 0,
        comment_count INT DEFAULT 0,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    client.release();

    // 기존 로컬 파일 시딩(마이그레이션)
    await seedVaultFromLocal();
    await seedCommentsFromLocal();

    return true;
  } catch (err) {
    console.warn(`⚠️ [Azure PostgreSQL] 연결 불가, 로컬 파일 시스템 모드로 유지합니다: ${err.message}`);
    isPgConnected = false;
    return false;
  }
}

/** 로컬 content_vault.json 데이터를 PostgreSQL로 시딩 */
async function seedVaultFromLocal() {
  if (!isPgConnected || !pool) return;
  try {
    const vaultPath = path.join(rootDir, 'content_vault.json');
    if (!fs.existsSync(vaultPath)) return;

    const res = await pool.query('SELECT COUNT(*) FROM threads_vault');
    const count = parseInt(res.rows[0].count, 10);
    if (count > 0) return; // 이미 데이터가 있으면 건너뜀

    const rawData = JSON.parse(fs.readFileSync(vaultPath, 'utf8'));
    // 객체 형태 {"0": {...}, "1": {...}} 또는 배열 지원
    const vaultList = Array.isArray(rawData) ? rawData : (rawData.vault || Object.values(rawData));
    if (!vaultList.length) return;

    console.log(`🌱 [PostgreSQL] 로컬 볼트 데이터(${vaultList.length}건)를 Azure DB로 시딩합니다...`);
    for (const item of vaultList) {
      if (!item || !item.id) continue;
      const body = item.body || item.postText || '';
      const hook = item.hook || item.hookType || (body.split('\n')[0] || '');
      const tag = item.topic_tag || (item.tags && item.tags[0] ? item.tags[0].replace(/^#/, '') : null);
      const isPosted = item.posted === true || item.status === 'POSTED';

      await pool.query(
        `INSERT INTO threads_vault (id, category, hook, body, topic_tag, posted)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO NOTHING`,
        [item.id, item.category || '일상', hook, body, tag, isPosted]
      );
    }
    console.log(`✅ [PostgreSQL] 볼트 ${vaultList.length}건 시딩 완료!`);
  } catch (err) {
    console.warn('볼트 시딩 오류:', err.message);
  }
}

/** 로컬 comments_history.json 데이터를 PostgreSQL로 시딩 */
async function seedCommentsFromLocal() {
  if (!isPgConnected || !pool) return;
  try {
    const histPath = path.join(rootDir, 'comments_history.json');
    if (!fs.existsSync(histPath)) return;

    const res = await pool.query('SELECT COUNT(*) FROM threads_comments');
    const count = parseInt(res.rows[0].count, 10);
    if (count > 0) return;

    const history = JSON.parse(fs.readFileSync(histPath, 'utf8'));
    if (!Array.isArray(history) || !history.length) return;

    console.log(`🌱 [PostgreSQL] 댓글 히스토리(${history.length}건)를 Azure DB로 시딩합니다...`);
    for (const c of history) {
      await pool.query(
        `INSERT INTO threads_comments (post_url, author_name, comment_text, followed, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [c.postUrl || null, c.authorName || c.targetAuthor || null, c.commentText || c.text || '', !!c.followed, c.createdAt || new Date()]
      );
    }
    console.log(`✅ [PostgreSQL] 댓글 히스토리 ${history.length}건 시딩 완료!`);
  } catch (err) {
    console.warn('댓글 시딩 오류:', err.message);
  }
}

// ── 로컬 볼트 파일 공용 헬퍼 ──
// content_vault.json은 {"0": {...}, "1": {...}} 형태의 "숫자 키 객체"다.
// (과거 코드가 data.vault 배열을 가정해 로컬 동기화가 조용히 실패하던 버그의 원인)

function vaultFilePath() {
  return path.join(rootDir, 'content_vault.json');
}

/** 로컬 볼트 파일을 원본(키 보존) 형태로 읽는다. 없으면 {} */
function readVaultRaw() {
  const p = vaultFilePath();
  if (!fs.existsSync(p)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (Array.isArray(parsed)) {
      // 배열이면 인덱스 키 객체로 정규화
      const obj = {};
      parsed.forEach((v, i) => { obj[String(i)] = v; });
      return obj;
    }
    if (parsed && Array.isArray(parsed.vault)) {
      const obj = {};
      parsed.vault.forEach((v, i) => { obj[String(i)] = v; });
      return obj;
    }
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** 로컬 볼트 객체를 원자적으로 저장한다. */
function writeVaultRaw(vaultObj) {
  const p = vaultFilePath();
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(vaultObj, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

/** 로컬 볼트 객체에서 id에 해당하는 키를 찾는다. */
function findVaultKey(vaultObj, vaultId) {
  return Object.keys(vaultObj).find(k => vaultObj[k] && vaultObj[k].id === vaultId);
}

// ── DB 쿼리 인터페이스 (로컬 폴백 포함) ──

/** 볼트 목록 조회 */
export async function getVaultPosts(category = '') {
  if (isPgConnected && pool) {
    try {
      let query = 'SELECT id, category, hook, body, topic_tag, posted FROM threads_vault';
      const params = [];
      if (category) {
        query += ' WHERE category = $1';
        params.push(category);
      }
      query += ' ORDER BY created_at ASC';
      const res = await pool.query(query, params);
      return res.rows.map(r => ({
        id: r.id,
        category: r.category,
        hook: r.hook,
        body: r.body,
        topic_tag: r.topic_tag,
        posted: r.posted
      }));
    } catch (err) {
      console.warn('PG 조회 실패, 로컬 파일 폴백:', err.message);
    }
  }

  // 폴백
  try {
    const vaultPath = path.join(rootDir, 'content_vault.json');
    if (!fs.existsSync(vaultPath)) return [];
    const rawData = JSON.parse(fs.readFileSync(vaultPath, 'utf8'));
    let list = Array.isArray(rawData) ? rawData : (rawData.vault || Object.values(rawData));
    if (category) list = list.filter(v => v.category === category);
    return list.map(v => ({
      id: v.id,
      category: v.category,
      hook: v.hook || v.hookType || '',
      body: v.body || v.postText || '',
      topic_tag: v.topic_tag || (v.tags && v.tags[0] ? v.tags[0].replace(/^#/, '') : null),
      posted: v.posted === true || v.status === 'POSTED'
    }));
  } catch {
    return [];
  }
}

/** 볼트 발행 완료 마킹 */
export async function markVaultAsPosted(vaultId) {
  if (isPgConnected && pool) {
    try {
      await pool.query('UPDATE threads_vault SET posted = true, updated_at = NOW() WHERE id = $1', [vaultId]);
    } catch (err) {
      console.warn('PG 볼트 마킹 실패:', err.message);
    }
  }
  // 로컬 파일 동기화 — 화면이 읽는 content_vault.json을 항상 최신으로 유지한다.
  // 과거에는 data.vault 배열을 가정해 숫자 키 구조를 농쳐 발행해도 READY로 남는 버그가 있었다.
  try {
    const vault = readVaultRaw();
    const key = findVaultKey(vault, vaultId);
    if (key) {
      vault[key] = { ...vault[key], posted: true, status: 'POSTED', postedAt: new Date().toISOString() };
      writeVaultRaw(vault);
    }
  } catch (err) {
    console.warn('로컬 볼트 마킹 실패:', err.message);
  }
}

/**
 * 볼트 항목 생성/수정(upsert).
 * item: { id?, category, hookType, postText, tags, status }
 * id가 없으면 새 항목을 생성하고, 있으면 해당 항목을 덮어쓴다.
 * DB 연결 상태면 threads_vault에도 반영한다.
 */
export async function upsertVaultItem(item = {}) {
  const vault = readVaultRaw();
  const now = new Date().toISOString();
  let id = item.id;
  let key = id ? findVaultKey(vault, id) : undefined;
  const isNew = !key;

  if (isNew) {
    id = id || `content_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    // 새 키는 기존 숫자 키 최댓값 +1 로 부여
    const numericKeys = Object.keys(vault).map(k => parseInt(k, 10)).filter(n => !Number.isNaN(n));
    key = String(numericKeys.length ? Math.max(...numericKeys) + 1 : 0);
  }

  const prev = (!isNew && vault[key]) ? vault[key] : {};
  const merged = {
    ...prev,
    id,
    category: item.category !== undefined ? item.category : (prev.category || '기타'),
    hookType: item.hookType !== undefined ? item.hookType : (prev.hookType || ''),
    postText: item.postText !== undefined ? item.postText : (prev.postText || ''),
    tags: Array.isArray(item.tags) ? item.tags : (prev.tags || []),
    status: item.status !== undefined ? item.status : (prev.status || 'READY'),
    postedAt: prev.postedAt !== undefined ? prev.postedAt : null,
    updatedAt: now
  };
  if (isNew) merged.createdAt = now;
  vault[key] = merged;
  writeVaultRaw(vault);

  // DB 동기화
  if (isPgConnected && pool) {
    try {
      const body = merged.postText || '';
      const hook = merged.hookType || (body.split('\n')[0] || '');
      const tag = Array.isArray(merged.tags) && merged.tags[0] ? String(merged.tags[0]).replace(/^#/, '') : null;
      const isPosted = merged.posted === true || merged.status === 'POSTED';
      await pool.query(
        `INSERT INTO threads_vault (id, category, hook, body, topic_tag, posted, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (id) DO UPDATE
           SET category = EXCLUDED.category, hook = EXCLUDED.hook, body = EXCLUDED.body,
               topic_tag = EXCLUDED.topic_tag, posted = EXCLUDED.posted, updated_at = NOW()`,
        [merged.id, merged.category || '기타', hook, body, tag, isPosted]
      );
    } catch (err) {
      console.warn('PG 볼트 upsert 실패:', err.message);
    }
  }

  return merged;
}

/**
 * 볼트 항목 삭제(소프트 삭제). status='DELETED'로 표시해 복구 가능하게 한다.
 * hard=true면 완전 제거.
 */
export async function deleteVaultItem(vaultId, { hard = false } = {}) {
  const vault = readVaultRaw();
  const key = findVaultKey(vault, vaultId);
  if (!key) return false;

  if (hard) {
    delete vault[key];
  } else {
    vault[key] = { ...vault[key], status: 'DELETED', deletedAt: new Date().toISOString() };
  }
  writeVaultRaw(vault);

  if (isPgConnected && pool) {
    try {
      if (hard) {
        await pool.query('DELETE FROM threads_vault WHERE id = $1', [vaultId]);
      } else {
        // threads_vault에는 상태 컬럼이 없으므로 소프트 삭제는 posted 플래그로만 구분하지 않고
        // 로컬 파일이 상태의 진실 공급원(source of truth)이므로 버리지만 유지를 위해 그대로 둔다.
        // (DB에서도 지우려면 hard 삭제를 사용)
      }
    } catch (err) {
      console.warn('PG 볼트 삭제 실패:', err.message);
    }
  }
  return true;
}

/** 삭제된 볼트 항목을 복구한다. 발행된 적 없으면 READY로 되돌린다. */
export async function restoreVaultItem(vaultId) {
  const vault = readVaultRaw();
  const key = findVaultKey(vault, vaultId);
  if (!key) return false;
  const wasPosted = vault[key].posted === true || vault[key].postedAt;
  vault[key] = { ...vault[key], status: wasPosted ? 'POSTED' : 'READY' };
  delete vault[key].deletedAt;
  writeVaultRaw(vault);
  return true;
}

/** 발행 게시물 이력 저장 */
export async function savePublishedPost({ title, body, mediaUrls = [], metaPostId = null, status = 'success', errorMsg = null }) {
  if (isPgConnected && pool) {
    try {
      const res = await pool.query(
        `INSERT INTO threads_posts (title, body, media_urls, meta_post_id, status, error_msg)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [title, body, mediaUrls, metaPostId, status, errorMsg]
      );
      return res.rows[0].id;
    } catch (err) {
      console.warn('PG 포스트 저장 실패:', err.message);
    }
  }
  return null;
}

/** 시스템 로그 저장 */
export async function logToPostgres(message, type = 'info', source = 'server') {
  if (isPgConnected && pool) {
    try {
      await pool.query(
        'INSERT INTO threads_system_logs (message, type, source) VALUES ($1, $2, $3)',
        [message, type, source]
      );
    } catch {}
  }
}

/** 라포 댓글 기록 저장 */
export async function recordCommentActivity({ postUrl, authorName, commentText, followed = false }) {
  if (isPgConnected && pool) {
    try {
      await pool.query(
        `INSERT INTO threads_comments (post_url, author_name, comment_text, followed)
         VALUES ($1, $2, $3, $4)`,
        [postUrl, authorName, commentText, followed]
      );
    } catch (err) {
      console.warn('PG 댓글 기록 실패:', err.message);
    }
  }
}

export function getPool() {
  return pool;
}
