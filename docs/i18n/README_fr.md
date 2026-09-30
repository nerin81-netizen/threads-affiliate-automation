# 🚀 Plateforme d'Automatisation d'Affiliation Threads

Plateforme tout-en-un propulsée par l'IA pour le marketing d'affiliation et l'engagement relationnel (rapport) sur Threads.

---

### 🌐 Langues / Languages
[ 🇰🇷 한국어 ](../../README.md) | [ 🇺🇸 English ](README_en.md) | [ 🇯🇵 日本語 ](README_ja.md) | [ 🇨🇳 简体中文 ](README_zh.md) | [ 🇪🇸 Español ](README_es.md) | [ 🇩🇪 Deutsch ](README_de.md) | [ 🇫🇷 Français ] | [ 🇧🇷 Português ](README_pt.md)

---

## 📸 Aperçu du Tableau de Bord

<div align="center">
  <h3>📊 1. Tableau de Bord Principal et Statistiques</h3>
  <img src="../images/01_dashboard_overview.png" alt="Dashboard Overview" width="92%" />
  <p><em>Quotas de sécurité quotidiens, statistiques d'activité et journaux système SSE en direct.</em></p>
  <br />

  <h3>📱 2. Studio de Cartes d'Affiliation</h3>
  <img src="../images/02_card_studio.png" alt="Card Studio" width="92%" />
  <p><em>Collecte automatique des tendances, accroches rédigées par IA et rendu de cartes 4:5.</em></p>
  <br />

  <h3>💬 3. Gestion des Relations & Moteur de Commentaires IA</h3>
  <img src="../images/03_rapport_management.png" alt="Rapport Management" width="92%" />
  <p><em>Analyse des sentiments, réponses chaleureuses par IA et interaction groupée en un clic.</em></p>
  <br />

  <h3>💻 4. Console Système en Direct</h3>
  <img src="../images/04_realtime_console.png" alt="Realtime Console" width="92%" />
  <p><em>Suivi en temps réel des tâches de fond, des sessions de navigation et des requêtes API.</em></p>
</div>

---

## 📌 Fonctionnalités Clés

1. **💬 Moteur d'Interaction et Commentaires IA (`scripts/rapport_engine.mjs`)**:
   - Comprend l'argot des réseaux sociaux et les tonalités informelles.
   - 3 styles de réponse : Empathie profonde, Répartie pleine d'esprit, Bienveillance.
   - Extraction de mots-clés et pipeline d'engagement sécurisé.

2. **📦 Coffre de 100 Contenus Phares sur 30 Jours (`content_vault.json`)**:
   - Pack de démarrage éprouvé pour bâtir la crédibilité du compte et fédérer les premiers abonnés.
   - Astuces du quotidien (25), Tranches de vie (25), Sondages & jeux (25), Dialogues authentiques (25).

3. **🖥️ Tableau de Bord Web Desktop Glassmorphism (`http://localhost:3500`)**:
   - Interface sombre moderne avec effets de transparence et de flou d'arrière-plan.
   - **Traduction Automatique en 8 Langues (i18n)** : Détection de la langue du navigateur et sélecteur rapide.
   - 6 Vues : Accueil, Cartes, Commentaires, Compte, Paramètres, Console.

4. **🛡️ Bouclier Anti-Bot et Émulation Humaine**:
   - Quotas journaliers stricts (maximum 40 abonnements, 30 commentaires par jour).
   - Vitesse de frappe humaine variable (35~110ms) et temporisations dynamiques.

5. **🔥 Bons Plans d'Affiliation & Support Graph API Officiel**:
   - Récupération des meilleures offres et génération de liens de partage.
   - Support hybride : API Graph Meta Threads et sessions Chrome réelles via Playwright.

---

## 🚀 Démarrage Rapide

### 1. Prérequis
- Node.js 18 ou version supérieure
- Navigateur Google Chrome

### 2. Installation
```bash
git clone https://github.com/nerin81-netizen/threads-affiliate-automation.git
cd threads-affiliate-automation
npm install
```

### 3. Configuration
```bash
cp .env.example .env
```

### 4. Lancement
```bash
npm start
# ou double-cliquez sur start_dashboard.bat
```
Ouvrez `http://localhost:3500` dans votre navigateur (la langue s'adaptera automatiquement à celle de votre système).

---

## 📄 Licence
Distribué sous [Licence MIT](../../LICENSE).
