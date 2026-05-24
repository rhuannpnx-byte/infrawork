-- InfraWork — Orçamento (Fase 3.C): RLS para Revisões + Comentários + Memória + Anexos
--
-- Padrão por tabela:
--   - revisao_orcamento, memoria_calculo_item, anexo:
--       leitura: god / adm-empresa / eng-com-permissão / apoio-via-eng
--       escrita: idem (exceto apoio)
--   - comentario_item:
--       leitura: idem
--       escrita: idem (todos com acesso de leitura podem comentar,
--                inclusive Apoio — comentar não é "editar orçamento")
--       UPDATE/DELETE de comentário: apenas autor (ou god)

alter table public.revisao_orcamento     enable row level security;
alter table public.comentario_item       enable row level security;
alter table public.memoria_calculo_item  enable row level security;
alter table public.anexo                 enable row level security;

-- =========================================================================
-- revisao_orcamento
-- INSERT/UPDATE: apenas service_role da Edge Function (mais seguro).
-- SELECT: god/adm/eng-com-perm/apoio.
-- DELETE: god/adm/eng-com-perm (trigger bloqueia se status=homologada).
-- =========================================================================
drop policy if exists revisao_god_select on public.revisao_orcamento;
create policy revisao_god_select on public.revisao_orcamento
  for select
  to authenticated
  using (public.auth_role() = 'god');

drop policy if exists revisao_adm_select on public.revisao_orcamento;
create policy revisao_adm_select on public.revisao_orcamento
  for select
  to authenticated
  using (public.auth_role() = 'adm'
         and public.obra_empresa(obra_id) = public.auth_empresa_id());

drop policy if exists revisao_eng_select on public.revisao_orcamento;
create policy revisao_eng_select on public.revisao_orcamento
  for select
  to authenticated
  using (public.auth_role() = 'engenheiro'
         and public.has_obra_permissao(obra_id, auth.uid()));

drop policy if exists revisao_apoio_select on public.revisao_orcamento;
create policy revisao_apoio_select on public.revisao_orcamento
  for select
  to authenticated
  using (public.auth_role() = 'apoio'
         and public.has_obra_permissao(obra_id, public.auth_engenheiro_id()));

drop policy if exists revisao_god_delete on public.revisao_orcamento;
create policy revisao_god_delete on public.revisao_orcamento
  for delete
  to authenticated
  using (public.auth_role() = 'god');

drop policy if exists revisao_adm_delete on public.revisao_orcamento;
create policy revisao_adm_delete on public.revisao_orcamento
  for delete
  to authenticated
  using (public.auth_role() = 'adm'
         and public.obra_empresa(obra_id) = public.auth_empresa_id());

-- Sem INSERT/UPDATE para `authenticated` → service_role (Edge Function) faz tudo.

-- =========================================================================
-- comentario_item
-- SELECT/INSERT: todos com acesso à obra (inclui Apoio).
-- UPDATE/DELETE: apenas autor ou god.
-- =========================================================================
drop policy if exists comentario_god_all on public.comentario_item;
create policy comentario_god_all on public.comentario_item
  for all
  to authenticated
  using      (public.auth_role() = 'god')
  with check (public.auth_role() = 'god');

drop policy if exists comentario_adm_select on public.comentario_item;
create policy comentario_adm_select on public.comentario_item
  for select
  to authenticated
  using (public.auth_role() = 'adm'
         and public.obra_empresa(obra_id) = public.auth_empresa_id());

drop policy if exists comentario_adm_insert on public.comentario_item;
create policy comentario_adm_insert on public.comentario_item
  for insert
  to authenticated
  with check (public.auth_role() = 'adm'
              and public.obra_empresa(obra_id) = public.auth_empresa_id()
              and autor_id = auth.uid());

drop policy if exists comentario_eng_select on public.comentario_item;
create policy comentario_eng_select on public.comentario_item
  for select
  to authenticated
  using (public.auth_role() = 'engenheiro'
         and public.has_obra_permissao(obra_id, auth.uid()));

drop policy if exists comentario_eng_insert on public.comentario_item;
create policy comentario_eng_insert on public.comentario_item
  for insert
  to authenticated
  with check (public.auth_role() = 'engenheiro'
              and public.has_obra_permissao(obra_id, auth.uid())
              and autor_id = auth.uid());

drop policy if exists comentario_apoio_select on public.comentario_item;
create policy comentario_apoio_select on public.comentario_item
  for select
  to authenticated
  using (public.auth_role() = 'apoio'
         and public.has_obra_permissao(obra_id, public.auth_engenheiro_id()));

drop policy if exists comentario_apoio_insert on public.comentario_item;
create policy comentario_apoio_insert on public.comentario_item
  for insert
  to authenticated
  with check (public.auth_role() = 'apoio'
              and public.has_obra_permissao(obra_id, public.auth_engenheiro_id())
              and autor_id = auth.uid());

drop policy if exists comentario_autor_update on public.comentario_item;
create policy comentario_autor_update on public.comentario_item
  for update
  to authenticated
  using      (autor_id = auth.uid())
  with check (autor_id = auth.uid());

drop policy if exists comentario_autor_delete on public.comentario_item;
create policy comentario_autor_delete on public.comentario_item
  for delete
  to authenticated
  using (autor_id = auth.uid());

-- =========================================================================
-- memoria_calculo_item
-- SELECT: todos com acesso (incluindo apoio).
-- INSERT/UPDATE/DELETE: god/adm/eng-com-perm.
-- =========================================================================
drop policy if exists memoria_god_all on public.memoria_calculo_item;
create policy memoria_god_all on public.memoria_calculo_item
  for all
  to authenticated
  using      (public.auth_role() = 'god')
  with check (public.auth_role() = 'god');

drop policy if exists memoria_adm_all on public.memoria_calculo_item;
create policy memoria_adm_all on public.memoria_calculo_item
  for all
  to authenticated
  using      (public.auth_role() = 'adm'
              and public.obra_empresa(obra_id) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm'
              and public.obra_empresa(obra_id) = public.auth_empresa_id());

drop policy if exists memoria_eng_all on public.memoria_calculo_item;
create policy memoria_eng_all on public.memoria_calculo_item
  for all
  to authenticated
  using      (public.auth_role() = 'engenheiro'
              and public.has_obra_permissao(obra_id, auth.uid()))
  with check (public.auth_role() = 'engenheiro'
              and public.has_obra_permissao(obra_id, auth.uid()));

drop policy if exists memoria_apoio_select on public.memoria_calculo_item;
create policy memoria_apoio_select on public.memoria_calculo_item
  for select
  to authenticated
  using (public.auth_role() = 'apoio'
         and public.has_obra_permissao(obra_id, public.auth_engenheiro_id()));

-- =========================================================================
-- anexo
-- Mesmo padrão de memoria (apoio só lê).
-- =========================================================================
drop policy if exists anexo_god_all on public.anexo;
create policy anexo_god_all on public.anexo
  for all
  to authenticated
  using      (public.auth_role() = 'god')
  with check (public.auth_role() = 'god');

drop policy if exists anexo_adm_all on public.anexo;
create policy anexo_adm_all on public.anexo
  for all
  to authenticated
  using      (public.auth_role() = 'adm'
              and public.obra_empresa(obra_id) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm'
              and public.obra_empresa(obra_id) = public.auth_empresa_id());

drop policy if exists anexo_eng_all on public.anexo;
create policy anexo_eng_all on public.anexo
  for all
  to authenticated
  using      (public.auth_role() = 'engenheiro'
              and public.has_obra_permissao(obra_id, auth.uid()))
  with check (public.auth_role() = 'engenheiro'
              and public.has_obra_permissao(obra_id, auth.uid()));

drop policy if exists anexo_apoio_select on public.anexo;
create policy anexo_apoio_select on public.anexo
  for select
  to authenticated
  using (public.auth_role() = 'apoio'
         and public.has_obra_permissao(obra_id, public.auth_engenheiro_id()));
