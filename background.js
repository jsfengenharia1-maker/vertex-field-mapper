// background.js — Vertex Field Mapper service worker (MV3)
// v1.4.1 — Migração de popup tradicional para Chrome Side Panel API.
//
// Comportamento desejado: clicar no ícone ⬡ da extensão abre o painel lateral
// fixo na direita (igual ao DevTools), e ele permanece aberto enquanto o
// usuário navega e interage com a página.
//
// Implementação:
// 1. setPanelBehavior({ openPanelOnActionClick: true }) — Chrome 116+ delega
//    a abertura do side panel ao próprio runtime; é o caminho recomendado.
// 2. onClicked listener — fallback defensivo caso setPanelBehavior falhe ou
//    a versão do Chrome seja mais antiga. Só dispara se `default_popup` estiver
//    ausente do manifest (que é o nosso caso na v1.4.1).

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error('[VFM] setPanelBehavior falhou:', err));
});

// Também tenta configurar no startup do service worker (caso o evento de
// install não dispare em alguma situação de update).
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => { /* silencioso — install handler já cobre */ });

// Fallback: se openPanelOnActionClick não for honrado por algum motivo,
// abrimos o painel manualmente quando o ícone é clicado.
chrome.action.onClicked.addListener((tab) => {
  if (tab && typeof tab.windowId === 'number') {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch((err) => {
      console.error('[VFM] sidePanel.open falhou:', err);
    });
  }
});
