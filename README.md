<div align="center">

![Vertex Field Mapper](banner.svg)

<br/>

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-f78166?style=flat-square&logo=googlechrome&logoColor=white)](https://github.com/jsfengenharia1-maker/vertex-field-mapper)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-79c0ff?style=flat-square&logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/)
[![Playwright](https://img.shields.io/badge/Playwright-ready-56d364?style=flat-square&logo=playwright&logoColor=white)](https://playwright.dev)
[![License MIT](https://img.shields.io/badge/License-MIT-e3b341?style=flat-square)](LICENSE)
[![Version](https://img.shields.io/badge/Version-1.3.0-b392f0?style=flat-square)](https://github.com/jsfengenharia1-maker/vertex-field-mapper/releases)

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

The session is the only flow. It persists when you close the popup and navigate between pages.

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

### Capturing lazy popups (OctoberCMS)

Some pages have popups that only exist in the DOM after a button click (`data-control="popup"`). The extension detects them automatically and shows a checklist below the page card:

```
📌 Lazy popups — 3 pending of 3
☐ Add main area        [▶ Capture] [Skip]
☐ Add hired company    [▶ Capture] [Skip]
☐ Add responsible      [▶ Capture] [Skip]
```

For each item:

```
1. Click [▶ Capture] — the button is highlighted on the page with a red pulsing outline
2. Click the highlighted button — the popup opens
3. Confirm the form loaded, then click [✓ Check] in the extension
4. The extension maps the popup fields and marks it ✓
5. Repeat for the remaining items
```

Captured popups are saved as sub-items of the parent page in the exported JSON. If you download the session with pending items, the JSON includes a `validacao` field listing the gaps.

---

## Output JSON

Every session generates a complete, structured JSON (schema v3.2):

```json
{
  "schema_version": "3.2",
  "projeto": "crea_mt",
  "paginas": [
    {
      "meta": { "descricao": "process tracking page", "url": "https://..." },
      "tipo_pagina": { "classificacao": "lista_dados", "confianca": "alta" },
      "frameworks": ["jQuery", "DataTables", "Bootstrap", "AdminLTE"],
      "grids": [
        {
          "tipo": "datatables",
          "colunas": [
            { "indice": 1, "nome": "ART Number", "seletor_celula": "#table tbody tr td:nth-child(1)" }
          ],
          "seletor_linha": "#table tbody tr",
          "paginacao": { "detectada": true, "seletor_proxima": "a.paginate_button.next" },
          "playwright": {
            "iterar_linhas": "linhas = page.locator('#table tbody tr')\nfor i in range(linhas.count()):\n    linha = linhas.nth(i)\n    art_number = linha.locator('td:nth-child(1)').inner_text().strip()"
          }
        }
      ],
      "formulario": { "detectado": true, "campos": [...] },
      "popups_pendentes": [],
      "popups_capturados": [
        {
          "abridor_texto": "Add main area",
          "formulario": { "campos": [...] },
          "meta": { "descricao": "Popup: Add main area", "capturado_em": "..." }
        }
      ]
    }
  ]
}
```

---

## Using the JSON with an AI

After mapping, copy the JSON (use the **⧉ Copy JSON** button) and send it to Claude with the prompt below.

### Prompt — explain fields and generate automation script

```
I have a JSON generated by Vertex Field Mapper, a Chrome extension that maps
web pages for Playwright automation. The JSON contains the page structure,
form fields with selectors, data grids, detected frameworks, and Go/No-Go
signals.

Here is the JSON:
[PASTE JSON HERE]

Here is how I do this process manually:
[DESCRIBE THE MANUAL STEPS — ex: "I navigate to the new process form,
fill in the property tab with address and area, upload 3 documents in the
documents tab, click Save, then capture the process number from the list"]

Based on this, please:

1. EXPLAIN THE FIELDS — for each field in formulario.campos, tell me:
   - what it likely represents in the business context
   - the correct Playwright selector to use
   - any warnings (mask, Select2, autocomplete, strict mode risk)

2. EXPLAIN THE POPUPS — for each item in popups_capturados, describe
   the fields inside and how they fit into the flow

3. GENERATE THE SCRIPT — write a complete protocolar.py using Playwright
   with the selectors from the JSON, following the manual steps I described.
   Use the submit_primario selector for the final submit.
   For OctoberCMS (data-request fields): always use .click(), never form.submit()
   For Select2: click the container, type to filter, click the option
   For pekeupload: POST to /api/files with session cookies, get UUID, fill hidden input
   For fields with masks: check the avisos field for ÷100 warnings

4. LIST THE RISKS — based on diagnostico and resumo.go_nogo, tell me
   what could break this automation and how to handle it
```

### Prompt — explain only (no script)

Shorter version when you just want to understand the page before coding:

```
I have a JSON from Vertex Field Mapper. Analyze it and tell me:
- What type of page this is and what it does
- All form fields with their selectors and any special handling needed
- All detected grids and how to iterate them
- Any automation risks I should know about

JSON: [PASTE JSON HERE]
```

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
| iFrame | Use `frame.locator()` instead of `page.locator()` |
| Strict mode risks | Selectors matching multiple elements — use `.first` or `.nth()` |

---

## Roadmap

- [x] DataTables, AG Grid, Tabulator, Kendo UI, Handsontable detection
- [x] Automatic page type classification
- [x] Multi-page session with persistence
- [x] Go/No-Go signals
- [x] Ready-to-use Playwright code per grid
- [x] Guided lazy popup capture (OctoberCMS) with checklist
- [x] Captured popups saved as sub-items of parent page (schema v3.2)
- [x] Copy JSON to clipboard
- [ ] Bootstrap modals and React modals without `role="dialog"`
- [ ] Detail mode — map display elements for `monitor.py` generation
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
