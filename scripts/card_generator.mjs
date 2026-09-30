import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAccessToken, getBestSellingProducts, getTodayDeals, createShareLink } from './toss_openapi.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const CARDS_FILE = path.join(rootDir, 'cards.json');

// 10대 극강 바이럴 카드 템플릿 (스레드 추천 피드 노출 & 저장/댓글 유도 최적화)
const CARD_TEMPLATES = [
  {
    style: '비밀정보_내부자형',
    tag: '🤫 아는사람만 아는',
    generateBody: (title, price, originPrice, discountRate) => 
`쿠팡·다이소 끊고 요즘 이거 씁니다... 🫢
알고리즘 타고 아는 사람들만 조용히 쟁여두는 히든 꿀템!

지금 토스 단독 특가 [${title}]
${discountRate ? `무려 ${discountRate}% 할인에 ` : ''}${price.toLocaleString()}원까지 떨어졌네요.

이 가격이면 안 사면 손해 수준이라 빠르게 공유합니다 🔥
💬 최저가 구매 좌표는 '첫 번째 댓글'에 남겨둘게요 👇`
  },
  {
    style: '실사용_간증형',
    tag: '⭐ 만족도 1위',
    generateBody: (title, price, originPrice, discountRate) => 
`솔직히 이 가격이면 그냥 사는 게 이득입니다.. 🥹

[${title}]
후기 평점 폭발한 갓성비 꿀템인데 지금 ${price.toLocaleString()}원 특가 떴어요!

삶의 질 수직상승템 찾는 분들한테 강력 추천합니다 👍

💬 10% 추가할인 좌표는 '첫 댓글' 확인해주세요 👇`
  },
  {
    style: '긴급특가_타임딜',
    tag: '⚡ 타임세일',
    generateBody: (title, price, originPrice, discountRate) => 
`🚨 긴급 특가 알림!

토스 쇼핑 1위 상품 [${title}]
지금 ${price.toLocaleString()}원 역대 최저가 갱신했습니다 ㄷㄷ

언제 가격 원상복구될지 모르니까 필요하신 분은 지금 바로 담아두세요!

💬 최저가 링크는 '첫 댓글'에 남겨뒀습니다 👇`
  },
  {
    style: '가성비_꿀템형',
    tag: '💡 가성비 종결',
    generateBody: (title, price, originPrice, discountRate) => 
`주변에 다 영업하고 다니는 인생템... 드디어 할인하네요 💡

[${title}]
토스 단독 특가 ${price.toLocaleString()}원!
치킨 한 마리 값도 안 되는데 만족감 진짜 미쳤습니다.

💬 구매 좌표는 '첫 번째 댓글'에 바로가기 남겨뒀어요 👇`
  }
];

export function getSavedCards() {
  try {
    if (fs.existsSync(CARDS_FILE)) {
      const cards = JSON.parse(fs.readFileSync(CARDS_FILE, 'utf8'));
      return cards.map(card => ({ ...card, firstComment: '' }));
    }
  } catch (e) {}
  return [];
}

export function saveCards(cards) {
  fs.writeFileSync(CARDS_FILE, JSON.stringify(cards, null, 2), 'utf8');
}

/**
 * 토스 베스트 상품을 기반으로 스레드 포스팅 카드 자동 생성
 */
export async function generateThreadCards(options = {}) {
  const count = options.count || 8;
  const source = options.source || 'best'; // 'best' or 'today'

  console.log(`📦 토스 API에서 [${source === 'today' ? '하루특가' : '실시간 베스트'}] 상품 수집 중...`);
  const token = await getAccessToken();

  let items = [];
  if (source === 'today') {
    const res = await getTodayDeals(token);
    items = res.success?.items || [];
  } else {
    const res = await getBestSellingProducts(token, Math.max(10, count));
    items = res.success?.items || [];
  }

  if (items.length === 0) {
    throw new Error('상품 데이터를 가져오지 못했습니다.');
  }

  const existingCards = getSavedCards();
  const newCards = [];

  const targetItems = items.slice(0, count);

  for (let i = 0; i < targetItems.length; i++) {
    const item = targetItems[i];
    const rank = i + 1;
    const title = item.displayName || '특가 상품';
    const price = item.displayPrice || 0;
    const originPrice = item.regularPrice || price;
    const discountRate = originPrice > price ? Math.round(((originPrice - price) / originPrice) * 100) : null;
    const imageUrl = item.thumbnailImageUrl || item.imageUrl || '';
    const itemId = item.tacaItemId;

    // 쉐어링크 발급
    let shortUrl = '';
    try {
      const linkRes = await createShareLink(token, itemId);
      shortUrl = linkRes.success?.shortUrl || '';
    } catch (err) {
      console.warn(`⚠️ 상품 [${title}] 쉐어링크 발급 실패: ${err.message}`);
    }

    const template = CARD_TEMPLATES[i % CARD_TEMPLATES.length];
    const basePostBody = template.generateBody(title, price, originPrice, discountRate)
      .replace(/\n💬[\s\S]*$/, '')
      .trim();
    const postBody = [
      basePostBody,
      shortUrl ? `🔗 구매 좌표: ${shortUrl}` : '',
      shortUrl ? '* 토스 제휴 활동의 일환으로 일정 수수료를 지급받을 수 있습니다.' : ''
    ].filter(Boolean).join('\n\n');
    const firstComment = '';

    const card = {
      id: `card_${Date.now()}_${itemId}_${i}`,
      itemId,
      rank,
      title,
      price,
      originPrice,
      discountRate,
      imageUrl,
      shortUrl,
      style: template.style,
      tag: template.tag,
      postBody,
      firstComment,
      estimatedReward: Math.round(price * 0.1), // 10% 예상 수익
      status: 'READY', // READY, POSTING, POSTED, FAILED
      createdAt: new Date().toISOString(),
      postedAt: null
    };

    newCards.push(card);
  }

  // 중복 아이템 병합 및 최신 순 유지
  const merged = [...newCards, ...existingCards.filter(c => !newCards.some(n => n.itemId === c.itemId))].slice(0, 30);
  saveCards(merged);

  console.log(`✅ 총 ${newCards.length}개의 스레드 포스팅 카드가 성공적으로 생성되었습니다!`);
  return merged;
}

/**
 * 단일 카드 문구 업데이트
 */
export function updateCard(cardId, updateFields) {
  const cards = getSavedCards();
  const index = cards.findIndex(c => c.id === cardId);
  if (index === -1) return null;

  cards[index] = { ...cards[index], ...updateFields, firstComment: '', updatedAt: new Date().toISOString() };
  saveCards(cards);
  return cards[index];
}

/**
 * 단일 카드 삭제
 */
export function deleteCard(cardId) {
  const cards = getSavedCards();
  const filtered = cards.filter(c => c.id !== cardId);
  saveCards(filtered);
  return filtered;
}
