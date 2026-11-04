-- InfraWork Web — buckets de Storage e policies (não vêm no dump `--schema public`).
--
--   orcamento            privado — anexos do orçamento, path <obra_id>/<escopo>/<escopo_id>/<arquivo>
--   acompanhamento-fotos privado — fotos de produção, path <empresa_id>/<obra_id>/<producao_id|avulsa>/<uuid>.jpg
--
-- As policies de `acompanhamento-fotos` vivem na migration da feature
-- (0007_acompanhamento_nativo).

-- ─── orcamento ────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('orcamento', 'orcamento', false)
on conflict (id) do nothing;

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
    and public.obra_empresa((split_part(name, '/', 1))::uuid) = public.auth_empresa_id()
  );

drop policy if exists orcamento_storage_eng_select on storage.objects;
create policy orcamento_storage_eng_select on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'orcamento'
    and public.auth_role() = 'engenheiro'
    and public.has_obra_permissao((split_part(name, '/', 1))::uuid, auth.uid())
  );

drop policy if exists orcamento_storage_apoio_select on storage.objects;
create policy orcamento_storage_apoio_select on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'orcamento'
    and public.auth_role() = 'apoio'
    and public.has_obra_permissao((split_part(name, '/', 1))::uuid, public.auth_engenheiro_id())
  );

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
    and public.obra_empresa((split_part(name, '/', 1))::uuid) = public.auth_empresa_id()
  )
  with check (
    bucket_id = 'orcamento'
    and public.auth_role() = 'adm'
    and public.obra_empresa((split_part(name, '/', 1))::uuid) = public.auth_empresa_id()
  );

drop policy if exists orcamento_storage_eng_write on storage.objects;
create policy orcamento_storage_eng_write on storage.objects
  for all
  to authenticated
  using (
    bucket_id = 'orcamento'
    and public.auth_role() = 'engenheiro'
    and public.has_obra_permissao((split_part(name, '/', 1))::uuid, auth.uid())
  )
  with check (
    bucket_id = 'orcamento'
    and public.auth_role() = 'engenheiro'
    and public.has_obra_permissao((split_part(name, '/', 1))::uuid, auth.uid())
  );

-- ─── acompanhamento-fotos (privado; policies na 0007_acompanhamento_nativo) ─
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('acompanhamento-fotos', 'acompanhamento-fotos', false, 15728640, '{image/jpeg,image/png,image/webp}')
on conflict (id) do nothing;
