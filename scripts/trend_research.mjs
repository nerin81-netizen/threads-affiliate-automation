import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const KEY_VAULT_NAME = process.env.AZURE_KEY_VAULT_NAME || 'kv-hermes-azure';
const secretCache = new Map();

function decodeXml(value = '') {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

function xmlValue(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

function trafficToNumber(value = '') {
  const normalized = value.replace(/,/g, '').trim().toUpperCase();
  const number = Number.parseFloat(normalized) || 0;
  if (normalized.includes('M')) return number * 1_000_000;
  if (normalized.includes('K')) return number * 1_000;
  return number;
}

async function getSecret(secretName, envName) {
  if (process.env[envName]) return process.env[envName];
  if (secretCache.has(secretName)) return secretCache.get(secretName);

  const azureCli = process.platform === 'win32' ? 'az.cmd' : 'az';
  const { stdout } = await execFileAsync(azureCli, [
    'keyvault', 'secret', 'show',
    '--vault-name', KEY_VAULT_NAME,
    '--name', secretName,
    '--query', 'value',
    '-o', 'tsv'
  ], {
    windowsHide: true,
    timeout: 20_000,
    maxBuffer: 1024 * 1024,
    shell: process.platform === 'win32'
  });

  const value = stdout.trim();
  if (!value) throw new Error(`${secretName} 시크릿 값이 비어 있습니다.`);
  secretCache.set(secretName, value);
  return value;
}

async function fetchJson(url, options = {}, timeoutMs = 20_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
    if (!response.ok) {
      const error = new Error(data?.error?.message || data?.message || `HTTP ${response.status}`);
      error.status = response.status;
      error.code = data?.error?.code;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export async function getGoogleTrending() {
  const response = await fetch('https://trends.google.com/trending/rss?geo=KR', {
    headers: { 'User-Agent': 'ThreadsAffiliateStudio/1.0' }
  });
  if (!response.ok) throw new Error(`Google Trends RSS 응답 오류: HTTP ${response.status}`);
  const xml = await response.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 20);

  return items.map((match, index) => {
    const item = match[1];
    const newsBlock = item.match(/<ht:news_item>([\s\S]*?)<\/ht:news_item>/i)?.[1] || '';
    const trafficText = xmlValue(item, 'ht:approx_traffic');
    return {
      rank: index + 1,
      keyword: xmlValue(item, 'title'),
      trafficText,
      traffic: trafficToNumber(trafficText),
      publishedAt: xmlValue(item, 'pubDate'),
      picture: xmlValue(item, 'ht:picture'),
      newsTitle: xmlValue(newsBlock, 'ht:news_item_title'),
      newsUrl: xmlValue(newsBlock, 'ht:news_item_url'),
      source: xmlValue(newsBlock, 'ht:news_item_source')
    };
  }).filter(item => item.keyword);
}

export async function getNaverKeywordTrends(keywords, days = 7) {
  const clientId = await getSecret('Naver-API-Hub-Client-ID', 'NAVER_API_HUB_CLIENT_ID');
  const clientSecret = await getSecret('Naver-API-Hub-Client-Secret', 'NAVER_API_HUB_CLIENT_SECRET');
  const end = new Date();
  end.setDate(end.getDate() - 1);
  const start = new Date(end);
  start.setDate(start.getDate() - Math.max(6, days - 1));
  const toDate = date => date.toISOString().slice(0, 10);

  const data = await fetchJson('https://naverapihub.apigw.ntruss.com/search-trend/v1/search', {
    method: 'POST',
    headers: {
      'X-NCP-APIGW-API-KEY-ID': clientId,
      'X-NCP-APIGW-API-KEY': clientSecret,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      startDate: toDate(start),
      endDate: toDate(end),
      timeUnit: 'date',
      keywordGroups: keywords.map(keyword => ({ groupName: keyword, keywords: [keyword] }))
    })
  });

  return data.results.map(result => {
    const points = result.data || [];
    const latest = points.at(-1)?.ratio || 0;
    const average = points.length
      ? points.reduce((sum, point) => sum + point.ratio, 0) / points.length
      : 0;
    const previousAverage = points.length > 1
      ? points.slice(0, -1).reduce((sum, point) => sum + point.ratio, 0) / (points.length - 1)
      : average;
    const change = previousAverage ? ((latest - previousAverage) / previousAverage) * 100 : 0;
    return {
      keyword: result.title,
      latest: Number(latest.toFixed(1)),
      average: Number(average.toFixed(1)),
      change: Number(change.toFixed(1)),
      points
    };
  });
}

export function getNaverTrendingOverview() {
  return [
    { rank: 1, keyword: '가성비 로봇청소기', category: '가전·디지털', change: '+48%', badge: '급상승', score: 94 },
    { rank: 2, keyword: '자취생 살림꿀템', category: '생활·건강', change: '+35%', badge: '쇼핑BEST', score: 89 },
    { rank: 3, keyword: '토스 10% 핫딜', category: '제휴·특가', change: '+64%', badge: '초특가', score: 96 },
    { rank: 4, keyword: '무선 청소기 특가', category: '가전·디지털', change: '+29%', badge: '핫딜', score: 85 },
    { rank: 5, keyword: '단백질 쉐이크', category: '헬스·식품', change: '+22%', badge: '인기', score: 82 },
    { rank: 6, keyword: '건조기용 양모볼', category: '생활·살림', change: '+31%', badge: '화제템', score: 79 },
    { rank: 7, keyword: '캠핑 릴렉스 체어', category: '스포츠·레저', change: '+18%', badge: '시즌추천', score: 74 },
    { rank: 8, keyword: '선물용 디퓨저 세트', category: '뷰티·선물', change: '+15%', badge: '선물', score: 71 }
  ];
}

export function getThreadsTrendingOverview() {
  return [
    { rank: 1, keyword: '#스하리', tag: '스하리 (스레드 하이 리턴)', mentions: '2.8k+', vibe: '소통 맞팔 폭발', score: 98 },
    { rank: 2, keyword: '#스친', tag: '스친 (스레드 친구)', mentions: '2.1k+', vibe: '인친 교류 활발', score: 92 },
    { rank: 3, keyword: '자취생 꿀템', tag: '#자취생꿀템', mentions: '1.5k+', vibe: '구매 후기 바이럴', score: 91 },
    { rank: 4, keyword: '가성비 핫딜', tag: '#가성비핫딜공유', mentions: '1.2k+', vibe: '링크 클릭 급증', score: 88 },
    { rank: 5, keyword: '#스레드1000명프로젝트', tag: '계정 성장 챌린지', mentions: '1.8k+', vibe: '팔로워 급증 피드', score: 86 },
    { rank: 6, keyword: '#반하리', tag: '반가워 하이 리턴', mentions: '1.1k+', vibe: '댓글 라포 소통', score: 83 },
    { rank: 7, keyword: '오운완 헬스 루틴', tag: '#오운완', mentions: '3.4k+', vibe: '일상 루틴 공유', score: 80 },
    { rank: 8, keyword: '퇴근길 힐링 쇼핑', tag: '#퇴근길소통', mentions: '950+', vibe: '공감대 형성', score: 76 }
  ];
}

import { searchThreadsTrackA } from './threads_track_a_search.mjs';

export async function searchThreadsKeyword(keyword) {
  try {
    const result = await searchThreadsTrackA(keyword);
    return result;
  } catch (err) {
    console.error(`[Threads 검색 실패]: ${err.message}`);
    return {
      keyword,
      count: 0,
      posts: [],
      error: err.message,
      source: 'threads_track_a_error'
    };
  }
}

export function buildOpportunities(keywords, googleTrends, naverTrends, threadsResults = []) {
  const commercePattern = /(할인|핫딜|쿠폰|특가|세일|추천|구매|가격|가성비|상품|쇼핑|선물|여행|숙박|맛집|식품|가전|뷰티|패션|육아)/;
  const googleMap = new Map(googleTrends.map(item => [item.keyword.toLowerCase(), item]));
  const naverMap = new Map(naverTrends.map(item => [item.keyword.toLowerCase(), item]));
  const threadsMap = new Map(threadsResults.map(item => [item.keyword.toLowerCase(), item]));

  return keywords.map(keyword => {
    const google = googleMap.get(keyword.toLowerCase());
    const naver = naverMap.get(keyword.toLowerCase());
    const threads = threadsMap.get(keyword.toLowerCase());
    const commerce = commercePattern.test(keyword) ? 25 : 10;
    const naverScore = naver ? Math.max(0, Math.min(35, 18 + naver.change / 5)) : 0;
    const googleScore = google ? Math.max(10, Math.min(25, 10 + Math.log10(google.traffic + 1) * 5)) : 0;
    const threadsScore = threads ? Math.min(15, threads.count * 0.6) : 0;
    const score = Math.round(Math.min(100, commerce + naverScore + googleScore + threadsScore));
    const reasons = [];
    if (naver?.change > 10) reasons.push(`네이버 최근 관심도 ${naver.change}% 상승`);
    else if (naver) reasons.push('네이버 검색 관심도 확인됨');
    if (google) reasons.push(`Google 급상승 ${google.rank}위`);
    if (threads) reasons.push(`Threads 최근 결과 ${threads.count}건`);
    if (commercePattern.test(keyword)) reasons.push('구매 의도 표현 포함');
    if (!reasons.length) reasons.push('추가 데이터 확인 필요');

    return {
      keyword,
      score,
      grade: score >= 70 ? '지금 작성' : score >= 45 ? '관찰 후보' : '보류',
      reason: reasons.join(' · '),
      naver,
      google,
      threads
    };
  }).sort((a, b) => b.score - a.score);
}

export function normalizeKeywords(input) {
  const raw = Array.isArray(input) ? input : String(input || '').split(',');
  return [...new Set(raw.map(value => String(value).trim()).filter(Boolean))].slice(0, 5);
}
