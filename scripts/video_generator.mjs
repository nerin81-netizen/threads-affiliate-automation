/**
 * 동영상 생성 모듈 — 두 가지 방식을 제공한다.
 *
 *  1) motion (기본, 비용 0): 이미지 한 장에 Ken Burns 모션(줌/팬/페이드)을 입혀
 *     Playwright 화면 녹화로 숏폼 영상(webm)을 만든다. 추가 API 비용이 없다.
 *
 *  2) veo (선택, 유료): Google Veo Image-to-Video. 유나 이미지를 첫 프레임으로
 *     넣고 실제로 움직이는 영상을 만든다. VEO_API_KEY가 있어야 동작하며,
 *     없으면 호출하지 않고 명확히 안내만 한다(비용 발생 안 함).
 *
 * 설계 원칙: 이미지 생성(scene_illustrator)과 분리한다. 동영상은 "이미 만들어진
 * 이미지 한 장"을 입력으로 받아 움직이게 만드는 역할만 한다.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(rootDir, '.env') });

const UPLOAD_DIR = path.join(rootDir, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// 4:5 세로 숏폼
export const VIDEO_WIDTH = 1080;
export const VIDEO_HEIGHT = 1350;

/** Ken Burns 모션 프리셋. 각 값은 CSS keyframe으로 전개된다. */
const MOTION_PRESETS = {
  zoomIn:  { from: 'scale(1.0) translate(0,0)',      to: 'scale(1.12) translate(0,-2%)' },
  zoomOut: { from: 'scale(1.12) translate(0,-2%)',   to: 'scale(1.0) translate(0,0)' },
  panLeft: { from: 'scale(1.12) translate(3%,0)',    to: 'scale(1.12) translate(-3%,0)' },
  panUp:   { from: 'scale(1.12) translate(0,3%)',    to: 'scale(1.1) translate(0,-3%)' }
};

function pickMotion() {
  const keys = Object.keys(MOTION_PRESETS);
  return MOTION_PRESETS[keys[Math.floor(Math.random() * keys.length)]];
}

/**
 * 이미지 한 장 → Ken Burns 모션 숏폼 영상(webm). 비용 0.
 * @param {string} imagePath 원본 이미지 절대경로
 * @param {object} opts { durationMs=4000, motion }
 * @returns {Promise<{fileName,filePath,fileSize,type,mode,durationMs}>}
 */
export async function generateMotionVideo(imagePath, opts = {}) {
  if (!imagePath || !fs.existsSync(imagePath)) {
    throw new Error(`모션 영상 원본 이미지를 찾을 수 없음: ${imagePath}`);
  }
  const durationMs = opts.durationMs || 4000;
  const motion = opts.motion || pickMotion();

  // 이미지를 data URI로 인라인 (파일 경로 이슈 회피)
  const ext = path.extname(imagePath).slice(1).toLowerCase();
  const mime = ext === 'jpg' ? 'jpeg' : ext;
  const dataUri = `data:image/${mime};base64,${fs.readFileSync(imagePath).toString('base64')}`;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { background:#000; overflow:hidden; width:${VIDEO_WIDTH}px; height:${VIDEO_HEIGHT}px; }
    .stage { width:100%; height:100%; overflow:hidden; position:relative; }
    .stage img {
      width:100%; height:100%; object-fit:cover; transform-origin:center center;
      animation: kenburns ${durationMs}ms cubic-bezier(0.33, 0, 0.2, 1) forwards, fade 900ms ease-out;
    }
    @keyframes kenburns { 0% { transform:${motion.from}; } 100% { transform:${motion.to}; } }
    @keyframes fade { 0% { opacity:0; } 100% { opacity:1; } }
  </style></head><body>
    <div class="stage"><img src="${dataUri}"></div>
  </body></html>`;

  const tempDir = path.join(UPLOAD_DIR, `temp_rec_${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });
  const finalFileName = `video_motion_${Date.now()}.webm`;
  const finalPath = path.join(UPLOAD_DIR, finalFileName);

  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  try {
    const context = await browser.newContext({
      recordVideo: { dir: tempDir, size: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT } },
      viewport: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT }
    });
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(durationMs + 300);
    await page.close();
    await context.close();

    const files = fs.readdirSync(tempDir).filter(f => f.endsWith('.webm'));
    if (!files.length) throw new Error('비디오 레코딩 파일 생성 실패');
    fs.renameSync(path.join(tempDir, files[0]), finalPath);
    fs.rmSync(tempDir, { recursive: true, force: true });

    const stat = fs.statSync(finalPath);
    return {
      success: true,
      fileName: finalFileName,
      filePath: finalPath,
      fileSize: stat.size,
      type: 'video',
      mode: 'motion',
      durationMs
    };
  } finally {
    await browser.close();
  }
}

/** Veo 사용 가능 여부 (키 존재만 확인, 비용 발생 없음) */
export function isVeoAvailable() {
  return !!process.env.VEO_API_KEY;
}

/** 본문 → Veo용 "움직임/카메라" 프롬프트. 얼굴은 참조가 고정하므로 동작만 지시. */
export function buildVeoMotionPrompt(text = '') {
  // 얼굴/정체성은 첫 프레임 이미지가 고정한다. 여기선 자연스러운 미세 모션만.
  return [
    'The person in the reference image keeps the exact same face, hair, and outfit.',
    'Add subtle, natural motion: gentle eye blinks, soft breathing, slight head tilt,',
    'hair swaying slightly in a soft breeze, delicate ambient light shift.',
    'Cinematic shallow depth of field, smooth slow subtle camera zoom-in, 4K, fluid 60fps.',
    'No text, no watermark, no logo. Keep facial features perfectly consistent.'
  ].join(' ');
}

/**
 * Veo Image-to-Video 생성 (스캐폴딩).
 * VEO_API_KEY가 없으면 호출하지 않고 available:false로 반환한다(비용 0).
 * 키가 있으면 Veo API를 호출하도록 자리를 잡아둔다.
 * @param {string} imagePath 첫 프레임 이미지 경로
 * @param {string} text 본문(모션 프롬프트 도출용)
 */
export async function generateVeoVideo(imagePath, text = '') {
  if (!isVeoAvailable()) {
    return {
      success: false,
      available: false,
      mode: 'veo',
      reason: 'VEO_API_KEY 미설정 — Veo 실사/애니 모션 영상은 키 등록 후 사용 가능합니다. (현재 비용 발생 없음)',
      motionPrompt: buildVeoMotionPrompt(text)
    };
  }

  // ── 여기부터는 VEO_API_KEY가 있을 때만 실행되는 실제 호출부 ──
  // Veo API 스펙(엔드포인트/모델명)은 접근 권한 확정 후 채운다.
  // 지금은 키가 있어도 실호출 대신 준비 상태만 알린다(의도치 않은 비용 방지).
  const VEO_MODEL = process.env.VEO_MODEL || 'veo-3.0-generate';
  return {
    success: false,
    available: true,
    mode: 'veo',
    model: VEO_MODEL,
    reason: 'Veo 키는 감지되었으나 실제 호출부는 접근/비용 확인 후 활성화하도록 보류 중입니다.',
    imagePath,
    motionPrompt: buildVeoMotionPrompt(text)
  };
}

async function demo() {
  // 데모: uploads 폴더의 최신 유나/장면 이미지에 모션을 입혀본다.
  const imgs = fs.readdirSync(UPLOAD_DIR)
    .filter(f => /^scene_.*\.png$/.test(f))
    .map(f => ({ f, t: fs.statSync(path.join(UPLOAD_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);

  if (!imgs.length) {
    console.log('데모용 장면 이미지가 uploads/에 없습니다. 먼저 이미지를 생성하세요.');
    return;
  }
  const src = path.join(UPLOAD_DIR, imgs[0].f);
  console.log('[motion] 원본:', imgs[0].f);
  const r = await generateMotionVideo(src, { durationMs: 4000 });
  console.log(`   ✅ ${r.fileName} (${Math.round(r.fileSize / 1024)}KB, ${r.durationMs}ms)`);
  console.assert(r.fileSize > 10_000, '영상이 너무 작음');

  const veo = await generateVeoVideo(src, '테스트');
  console.log('[veo] available:', veo.available, '| reason:', veo.reason);

  console.log('self-check 통과 ✅');
}

if (process.argv.includes('--demo')) await demo();
