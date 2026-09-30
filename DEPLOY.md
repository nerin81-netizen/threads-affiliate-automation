# 배포 정보 (Threads Affiliate Automation)

> 원본 서버 문서: `C:\Users\user\Desktop\allproject\azure\2026-08-23_Azure_웹서버_연결_및_아키텍처_보고서.md`
> 이 파일은 이 프로젝트에 필요한 부분만 추린 것이다. 자격증명은 적지 않는다.

## 배포 대상

| 항목 | 값 |
|---|---|
| 서비스 URL | https://your-domain.com |
| VM | Azure `myDemoVM` · `YOUR_SERVER_IP` · Ubuntu 22.04 · Standard_D4s_v5 |
| SSH | `ssh your_username@YOUR_SERVER_IP` (기본 키, `~/.ssh/config` 등록 없음) |
| 배포 경로 | `/var/www/threads-affiliate-automation` |
| 프로세스 | PM2 앱 이름 `threads-automation` (id 9) · Node 20.20.2 |
| 내부 포트 | `127.0.0.1:3500` (Nginx 리버스 프록시) |
| Nginx vhost | `your-domain.com.conf` · Let's Encrypt TLS |
| GitHub | https://github.com/nerin81-netizen/threads-affiliate-automation (**PUBLIC**) |
| gh 계정 | `your_github_username` — push 전 `gh auth status`로 활성 계정 확인 |

## ⚠️ 공존 서버 주의

이 VM에는 **5개 웹서비스가 Nginx·PM2를 공유**한다
(`ai-guide` :3200 · `kids-api` :3300 · `prompt-daily` :3003 · `another-service` :3400 · `devdiary-api`).

- 금지: `pm2 kill`, `pm2 restart all`, `systemctl restart nginx`
- 허용: `pm2 restart threads-automation --update-env`, `sudo nginx -s reload`

## 서버에만 있는 파일 (절대 덮어쓰지 말 것)

배포 경로에는 저장소에 없는 운영 파일이 있다. 전체 동기화(rsync --delete 등)를 하면 계정이 끊긴다.

| 파일 | 내용 |
|---|---|
| `.env` | API 키 전체 (Gemini · Threads · Toss · Azure Blob) |
| `storage_state.json` | 인스타/스레드 로그인 세션 쿠키. **유출 시 계정 탈취 가능** |
| `.toss_token.json` | 토스 제휴 토큰 |
| `.threads_chrome_profile/` | Playwright 브라우저 프로필 |
| `content_vault.json` | 발행 상태(`postedAt`)가 서버에서 갱신된다 |

`storage_state.json`은 2026-09-07부터 git 추적에서 제외했다(`.gitignore`).
과거 커밋 `8e882ff`에는 아직 남아 있으나 저장소가 PRIVATE이라 보류 중.

## 운영 보안 설정 (2026-09-10)

공개 운영 대시보드에 관리자 인증과 정적 파일 경계가 추가됐다. 서버 `.env`에 아래 값을 반드시 넣는다.

```bash
# 대시보드 관리자 로그인 비밀번호 (운영 서버 필수 · 긴 임의 문자열)
DASHBOARD_ADMIN_PASSWORD=<긴 임의 비밀번호>
# 리버스 프록시의 실제 공개 원점 (Origin 검사용)
DASHBOARD_PUBLIC_ORIGIN=https://your-domain.com
```

- 비밀번호가 없으면 **직접 로컬 접속(프록시 헤드 없는 루프백)만** 허용된다. Nginx 뒤 운영 트래픽은 `503`으로 거부된다.
- 프로젝트 루트의 `.env`, `content_vault.json`, `package.json`, `CHANGELOG.md`, `system_logs.log` 등은 더 이상 정적 응답으로 나가지 않는다. `public/`와 허용 목록의 가이드 HTML만 제공한다.
- 배포 후 아래 회귀 검사를 서버에서 돌려 인증·노출 경계를 확인한다.

```bash
cd /var/www/threads-affiliate-automation && npm run test:dashboard-security
```

## 배포 절차

git이 서버에 설치돼 있지 않아 **변경 파일만 tar로 올려 전개**한다.

```bash
# 1) 로컬: 커밋 후 푸시
git add -A && git commit -m "..." && git push origin main

# 2) 로컬: 미배포 커밋의 변경 파일 확인
git diff --name-only <서버에_올라간_마지막_커밋> HEAD

# 3) 로컬: 변경 파일만 묶기 (.env / storage_state.json 제외)
tar -czf ./deploy.tgz CHANGELOG.md content_vault.json server.mjs \
  public/app.js public/index.html public/style.css \
  scripts/*.mjs interim_reports/*.html

# 4) 서버: 백업
ssh your_username@YOUR_SERVER_IP "cd /var/www/threads-affiliate-automation && \
  cp content_vault.json content_vault.json.\$(date +%Y%m%d-%H%M%S).bak && cp .env .env.bak-predeploy"

# 5) 업로드 후 전개
scp ./deploy.tgz your_username@YOUR_SERVER_IP:/tmp/deploy.tgz
ssh your_username@YOUR_SERVER_IP "cd /var/www/threads-affiliate-automation && tar -xzf /tmp/deploy.tgz"

# 6) 서버에서 검증 (재시작 전에)
ssh your_username@YOUR_SERVER_IP "cd /var/www/threads-affiliate-automation && \
  node --check server.mjs && node scripts/post_quality.mjs --selftest && \
  node scripts/threads_api.mjs --selftest && npm run test:dashboard-security --silent"

# 7) 이 앱만 재시작
ssh your_username@YOUR_SERVER_IP "pm2 restart threads-automation --update-env"

# 8) 라이브 확인
curl -s -o /dev/null -w "%{http_code}\n" https://your-domain.com/
curl -s https://your-domain.com/api/insights | head -c 200
```

## 롤백

```bash
ssh your_username@YOUR_SERVER_IP "cd /var/www/threads-affiliate-automation && \
  ls -t content_vault.json.*.bak | head -3"          # 볼트 백업 목록
# 특정 백업으로 되돌린 뒤 pm2 restart threads-automation
```

코드 롤백은 로컬에서 이전 커밋을 체크아웃해 3~7단계를 다시 수행한다.

## 운영 명령

```bash
ssh your_username@YOUR_SERVER_IP "pm2 logs threads-automation --lines 50 --nostream"
ssh your_username@YOUR_SERVER_IP "pm2 describe threads-automation"
ssh your_username@YOUR_SERVER_IP "pm2 list"
```

## 최근 배포

| 일시(KST) | 커밋 | 내용 |
|---|---|---|
| 2026-09-10 00:30 | `HEAD` | v1.5.3 · 맥락 인지형 시네마틱 씬 하모니 엔진(Contextual Scene Harmony Engine) 탑재 · 7대 테마 스토리보드 완벽 조화 |
| 2026-09-10 00:20 | `6b0a788` | v1.5.2 · AI 이미지 시각 연출 10대 카테고리 각 100가지 = 총 1,000가지 대규모 규칙 엔진 탑재 |
| 2026-09-10 00:15 | `a45c071` | v1.5.1 · AI 이미지 배경 공간 라이브러리 80개로 2배 대폭 확장 |
| 2026-09-10 00:10 | `a38c663` | v1.5.0 · AI 이미지 공간/배경 극적 다양성 엔진 탑재 및 40대 현실 공간 무대 대확장 |
| 2026-09-10 00:07 | `09983e3` | v1.4.9 · 주유소/차량유지비 도메인 신설 & 본문 명시 장소 100% 최우선 반영 엔진 탑재 |
| 2026-09-09 23:58 | `64f329a` | v1.4.8 · AI 이미지 인물 페르소나 다양성 엔진 & 머그잔/웜톤 클리셰 차단 & PM2 실시간 디버그 로그 탑재 |
| 2026-09-09 23:45 | `880fde1` | v1.4.7 · AI 이미지 생성 32대 도메인 130개 프리셋 & 200대 연출 규칙, 5단 구조화 프롬프트 엔진 탑재 |
| 2026-09-09 22:35 | `5214dd3` | v1.4.3 · 게시물 후보 원문 기사 링크 100% 매칭 & 본문 정밀 기사 탐색 엔진 탑재 |
| 2026-09-09 02:10 | `46abc95` | v1.4.2 · 뉴스 기사 원문 링크를 첫 답글로 복구 |
| 2026-09-09 01:45 | `3243091` | v1.4.1 · 피드 답글 1회 실행량 10건 상향 · 예상 소요 안내 |
| 2026-09-09 21:12 | `7bde0b8` | v1.4.0 · 팔로잉 피드 아웃바운드 라포 답글(브라우저 경로) · 아웃바운드 전용 한도 분리 |
| 2026-09-08 | `a95305c` | 최상위 게시물 전용 안전 모드 · 타인 글 자동 댓글/답글 영구 차단 |
| 2026-09-07 22:50 | `4df9370` | 모바일 드로어 · 프롬프트 엔진 v2 · insights 회수 · post_quality · 대시보드 생성기 |
| 2026-09-06 | `8744d8c` | 자동 답글 비활성화 |
