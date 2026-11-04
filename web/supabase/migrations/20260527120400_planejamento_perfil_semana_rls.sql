-- InfraWork — Planejamento: RLS de planejamento_tarefa_perfil_semana
--
-- Espelha planejamento_tarefa_equipe (mesma chain via tarefa_obra(tarefa_id)).
-- Matriz:
--   God:        all
--   Adm:        all na empresa (via obra_empresa)
--   Engenheiro: all com has_obra_permissao
--   Apoio:      SELECT com has_obra_permissao(auth_engenheiro_id())
--
-- Apoio NUNCA escreve. service_role bypassa todas (edge functions controlam).

alter table public.planejamento_tarefa_perfil_semana enable row level security;

drop policy if exists ptps_god_all on public.planejamento_tarefa_perfil_semana;
create policy ptps_god_all on public.planejamento_tarefa_perfil_semana
  for all to authenticated
  using      (public.auth_role() = 'god')
  with check (public.auth_role() = 'god');

drop policy if exists ptps_adm_all on public.planejamento_tarefa_perfil_semana;
create policy ptps_adm_all on public.planejamento_tarefa_perfil_semana
  for all to authenticated
  using      (public.auth_role() = 'adm'
              and public.obra_empresa(public.tarefa_obra(tarefa_id)) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm'
              and public.obra_empresa(public.tarefa_obra(tarefa_id)) = public.auth_empresa_id());

drop policy if exists ptps_eng_all on public.planejamento_tarefa_perfil_semana;
create policy ptps_eng_all on public.planejamento_tarefa_perfil_semana
  for all to authenticated
  using      (public.auth_role() = 'engenheiro'
              and public.has_obra_permissao(public.tarefa_obra(tarefa_id), auth.uid()))
  with check (public.auth_role() = 'engenheiro'
              and public.has_obra_permissao(public.tarefa_obra(tarefa_id), auth.uid()));

drop policy if exists ptps_apoio_select on public.planejamento_tarefa_perfil_semana;
create policy ptps_apoio_select on public.planejamento_tarefa_perfil_semana
  for select to authenticated
  using (public.auth_role() = 'apoio'
         and public.has_obra_permissao(public.tarefa_obra(tarefa_id), public.auth_engenheiro_id()));
