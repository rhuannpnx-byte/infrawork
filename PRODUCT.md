# Product

## Register

product

## Users

**Persona primária: Engenheiro de obra (TecPav)**
Profissional técnico que entra todo dia no app. Trabalha **híbrido — escritório no monitor grande, notebook em canteiro/reunião**. Conhece intimamente a terminologia: CPU, BDI, fator de conversão, baseline, snapshot, indireto, planejamento ativo. Não precisa que o app explique conceitos básicos; precisa que ele exiba os números certos rápido.

**Personas secundárias:**
- **Apoio / Coordenador de Planejamento**: passa muito tempo lançando/editando orçamento e cronograma, baixando relatórios, preparando medições. Densidade de tabela importa pra ele.
- **Gestor / Administrador (você, diretoria TecPav)**: usa principalmente o Dashboard pra ver avanços, alertas críticos, indicadores. Pouca edição, muito olhar.

**Contexto físico**: monitor 27" em escritório → notebook 14" em obra. Mesmo design funciona nos dois sem requalificar.

## Product Purpose

> **Substituir Excel + relatórios manuais pelo único fluxo unificado: planejei, executei, vi.**

O engenheiro deixa de viver em 3 sistemas + planilhas paralelas + WhatsApp. Toda a vida da obra (orçamento versionado, cronograma com baseline, apontamento SIGA, fotos georreferenciadas, alertas, dashboard) acontece num único app, sincronizado, com histórico.

**Critério de sucesso operacional**: o engenheiro abre o app cedo, navega Dashboard → identifica desvio → vai pra Planejamento ou Acompanhamento → toma decisão → fecha. Sem precisar abrir Excel, sem cruzar com email, sem perguntar no grupo.

## Brand Personality

**Três palavras: Confiável · Técnico · Direto.**

- **Confiável**: o número que o app mostra é o número certo. Erros em cálculo, sync ou copy são bugs sérios — engenheiro vai assinar medição baseado nisso. Sem hesitação, sem placeholders simpáticos ("oops, algo deu errado").
- **Técnico**: vocabulário de engenharia rodoviária preservado. CBUQ é CBUQ, não "pavimento asfáltico". Fator de conversão é exibido (`× 0.12`), não escondido. Unidades sempre presentes (m², m³, t, m, unid).
- **Direto**: cada elemento de UI tem propósito operacional. Sem hero metric decorativo, sem confete de sucesso, sem skeleton elaborado quando spinner basta. Mensagens vão ao ponto: "Sync desabilitado para esta obra (sincronizar_fotos=false)" diz mais que "Algumas configurações precisam de atenção".

**Inspirações tonais**: Linear (densidade respeitosa + tom seco), Stripe Dashboard (data-first, sem floreio), Raycast (atalho > caminho).

## Anti-references

O InfraWork explicitamente **NÃO** deve lembrar:

- **ERPs tradicionais (SAP, TOTVS, Sienge, Sage)** — densos demais, datados, navegação em árvore profunda, formulários enormes, cores institucionais frias, paginação 1990. O que estamos substituindo.
- **Planilhas Excel-look (linhas infinitas, cabeçalho ZA-ZZ)** — visual de grid sem hierarquia, sem cor semântica, sem navegação guiada. O motivo do projeto existir.
- **Dashboards corporativos genéricos (PowerBI templates, AdminLTE, CoreUI)** — templates SaaS azul-e-cinza com cards idênticos, hero-metric obrigatório, gradiente decorativo no card de receita. AI slop saturado.
- **Apps consumer / gamificados (Duolingo, Notion playful, Linear's onboarding)** — mascotes, emojis decorativos, "Welcome aboard! 🎉", animações de celebração. Inadequado pro tom sério de uma obra de R$ 50M.

## Design Principles

1. **Terminologia primeiro, simplificação nunca.** O engenheiro reconhece "BDI 28,5%", "snapshot da CPU", "fator de conversão 0,12 m²→t". Não traduzir pra leigo. Tooltips explicam conceitos derivados (aderência CPU), não conceitos básicos.

2. **Números antes da narrativa.** Avanço físico, dias trabalhados, qtd realizada, desvio dias — esses são a UI. Texto explicativo entra DEPOIS dos números e em escala menor. O engenheiro lê o número e decide; descrição é segundo plano.

3. **Densidade adaptativa, não responsividade fluida.** O monitor 27" e o notebook 14" recebem o MESMO layout. Densidade alta é intencional — engenheiro quer ver máximo na viewport. Não tem layout mobile (não é caso de uso), não tem fluid typography.

4. **Sem decoração.** Cada pixel justifica espaço. Sem gradiente que não conduz estado. Sem animação que não comunica mudança. Sem ícone que não diferencia ação. Sem card que não agrupa algo legítimo. **Funcionalidade > flourish, sempre.**

5. **Erro de dado é P0 sempre.** Confiar nos números é decisão de canteiro. Se a Curva-S mostra menos do que deveria, se a unidade não está convertida, se a contagem inclui registro deletado, é bug crítico. Mais grave que crash. Mais grave que UX ruim. Estes têm precedência de fix sobre qualquer outra coisa.

## Accessibility & Inclusion

**Meta: WCAG 2.2 AA estrito.**

- **Contraste mínimo 4,5:1** pra texto < 18px (que é praticamente todo texto na app — corpo 12px). Hoje `--text-dim` falha em ~3,16:1 e precisa subir.
- **Focus visível em tudo** que recebe teclado. Custom buttons fora do componente `<Button>` precisam herdar `focus-visible:ring`.
- **Touch / mira mínima 24×24** (WCAG 2.2 SC 2.5.8). Botões de ícone hoje em `w-5 h-5` (20px) precisam virar `w-6 h-6+`.
- **Cor não pode ser único indicador de estado.** Verde/amarelo/vermelho de aderência precisam acompanhar texto ou ícone.
- **Sem motion sickness**: respeitar `prefers-reduced-motion` (Electron tem essa API), evitar parallax, animação só pra feedback de estado.
- **Lei Brasileira de Inclusão (LBI 13.146)** se aplica como contexto regulatório, mas o WCAG 2.2 AA já cobre as exigências práticas.

Quando a11y bate de frente com densidade (caso raro, geralmente conciliável), **a11y vence** — engenheiro veterano com presbiopia tem que conseguir ler o número, mesmo que custe 2px de respiração.
