// Aplica o tema e a densidade antes da primeira pintura (arquivo externo: a CSP não aceita script embutido).
// A mesma chave e a mesma regra estão em src/stores/theme-store.ts.
;(function () {
  var pref = 'light'
  try {
    pref = localStorage.getItem('infrawork.ui.theme') || 'light'
  } catch {
    pref = 'light'
  }
  var escuro =
    pref === 'dark' ||
    (pref === 'system' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = escuro ? 'dark' : 'light'
  try {
    if (localStorage.getItem('infrawork.ui.density') === 'compact')
      document.documentElement.dataset.density = 'compact'
  } catch {
    // sem armazenamento: vale a densidade padrão
  }
  var meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', escuro ? '#121211' : '#f1efeb')
})()
