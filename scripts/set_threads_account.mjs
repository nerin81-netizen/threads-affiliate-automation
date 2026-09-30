import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../.env');

const id = process.argv[2];
const pw = process.argv[3];

if (!id || !pw) {
  console.log('사용법: node scripts/set_threads_account.mjs [아이디] [비밀번호]');
  process.exit(1);
}

let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

// 기존 THREADS_ID, THREADS_PW 교체 또는 추가
if (content.includes('THREADS_ID=')) {
  content = content.replace(/THREADS_ID=.*/g, `THREADS_ID=${id}`);
} else {
  content += `\nTHREADS_ID=${id}`;
}

if (content.includes('THREADS_PW=')) {
  content = content.replace(/THREADS_PW=.*/g, `THREADS_PW=${pw}`);
} else {
  content += `\nTHREADS_PW=${pw}`;
}

fs.writeFileSync(envPath, content.trim() + '\n', 'utf8');
console.log(`✅ 스레드 계정 정보가 .env에 성공적으로 저장되었습니다! (아이디: ${id})`);
