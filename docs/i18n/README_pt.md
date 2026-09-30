# 🚀 Plataforma de Automação de Afiliados para o Threads

Plataforma completa impulsionada por IA para marketing de afiliados e engajamento orgânico (rapport) no Threads.

---

### 🌐 Idiomas / Languages
[ 🇰🇷 한국어 ](../../README.md) | [ 🇺🇸 English ](README_en.md) | [ 🇯🇵 日本語 ](README_ja.md) | [ 🇨🇳 简体中文 ](README_zh.md) | [ 🇪🇸 Español ](README_es.md) | [ 🇩🇪 Deutsch ](README_de.md) | [ 🇫🇷 Français ](README_fr.md) | [ 🇧🇷 Português ]

---

## 📸 Prévia do Painel (Dashboard Preview)

<div align="center">
  <h3>📊 1. Painel Principal e Resumo de Atividades</h3>
  <img src="../images/01_dashboard_overview.png" alt="Dashboard Overview" width="92%" />
  <p><em>Cotas diárias de segurança, métricas de desempenho e streaming de logs SSE em tempo real.</em></p>
  <br />

  <h3>📱 2. Estúdio de Cards de Afiliado</h3>
  <img src="../images/02_card_studio.png" alt="Card Studio" width="92%" />
  <p><em>Coleta automática de itens em alta, criação de copies persuasivas com IA e renderização visual 4:5.</em></p>
  <br />

  <h3>💬 3. Engajamento no Feed & Motor de Comentários IA</h3>
  <img src="../images/03_rapport_management.png" alt="Rapport Management" width="92%" />
  <p><em>Análise de sentimento, respostas empáticas contextuais e conexão em massa com um único clique.</em></p>
  <br />

  <h3>💻 4. Console do Sistema em Tempo Real</h3>
  <img src="../images/04_realtime_console.png" alt="Realtime Console" width="92%" />
  <p><em>Monitoramento ao vivo de tarefas em segundo plano, sessões de navegador e chamadas de API.</em></p>
</div>

---

## 📌 Principais Recursos

1. **💬 Motor de Conexão e Comentários IA (`scripts/rapport_engine.mjs`)**:
   - Compreende gírias e a linguagem descontraída das redes sociais.
   - Gera 3 estilos de comunicação (Empatia profunda, Resposta inteligente, Acolhimento).
   - Extração de palavras-chave e automação segura de interações.

2. **📦 Cofre de 100 Conteúdos Estratégicos para 30 Dias (`content_vault.json`)**:
   - Pacote inicial desenvolvido para gerar autoridade e atrair os primeiros seguidores fiéis.
   - Dicas úteis (25), Identificação do cotidiano (25), Enquetes e jogos (25), Perguntas reais (25).

3. **🖥️ Painel Web Desktop com Estilo Glassmorphism (`http://localhost:3500`)**:
   - Design moderno em modo escuro com camadas translúcidas de vidro.
   - **Tradução Automática em 8 Idiomas (i18n)**: Detecção do idioma do navegador e seletor rápido.
   - 6 Módulos: Dashboard, Cards, Comentários, Conta, Configurações e Console.

4. **🛡️ Escudo Anti-Bot e Digitação Humanizada**:
   - Limites diários rígidos (máximo de 40 follows e 30 comentários ao dia).
   - Velocidade variável de digitação natural (35~110ms) e pausas dinâmicas.

5. **🔥 Postagem de Ofertas & Suporte Oficial à Graph API**:
   - Coleta de produtos em destaque e geração de links de comissão.
   - Suporte híbrido entre Meta Threads Graph API e sessões autênticas do Google Chrome via Playwright.

---

## 🚀 Início Rápido

### 1. Pré-requisitos
- Node.js 18 ou superior
- Navegador Google Chrome

### 2. Instalação
```bash
git clone https://github.com/nerin81-netizen/threads-affiliate-automation.git
cd threads-affiliate-automation
npm install
```

### 3. Configuração
```bash
cp .env.example .env
```

### 4. Executar
```bash
npm start
# ou clique duas vezes em start_dashboard.bat
```
Acesse `http://localhost:3500` no seu navegador. (O painel será traduzido automaticamente para o português com base no idioma do seu sistema).

---

## 📄 Licença
Distribuído sob a [Licença MIT](../../LICENSE).
