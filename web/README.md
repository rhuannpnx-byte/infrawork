# InfraWork — gestão de obras de infraestrutura (web)

Versão web do InfraWork: orçamento, composições,
cronograma (motor do ApeX) e acompanhamento de produção, sem integrações
proprietárias (não usa SIGA, nem a planilha de planejamento da TecPav).

- SPA em **Vite + React 19 + TypeScript + Tailwind** (`web/src`).
- Backend **Supabase** (`web/supabase`): Postgres + RLS, Edge Functions (Deno),
  Storage, `pg_cron`.
- Multi-tenant por `empresas` → `obras`, papéis `god / adm / engenheiro /
  apoio / cliente`.

## Módulos

| Módulo | O que faz |
|---|---|
| Gerencial | empresas, obras, usuários, permissões |
| Orçamento | recursos, **composições** (CPU) simplificadas, planilha de venda + **serviços com rateio**, **aditivos**, **reajustes**, taxas — com **modelos XLSX** de importação (recursos, composições, orçamento) |
| Planejamento | **cronograma** (Gantt) e **tempo-caminho** com o motor do ApeX, calendários, serviços (equipe = composição), recursos, curva-S, comparar, **planos e linhas de base**, trechos e quantidades, **modo controle** (realizado e previsão) |
| Acompanhamento | **Lançar produção** (celular em `/lancar`), produção, fotos & mapa, previsto × realizado, valor agregado/medição, performance, alertas |

### Cronograma e tempo-caminho (motor do ApeX)

O cronograma usa o motor do ApeX (cópia em `vendor/apex`, sem alterações; decisões em
`docs/cronograma-apex/DECISOES.md`). Uma tarefa é um serviço do orçamento com quantidade, locais (trecho + faixa de
estacas, ou sem local) e equipes; a **equipe do serviço é a composição** (produção/dia e recursos), × nº de equipes,
× coeficiente da taxa. O motor programa ASAP ou pelo início desejado, com dependências (término-início, início-início,
término-término, início-término e por estacas, com atraso mínimo/máximo), restrições, marcos (com filtro de estacas,
serviços e recursos), limites de recursos, nivelamento das equipes nomeadas, calendários (vários por obra, feriados,
feriados móveis brasileiros, folgas, horários excepcionais, fator de produtividade do mês) e dependências derivadas
entre serviços.

- O banco é a fonte da verdade; o navegador remonta o projeto do ApeX num Web Worker a cada mudança
  (`features/cronograma/motor`), calcula e grava os resultados por `planejamento_gravar_calculo` (datas, folgas,
  violações, trechos de tarefa, perfis diário e semanal), conferindo a revisão dos dados (`dados_rev`). Recalcular a
  partir do banco chega às mesmas datas (ponto fixo, testado).
- Visões (`features/cronograma/components`): **Gantt** (arrastar início/término, criar dependências, menus e
  diálogos do ApeX), **tempo-caminho** (estacas × tempo, a "escada" de cada tarefa, arraste e dependências),
  **recursos** (uso empilhado e limites), **calendários** e **serviços**. Os comandos de edição rodam no motor (prévia
  imediata) e o banco recebe só o que muda.
- **Modo controle** (propriedade do plano): a produção lançada até a data de controle vira os realizados do ApeX; o
  Gantt mostra o executado e o término previsto, o tempo-caminho as séries realizada (pontilhada) e prevista
  (tracejada). O planejado não muda.
- Empate de prioridade: vai antes quem vem antes no plano (DECISOES D-10).
- Planos: copiar (`planejamento_copiar`) e travar (`planejamento_promover`) são RPCs; "restaurar como nova linha de
  base" é orquestrado no cliente (cópia → cálculo → trava).

### Planilha de venda, serviços e rateio

A planilha de venda (etapas + receitas) fica **exatamente como o contrato**:
agrupar nunca move receitas. Os serviços (`servico_grupo`, códigos `S01`…) ficam
fora da árvore e recebem receitas por **alocação** (`item_orc_alocacao`), com
fração — uma receita pode ser **rateada** entre vários serviços por %, por peso
(quantidade física) ou proporcional à venda (recalcula sozinho).

- venda do serviço = Σ venda da receita × fração; quantidade = Σ quantidade das
  receitas que *compõem* × fração (ou manual); custo = composição × quantidade,
  apropriado de volta às receitas/etapas pela venda alocada.
- totais: venda = planilha de venda; custo direto = serviços.
- receita alocada não pode ser excluída (remova a alocação antes).
- serviço sem composição soma a venda, mas fica fora de custo, programação e
  produção até ser vinculado.
- tela: símbolo de alocação por linha (filtro no cabeçalho), barra de progresso
  do agrupado, painel Serviços (destaque/arrastar), "Agrupar em…", "Ratear…".
- modelo XLSX v4: tudo na aba "Orçamento" (serviço, compõe, bloco recolhido com
  rateio e quantidade/unidade manual do serviço); aba "Agrupamentos" só por
  fórmula. "Exportar modelo" gera o mesmo
  formato a partir do sistema (ida e volta).

### Cadeia ao vivo, linhas de base e vigente

- **Cadeia ao vivo:** recurso → composição → serviço → orçamento → plano em edição
  recalculam sozinhos (`vw_servico_vivo`; recálculo adiado, uma vez por obra no fim
  da transação — `orcamento_recalculo_pendente`). Não há snapshot de CPU nem
  botões de atualização manual; o histórico de preços dos recursos é mantido.
- **Planos:** 0..1 plano em edição, até 20 linhas de base travadas (cada uma com
  as próprias premissas em `planejamento_lb_premissa` + calendário) e 0..1
  vigente — a régua do acompanhamento. Sem vigente, a última que foi vigente
  vale como referência provisória (`planejamento_referencia`).
- **Trava da cadeia** (`cadeia_trava_motivo`): recursos, composições, serviços,
  orçamento e indiretos só mudam sem vigente e com plano em edição (ou antes de
  qualquer linha de base). Linha de base com premissas mudadas não volta a ser
  vigente: "Restaurar como nova linha de base" cria uma nova, recalculada.
- Σ tarefas de um serviço ≤ quantidade do serviço (`trg_tarefa_limite_servico`).

### Aditivos e reajustes

- **Aditivos** (datados, N por obra): acréscimo/supressão, exclusão (só receita
  não alocada) e itens novos (saldo ou já alocados). O 1º arquiva a **Planilha
  Inicial**; depois a planilha de venda só muda por aditivo. Supressão é recusada
  só se o serviço ficar abaixo do executado. Permitidos com plano vigente.
- **Reajustes** anuais por grupos de índices (fator = atual ÷ anterior,
  encadeado); 1º ≥ 12 meses da data-base, seguintes ≥ 12 meses do anterior.
  Prospectivos: `receita_preco_em(receita, data)`.
- **Valor agregado:** avanço físico × valor do serviço no contrato atual, ao
  preço do dia (reajuste); acima de 100% do serviço vai para "executado além do
  contrato". Planejado = premissa da linha de base × fator de reajuste do dia.
- **Curva-S do planejamento** (e Comparar): receita com o mesmo reajuste datado —
  cada semana de cada tarefa é repartida pelo perfil diário do cronograma e cada
  dia vale ao seu preço. Linha de base: fator = preço do dia ÷ preço quando foi travada;
  plano em edição: preço do dia ÷ preço atual.
- O antigo módulo "Revisões" do orçamento foi removido (migração 0024).

### Locais, quantidades por local e tempo-caminho (a lógica do DynaRoad)

- `/planejamento/trechos` (**Locais**): **eixos** = nome + unidade (km, estaca
  20 m, m ou custom) + estaca inicial e final (`comprimento_m`; o mapa KMZ/KML é
  opcional e só enriquece) e **áreas** = locais sem estacas (`tipo = 'area'`).
  Posições são metros internos no eixo (0…comprimento). Encurtar um eixo abaixo
  de um local, de um segmento de quantidades ou de uma faixa de marco é recusado.
- **Planilha de quantidades por local** (template, 1 por local, com versões):
  grade na tela (passo por unidade, N unidades, N m ou faixas livres; rodapé com
  total · em tarefas · outros locais · orçamento · disponível) e **importação**
  (`lib/quantidades/boq-xlsx.ts`): uma aba por local — por estaca (coluna
  "Estaca" + serviços, regra dos pontos médios e o zero fecha a sequência, como
  no DynaRoad), por faixa (Início/Fim) ou a aba "Áreas"; colunas → serviços com
  mapeamento salvo na obra (`trecho_quantidade_mapeamento`). Gravação por
  `trecho_salvar_quantidades`: Σ dos locais ≤ orçamento; tarefas "do template"
  acompanham. Exportação multi-aba (ida e volta).
- **Tarefa = seus locais** (`planejamento_tarefa_local`): eixo + faixa ou área,
  quantidade `manual` | `trecho` (do template; calculada no banco pela sobreposição
  e recalculada a cada versão). "Criar tarefas" nasce das quantidades por local
  (`planejamento_tarefas_criar_das_quantidades`: uma tarefa por sequência contígua,
  por local ou por janela de N m) ou manualmente; RPCs do ApeX: dividir por estaca
  (`planejamento_tarefa_dividir_estaca`), por quantidade, combinar, renomear
  automaticamente (`<serviço> <trecho> N`) e mudar de trecho (`adjustedSpan`).
  No Gantt, colunas Trecho e Estacas vêm dos locais; linhas de local/serviço somam.
- `/planejamento/tempo-caminho`: eixos lado a lado + áreas como colunas, faixa de
  quantidades por estaca sob o cabeçalho, modo Dividir (clique na estaca), áreas
  das tarefas-resumo, indicador de tarefas fora da visão. Gantt e tempo-caminho
  compartilham o **filtro da visão** (resumo, locais, serviços, equipes).
- Controle por estaca: o lançamento de produção aceita local + estacas
  (`trecho_id`, `posicao_inicio_m/fim_m`); o realizado cai na tarefa cujo local
  cobre a faixa (rateio pela sobreposição) e só sem faixa vale a regra por equipe.

### Lançamento de produção

`/acompanhamento/lancar` (dentro do app) ou `/lancar` (modo campo, sem menu,
para celular). Lança por item do orçamento com composição, equipe,
encarregado, frente, estacas, materiais e fotos (comprimidas no aparelho,
GPS/hora do EXIF). Lote por dia (desktop) e importação por modelo XLSX com
"desfazer importação". Tabelas: `acompanhamento_producao`,
`acompanhamento_producao_material`, `acompanhamento_foto`, `encarregado`.
Apoio só edita o que lançou (RLS `pode_lancar_producao`).

### Parametrização dos serviços, viagens e o app de campo

- **Planejamento › Parametrização** (antes do cronograma): por serviço do
  orçamento, o modo de lançamento (quantidade ou **viagens**), o **material
  controlado** (recurso de material e unidade — o lançamento pede a quantidade
  e a tela mostra a média lançada por unidade produzida ao lado do previsto na
  composição), observação habilitada e local/estacas obrigatórios
  (`servico_parametro`, `vw_servico_consumo_material`).
- **Viagens** (Acompanhamento › Viagens e app de campo): ficha do caminhão no
  dia + viagens com origem, destino, estaca na pista, quantidade, DMT e
  NF/ticket. A produção do dia do serviço é a **soma das viagens**, recomposta
  no banco por (dia, serviço, local) — o cronograma, a Curva-S e o controle por
  estaca leem como qualquer produção. Cadastros: **Gerencial › Frota** (por
  empresa) e **Acompanhamento › Origens e destinos** (com rotas/DMT).
- **App de campo** (`../campo`, PWA, cópia do Monito Mobile): produção, viagens
  e fotos offline, gravando aqui pelas RPCs `campo_*` (idempotentes pelo UUID do
  aparelho). Usuários de campo têm o papel **apontador** (só o app, só as obras
  liberadas). Dados de teste: `node scripts/seed-campo.mjs` depois do
  seed-cronograma.

## Pré-requisitos

- Node ≥ 20.19, npm.
- [Supabase CLI](https://supabase.com/docs/guides/cli) ≥ 2.100 (logado:
  `supabase login`).
- Docker Desktop (para o stack local).

## Setup local

```bash
cd web
npm install
cp .env.example .env            # URL + chave publishable do projeto remoto
supabase start -x logflare,vector,imgproxy,studio   # Postgres 17 + API + Storage + Auth
```

Para o `npm run dev` apontar ao stack local, crie `web/.env.development.local`
(ignorado pelo git; só vale em modo *development*):

```
VITE_SUPABASE_URL=http://127.0.0.1:55321
VITE_SUPABASE_ANON_KEY=<Publishable key do `supabase status`>
```

Usuário inicial (God):

```bash
SUPABASE_URL=http://127.0.0.1:55321 \
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY do `supabase status -o env`> \
SEED_GOD_EMAIL=god@infrawork.local SEED_GOD_PASSWORD='<senha>' SEED_GOD_NAME='God' \
node supabase/seeds/seed-god.mjs
```

Edge functions localmente: `supabase functions serve` (em outro terminal).
Depois `npm run dev` → http://localhost:5173.

Scripts: `npm run typecheck`, `npm run lint`, `npm run build`, `npm run format`,
`supabase db reset` (reaplica todas as migrações do zero).

Teste de ponta a ponta (empresa → obra → importações → cronograma no motor do
ApeX → linha de base → produção → aditivos/reajustes → trechos), com o stack e as
functions locais no ar. Roda no `vite-node` para usar o motor e a carga do
cronograma do próprio app:

```bash
VITE_SUPABASE_URL=http://127.0.0.1:55321 VITE_SUPABASE_ANON_KEY=<publishable> \
E2E_EMAIL=god@infrawork.local E2E_PASSWORD='<senha>' npx vite-node scripts/e2e-local.mjs
```

Testes do motor e das visões: `npx vitest run src/features/cronograma` (o teste
de integração com o banco local roda com `CRONOGRAMA_LOCAL=<planejamento_id>`).

> `supabase/config.toml` mantém `[auth.email] enable_signup = true`: no CLI
> esse flag liga/desliga o **provedor** e-mail inteiro (com `false` o login por
> senha para de funcionar). O cadastro de usuários continua só pela function
> `create-usuario`. No projeto remoto, deixe *Enable Email provider* ligado e
> *Allow new users to sign up* desligado (Auth → Providers → Email).

## Deploy (projeto remoto)

```bash
cd web
supabase link --project-ref <ref>        # pede a senha do banco
supabase db push                         # migrações
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service role>   # usada pelas functions
npm run fn:deploy                        # supabase functions deploy --use-api
```

Uma vez por ambiente, no SQL Editor, cadastre os segredos do cron de alertas:

```sql
select vault.create_secret('https://<ref>.supabase.co', 'project_url');
select vault.create_secret('<service role key>', 'service_role_key');
```

Auth → URL Configuration: *Site URL* e *Redirect URLs* com o domínio da SPA.
Hospedagem estática (Vercel: `rootDirectory = web`, `vercel.json` já traz o
rewrite SPA e os headers CSP). Variáveis: `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY` e, opcional, `VITE_STORAGE_PREFIX`.

## Design

O design é o mesmo do InfraWork desktop: tema escuro único, tokens em
`src/styles/theme.css` (OKLCH, hue 255). Componentes, gráficos e mapas usam
sempre `var(--…)`; exportações XLSX e o relatório impresso usam as cores fixas
do desktop.

## Diferenças em relação ao desktop (InfraWork)

- Sem Electron: arquivos são baixados pelo navegador; PDF sai pelo diálogo de
  impressão (`lib/print/print-html.ts`, A4 paisagem; recomendado Chrome/Edge).
- Atalhos que o navegador reserva (`Ctrl+W`, `Ctrl+1..9`, `Ctrl+Shift+T`)
  viraram `Alt+…`.
- Removidos: integração SIGA, WhatsApp, Documentação/IA, agrupamento por IA e
  MS Project. O cronograma usa o motor do ApeX (Gantt e tempo-caminho próprios).
- Abas em memória + sincronização com a URL (deep link e F5 funcionam).

## Estrutura

```
web/
  src/app          router (uma instância por aba), AuthGate, url-sync
  src/features     gerencial · orcamento · planejamento · cronograma · acompanhamento
  vendor/apex      motor do ApeX (cópia, sem alterações)
  src/lib/xlsx     modelos de importação (spec → gerar + ler)
  supabase/migrations   161 migrações originais + 20260701* (prune, storage,
                        cron, importação, programação por equipes,
                        acompanhamento nativo, views, alertas)
  supabase/functions    edge functions mantidas (Deno)
```

Benchmark de produtividade entre obras (`acompanhamento_perf_historico`)
depende do mesmo `servico.codigo` entre obras — mantenha os códigos do catálogo
consistentes ao importar composições.
