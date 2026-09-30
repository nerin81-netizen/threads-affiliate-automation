import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3011';
const installedChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await chromium.launch({
  headless: true,
  executablePath: fs.existsSync(installedChrome) ? installedChrome : undefined
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const consoleErrors = [];

page.on('console', message => {
  // 종료 시 유지 중인 SSE 연결이 닫히며 발생하는 브라우저 네트워크 메시지는 제외합니다.
  if (message.type() === 'error' && !message.text().includes('ERR_CONNECTION_CLOSED')) {
    consoleErrors.push(message.text());
  }
});
page.on('pageerror', error => consoleErrors.push(error.message));

try {
  // 실시간 SSE 연결이 유지되므로 networkidle 대신 DOM 완료를 기준으로 검사합니다.
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.locator('[data-page="page-trends"]').click();
  await page.locator('#page-trends.active').waitFor({ state: 'visible' });
  await page.locator('#googleTrendList .google-trend-item').first().waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('#btnAnalyzeTrends').click();
  await page.locator('#opportunityList .opportunity-item').first().waitFor({ state: 'visible', timeout: 30_000 });

  const result = {
    title: await page.locator('#page-trends h1').textContent(),
    googleItems: await page.locator('#googleTrendList .google-trend-item').count(),
    opportunities: await page.locator('#opportunityList .opportunity-item').count(),
    comparisonRows: await page.locator('#trendComparisonBody tr').count(),
    naverStatus: await page.locator('#naverSourceStatus').textContent(),
    threadsStatus: await page.locator('#threadsSourceStatus').textContent(),
    consoleErrors
  };

  await page.screenshot({ path: path.join(rootDir, 'trend_dashboard_verified.png'), fullPage: true });
  console.log(JSON.stringify(result, null, 2));
  if (result.googleItems < 1 || result.opportunities !== 5 || result.comparisonRows !== 5 || consoleErrors.length) {
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
