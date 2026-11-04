-- InfraWork — Fix histórico: cpu_snapshot ficou sem policies de SELECT após
-- a migration 20260524100000_orcamento_vedacao_por_obra.sql ter dropado as
-- policies originais e a 20260524100100_orcamento_vedacao_rls.sql não as
-- ter recriado.
--
-- Sintoma: vw_planejamento_tarefa_completa (security_invoker=true) faz LEFT
-- JOIN com cpu_snapshot, mas o caller não tinha permissão SELECT no
-- cpu_snapshot, então os campos snap.* vinham NULL. Painel mostrava custo
-- R$ 0,00 e produção diária "—" mesmo com snapshot existindo.

drop policy if exists cpu_snap_god_select on public.cpu_snapshot;
create policy cpu_snap_god_select on public.cpu_snapshot
  for select to authenticated
  using (public.auth_role() = 'god');

drop policy if exists cpu_snap_adm_select on public.cpu_snapshot;
create policy cpu_snap_adm_select on public.cpu_snapshot
  for select to authenticated
  using (public.auth_role() = 'adm'
         and public.obra_empresa(obra_id) = public.auth_empresa_id());

drop policy if exists cpu_snap_eng_select on public.cpu_snapshot;
create policy cpu_snap_eng_select on public.cpu_snapshot
  for select to authenticated
  using (public.auth_role() = 'engenheiro'
         and public.has_obra_permissao(obra_id, auth.uid()));

drop policy if exists cpu_snap_apoio_select on public.cpu_snapshot;
create policy cpu_snap_apoio_select on public.cpu_snapshot
  for select to authenticated
  using (public.auth_role() = 'apoio'
         and public.has_obra_permissao(obra_id, public.auth_engenheiro_id()));

-- Sem policy de INSERT/UPDATE/DELETE → bloqueia escrita por authenticated.
-- service_role bypassa RLS automaticamente (Edge Functions).
