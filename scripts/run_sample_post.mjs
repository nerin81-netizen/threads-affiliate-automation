import { postSingleCard } from './threads_bot.mjs';
import { getSavedCards, updateCard } from './card_generator.mjs';

async function main() {
  console.log('🚀 [스레드 샘플 게시물 등록 테스트]');
  const cards = getSavedCards();
  const readyCard = cards.find(c => c.status === 'READY') || cards[0];

  if (!readyCard) {
    console.error('❌ 등록할 카드가 없습니다.');
    process.exit(1);
  }

  console.log(`📌 선택된 카드: [${readyCard.title}] (${readyCard.style})`);
  console.log(`📝 본문 내용:\n---\n${readyCard.postBody}\n---`);
  console.log(`💬 첫 댓글:\n---\n${readyCard.firstComment}\n---`);

  // 화면을 보면서 검증할 수 있도록 headless: false로 실행
  const result = await postSingleCard(readyCard, {
    headless: false,
    log: (msg) => console.log(msg)
  });

  if (result.success) {
    updateCard(readyCard.id, { status: 'POSTED', postedAt: new Date().toISOString() });
    console.log('\n🎉 [성공] 스레드에 샘플 게시물이 안전하게 성공적으로 게시되었습니다!');
  } else {
    console.error(`\n❌ [실패] 게시 실패 사유: ${result.error}`);
  }
}

main().catch(err => {
  console.error('치명적 에러:', err);
});
