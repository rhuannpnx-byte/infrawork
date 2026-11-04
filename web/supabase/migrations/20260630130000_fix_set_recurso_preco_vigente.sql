-- Corrige set_recurso_preco_vigente(): a checagem de permissão usava
-- recurso_empresa(uuid), helper que foi REMOVIDO na migração de vedação por
-- obra (20260524100000). Recursos agora são obra-scoped — o acesso segue o
-- mesmo critério das policies de recurso_preco (god / adm por empresa da obra /
-- engenheiro por permissão na obra).

create or replace function public.set_recurso_preco_vigente(_preco_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _recurso uuid;
  _obra    uuid;
begin
  select recurso_id into _recurso from public.recurso_preco where id = _preco_id;
  if _recurso is null then
    raise exception 'Preço não encontrado';
  end if;

  _obra := public.recurso_obra(_recurso);

  if not (
    public.auth_role() = 'god'
    or (public.auth_role() = 'adm'
        and public.obra_empresa(_obra) = public.auth_empresa_id())
    or (public.auth_role() = 'engenheiro'
        and public.has_obra_permissao(_obra, auth.uid()))
  ) then
    raise exception 'Sem permissão para alterar o preço vigente';
  end if;

  update public.recurso_preco
     set is_vigente = false
   where recurso_id = _recurso and is_vigente = true and id <> _preco_id;

  update public.recurso_preco
     set is_vigente = true
   where id = _preco_id;
end
$$;
