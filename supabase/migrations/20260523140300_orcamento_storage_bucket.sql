-- InfraWork — Orçamento (Fase 3.D): bucket de Storage para anexos
--
-- Cria bucket privado `orcamento` (apenas usuários autenticados acessam).
-- Estrutura de paths esperada: <empresa_id>/<obra_id>/<escopo>/<escopo_id>/<arquivo>
--
-- Policies de Storage:
--   - SELECT: usuário com acesso à obra (god/adm/eng/apoio via has_obra_permissao)
--   - INSERT/UPDATE/DELETE: god/adm + eng com permissão (não apoio)
--
-- O obra_id é o segmento [2] do path (índice 1 no SPLIT_PART começando em 1, mas
-- storage.foldername usa array — então split_part(name, '/', 2) é o obra_id).

insert into storage.buckets (id, name, public)
values ('orcamento', 'orcamento', false)
on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- SELECT policies — 4 personas via has_obra_permissao / empresa
-- ─────────────────────────────────────────────────────────────────────────
drop policy if exists orcamento_storage_god_select on storage.objects;
create policy orcamento_storage_god_select on storage.objects
  for select
  to authenticated
  using (bucket_id = 'orcamento' and public.auth_role() = 'god');

drop policy if exists orcamento_storage_adm_select on storage.objects;
create policy orcamento_storage_adm_select on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'orcamento'
    and public.auth_role() = 'adm'
    and public.obra_empresa((split_part(name, '/', 2))::uuid) = public.auth_empresa_id()
  );

drop policy if exists orcamento_storage_eng_select on storage.objects;
create policy orcamento_storage_eng_select on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'orcamento'
    and public.auth_role() = 'engenheiro'
    and public.has_obra_permissao((split_part(name, '/', 2))::uuid, auth.uid())
  );

drop policy if exists orcamento_storage_apoio_select on storage.objects;
create policy orcamento_storage_apoio_select on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'orcamento'
    and public.auth_role() = 'apoio'
    and public.has_obra_permissao((split_part(name, '/', 2))::uuid, public.auth_engenheiro_id())
  );

-- ─────────────────────────────────────────────────────────────────────────
-- INSERT/UPDATE/DELETE — god/adm/eng com permissão (não apoio)
-- ─────────────────────────────────────────────────────────────────────────
drop policy if exists orcamento_storage_god_write on storage.objects;
create policy orcamento_storage_god_write on storage.objects
  for all
  to authenticated
  using      (bucket_id = 'orcamento' and public.auth_role() = 'god')
  with check (bucket_id = 'orcamento' and public.auth_role() = 'god');

drop policy if exists orcamento_storage_adm_write on storage.objects;
create policy orcamento_storage_adm_write on storage.objects
  for all
  to authenticated
  using (
    bucket_id = 'orcamento'
    and public.auth_role() = 'adm'
    and public.obra_empresa((split_part(name, '/', 2))::uuid) = public.auth_empresa_id()
  )
  with check (
    bucket_id = 'orcamento'
    and public.auth_role() = 'adm'
    and public.obra_empresa((split_part(name, '/', 2))::uuid) = public.auth_empresa_id()
  );

drop policy if exists orcamento_storage_eng_write on storage.objects;
create policy orcamento_storage_eng_write on storage.objects
  for all
  to authenticated
  using (
    bucket_id = 'orcamento'
    and public.auth_role() = 'engenheiro'
    and public.has_obra_permissao((split_part(name, '/', 2))::uuid, auth.uid())
  )
  with check (
    bucket_id = 'orcamento'
    and public.auth_role() = 'engenheiro'
    and public.has_obra_permissao((split_part(name, '/', 2))::uuid, auth.uid())
  );
