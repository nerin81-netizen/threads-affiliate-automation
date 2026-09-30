import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const DB_FILE = path.join(rootDir, 'system_logs.db');
const TEXT_LOG_FILE = path.join(rootDir, 'system_logs.log');

let db = null;
let insertStmt = null;

/**
 * SQLite 데이터베이스 초기화 (Node.js 내장 node:sqlite 활용)
 */
export async function initLoggerDb() {
  try {
    const { DatabaseSync } = await import('node:sqlite');
    db = new DatabaseSync(DB_FILE);

    // 테이블 생성
    db.exec(`
      CREATE TABLE IF NOT EXISTS system_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        time_label TEXT NOT NULL,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        source TEXT DEFAULT 'server',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_logs_created ON system_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_logs_type ON system_logs(type);
    `);

    insertStmt = db.prepare(`
      INSERT INTO system_logs (timestamp, time_label, type, message, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    console.log(`[DB] 시스템 로그 영속성 SQLite DB 초기화 완료: ${DB_FILE}`);
  } catch (err) {
    console.error(`[DB 경고] SQLite 초기화 실패, JSON 파일 로깅으로 대체: ${err.message}`);
    db = null;
  }
}

/**
 * 로그 기록 (SQLite DB + 백업 텍스트 파일)
 */
export function saveLog(message, type = 'info', source = 'server') {
  const now = new Date();
  const timestamp = now.toISOString();
  const timeLabel = now.toLocaleTimeString('ko-KR');
  const createdAt = now.getTime();

  // 1. SQLite DB에 기록
  if (db && insertStmt) {
    try {
      insertStmt.run(timestamp, timeLabel, type, message, source, createdAt);
    } catch (e) {
      console.error('[DB 오류] 로그 INSERT 실패:', e.message);
    }
  }

  // 2. 파일 시스템 system_logs.log에 동시 기록 (백업)
  try {
    const logLine = `[${timestamp}] [${type.toUpperCase()}] [${source}] ${message}\n`;
    fs.appendFileSync(TEXT_LOG_FILE, logLine, 'utf8');
  } catch (e) {}

  return {
    timestamp: timeLabel,
    isoTime: timestamp,
    type,
    message,
    source
  };
}

/**
 * 최근 로그 조회 (새로고침 시 복원용)
 */
export function getRecentLogs(limit = 200, filterType = null) {
  if (!db) {
    // DB가 없는 경우 백업 텍스트 파일의 마지막 라인들 읽기
    return getLogsFromTextFile(limit, filterType);
  }

  try {
    let query = `SELECT id, timestamp, time_label as timeLabel, type, message, source, created_at 
                 FROM system_logs`;
    const params = [];

    if (filterType && filterType !== 'all') {
      query += ` WHERE type = ?`;
      params.push(filterType);
    }

    query += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);

    const stmt = db.prepare(query);
    const rows = stmt.all(...params);

    // 오래된 순 -> 최신순으로 정렬하여 반환 (터미널 뷰용)
    return rows.reverse().map(row => ({
      id: row.id,
      timestamp: row.timeLabel || row.timestamp,
      isoTime: row.timestamp,
      type: row.type,
      message: row.message,
      source: row.source
    }));
  } catch (e) {
    console.error('[DB 오류] 로그 조회 실패:', e.message);
    return getLogsFromTextFile(limit, filterType);
  }
}

/**
 * 로그 통계 정보
 */
export function getLogStats() {
  if (!db) {
    return { total: 0, today: 0, errorCount: 0, successCount: 0 };
  }

  try {
    const totalRow = db.prepare(`SELECT COUNT(*) as count FROM system_logs`).get();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const todayRow = db.prepare(`SELECT COUNT(*) as count FROM system_logs WHERE created_at >= ?`).get(startOfToday.getTime());
    const errorRow = db.prepare(`SELECT COUNT(*) as count FROM system_logs WHERE type IN ('error', 'warning')`).get();
    const successRow = db.prepare(`SELECT COUNT(*) as count FROM system_logs WHERE type = 'success'`).get();

    return {
      total: totalRow?.count || 0,
      today: todayRow?.count || 0,
      errorCount: errorRow?.count || 0,
      successCount: successRow?.count || 0
    };
  } catch (e) {
    return { total: 0, today: 0, errorCount: 0, successCount: 0 };
  }
}

/**
 * 로그 전체 비우기
 */
export function clearLogs() {
  if (db) {
    try {
      db.exec(`DELETE FROM system_logs; VACUUM;`);
    } catch (e) {
      console.error('[DB 오류] 로그 삭제 실패:', e.message);
    }
  }

  try {
    fs.writeFileSync(TEXT_LOG_FILE, `[${new Date().toISOString()}] [SYSTEM] 로그가 사용자에 의해 초기화되었습니다.\n`, 'utf8');
  } catch (e) {}

  return { success: true };
}

/**
 * 텍스트 파일 대체 조회 헬퍼
 */
function getLogsFromTextFile(limit = 100, filterType = null) {
  if (!fs.existsSync(TEXT_LOG_FILE)) return [];
  try {
    const content = fs.readFileSync(TEXT_LOG_FILE, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    const sliced = lines.slice(-limit);

    return sliced.map(line => {
      const match = line.match(/^\[(.*?)\] \[(.*?)\] \[(.*?)\] (.*)$/);
      if (match) {
        return {
          timestamp: new Date(match[1]).toLocaleTimeString('ko-KR'),
          isoTime: match[1],
          type: match[2].toLowerCase(),
          source: match[3],
          message: match[4]
        };
      }
      return { timestamp: '-', type: 'info', message: line, source: 'system' };
    }).filter(item => !filterType || filterType === 'all' || item.type === filterType);
  } catch (e) {
    return [];
  }
}
