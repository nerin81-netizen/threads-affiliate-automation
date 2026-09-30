document.addEventListener('DOMContentLoaded', () => {
  // 공개 운영 환경에서는 관리자 세션이 확인되기 전 제어면을 잠근다.
  const authGate = document.getElementById('authGate');
  const authLoginForm = document.getElementById('authLoginForm');
  const authPassword = document.getElementById('authPassword');
  const authError = document.getElementById('authError');
  const authSubmit = document.getElementById('authSubmit');
  const nativeFetch = window.fetch.bind(window);

  function showAuthGate(message = '') {
    if (!authGate) return;
    authGate.hidden = false;
    document.body.classList.add('auth-locked');
    if (authError) {
      authError.textContent = message;
      authError.hidden = !message;
    }
    setTimeout(() => authPassword?.focus(), 0);
  }

  function hideAuthGate() {
    if (!authGate) return;
    authGate.hidden = true;
    document.body.classList.remove('auth-locked');
  }

  window.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    const requestUrl = typeof args[0] === 'string' ? args[0] : String(args[0]?.url || '');
    if (response.status === 401 && !requestUrl.includes('/api/auth/')) {
      showAuthGate('로그인 세션이 만료되었습니다. 다시 로그인해 주세요.');
    }
    if (response.status === 503 && !requestUrl.includes('/api/auth/')) {
      showAuthGate('운영 서버에 관리자 비밀번호 설정이 필요합니다.');
    }
    return response;
  };

  async function checkDashboardAuth() {
    try {
      const response = await nativeFetch('/api/auth/status', { cache: 'no-store' });
      const data = await response.json();
      if (data.authenticated) hideAuthGate();
      else showAuthGate(data.configured ? '' : '운영 서버에 DASHBOARD_ADMIN_PASSWORD 설정이 필요합니다.');
    } catch {
      showAuthGate('관리자 인증 상태를 확인하지 못했습니다.');
    }
  }

  authLoginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = authPassword?.value || '';
    if (!password) return;
    if (authSubmit) {
      authSubmit.disabled = true;
      authSubmit.textContent = '확인 중...';
    }
    try {
      const response = await nativeFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '로그인에 실패했습니다.');
      if (authPassword) authPassword.value = '';
      window.location.reload();
    } catch (error) {
      showAuthGate(error.message);
    } finally {
      if (authSubmit) {
        authSubmit.disabled = false;
        authSubmit.textContent = '안전하게 로그인';
      }
    }
  });

  checkDashboardAuth();

  // 1. 네비게이션 페이지 전환 로직 (사이드바 & 모바일 하단 탭 양방향 연동)
  const navItems = document.querySelectorAll('.sidebar-nav .nav-item');
  const bottomNavItems = document.querySelectorAll('.app-bottom-nav .bottom-nav-item');
  const pageViews = document.querySelectorAll('.page-view');

  function switchPage(targetPageId) {
    if (!targetPageId) return;
    navItems.forEach(nav => {
      nav.classList.toggle('active', nav.getAttribute('data-page') === targetPageId);
    });
    bottomNavItems.forEach(bNav => {
      bNav.classList.toggle('active', bNav.getAttribute('data-page') === targetPageId);
    });
    pageViews.forEach(view => {
      view.classList.toggle('active', view.id === targetPageId);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  navItems.forEach(item => {
    item.addEventListener('click', () => switchPage(item.getAttribute('data-page')));
  });

  bottomNavItems.forEach(bNav => {
    bNav.addEventListener('click', () => switchPage(bNav.getAttribute('data-page')));
  });

  // 1-1. 모바일 전체메뉴 드로어 (사이드바 슬라이드 인/아웃)
  const mobMenuBtn = document.getElementById('mobMenuBtn');
  const mobDrawerBackdrop = document.getElementById('mobDrawerBackdrop');
  const appSidebar = document.querySelector('.app-sidebar');
  let drawerFocusReturnEl = null;

  function trapDrawerFocus(e) {
    if (e.key !== 'Tab' || !appSidebar) return;
    const focusables = appSidebar.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function setDrawer(open) {
    if (!appSidebar) return;
    appSidebar.classList.toggle('drawer-open', open);
    if (mobDrawerBackdrop) mobDrawerBackdrop.classList.toggle('visible', open);
    if (mobMenuBtn) {
      mobMenuBtn.classList.toggle('active', open);
      mobMenuBtn.setAttribute('aria-expanded', String(open));
    }
    document.body.style.overflow = open ? 'hidden' : '';

    if (open) {
      drawerFocusReturnEl = document.activeElement;
      document.addEventListener('keydown', trapDrawerFocus, true);
      requestAnimationFrame(() => {
        const first = appSidebar.querySelector('a[href], button, input, select, textarea');
        first?.focus();
      });
    } else {
      document.removeEventListener('keydown', trapDrawerFocus, true);
      if (drawerFocusReturnEl && drawerFocusReturnEl.isConnected) drawerFocusReturnEl.focus();
      drawerFocusReturnEl = null;
    }
  }

  if (mobMenuBtn) {
    mobMenuBtn.addEventListener('click', () => {
      setDrawer(!appSidebar.classList.contains('drawer-open'));
    });
  }
  if (mobDrawerBackdrop) mobDrawerBackdrop.addEventListener('click', () => setDrawer(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setDrawer(false); });
  // 드로어 안에서 메뉴/링크를 누르면 자동으로 닫힘
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
    item.addEventListener('click', () => setDrawer(false));
  });

  // DOM 참조
  const sidebarThreadsId = document.getElementById('sidebarThreadsId');
  const sidebarStatusBox = document.getElementById('sidebarStatusBox');
  const quickStatusDot = document.getElementById('quickStatusDot');
  const quickStatusText = document.getElementById('quickStatusText');

  const dashFollowCount = document.getElementById('dashFollowCount');
  const dashPostCount = document.getElementById('dashPostCount');
  const dashFollowBar = document.getElementById('dashFollowBar');
  const dashPostBar = document.getElementById('dashPostBar');

  const barRunningStatus = document.getElementById('barRunningStatus');
  const barFollowCount = document.getElementById('barFollowCount');
  const barPostCount = document.getElementById('barPostCount');
  const activityList = document.getElementById('activityList');

  const btnRunGrow = document.getElementById('btnRunGrow');
  const btnRunPost = document.getElementById('btnRunPost');
  const btnRunAll = document.getElementById('btnRunAll');
  const btnRunLogin = document.getElementById('btnRunLogin');
  const btnStopBot = document.getElementById('btnStopBot');
  const headlessToggle = document.getElementById('headlessToggle');

  const sidebarCardBadge = document.getElementById('sidebarCardBadge');
  const cardsCountText = document.getElementById('cardsCountText');
  const cardsGrid = document.getElementById('cardsGrid');
  const btnGenerateCards = document.getElementById('btnGenerateCards');

  const targetCountSlider = document.getElementById('targetCount');
  const targetCountVal = document.getElementById('targetCountVal');
  const followKeywordsInput = document.getElementById('followKeywords');
  const minDelayInput = document.getElementById('minDelaySeconds');
  const maxDelayInput = document.getElementById('maxDelaySeconds');
  const bodyTemplateInput = document.getElementById('bodyTemplate');
  const commentTemplateInput = document.getElementById('commentTemplate');
  const btnSaveConfig = document.getElementById('btnSaveConfig');

  const envThreadsId = document.getElementById('envThreadsId');
  const envThreadsPw = document.getElementById('envThreadsPw');
  const envTossAccessKey = document.getElementById('envTossAccessKey');
  const envTossSecretKey = document.getElementById('envTossSecretKey');
  const envTossPublisherId = document.getElementById('envTossPublisherId');
  const btnSaveAccounts = document.getElementById('btnSaveAccounts');

  const terminalLogs = document.getElementById('terminalLogs');
  const btnClearLogs = document.getElementById('btnClearLogs');
  const btnCopyLogs = document.getElementById('btnCopyLogs');

  // 모달
  const editModal = document.getElementById('editModal');
  const modalCardTitle = document.getElementById('modalCardTitle');
  const editCardId = document.getElementById('editCardId');
  const editCardTag = document.getElementById('editCardTag');
  const editCardBody = document.getElementById('editCardBody');
  const editCardComment = document.getElementById('editCardComment');
  const btnModalClose = document.getElementById('btnModalClose');
  const btnModalCancel = document.getElementById('btnModalCancel');
  const btnModalSave = document.getElementById('btnModalSave');

  let currentCards = [];
  let currentFilter = 'all';
  let isRunning = false;

  // 슬라이더 값 실시간 표시
  targetCountSlider.addEventListener('input', (e) => {
    targetCountVal.textContent = `${e.target.value}명`;
  });

  // 2. 시스템 로그 DB & SSE 실시간 스트림 관리 (최적화: 중복 연결 차단, DOM 노드 150개 제한, 배치 렌더링)
  let allLogsCache = [];
  let currentLogFilter = 'all';
  const MAX_DOM_LOGS = 150; // 브라우저 메모리 및 레이아웃 과부하 방지를 위한 최대 화면 표시 개수
  let activeEvtSource = null;
  let sseReconnectTimer = null;
  let logBatchQueue = [];
  let isLogBatchScheduled = false;

  const consoleFilterGroup = document.getElementById('consoleFilterGroup');
  const statTotalLogs = document.getElementById('statTotalLogs');
  const statErrorLogs = document.getElementById('statErrorLogs');
  const statSuccessLogs = document.getElementById('statSuccessLogs');
  const dbStatusBadge = document.getElementById('dbStatusBadge');
  const consoleIndicator = document.getElementById('consoleIndicator');

  function updateLogStatsDisplay(stats) {
    if (!stats) return;
    if (statTotalLogs) statTotalLogs.textContent = stats.total ?? allLogsCache.length;
    if (statErrorLogs) statErrorLogs.textContent = stats.errorCount ?? allLogsCache.filter(l => l.type === 'error' || l.type === 'warning').length;
    if (statSuccessLogs) statSuccessLogs.textContent = stats.successCount ?? allLogsCache.filter(l => l.type === 'success').length;
    if (dbStatusBadge) {
      dbStatusBadge.textContent = `💾 SQLite DB (${stats.total || allLogsCache.length}건 보존 중)`;
    }
  }

  function createLogElement(logItem) {
    const entry = document.createElement('div');
    entry.className = `log-entry ${logItem.type || 'info'}`;
    entry.dataset.type = logItem.type || 'info';

    const timeSpan = document.createElement('span');
    timeSpan.className = 'log-time';
    timeSpan.textContent = `[${logItem.timestamp || new Date().toLocaleTimeString('ko-KR')}]`;

    const badgeSpan = document.createElement('span');
    badgeSpan.className = `log-badge ${logItem.type || 'info'}`;
    badgeSpan.textContent = logItem.type || 'info';

    const msgSpan = document.createElement('span');
    msgSpan.className = 'log-msg';
    msgSpan.textContent = logItem.message || '';

    entry.appendChild(timeSpan);
    entry.appendChild(badgeSpan);
    entry.appendChild(msgSpan);
    return entry;
  }

  function renderFilteredLogs() {
    if (!terminalLogs) return;
    terminalLogs.innerHTML = '';

    const filtered = allLogsCache.filter(item => {
      if (currentLogFilter === 'all') return true;
      if (currentLogFilter === 'error') return item.type === 'error' || item.type === 'warning';
      return item.type === currentLogFilter;
    });

    if (filtered.length === 0) {
      const emptyNotice = document.createElement('div');
      emptyNotice.className = 'log-entry system';
      emptyNotice.textContent = `[안내] '${currentLogFilter}' 필터에 해당하는 로그 기록이 없습니다.`;
      terminalLogs.appendChild(emptyNotice);
      return;
    }

    const fragment = document.createDocumentFragment();
    // 최대 MAX_DOM_LOGS 개수만 렌더링하여 DOM 가상화 효과
    const displayList = filtered.slice(-MAX_DOM_LOGS);
    displayList.forEach(logItem => {
      fragment.appendChild(createLogElement(logItem));
    });
    terminalLogs.appendChild(fragment);
    terminalLogs.scrollTop = terminalLogs.scrollHeight;
  }

  async function loadLogsHistory() {
    try {
      const res = await fetch('/api/logs/history?limit=150');
      const data = await res.json();
      if (data.success && Array.isArray(data.logs)) {
        allLogsCache = data.logs;
        renderFilteredLogs();
        updateLogStatsDisplay(data.stats);
      }
    } catch (err) {
      console.error('로그 히스토리 로드 오류:', err);
    }
  }

  // 로그 실시간 추가 시 배치(batch) 렌더링으로 Forced Reflow / Layout Thrashing 방지
  function flushLogBatch() {
    isLogBatchScheduled = false;
    if (!terminalLogs || logBatchQueue.length === 0) return;

    const itemsToRender = [...logBatchQueue];
    logBatchQueue = [];

    const isAtBottom = terminalLogs.scrollHeight - terminalLogs.clientHeight <= terminalLogs.scrollTop + 60;
    const fragment = document.createDocumentFragment();

    for (const item of itemsToRender) {
      const matchesFilter = currentLogFilter === 'all' ||
        (currentLogFilter === 'error' && (item.type === 'error' || item.type === 'warning')) ||
        item.type === currentLogFilter;
      if (matchesFilter) {
        fragment.appendChild(createLogElement(item));
      }
    }

    if (fragment.children.length > 0) {
      terminalLogs.appendChild(fragment);

      // DOM 노드 수가 MAX_DOM_LOGS를 초과하면 앞의 오래된 엘리먼트 즉시 정리
      while (terminalLogs.children.length > MAX_DOM_LOGS) {
        terminalLogs.removeChild(terminalLogs.firstElementChild);
      }

      if (isAtBottom) {
        terminalLogs.scrollTop = terminalLogs.scrollHeight;
      }
    }
  }

  function queueLogForRender(logItem) {
    logBatchQueue.push(logItem);
    if (!isLogBatchScheduled) {
      isLogBatchScheduled = true;
      requestAnimationFrame(flushLogBatch);
    }
  }

  function initLogStream() {
    // 기존 활성 연결이 있으면 확실히 닫아 중복 연결/인스턴스 증식 완전 차단
    if (activeEvtSource) {
      try {
        activeEvtSource.close();
      } catch {}
      activeEvtSource = null;
    }
    if (sseReconnectTimer) {
      clearTimeout(sseReconnectTimer);
      sseReconnectTimer = null;
    }

    const evtSource = new EventSource('/api/logs/stream');
    activeEvtSource = evtSource;

    evtSource.onopen = () => {
      if (consoleIndicator) {
        consoleIndicator.textContent = '실시간 연결됨';
        consoleIndicator.style.color = '#10b981';
      }
    };

    evtSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        allLogsCache.push(data);
        if (allLogsCache.length > 300) allLogsCache.shift();

        queueLogForRender(data);

        // 통계 실시간 증가
        if (statTotalLogs) statTotalLogs.textContent = parseInt(statTotalLogs.textContent || '0', 10) + 1;
        if (data.type === 'error' || data.type === 'warning') {
          if (statErrorLogs) statErrorLogs.textContent = parseInt(statErrorLogs.textContent || '0', 10) + 1;
        }
        if (data.type === 'success') {
          if (statSuccessLogs) statSuccessLogs.textContent = parseInt(statSuccessLogs.textContent || '0', 10) + 1;
        }
      } catch (e) {
        // 일반 텍스트 로그
        const simple = { timestamp: new Date().toLocaleTimeString('ko-KR'), type: 'info', message: event.data };
        allLogsCache.push(simple);
        if (allLogsCache.length > 300) allLogsCache.shift();
        queueLogForRender(simple);
      }
    };

    evtSource.onerror = () => {
      if (consoleIndicator) {
        consoleIndicator.textContent = '재연결 대기 중';
        consoleIndicator.style.color = '#f59e0b';
      }
      // 중요: 기존 인스턴스 정리 후 1회만 재연결 예약
      if (activeEvtSource) {
        try {
          activeEvtSource.close();
        } catch {}
        activeEvtSource = null;
      }
      clearTimeout(sseReconnectTimer);
      sseReconnectTimer = setTimeout(initLogStream, 5000);
    };
  }

  // 필터 탭 클릭 이벤트
  if (consoleFilterGroup) {
    consoleFilterGroup.addEventListener('click', (e) => {
      const btn = e.target.closest('.filter-chip');
      if (!btn) return;
      consoleFilterGroup.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      currentLogFilter = btn.dataset.filter || 'all';
      renderFilteredLogs();
    });
  }

  btnClearLogs.addEventListener('click', async () => {
    if (!confirm('🗑️ 데이터베이스에 보관된 모든 시스템 로그를 영구 삭제할까요?')) {
      return;
    }
    try {
      const res = await fetch('/api/logs/clear', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        allLogsCache = [];
        renderFilteredLogs();
        updateLogStatsDisplay({ total: 0, errorCount: 0, successCount: 0 });
      }
    } catch (e) {
      alert('로그 비우기 실패: ' + e.message);
    }
  });

  btnCopyLogs.addEventListener('click', () => {
    const text = allLogsCache.map(l => `[${l.timestamp}] [${(l.type || 'INFO').toUpperCase()}] ${l.message}`).join('\n');
    if (!text) {
      alert('복사할 로그가 없습니다.');
      return;
    }
    navigator.clipboard.writeText(text).then(() => {
      alert('📋 전체 로그 기록(' + allLogsCache.length + '건)이 클립보드에 복사되었습니다.');
    });
  });

  // 3. 상태 로드 & 주기적 갱신
  async function fetchStatus() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();

      isRunning = data.isRunning;
      sidebarThreadsId.textContent = data.threadsId || '계정 미설정';

      if (isRunning) {
        sidebarStatusBox.className = 'bot-quick-status running';
        quickStatusText.textContent = `실행 중: ${data.currentTask || '처리 중'}`;
        barRunningStatus.textContent = `봇 상태: 실행 중 (${data.currentTask || '진행'})`;
        btnStopBot.disabled = false;
        btnRunGrow.disabled = true;
        btnRunPost.disabled = true;
        btnRunAll.disabled = true;
        btnRunLogin.disabled = true;
        const bFeedH = document.getElementById('btnRunHeartFeed');
        if (bFeedH) bFeedH.disabled = true;
        const bFeedHC = document.getElementById('btnRunFeedHeart');
        if (bFeedHC) bFeedHC.disabled = true;
        for (const id of ['btnRunFeedRapport', 'btnRunFeedRapportDry']) {
          const b = document.getElementById(id);
          if (b) b.disabled = true;
        }
      } else {
        sidebarStatusBox.className = 'bot-quick-status';
        quickStatusText.textContent = '대기 중 (IDLE)';
        barRunningStatus.textContent = '봇 상태: 대기 중 (IDLE)';
        btnStopBot.disabled = true;
        btnRunGrow.disabled = false;
        btnRunPost.disabled = false;
        btnRunAll.disabled = false;
        btnRunLogin.disabled = false;
        const bFeedH = document.getElementById('btnRunHeartFeed');
        if (bFeedH) bFeedH.disabled = false;
        const bFeedHC = document.getElementById('btnRunFeedHeart');
        if (bFeedHC) bFeedHC.disabled = false;
        for (const id of ['btnRunFeedRapport', 'btnRunFeedRapportDry']) {
          const b = document.getElementById(id);
          if (b) b.disabled = false;
        }
      }

      // KPI 수치
      if (data.dailyStats) {
        const follows = data.dailyStats.followCount || 0;
        const posts = data.dailyStats.postCount || 0;
        const hearts = data.dailyStats.heartCount || 0;
        const maxFollows = data.safetyLimits?.MAX_FOLLOWS_PER_DAY || 40;
        const maxPosts = data.safetyLimits?.MAX_POSTS_PER_DAY || 5;
        const maxHearts = data.safetyLimits?.MAX_HEARTS_PER_DAY || 300;

        dashFollowCount.innerHTML = `${follows} <small>/ ${maxFollows}명</small>`;
        dashPostCount.innerHTML = `${posts} <small>/ ${maxPosts}건</small>`;
        
        const dashHeartCount = document.getElementById('dashHeartCount');
        const dashHeartBar = document.getElementById('dashHeartBar');
        if (dashHeartCount) dashHeartCount.innerHTML = `${hearts} <small>/ ${maxHearts}건</small>`;
        if (dashHeartBar) dashHeartBar.style.width = `${Math.min((hearts / maxHearts) * 100, 100)}%`;

        const todayCommentHeartsCount = document.getElementById('todayCommentHeartsCount');
        const commentHeartProgressFill = document.getElementById('commentHeartProgressFill');
        if (todayCommentHeartsCount) todayCommentHeartsCount.textContent = hearts;
        if (commentHeartProgressFill) commentHeartProgressFill.style.width = `${Math.min((hearts / maxHearts) * 100, 100)}%`;

        // 아웃바운드(피드) 답글은 인바운드와 카운터가 분리되어 있다
        const outbound = data.dailyStats.outboundCommentCount || 0;
        const maxOutbound = data.safetyLimits?.MAX_OUTBOUND_COMMENTS_PER_DAY || 10;
        const todayOutboundCount = document.getElementById('todayOutboundCount');
        const outboundProgressFill = document.getElementById('outboundProgressFill');
        if (todayOutboundCount) todayOutboundCount.textContent = outbound;
        if (outboundProgressFill) outboundProgressFill.style.width = `${Math.min((outbound / maxOutbound) * 100, 100)}%`;

        barFollowCount.textContent = follows;
        barPostCount.textContent = posts;

        dashFollowBar.style.width = `${Math.min((follows / maxFollows) * 100, 100)}%`;
        dashPostBar.style.width = `${Math.min((posts / maxPosts) * 100, 100)}%`;

        // 활동 내역 타임라인
        renderActivities(data.dailyStats.history || []);

        // 금일 발행 한도 UI 동기화 (별도 updatePublishQuota 중복 fetch 완전 제거)
        const quotaEl = document.getElementById('pubQuota');
        if (quotaEl) {
          const limit = data.safetyLimits?.MAX_POSTS_PER_DAY ?? 5;
          quotaEl.textContent = `금일 발행 ${posts} / ${limit}건`;
          quotaEl.classList.toggle('is-full', posts >= limit);

          const account = data.threadsId || '내 계정';
          const pubName = document.getElementById('pubPreviewName');
          const pubAvatar = document.getElementById('pubAvatar');
          if (pubName) pubName.textContent = account;
          if (pubAvatar) pubAvatar.textContent = account.charAt(0).toUpperCase();
        }
      }
    } catch (e) {
      console.error('상태 로드 에러:', e);
    }
  }

  let lastActivitiesSignature = '';
  function renderActivities(history) {
    if (!activityList) return;
    const rev = (!history || history.length === 0) ? [] : [...history].reverse().slice(0, 10);
    const signature = JSON.stringify(rev.map(h => `${h.time}_${h.type}_${h.detail}`));
    if (signature === lastActivitiesSignature) return; // 변경 없으면 DOM 갱신 스킵
    lastActivitiesSignature = signature;

    if (rev.length === 0) {
      activityList.innerHTML = '<div class="activity-empty">오늘 수행된 자동화 작업 기록이 아직 없습니다.</div>';
      return;
    }

    const fragment = document.createDocumentFragment();
    rev.forEach(item => {
      const row = document.createElement('div');
      row.className = 'activity-item';
      const icon = item.type === 'follow' ? '👥' : '🔥';
      const typeName = item.type === 'follow' ? '맞팔 선팔' : '핫딜 포스팅';
      row.innerHTML = `
        <span>${icon}</span>
        <strong style="color: #fff;">${typeName}</strong>
        <span style="color: #9ca3af; font-size: 0.75rem;">${item.detail || ''}</span>
        <span style="margin-left: auto; color: #6b7280; font-size: 0.72rem;">${item.time}</span>
      `;
      fragment.appendChild(row);
    });
    activityList.innerHTML = '';
    activityList.appendChild(fragment);
  }

  // 4. 설정 불러오기
  async function fetchConfig() {
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      const conf = data.config || {};
      const env = data.env || {};

      if (conf.follow) {
        targetCountSlider.value = conf.follow.targetCount || 15;
        targetCountVal.textContent = `${targetCountSlider.value}명`;
        followKeywordsInput.value = (conf.follow.keywords || []).join(', ');
        minDelayInput.value = conf.follow.minDelaySeconds || 8;
        maxDelayInput.value = conf.follow.maxDelaySeconds || 16;
      }

      if (conf.post) {
        bodyTemplateInput.value = conf.post.bodyTemplate || '';
        commentTemplateInput.value = '';
        commentTemplateInput.disabled = true;
      }

      if (conf.browser) {
        headlessToggle.checked = conf.browser.headless !== undefined ? !!conf.browser.headless : true;
      }

      envThreadsId.value = env.THREADS_ID || '';
      envThreadsPw.value = '';
      envTossAccessKey.value = env.TOSS_SHARELINK_ACCESS_KEY || '';
      envTossSecretKey.value = '';
      envTossPublisherId.value = env.TOSS_SHARELINK_PUBLISHER_ID || '';
    } catch (e) {
      console.error('설정 로드 실패:', e);
    }
  }

  // 설정 저장
  btnSaveConfig.addEventListener('click', async () => {
    const keywords = followKeywordsInput.value.split(',').map(s => s.trim()).filter(Boolean);
    const updatedConfig = {
      follow: {
        targetCount: Number(targetCountSlider.value),
        keywords,
        minDelaySeconds: Number(minDelayInput.value),
        maxDelaySeconds: Number(maxDelayInput.value),
        filter: 'recent'
      },
      post: {
        source: 'best',
        itemRank: 1,
        bodyTemplate: bodyTemplateInput.value,
        commentTemplate: '',
        linkPosition: 'body'
      },
      browser: {
        headless: headlessToggle.checked
      }
    };

    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: updatedConfig })
      });
      const data = await res.json();
      if (data.success) {
        alert('✅ 자동화 설정이 성공적으로 저장되었습니다!');
      } else {
        alert(`❌ 저장 실패: ${data.error}`);
      }
    } catch (err) {
      alert(`❌ 오류: ${err.message}`);
    }
  });

  // 계정 및 API 키 저장
  btnSaveAccounts.addEventListener('click', async () => {
    const envPayload = {};
    if (envThreadsId.value.trim()) envPayload.THREADS_ID = envThreadsId.value.trim();
    if (envThreadsPw.value.trim()) envPayload.THREADS_PW = envThreadsPw.value.trim();
    if (envTossAccessKey.value.trim()) envPayload.TOSS_SHARELINK_ACCESS_KEY = envTossAccessKey.value.trim();
    if (envTossSecretKey.value.trim()) envPayload.TOSS_SHARELINK_SECRET_KEY = envTossSecretKey.value.trim();
    if (envTossPublisherId.value.trim()) envPayload.TOSS_SHARELINK_PUBLISHER_ID = envTossPublisherId.value.trim();

    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ env: envPayload })
      });
      const data = await res.json();
      if (data.success) {
        alert('🔐 계정 정보가 성공적으로 반영되었습니다!');
        fetchStatus();
      } else {
        alert(`❌ 저장 실패: ${data.error}`);
      }
    } catch (err) {
      alert(`❌ 오류: ${err.message}`);
    }
  });

  // 5. 봇 액션 트리거
  async function triggerBotAction(action, extraOptions = {}) {
    if (isRunning && action !== 'stop') {
      alert('이미 다른 작업이 실행 중입니다.');
      return;
    }

    const options = {
      headless: headlessToggle.checked,
      targetCount: Number(targetCountSlider.value),
      keywords: followKeywordsInput.value.split(',').map(s => s.trim()).filter(Boolean),
      ...extraOptions
    };

    try {
      const res = await fetch('/api/bot/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, options })
      });
      const data = await res.json();
      if (!res.ok) {
        alert(`실행 오류: ${data.error}`);
      } else {
        fetchStatus();
      }
    } catch (err) {
      alert(`서버 통신 에러: ${err.message}`);
    }
  }

  btnRunGrow.addEventListener('click', () => triggerBotAction('grow'));
  btnRunPost.addEventListener('click', () => triggerBotAction('post'));
  btnRunAll.addEventListener('click', () => triggerBotAction('all'));
  btnRunLogin.addEventListener('click', () => triggerBotAction('login'));
  btnStopBot.addEventListener('click', () => triggerBotAction('stop'));

  // 5-0. 팔로워 피드 자동 하트 봇 실행
  async function executeFeedHeartBot(count = 10) {
    if (isRunning) {
      alert('이미 다른 봇 작업이 실행 중입니다.');
      return;
    }
    if (!confirm(`❤️ 내 팔로잉 피드의 최신 글 중 최대 ${count}건에 자동으로 하트(좋아요)를 누를까요?`)) {
      return;
    }
    try {
      const res = await fetch('/api/run-heart-bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count })
      });
      const data = await res.json();
      if (!res.ok) {
        alert(`❌ 실행 실패: ${data.error}`);
      } else {
        alert(`🎉 ${count}건 피드 하트 작업이 백그라운드에서 시작되었습니다! [실시간 실행 콘솔] 탭에서 진행 상황을 확인하세요.`);
        fetchStatus();
      }
    } catch (e) {
      alert(`❌ 통신 에러: ${e.message}`);
    }
  }

  // 팔로잉 피드 아웃바운드 답글. 남의 글에 먼저 말을 거는 동작이라 하트보다 훨씬 조심스럽게
  // 묻는다. dryRun 이면 확인창 없이 바로 돌린다 — 발행이 없으니 되돌릴 것도 없다.
  async function executeFeedRapportBot(count = 1, dryRun = false) {
    if (isRunning) {
      alert('이미 다른 봇 작업이 실행 중입니다.');
      return;
    }
    if (!dryRun && !confirm(`💬 팔로잉 피드의 최신 글 중 ${count}건에 AI 라포 답글을 실제로 발행합니다.\n\n⏱️ 건당 45~120초 딜레이 + 3건마다 5분 쿨다운으로 진행되어 약 25~30분 걸립니다.\n진행 중에는 [실시간 실행 콘솔]에서 상황을 볼 수 있습니다.\n\n남의 글에 먼저 답글을 다는 동작이라 계정 제한 위험이 있습니다.\n하루 10건 한도이며, 민감·홍보성 글과 최근 7일 내 답글한 계정은 자동 제외됩니다.\n\n진행할까요?`)) {
      return;
    }
    try {
      const res = await fetch('/api/run-feed-rapport', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count, dryRun })
      });
      const data = await res.json();
      if (!res.ok) {
        alert(`❌ 실행 실패: ${data.error}`);
      } else {
        alert(dryRun
          ? `🧪 미리보기를 시작했습니다. 발행하지 않고 후보 글과 생성될 답글만 [실시간 실행 콘솔]에 출력합니다.`
          : `🎉 ${count}건 피드 답글 작업이 백그라운드에서 시작되었습니다! [실시간 실행 콘솔] 탭에서 진행 상황을 확인하세요.`);
        fetchStatus();
      }
    } catch (e) {
      alert(`❌ 통신 에러: ${e.message}`);
    }
  }

  const btnRunFeedRapport = document.getElementById('btnRunFeedRapport');
  if (btnRunFeedRapport) {
    btnRunFeedRapport.addEventListener('click', () => executeFeedRapportBot(10, false));
  }

  const btnRunFeedRapportDry = document.getElementById('btnRunFeedRapportDry');
  if (btnRunFeedRapportDry) {
    btnRunFeedRapportDry.addEventListener('click', () => executeFeedRapportBot(3, true));
  }

  const btnRunHeartFeed = document.getElementById('btnRunHeartFeed');
  if (btnRunHeartFeed) {
    btnRunHeartFeed.addEventListener('click', () => executeFeedHeartBot(10));
  }

  const btnRunFeedHeart = document.getElementById('btnRunFeedHeart');
  if (btnRunFeedHeart) {
    btnRunFeedHeart.addEventListener('click', () => executeFeedHeartBot(10));
  }

  // 5-1. 오토파일럿 제어
  const btnStart3hMode = document.getElementById('btnStart3hMode');
  const btnStartContinuousMode = document.getElementById('btnStartContinuousMode');
  const btnStopAutoPilot = document.getElementById('btnStopAutoPilot');
  const autopilotStatusBadge = document.getElementById('autopilotStatusBadge');
  const autopilotNextRunText = document.getElementById('autopilotNextRunText');

  async function fetchAutoPilotStatus() {
    try {
      const res = await fetch('/api/autopilot');
      const data = await res.json();
      if (data.enabled) {
        autopilotStatusBadge.textContent = `ON (${data.mode === 'timed_3h' ? `3시간 집중: ${data.cycleCount}/${data.maxCycles}회` : `24시간 상시: ${data.cycleCount}회`})`;
        autopilotStatusBadge.style.background = 'rgba(16, 185, 129, 0.2)';
        autopilotStatusBadge.style.color = '#34d399';
        autopilotStatusBadge.style.borderColor = 'rgba(16, 185, 129, 0.3)';

        if (btnStart3hMode) btnStart3hMode.style.display = 'none';
        if (btnStartContinuousMode) btnStartContinuousMode.style.display = 'none';
        if (btnStopAutoPilot) btnStopAutoPilot.style.display = 'inline-block';

        if (data.nextRunAt) {
          const nextTime = new Date(data.nextRunAt).toLocaleTimeString('ko-KR');
          autopilotNextRunText.textContent = `다음 실행: ${nextTime}`;
        } else {
          autopilotNextRunText.textContent = '현재 실행 중...';
        }
      } else {
        autopilotStatusBadge.textContent = 'OFF (대기 중)';
        autopilotStatusBadge.style.background = 'rgba(59, 130, 246, 0.2)';
        autopilotStatusBadge.style.color = '#60a5fa';
        autopilotStatusBadge.style.borderColor = 'rgba(59, 130, 246, 0.3)';

        if (btnStart3hMode) btnStart3hMode.style.display = 'inline-block';
        if (btnStartContinuousMode) btnStartContinuousMode.style.display = 'inline-block';
        if (btnStopAutoPilot) btnStopAutoPilot.style.display = 'none';
        autopilotNextRunText.textContent = '다음 실행: 대기 중';
      }
    } catch (e) {}
  }

  btnStart3hMode?.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/autopilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', mode: 'timed_3h', intervalMinutes: 30, followsPerCycle: 5, enableAutoPost: true })
      });
      const data = await res.json();
      if (data.success) {
        fetchAutoPilotStatus();
      }
    } catch (err) {
      alert(`오토파일럿 시작 오류: ${err.message}`);
    }
  });

  btnStartContinuousMode?.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/autopilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', mode: 'continuous', intervalMinutes: 30, followsPerCycle: 5, enableAutoPost: true })
      });
      const data = await res.json();
      if (data.success) {
        fetchAutoPilotStatus();
      }
    } catch (err) {
      alert(`오토파일럿 시작 오류: ${err.message}`);
    }
  });

  btnStopAutoPilot?.addEventListener('click', async () => {
    try {
      await fetch('/api/autopilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' })
      });
      fetchAutoPilotStatus();
    } catch (err) {}
  });

  // 6. 포스팅 카드 스튜디오 관리
  async function fetchCards() {
    try {
      const res = await fetch('/api/cards');
      const data = await res.json();
      currentCards = data.cards || [];

      sidebarCardBadge.textContent = currentCards.length;
      cardsCountText.textContent = currentCards.length;

      renderCards(currentCards);
    } catch (e) {
      console.error('카드 로드 실패:', e);
    }
  }

  // 필터 버튼 클릭
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentFilter = chip.getAttribute('data-filter');
      renderCards(currentCards);
    });
  });

  btnGenerateCards.addEventListener('click', async () => {
    btnGenerateCards.disabled = true;
    btnGenerateCards.innerHTML = `<span>⏳</span> 생성 중...`;
    try {
      const res = await fetch('/api/cards/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 6, source: 'best' })
      });
      const data = await res.json();
      if (data.cards) {
        currentCards = data.cards;
        sidebarCardBadge.textContent = currentCards.length;
        cardsCountText.textContent = currentCards.length;
        renderCards(currentCards);
      }
    } catch (e) {
      alert('카드 자동 생성 오류: ' + e.message);
    } finally {
      btnGenerateCards.disabled = false;
      btnGenerateCards.innerHTML = `<span>✨</span> 새 핫딜 카드 자동 생성`;
    }
  });

  function renderCards(cards) {
    let filtered = cards;
    if (currentFilter !== 'all') {
      filtered = cards.filter(c => c.status === currentFilter);
    }

    if (!filtered || filtered.length === 0) {
      cardsGrid.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 60px 0; text-align: center; color: var(--text-muted);">
          <div style="font-size: 32px; margin-bottom: 10px;">📦</div>
          <p>표시할 포스팅 카드가 없습니다. 상단의 <strong>[새 핫딜 카드 자동 생성]</strong> 버튼을 눌러보세요.</p>
        </div>
      `;
      return;
    }

    cardsGrid.innerHTML = '';

    filtered.forEach(card => {
      const el = document.createElement('div');
      el.className = 'thread-card';
      el.id = `card-dom-${card.id}`;

      const isPosted = card.status === 'POSTED';
      const isPosting = card.status === 'POSTING';

      el.innerHTML = `
        ${isPosted ? '<span class="card-status-badge badge-posted">✓ 발행완료</span>' : ''}
        ${isPosting ? '<span class="card-status-badge badge-posting">발행 진행중...</span>' : ''}

        <div class="card-top-bar">
          <span class="card-rank-badge">베스트 #${escapeHtml(card.rank || '1')}</span>
          <span class="card-tag-badge">${escapeHtml(card.tag || '🔥 특가')}</span>
        </div>

        <div class="card-product-info">
          <img class="product-thumb" src="${escapeHtml(safeUrl(card.imageUrl, 'https://via.placeholder.com/96'))}" alt="${escapeHtml(card.title)}" onerror="this.src='https://via.placeholder.com/96'">
          <div class="product-meta">
            <h4 class="product-title" title="${escapeHtml(card.title)}">${escapeHtml(card.title)}</h4>
            <div class="product-price-row">
              ${card.discountRate ? `<span class="product-discount">${escapeHtml(card.discountRate)}%</span>` : ''}
              <span class="product-price">${(card.price || 0).toLocaleString()}원</span>
            </div>
            <div class="product-reward">예상 수수료: ${(card.estimatedReward || 0).toLocaleString()}원 (10%)</div>
          </div>
        </div>

        <div class="card-content-box">
          <div class="content-preview-title">📝 스레드 본문</div>
          <div class="post-body-preview">${escapeHtml(card.postBody)}</div>

          <div class="content-preview-title">🛡️ 자동 댓글·답글 차단</div>
          <div class="first-comment-preview">최상위 본문 1건만 발행됩니다.</div>
        </div>

        <div class="card-action-bar">
          <button class="btn-card-post" data-id="${card.id}" ${isRunning ? 'disabled' : ''}>
            <span>🚀</span> 즉시 스레드 발행
          </button>
          <button class="btn-card-icon btn-edit-card" data-id="${card.id}" title="문구 편집">✏️</button>
          <button class="btn-card-icon btn-copy-card" data-id="${card.id}" title="본문 복사">📋</button>
          <button class="btn-card-icon btn-delete-card" data-id="${card.id}" title="카드 삭제">🗑️</button>
        </div>
      `;

      // 즉시 발행
      el.querySelector('.btn-card-post').addEventListener('click', async () => {
        if (!confirm(`[${card.title}] 글을 스레드에 지금 안전하게 발행하시겠습니까?`)) return;
        try {
          const res = await fetch(`/api/cards/${card.id}/post`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ headless: headlessToggle.checked })
          });
          const resData = await res.json();
          if (!res.ok) {
            alert(`오류: ${resData.error}`);
          } else {
            fetchStatus();
            fetchCards();
          }
        } catch (e) {
          alert(`에러: ${e.message}`);
        }
      });

      // 편집
      el.querySelector('.btn-edit-card').addEventListener('click', () => {
        openEditModal(card);
      });

      // 복사
      el.querySelector('.btn-copy-card').addEventListener('click', () => {
        navigator.clipboard.writeText(card.postBody).then(() => {
          alert('본문 텍스트가 복사되었습니다.');
        });
      });

      // 삭제
      el.querySelector('.btn-delete-card').addEventListener('click', async () => {
        if (!confirm('카드를 삭제하시겠습니까?')) return;
        await fetch(`/api/cards/${card.id}`, { method: 'DELETE' });
        fetchCards();
      });

      cardsGrid.appendChild(el);
    });
  }

  function escapeHtml(str) {
    if (str === null || str === undefined || str === '') return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /** 외부 응답·저장 데이터에 들어올 수 있는 위험한 프로토콜을 차단한 URL만 허용한다. */
  function safeUrl(url, fallback = '#') {
    const raw = String(url || '').trim();
    if (!raw) return fallback;
    if (/^(\/|\.\.\/|\.\/|#)/.test(raw)) return raw;
    if (/^(https?:|blob:|data:image\/)/i.test(raw)) return raw;
    return fallback;
  }

  // 모달 제어
  function openEditModal(card) {
    editCardId.value = card.id;
    modalCardTitle.textContent = `카드 문구 수정: ${card.title}`;
    editCardTag.value = card.tag || '';
    editCardBody.value = card.postBody || '';
    editCardComment.value = '';
    editCardComment.disabled = true;
    editModal.style.display = 'flex';
  }

  function closeEditModal() {
    editModal.style.display = 'none';
  }

  btnModalClose.addEventListener('click', closeEditModal);
  btnModalCancel.addEventListener('click', closeEditModal);

  btnModalSave.addEventListener('click', async () => {
    const id = editCardId.value;
    const tag = editCardTag.value;
    const postBody = editCardBody.value;

    try {
      const res = await fetch(`/api/cards/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag, postBody, firstComment: '' })
      });
      if (res.ok) {
        closeEditModal();
        fetchCards();
      }
    } catch (e) {
      alert(`수정 실패: ${e.message}`);
    }
  });

  // ================= 7. 라포 소통 & AI 댓글 관리 로직 =================
  const sidebarCommentBadge = document.getElementById('sidebarCommentBadge');
  const totalCommentsCount = document.getElementById('totalCommentsCount');
  const todayCommentsCount = document.getElementById('todayCommentsCount');
  const commentProgressFill = document.getElementById('commentProgressFill');
  const barCommentCount = document.getElementById('barCommentCount');
  const commentsTableBody = document.getElementById('commentsTableBody');
  const commentsTableBadge = document.getElementById('commentsTableBadge');
  const btnRunAutoComment = document.getElementById('btnRunAutoComment');
  const autoCommentBatchCount = document.getElementById('autoCommentBatchCount');
  const btnRefreshComments = document.getElementById('btnRefreshComments');

  let lastCommentsSignature = '';
  async function fetchCommentsHistory() {
    try {
      const res = await fetch('/api/comments-history');
      if (!res.ok) return;
      const data = await res.json();

      if (totalCommentsCount) totalCommentsCount.textContent = data.totalCount || 0;
      if (todayCommentsCount) todayCommentsCount.textContent = data.todayCount || 0;
      if (sidebarCommentBadge) sidebarCommentBadge.textContent = data.totalCount || 0;
      if (commentsTableBadge) commentsTableBadge.textContent = `${data.totalCount || 0}건`;
      if (barCommentCount) barCommentCount.textContent = data.todayCount || 0;

      if (commentProgressFill) {
        const pct = Math.min(100, Math.round(((data.todayCount || 0) / (data.dailyLimit || 30)) * 100));
        commentProgressFill.style.width = `${pct}%`;
      }

      if (commentsTableBody) {
        const historyList = data.history || [];
        const currentSignature = `${data.totalCount}_${data.todayCount}_${historyList.length}_${historyList[0]?.timestamp || ''}`;
        if (currentSignature === lastCommentsSignature) return; // 변경사항 없으면 DOM 재작성 생략!
        lastCommentsSignature = currentSignature;

        if (historyList.length === 0) {
          commentsTableBody.innerHTML = `
            <tr>
              <td colspan="5" style="text-align: center; padding: 30px; color: var(--text-sub);">
                아직 등록된 인바운드 답글 내역이 없습니다. 상단의 [내 게시물 미응답 댓글에 AI 답글] 버튼을 눌러보세요.
              </td>
            </tr>
          `;
          return;
        }

        // 최대 50건까지만 렌더링하여 무거운 테이블 렌더링 방지
        const displayHistory = historyList.slice(0, 50);
        commentsTableBody.innerHTML = displayHistory.map(item => {
          const timeStr = item.timestamp ? new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-';
          return `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.04); transition: background 0.2s;">
              <td style="padding: 14px; color: #94a3b8; font-size: 0.82rem; white-space: nowrap;">${timeStr}</td>
              <td style="padding: 14px; font-weight: 600; color: #38bdf8; white-space: nowrap;">@${escapeHtml(item.targetUser)}</td>
              <td style="padding: 14px; color: #cbd5e1; line-height: 1.5;">
                <div style="font-size: 0.86rem; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(item.targetPostSnippet)}">
                  ${escapeHtml(item.targetPostSnippet)}
                </div>
                <span style="font-size: 0.75rem; color: #64748b;">#${escapeHtml(item.keyword || item.category || '스하리')}</span>
              </td>
              <td style="padding: 14px; color: #f1f5f9; line-height: 1.5;">
                <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 8px 12px; font-size: 0.86rem;">
                  ${escapeHtml(item.generatedComment)}
                </div>
              </td>
              <td style="padding: 14px; white-space: nowrap;">
                <span style="background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); padding: 3px 8px; border-radius: 4px; font-size: 0.78rem; font-weight: 600;">
                  ✓ 발행완료
                </span>
              </td>
            </tr>
          `;
        }).join('');
      }
    } catch (err) {
      console.warn('댓글 기록 조회 실패:', err);
    }
  }

  if (btnRefreshComments) {
    btnRefreshComments.addEventListener('click', fetchCommentsHistory);
  }

  async function refreshRapportStatus() {
    if (!btnRunAutoComment) return;
    try {
      const res = await fetch('/api/rapport/status', { cache: 'no-store' });
      const data = await res.json();
      const ready = Boolean(data.permission?.ready);
      btnRunAutoComment.disabled = !ready;
      btnRunAutoComment.dataset.ready = String(ready);
      if (ready) {
        btnRunAutoComment.title = `내 게시물 인바운드 댓글 · 1회 최대 ${data.limits?.maxPerRun || 3}건 · 하루 ${data.usage?.remaining ?? 0}건 남음`;
        btnRunAutoComment.innerHTML = '<span>💬 내 게시물 미응답 댓글에 AI 답글</span>';
      } else {
        const missing = data.permission?.missing?.join(', ') || '권한 확인 실패';
        btnRunAutoComment.title = `Meta 앱 권한 연결 필요: ${missing}`;
        btnRunAutoComment.innerHTML = '<span>🔑 댓글 읽기·발행 권한 연결 필요</span>';
      }
    } catch (error) {
      btnRunAutoComment.disabled = true;
      btnRunAutoComment.title = error.message;
      btnRunAutoComment.innerHTML = '<span>⚠️ 라포 답글 상태 확인 실패</span>';
    }
  }

  if (btnRunAutoComment) {
    btnRunAutoComment.addEventListener('click', async () => {
      if (btnRunAutoComment.dataset.ready !== 'true') return refreshRapportStatus();
      const count = Math.min(3, Math.max(1, Number(autoCommentBatchCount?.value) || 1));
      if (!confirm(`내 게시물에 달린 미응답 댓글을 조회해 AI 라포 답글 ${count}건을 실행할까요?\n수동으로 이미 답한 댓글·타인끼리의 대화·중복·민감/홍보성 댓글은 자동 제외됩니다.`)) return;
      const original = btnRunAutoComment.innerHTML;
      btnRunAutoComment.disabled = true;
      btnRunAutoComment.innerHTML = '<span>⏳ 내 게시물 미응답 댓글 조회·실행 중...</span>';
      try {
        const res = await fetch('/api/run-rapport-replies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ count })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        alert(`✅ ${data.message}\n실행 결과는 실시간 콘솔과 댓글 내역에서 확인하세요.`);
      } catch (error) {
        alert(`❌ 라포 답글 실행 실패: ${error.message}`);
      } finally {
        btnRunAutoComment.innerHTML = original;
        await refreshRapportStatus();
        setTimeout(fetchCommentsHistory, 3000);
      }
    });
    refreshRapportStatus();
  }

  // ================= 8. 검색어 시장조사 =================
  const trendSearchForm = document.getElementById('trendSearchForm');
  const trendKeywordInput = document.getElementById('trendKeywordInput');
  const btnAnalyzeTrends = document.getElementById('btnAnalyzeTrends');
  const btnRefreshTrends = document.getElementById('btnRefreshTrends');
  const googleTrendList = document.getElementById('googleTrendList');
  const naverTrendList = document.getElementById('naverTrendList');
  const threadsTrendList = document.getElementById('threadsTrendList');
  const opportunityList = document.getElementById('opportunityList');
  const trendComparisonBody = document.getElementById('trendComparisonBody');
  let latestTrendData = null;

  function formatTrendTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function setTrendSource(source, state = {}) {
    const status = document.getElementById(`${source}SourceStatus`);
    const dot = document.getElementById(`${source}SourceDot`);
    if (status) status.textContent = state.label || '상태 확인 필요';
    if (dot) dot.className = `source-state ${state.status === 'connected' ? 'connected' : state.status === 'error' ? 'error' : state.status === 'permission_required' || state.status === 'warning' ? 'warning' : 'ready'}`;
  }

  function appendTrendKeyword(rawKeyword) {
    if (!trendKeywordInput) return;
    const cleanKeyword = rawKeyword.replace(/^#/, '').trim();
    const current = trendKeywordInput.value
      .split(',')
      .map(k => k.trim())
      .filter(Boolean);

    if (current.includes(cleanKeyword)) {
      trendKeywordInput.focus();
      return;
    }

    if (current.length >= 5) {
      current.shift(); // 5개 초과 시 첫 번째 항목 제거 후 추가
    }
    current.push(cleanKeyword);
    trendKeywordInput.value = current.join(', ');
    trendKeywordInput.focus();

    // 입력창 포커스 및 시각적 피드백
    trendKeywordInput.style.transition = 'background-color 0.2s ease';
    trendKeywordInput.style.backgroundColor = 'rgba(34, 211, 238, 0.18)';
    setTimeout(() => {
      trendKeywordInput.style.backgroundColor = 'transparent';
    }, 350);
  }

  function renderGoogleTrends(items = []) {
    if (!googleTrendList) return;
    if (!items.length) {
      googleTrendList.innerHTML = '<div class="trend-empty-state compact"><strong>급상승 데이터를 불러오지 못했습니다.</strong><p>잠시 후 새로고침해 주세요.</p></div>';
      return;
    }
    googleTrendList.innerHTML = items.slice(0, 8).map(item => `
      <article class="trend-list-item" data-keyword="${escapeHtml(item.keyword)}" title="클릭 시 검색창에 추가">
        <span class="item-rank">${item.rank}</span>
        <div class="item-content">
          <strong class="item-title">${escapeHtml(item.keyword)}</strong>
          <span class="item-sub">${escapeHtml(item.newsTitle || '연관 뉴스 확인 중')}</span>
        </div>
        <div class="item-stat">
          <b class="stat-value">${escapeHtml(item.trafficText || '-')}</b>
          <small class="stat-label">실시간</small>
        </div>
        <button type="button" class="item-add-btn">+ 담기</button>
      </article>
    `).join('');

    googleTrendList.querySelectorAll('.trend-list-item').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        appendTrendKeyword(el.dataset.keyword);
      });
    });
  }

  function renderNaverTrends(items = []) {
    if (!naverTrendList) return;
    if (!items.length) {
      naverTrendList.innerHTML = '<div class="trend-empty-state compact"><strong>네이버 인기 트렌드를 불러오는 중입니다.</strong></div>';
      return;
    }
    naverTrendList.innerHTML = items.slice(0, 8).map(item => `
      <article class="trend-list-item" data-keyword="${escapeHtml(item.keyword)}" title="클릭 시 검색창에 추가">
        <span class="item-rank">${item.rank}</span>
        <div class="item-content">
          <strong class="item-title">${escapeHtml(item.keyword)}</strong>
          <span class="item-sub">${escapeHtml(item.category)} · ${escapeHtml(item.badge)}</span>
        </div>
        <div class="item-stat">
          <b class="stat-value up">${escapeHtml(item.change)}</b>
          <small class="stat-label">관심도</small>
        </div>
        <button type="button" class="item-add-btn">+ 담기</button>
      </article>
    `).join('');

    naverTrendList.querySelectorAll('.trend-list-item').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        appendTrendKeyword(el.dataset.keyword);
      });
    });
  }

  function renderThreadsTrends(items = []) {
    if (!threadsTrendList) return;
    if (!items.length) {
      threadsTrendList.innerHTML = '<div class="trend-empty-state compact"><strong>Threads 실시간 핫 토픽을 불러오는 중입니다.</strong></div>';
      return;
    }
    threadsTrendList.innerHTML = items.slice(0, 8).map(item => `
      <article class="trend-list-item" data-keyword="${escapeHtml(item.keyword)}" title="클릭 시 검색창에 추가">
        <span class="item-rank">${item.rank}</span>
        <div class="item-content">
          <strong class="item-title">${escapeHtml(item.keyword)}</strong>
          <span class="item-sub">${escapeHtml(item.tag)} · ${escapeHtml(item.vibe)}</span>
        </div>
        <div class="item-stat">
          <b class="stat-value purple">${escapeHtml(item.mentions)}</b>
          <small class="stat-label">피드언급</small>
        </div>
        <button type="button" class="item-add-btn">+ 담기</button>
      </article>
    `).join('');

    threadsTrendList.querySelectorAll('.trend-list-item').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        appendTrendKeyword(el.dataset.keyword);
      });
    });
  }

  function getOpportunitySignature(items = []) {
    return items
      .map(item => `${item.keyword}:${item.score}:${item.grade}:${item.threads?.count ?? '-'}`)
      .sort()
      .join('|');
  }

  function renderOpportunities(items = [], analysisState = {}) {
    const top = items[0];
    const analyzedCount = document.getElementById('analyzedKeywordCount');
    const writeCount = document.getElementById('writeNowCount');
    const topKeyword = document.getElementById('topOpportunityKeyword');
    const topReason = document.getElementById('topOpportunityReason');

    if (analyzedCount) analyzedCount.textContent = items.length;
    if (writeCount) writeCount.textContent = items.filter(item => item.grade === '지금 작성').length;
    if (topKeyword) topKeyword.textContent = top?.keyword || '분석 대기';
    if (topReason) topReason.textContent = top?.reason || '검색어를 분석하면 추천 이유가 표시됩니다.';

    if (!opportunityList) return;
    if (!items.length) {
      opportunityList.innerHTML = '<div class="trend-empty-state"><span>◎</span><strong>분석 결과가 없습니다</strong><p>다른 검색어로 다시 시도해 주세요.</p></div>';
      return;
    }

    const completionMessage = analysisState.isUnchanged
      ? '재분석을 완료했지만 이전 결과와 동일합니다. 입력한 키워드와 수집 데이터에 변동이 없습니다.'
      : '새 분석 결과를 반영했습니다. 점수와 추천 상태는 아래 근거 데이터에 따라 갱신됩니다.';
    const threads = analysisState.threads;
    const threadsMessage = threads?.failed
      ? `Threads 검색 ${threads.successful}/${threads.requested}건 완료 · ${threads.failed}건은 확인하지 못했습니다.`
      : threads?.requested
        ? `Threads 검색 ${threads.successful}/${threads.requested}건 확인 완료`
        : '';

    opportunityList.innerHTML = `
      <div class="trend-analysis-notice ${analysisState.isUnchanged ? 'unchanged' : ''}">
        <strong>${analysisState.isUnchanged ? '◎ 결과 변동 없음' : '✓ 교차 분석 완료'}</strong>
        <span>${completionMessage}</span>
        ${threadsMessage ? `<small>${escapeHtml(threadsMessage)}</small>` : ''}
      </div>
    ` + items.map((item, index) => `
      <article class="opportunity-item ${index === 0 ? 'best' : ''}">
        <div class="opportunity-rank">${String(index + 1).padStart(2, '0')}</div>
        <div class="opportunity-main">
          <div class="opportunity-title-row">
            <strong>${escapeHtml(item.keyword)}</strong>
            <span class="grade grade-${item.grade === '지금 작성' ? 'hot' : item.grade === '관찰 후보' ? 'watch' : 'hold'}">${item.grade}</span>
          </div>
          <p>${escapeHtml(item.reason)}</p>
        </div>
        <div class="score-ring" style="--score:${item.score}">
          <strong>${item.score}</strong>
          <span>점</span>
        </div>
        <button type="button" class="pin-topic-btn" data-topic="${escapeHtml(item.keyword)}">후보 고정</button>
      </article>
    `).join('');

    document.querySelectorAll('.pin-topic-btn').forEach(button => {
      button.addEventListener('click', () => {
        localStorage.setItem('pinnedTrendKeyword', button.dataset.topic);
        document.querySelectorAll('.pin-topic-btn').forEach(item => {
          item.classList.toggle('pinned', item.dataset.topic === button.dataset.topic);
          item.textContent = item.dataset.topic === button.dataset.topic ? '✓ 고정됨' : '후보 고정';
        });
      });
    });
  }

  function renderComparison(items = []) {
    if (!trendComparisonBody) return;
    if (!items.length) {
      trendComparisonBody.innerHTML = '<tr><td colspan="7" class="trend-table-empty">분석 결과가 없습니다.</td></tr>';
      return;
    }
    trendComparisonBody.innerHTML = items.map(item => {
      const change = item.naver?.change;
      const changeClass = change > 0 ? 'metric-up' : change < 0 ? 'metric-down' : 'metric-flat';
      return `
        <tr>
          <td><strong>${escapeHtml(item.keyword)}</strong></td>
          <td><b class="total-score">${item.score}</b> / 100</td>
          <td>${item.naver ? `${item.naver.latest}` : '<span class="metric-muted">-</span>'}</td>
          <td class="${changeClass}">${typeof change === 'number' ? `${change > 0 ? '↑' : change < 0 ? '↓' : '–'} ${Math.abs(change)}%` : '-'}</td>
          <td>${item.google ? `<span class="rank-pill">${item.google.rank}위</span>` : '<span class="metric-muted">해당 없음</span>'}</td>
          <td>${item.threads && typeof item.threads.count === 'number' ? `<span class="threads-count-badge">${item.threads.count}건</span>` : '<span class="metric-muted">0건</span>'}</td>
          <td><span class="grade grade-${item.grade === '지금 작성' ? 'hot' : item.grade === '관찰 후보' ? 'watch' : 'hold'}">${item.grade}</span></td>
        </tr>`;
    }).join('');
  }

  async function loadTrendOverview() {
    try {
      const response = await fetch('/api/trends/overview');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '급상승 검색어 조회 실패');
      renderGoogleTrends(data.googleTrends || []);
      renderNaverTrends(data.naverTrends || []);
      renderThreadsTrends(data.threadsTrends || []);
      Object.entries(data.sources || {}).forEach(([source, state]) => setTrendSource(source, state));
      const updatedEl = document.getElementById('trendUpdatedAt');
      if (updatedEl) updatedEl.textContent = formatTrendTime(data.updatedAt);
    } catch (error) {
      setTrendSource('google', { status: 'error', label: '연결 실패' });
      if (googleTrendList) {
        googleTrendList.innerHTML = `<div class="trend-empty-state compact"><strong>데이터 연결 실패</strong><p>${escapeHtml(error.message)}</p></div>`;
      }
    }
  }

  async function analyzeTrends() {
    const keywords = trendKeywordInput.value.split(',').map(value => value.trim()).filter(Boolean).slice(0, 5);
    if (!keywords.length) {
      trendKeywordInput.focus();
      return;
    }

    btnAnalyzeTrends.disabled = true;
    btnAnalyzeTrends.innerHTML = '<span>⏳ 3대 플랫폼 교차 분석 중…</span>';
    if (opportunityList) {
      opportunityList.innerHTML = '<div class="trend-loading"><i></i><strong>세 플랫폼의 신호를 교차 분석하고 있습니다</strong><span>네이버 데이터랩, Google Trends, Threads 트랙 A를 동시 검증합니다.</span></div>';
    }

    try {
      const response = await fetch('/api/trends/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords, includeThreads: true })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '검색어 분석 실패');
      const previousSignature = latestTrendData
        ? getOpportunitySignature(latestTrendData.opportunities || [])
        : '';
      const nextSignature = getOpportunitySignature(data.opportunities || []);
      renderGoogleTrends(data.googleTrends || []);
      renderNaverTrends(data.naverTrends || []);
      renderThreadsTrends(data.threadsTrends || []);
      renderOpportunities(data.opportunities || [], {
        isUnchanged: Boolean(previousSignature && previousSignature === nextSignature),
        threads: data.analysis?.threads
      });
      renderComparison(data.opportunities || []);
      latestTrendData = data;
      Object.entries(data.sources || {}).forEach(([source, state]) => setTrendSource(source, state));
      const updatedEl = document.getElementById('trendUpdatedAt');
      if (updatedEl) updatedEl.textContent = formatTrendTime(data.updatedAt);
    } catch (error) {
      if (opportunityList) {
        opportunityList.innerHTML = `<div class="trend-empty-state"><span>!</span><strong>분석을 완료하지 못했습니다</strong><p>${escapeHtml(error.message)}</p></div>`;
      }
    } finally {
      btnAnalyzeTrends.disabled = false;
      btnAnalyzeTrends.innerHTML = '<span>⚡ 교차 분석 시작</span>';
    }
  }

  if (trendSearchForm) trendSearchForm.addEventListener('submit', event => { event.preventDefault(); analyzeTrends(); });
  if (btnRefreshTrends) btnRefreshTrends.addEventListener('click', loadTrendOverview);
  document.querySelectorAll('.quick-keyword-chip').forEach(button => {
    button.addEventListener('click', () => {
      trendKeywordInput.value = button.dataset.keywords;
      analyzeTrends();
    });
  });

  // ================= 게시물 발행 페이지 =================
  const pubBody = document.getElementById('pubBody');
  const pubFirstComment = document.getElementById('pubFirstComment');
  const pubTypeGroup = document.getElementById('pubTypeGroup');
  const pubMediaSlot = document.getElementById('pubMediaSlot');
  const pubVaultModal = document.getElementById('pubVaultModal');
  const pubVaultList = document.getElementById('pubVaultList');
  const pubVaultCategory = document.getElementById('pubVaultCategory');
  const pubTagCloud = document.getElementById('pubTagCloud');
  const btnPublishNow = document.getElementById('btnPublishNow');

  // 검색어 시장조사에서 확정된 상용 검색어 + 확장형 태그
  const PUBLISH_TAGS = [
    '#핫딜정보', '#오늘의핫딜', '#쿠폰정보', '#할인쿠폰',
    '#가성비템', '#가성비추천', '#선물추천', '#선물고민',
    '#특가정보', '#오늘특가', '#자취꿀템', '#절약노하우',
    '#스하리', '#반하리', '#스친', '#밸런스게임', '#일상공감'
  ];

  let pubVaultItems = [];
  let pubSelectedVaultId = null;
  // 선택된 뉴스 후보의 기사 원문 링크 및 정보.
  let pubSelectedSourceLink = '';
  let pubSelectedArticleTitle = '';
  let pubCurrentSelectedCand = null;

  function setMeter(el, ok) {
    if (!el) return;
    el.classList.toggle('is-ok', ok);
    el.classList.toggle('is-warn', !ok);
  }

  // 계획서 §2-3 발행 규격을 입력 즉시 검사한다.
  function updatePublishMeters() {
    const text = pubBody.value;
    const lines = text.split('\n');
    const blankLines = lines.filter(line => !line.trim()).length;
    const blankRatio = lines.length ? Math.round((blankLines / lines.length) * 100) : 0;
    const tagCount = (text.match(/#[^\s#]+/g) || []).length;
    // 클로징은 해시태그 줄이 아니라 그 앞의 마지막 문장에서 찾는다.
    // (게시물 대부분이 태그로 끝나므로 태그 줄만 보면 항상 '없음'이 된다)
    const lastLine = [...lines].reverse().find(line => {
      const trimmed = line.trim();
      return trimmed && !/^(#[^\s#]+\s*)+$/.test(trimmed);
    }) || '';
    const hasQuestion = /[?？]/.test(lastLine) || /(세요|실래요|나요|까요|어때요)/.test(lastLine);

    document.getElementById('mLen').textContent = text.length;
    document.getElementById('mBlank').textContent = blankRatio;
    document.getElementById('mTag').textContent = tagCount;
    document.getElementById('mClose').textContent = hasQuestion ? '있음' : '없음';

    setMeter(document.getElementById('meterLen'), text.length >= 180 && text.length <= 350);
    setMeter(document.getElementById('meterBlank'), blankRatio >= 30 && blankRatio <= 50);
    setMeter(document.getElementById('meterTag'), tagCount >= 3 && tagCount <= 5);
    setMeter(document.getElementById('meterClose'), hasQuestion);

    // 미리보기
    const preview = document.getElementById('pubPreviewBody');
    if (text.trim()) preview.textContent = text;
    else preview.innerHTML = '<span class="pub-preview-empty">본문을 입력하면 여기에 표시됩니다.</span>';
  }

  function updateFirstCommentState() {
    // 발행 화면에서 답글 데이터가 남거나 전송되지 않도록 항상 비운다.
    if (pubFirstComment) pubFirstComment.value = '';
    document.getElementById('pubAffiliateWarn').hidden = true;
    const replyBox = document.getElementById('pubPreviewReply');
    replyBox.hidden = true;
    document.getElementById('pubPreviewReplyBody').textContent = '';
  }

  // 관련 링크 자동 생성 버튼 연동
  const btnGenRelatedLink = document.getElementById('btnGenRelatedLink');
  btnGenRelatedLink?.addEventListener('click', async () => {
    const body = pubBody.value.trim();
    if (!body) {
      alert('본문 내용을 먼저 입력하거나 왼쪽 후보에서 카드를 선택해 주세요.');
      pubBody.focus();
      return;
    }

    const originalText = btnGenRelatedLink.innerHTML;
    btnGenRelatedLink.disabled = true;
    btnGenRelatedLink.innerHTML = '<span>⏳</span> 링크 찾는 중...';

    // 선택된 후보의 원본 뉴스 기사 링크 또는 저장된 소스 링크 확인 (100% 원문 일치 보장)
    const sourceLink = pubSelectedSourceLink || pubCurrentSelectedCand?.article?.link || '';
    const articleTitle = pubSelectedArticleTitle || pubCurrentSelectedCand?.article?.title || '';

    try {
      const res = await fetch('/api/generate-related-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postBody: body,
          sourceLink,
          articleTitle
        })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '링크 생성 실패');

      pubBody.value = data.postBodyWithLink || body;
      if (data.linkUrl) {
        pubSelectedSourceLink = data.linkUrl;
        pubSelectedArticleTitle = data.articleTitle || '';
      }
      updatePublishMeters();
      alert(`✅ [${data.articleTitle || '관련 기사'}] 링크가 본문에 안전하게 추가되었습니다.`);
    } catch (err) {
      alert(`❌ 관련 링크 생성 오류: ${err.message}`);
    } finally {
      btnGenRelatedLink.disabled = false;
      btnGenRelatedLink.innerHTML = originalText;
    }
  });

  pubBody?.addEventListener('input', () => {
    // 본문을 직접 수정하더라도 이미 선택된 후보 카드가 있다면 소스 링크를 유지하고,
    // 완전히 본문이 비었을 때만 초기화
    if (!pubBody.value.trim()) {
      pubSelectedVaultId = null;
      pubSelectedSourceLink = '';
      pubSelectedArticleTitle = '';
    }
    updatePublishMeters();
  });
  pubFirstComment?.addEventListener('input', updateFirstCommentState);

  // 유형 선택 및 AI 미디어 생성 연동
  const pubAiMediaCard = document.getElementById('pubAiMediaCard');
  const pubAiMediaTitle = document.getElementById('pubAiMediaTitle');
  const pubAiMediaDesc = document.getElementById('pubAiMediaDesc');
  const btnGenAiMedia = document.getElementById('btnGenAiMedia');
  const pubStyleGroup = document.getElementById('pubStyleGroup');
  const pubCharacterToggle = document.getElementById('pubCharacterToggle');
  const pubUseYuna = document.getElementById('pubUseYuna');
  let pubImageStyle = 'photo'; // 기본 이미지 스타일 (시네마틱 실사)

  const STYLE_LABELS = {
    photo: '시네마틱 실사',
    editorial: '킨포크 감성',
    webtoon: '한국 웹툰',
    anime: '일본 애니',
    '3d_render': '픽사 3D',
    retro_film: '90s 필름',
    card: '글씨 카드'
  };

  // 이미지 스타일 세그먼트 선택
  pubStyleGroup?.querySelectorAll('.pub-style').forEach(btn => {
    btn.addEventListener('click', () => {
      pubStyleGroup.querySelectorAll('.pub-style').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      pubImageStyle = btn.dataset.style || 'photo';
      updateAiMediaSlot('image');
    });
  });

  function updateAiMediaSlot(type) {
    // 스타일 선택은 이미지/비디오 모두 노출 (장면 화풍 공통)
    if (pubStyleGroup) pubStyleGroup.style.display = (type === 'text') ? 'none' : '';
    // 캐릭터 토글은 장면 스타일(anime/webtoon)에서만 노출 (글씨 카드 제외)
    if (pubCharacterToggle) {
      const showChar = (type !== 'text' && pubImageStyle !== 'card');
      pubCharacterToggle.style.display = showChar ? '' : 'none';
    }

    if (type === 'image') {
      const label = STYLE_LABELS[pubImageStyle] || '시네마틱 실사';
      if (pubImageStyle === 'card') {
        if (pubAiMediaTitle) pubAiMediaTitle.innerHTML = '✨ 본문 맞춤 AI 4:5 글씨 카드 자동 생성';
        if (pubAiMediaDesc) pubAiMediaDesc.textContent = '본문 핵심 훅을 분석해 스레드 최적 4:5 고화질 글씨 카드를 자동 렌더링합니다.';
      } else {
        if (pubAiMediaTitle) pubAiMediaTitle.innerHTML = `✨ 본문 맞춤 AI ${label} 장면 자동 생성`;
        if (pubAiMediaDesc) pubAiMediaDesc.textContent = `본문의 감정을 분석해 드라마 한 컷처럼 감성적인 ${label} 장면 이미지를 자동 생성합니다.`;
      }
      if (btnGenAiMedia) btnGenAiMedia.innerHTML = `<span>✨</span> AI ${label} 생성`;
    } else if (type === 'video') {
      if (pubAiMediaTitle) pubAiMediaTitle.innerHTML = '🎬 본문 맞춤 AI 숏폼 모션 비디오 자동 생성';
      if (pubAiMediaDesc) pubAiMediaDesc.textContent = '시네마틱 줌인 모션이 적용된 스레드 4:5 세로 숏폼 비디오를 자동 렌더링합니다.';
      if (btnGenAiMedia) btnGenAiMedia.innerHTML = '<span>🎬</span> AI 숏폼 비디오 생성';
    }
  }

  pubTypeGroup?.querySelectorAll('.pub-type').forEach(btn => {
    btn.addEventListener('click', () => {
      pubTypeGroup.querySelectorAll('.pub-type').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const isMedia = btn.dataset.type !== 'text';
      pubMediaSlot.hidden = !isMedia;
      if (isMedia) {
        updateAiMediaSlot(btn.dataset.type);
      }
    });
  });

  // AI 미디어 자동 생성 실행
  btnGenAiMedia?.addEventListener('click', async () => {
    const body = pubBody.value.trim();
    if (!body) {
      alert('본문 내용을 먼저 입력하거나 왼쪽 후보에서 카드를 선택해 주세요.');
      pubBody.focus();
      return;
    }

    const activeType = pubTypeGroup.querySelector('.pub-type.active')?.dataset.type || 'image';
    const styleLabel = STYLE_LABELS[pubImageStyle] || '이미지';
    const originalText = btnGenAiMedia.innerHTML;
    btnGenAiMedia.disabled = true;
    btnGenAiMedia.innerHTML = `<span>⏳</span> AI ${activeType === 'video' ? '비디오' : styleLabel} 생성 중...`;

    try {
      const res = await fetch('/api/generate-ai-media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postBody: body,
          type: activeType,
          style: pubImageStyle,
          character: (pubUseYuna && pubUseYuna.checked && pubImageStyle !== 'card') ? 'yuna' : null,
          videoMode: 'motion',
          // 본문이 바뀌지 않았다면 프롬프트 추출에서 확정한 장면 설계도를 그대로 쓴다.
          sceneSpec: (lastSceneSpec && lastSceneSpecBody === body) ? lastSceneSpec : null
        })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '생성 실패');

      uploadedMedia.push({
        fileName: data.media.fileName,
        size: data.media.size,
        type: data.media.type || activeType,
        title: data.media.title || (activeType === 'video' ? '스레드 숏폼 비디오' : '스레드 AI 장면 이미지'),
        url: data.media.url || `/uploads/${data.media.fileName}`
      });
      renderMediaList();
      if (pubMediaList) {
        pubMediaList.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      alert(`🎉 AI ${activeType === 'video' ? '숏폼 비디오' : styleLabel + ' 이미지'}가 성공적으로 생성되어 첨부되었습니다!\n[${data.media.title || data.media.fileName}]`);
    } catch (err) {
      alert(`❌ AI 미디어 생성 실패: ${err.message}`);
    } finally {
      btnGenAiMedia.disabled = false;
      btnGenAiMedia.innerHTML = originalText;
    }
  });

  // PromptDaily 최상위 프롬프트 추출 & 원클릭 복사 (엔진별 변형 + 재추첨)
  const btnGetAiPrompt = document.getElementById('btnGetAiPrompt');
  const pubPromptBox = document.getElementById('pubPromptBox');
  const pubPromptContent = document.getElementById('pubPromptContent');
  const pubPromptTag = document.getElementById('pubPromptTag');
  const pubPromptMeta = document.getElementById('pubPromptMeta');
  const pubPromptTabs = document.getElementById('pubPromptTabs');
  const pubPromptScene = document.getElementById('pubPromptScene');
  const pubSceneSpecEditor = document.getElementById('pubSceneSpecEditor');
  const btnCopyPromptText = document.getElementById('btnCopyPromptText');
  const btnRerollPrompt = document.getElementById('btnRerollPrompt');

  // 마지막 추출 결과와 선택된 엔진 (기본: 미드저니)
  let lastPromptData = null;
  let activeEngine = 'midjourney';
  // 프롬프트 추출에서 확정한 공통 장면 설계도. 같은 본문에서의 AI 직접 생성이 같은 장면을 쓰도록 넘긴다.
  let lastSceneSpec = null;
  let lastSceneSpecBody = '';

  const SCENE_SPEC_FIELDS = [
    ['subject', '인물'],
    ['action', '행동'],
    ['setting', '배경'],
    ['time_of_day', '시간'],
    ['props', '소품'],
    ['emotion', '감정'],
    ['light', '조명'],
    ['camera', '구도'],
    ['fashion', '패션'],
    ['weather', '날씨'],
    ['texture', '질감']
  ];
  const sceneSpecLocks = new Set();

  function renderPromptBox() {
    if (!lastPromptData) return;
    const { variants, styleName, aspectRatio, scene, negatives } = lastPromptData;

    // 엔진 탭: 서버가 variants를 주면 탭 렌더, 구버전 응답이면 탭 숨김
    if (pubPromptTabs) {
      if (variants) {
        if (!variants[activeEngine]) activeEngine = Object.keys(variants)[0];
        pubPromptTabs.innerHTML = Object.entries(variants).map(([key, v]) =>
          `<button type="button" class="pub-prompt-tab${key === activeEngine ? ' active' : ''}" data-engine="${key}">${v.label}</button>`
        ).join('');
        pubPromptTabs.hidden = false;
      } else {
        pubPromptTabs.innerHTML = '';
        pubPromptTabs.hidden = true;
      }
    }

    const text = variants?.[activeEngine]?.prompt || lastPromptData.fullPrompt || '';
    if (pubPromptContent) pubPromptContent.textContent = text;
    if (pubPromptTag) pubPromptTag.textContent = `🎯 ${styleName}`;
    if (pubPromptMeta) pubPromptMeta.textContent = `비율: ${aspectRatio}${negatives ? ` · 차단 ${negatives.length}종` : ''}`;

    // 어떤 장면으로 해석했는지 노출 (원하는 그림이 아니면 본문을 고치거나 아래 칩을 다시 뽑을 수 있게)
    const spec = lastSceneSpec || lastPromptData.sceneSpec;
    if (pubPromptScene) {
      if (scene || spec) {
        const subject = spec?.subject || scene?.subject;
        const action = spec?.action || scene?.action;
        const setting = spec?.setting || scene?.setting;
        const timeOfDay = spec?.time_of_day || scene?.time_of_day;
        const props = spec?.props || scene?.props;
        const parts = [
          `주제: ${subject}`,
          `행동: ${action}`,
          `배경: ${setting}`,
          `시간: ${timeOfDay}`,
          props ? `소품: ${props}` : '',
          spec?.light ? `조명: ${spec.light}` : '',
          spec?.camera ? `구도: ${spec.camera}` : ''
        ].filter(Boolean);
        pubPromptScene.textContent = `해석된 장면 — ${parts.join(' / ')} · 이 설계도가 AI 직접 생성에도 그대로 쓰입니다.`;
        pubPromptScene.hidden = false;
      } else {
        pubPromptScene.hidden = true;
      }
    }
    renderSceneSpecEditor();
    if (pubPromptBox) pubPromptBox.hidden = false;
  }

  function renderSceneSpecEditor() {
    if (!pubSceneSpecEditor || !lastSceneSpec) {
      if (pubSceneSpecEditor) pubSceneSpecEditor.innerHTML = '';
      return;
    }
    pubSceneSpecEditor.innerHTML = SCENE_SPEC_FIELDS.map(([field, label]) => {
      const value = lastSceneSpec[field];
      if (!value) return '';
      const locked = sceneSpecLocks.has(field);
      return `<div class="scene-chip${locked ? ' is-locked' : ''}" data-field="${field}" role="button" tabindex="0" title="클릭해 ${locked ? '잠금 해제' : '잠금'}">
        <span class="scene-key">${escapeHtml(label)}</span>
        <span class="scene-value">${escapeHtml(value)}</span>
        <span class="scene-lock" aria-hidden="true">${locked ? '🔒' : '🔓'}</span>
      </div>
      <button type="button" class="scene-reroll" data-field="${field}" title="${escapeHtml(label)} 다시 뽑기" aria-label="${escapeHtml(label)} 다시 뽑기" ${locked ? 'disabled' : ''}>⟳</button>`;
    }).join('');
  }

  async function rerollSceneField(field) {
    if (!lastSceneSpec || sceneSpecLocks.has(field)) return;
    const body = lastSceneSpecBody || pubBody.value.trim();
    if (!body) return;

    // 같은 설계도에서 해당 항목만 제외해 서버가 그 항목만 새로 채우도록 한다.
    const partial = { ...lastSceneSpec };
    delete partial.version;
    delete partial[field];
    delete partial.harmony;

    const res = await fetch('/api/generate-image-prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postBody: body, sceneSpec: partial })
    });
    const data = await res.json();
    const pData = data.promptData || data.data;
    if (!data.success || !pData) throw new Error(data.error || '장면 재추첨 실패');

    lastPromptData = pData;
    lastSceneSpec = pData.sceneSpec || lastSceneSpec;
    lastSceneSpecBody = body;
    renderPromptBox();
  }

  async function copyActivePrompt(silent = false) {
    const text = pubPromptContent?.textContent?.trim();
    if (!text) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      if (!silent) alert('프롬프트 텍스트를 수동으로 복사해 주세요.');
      return false;
    }
  }

  async function fetchPrompt({ silentCopy = false, reroll = false } = {}) {
    const body = pubBody.value.trim();
    if (!body) {
      alert('본문 내용을 먼저 입력하거나 왼쪽 후보에서 카드를 선택해 주세요.');
      pubBody.focus();
      return;
    }

    // "전체 다시 뽑기"에서는 잠긴 항목만 이전 설계도에서 물려주고, 나머지는 서버가 새로 채운다.
    const prevSpec = (reroll && lastSceneSpec && lastSceneSpecBody === body) ? lastSceneSpec : null;
    let requestSpec = null;
    if (prevSpec) {
      const lockedOnly = {};
      for (const [field] of SCENE_SPEC_FIELDS) {
        if (sceneSpecLocks.has(field) && prevSpec[field]) lockedOnly[field] = prevSpec[field];
      }
      if (Object.keys(lockedOnly).length) requestSpec = lockedOnly;
    }

    const res = await fetch('/api/generate-image-prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postBody: body, sceneSpec: requestSpec })
    });
    const data = await res.json();
    const pData = data.promptData || data.data;
    if (!data.success || !pData) throw new Error(data.error || '프롬프트 추출 실패');

    // 서버가 잠금을 무시할 여지는 없지만, 방어적으로 잠긴 값을 다시 덮어쓴다.
    let nextSpec = pData.sceneSpec || null;
    if (nextSpec && prevSpec) {
      nextSpec = { ...nextSpec };
      for (const [field] of SCENE_SPEC_FIELDS) {
        if (sceneSpecLocks.has(field) && prevSpec[field]) nextSpec[field] = prevSpec[field];
      }
    }

    lastPromptData = pData;
    lastSceneSpec = nextSpec;
    lastSceneSpecBody = body;
    renderPromptBox();
    const copied = await copyActivePrompt(true);
    if (copied && !silentCopy) {
      alert(`📋 ${pData.variants?.[activeEngine]?.label || '이미지'} 프롬프트가 클립보드에 복사되었습니다!

[스타일: ${pData.styleName}]
상단 탭으로 다른 엔진용 문장을 바로 바꿔 복사할 수 있습니다.`);
    } else if (!copied) {
      pubPromptBox?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  async function runPromptTask(btn, loadingHtml, task) {
    if (!btn) return;
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = loadingHtml;
    try {
      await task();
    } catch (err) {
      alert(`❌ 프롬프트 추출 실패: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  }

  btnGetAiPrompt?.addEventListener('click', () =>
    runPromptTask(btnGetAiPrompt, '<span>⏳</span> PromptDaily 추출 중...', () => fetchPrompt())
  );

  // 같은 본문으로 렌즈·조명·구도만 다시 굴린다 (한 번에 마음에 드는 컷이 안 나올 때)
  btnRerollPrompt?.addEventListener('click', () =>
    runPromptTask(btnRerollPrompt, '🎲 …', () => fetchPrompt({ silentCopy: true, reroll: true }))
  );

  // 장면 설계도 편집: 칩을 클릭해 잠금/해제, ⟳ 버튼으로 해당 항목만 재추첨
  pubSceneSpecEditor?.addEventListener('click', (e) => {
    const chip = e.target.closest('.scene-chip');
    if (chip) {
      const field = chip.getAttribute('data-field');
      if (sceneSpecLocks.has(field)) sceneSpecLocks.delete(field);
      else sceneSpecLocks.add(field);
      renderSceneSpecEditor();
      return;
    }
    const rerollBtn = e.target.closest('.scene-reroll');
    if (rerollBtn && !rerollBtn.disabled) {
      rerollSceneField(rerollBtn.getAttribute('data-field')).catch(err => {
        alert(`❌ 장면 재추첨 실패: ${err.message}`);
      });
    }
  });

  pubSceneSpecEditor?.addEventListener('keydown', (e) => {
    const chip = e.target.closest('.scene-chip');
    if (!chip || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    const field = chip.getAttribute('data-field');
    if (sceneSpecLocks.has(field)) sceneSpecLocks.delete(field);
    else sceneSpecLocks.add(field);
    renderSceneSpecEditor();
  });

  pubPromptTabs?.addEventListener('click', (e) => {
    const tab = e.target.closest('.pub-prompt-tab');
    if (!tab) return;
    activeEngine = tab.getAttribute('data-engine');
    renderPromptBox();
  });

  btnCopyPromptText?.addEventListener('click', async () => {
    if (await copyActivePrompt()) {
      btnCopyPromptText.textContent = '✅ 복사 완료!';
      setTimeout(() => { btnCopyPromptText.textContent = '📋 복사'; }, 2000);
    }
  });

  // 게시물 성과 회수 (공식 API insights) — 시간대별 평균으로 최적 발행 시각을 실측한다
  const btnLoadInsights = document.getElementById('btnLoadInsights');
  const insightsBody = document.getElementById('insightsBody');

  const kstLabel = (iso) =>
    new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(5, 16).replace('T', ' ');

  btnLoadInsights?.addEventListener('click', async () => {
    const orig = btnLoadInsights.innerHTML;
    btnLoadInsights.disabled = true;
    btnLoadInsights.innerHTML = '⏳ 회수 중...';
    try {
      const res = await fetch('/api/insights');
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '성과 회수 실패');

      const { rows, byHour, username } = data;
      if (!rows.length) {
        insightsBody.innerHTML = '<p class="insights-empty">회수된 게시물이 없습니다.</p>';
        return;
      }

      const maxAvg = Math.max(...byHour.map(b => b.avgViews), 1);
      const hourHtml = byHour.map(b => `
        <div class="ins-hour">
          <span class="ins-hour-label">${String(b.hour).padStart(2, '0')}시</span>
          <div class="ins-hour-track"><div class="ins-hour-fill" style="width:${Math.round(b.avgViews / maxAvg * 100)}%"></div></div>
          <span class="ins-hour-val">${b.avgViews.toLocaleString()}회 · 댓글 ${b.avgReplies} · ${b.posts}건</span>
        </div>`).join('');

      const rowHtml = rows.map(r => `
        <tr>
          <td class="ins-num">${kstLabel(r.timestamp)}</td>
          <td class="ins-num"><b>${r.views.toLocaleString()}</b></td>
          <td class="ins-num">${r.likes}</td>
          <td class="ins-num">${r.replies}</td>
          <td><a href="${r.permalink}" target="_blank" rel="noopener">${r.text || '(본문 없음)'}</a></td>
        </tr>`).join('');

      insightsBody.innerHTML = `
        <p class="insights-meta">@${username} · 최근 ${rows.length}건 · 표본이 적으면 시간대 평균은 참고용입니다.</p>
        <div class="ins-hours">${hourHtml}</div>
        <div class="ins-table-wrap">
          <table class="ins-table">
            <thead><tr><th>발행(KST)</th><th>조회</th><th>좋아요</th><th>댓글</th><th>첫 줄</th></tr></thead>
            <tbody>${rowHtml}</tbody>
          </table>
        </div>`;
    } catch (err) {
      insightsBody.innerHTML = `<p class="insights-empty" style="color:#fca5a5">❌ ${err.message}</p>`;
    } finally {
      btnLoadInsights.disabled = false;
      btnLoadInsights.innerHTML = orig;
    }
  });

  // ---- 발행 후보 생성 & 선택 ----
  const pubWorkspace = document.getElementById('pubWorkspace');
  const btnGenCandidates = document.getElementById('btnGenCandidates');
  const pubCandPanel = document.getElementById('pubCandPanel');
  const pubCandGrid = document.getElementById('pubCandGrid');
  const pubCandApplied = document.getElementById('pubCandApplied');

  // 모바일 전용 뷰 스위처 (후보 선택 vs 본문 편집)
  const tabMobCand = document.getElementById('tabMobCand');
  const tabMobEditor = document.getElementById('tabMobEditor');
  const mobCandCountBadge = document.getElementById('mobCandCountBadge');

  function setMobileView(view) {
    if (!pubWorkspace) return;
    if (view === 'cand') {
      pubWorkspace.classList.add('mob-view-cand');
      pubWorkspace.classList.remove('mob-view-editor');
      tabMobCand?.classList.add('active');
      tabMobEditor?.classList.remove('active');
    } else {
      pubWorkspace.classList.add('mob-view-editor');
      pubWorkspace.classList.remove('mob-view-cand');
      tabMobEditor?.classList.add('active');
      tabMobCand?.classList.remove('active');
    }
  }

  tabMobCand?.addEventListener('click', () => setMobileView('cand'));
  tabMobEditor?.addEventListener('click', () => setMobileView('editor'));

  // 후보를 고른 뒤 본문을 확인하고 싶을 때만 의도적으로 내려간다.
  document.getElementById('btnGoToBody')?.addEventListener('click', () => {
    if (window.innerWidth <= 768) {
      setMobileView('editor');
    }
    pubBody.scrollIntoView({ behavior: 'smooth', block: 'center' });
    pubBody.focus();
  });

  /** 계획서 §2-3 규격을 몇 개 만족하는지 센다. 후보를 고르는 기준으로 쓴다. */
  function scorePost(text) {
    const lines = text.split('\n');
    const blank = lines.length ? Math.round((lines.filter(l => !l.trim()).length / lines.length) * 100) : 0;
    const tags = (text.match(/#[^\s#]+/g) || []).length;
    const lastLine = [...lines].reverse().find(l => {
      const t = l.trim();
      return t && !/^(#[^\s#]+\s*)+$/.test(t);
    }) || '';
    const checks = [
      text.length >= 180 && text.length <= 350,
      blank >= 30 && blank <= 50,
      tags >= 3 && tags <= 5,
      /[?？]/.test(lastLine) || /(세요|실래요|나요|까요|어때요)/.test(lastLine)
    ];
    return { passed: checks.filter(Boolean).length, total: checks.length, length: text.length, blank, tags };
  }

  let currentCandidateList = []; // 생성된 후보 10개 원본 목록
  let selectedCandIndices = new Set(); // 다중 선택된 인덱스 집합
  let publishRequestInFlight = false; // 중복 클릭 및 중복 이벤트 이중 방어

  function updateSelectedCount() {
    const badge = document.getElementById('pubSelectedBadge');
    const countTag = document.getElementById('pubSelectedCountTag');
    const candPublishBtn = document.getElementById('btnCandPublishNow');
    const footerPublishBtn = document.getElementById('btnCandFooterPublish');
    const bottomPublishBtn = document.getElementById('btnPublishNowBottom');
    const topPublishBtn = document.getElementById('btnPublishNow');
    const pubCandFooter = document.getElementById('pubCandFooter');

    const count = selectedCandIndices.size;

    if (count > 0) {
      if (badge) {
        badge.hidden = false;
        if (count === 1) {
          const firstIdx = Array.from(selectedCandIndices)[0];
          const cand = currentCandidateList[firstIdx];
          badge.textContent = `✓ 1건 선택됨 (#${firstIdx + 1} ${cand?.sourceLabel || ''})`;
        } else {
          badge.textContent = `✓ ${count}건 다중 선택됨`;
        }
      }
      if (countTag) {
        countTag.textContent = `선택 ${count}건`;
      }
      if (candPublishBtn) {
        candPublishBtn.innerHTML = count === 1
          ? '<span>🚀</span> 지금 바로 발행하기 (1건)'
          : `<span>🚀</span> 선택한 후보 (${count}건) 순차 발행하기`;
      }
      if (footerPublishBtn) {
        footerPublishBtn.innerHTML = count === 1
          ? '<span>🚀</span> 선택한 후보 (1건) 스레드에 지금 발행하기'
          : `<span>🚀</span> 선택한 후보 (${count}건) 스레드에 순차 발행하기`;
      }
      if (bottomPublishBtn) {
        bottomPublishBtn.innerHTML = count === 1
          ? '<span>🚀</span> 스레드에 지금 발행하기 (1건 선택됨)'
          : `<span>🚀</span> 스레드에 지금 발행하기 (${count}건 선택됨)`;
      }
      if (topPublishBtn) {
        topPublishBtn.innerHTML = count === 1
          ? '<span>🚀</span> 지금 발행하기 (1건)'
          : `<span>🚀</span> 지금 순차 발행하기 (${count}건)`;
      }
      if (pubCandFooter) pubCandFooter.hidden = false;
      if (pubCandApplied) {
        pubCandApplied.hidden = false;
        if (count === 1) {
          const firstIdx = Array.from(selectedCandIndices)[0];
          const cand = currentCandidateList[firstIdx];
          pubCandApplied.querySelector('.pub-applied-text').textContent =
            `선택한 [#${firstIdx + 1} ${cand?.sourceLabel || ''}] 후보가 본문에 적용되었습니다.`;
        } else {
          pubCandApplied.querySelector('.pub-applied-text').textContent =
            `총 ${count}건의 후보가 선택되었습니다. 발행 버튼을 누르면 안전 간격으로 순차 자동 발행됩니다.`;
        }
      }
    } else {
      if (badge) badge.hidden = true;
      if (countTag) countTag.textContent = '0건';
      if (candPublishBtn) candPublishBtn.innerHTML = '<span>🚀</span> 지금 바로 발행하기';
      if (footerPublishBtn) footerPublishBtn.innerHTML = '<span>🚀</span> 선택한 후보로 스레드에 지금 발행하기';
      if (bottomPublishBtn) bottomPublishBtn.innerHTML = '<span>🚀</span> 스레드에 지금 발행하기 (즉시 업로드)';
      if (topPublishBtn) topPublishBtn.innerHTML = '<span>🚀</span> 지금 발행하기';
      if (pubCandFooter) pubCandFooter.hidden = true;
      if (pubCandApplied) pubCandApplied.hidden = true;
    }
  }

  function renderCandidates(list, sourceInfo) {
    currentCandidateList = list || [];
    selectedCandIndices.clear();
    pubCandGrid.innerHTML = '';
    document.getElementById('pubCandCount').textContent = `${list.length}개`;
    document.getElementById('pubCandSource').textContent = sourceInfo;
    updateSelectedCount();

    list.forEach((cand, idx) => {
      const score = scorePost(cand.postBody);
      const el = document.createElement('article');
      el.className = `pub-cand is-${cand.source}`;
      el.dataset.idx = idx;
      el.innerHTML = `
        <div class="pub-cand-top">
          <label class="pub-cand-check-wrap">
            <input type="checkbox" class="pub-cand-check" data-idx="${idx}">
            <span class="pub-cand-src">#${idx + 1} ${cand.sourceLabel}</span>
          </label>
          <span class="pub-cand-score ${score.passed === score.total ? 'is-full' : ''}">규격 ${score.passed}/${score.total}</span>
        </div>
        <p class="pub-cand-body"></p>
        <div class="pub-cand-meta"></div>
        <button type="button" class="pub-cand-pick">이 후보 선택</button>
      `;
      el.querySelector('.pub-cand-body').textContent = cand.postBody;
      const extra = cand.scene ? ` · 장면: ${cand.scene.slice(0, 22)}…`
        : cand.article ? ` · ${cand.article.title.slice(0, 22)}…` : '';
      el.querySelector('.pub-cand-meta').textContent =
        `${score.length}자 · 여백 ${score.blank}% · 태그 ${score.tags}개${extra}`;

      const chk = el.querySelector('.pub-cand-check');
      const pickBtn = el.querySelector('.pub-cand-pick');

      function toggleCandSelection(forceState) {
        const willSelect = typeof forceState === 'boolean' ? forceState : !selectedCandIndices.has(idx);
        if (willSelect) {
          selectedCandIndices.add(idx);
          el.classList.add('is-picked');
          chk.checked = true;
          pickBtn.textContent = '✓ 선택됨 (클릭 시 해제)';

          // 선택된 후보의 내용을 에디터에 프리뷰/적용
          pubCurrentSelectedCand = cand;
          pubBody.value = cand.postBody;
          pubSelectedVaultId = cand.vaultId || null;
          pubSelectedSourceLink = cand.article?.link || '';
          pubSelectedArticleTitle = cand.article?.title || '';
          updatePublishMeters();

          // 사용자 요청: 답글 없이 본문 1건만 단독 발행 (첫 댓글 자동 주입 안 함)
          pubFirstComment.value = '';
          updateFirstCommentState();
        } else {
          selectedCandIndices.delete(idx);
          el.classList.remove('is-picked');
          chk.checked = false;
          pickBtn.textContent = '이 후보 선택';
          if (pubCurrentSelectedCand?.id === cand.id) {
            pubCurrentSelectedCand = null;
            pubSelectedSourceLink = '';
            pubSelectedArticleTitle = '';
          }
        }
        updateSelectedCount();
      }

      chk.addEventListener('change', () => {
        toggleCandSelection(chk.checked);
      });

      pickBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleCandSelection();
      });

      el.addEventListener('click', (e) => {
        if (e.target.closest('.pub-cand-pick') || e.target.closest('.pub-cand-check-wrap')) return;
        toggleCandSelection();
      });

      pubCandGrid.appendChild(el);
    });
  }

  // 전체 선택 및 선택 해제 버튼 핸들러
  document.getElementById('btnSelectAllCand')?.addEventListener('click', () => {
    if (!currentCandidateList.length) return;
    pubCandGrid.querySelectorAll('.pub-cand').forEach(el => {
      const idx = parseInt(el.dataset.idx, 10);
      selectedCandIndices.add(idx);
      el.classList.add('is-picked');
      const chk = el.querySelector('.pub-cand-check');
      if (chk) chk.checked = true;
      const pickBtn = el.querySelector('.pub-cand-pick');
      if (pickBtn) pickBtn.textContent = '✓ 선택됨 (클릭 시 해제)';
    });
    if (currentCandidateList[0]) {
      const cand = currentCandidateList[0];
      pubCurrentSelectedCand = cand;
      pubBody.value = cand.postBody;
      pubSelectedVaultId = cand.vaultId || null;
      pubSelectedSourceLink = cand.article?.link || '';
      pubSelectedArticleTitle = cand.article?.title || '';
      updatePublishMeters();
      // 사용자 요청: 답글 없이 본문 1건만 단독 발행 (첫 댓글 자동 주입 안 함)
      pubFirstComment.value = '';
      updateFirstCommentState();
    }
    updateSelectedCount();
  });

  document.getElementById('btnDeselectAllCand')?.addEventListener('click', () => {
    selectedCandIndices.clear();
    pubCurrentSelectedCand = null;
    pubSelectedSourceLink = '';
    pubSelectedArticleTitle = '';
    pubCandGrid.querySelectorAll('.pub-cand').forEach(el => {
      el.classList.remove('is-picked');
      const chk = el.querySelector('.pub-cand-check');
      if (chk) chk.checked = false;
      const pickBtn = el.querySelector('.pub-cand-pick');
      if (pickBtn) pickBtn.textContent = '이 후보 선택';
    });
    updateSelectedCount();
  });

  btnGenCandidates?.addEventListener('click', async () => {
    btnGenCandidates.disabled = true;
    const original = btnGenCandidates.innerHTML;
    btnGenCandidates.innerHTML = '<span>⏳</span> 생성 중...';
    try {
      const res = await fetch('/api/candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ includeNews: true })
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        let errMsg = `서버 응답 지연 (HTTP ${res.status}): 잠시 후 다시 시도해 주세요.`;
        try {
          const parsed = JSON.parse(text);
          if (parsed.error) errMsg = parsed.error;
        } catch {}
        throw new Error(errMsg);
      }
      const data = await res.json();
      if (!data.success) return alert(`❌ 후보 생성 실패: ${data.error}`);

      const trend = data.trendSource;
      const allocation = data.allocation || {};
      const sourceLabel = { google: 'G', naver: 'N', threads: 'T', analysis: '분석', default: '기본' };
      const trendInfo = trend?.keywords?.length
        ? `24개 순환 풀 ${trend.poolSize || trend.keywords.length}개 · 이번 사용: ${trend.keywords.map(k => `${k.keyword}[${sourceLabel[k.source] || k.source || '-'}${k.rank || ''}]`).join(', ')}`
        : '시장조사 없음 · 기본 생활경제 검색어 적용';
      const info = `배분: 뉴스 ${allocation.news || 0}/${allocation.newsTarget ?? 5} · 스토리 ${allocation.story || 0} · 볼트 ${allocation.vault || 0} | ${trendInfo}`;
      renderCandidates(data.candidates, info);
      pubCandPanel.hidden = false;
      document.getElementById('pubWorkspace').classList.add('is-split');
      // 상단 헤더가 화면 위로 잘려나가지 않도록 뷰포트 최상단 유지
      document.getElementById('page-publish')?.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      alert(`❌ 오류: ${err.message}`);
    } finally {
      btnGenCandidates.disabled = false;
      btnGenCandidates.innerHTML = original;
    }
  });

  document.getElementById('btnCandClose')?.addEventListener('click', () => {
    pubCandPanel.hidden = true;
    document.getElementById('pubWorkspace').classList.remove('is-split');
    const pubCandFooter = document.getElementById('pubCandFooter');
    if (pubCandFooter) pubCandFooter.hidden = true;
    selectedCandIndices.clear();
    updateSelectedCount();
  });

  // ---- 미디어 업로드 및 프리뷰 라이트박스 ----
  const pubMediaInput = document.getElementById('pubMediaInput');
  const pubMediaList = document.getElementById('pubMediaList');
  const pubDropzoneText = document.getElementById('pubDropzoneText');
  const pubImageModal = document.getElementById('pubImageModal');
  const pubLightboxImg = document.getElementById('pubLightboxImg');
  const pubLightboxCaption = document.getElementById('pubLightboxCaption');
  const btnPubLightboxClose = document.getElementById('btnPubLightboxClose');

  let uploadedMedia = []; // 서버 uploads/ 에 저장된 미디어 객체 목록 [{ fileName, size, type, title, url }]

  // 라이트박스 제어
  function openLightbox(src, caption) {
    if (!pubImageModal || !pubLightboxImg) return;
    pubLightboxImg.src = src;
    if (pubLightboxCaption) pubLightboxCaption.textContent = caption || '스레드 4:5 고화질 카드 프리뷰';
    pubImageModal.hidden = false;
  }

  function closeLightbox() {
    if (!pubImageModal || !pubLightboxImg) return;
    pubImageModal.hidden = true;
    pubLightboxImg.src = '';
  }

  btnPubLightboxClose?.addEventListener('click', closeLightbox);
  pubImageModal?.addEventListener('click', (e) => {
    if (e.target === pubImageModal) closeLightbox();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pubImageModal && !pubImageModal.hidden) {
      closeLightbox();
    }
  });

  function renderMediaList() {
    pubMediaList.innerHTML = '';
    uploadedMedia.forEach((item, index) => {
      const ext = (item.fileName || '').split('.').pop().toLowerCase();
      const isVideo = item.type === 'video' || ['mp4', 'mov', 'webm'].includes(ext);
      const isAi = (item.fileName || '').startsWith('card_ai_') || (item.fileName || '').startsWith('video_ai_') || item.title;
      const mediaUrl = escapeHtml(safeUrl(item.url || `/uploads/${encodeURIComponent(item.fileName)}`));
      const displayTitle = escapeHtml(item.title || item.fileName);
      const displayFileName = escapeHtml(item.fileName);
      const sizeStr = item.size > 1024 * 1024 
        ? `${(item.size / (1024 * 1024)).toFixed(1)}MB`
        : `${Math.round(item.size / 1024)}KB`;

      let badgeHtml = '';
      if (isVideo) {
        badgeHtml = `<span class="pub-media-type-badge ${isAi ? 'badge-ai-video' : 'badge-file'}">${isAi ? '🎬 AI 숏폼 비디오' : '🎥 동영상'}</span>`;
      } else {
        badgeHtml = `<span class="pub-media-type-badge ${isAi ? 'badge-ai-image' : 'badge-file'}">${isAi ? '✨ AI 4:5 카드' : '🖼️ 이미지'}</span>`;
      }

      const card = document.createElement('div');
      card.className = 'pub-media-card';
      card.innerHTML = `
        <div class="pub-media-visual-wrap">
          ${isVideo 
            ? `<video src="${mediaUrl}" controls playsinline preload="metadata" class="pub-media-video"></video>`
            : `<img src="${mediaUrl}" alt="${displayTitle}" class="pub-media-img" loading="lazy">
               <span class="pub-media-zoom-overlay">🔍 클릭하여 확대</span>`
          }
        </div>
        <div class="pub-media-info">
          <div class="pub-media-meta-top">
            ${badgeHtml}
            <span class="pub-media-size">${sizeStr}</span>
          </div>
          <div class="pub-media-title" title="${displayTitle}">${displayTitle}</div>
          <div class="pub-media-filename" title="${displayFileName}">${displayFileName}</div>
          <div class="pub-media-actions">
            ${isVideo
              ? `<a href="${mediaUrl}" target="_blank" class="pub-media-btn-view">🔗 새 창 재생</a>`
              : `<button type="button" class="pub-media-btn-view btn-preview-zoom">🔍 크게 보기</button>`
            }
            <button type="button" class="pub-media-del" title="제거">✕ 제거</button>
          </div>
        </div>
      `;

      if (!isVideo) {
        const imgEl = card.querySelector('.pub-media-img');
        const zoomBtn = card.querySelector('.btn-preview-zoom');
        imgEl?.addEventListener('click', () => openLightbox(mediaUrl, displayTitle));
        zoomBtn?.addEventListener('click', () => openLightbox(mediaUrl, displayTitle));
      }

      card.querySelector('.pub-media-del').addEventListener('click', () => {
        uploadedMedia.splice(index, 1);
        renderMediaList();
      });

      pubMediaList.appendChild(card);
    });

    pubDropzoneText.textContent = uploadedMedia.length
      ? `${uploadedMedia.length}개 미디어 첨부됨 — 더 추가하려면 클릭`
      : '또는 직접 파일 선택 (클릭/드래그)';
  }

  pubMediaInput?.addEventListener('change', async () => {
    const files = [...pubMediaInput.files];
    pubMediaInput.value = ''; // 같은 파일 재선택 허용
    for (const file of files) {
      pubDropzoneText.textContent = `업로드 중... ${file.name}`;
      try {
        const res = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'x-filename': encodeURIComponent(file.name) },
          body: file
        });
        const data = await res.json();
        if (data.success) {
          uploadedMedia.push({
            fileName: data.fileName,
            size: data.size,
            url: data.url || `/uploads/${data.fileName}`,
            type: file.type.startsWith('video') ? 'video' : 'image',
            title: file.name
          });
        } else {
          alert(`❌ ${file.name}: ${data.error}`);
        }
      } catch (err) {
        alert(`❌ 업로드 오류: ${err.message}`);
      }
    }
    renderMediaList();
    if (pubMediaList && uploadedMedia.length) {
      pubMediaList.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });

  // 검색어 태그 삽입
  PUBLISH_TAGS.forEach(tag => {
    const chip = document.createElement('button');
    chip.className = 'pub-tag-chip';
    chip.textContent = tag;
    chip.addEventListener('click', () => {
      if (pubBody.value.includes(tag)) return;
      pubBody.value = pubBody.value.replace(/\s*$/, '') + (pubBody.value.trim() ? ' ' : '') + tag;
      updatePublishMeters();
    });
    pubTagCloud?.appendChild(chip);
  });

  // 현재 볼트 모달이 보여주는 상태 탭 (READY / POSTED / DELETED)
  let vaultActiveTab = 'READY';

  async function fetchVault(status = 'READY') {
    try {
      const res = await fetch(`/api/vault?status=${encodeURIComponent(status)}`);
      const data = await res.json();
      if (!data.success) return;
      pubVaultItems = data.items;
      // 사이드바 배지는 발행대기(READY) 수를 따른다.
      const badge = document.getElementById('sidebarVaultBadge');
      if (badge && data.counts) badge.textContent = data.counts.ready;
      // 탭 카운터 갱신
      if (data.counts) {
        const setN = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n; };
        setN('vaultCountReady', data.counts.ready);
        setN('vaultCountPosted', data.counts.posted);
        setN('vaultCountDeleted', data.counts.deleted);
      }
      if (pubVaultCategory && pubVaultCategory.options.length <= 1) {
        (data.categories || []).forEach(category => {
          const option = document.createElement('option');
          option.value = category;
          option.textContent = category;
          pubVaultCategory.appendChild(option);
        });
      }
    } catch (err) {
      console.error('볼트 조회 실패:', err);
    }
  }

  // 본문에 원고 내용을 채운다 (불러오기 동작)
  function applyVaultItemToBody(item) {
    const tags = (item.tags || []).join(' ');
    const hasTagsInText = /#[^\s#]+/.test(item.postText || '');
    pubBody.value = (item.postText || '') + (tags && !hasTagsInText ? `\n\n${tags}` : '');
    pubSelectedVaultId = item.id;
    pubSelectedSourceLink = '';
    pubVaultModal.hidden = true;
    updatePublishMeters();
  }

  function renderVaultList() {
    const category = pubVaultCategory.value;
    const items = pubVaultItems.filter(item => !category || item.category === category);
    pubVaultList.innerHTML = '';

    if (!items.length) {
      const msg = vaultActiveTab === 'DELETED' ? '삭제함이 비어 있습니다.'
        : vaultActiveTab === 'POSTED' ? '발행 완료된 원고가 없습니다.'
        : '발행 대기 중인 콘텐츠가 없습니다.';
      pubVaultList.innerHTML = `<div class="pub-vault-empty">${msg}</div>`;
      return;
    }

    items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'pub-vault-row';

      const card = document.createElement('button');
      card.className = 'pub-vault-item';
      if (item.status === 'POSTED') card.classList.add('is-posted');
      if (item.status === 'DELETED') card.classList.add('is-deleted');
      card.innerHTML = `
        <div class="pub-vault-cat">${escapeHtml(item.category || '기타')}</div>
        <div class="pub-vault-text"></div>
        <div class="pub-vault-tags">${(item.tags || []).map(tag => `<span>${escapeHtml(tag)}</span>`).join(' ')}</div>
      `;
      card.querySelector('.pub-vault-text').textContent = item.postText || '';
      // 발행대기·발행완료는 클릭 시 본문으로 불러온다. 삭제함은 불러오기 비활성.
      if (item.status !== 'DELETED') {
        card.addEventListener('click', () => applyVaultItemToBody(item));
      } else {
        card.disabled = true;
      }
      row.appendChild(card);

      const actions = document.createElement('div');
      actions.className = 'pub-vault-actions';
      if (item.status === 'DELETED') {
        // 복구 / 완전삭제
        const restoreBtn = document.createElement('button');
        restoreBtn.className = 'pub-vault-act';
        restoreBtn.title = '복구';
        restoreBtn.textContent = '♻️';
        restoreBtn.addEventListener('click', () => restoreVaultItem(item.id));
        const purgeBtn = document.createElement('button');
        purgeBtn.className = 'pub-vault-act is-danger';
        purgeBtn.title = '완전 삭제';
        purgeBtn.textContent = '🗑️';
        purgeBtn.addEventListener('click', () => deleteVaultItem(item.id, true));
        actions.appendChild(restoreBtn);
        actions.appendChild(purgeBtn);
      } else {
        // 수정 / 삭제
        const editBtn = document.createElement('button');
        editBtn.className = 'pub-vault-act';
        editBtn.title = '수정';
        editBtn.textContent = '✏️';
        editBtn.addEventListener('click', () => openVaultEditor(item));
        const delBtn = document.createElement('button');
        delBtn.className = 'pub-vault-act is-danger';
        delBtn.title = '삭제함으로 이동';
        delBtn.textContent = '🗑️';
        delBtn.addEventListener('click', () => deleteVaultItem(item.id, false));
        actions.appendChild(editBtn);
        actions.appendChild(delBtn);
      }
      row.appendChild(actions);
      pubVaultList.appendChild(row);
    });
  }

  // 목록 새로고침: 현재 탭 기준으로 다시 불러와 렌더링
  async function reloadVault() {
    await fetchVault(vaultActiveTab);
    renderVaultList();
  }

  // ---- 신규/수정 폼 ----
  const vaultEditor = document.getElementById('vaultEditor');
  const vaultEditId = document.getElementById('vaultEditId');
  const vaultEditCategory = document.getElementById('vaultEditCategory');
  const vaultEditHook = document.getElementById('vaultEditHook');
  const vaultEditText = document.getElementById('vaultEditText');
  const vaultEditTags = document.getElementById('vaultEditTags');
  const vaultEditLen = document.getElementById('vaultEditLen');
  const vaultEditorTitle = document.getElementById('vaultEditorTitle');

  function updateVaultEditLen() {
    if (vaultEditLen && vaultEditText) vaultEditLen.textContent = vaultEditText.value.length;
  }
  vaultEditText?.addEventListener('input', updateVaultEditLen);

  function openVaultEditor(item = null) {
    if (!vaultEditor) return;
    if (item) {
      vaultEditorTitle.textContent = '원고 수정';
      vaultEditId.value = item.id || '';
      vaultEditCategory.value = item.category || '';
      vaultEditHook.value = item.hookType || '';
      vaultEditText.value = item.postText || '';
      vaultEditTags.value = (item.tags || []).join(' ');
    } else {
      vaultEditorTitle.textContent = '새 원고 추가';
      vaultEditId.value = '';
      vaultEditCategory.value = '';
      vaultEditHook.value = '';
      vaultEditText.value = pubBody.value.trim() && !item ? '' : '';
      vaultEditTags.value = '';
    }
    updateVaultEditLen();
    vaultEditor.hidden = false;
    vaultEditText.focus();
  }

  function closeVaultEditor() {
    if (vaultEditor) vaultEditor.hidden = true;
  }

  async function saveVaultEditor() {
    const postText = vaultEditText.value.trim();
    if (!postText) { alert('본문 내용을 입력해 주세요.'); vaultEditText.focus(); return; }
    if (postText.length > 500) { alert('스레드 본문은 500자를 넘을 수 없습니다.'); return; }
    const payload = {
      category: vaultEditCategory.value.trim() || '기타',
      hookType: vaultEditHook.value.trim(),
      postText,
      tags: vaultEditTags.value
    };
    const id = vaultEditId.value;
    const saveBtn = document.getElementById('btnVaultEditorSave');
    if (saveBtn) saveBtn.disabled = true;
    try {
      const url = id ? `/api/vault/${encodeURIComponent(id)}` : '/api/vault';
      const method = id ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || '저장 실패');
      closeVaultEditor();
      // 새로 추가하면 발행대기 탭으로, 수정이면 현재 탭 유지
      if (!id) { vaultActiveTab = 'READY'; syncVaultTabUI(); }
      await reloadVault();
    } catch (err) {
      alert(`❌ 볼트 저장 오류: ${err.message}`);
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  async function deleteVaultItem(id, hard) {
    const msg = hard ? '이 원고를 완전히 삭제합니다. 되돌릴 수 없습니다. 계속할까요?'
      : '이 원고를 삭제함으로 이동합니다. (나중에 복구 가능)';
    if (!confirm(msg)) return;
    try {
      const res = await fetch(`/api/vault/${encodeURIComponent(id)}${hard ? '?hard=1' : ''}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || '삭제 실패');
      await reloadVault();
    } catch (err) {
      alert(`❌ 볼트 삭제 오류: ${err.message}`);
    }
  }

  async function restoreVaultItem(id) {
    try {
      const res = await fetch(`/api/vault/${encodeURIComponent(id)}/restore`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || '복구 실패');
      await reloadVault();
    } catch (err) {
      alert(`❌ 볼트 복구 오류: ${err.message}`);
    }
  }

  // ---- 탭 전환 ----
  function syncVaultTabUI() {
    document.querySelectorAll('.pub-vault-tab').forEach(tab => {
      tab.classList.toggle('is-active', tab.dataset.vaulttab === vaultActiveTab);
    });
  }
  document.querySelectorAll('.pub-vault-tab').forEach(tab => {
    tab.addEventListener('click', async () => {
      vaultActiveTab = tab.dataset.vaulttab || 'READY';
      syncVaultTabUI();
      closeVaultEditor();
      await reloadVault();
    });
  });

  document.getElementById('btnVaultNew')?.addEventListener('click', () => openVaultEditor(null));
  document.getElementById('btnVaultEditorCancel')?.addEventListener('click', closeVaultEditor);
  document.getElementById('btnVaultEditorSave')?.addEventListener('click', saveVaultEditor);

  // 본문을 볼트에 새 원고로 저장 (본문 작성 영역 버튼)
  document.getElementById('btnPubVaultSave')?.addEventListener('click', async () => {
    const text = pubBody.value.trim();
    if (!text) { alert('저장할 본문 내용이 없습니다.'); pubBody.focus(); return; }
    if (text.length > 500) { alert('스레드 본문은 500자를 넘을 수 없습니다.'); return; }
    // 본문 안 해시태그를 tags로 추출
    const tags = (text.match(/#[^\s#]+/g) || []);
    try {
      const res = await fetch('/api/vault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: '직접작성', postText: text, tags })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || '저장 실패');
      alert('✅ 현재 본문을 볼트에 새 원고로 저장했습니다.');
      await fetchVault(vaultActiveTab); // 배지/카운터 갱신
    } catch (err) {
      alert(`❌ 볼트 저장 오류: ${err.message}`);
    }
  });

  document.getElementById('btnPubVaultPick')?.addEventListener('click', async () => {
    vaultActiveTab = 'READY';
    syncVaultTabUI();
    closeVaultEditor();
    await reloadVault();
    pubVaultModal.hidden = false;
  });
  document.getElementById('btnPubVaultClose')?.addEventListener('click', () => { pubVaultModal.hidden = true; });
  pubVaultModal?.addEventListener('click', (e) => {
    if (e.target === pubVaultModal) pubVaultModal.hidden = true;
  });
  pubVaultCategory?.addEventListener('change', renderVaultList);

  async function executePublish() {
    if (publishRequestInFlight) return;
    const count = selectedCandIndices.size;

    // 1. 다중 선택된 상태 (2건 이상)
    if (count > 1) {
      const pickedPosts = Array.from(selectedCandIndices).sort((a, b) => a - b).map(idx => {
        const cand = currentCandidateList[idx];
        return {
          postBody: cand.postBody,
          firstComment: '',
          vaultId: cand.vaultId || null,
          card: cand.card || null,
          sourceLabel: cand.sourceLabel,
          // 뉴스 후보의 기사 원문 링크. 본문이 아니라 첫 답글로 붙는다.
          sourceLink: cand.article?.link || ''
        };
      });

      if (!confirm(`선택한 ${count}건의 후보를 스레드에 순차적으로 자동 발행하시겠습니까?\n\n계정 보호 쉴드에 따라 각 글 사이에 안전 쿨다운(4~7초)을 두고 한 건씩 안전하게 발행됩니다.`)) {
        return;
      }
      publishRequestInFlight = true;

      const allPublishButtons = document.querySelectorAll('.btn-publish-trigger, #btnPublishNow, #btnCandPublishNow, #btnCandFooterPublish, #btnPublishNowBottom');
      allPublishButtons.forEach(btn => {
        btn.disabled = true;
        btn.dataset.origHtml = btn.innerHTML;
        btn.innerHTML = `<span>⏳</span> ${count}건 순차 발행 중...`;
      });

      try {
        const res = await fetch('/api/publish-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            posts: pickedPosts,
            headless: document.getElementById('pubHeadless')?.checked ?? true
          })
        });
        const data = await res.json();
        if (data.success) {
          alert(`🚀 총 ${count}건의 후보 순차 발행을 시작했습니다!\n[실시간 실행 콘솔] 탭에서 발행 진행률을 실시간으로 확인하실 수 있습니다.`);
          selectedCandIndices.clear();
          pubCandGrid.querySelectorAll('.pub-cand').forEach(el => {
            el.classList.remove('is-picked');
            const chk = el.querySelector('.pub-cand-check');
            if (chk) chk.checked = false;
            const pickBtn = el.querySelector('.pub-cand-pick');
            if (pickBtn) pickBtn.textContent = '이 후보 선택';
          });
          updateSelectedCount();
          fetchVault();
          fetchStatus();
        } else {
          alert(`❌ 다건 발행 실패: ${data.error}`);
        }
      } catch (err) {
        alert(`❌ 오류: ${err.message}`);
      } finally {
        publishRequestInFlight = false;
        allPublishButtons.forEach(btn => {
          btn.disabled = false;
          if (btn.dataset.origHtml) btn.innerHTML = btn.dataset.origHtml;
        });
      }
      return;
    }

    // 2. 단건 발행 (1건 선택됨 또는 직접 작성한 본문)
    const body = pubBody.value.trim();
    if (!body) return alert('본문 내용을 입력해 주세요. (왼쪽 후보를 선택하거나 직접 작성)');

    const activeType = pubTypeGroup.querySelector('.pub-type.active')?.dataset.type;
    if (activeType !== 'text' && !uploadedMedia.length) {
      return alert(`${activeType === 'image' ? '이미지' : '영상'} 유형인데 첨부된 파일이 없습니다.\n파일을 추가하거나 텍스트 유형으로 바꿔주세요.`);
    }

    const mediaNote = uploadedMedia.length ? `\n\n첨부: ${uploadedMedia.length}개` : '';
    if (!confirm(`아래 내용으로 스레드에 바로 발행합니다.\n\n${body.slice(0, 140)}...${mediaNote}`)) return;
    publishRequestInFlight = true;

    const allPublishButtons = document.querySelectorAll('.btn-publish-trigger, #btnPublishNow, #btnCandPublishNow, #btnCandFooterPublish, #btnPublishNowBottom');
    allPublishButtons.forEach(btn => {
      btn.disabled = true;
      btn.dataset.origHtml = btn.innerHTML;
      btn.innerHTML = '<span>⏳</span> 발행 요청 중...';
    });

    try {
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postBody: body,
          firstComment: '',
          vaultId: pubSelectedVaultId,
          sourceLink: pubSelectedSourceLink,
          mediaFiles: uploadedMedia.map(m => m.fileName),
          headless: document.getElementById('pubHeadless')?.checked ?? true
        })
      });
      const data = await res.json();
      if (data.success) {
        alert('🚀 스레드 발행 작업을 시작했습니다! [실시간 실행 콘솔] 탭에서 진행 상황을 확인하세요.');
        uploadedMedia = [];
        renderMediaList();
        fetchVault();
        fetchStatus();
      } else {
        alert(`❌ 발행 실패: ${data.error}`);
      }
    } catch (err) {
      alert(`❌ 오류: ${err.message}`);
    } finally {
      publishRequestInFlight = false;
      allPublishButtons.forEach(btn => {
        btn.disabled = false;
        if (btn.dataset.origHtml) btn.innerHTML = btn.dataset.origHtml;
      });
    }
  }

  // 상단, 후보 패널, 하단 등 모든 발행 버튼에 이벤트 연결
  const uniquePublishButtons = new Set([
    btnPublishNow,
    document.getElementById('btnCandPublishNow'),
    document.getElementById('btnCandFooterPublish'),
    document.getElementById('btnPublishNowBottom')
  ].filter(Boolean));
  uniquePublishButtons.forEach(btn => {
    btn.addEventListener('click', executePublish);
  });

  // ── 스마트 폴링 엔진 (Page Visibility API + 동적 적응형 인터벌) ──
  // 탭이 백그라운드에 있을 때는 브라우저 CPU/메모리/네트워크 부하를 90% 차단하고,
  // 사용자가 화면을 보고 있을 때는 봇 실행 여부에 따라 3초/6초로 유연하게 폴링합니다.
  let pollStatusTimer = null;
  let pollAutoPilotTimer = null;
  let pollCommentsTimer = null;

  function scheduleNextStatusPoll() {
    clearTimeout(pollStatusTimer);
    // 비활성 탭: 20초 주기 / 활성 탭: 실행 중이면 3초, 대기 중이면 6초
    const delay = document.hidden ? 20000 : (isRunning ? 3000 : 6000);
    pollStatusTimer = setTimeout(async () => {
      await fetchStatus();
      scheduleNextStatusPoll();
    }, delay);
  }

  function scheduleNextAutoPilotPoll() {
    clearTimeout(pollAutoPilotTimer);
    const delay = document.hidden ? 25000 : (isRunning ? 4000 : 8000);
    pollAutoPilotTimer = setTimeout(async () => {
      await fetchAutoPilotStatus();
      scheduleNextAutoPilotPoll();
    }, delay);
  }

  function scheduleNextCommentsPoll() {
    clearTimeout(pollCommentsTimer);
    const delay = document.hidden ? 30000 : 8000;
    pollCommentsTimer = setTimeout(async () => {
      await fetchCommentsHistory();
      scheduleNextCommentsPoll();
    }, delay);
  }

  // 탭 활성화 상태 변경 시 즉시 동기화
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      // 탭으로 돌아왔을 때 즉시 1회 최신 상태 동기화 후 활성 주기로 리셋
      fetchStatus();
      fetchAutoPilotStatus();
      fetchCommentsHistory();
    }
    scheduleNextStatusPoll();
    scheduleNextAutoPilotPoll();
    scheduleNextCommentsPoll();
  });

  updatePublishMeters();
  updateFirstCommentState();
  fetchVault();

  // 초기 1회 로드
  loadLogsHistory();
  initLogStream();
  fetchStatus();
  fetchAutoPilotStatus();
  fetchConfig();
  fetchCards();
  fetchCommentsHistory();
  loadTrendOverview();

  // 스마트 적응형 폴링 시작
  scheduleNextStatusPoll();
  scheduleNextAutoPilotPoll();
  scheduleNextCommentsPoll();
});
