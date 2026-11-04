-- InfraWork — Orçamento (Fase 2.C): RLS para item_orcamentario, cpu_snapshot, indireto_item
--
-- Matriz acordada (igual para item_orcamentario e indireto_item):
--   - God:        todos (qualquer obra)
--   - Adm:        todos na empresa (obra_empresa(obra_id) = auth_empresa_id())
--   - Engenheiro: todos com has_obra_permissao(obra_id, auth.uid())
--   - Apoio:      SELECT com has_obra_permissao(obra_id, auth_engenheiro_id())
--
-- cpu_snapshot: SELECT espelha (via cpu_snap_obra); INSERT/UPDATE/DELETE
-- bloqueados para `authenticated` — apenas service_role da Edge Function pode.

alter table public.item_orcamentario enable row level security;
alter table public.cpu_snapshot      enable row level security;
alter table public.indireto_item     enable row level security;

-- =========================================================================
-- item_orcamentario
-- =========================================================================
drop policy if exists item_orc_god_all on public.item_orcamentario;
create policy item_orc_god_all on public.item_orcamentario
  for all
  to authenticated
  using      (public.auth_role() = 'god')
  with check (public.auth_role() = 'god');

drop policy if exists item_orc_adm_all on public.item_orcamentario;
create policy item_orc_adm_all on public.item_orcamentario
  for all
  to authenticated
  using      (public.auth_role() = 'adm'
              and public.obra_empresa(obra_id) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm'
              and public.obra_empresa(obra_id) = public.auth_empresa_id());

drop policy if exists item_orc_eng_all on public.item_orcamentario;
create policy item_orc_eng_all on public.item_orcamentario
  for all
  to authenticated
  using      (public.auth_role() = 'engenheiro'
              and public.has_obra_permissao(obra_id, auth.uid()))
  with check (public.auth_role() = 'engenheiro'
              and public.has_obra_permissao(obra_id, auth.uid()));

drop policy if exists item_orc_apoio_select on public.item_orcamentario;
create policy item_orc_apoio_select on public.item_orcamentario
  for select
  to authenticated
  using (public.auth_role() = 'apoio'
         and public.has_obra_permissao(obra_id, public.auth_engenheiro_id()));

-- =========================================================================
-- cpu_snapshot
-- SELECT: 4 personas (idêntico aos itens).
-- INSERT/UPDATE/DELETE: apenas service_role (Edge Function).
-- =========================================================================
drop policy if exists cpu_snap_god_select on public.cpu_snapshot;
create policy cpu_snap_god_select on public.cpu_snapshot
  for select
  to authenticated
  using (public.auth_role() = 'god');

drop policy if exists cpu_snap_adm_select on public.cpu_snapshot;
create policy cpu_snap_adm_select on public.cpu_snapshot
  for select
  to authenticated
  using (public.auth_role() = 'adm'
         and empresa_id = public.auth_empresa_id());

drop policy if exists cpu_snap_eng_select on public.cpu_snapshot;
create policy cpu_snap_eng_select on public.cpu_snapshot
  for select
  to authenticated
  using (public.auth_role() = 'engenheiro'
         and public.has_obra_permissao(obra_id, auth.uid()));

drop policy if exists cpu_snap_apoio_select on public.cpu_snapshot;
create policy cpu_snap_apoio_select on public.cpu_snapshot
  for select
  to authenticated
  using (public.auth_role() = 'apoio'
         and public.has_obra_permissao(obra_id, public.auth_engenheiro_id()));

-- Sem policy de INSERT/UPDATE/DELETE para `authenticated` → RLS bloqueia.
-- service_role bypassa RLS automaticamente.

-- =========================================================================
-- indireto_item
-- =========================================================================
drop policy if exists indireto_god_all on public.indireto_item;
create policy indireto_god_all on public.indireto_item
  for all
  to authenticated
  using      (public.auth_role() = 'god')
  with check (public.auth_role() = 'god');

drop policy if exists indireto_adm_all on public.indireto_item;
create policy indireto_adm_all on public.indireto_item
  for all
  to authenticated
  using      (public.auth_role() = 'adm'
              and public.obra_empresa(obra_id) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm'
              and public.obra_empresa(obra_id) = public.auth_empresa_id());

drop policy if exists indireto_eng_all on public.indireto_item;
create policy indireto_eng_all on public.indireto_item
  for all
  to authenticated
  using      (public.auth_role() = 'engenheiro'
              and public.has_obra_permissao(obra_id, auth.uid()))
  with check (public.auth_role() = 'engenheiro'
              and public.has_obra_permissao(obra_id, auth.uid()));

drop policy if exists indireto_apoio_select on public.indireto_item;
create policy indireto_apoio_select on public.indireto_item
  for select
  to authenticated
  using (public.auth_role() = 'apoio'
         and public.has_obra_permissao(obra_id, public.auth_engenheiro_id()));
