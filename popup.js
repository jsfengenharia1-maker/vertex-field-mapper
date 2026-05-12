// popup.js — Vertex Field Mapper v4.0
// Detecção automática: DataTables, AG Grid, Tabulator, Kendo UI, Handsontable + HTML Table
// Classificação de tipo de página: formulario | lista_dados | dashboard | detalhe | misto
// JSON sempre completo com meta, tipo_pagina, grids, formulario, diagnostico

'use strict';

const STORAGE_KEY = 'vertex_sessao_v4';
const $ = id => document.getElementById(id);
let dadosMapeados = null;

// ─────────────────────────────────────────────────────────────────────────────
// STORAGE
// ─────────────────────────────────────────────────────────────────────────────
const storage = {
  get: () => new Promise(r => chrome.storage.local.get(STORAGE_KEY, d => r(d[STORAGE_KEY] || null))),
  set: v  => new Promise(r => chrome.storage.local.set({ [STORAGE_KEY]: v }, r)),
  clear: () => new Promise(r => chrome.storage.local.remove(STORAGE_KEY, r)),
};

// ─────────────────────────────────────────────────────────────────────────────
// UTILITÁRIOS
// ─────────────────────────────────────────────────────────────────────────────
const slugify = t => (t||'projeto').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,'_')
  .replace(/[^\w_]/g,'').replace(/_+/g,'_').trim() || 'projeto';

const formatUrl = url => { try { const u=new URL(url); return u.hostname+u.pathname.substring(0,30)+(u.pathname.length>30?'…':''); } catch(_){ return url.substring(0,40); } };

function setStatus(id, msg, tipo='info') { const e=$(id); e.textContent=msg; e.className=`status-box show ${tipo}`; }
function clearStatus(id) { const e=$(id); e.textContent=''; e.className='status-box'; }

// ─────────────────────────────────────────────────────────────────────────────
// TABS
// ─────────────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    $('tab-'+tab.dataset.tab).classList.add('active');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCRIPT INJETADO — roda dentro da página alvo
// ─────────────────────────────────────────────────────────────────────────────
function scriptDeMapeamento(opcoes) {
  'use strict';

  // ── Helpers ────────────────────────────────────────────────────────────────
  const htmlLow = document.documentElement.innerHTML.toLowerCase();

  function getLabel(el) {
    if (el.id) { const l=document.querySelector(`label[for="${el.id}"]`); if(l) return l.innerText.trim().substring(0,100); }
    const pl=el.closest('label'); if(pl) return pl.innerText.trim().substring(0,100);
    const prev=el.previousElementSibling; if(prev?.tagName==='LABEL') return prev.innerText.trim().substring(0,100);
    const g=el.closest('.field,.form-group,.control,.input-group,[class*="field"]');
    if(g){const l=g.querySelector('label'); if(l) return l.innerText.trim().substring(0,100);}
    return '';
  }

  function getSeletor(el) {
    if(el.id) return `#${el.id}`;
    if(el.name) return `${el.tagName.toLowerCase()}[name="${el.name}"]`;
    const cls=el.className?.trim().split(/\s+/)[0];
    if(cls) return `${el.tagName.toLowerCase()}.${cls}`;
    return el.tagName.toLowerCase();
  }

  function getMascara(el) {
    return el.dataset.mask||el.getAttribute('data-inputmask')||el.getAttribute('pattern')||'';
  }

  function countEl(sel) { try{return document.querySelectorAll(sel).length;}catch(_){return 1;} }

  // ── 1. Frameworks ──────────────────────────────────────────────────────────
  const FW = {
    'OctoberCMS':    ['data-request','eseti','october','oc-'],
    'Laravel':       ['laravel_session','_token'],
    'Django':        ['csrfmiddlewaretoken'],
    'WordPress':     ['wp-content','wp-includes'],
    'AdminLTE':      ['hold-transition','main-sidebar','sidebar-dark','control-sidebar'],
    'jQuery':        ['jquery'],
    'Vue.js':        ['__vue__','v-bind','v-model'],
    'React':         ['data-reactroot','__react'],
    'Angular':       ['ng-version','_nghost','_ngcontent'],
    'Alpine.js':     ['x-data','x-bind'],
    'Livewire':      ['wire:model','livewire'],
    'Select2':       ['select2-container','select2-selection'],
    'pekeupload':    ['pekeupload','pkuparea'],
    'Semantic UI':   ['ui message','ui form','ui segment'],
    'Bootstrap':     ['bootstrap'],
    'Tailwind':      ['tailwind'],
    'Materialize':   ['materialize','input-field','chip'],
    'Foundation':    ['foundation','orbit','grid-x'],
  };
  // Mínimo de assinaturas distintas pra evitar falso positivo (data-request é genérico)
  const FW_MIN = { 'OctoberCMS': 2, 'Materialize': 2, 'Semantic UI': 2 };
  const frameworks = [];
  for(const [n,s] of Object.entries(FW)) {
    const hits = s.filter(sig => htmlLow.includes(sig.toLowerCase())).length;
    const required = FW_MIN[n] || 1;
    if(hits >= required) frameworks.push(n);
  }

  // ── 1b. Detecção de SPA via window globals (mais robusta que innerHTML) ────
  // Só funciona quando o script roda em world:'MAIN' (vide executarScript)
  const W = (typeof window !== 'undefined') ? window : {};
  const spa = {
    react:    !!(W.React || W.__REACT_DEVTOOLS_GLOBAL_HOOK__ || document.querySelector('[data-reactroot]')),
    next:     !!(W.__NEXT_DATA__ || document.getElementById('__next')),
    vue:      !!(W.Vue || W.__VUE__ || document.querySelector('[data-v-app]')),
    nuxt:     !!(W.__NUXT__ || W.$nuxt),
    angular:  !!(W.ng || W.getAllAngularRootElements),
    svelte:   !!document.querySelector('[class*="svelte-"]'),
    preact:   !!(W.preact),
    solid:    !!(W._$HY),
  };
  const spaDetectado = Object.entries(spa).filter(([k,v])=>v).map(([k])=>k);
  // Promover detecção mais confiável: se achou via window, garante presença na lista
  if(spa.react   && !frameworks.includes('React'))   frameworks.push('React');
  if(spa.vue     && !frameworks.includes('Vue.js')) frameworks.push('Vue.js');
  if(spa.angular && !frameworks.includes('Angular')) frameworks.push('Angular');
  if(spa.next    && !frameworks.includes('Next.js')) frameworks.push('Next.js');
  if(spa.nuxt    && !frameworks.includes('Nuxt'))    frameworks.push('Nuxt');
  if(spa.svelte  && !frameworks.includes('Svelte'))  frameworks.push('Svelte');

  // ── 2. Detecção de GRIDS ───────────────────────────────────────────────────
  const grids = [];

  // ── 2a. jQuery DataTables ─────────────────────────────────────────────────
  const dtWrappers = document.querySelectorAll('div.dataTables_wrapper');
  dtWrappers.forEach((wrapper, wi) => {
    const table = wrapper.querySelector('table.dataTable') || wrapper.querySelector('table');
    if(!table) return;
    const tableId = table.id ? `#${table.id}` : (wi===0 ? 'table.dataTable' : `table.dataTable:nth-of-type(${wi+1})`);
    const headers = Array.from(table.querySelectorAll('thead th,thead td')).map((th,i) => ({
      indice: i+1,
      nome: th.innerText.trim().replace(/\s+/g,' '),
      ordenavel: th.classList.contains('sorting')||th.classList.contains('sorting_asc')||th.classList.contains('sorting_desc'),
      seletor_header: `${tableId} thead th:nth-child(${i+1})`,
      seletor_celula: `${tableId} tbody tr td:nth-child(${i+1})`,
    })).filter(h => h.nome);
    const rows = table.querySelectorAll('tbody tr:not(.dataTables_empty)');
    const paginate = wrapper.querySelector('div.dataTables_paginate');
    const filterInput = wrapper.querySelector('div.dataTables_filter input');
    const info = wrapper.querySelector('div.dataTables_info');

    // Gerar código Playwright
    const colCode = headers.slice(0,6).map(h =>
      `    ${h.nome.toLowerCase().replace(/\s+/g,'_')} = linha.locator('td:nth-child(${h.indice})').inner_text().strip()`
    ).join('\n');

    grids.push({
      tipo: 'datatables',
      id_elemento: table.id || '',
      seletor_tabela: tableId,
      colunas: headers,
      total_linhas_visiveis: rows.length,
      seletor_linha: `${tableId} tbody tr`,
      paginacao: {
        detectada: !!paginate,
        seletor_proxima:  paginate ? `${tableId}_next, a.paginate_button.next` : null,
        seletor_anterior: paginate ? `${tableId}_previous, a.paginate_button.previous` : null,
        seletor_atual:    paginate ? 'a.paginate_button.current, span.current' : null,
        info_seletor:     info ? 'div.dataTables_info' : null,
      },
      filtro: {
        detectado: !!filterInput,
        seletor: filterInput ? 'div.dataTables_filter input' : null,
      },
      aviso: 'DataTables pode carregar dados via AJAX. Verificar se as linhas estão presentes no HTML ou se requerem navegação de página.',
      playwright: {
        iterar_linhas: `linhas = page.locator("${tableId} tbody tr")\nfor i in range(linhas.count()):\n    linha = linhas.nth(i)\n${colCode}`,
        proxima_pagina: paginate ? `page.locator("a.paginate_button.next").click()\npage.wait_for_timeout(1500)` : None,
        filtrar: filterInput ? `page.locator("div.dataTables_filter input").fill("TERMO")\npage.wait_for_timeout(800)` : null,
      },
    });
  });

  // Fallback: table.dataTable sem wrapper
  if(dtWrappers.length===0) {
    document.querySelectorAll('table.dataTable').forEach((table,wi) => {
      const tableId = table.id ? `#${table.id}` : 'table.dataTable';
      const headers = Array.from(table.querySelectorAll('thead th')).map((th,i) => ({
        indice: i+1, nome: th.innerText.trim(),
        seletor_celula: `${tableId} tbody tr td:nth-child(${i+1})`,
      })).filter(h=>h.nome);
      grids.push({
        tipo: 'datatables',
        id_elemento: table.id||'',
        seletor_tabela: tableId,
        colunas: headers,
        total_linhas_visiveis: table.querySelectorAll('tbody tr').length,
        seletor_linha: `${tableId} tbody tr`,
        paginacao: { detectada: false },
        aviso: 'DataTables sem wrapper detectado. Procurar controles de paginação externos.',
        playwright: {
          iterar_linhas: `for linha in page.locator("${tableId} tbody tr").all():\n    # extrair colunas`,
        },
      });
    });
  }

  // ── 2b. AG Grid ────────────────────────────────────────────────────────────
  document.querySelectorAll('div.ag-root-wrapper').forEach(agRoot => {
    const headerCells = Array.from(agRoot.querySelectorAll('div.ag-header-cell[col-id]'));
    const cols = headerCells.map(h => {
      const colId = h.getAttribute('col-id');
      return {
        col_id: colId,
        nome: h.querySelector('.ag-header-cell-text')?.innerText?.trim() || colId,
        seletor_celula: `div.ag-cell[col-id="${colId}"]`,
      };
    });
    const rows = agRoot.querySelectorAll('div.ag-row:not(.ag-row-group)');
    const pagPanel = agRoot.querySelector('div.ag-paging-panel');
    const colCode = cols.slice(0,6).map(c =>
      `    ${c.col_id.replace(/-/g,'_')} = linha.locator('div.ag-cell[col-id="${c.col_id}"]').inner_text().strip()`
    ).join('\n');

    grids.push({
      tipo: 'ag-grid',
      tema: agRoot.className.match(/ag-theme-\w+/)?.[0] || '',
      colunas: cols,
      total_linhas_visiveis: rows.length,
      seletor_linha: 'div.ag-row',
      paginacao: {
        detectada: !!pagPanel,
        seletor_proxima:  pagPanel ? 'span[ref="btNext"], button[ref="btNext"]' : null,
        seletor_anterior: pagPanel ? 'span[ref="btPrevious"], button[ref="btPrevious"]' : null,
        seletor_info:     pagPanel ? 'span.ag-paging-description' : null,
      },
      aviso: 'AG Grid usa virtualização de linhas — apenas linhas visíveis estão no DOM. Rolar para baixo para ver mais.',
      playwright: {
        iterar_linhas: `linhas = page.locator("div.ag-row")\nfor i in range(linhas.count()):\n    linha = linhas.nth(i)\n${colCode}`,
        proxima_pagina: pagPanel ? `page.locator('span[ref="btNext"]').click()\npage.wait_for_timeout(1500)` : null,
        aviso_virtualizacao: 'AG Grid virtualiza linhas. Fazer scroll: page.locator("div.ag-body-viewport").evaluate("el => el.scrollTop += 500")',
      },
    });
  });

  // ── 2c. Tabulator ──────────────────────────────────────────────────────────
  const tabulators = document.querySelectorAll('div.tabulator');
  tabulators.forEach(tab => {
    const rows = tab.querySelectorAll('div.tabulator-row');
    if(rows.length===0) return;
    const cols = Array.from(rows[0].querySelectorAll('[tabulator-field]')).map(c => {
      const field = c.getAttribute('tabulator-field');
      return { campo: field, seletor_celula: `[tabulator-field="${field}"]` };
    });
    // Headers (melhor nome)
    const colNomes = {};
    tab.querySelectorAll('div.tabulator-col[tabulator-field]').forEach(h => {
      const f = h.getAttribute('tabulator-field');
      const nome = h.querySelector('.tabulator-col-title')?.innerText?.trim();
      if(f && nome) colNomes[f]=nome;
    });
    cols.forEach(c => { if(colNomes[c.campo]) c.nome=colNomes[c.campo]; else c.nome=c.campo; });
    const paginator = tab.querySelector('span.tabulator-paginator');
    const colCode = cols.slice(0,6).map(c =>
      `    ${c.campo.replace(/-/g,'_')} = linha.locator('[tabulator-field="${c.campo}"]').inner_text().strip()`
    ).join('\n');

    grids.push({
      tipo: 'tabulator',
      colunas: cols,
      total_linhas_visiveis: rows.length,
      seletor_linha: 'div.tabulator-row',
      paginacao: {
        detectada: !!paginator,
        seletor_proxima:  paginator ? 'button[data-page="next"]' : null,
        seletor_anterior: paginator ? 'button[data-page="prev"]' : null,
        seletor_ultima:   paginator ? 'button[data-page="last"]' : null,
        seletor_atual:    paginator ? 'button.tabulator-page.active' : null,
      },
      aviso_falso_positivo: 'Capturar numero_antes do submit. Comparar com numero_depois. Se iguais = falso positivo.',
      playwright: {
        capturar_antes: `numero_antes = page.locator("div.tabulator-row").first.locator('[tabulator-field="${cols[0]?.campo}"]').inner_text().strip()`,
        iterar_linhas: `linhas = page.locator("div.tabulator-row")\nfor i in range(linhas.count()):\n    linha = linhas.nth(i)\n${colCode}`,
        proxima_pagina: paginator ? `page.locator('button[data-page="next"]').click()\npage.wait_for_timeout(2000)` : null,
      },
    });
  });

  // ── 2d. Kendo UI ───────────────────────────────────────────────────────────
  document.querySelectorAll('div.k-grid').forEach(kGrid => {
    const headers = Array.from(kGrid.querySelectorAll('th.k-header')).map((th,i) => ({
      indice: i+1,
      nome: th.innerText.trim().replace(/\s+/g,' '),
      seletor_celula: `td[role="gridcell"]:nth-child(${i+1})`,
    })).filter(h=>h.nome);
    const rows = kGrid.querySelectorAll('tr.k-master-row');
    const pager = kGrid.querySelector('div.k-pager-wrap') || document.querySelector('div.k-pager-wrap');
    const colCode = headers.slice(0,6).map(h =>
      `    ${h.nome.toLowerCase().replace(/\s+/g,'_')} = linha.locator('td:nth-child(${h.indice})').inner_text().strip()`
    ).join('\n');

    grids.push({
      tipo: 'kendo-ui',
      colunas: headers,
      total_linhas_visiveis: rows.length,
      seletor_linha: 'tr.k-master-row',
      paginacao: {
        detectada: !!pager,
        seletor_proxima:  pager ? 'a.k-pager-nav[title*="next"], a[aria-label*="next"]' : null,
        seletor_anterior: pager ? 'a.k-pager-nav[title*="previous"]' : null,
        seletor_info:     pager ? 'span.k-pager-info' : null,
      },
      aviso: 'Kendo UI comum em stacks .NET/Microsoft. Verificar se o grid usa server-side paging.',
      playwright: {
        iterar_linhas: `linhas = page.locator("tr.k-master-row")\nfor i in range(linhas.count()):\n    linha = linhas.nth(i)\n${colCode}`,
        proxima_pagina: pager ? `page.locator('a.k-pager-nav[title*="next"]').click()\npage.wait_for_timeout(1500)` : null,
      },
    });
  });

  // ── 2e. Handsontable ───────────────────────────────────────────────────────
  document.querySelectorAll('div.handsontable').forEach(hot => {
    const hotTable = hot.querySelector('table.htCore');
    if(!hotTable) return;
    const headers = Array.from(hotTable.querySelectorAll('thead th')).map((th,i) => ({
      indice: i+1,
      nome: th.innerText.trim(),
      seletor_celula: `table.htCore tbody tr td:nth-child(${i+1})`,
    })).filter(h=>h.nome && h.nome!=='');
    const rows = hotTable.querySelectorAll('tbody tr');
    const colCode = headers.slice(0,6).map(h =>
      `    ${h.nome.toLowerCase().replace(/\s+/g,'_')} = linha.locator('td:nth-child(${h.indice})').inner_text().strip()`
    ).join('\n');

    grids.push({
      tipo: 'handsontable',
      colunas: headers,
      total_linhas_visiveis: rows.length,
      seletor_linha: 'div.handsontable table.htCore tbody tr',
      paginacao: { detectada: false },
      aviso: 'Handsontable usa scroll virtual — linhas fora da tela não estão no DOM. Fazer scroll para carregar mais.',
      playwright: {
        iterar_linhas: `linhas = page.locator("div.handsontable table.htCore tbody tr")\nfor i in range(linhas.count()):\n    linha = linhas.nth(i)\n${colCode}`,
        scroll_virtual: `page.locator("div.handsontable").evaluate("el => el.scrollTop += 500")\npage.wait_for_timeout(500)`,
      },
    });
  });

  // ── 2f. HTML Table nativa (sem biblioteca conhecida) ──────────────────────
  const tablesBiblioteca = new Set();
  document.querySelectorAll('table.dataTable, .ag-root-wrapper table, .k-grid table, .handsontable table, .tabulator table')
    .forEach(t => tablesBiblioteca.add(t));

  document.querySelectorAll('table').forEach((table,ti) => {
    if(tablesBiblioteca.has(table)) return;
    const tbody = table.querySelector('tbody');
    if(!tbody || tbody.querySelectorAll('tr').length===0) return;
    const tableId = table.id ? `#${table.id}` : `table:nth-of-type(${ti+1})`;
    const headers = Array.from(table.querySelectorAll('thead th, thead td')).map((th,i) => ({
      indice: i+1,
      nome: th.innerText.trim().replace(/\s+/g,' '),
      seletor_celula: `${tableId} tbody tr td:nth-child(${i+1})`,
    })).filter(h=>h.nome);
    const rows = tbody.querySelectorAll('tr');
    const colCode = headers.slice(0,6).map(h =>
      `    ${h.nome.toLowerCase().replace(/\s+/g,'_')||'col'+h.indice} = linha.locator('td:nth-child(${h.indice})').inner_text().strip()`
    ).join('\n') || '    # extrair colunas por índice';

    grids.push({
      tipo: 'html_table',
      id_elemento: table.id||'',
      seletor_tabela: tableId,
      colunas: headers,
      total_linhas_visiveis: rows.length,
      seletor_linha: `${tableId} tbody tr`,
      paginacao: { detectada: false },
      playwright: {
        iterar_linhas: `linhas = page.locator("${tableId} tbody tr")\nfor i in range(linhas.count()):\n    linha = linhas.nth(i)\n${colCode}`,
      },
    });
  });

  // ── 3. Classificação do tipo de página ────────────────────────────────────
  const temGrid = grids.length > 0;
  const temForm = !!document.querySelector('form');
  const nCamposForm = document.querySelectorAll('input:not([type=hidden]):not([type=submit]), select, textarea').length;
  const temCards = document.querySelectorAll('.card,.widget,.kpi,[class*="metric"],[class*="stat-card"]').length > 2;
  const temReadOnly = document.querySelectorAll('input[readonly],input[disabled],.field-value,[class*="display-field"]').length > 3;

  const motivos = [];
  let classificacao = 'misto';
  let confianca = 'media';

  if(temForm && nCamposForm > 0 && !temGrid) {
    classificacao='formulario'; confianca='alta';
    motivos.push(`${nCamposForm} campos de entrada`, 'sem grids de dados');
  } else if(temGrid && (!temForm || nCamposForm < 2)) {
    classificacao='lista_dados'; confianca='alta';
    motivos.push(`${grids.length} grid(s) detectado(s)`, 'sem formulário de entrada significativo');
  } else if(temCards && !temForm && !temGrid) {
    classificacao='dashboard'; confianca='media';
    motivos.push('múltiplos cards/widgets', 'sem grids ou formulários principais');
  } else if(temReadOnly && !temForm && !temGrid) {
    classificacao='detalhe'; confianca='media';
    motivos.push('campos somente leitura', 'sem grids ou formulários');
  } else if(temForm && temGrid) {
    classificacao='misto'; confianca='alta';
    motivos.push(`formulário com ${nCamposForm} campos`, `${grids.length} grid(s)`);
  } else {
    confianca='baixa';
    motivos.push('estrutura não identificada com clareza');
  }

  // ── 4. Campos de formulário ────────────────────────────────────────────────
  const campos = [];

  document.querySelectorAll('input:not([type=hidden])').forEach(el => {
    const tipo=(el.type||'text').toLowerCase();
    if(['button','submit','reset','image'].includes(tipo)) return;
    if((el.disabled||el.readOnly) && !opcoes.incluirDisabled) return;
    const sel=getSeletor(el); const cnt=countEl(sel);
    const mask=getMascara(el);
    const isSel2=el.id?!!document.querySelector(`#s2id_${el.id},.select2-container[id*="${el.id}"]`):false;
    const isAuto=!!(el.dataset.autocomplete||el.dataset.source||el.getAttribute('data-provide')==='typeahead'||el.list);
    const isDate=!!(tipo==='date'||tipo==='datetime-local'||el.className.includes('datepicker'));
    const avisos=[];
    if(mask) avisos.push(`Máscara: "${mask}"`);
    if(isSel2) avisos.push('Select2');
    if(isAuto) avisos.push('Autocomplete XHR');
    if(isDate) avisos.push('Datepicker JS');
    if(cnt>1) avisos.push(`Strict mode: ${cnt} matches`);
    campos.push({
      tipo_elemento: isAuto?'autocomplete':isDate?'datepicker':'input',
      type:tipo, name:el.name||'', id:el.id||'',
      label:getLabel(el), placeholder:el.placeholder||'',
      aria_label: el.getAttribute('aria-label')||'',
      data_testid: el.getAttribute('data-testid')||'',
      seletor_playwright: cnt>1?`${sel} /* ⚠ ${cnt} matches */`:sel,
      obrigatorio:el.required||false, readonly:el.readOnly||false,
      mascara:mask, is_select2:isSel2,
      avisos:avisos.length?avisos:undefined,
    });
  });

  document.querySelectorAll('select').forEach(el => {
    if(el.disabled&&!opcoes.incluirDisabled) return;
    const isSel2=!!document.querySelector(`#s2id_${el.id},.select2-container[id*="${el.id}"]`);
    campos.push({
      tipo_elemento:'select', type:'select', name:el.name||'', id:el.id||'',
      label:getLabel(el),
      aria_label: el.getAttribute('aria-label')||'',
      data_testid: el.getAttribute('data-testid')||'',
      seletor_playwright:getSeletor(el),
      total_opcoes:el.options.length,
      opcoes:Array.from(el.options).slice(0,20).map(o=>({value:o.value,text:o.text.trim()})),
      is_select2:isSel2, seletor_select2:isSel2?`#s2id_${el.id}`:null,
      avisos:isSel2?['Select2 — não usar select_option()']:undefined,
    });
  });

  document.querySelectorAll('textarea').forEach(el => {
    if(el.disabled&&!opcoes.incluirDisabled) return;
    campos.push({ tipo_elemento:'textarea', name:el.name||'', id:el.id||'',
      label:getLabel(el),
      aria_label: el.getAttribute('aria-label')||'',
      data_testid: el.getAttribute('data-testid')||'',
      seletor_playwright:getSeletor(el) });
  });

  document.querySelectorAll('.pekeupload-drag-area,.pkuparea,input[type=file]').forEach(el => {
    const g=el.closest('.field,.form-group,.control')||el.parentElement;
    campos.push({ tipo_elemento:'upload_pekeupload',
      input_hidden_name:g?.querySelector('input[type=hidden]')?.name||'',
      label:g?.querySelector('label')?.innerText?.trim()||'',
      aria_label: el.getAttribute('aria-label')||'',
      data_testid: el.getAttribute('data-testid')||'',
      seletor_playwright:el.tagName==='INPUT'?`input[type=file]`:'.pkuparea',
      avisos:['POST /api/files + cookies → UUID → input hidden'],
    });
  });

  // ── 4b. Botões de ação ────────────────────────────────────────────────────
  // Gap #1 identificado na análise: sem mapeamento de botões, IA chuta seletor de submit
  const botoes = [];
  const RX_TEXTO_PRIMARIO = /salvar|enviar|confirmar|finalizar|protocolar|cadastrar|continuar|próximo|proximo|avançar|avancar|submit|publish|create|save|send/i;
  const RX_TEXTO_PERIGO  = /excluir|deletar|remover|cancelar|delete|remove/i;
  const RX_CLASSE_PRIM   = /btn-primary|primary|main-action|btn-success|btn-submit/i;

  const botoesSeletor = 'button, input[type=submit], input[type=button], input[type=image], a[data-request], a.btn, [role=button]';
  document.querySelectorAll(botoesSeletor).forEach(el => {
    if(el.disabled && !opcoes.incluirDisabled) return;
    // Texto: prefere innerText, depois value, depois aria-label
    const texto = ((el.innerText||el.textContent||'').trim() || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g,' ').substring(0,80);
    // Pular botões totalmente anônimos (sem id, name, texto, data-request)
    const dataRequest = el.getAttribute('data-request') || '';
    if(!texto && !el.id && !el.name && !dataRequest) return;

    const sel = getSeletor(el);
    const cnt = countEl(sel);
    const classesRaw = (typeof el.className === 'string') ? el.className : (el.getAttribute('class')||'');
    const classes = classesRaw.split(/\s+/).filter(Boolean);
    const isPrimaryByClass = classes.some(c => RX_CLASSE_PRIM.test(c));
    const isPrimaryByText  = RX_TEXTO_PRIMARIO.test(texto);
    const isPerigo         = RX_TEXTO_PERIGO.test(texto);
    const formContexto     = el.closest('form');

    const tipo = (el.tagName === 'A' || el.getAttribute('role') === 'button')
      ? 'link_acao'
      : ((el.type||'').toLowerCase() || el.tagName.toLowerCase());

    let posY = 0;
    try { posY = Math.round(el.getBoundingClientRect().top); } catch(_){}

    const avisos = [];
    if(cnt > 1) avisos.push(`Strict mode: ${cnt} matches — use .first() ou refine seletor`);
    if(dataRequest) avisos.push(`OctoberCMS AJAX: data-request="${dataRequest}" — usar .click(), NUNCA form.submit()`);
    if(isPerigo) avisos.push('Texto sugere ação destrutiva — confirmar antes de automatizar');
    if(el.tagName === 'A' && !dataRequest) avisos.push('É um link <a> — pode causar navegação; verifique se há handler JS');

    botoes.push({
      texto, tipo,
      seletor_playwright: cnt>1 ? `${sel} /* ⚠ ${cnt} matches */` : sel,
      id: el.id||'', name: el.name||'',
      classes: classes.slice(0,5),
      aria_label: el.getAttribute('aria-label')||'',
      data_testid: el.getAttribute('data-testid')||'',
      data_request: dataRequest,
      disabled: el.disabled||false,
      em_formulario: !!formContexto,
      form_id: formContexto?.id || '',
      provavel_primario: isPrimaryByClass || isPrimaryByText,
      acao_destrutiva: isPerigo,
      posicao_y: posY,
      avisos: avisos.length ? avisos : undefined,
    });
  });

  // Heurística de "este é o botão de submit principal": prioriza data-request > classe primária > texto primário > último botão do form
  // Marca apenas UM como provavel_submit_primario para evitar ambiguidade
  let idxSubmit = botoes.findIndex(b => b.data_request && b.provavel_primario);
  if(idxSubmit < 0) idxSubmit = botoes.findIndex(b => b.data_request);
  if(idxSubmit < 0) idxSubmit = botoes.findIndex(b => b.em_formulario && b.provavel_primario && !b.acao_destrutiva);
  if(idxSubmit < 0) idxSubmit = botoes.findIndex(b => b.provavel_primario && !b.acao_destrutiva);
  if(idxSubmit < 0) {
    // Último botão dentro de um form, descartando ações destrutivas
    for(let i=botoes.length-1; i>=0; i--) {
      if(botoes[i].em_formulario && !botoes[i].acao_destrutiva) { idxSubmit = i; break; }
    }
  }
  if(idxSubmit >= 0) botoes[idxSubmit].provavel_submit_primario = true;

  // ── 5. Diagnóstico ─────────────────────────────────────────────────────────
  const diag = {
    webdriver_detectavel: navigator.webdriver===true,
    tem_recaptcha: !!(document.querySelector('.g-recaptcha,iframe[src*="recaptcha"],iframe[src*="hcaptcha"]')||htmlLow.includes('grecaptcha')),
    tem_certificado_digital: !!(htmlLow.includes('certificado digital')||htmlLow.includes('.pfx')||htmlLow.includes('e-cpf')),
    tem_govbr: !!(document.querySelector('[href*="acesso.gov.br"]')||htmlLow.includes('acesso.gov.br')),
    tem_csrf_token: !!(document.querySelector('input[name*="csrf"],input[name*="_token"],meta[name="csrf-token"]')),
    csrf_token_name: document.querySelector('input[name*="csrf"],input[name*="_token"]')?.name||null,
    sessao_php: location.search.includes('PHPSESSID')||document.cookie.includes('PHPSESSID'),
    qtd_forms: document.querySelectorAll('form').length,
    tem_iframe: Array.from(document.querySelectorAll('iframe')).some(f=>f.src&&!f.src.includes('youtube')&&!f.src.includes('google')),
    strict_mode_risks: (() => {
      const CSRF_NAMES = ['__RequestVerificationToken','_token','csrfmiddlewaretoken','authenticity_token','_csrf','csrf_token'];
      const risks = [];
      const seen = new Set();
      document.querySelectorAll('input,select,textarea').forEach(el => {
        if(el.type === 'hidden') return;                            // hidden raramente importa
        if(CSRF_NAMES.includes(el.name)) return;                    // CSRF tokens são esperados aos pares
        const sel = getSeletor(el);
        if(seen.has(sel)) return;                                   // dedupe
        if(/^(input|select|textarea)$/.test(sel)) return;           // muito genérico — sempre matcha muito
        if(sel.length < 8) return;                                  // seletores muito curtos
        const cnt = countEl(sel);
        if(cnt > 1 && cnt < 100) {                                  // teto pra ignorar libs com centenas de inputs internos
          risks.push({seletor: sel, count: cnt});
          seen.add(sel);
        }
      });
      return risks;
    })(),
  };

  // ── 6. AJAX endpoints ──────────────────────────────────────────────────────
  let ajaxEndpoints = [];
  if(opcoes.incluirAjax) {
    try {
      ajaxEndpoints = performance.getEntriesByType('resource')
        .filter(e=>['xmlhttprequest','fetch'].includes(e.initiatorType))
        .map(e=>({url:e.name,ms:Math.round(e.duration)}))
        .filter(e=>!['analytics','gtag','facebook','hotjar'].some(s=>e.url.includes(s)))
        .slice(0,20);
    } catch(_){}
  }

  // ── 7. Cookies ─────────────────────────────────────────────────────────────
  let cookies = [];
  if(opcoes.incluirCookies) {
    cookies = document.cookie.split(';').map(c=>{
      const [n,...v]=c.trim().split('=');
      return {nome:n.trim(),valor_parcial:v.join('=').substring(0,15)+'...'};
    }).filter(c=>c.nome&&!['_ga','_gid','_fbp'].some(s=>c.nome.startsWith(s)));
  }

  // ── 8. Go/No-Go ────────────────────────────────────────────────────────────
  const gng = (() => {
    if(diag.tem_certificado_digital) return {status:'nogo',motivo:'Certificado digital — impossível automatizar'};
    if(diag.tem_recaptcha)           return {status:'nogo',motivo:'reCAPTCHA detectado'};
    if(diag.tem_govbr)               return {status:'warn',motivo:'Login gov.br — verificar alternativa user+senha'};
    if(diag.webdriver_detectavel)    return {status:'warn',motivo:'navigator.webdriver=true — pode ser bloqueado'};
    if(diag.tem_iframe)              return {status:'warn',motivo:'iframe detectado — usar frame.locator()'};
    return {status:'go',motivo:'Página parece automatizável'};
  })();

  // ── 9. Resumo ──────────────────────────────────────────────────────────────
  const submitPrimarioIdx = botoes.findIndex(b => b.provavel_submit_primario);
  const resumo = {
    tipo_pagina: classificacao,
    total_grids: grids.length,
    tipos_grids: [...new Set(grids.map(g=>g.tipo))],
    total_campos_form: campos.length,
    total_botoes: botoes.length,
    submit_primario: submitPrimarioIdx >= 0 ? {
      texto: botoes[submitPrimarioIdx].texto,
      seletor: botoes[submitPrimarioIdx].seletor_playwright,
      data_request: botoes[submitPrimarioIdx].data_request || null,
    } : null,
    total_frameworks: frameworks.length,
    total_avisos: campos.filter(c=>c.avisos?.length).length + diag.strict_mode_risks.length + botoes.filter(b=>b.avisos?.length).length,
    go_nogo: gng,
    frameworks,
    spa_detectado: spaDetectado.length > 0 ? spaDetectado : null,
  };

  return {
    schema_version: '2.0',                              // bump por adição de botoes_acao, spa_detection, aria_label
    url: location.href,
    titulo: document.title,
    timestamp: new Date().toISOString(),
    tipo_pagina: { classificacao, confianca, motivos },
    frameworks,
    spa_detection: spa,                                  // detalhe técnico de qual SPA framework foi encontrado
    grids,
    formulario: { detectado: campos.length>0, campos },
    botoes_acao: botoes,                                 // NOVO — seção crítica pra geração de protocolar.py
    diagnostico: diag,
    ajax_endpoints: ajaxEndpoints,
    cookies_sessao: cookies,
    resumo,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTAR SCRIPT NA ABA ATIVA
// ─────────────────────────────────────────────────────────────────────────────
async function executarScript(opcoes) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if(!tab?.id) throw new Error('Aba não encontrada.');
  if(tab.url?.startsWith('chrome://')||tab.url?.startsWith('edge://'))
    throw new Error('Não é possível mapear páginas internas do browser.');
  // Hydration wait — útil pra SPAs que ainda estão renderizando
  const waitMs = parseInt(opcoes?.waitSpaMs || 0, 10);
  if(waitMs > 0) await new Promise(r => setTimeout(r, waitMs));
  // world:'MAIN' permite acesso a window.React, window.__NEXT_DATA__, window.Vue, etc.
  const res = await chrome.scripting.executeScript({
    target:{tabId:tab.id},
    func:scriptDeMapeamento,
    args:[opcoes],
    world: 'MAIN',
  });
  const dados = res?.[0]?.result;
  if(!dados) throw new Error('Nenhum dado retornado da página.');
  return { dados, tab };
}

// ─────────────────────────────────────────────────────────────────────────────
// TIPO DE PÁGINA — config de exibição
// ─────────────────────────────────────────────────────────────────────────────
const TIPO_CONFIG = {
  formulario:  { icon:'📝', label:'Formulário de entrada',   cor:'formulario' },
  lista_dados: { icon:'📊', label:'Lista / tabela de dados', cor:'lista_dados' },
  dashboard:   { icon:'📈', label:'Dashboard / painel',      cor:'dashboard' },
  detalhe:     { icon:'🔍', label:'Página de detalhe',       cor:'detalhe' },
  misto:       { icon:'🔀', label:'Página mista',            cor:'misto' },
};

const GRID_ICONS = {
  datatables:   '①', 'ag-grid': '②', tabulator: '③',
  'kendo-ui':   '④', handsontable: '⑤', html_table: '⑥',
};

// ─────────────────────────────────────────────────────────────────────────────
// RENDERIZAR RESULTADO
// ─────────────────────────────────────────────────────────────────────────────
function renderResultado(dados, cidade) {
  const { tipo_pagina, grids, formulario, botoes_acao, frameworks, diagnostico, resumo } = dados;
  const botoes = botoes_acao || [];
  const gng = resumo.go_nogo;
  const cfg = TIPO_CONFIG[tipo_pagina.classificacao] || TIPO_CONFIG.misto;

  // Tipo banner
  $('tipo-icon').textContent   = cfg.icon;
  $('tipo-label').textContent  = cfg.label;
  $('tipo-confianca').textContent = `Confiança: ${tipo_pagina.confianca} — ${tipo_pagina.motivos.join(', ')}`;
  $('tipo-badge').textContent  = tipo_pagina.classificacao;
  $('tipo-badge').className    = `tipo-badge ${cfg.cor}`;

  // GNG
  const gngIcons = {go:'✓',warn:'⚠',nogo:'✕'};
  $('gng-icon').textContent = gngIcons[gng.status];
  $('gng-texto').textContent = gng.motivo;
  $('gng-banner').className  = `gng-banner ${gng.status}`;

  // Alertas
  const alertasEl = $('alertas');
  alertasEl.innerHTML = '';
  const submit = resumo.submit_primario;
  const alertDefs = [
    [submit,                                   'ok',    `✓ Submit primário detectado: "${submit?.texto||''}"${submit?.data_request?` (AJAX: ${submit.data_request})`:''}`],
    [!submit && botoes.length > 0,             'aviso', `⚠ ${botoes.length} botão(ões) detectado(s) mas nenhum identificado como submit primário — revise manualmente`],
    [!submit && botoes.length === 0 && formulario.detectado, 'danger', '⛔ Formulário sem botão de submit detectado — verificar se há AJAX programático'],
    [resumo.spa_detectado?.length > 0,         'info',  `ℹ SPA detectada: ${(resumo.spa_detectado||[]).join(', ')} — considere "Esperar SPA (3s)" antes de mapear`],
    [frameworks.includes('OctoberCMS'),        'aviso', '⚠ OctoberCMS: usar .click() no botão. NUNCA form.submit().'],
    [frameworks.includes('pekeupload'),        'aviso', '⚠ pekeupload: upload via /api/files + UUID.'],
    [frameworks.includes('Select2'),           'info',  'ℹ Select2: não usar select_option().'],
    [grids.some(g=>g.tipo==='tabulator'),      'info',  'ℹ Tabulator: capturar numero_antes para evitar falso positivo.'],
    [grids.some(g=>g.tipo==='ag-grid'),        'aviso', '⚠ AG Grid: virtualização — apenas linhas visíveis no DOM.'],
    [grids.some(g=>g.tipo==='handsontable'),   'aviso', '⚠ Handsontable: scroll virtual — fazer scroll para mais linhas.'],
    [diagnostico.webdriver_detectavel,         'aviso', '⚠ navigator.webdriver=true — site pode bloquear Playwright.'],
    [diagnostico.strict_mode_risks?.length>0,  'aviso', `⚠ ${diagnostico.strict_mode_risks?.length} seletor(es) com múltiplos matches.`],
  ];
  alertDefs.forEach(([c,cls,txt]) => {
    if(!c) return;
    const d=document.createElement('div');
    d.className=`alerta ${cls}`; d.textContent=txt; alertasEl.appendChild(d);
  });

  // Stats
  $('total-grids').textContent  = grids.length;
  $('total-campos').textContent = formulario.campos.length;
  $('total-fw').textContent     = frameworks.length;
  $('total-avisos').textContent = resumo.total_avisos;
  $('nome-arquivo').textContent = cidade;

  // Badges frameworks
  const badgesEl = $('badges-fw');
  badgesEl.innerHTML = '';
  frameworks.forEach(fw => {
    const b=document.createElement('span');
    b.className='badge fw'; b.textContent=fw; badgesEl.appendChild(b);
  });

  // Grids detectados
  const gridsEl = $('grids-lista');
  gridsEl.innerHTML = '';
  grids.forEach(g => {
    const card=document.createElement('div'); card.className='grid-card';
    const icon=GRID_ICONS[g.tipo]||'⑦';
    const nCols=g.colunas?.length||0;
    const nLinhas=g.total_linhas_visiveis||0;
    const temPag=g.paginacao?.detectada?'✓ paginação':'sem paginação';
    card.innerHTML=`
      <div class="grid-card-header">
        <span class="grid-tipo-badge ${g.tipo}">${icon} ${g.tipo}</span>
        ${g.id_elemento?`<span style="font-family:monospace;font-size:10px;color:var(--dim)">#${g.id_elemento}</span>`:''}
      </div>
      <div class="grid-info">
        <strong>${nCols} colunas</strong> · ${nLinhas} linhas visíveis · ${temPag}<br>
        ${g.colunas?.slice(0,4).map(c=>c.nome||c.campo||c.col_id).filter(Boolean).join(', ')||'—'}${nCols>4?` +${nCols-4}…`:''}
      </div>
      ${g.aviso?`<div style="font-size:10px;color:var(--yellow);margin-top:5px">⚠ ${g.aviso}</div>`:''}
    `;
    gridsEl.appendChild(card);
  });

  $('resultado').className='show';
  renderDiagnostico(dados);
}

// ─────────────────────────────────────────────────────────────────────────────
// RENDERIZAR DIAGNÓSTICO
// ─────────────────────────────────────────────────────────────────────────────
function renderDiagnostico(dados) {
  const d=dados.diagnostico; const gng=dados.resumo.go_nogo;
  const chk=(v,ok,warn,cls='danger')=>v?`<span class="diag-val ${cls}">${warn}</span>`:`<span class="diag-val ok">${ok}</span>`;
  $('tab-diag').innerHTML=`
    <div class="diag-section">
      <div class="diag-title">Tipo de página</div>
      <div class="diag-item"><span class="diag-key">Classificação</span><span class="diag-val">${dados.tipo_pagina.classificacao} (confiança: ${dados.tipo_pagina.confianca})</span></div>
      <div class="diag-item"><span class="diag-key">Motivos</span><span class="diag-val">${dados.tipo_pagina.motivos.join(' · ')}</span></div>
    </div>
    <div class="diag-section">
      <div class="diag-title">Grids detectados</div>
      ${dados.grids.length===0?'<div class="diag-item"><span class="diag-val dim">nenhum detectado</span></div>':
        dados.grids.map(g=>`<div class="diag-item"><span class="diag-key">${g.tipo}</span><span class="diag-val">${g.colunas?.length||0} cols · ${g.total_linhas_visiveis||0} linhas · paginação: ${g.paginacao?.detectada?'sim':'não'}</span></div>`).join('')}
    </div>
    <div class="diag-section">
      <div class="diag-title">Go/No-Go</div>
      <div class="diag-item"><span class="diag-key">Status</span><span class="diag-val ${gng.status==='go'?'ok':gng.status==='nogo'?'danger':'warn'}">${gng.status.toUpperCase()} — ${gng.motivo}</span></div>
    </div>
    <div class="diag-section">
      <div class="diag-title">Sinais de bloqueio</div>
      <div class="diag-item"><span class="diag-key">reCAPTCHA</span>${chk(d.tem_recaptcha,'não ✓','⛔ detectado')}</div>
      <div class="diag-item"><span class="diag-key">Certificado</span>${chk(d.tem_certificado_digital,'não ✓','⛔ detectado')}</div>
      <div class="diag-item"><span class="diag-key">gov.br</span>${chk(d.tem_govbr,'não ✓','⚠ detectado','warn')}</div>
      <div class="diag-item"><span class="diag-key">webdriver</span>${chk(d.webdriver_detectavel,'não ✓','⚠ true','warn')}</div>
    </div>
    <div class="diag-section">
      <div class="diag-title">Estrutura</div>
      <div class="diag-item"><span class="diag-key">Formulários</span><span class="diag-val">${d.qtd_forms}</span></div>
      <div class="diag-item"><span class="diag-key">iFrame</span>${chk(d.tem_iframe,'não ✓','usar frame.locator()','warn')}</div>
      <div class="diag-item"><span class="diag-key">CSRF token</span><span class="diag-val ${d.tem_csrf_token?'warn':'ok'}">${d.tem_csrf_token?`sim (${d.csrf_token_name})  — Playwright preserva`:'não'}</span></div>
      <div class="diag-item"><span class="diag-key">Strict risks</span><span class="diag-val ${d.strict_mode_risks?.length?'warn':'ok'}">${d.strict_mode_risks?.length||0} seletor(es) com múltiplos matches</span></div>
    </div>
    <div class="diag-section">
      <div class="diag-title">Frameworks</div>
      <div class="diag-item"><span class="diag-val">${dados.frameworks?.join(', ')||'nenhum'}</span></div>
    </div>
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// RENDERIZAR SESSÃO
// ─────────────────────────────────────────────────────────────────────────────
function renderSessao(sessao) {
  const tem = sessao?.paginas?.length > 0;
  $('sessao-vazia').style.display  = tem?'none':'block';
  $('sessao-header').style.display = tem?'flex':'none';
  $('sessao-acoes').style.display  = tem?'flex':'none';
  if(!tem) { $('paginas-lista').innerHTML=''; return; }

  $('sh-nome').textContent  = sessao.nome;
  $('sh-qtd').textContent   = sessao.paginas.length;
  $('baixar-qtd').textContent = sessao.paginas.length;

  const lista = $('paginas-lista');
  lista.innerHTML='';
  // Renderiza em ordem reversa — mais recente no topo. Número exibido reflete
  // ordem de adição (1 = primeira adicionada), e data-idx preserva o índice
  // real no array pra remoção correta.
  [...sessao.paginas].reverse().forEach((pag, posInvertida) => {
    const idx = sessao.paginas.length - 1 - posInvertida;
    const gng = pag.resumo?.go_nogo;
    const tipo = pag.tipo_pagina?.classificacao || '—';
    const cfg  = TIPO_CONFIG[tipo] || TIPO_CONFIG.misto;
    const nGrids = pag.grids?.length||0;
    const nCampos = pag.formulario?.campos?.length||0;
    const card=document.createElement('div'); card.className='pagina-card';
    card.innerHTML=`
      <div class="pagina-num">${idx+1}</div>
      <div class="pagina-info">
        <div class="pagina-desc">${cfg.icon} ${pag.meta?.descricao||pag.titulo||'Sem descrição'}</div>
        <div class="pagina-titulo">${pag.titulo||''}</div>
        <div class="pagina-url">${formatUrl(pag.url)}</div>
        <div class="pagina-meta">
          <span class="pagina-badge ${gng?.status||'go'}">${gng?.status==='go'?'✓':gng?.status==='nogo'?'✕':'⚠'} ${(gng?.status||'go').toUpperCase()}</span>
          <span>${tipo}</span>
          ${nGrids>0?`<span>🔲 ${nGrids} grid(s)</span>`:''}
          ${nCampos>0?`<span>✏ ${nCampos} campos</span>`:''}
        </div>
      </div>
      <button class="pagina-remover" data-idx="${idx}" title="Remover">✕</button>
    `;
    lista.appendChild(card);
  });

  lista.querySelectorAll('.pagina-remover').forEach(btn => {
    btn.addEventListener('click', async () => {
      const s=await storage.get(); if(!s) return;
      s.paginas.splice(parseInt(btn.dataset.idx),1);
      await storage.set(s); renderSessao(s);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MONTAR JSON FINAL DA SESSÃO
// ─────────────────────────────────────────────────────────────────────────────
function montarJsonSessao(sessao) {
  return {
    schema_version: '2.0',
    projeto: sessao.nome,
    criado_em: sessao.criada_em,
    exportado_em: new Date().toISOString(),
    total_paginas: sessao.paginas.length,
    paginas: sessao.paginas.map((p,i) => ({
      indice: i+1,
      schema_version: p.schema_version || '1.0',
      meta: p.meta,
      tipo_pagina: p.tipo_pagina,
      frameworks: p.frameworks,
      spa_detection: p.spa_detection,
      grids: p.grids,
      formulario: p.formulario,
      botoes_acao: p.botoes_acao,
      diagnostico: p.diagnostico,
      ajax_endpoints: p.ajax_endpoints,
      resumo: p.resumo,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// INICIALIZAÇÃO
// ─────────────────────────────────────────────────────────────────────────────
async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if(tab?.url) {
    const u=formatUrl(tab.url);
    $('footer-url').textContent=$('footer-url').title=u;
    $('atual-url').textContent=u;
    $('atual-titulo').textContent=tab.title||'Sem título';
  }
  const sessao=await storage.get();
  if(sessao?.nome) $('sessao-nome').value=sessao.nome;
  renderSessao(sessao);
}
init();

// ─────────────────────────────────────────────────────────────────────────────
// EVENTOS — SESSÃO
// ─────────────────────────────────────────────────────────────────────────────
$('btn-adicionar').addEventListener('click', async () => {
  const nome=slugify($('sessao-nome').value);
  const desc=($('sessao-desc').value||'').trim();
  const btn=$('btn-adicionar');
  btn.disabled=true; btn.innerHTML='<span class="spin">⬡</span> Reconhecendo...';
  clearStatus('sessao-status');

  try {
    const {dados,tab} = await executarScript({
      incluirHidden:true,
      incluirDisabled:false,
      incluirCookies:false,
      incluirAjax:true,
      waitSpaMs: $('opt-wait-spa')?.checked ? 3000 : 0,
    });
    let sessao=await storage.get();
    if(!sessao||sessao.nome!==nome) sessao={nome,criada_em:new Date().toISOString(),paginas:[]};

    // Enriquecer com meta
    dados.meta = {
      descricao: desc || dados.titulo || `Página ${sessao.paginas.length+1}`,
      projeto: nome,
      url: dados.url,
      titulo: dados.titulo,
      capturado_em: dados.timestamp,
    };

    sessao.paginas.push(dados);
    sessao.ultima_atualizacao=new Date().toISOString();
    await storage.set(sessao);
    renderSessao(sessao);
    renderDiagnostico(dados);

    const gng=dados.resumo.go_nogo;
    const tipo=dados.tipo_pagina.classificacao;
    setStatus('sessao-status',
      `✓ Adicionada — ${tipo} · ${dados.grids.length} grid(s) · ${dados.formulario.campos.length} campos | ${gng.motivo}`,
      gng.status==='go'?'ok':gng.status==='nogo'?'erro':'warn'
    );
    $('sessao-desc').value=''; // limpar descrição para próxima página

  } catch(err) {
    setStatus('sessao-status',`Erro: ${err.message}`,'erro');
  } finally {
    btn.disabled=false; btn.innerHTML='<span>＋</span> Adicionar esta página à sessão';
  }
});

$('btn-baixar-sessao').addEventListener('click', async () => {
  const sessao=await storage.get();
  if(!sessao?.paginas?.length) return;
  const json=JSON.stringify(montarJsonSessao(sessao),null,2);
  const url=URL.createObjectURL(new Blob([json],{type:'application/json'}));
  Object.assign(document.createElement('a'),{href:url,download:`${sessao.nome}_mapeamento_${sessao.paginas.length}paginas.json`}).click();
  URL.revokeObjectURL(url);
  setStatus('sessao-status',`✓ ${sessao.nome}_mapeamento_${sessao.paginas.length}paginas.json baixado`,'ok');
});

$('btn-limpar-sessao').addEventListener('click', async () => {
  if(!confirm('Limpar toda a sessão?')) return;
  await storage.clear();
  $('sessao-nome').value='';
  renderSessao(null);
  clearStatus('sessao-status');
  $('tab-diag').innerHTML='<p style="color:var(--dim);font-size:12px;text-align:center;padding:24px 0">Faça um mapeamento para ver o diagnóstico.</p>';
});

$('sessao-nome').addEventListener('input', async () => {
  const s=await storage.get(); if(!s) return;
  s.nome=slugify($('sessao-nome').value); await storage.set(s); $('sh-nome').textContent=s.nome;
});

// ─────────────────────────────────────────────────────────────────────────────
// EVENTOS — PÁGINA ÚNICA
// ─────────────────────────────────────────────────────────────────────────────
$('btn-mapear').addEventListener('click', async () => {
  const cidade=slugify($('cidade').value);
  const desc=($('pagina-desc').value||'').trim();
  const btn=$('btn-mapear');
  btn.disabled=true; btn.innerHTML='<span class="spin">⬡</span> Reconhecendo...';
  $('resultado').className=''; clearStatus('status');

  try {
    const {dados} = await executarScript({
      incluirHidden:$('opt-hidden').checked,
      incluirDisabled:$('opt-disabled').checked,
      incluirCookies:$('opt-cookies').checked,
      incluirAjax:$('opt-ajax').checked,
      waitSpaMs: $('opt-wait-spa')?.checked ? 3000 : 0,
    });
    dados.meta={descricao:desc||dados.titulo||'Página mapeada',projeto:cidade,url:dados.url,titulo:dados.titulo,capturado_em:dados.timestamp};
    dados.cidade=cidade;
    dadosMapeados=dados;

    const gng=dados.resumo.go_nogo;
    if(gng.status!=='go') setStatus('status',`${gng.status==='nogo'?'⛔':'⚠'} ${gng.motivo}`,gng.status==='nogo'?'erro':'warn');
    renderResultado(dados,cidade);
  } catch(err) {
    setStatus('status',`Erro: ${err.message}`,'erro');
  } finally {
    btn.disabled=false; btn.innerHTML='<span>⬡</span> Mapear e reconhecer página';
  }
});

$('btn-download').addEventListener('click', () => {
  if(!dadosMapeados) return;
  const cidade=slugify($('cidade').value||'site');
  const url=URL.createObjectURL(new Blob([JSON.stringify(dadosMapeados,null,2)],{type:'application/json'}));
  Object.assign(document.createElement('a'),{href:url,download:`${cidade}_campos.json`}).click();
  URL.revokeObjectURL(url);
  setStatus('status',`✓ ${cidade}_campos.json baixado`,'ok');
});

$('btn-novo').addEventListener('click', () => {
  dadosMapeados=null; $('resultado').className='';
  clearStatus('status'); $('cidade').value=''; $('pagina-desc').value='';
  $('nome-arquivo').textContent='site'; $('cidade').focus();
});

$('cidade').addEventListener('input', () => { $('nome-arquivo').textContent=slugify($('cidade').value||'site'); });
