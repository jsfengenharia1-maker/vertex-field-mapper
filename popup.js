// popup.js — Vertex Field Mapper v4.0
// Detecção automática: DataTables, AG Grid, Tabulator, Kendo UI, Handsontable + HTML Table
// Classificação de tipo de página: formulario | lista_dados | dashboard | detalhe | misto
// JSON sempre completo com meta, tipo_pagina, grids, formulario, diagnostico

'use strict';

const STORAGE_KEY = 'vertex_sessao_v4';
const $ = id => document.getElementById(id);

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

  // ── Helper: pega TODOS os data-* de um elemento, opcionalmente excluindo
  // chaves já capturadas em campos dedicados (ex: data-testid, data-request).
  function getDataAttrs(el, excluir = []) {
    const result = {};
    if(!el || !el.attributes) return result;
    const excluirSet = new Set(excluir);
    for(const attr of el.attributes) {
      if(attr.name.startsWith('data-') && !excluirSet.has(attr.name)) {
        result[attr.name] = attr.value;
      }
    }
    return result;
  }

  // ── Helper: outerHTML truncado pra contexto de debug, sem inflar JSON.
  function getOuterHtmlTruncado(el, max = 1500) {
    try {
      const h = el.outerHTML || '';
      if(h.length <= max) return h;
      return h.substring(0, max) + ` ... (+${h.length - max} chars truncados)`;
    } catch(_) { return ''; }
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
  // Só funciona quando o script roda em world:'MAIN' (vide executarScript).
  // IMPORTANTE: NÃO usar __REACT_DEVTOOLS_GLOBAL_HOOK__, __VUE_DEVTOOLS_GLOBAL_HOOK__,
  // getAllAngularRootElements etc — essas extensões de devtools injetam esses
  // globals em TODAS as páginas, gerando falso positivo em sites não-SPA.
  const W = (typeof window !== 'undefined') ? window : {};

  // Helper: detecta React via chaves internas em containers do body.
  // React 16+: cada container do body ganha chave '__reactContainer$<hash>'.
  // React legado: cada container ganha propriedade '_reactRootContainer'.
  const hasReactContainer = (() => {
    try {
      const filhos = Array.from(document.body?.children || []);
      return filhos.some(el =>
        el._reactRootContainer ||
        Object.keys(el).some(k => k.startsWith('__reactContainer$') || k.startsWith('__reactFiber$'))
      );
    } catch(_) { return false; }
  })();

  const spa = {
    // React: exige React.version (objeto real), [data-reactroot] no DOM,
    // [data-react-helmet], OU container interno do React no body.
    react: !!(W.React?.version || document.querySelector('[data-reactroot],[data-react-helmet]') || hasReactContainer),
    // Next.js: __NEXT_DATA__ é injetado pelo Next no SSR; <div id="__next"> idem.
    next:  !!(W.__NEXT_DATA__ || document.getElementById('__next')),
    // Vue: Vue.version (Vue 2 global), __VUE__ apenas se tiver Vue real anexado,
    // ou marcadores SSR/CSR no DOM.
    vue:   !!(W.Vue?.version || (W.__VUE__ && W.__VUE__.$root) || document.querySelector('[data-v-app],[data-server-rendered]')),
    // Nuxt: $nuxt é o objeto real; __NUXT__ é o estado SSR.
    nuxt:  !!(W.$nuxt || W.__NUXT__),
    // Angular: ng.version é injetado pelo Angular runtime real; [ng-version]
    // no DOM é marcador do compiler. Removido getAllAngularRootElements pois é
    // injetado pelo Angular DevTools em todas as páginas.
    angular: !!(W.ng?.version || document.querySelector('[ng-version]')),
    svelte:  !!document.querySelector('[class*="svelte-"]'),
    preact:  !!(W.preact?.h),
    solid:   !!(W._$HY?.completed),
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

  // ── 3.5. Helpers de detecção enriquecida ──────────────────────────────────

  // Detecta se um campo é obrigatório através de múltiplas fontes.
  // Retorna { obrigatorio: bool, fontes: [...] } — fontes ajuda a IA a entender
  // por que aquele campo foi marcado (e a debugar se for falso positivo).
  function detectarObrigatorio(el) {
    const fontes = [];
    if(el.required === true) fontes.push('attr-required-html5');
    if(el.getAttribute('aria-required') === 'true') fontes.push('aria-required');
    const dv = el.getAttribute('data-validation') || '';
    if(/required|obrigat/i.test(dv)) fontes.push('data-validation');
    // Label associado com asterisco
    if(el.id) {
      const lbl = document.querySelector(`label[for="${el.id}"]`);
      if(lbl && /\*/.test(lbl.textContent || '')) fontes.push('label-asterisco');
    }
    // Container ancestral com classe required/field-required/is-required
    const container = el.closest('.field,.form-group,.control,.input-group,[class*="field"]');
    if(container) {
      const cls = (container.className || '').toString();
      if(/\b(required|is-required|field-required|form-group-required)\b/.test(cls)) {
        fontes.push('classe-container-required');
      }
    }
    return { obrigatorio: fontes.length > 0, fontes };
  }

  // ── 3.6. Modais e popups ──────────────────────────────────────────────────
  // Detecta containers de modal/popup/dialog no DOM, mesmo que ocultos. Captura
  // tipo, visibilidade, campos dentro, botões dentro, e quais botões da página
  // ABREM cada modal (via data-target, data-bs-target, uk-toggle, href="#id").
  //
  // Sites de prefeitura (OctoberCMS) usam UIkit; outros usam Bootstrap. SweetAlert
  // aparece pra confirmações. Tudo é mapeado pra a IA saber:
  //  1. Que existem modais escondidos com forms aninhados
  //  2. Qual botão clicar pra abrir cada modal
  //  3. Quais campos preencher dentro
  //  4. Se o modal já está visível no momento da captura

  const SELETOR_MODAL = [
    '.modal', '.popup', '.dialog',
    '[role="dialog"]',
    'dialog',                            // HTML5 nativo
    '.uk-modal', '[uk-modal]',
    '.sweet-alert', '.swal2-popup', '.swal2-container',
    '.lightbox', '.overlay-modal',
  ].join(',');

  function tipoDoModal(el) {
    const cls = (el.className || '').toString().toLowerCase();
    if(el.hasAttribute('uk-modal') || cls.includes('uk-modal')) return 'uikit';
    if(cls.includes('swal') || cls.includes('sweet-alert')) return 'sweetalert';
    if(el.tagName === 'DIALOG') return 'html5_dialog';
    if(cls.includes('modal') && (cls.includes('fade') || el.hasAttribute('data-bs-toggle') || el.hasAttribute('data-toggle'))) return 'bootstrap';
    if(el.getAttribute('role') === 'dialog') return 'dialog';
    return 'custom';
  }

  function elVisivel(el) {
    if(!el) return false;
    try {
      if(el.offsetParent === null && el.tagName !== 'DIALOG') return false;
      const cs = window.getComputedStyle(el);
      if(cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
      if(el.tagName === 'DIALOG' && !el.open) return false;
      return true;
    } catch(_) { return false; }
  }

  const modaisEncontrados = [];
  const seletoresModaisVistos = new Set();   // pra dedup
  const elementosEmModal = new WeakMap();    // el → seletor do modal pai

  document.querySelectorAll(SELETOR_MODAL).forEach(modal => {
    // Pular modais aninhados (vamos pegar só os de topo)
    const pai = modal.parentElement?.closest(SELETOR_MODAL);
    if(pai) return;
    // Pular elementos genéricos demais (qualquer .dialog dentro de um framework)
    const id = modal.id || '';
    const cls0 = (modal.className || '').toString().split(/\s+/)[0] || '';
    const seletorModal = id ? `#${id}` : (cls0 ? `.${cls0}` : modal.tagName.toLowerCase());
    if(seletoresModaisVistos.has(seletorModal)) return;
    seletoresModaisVistos.add(seletorModal);

    // Título: procura header conhecido
    const tituloEl = modal.querySelector('.modal-title, .uk-modal-title, .swal2-title, h1, h2, h3, header');
    const titulo = tituloEl?.textContent?.trim().substring(0, 100) || '';

    // Conteúdo dentro do modal
    const formsInternos = modal.querySelectorAll('form');
    const inputsInternos = modal.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea');
    const botoesInternos = modal.querySelectorAll('button, input[type=submit], input[type=button], a.btn, [role="button"]');

    const camposIds = Array.from(inputsInternos).map(i => i.id || i.name || '').filter(Boolean).slice(0, 30);
    const botoesTextos = Array.from(botoesInternos).map(b => (b.innerText || b.value || '').trim().substring(0, 40)).filter(Boolean).slice(0, 10);

    // Encontrar abridores: botões fora do modal que apontam pra ele
    const abridores = [];
    if(id) {
      // Seletores que indicam "este botão abre o modal #id"
      const seletoresAbridor = [
        `[data-target="#${id}"]`,
        `[data-bs-target="#${id}"]`,
        `[uk-toggle*="${id}"]`,
        `[data-uk-modal*="${id}"]`,
        `[href="#${id}"]`,
      ];
      seletoresAbridor.forEach(sel => {
        try {
          document.querySelectorAll(sel).forEach(btn => {
            if(modal.contains(btn)) return;     // não conta botões que estão DENTRO do modal
            const texto = ((btn.innerText || btn.textContent || '').trim() || btn.value || '').substring(0, 60);
            const idBtn = btn.id || '';
            const dup = abridores.some(a => a.seletor === sel || a.id === idBtn);
            if(!dup) abridores.push({ texto, seletor: sel, id: idBtn });
          });
        } catch(_){}
      });
    }

    modaisEncontrados.push({
      id,
      seletor: seletorModal,
      tipo: tipoDoModal(modal),
      titulo,
      esta_visivel: elVisivel(modal),
      tem_form: formsInternos.length > 0,
      total_forms_internos: formsInternos.length,
      campos_dentro: camposIds,
      total_campos_dentro: inputsInternos.length,
      botoes_dentro: botoesTextos,
      total_botoes_dentro: botoesInternos.length,
      abridores,
      classes: (modal.className || '').toString().split(/\s+/).filter(Boolean).slice(0, 5),
    });

    // Marcar todos os elementos dentro do modal pra que possamos referenciar depois
    [...inputsInternos, ...botoesInternos].forEach(el => {
      elementosEmModal.set(el, seletorModal);
    });
  });

  // ── 3.7. Popups lazy do OctoberCMS (data-control="popup") ──────────────────
  // O OctoberCMS implementa popups que NÃO existem no DOM até serem abertos:
  // o botão tem data-control="popup" + data-handler="onAlgo"; quando clicado,
  // dispara POST AJAX pro handler, que retorna o HTML do popup. Por isso o
  // snapshot único não vê os campos internos — eles vivem só após interação.
  //
  // Aqui marcamos esses botões e adicionamos entries virtuais em modais_popups
  // pra a IA (e o usuário) saberem que precisam clicar e remapear depois.

  document.querySelectorAll('[data-control="popup"]').forEach(el => {
    const handler = el.getAttribute('data-handler') || '';
    if(!handler) return;                                    // sem handler, não conseguimos identificar o popup
    const extraData = el.getAttribute('data-extra-data') || '';

    const textoBtn = ((el.innerText || el.textContent || '').trim() || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g,' ').substring(0,80);
    const selBtn = getSeletor(el);
    const idBtn = el.id || '';

    // Chave única pro popup: handler + extra_data
    const chave = `${handler}|${extraData}`;
    const popupExistente = modaisEncontrados.find(m => m.lazy_loaded && (m.handler_backend + '|' + (m.extra_data||'')) === chave);

    if(popupExistente) {
      // Outro botão dispara o mesmo popup — adiciona como abridor adicional
      if(!popupExistente.abridores.some(a => a.seletor === selBtn)) {
        popupExistente.abridores.push({ texto: textoBtn, seletor: selBtn, id: idBtn });
      }
    } else {
      // Primeiro botão a disparar este popup — cria a entry
      const popupId = `popup_lazy_${handler}${extraData ? '_' + extraData.replace(/[^a-z0-9]/gi, '_') : ''}`;
      modaisEncontrados.push({
        id: popupId,
        seletor: '(carregado dinamicamente)',
        tipo: 'popup_lazy_octobercms',
        titulo: '(conteúdo só existe após click)',
        esta_visivel: false,
        lazy_loaded: true,
        handler_backend: handler,
        extra_data: extraData,
        tem_form: null,                                     // null = não sabemos ainda
        campos_dentro: [],
        total_campos_dentro: null,
        botoes_dentro: [],
        total_botoes_dentro: null,
        abridores: [{ texto: textoBtn, seletor: selBtn, id: idBtn }],
        classes: [],
        aviso: 'Popup carregado via AJAX. Clique no botão abridor e adicione esta página à sessão de novo para capturar os campos internos.',
      });
    }
  });

  // ── 3.8. Filtrar flyouts de navegação que poluem modais_popups ───────────────
  // Amazon e sites jQuery têm 20+ nav-flyouts sem campos — excluir se não há form,
  // não há campos e a classe está na lista de ignorados.
  const CLASSES_IGNORAR_MODAL = new Set(['nav-flyout', 'nav-coreflyout', 'dropdown-menu', 'nav-core-flyout']);
  const modaisPopups = modaisEncontrados.filter(m => {
    if(m.lazy_loaded) return true;                                  // lazy sempre mantém
    if(m.total_campos_dentro > 0 || m.tem_form) return true;        // tem conteúdo útil
    const temClasseIgnorada = (m.classes || []).some(c => CLASSES_IGNORAR_MODAL.has(c.toLowerCase()));
    if(temClasseIgnorada && !m.total_campos_dentro && !m.tem_form) return false;  // flyout vazio
    return true;
  });

  const campos = [];

  document.querySelectorAll('input:not([type=hidden])').forEach(el => {
    const tipo=(el.type||'text').toLowerCase();
    if(['button','submit','reset','image','file'].includes(tipo)) return;  // file é tratado na seção de uploads
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
    const obrig = detectarObrigatorio(el);
    campos.push({
      tipo_elemento: isAuto?'autocomplete':isDate?'datepicker':'input',
      type:tipo, name:el.name||'', id:el.id||'',
      label:getLabel(el), placeholder:el.placeholder||'',
      aria_label: el.getAttribute('aria-label')||'',
      data_testid: el.getAttribute('data-testid')||'',
      data_atributos_extras: getDataAttrs(el, ['data-testid','data-mask','data-inputmask','data-request']),
      seletor_playwright: cnt>1?`${sel} /* ⚠ ${cnt} matches */`:sel,
      obrigatorio: obrig.obrigatorio,
      obrigatorio_fontes: obrig.fontes,
      readonly:el.readOnly||false,
      mascara:mask, is_select2:isSel2,
      dentro_de_modal: elementosEmModal.get(el) || null,
      avisos:avisos.length?avisos:undefined,
    });
  });

  document.querySelectorAll('select').forEach(el => {
    if(el.disabled&&!opcoes.incluirDisabled) return;
    const isSel2=!!document.querySelector(`#s2id_${el.id},.select2-container[id*="${el.id}"]`);
    const obrig = detectarObrigatorio(el);
    campos.push({
      tipo_elemento:'select', type:'select', name:el.name||'', id:el.id||'',
      label:getLabel(el),
      aria_label: el.getAttribute('aria-label')||'',
      data_testid: el.getAttribute('data-testid')||'',
      data_atributos_extras: getDataAttrs(el, ['data-testid','data-request']),
      seletor_playwright:getSeletor(el),
      obrigatorio: obrig.obrigatorio,
      obrigatorio_fontes: obrig.fontes,
      total_opcoes:el.options.length,
      opcoes:Array.from(el.options).slice(0,20).map(o=>({value:o.value,text:o.text.trim()})),
      is_select2:isSel2, seletor_select2:isSel2?`#s2id_${el.id}`:null,
      dentro_de_modal: elementosEmModal.get(el) || null,
      avisos:isSel2?['Select2 — não usar select_option()']:undefined,
    });
  });

  document.querySelectorAll('textarea').forEach(el => {
    if(el.disabled&&!opcoes.incluirDisabled) return;
    const obrig = detectarObrigatorio(el);
    campos.push({ tipo_elemento:'textarea', name:el.name||'', id:el.id||'',
      label:getLabel(el),
      aria_label: el.getAttribute('aria-label')||'',
      data_testid: el.getAttribute('data-testid')||'',
      data_atributos_extras: getDataAttrs(el, ['data-testid','data-request']),
      seletor_playwright:getSeletor(el),
      obrigatorio: obrig.obrigatorio,
      obrigatorio_fontes: obrig.fontes,
      dentro_de_modal: elementosEmModal.get(el) || null,
    });
  });

  // ── 4a. Uploads (pekeupload + input[type=file] genéricos) ─────────────────
  // Estratégia: itera pelos CONTAINERS de widget (pkuparea, pekeupload-drag-area,
  // [data-pekeupload], [data-pekeupload-attachment-field]), não pelos inputs.
  // Isso resolve 2 problemas:
  //   1. Captura os data-attachment-field / data-attachment-type do CONTAINER,
  //      que dizem pra qual entidade do backend o arquivo será anexado.
  //   2. Evita duplicação (cada widget tinha entrada do input + do .pkuparea).
  // Para o restante de inputs[type=file] sem container pekeupload, fallback
  // como upload simples.
  const uploadsCapturados = new WeakSet();

  // Critérios pra encontrar o container do widget pekeupload
  const SELETOR_CONTAINER_UPLOAD = [
    '.pkuparea',
    '.pekeupload-drag-area',
    '[data-pekeupload]',
    '[data-pekeupload-attachment-field]',
    '[data-attachment-field]',
  ].join(',');

  document.querySelectorAll(SELETOR_CONTAINER_UPLOAD).forEach(container => {
    // Dedup: se outro container pai já foi capturado, pula
    if(uploadsCapturados.has(container)) return;

    // Procurar o <input type=file> e os hidden dentro do container.
    // Se não houver, tentar irmãos (alguns templates colocam fora do container visual).
    const inputFile = container.querySelector('input[type=file]') ||
                      container.parentElement?.querySelector('input[type=file]');
    const inputHidden = container.querySelector('input[type=hidden]') ||
                        container.parentElement?.querySelector('input[type=hidden]');

    if(inputFile) uploadsCapturados.add(inputFile);
    uploadsCapturados.add(container);

    // Captura TODOS os data-* do container E do input file (merge).
    // Excluir os que já vão em campos dedicados pra evitar duplicação.
    const excluir = ['data-testid', 'data-request'];
    const dataContainer = getDataAttrs(container, excluir);
    const dataInput = inputFile ? getDataAttrs(inputFile, excluir) : {};
    const dataAttrs = { ...dataContainer, ...dataInput };

    // Extrair campos críticos pra top-level. OctoberCMS pekeupload usa nomes
    // variados conforme a versão/template — cobrimos os principais.
    const attachmentField =
      dataAttrs['data-attachment-field'] ||
      dataAttrs['data-pekeupload-attachment-field'] ||
      dataAttrs['data-field'] ||
      '';
    const attachmentType =
      dataAttrs['data-attachment-type'] ||
      dataAttrs['data-pekeupload-attachment-type'] ||
      dataAttrs['data-type'] ||
      dataAttrs['data-model'] ||
      '';
    const handler =
      container.getAttribute('data-request') ||
      dataAttrs['data-handler'] ||
      dataAttrs['data-pekeupload-handler'] ||
      '';

    // Encontrar label associado
    const grupo = container.closest('.field,.form-group,.control,.form-field') || container.parentElement;
    const labelEl = grupo?.querySelector('label');

    // Avisos sobre dados faltantes — sinaliza pra IA quando o widget tá incompleto
    const avisos = ['POST /api/files + cookies → UUID → input hidden'];
    if(!attachmentField) avisos.push('⚠ attachment_field não encontrado no DOM — handler do backend pode rejeitar');
    if(!attachmentType)  avisos.push('⚠ attachment_type não encontrado no DOM — verificar partial OctoberCMS');
    if(!inputHidden?.name) avisos.push('⚠ input hidden de UUID não localizado');

    campos.push({
      tipo_elemento: 'upload_pekeupload',
      id: inputFile?.id || container.id || '',
      input_file_id: inputFile?.id || '',
      input_hidden_name: inputHidden?.name || '',
      label: labelEl?.innerText?.trim() || '',
      aria_label: (inputFile || container).getAttribute('aria-label') || '',
      data_testid: (inputFile || container).getAttribute('data-testid') || '',

      // Os campos críticos extraídos pra top-level — IA usa direto
      attachment_field: attachmentField,
      attachment_type: attachmentType,
      handler_ajax: handler,

      // Bag completa de data-* (container + input) pra qualquer caso não previsto
      data_atributos: dataAttrs,

      // Seletor mais específico possível: prefere id do input, depois id do container
      seletor_playwright:
        inputFile?.id ? `#${inputFile.id}` :
        container.id ? `#${container.id}` :
        'input[type=file]',
      seletor_container: container.id ? `#${container.id}` : (container.className?`.${container.className.split(/\s+/)[0]}`:'.pkuparea'),

      // outerHTML do container truncado — debug/contexto pra IA inferir o resto
      html_widget_truncado: getOuterHtmlTruncado(container, 1500),

      avisos,
    });
  });

  // Fallback: <input type=file> sem container pekeupload identificável
  // (uploads HTML5 nativos). Captura mais simples.
  document.querySelectorAll('input[type=file]').forEach(el => {
    if(uploadsCapturados.has(el)) return;
    const grupo = el.closest('.field,.form-group,.control') || el.parentElement;
    const labelEl = grupo?.querySelector('label');
    const dataAttrs = getDataAttrs(el, ['data-testid']);

    campos.push({
      tipo_elemento: 'upload_simples',
      id: el.id || '',
      name: el.name || '',
      label: labelEl?.innerText?.trim() || '',
      aria_label: el.getAttribute('aria-label') || '',
      data_testid: el.getAttribute('data-testid') || '',
      data_atributos: dataAttrs,
      seletor_playwright: el.id ? `#${el.id}` : 'input[type=file]',
      accept: el.getAttribute('accept') || '',
      multiple: el.multiple || false,
      avisos: ['Upload HTML5 nativo — set_input_files() do Playwright'],
    });
  });

  // ── 4b. Botões de ação ────────────────────────────────────────────────────
  // Gap #1 identificado na análise: sem mapeamento de botões, IA chuta seletor de submit
  const botoes = [];
  const botoesContatoExterno = new Set();  // índices de botões com href tel:/wa.me/maps — nunca são submit
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

    // Detectar se este botão abre um modal específico (data-target, data-bs-target, uk-toggle, href="#id")
    let abreModal = null;
    const targets = [
      el.getAttribute('data-target'),
      el.getAttribute('data-bs-target'),
      el.getAttribute('uk-toggle'),
      el.getAttribute('data-uk-modal'),
      el.getAttribute('href'),
    ].filter(Boolean);
    for(const t of targets) {
      // uk-toggle pode ser "target: #id" — extrair só o #id
      const m = t.match(/#[\w-]+/);
      if(m) {
        // Confirmar que esse id realmente é um modal capturado
        const modalAlvo = modaisEncontrados.find(mod => mod.seletor === m[0]);
        if(modalAlvo) { abreModal = m[0]; break; }
      }
    }

    // Detectar se este botão abre um POPUP LAZY do OctoberCMS
    const abrePopupLazy = el.getAttribute('data-control') === 'popup';
    const popupHandler = abrePopupLazy ? (el.getAttribute('data-handler') || '') : '';
    const popupExtraData = abrePopupLazy ? (el.getAttribute('data-extra-data') || '') : '';

    // Detectar link externo de contato (tel:, wa.me, maps) — nunca é submit primário
    const hrefBotao = el.getAttribute('href') || '';
    const ehHrefExternoContato = el.tagName === 'A' && /^(tel:|https?:\/\/(wa\.me|maps\.google|goo\.gl\/maps))/i.test(hrefBotao);
    if(ehHrefExternoContato) botoesContatoExterno.add(botoes.length);  // registra índice antes do push

    botoes.push({
      texto, tipo,
      seletor_playwright: cnt>1 ? `${sel} /* ⚠ ${cnt} matches */` : sel,
      id: el.id||'', name: el.name||'',
      classes: classes.slice(0,5),
      aria_label: el.getAttribute('aria-label')||'',
      data_testid: el.getAttribute('data-testid')||'',
      data_request: dataRequest,
      data_atributos_extras: getDataAttrs(el, ['data-testid','data-request']),
      disabled: el.disabled||false,
      em_formulario: !!formContexto,
      form_id: formContexto?.id || '',
      provavel_primario: isPrimaryByClass || isPrimaryByText,
      acao_destrutiva: isPerigo,
      posicao_y: posY,
      abre_modal: abreModal,
      abre_popup_lazy: abrePopupLazy,
      popup_handler_backend: popupHandler,
      popup_extra_data: popupExtraData,
      dentro_de_modal: elementosEmModal.get(el) || null,
      avisos: avisos.length ? avisos : undefined,
    });
  });

  // Heurística do "submit primário": pontua cada botão e escolhe o melhor.
  // Threshold mínimo: se ninguém atingir 30, deixa não-marcado (melhor admitir
  // que não sabe do que chutar "Sair"/"JONATHAN" como na v1.1.0).
  const RX_DATA_REQUEST_NAO_SUBMIT = /onLogout|onSair|onLogin|onDelete|onClose|onCancel|onRemove|onDestroy|onShow|onHide|onToggle/i;
  const RX_TEXTO_NAO_SUBMIT = /^(sair|logout|voltar|menu|perfil|conta|ajuda|home|in[ií]cio|cancelar|fechar|×|x|ok|telefone[s]?|whatsapp|chat|localiza[çc][aã]o)$/i;

  function pontuarBotaoSubmit(b, idx) {
    // Desqualificações duras: retornam imediatamente um score muito negativo
    if(b.acao_destrutiva) return { score: -100, razao: 'destrutivo' };
    if(b.disabled) return { score: -100, razao: 'disabled' };
    if(RX_TEXTO_NAO_SUBMIT.test((b.texto||'').trim())) {
      return { score: -50, razao: `texto blacklist: "${b.texto}"` };
    }
    if(b.data_request && RX_DATA_REQUEST_NAO_SUBMIT.test(b.data_request)) {
      return { score: -50, razao: `data-request blacklist: ${b.data_request}` };
    }
    // Penalizar links externos de contato (tel:, whatsapp, maps) — nunca são submit
    if(botoesContatoExterno.has(idx)) {
      return { score: -50, razao: 'link externo contato (tel/wa.me/maps)' };
    }

    let score = 0;
    const razoes = [];
    // Estar DENTRO de um <form> é o sinal mais forte de submit real
    if(b.em_formulario) { score += 30; razoes.push('em form'); }
    // type=submit em <button> ou <input> é declaração explícita
    if(b.tipo === 'submit') { score += 20; razoes.push('type=submit'); }
    // data-request válido (não-blacklist) indica AJAX intencional
    if(b.data_request && !RX_DATA_REQUEST_NAO_SUBMIT.test(b.data_request)) {
      score += 25; razoes.push(`data-request=${b.data_request}`);
    }
    // Classe primária OU texto primário (heurística antiga)
    if(b.provavel_primario) { score += 15; razoes.push('classe/texto primário'); }
    // ID nomeado costuma ser mais estável e intencional
    if(b.id) { score += 5; razoes.push('tem id'); }
    // Botões abaixo da dobra costumam ser submit (header tem botões em y baixo)
    if(b.posicao_y && b.posicao_y > 200) { score += 5; razoes.push('abaixo da dobra'); }

    return { score, razao: razoes.join(' + ') };
  }

  let melhorScore = -Infinity;
  let melhorIdx = -1;
  let melhorRazao = '';
  for(let i = 0; i < botoes.length; i++) {
    const { score, razao } = pontuarBotaoSubmit(botoes[i], i);
    if(score > melhorScore) {
      melhorScore = score;
      melhorIdx = i;
      melhorRazao = razao;
    }
  }
  // Threshold de 30: precisa pelo menos estar dentro de um form, OU ter
  // data-request válido + algo. Sem isso, melhor não marcar.
  if(melhorIdx >= 0 && melhorScore >= 30) {
    botoes[melhorIdx].provavel_submit_primario = true;
    botoes[melhorIdx].submit_primario_razao = melhorRazao;
    botoes[melhorIdx].submit_primario_score = melhorScore;
  }

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

  // Ações recomendadas: o que o usuário precisa fazer pra completar a captura
  const acoesRecomendadas = modaisPopups
    .filter(m => m.lazy_loaded)
    .map(m => {
      const abridor = m.abridores?.[0] || {};
      return {
        tipo: 'mapear_popup_lazy',
        prioridade: 'media',
        abridor_texto: abridor.texto || '?',
        abridor_seletor: abridor.seletor || '',
        instrucao: `Clique no botão "${abridor.texto || '?'}" para abrir o popup, depois adicione esta página à sessão de novo. O scanner vai capturar os campos internos.`,
        handler_backend: m.handler_backend,
        extra_data: m.extra_data,
      };
    });

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
    acoes_recomendadas: acoesRecomendadas,
  };

  return {
    schema_version: '3.2',                              // bump v1.3.0: popups_pendentes/capturados, checklist guiado
    url: location.href,
    titulo: document.title,
    timestamp: new Date().toISOString(),
    tipo_pagina: { classificacao, confianca, motivos },
    frameworks,
    spa_detection: spa,
    grids,
    formulario: { detectado: campos.length>0, campos },
    botoes_acao: botoes,
    modais_popups: modaisPopups,                          // filtrado (flyouts removidos)
    diagnostico: diag,
    ajax_endpoints: ajaxEndpoints,
    cookies_sessao: cookies,
    resumo: { ...resumo, total_modais: modaisPopups.length, total_campos_obrigatorios: campos.filter(c => c.obrigatorio).length },
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
// DESTAQUE VISUAL NA PÁGINA — para guiar o usuário a clicar em popups lazy
// ─────────────────────────────────────────────────────────────────────────────

// Esta função roda na página alvo (world:'MAIN'). Recebe uma lista de seletores
// e desenha overlay escurecido + outline pulsante em cada um. Inclui botão
// flutuante "✕ Fechar destaque" pra o usuário remover quando quiser.
function scriptDestacarBotoes(itens) {
  // Remove qualquer destaque anterior pra evitar acumular
  document.getElementById('vertex-overlay-destaque')?.remove();
  document.getElementById('vertex-btn-fechar-destaque')?.remove();
  document.getElementById('vertex-css-destaque')?.remove();
  document.querySelectorAll('.vertex-alvo-destaque').forEach(el => el.classList.remove('vertex-alvo-destaque'));

  // CSS injetado: overlay full-screen, outline pulsante nos alvos, botão flutuante
  const css = document.createElement('style');
  css.id = 'vertex-css-destaque';
  css.textContent = `
    #vertex-overlay-destaque {
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,.55); z-index: 2147483640;
      pointer-events: none;
    }
    .vertex-alvo-destaque {
      position: relative !important;
      z-index: 2147483641 !important;
      outline: 3px solid #ff3b3b !important;
      outline-offset: 3px !important;
      box-shadow: 0 0 0 6px rgba(255,59,59,.35), 0 0 24px 4px rgba(255,59,59,.6) !important;
      animation: vertex-pulse 1.2s ease-in-out infinite !important;
      transition: none !important;
    }
    @keyframes vertex-pulse {
      0%, 100% { box-shadow: 0 0 0 6px rgba(255,59,59,.35), 0 0 24px 4px rgba(255,59,59,.6); }
      50%      { box-shadow: 0 0 0 10px rgba(255,59,59,.15), 0 0 32px 8px rgba(255,59,59,.85); }
    }
    .vertex-rotulo-destaque {
      position: absolute; top: -28px; left: 0;
      background: #ff3b3b; color: white; font-family: system-ui, sans-serif;
      font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 4px;
      white-space: nowrap; z-index: 2147483642;
      box-shadow: 0 2px 6px rgba(0,0,0,.4);
      pointer-events: none;
    }
    #vertex-btn-fechar-destaque {
      position: fixed; top: 20px; right: 20px;
      background: #21262d; color: #e6edf3;
      border: 1px solid #ff3b3b;
      border-radius: 6px; padding: 8px 14px;
      font-family: system-ui, sans-serif; font-size: 13px; font-weight: 600;
      cursor: pointer; z-index: 2147483647;
      box-shadow: 0 4px 12px rgba(0,0,0,.4);
      transition: background .15s;
    }
    #vertex-btn-fechar-destaque:hover { background: #2a1c1c; }
    #vertex-info-destaque {
      position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
      background: #21262d; color: #e6edf3;
      border: 1px solid #f78166;
      border-radius: 6px; padding: 10px 16px;
      font-family: system-ui, sans-serif; font-size: 13px; font-weight: 500;
      z-index: 2147483647; box-shadow: 0 4px 12px rgba(0,0,0,.4);
      max-width: 80%; text-align: center; line-height: 1.4;
    }
  `;
  document.head.appendChild(css);

  // Overlay escurecido
  const overlay = document.createElement('div');
  overlay.id = 'vertex-overlay-destaque';
  document.body.appendChild(overlay);

  // Info flutuante no topo
  const info = document.createElement('div');
  info.id = 'vertex-info-destaque';
  info.innerHTML = `<strong>📌 Vertex:</strong> clique no(s) botão(ões) destacado(s) em vermelho, depois mapeie a página de novo`;
  document.body.appendChild(info);

  // Destacar cada item
  let encontrados = 0;
  (itens || []).forEach((item, idx) => {
    if(!item.seletor) return;
    try {
      // Pegar SÓ o primeiro elemento que bate (mesmo que strict mode tenha múltiplos)
      const el = document.querySelector(item.seletor.replace(/\s*\/\*.*?\*\//g,'').trim());
      if(!el) return;
      el.classList.add('vertex-alvo-destaque');
      // Rotulo numérico em cima do botão
      const rotulo = document.createElement('div');
      rotulo.className = 'vertex-rotulo-destaque';
      rotulo.textContent = `${idx+1}. ${item.texto || 'Clique aqui'}`;
      el.appendChild(rotulo);
      encontrados++;
    } catch(_) {}
  });

  // Botão de fechar
  const btnFechar = document.createElement('button');
  btnFechar.id = 'vertex-btn-fechar-destaque';
  btnFechar.textContent = '✕ Fechar destaque';
  btnFechar.onclick = () => {
    document.getElementById('vertex-overlay-destaque')?.remove();
    document.getElementById('vertex-info-destaque')?.remove();
    document.getElementById('vertex-css-destaque')?.remove();
    document.querySelectorAll('.vertex-rotulo-destaque').forEach(el => el.remove());
    document.querySelectorAll('.vertex-alvo-destaque').forEach(el => el.classList.remove('vertex-alvo-destaque'));
    btnFechar.remove();
  };
  document.body.appendChild(btnFechar);

  // Auto-rolar pra o primeiro destacado se estiver fora da viewport
  const primeiro = document.querySelector('.vertex-alvo-destaque');
  if(primeiro) {
    try { primeiro.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch(_) {}
  }

  return { encontrados };
}

async function destacarNaPagina(acoes) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if(!tab?.id) throw new Error('Aba não encontrada.');
  const itens = (acoes || []).map(a => ({ seletor: a.abridor_seletor, texto: a.abridor_texto }));
  const res = await chrome.scripting.executeScript({
    target:{tabId:tab.id},
    func:scriptDestacarBotoes,
    args:[itens],
    world: 'MAIN',
  });
  return res?.[0]?.result || { encontrados: 0 };
}

// Wrapper pra destacar um único popup (usado pelo fluxo guiado do checklist)
async function destacarUmPopup(seletor, texto) {
  return destacarNaPagina([{ abridor_seletor: seletor, abridor_texto: texto }]);
}

// Remove overlay de destaque programaticamente (sem depender do botão ✕ na página)
function scriptRemoverDestaqueInjetado() {
  document.getElementById('vertex-overlay-destaque')?.remove();
  document.getElementById('vertex-info-destaque')?.remove();
  document.getElementById('vertex-css-destaque')?.remove();
  document.getElementById('vertex-btn-fechar-destaque')?.remove();
  document.querySelectorAll('.vertex-rotulo-destaque').forEach(el => el.remove());
  document.querySelectorAll('.vertex-alvo-destaque').forEach(el => el.classList.remove('vertex-alvo-destaque'));
}

async function removerDestaqueNaPagina() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if(!tab?.id) return;
  await chrome.scripting.executeScript({
    target:{tabId:tab.id},
    func:scriptRemoverDestaqueInjetado,
    world: 'MAIN',
  });
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
    // Guard de migração: sessões v3.1 não têm esses campos
    pag.popups_pendentes  = pag.popups_pendentes  || [];
    pag.popups_capturados = pag.popups_capturados || [];

    const gng = pag.resumo?.go_nogo;
    const tipo = pag.tipo_pagina?.classificacao || '—';
    const cfg  = TIPO_CONFIG[tipo] || TIPO_CONFIG.misto;
    const nGrids = pag.grids?.length||0;
    const nCampos = pag.formulario?.campos?.length||0;

    // Status de popups para badge no card
    const totalPop   = pag.popups_pendentes.length;
    const capturados = pag.popups_pendentes.filter(p=>p.status==='capturado').length;
    const pulados    = pag.popups_pendentes.filter(p=>p.status==='pulado').length;
    const pendentes  = pag.popups_pendentes.filter(p=>p.status==='pendente').length;
    const temPopups  = totalPop > 0;
    const todosConcluidos = temPopups && pendentes === 0;

    let popupBadgeHtml = '';
    if(temPopups) {
      popupBadgeHtml = todosConcluidos
        ? `<span class="popup-status-badge ok">✓ ${totalPop} popup${totalPop>1?'s':''}</span>`
        : `<span class="popup-status-badge pendente">⚠ ${pendentes} popup${pendentes>1?'s':''} pendente${pendentes>1?'s':''}</span>`;
    }

    const card=document.createElement('div'); card.className='pagina-card';
    card.style.flexDirection = 'column';
    card.style.alignItems = 'stretch';
    card.innerHTML=`
      <div style="display:flex;align-items:flex-start;gap:10px">
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
            ${popupBadgeHtml}
          </div>
        </div>
        <button class="pagina-remover" data-idx="${idx}" title="Remover">✕</button>
      </div>
    `;

    // ── Checklist de popups pendentes ────────────────────────────────────────
    if(temPopups) {
      const checklist = document.createElement('div');
      checklist.className = 'popup-checklist';

      const headerCl = document.createElement('div');
      headerCl.className = `popup-checklist-header ${todosConcluidos ? 'todos-ok' : 'tem-pendente'}`;
      headerCl.textContent = todosConcluidos
        ? `✓ ${capturados} popup${capturados>1?'s':''} capturado${capturados>1?'s':''}${pulados>0?` · ${pulados} pulado${pulados>1?'s':''}`:''}`
        : `📌 Popups lazy — ${pendentes} pendente${pendentes>1?'s':''} de ${totalPop}`;
      checklist.appendChild(headerCl);

      pag.popups_pendentes.forEach((popup, popIdx) => {
        const item = document.createElement('div');
        item.className = `popup-item popup-item--${popup.status}`;

        const icone = popup.status === 'capturado' ? '☑' : popup.status === 'pulado' ? '—' : '☐';
        const resultadoHtml = popup.status === 'capturado'
          ? `<span class="popup-item-resultado">${popup._resultado_resumo || 'capturado'}</span>` : '';

        const isModoCapturando = popup.status === 'capturando';
        item.innerHTML = `
          <span class="popup-item-icone">${icone}</span>
          <span class="popup-item-texto" title="${popup.abridor_texto||''}">${popup.abridor_texto||'popup'}</span>
          ${resultadoHtml}
          <div class="popup-item-acoes">
            ${popup.status==='pendente'||isModoCapturando ? `
              <button class="btn-capturar" data-pag-idx="${idx}" data-pop-idx="${popIdx}" ${isModoCapturando?'disabled':''}>
                ${isModoCapturando?'<span class="spin">⬡</span>':''} Capturar
              </button>
              <button class="btn-check" data-pag-idx="${idx}" data-pop-idx="${popIdx}" style="display:${isModoCapturando?'inline-block':'none'}">
                ✓ Check
              </button>
              <button class="btn-pular" data-pag-idx="${idx}" data-pop-idx="${popIdx}" ${isModoCapturando?'disabled':''}>Pular</button>
            ` : ''}
          </div>
        `;
        checklist.appendChild(item);

        if(isModoCapturando) {
          const instrucao = document.createElement('div');
          instrucao.className = 'popup-instrucao';
          instrucao.innerHTML = `<strong>1.</strong> Clique no botão destacado na página &nbsp;→&nbsp; <strong>2.</strong> Aguarde o popup abrir &nbsp;→&nbsp; <strong>3.</strong> Clique <strong>✓ Check</strong> acima`;
          checklist.appendChild(instrucao);
        }
      });

      card.appendChild(checklist);
    }

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
    schema_version: '3.2',
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
      modais_popups: p.modais_popups,
      diagnostico: p.diagnostico,
      ajax_endpoints: p.ajax_endpoints,
      resumo: p.resumo,
      popups_pendentes:  p.popups_pendentes  || [],
      popups_capturados: p.popups_capturados || [],
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

    // ── Preencher popups_pendentes a partir de acoes_recomendadas ─────────────
    // acoes_recomendadas já tem os lazy popups identificados no mapeamento.
    // Transformamos em pendentes com status rastreável para o checklist da Fase 2.
    const acoesPendentes = dados.resumo?.acoes_recomendadas || [];
    dados.popups_pendentes = acoesPendentes.map((a, i) => ({
      id: `popup_lazy_${a.handler_backend || 'unknown'}${a.extra_data ? '_' + a.extra_data.replace(/[^a-z0-9]/gi,'_') : ''}_${i}`,
      handler_backend: a.handler_backend || '',
      extra_data: a.extra_data || '',
      abridor_texto: a.abridor_texto || '?',
      abridor_seletor: a.abridor_seletor || '',
      status: 'pendente',    // pendente | capturado | pulado
    }));
    dados.popups_capturados = [];

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

  // ── Calcular lacunas (popups ainda pendentes) ─────────────────────────────
  const lacunas = sessao.paginas.flatMap((p, i) =>
    (p.popups_pendentes || [])
      .filter(pp => pp.status === 'pendente')
      .map(pp => ({ pagina: i+1, descricao: p.meta?.descricao || `Página ${i+1}`, popup: pp.abridor_texto }))
  );

  if(lacunas.length > 0) {
    // Mostrar aviso de lacunas no container dedicado
    const container = $('lacunas-container');
    container.style.display = 'block';
    container.innerHTML = `
      <div class="lacunas-aviso">
        <div class="lacunas-aviso-titulo">⚠ ${lacunas.length} popup${lacunas.length>1?'s':''} não capturado${lacunas.length>1?'s':''}</div>
        <div class="lacunas-aviso-lista">${lacunas.map(l=>`Pág. ${l.pagina} — "${l.popup}"`).join('<br>')}</div>
        <div class="lacunas-aviso-acoes">
          <button class="btn-cancelar-lacunas" id="btn-cancelar-lacunas">Cancelar e capturar</button>
          <button class="btn-baixar-assim" id="btn-baixar-assim">Baixar assim mesmo</button>
        </div>
      </div>
    `;
    $('btn-cancelar-lacunas').onclick = () => { container.style.display='none'; container.innerHTML=''; };
    $('btn-baixar-assim').onclick = () => {
      container.style.display='none'; container.innerHTML='';
      _executarDownloadSessao(sessao, lacunas);
    };
    return;
  }

  _executarDownloadSessao(sessao, []);
});

function _executarDownloadSessao(sessao, lacunas) {
  const jsonObj = montarJsonSessao(sessao);
  // Adicionar campo validacao se houver lacunas
  if(lacunas.length > 0) {
    jsonObj.validacao = {
      popups_pendentes_total: lacunas.length,
      paginas_com_lacunas: lacunas,
    };
  }
  const json = JSON.stringify(jsonObj, null, 2);
  const url=URL.createObjectURL(new Blob([json],{type:'application/json'}));
  Object.assign(document.createElement('a'),{href:url,download:`${sessao.nome}_mapeamento_${sessao.paginas.length}paginas.json`}).click();
  URL.revokeObjectURL(url);
  setStatus('sessao-status',`✓ ${sessao.nome}_mapeamento_${sessao.paginas.length}paginas.json baixado`,'ok');
}

$('btn-copiar-json-sessao').addEventListener('click', async () => {
  const sessao=await storage.get();
  if(!sessao?.paginas?.length) return;
  const json=JSON.stringify(montarJsonSessao(sessao),null,2);
  try {
    await navigator.clipboard.writeText(json);
    const btn=$('btn-copiar-json-sessao');
    const original=btn.textContent;
    btn.textContent='✓ Copiado!';
    setTimeout(()=>{btn.textContent=original;},2000);
  } catch(_) {
    setStatus('sessao-status','Erro ao copiar: verifique permissões do clipboard','erro');
  }
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
// HANDLERS DO CHECKLIST DE POPUPS — event delegation na paginas-lista
// ─────────────────────────────────────────────────────────────────────────────
$('paginas-lista').addEventListener('click', async (e) => {
  // ── [Capturar] ─────────────────────────────────────────────────────────────
  const btnCapturar = e.target.closest('.btn-capturar');
  if(btnCapturar && !btnCapturar.disabled) {
    const pagIdx = parseInt(btnCapturar.dataset.pagIdx);
    const popIdx = parseInt(btnCapturar.dataset.popIdx);
    const sessao = await storage.get(); if(!sessao) return;
    const pag    = sessao.paginas[pagIdx]; if(!pag) return;
    const popup  = pag.popups_pendentes[popIdx]; if(!popup) return;

    // Marcar como "capturando" no storage e re-renderizar pra mostrar instrução
    popup.status = 'capturando';
    await storage.set(sessao);
    renderSessao(sessao);

    // Destacar o botão na página
    try {
      await destacarUmPopup(popup.abridor_seletor, popup.abridor_texto);
    } catch(err) {
      setStatus('sessao-status', `Erro ao destacar: ${err.message}`, 'erro');
      popup.status = 'pendente';
      await storage.set(sessao);
      renderSessao(sessao);
    }
    return;
  }

  // ── [✓ Check] ──────────────────────────────────────────────────────────────
  const btnCheck = e.target.closest('.btn-check');
  if(btnCheck && !btnCheck.disabled) {
    const pagIdx = parseInt(btnCheck.dataset.pagIdx);
    const popIdx = parseInt(btnCheck.dataset.popIdx);

    btnCheck.disabled = true;
    btnCheck.innerHTML = '<span class="spin">⬡</span>';

    try {
      // Rodar mapeamento completo na aba ativa (popup deve estar aberto)
      const { dados } = await executarScript({
        incluirHidden:true,
        incluirDisabled:false,
        incluirCookies:false,
        incluirAjax:false,    // ajax endpoints já foram capturados na página mãe
        waitSpaMs:0,
      });

      const sessao = await storage.get(); if(!sessao) return;
      const pag    = sessao.paginas[pagIdx]; if(!pag) return;
      const popup  = pag.popups_pendentes[popIdx]; if(!popup) return;

      // Resumo curto para exibir no item capturado
      const nCampos  = dados.formulario?.campos?.length || 0;
      const nBotoes  = dados.botoes_acao?.length || 0;
      popup._resultado_resumo = `${nCampos} campo${nCampos!==1?'s':''} · ${nBotoes} botão${nBotoes!==1?'ões':''}`;
      popup.status = 'capturado';

      // Salvar resultado completo em popups_capturados da página mãe
      pag.popups_capturados = pag.popups_capturados || [];
      pag.popups_capturados.push({
        pai_indice:    pagIdx + 1,
        pai_url:       pag.meta?.url || pag.url || '',
        popup_id:      popup.id,
        abridor_texto: popup.abridor_texto,
        abridor_seletor: popup.abridor_seletor,
        schema_version: '3.2',
        meta: {
          descricao:    `Popup: ${popup.abridor_texto}`,
          capturado_em: new Date().toISOString(),
        },
        // Dados completos do mapeamento
        tipo_pagina:  dados.tipo_pagina,
        frameworks:   dados.frameworks,
        grids:        dados.grids,
        formulario:   dados.formulario,
        botoes_acao:  dados.botoes_acao,
        modais_popups: dados.modais_popups,
        diagnostico:  dados.diagnostico,
        resumo:       dados.resumo,
      });

      sessao.ultima_atualizacao = new Date().toISOString();
      await storage.set(sessao);

      // Remover overlay da página
      await removerDestaqueNaPagina();

      renderSessao(sessao);
      setStatus('sessao-status',
        `✓ Popup "${popup.abridor_texto}" capturado — ${popup._resultado_resumo}`, 'ok');

    } catch(err) {
      // Em caso de erro, remover overlay e voltar pra pendente
      await removerDestaqueNaPagina().catch(()=>{});
      const sessao = await storage.get();
      if(sessao?.paginas?.[pagIdx]?.popups_pendentes?.[popIdx]) {
        sessao.paginas[pagIdx].popups_pendentes[popIdx].status = 'pendente';
        await storage.set(sessao);
        renderSessao(sessao);
      }
      setStatus('sessao-status', `Erro ao capturar popup: ${err.message}`, 'erro');
    }
    return;
  }

  // ── [Pular] ────────────────────────────────────────────────────────────────
  const btnPular = e.target.closest('.btn-pular');
  if(btnPular && !btnPular.disabled) {
    const pagIdx = parseInt(btnPular.dataset.pagIdx);
    const popIdx = parseInt(btnPular.dataset.popIdx);
    const sessao = await storage.get(); if(!sessao) return;
    const popup  = sessao.paginas[pagIdx]?.popups_pendentes?.[popIdx]; if(!popup) return;

    // Se estava capturando (overlay ativo), remover antes de pular
    if(popup.status === 'capturando') {
      await removerDestaqueNaPagina().catch(()=>{});
    }

    popup.status = 'pulado';
    sessao.ultima_atualizacao = new Date().toISOString();
    await storage.set(sessao);
    renderSessao(sessao);
  }
});
