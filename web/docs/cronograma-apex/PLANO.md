# Cronograma e tempo-caminho do InfraWork Web a partir do ApeX

Pedido (2026-10-18): copiar do ApeX (`REA - Reverse Engenieer/projetos/2026-10-12_dynaroad`, reconstrução do
DynaRoad 5.5.2) o cronograma e o tempo-caminho, adaptando aos dados e ao visual do InfraWork. Entrega validada,
sem pressa.

## Princípio

O motor do ApeX entra **intacto** (pacotes `dr5`, `model`, `calendar`, `engine`, `obra` e o esquema do documento
`apex-obra/1`), com os testes dele rodando aqui. O InfraWork continua dono dos dados (tabelas do Supabase). A cada
cálculo:

1. carrega o modelo padrão do ApeX (`default.dr5`);
2. monta a obra pelo documento `apex-obra/1` gerado dos dados do plano (`buildObra`, base `empty`, modo Schedule);
3. completa o que o documento não leva (recursos identificados = equipes nomeadas; realizados no Control);
4. `applyAutoDependencies` + `Scheduler.calculate(true)` (nivelamento), folgas e violações;
5. lê as datas por trecho de tarefa (work place) e grava tudo numa única RPC transacional, com trava por plano.

As telas são reconstruídas em React no visual do InfraWork, reproduzindo o comportamento das visões do ApeX
(Gantt, tempo-local, recursos, controle, planilha de tarefas, diálogos).

## Correspondência ApeX → InfraWork

| ApeX | InfraWork |
|---|---|
| Projeto (início, prazo, calendário padrão, modo) | `planejamento` (início de referência, prazo novo, calendário padrão, modo programação/controle) |
| Eixo (road line) com estacas | `obra_trecho` (posições em metros internos ao eixo) |
| Área (local sem estacas) | local virtual "Sem local" para tarefas sem trecho |
| Tipo de tarefa (WorkType) + unidade | `servico` do catálogo (via `item_orcamentario.servico_id` do agrupador) |
| Dependência entre tipos (por estacas, atraso em dias) | `servico_dependencia` (nova) |
| Tarefa (OtherWorkSite) | `planejamento_tarefa` (tipo `tarefa`) |
| Trecho da tarefa (work place: local, estacas, quantidade) | `planejamento_tarefa_local` (nova; vários por tarefa, sem sobreposição) — origem manual ou do template do trecho; com template, um work place por segmento |
| Tarefa-resumo (EAP) | `planejamento_tarefa` tipo `grupo` |
| Equipe (WorkGroup: recursos + taxa por tipo) | **composição** (CPU vigente do serviço): recursos = itens EQ/MO; taxa/h = produção/dia ÷ jornada do calendário |
| N equipes na tarefa | equipe ApeX "composição × N" (recursos e taxa multiplicados) |
| Recurso identificado (limite 1) | equipe nomeada do InfraWork (`equipe`): a mesma equipe não trabalha em duas tarefas ao mesmo tempo |
| Recurso com limite simultâneo (global ou por tarefa-resumo) | `planejamento_recurso_limite` (nova) sobre `recurso` |
| Calendário (semana com início e horas; feriados, Páscoa, folgas, horários excepcionais) | `calendario` + `calendario_definicao` (novas; vários por obra); fator mensal do InfraWork vira horário excepcional |
| Marco (janela + inclusão por tarefa/tipo/recurso/estacas) | `planejamento_marco` (nova) |
| Prioridade, ASAP, início do dia, sentido, restrições, coeficiente, calendário próprio, derivar predecessoras | colunas novas em `planejamento_tarefa` |
| Dependência (FS/SS/FF/SF/por estacas; atraso mín./máx.; dias corridos/úteis; aparência) | `planejamento_dependencia` estendida |
| Datas dos work places | `planejamento_tarefa_local.inicio/fim` + resumo em `planejamento_tarefa` |
| Realizados (Control) e previsão | `acompanhamento_producao` (data, quantidade, estacas) → realizados por tarefa |
| Indiretos | fora do motor (como hoje), janela pelas diretas |

## Fases

| Fase | Conteúdo | Validação |
|---|---|---|
| F0 | Motor do ApeX copiado (`web/vendor/apex`), aliases `@apex/*`, `lp` sem solver, `pako`, suíte do ApeX rodando aqui, recálculo dos 27 `.dr5` do DynaRoad igual ao salvo | testes do ApeX + `compareTiming` nos 27 |
| F1 | Modelo de dados (migrações) e migração dos dados atuais | `db reset` + E2E |
| F2 | Adaptador InfraWork → obra → motor → resultados; RPC de gravação; perfil semanal/diário; premissas da LB; fluxo de recálculo | testes do adaptador + E2E |
| F3 | Gantt (grade, barras, dependências, marcos, violações, arraste com faixas, modo dependências, compactar), planilha de tarefas e diálogos | Playwright + capturas |
| F4 | Tempo-caminho (visão tempo-local) | idem |
| F5 | Visão de recursos, calendários, equipes/composições, limites | idem |
| F6 | Controle: realizados a partir dos lançamentos, previsão, visão de controle | idem |
| F7 | Integração final (LB/vigente, curva S, valor agregado, acompanhamento), remoção do motor antigo, documentação | E2E completo |

Decisões e desvios ficam registrados em `DECISOES.md` nesta pasta.
