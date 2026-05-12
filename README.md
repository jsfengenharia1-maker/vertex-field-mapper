<div align="center">

![Vertex Field Mapper](banner.svg)

<br/>

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-f78166?style=flat-square&logo=googlechrome&logoColor=white)](https://github.com/jsfengenharia1-maker/vertex-field-mapper)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-79c0ff?style=flat-square&logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/)
[![Playwright](https://img.shields.io/badge/Playwright-ready-56d364?style=flat-square&logo=playwright&logoColor=white)](https://playwright.dev)
[![License MIT](https://img.shields.io/badge/License-MIT-e3b341?style=flat-square)](LICENSE)
[![Version](https://img.shields.io/badge/Version-1.1.1-b392f0?style=flat-square)](https://github.com/jsfengenharia1-maker/vertex-field-mapper/releases)

**Stop spending hours inspecting DevTools.**  
Map any web page — forms, dashboards, data grids — in seconds.  
Get ready-to-use Playwright selectors, page classification, action buttons and automation warnings automatically.

[Installation](#installation) · [How to use](#how-to-use) · [Output JSON](#output-json) · [Known limitations](#known-limitations) · [Roadmap](#roadmap)

</div>

---

## What it does

Vertex Field Mapper is a Chrome extension that analyzes any web page and generates a complete structured JSON with everything you need to build automation scripts with Playwright — without touching DevTools.

**One click. Full reconnaissance. Ready to code.**

It was built and refined while automating real-world Brazilian government permit systems (CREA-MT, Prefeitura Municipal de Sorriso) and tested against e-commerce SPAs (Mercado Livre). The detection heuristics carry that experience.

---

## What it detects

### 🆕 Action buttons — with primary submit ranking

The mapper now captures all buttons, submit inputs, action links (`<a data-request>`, `<a class="btn">`, `[role="button"]`) and identifies the **most likely primary submit button** using a scored heuristic:

- Inside a `<form>`: +30
- `type="submit"` explicit: +20
- Valid `data-request` handler (not in blacklist): +25
- Primary class or text (`btn-primary`, "Save", "Send", "Próximo", etc): +15
- Has a stable `id`: +5
- Below the fold (y > 200px): +5

**Hard disqualifiers** (score forced negative):
- Destructive action (`Delete`, `Remove`, `Excluir`)
- Text blacklist (`Sair`, `Logout`, `Cancel`, `Menu`, `Profile`, `Close`, `×`)
- `data-request` blacklist (`onLogout`, `onDelete`, `onClose`, `onCancel`, `onLogin`, `onRemove`, `onDestroy`)

Each marked button carries `submit_primario_razao` (human-readable reason) and `submit_primario_score` (numeric) for full transparency. If no button passes the threshold, the field stays `null` instead of guessing — better to admit uncertainty than mark "Logout" as the primary action.

### 📊 Data grids — all major libraries

| Library | Detection | Extraction |
|---|---|---|
| **① jQuery DataTables** | `div.dataTables_wrapper` | Columns, rows, pagination, filter |
| **② AG Grid** | `div.ag-root-wrapper` | `col-id` attributes, virtualization warning |
| **③ Tabulator.js** | `div.tabulator-row` | `tabulator-field`, false-positive guard code |
| **④ Kendo UI** | `div.k-grid` | `tr.k-master-row`, pager selectors |
| **⑤ Handsontable** | `div.handsontable` | Virtual scroll warning, scroll code |
| **⑥ HTML Table** | `<table>` | Column headers, row selectors |

### 📝 Form fields

- `input` — text, email, number, date, radio, checkbox, file
- `select` — native and Select2 (with specific warning)
- `textarea`
- `pekeupload` — file upload via `/api/files` UUID pattern
- Autocomplete fields that trigger XHR requests
- Datepicker JS fields
- Numeric masks (detects ÷100 pattern common in area fields)

Every field also captures `aria_label` and `data_testid` when present — critical for SPAs where IDs are auto-generated and unstable (`#_R_moipij1rie_` style).

### 🔍 Page classification

Automatically classifies each page as:
`formulario` · `lista_dados` · `dashboard` · `detalhe` · `misto`

With confidence level (`alta` / `média` / `baixa`) and the reasons behind the classification.

### 🔬 Frameworks & stack detection

`OctoberCMS` `Laravel` `Django` `WordPress` `AdminLTE` `jQuery`  
`Vue.js` `React` `Angular` `Next.js` `Nuxt` `Svelte` `Alpine.js` `Livewire`  
`Select2` `pekeupload` `Semantic UI` `Bootstrap` `Tailwind` `Materialize`

SPA detection uses **real framework markers** (`window.React.version`, internal React containers, `[ng-version]`, `[data-v-app]`) instead of devtools hooks — devtools extensions inject `__REACT_DEVTOOLS_GLOBAL_HOOK__` and friends into every page you visit, which would otherwise generate false positives on every site.

Ambiguous signatures (OctoberCMS, Materialize, Semantic UI) require **multiple distinct markers** to be considered detected. Prevents single-attribute matches like `data-request` from falsely flagging non-OctoberCMS sites.

### ⚠️ Go/No-Go automation signals

- reCAPTCHA / hCaptcha → **NO-GO**
- Digital certificate (e-CPF, A1, A3) → **NO-GO**
- gov.br login (acesso.gov.br) → **WARNING**
- `navigator.webdriver = true` → **WARNING**
- iFrame with relevant content → **WARNING**
- Strict mode risks (selector matching multiple elements) → **WARNING** (filtered: CSRF tokens and generic selectors are excluded automatically)
- CSRF token, PHP session, JWT localStorage → **INFO**

---

## Installation

1. **Download** — click `Code → Download ZIP` on this page, or grab the latest release ZIP
2. **Extract** the zip on your computer
3. Open Chrome and go to `chrome://extensions`
4. Enable **Developer mode** (top right toggle)
5. Click **"Load unpacked"**
6. Select the `vertex-field-mapper` folder

> The extension icon ⬡ will appear in your Chrome toolbar.  
> Pin it by clicking the puzzle 🧩 icon → pin button next to Vertex Field Mapper.

---

## How to use

### Multi-page session *(recommended for complete flows)*

The session persists even when you close the popup and navigate between pages. Most recent page appears at the top of the list.

```
1. Open the extension → "Session" tab
2. Type a project name: crea_mt, my_erp, etc.
3. Navigate to page 1 of your flow
4. Type a description: "new process form - property data"
5. Click "Add this page to session"
6. Navigate to page 2, add description, add again
7. Repeat for each step, tab, modal in the flow
8. Click "Download complete session"
```

### Single page

```
1. Navigate to the target page (already logged in if needed)
2. Click the ⬡ icon
3. Type a project name and page description
4. (Optional) Check "Wait SPA (3s before mapping)" if the page is a SPA still hydrating
5. Click "Map and recognize page"
6. Download the JSON
```

The **"Wait SPA"** option is useful for React/Vue/Angular apps that finish rendering after initial load. Without it, the mapper may run before the framework finishes building the DOM.

---

## Output JSON

Every page generates a complete, structured JSON. Schema version is included at the top so consumers can adapt to format changes.

```json
{
  "schema_version": "2.0",
  "meta": {
    "descricao": "process tracking page",
    "projeto":   "crea_mt",
    "url":       "https://...",
    "titulo":    "ART Tracking — CREA",
    "capturado_em": "2026-05-12T..."
  },
  "tipo_pagina": {
    "classificacao": "lista_dados",
    "confianca": "alta",
    "motivos": ["2 grids detected", "no significant input form"]
  },
  "frameworks": ["jQuery", "DataTables", "Bootstrap", "AdminLTE"],
  "spa_detection": {
    "react": false, "next": false, "vue": false,
    "nuxt": false, "angular": false, "svelte": false
  },
  "grids": [
    {
      "tipo": "datatables",
      "colunas": [
        { "indice": 1, "nome": "ART Number", "seletor_celula": "#table tbody tr td:nth-child(1)" }
      ],
      "playwright": {
        "iterar_linhas": "linhas = page.locator('#table tbody tr')\nfor i in range(linhas.count()):\n    linha = linhas.nth(i)\n    art_number = linha.locator('td:nth-child(1)').inner_text().strip()"
      }
    }
  ],
  "formulario": {
    "detectado": true,
    "campos": [
      {
        "tipo_elemento": "input",
        "type": "text",
        "name": "nome",
        "label": "Nome",
        "aria_label": "Nome completo do cliente",
        "data_testid": "name-input",
        "seletor_playwright": "#nome",
        "obrigatorio": true
      }
    ]
  },
  "botoes_acao": [
    {
      "texto": "Salvar Protocolo",
      "tipo": "submit",
      "seletor_playwright": "#btnSalvar",
      "id": "btnSalvar",
      "data_request": "onSave",
      "em_formulario": true,
      "provavel_primario": true,
      "provavel_submit_primario": true,
      "submit_primario_score": 75,
      "submit_primario_razao": "em form + type=submit + data-request=onSave + classe/texto primário + tem id"
    }
  ],
  "resumo": {
    "submit_primario": {
      "texto": "Salvar Protocolo",
      "seletor": "#btnSalvar",
      "data_request": "onSave"
    },
    "spa_detectado": null
  }
}
```

---

## Known limitations

Vertex Field Mapper was calibrated against Brazilian government portals (OctoberCMS, ASP.NET MVC) and validated against one major SPA (Mercado Livre). The following limitations are known and documented honestly — if your use case hits one of them, please open an issue with the URL and JSON attached.

### Submit detection
- **Pages without a real submit form** (e.g., e-commerce nav-only pages) may mark a search button or promotional link as primary submit. The threshold of 30 lets borderline cases through.
- **Search forms** (single input + submit button) currently pass the same threshold as data-entry forms. A search button can be flagged as primary submit. Workaround: read the `submit_primario_score` and `submit_primario_razao` to evaluate quality.
- **Navigation dropdowns inside `<form>` elements** (common with user menus) may pass the form-membership check. Workaround: if `submit_primario_score == 30` and the text is a user name or generic word, treat as uncertain.

### Field labels
- When multiple fields share a containing element (common with grouped selects in OctoberCMS), all may receive the same label. Fix planned, not yet implemented.

### Framework / DOM coverage
- **Shadow DOM**: not supported. Web Components (LitElement, Stencil) are invisible to the mapper.
- **iframes**: detected (with warning) but the mapper does not descend into them.
- **Mobile viewports**: extension runs on Chrome desktop only. Bookmarklet version planned.
- **WebSocket-based interactions**: not captured.

### SPA support
- React/Vue/Angular/Next/Nuxt/Svelte are detected via real framework markers. SPAs that hydrate after page load may need the **"Wait SPA (3s)"** option enabled.
- Frameworks with rendering delays beyond 3s require manual wait via DevTools before mapping.
- SPA-generated selectors (`#_R_moipij1rie_` style) are captured as-is but warned about — prefer `data-testid` or `aria-label` based selectors when available.

### Locale
- Primary submit text heuristic is calibrated for Portuguese and English (`Salvar`, `Enviar`, `Próximo`, `Save`, `Send`, `Submit`, `Continue`, etc). Spanish, French, German and other locales may benefit from expanding the regex in `popup.js`. PRs welcome.

---

## Generating automation scripts

After mapping, send the JSON + an audio or description explaining how you do the process manually to Claude (or any AI assistant):

```
"Here is the JSON from the field mapper: [paste JSON]

Here is how I do this process manually:
- I navigate to the new process form
- In the property tab I fill: address, area (always × 100 because of the mask)
- In the documents tab I upload: memorial, ART, project PDF
- I click Save and capture the process number from the list"
```

The AI generates the complete `protocolar.py` or `monitor.py` with selectors already mapped. The `botoes_acao` section and `submit_primario` summary tell the AI exactly which button to click — no more guessing.

---

## Diagnostic tab

Every mapping also shows a full diagnostic panel:

| Check | Description |
|---|---|
| reCAPTCHA | Automation blocker — NO-GO |
| Digital certificate | Cannot automate — NO-GO |
| gov.br login | Verify if user+password alternative exists |
| `webdriver` detection | Site may block Playwright |
| CSRF token | Playwright preserves automatically |
| PHP session | Check session duration |
| iFrame | Use `frame.locator()` instead of `page.locator()` |
| Strict mode risks | Selectors matching multiple elements (CSRF tokens and generic selectors are pre-filtered) |
| Primary submit | Identified button + reason + score |
| SPA detected | Which framework + recommendation to enable "Wait SPA" |

---

## Roadmap

- [x] DataTables, AG Grid, Tabulator, Kendo UI, Handsontable detection
- [x] Automatic page type classification
- [x] Multi-page session with persistence
- [x] Go/No-Go signals
- [x] Ready-to-use Playwright code per grid
- [x] **Action buttons capture with primary submit ranking** *(v1.1.0+)*
- [x] **`aria_label` and `data_testid` capture for SPA stability** *(v1.1.0+)*
- [x] **SPA detection via real framework markers** *(v1.1.0+)*
- [x] **Schema version field** for forward compatibility *(v1.1.0+)*
- [x] **Strict mode risks cleanup** (CSRF tokens and bare selectors filtered) *(v1.1.0+)*
- [x] **Submit primary heuristic with scoring + blacklists** *(v1.1.1)*
- [x] **Framework detection requires real markers** (no devtools hook false positives) *(v1.1.1)*
- [ ] Refine submit primary threshold (eliminate nav/search false positives)
- [ ] Detail mode — map display elements for `monitor.py` generation
- [ ] Bookmarklet version for mobile browsers
- [ ] AJAX interceptor with request replay examples
- [ ] Export as Python `protocolar.py` template directly

---

## Key learnings behind this tool

This extension was built from real-world experience automating Brazilian government permit systems. Common pitfalls it helps you avoid:

- **`form.submit()` vs `.click()`** — OctoberCMS `data-request` handlers require a real button click, never `form.submit()`. The `data_request` field on each button tells you which.
- **Submit primary detection beats guessing** — A page with 20 `<a data-request>` links and one real "Create" button needs heuristics, not luck. The scored ranking + blacklists give a defensible choice (or admit uncertainty).
- **Devtools extensions pollute window globals** — Detecting React via `__REACT_DEVTOOLS_GLOBAL_HOOK__` will give false positives on every site. Use `window.React.version` or internal containers instead.
- **Tabulator false positive** — always capture state before submit, compare after; if equal = silent failure.
- **Numeric masks** — area fields often divide by 100 automatically (type `6000` = `60.00 m²`).
- **Select2** — `select_option()` doesn't work; click the container, filter, click the option.
- **pekeupload** — POST to `/api/files` with session cookies, get UUID, place in hidden input.
- **Playwright strict mode** — one selector matching two elements throws an exception; use `.first` or `.nth()`. CSRF tokens trigger this normally and are filtered from the warnings.
- **AG Grid virtualization** — only visible rows are in the DOM; scroll to load more.
- **Playwright browser path** — install browsers for the exact user running the service, not root.

---

## License

MIT © [jsfengenharia1-maker](https://github.com/jsfengenharia1-maker)

---

<div align="center">
  <sub>Built with real automation pain. No vibe coding.</sub>
</div>
