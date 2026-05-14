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
    // v1.6.0 — Feature B2: enriquecer seletor com escopo SFC quando classe
    // pura não é única. Evita classes de widget (vs-, vs__, el-, select2-)
    // como classe principal — são compartilhadas por dezenas de instâncias.
    const tag = el.tagName.toLowerCase();
    const classesRaw = (typeof el.className === 'string')
      ? el.className.trim().split(/\s+/).filter(Boolean)
      : [];
    const classePrincipal = classesRaw.find(c =>
      !c.startsWith('vs-') && !c.startsWith('vs__') &&
      !c.startsWith('el-') && !c.startsWith('select2-') &&
      !c.startsWith('multiselect__')
    ) || classesRaw[0];
    if(!classePrincipal) return tag;

    const seletorBase = `${tag}.${classePrincipal}`;
    let matches = 1;
    try { matches = document.querySelectorAll(seletorBase).length; } catch(_){}
    if(matches <= 1) return seletorBase;

    // Enriquecer com data-v-XXX se houver e tornar o seletor mais específico
    const dataV = el.getAttributeNames().find(a => /^data-v-[a-f0-9]{6,12}$/.test(a));
    if(dataV) {
      const cand = `${tag}.${classePrincipal}[${dataV}]`;
      try {
        const m = document.querySelectorAll(cand).length;
        if(m >= 1 && m <= 3) return cand;
      } catch(_){}
    }
    return seletorBase;
  }

  // v1.6.0 — Feature B4 helper: seletor alternativo que IGNORA o id, útil
  // para elementos com id duplicado (Vue SFC produz isso quando reutiliza
  // componentes). Tenta primeiro tag.classe[data-v-XXX], depois tag.classe.
  function montarSeletorAlternativo(el) {
    const tag = el.tagName.toLowerCase();
    const classesRaw = (typeof el.className === 'string')
      ? el.className.trim().split(/\s+/).filter(Boolean)
      : [];
    const classePrincipal = classesRaw.find(c =>
      !c.startsWith('vs-') && !c.startsWith('vs__') &&
      !c.startsWith('el-') && !c.startsWith('select2-') &&
      !c.startsWith('multiselect__')
    ) || classesRaw[0] || null;
    const dataV = el.getAttributeNames().find(a => /^data-v-[a-f0-9]{6,12}$/.test(a));
    if(classePrincipal && dataV) return `${tag}.${classePrincipal}[${dataV}]`;
    if(classePrincipal)          return `${tag}.${classePrincipal}`;
    return tag;
  }

  // v1.6.0 — Feature B7 helper: detecta inputs que são parte de widgets
  // pseudo-select (Vue/Element/Select2). Esses inputs não aceitam .fill()
  // direto — precisam de .click() no container e .click() na opção do dropdown.
  const INTERACAO_POR_WIDGET = {
    'vue-select':       'page.locator(SELETOR).click(); page.locator(".vs__dropdown-menu li").filter(has_text="VALOR").click()',
    'element-ui-select':'page.locator(SELETOR).click(); page.locator(".el-select-dropdown__item").filter(has_text="VALOR").click()',
    'element-ui-input': 'page.locator(SELETOR).fill("VALOR")',
    'select2':          'page.locator(SELETOR).click(); page.locator(".select2-results__option").filter(has_text="VALOR").click()',
    'vue-multiselect':  'page.locator(SELETOR).click(); page.locator(".multiselect__option span").filter(has_text="VALOR").click()',
  };
  function detectarWidgetPseudoSelect(el) {
    const c = el.classList;
    if(c.contains('vs__search'))            return 'vue-select';
    if(c.contains('el-select__input'))      return 'element-ui-select';
    if(c.contains('el-input__inner'))       return 'element-ui-input';
    if(c.contains('select2-search__field')) return 'select2';
    if(c.contains('multiselect__input'))    return 'vue-multiselect';
    return null;
  }

  // v1.6.1 — Feature D9.1: detectar autocomplete server-side via ≥2 sinais
  // estruturais (sem palavras-chave de domínio). Casos cobertos: Select2 AJAX,
  // Twitter Typeahead, ARIA combobox com aria-autocomplete=list.
  // Sinais:
  //   A. classe search-field reconhecida OU role=combobox + aria-autocomplete=list
  //   B. placeholder contém padrão "N caractere(s)" (regex)
  //   C. <select> irmão/anterior está vazio (≤1 opção) OU tem data-ajax-url/data-source
  function detectarAutocompleteRemoto(el) {
    const sinais = { a: false, b: false, c: false };
    const classes = (typeof el.className === 'string' ? el.className : (el.getAttribute('class')||''));
    if(
      /\bselect2-search__field\b/.test(classes) ||
      /\btt-input\b/.test(classes) ||
      (el.getAttribute('role') === 'combobox' &&
       (el.getAttribute('aria-autocomplete') || '').toLowerCase() === 'list')
    ) {
      sinais.a = true;
    }
    const ph = el.getAttribute('placeholder') || '';
    let minCaracteres = null;
    const matchPh = ph.match(/(\d+)\s*caractere/i) || ph.match(/at\s*least\s*(\d+)\s*char/i);
    if(matchPh) { sinais.b = true; minCaracteres = parseInt(matchPh[1], 10); }

    const containerSel2 = el.closest('.select2-container') ||
                          el.closest('[class*="select2"]') ||
                          el.closest('[class*="autocomplete"]');
    if(containerSel2) {
      let selOriginal = containerSel2.previousElementSibling;
      // O original às vezes é avô do container — varrer alguns parentes
      let scope = containerSel2.parentElement;
      for(let i = 0; i < 3 && (!selOriginal || selOriginal.tagName !== 'SELECT'); i++) {
        if(!scope) break;
        selOriginal = scope.querySelector('select');
        scope = scope.parentElement;
      }
      if(selOriginal && selOriginal.tagName === 'SELECT') {
        if(selOriginal.options.length <= 1) sinais.c = true;
        if(selOriginal.hasAttribute('data-ajax--url')) sinais.c = true;
        if(selOriginal.hasAttribute('data-ajax-url'))  sinais.c = true;
        if(selOriginal.hasAttribute('data-source'))    sinais.c = true;
      }
    }

    const total = (sinais.a?1:0) + (sinais.b?1:0) + (sinais.c?1:0);
    if(total < 2) return { detectado: false };
    return { detectado: true, sinais, min_caracteres: minCaracteres };
  }

  // v1.6.1 — Feature D9.2: descobrir endpoints irmãos NO DOM (estrutural).
  // Não inventa nomes — só usa URLs que JÁ estão no DOM (em <script>,
  // atributos data-*, href, action) e compartilham path-prefix com o endpoint
  // capturado. Retorna lista de URLs candidatas (vazia se nada bater).
  function descobrirEndpointsIrmaos(endpointBase) {
    if(!endpointBase) return [];
    let urlObj;
    try { urlObj = new URL(endpointBase, location.href); } catch(_) { return []; }
    const path = urlObj.pathname;
    const partes = path.split('/').filter(Boolean);
    if(partes.length === 0) return [];
    // path-base = tudo menos a última parte. Ex: /Art/Obter... → /Art/
    const pathBase = '/' + partes.slice(0, -1).join('/') + '/';
    if(pathBase === '/' || pathBase.length < 4) return []; // genérico demais

    const candidatas = new Set();
    const rxPath = new RegExp(`["'\\\`]([^"'\\\`]*${pathBase.replace(/\//g,'\\/').replace(/\./g,'\\.')}[^"'\\\`\\s]*)["'\\\`]`, 'g');
    // 1. <script> tags
    document.querySelectorAll('script').forEach(s => {
      const txt = s.textContent || '';
      let m;
      while((m = rxPath.exec(txt)) !== null) {
        candidatas.add(m[1]);
        if(candidatas.size > 30) break;
      }
    });
    // 2. atributos data-* que parecem URL
    document.querySelectorAll('[data-url],[data-source],[data-ajax],[data-ajax--url],[data-ajax-url]').forEach(el => {
      for(const a of ['data-url','data-source','data-ajax','data-ajax--url','data-ajax-url']) {
        const v = el.getAttribute(a);
        if(v && v.includes(pathBase)) candidatas.add(v);
      }
    });
    candidatas.delete(endpointBase);
    return Array.from(candidatas).slice(0, 20);
  }

  // v1.6.1 — Feature D1: desambiguar seletor de botão/link/submit usando
  // :has-text() quando o texto do elemento é único entre os matches do seletor.
  // Resolve casos como "Próximo" no CREA-MT (button.btn com 4 matches mas
  // só um deles tem o texto exato "Próximo"). Estritamente estrutural —
  // o texto vem do innerText do próprio elemento, não de lista hardcoded.
  function tentarDesambiguarPorTexto(seletorBase, elemento, todosMatches) {
    if(!Array.isArray(todosMatches) || todosMatches.length <= 1) return null;
    if(todosMatches.length > 50) return null; // amostragem cara — desistir
    const texto = (elemento.textContent || elemento.value || '').trim();
    if(!texto || texto.length < 2 || texto.length > 60) return null;
    // Escape de aspas duplas para Playwright
    const textoEscapado = texto.replace(/"/g, '\\"');
    const mesmoTexto = todosMatches.filter(el =>
      (el.textContent || el.value || '').trim() === texto
    );
    if(mesmoTexto.length === 1) {
      return { seletor: `${seletorBase}:has-text("${textoEscapado}")`, matches: 1, residuais: 0 };
    }
    if(mesmoTexto.length <= 3 && mesmoTexto.length < todosMatches.length) {
      return {
        seletor: `${seletorBase}:has-text("${textoEscapado}") /* ⚠ ${mesmoTexto.length} matches (era ${todosMatches.length}) */`,
        matches: mesmoTexto.length,
        residuais: mesmoTexto.length,
      };
    }
    return null;
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

  // v1.6.0 — Feature B1: Detecção robusta de Vue (incluindo Vue 3 SFC compilado).
  // O detector v1.5.0 ignorava Vue 3 em produção quando o build não expõe
  // window.Vue nem deixa [data-v-app]. Componentes SFC compilados deixam
  // atributos data-v-XXXXXX (scoped CSS) que servem de fingerprint estrutural.
  const detectarVue = (() => {
    if(W.Vue?.version)                return { vue: true, vue_evidencia: 'window.Vue' };
    if(W.__VUE__?.$root)              return { vue: true, vue_evidencia: 'window.__VUE__' };
    if(W.__vue_app__)                 return { vue: true, vue_evidencia: 'window.__vue_app__' };
    if(document.__vue_app__)          return { vue: true, vue_evidencia: 'document.__vue_app__' };
    if(document.querySelector('[data-v-app],[data-server-rendered]')) {
      return { vue: true, vue_evidencia: '[data-v-app]' };
    }
    const hook = W.__VUE_DEVTOOLS_GLOBAL_HOOK__;
    if(hook?.apps?.length > 0)        return { vue: true, vue_evidencia: 'devtools_hook' };

    // Fingerprint SFC: amostra de até 100 elementos, busca padrão data-v-[a-f0-9]{6,12}
    const RX_DATA_V = /^data-v-[a-f0-9]{6,12}$/;
    const amostra = document.querySelectorAll('div, span, button, input, form, section, article, table');
    const limite = Math.min(100, amostra.length);
    for(let i = 0; i < limite; i++) {
      const attrs = amostra[i].getAttributeNames();
      for(const a of attrs) {
        if(RX_DATA_V.test(a)) return { vue: true, vue_evidencia: 'data-v-XXX fingerprint' };
      }
    }
    return { vue: false, vue_evidencia: null };
  })();

  const spa = {
    // React: exige React.version (objeto real), [data-reactroot] no DOM,
    // [data-react-helmet], OU container interno do React no body.
    react: !!(W.React?.version || document.querySelector('[data-reactroot],[data-react-helmet]') || hasReactContainer),
    // Next.js: __NEXT_DATA__ é injetado pelo Next no SSR; <div id="__next"> idem.
    next:  !!(W.__NEXT_DATA__ || document.getElementById('__next')),
    // Vue: v1.6.0 Feature B1 — detector múltiplo com fingerprint SFC.
    vue:           detectarVue.vue,
    vue_evidencia: detectarVue.vue_evidencia,
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
  const spaDetectado = Object.entries(spa).filter(([k,v])=>v===true).map(([k])=>k);
  // Promover detecção mais confiável: se achou via window, garante presença na lista
  if(spa.react   && !frameworks.includes('React'))   frameworks.push('React');
  if(spa.vue     && !frameworks.includes('Vue.js')) frameworks.push('Vue.js');
  if(spa.angular && !frameworks.includes('Angular')) frameworks.push('Angular');
  if(spa.next    && !frameworks.includes('Next.js')) frameworks.push('Next.js');
  if(spa.nuxt    && !frameworks.includes('Nuxt'))    frameworks.push('Nuxt');
  if(spa.svelte  && !frameworks.includes('Svelte'))  frameworks.push('Svelte');

  // ── 1c. Mapa de abas (tab attribution) ─────────────────────────────────────
  // v1.4.0 — Fase 2: descobre painéis de aba (tab panels) e seus rótulos, e
  // depois cada elemento mapeado (campo, grid, botão, modal) recebe aba_origem
  // descobrindo qual painel o contém. Estritamente estrutural — suporta
  // Bootstrap 4, Bootstrap 5, generic [role=tab][aria-controls], UIkit switcher,
  // Semantic UI (via data-tab). Sem dependência de texto ou nome de sistema.
  // v1.5.0 — Feature 3: limpa contadores de badge ao final do texto da aba.
  // Tabs com notificação tipo "PROCESSOS COMIGO\n2" eram capturadas inteiras.
  const mapaAbas = {};   // { painelId → rotuloDaAba }

  function limparTextoAba(texto) {
    return (texto || '')
      .trim()
      .replace(/\s*\n\s*\d+\s*$/, '')  // remove "\n2", "\n  15", etc no final
      .replace(/\s+\d+$/, '')           // remove " 2", " 15" no final
      .trim();
  }

  // Bootstrap 4: data-target="#id"
  document.querySelectorAll('[data-target]').forEach(tab => {
    const raw = (tab.getAttribute('data-target') || '').trim();
    if(!raw.startsWith('#')) return;
    const targetId = raw.slice(1);
    const texto = limparTextoAba(tab.innerText || tab.textContent || '');
    if(targetId && texto) mapaAbas[targetId] = texto.substring(0,80);
  });
  // Bootstrap 5: data-bs-target="#id"
  document.querySelectorAll('[data-bs-target]').forEach(tab => {
    const raw = (tab.getAttribute('data-bs-target') || '').trim();
    if(!raw.startsWith('#')) return;
    const targetId = raw.slice(1);
    const texto = limparTextoAba(tab.innerText || tab.textContent || '');
    if(targetId && texto) mapaAbas[targetId] = texto.substring(0,80);
  });
  // Generic ARIA: role="tab" + aria-controls
  document.querySelectorAll('[role="tab"][aria-controls]').forEach(tab => {
    const targetId = tab.getAttribute('aria-controls');
    const texto = limparTextoAba(tab.innerText || tab.textContent || '');
    if(targetId && texto) mapaAbas[targetId] = texto.substring(0,80);
  });
  // Semantic UI: a.item[data-tab] aponta para .tab[data-tab="id"]
  document.querySelectorAll('a.item[data-tab], .menu .item[data-tab]').forEach(tab => {
    const tabId = tab.getAttribute('data-tab');
    if(!tabId) return;
    const painel = document.querySelector(`.tab[data-tab="${tabId}"], [data-tab="${tabId}"]:not(.item)`);
    if(painel) {
      if(!painel.id) painel.id = `vfm-sui-tab-${tabId}`;
      const texto = limparTextoAba(tab.innerText || tab.textContent || '');
      if(texto) mapaAbas[painel.id] = texto.substring(0,80);
    }
  });
  // UIkit: ul.uk-tab li > a → painéis em .uk-switcher por índice
  const ukTabs = document.querySelectorAll('ul.uk-tab > li > a, [uk-tab] > li > a');
  if(ukTabs.length) {
    const ukPaineis = document.querySelectorAll('.uk-switcher > *, [uk-switcher] > *');
    ukTabs.forEach((tab, i) => {
      const painel = ukPaineis[i];
      if(!painel) return;
      if(!painel.id) painel.id = `vfm-uk-switcher-${i}`;
      const texto = limparTextoAba(tab.innerText || tab.textContent || '');
      if(texto) mapaAbas[painel.id] = texto.substring(0,80);
    });
  }

  // Resolve a aba que contém um elemento subindo a árvore DOM até achar
  // um ancestral cujo id esteja em mapaAbas. Retorna null se não houver.
  function getAbaOrigem(el) {
    if(!el || !mapaAbas) return null;
    let cursor = el;
    while(cursor && cursor !== document.body) {
      if(cursor.id && mapaAbas[cursor.id]) return mapaAbas[cursor.id];
      cursor = cursor.parentElement;
    }
    return null;
  }

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
      aba_origem: getAbaOrigem(table),
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
        proxima_pagina: paginate ? `page.locator("a.paginate_button.next").click()\npage.wait_for_timeout(1500)` : null,
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
        aba_origem: getAbaOrigem(table),
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

    // v1.4.0 — Fase 4: tentar extrair campo de ID da linha via API JS interna
    // do AG Grid e por atributo DOM. Estritamente estrutural.
    let campoIdLinha = null;
    let exemploIdLinha = null;
    const RX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const RX_ID   = /^(id|uuid|pid|_id|process_id|codigo|key|guid|row_id)$/i;
    try {
      const agApi =
        agRoot.__agComponent?.gridOptionsService?.gridOptions?.api ||
        agRoot.__agComponent?.gridOptions?.api ||
        agRoot.__agBean?.gridOptionsService?.gridOptions?.api;
      if(agApi) {
        const primeiroNode = agApi.getDisplayedRowAtIndex?.(0);
        const data = primeiroNode?.data;
        if(data && typeof data === 'object') {
          const chaves = Object.keys(data);
          const cNome = chaves.find(k => RX_ID.test(k));
          const cValor = chaves.find(k => RX_UUID.test(String(data[k] || '')));
          campoIdLinha = cNome || cValor || null;
          if(campoIdLinha) exemploIdLinha = String(data[campoIdLinha]).substring(0,60);
        }
      }
    } catch(_) {}
    // Fallback: atributo DOM da primeira linha (row-id, data-id, etc.)
    if(!campoIdLinha) {
      const primeiraLinhaEl = agRoot.querySelector('div.ag-row');
      if(primeiraLinhaEl) {
        const attrs = primeiraLinhaEl.getAttributeNames();
        const attrId = attrs.find(a => /^(row-id|data-(id|pid|uuid|key|row-id))$/i.test(a));
        if(attrId) {
          campoIdLinha = attrId;
          exemploIdLinha = primeiraLinhaEl.getAttribute(attrId);
        }
      }
    }

    grids.push({
      tipo: 'ag-grid',
      tema: agRoot.className.match(/ag-theme-\w+/)?.[0] || '',
      colunas: cols,
      total_linhas_visiveis: rows.length,
      seletor_linha: 'div.ag-row',
      aba_origem: getAbaOrigem(agRoot),
      campo_id_linha: campoIdLinha,
      exemplo_id: exemploIdLinha,
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
        obter_id_linha: campoIdLinha
          ? `# acesso via API JS: agApi.getDisplayedRowAtIndex(i).data['${campoIdLinha}']  ou  linha.get_attribute('${campoIdLinha}')`
          : '# campo de ID não detectado — inspecionar AG Grid via __agComponent.gridOptions.api',
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

    // v1.4.0/v1.4.6/v1.5.0/v1.6.1 — Fase 4: extrair campo de ID da linha.
    // Tabulator guarda o registro completo no modelo JS interno — DOM só mostra
    // colunas visíveis. Sem o ID, scripts Playwright não conseguem construir
    // URLs de detalhe.
    //
    // v1.5.0: suporte explícito a v4 (Tabulator.findTable) e v5 (.table no
    //         `_tabulator`/`tabulator`/`__tabulator`).
    // v1.6.1 D3: ampliada heurística de fallback (id, ID, Id, _id, codigo, key,
    //            pk) + fallback "primeiro campo numérico ou uuid-like" + código
    //            Playwright dinâmico via dataset.row.
    let campoIdLinha = null;
    let exemploIdLinha = null;
    let urlDetalheInferida = null;
    const RX_UUID_T = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const RX_ID_T   = /^(id|ID|Id|uuid|UUID|pid|_id|process_id|processId|codigo|c[oó]digo|key|guid|row_id|rowId|pk)$/i;
    const RX_NUM_OR_UUID = /^([0-9]+|[0-9a-f-]{8,})$/i;
    try {
      // Resolver instância do Tabulator (v4 + v5 + variantes)
      let tabApi = null;
      if(typeof W.Tabulator?.findTable === 'function') {
        try { tabApi = W.Tabulator.findTable(tab)?.[0] || null; } catch(_){}
      }
      if(!tabApi) tabApi = tab._tabulator || tab.tabulator || tab.__tabulator || null;

      if(tabApi && (typeof tabApi.getData === 'function' || tabApi.options?.data)) {
        const dados = (typeof tabApi.getData === 'function') ? tabApi.getData() : tabApi.options?.data;
        const primeiro = Array.isArray(dados) ? dados[0] : null;
        if(primeiro && typeof primeiro === 'object') {
          const chaves = Object.keys(primeiro);
          // 1) campo cujo NOME bate com regex de ID
          const cNome  = chaves.find(k => RX_ID_T.test(k));
          // 2) campo cujo VALOR é um UUID válido
          const cValor = chaves.find(k => RX_UUID_T.test(String(primeiro[k] || '')));
          // 3) v1.6.1 D3: fallback — primeiro campo cujo valor é numérico puro
          // ou uuid-like (8+ chars hex/dash). Ordem de preferência: nome → uuid → numérico.
          const cNum = chaves.find(k => {
            const v = primeiro[k];
            if(typeof v === 'number') return true;
            if(typeof v === 'string' && RX_NUM_OR_UUID.test(v) && v.length >= 4) return true;
            return false;
          });
          campoIdLinha = cNome || cValor || cNum || null;
          if(campoIdLinha) exemploIdLinha = String(primeiro[campoIdLinha]).substring(0,60);
        }
      }
    } catch(_) {}
    // Fallback: atributo DOM da primeira linha
    if(!campoIdLinha) {
      const primeiraLinhaEl = tab.querySelector('div.tabulator-row');
      if(primeiraLinhaEl) {
        const attrs = primeiraLinhaEl.getAttributeNames();
        const attrId = attrs.find(a => /^data-(id|pid|uuid|key|row-id)$/i.test(a));
        if(attrId) {
          campoIdLinha = attrId;
          exemploIdLinha = primeiraLinhaEl.getAttribute(attrId);
        }
      }
    }
    // Inferir URL de detalhe a partir de link em botão de ação na linha.
    // Procuramos um <a href=...> dentro da primeira linha cujo href contenha o
    // exemplo de id; substituímos por placeholder {campo}.
    if(exemploIdLinha) {
      const linhaEl = tab.querySelector('div.tabulator-row');
      if(linhaEl) {
        const link = linhaEl.querySelector(`a[href*="${exemploIdLinha}"]`);
        if(link) {
          const href = link.getAttribute('href') || '';
          urlDetalheInferida = href.replace(exemploIdLinha, `{${campoIdLinha || 'id'}}`);
        }
      }
    }

    grids.push({
      tipo: 'tabulator',
      colunas: cols,
      total_linhas_visiveis: rows.length,
      seletor_linha: 'div.tabulator-row',
      aba_origem: getAbaOrigem(tab),
      campo_id_linha: campoIdLinha,
      exemplo_id: exemploIdLinha,
      url_detalhe_inferida: urlDetalheInferida,
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
        obter_id_linha: campoIdLinha
          ? `# v1.6.1 D3 — executável sem inspeção manual. Usa dataset.row do DOM\n# para indexar a estrutura interna do Tabulator (v4 ou v5).\nid_linha = linha.evaluate("el => { const t = document.querySelector('div.tabulator')._tabulator || (window.Tabulator && Tabulator.findTable(document.querySelector('div.tabulator'))?.[0]); return t?.getData?.()?.[Number(el.dataset.row || 0)]?.${campoIdLinha} ?? null; }")`
          : '# campo de ID não detectado — inspecionar via console: document.querySelector("div.tabulator")._tabulator?.getData()[0]  (v5)  ou  Tabulator.findTable(...)[0].getData()[0]  (v4)',
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
      aba_origem: getAbaOrigem(kGrid),
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
      aba_origem: getAbaOrigem(hot),
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

    // v1.4.0 — Fase 1: 3 tentativas de fallback para headers em tabelas sem <thead>.
    // Sistemas legados, OctoberCMS e Laravel sem scaffolding frequentemente geram
    // <table> sem <thead> — sem essa lógica, colunas saía [] e o script Playwright
    // ficava inútil. fonte_header registra a procedência para rastreabilidade.
    let headers = [];
    let fonteHeader = null;

    // v1.6.0 — Feature B5 helper: header com >=3 colunas de texto idêntico
    // é falso (linha de dados disfarçada de cabeçalho). Caso observado:
    // grids do tipo permissão/checklist em que toda coluna é "NÃO" / "SIM".
    function headerTemTextoRepetido(celulas) {
      const textos = celulas.map(c => (c.innerText||'').trim()).filter(Boolean);
      if(textos.length < 3) return false;
      const freq = {};
      textos.forEach(t => { freq[t] = (freq[t] || 0) + 1; });
      return Math.max(...Object.values(freq)) >= 3;
    }

    // Tentativa 1: <thead> com <th> ou <td> (caminho ideal)
    headers = Array.from(table.querySelectorAll('thead th, thead td')).map((th,i) => ({
      indice: i+1,
      nome: th.innerText.trim().replace(/\s+/g,' '),
      seletor_celula: `${tableId} tbody tr td:nth-child(${i+1})`,
    })).filter(h=>h.nome);
    if(headers.length) fonteHeader = 'thead';

    // Tentativa 2: primeira <tr> da tabela tem <th> (sem thead, mas com semântica)
    if(!headers.length) {
      const primeiraLinha = table.querySelector('tr');
      const ths = primeiraLinha ? Array.from(primeiraLinha.querySelectorAll('th')) : [];
      // v1.6.0 — Feature B5: descartar se >=3 ths têm texto idêntico
      if(ths.length && !headerTemTextoRepetido(ths)) {
        headers = ths.map((th,i) => ({
          indice: i+1,
          nome: th.innerText.trim().replace(/\s+/g,' '),
          seletor_celula: `${tableId} tbody tr td:nth-child(${i+1})`,
        })).filter(h => h.nome);
        if(headers.length) fonteHeader = 'th_primeira_linha';
      }
    }

    // Tentativa 3: primeira <tr> só tem <td> — tratar como header inferido
    // (tabela totalmente sem marcação semântica). Pulamos a primeira tr do tbody
    // no seletor de célula porque ela vira o header.
    if(!headers.length) {
      const primeiraLinha = table.querySelector('tr');
      const tds = primeiraLinha ? Array.from(primeiraLinha.querySelectorAll('td')) : [];
      // v1.4.4 — Guard absoluto: se QUALQUER célula da primeira linha for
      // puramente numérica, a linha inteira é linha de dados, não header.
      // Headers reais nunca têm número solto como nome de coluna.
      //
      // Histórico:
      //  - v1.4.1 usava `every` (TODAS) — falhava em [valor, "3"] (metade)
      //  - v1.4.2 usava `> tds.length/2` — falhava em 2 cols (1 > 1 é false)
      //  - v1.4.4 usa `some` (QUALQUER UMA) — regra absoluta, sem fronteira numérica
      //
      // Trade-off conhecido: em tabelas comparativas anuais legítimas (ex:
      // colunas "Item", "2024", "2025"), a Tentativa 3 vai retornar []. Isso
      // é OK — header com ano puro é raro e produzir `colunas: []` é melhor
      // que produzir nomes errados que confundem a IA downstream.
      const temCelulaNumericaPura = tds.some(td => {
        const txt = (td.innerText || '').trim();
        return /^\d+([.,]\d+)?$/.test(txt);
      });
      // v1.6.0 — Feature B5: também descartar se >=3 tds têm texto idêntico
      const textoRepetido = headerTemTextoRepetido(tds);
      if(tds.length && !temCelulaNumericaPura && !textoRepetido) {
        headers = tds.map((td,i) => ({
          indice: i+1,
          nome: td.innerText.trim().replace(/\s+/g,' ') || `col_${i+1}`,
          seletor_celula: `${tableId} tbody tr:nth-child(n+2) td:nth-child(${i+1})`,
        })).filter(h => h.nome);
        if(headers.length) fonteHeader = 'td_primeira_linha';
      }
    }

    // Anotar fonte_header em cada coluna pra a IA saber se o nome é confiável
    if(fonteHeader) headers.forEach(h => { h.fonte_header = fonteHeader; });

    // Enriquecer com valor_exemplo da primeira linha de dados.
    // Se headers vieram de td_primeira_linha, pula a 1ª <tr> do tbody.
    const linhaExemplo = fonteHeader === 'td_primeira_linha'
      ? tbody.querySelector('tr:nth-child(n+2)')
      : tbody.querySelector('tr');
    if(linhaExemplo) {
      headers = headers.map(h => ({
        ...h,
        valor_exemplo: linhaExemplo.querySelector(`td:nth-child(${h.indice})`)?.innerText?.trim()?.substring(0,80) || '',
      }));
    }

    const rows = tbody.querySelectorAll('tr');
    const colCode = headers.slice(0,6).map(h =>
      `    ${h.nome.toLowerCase().replace(/\s+/g,'_')||'col'+h.indice} = linha.locator('td:nth-child(${h.indice})').inner_text().strip()`
    ).join('\n') || '    # extrair colunas por índice';

    grids.push({
      tipo: 'html_table',
      id_elemento: table.id||'',
      seletor_tabela: tableId,
      colunas: headers,
      fonte_header: fonteHeader,                      // 'thead' | 'th_primeira_linha' | 'td_primeira_linha' | null
      total_linhas_visiveis: rows.length,
      seletor_linha: `${tableId} tbody tr`,
      paginacao: { detectada: false },
      aba_origem: getAbaOrigem(table),                // preenchido pela fase 2
      playwright: {
        iterar_linhas: `linhas = page.locator("${tableId} tbody tr")\nfor i in range(linhas.count()):\n    linha = linhas.nth(i)\n${colCode}`,
      },
    });
  });

  // ── 2g. Feed / timeline detector ───────────────────────────────────────────
  // v1.4.0 — Fase 3: Conteúdo em divs irmãos repetidos com padrão
  // autor + data + texto + anexos passa invisível pros detectores de tabela.
  // Esse bloco encontra grupos homogêneos de 3+ siblings cujo conteúdo casa
  // com a heurística "tem data E tem texto longo", e mapeia seletores internos
  // de cada componente. Estritamente estrutural: não menciona nome de sistema.
  //
  // v1.6.1 — Feature D2: feed guard. Coletar seletores estruturalmente
  // "ocupados" por grids (Tabulator, AG Grid, etc.) e descartar candidatos
  // a feed cujo container/seletor já tenha sido capturado como linha de grid.
  // Evita o falso positivo de `.tabulator-row` virar feed.
  const _feedGridSeletoresOcupados = new Set();
  grids.forEach(g => {
    if(g.seletor_linha) {
      _feedGridSeletoresOcupados.add(g.seletor_linha);
      // Normalizar removendo tag prefix: 'div.tabulator-row' → '.tabulator-row'
      _feedGridSeletoresOcupados.add(g.seletor_linha.replace(/^[a-z]+(?=[.\[#])/i, ''));
    }
    if(g.seletor_tabela) {
      _feedGridSeletoresOcupados.add(g.seletor_tabela);
      _feedGridSeletoresOcupados.add(g.seletor_tabela.replace(/^[a-z]+(?=[.\[#])/i, ''));
    }
  });
  // Helper: dado o `pai` e a `classeAlvo` dos filhos, retorna o seletor
  // que seria registrado como `seletor_item` do feed, para comparar com grids.
  function _feedSeletorAlvo(tagAlvo, classeAlvo) {
    return `${tagAlvo.toLowerCase()}.${classeAlvo}`;
  }

  const RX_DATA_HORA = /\b\d{2}\/\d{2}\/\d{4}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{2}:\d{2}\b|\b(segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo)|\b(janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/i;
  const feedsDetectados = [];
  const paisFeedVistos = new WeakSet();

  // Escolher candidatos plausíveis: containers com 3+ filhos do mesmo tipo.
  // Evita document.body e document.documentElement pra não rodar a busca em
  // árvores genéricas. Limitamos a 500 nós inspecionados por questão de perf.
  const candidatosFeed = document.querySelectorAll(
    'div, section, ul, ol, article, aside, main'
  );
  let inspecionados = 0;
  for(const pai of candidatosFeed) {
    if(++inspecionados > 800) break;
    if(paisFeedVistos.has(pai)) continue;
    // pular containers que claramente são grids/forms/modais
    if(pai.closest('table, .modal, [role="dialog"], form')) continue;
    const filhos = Array.from(pai.children);
    if(filhos.length < 3) continue;
    const primeiro = filhos[0];
    if(!(primeiro instanceof Element)) continue;
    const tagAlvo = primeiro.tagName;
    const classeAlvo = (primeiro.classList && primeiro.classList[0]) || '';
    if(!classeAlvo) continue;                                  // sem classe é genérico demais
    // v1.6.1 D2: descartar se classe-alvo já foi capturada como linha de grid
    const seletorAlvo = _feedSeletorAlvo(tagAlvo, classeAlvo);
    if(_feedGridSeletoresOcupados.has(seletorAlvo) ||
       _feedGridSeletoresOcupados.has(`.${classeAlvo}`)) continue;
    // Filhos homogêneos: mesmo tag + mesma 1ª classe
    const grupo = filhos.filter(f =>
      f instanceof Element && f.tagName === tagAlvo && f.classList.contains(classeAlvo)
    );
    if(grupo.length < 3) continue;
    // Padrão de feed: tem data E texto longo na amostra
    const sample = grupo[0];
    const textoSample = (sample.innerText || sample.textContent || '');
    if(textoSample.length <= 30) continue;
    if(!RX_DATA_HORA.test(textoSample)) continue;

    // Heurísticas para seletores internos — testam o que existe na amostra
    function escolherSeletorInterno(el, seletoresTentativa) {
      for(const sel of seletoresTentativa) {
        try { if(el.querySelector(sel)) return sel; } catch(_){}
      }
      return null;
    }
    const seletorItem = `.${classeAlvo}`;
    const seletorAutor = escolherSeletorInterno(sample, [
      '[class*="autor"]','[class*="author"]','[class*="user"]','[class*="name"]',
      '[class*="nome"]','[class*="remetente"]','[class*="sender"]','[class*="from"]',
      'strong','b','h4','h5','h6','a','span'
    ]);
    const seletorData  = escolherSeletorInterno(sample, [
      'time','[datetime]','[class*="data"]','[class*="date"]','[class*="time"]','small'
    ]);
    const seletorTexto = escolherSeletorInterno(sample, [
      '[class*="texto"]','[class*="body"]','[class*="content"]','[class*="mensagem"]','[class*="message"]',
      'p'
    ]);
    const seletorAnexos = escolherSeletorInterno(sample, [
      'a[href*=".pdf"]','a[download]','a[href*="/files/"]','a[href*="/file/"]','a[href*="/upload"]',
      'a.btn[href]'
    ]);
    const nAnexosSample = seletorAnexos
      ? sample.querySelectorAll(seletorAnexos).length : 0;

    // Seletor do container: prefere id, depois 1ª classe, depois tag
    let seletorContainer;
    if(pai.id) seletorContainer = `#${pai.id}`;
    else if(pai.classList[0]) seletorContainer = `${pai.tagName.toLowerCase()}.${pai.classList[0]}`;
    else seletorContainer = pai.tagName.toLowerCase();

    const playwrightSnippet = [
      `itens = page.locator("${seletorItem}")`,
      `for i in range(itens.count()):`,
      `    item = itens.nth(i)`,
      seletorAutor  ? `    autor  = item.locator("${seletorAutor}").inner_text().strip()`  : null,
      seletorData   ? `    data   = item.locator("${seletorData}").inner_text().strip()`   : null,
      seletorTexto  ? `    texto  = item.locator("${seletorTexto}").inner_text().strip()`  : null,
      seletorAnexos ? `    anexos = item.locator("${seletorAnexos}").all()`                : null,
    ].filter(Boolean).join('\n');

    // v1.6.1 — Feature D2: guard final. Se nenhum dos sinais estruturais
    // (autor/data/texto/anexos) foi detectado nos seletores internos, o
    // candidato é provavelmente um grid/lista genérica sem padrão de timeline.
    // Casos: `.tabulator-row` (já filtrado acima por overlap de grid), mas
    // também listas decorativas. Melhor não emitir feed do que emitir vazio.
    const _feedTudoVazio = !seletorAutor && !seletorData && !seletorTexto && !seletorAnexos;
    if(_feedTudoVazio) {
      paisFeedVistos.add(pai);
      continue;
    }

    feedsDetectados.push({
      tipo: 'feed_timeline',
      seletor_container: seletorContainer,
      seletor_item: seletorItem,
      aba_origem: getAbaOrigem(pai),
      total_itens: grupo.length,
      estrutura_detectada: {
        tem_autor:  !!seletorAutor,
        tem_data:   !!seletorData,
        tem_texto:  !!seletorTexto,
        tem_anexos: !!seletorAnexos,
      },
      seletores: {
        autor:  seletorAutor  ? `${seletorItem} ${seletorAutor}`  : null,
        data:   seletorData   ? `${seletorItem} ${seletorData}`   : null,
        texto:  seletorTexto  ? `${seletorItem} ${seletorTexto}`  : null,
        anexos: seletorAnexos ? `${seletorItem} ${seletorAnexos}` : null,
      },
      exemplo_primeiro_item: {
        autor:  seletorAutor  ? sample.querySelector(seletorAutor)?.innerText?.trim()?.substring(0,60)  : null,
        data:   seletorData   ? sample.querySelector(seletorData)?.innerText?.trim()?.substring(0,40)   : null,
        texto:  seletorTexto  ? sample.querySelector(seletorTexto)?.innerText?.trim()?.substring(0,100) : null,
        n_anexos: nAnexosSample,
      },
      playwright: {
        iterar_itens: playwrightSnippet,
      },
    });
    paisFeedVistos.add(pai);
  }

  // ── 2h. Campos estáticos (display fields) ─────────────────────────────────
  // v1.5.0 — Feature 2: detecta pares label/valor em páginas de detalhe que
  // não são formulários nem grids. Três padrões estruturais:
  //  1) <dl><dt>Label</dt><dd>Valor</dd>          (HTML semântico)
  //  2) elemento com classe *label* + irmão/filho com *value*  (Bootstrap-like)
  //  3) tabela com exatamente 2 colunas pequena   (ficha de cadastro)
  // Sem dependência de nome de site — só estrutura de DOM.
  const camposEstaticos = [];
  const RX_LABEL_IGNORAR = /^(menu|nav|header|footer|copyright|©)/i;

  // Padrão 1: <dl><dt>...</dt><dd>...</dd></dl>
  document.querySelectorAll('dl').forEach(dl => {
    if(dl.closest('nav, header, footer, .menu')) return;
    Array.from(dl.querySelectorAll('dt')).forEach(dt => {
      const dd = dt.nextElementSibling;
      if(!dd || dd.tagName !== 'DD') return;
      const label = (dt.innerText || '').trim();
      const valor = (dd.innerText || '').trim();
      if(!label || !valor || RX_LABEL_IGNORAR.test(label)) return;
      camposEstaticos.push({
        tipo: 'dl_dt_dd',
        label: label.substring(0,80),
        valor_exemplo: valor.substring(0, 120),
        seletor_valor: dd.id ? `#${dd.id}` : null,
        aba_origem: getAbaOrigem(dt),
      });
    });
  });

  // Padrão 2: classe *label* + irmão/filho com classe *value*
  // Filtra <label> nativo (já capturado em campos de form).
  const SEL_LABELS = '[class*="label"]:not(label),[class*="field-name"],[class*="campo-label"]';
  document.querySelectorAll(SEL_LABELS).forEach(el => {
    if(el.closest('nav, header, footer, .menu, form, .modal, [role="dialog"]')) return;
    // tenta irmão imediato; se não, busca por elemento com classe *value* no mesmo pai
    let valorEl = el.nextElementSibling;
    if(!valorEl || !(valorEl instanceof Element) ||
       !/(value|field-value|campo-valor)/i.test(valorEl.className || '')) {
      valorEl = el.parentElement?.querySelector(
        '[class*="value"]:not(.label),[class*="field-value"],[class*="campo-valor"]'
      );
    }
    if(!valorEl || valorEl === el) return;
    const label = (el.innerText || '').trim();
    const texto = (valorEl.innerText || '').trim();
    if(!label || !texto || texto.length > 200 || RX_LABEL_IGNORAR.test(label)) return;
    camposEstaticos.push({
      tipo: 'label_value_class',
      label: label.substring(0,80),
      valor_exemplo: texto.substring(0, 120),
      seletor_valor: valorEl.id ? `#${valorEl.id}` : null,
      aba_origem: getAbaOrigem(el),
    });
  });

  // Padrão 3: tabela 2-colunas pequena com padrão label/valor
  // (ficha de cadastro, não grid de dados). Evita tablesBiblioteca pra
  // não conflitar com grids já capturados como datatables/tabulator/etc.
  document.querySelectorAll('table').forEach(table => {
    if(tablesBiblioteca.has(table)) return;
    if(table.closest('nav, header, footer, .menu')) return;
    const linhas = Array.from(table.querySelectorAll('tr'));
    if(linhas.length < 2 || linhas.length > 30) return;  // grids têm muitas linhas
    let pareceFicha = true;
    const candidatos = [];
    for(const row of linhas) {
      const cells = row.querySelectorAll('td, th');
      if(cells.length !== 2) { pareceFicha = false; break; }
      const label = (cells[0].innerText || '').trim();
      const valor = (cells[1].innerText || '').trim();
      // Label vazio ou puramente numérico desclassifica a tabela como ficha
      if(!label || /^\d+([.,]\d+)?$/.test(label)) { pareceFicha = false; break; }
      if(RX_LABEL_IGNORAR.test(label)) { pareceFicha = false; break; }
      candidatos.push({ label, valor });
    }
    if(pareceFicha && candidatos.length >= 2) {
      const abaTabela = getAbaOrigem(table);
      candidatos.forEach(c => camposEstaticos.push({
        tipo: 'table_2col_label_value',
        label: c.label.substring(0,80),
        valor_exemplo: c.valor.substring(0, 120),
        seletor_valor: null,                              // célula sem id estável
        aba_origem: abaTabela,
      }));
    }
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
      aba_origem: getAbaOrigem(modal),
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

  // ── 3.6b. Bootstrap modals sem role="dialog" ─────────────────────────────
  // v1.4.0 — Fase 5: o seletor base ".modal" já passa pelo bloco 3.6 acima,
  // mas há sites que usam .modal sem ".fade" e sem data-toggle e o detector
  // generaliza pra "custom". Esse passe garante que QUALQUER .modal entre,
  // procura abridores via data-target/data-bs-target/href="#id" (Bootstrap),
  // mapeia campos/botões internos e marca como tipo bootstrap_modal explicitamente.
  // Estrutural: só se importa com a presença da classe .modal.
  function montarModalBootstrap(el) {
    if(!el || !(el instanceof Element)) return;
    if(el.closest('table')) return;
    const seletor = el.id ? `#${el.id}` : (el.classList[0] ? `.${el.classList[0]}` : 'div.modal');
    if(seletoresModaisVistos.has(seletor)) {
      // Já capturado — só promover tipo se ainda for genérico
      const existente = modaisEncontrados.find(m => m.seletor === seletor);
      if(existente && existente.tipo === 'custom') existente.tipo = 'bootstrap_modal';
      return;
    }
    seletoresModaisVistos.add(seletor);

    const tituloEl = el.querySelector('.modal-title, .modal-header h1, .modal-header h2, .modal-header h3, .modal-header h4, .modal-header h5, header');
    const titulo = tituloEl?.textContent?.trim().substring(0, 100) || '';

    const formsInternos  = el.querySelectorAll('form');
    const inputsInternos = el.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea');
    const botoesInternos = el.querySelectorAll('button, input[type=submit], input[type=button], a.btn, [role="button"]');

    const camposIds = Array.from(inputsInternos).map(i => i.id || i.name || '').filter(Boolean).slice(0, 30);
    const botoesTextos = Array.from(botoesInternos).map(b => (b.innerText || b.value || '').trim().substring(0, 40)).filter(Boolean).slice(0, 10);

    const abridores = [];
    if(el.id) {
      const seletoresAbridor = [
        `[data-target="#${el.id}"]`,
        `[data-bs-target="#${el.id}"]`,
        `[href="#${el.id}"]`,
      ];
      seletoresAbridor.forEach(s => {
        try {
          document.querySelectorAll(s).forEach(btn => {
            if(el.contains(btn)) return;
            const texto = ((btn.innerText || btn.textContent || '').trim() || btn.value || '').substring(0, 60);
            const idBtn = btn.id || '';
            if(!abridores.some(a => a.seletor === s || (idBtn && a.id === idBtn))) {
              abridores.push({ texto, seletor: s, id: idBtn });
            }
          });
        } catch(_){}
      });
    }

    const estaVisivel = el.classList.contains('show') ||
      el.classList.contains('in') ||
      el.classList.contains('uk-open') ||
      (window.getComputedStyle(el).display !== 'none' && el.offsetParent !== null);

    modaisEncontrados.push({
      id: el.id || '',
      seletor,
      tipo: 'bootstrap_modal',
      titulo,
      esta_visivel: estaVisivel,
      aba_origem: getAbaOrigem(el),
      tem_form: formsInternos.length > 0,
      total_forms_internos: formsInternos.length,
      campos_dentro: camposIds,
      total_campos_dentro: inputsInternos.length,
      botoes_dentro: botoesTextos,
      total_botoes_dentro: botoesInternos.length,
      abridores,
      classes: (el.className || '').toString().split(/\s+/).filter(Boolean).slice(0, 5),
    });

    [...inputsInternos, ...botoesInternos].forEach(elInt => {
      elementosEmModal.set(elInt, seletor);
    });
  }
  document.querySelectorAll('.modal').forEach(montarModalBootstrap);

  // ── 3.6c. React component modals (Andes, MUI, headless via data-testid) ──
  // v1.4.0 — Fase 6: componentes React modernos não usam role="dialog" nem
  // classes Bootstrap. Detecção por classes que identificam o design system
  // (Andes do Mercado Livre, MUI Material) ou por data-testid contendo "modal"
  // ou "dialog". Estrutural: classe ou data-attr, nunca conteúdo semântico.
  const SELETORES_REACT_MODAL = [
    '[class*="andes-modal"]',
    '[class*="andes-dialog"]',
    '[class*="MuiDialog-root"]',
    '[class*="MuiModal-root"]',
    '[data-testid*="modal"]',
    '[data-testid*="dialog"]',
  ];
  function montarModalReact(el) {
    if(!el || !(el instanceof Element)) return;
    if(el.getAttribute('aria-hidden') === 'true') return;
    // Resolve seletor preferindo id, depois data-testid, depois 1ª classe
    let seletor;
    if(el.id) seletor = `#${el.id}`;
    else if(el.getAttribute('data-testid')) seletor = `[data-testid="${el.getAttribute('data-testid')}"]`;
    else if(el.classList[0]) seletor = `${el.tagName.toLowerCase()}.${el.classList[0]}`;
    else seletor = el.tagName.toLowerCase();
    if(seletoresModaisVistos.has(seletor)) return;
    seletoresModaisVistos.add(seletor);

    const tituloEl = el.querySelector('h1, h2, h3, h4, h5, [class*="title"], [class*="Title"]');
    const titulo = tituloEl?.textContent?.trim().substring(0, 100) || '';

    const formsInternos  = el.querySelectorAll('form');
    const inputsInternos = el.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea');
    const botoesInternos = el.querySelectorAll('button, input[type=submit], input[type=button], a.btn, [role="button"]');

    const camposIds = Array.from(inputsInternos).map(i => i.id || i.name || '').filter(Boolean).slice(0, 30);
    const botoesTextos = Array.from(botoesInternos).map(b => (b.innerText || b.value || '').trim().substring(0, 40)).filter(Boolean).slice(0, 10);

    modaisEncontrados.push({
      id: el.id || '',
      seletor,
      tipo: 'react_modal',
      titulo,
      esta_visivel: elVisivel(el),
      aba_origem: getAbaOrigem(el),
      tem_form: formsInternos.length > 0,
      total_forms_internos: formsInternos.length,
      campos_dentro: camposIds,
      total_campos_dentro: inputsInternos.length,
      botoes_dentro: botoesTextos,
      total_botoes_dentro: botoesInternos.length,
      abridores: [],                                       // React abre via state, sem atributo DOM
      classes: (el.className || '').toString().split(/\s+/).filter(Boolean).slice(0, 5),
      aviso: 'Modal React controlado por estado — abridores não detectáveis no DOM. Use "Adicionar popup manualmente" para informar o seletor do botão.',
    });

    [...inputsInternos, ...botoesInternos].forEach(elInt => {
      elementosEmModal.set(elInt, seletor);
    });
  }
  SELETORES_REACT_MODAL.forEach(sel => {
    try { document.querySelectorAll(sel).forEach(montarModalReact); } catch(_){}
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
        aba_origem: getAbaOrigem(el),
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
    // v1.6.0 — Feature B7: identificar widgets pseudo-select (vue-select,
    // element-ui-select, select2, vue-multiselect). Esses inputs não aceitam
    // .fill() direto — o `interacao_playwright` orienta o gerador de scripts.
    const widget = detectarWidgetPseudoSelect(el);
    let interacaoPlaywright = widget ? INTERACAO_POR_WIDGET[widget] : null;
    // v1.6.1 — Feature D9.1: autocomplete server-side (Select2 AJAX, Typeahead).
    // Quando detectado, sobrescreve interacao_playwright com fluxo que digita
    // ANTES de tentar localizar a opção (Select2 estático falhava em produção).
    const detAjax = detectarAutocompleteRemoto(el);
    let tipoInputDinamico = null;
    let minCaracteres = null;
    if(detAjax.detectado) {
      tipoInputDinamico = 'ajax_remote';
      minCaracteres = detAjax.min_caracteres || 3;
      // Sobrescrever interacao_playwright para incluir .fill() antes do wait
      interacaoPlaywright =
        `# v1.6.1 D9 — autocomplete server-side (min ${minCaracteres} chars).\n` +
        `page.locator(SELETOR).click()\n` +
        `page.locator(SELETOR).fill("TEXTO_BUSCA")  # mínimo ${minCaracteres} chars\n` +
        `page.wait_for_selector(".select2-results__option:not(.loading-results)", timeout=5000)\n` +
        `page.locator(".select2-results__option").filter(has_text="VALOR_DESEJADO").click()`;
    }
    const avisos=[];
    if(mask) avisos.push(`Máscara: "${mask}"`);
    if(isSel2) avisos.push('Select2');
    if(isAuto) avisos.push('Autocomplete XHR');
    if(isDate) avisos.push('Datepicker JS');
    if(widget) avisos.push(`Widget pseudo-select: ${widget} — usar click+click, NUNCA fill()`);
    if(tipoInputDinamico === 'ajax_remote') avisos.push(`Autocomplete server-side — digite ≥${minCaracteres} chars antes de selecionar`);
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
      seletor_alternativo: cnt>1 ? montarSeletorAlternativo(el) : null,    // v1.6.0 B4
      widget,                                                                // v1.6.0 B7
      interacao_playwright: interacaoPlaywright,                             // v1.6.0 B7 + v1.6.1 D9.1
      tipo_input_dinamico: tipoInputDinamico,                                // v1.6.1 D9.1
      min_caracteres: minCaracteres,                                         // v1.6.1 D9.1
      endpoint_ref: null,                                                    // v1.6.1 D9.5 — populado no merge da sessão
      obrigatorio: obrig.obrigatorio,
      obrigatorio_fontes: obrig.fontes,
      readonly:el.readOnly||false,
      mascara:mask, is_select2:isSel2,
      dentro_de_modal: elementosEmModal.get(el) || null,
      aba_origem: getAbaOrigem(el),
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
      aba_origem: getAbaOrigem(el),
      avisos:isSel2?['Select2 — não usar select_option()']:undefined,
    });
  });

  document.querySelectorAll('textarea').forEach(el => {
    if(el.disabled&&!opcoes.incluirDisabled) return;
    const obrig = detectarObrigatorio(el);
    // v1.4.0 — Detecção estrutural de editor Froala: se o textarea está dentro
    // de um container que tem .fr-box ou .fr-toolbar, .fill() padrão não funciona.
    // Estrutural (presença de classe Froala), não semântico — qualquer site que
    // use Froala recebe o aviso.
    const avisosTx = [];
    const containerFroala = el.closest('form, section, .field, .form-group, .control, .input-group');
    if(containerFroala && containerFroala.querySelector('.fr-box, .fr-toolbar')) {
      avisosTx.push('Froala Editor detectado — usar page.evaluate(() => FroalaEditor.INSTANCES[0].html.set("texto")) em vez de fill()');
    }
    campos.push({ tipo_elemento:'textarea', name:el.name||'', id:el.id||'',
      label:getLabel(el),
      aria_label: el.getAttribute('aria-label')||'',
      data_testid: el.getAttribute('data-testid')||'',
      data_atributos_extras: getDataAttrs(el, ['data-testid','data-request']),
      seletor_playwright:getSeletor(el),
      obrigatorio: obrig.obrigatorio,
      obrigatorio_fontes: obrig.fontes,
      dentro_de_modal: elementosEmModal.get(el) || null,
      aba_origem: getAbaOrigem(el),
      avisos: avisosTx.length ? avisosTx : undefined,
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

      aba_origem: getAbaOrigem(container),
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
      aba_origem: getAbaOrigem(el),
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
    // Pular elementos internos do Vertex Field Mapper (overlay, botão fechar, etc.)
    if(el.id?.startsWith('vertex-') || el.closest('#vertex-overlay-destaque,#vertex-info-destaque,#vertex-btn-fechar-destaque')) return;
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
    // v1.5.0 — Feature 5 + v1.6.0 B3: detectar se o form contém campo de busca REAL.
    // v1.6.0 excluiu inputs de busca internos de widgets pseudo-select (vs__search,
    // el-select__input, select2-search__field) — esses são parte do dropdown,
    // não o campo de busca do formulário.
    let formTemBusca = false;
    if(formContexto) {
      try {
        formTemBusca = !!formContexto.querySelector(
          'input[type="search"]:not(.vs__search):not(.el-select__input):not(.select2-search__field):not(.multiselect__input), ' +
          'input[placeholder*="busca" i]:not(.vs__search):not(.el-select__input):not(.select2-search__field):not(.multiselect__input), ' +
          'input[placeholder*="search" i]:not(.vs__search):not(.el-select__input):not(.select2-search__field):not(.multiselect__input), ' +
          'input[placeholder*="pesquis" i]:not(.vs__search):not(.el-select__input):not(.select2-search__field):not(.multiselect__input), ' +
          'input[name*="search" i]:not(.vs__search):not(.el-select__input):not(.select2-search__field):not(.multiselect__input), ' +
          'input[name*="busca" i]:not(.vs__search):not(.el-select__input):not(.select2-search__field):not(.multiselect__input), ' +
          'input[name*="pesquis" i]:not(.vs__search):not(.el-select__input):not(.select2-search__field):not(.multiselect__input)'
        );
      } catch(_){}
    }

    // v1.6.0 — Feature B8: detectar dropdown-toggle (Bootstrap/ARIA) como tipo
    // distinto. Esses botões abrem menus, NUNCA são submit primário.
    const ehDropdownToggle =
      el.classList.contains('dropdown-toggle') ||
      el.dataset.toggle === 'dropdown' ||
      el.dataset.bsToggle === 'dropdown' ||
      ['menu', 'true', 'listbox'].includes((el.getAttribute('aria-haspopup') || '').toLowerCase());

    const tipoTag = (el.tagName === 'A' || el.getAttribute('role') === 'button')
      ? 'link_acao'
      : ((el.type||'').toLowerCase() || el.tagName.toLowerCase());
    const tipo = ehDropdownToggle ? 'dropdown_toggle' : tipoTag;

    let posY = 0;
    let w = 0, h = 0;
    try {
      const rect = el.getBoundingClientRect();
      posY = Math.round(rect.top);
      w = Math.round(rect.width);
      h = Math.round(rect.height);
    } catch(_){}
    const formVisivel = w > 0 && h > 0;

    // v1.6.1 — Feature D1: tentar desambiguar com :has-text() antes de avisar
    // strict-mode. Reduz dramaticamente o número de warnings em sites como
    // CREA-MT/Caixa onde o texto do botão é único na página.
    let seletorFinalBotao = sel;
    let cntFinal = cnt;
    let seletorAlternativoBotao = null;
    if(cnt > 1) {
      let matchesArr = [];
      try { matchesArr = Array.from(document.querySelectorAll(sel)); } catch(_){}
      const desamb = tentarDesambiguarPorTexto(sel, el, matchesArr);
      if(desamb) {
        seletorFinalBotao = desamb.seletor;
        cntFinal = desamb.matches;
        seletorAlternativoBotao = sel; // o base original como fallback
      } else {
        seletorFinalBotao = `${sel} /* ⚠ ${cnt} matches */`;
        seletorAlternativoBotao = montarSeletorAlternativo(el);
      }
    }

    const avisos = [];
    if(cntFinal > 1) avisos.push(`Strict mode: ${cntFinal} matches — use .first() ou refine seletor`);
    if(dataRequest) avisos.push(`OctoberCMS AJAX: data-request="${dataRequest}" — usar .click(), NUNCA form.submit()`);
    if(isPerigo) avisos.push('Texto sugere ação destrutiva — confirmar antes de automatizar');
    if(el.tagName === 'A' && !dataRequest) avisos.push('É um link <a> — pode causar navegação; verifique se há handler JS');
    if(ehDropdownToggle) avisos.push('dropdown-toggle: abre menu, não submete form');

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
      seletor_playwright: seletorFinalBotao,                                // v1.6.1 D1
      seletor_alternativo: seletorAlternativoBotao,                          // v1.6.0 B4 + v1.6.1 D1
      id: el.id||'', name: el.name||'',
      classes: classes.slice(0,5),
      aria_label: el.getAttribute('aria-label')||'',
      data_testid: el.getAttribute('data-testid')||'',
      data_request: dataRequest,
      data_atributos_extras: getDataAttrs(el, ['data-testid','data-request']),
      disabled: el.disabled||false,
      em_formulario: !!formContexto,
      form_id: formContexto?.id || '',
      form_tem_busca: formTemBusca,                       // v1.5.0 Feature 5 + v1.6.0 B3 refinado
      form_visivel: formVisivel,                          // v1.6.0 B4 — tem dimensão visível
      tamanho: { w, h },                                  // v1.6.0 B3 — para penalizar botões-ícone
      provavel_primario: isPrimaryByClass || isPrimaryByText,
      acao_destrutiva: isPerigo,
      e_dropdown_toggle: undefined,                       // v1.6.1 D7: campo removido (redundante com tipo: 'dropdown_toggle')
      _ed: ehDropdownToggle,                              // v1.6.1 D7: flag interna p/ scorer (chave _ é descartada no export)
      posicao_y: posY,
      abre_modal: abreModal,
      abre_popup_lazy: abrePopupLazy,
      popup_handler_backend: popupHandler,
      popup_extra_data: popupExtraData,
      dentro_de_modal: elementosEmModal.get(el) || null,
      aba_origem: getAbaOrigem(el),
      avisos: avisos.length ? avisos : undefined,
      _link_externo_contato: ehHrefExternoContato,                  // v1.6.0 — flag p/ scorer (substitui Set indexado)
    });
  });

  // ── v1.6.0 — Feature B4: Deduplicação de elementos com mesmo ID ─────────────
  // Vue SFC e templates legados frequentemente reutilizam o mesmo id em
  // múltiplos componentes ("#setting-save-button" 12×). Sem dedup, o JSON
  // ganha 11 entradas redundantes e o seletor `#id` vira ambíguo no Playwright.
  // Estratégia: manter a 1ª ocorrência, anotar duplicado_count, e oferecer
  // seletor alternativo já estruturalmente único (tag.classe[data-v-XXX]).
  function dedupPorId(lista) {
    const grupos = new Map(); // id → array de índices
    lista.forEach((item, i) => {
      const id = item.id;
      if(!id) return;
      if(!grupos.has(id)) grupos.set(id, []);
      grupos.get(id).push(i);
    });
    const indicesARemover = new Set();
    for(const [id, indices] of grupos) {
      if(indices.length <= 1) continue;
      const principal = lista[indices[0]];
      principal.duplicado_count = indices.length;
      principal.avisos = principal.avisos || [];
      principal.avisos.push(`id duplicado ${indices.length}× — use seletor alternativo ou .first()`);
      if(!String(principal.seletor_playwright).includes('>> nth=')) {
        principal.seletor_playwright = `#${id} >> nth=0  /* ⚠ ${indices.length} duplicatas */`;
      }
      for(let k = 1; k < indices.length; k++) indicesARemover.add(indices[k]);
    }
    return lista.filter((_, i) => !indicesARemover.has(i));
  }
  // Aplicar a campos e botões in-place. botoes é referenciado por outras
  // estruturas via .find/.findIndex, então mutamos o array original.
  const camposDedup = dedupPorId(campos);
  campos.length = 0; campos.push(...camposDedup);
  const botoesDedup = dedupPorId(botoes);
  botoes.length = 0; botoes.push(...botoesDedup);

  // ── v1.6.1 — Feature D8: Dedup de botões SEM id por chave composta ──────────
  // Botões duplicados sem `id` (ex: menu desktop + mobile no CREA-MT, mesmo
  // texto e classe `dropdown-toggle`) ficavam fora do alcance da B4. Chave
  // estrutural: texto + tag + data-request + data-toggle + 2 primeiras classes
  // ordenadas + aba_origem. Estruturalmente idênticos = consolidados.
  function dedupBotoesSemId(lista) {
    const grupos = new Map();
    lista.forEach((b, i) => {
      if(b.id) return; // já tratados pela B4
      const dToggle = (b.data_atributos_extras || {})['data-toggle']
                   || (b.data_atributos_extras || {})['data-bs-toggle']
                   || '';
      const chave = [
        (b.texto || '').trim().substring(0, 50),
        b.tipo || '',
        b.data_request || '',
        dToggle,
        (b.classes || []).slice(0, 2).slice().sort().join(','),
        b.aba_origem || '',
      ].join('|');
      if(!grupos.has(chave)) grupos.set(chave, []);
      grupos.get(chave).push(i);
    });
    const indicesARemover = new Set();
    for(const [chave, indices] of grupos) {
      if(indices.length <= 1) continue;
      const principal = lista[indices[0]];
      principal.duplicado_count = (principal.duplicado_count || 1) * indices.length;
      principal.duplicado_chave = chave;
      principal.avisos = principal.avisos || [];
      principal.avisos.push(`duplicado estrutural ${indices.length}× — mesma chave composta`);
      for(let k = 1; k < indices.length; k++) indicesARemover.add(indices[k]);
    }
    return lista.filter((_, i) => !indicesARemover.has(i));
  }
  const botoesDedup2 = dedupBotoesSemId(botoes);
  botoes.length = 0; botoes.push(...botoesDedup2);

  // Heurística do "submit primário": pontua cada botão e escolhe o melhor.
  // Threshold mínimo: se ninguém atingir 30, deixa não-marcado (melhor admitir
  // que não sabe do que chutar "Sair"/"JONATHAN" como na v1.1.0).
  const RX_DATA_REQUEST_NAO_SUBMIT = /onLogout|onSair|onLogin|onDelete|onClose|onCancel|onRemove|onDestroy|onShow|onHide|onToggle/i;
  const RX_TEXTO_NAO_SUBMIT = /^(sair|logout|voltar|menu|perfil|conta|ajuda|home|in[ií]cio|cancelar|fechar|×|x|ok|telefone[s]?|whatsapp|chat|localiza[çc][aã]o)$/i;
  // v1.6.0 — Feature B3: blacklists adicionais para falsos positivos do Puzl Place.
  // ARIA labels que indicam "limpar/fechar/colapsar" — clear, deselect, close, dismiss
  const RX_ARIA_BLACKLIST = /^(clear|deselect|close|remove|delete|dismiss|toggle|expand|collapse)\b/i;
  // Classes de widget pseudo-select que NUNCA são submit (botõezinhos de UI interna)
  const CLASS_BLACKLIST = new Set([
    'vs__clear', 'vs__deselect', 'vs__open-indicator',
    'el-select__caret', 'el-tag__close', 'el-input__suffix',
    'select2-selection__clear',
    'close', 'btn-close', 'dropdown-toggle', 'navbar-toggler',
  ]);

  function pontuarBotaoSubmit(b, idx) {
    // Desqualificações duras: retornam imediatamente um score muito negativo
    if(b.acao_destrutiva) return { score: -100, razao: 'destrutivo' };
    if(b.disabled) return { score: -100, razao: 'disabled' };
    // v1.6.0 — Feature B8 + v1.6.1 D7: dropdown-toggle nunca é submit (lê flag interna _ed)
    if(b._ed || b.tipo === 'dropdown_toggle') return { score: -100, razao: 'dropdown-toggle (abre menu)' };
    if(RX_TEXTO_NAO_SUBMIT.test((b.texto||'').trim())) {
      return { score: -50, razao: `texto blacklist: "${b.texto}"` };
    }
    if(b.data_request && RX_DATA_REQUEST_NAO_SUBMIT.test(b.data_request)) {
      return { score: -50, razao: `data-request blacklist: ${b.data_request}` };
    }
    // Penalizar links externos de contato (tel:, whatsapp, maps) — nunca são submit
    // v1.6.0 — leitura via flag _link_externo_contato (robusta após dedup)
    if(b._link_externo_contato) {
      return { score: -50, razao: 'link externo contato (tel/wa.me/maps)' };
    }
    // v1.6.0 — Feature B3: aria-label começa com clear/close/etc → fora
    if(RX_ARIA_BLACKLIST.test(b.aria_label || '')) {
      return { score: -60, razao: `aria-label blacklist: "${b.aria_label}"` };
    }
    // v1.6.0 — Feature B3: classe de widget pseudo-select interno → fora
    if((b.classes||[]).some(c => CLASS_BLACKLIST.has(c))) {
      return { score: -60, razao: `classe blacklist: ${(b.classes||[]).find(c => CLASS_BLACKLIST.has(c))}` };
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
    // v1.5.0 — Feature 5: bônus quando o form contém campo de busca.
    if(b.form_tem_busca) { score += 50; razoes.push('form tem campo de busca'); }
    // v1.6.0 — Feature B3: penalizar botões-ícone (largura < 30 e altura < 30)
    if(b.tamanho && b.tamanho.w > 0 && b.tamanho.w < 30 && b.tamanho.h > 0 && b.tamanho.h < 30) {
      score -= 30; razoes.push(`tamanho-ícone (${b.tamanho.w}×${b.tamanho.h})`);
    }

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
  // v1.6.0 — Feature B6: Classificar iframes em "widget externo" (chat,
  // tracking, vídeo embed) vs "relevante" (formulários embarcados).
  // Sem isso, qualquer página com chat de suporte virava warn injustamente.
  const RX_WIDGET_EXTERNO = /(\bchat\b|\bwidget\b|tawk|crisp|intercom|drift|zendesk|hotjar|fullstory|googletagmanager|hcaptcha|recaptcha\/api|youtube\.com\/embed|player\.vimeo)/i;
  const iframesNode = [...document.querySelectorAll('iframe')];
  const iframesDetalhe = iframesNode.map(f => {
    const src = f.src || f.getAttribute('data-src') || '';
    const visivel = f.offsetWidth > 50 && f.offsetHeight > 50;
    let sameOrigin = null;
    try { sameOrigin = src ? new URL(src, location.href).origin === location.origin : null; } catch(_){}
    return {
      src,
      visivel,
      same_origin: sameOrigin,
      e_widget_externo: RX_WIDGET_EXTERNO.test(src),
    };
  });
  const iframesRelevantes = iframesDetalhe.filter(i => i.visivel && !i.e_widget_externo);

  const diag = {
    webdriver_detectavel: navigator.webdriver===true,
    tem_recaptcha: !!(document.querySelector('.g-recaptcha,iframe[src*="recaptcha"],iframe[src*="hcaptcha"]')||htmlLow.includes('grecaptcha')),
    tem_certificado_digital: !!(htmlLow.includes('certificado digital')||htmlLow.includes('.pfx')||htmlLow.includes('e-cpf')),
    tem_govbr: !!(document.querySelector('[href*="acesso.gov.br"]')||htmlLow.includes('acesso.gov.br')),
    tem_csrf_token: !!(document.querySelector('input[name*="csrf"],input[name*="_token"],meta[name="csrf-token"]')),
    csrf_token_name: document.querySelector('input[name*="csrf"],input[name*="_token"]')?.name||null,
    sessao_php: location.search.includes('PHPSESSID')||document.cookie.includes('PHPSESSID'),
    qtd_forms: document.querySelectorAll('form').length,
    // v1.6.0 — Feature B6: iframes classificados
    tem_iframe: iframesNode.length > 0,
    iframes_relevantes_count: iframesRelevantes.length,
    iframes_detalhe: iframesDetalhe,
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
    // v1.6.0 — Feature B6: só rebaixar para warn se há iframe REAL (não widget externo)
    if(diag.iframes_relevantes_count > 0) {
      return {status:'warn',motivo:`${diag.iframes_relevantes_count} iframe(s) relevante(s) — usar frame.locator()`};
    }
    if(diag.tem_iframe && diag.iframes_relevantes_count === 0) {
      // Há iframe(s) mas todos são widgets externos (chat/tracking) — go com aviso
      return {status:'go',motivo:`Página automatizável (${diag.iframes_detalhe.length} iframe(s) widget externo ignorado(s))`};
    }
    return {status:'go',motivo:'Página parece automatizável'};
  })();

  // ── 8b. Candidatos a cascade ───────────────────────────────────────────────
  // v1.6.0 — Feature A1: Detecção estrutural de candidatos a cascade.
  // Critério: dentro de um mesmo <form>, qualquer <select> com ≥3 opções é
  // possível pai; qualquer <select> com ≤2 opções (vazio ou só "Selecione")
  // é possível filho. A validação real (se o change do pai muda o filho)
  // é feita por iteração na própria scriptCascadesMapper com early-abort.
  // Heurística puramente estrutural — não menciona id/nome de campo específico.
  const cascadeCandidatos = [];
  document.querySelectorAll('form').forEach(form => {
    const selectsForm = [...form.querySelectorAll('select')];
    if(selectsForm.length < 2) return;
    const possiveisPais   = selectsForm.filter(s => s.options.length >= 3);
    const possiveisFilhos = selectsForm.filter(s => s.options.length <= 2);
    if(possiveisPais.length === 0 || possiveisFilhos.length === 0) return;
    possiveisPais.forEach(pai => {
      if(!pai.id) return;
      cascadeCandidatos.push({
        seletor_pai: '#' + (window.CSS?.escape ? CSS.escape(pai.id) : pai.id),
        total_opcoes_pai: pai.options.length,
        filhos_potenciais: possiveisFilhos
          .filter(f => f.id && f !== pai)
          .map(f => '#' + (window.CSS?.escape ? CSS.escape(f.id) : f.id)),
      });
    });
  });
  const cascadeCandidatosValidos = cascadeCandidatos.filter(c => c.filhos_potenciais.length > 0);

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
    schema_version: '3.7',                              // bump v1.6.1: tipo_input_dinamico, min_caracteres, endpoint_ref, has-text seletor, dedup composta, feed guard, Tabulator id automático
    url: location.href,
    titulo: document.title,
    timestamp: new Date().toISOString(),
    tipo_pagina: { classificacao, confianca, motivos },
    frameworks,
    spa_detection: spa,
    grids,
    feeds: feedsDetectados,                              // v1.4.0 fase 3
    campos_estaticos: camposEstaticos,                   // v1.5.0 Feature 2
    cascade_candidatos: cascadeCandidatosValidos,        // v1.6.0 Feature A1 — sempre presente, mesmo que []
    formulario: { detectado: campos.length>0, campos },
    botoes_acao: botoes,
    modais_popups: modaisPopups,                          // filtrado (flyouts removidos)
    diagnostico: diag,
    ajax_endpoints: ajaxEndpoints,
    cookies_sessao: cookies,
    resumo: { ...resumo, total_modais: modaisPopups.length, total_feeds: feedsDetectados.length, total_campos_estaticos: camposEstaticos.length, total_campos_obrigatorios: campos.filter(c => c.obrigatorio).length, total_cascade_candidatos: cascadeCandidatosValidos.length },
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
      background: #ffffff !important;
      color: #111111 !important;
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
      const seletorLimpo = item.seletor.replace(/\s*\/\*.*?\*\//g,'').trim();
      const candidatos = Array.from(document.querySelectorAll(seletorLimpo));
      let el = null;
      if(candidatos.length === 0) return;
      if(candidatos.length === 1) {
        el = candidatos[0];
      } else if(item.texto) {
        // Múltiplos matches: encontrar pelo texto mais parecido
        const alvo = item.texto.trim().toLowerCase();
        el = candidatos.find(c => {
          // Clonar e remover rótulos vertex antes de comparar o texto
          const clone = c.cloneNode(true);
          clone.querySelectorAll('.vertex-rotulo-destaque').forEach(r => r.remove());
          const txt = (clone.innerText || clone.textContent || '').trim().toLowerCase();
          return txt === alvo || txt.startsWith(alvo) || alvo.startsWith(txt);
        }) || candidatos[0];
      } else {
        el = candidatos[0];
      }
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

// v1.4.2/1.4.3/1.4.5 — Bloco prioritário de captura.
// Renderiza um bloco fixo no topo da aba Sessão com TODOS os popups pendentes
// (status 'pendente' ou 'capturando') de qualquer página. É o ponto de entrada
// principal para o fluxo — o checklist nos cards de página fica somente-leitura.
//
// v1.4.3 — Layout vertical, contador, alternância da classe `wizard-active`
//          no <body> para esconder os outros elementos da aba Sessão.
// v1.4.5 — Lista todas as tarefas pendentes simultaneamente:
//          - Ninguém capturando: cada item mostra nome + [▶ Capturar] + [Pular]
//          - Algum item capturando: só ESSE item tem botões; os outros mostram
//            apenas ícone + nome (atenuados), pra evitar que o usuário tente
//            iniciar uma segunda captura no meio do fluxo da primeira.
//          - Contador mostra "X DE Y" onde X = concluídos (capturados+pulados).
function renderCapturaPrioritaria(sessao) {
  const container = $('captura-prioritaria-container');
  if(!container) return;

  // Coletar todos os pendentes/capturando de todas as páginas
  const tarefas = [];
  (sessao?.paginas || []).forEach((pag, pagIdx) => {
    (pag.popups_pendentes || []).forEach((popup, popIdx) => {
      if(popup.status === 'pendente' || popup.status === 'capturando') {
        tarefas.push({ pagIdx, popIdx, popup, pag });
      }
    });
  });

  if(tarefas.length === 0) {
    container.style.display = 'none';
    container.innerHTML = '';
    document.body.classList.remove('wizard-active');
    return;
  }

  // Contador "X DE Y": Y = todos popups que já foram pendentes algum dia,
  // X = quantos já foram concluídos (capturados ou pulados).
  let totalGeral = 0;
  let totalConcluidos = 0;
  (sessao?.paginas || []).forEach(pag => {
    (pag.popups_pendentes || []).forEach(popup => {
      totalGeral++;
      if(popup.status === 'capturado' || popup.status === 'pulado') totalConcluidos++;
    });
  });

  // Detectar se existe um item em status='capturando' (no máximo 1 por vez)
  const emCaptura = tarefas.find(t => t.popup.status === 'capturando');

  // Helper de escape pra evitar HTML em texto de botão de site
  const escapar = (s) => String(s || 'popup')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');

  // Gerar HTML pra cada tarefa
  const itensHtml = tarefas.map(({pagIdx, popIdx, popup}) => {
    const isCapturando = popup.status === 'capturando';
    const nomeEsc = escapar(popup.abridor_texto);

    // Caso 1: existe item em captura E este NÃO é o capturando → ghost item
    // (mostra ícone + nome atenuado, sem botões; deixa claro que existem outras
    // tarefas na fila mas o usuário só pode mexer na que está em andamento)
    if(emCaptura && !isCapturando) {
      return `
        <div style="display:flex; align-items:center; gap:8px; padding:2px 0; opacity:.45; font-size:13px; line-height:1.4; word-break:break-word;">
          <span style="color:var(--dim); flex-shrink:0;">☐</span>
          <span style="color:var(--dim);">${nomeEsc}</span>
        </div>
      `;
    }

    // Caso 2: este é o item em captura → bloco ativo com instrução + botões
    if(isCapturando) {
      return `
        <div style="display:flex; flex-direction:column; gap:10px; padding:8px 10px; background:rgba(243,179,65,.06); border-radius:var(--r); border:1px solid rgba(243,179,65,.35);">
          <div class="captura-prioritaria-instrucao">→ Clique no botão destacado na página</div>
          <div class="captura-prioritaria-popup-nome">☐ ${nomeEsc}</div>
          <button class="btn-capturar-agora btn-cp-check" data-pag-idx="${pagIdx}" data-pop-idx="${popIdx}">📸 Popup abriu? Capturar agora</button>
          <button class="btn-pular-prioritario btn-cp-pular" data-pag-idx="${pagIdx}" data-pop-idx="${popIdx}">Pular este popup</button>
        </div>
      `;
    }

    // Caso 3: ninguém está em captura → item pendente "ativável", com botões
    return `
      <div style="display:flex; flex-direction:column; gap:8px;">
        <div class="captura-prioritaria-popup-nome">☐ ${nomeEsc}</div>
        <button class="btn-capturar-prioritario btn-cp-capturar" data-pag-idx="${pagIdx}" data-pop-idx="${popIdx}">▶ Capturar</button>
        <button class="btn-pular-prioritario btn-cp-pular" data-pag-idx="${pagIdx}" data-pop-idx="${popIdx}">Pular este popup</button>
      </div>
    `;
  }).join('');

  const html = `
    <div class="captura-prioritaria">
      <div class="captura-prioritaria-titulo">📌 CAPTURA NECESSÁRIA — ${totalConcluidos} DE ${totalGeral}</div>
      ${itensHtml}
    </div>
  `;
  container.innerHTML = html;
  container.style.display = 'block';
  document.body.classList.add('wizard-active');
}

function renderSessao(sessao) {
  // v1.6.1 — Migração 3.6 → 3.7: garantir endpoints_dinamicos sempre presente
  if(sessao) sessao.endpoints_dinamicos = sessao.endpoints_dinamicos || {};
  const tem = sessao?.paginas?.length > 0;
  $('sessao-vazia').style.display  = tem?'none':'block';
  $('sessao-header').style.display = tem?'flex':'none';
  $('sessao-acoes').style.display  = tem?'flex':'none';
  if(!tem) {
    $('paginas-lista').innerHTML='';
    const cp = $('captura-prioritaria-container');
    if(cp) { cp.style.display='none'; cp.innerHTML=''; }
    document.body.classList.remove('wizard-active');
    return;
  }

  // v1.4.2 — bloco prioritário (ponto de entrada principal de captura)
  renderCapturaPrioritaria(sessao);

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
    // v1.4.0 — Guard para schema 3.2 → 3.3: feeds não existia, origem em
    // popups_pendentes não existia. Preencher defaults antes de renderizar.
    pag.feeds = pag.feeds || [];
    pag.popups_pendentes.forEach(pp => { pp.origem = pp.origem || 'detectado'; });
    // v1.5.0 — Guard para schema 3.3 → 3.4: campos_estaticos e cascade_maps
    pag.campos_estaticos = pag.campos_estaticos || [];
    pag.cascade_maps     = pag.cascade_maps     || {};
    // v1.6.0 — Migração 3.4 → 3.6: cascade_candidatos + iframes classificados + vue_evidencia
    pag.cascade_candidatos = pag.cascade_candidatos || [];
    pag.diagnostico = pag.diagnostico || {};
    if(pag.diagnostico.iframes_relevantes_count == null) pag.diagnostico.iframes_relevantes_count = null;
    pag.diagnostico.iframes_detalhe = pag.diagnostico.iframes_detalhe || [];
    pag.spa_detection = pag.spa_detection || {};
    if(pag.spa_detection.vue_evidencia == null) pag.spa_detection.vue_evidencia = null;
    // v1.6.1 — Migração 3.6 → 3.7: tipo_input_dinamico, min_caracteres, endpoint_ref nos campos
    if(pag.formulario?.campos) {
      pag.formulario.campos.forEach(c => {
        if(c.tipo_input_dinamico === undefined) c.tipo_input_dinamico = null;
        if(c.min_caracteres === undefined)     c.min_caracteres = null;
        if(c.endpoint_ref === undefined)       c.endpoint_ref = null;
      });
    }
    // Aborto por timeouts consecutivos: metadata cascade
    for(const info of Object.values(pag.cascade_maps || {})) {
      if(info && info.metadata) {
        if(info.metadata.combinacoes_processadas === undefined) info.metadata.combinacoes_processadas = null;
        if(info.metadata.combinacoes_puladas    === undefined) info.metadata.combinacoes_puladas    = null;
      }
    }

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

    // v1.6.1 — Feature D9.4: aviso amarelo se a página tem campos ajax_remote.
    // Mostra o(s) endpoint(s) descoberto(s) e contador ao vivo de opções.
    const camposAjaxPag = (pag.formulario?.campos || []).filter(c => c.tipo_input_dinamico === 'ajax_remote');
    if(camposAjaxPag.length > 0) {
      const aviso = document.createElement('div');
      aviso.className = 'autocomplete-aviso';
      aviso.dataset.pagIdx = idx;
      const linhasCampo = camposAjaxPag.map(c => {
        const lbl = c.label || c.placeholder || c.name || c.aria_label || '(sem rótulo)';
        const endpointPath = c.endpoint_ref ? (() => {
          try { return new URL(c.endpoint_ref).pathname; } catch(_) { return c.endpoint_ref; }
        })() : '(será detectado quando você digitar)';
        return `
          <div class="ac-detalhe">
            <span>Campo: <strong>${lbl}</strong></span>
            <span>Endpoint: <code data-endpoint="${c.endpoint_ref || ''}">${endpointPath}</code></span>
            <span>Min. caracteres: <strong>${c.min_caracteres || 3}</strong></span>
            <span class="ac-contador" data-endpoint-key="${c.endpoint_ref || ''}">Opções capturadas: <strong>0 únicas</strong> (0 buscas)</span>
          </div>`;
      }).join('');
      aviso.innerHTML = `
        <div class="ac-titulo">🔍 AUTOCOMPLETE REMOTO DETECTADO</div>
        ${linhasCampo}
        <div class="ac-instrucao">
          ⚡ Digite termos representativos do seu domínio no campo da página. A extensão captura
          automaticamente cada resposta JSON. Recomendado: 5-10 termos distintos.
        </div>`;
      card.appendChild(aviso);
    }

    // ── Checklist de popups pendentes + botão "Adicionar manualmente" ───────
    // v1.4.0 — Fase 7: o botão de adicionar manual SEMPRE aparece (mesmo em
    // páginas sem popups detectados), pois modais React state-driven não são
    // visíveis ao scanner. Já o checklist só renderiza se há popups.
    const checklist = document.createElement('div');
    checklist.className = 'popup-checklist';
    checklist.dataset.pagIdx = idx;

    if(temPopups) {
      const headerCl = document.createElement('div');
      headerCl.className = `popup-checklist-header ${todosConcluidos ? 'todos-ok' : 'tem-pendente'}`;
      headerCl.textContent = todosConcluidos
        ? `✓ ${capturados} popup${capturados>1?'s':''} capturado${capturados>1?'s':''}${pulados>0?` · ${pulados} pulado${pulados>1?'s':''}`:''}`
        : `📌 Popups lazy — ${pendentes} pendente${pendentes>1?'s':''} de ${totalPop}`;
      checklist.appendChild(headerCl);

      pag.popups_pendentes.forEach((popup, popIdx) => {
        const item = document.createElement('div');
        item.className = `popup-item popup-item--${popup.status}`;

        const icone = popup.status === 'capturado' ? '☑' : popup.status === 'pulado' ? '—' :
                      popup.status === 'capturando' ? '◐' : '☐';
        const resultadoHtml = popup.status === 'capturado'
          ? `<span class="popup-item-resultado">${popup._resultado_resumo || 'capturado'}</span>` : '';
        const origemBadge = popup.origem === 'manual'
          ? '<span class="popup-item-origem" title="Adicionado manualmente">M</span>' : '';

        // v1.4.2 — checklist secundário é somente-leitura. Os botões
        // [Capturar]/[Check]/[Pular] ficam apenas no bloco prioritário no
        // topo da aba. Aqui mostramos só o estado da tarefa.
        item.innerHTML = `
          <span class="popup-item-icone">${icone}</span>
          <span class="popup-item-texto" title="${popup.abridor_texto||''}">${popup.abridor_texto||'popup'}${origemBadge}</span>
          ${resultadoHtml}
        `;
        checklist.appendChild(item);
      });
    }

    // Sempre: botão "+ Adicionar popup manualmente". Form inline expansível.
    if(pag._popupManualForm) {
      const form = document.createElement('div');
      form.className = 'popup-manual-form';
      form.innerHTML = `
        <input type="text" class="pm-texto" data-pag-idx="${idx}" placeholder="Texto do botão (ex: Adicionar endereço)" value="${pag._popupManualForm.texto || ''}">
        <input type="text" class="pm-seletor" data-pag-idx="${idx}" placeholder="Seletor CSS do botão (ex: [data-testid='address-modal-trigger'])" value="${pag._popupManualForm.seletor || ''}">
        <div class="popup-manual-form-acoes">
          <button class="btn-pm-confirmar" data-pag-idx="${idx}">Confirmar</button>
          <button class="btn-pm-cancelar"  data-pag-idx="${idx}">Cancelar</button>
        </div>
      `;
      checklist.appendChild(form);
    } else {
      const btnAddManual = document.createElement('button');
      btnAddManual.className = 'btn-add-popup-manual';
      btnAddManual.dataset.pagIdx = idx;
      btnAddManual.textContent = '＋ Adicionar popup manualmente';
      checklist.appendChild(btnAddManual);
    }

    card.appendChild(checklist);

    lista.appendChild(card);
  });

  lista.querySelectorAll('.pagina-remover').forEach(btn => {
    btn.addEventListener('click', async () => {
      const s=await storage.get(); if(!s) return;
      s.paginas.splice(parseInt(btn.dataset.idx),1);
      await storage.set(s); renderSessao(s);
    });
  });

  // v1.6.0 — Feature C3: atualizar soft-warn de tamanho do JSON exportado
  try { atualizarAvisoTamanho(sessao); } catch(_){}
}

// ─────────────────────────────────────────────────────────────────────────────
// MONTAR JSON FINAL DA SESSÃO
// ─────────────────────────────────────────────────────────────────────────────
// v1.6.0 — Feature C2: Helpers de compactação do JSON exportado.
// Filosofia: o JSON descreve o que EXISTE no DOM. Atributos vazios são
// "ausentes" — interpretação implícita. Aplicar SÓ no export (montarJsonSessao),
// nunca no storage interno nem no popup, pra preservar acesso direto a campos.
//
// O que conta como "vazio": '', null, undefined, [], {}.
// Booleans `false` NÃO são vazios — `disabled: false` é informação válida
// distinta de "disabled não verificado".
function _vfmVazio(v) {
  if(v === '' || v === null || v === undefined) return true;
  if(Array.isArray(v) && v.length === 0) return true;
  if(typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) return true;
  return false;
}
function _vfmCompactar(obj, criticos) {
  if(!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const out = {};
  const set = criticos instanceof Set ? criticos : new Set(criticos || []);
  for(const [k, v] of Object.entries(obj)) {
    // v1.6.0 — Feature C2: chaves prefixadas com `_` são flags internas
    // (ex: _link_externo_contato, _popupManualForm) — nunca exportadas.
    if(k.startsWith('_')) continue;
    // v1.6.1 — Feature D6: omitir `tamanho` quando ambas dimensões são 0
    // (elementos invisíveis poluem ~412 linhas no Puzl, ~80 no CREA).
    if(k === 'tamanho' && v && typeof v === 'object' &&
       (v.h === 0 || v.h === undefined) &&
       (v.w === 0 || v.w === undefined)) continue;
    if(set.has(k)) { out[k] = v; continue; }
    if(_vfmVazio(v)) continue;
    out[k] = v;
  }
  return out;
}
// Campos que SEMPRE aparecem mesmo vazios (integridade de schema downstream)
const _VFM_CRITICOS_CAMPO  = new Set(['tipo_elemento', 'seletor_playwright', 'type']);
const _VFM_CRITICOS_BOTAO  = new Set(['tipo', 'texto', 'seletor_playwright']);
const _VFM_CRITICOS_GRID   = new Set(['tipo']);
const _VFM_CRITICOS_MODAL  = new Set(['tipo', 'seletor']);
const _VFM_CRITICOS_FEED   = new Set(['tipo']);
const _VFM_CRITICOS_ESTAT  = new Set(['tipo']);

function montarJsonSessao(sessao) {
  // v1.6.0 — Feature C2: compactar listas de entidades no momento do export.
  // Páginas raiz, cascade_maps e estruturas de protocolo (popups_pendentes,
  // popups_capturados) preservam todos os campos.
  const compactarLista = (lista, criticos) =>
    Array.isArray(lista) ? lista.map(item => _vfmCompactar(item, criticos)) : lista;

  // v1.6.1 — Feature D9.5: endpoints_dinamicos no nível da sessão.
  // Converte cada endpoint capturado pelo interceptor em formato exportável
  // com `opcoes` como Array de 2-tuplas [text, value] (consistente com C1).
  const endpointsExport = {};
  for(const [endpoint, info] of Object.entries(sessao.endpoints_dinamicos || {})) {
    const opcoesArr = Object.entries(info.opcoes || {}).map(([val, txt]) => [txt, val]);
    endpointsExport[endpoint] = {
      parametro_query: info.parametro_query || 'q',
      min_caracteres: info.min_caracteres || null,
      metodo: info.metodo || 'GET',
      total_opcoes_capturadas: opcoesArr.length,
      total_buscas_realizadas: info.total_buscas || 0,
      cobertura: 'amostra_passiva',
      opcoes: opcoesArr,
    };
  }

  return {
    schema_version: '3.7',
    projeto: sessao.nome,
    criado_em: sessao.criada_em,
    exportado_em: new Date().toISOString(),
    total_paginas: sessao.paginas.length,
    endpoints_dinamicos: endpointsExport,                  // v1.6.1 D9.5
    paginas: sessao.paginas.map((p,i) => ({
      indice: i+1,
      schema_version: p.schema_version || '1.0',
      meta: p.meta,
      tipo_pagina: p.tipo_pagina,
      frameworks: p.frameworks,
      spa_detection: p.spa_detection,
      // v1.6.0 C2: compactação aplicada em listas de entidades
      grids: compactarLista(p.grids, _VFM_CRITICOS_GRID),
      feeds: compactarLista(p.feeds || [], _VFM_CRITICOS_FEED),
      campos_estaticos: compactarLista(p.campos_estaticos || [], _VFM_CRITICOS_ESTAT),
      cascade_candidatos: p.cascade_candidatos || [],      // v1.6.0 Feature A1
      cascade_maps:     p.cascade_maps     || {},          // v1.5.0/1.6.0 — preservar estrutura
      formulario: p.formulario ? {
        ...p.formulario,
        campos: compactarLista(p.formulario.campos || [], _VFM_CRITICOS_CAMPO),
      } : p.formulario,
      botoes_acao: compactarLista(p.botoes_acao, _VFM_CRITICOS_BOTAO),
      modais_popups: compactarLista(p.modais_popups, _VFM_CRITICOS_MODAL),
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

// v1.4.1 — Atualiza a preview "Página atual" no topo do painel.
// Em modo Side Panel o painel permanece aberto enquanto o usuário navega,
// então essa função precisa ser chamada toda vez que a aba ativa muda OU
// quando a URL/título da aba atual mudam. Em modo popup tradicional, é
// chamada apenas uma vez no init.
async function atualizarPreviewAbaAtual() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if(!tab) return;
    if(tab.url) {
      const u = formatUrl(tab.url);
      $('footer-url').textContent = $('footer-url').title = u;
      $('atual-url').textContent = u;
    }
    $('atual-titulo').textContent = tab.title || 'Sem título';
  } catch(_) { /* aba pode ter fechado entre query e leitura */ }
}

async function init() {
  await atualizarPreviewAbaAtual();
  const sessao=await storage.get();
  if(sessao?.nome) $('sessao-nome').value=sessao.nome;
  // Limpar estado transient _popupManualForm de qualquer página
  // (ele não deve persistir entre aberturas do popup da extensão)
  if(sessao?.paginas) {
    let mudou = false;
    sessao.paginas.forEach(p => {
      if(p._popupManualForm) { delete p._popupManualForm; mudou = true; }
    });
    if(mudou) await storage.set(sessao);
  }
  renderSessao(sessao);
}
init();

// v1.4.1 — Live update da preview no Side Panel.
// onActivated dispara quando o usuário troca de aba;
// onUpdated dispara quando a aba atual carrega nova URL/título.
// Sem permission "tabs" no manifest, tab.title viria vazio — por isso o
// manifest da v1.4.1 adiciona "tabs" às permissões.
if(chrome.tabs?.onActivated) {
  chrome.tabs.onActivated.addListener(() => { atualizarPreviewAbaAtual(); });
}
if(chrome.tabs?.onUpdated) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Só re-render se a aba que mudou é a aba ativa da janela do painel
    if(tab && tab.active && (changeInfo.url || changeInfo.title || changeInfo.status === 'complete')) {
      atualizarPreviewAbaAtual();
    }
  });
}

// v1.6.1 — Feature D9.4: tick de atualização ao vivo dos contadores de
// autocomplete remoto. A cada 2s, lê window.__vfm_opcoes_capturadas da aba
// ativa e atualiza os elementos `.ac-contador` no DOM da extensão.
// Roda só quando há pelo menos um aviso de autocomplete visível.
setInterval(async () => {
  const contadores = document.querySelectorAll('.ac-contador[data-endpoint-key]');
  if(contadores.length === 0) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if(!tab?.id) return;
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scriptLerOpcoesCapturadas,
      world: 'MAIN',
    });
    const endpoints = res?.result?.endpoints || {};
    contadores.forEach(el => {
      const key = el.dataset.endpointKey;
      // Se o campo ainda não tem endpoint_ref vinculado, varrer todos e usar o maior
      let info;
      if(key && endpoints[key]) {
        info = endpoints[key];
      } else {
        // Pega o primeiro endpoint com opções (heurística enquanto não vincula)
        const todos = Object.values(endpoints).filter(e => e.total_unicas > 0);
        if(todos.length === 1) info = todos[0];
      }
      if(info) {
        el.innerHTML = `Opções capturadas: <strong>${info.total_unicas} únicas</strong> (${info.total_buscas} buscas)`;
      }
    });
  } catch(_){}
}, 2000);

// ─────────────────────────────────────────────────────────────────────────────
// EVENTOS — SESSÃO
// ─────────────────────────────────────────────────────────────────────────────
$('btn-adicionar').addEventListener('click', async () => {
  // v1.6.0 — Feature A7: Mutex contra duplo-clique e cascade em andamento
  if(window.__vfm_cascade_em_andamento) {
    setStatus('sessao-status', '⏳ Já está rodando — aguarde a captura terminar.', 'warn');
    return;
  }
  window.__vfm_cascade_em_andamento = true;

  const nome=slugify($('sessao-nome').value);
  const desc=($('sessao-desc').value||'').trim();
  const btn=$('btn-adicionar');
  btn.disabled=true; btn.innerHTML='<span class="spin">⬡</span> Reconhecendo...';
  clearStatus('sessao-status');

  // Barra de progresso fina abaixo do botão (Feature A8)
  const progressBar = $('cascade-progress-bar');
  if(progressBar) { progressBar.style.display = 'none'; progressBar.style.width = '0%'; }

  try {
    // v1.6.1 — Feature D9.3: instalar interceptor de fetch/XHR ANTES do scan.
    // O guard `window.__vfm_interceptor_instalado` evita reinstalação se já existe.
    // Roda em world:'MAIN' para hookar o fetch real da página.
    try {
      const [tabAtual] = await chrome.tabs.query({ active: true, currentWindow: true });
      if(tabAtual?.id) {
        await chrome.scripting.executeScript({
          target: { tabId: tabAtual.id },
          func: scriptInterceptorAutocomplete,
          world: 'MAIN',
        });
      }
    } catch(_){}

    const {dados,tab} = await executarScript({
      incluirHidden:true,
      incluirDisabled:false,
      incluirCookies:false,
      incluirAjax:true,
      waitSpaMs: $('opt-wait-spa')?.checked ? 3000 : 0,
    });

    // ── v1.6.0 — Feature A7: Cascade como fase atômica do fluxo ──────────────
    // Se há candidatos a cascade E o usuário NÃO marcou "pular", roda o mapper
    // antes de salvar a página. Resultado: ou entra completa, ou não entra.
    const pularCascade = $('chk-pular-cascade')?.checked;
    const candidatos   = dados.cascade_candidatos || [];

    if(candidatos.length > 0 && !pularCascade) {
      const urlNoInicio = tab.url;
      btn.innerHTML = `<span class="spin">⬡</span> Iniciando ${candidatos.length} cascade(s)...`;
      if(progressBar) { progressBar.style.display = 'block'; progressBar.style.width = '0%'; }

      const resCascade = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func:   scriptCascadesMapper,
        args:   [candidatos],
        world:  'MAIN',
      });
      const outCascade = resCascade?.[0]?.result || { cascade_maps: {}, total_pais: 0 };

      // Detectar navegação durante o cascade — descartar tudo (atomicidade)
      const [tabAgora] = await chrome.tabs.query({ active: true, currentWindow: true });
      if(tabAgora?.url !== urlNoInicio) {
        alert('⚠ Captura abortada — a aba navegou durante o mapeamento de cascade.\n\n' +
              'A página NÃO foi adicionada à sessão. Volte à página original e tente de novo.');
        return; // sem salvar nada
      }

      dados.cascade_maps = outCascade.cascade_maps || {};
    } else {
      dados.cascade_maps = {};
    }

    // ── v1.6.1 — Feature D9.5: Ler opções capturadas e mergear na sessão ─────
    // O interceptor instalado no início acumulou tudo que a página chamou via
    // fetch/XHR. Filtramos só os endpoints que correspondem a campos `ajax_remote`
    // mapeados nesta página (estrutural: olhamos `data-ajax--url` ou último
    // endpoint AJAX visto perto do campo) e mergeamos com sessao.endpoints_dinamicos.
    let endpointsCapturadosNoScan = {};
    try {
      const resOp = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: scriptLerOpcoesCapturadas,
        world: 'MAIN',
      });
      endpointsCapturadosNoScan = resOp?.[0]?.result?.endpoints || {};
    } catch(_){}

    let sessao=await storage.get();
    if(!sessao||sessao.nome!==nome) sessao={nome,criada_em:new Date().toISOString(),paginas:[]};
    sessao.endpoints_dinamicos = sessao.endpoints_dinamicos || {};

    // Enriquecer com meta
    dados.meta = {
      descricao: desc || dados.titulo || `Página ${sessao.paginas.length+1}`,
      projeto: nome,
      url: dados.url,
      titulo: dados.titulo,
      capturado_em: dados.timestamp,
    };

    // v1.6.1 D9.5: merge dos endpoints capturados na sessão (acumulativo entre
    // páginas). Mesma URL = mesma entrada, opcoes acumuladas sem duplicação.
    for(const [endpoint, info] of Object.entries(endpointsCapturadosNoScan)) {
      if(!sessao.endpoints_dinamicos[endpoint]) {
        sessao.endpoints_dinamicos[endpoint] = {
          opcoes: {},
          total_buscas: 0,
          min_caracteres: null,
          parametro_query: 'q',
          metodo: 'GET',
        };
      }
      const acc = sessao.endpoints_dinamicos[endpoint];
      // Merge: chave value → text. Não sobrescreve se já existe.
      for(const [val, txt] of Object.entries(info.opcoes || {})) {
        if(!acc.opcoes[val]) acc.opcoes[val] = txt;
      }
      acc.total_buscas = (acc.total_buscas || 0) + (info.total_buscas || 0);
      // Inferir parametro_query da última busca registrada
      const ultBusca = info.buscas_amostra?.[info.buscas_amostra.length - 1];
      if(ultBusca?.params) {
        // Heurística estrutural: parâmetro mais longo (texto digitado) costuma ser o query
        const candidatos = Object.entries(ultBusca.params)
          .filter(([k, v]) => v && v.length >= 1 && v.length <= 80);
        if(candidatos.length > 0) {
          // Pega o primeiro parâmetro não trivial
          const [pq] = candidatos.find(([k]) => /^(q|query|search|term|busca|texto|filter)$/i.test(k))
                       || candidatos[0];
          if(pq && !acc.parametro_query) acc.parametro_query = pq;
        }
      }
    }

    // v1.6.1 D9.5: vincular cada campo `ajax_remote` ao endpoint provável.
    // Heurística estrutural: pegar o endpoint capturado mais recentemente
    // que ainda não está vinculado a outro campo desta página.
    const camposAjax = (dados.formulario?.campos || []).filter(c => c.tipo_input_dinamico === 'ajax_remote');
    if(camposAjax.length > 0) {
      const endpointsDisponiveis = Object.keys(endpointsCapturadosNoScan);
      camposAjax.forEach((campo, idx) => {
        // Vincula pela ordem se houver apenas 1; caso múltiplos, deixa para o
        // protocolar.py distinguir pelo seletor. Conservador: só preenche
        // endpoint_ref quando há exatamente 1 endpoint capturado disponível.
        if(endpointsDisponiveis.length === 1) {
          campo.endpoint_ref = endpointsDisponiveis[0];
        } else if(endpointsDisponiveis[idx]) {
          campo.endpoint_ref = endpointsDisponiveis[idx];
        }
      });
    }

    sessao.paginas.push(dados);

    // ── Preencher popups_pendentes a partir de acoes_recomendadas ─────────────
    const acoesPendentes = dados.resumo?.acoes_recomendadas || [];
    dados.popups_pendentes = acoesPendentes.map((a, i) => ({
      id: `popup_lazy_${a.handler_backend || 'unknown'}${a.extra_data ? '_' + a.extra_data.replace(/[^a-z0-9]/gi,'_') : ''}_${i}`,
      origem: 'detectado',                              // v1.4.0 — distingue auto vs manual
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
    const cascadeNota = (dados.cascade_maps && Object.keys(dados.cascade_maps).length > 0)
      ? ` · ${Object.keys(dados.cascade_maps).length} cascade(s) mapeado(s)`
      : (candidatos.length > 0 && pularCascade ? ` · cascade pulado` : '');
    setStatus('sessao-status',
      `✓ Adicionada — ${tipo} · ${dados.grids.length} grid(s) · ${dados.formulario.campos.length} campos${cascadeNota} | ${gng.motivo}`,
      gng.status==='go'?'ok':gng.status==='nogo'?'erro':'warn'
    );
    $('sessao-desc').value=''; // limpar descrição para próxima página

  } catch(err) {
    setStatus('sessao-status',`Erro: ${err.message}`,'erro');
  } finally {
    window.__vfm_cascade_em_andamento = false;            // libera o mutex
    btn.disabled=false; btn.innerHTML='<span>＋</span> Adicionar esta página à sessão';
    if(progressBar) { progressBar.style.display = 'none'; progressBar.style.width = '0%'; }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// v1.5.0 — Feature 1: Cascade select mapper (opt-in)
// ─────────────────────────────────────────────────────────────────────────────
// Itera por cada opção de cada <select> da página e detecta selects "filhos"
// cujas opções mudam após o disparo do evento 'change'. Para cada par pai→filho
// detectado, captura o mapa completo opção→opções_filhas. Operação custosa
// (N opções × ~1s de delay AJAX), por isso é opt-in via botão dedicado.
//
// A função abaixo é INJETADA na aba alvo via chrome.scripting.executeScript.
// Ela posta mensagens de progresso via chrome.runtime.sendMessage; o popup
// (este arquivo) escuta e atualiza #cascade-progress em tempo real.

// ─────────────────────────────────────────────────────────────────────────────
// v1.6.1 — Feature D9.3: Interceptor de fetch/XHR para autocomplete remoto.
// ─────────────────────────────────────────────────────────────────────────────
// Injetado em world:'MAIN' UMA vez por aba. Guarda toda resposta JSON que
// pareça lista (Array<>, {results:[]}, {items:[]}, {data:[]}) em
// `window.__vfm_opcoes_capturadas`, indexada por endpoint base. Conforme o
// usuário interage com a página naturalmente, as opções acumulam.
// O scanner lê esse acumulador no fluxo de "Adicionar à sessão" e mergea
// com `sessao.endpoints_dinamicos`.

function scriptInterceptorAutocomplete() {
  if(window.__vfm_interceptor_instalado) {
    return { ja_instalado: true, capturados: Object.keys(window.__vfm_opcoes_capturadas || {}).length };
  }
  window.__vfm_interceptor_instalado = true;
  window.__vfm_opcoes_capturadas = window.__vfm_opcoes_capturadas || {};

  // Heurística estrutural: ignorar URLs de telemetria/analytics
  const RX_IGNORAR = /(google-analytics|googletagmanager|gtag|hotjar|fullstory|sentry|datadog|newrelic|facebook\.com|doubleclick)/i;
  // Mínimo de itens em uma resposta para considerar relevante
  const MIN_ITENS = 1;

  function extrairBaseEndpoint(urlCompleta) {
    try {
      const u = new URL(urlCompleta, location.href);
      return u.origin + u.pathname; // sem query string
    } catch(_) { return null; }
  }

  function armazenarOpcoes(urlCompleta, dadosBruto) {
    if(!urlCompleta || !dadosBruto) return;
    if(RX_IGNORAR.test(urlCompleta)) return;
    const arr = Array.isArray(dadosBruto) ? dadosBruto :
                Array.isArray(dadosBruto?.results) ? dadosBruto.results :
                Array.isArray(dadosBruto?.items)   ? dadosBruto.items :
                Array.isArray(dadosBruto?.data)    ? dadosBruto.data :
                Array.isArray(dadosBruto?.records) ? dadosBruto.records : null;
    if(!arr || arr.length < MIN_ITENS) return;

    const endpointBase = extrairBaseEndpoint(urlCompleta);
    if(!endpointBase) return;
    if(!window.__vfm_opcoes_capturadas[endpointBase]) {
      window.__vfm_opcoes_capturadas[endpointBase] = { opcoes: {}, buscas: [], total_unicas: 0 };
    }
    const store = window.__vfm_opcoes_capturadas[endpointBase];
    // Detectar campos text/value de forma estrutural
    let novos = 0;
    arr.forEach(item => {
      if(!item || typeof item !== 'object') return;
      const text  = item.text || item.label || item.nome || item.name ||
                    item.descricao || item.description || item.title || JSON.stringify(item).substring(0,80);
      const value = item.value !== undefined ? item.value :
                    item.id !== undefined    ? item.id :
                    item.codigo !== undefined ? item.codigo :
                    item.key !== undefined   ? item.key : text;
      if(text === undefined || text === null) return;
      const chave = String(value);
      if(!store.opcoes[chave]) { store.opcoes[chave] = String(text).substring(0,200); novos++; }
    });
    store.total_unicas = Object.keys(store.opcoes).length;

    // Registrar query usada para auditoria (até 100 buscas por endpoint)
    try {
      const u = new URL(urlCompleta, location.href);
      const params = {};
      u.searchParams.forEach((v, k) => { params[k] = v.substring(0,40); });
      store.buscas.push({ ts: Date.now(), params, n_retornados: arr.length, novos });
      if(store.buscas.length > 100) store.buscas.shift();
    } catch(_){}
  }

  // Hook fetch
  const fetchOriginal = window.fetch;
  window.fetch = async function(...args) {
    const resposta = await fetchOriginal.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
      const ct = resposta.headers?.get?.('content-type') || '';
      if(url && /json/i.test(ct)) {
        const clone = resposta.clone();
        clone.json().then(dados => armazenarOpcoes(url, dados)).catch(() => {});
      }
    } catch(_){}
    return resposta;
  };

  // Hook XHR
  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__vfm_url = url;
    return xhrOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function(...args) {
    this.addEventListener('load', () => {
      try {
        const ct = this.getResponseHeader('content-type') || '';
        if(this.__vfm_url && /json/i.test(ct) && this.responseText) {
          const dados = JSON.parse(this.responseText);
          armazenarOpcoes(this.__vfm_url, dados);
        }
      } catch(_){}
    });
    return xhrSend.apply(this, args);
  };

  return { instalado: true, capturados: 0 };
}

// v1.6.1 — Lê o estado atual do interceptor (window.__vfm_opcoes_capturadas)
// e retorna apenas snapshot serializável.
function scriptLerOpcoesCapturadas() {
  if(!window.__vfm_interceptor_instalado) return { instalado: false, endpoints: {} };
  const cap = window.__vfm_opcoes_capturadas || {};
  const out = {};
  for(const [endpoint, store] of Object.entries(cap)) {
    out[endpoint] = {
      total_unicas: store.total_unicas || Object.keys(store.opcoes || {}).length,
      total_buscas: (store.buscas || []).length,
      opcoes: store.opcoes || {},
      buscas_amostra: (store.buscas || []).slice(-5), // últimas 5 buscas
    };
  }
  return { instalado: true, endpoints: out };
}

// ─────────────────────────────────────────────────────────────────────────────
// v1.5.0/v1.6.0 — Cascade select mapper (endurecido).
// ─────────────────────────────────────────────────────────────────────────────
// v1.5.0 introduziu o mapper opt-in com sleep fixo de 700ms (30% de falha
// em testes na Caixa Imóveis devido à latência AJAX variável).
//
// v1.6.0 reescreve por completo:
//  - Feature A2: aguardarMudancaFilho com snapshots INICIAL (imutável,
//    referência de comparação) vs ULTIMO (rastreia mudanças). Estabilização
//    exige 200ms sem nova mudança E valor diferente do inicial.
//  - Feature A3: resetarPai antes de cada iteração (evita contaminação).
//  - Feature A4: re-query do pai a cada iteração (sobrevive a re-renders
//    parciais) + early-abort se 3 primeiras iterações falham (falso positivo).
//  - Feature A5: 2ª passada com timeout dobrado para itens falhados.
//  - Feature A6: snapshot+restore do estado do form para preservar UX.
//  - Feature A8: enviarProgresso estruturado (passada/atual/total/valorAtual).
//
// Assinatura:
//   await scriptCascadesMapper(candidatos)
// - candidatos array com itens → modo Feature A1 (pré-detectados)
// - candidatos null/[] → modo legado (re-mapear: varre todos os selects)

async function scriptCascadesMapper(candidatos) {
  // ── Helpers de progresso ────────────────────────────────────────────────────
  function enviarProgresso(payload) {
    try { chrome.runtime.sendMessage({ tipo: 'vfm-cascade-progress-struct', ...payload }); } catch(_){}
  }
  function progressoTexto(mensagem) {
    try { chrome.runtime.sendMessage({ tipo: 'vfm-cascade-progress', texto: mensagem }); } catch(_){}
  }

  const isPlaceholderValue = v =>
    !v || v === '' || /^(selecione|escolha|---?|0)$/i.test(String(v).trim());

  function dispararChange(el) {
    try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch(_){}
    try { if(window.jQuery) window.jQuery(el).trigger('change'); } catch(_){}
  }

  // ── Feature A2: wait condicional com snapshots inicial vs último ────────────
  async function aguardarMudancaFilho(filhoSeletor, snapshotInicial, timeoutMs = 5000) {
    const snapshot = () => {
      const el = document.querySelector(filhoSeletor);
      if(!el) return null;
      return JSON.stringify([...el.options].map(o => o.value));
    };
    const t0 = Date.now();
    let snapshotUltimo = snapshotInicial;
    let momentoDaUltimaMudanca = null;

    while(Date.now() - t0 < timeoutMs) {
      await new Promise(r => setTimeout(r, 100));
      const atual = snapshot();
      if(atual === null) continue; // filho temporariamente detached — esperar voltar

      if(atual !== snapshotUltimo) {
        snapshotUltimo = atual;
        momentoDaUltimaMudanca = Date.now();
        continue;
      }
      // Estável neste tick
      if(momentoDaUltimaMudanca !== null && Date.now() - momentoDaUltimaMudanca >= 200) {
        // E o snapshot atual precisa ser DIFERENTE do inicial (proteção
        // contra falso positivo onde o select voltou ao estado inicial)
        if(atual !== snapshotInicial) {
          return { ok: true, snapshotFinal: atual, tempoMs: Date.now() - t0 };
        }
        return { ok: false, motivo: 'sem_mudanca_real', tempoMs: Date.now() - t0 };
      }
    }
    return { ok: false, motivo: 'timeout', tempoMs: Date.now() - t0 };
  }

  // ── Feature A3: reset do pai antes de iterar ────────────────────────────────
  async function resetarPai(paiSeletor, filhoSeletor) {
    const pai = document.querySelector(paiSeletor);
    if(!pai) return false;
    const filho = document.querySelector(filhoSeletor);
    const snapAntes = filho
      ? JSON.stringify([...filho.options].map(o => o.value))
      : '[]';
    try { pai.value = ''; } catch(_){}
    dispararChange(pai);
    // Timeout curto — não importa se 'ok'; queremos só dar tempo de limpar
    await aguardarMudancaFilho(filhoSeletor, snapAntes, 1500);
    await new Promise(r => setTimeout(r, 100));
    return true;
  }

  // ── Feature A6: snapshot e restore do estado do form ────────────────────────
  function snapshotEstadoForm(form) {
    const estado = [];
    if(!form) return estado;
    form.querySelectorAll('select, input, textarea').forEach(el => {
      const v = (el.type === 'checkbox' || el.type === 'radio') ? el.checked : el.value;
      estado.push({ el, valor: v, tipo: el.type });
    });
    return estado;
  }
  function restaurarEstadoForm(estado) {
    if(!Array.isArray(estado)) return;
    for(const { el, valor, tipo } of estado) {
      if(!el.isConnected) continue;
      try {
        if(tipo === 'checkbox' || tipo === 'radio') el.checked = valor;
        else el.value = valor;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } catch(_){}
    }
  }

  // ── Feature A4: iterar 1 cascade com re-query e early-abort ─────────────────
  async function iterarCascade(candidato, passada, timeoutPorIteracao) {
    const seletorPai   = candidato.seletor_pai;
    const filhoSeletor = candidato.filhos_potenciais[0];
    const filhosTodos  = candidato.filhos_potenciais.map(s => document.querySelector(s)).filter(Boolean);
    const idPai = (() => {
      const p = document.querySelector(seletorPai);
      return p?.id || p?.name || seletorPai;
    })();

    // Snapshot dos values do pai ANTES de qualquer mutação (lista imutável)
    const valoresPai = (() => {
      const pai = document.querySelector(seletorPai);
      if(!pai) return [];
      return [...pai.options].filter(o => !isPlaceholderValue(o.value)).map(o => o.value);
    })();

    const mapaOpcoes = {};
    const valoresFalhados = [];
    let falhasConsecutivasIniciais = 0;
    let timeoutsConsecutivos = 0;                              // v1.6.1 D4
    const TIMEOUTS_CONSECUTIVOS_LIMITE = 3;

    for(let i = 0; i < valoresPai.length; i++) {
      const valor = valoresPai[i];

      // Re-resolver pai a cada iteração (proteção contra detached em re-render)
      let pai = document.querySelector(seletorPai);
      if(!pai) {
        return { ok: false, motivo: 'pai_desapareceu', mapaOpcoes, valoresFalhados, idPai };
      }

      // Feature A3: reset antes de cada iteração
      await resetarPai(seletorPai, filhoSeletor);
      pai = document.querySelector(seletorPai);
      if(!pai) return { ok: false, motivo: 'pai_desapareceu', mapaOpcoes, valoresFalhados, idPai };

      const filho = document.querySelector(filhoSeletor);
      if(!filho) {
        return { ok: false, motivo: 'filho_desapareceu', mapaOpcoes, valoresFalhados, idPai };
      }

      // Texto da opção: pega do array DOM atual; se não bater, usa o value
      const opcoesAtual = [...pai.options];
      const optMatch = opcoesAtual.find(o => o.value === valor);
      const chave = (optMatch?.text || valor).trim();

      enviarProgresso({
        passada,
        atual: i + 1,
        total: valoresPai.length,
        valorAtual: chave,
        idPai,
      });

      const snapAntes = JSON.stringify([...filho.options].map(o => o.value));
      try { pai.value = valor; } catch(_){}
      dispararChange(pai);

      const r = await aguardarMudancaFilho(filhoSeletor, snapAntes, timeoutPorIteracao);
      const filhoFinal = document.querySelector(filhoSeletor);

      if(r.ok && filhoFinal) {
        // v1.6.0 — Feature C1: opcoes como 2-tuplas [text,value] reduz ~80%
        // o espaço ocupado no JSON exportado (vs Array<{text,value}>).
        const opcoesCapturadas = [...filhoFinal.options]
          .filter(o => !isPlaceholderValue(o.value))
          .map(o => [o.text.trim(), o.value]);
        mapaOpcoes[chave] = {
          opcoes: opcoesCapturadas,
          erro: null,
          tempo_ms: r.tempoMs,
          passada,
          definitivo: false,
        };
        // v1.6.1 — Feature D5: marcar 0 opções com resposta rápida como suspeito
        // (servidor pode estar com bug/cache invalidado — não é timeout, mas é
        // estranho responder vazio em <500ms quando outras opções retornam dados).
        if(opcoesCapturadas.length === 0 && r.tempoMs < 500) {
          mapaOpcoes[chave].suspeito_zero_opcoes = true;
          mapaOpcoes[chave].motivo_suspeita = 'resposta rápida sem timeout retornou 0 opções — possível bug servidor ou cache invalidado';
        }
        falhasConsecutivasIniciais = 0;
        timeoutsConsecutivos = 0;                              // v1.6.1 D4: resetar
      } else {
        mapaOpcoes[chave] = {
          opcoes: [],
          erro: r.motivo,
          tempo_ms: r.tempoMs,
          passada,
          definitivo: false,
        };
        valoresFalhados.push(valor);

        // v1.6.1 — Feature D4: abortar candidato após N timeouts consecutivos
        // EM QUALQUER PONTO do loop (não só nas 3 primeiras iterações).
        // Caso real Caixa: cmb_financiamento → cmb_cidade desperdiçou 36,7s em
        // timeouts; cmb_modalidade desperdiçou 74,4s. Aborto economiza esse tempo.
        if(r.motivo === 'timeout') {
          timeoutsConsecutivos++;
          if(timeoutsConsecutivos >= TIMEOUTS_CONSECUTIVOS_LIMITE) {
            return {
              ok: false,
              motivo: 'timeouts_consecutivos',
              motivo_abort: `${TIMEOUTS_CONSECUTIVOS_LIMITE} timeouts consecutivos — pai não dispara mudança no filho`,
              combinacoes_processadas: i + 1,
              combinacoes_puladas: valoresPai.length - (i + 1),
              mapaOpcoes,
              valoresFalhados,
              idPai,
            };
          }
        } else {
          timeoutsConsecutivos = 0;                            // outras falhas não contam para o limite
        }

        // Feature A4: early-abort se as 3 primeiras iterações falharam todas.
        // Indica que o candidato é falso positivo (selects independentes,
        // não cascade real). Melhor descartar agora que perder N×timeout.
        if(i < 3) {
          falhasConsecutivasIniciais++;
          if(falhasConsecutivasIniciais >= 3 && i === 2) {
            return {
              ok: false,
              motivo: 'falso_positivo_candidato',
              mapaOpcoes: {},
              valoresFalhados: [],
              idPai,
              abortado_em: i + 1,
            };
          }
        }
      }
    }

    return { ok: true, mapaOpcoes, valoresFalhados, idPai };
  }

  // ── Feature A5: retry dos falhados com timeout dobrado ──────────────────────
  async function retryFalhados(candidato, mapaOpcoes, valoresFalhados, idPai) {
    if(valoresFalhados.length === 0) return { mapaOpcoes, recuperadas: 0 };
    progressoTexto(`Retry de ${valoresFalhados.length} item(s) que falharam…`);
    let recuperadas = 0;

    for(let i = 0; i < valoresFalhados.length; i++) {
      const valor = valoresFalhados[i];
      await resetarPai(candidato.seletor_pai, candidato.filhos_potenciais[0]);

      const pai = document.querySelector(candidato.seletor_pai);
      const filho = document.querySelector(candidato.filhos_potenciais[0]);
      if(!pai || !filho) break;

      const optMatch = [...pai.options].find(o => o.value === valor);
      const chave = (optMatch?.text || valor).trim();

      enviarProgresso({
        passada: 2,
        atual: i + 1,
        total: valoresFalhados.length,
        valorAtual: chave,
        idPai,
      });

      const snapAntes = JSON.stringify([...filho.options].map(o => o.value));
      try { pai.value = valor; } catch(_){}
      dispararChange(pai);

      const r = await aguardarMudancaFilho(candidato.filhos_potenciais[0], snapAntes, 10000);
      const filhoFinal = document.querySelector(candidato.filhos_potenciais[0]);

      if(r.ok && filhoFinal) {
        // v1.6.0 — Feature C1: 2-tuplas (consistente com 1ª passada)
        const opcoesCapturadas = [...filhoFinal.options]
          .filter(o => !isPlaceholderValue(o.value))
          .map(o => [o.text.trim(), o.value]);
        mapaOpcoes[chave] = {
          opcoes: opcoesCapturadas,
          erro: null,
          tempo_ms: r.tempoMs,
          passada: 2,
          definitivo: false,
        };
        // v1.6.1 — Feature D5: mesma heurística na 2ª passada
        if(opcoesCapturadas.length === 0 && r.tempoMs < 500) {
          mapaOpcoes[chave].suspeito_zero_opcoes = true;
          mapaOpcoes[chave].motivo_suspeita = 'resposta rápida sem timeout retornou 0 opções — possível bug servidor ou cache invalidado';
        }
        recuperadas++;
      } else {
        // Mantém erro da 1ª passada mas marca como definitivo
        if(mapaOpcoes[chave]) {
          mapaOpcoes[chave].definitivo = true;
          mapaOpcoes[chave].tempo_ms = r.tempoMs;
        }
      }
    }
    return { mapaOpcoes, recuperadas };
  }

  // ── Resolver alvos: passados como argumento OU detecção legada ──────────────
  const cascadeAlvos = [];
  if(Array.isArray(candidatos) && candidatos.length > 0) {
    for(const cand of candidatos) {
      const pai = document.querySelector(cand.seletor_pai);
      if(!pai) continue;
      const filhos = (cand.filhos_potenciais || [])
        .filter(sel => document.querySelector(sel));
      if(filhos.length === 0) continue;
      cascadeAlvos.push({ ...cand, filhos_potenciais: filhos });
    }
  } else {
    // Modo legado (re-mapear): varre selects, probe um a um
    const todosSelects = Array.from(document.querySelectorAll('select'));
    progressoTexto(`Analisando ${todosSelects.length} select(s)…`);
    for(let idxPai = 0; idxPai < todosSelects.length; idxPai++) {
      const sel = todosSelects[idxPai];
      if(!sel.options || sel.options.length < 3) continue;
      const valorOriginal = sel.value;
      const snapshotAntes = todosSelects.map(s => s.options.length);
      const primeira = [...sel.options].find(o => !isPlaceholderValue(o.value));
      if(!primeira) continue;
      try { sel.value = primeira.value; } catch(_){}
      dispararChange(sel);
      await new Promise(r => setTimeout(r, 800));
      const filhos = todosSelects.filter((s, i) =>
        s !== sel && s.options.length !== snapshotAntes[i]
      );
      try { sel.value = valorOriginal; } catch(_){}
      dispararChange(sel);
      await new Promise(r => setTimeout(r, 300));
      if(filhos.length === 0) continue;
      const seletorPai = sel.id ? `#${sel.id}` :
        (sel.name ? `select[name="${sel.name}"]` : `select:nth-of-type(${idxPai+1})`);
      cascadeAlvos.push({
        seletor_pai: seletorPai,
        total_opcoes_pai: sel.options.length,
        filhos_potenciais: filhos.map(f => f.id ? `#${f.id}` :
          (f.name ? `select[name="${f.name}"]` : 'select')),
      });
    }
  }

  if(cascadeAlvos.length === 0) {
    progressoTexto('Nenhum cascade detectado.');
    return { cascade_maps: {}, total_pais: 0 };
  }

  // ── Iterar cada cascade ─────────────────────────────────────────────────────
  const resultado = {};

  for(let iAlvo = 0; iAlvo < cascadeAlvos.length; iAlvo++) {
    const cand = cascadeAlvos[iAlvo];

    // Feature A6: snapshot do form antes de mexer
    const paiEl = document.querySelector(cand.seletor_pai);
    const formPai = paiEl?.closest('form');
    const estadoOriginal = formPai ? snapshotEstadoForm(formPai) : null;

    const tInicio = Date.now();
    progressoTexto(`Cascade ${iAlvo+1}/${cascadeAlvos.length} — ${cand.seletor_pai}…`);

    // 1ª passada
    const r1 = await iterarCascade(cand, 1, 5000);

    // Tratamento de aborts
    if(!r1.ok && r1.motivo === 'falso_positivo_candidato') {
      progressoTexto(`✗ ${cand.seletor_pai} descartado (falso positivo após 3 timeouts iniciais).`);
      // Restaurar estado e seguir para próximo candidato
      if(estadoOriginal) restaurarEstadoForm(estadoOriginal);
      continue;
    }
    if(!r1.ok && (r1.motivo === 'pai_desapareceu' || r1.motivo === 'filho_desapareceu')) {
      // Salvar parcial com aviso
      resultado[r1.idPai || cand.seletor_pai] = {
        seletor_pai: cand.seletor_pai,
        selects_filhos: cand.filhos_potenciais,
        total_combinacoes: Object.keys(r1.mapaOpcoes).length,
        metadata: {
          tempo_total_ms: Date.now() - tInicio,
          passada_1_falhas: r1.valoresFalhados.length,
          passada_2_recuperadas: 0,
          falhas_definitivas: r1.valoresFalhados.length,
          abortado: true,
          motivo_abort: r1.motivo,
        },
        mapa_opcoes: r1.mapaOpcoes,
      };
      if(estadoOriginal) restaurarEstadoForm(estadoOriginal);
      continue;
    }
    // v1.6.1 — Feature D4: aborto por timeouts consecutivos. Salva o que foi
    // processado e marca quantas combinações foram puladas. Útil para casos
    // como cmb_financiamento → cmb_cidade da Caixa (pai não funcional).
    if(!r1.ok && r1.motivo === 'timeouts_consecutivos') {
      progressoTexto(`✗ ${cand.seletor_pai} abortado: ${r1.motivo_abort}`);
      resultado[r1.idPai || cand.seletor_pai] = {
        seletor_pai: cand.seletor_pai,
        selects_filhos: cand.filhos_potenciais,
        total_combinacoes: Object.keys(r1.mapaOpcoes).length,
        metadata: {
          tempo_total_ms: Date.now() - tInicio,
          passada_1_falhas: r1.valoresFalhados.length,
          passada_2_recuperadas: 0,
          falhas_definitivas: r1.valoresFalhados.length,
          abortado: true,
          motivo_abort: r1.motivo_abort || r1.motivo,
          combinacoes_processadas: r1.combinacoes_processadas,
          combinacoes_puladas: r1.combinacoes_puladas,
        },
        mapa_opcoes: r1.mapaOpcoes,
      };
      if(estadoOriginal) restaurarEstadoForm(estadoOriginal);
      continue;
    }

    // Feature A5: retry dos falhados
    const { mapaOpcoes: mapaFinal, recuperadas } = await retryFalhados(
      cand, r1.mapaOpcoes, r1.valoresFalhados, r1.idPai
    );

    resultado[r1.idPai] = {
      seletor_pai: cand.seletor_pai,
      selects_filhos: cand.filhos_potenciais,
      total_combinacoes: Object.keys(mapaFinal).length,
      metadata: {
        tempo_total_ms: Date.now() - tInicio,
        passada_1_falhas: r1.valoresFalhados.length,
        passada_2_recuperadas: recuperadas,
        falhas_definitivas: r1.valoresFalhados.length - recuperadas,
        abortado: false,
        motivo_abort: null,
      },
      mapa_opcoes: mapaFinal,
    };

    // Feature A6: restaurar estado original do form
    if(estadoOriginal) restaurarEstadoForm(estadoOriginal);
  }

  progressoTexto(`✓ Concluído — ${Object.keys(resultado).length} cascade(s) mapeado(s)`);
  return { cascade_maps: resultado, total_pais: Object.keys(resultado).length };
}

// Listener de progresso (popup recebe mensagens do script injetado)
// v1.6.0 — Feature A8: trata progresso estruturado (passada/atual/total)
// E texto livre (compat com modo legado do re-mapear).
chrome.runtime.onMessage.addListener((msg) => {
  if(!msg) return;
  if(msg.tipo === 'vfm-cascade-progress') {
    const el = $('cascade-progress');
    if(el) { el.style.display = 'block'; el.textContent = msg.texto; }
  }
  if(msg.tipo === 'vfm-cascade-progress-struct') {
    const btn = $('btn-adicionar');
    const bar = $('cascade-progress-bar');
    const sufixo = msg.passada === 2 ? ' (retry)' : '';
    if(btn && btn.disabled) {
      btn.innerHTML = `<span class="spin">⬡</span> Cascade ${msg.atual}/${msg.total} — ${msg.valorAtual || ''}${sufixo}`;
    }
    if(bar && msg.total > 0) {
      bar.style.display = 'block';
      bar.style.width = `${Math.min(100, (msg.atual / msg.total) * 100).toFixed(1)}%`;
    }
    const el = $('cascade-progress');
    if(el) {
      el.style.display = 'block';
      el.textContent = `Passada ${msg.passada}: ${msg.atual}/${msg.total} — ${msg.valorAtual || ''}${sufixo}`;
    }
  }
});

// v1.6.0 — Botão renomeado: "Re-mapear cascades desta página".
// Usado quando o usuário precisa rodar de novo após corrigir bug ou erro
// temporário do servidor. Passa os candidatos salvos na página (se houver);
// senão entra no modo legado (varre tudo).
$('btn-mapear-cascades').addEventListener('click', async () => {
  const btn = $('btn-mapear-cascades');
  const prog = $('cascade-progress');
  const sessao = await storage.get();
  if(!sessao?.paginas?.length) {
    prog.style.display = 'block';
    prog.textContent = '⚠ Adicione a página à sessão antes de re-mapear cascades';
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if(!tab?.url) {
    prog.style.display = 'block';
    prog.textContent = '⚠ Aba ativa sem URL';
    return;
  }

  const paginaAlvo = [...sessao.paginas].reverse().find(p =>
    (p.meta?.url || p.url) === tab.url
  );
  if(!paginaAlvo) {
    prog.style.display = 'block';
    prog.textContent = '⚠ URL atual não corresponde a nenhuma página da sessão. Adicione a página primeiro.';
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '⏳ Re-mapeando…';
  prog.style.display = 'block';
  prog.textContent = 'Iniciando…';

  try {
    const candidatos = paginaAlvo.cascade_candidatos || [];
    const args = candidatos.length > 0 ? [candidatos] : [];

    const [resultado] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scriptCascadesMapper,
      args,
      world: 'MAIN',
    });
    const out = resultado?.result || { cascade_maps: {}, total_pais: 0 };

    paginaAlvo.cascade_maps = out.cascade_maps;
    sessao.ultima_atualizacao = new Date().toISOString();
    await storage.set(sessao);

    const nPais = out.total_pais;
    prog.textContent = nPais > 0
      ? `✓ ${nPais} cascade(s) salvos na página "${paginaAlvo.meta?.descricao || 'sem descrição'}"`
      : `✓ Nenhum cascade detectado — página salva sem alterações`;
    renderSessao(sessao);
  } catch(err) {
    prog.textContent = `Erro: ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🔄 Re-mapear cascades desta página';
  }
});

$('btn-baixar-sessao').addEventListener('click', async () => {
  await _handleBaixarSessao({ compacto: false });
});

// v1.6.0 — Feature C3: handler do botão "Baixar (compacto)"
$('btn-baixar-sessao-compacto').addEventListener('click', async () => {
  await _handleBaixarSessao({ compacto: true });
});

// Fluxo comum (lacunas → confirmação → download). compacto=true gera JSON
// minificado (sem indent) ~84% menor para colar em LLMs downstream.
async function _handleBaixarSessao({ compacto }) {
  const sessao=await storage.get();
  if(!sessao?.paginas?.length) return;

  // ── Calcular lacunas (popups ainda pendentes) ─────────────────────────────
  const lacunas = sessao.paginas.flatMap((p, i) =>
    (p.popups_pendentes || [])
      .filter(pp => pp.status === 'pendente')
      .map(pp => ({ pagina: i+1, descricao: p.meta?.descricao || `Página ${i+1}`, popup: pp.abridor_texto }))
  );

  if(lacunas.length > 0) {
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
      _executarDownloadSessao(sessao, lacunas, compacto);
    };
    return;
  }

  _executarDownloadSessao(sessao, [], compacto);
}

function _executarDownloadSessao(sessao, lacunas, compacto) {
  const jsonObj = montarJsonSessao(sessao);
  if(lacunas.length > 0) {
    jsonObj.validacao = {
      popups_pendentes_total: lacunas.length,
      paginas_com_lacunas: lacunas,
    };
  }
  // v1.6.0 — Feature C3: 2 modos. compacto=false → indent 2 (legível);
  // compacto=true → JSON.stringify sem indent (minificado, ~84% menor).
  const json = compacto ? JSON.stringify(jsonObj) : JSON.stringify(jsonObj, null, 2);
  const sufixo = compacto ? '_compacto' : '';
  const fileName = `${sessao.nome}_mapeamento_${sessao.paginas.length}paginas${sufixo}.json`;
  const url=URL.createObjectURL(new Blob([json],{type:'application/json'}));
  Object.assign(document.createElement('a'),{href:url,download:fileName}).click();
  URL.revokeObjectURL(url);
  setStatus('sessao-status',`✓ ${fileName} baixado`,'ok');
}

// v1.6.0 — Feature C3: soft-warn de tamanho. Chamado pelo renderSessao para
// alertar o usuário quando o JSON ficou grande (>5.000 linhas no modo legível).
// O cálculo é leve (apenas split de string) e roda apenas quando há sessão.
function atualizarAvisoTamanho(sessao) {
  const aviso = $('aviso-tamanho');
  if(!aviso) return;
  if(!sessao?.paginas?.length) {
    aviso.style.display = 'none';
    return;
  }
  try {
    const json = JSON.stringify(montarJsonSessao(sessao), null, 2);
    const nLinhas = (json.match(/\n/g) || []).length + 1;
    if(nLinhas > 5000) {
      const nFmt = nLinhas.toLocaleString('pt-BR');
      aviso.style.display = 'block';
      aviso.textContent = `⚠ JSON com ${nFmt} linhas no modo legível. Use "📦 Baixar (compacto)" para colar no Claude sem inflar contexto.`;
    } else {
      aviso.style.display = 'none';
    }
  } catch(_){
    aviso.style.display = 'none';
  }
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
// + v1.4.2: também no bloco captura-prioritaria-container, com a mesma lógica
// ─────────────────────────────────────────────────────────────────────────────

// Ação [Capturar]: marca o popup como "capturando", destaca o botão na página.
// Usado tanto pelo bloco prioritário quanto (defensivamente) por checklist antigo.
async function acaoCapturarPopup(pagIdx, popIdx) {
  const sessao = await storage.get(); if(!sessao) return;
  const pag    = sessao.paginas[pagIdx]; if(!pag) return;
  const popup  = pag.popups_pendentes[popIdx]; if(!popup) return;

  popup.status = 'capturando';
  await storage.set(sessao);
  renderSessao(sessao);

  try {
    await destacarUmPopup(popup.abridor_seletor, popup.abridor_texto);
  } catch(err) {
    setStatus('sessao-status', `Erro ao destacar: ${err.message}`, 'erro');
    popup.status = 'pendente';
    await storage.set(sessao);
    renderSessao(sessao);
  }
}

// Ação [Check] / [Popup abriu? Capturar agora]: roda o scriptDeMapeamento
// na aba ativa, salva resultado em popups_capturados e marca status='capturado'.
async function acaoCheckPopup(pagIdx, popIdx, btnElemento) {
  if(btnElemento) {
    btnElemento.disabled = true;
    btnElemento.innerHTML = '<span class="spin">⬡</span> Capturando…';
  }

  try {
    // Remover overlay ANTES de capturar — o rótulo vertex fica dentro do botão
    // e contamina o innerText capturado se não for removido primeiro.
    await removerDestaqueNaPagina().catch(()=>{});
    await new Promise(r => setTimeout(r, 150)); // aguarda DOM limpar

    const { dados } = await executarScript({
      incluirHidden:true,
      incluirDisabled:false,
      incluirCookies:false,
      incluirAjax:false,
      waitSpaMs:0,
    });

    const sessao = await storage.get(); if(!sessao) return;
    const pag    = sessao.paginas[pagIdx]; if(!pag) return;
    const popup  = pag.popups_pendentes[popIdx]; if(!popup) return;

    const nCampos  = dados.formulario?.campos?.length || 0;
    const nBotoes  = dados.botoes_acao?.length || 0;
    popup._resultado_resumo = `${nCampos} campo${nCampos!==1?'s':''} · ${nBotoes} ${nBotoes!==1?'botões':'botão'}`;
    popup.status = 'capturado';

    pag.popups_capturados = pag.popups_capturados || [];
    pag.popups_capturados.push({
      pai_indice:    pagIdx + 1,
      pai_url:       pag.meta?.url || pag.url || '',
      popup_id:      popup.id,
      origem:        popup.origem || 'detectado',
      abridor_texto: popup.abridor_texto,
      abridor_seletor: popup.abridor_seletor,
      schema_version: '3.7',
      meta: {
        descricao:    `Popup: ${popup.abridor_texto}`,
        capturado_em: new Date().toISOString(),
      },
      tipo_pagina:  dados.tipo_pagina,
      frameworks:   dados.frameworks,
      grids:        dados.grids,
      feeds:        dados.feeds || [],
      campos_estaticos: dados.campos_estaticos || [],
      formulario:   dados.formulario,
      botoes_acao:  dados.botoes_acao,
      modais_popups: dados.modais_popups,
      diagnostico:  dados.diagnostico,
      resumo:       dados.resumo,
    });

    sessao.ultima_atualizacao = new Date().toISOString();
    await storage.set(sessao);
    renderSessao(sessao);
    setStatus('sessao-status',
      `✓ Popup "${popup.abridor_texto}" capturado — ${popup._resultado_resumo}`, 'ok');

  } catch(err) {
    await removerDestaqueNaPagina().catch(()=>{});
    const sessao = await storage.get();
    if(sessao?.paginas?.[pagIdx]?.popups_pendentes?.[popIdx]) {
      sessao.paginas[pagIdx].popups_pendentes[popIdx].status = 'pendente';
      await storage.set(sessao);
      renderSessao(sessao);
    }
    setStatus('sessao-status', `Erro ao capturar popup: ${err.message}`, 'erro');
  }
}

// Ação [Pular]: marca o popup como pulado.
async function acaoPularPopup(pagIdx, popIdx) {
  const sessao = await storage.get(); if(!sessao) return;
  const popup  = sessao.paginas[pagIdx]?.popups_pendentes?.[popIdx]; if(!popup) return;
  if(popup.status === 'capturando') {
    await removerDestaqueNaPagina().catch(()=>{});
  }
  popup.status = 'pulado';
  sessao.ultima_atualizacao = new Date().toISOString();
  await storage.set(sessao);
  renderSessao(sessao);
}

// Listener do bloco prioritário (topo da aba Sessão) — botões com classes
// btn-cp-capturar / btn-cp-check / btn-cp-pular vindos de renderCapturaPrioritaria.
$('captura-prioritaria-container').addEventListener('click', async (e) => {
  const cap = e.target.closest('.btn-cp-capturar');
  if(cap && !cap.disabled) {
    return acaoCapturarPopup(parseInt(cap.dataset.pagIdx), parseInt(cap.dataset.popIdx));
  }
  const chk = e.target.closest('.btn-cp-check');
  if(chk && !chk.disabled) {
    return acaoCheckPopup(parseInt(chk.dataset.pagIdx), parseInt(chk.dataset.popIdx), chk);
  }
  const pul = e.target.closest('.btn-cp-pular');
  if(pul && !pul.disabled) {
    return acaoPularPopup(parseInt(pul.dataset.pagIdx), parseInt(pul.dataset.popIdx));
  }
});

$('paginas-lista').addEventListener('click', async (e) => {
  // ── [Capturar] (legado — checklist secundário não renderiza mais esses
  //     botões na v1.4.2, mas mantemos defensivamente) ──────────────────────
  const btnCapturar = e.target.closest('.btn-capturar');
  if(btnCapturar && !btnCapturar.disabled) {
    return acaoCapturarPopup(parseInt(btnCapturar.dataset.pagIdx), parseInt(btnCapturar.dataset.popIdx));
  }

  // ── [✓ Check] (legado) ─────────────────────────────────────────────────────
  const btnCheck = e.target.closest('.btn-check');
  if(btnCheck && !btnCheck.disabled) {
    return acaoCheckPopup(parseInt(btnCheck.dataset.pagIdx), parseInt(btnCheck.dataset.popIdx), btnCheck);
  }

  // ── [Pular] (legado) ───────────────────────────────────────────────────────
  const btnPular = e.target.closest('.btn-pular');
  if(btnPular && !btnPular.disabled) {
    return acaoPularPopup(parseInt(btnPular.dataset.pagIdx), parseInt(btnPular.dataset.popIdx));
  }

  // ── [+ Adicionar popup manualmente] — abre form inline ────────────────────
  const btnAddManual = e.target.closest('.btn-add-popup-manual');
  if(btnAddManual) {
    const pagIdx = parseInt(btnAddManual.dataset.pagIdx);
    const sessao = await storage.get(); if(!sessao) return;
    const pag = sessao.paginas[pagIdx]; if(!pag) return;
    pag._popupManualForm = { texto: '', seletor: '' };
    await storage.set(sessao);
    renderSessao(sessao);
    // Focar no primeiro input
    setTimeout(() => {
      const inp = document.querySelector(`.popup-checklist[data-pag-idx="${pagIdx}"] .pm-texto`);
      if(inp) inp.focus();
    }, 50);
    return;
  }

  // ── [Confirmar] do form manual — cria popup_pendente com origem 'manual' ──
  const btnConfirmar = e.target.closest('.btn-pm-confirmar');
  if(btnConfirmar) {
    const pagIdx = parseInt(btnConfirmar.dataset.pagIdx);
    const sessao = await storage.get(); if(!sessao) return;
    const pag = sessao.paginas[pagIdx]; if(!pag) return;

    const txt = document.querySelector(`.popup-checklist[data-pag-idx="${pagIdx}"] .pm-texto`)?.value?.trim() || '';
    const sel = document.querySelector(`.popup-checklist[data-pag-idx="${pagIdx}"] .pm-seletor`)?.value?.trim() || '';
    if(!txt || !sel) {
      setStatus('sessao-status', 'Informe texto E seletor do botão para adicionar manualmente', 'erro');
      return;
    }

    pag.popups_pendentes = pag.popups_pendentes || [];
    const indiceManual = pag.popups_pendentes.filter(p => p.origem === 'manual').length;
    pag.popups_pendentes.push({
      id: `popup_manual_${indiceManual}_${Date.now()}`,
      origem: 'manual',
      handler_backend: '',
      extra_data: '',
      abridor_texto: txt.substring(0,80),
      abridor_seletor: sel,
      status: 'pendente',
    });
    delete pag._popupManualForm;
    sessao.ultima_atualizacao = new Date().toISOString();
    await storage.set(sessao);
    renderSessao(sessao);
    setStatus('sessao-status', `✓ Popup manual "${txt}" adicionado à página ${pagIdx+1}`, 'ok');
    return;
  }

  // ── [Cancelar] do form manual ─────────────────────────────────────────────
  const btnCancelar = e.target.closest('.btn-pm-cancelar');
  if(btnCancelar) {
    const pagIdx = parseInt(btnCancelar.dataset.pagIdx);
    const sessao = await storage.get(); if(!sessao) return;
    const pag = sessao.paginas[pagIdx]; if(!pag) return;
    delete pag._popupManualForm;
    await storage.set(sessao);
    renderSessao(sessao);
    return;
  }
});

// Sincronizar valores dos inputs do form manual com storage transient
// (para que cancelar/confirmar pegue o texto digitado mesmo sem re-render).
$('paginas-lista').addEventListener('input', async (e) => {
  const inp = e.target.closest('.pm-texto, .pm-seletor');
  if(!inp) return;
  const pagIdx = parseInt(inp.dataset.pagIdx);
  const sessao = await storage.get(); if(!sessao) return;
  const pag = sessao.paginas[pagIdx]; if(!pag || !pag._popupManualForm) return;
  if(inp.classList.contains('pm-texto'))   pag._popupManualForm.texto   = inp.value;
  if(inp.classList.contains('pm-seletor')) pag._popupManualForm.seletor = inp.value;
  await storage.set(sessao);
  // NÃO re-renderizar aqui — perderia foco. O storage transient acumula.
});
