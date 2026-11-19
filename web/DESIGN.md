# InfraWork Web: identidade visual

Direção escolhida em 12/11/2026: **Prancheta técnica**. A tela parece um documento de engenharia: papel claro, tinta
quase preta, linhas finas, cantos quase retos, azul de carimbo como único destaque. O tema escuro é a variante, não o
padrão. As direções "Console refinado", "Rodovia" e a inspirada no Procore foram avaliadas e descartadas.

Cena de uso: engenheiro ou planejador no escritório da obra, de dia, com planilha e projeto abertos ao lado. Por isso
o claro é o padrão; o escuro existe para quem trabalha à noite ou prefere.

## Onde fica cada coisa

| O quê                                        | Arquivo                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Cores dos dois temas                         | `src/styles/theme.css`                                                                     |
| Base (fonte, foco, rolagem)                  | `src/styles/globals.css`                                                                   |
| Escalas de tamanho, raio e as classes de cor | `tailwind.config.js`                                                                       |
| Tema antes da primeira pintura               | `public/theme-boot.js`                                                                     |
| Preferência de tema (claro, escuro, sistema) | `src/stores/theme-store.ts`                                                                |
| Tamanho do texto (confortável ou compacto)   | `--fs-*` em `theme.css`; `density` em `stores/ui-store`                                    |
| Componentes compartilhados                   | `src/components/ui/`, `src/components/charts/`                                             |
| Rótulos dos códigos do banco e plurais       | `src/lib/rotulos.ts`                                                                       |
| Casca: barra superior e menus                | `src/components/layout/` (`AppShell`, `TitleBar`, `BarraModulos`, `MenuModulo`, `Sidebar`) |
| Cabeçalho de página                          | `src/components/layout/PageHeader.tsx`                                                     |
| Início (painel da obra, faixa da obra)       | `src/features/painel/`                                                                     |

## Cor

- Tudo por variável CSS em OKLCH. Nada de cor literal em componente, nem classe da paleta padrão do Tailwind
  (`text-emerald-400`, `bg-black/60`). Exceções: o mapa de satélite, o login, o que vai para arquivo exportado ou
  impresso e o valor padrão das cores gravadas no banco (equipe, local). Controle sobre foto usa `--sobre-foto`
  (fundo) e `--na-foto` (tinta), iguais nos dois temas. `src/styles/cores.test.ts` cobra e lista as exceções.
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
- Gráficos usam `--chart-1…6`; as séries do cronograma (uma cor por serviço) usam `--serie-1…10`, mais escuras no
  claro e mais claras no escuro; superfícies flutuantes usam `--popover`, `--sombra-flutuante` e `--veu` (fundo atrás
  de diálogo).
- Token novo entra nos dois temas. `src/styles/theme.test.ts` falha se o código usar variável que o tema não define.

## Tipografia

- Uma família: Archivo (variável, servida pelo próprio site via `@fontsource-variable/archivo`). Números usam a
  mesma família com algarismos tabulares: classe `font-mono` ou `tabular`.
- Os tamanhos vêm de variáveis (`--fs-2xs` … `--fs-3xl`), usadas pelas classes `text-*`. Escala confortável
  (padrão): `2xs` 11,5, `xs` 12,5, `sm` 13,5, `base` 14, `md` 15, `lg` 16, `xl` 18, `2xl` 21, `3xl` 25. Escala
  compacta (`data-density="compact"`): 11, 11,5, 12,5, 13, 14, 15, 17, 20, 24.
- A preferência do usuário põe `data-density` no `<html>`. Tela de geometria fixa em px (Gantt, tempo-caminho,
  árvore da planilha orçamentária) põe `data-density="compact"` no próprio bloco e fica sempre compacta.
- Texto corrido e de apoio: `text-sm text-text-muted`. Nada de texto de leitura em `text-2xs`.
- Rótulo de campo, de coluna e de grupo: `text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim`.
- Título de página: `text-2xl font-semibold`. Título de bloco: `text-lg font-semibold`.

## Forma

- Raio: 2 px (`rounded`), 1 px (`rounded-sm`), 3 px (`rounded-lg`). Círculo só em avatar e marcador.
- Bloco é folha branca com borda fina; sombra só no que flutua (menu, diálogo, dica).
- Proibido: faixa lateral colorida em cartão ou item, texto em degradê, vidro fosco, grade de cartões idênticos.
- Controles: botão e campo de 32 px (padrão), 28 px (`sm`), 36 e 40 px para ação de destaque.

## Componentes

Antes de montar um bloco à mão, use o que já existe:

| Para                                          | Componente                                                                                      |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Indicadores (número com rótulo e apoio)       | `ui/indicador`: `FaixaIndicadores`, `Indicador`, `BarraAvanco`                                  |
| Bloco com título, nota e "ver mais"           | `ui/secao`: `Secao`                                                                             |
| Carregando, erro de consulta e vazio          | `ui/estado`: `EstadoConsulta`, `ErroConsulta`, `Carregando`, `Vazio`                            |
| Retorno de edição direta ("Salvando…", falha) | `ui/estado`: `EstadoGravacao`                                                                   |
| Campo de formulário com rótulo, dica e erro   | `ui/campo`: `Campo` (ou `aria-invalid` no `Input`/`Select`)                                     |
| Escolha única entre poucas opções             | `ui/segmentado`: `Segmentado`                                                                   |
| Escolher numa lista longa, com busca          | `ui/lista-pesquisavel`: `ListaPesquisavel` (abre em portal; aceita valor digitado via `livre`)  |
| Filtros da página                             | `ui/filtros`: `BarraFiltros`, `Filtro`, `FiltroMulti`; `ui/filtro-chips`; `ui/DateRangePopover` |
| Curva S (previsto e realizado)                | `charts/CurvaS`                                                                                 |
| Diálogo, painel lateral, menu, popover        | `ui/dialog`, `ui/sheet`, `ui/dropdown`, `ui/popover`                                            |
| Dica ao passar o mouse ou focar               | `ui/tooltip` (o `IconButton` já usa o `aria-label` como dica)                                   |
| Barra de ferramentas do plano                 | `features/cronograma/components/BarraPlano` (grupos, zoom, somente leitura)                     |
| Fundo de vazio e de carregamento              | `layout/CurvasDeNivel` (já usado pelo `EmptyState`)                                             |

Regras que valem para todos:

- Soma só de mesma unidade. Indicador ou gráfico que junta vários serviços usa valor (R$) ou contagem de dias, nunca
  a soma de m², m³ e metros. Para a obra inteira, a curva S é a de valor (`useCurvaSValor`).
- Toda consulta mostra os três estados: carregando, erro (com "Tentar de novo") e vazio com uma frase que diz o que
  falta. Não mostrar "sem dados" enquanto carrega.
- Erro de formulário aparece no campo, depois da primeira tentativa de salvar; o botão de salvar não fica
  desabilitado sem explicação.
- Diálogo e painel lateral usam `useCamadaModal` (`ui/camada-modal`): o Esc fecha só a camada de cima, o Tab fica
  dentro dela e o foco volta para onde estava. Menu abre com seta para baixo e anda com as setas; popover leva o
  foco para dentro ao abrir.
- Todo campo tem nome (rótulo ligado ou `aria-label`), botão só com ícone tem `aria-label`, abas ficam num
  `role="tablist"` e região com rolagem própria é focável.
- Controle desabilitado diz o motivo no `title` (linha de base travada, falta de permissão).
- Barra com muitos controles é dividida em grupos, com as ações raras num menu "Mais".
- Gravação que falha e a tela não tratou vira aviso pelo `lib/query-client`; quando a tela avisa, o global se cala.
- Toda `<table>` com `<thead>` ganha largura de coluna ajustável sem código na tela (`lib/tabelas/colunas-ajustaveis`,
  ligado no `AppShell`): alça na borda direita do cabeçalho, setas do teclado com ela em foco, duplo clique volta ao
  automático, largura guardada no navegador por tela e cabeçalho. Tabela com colunas fixas de deslocamento calculado
  (ou grade com largura própria) fica de fora com `data-sem-ajuste`. Grade que não é `<table>` (ex.: a planilha
  orçamentária virtualizada) usa `useLargurasColunas` (`lib/tabelas`) e `AlcaColuna` (`ui/alca-coluna`) no título.

## Texto

- Um nome por conceito: **linha de base** (não baseline nem LB), **plano** (versão do cronograma), **lançamento** e
  **lançar** (não apontamento), **previsto** e **realizado** (ou **executado**, em valor), **composição** (não CPU).
- Código do banco não vai para a tela: papéis, situações e tipos passam por `src/lib/rotulos.ts`.
- Plural certo com `contar(n, 'lançamento', 'lançamentos')`; nada de "item(ns)".
- Subtítulo de página curto e sem o nome da obra (ela já está na barra superior). Sem travessão como separador.
- Botão diz o que faz ("Lançar produção", "Tentar de novo"); mensagem de erro diz o que houve e o que fazer.

## Navegação

- Barra superior: marca, obra em uso, busca (Ctrl K), tema e usuário. A busca encontra páginas do menu, obras e
  ações.
- Abaixo, três colunas no padrão do Supabase:
  - **Barra de módulos** (`BarraModulos`): ícones de 20 px em grupos separados por linha (Início; Orçamento,
    Planejamento e Acompanhamento; Gerencial; atalhos e configurações). Tem 48 px e abre para 208 px em 100 ms
    lineares. Tem duas camadas: a de fora reserva o espaço e a de dentro é absoluta (`z-30`). Ao passar o mouse, só a
    de dentro cresce, por cima do resto. O rótulo está sempre no item e só é cortado. O ícone fica a 14 px da borda nos
    dois estados (8 px do grupo + 6 px do item), nunca centralizado. O estado vai em `data-state`.
  - **Modos**, no botão "Controle da sidebar" do rodapé: expandida (empurra o conteúdo), recolhida (só ícones, dica na
    hora) e "expandir ao passar o mouse" (padrão; também abre com o foco do teclado). A preferência fica em
    `ui-store` (`modoBarra`, no navegador). Ctrl B alterna entre expandida e ao passar o mouse.
  - **Menu do módulo** (`MenuModulo`): 256 px, com o nome do módulo no topo e as páginas em grupos com título, separados por uma linha de ponta a ponta. Só
    aparece em módulo com páginas (o Início não tem) e entra e sai em 200 ms.
  - **Conteúdo**: `isolate`, para mapas e gráficos (`z-index` alto) não passarem por cima da barra aberta.
- Destaque só por contraste: o item ativo tem `bg-active` e peso médio, o item sob o mouse tem `bg-hover`, e nenhum usa
  cor de marca. A bolinha de alerta sobre o ícone de Acompanhamento é vermelha (alerta crítico aberto) ou amarela
  (aviso).
- Em tela estreita (celular) as colunas dão lugar à gaveta (`Sidebar`), aberta pelo botão de menu da barra superior.
- Tudo sai de `src/config/modules.ts` (módulos, páginas, `GRUPOS_BARRA`, `MODULO_INICIO`): página nova entra lá. Cada
  módulo continua com a sua aba viva em memória (`stores/tabs-store.ts`), e o ícone do módulo volta à última página
  aberta nele.
- Início com obra selecionada é o painel da obra: carimbo, situação (avanço, valor executado, término, serviços,
  último lançamento), curva S em valor, faixa da obra, serviços, alertas, últimos lançamentos e prontidão.

## Verificação

Com o servidor de desenvolvimento no ar e as variáveis `E2E_EMAIL`, `E2E_PASSWORD`, `E2E_EMPRESA_ID` e `E2E_OBRA_ID`:

| Roteiro                                           | O que confere                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `node scripts/fumaca-telas.mjs`                   | as rotas abrem sem erro de página, de console ou de rede, e sem texto transbordando por cima do vizinho |
| `node scripts/capturas-telas.mjs`                 | fotografa as rotas num tema (`E2E_TEMA`, `E2E_LARGURA`, `E2E_ALTURA`)                                   |
| `node scripts/comparar-capturas.mjs antes depois` | diferença por pixel entre duas pastas de capturas                                                       |
| `node scripts/acessibilidade-telas.mjs`           | axe (WCAG 2 A e AA) em cada rota (`E2E_LARGURA=390` para celular)                                       |
| `node scripts/acessibilidade-dialogos.mjs`        | abre os diálogos pelos botões, roda o axe e confere foco e Esc                                          |
| `node scripts/layout-telas.mjs [rota…]`           | em 1440, 1024 e 390 px: rolagem lateral, controle cortado, texto cru                                    |
| `node scripts/conferir-csp.mjs [../campo]`        | serve o build com a CSP do `vercel.json` e acusa o que for bloqueado                                    |

Sem servidor, no `npm test`: `theme.test.ts` (toda variável usada existe), `contraste.test.ts` (texto com 4,5:1 e
contorno de campo com 3:1, nos dois temas), `cores.test.ts` (sem cor literal), `classes.test.ts` (classe de cor usada existe no `tailwind.config.js`) e
`icones.test.ts`.

- Toda mudança visual é conferida nos dois temas.
- Tela de acompanhamento se confere com dados: a obra local quase não tem produção, então semeie produção de
  demonstração só no banco local antes de olhar e apague depois.
- A galeria dos componentes fica em `/galeria` no servidor de desenvolvimento (não entra no build de produção): é a
  vitrine e o alvo do axe para os componentes compartilhados.
