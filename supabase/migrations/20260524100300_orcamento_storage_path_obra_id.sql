-- InfraWork — Orçamento: ajusta storage policies para novo path
--
-- O path de anexos era <empresa_id>/<obra_id>/<escopo>/<escopo_id>/<arquivo>;
-- com a vedação por obra (catálogos por obra), o path simplifica para
-- <obra_id>/<escopo>/<escopo_id>/<arquivo>. As policies são reescritas
-- com split_part(name, '/', 1) em vez de '/', 2.

drop policy if exists orcamento_storage_god_select on storage.objects;
drop policy if exists orcamento_storage_adm_select on storage.objects;
drop policy if exists orcamento_storage_eng_select on storage.objects;
drop policy if exists orcamento_storage_apoio_select on storage.objects;
drop policy if exists orcamento_storage_god_write on storage.objects;
drop policy if exists orcamento_storage_adm_write on storage.objects;
drop policy if exists orcamento_storage_eng_write on storage.objects;

create policy orcamento_storage_god_select on storage.objects
  for select
  to authenticated
  using (bucket_id = 'orcamento' and public.auth_role() = 'god');

create policy orcamento_storage_adm_select on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'orcamento'
    and public.auth_role() = 'adm'
    and public.obra_empresa((split_part(name, '/', 1))::uuid) = public.auth_empresa_id()
  );

create policy orcamento_storage_eng_select on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'orcamento'
    and public.auth_role() = 'engenheiro'
    and public.has_obra_permissao((split_part(name, '/', 1))::uuid, auth.uid())
  );

create policy orcamento_storage_apoio_select on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'orcamento'
    and public.auth_role() = 'apoio'
    and public.has_obra_permissao((split_part(name, '/', 1))::uuid, public.auth_engenheiro_id())
  );

create policy orcamento_storage_god_write on storage.objects
  for all
  to authenticated
  using      (bucket_id = 'orcamento' and public.auth_role() = 'god')
  with check (bucket_id = 'orcamento' and public.auth_role() = 'god');

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
