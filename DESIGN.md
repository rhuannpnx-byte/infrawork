---
name: InfraWork
description: Console técnico denso para engenheiros de obra rodoviária.
colors:
  bg: "#08090b"
  bg-tabs: "#0a0b0e"
  bg-menu: "#0c0e12"
  bg-rail: "#0a0b0e"
  bg-panel: "#0f1116"
  bg-elevated: "#14171f"
  bg-hover: "#1a1e28"
  bg-active: "#1f242f"
  border: "#1b1e26"
  border-strong: "#262a35"
  border-accent: "#2d3340"
  text: "#e8ebef"
  text-muted: "#8b909a"
  text-dim: "#5b6068"
  text-faint: "#3d4148"
  accent: "#4d8eff"
  accent-hover: "#66a0ff"
  success: "#4ade80"
  warn: "#fbbf24"
  danger: "#f87171"
  module-orcamento: "#4d8eff"
  module-planejamento: "#67e8f9"
  module-acompanhamento: "#4ade80"
  module-medicoes: "#fbbf24"
  module-suprimentos: "#a78bfa"
  module-equipe: "#f472b6"
  module-documentos: "#94a3b8"
typography:
  display:
    fontFamily: '"IBM Plex Sans", system-ui, sans-serif'
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "normal"
  headline:
    fontFamily: '"IBM Plex Sans", system-ui, sans-serif'
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "normal"
  title:
    fontFamily: '"IBM Plex Sans", system-ui, sans-serif'
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
  body:
    fontFamily: '"IBM Plex Sans", system-ui, sans-serif'
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
  body-sm:
    fontFamily: '"IBM Plex Sans", system-ui, sans-serif'
    fontSize: "11.5px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
  label:
    fontFamily: '"IBM Plex Mono", ui-monospace, monospace'
    fontSize: "10px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.04em"
  numeric:
    fontFamily: '"IBM Plex Mono", ui-monospace, monospace'
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "normal"
    fontFeature: '"tnum"'
rounded:
  sm: "3px"
  md: "4px"
  lg: "6px"
  xl: "8px"
spacing:
  row-compact: "24px"
  control: "28px"
  control-md: "32px"
  control-lg: "36px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.bg-tabs}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "28px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "{colors.bg-elevated}"
    textColor: "{colors.text}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "28px"
  button-secondary-hover:
    backgroundColor: "{colors.bg-hover}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "28px"
  button-ghost-hover:
    backgroundColor: "{colors.bg-hover}"
    textColor: "{colors.text}"
  button-danger:
    backgroundColor: "{colors.bg-panel}"
    textColor: "{colors.danger}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "28px"
  input-default:
    backgroundColor: "{colors.bg-elevated}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 8px"
    height: "28px"
  input-focus:
    backgroundColor: "{colors.bg-elevated}"
    textColor: "{colors.text}"
  badge-default:
    backgroundColor: "{colors.bg-elevated}"
    textColor: "{colors.text-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "2px 6px"
  badge-success:
    backgroundColor: "{colors.success}"
    textColor: "{colors.success}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "2px 6px"
  badge-warn:
    backgroundColor: "{colors.warn}"
    textColor: "{colors.warn}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "2px 6px"
  badge-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.danger}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "2px 6px"
  panel:
    backgroundColor: "{colors.bg-panel}"
    rounded: "{rounded.md}"
    padding: "12px"
  dialog:
    backgroundColor: "{colors.bg-panel}"
    rounded: "{rounded.lg}"
    padding: "0"
---

# Design System: InfraWork

## 1. Overview

**Creative North Star: "Console de Canteiro"**

InfraWork é o painel que substitui Excel + WhatsApp + três sistemas legados pelo único fluxo coerente do engenheiro de obra. O sistema visual emula um console técnico: tela escura saturada de informação, números monoespaçados alinhados à direita, badges semânticos curtos, zero decoração. O engenheiro abre o app cedo, navega Dashboard → identifica desvio → vai pra módulo → fecha. Cada pixel da viewport precisa ganhar seu lugar nesse fluxo.

O sistema rejeita explicitamente o visual de ERP tradicional (SAP/TOTVS/Sienge), o cinza institucional de PowerBI/AdminLTE, a planilha-com-cabeçalho-ZA-ZZ do Excel, e qualquer onboarding warmth de app consumer. Inspirações tonais: Linear (densidade respeitosa), Stripe Dashboard (data-first), Raycast (atalho > caminho). Não é dark mode "porque dev gosta": o engenheiro alterna escritório (monitor 27", luz ambiente forte) e canteiro (notebook 14", sol direto refletindo na tela), e o fundo escuro com texto claro mantém legibilidade nos dois cenários sem reduzir densidade.

**Key Characteristics:**
- Densidade alta intencional: linha de tabela 24px, controle 28px, fonte base 12px.
- Mesmo layout em monitor 27" e notebook 14"; sem fluid typography, sem breakpoint mobile.
- Mono (IBM Plex Mono) carrega todo dado numérico; sans (IBM Plex Sans) carrega rótulo e prosa.
- Cor é semântica, nunca decorativa. Accent azul ocupa <10% da tela. Verde/amarelo/vermelho são exclusivos de estado de aderência.
- Cada módulo principal tem uma cor de identidade (orçamento azul, planejamento ciano, acompanhamento verde, etc.) usada apenas em sidebar/tabs, nunca como fundo de conteúdo.

## 2. Colors: A Paleta do Console

Restrained: um único accent carrega ações primárias e seleção; status semânticos têm voz própria mas não invadem decoração; o restante é uma escala fria de 8 níveis de fundo escuro tintada para o azul accent.

### Primary

- **Console Blue** (`#4d8eff`): único accent do sistema. Ações primárias (botão Salvar, link, foco), seleção atual, indicador "current" em navegação. Hover sobe para `#66a0ff`. Glow translúcido `rgba(77,142,255,0.12)` é o único uso decorativo aceito, em hover de linha e pílula de seleção.

### Secondary (status semântico)

Não são "cores secundárias" no sentido decorativo. São o vocabulário de estado da aderência CPU, da medição, da sincronização. Cada cor só aparece quando o estado existe.

- **Aderência OK** (`#4ade80`): aderência CPU 90–110%, sync concluída, item baseline ativo. Também identidade do módulo Acompanhamento.
- **Aderência Atenção** (`#fbbf24`): aderência 70–89% ou 111–130%, snapshot pendente, prazo apertando. Também identidade do módulo Medições.
- **Aderência Crítica** (`#f87171`): aderência <70% ou >130%, erro de sync, baseline divergente, registro a deletar. Mesmo tom usado em destructive.

### Tertiary (identidade de módulo)

Cores reservadas exclusivamente para sidebar, breadcrumb e tab do módulo correspondente. Nunca como fundo de painel, nunca como cor de chart genérico.

- **Planejamento Ciano** (`#67e8f9`)
- **Suprimentos Lavanda** (`#a78bfa`)
- **Equipe Magenta** (`#f472b6`)
- **Documentos Cinza** (`#94a3b8`)

### Neutral (escala de fundo, 8 níveis)

Hierarquia vertical de elevação sem sombra: cada camada acima da anterior recebe um clique de luminosidade. Tudo tintado levemente para o azul accent.

- **bg** (`#08090b`): root do app, fundo absoluto, sob tudo.
- **bg-tabs / bg-rail** (`#0a0b0e`): barra superior arrastável (drag region Electron) e rail lateral fina.
- **bg-menu** (`#0c0e12`): menus suspensos, dropdown, palette.
- **bg-panel** (`#0f1116`): card principal de conteúdo, fundo de chart, modal.
- **bg-elevated** (`#14171f`): input, select, popover, tooltip.
- **bg-hover** (`#1a1e28`): row hover, botão ghost hover.
- **bg-active** (`#1f242f`): row selecionada, tab ativa, botão pressed.

### Neutral (texto, 4 níveis)

- **text** (`#e8ebef`): conteúdo primário, número da KPI, label de form.
- **text-muted** (`#8b909a`): rótulo de coluna, breadcrumb não-ativo, helper text. Razão de contraste contra `bg-panel`: 5,4:1 — aprovado.
- **text-dim** (`#5b6068`): placeholder, timestamp, divisor textual. **Hoje falha WCAG AA (~3,16:1 contra bg-panel) e precisa subir; ver Don'ts.**
- **text-faint** (`#3d4148`): apenas para ícones decorativos não-essenciais (scrollbar, chevron de tooltip).

### Named Rules

**A Regra do Único Accent.** O `Console Blue` ocupa no máximo 10% de qualquer tela. Botão primário (1 por dialog), foco corrente, link, indicador de tab ativa. Não é cor de fundo de painel, não é cor de gráfico decorativo, não é gradiente. Glow translúcido é a única forma decorativa permitida.

**A Regra do Verde/Amarelo/Vermelho Semântico.** As cores `success`, `warn`, `danger` só aparecem quando representam um estado de aderência, sync ou perigo. Nunca como tema visual de seção ("seção verde"), nunca como tag de categoria estética. Verde é "OK"; amarelo é "atenção"; vermelho é "crítico". Não há outro significado disponível.

**A Regra da Cor Não-Solo.** Aderência verde/amarela/vermelha precisa acompanhar texto numérico ou ícone. Daltônico tem que conseguir ler o estado sem ver a cor. Badge sempre carrega texto curto ("OK", "ATENÇÃO", "CRÍTICO" ou o valor "97%").

## 3. Typography

**Sans Font:** IBM Plex Sans (com fallback `system-ui, sans-serif`)
**Mono Font:** IBM Plex Mono (com fallback `ui-monospace, monospace`)

**Character:** IBM Plex foi escolhida pelo desenho da forma geométrica sem ser brutalista, contraste alto pra leitura em corpo 12px, e versão mono que cobre todo o intervalo numérico sem distância entre dígitos. Não há pareamento display + body: uma família carrega títulos, rótulos e prosa; a mono carrega exclusivamente número, métrica, código de obra, badge. A mudança de família já basta de hierarquia entre "rótulo" e "dado".

### Hierarchy

A escala é tight (1,1–1,2 entre passos) porque a UI mostra muito tipo. Contraste exagerado seria ruído.

- **Display** (`20px`, 600, line-height 1.2): título de página (Dashboard, Planejamento). Aparece uma vez por tela.
- **Headline** (`18px`, 600, line-height 1.25): título de seção dentro de página (Curva-S, Aderência por Serviço).
- **Title** (`14px`, 600, line-height 1.3): título de card, header de modal.
- **Body** (`12px`, 400, line-height 1.45): tamanho base do app. Tabela, descrição, label de form. Max 75ch em prosa contínua.
- **Body-sm** (`11.5px`, 400): linha secundária em tabela densa, texto de tooltip.
- **Label** (`10px`, 500, mono, uppercase, letter-spacing 0.04em): badge, header de coluna, breadcrumb segmento, código de status.
- **Numeric** (`12px`, 500, mono, `font-variant-numeric: tabular-nums`): toda quantidade numérica. Alinhado à direita em tabela. KPI grande sobe para 18–24px mantendo mono.

### Named Rules

**A Regra do Mono pra Número.** Qualquer número que o engenheiro vai comparar visualmente (qtd realizada vs planejada, percentual de aderência, dias trabalhados, valor financeiro) usa IBM Plex Mono com `tabular-nums`. Mesmo dentro de prosa: "executados 1.247 m²" → `1.247` em mono. O alinhamento de dígito é decisão de canteiro: engenheiro escaneia coluna de 50 linhas, dígito desalinhado é erro de leitura.

**A Regra da Unidade Visível.** Toda métrica numérica carrega unidade adjacente (m², m³, t, m, %, R$, unid). Unidade é `text-muted`, número é `text`. Nunca esconder unidade "porque o contexto explica".

**A Regra de Não-Traduzir.** O engenheiro conhece "BDI", "CPU", "fator de conversão", "snapshot", "baseline". Não simplificar pra leigo. Tooltip explica conceito derivado (aderência CPU = realizado/planejado × 100), não conceito básico.

## 4. Elevation

InfraWork é flat-by-default. Profundidade vem de **tonal layering**: 8 níveis de fundo escuro, cada camada acima ganha um clique de luminosidade (bg → bg-panel → bg-elevated → bg-hover → bg-active). Borda fina de 1px (`#1b1e26` ou `#262a35`) separa superfícies vizinhas com luminosidade próxima.

Sombra existe em três contextos específicos e em nenhum outro:

### Shadow Vocabulary

- **Popover ambiente** (`shadow-lg` ≈ `0 10px 15px -3px rgba(0,0,0,0.1)`): tooltip, popover, dropdown. Sinaliza que aquele elemento existe acima do fluxo de página.
- **Modal contundente** (`shadow-2xl` ≈ `0 25px 50px -12px rgba(0,0,0,0.25)`): dialog. Mais pesada para escurecer mentalmente o fundo, junto com backdrop `bg-black/60`.
- **Glow de accent** (`shadow-[0_0_0_1px_var(--accent-line)]`): borda fantasma de 1px atrás de botão primário. Não é sombra de elevação; é borda decorativa que reforça importância semântica.

### Named Rules

**A Regra do Flat-by-Default.** Painel, card, tabela, input: nenhum tem sombra em estado de repouso. Quem cria profundidade é a hierarquia de fundo + borda 1px. Sombra é resposta a estado (popover aparece, dialog abre), nunca decoração visual em estado parado.

**A Regra do Backdrop Sutil.** Modal usa `bg-black/60` + `backdrop-blur-sm`. Não confundir com glassmorphism: o blur só serve pra desfocar o conteúdo de trás durante decisão, não é tema visual de painel.

## 5. Components

### Buttons
- **Shape:** retângulo levemente arredondado, `rounded` (4px).
- **Altura:** sm `24px`, default `28px`, md `32px`, lg `36px`, icon `28×28px`. Padding horizontal 8–16px conforme tamanho.
- **Primary:** fundo `accent` (`#4d8eff`), texto `bg-tabs` (`#0a0b0e`), borda fantasma de 1px em `accent-line` translúcido. Hover sobe pra `accent-hover` (`#66a0ff`).
- **Secondary:** fundo `bg-elevated`, texto `text`, borda 1px `border-strong`. Hover sobe fundo pra `bg-hover` e borda pra `border-accent`.
- **Ghost:** sem fundo, texto `text-muted`. Hover ganha fundo `bg-hover` e texto sobe pra `text`. Uso predominante em toolbars densas.
- **Outline:** borda 1px `border-strong` sobre transparente. Hover ganha fundo `bg-hover`. Usado em filtros e ações terciárias.
- **Danger:** fundo `danger/15` (translúcido), texto `danger`, borda `danger/30`. Hover sobe pra `danger/25`. Nunca preencher 100% de vermelho num botão.
- **Link:** texto `accent`, hover `accent-hover` com underline. Apenas em prosa contínua, nunca em barra de ações.
- **Focus:** `focus-visible:ring-1 ring-accent` herdado em todo button. Custom buttons fora do componente devem replicar isso.

### Inputs / Fields
- **Style:** altura `28px`, fundo `bg-elevated`, borda 1px `border-strong`, radius `4px`, texto 12px `text`.
- **Placeholder:** `text-dim`.
- **Focus:** borda muda para `accent`, ganha `ring-1 ring-accent`. Sem glow exagerado.
- **Disabled:** opacity 0.5, cursor not-allowed.
- **Select nativo:** mesmo chassis do input, chevron 12px à direita em `text-muted`, padding-right reservado.

### Badges
- **Style:** pill compacta `padding: 2px 6px`, radius `3px`, fonte mono uppercase 10px com letter-spacing 0.04em.
- **Variantes:** `default` (fundo `bg-elevated`, texto `text-muted`), `accent`, `success`, `warn`, `danger`, `outline`. Status variants usam fundo translúcido a 15% + texto saturado + borda 30%.
- **Uso:** estado de medição, código de status SIGA, contador inline em header. Nunca como decoração de seção.

### Cards / Panels
- **Corner Style:** radius `4px` (md). Modal sobe pra `8px` (xl).
- **Background:** `bg-panel` (`#0f1116`). Painel aninhado pode ir pra `bg-elevated` (`#14171f`), mas três níveis aninhados de painel são proibidos.
- **Shadow Strategy:** flat. Profundidade só por luminosidade + borda 1px.
- **Border:** 1px `border` ou `border-strong` conforme proeminência.
- **Internal Padding:** 12px padrão; 16px só em modal; 8px em painel muito denso (timeline, lista).

### Dialog / Modal
- **Container:** `bg-panel`, borda `border-strong`, radius `6px`, `shadow-2xl`, `max-w` (sm 28rem / md 32rem / lg 42rem / xl 56rem).
- **Backdrop:** `bg-black/60` + `backdrop-blur-sm`, dismiss por click-outside (a menos que `disableDismiss`).
- **Header:** padding `16px 16px 12px`, borda inferior `border`, título `text-md font-semibold`, descrição opcional `text-xs text-muted`.
- **Footer:** padding `12px 16px`, borda superior `border`, ações alinhadas à direita com gap 8px.
- **Portal + z-index:** sempre via `createPortal` em `document.body`. Z-index padrão 50; quando precisa ficar acima de lightbox/leaflet, usa `topmost` → `z-[10010]`.
- **ESC:** fecha (a menos que `disableDismiss`). Botão X 14px no canto superior direito.

### Tooltip
- **Style:** `bg-elevated`, borda `border-strong`, radius `4px`, padding `4px 8px`, fonte 10px `text`, sombra `shadow-lg`.
- **Delay:** 250ms hover. Shortcut opcional aparece à direita em mono `text-faint`.
- **Posição:** top/right/bottom/left configurável. Default right.

### Popover / Dropdown
- **Style:** `bg-elevated`, borda `border-strong`, radius `6px`, padding 1, `shadow-xl`, min-width 220px, anima `slide-up` em 160ms.
- **Dismiss:** click-outside + ESC. Sem backdrop (não bloqueia interação atrás).
- **Alinhamento:** start/center/end relativo ao trigger.

### Tabelas (signature component)
- **Linha:** altura 24px (`density-compact`). Hover muda fundo pra `bg-hover`. Selecionada vai pra `bg-active`.
- **Header:** sticky no topo, fundo `bg-panel`, texto `text-muted` em label uppercase 10px mono, padding vertical 6px.
- **Coluna numérica:** alinhada à direita, fonte mono `tabular-nums`, com unidade em `text-muted` ao lado.
- **Status:** badge inline, nunca cor de fundo de linha inteira (cor não é único indicador).

### Charts (signature component)
- **Grid:** stroke `#1b1e26`, dash `2 3`. Eixo stroke `#3d4148`, label mono 10px `text-muted`.
- **Tooltip:** `bg-elevated` + borda `border-strong` + radius 4px + fonte mono 11px.
- **Série padrão (até 6):** `#4d8eff`, `#67e8f9`, `#4ade80`, `#fbbf24`, `#a78bfa`, `#f472b6`. Primeira série é sempre accent; as demais vêm dos módulos. Acima de 6 séries, agrupar em "outros".
- **ReferenceLine "Hoje":** linha vertical 1px `text-muted` dashed.

### Animações
- **fade-in:** opacity 0→1 em 120ms ease-out. Para tooltip e overlay.
- **slide-up:** translateY(4px)→0 + fade em 160ms ease-out. Para popover, dialog, dropdown.
- **accordion:** height 200ms ease-out. Para seção expansível.
- **Sem bounce, sem elastic, sem orquestração.** Animação só sinaliza mudança de estado, nunca decoração.

### Named Rules

**A Regra do Densidade Adaptativa.** Não há layout mobile, não há fluid typography. Monitor 27" e notebook 14" recebem o MESMO chassis. Quem ajusta a densidade na viewport menor é o usuário via `density-compact`, não o sistema via media query.

**A Regra do Componente Único.** Toda ação primária do app é o mesmo `<Button variant="default">`. Toda confirmação destrutiva passa pelo mesmo `useConfirm()`. Toda métrica numérica usa o mesmo helper de formatação. Inconsistência de vocabulário entre telas é bug visual.

## 6. Do's and Don'ts

### Do:

- **Do** usar `<Button>` para qualquer ação clicável. Custom button precisa replicar `focus-visible:ring-1 ring-accent` ou herdar `buttonVariants`.
- **Do** colocar unidade ao lado de todo número (`1.247 m²`, `97 %`, `R$ 3.400,00`). Número em mono, unidade em sans `text-muted`.
- **Do** usar `tabular-nums` em qualquer coluna numérica de tabela ou KPI.
- **Do** mostrar o fator de conversão explicitamente quando aplicado (`× 0,12 m²→t`). Engenheiro precisa ver o cálculo, não confiar cego.
- **Do** preservar terminologia técnica: CBUQ é CBUQ, BDI é BDI, fator é fator. Tooltip explica conceito derivado, não básico.
- **Do** usar `useConfirm()` em vez de `window.confirm()` para qualquer ação destrutiva.
- **Do** usar `createPortal` para qualquer overlay (dialog, popover, tooltip). Stacking context herdado é bug.
- **Do** dar foco visível em tudo que recebe teclado. Sem outline = bug de acessibilidade P1.
- **Do** dimensionar alvos de toque para no mínimo 24×24px (WCAG 2.2 SC 2.5.8). Botão de ícone hoje em `w-5 h-5` (20px) precisa subir para `w-6` ou maior.
- **Do** acompanhar cor de estado com texto ou ícone. Daltônico tem que ler aderência sem ver a cor.
- **Do** respeitar `prefers-reduced-motion`: cortar `slide-up` e `accordion` para usuário que pediu redução.

### Don't:

- **Don't** usar `#000` ou `#fff` puros. Toda neutra é tintada para o accent azul (chroma 0.005–0.01 em OKLCH).
- **Don't** subir `text-dim` (`#5b6068`) acima do valor atual sem aumentar contraste. Hoje ele falha WCAG AA (~3,16:1 contra `bg-panel`); precisa subir para ≥4,5:1. `text-faint` é decoração-só e nunca deve carregar informação essencial.
- **Don't** usar gradiente em texto (`background-clip: text` + gradient). InfraWork não tem gradiente em lugar nenhum.
- **Don't** usar `border-left` ou `border-right` maior que 1px como faixa colorida em card, alerta ou item de lista. Cor de estado vai em fundo translúcido (15%) + borda 1px completa.
- **Don't** usar glassmorphism como tema. `backdrop-blur-sm` no backdrop de modal é o único uso aceito.
- **Don't** ter "hero metric template" (número gigante decorativo + label + stat secundária + gradiente). KPI é grid denso de números, não palco.
- **Don't** repetir cards idênticos em grid (mesmo tamanho, ícone + heading + texto). Se as colunas mostram dados diferentes, a UI tem que mostrar isso.
- **Don't** usar modal como primeira ideia. Tente inline / popover / drawer antes. Modal só para decisão bloqueante.
- **Don't** usar emoji decorativo, mascote, confete, animação de celebração. Obra de R$ 50M não recebe `🎉`.
- **Don't** copiar visual de ERP tradicional (SAP/TOTVS/Sienge/Sage): árvore profunda, formulário gigante, paginação 1990, cor institucional fria.
- **Don't** copiar visual de PowerBI/AdminLTE/CoreUI: card SaaS azul-e-cinza idêntico, hero metric obrigatório, gradiente decorativo no card "receita".
- **Don't** copiar visual de Excel/planilha: grid sem hierarquia, sem cor semântica, sem navegação guiada. É o motivo do projeto existir.
- **Don't** usar travessão (em dash, `—`) na copy do produto. Vírgula, dois-pontos, ponto e vírgula, ponto ou parênteses resolvem.
- **Don't** mostrar mensagem genérica simpática ("Oops, algo deu errado"). Mensagem é específica e técnica: "Sync desabilitado para esta obra (sincronizar_fotos=false)".
- **Don't** colorir fundo de linha inteira de tabela como único indicador. Cor + texto + ícone, sempre.
- **Don't** animar propriedade de layout (height, width, top). Use transform/opacity. Animações já são curtas (120–200ms) e ease-out exponencial; nada de bounce/elastic.
