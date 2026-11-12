# InfraWork Web: identidade visual

Direção escolhida em 12/11/2026: **Prancheta técnica**. A tela parece um documento de engenharia: papel claro, tinta
quase preta, linhas finas, cantos quase retos, azul de carimbo como único destaque. O tema escuro é a variante, não o
padrão. As direções "Console refinado", "Rodovia" e a inspirada no Procore foram avaliadas e descartadas.

Cena de uso: engenheiro ou planejador no escritório da obra, de dia, com planilha e projeto abertos ao lado. Por isso
o claro é o padrão; o escuro existe para quem trabalha à noite ou prefere.

## Onde fica cada coisa

| O quê                                        | Arquivo                                                 |
| -------------------------------------------- | ------------------------------------------------------- |
| Cores dos dois temas                         | `src/styles/theme.css`                                  |
| Base (fonte, foco, rolagem)                  | `src/styles/globals.css`                                |
| Escalas de tamanho, raio e as classes de cor | `tailwind.config.js`                                    |
| Tema antes da primeira pintura               | `public/theme-boot.js`                                  |
| Preferência de tema (claro, escuro, sistema) | `src/stores/theme-store.ts`                             |
| Casca: barra superior e menu                 | `src/components/layout/{AppShell,TitleBar,Sidebar}.tsx` |
| Cabeçalho de página                          | `src/components/layout/PageHeader.tsx`                  |
| Início (painel da obra, faixa da obra)       | `src/features/painel/`                                  |

## Cor

- Tudo por variável CSS em OKLCH. Nada de cor literal em componente, nem classe da paleta padrão do Tailwind
  (`text-emerald-400`, `bg-black/60`). Exceções: o que fica sobre foto ou mapa de satélite, o login e a prévia de
  exportação.
- Neutros puxados para o tom do papel (hue 90). Sem preto ou branco puros.
- Papéis: `bg` (mesa), `bg-menu` (barra e menu), `bg-panel` (folha), `bg-elevated` (bloco dentro da folha, cabeçalho
  de tabela), `bg-hover` e `bg-active` (véu de tinta translúcido, serve sobre qualquer fundo; não use como fundo
  chapado de célula fixa).
- Linhas: `border` separa; `border-strong` contorna campo e botão (3:1 sobre a folha); `border-accent` é o contorno
  ao passar o mouse.
- Tinta: `text`, `text-muted`, `text-dim` (mínimo para texto, 4,5:1), `text-faint` (só decoração).
- Destaque: `accent` (azul de carimbo) para a ação principal, o item ativo e os links. Texto sobre ele usa
  `--on-accent`. Estados: `success`, `warn`, `danger`; fundo de estado é a própria cor com transparência
  (`bg-danger/10`), que funciona porque as cores do Tailwind são geradas com `color-mix`.
- Gráficos usam `--chart-1…6`; superfícies flutuantes usam `--popover`, `--sombra-flutuante` e `--veu` (fundo atrás
  de diálogo).
- Token novo entra nos dois temas. `src/styles/theme.test.ts` falha se o código usar variável que o tema não define.

## Tipografia

- Uma família: Archivo (variável, servida pelo próprio site via `@fontsource-variable/archivo`). Números usam a
  mesma família com algarismos tabulares: classe `font-mono` ou `tabular`.
- Corpo de 13 px. Escala: `2xs` 11, `xs` 11,5, `sm` 12,5, `base` 13, `md` 14, `lg` 15, `xl` 17, `2xl` 20, `3xl` 24.
- Rótulo de campo, de coluna e de grupo: `text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim`.
- Título de página: `text-2xl font-semibold`. Título de bloco: `text-lg font-semibold`.

## Forma

- Raio: 2 px (`rounded`), 1 px (`rounded-sm`), 3 px (`rounded-lg`). Círculo só em avatar e marcador.
- Bloco é folha branca com borda fina; sombra só no que flutua (menu, diálogo, dica).
- Proibido: faixa lateral colorida em cartão ou item, texto em degradê, vidro fosco, grade de cartões idênticos.
- Controles: botão e campo de 32 px (padrão), 28 px (`sm`), 36 e 40 px para ação de destaque.

## Navegação

- Barra superior: menu, marca, obra em uso, busca (Ctrl K), tema e usuário.
- Um menu lateral só: Início e um grupo por módulo, com as páginas dentro. O grupo do módulo em uso abre sozinho.
  Em tela estreita o menu abre por cima do conteúdo.
- As páginas vêm de `src/config/modules.ts`. Cada módulo continua com a sua aba viva em memória
  (`stores/tabs-store.ts`), mas não há mais barra de abas, trilho de ícones nem barra de status.
- Início com obra selecionada é o painel da obra: carimbo, situação, faixa da obra, serviços, alertas, últimos
  lançamentos e prontidão.

## Verificação visual

- `node scripts/capturas-telas.mjs` fotografa as 45 rotas num tema (`E2E_TEMA=light|dark`, `E2E_LARGURA=390` para
  celular); `node scripts/fumaca-telas.mjs` acusa erro de página e de console.
- Toda mudança visual é conferida nos dois temas.
