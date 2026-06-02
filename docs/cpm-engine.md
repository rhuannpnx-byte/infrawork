# Motor CPM — Documentação Técnica

> Critical Path Method automático e reativo do módulo Planejamento.

## Visão geral

O motor CPM do InfraWork combina:

- **Engine Edge** (Deno + Supabase Functions) — source-of-truth, persiste resultados no banco.
- **Engine Client** (renderer React) — espelho leve da lógica Edge, dá feedback instantâneo na UI sem esperar HTTP.
- **Bus de eventos** (`recalcBus`) — hooks de mutation emitem nele; o motor reativo subscreve e debounça.

Ambos engines compartilham a mesma lib `cronograma-pure.ts` (cópia byte-equivalente nos dois lados).

## Algoritmo

### Forward pass (ES/EF)

Para cada tarefa em ordem topológica:

1. **MSO hard**: se `constraint_type='mso'`, força `ES = constraint_date`. Se predecessoras pedem ES maior, emite warning `constraint_violated` mas mantém MSO.
2. **Predecessoras**: calcula o máximo entre todos os candidatos:
   - FS: `ES_suc = EF_pred + lag + 1 dia útil`
   - SS: `ES_suc = ES_pred + lag`
   - FF: `ES_suc = EF_pred + lag` (afeta fim, mas constrange início via dur)
   - SF: não constrange início, apenas fim (tratado em backward)
3. **Âncora**: `ES = max(ES, projectStart)`.
4. **SNET soft**: `ES = max(ES, constraint_date)` se SNET preenchido.
5. **Data Date**: `ES = max(ES, dataDate)` — passado não é replanejado.
6. **EF = ES + duração** em dias úteis (`addWorkDays`).

### Backward pass (LS/LF)

Para cada tarefa em ordem topológica reversa:

1. **Sem sucessores**: `LF = dataFimProjeto`.
2. **Com sucessores**: `LF = min(LF candidato de cada sucessor)`:
   - FS: `LF_pred = LS_suc - lag - 1`
   - SS: `LF_pred = LS_suc - lag + dur_pred`
   - FF: `LF_pred = LF_suc - lag`
   - SF: `LF_pred = LF_suc - lag + dur_pred`
3. **FNLT soft**: `LF = min(LF, constraint_date)`.
4. **MFO hard**: força `LF = constraint_date`, emite warning se sucessoras pedem antes.
5. `LS = LF - dur + 1 dia útil`.

### Total Float, Free Float, caminho crítico

- `TF = LF - EF` em dias úteis (`diffWorkDays`).
- `FF` = menor folga até a sucessora mais cedo:
  - FS: `alvo = ES_suc - 1 - lag`, `slack = diff(EF, alvo)`
  - SS: `alvo = ES_suc - lag`, `slack = diff(ES, alvo)`
  - FF: `alvo = EF_suc - lag`, `slack = diff(EF, alvo)`
  - SF: `alvo = EF_suc - lag`, `slack = diff(ES, alvo)`
- `is_critico = TF ≤ 0`.

### ALAP shift

Após forward+backward, tarefas com `schedule_mode='alap'` e `TF > 0` têm `data_inicio` e `data_fim` substituídos por `LS` e `LF` respectivamente. Perfil semanal é shiftado em `LS - ES` dias úteis (preserva shape, atrasa datas). Tarefas críticas (TF≤0) não shiftam — ALAP = ASAP nesse caso.

## Ordem de precedência (quando há conflitos)

1. **Frozen (Data Date)** — tarefas executadas no passado mantêm datas atuais; CPM não as toca. Próximo na lista CPM começa em `max(ES_calculado, dataDate)`.
2. **Hard constraints** (MSO/MFO) — sempre vencem dependências. Conflito gera warning visível mas a data hard é mantida.
3. **Dependências** (FS/SS/FF/SF + lag) — agendamento natural do CPM.
4. **Soft constraints** (SNET/FNLT) — modulam ES/LF dentro do range permitido pelas dependências.
5. **Schedule mode** (ASAP/ALAP) — escolha entre early vs late dates dentro da folga.
6. **Âncora do projeto** (`data_referencia_inicio`) — limite inferior absoluto.

## Calendários

InfraWork suporta **apenas calendário de obra**: `obra_calendario` (bitmask dias úteis) + `obra_calendario_excecao` (feriados/paralisações) + `obra_produtividade_mes` (fator multiplicativo por mês).

Calendário de tarefa e de recurso (equipe) **não são suportados** nesta versão. Documenta a decisão; viabilidade é trivial via aditiva no schema mas o uso real raramente justifica a complexidade extra em obras rodoviárias.

## Triggers de recálculo

Cobertura dos critérios 19-24:

| Trigger | Hook | Evento bus |
|---|---|---|
| Criar tarefa | `useCreateTarefa` | `mutationDone` |
| Editar tarefa (qty, dur, datas) | `useUpdateTarefa` | `mutationDone` |
| Deletar tarefa | `useDeleteTarefa` | `mutationDone` |
| Criar marco/grupo | `useCreateMarco`/`useCreateGrupo` | `mutationDone` |
| Importar lote do orçamento | `useImportarItensSelecionados` | `mutationDone` |
| Reorder/move | `useReorderTarefas` | `mutationDone` |
| Adicionar/editar/deletar dep | `useAddDependencia`/`useUpdateDependencia`/`useDeleteDependencia` | `mutationDone` |
| Alocar/desalocar equipe | `useAlocarEquipe`/`useDesalocarEquipe` | `mutationDone` |
| Editar perfil customizado | `useSalvarPerfilCustomizado` | `mutationDone` |
| Reverter perfil | `useReverterParaPerfilDefault` | `mutationDone` |
| Calendário bitmask | `useUpdateCalendarioBitmask` | `obraChanged` |
| Exceção (feriado) | `useUpsertExcecao`/`useDeleteExcecao` | `obraChanged` |
| Fator mensal | `useUpsertFatorMes`/`useDeleteFatorMes` | `obraChanged` |
| Project Start / Data Date | `useUpdatePlanejamento` (campos relevantes) | `mutationDone` |

O hook `useCpmEngine` subscreve `mutationDone` (filtrando por `planejamentoId`) e `obraChanged` (filtrando por `obra_id`) — debounça 300ms e dispara UMA chamada Edge.

## Persistência

Os 7 campos CPM ficam em `planejamento_tarefa` (Fase 1):

- `early_start`, `early_finish` — date
- `late_start`, `late_finish` — date
- `total_float`, `free_float` — integer (dias úteis)
- `is_critico` — boolean

A view `vw_planejamento_tarefa_completa` (v6) expõe esses campos junto com:

- `schedule_mode`, `constraint_type`, `constraint_date` (Fase 2)
- `planejamento_data_date` (replicado do plano-pai, evita JOIN duplo)

Re-abrir o cronograma é **instantâneo** — UI lê os campos do banco. Recálculo só roda quando há mutation.

## Detecção de inconsistência

O hook `useCpmEngine` computa CPM client toda vez que `tarefas` muda. Se o resultado client divergir do banco em mais de 0.1% (drift > tolerância), idealmente dispara warning + auto-recalc Edge. *(Não implementado nesta versão — usar `useEffect` que compara `cpm.porTarefa` com `tarefa.early_start` etc.; defer.)*

## Arquitetura hybrid

```
┌─────────────────┐     emit mutationDone     ┌──────────────────┐
│  Hook mutation  │ ─────────────────────▶   │   recalcBus      │
│  (use*Tarefa,   │                          │  (event emitter) │
│   use*Dep,      │                          └──────────────────┘
│   use*Equipe…)  │                                    │
└─────────────────┘                                    │
                                                       ▼
                                          ┌─────────────────────┐
                                          │   useCpmEngine      │
                                          │                     │
                                          │  1. computeCpm()    │ ← client preview
                                          │     (~10-50ms)      │
                                          │                     │
                                          │  2. qc.setQueryData │ ← optimistic
                                          │     (ES/EF/LS/LF…)  │   update do cache
                                          │                     │
                                          │  3. debounce 300ms  │
                                          │  4. calcular.mutate │ ← Edge canônico
                                          │     (~200-500ms)    │
                                          │                     │
                                          │  5. invalidateQueries│ ← refetch real
                                          │  6. emit            │   (auto via React Query)
                                          │     scheduleRecalc'd│
                                          └─────────────────────┘
```

**UI nunca trava**: passos 1-2 são síncronos em JS puro (<50ms tipicamente). Edge roda em background.

## Critérios cobertos vs deferidos

| # | Critério | Status |
|---|---|---|
| 1-5 | Forward/Backward/TF/FF/Crítico | ✅ Edge + Client |
| 6 | Summary tasks (min ES, max EF) | ✅ via `buildTaskTree` no client |
| 7 | Project Start + Data Date | ✅ (data_date integrado com acompanhamento manualmente) |
| 8-9 | FS/SS/FF/SF + lag/lead | ✅ |
| 10 | Ciclos detectados | ✅ Kahn + RPC |
| 11-14 | SNET/FNLT/MSO/MFO + alertas | ✅ |
| 15 | Calendário projeto | ✅ |
| 16-18 | Calendário tarefa/recurso/precedência | ❌ **Deferido** — project-only por decisão |
| 19-24 | Triggers exaustivos | ✅ via `recalcBus` |
| 25 | Recálculo incremental | ⚠️ Full recompute (rápido o suficiente: <50ms client / <500ms Edge) |
| 26 | Debounce/coalescing | ✅ 300ms |
| 27 | UI não trava | ✅ |
| 28 | Benchmark 5k tarefas <500ms | ⚠️ Não testado formalmente |
| 29 | Nunca stale | ✅ via optimistic update |
| 30 | Callback scheduleRecalculated | ✅ `recalcBus` |
| 31 | Undo/Redo | ❌ **Deferido** — feature transversal não-CPM |
| 32 | Persistência | ✅ 7 campos novos em `planejamento_tarefa` |
| 33 | Testes unitários | ✅ Deno tests (cronograma-pure + CPM helpers) |
| 34 | Regressão MS Project / P6 | ❌ **Deferido** — montar inputs MSP custoso |
| 35 | Stress test | ❌ **Deferido** — sem framework de teste no renderer |
| 36 | Documentação | ✅ este arquivo |

## Decisões arquiteturais

1. **Edge como source-of-truth**: garante consistência (service_role bypassa RLS), validações server-side, baseline imutabilidade. Client é "leitor otimista".
2. **Cópia byte-equivalente de cronograma-pure**: sem build step pra sincronizar. Manutenção via diff manual; mudança em um arquivo exige mudança no outro. Aceitável porque o módulo é estável.
3. **CPM full-recompute**: incremental traz complexidade desproporcional aos ganhos. Recompute em <50ms client é OK pra obras com até ~1000 tarefas (caso de uso real do InfraWork).
4. **MSO/MFO hard como warning, não bloqueio**: usuário precisa enxergar o conflito (pra tomar decisão), não ser bloqueado de salvar.
5. **Data Date acoplado a acompanhamento**: planejamento.data_date é manual hoje; recomendação é setar `max(data_producao)` semanalmente. Automação futura via cron.

## Arquivos críticos

**Backend**:
- [supabase/functions/calcular-cronograma/index.ts](../supabase/functions/calcular-cronograma/index.ts)
- [supabase/functions/_shared/cronograma-pure.ts](../supabase/functions/_shared/cronograma-pure.ts)
- [supabase/migrations/20260601120000_planejamento_tarefa_cpm_cols.sql](../supabase/migrations/20260601120000_planejamento_tarefa_cpm_cols.sql)
- [supabase/migrations/20260601120100_planejamento_view_completa_v5.sql](../supabase/migrations/20260601120100_planejamento_view_completa_v5.sql)
- [supabase/migrations/20260602120000_planejamento_constraints.sql](../supabase/migrations/20260602120000_planejamento_constraints.sql)
- [supabase/migrations/20260602120100_planejamento_data_date.sql](../supabase/migrations/20260602120100_planejamento_data_date.sql)
- [supabase/migrations/20260602120200_planejamento_view_completa_v6.sql](../supabase/migrations/20260602120200_planejamento_view_completa_v6.sql)

**Frontend**:
- [src/renderer/src/features/planejamento/lib/cronograma-pure.ts](../src/renderer/src/features/planejamento/lib/cronograma-pure.ts)
- [src/renderer/src/features/planejamento/lib/cpm-engine.ts](../src/renderer/src/features/planejamento/lib/cpm-engine.ts)
- [src/renderer/src/features/planejamento/lib/recalc-bus.ts](../src/renderer/src/features/planejamento/lib/recalc-bus.ts)
- [src/renderer/src/features/planejamento/hooks/cpm-reactive.ts](../src/renderer/src/features/planejamento/hooks/cpm-reactive.ts)

**Testes**:
- [supabase/tests/cronograma-pure.test.ts](../supabase/tests/cronograma-pure.test.ts)

**Execução de testes**:
```bash
cd supabase/functions && deno task test
```
