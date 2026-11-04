-- InfraWork — Orçamento (Fase 4.B): RLS para Importação
--
-- Padrão:
--   template_importacao:
--     SELECT: god / adm-empresa / engenheiro-empresa / apoio-via-eng
--     INSERT/UPDATE/DELETE: god / adm-empresa / engenheiro-empresa
--
--   import_job:
--     SELECT: god / adm-empresa / engenheiro-com-perm / apoio-via-eng
--     INSERT/UPDATE/DELETE: god / adm-empresa / engenheiro-com-perm
--     (criado_por é gravado pelo client; sem service_role obrigatório)
--
--   import_match_fraco:
--     SELECT/UPDATE: god / adm / eng-com-perm-na-obra-do-job
--     INSERT/DELETE: bloqueado pra authenticated (popular vem da Edge Function)

alter table public.template_importacao   enable row level security;
alter table public.import_job            enable row level security;
alter table public.import_match_fraco    enable row level security;

-- =========================================================================
-- template_importacao
-- =========================================================================
drop policy if exists template_god_all on public.template_importacao;
create policy template_god_all on public.template_importacao
  for all
  to authenticated
  using      (public.auth_role() = 'god')
  with check (public.auth_role() = 'god');

drop policy if exists template_adm_eng_all on public.template_importacao;
create policy template_adm_eng_all on public.template_importacao
  for all
  to authenticated
  using      (public.auth_role() in ('adm','engenheiro')
              and empresa_id = public.auth_empresa_id())
  with check (public.auth_role() in ('adm','engenheiro')
              and empresa_id = public.auth_empresa_id());

drop policy if exists template_apoio_select on public.template_importacao;
create policy template_apoio_select on public.template_importacao
  for select
  to authenticated
  using (public.auth_role() = 'apoio'
         and empresa_id = public.auth_empresa_id());

-- =========================================================================
-- import_job
-- =========================================================================
drop policy if exists job_god_all on public.import_job;
create policy job_god_all on public.import_job
  for all
  to authenticated
  using      (public.auth_role() = 'god')
  with check (public.auth_role() = 'god');

drop policy if exists job_adm_all on public.import_job;
create policy job_adm_all on public.import_job
  for all
  to authenticated
  using      (public.auth_role() = 'adm'
              and public.obra_empresa(obra_id) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm'
              and public.obra_empresa(obra_id) = public.auth_empresa_id());

drop policy if exists job_eng_all on public.import_job;
create policy job_eng_all on public.import_job
  for all
  to authenticated
  using      (public.auth_role() = 'engenheiro'
              and public.has_obra_permissao(obra_id, auth.uid()))
  with check (public.auth_role() = 'engenheiro'
              and public.has_obra_permissao(obra_id, auth.uid()));

drop policy if exists job_apoio_select on public.import_job;
create policy job_apoio_select on public.import_job
  for select
  to authenticated
  using (public.auth_role() = 'apoio'
         and public.has_obra_permissao(obra_id, public.auth_engenheiro_id()));

-- =========================================================================
-- import_match_fraco
-- =========================================================================
drop policy if exists match_god_all on public.import_match_fraco;
create policy match_god_all on public.import_match_fraco
  for all
  to authenticated
  using      (public.auth_role() = 'god')
  with check (public.auth_role() = 'god');

drop policy if exists match_adm_select on public.import_match_fraco;
create policy match_adm_select on public.import_match_fraco
  for select
  to authenticated
  using (public.auth_role() = 'adm'
         and public.match_fraco_obra(id) is not null
         and public.obra_empresa(public.match_fraco_obra(id)) = public.auth_empresa_id());

drop policy if exists match_adm_update on public.import_match_fraco;
create policy match_adm_update on public.import_match_fraco
  for update
  to authenticated
  using      (public.auth_role() = 'adm'
              and public.match_fraco_obra(id) is not null
              and public.obra_empresa(public.match_fraco_obra(id)) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm'
              and public.match_fraco_obra(id) is not null
              and public.obra_empresa(public.match_fraco_obra(id)) = public.auth_empresa_id());

drop policy if exists match_eng_select on public.import_match_fraco;
create policy match_eng_select on public.import_match_fraco
  for select
  to authenticated
  using (public.auth_role() = 'engenheiro'
         and public.match_fraco_obra(id) is not null
         and public.has_obra_permissao(public.match_fraco_obra(id), auth.uid()));

drop policy if exists match_eng_update on public.import_match_fraco;
create policy match_eng_update on public.import_match_fraco
  for update
  to authenticated
  using      (public.auth_role() = 'engenheiro'
              and public.match_fraco_obra(id) is not null
              and public.has_obra_permissao(public.match_fraco_obra(id), auth.uid()))
  with check (public.auth_role() = 'engenheiro'
              and public.match_fraco_obra(id) is not null
              and public.has_obra_permissao(public.match_fraco_obra(id), auth.uid()));

drop policy if exists match_apoio_select on public.import_match_fraco;
create policy match_apoio_select on public.import_match_fraco
  for select
  to authenticated
  using (public.auth_role() = 'apoio'
         and public.match_fraco_obra(id) is not null
         and public.has_obra_permissao(public.match_fraco_obra(id), public.auth_engenheiro_id()));

-- INSERT/DELETE: bloqueado p/ authenticated → só service_role (Edge Function).
