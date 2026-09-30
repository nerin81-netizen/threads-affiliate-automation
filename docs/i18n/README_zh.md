# 🚀 Threads 联盟营销与社交互动自动化平台

基于人工智能的 Threads 联盟营销与高情商互动（建立信任）一体化自动化运营平台。

---

### 🌐 语言选择 / Languages
[ 🇰🇷 한국어 ](../../README.md) | [ 🇺🇸 English ](README_en.md) | [ 🇯🇵 日本語 ](README_ja.md) | [ 🇨🇳 简体中文 ] | [ 🇪🇸 Español ](README_es.md) | [ 🇩🇪 Deutsch ](README_de.md) | [ 🇫🇷 Français ](README_fr.md) | [ 🇧🇷 Português ](README_pt.md)

---

## 📸 控制面板预览 (Dashboard Preview)

<div align="center">
  <h3>📊 1. 主控制面板与运行概览</h3>
  <img src="../images/01_dashboard_overview.png" alt="Dashboard Overview" width="92%" />
  <p><em>每日安全配额、运营数据统计、机器人快速控制与实时 SSE 日志流。</em></p>
  <br />

  <h3>📱 2. 推广卡片工作室</h3>
  <img src="../images/02_card_studio.png" alt="Card Studio" width="92%" />
  <p><em>自动采集爆款商品、AI 生成吸睛文案并渲染 4:5 比例精美视觉卡片。</em></p>
  <br />

  <h3>💬 3. 信息流互动与智能回复管理</h3>
  <img src="../images/03_rapport_management.png" alt="Rapport Management" width="92%" />
  <p><em>实时情绪分析、生成情商极高的共情评论，支持一键批量安全互动。</em></p>
  <br />

  <h3>💻 4. 实时运行控制台</h3>
  <img src="../images/04_realtime_console.png" alt="Realtime Console" width="92%" />
  <p><em>后台自动化任务、浏览器会话状态及 API 调用实时全景监控。</em></p>
</div>

---

## 📌 核心功能

1. **💬 情感互动与 AI 评论引擎 (`scripts/rapport_engine.mjs`)**:
   - 深入理解社交网络流行语与地道交流语调。
   - 自动生成 3 种语境风格（深度共情型、机智互动型、温柔治愈型）。
   - 实时关键词提取与自动化安全互动链路。

2. **📦 30天 100篇 精选内容素材库 (`content_vault.json`)**:
   - 专为建立账号初始信任度与吸引早期粉丝打造的精选预设内容。
   - 生活窍门(25篇)、生活共鸣(25篇)、二选一投票互动(25篇)、真诚问答(25篇)。

3. **🖥️ 拟态玻璃质感桌面 Web 控制台 (`http://localhost:3500`)**:
   - 现代暗黑模式半透明毛玻璃视觉界面。
   - **8国语言实时自动翻译(i18n)**: 自动检测浏览器语言并支持一键切换。
   - 6大功能模块: 仪表盘、卡片制作、互动管理、账号、系统设置、实时终端。

4. **🛡️ 防封禁安全护盾与拟人化操作**:
   - 严格的每日安全阈值控制（每日上限 40关注、30评论）。
   - 模拟真人随机打字延迟（35~110ms）与动态冷却机制。

5. **🔥 推广商品发布与官方 Graph API 支持**:
   - 热门商品自动采集与分销推广链接生成。
   - 混合支持 Meta 官方 Threads Graph API 与 Playwright 原生 Chrome 浏览器会话。

---

## 🚀 快速上手

### 1. 环境准备
- Node.js 18 或更高版本
- Google Chrome 浏览器

### 2. 克隆项目与安装依赖
```bash
git clone https://github.com/nerin81-netizen/threads-affiliate-automation.git
cd threads-affiliate-automation
npm install
```

### 3. 配置环境变量
```bash
cp .env.example .env
```

### 4. 启动控制台
```bash
npm start
# 或双击运行 start_dashboard.bat
```
在浏览器中打开 `http://localhost:3500` 即可开始使用。（系统会根据您的浏览器语言环境自动切换为中文）

---

## 📄 开源许可证
本项目采用 [MIT License](../../LICENSE) 许可证发布。

---

## ⚖️ 法律免责声明
- 本项目为独立的开源学术与技术研究项目，与 Meta Platforms, Inc. (Threads, Instagram)、Viva Republica (Toss) 等公司无任何商业附属或官方授权关系。
- 软件仅供学习与自动化测试参考，用户须自行遵守相关平台的服务协议及法律法规。
