-- 0072: usuários do SIGA.
-- Para gravar no SIGA, quem lança precisa ser um usuário de lá: o lançamento guarda o NOME de quem cadastrou.
--   1. integracao_usuario: usuário do InfraWork ↔ usuário do sistema externo.
--        origem 'login'   apontador que entra no app de campo com o usuário e a senha do SIGA (função siga-login).
--                         As obras dele são as ligadas a um projeto que o SIGA libera para ele.
--        origem 'vinculo' usuário criado no InfraWork (engenheiro, apoio…) que o administrador liga ao do SIGA.
--                         As obras continuam dadas na tela de usuários.
--   2. integracao_login_tentativa: limite de tentativas de entrada, por usuário e por origem da chamada.
-- Tudo é gravado pelo conector (chave de serviço): o nome e o login vêm do SIGA, não de quem está na tela.

-- ── 1. Vínculo de usuário ────────────────────────────────────────────────────────────────────────────────────
create table public.integracao_usuario (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  integracao_id uuid not null references public.integracao(id) on delete cascade,
  externo_id bigint not null,
  externo_login text not null,
  externo_nome text not null,
  origem text not null default 'vinculo',
  -- ativo no sistema externo (conferido na entrada e na rodada automática)
  ativo boolean not null default true,
  -- projetos que o sistema externo libera para o usuário; nulo = todos
  projetos bigint[],
  conferido_em timestamptz,
  criado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_integracao_usuario_externo unique (integracao_id, externo_id),
  constraint chk_integracao_usuario_origem check (origem in ('login', 'vinculo'))
);
comment on table public.integracao_usuario is
  'Usuário do InfraWork ligado a um usuário do sistema externo (SIGA). É com o nome de lá que o lançamento é gravado.';

alter table public.integracao_usuario enable row level security;
-- leitura: o próprio usuário, o god e quem administra a empresa da integração. Gravação: só pelo conector.
create policy integracao_usuario_select on public.integracao_usuario for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.auth_role()) = 'god'::public.role_enum
    or ((select public.auth_role()) in ('adm'::public.role_enum, 'engenheiro'::public.role_enum)
        and integracao_id in (select i.id from public.integracao i where i.empresa_id = (select public.auth_empresa_id())))
  );
revoke all on table public.integracao_usuario from anon, authenticated;
grant select on table public.integracao_usuario to authenticated;

-- ── 2. Obras de quem entra pelo SIGA ─────────────────────────────────────────────────────────────────────────
-- As obras ligadas a um projeto liberado para o usuário entram em obra_permissoes; as que saíram, saem.
-- Usuário criado no InfraWork (origem 'vinculo') não é tocado.
create function public.siga_usuario_permissoes(_user_id uuid) returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  u record;
begin
  select iu.integracao_id, iu.origem, iu.ativo, iu.projetos, i.ativa, i.conectado_por, p.ativo as perfil_ativo
    into u
    from integracao_usuario iu
    join integracao i on i.id = iu.integracao_id
    join profiles p on p.id = iu.user_id
   where iu.user_id = _user_id;
  if not found or u.origem <> 'login' then return; end if;

  delete from obra_permissoes op
   where op.user_id = _user_id
     and op.obra_id in (select io.obra_id from integracao_obra io where io.integracao_id = u.integracao_id)
     and not (u.ativo and u.ativa and exists (
           select 1 from integracao_obra io
            where io.obra_id = op.obra_id and (u.projetos is null or io.externo_projeto_id = any (u.projetos))));

  if u.ativo and u.ativa then
    insert into obra_permissoes (obra_id, user_id, concedido_por)
    select io.obra_id, _user_id, coalesce(u.conectado_por, _user_id)
      from integracao_obra io
     where io.integracao_id = u.integracao_id
       and (u.projetos is null or io.externo_projeto_id = any (u.projetos))
       and not exists (select 1 from obra_permissoes op where op.obra_id = io.obra_id and op.user_id = _user_id);
  end if;
end
$$;
revoke execute on function public.siga_usuario_permissoes(uuid) from public, anon, authenticated;

-- Grava (ou atualiza) o vínculo. A origem de um vínculo que já existe não muda.
create function public.siga_usuario_gravar(
  _user_id uuid, _integracao_id uuid, _externo_id bigint, _login text, _nome text,
  _origem text, _projetos bigint[], _por uuid
) returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_empresa uuid;
begin
  select empresa_id into v_empresa from integracao where id = _integracao_id;
  if v_empresa is null then raise exception 'Integração não encontrada'; end if;
  if not exists (select 1 from profiles where id = _user_id and empresa_id = v_empresa) then
    raise exception 'O usuário não é da empresa desta integração';
  end if;
  if exists (select 1 from integracao_usuario
              where integracao_id = _integracao_id and externo_id = _externo_id and user_id <> _user_id) then
    raise exception 'Este usuário do SIGA já está ligado a outro usuário do InfraWork' using errcode = '23505';
  end if;
  if coalesce(btrim(_nome), '') = '' or coalesce(btrim(_login), '') = '' then
    raise exception 'O usuário do SIGA veio sem nome ou sem login';
  end if;

  insert into integracao_usuario
    (user_id, integracao_id, externo_id, externo_login, externo_nome, origem, ativo, projetos, conferido_em, criado_por)
  values (_user_id, _integracao_id, _externo_id, btrim(_login), btrim(_nome), _origem, true, _projetos, now(), _por)
  on conflict (user_id) do update
    set integracao_id = excluded.integracao_id, externo_id = excluded.externo_id,
        externo_login = excluded.externo_login, externo_nome = excluded.externo_nome,
        ativo = true, projetos = excluded.projetos, conferido_em = now(), updated_at = now();
  perform siga_usuario_permissoes(_user_id);
end
$$;
revoke execute on function public.siga_usuario_gravar(uuid, uuid, bigint, text, text, text, bigint[], uuid)
  from public, anon, authenticated;

-- Desfaz o vínculo feito pelo administrador. Quem entra pelo SIGA não tem o que desfazer: desative o usuário.
create function public.siga_usuario_remover(_user_id uuid) returns void
language plpgsql security definer
set search_path to 'public'
as $$
begin
  if exists (select 1 from integracao_usuario where user_id = _user_id and origem = 'login') then
    raise exception 'Este usuário entra pelo SIGA: para tirar o acesso, desative o usuário.';
  end if;
  delete from integracao_usuario where user_id = _user_id;
end
$$;
revoke execute on function public.siga_usuario_remover(uuid) from public, anon, authenticated;

-- Rodada automática: o conector lê de novo, no SIGA, quem continua ativo e quais projetos cada um tem.
-- _situacao: [{ externo_id, ativo, login, nome, projetos: [..] | null }]. Quem não veio é dado como inativo.
create function public.siga_usuarios_conferir(_integracao_id uuid, _situacao jsonb) returns integer
language plpgsql security definer
set search_path to 'public'
as $$
declare
  r record;
  s jsonb;
  n integer := 0;
begin
  for r in select user_id, externo_id from integracao_usuario where integracao_id = _integracao_id loop
    select x into s from jsonb_array_elements(coalesce(_situacao, '[]'::jsonb)) x
     where (x->>'externo_id')::bigint = r.externo_id limit 1;
    update integracao_usuario iu
       set ativo = coalesce((s->>'ativo')::boolean, false),
           externo_nome = coalesce(nullif(btrim(s->>'nome'), ''), iu.externo_nome),
           externo_login = coalesce(nullif(btrim(s->>'login'), ''), iu.externo_login),
           projetos = case when s is null then iu.projetos
                           when jsonb_typeof(s->'projetos') = 'array'
                             then array(select jsonb_array_elements_text(s->'projetos')::bigint)
                           else null end,
           conferido_em = now(), updated_at = now()
     where iu.user_id = r.user_id;
    perform siga_usuario_permissoes(r.user_id);
    n := n + 1;
  end loop;
  return n;
end
$$;
revoke execute on function public.siga_usuarios_conferir(uuid, jsonb) from public, anon, authenticated;

-- Obra vinculada, trocada de projeto ou desvinculada: as obras de quem entra pelo SIGA acompanham.
create function public.fn_integracao_obra_permissoes() returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
begin
  if tg_op = 'DELETE' then
    delete from obra_permissoes op
     using integracao_usuario iu
     where op.obra_id = old.obra_id and iu.user_id = op.user_id
       and iu.integracao_id = old.integracao_id and iu.origem = 'login';
    return old;
  end if;
  perform siga_usuario_permissoes(iu.user_id)
     from integracao_usuario iu
    where iu.integracao_id = new.integracao_id and iu.origem = 'login';
  return new;
end
$$;
revoke execute on function public.fn_integracao_obra_permissoes() from public, anon, authenticated;
create trigger trg_integracao_obra_permissoes
  after insert or delete or update of externo_projeto_id on public.integracao_obra
  for each row execute function public.fn_integracao_obra_permissoes();

-- ── 3. Limite de tentativas de entrada ───────────────────────────────────────────────────────────────────────
create table public.integracao_login_tentativa (
  id bigint generated always as identity primary key,
  -- 'u:<login>' ou 'o:<origem da chamada>'
  chave text not null,
  ok boolean not null,
  quando timestamptz not null default now()
);
create index ix_integracao_login_tentativa on public.integracao_login_tentativa (chave, quando desc);
comment on table public.integracao_login_tentativa is
  'Tentativas de entrada pelo sistema externo (siga-login), para limitar por usuário e por origem. Só o serviço lê e grava.';
alter table public.integracao_login_tentativa enable row level security;
revoke all on table public.integracao_login_tentativa from anon, authenticated;

-- Em 15 minutos: até 8 senhas erradas por usuário e 40 por origem.
create function public.siga_login_liberado(_login text, _origem text) returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select (select count(*) from integracao_login_tentativa
           where chave = 'u:' || lower(btrim(_login)) and not ok and quando > now() - interval '15 minutes') < 8
     and (select count(*) from integracao_login_tentativa
           where chave = 'o:' || coalesce(_origem, '') and not ok and quando > now() - interval '15 minutes') < 40
$$;
revoke execute on function public.siga_login_liberado(text, text) from public, anon, authenticated;

create function public.siga_login_registrar(_login text, _origem text, _ok boolean) returns void
language plpgsql security definer
set search_path to 'public'
as $$
begin
  if _ok then
    delete from integracao_login_tentativa where chave = 'u:' || lower(btrim(_login)) and not ok;
  else
    insert into integracao_login_tentativa (chave, ok)
    values ('u:' || lower(btrim(_login)), false), ('o:' || coalesce(_origem, ''), false);
  end if;
  delete from integracao_login_tentativa where quando < now() - interval '2 days';
end
$$;
revoke execute on function public.siga_login_registrar(text, text, boolean) from public, anon, authenticated;
