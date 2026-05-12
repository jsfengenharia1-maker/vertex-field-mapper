<div align="center">

![Vertex Field Mapper](banner.svg)

<br/>

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-f78166?style=flat-square&logo=googlechrome&logoColor=white)](https://github.com/jsfengenharia1-maker/vertex-field-mapper)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-79c0ff?style=flat-square&logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/)
[![Playwright](https://img.shields.io/badge/Playwright-ready-56d364?style=flat-square&logo=playwright&logoColor=white)](https://playwright.dev)
[![License MIT](https://img.shields.io/badge/License-MIT-e3b341?style=flat-square)](LICENSE)
[![Version](https://img.shields.io/badge/Version-4.0.0-b392f0?style=flat-square)](https://github.com/jsfengenharia1-maker/vertex-field-mapper/releases)

**Stop spending hours inspecting DevTools.**  
Map any web page — forms, dashboards, data grids — in seconds.  
Get ready-to-use Playwright selectors, page classification and automation warnings automatically.

[Installation](#installation) · [How to use](#how-to-use) · [Output JSON](#output-json) · [Roadmap](#roadmap)

</div>

---

## What it does

Vertex Field Mapper is a Chrome extension that analyzes any web page and generates a complete structured JSON with everything you need to build automation scripts with Playwright — without touching DevTools.

**One click. Full reconnaissance. Ready to code.**

---

## What it detects

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

### 🔍 Page classification
Automatically classifies each page as:
`formulario` · `lista_dados` · `dashboard` · `detalhe` · `misto`

With confidence level (`alta` / `média` / `baixa`) and the reasons behind the classification.

### 🔬 Frameworks & stack detection
`OctoberCMS` `Laravel` `Django` `WordPress` `AdminLTE` `jQuery`  
`Vue.js` `React` `Angular` `Alpine.js` `Livewire`  
`Select2` `pekeupload` `Semantic UI` `Bootstrap` `Tailwind` `Materialize`

### ⚠️ Go/No-Go automation signals
- reCAPTCHA / hCaptcha → **NO-GO**
- Digital certificate (e-CPF, A1, A3) → **NO-GO**
- gov.br login (acesso.gov.br) → **WARNING**
- `navigator.webdriver = true` → **WARNING**
- iFrame with relevant content → **WARNING**
- Strict mode risks (selector matching multiple elements) → **WARNING**
- CSRF token, PHP session, JWT localStorage → **INFO**

---

## Installation

1. **Download** — click `Code → Download ZIP` on this page
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

The session persists even when you close the popup and navigate between pages.

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
4. Click "Map and recognize page"
5. Download the JSON
```

---

## Output JSON

Every page always generates a complete, structured JSON:

```json
{
  "meta": {
    "descricao": "process tracking page",
    "projeto":   "crea_mt",
    "url":       "https://...",
    "titulo":    "ART Tracking — CREA",
    "capturado_em": "2026-05-11T..."
  },
  "tipo_pagina": {
    "classificacao": "lista_dados",
    "confianca": "alta",
    "motivos": ["2 grids detected", "no significant input form"]
  },
  "frameworks": ["jQuery", "DataTables", "Bootstrap", "AdminLTE"],
  "grids": [
    {
      "tipo": "datatables",
      "colunas": [
        { "indice": 1, "nome": "ART Number", "seletor_celula": "#table tbody tr td:nth-child(1)" },
        { "indice": 2, "nome": "Professional", "seletor_celula": "#table tbody tr td:nth-child(2)" }
      ],
      "total_linhas_visiveis": 15,
      "seletor_linha": "#table tbody tr",
      "paginacao": { "detectada": true, "seletor_proxima": "a.paginate_button.next" },
      "playwright": {
        "iterar_linhas": "linhas = page.locator('#table tbody tr')\nfor i in range(linhas.count()):\n    linha = linhas.nth(i)\n    art_number = linha.locator('td:nth-child(1)').inner_text().strip()",
        "proxima_pagina": "page.locator('a.paginate_button.next').click()\npage.wait_for_timeout(1500)"
      }
    }
  ],
  "formulario": { "detectado": false, "campos": [] },
  "diagnostico": { "go_nogo": { "status": "go", "motivo": "Page appears automatable" } },
  "resumo": { "tipo_pagina": "lista_dados", "total_grids": 1, "total_campos_form": 0 }
}
```

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

The AI generates the complete `protocolar.py` or `monitor.py` with selectors already mapped.

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
| Strict mode risks | Selectors matching multiple elements — use `.first` or `.nth()` |

---

## Roadmap

- [x] DataTables, AG Grid, Tabulator, Kendo UI, Handsontable detection
- [x] Automatic page type classification
- [x] Multi-page session with persistence
- [x] Go/No-Go signals
- [x] Ready-to-use Playwright code per grid
- [ ] Detail mode — map display elements for `monitor.py` generation
- [ ] Bookmarklet version for mobile browsers
- [ ] AJAX interceptor with request replay examples
- [ ] Export as Python `protocolar.py` template directly

---

## Key learnings behind this tool

This extension was built from real-world experience automating Brazilian government permit systems. Common pitfalls it helps you avoid:

- **`form.submit()` vs `.click()`** — OctoberCMS `data-request` handlers require a real button click, never `form.submit()`
- **Tabulator false positive** — always capture state before submit, compare after; if equal = silent failure
- **Numeric masks** — area fields often divide by 100 automatically (type `6000` = `60.00 m²`)
- **Select2** — `select_option()` doesn't work; click the container, filter, click the option
- **pekeupload** — POST to `/api/files` with session cookies, get UUID, place in hidden input
- **Playwright strict mode** — one selector matching two elements throws an exception; use `.first` or `.nth()`
- **AG Grid virtualization** — only visible rows are in the DOM; scroll to load more
- **Playwright browser path** — install browsers for the exact user running the service, not root

---

## License

MIT © [jsfengenharia1-maker](https://github.com/jsfengenharia1-maker)

---

<div align="center">
  <sub>Built with real automation pain. No vibe coding.</sub>
</div>
