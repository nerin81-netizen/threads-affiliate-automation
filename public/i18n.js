/**
 * Threads Affiliate Studio - Global i18n Multi-Language Translation System
 * Supports 8 Languages: KO (Default), EN, JA, ZH, ES, DE, FR, PT
 * Features: Automatic Browser Language Detection, Manual Switcher, LocalStorage Persistence
 */

const I18N_RESOURCES = {
  ko: {
    app_name: 'Threads Studio',
    version_pill: 'v1.5.3 데스크톱',
    shield_status: '메타 안티봇 방어 쉴드 가동 중',
    menu_header: '메뉴',
    nav_dashboard: '대시보드 & 실행',
    nav_trends: '검색어 시장조사',
    nav_publish: '게시물 발행',
    nav_cards: '카드 스튜디오',
    nav_rapport: '라포 소통 & 댓글 관리',
    nav_account: '계정 & 프로필',
    nav_settings: '설정',
    nav_console: '실시간 콘솔',
    today_stats: '오늘의 활동 통계',
    stat_follows: '선팔로우',
    stat_comments: '작성 댓글',
    stat_posts: '발행 게시물',
    stat_quota: '안전 쿼터',
    btn_start_bot: '무인 자동화 시작',
    btn_stop_bot: '자동화 일시중지',
    btn_refresh: '새로고침',
    btn_save: '저장하기',
    btn_copy: '복사하기',
    recent_logs: '실시간 시스템 로그',
    cards_title: '제휴 상품 카드 보관소',
    cards_desc: '토스 OpenAPI 실시간 1위 상품 및 자동 생성된 후킹 카드 목록입니다.',
    publish_title: '게시물 원클릭 발행',
    rapport_title: '피드 라포 소통 관리',
    rapport_desc: '피드 글을 실시간 분석하여 공감형 AI 댓글을 자동 생성하고 소통합니다.',
    lang_select: '언어'
  },
  en: {
    app_name: 'Threads Studio',
    version_pill: 'v1.5.3 Desktop',
    shield_status: 'Meta Anti-Bot Shield Active',
    menu_header: 'MENU',
    nav_dashboard: 'Dashboard & Execution',
    nav_trends: 'Trend Market Research',
    nav_publish: 'Post Publishing',
    nav_cards: 'Card Studio',
    nav_rapport: 'Rapport & Comments',
    nav_account: 'Account & Profile',
    nav_settings: 'Settings',
    nav_console: 'Live Console',
    today_stats: "Today's Activity Stats",
    stat_follows: 'Follows',
    stat_comments: 'Comments',
    stat_posts: 'Posts Published',
    stat_quota: 'Safety Quota',
    btn_start_bot: 'Start Automation',
    btn_stop_bot: 'Pause Automation',
    btn_refresh: 'Refresh',
    btn_save: 'Save',
    btn_copy: 'Copy',
    recent_logs: 'Live System Logs',
    cards_title: 'Affiliate Product Cards Vault',
    cards_desc: 'Real-time trending products with AI-crafted hooking copy & share links.',
    publish_title: 'One-Click Post Publishing',
    rapport_title: 'Feed Rapport & Engagement',
    rapport_desc: 'Analyze feeds in real-time to generate warm AI comments and engage authentic creators.',
    lang_select: 'Language'
  },
  ja: {
    app_name: 'Threads Studio',
    version_pill: 'v1.5.3 デスクトップ',
    shield_status: 'Metaアンチボット保護シールド稼働中',
    menu_header: 'メニュー',
    nav_dashboard: 'ダッシュボード & 実行',
    nav_trends: 'トレンド市場調査',
    nav_publish: '投稿公開',
    nav_cards: 'カードスタジオ',
    nav_rapport: '交流・コメント管理',
    nav_account: 'アカウント・プロフィール',
    nav_settings: '設定',
    nav_console: 'リアルタイムコンソール',
    today_stats: '本日の活動統計',
    stat_follows: 'フォロー数',
    stat_comments: 'コメント数',
    stat_posts: '投稿数',
    stat_quota: '安全クォータ',
    btn_start_bot: '自動化を開始',
    btn_stop_bot: '自動化を一時停止',
    btn_refresh: '更新',
    btn_save: '保存',
    btn_copy: 'コピー',
    recent_logs: 'リアルタイムシステムログ',
    cards_title: 'アフィリエイトカード保管庫',
    cards_desc: 'リアルタイム人気商品とAIが生成したフックコピー・共有リンク一覧です。',
    publish_title: 'ワンクリック投稿公開',
    rapport_title: 'フィード交流・コメント管理',
    rapport_desc: 'フィード投稿をAIがリアルタイム分析し、共感型コメントで自動交流します。',
    lang_select: '言語'
  },
  zh: {
    app_name: 'Threads Studio',
    version_pill: 'v1.5.3 桌面版',
    shield_status: 'Meta 反爬虫防护盾运行中',
    menu_header: '菜单',
    nav_dashboard: '仪表盘与运行',
    nav_trends: '趋势市场调研',
    nav_publish: '帖子发布',
    nav_cards: '卡片工作室',
    nav_rapport: '互动与评论管理',
    nav_account: '账户与个人资料',
    nav_settings: '设置',
    nav_console: '实时控制台',
    today_stats: '今日活动数据',
    stat_follows: '关注数',
    stat_comments: '评论数',
    stat_posts: '发布帖子数',
    stat_quota: '安全配额',
    btn_start_bot: '启动自动化',
    btn_stop_bot: '暂停自动化',
    btn_refresh: '刷新',
    btn_save: '保存',
    btn_copy: '复制',
    recent_logs: '实时系统日志',
    cards_title: '推广商品卡片库',
    cards_desc: '实时热门商品与AI撰写的吸睛文案及分销链接。',
    publish_title: '一键发布帖子',
    rapport_title: '信息流互动与评论管理',
    rapport_desc: '实时分析信息流内容，自动生成高情商AI回复并建立真实互动。',
    lang_select: '语言'
  },
  es: {
    app_name: 'Threads Studio',
    version_pill: 'v1.5.3 Escritorio',
    shield_status: 'Escudo Anti-Bot de Meta Activo',
    menu_header: 'MENÚ',
    nav_dashboard: 'Panel y Ejecución',
    nav_trends: 'Estudio de Tendencias',
    nav_publish: 'Publicar Contenido',
    nav_cards: 'Estudio de Tarjetas',
    nav_rapport: 'Comentarios e Interacción',
    nav_account: 'Cuenta y Perfil',
    nav_settings: 'Configuración',
    nav_console: 'Consola en Vivo',
    today_stats: 'Estadísticas de Hoy',
    stat_follows: 'Seguimientos',
    stat_comments: 'Comentarios',
    stat_posts: 'Publicaciones',
    stat_quota: 'Cuota de Seguridad',
    btn_start_bot: 'Iniciar Automatización',
    btn_stop_bot: 'Pausar Automatización',
    btn_refresh: 'Actualizar',
    btn_save: 'Guardar',
    btn_copy: 'Copiar',
    recent_logs: 'Registros del Sistema en Vivo',
    cards_title: 'Bóveda de Tarjetas de Afiliados',
    cards_desc: 'Productos en tendencia con textos atractivos generados por IA y enlaces de afiliados.',
    publish_title: 'Publicación en un Clic',
    rapport_title: 'Gestión de Interacción y Respuestas',
    rapport_desc: 'Analiza publicaciones del feed para generar comentarios empáticos con IA y construir comunidad.',
    lang_select: 'Idioma'
  },
  de: {
    app_name: 'Threads Studio',
    version_pill: 'v1.5.3 Desktop',
    shield_status: 'Meta Anti-Bot-Schutzschild Aktiv',
    menu_header: 'MENÜ',
    nav_dashboard: 'Dashboard & Ausführung',
    nav_trends: 'Trend-Marktforschung',
    nav_publish: 'Beitrag Veröffentlichen',
    nav_cards: 'Karten-Studio',
    nav_rapport: 'Beziehungs- & Kommentarmanagement',
    nav_account: 'Konto & Profil',
    nav_settings: 'Einstellungen',
    nav_console: 'Live-Konsole',
    today_stats: 'Heutige Aktivitäten',
    stat_follows: 'Follows',
    stat_comments: 'Kommentare',
    stat_posts: 'Beiträge',
    stat_quota: 'Sicherheitsquote',
    btn_start_bot: 'Automatisierung Starten',
    btn_stop_bot: 'Automatisierung Anhalten',
    btn_refresh: 'Aktualisieren',
    btn_save: 'Speichern',
    btn_copy: 'Kopieren',
    recent_logs: 'Live-Systemprotokolle',
    cards_title: 'Affiliate-Karten-Tresor',
    cards_desc: 'Echtzeit-Trendprodukte mit KI-generierten Hook-Texten und Partnerlinks.',
    publish_title: '1-Klick-Veröffentlichung',
    rapport_title: 'Feed-Interaktion & Kommentare',
    rapport_desc: 'Echtzeitanalyse von Feed-Beiträgen für empathische KI-Kommentare und echten Beziehungsaufbau.',
    lang_select: 'Sprache'
  },
  fr: {
    app_name: 'Threads Studio',
    version_pill: 'v1.5.3 Bureau',
    shield_status: 'Bouclier Anti-Bot Meta Actif',
    menu_header: 'MENU',
    nav_dashboard: 'Tableau de bord & Exécution',
    nav_trends: 'Étude des Tendances',
    nav_publish: 'Publication de Post',
    nav_cards: 'Studio de Cartes',
    nav_rapport: 'Engagement & Commentaires',
    nav_account: 'Compte & Profil',
    nav_settings: 'Paramètres',
    nav_console: 'Console en Direct',
    today_stats: "Statistiques d'Aujourd'hui",
    stat_follows: 'Abonnements',
    stat_comments: 'Commentaires',
    stat_posts: 'Publications',
    stat_quota: 'Quota de Sécurité',
    btn_start_bot: "Démarrer l'Automatisation",
    btn_stop_bot: "Pause de l'Automatisation",
    btn_refresh: 'Actualiser',
    btn_save: 'Enregistrer',
    btn_copy: 'Copier',
    recent_logs: 'Journaux Système en Direct',
    cards_title: 'Coffre de Cartes Affiliées',
    cards_desc: 'Produits tendance en temps réel avec accroches générées par IA et liens partenaires.',
    publish_title: 'Publication en 1 Clic',
    rapport_title: 'Gestion des Relations & Réponses',
    rapport_desc: 'Analyse les posts du fil en direct pour générer des commentaires IA bienveillants.',
    lang_select: 'Langue'
  },
  pt: {
    app_name: 'Threads Studio',
    version_pill: 'v1.5.3 Desktop',
    shield_status: 'Escudo Anti-Bot da Meta Ativo',
    menu_header: 'MENU',
    nav_dashboard: 'Painel & Execução',
    nav_trends: 'Pesquisa de Tendências',
    nav_publish: 'Publicar Post',
    nav_cards: 'Estúdio de Cards',
    nav_rapport: 'Engajamento & Comentários',
    nav_account: 'Conta & Perfil',
    nav_settings: 'Configurações',
    nav_console: 'Console em Tempo Real',
    today_stats: 'Estatísticas de Hoje',
    stat_follows: 'Seguindo',
    stat_comments: 'Comentários',
    stat_posts: 'Posts Publicados',
    stat_quota: 'Cota de Segurança',
    btn_start_bot: 'Iniciar Automação',
    btn_stop_bot: 'Pausar Automação',
    btn_refresh: 'Atualizar',
    btn_save: 'Salvar',
    btn_copy: 'Copiar',
    recent_logs: 'Logs do Sistema em Tempo Real',
    cards_title: 'Cofre de Cards de Afiliados',
    cards_desc: 'Produtos em alta com copies persuasivas criadas por IA e links de afiliado.',
    publish_title: 'Publicação em 1 Clique',
    rapport_title: 'Engajamento no Feed & Respostas',
    rapport_desc: 'Analisa publicações do feed para gerar comentários empáticos com IA e criar conexões reais.',
    lang_select: 'Idioma'
  }
};

class I18nManager {
  constructor() {
    this.currentLang = this.detectLanguage();
    this.supportedLanguages = ['ko', 'en', 'ja', 'zh', 'es', 'de', 'fr', 'pt'];
  }

  detectLanguage() {
    const saved = localStorage.getItem('threads_studio_lang');
    if (saved && I18N_RESOURCES[saved]) return saved;

    const navLang = (navigator.language || navigator.userLanguage || 'ko').toLowerCase();
    if (navLang.startsWith('en')) return 'en';
    if (navLang.startsWith('ja')) return 'ja';
    if (navLang.startsWith('zh')) return 'zh';
    if (navLang.startsWith('es')) return 'es';
    if (navLang.startsWith('de')) return 'de';
    if (navLang.startsWith('fr')) return 'fr';
    if (navLang.startsWith('pt')) return 'pt';
    return 'ko';
  }

  setLanguage(lang) {
    if (!I18N_RESOURCES[lang]) return;
    this.currentLang = lang;
    localStorage.setItem('threads_studio_lang', lang);
    document.documentElement.lang = lang;
    this.applyTranslations();
  }

  t(key) {
    const dict = I18N_RESOURCES[this.currentLang] || I18N_RESOURCES.ko;
    return dict[key] || I18N_RESOURCES.ko[key] || key;
  }

  applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const translation = this.t(key);
      if (el.tagName === 'INPUT' && el.getAttribute('placeholder')) {
        el.setAttribute('placeholder', translation);
      } else {
        el.textContent = translation;
      }
    });

    const selector = document.getElementById('i18n-lang-select');
    if (selector && selector.value !== this.currentLang) {
      selector.value = this.currentLang;
    }
  }

  renderLanguageSelector(container) {
    if (!container) return;
    const languages = [
      { code: 'ko', label: '🇰🇷 한국어' },
      { code: 'en', label: '🇺🇸 English' },
      { code: 'ja', label: '🇯🇵 日本語' },
      { code: 'zh', label: '🇨🇳 简体中文' },
      { code: 'es', label: '🇪🇸 Español' },
      { code: 'de', label: '🇩🇪 Deutsch' },
      { code: 'fr', label: '🇫🇷 Français' },
      { code: 'pt', label: '🇧🇷 Português' }
    ];

    const wrapper = document.createElement('div');
    wrapper.className = 'i18n-selector-wrapper';
    wrapper.innerHTML = `
      <label for="i18n-lang-select" class="i18n-icon-label" title="언어 선택 / Select Language">🌐</label>
      <select id="i18n-lang-select" class="i18n-select">
        ${languages.map(l => `<option value="${l.code}" ${l.code === this.currentLang ? 'selected' : ''}>${l.label}</option>`).join('')}
      </select>
    `;

    container.appendChild(wrapper);

    const selectEl = wrapper.querySelector('#i18n-lang-select');
    selectEl.addEventListener('change', (e) => {
      this.setLanguage(e.target.value);
    });
  }
}

window.i18n = new I18nManager();
document.addEventListener('DOMContentLoaded', () => {
  const targetBar = document.querySelector('.window-controls');
  if (targetBar) {
    window.i18n.renderLanguageSelector(targetBar);
  }
  window.i18n.applyTranslations();
});
