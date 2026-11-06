-- Tokens pessoais do MCP do InfraWork (IDEs, agentes e clientes sem OAuth). O token só aparece na criação; o banco
-- guarda o SHA-256. O servidor do MCP troca o token por uma sessão do dono (com a service key) e daí em diante o
-- RLS vale como no web.

create table if not exists public.mcp_token (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  nome          text not null check (length(trim(nome)) between 1 and 80),
  prefixo       text not null,
  hash          text not null unique,
  criado_em     timestamptz not null default now(),
  expira_em     timestamptz,
  ultimo_uso_em timestamptz,
  revogado_em   timestamptz
);
create index if not exists idx_mcp_token_user on public.mcp_token (user_id);

alter table public.mcp_token enable row level security;
drop policy if exists mcp_token_select on public.mcp_token;
create policy mcp_token_select on public.mcp_token for select to authenticated using (user_id = auth.uid());

-- cria o token do próprio usuário e devolve o texto (única vez em que aparece)
create or replace function public.mcp_token_criar(_nome text, _dias int default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token text;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Sessão expirada'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and ativo) then
    raise exception 'Usuário inativo';
  end if;
  if _dias is not null and (_dias < 1 or _dias > 730) then
    raise exception 'Validade entre 1 e 730 dias (ou sem validade)';
  end if;
  if (select count(*) from public.mcp_token where user_id = auth.uid() and revogado_em is null) >= 20 then
    raise exception 'Limite de 20 tokens ativos — revogue algum antes';
  end if;
  v_token := 'iwk_' || translate(encode(gen_random_bytes(30), 'base64'), '+/=', '-_');
  insert into public.mcp_token (user_id, nome, prefixo, hash, expira_em)
  values (auth.uid(), trim(_nome), left(v_token, 10), encode(digest(v_token, 'sha256'), 'hex'),
          case when _dias is null then null else now() + make_interval(days => _dias) end)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'token', v_token);
end $$;

create or replace function public.mcp_token_revogar(_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.mcp_token set revogado_em = now()
   where id = _id and user_id = auth.uid() and revogado_em is null;
  if not found then raise exception 'Token não encontrado ou já revogado'; end if;
end $$;

alter function public.mcp_token_criar(text, int) owner to postgres;
alter function public.mcp_token_revogar(uuid) owner to postgres;
revoke all on function public.mcp_token_criar(text, int) from public, anon;
revoke all on function public.mcp_token_revogar(uuid) from public, anon;
grant execute on function public.mcp_token_criar(text, int) to authenticated;
grant execute on function public.mcp_token_revogar(uuid) to authenticated;
