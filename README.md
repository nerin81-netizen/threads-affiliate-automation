# 🚀 Threads Affiliate Automation Platform

AI 기반 스레드(Threads) 제휴 마케팅 및 자동 소통(라포 형성) 올인원 자동화 플랫폼입니다.

---

### 🌐 Language / 다국어 지원
[ 🇰🇷 한국어 ] | [ 🇺🇸 English ](docs/i18n/README_en.md) | [ 🇯🇵 日本語 ](docs/i18n/README_ja.md) | [ 🇨🇳 简体中文 ](docs/i18n/README_zh.md) | [ 🇪🇸 Español ](docs/i18n/README_es.md) | [ 🇩🇪 Deutsch ](docs/i18n/README_de.md) | [ 🇫🇷 Français ](docs/i18n/README_fr.md) | [ 🇧🇷 Português ](docs/i18n/README_pt.md)

---

## 📸 대시보드 미리보기 (Dashboard Screenshots)

<div align="center">
  <h3>📊 1. 메인 대시보드 & 통계 개요</h3>
  <img src="docs/images/01_dashboard_overview.png" alt="Dashboard Overview" width="92%" />
  <p><em>일일 안전 쿼터, 활동 통계, 봇 퀵 컨트롤 및 실시간 SSE 스트리밍 로그</em></p>
  <br />

  <h3>📱 2. 포스팅 카드 스튜디오</h3>
  <img src="docs/images/02_card_studio.png" alt="Card Studio" width="92%" />
  <p><em>인기 상품 자동 수집, AI 후킹 문구 생성 및 4:5 맞춤형 카드 렌더링</em></p>
  <br />

  <h3>💬 3. 피드 라포 소통 & AI 맞춤 댓글 관리</h3>
  <img src="docs/images/03_rapport_management.png" alt="Rapport Management" width="92%" />
  <p><em>스레드 생태계 은어 기반 3대 스타일 공감 댓글 및 10건 원클릭 자동 소통</em></p>
  <br />

  <h3>💻 4. 실시간 실행 콘솔</h3>
  <img src="docs/images/04_realtime_console.png" alt="Realtime Console" width="92%" />
  <p><em>백그라운드 자동화 작업, 브라우저 세션 상태 및 API 호출 실시간 모니터링</em></p>
</div>

---

## 📌 핵심 기능

1. **💬 라포 소통 & AI 맞춤 댓글 엔진 (`scripts/rapport_engine.mjs`)**:
   - 스레드 고유 생태계 소통 키워드(`스하리`, `반하리`, `스친`, `맞스팔` 등) 반영
   - 맥락 기반 3대 소통 스타일(키워드 초밀착 공감형 / 티키타카 재치형 / 심플 다정 힐링형) 자동 생성
   - 피드 글 키워드 자동 분석 및 자동 소통 파이프라인 탑재

2. **📦 30일 100개 킬러 콘텐츠 보관소 (`content_vault.json`)**:
   - 초기 계정 신뢰도 및 팔로워 형성을 위한 검증된 고품질 콘텐츠 프리셋 수록
   - 생활 꿀팁(25개), 공감 일상(25개), 밸런스 게임/투표(25개), 소통형(25개) 탑재

3. **🖥️ 글래스모피즘 데스크톱 스타일 웹 대시보드 (`http://localhost:3500`)**:
   - 다크/글래스모피즘 테마 기반의 모던 웹 대시보드
   - **8개국어 실시간 자동 번역(i18n)**: 브라우저 언어 자동 감지 및 원클릭 언어 전환
   - 6대 서브 페이지: 대시보드, 카드 스튜디오, 라포 소통 & 댓글 관리, 계정, 설정, 실시간 콘솔
   - 실시간 SSE 로그 스트리밍 및 댓글/팔로우 KPI 지표 시각화

4. **🛡️ 안전 쿼터 & 휴먼 모방 안티봇 방어 쉴드**:
   - 일일 선팔 40건, 댓글 30건 등 계정 보호 안전 쿼터 적용
   - 인간형 가변 타이핑 딜레이(35~110ms) 및 지터(Jitter)로 어뷰징 방지

5. **🔥 제휴 핫딜 포스팅 & 공식 Graph API 지원**:
   - 인기 제휴 상품 정보 자동 수집 및 제휴 쉐어링크 발급 파이프라인
   - 본문(후킹 문구) + 첫 번째 댓글(수익 링크 분리) 자동 게시
   - Meta 공식 Threads Graph API 및 Playwright 정품 브라우저 세션 하이브리드 지원

---

## 🚀 빠른 시작

### 1. 사전 요구사항
- Node.js 18 이상
- Google Chrome 브라우저

### 2. 저장소 클론 및 패키지 설치
```bash
git clone https://github.com/nerin81-netizen/threads-affiliate-automation.git
cd threads-affiliate-automation
npm install
```

### 3. 환경 변수 설정
`.env.example`을 복사하여 `.env`를 생성하고 계정 정보 및 API 키를 입력합니다.
```bash
cp .env.example .env
```

### 4. 대시보드 실행
```bash
npm start
# 또는 start_dashboard.bat 실행
```
브라우저에서 `http://localhost:3500`으로 접속하여 제어할 수 있습니다. (브라우저 시스템 언어에 맞춰 한국어/영어/일본어/중국어/스페인어/독일어/프랑스어/포르투갈어로 자동 전환됩니다.)

---

## 📁 프로젝트 구조

```text
├── docs/                   # 문서 및 다국어 지원
│   ├── i18n/               # 8개국어 번역 README 문서
│   └── images/             # 대시보드 스크린샷 캡처 에셋
├── public/                 # 대시보드 프론트엔드 (HTML/CSS/JS/i18n)
├── scripts/                # 핵심 자동화 엔진 및 API 연동 모듈
├── server.mjs              # 대시보드 웹 서버 및 API 라우터
├── content_vault.sample.json # 콘텐츠 보관소 데이터 템플릿
├── cards.sample.json       # 상품 카드 데이터 템플릿
├── comments_history.sample.json # 댓글 히스토리 템플릿
├── persona.sample.json     # 인물 페르소나 설정 템플릿
└── .env.example            # 환경 변수 설정 템플릿
```

---

## 📑 프로젝트 문서
- [업데이트 히스토리 (CHANGELOG.md)](file:///c:/Users/user/Desktop/allproject/threads-affiliate-automation/CHANGELOG.md)
- [오픈소스 라이선스 (LICENSE)](file:///c:/Users/user/Desktop/allproject/threads-affiliate-automation/LICENSE)

---

## 📄 라이선스
본 프로젝트는 [MIT License](file:///c:/Users/user/Desktop/allproject/threads-affiliate-automation/LICENSE)에 따라 배포됩니다.

---

## ⚖️ 법적 면책 조항 (Legal Disclaimer)

1. **비공식 프로젝트 및 상표권 안내**:
   - 본 프로젝트는 Meta Platforms, Inc.(Threads, Instagram), Viva Republica(Toss), Naver Corp. 등과 어떠한 공식적인 제휴, 승인, 후원 관계도 없는 **독립적인 오픈소스 연구·개발 프로젝트**입니다.
   - 본 문서 및 코드에서 언급된 모든 제품명, 상표, 등록상표는 해당 소유자의 자산입니다.

2. **서비스 이용약관 준수 및 사용자 책임**:
   - 본 소프트웨어는 자동화 기술 및 API 연동에 관한 교육·연구 목적으로 제공됩니다.
   - 각 대상 플랫폼(Threads, Toss 등)의 최신 서비스 이용약관(Terms of Service) 및 API 정책을 준수할 책임은 전적으로 소프트웨어를 사용하는 사용자 본인에게 있습니다.
   - 본 프로그램을 실행하여 발생할 수 있는 계정 일시정지, 영구 제재(Ban), 데이터 손실, 법적 분쟁 및 기타 직간접적 손해에 대해 개발자 및 기여자는 일체의 법적 책임을 지지 않습니다.

3. **표시·광고 공정화 지침 준수**:
   - 본 프로그램을 통해 제휴 마케팅 링크를 게시할 경우, 공정거래위원회의 「추천·보증 등에 관한 표시·광고 심사지침」에 따라 소비자가 명확히 인식할 수 있도록 경제적 이해관계(수수료 지급 등)를 명시하여야 합니다. 기본 템플릿의 수수료 고지 문구를 임의로 삭제하지 마십시오.
