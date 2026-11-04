-- Segurança e acesso para uso em obra (levantamento de prontidão, 2026-11-03).
--  1. Perfil: papel, empresa, vínculo de apoio, situação e e-mail só mudam pelas edge functions (service_role) ou
--     pelo god — antes qualquer usuário podia se promover a god com um UPDATE direto (profiles_self_update) e o adm
--     podia promover alguém da empresa a god (profiles_adm_update).
--  2. Views que perderam security_invoker ao serem recriadas (0027/0004) voltam a respeitar o RLS das tabelas.
--  3. Usuário inativo perde o acesso no banco (os helpers de papel/empresa devolvem null).
--  4. Funções do app de campo não ficam expostas ao papel anônimo.
--  5. Apontador lê as próprias fotos (o app reexibe o que enviou).
--  6. campo_sync_producao só reaproveita um lançamento (app_uuid) da mesma obra.

-- ── 1. perfil ────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.fn_profiles_protege()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon')
     and coalesce(public.auth_role()::text, '') <> 'god'
     and (new.id is distinct from old.id
          or new.role is distinct from old.role
          or new.empresa_id is distinct from old.empresa_id
          or new.engenheiro_id is distinct from old.engenheiro_id
          or new.ativo is distinct from old.ativo
          or new.email is distinct from old.email) then
    raise exception 'Papel, empresa, vínculo, situação e e-mail do usuário só mudam em Gerencial › Usuários';
  end if;
  return new;
end $$;

drop trigger if exists trg_profiles_protege on public.profiles;
create trigger trg_profiles_protege
  before update on public.profiles
  for each row execute function public.fn_profiles_protege();

-- ── 2. views com o RLS de quem consulta ──────────────────────────────────────────────────────────────────────────
alter view public.vw_acompanhamento_curva_s set (security_invoker = true);
alter view public.vw_acompanhamento_previsto_x_realizado set (security_invoker = true);
alter view public.vw_servico_custo_agregado set (security_invoker = true);

-- ── 3. usuário inativo: sem papel, sem empresa ───────────────────────────────────────────────────────────────────
create or replace function public.auth_role()
returns role_enum
language sql
stable security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and ativo
$$;

create or replace function public.auth_empresa_id()
returns uuid
language sql
stable security definer
set search_path = public
as $$
  select empresa_id from public.profiles where id = auth.uid() and ativo
$$;

create or replace function public.auth_engenheiro_id()
returns uuid
language sql
stable security definer
set search_path = public
as $$
  select engenheiro_id from public.profiles where id = auth.uid() and ativo
$$;

-- ── 4. app de campo: só usuário autenticado ──────────────────────────────────────────────────────────────────────
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname like 'campo\_%'
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

-- ── 5. apontador lê as próprias fotos ────────────────────────────────────────────────────────────────────────────
drop policy if exists acomp_foto_select_proprio on public.acompanhamento_foto;
create policy acomp_foto_select_proprio on public.acompanhamento_foto
  for select using (enviado_por = auth.uid() and public.auth_role() is not null);

drop policy if exists acomp_fotos_storage_select_dono on storage.objects;
create policy acomp_fotos_storage_select_dono on storage.objects
  for select using (
    bucket_id = 'acompanhamento-fotos'
    and owner_id = (auth.uid())::text
    and public.auth_role() is not null
  );

-- ── 6. campo_sync_producao: app_uuid procurado na própria obra ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.campo_sync_producao(_registros jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r jsonb; v_uuid uuid; v_obra uuid; v_id uuid; v_dono uuid; v_mat numeric;
  v_controla boolean; v_obrig boolean; v_rec uuid; v_unid text;
  aceitos jsonb := '[]'::jsonb; rejeitados jsonb := '[]'::jsonb; v_msg text;
begin
  if auth.uid() is null then raise exception 'Sessão expirada'; end if;
  if jsonb_typeof(_registros) <> 'array' or jsonb_array_length(_registros) > 200 then
    raise exception 'Envie de 1 a 200 registros';
  end if;
  for r in select * from jsonb_array_elements(_registros) loop
    begin
      v_uuid := (r->>'app_uuid')::uuid;
      v_obra := (r->>'obra_id')::uuid;
      if v_uuid is null or v_obra is null then raise exception 'app_uuid e obra_id são obrigatórios'; end if;
      perform public.campo_assert(v_obra);
      select id, criado_por into v_id, v_dono from public.acompanhamento_producao where app_uuid = v_uuid and obra_id = v_obra;
      if v_id is not null and public.auth_role() in ('apoio', 'apontador') and v_dono is distinct from auth.uid() then
        raise exception 'Lançamento de outro usuário';
      end if;

      if coalesce((r->>'excluir')::boolean, false) then
        if v_id is not null then delete from public.acompanhamento_producao where id = v_id; end if;
        aceitos := aceitos || to_jsonb(v_uuid::text);
        continue;
      end if;

      v_controla := false; v_obrig := false; v_rec := null; v_unid := null;
      select true, material_obrigatorio, material_recurso_id, material_unidade
        into v_controla, v_obrig, v_rec, v_unid
        from public.servico_parametro
       where item_orcamentario_id = (r->>'item_orcamentario_id')::uuid and controla_material;
      v_controla := coalesce(v_controla, false);
      v_mat := nullif(r->>'material_qtd', '')::numeric;
      if v_controla and v_obrig and v_mat is null then
        raise exception 'Informe a quantidade de material aplicado';
      end if;

      if v_id is null then
        insert into public.acompanhamento_producao
          (app_uuid, obra_id, data, item_orcamentario_id, servico_nome, equipe_id, encarregado_id, quantidade,
           frente, estaca_inicial, estaca_final, trecho_id, posicao_inicio_m, posicao_fim_m, obs, origem)
        values
          (v_uuid, v_obra, (r->>'data')::date, (r->>'item_orcamentario_id')::uuid, '',
           nullif(r->>'equipe_id', '')::uuid, nullif(r->>'encarregado_id', '')::uuid,
           (r->>'quantidade')::numeric, nullif(r->>'frente', ''), nullif(r->>'estaca_inicial', ''),
           nullif(r->>'estaca_final', ''), nullif(r->>'trecho_id', '')::uuid,
           nullif(r->>'posicao_inicio_m', '')::numeric, nullif(r->>'posicao_fim_m', '')::numeric,
           nullif(r->>'obs', ''), 'campo')
        returning id into v_id;
      else
        update public.acompanhamento_producao set
          data = (r->>'data')::date, item_orcamentario_id = (r->>'item_orcamentario_id')::uuid,
          servico_id = null, servico_nome = '', unidade = null,
          equipe_id = nullif(r->>'equipe_id', '')::uuid, encarregado_id = nullif(r->>'encarregado_id', '')::uuid,
          quantidade = (r->>'quantidade')::numeric, frente = nullif(r->>'frente', ''),
          estaca_inicial = nullif(r->>'estaca_inicial', ''), estaca_final = nullif(r->>'estaca_final', ''),
          trecho_id = nullif(r->>'trecho_id', '')::uuid,
          posicao_inicio_m = nullif(r->>'posicao_inicio_m', '')::numeric,
          posicao_fim_m = nullif(r->>'posicao_fim_m', '')::numeric,
          obs = nullif(r->>'obs', '')
         where id = v_id;
      end if;

      delete from public.acompanhamento_producao_material where producao_id = v_id;
      if v_controla and v_mat is not null then
        insert into public.acompanhamento_producao_material (producao_id, recurso_id, nome, quantidade, unidade)
        values (v_id, v_rec, '', v_mat, v_unid);
      end if;
      aceitos := aceitos || to_jsonb(v_uuid::text);
    exception when others then
      get stacked diagnostics v_msg = message_text;
      rejeitados := rejeitados || jsonb_build_object('app_uuid', r->>'app_uuid', 'motivo', v_msg);
    end;
  end loop;
  return jsonb_build_object('aceitos', aceitos, 'rejeitados', rejeitados);
end $function$

;

-- ── 7. engenheiro vê quem tem acesso às obras dele (libera/revoga apontadores pela tela de usuários) ──────────────
drop policy if exists obra_perm_eng_select_suas_obras on public.obra_permissoes;
create policy obra_perm_eng_select_suas_obras on public.obra_permissoes
  for select using (public.auth_role() = 'engenheiro' and public.has_obra_permissao(obra_id, auth.uid()));
