# Changelog

## [0.1.0] - 2026-05-24

Primeira release beta distribuída. Pipeline de auto-update via GitHub Releases ativo.

### Disponível nesta release

- **Home** — página inicial com seleção de módulos, contexto atual (empresa/obra/papel) e branding InfraWork.
- **Módulo Gerencial** — CRUD de empresas, usuários, obras e permissões; controle granular por papel (God / Adm / Engenheiro / Apoio).
- **Módulo Orçamento** — recursos, serviços, CPUs, planilha orçamentária, indireto, lucratividade, revisões versionadas. Importação via Excel.
- **Módulo Planejamento** — cronograma físico (Gantt), calendários, equipes, dependências, curva-S baseline imutável, comparativo entre revisões.
- **Módulo Acompanhamento** — vínculo obra↔SIGA com sync horário de produção e fotos georreferenciadas. Dashboard estratégico, previsto×realizado, mapa satélite com clusters de fotos, motor de alertas de desvio com regras configuráveis.
- **Auto-update** — verifica releases no startup e a cada 4h; baixa em background; toast pra reiniciar quando pronto.

### Infraestrutura

- Build Windows x64 via electron-builder + NSIS, publicado em GitHub Releases por workflow do GitHub Actions ao push de tag `v*.*.*`.
- Bundle 4.8 MB (renderer) + ícone/wordmark InfraWork integrados ao instalador.

## Não lançado — Módulo Gerencial (2026-05-22)

Primeiro módulo real ligado às Edge Functions deployadas. Implementa o CRUD básico do RBAC: empresas, usuários, obras e permissões.

### Adicionado

- **`types/module.ts`** ganhou `requiredRoles?: Role[]` em `ModuleConfig`, `ModuleSection`, `ModuleNavItem`, `ModulePill` e `ModuleAction`, mais um helper `visibleFor(items, role)` para filtrar arrays declarativos.
- **`config/modules.ts`** ganhou o módulo `gerencial` (atalho `G G`), pinned no topo do rail, com pills (Empresas / Usuários / Obras) e seções que aparecem só para os papéis apropriados.
- **`PrimaryRail`** e **`SecondarySidebar`** passam a filtrar módulos/pills/seções/itens pelo papel do `auth-store` — Apoio não vê o módulo, Engenheiro vê só Usuários (Apoios), Adm vê Usuários + Obras, God vê tudo + Empresas.
- **`types/gerencial.ts`** com `Empresa`, `UsuarioRow`/`UsuarioComEmpresa`, `Obra`/`ObraComEmpresa`, `ObraPermissao`.
- **`features/gerencial/hooks/`** com React Query wrappers: `useEmpresas`, `useUsuarios`, `useEngenheiros(empresaId)`, `useObras`, `useObra(id)`, `useObraPermissoes(obraId)`. Leituras via SDK (RLS filtra), escritas via `adminApi` (Edge Functions): `useCreateEmpresa`, `useCreateUsuario`, `useCreateObra`, `useGrantPermissao`, `useRevokePermissao`. Invalidação de cache por queryKey.
- **`features/gerencial/modals/`**:
  - `NewEmpresaDialog` — God only (validação no front; RLS na fonte).
  - `NewUsuarioDialog` — role-aware: God escolhe papel/empresa/engenheiro_id livremente; Adm seleciona entre Adm/Eng/Apoio (empresa forçada); Engenheiro só pode criar Apoio (engenheiro_id = caller.id, papel e escopo bloqueados na UI).
  - `NewObraDialog` — God escolhe empresa; Adm tem empresa fixa.
  - `GrantPermissaoDialog` — lista Engenheiros ativos da empresa da obra, já excluindo quem tem permissão; aviso visual que Apoios herdam.
- **Páginas em `app/routes/gerencial/`**:
  - `index.tsx` — dashboard com 3 cards de contagem (empresas/usuários/obras), filtrados por papel, e bloco explicando o que o papel atual pode fazer.
  - `empresas.tsx` — DataTable com razão social/CNPJ/status/data; botão "Nova empresa" só pro God.
  - `usuarios.tsx` — DataTable com nome/email/role (badge colorido)/empresa/engenheiro_responsável/status; respeita escopo.
  - `obras.tsx` — DataTable; clicar abre detalhe.
  - `obra-detail.tsx` — sumário da obra + tabela "Engenheiros com acesso" mostrando os Apoios que herdam por linha (badges); revogar acesso usa `ConfirmDeleteDialog` com aviso quando há Apoios em cascata.
- **Router** ganhou rotas concretas para `/gerencial`, `/gerencial/empresas`, `/gerencial/usuarios`, `/gerencial/obras`, `/gerencial/obras/$id`. Sai do catch-all genérico.
- **Atalho `G G`** mapeado para `/gerencial` em `useShortcuts.ts`.

### Defesa em profundidade

- **UI** esconde botões/pills/seções proibidos.
- **Páginas** mostram empty state "Sem permissão" para acessos indevidos.
- **Edge Functions** validam papel + forçam `empresa_id`/`engenheiro_id` do caller antes de inserir.
- **RLS** é a barreira final no banco.

### Resultado

- Typecheck node + web limpos.
- Build de produção: 3.02 MB JS / 29.6 KB CSS.
- Primeiro fluxo end-to-end funcionando: login → /me → /gerencial → criar empresa → criar usuário → criar obra → conceder acesso → ver Apoios herdando.

---

## Não lançado — Limpeza pré-integração front+back (2026-05-22)

Removidas as páginas e dados do scaffold para abrir caminho à implementação real contra Supabase. **Mantidos** todo o esqueleto reutilizável: shell, design system, primitivos UI, modais, charts, gantt, DataTable, atalhos e auth.

### Removido

- `src/renderer/src/lib/mock-data/` (folder inteira: projeto, composições, insumos, tarefas-gantt, boletins, rdos, fornecedores, equipe, usuários, curva-s, curva-abc).
- `src/renderer/src/lib/api/mock-adapter.ts` e `lib/api/endpoints/` (mock-bound).
- `src/renderer/src/types/domain.ts` (tipos `Composicao`/`Insumo`/`TarefaPlanejamento`/etc. do scaffold).
- `src/renderer/src/stores/project-store.ts` (será reintroduzido como `obra-store` quando a feature de obras for ligada).
- `src/renderer/src/features/*` (todos os feature hooks — eram wrappers do mock-adapter).
- Páginas mock-implementadas: `/visao`, `/orcamento/*`, `/planejamento/*`, `/acompanhamento/*`, `/medicoes`, `/suprimentos`, `/equipe`, `/documentos`, `/relatorios`.
- Modais entity-específicos: `NewCompositionDialog`, `NewInsumoDialog`.
- DataTable columns: `composicoes.tsx`, `insumos.tsx`.
- Dependências: `axios-mock-adapter`, `@faker-js/faker` removidas do `package.json`.

### Refatorado

- **Router**: cada um dos 9 módulos agora tem um catch-all (`$`) que renderiza `PlaceholderPage` resolvendo o título contra `config/modules.ts`. Sub-rotas concretas voltam à medida que features forem implementadas.
- **MenuBar**: pill de projeto passou a ler `empresa` do `auth-store`. Mostra "Acesso global" para God ou "Sem empresa" para perfil sem `empresa_id`.
- **StatusBar**: indicador de conexão amarrado ao `auth-store.status`. Mostra empresa atual e contagem de obras visíveis. Sem mais SICRO/DNIT hardcoded.
- **ProjectSwitcher**: lê `obras` do `auth-store` (vindas do `/me`); empty state apropriado por papel. Botão "Nova obra" só aparece para God/Adm.
- **CommandPalette**: removida seção "Composições"; ações agora são genéricas (trocar obra, configurações, atalhos, sair).
- **SecondarySidebar**: mapping de `onClick` removeu as chaves de modais deletados.
- **Providers**: removido `ProjectBootstrap` (consumia `projetoApi` mock).
- **`lib/api/client.ts`**: simplificado para axios genérico (sem conditional load do mock-adapter).
- **Gantt/Charts**: tipos de dados inlineados (`GanttTask`, `CurvaSDataPoint`, `CurvaABCItem`) — desacoplados do antigo `types/domain.ts`. Componentes seguem 100% reutilizáveis.
- **`ShareDialog`**: lista de usuários virá do backend; URL hardcoded do GO-060 trocada por placeholder.

### Preservado (continua reutilizável)

- Tokens CSS + Tailwind config.
- Todos os primitivos UI em `components/ui/`.
- Shell completo (`components/layout/*`).
- `components/data-table/DataTable.tsx` (genérico, aceita `ColumnDef<T>`).
- Charts (`CurvaSChart`, `CurvaABCChart`, `HistogramaRecursos`, `KPICard`).
- Gantt (`GanttView` + CSS dark).
- Modais shells (CommandPalette, ProjectSwitcher, ConfirmDelete, Export, Share, Settings, FilterSheet, KeyboardShortcuts, SimpleFormDialogs).
- `config/modules.ts` (single source of truth da navegação).
- Atalhos, Stores (`ui`, `tabs`, `settings`, `auth`), Supabase client + AuthGate + LoginPage + Edge Functions wrappers.
- Formatadores pt-BR e camada IPC.

### Resultado

- Typecheck e build limpos.
- Bundle do renderer: **3,629 kB → 2,749 kB** (-24%); CSS: **40 kB → 29 kB**.
- Próximo passo: implementar cada módulo contra Supabase, começando por **Empresas → Obras → permissões** (UI do Adm), depois Orçamento/Planejamento/etc.

---

## Não lançado — Auth & RBAC (Supabase) (2026-05-22)

### Adicionado

- **Schema do RBAC** (`supabase/migrations/20260522120000_init_schema.sql`):
  - Enum `role_enum ∈ {god, adm, engenheiro, apoio}`.
  - Tabelas `empresas`, `profiles` (FK em `auth.users`), `obras`, `obra_permissoes` com índices e checks (`chk_god_no_empresa`, `chk_apoio_has_engenheiro`).
  - Funções helper `auth_role()`, `auth_empresa_id()`, `auth_engenheiro_id()` — SECURITY DEFINER + owner `postgres` (BYPASSRLS) para evitar recursão dentro das policies de `profiles`.
- **Policies RLS** (`supabase/migrations/20260522120001_rls_policies.sql`) cobrindo SELECT/INSERT/UPDATE/DELETE em todas as 4 tabelas, espelhando a matriz:
  - God: tudo.
  - Adm: própria empresa.
  - Engenheiro: vê apenas obras com `obra_permissoes`; pode criar Apoio vinculado a si.
  - Apoio: herda obras via JOIN `obra_permissoes.user_id = profiles.engenheiro_id`.
- **Seed idempotente do God** (`supabase/seeds/seed-god.ts`, Deno): `auth.admin.createUser` + upsert do profile, lendo `SEED_GOD_EMAIL` e `SEED_GOD_PASSWORD` do env. Re-executável sem efeitos colaterais.
- **6 Edge Functions** (`supabase/functions/*`, Deno) com validação de papel em código antes de tocar o banco:
  - `create-empresa` (God)
  - `create-usuario` (God / Adm / Engenheiro — força escopo de empresa e engenheiro_id quando aplicável; cria via Auth Admin API; rollback do auth.user se o insert do profile falha)
  - `create-obra` (God / Adm)
  - `grant-obra-permissao` (God / Adm; só aceita Engenheiro como target)
  - `revoke-obra-permissao` (God / Adm; cascata automática para Apoios via JOIN)
  - `me` (qualquer autenticado — retorna profile + empresa + obras resolvidas)
  - Helpers compartilhados em `_shared/auth.ts` e `_shared/cors.ts`.
- **Testes RBAC** (`supabase/tests/rbac.test.ts`, Deno) cobrindo os 5 cenários do prompt: God cria empresa, Adm não cria, Engenheiro não vê obra sem permissão, Apoio vê o que o Engenheiro vê, revogação cascateia para o Apoio.
- **Integração no renderer**:
  - `@supabase/supabase-js` instalado; cliente em `lib/supabase/client.ts` ligado por `VITE_USE_SUPABASE`.
  - `stores/auth-store.ts` (Zustand) com bootstrap de sessão, `signInWithPassword`, `signOut`, `refreshMe`, escuta `onAuthStateChange`.
  - `lib/supabase/functions.ts` — wrappers tipados das 5 admin functions.
  - `app/routes/LoginPage.tsx` — tela de login dark, autofocus, validação.
  - `app/AuthGate.tsx` — gateia o router: mostra Login quando `status === 'guest'`.
  - `MenuBar` ganha menu do usuário com avatar (iniciais), nome/email/empresa e botão "Sair".
  - Em modo mock (`VITE_USE_SUPABASE !== 'true'`) o app boota direto com uma sessão sintética de God — preserva o fluxo DEV anterior.
- **Documentação**:
  - [`supabase/README.md`](supabase/README.md) com setup local/remoto, env vars, comandos, matriz de papéis, lista de endpoints.
  - Seção dedicada no README principal.

### Decisões técnicas

- **Edge Functions em vez de Node backend separado** — InfraWork é Electron desktop, evitamos infra extra. RLS é a autorização primária; functions adicionam defesa em profundidade para ops privilegiadas (Auth Admin API).
- **Helpers `SECURITY DEFINER` + owner `postgres`** — evita recursão de RLS ao consultar `profiles` dentro de policies em `profiles`.
- **Apoio sem linha própria em `obra_permissoes`** — acesso é derivado por JOIN. Revogação automaticamente em cascata.
- **Adm/Engenheiro com `empresa_id` forçado** — mesmo se o cliente enviar `empresa_id` no body, a Edge Function sobrescreve com a empresa do caller (defesa contra IDOR).

---

## 0.1.0 — Scaffold inicial (2026-05-22)

Primeira versão funcional do frontend do InfraWork. Construído por etapas conforme o prompt de scaffold:

### Adicionado

- **Bootstrap Electron + React 19 + TypeScript** via electron-vite (template `react-ts`).
- **Sistema de design**: tokens CSS (`styles/theme.css`), Tailwind 3 estendido com paleta dark Palantir-like, IBM Plex Sans/Mono, densidade técnica (font-size base 12px).
- **Primitivos UI** escritos manualmente (Button, Input, Label, Badge, Dialog, Popover, Sheet, Select, Dropdown, Tooltip, Separator, ScrollArea) — controle total sobre densidade e tema.
- **AppShell** com grid 4×3 (TopTabBar / MenuBar / PrimaryRail / SecondarySidebar / Main / StatusBar).
- **Configuração declarativa de módulos** em `config/modules.ts` — fonte única para rail, sidebar e command palette nos 9 módulos (Visão, Orçamento, Planejamento, Acompanhamento, Medições, Suprimentos, Equipe, Documentos, Relatórios).
- **Roteamento** com TanStack Router (code-based), com layouts aninhados e placeholders para todas as rotas dos sub-itens.
- **DataTable genérico** com TanStack Table: busca global, ordenação, paginação, seleção, visibilidade de colunas, densidade, exportação.
- **Páginas implementadas**:
  - Visão geral — KPI cards, curva S, histograma de recursos, curva ABC
  - Orçamento — index com KPIs, Composições (DataTable), Detalhe de composição com cross-references, Insumos, Curva ABC
  - Planejamento — index, EAP hierárquica, Gantt funcional
  - Acompanhamento — index com KPIs e curva S, RDOs em cards
  - Medições — index com boletins de medição
  - Suprimentos — index com fornecedores
  - Equipe — index com colaboradores
  - Documentos — index com pastas
  - Relatórios — index com histórico
- **Modais e popups**:
  - Command Palette (cmdk) com 4 seções (Ir para, Ações, Abas, Composições)
  - Project Switcher
  - New Composition / New Insumo (react-hook-form + zod)
  - Confirm Delete (com aviso de itens vinculados)
  - Export Dialog (PDF/Excel/CSV com opções específicas)
  - Share Dialog (permissões + link público)
  - Settings (Sheet lateral com Aparência/Atalhos/Conta/Sobre)
  - Filter Sheet
  - Keyboard Shortcuts Overlay (`?`)
  - 5 form dialogs adicionais (New Task / RDO / BM / Order / Employee)
- **Charts** com Recharts já tematizados:
  - Curva S (Area com gradiente + linha do "hoje")
  - Curva ABC (ComposedChart com barras coloridas por classe + linha cumulativa)
  - Histograma de recursos (BarChart empilhado)
  - KPI cards (com sparkline e delta)
- **Gantt** com `frappe-gantt` (vanilla SVG, MIT) — wrapper React próprio com CSS dark overlay, popup customizado, view modes Day/Week/Month/Year, suporte a caminho crítico.
- **Sistema de abas** (Zustand `tabs-store`): abrir, fechar, reabrir última fechada, ciclar com Cmd+1..9.
- **Atalhos de teclado** (react-hotkeys-hook): Cmd+K, navegação por sequência G+letra (Vim-style), Cmd+B, Cmd+W, ?, Esc.
- **Camada de API mock-first** (`lib/api`): cliente axios + axios-mock-adapter, endpoints tipados, hooks de React Query por feature.
- **Mock data** rica: projeto "Duplicação GO-060 Lote 3", 50+ composições, 200+ insumos, 50+ tarefas Gantt hierárquicas com caminho crítico, 14 boletins de medição, 32 RDOs, 20 fornecedores, 84 colaboradores.
- **Electron main process** completo: persistência de geometria de janela (`electron-store`), multi-janela (IPC `window:open`), menu nativo em pt-BR, settings IPC.
- **Bridge IPC tipada** em `window.infrawork` (ver `src/preload/index.d.ts`).
- **README**, **CHANGELOG**, **docs/architecture.md**.

### Decisões técnicas notáveis

- **`frappe-gantt` em vez de `gantt-task-react`** — este último é incompatível com React 19; o frappe é SVG puro e infinitamente customizável via CSS.
- **CSS base do frappe-gantt copiada** para `components/gantt/frappe-base.css` porque o `exports` map do pacote não expõe `dist/frappe-gantt.css` como subpath padrão e isso quebrava o build de produção.
- **Primitivos shadcn escritos manualmente** — copy-paste do shadcn CLI deixaria os componentes "espaçosos" demais; a estética técnica densa exige altura de 24–28px em controles, o que é mais simples ajustar quando se escreve do zero.
- **TanStack Router code-based** em vez de file-based — funciona sem plugin Vite adicional e mantém todas as rotas explícitas em um único arquivo.
- **Zod 4 + react-hook-form** — `.transform()` em campos opcionais conflita com o resolver; o conversão `string → number` foi movida para o `onSubmit`.
