-- InfraWork Web — remove a marca whitelabel por empresa (design único, igual ao
-- InfraWork desktop). Idempotente: em bancos novos nada disso existe.
-- O bucket `marca` não pode ser apagado por SQL (storage.protect_delete); é
-- removido pela API de Storage nos ambientes onde já existia.

drop policy if exists marca_storage_god_write on storage.objects;
drop policy if exists marca_storage_adm_write on storage.objects;
drop policy if exists marca_storage_auth_read on storage.objects;

drop function if exists public.marca_publica(text);
drop table if exists public.empresa_marca cascade;
drop function if exists public.fn_empresa_marca_touch();
