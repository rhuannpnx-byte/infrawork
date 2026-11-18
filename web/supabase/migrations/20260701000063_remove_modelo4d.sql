-- Remove o Acompanhamento 4D (beta): o módulo saiu do sistema antes de entrar em uso, e o código ficou guardado na
-- tag `acompanhamento-4d-beta`. Saem as tabelas, as funções e as regras do bucket criadas na 0062.

-- Vincular um modelo ligava a exigência de estaca no lançamento dos serviços vinculados. Onde ela foi ligada pelo
-- próprio registro do modelo (o parâmetro mudou no mesmo instante e ninguém mexeu nele depois), volta ao que era.
-- O que foi ligado na parametrização da obra não é tocado.
do $$
begin
  if to_regclass('public.modelo4d_vinculo') is not null then
    update public.servico_parametro sp
       set exige_local = false
      from public.modelo4d_vinculo v
      join public.modelo4d m on m.id = v.modelo_id
     where sp.item_orcamentario_id = v.item_orcamentario_id
       and sp.exige_local
       and abs(extract(epoch from sp.updated_at - m.created_at)) < 120;
  end if;
end $$;

drop policy if exists "modelos4d_storage_select" on storage.objects;
drop policy if exists "modelos4d_storage_insert" on storage.objects;
drop policy if exists "modelos4d_storage_delete" on storage.objects;

drop function if exists public.modelo4d_excluir(uuid);
drop function if exists public.modelo4d_ativar(uuid);
drop function if exists public.modelo4d_vincular(uuid, jsonb, jsonb);
drop function if exists public.modelo4d_registrar(uuid, uuid, text, text, bigint, jsonb, jsonb, jsonb);
drop function if exists public.modelo4d_gravar_vinculos(uuid, uuid, jsonb, jsonb);

drop table if exists public.modelo4d_vinculo;
drop table if exists public.modelo4d_eixo;
drop table if exists public.modelo4d;

-- O bucket `modelos-4d` e os arquivos dele não saem por SQL (o Storage recusa apagar direto nas tabelas): são
-- removidos pela API do Storage. Enquanto existir, o bucket fica sem regra de acesso, fechado para os usuários.
