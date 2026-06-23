-- InfraWork — Documentação Oficial (Fase 1): bucket de Storage
--
-- Bucket privado `documentacao` (apenas autenticados). Regra de ouro WORM: o
-- arquivo é cópia governada; não sobrescrevemos a origem.
-- Path: <obra_id>/<contrato_id>/<documento_id>/<timestamp>-<arquivo>
-- → obra_id é o segmento [1] (split_part(name, '/', 1)).
--
-- Policies espelham a matriz por obra:
--   SELECT: god / adm-empresa / eng-permissão / apoio (via engenheiro)
--   WRITE : god / adm / eng com permissão (apoio NÃO escreve)
-- CLIENTE não tem policy → não acessa o bucket.

insert into storage.buckets (id, name, public)
values ('documentacao', 'documentacao', false)
on conflict (id) do nothing;

-- ─── SELECT ────────────────────────────────────────────────────────────────
drop policy if exists documentacao_storage_god_select on storage.objects;
create policy documentacao_storage_god_select on storage.objects
  for select to authenticated
  using (bucket_id = 'documentacao' and public.auth_role() = 'god');

drop policy if exists documentacao_storage_adm_select on storage.objects;
create policy documentacao_storage_adm_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documentacao'
    and public.auth_role() = 'adm'
    and public.obra_empresa((split_part(name, '/', 1))::uuid) = public.auth_empresa_id()
  );

drop policy if exists documentacao_storage_eng_select on storage.objects;
create policy documentacao_storage_eng_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documentacao'
    and public.auth_role() = 'engenheiro'
    and public.has_obra_permissao((split_part(name, '/', 1))::uuid, auth.uid())
  );

drop policy if exists documentacao_storage_apoio_select on storage.objects;
create policy documentacao_storage_apoio_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documentacao'
    and public.auth_role() = 'apoio'
    and public.has_obra_permissao((split_part(name, '/', 1))::uuid, public.auth_engenheiro_id())
  );

-- ─── WRITE (INSERT/UPDATE/DELETE) — god/adm/eng (não apoio) ─────────────────
drop policy if exists documentacao_storage_god_write on storage.objects;
create policy documentacao_storage_god_write on storage.objects
  for all to authenticated
  using      (bucket_id = 'documentacao' and public.auth_role() = 'god')
  with check (bucket_id = 'documentacao' and public.auth_role() = 'god');

drop policy if exists documentacao_storage_adm_write on storage.objects;
create policy documentacao_storage_adm_write on storage.objects
  for all to authenticated
  using (
    bucket_id = 'documentacao'
    and public.auth_role() = 'adm'
    and public.obra_empresa((split_part(name, '/', 1))::uuid) = public.auth_empresa_id()
  )
  with check (
    bucket_id = 'documentacao'
    and public.auth_role() = 'adm'
    and public.obra_empresa((split_part(name, '/', 1))::uuid) = public.auth_empresa_id()
  );

drop policy if exists documentacao_storage_eng_write on storage.objects;
create policy documentacao_storage_eng_write on storage.objects
  for all to authenticated
  using (
    bucket_id = 'documentacao'
    and public.auth_role() = 'engenheiro'
    and public.has_obra_permissao((split_part(name, '/', 1))::uuid, auth.uid())
  )
  with check (
    bucket_id = 'documentacao'
    and public.auth_role() = 'engenheiro'
    and public.has_obra_permissao((split_part(name, '/', 1))::uuid, auth.uid())
  );
