# 🚀 Plataforma de Automatización de Afiliados para Threads

Plataforma integral basada en IA para marketing de afiliados e interacción orgánica (rapport) en Threads.

---

### 🌐 Idiomas / Languages
[ 🇰🇷 한국어 ](../../README.md) | [ 🇺🇸 English ](README_en.md) | [ 🇯🇵 日本語 ](README_ja.md) | [ 🇨🇳 简体中文 ](README_zh.md) | [ 🇪🇸 Español ] | [ 🇩🇪 Deutsch ](README_de.md) | [ 🇫🇷 Français ](README_fr.md) | [ 🇧🇷 Português ](README_pt.md)

---

## 📸 Vista Previa del Panel (Dashboard)

<div align="center">
  <h3>📊 1. Panel Principal y Resumen de Ejecución</h3>
  <img src="../images/01_dashboard_overview.png" alt="Dashboard Overview" width="92%" />
  <p><em>Cuota diaria de seguridad, estadísticas, controles rápidos y transmisión de registros SSE en vivo.</em></p>
  <br />

  <h3>📱 2. Estudio de Tarjetas de Afiliados</h3>
  <img src="../images/02_card_studio.png" alt="Card Studio" width="92%" />
  <p><em>Recopilación automática de productos en tendencia, generación de textos con IA y renderizado en formato 4:5.</em></p>
  <br />

  <h3>💬 3. Gestión de Interacción y Comentarios con IA</h3>
  <img src="../images/03_rapport_management.png" alt="Rapport Management" width="92%" />
  <p><em>Análisis de sentimiento en tiempo real, respuestas empáticas contextuales e interacción masiva en un clic.</em></p>
  <br />

  <h3>💻 4. Consola del Sistema en Vivo</h3>
  <img src="../images/04_realtime_console.png" alt="Realtime Console" width="92%" />
  <p><em>Supervisión en tiempo real de tareas en segundo plano, sesiones de navegador y llamadas a la API.</em></p>
</div>

---

## 📌 Características Principales

1. **💬 Motor de Interacción y Comentarios IA (`scripts/rapport_engine.mjs`)**:
   - Comprensión de modismos y lenguaje informal de redes sociales.
   - Generación de 3 estilos contextuales (Empatía profunda, Humor ingenioso, Calidez y apoyo).
   - Extracción de palabras clave e interacción automática segura.

2. **📦 Bóveda de 100 Contenidos Clave para 30 Días (`content_vault.json`)**:
   - Paquete de inicio probado para generar autoridad y atraer los primeros seguidores de forma orgánica.
   - Consejos útiles (25), Estilo de vida cercano (25), Encuestas y juegos (25), Preguntas auténticas (25).

3. **🖥️ Panel Web de Escritorio con Estilo Glassmorphism (`http://localhost:3500`)**:
   - Diseño moderno en modo oscuro con capas translúcidas de cristal.
   - **Traducción Automática en 8 Idiomas (i18n)**: Detección automática del idioma del navegador y selector manual.
   - 6 Módulos: Panel, Tarjetas, Comentarios, Cuenta, Ajustes y Consola.

4. **🛡️ Escudo Anti-Bot y Emulación Humana**:
   - Umbrales diarios estrictos de seguridad (máximo 40 seguidos, 30 comentarios al día).
   - Cadencia de escritura variable humana (35~110ms) y pausas dinámicas.

5. **🔥 Publicación de Ofertas y Compatibilidad Oficial con Graph API**:
   - Detección de productos populares y generación de enlaces de afiliado.
   - Compatibilidad híbrida entre Meta Threads Graph API y sesiones reales de Google Chrome con Playwright.

---

## 🚀 Inicio Rápido

### 1. Requisitos
- Node.js 18 o superior
- Navegador Google Chrome

### 2. Instalación
```bash
git clone https://github.com/nerin81-netizen/threads-affiliate-automation.git
cd threads-affiliate-automation
npm install
```

### 3. Configuración
```bash
cp .env.example .env
```

### 4. Ejecución
```bash
npm start
# o doble clic en start_dashboard.bat
```
Abre `http://localhost:3500` en tu navegador. (El panel se traducirá automáticamente al español según el idioma de tu navegador).

---

## 📄 Licencia
Distribuido bajo la [Licencia MIT](../../LICENSE).

---

## ⚖️ Descargo de Responsabilidad (Legal Disclaimer)
- Este proyecto es una iniciativa independiente de código abierto con fines de investigación y **no está afiliado ni respaldado por** Meta Platforms, Inc. o Viva Republica. El cumplimiento de las condiciones de servicio de cada plataforma es responsabilidad exclusiva del usuario.
