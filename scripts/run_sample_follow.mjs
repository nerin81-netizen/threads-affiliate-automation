import { growFollowers } from './threads_bot.mjs';

async function main() {
  console.log('🚀 [스레드 안전 맞팔/팔로잉 자동화 시작]');
  console.log('🛡️ 계정 보호 쉴드: 인간형 마우스 무빙, 가변 딜레이(8~14초), 안전 한도 적용');

  // 첫 테스트는 안전하게 5명 목표로 실행 (눈으로 확인할 수 있게 창을 띄움)
  const result = await growFollowers({
    targetCount: 5,
    minDelaySeconds: 8,
    maxDelaySeconds: 14,
    headless: false,
    log: (msg) => console.log(msg)
  });

  if (result.success) {
    console.log(`\n🎉 [성공] 총 ${result.followedCount}명의 추천 유저에게 안전하게 선팔을 완료했습니다!`);
  } else {
    console.log(`\n⚠️ 결과: ${result.reason || result.error || '완료'}`);
  }
}

main().catch(err => {
  console.error('치명적 오류:', err);
});
