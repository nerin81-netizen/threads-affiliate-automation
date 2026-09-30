import readline from 'readline';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const envPath = path.join(rootDir, '.env');

dotenv.config({ path: envPath });

function clearScreen() {
  process.stdout.write('\x1Bc');
}

function ask(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => rl.question(query, ans => {
    rl.close();
    resolve(ans.trim());
  }));
}

function runNodeScript(scriptPath, args = []) {
  return new Promise((resolve) => {
    const proc = spawn('node', [scriptPath, ...args], {
      cwd: rootDir,
      stdio: 'inherit',
      shell: true
    });
    proc.on('close', resolve);
  });
}

async function showMenu() {
  while (true) {
    clearScreen();
    // 최신 .env 읽기
    dotenv.config({ path: envPath, override: true });
    const currentId = process.env.THREADS_ID || '(미설정)';

    console.log('================================================================');
    console.log('   🚀 EasyWorksLab 스레드(Threads) 핫딜 & 맞팔 자동화 봇');
    console.log('================================================================');
    console.log(`   현재 등록 계정: ${currentId}`);
    console.log('----------------------------------------------------------------');
    console.log('  [1] 🤝 #스팔 맞팔 늘리기 (안전 선팔 20명 자동 실행)');
    console.log('  [2] 🔥 토스 실시간 1위 핫딜 자동 포스팅 (본문 + 첫댓글 링크)');
    console.log('  [3] ⚡ 풀코스 자동 실행 (맞팔 15명 + 핫딜 자동 포스팅)');
    console.log('  [4] ⚙️  스레드 부계정 아이디 / 비밀번호 설정');
    console.log('  [5] 🌐 스레드 브라우저 창 직접 열기 (수동 확인용)');
    console.log('  [0] 종료');
    console.log('================================================================');

    const choice = await ask('👉 원하시는 작업 번호를 입력하세요 (0-5): ');

    if (choice === '1') {
      console.log('\n🚀 맞팔 늘리기 봇을 실행합니다...\n');
      await runNodeScript('scripts/threads_bot.mjs', ['--mode=grow']);
      await ask('\n⏎ 엔터를 누르면 메뉴로 돌아갑니다.');
    } else if (choice === '2') {
      console.log('\n🔥 토스 핫딜 포스팅 봇을 실행합니다...\n');
      await runNodeScript('scripts/threads_bot.mjs', ['--mode=post']);
      await ask('\n⏎ 엔터를 누르면 메뉴로 돌아갑니다.');
    } else if (choice === '3') {
      console.log('\n⚡ 풀코스 무인 자동화를 실행합니다...\n');
      await runNodeScript('scripts/threads_bot.mjs', ['--mode=all']);
      await ask('\n⏎ 엔터를 누르면 메뉴로 돌아갑니다.');
    } else if (choice === '4') {
      console.log('\n================================================================');
      console.log('⚙️ 스레드 부계정 정보 설정');
      console.log('================================================================');
      const id = await ask('👉 스레드(인스타) 아이디(username 또는 이메일): ');
      const pw = await ask('👉 스레드(인스타) 비밀번호: ');
      if (id && pw) {
        await runNodeScript('scripts/set_threads_account.mjs', [id, pw]);
      } else {
        console.log('⚠️ 아이디 또는 비밀번호가 입력되지 않았습니다.');
      }
      await ask('\n⏎ 엔터를 누르면 메뉴로 돌아갑니다.');
    } else if (choice === '5') {
      console.log('\n🌐 스레드 브라우저 창을 엽니다...\n');
      await runNodeScript('scripts/threads_bot.mjs', ['--mode=login']);
      await ask('\n⏎ 엔터를 누르면 메뉴로 돌아갑니다.');
    } else if (choice === '0') {
      console.log('\n프로그램을 종료합니다.');
      process.exit(0);
    } else {
      console.log('\n잘못된 입력입니다.');
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

showMenu();
