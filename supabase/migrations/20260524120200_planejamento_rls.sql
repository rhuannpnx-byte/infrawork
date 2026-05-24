-- InfraWork — Planejamento (Fase P1.A): RLS policies
--
-- Matriz acordada (igual ao orçamento):
--   God:        todos (qualquer obra)
--   Adm:        todos na empresa (obra_empresa(obra_id) = auth_empresa_id())
--   Engenheiro: todos com has_obra_permissao(obra_id, auth.uid())
--   Apoio:      SELECT com has_obra_permissao(obra_id, auth_engenheiro_id())
--
-- planejamento_baseline_snapshot: SELECT espelha; INSERT/UPDATE/DELETE
-- bloqueados para `authenticated` — apenas service_role da Edge Function.

alter table public.obra_calendario              enable row level security;
alter table public.obra_calendario_excecao      enable row level security;
alter table public.obra_produtividade_mes       enable row level security;
alter table public.equipe                       enable row level security;
alter table public.planejamento                 enable row level security;
alter table public.planejamento_tarefa          enable row level security;
alter table public.planejamento_tarefa_equipe   enable row level security;
alter table public.planejamento_dependencia     enable row level security;
alter table public.planejamento_baseline_snapshot enable row level security;

-- =========================================================================
-- obra_calendario (1:1 com obra)
-- =========================================================================
drop policy if exists obra_cal_god_all on public.obra_calendario;
create policy obra_cal_god_all on public.obra_calendario
  for all to authenticated
  using      (public.auth_role() = 'god')
  with check (public.auth_role() = 'god');

drop policy if exists obra_cal_adm_all on public.obra_calendario;
create policy obra_cal_adm_all on public.obra_calendario
  for all to authenticated
  using      (public.auth_role() = 'adm' and public.obra_empresa(obra_id) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm' and public.obra_empresa(obra_id) = public.auth_empresa_id());

drop policy if exists obra_cal_eng_all on public.obra_calendario;
create policy obra_cal_eng_all on public.obra_calendario
  for all to authenticated
  using      (public.auth_role() = 'engenheiro' and public.has_obra_permissao(obra_id, auth.uid()))
  with check (public.auth_role() = 'engenheiro' and public.has_obra_permissao(obra_id, auth.uid()));

drop policy if exists obra_cal_apoio_select on public.obra_calendario;
create policy obra_cal_apoio_select on public.obra_calendario
  for select to authenticated
  using (public.auth_role() = 'apoio' and public.has_obra_permissao(obra_id, public.auth_engenheiro_id()));

-- =========================================================================
-- obra_calendario_excecao
-- =========================================================================
drop policy if exists obra_exc_god_all on public.obra_calendario_excecao;
create policy obra_exc_god_all on public.obra_calendario_excecao
  for all to authenticated
  using (public.auth_role() = 'god') with check (public.auth_role() = 'god');

drop policy if exists obra_exc_adm_all on public.obra_calendario_excecao;
create policy obra_exc_adm_all on public.obra_calendario_excecao
  for all to authenticated
  using      (public.auth_role() = 'adm' and public.obra_empresa(obra_id) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm' and public.obra_empresa(obra_id) = public.auth_empresa_id());

drop policy if exists obra_exc_eng_all on public.obra_calendario_excecao;
create policy obra_exc_eng_all on public.obra_calendario_excecao
  for all to authenticated
  using      (public.auth_role() = 'engenheiro' and public.has_obra_permissao(obra_id, auth.uid()))
  with check (public.auth_role() = 'engenheiro' and public.has_obra_permissao(obra_id, auth.uid()));

drop policy if exists obra_exc_apoio_select on public.obra_calendario_excecao;
create policy obra_exc_apoio_select on public.obra_calendario_excecao
  for select to authenticated
  using (public.auth_role() = 'apoio' and public.has_obra_permissao(obra_id, public.auth_engenheiro_id()));

-- =========================================================================
-- obra_produtividade_mes
-- =========================================================================
drop policy if exists obra_prod_god_all on public.obra_produtividade_mes;
create policy obra_prod_god_all on public.obra_produtividade_mes
  for all to authenticated
  using (public.auth_role() = 'god') with check (public.auth_role() = 'god');

drop policy if exists obra_prod_adm_all on public.obra_produtividade_mes;
create policy obra_prod_adm_all on public.obra_produtividade_mes
  for all to authenticated
  using      (public.auth_role() = 'adm' and public.obra_empresa(obra_id) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm' and public.obra_empresa(obra_id) = public.auth_empresa_id());

drop policy if exists obra_prod_eng_all on public.obra_produtividade_mes;
create policy obra_prod_eng_all on public.obra_produtividade_mes
  for all to authenticated
  using      (public.auth_role() = 'engenheiro' and public.has_obra_permissao(obra_id, auth.uid()))
  with check (public.auth_role() = 'engenheiro' and public.has_obra_permissao(obra_id, auth.uid()));

drop policy if exists obra_prod_apoio_select on public.obra_produtividade_mes;
create policy obra_prod_apoio_select on public.obra_produtividade_mes
  for select to authenticated
  using (public.auth_role() = 'apoio' and public.has_obra_permissao(obra_id, public.auth_engenheiro_id()));

-- =========================================================================
-- equipe
-- =========================================================================
drop policy if exists equipe_god_all on public.equipe;
create policy equipe_god_all on public.equipe
  for all to authenticated
  using (public.auth_role() = 'god') with check (public.auth_role() = 'god');

drop policy if exists equipe_adm_all on public.equipe;
create policy equipe_adm_all on public.equipe
  for all to authenticated
  using      (public.auth_role() = 'adm' and public.obra_empresa(obra_id) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm' and public.obra_empresa(obra_id) = public.auth_empresa_id());

drop policy if exists equipe_eng_all on public.equipe;
create policy equipe_eng_all on public.equipe
  for all to authenticated
  using      (public.auth_role() = 'engenheiro' and public.has_obra_permissao(obra_id, auth.uid()))
  with check (public.auth_role() = 'engenheiro' and public.has_obra_permissao(obra_id, auth.uid()));

drop policy if exists equipe_apoio_select on public.equipe;
create policy equipe_apoio_select on public.equipe
  for select to authenticated
  using (public.auth_role() = 'apoio' and public.has_obra_permissao(obra_id, public.auth_engenheiro_id()));

-- =========================================================================
-- planejamento
-- =========================================================================
drop policy if exists planejamento_god_all on public.planejamento;
create policy planejamento_god_all on public.planejamento
  for all to authenticated
  using (public.auth_role() = 'god') with check (public.auth_role() = 'god');

drop policy if exists planejamento_adm_all on public.planejamento;
create policy planejamento_adm_all on public.planejamento
  for all to authenticated
  using      (public.auth_role() = 'adm' and public.obra_empresa(obra_id) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm' and public.obra_empresa(obra_id) = public.auth_empresa_id());

drop policy if exists planejamento_eng_all on public.planejamento;
create policy planejamento_eng_all on public.planejamento
  for all to authenticated
  using      (public.auth_role() = 'engenheiro' and public.has_obra_permissao(obra_id, auth.uid()))
  with check (public.auth_role() = 'engenheiro' and public.has_obra_permissao(obra_id, auth.uid()));

drop policy if exists planejamento_apoio_select on public.planejamento;
create policy planejamento_apoio_select on public.planejamento
  for select to authenticated
  using (public.auth_role() = 'apoio' and public.has_obra_permissao(obra_id, public.auth_engenheiro_id()));

-- =========================================================================
-- planejamento_tarefa (via tarefa_obra)
-- =========================================================================
drop policy if exists plan_tarefa_god_all on public.planejamento_tarefa;
create policy plan_tarefa_god_all on public.planejamento_tarefa
  for all to authenticated
  using (public.auth_role() = 'god') with check (public.auth_role() = 'god');

drop policy if exists plan_tarefa_adm_all on public.planejamento_tarefa;
create policy plan_tarefa_adm_all on public.planejamento_tarefa
  for all to authenticated
  using      (public.auth_role() = 'adm'
              and public.obra_empresa(public.planejamento_obra(planejamento_id)) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm'
              and public.obra_empresa(public.planejamento_obra(planejamento_id)) = public.auth_empresa_id());

drop policy if exists plan_tarefa_eng_all on public.planejamento_tarefa;
create policy plan_tarefa_eng_all on public.planejamento_tarefa
  for all to authenticated
  using      (public.auth_role() = 'engenheiro'
              and public.has_obra_permissao(public.planejamento_obra(planejamento_id), auth.uid()))
  with check (public.auth_role() = 'engenheiro'
              and public.has_obra_permissao(public.planejamento_obra(planejamento_id), auth.uid()));

drop policy if exists plan_tarefa_apoio_select on public.planejamento_tarefa;
create policy plan_tarefa_apoio_select on public.planejamento_tarefa
  for select to authenticated
  using (public.auth_role() = 'apoio'
         and public.has_obra_permissao(public.planejamento_obra(planejamento_id), public.auth_engenheiro_id()));

-- =========================================================================
-- planejamento_tarefa_equipe (via tarefa_obra)
-- =========================================================================
drop policy if exists plan_tar_eq_god_all on public.planejamento_tarefa_equipe;
create policy plan_tar_eq_god_all on public.planejamento_tarefa_equipe
  for all to authenticated
  using (public.auth_role() = 'god') with check (public.auth_role() = 'god');

drop policy if exists plan_tar_eq_adm_all on public.planejamento_tarefa_equipe;
create policy plan_tar_eq_adm_all on public.planejamento_tarefa_equipe
  for all to authenticated
  using      (public.auth_role() = 'adm'
              and public.obra_empresa(public.tarefa_obra(tarefa_id)) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm'
              and public.obra_empresa(public.tarefa_obra(tarefa_id)) = public.auth_empresa_id());

drop policy if exists plan_tar_eq_eng_all on public.planejamento_tarefa_equipe;
create policy plan_tar_eq_eng_all on public.planejamento_tarefa_equipe
  for all to authenticated
  using      (public.auth_role() = 'engenheiro'
              and public.has_obra_permissao(public.tarefa_obra(tarefa_id), auth.uid()))
  with check (public.auth_role() = 'engenheiro'
              and public.has_obra_permissao(public.tarefa_obra(tarefa_id), auth.uid()));

drop policy if exists plan_tar_eq_apoio_select on public.planejamento_tarefa_equipe;
create policy plan_tar_eq_apoio_select on public.planejamento_tarefa_equipe
  for select to authenticated
  using (public.auth_role() = 'apoio'
         and public.has_obra_permissao(public.tarefa_obra(tarefa_id), public.auth_engenheiro_id()));

-- =========================================================================
-- planejamento_dependencia (via planejamento_obra)
-- =========================================================================
drop policy if exists plan_dep_god_all on public.planejamento_dependencia;
create policy plan_dep_god_all on public.planejamento_dependencia
  for all to authenticated
  using (public.auth_role() = 'god') with check (public.auth_role() = 'god');

drop policy if exists plan_dep_adm_all on public.planejamento_dependencia;
create policy plan_dep_adm_all on public.planejamento_dependencia
  for all to authenticated
  using      (public.auth_role() = 'adm'
              and public.obra_empresa(public.planejamento_obra(planejamento_id)) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm'
              and public.obra_empresa(public.planejamento_obra(planejamento_id)) = public.auth_empresa_id());

drop policy if exists plan_dep_eng_all on public.planejamento_dependencia;
create policy plan_dep_eng_all on public.planejamento_dependencia
  for all to authenticated
  using      (public.auth_role() = 'engenheiro'
              and public.has_obra_permissao(public.planejamento_obra(planejamento_id), auth.uid()))
  with check (public.auth_role() = 'engenheiro'
              and public.has_obra_permissao(public.planejamento_obra(planejamento_id), auth.uid()));

drop policy if exists plan_dep_apoio_select on public.planejamento_dependencia;
create policy plan_dep_apoio_select on public.planejamento_dependencia
  for select to authenticated
  using (public.auth_role() = 'apoio'
         and public.has_obra_permissao(public.planejamento_obra(planejamento_id), public.auth_engenheiro_id()));

-- =========================================================================
-- planejamento_baseline_snapshot (SELECT espelha; escrita só service_role)
-- =========================================================================
drop policy if exists plan_baseline_god_select on public.planejamento_baseline_snapshot;
create policy plan_baseline_god_select on public.planejamento_baseline_snapshot
  for select to authenticated
  using (public.auth_role() = 'god');

drop policy if exists plan_baseline_adm_select on public.planejamento_baseline_snapshot;
create policy plan_baseline_adm_select on public.planejamento_baseline_snapshot
  for select to authenticated
  using (public.auth_role() = 'adm' and public.obra_empresa(obra_id) = public.auth_empresa_id());

drop policy if exists plan_baseline_eng_select on public.planejamento_baseline_snapshot;
create policy plan_baseline_eng_select on public.planejamento_baseline_snapshot
  for select to authenticated
  using (public.auth_role() = 'engenheiro' and public.has_obra_permissao(obra_id, auth.uid()));

drop policy if exists plan_baseline_apoio_select on public.planejamento_baseline_snapshot;
create policy plan_baseline_apoio_select on public.planejamento_baseline_snapshot
  for select to authenticated
  using (public.auth_role() = 'apoio' and public.has_obra_permissao(obra_id, public.auth_engenheiro_id()));

-- Sem policy de INSERT/UPDATE/DELETE → bloqueado para authenticated.
-- service_role bypassa RLS.
