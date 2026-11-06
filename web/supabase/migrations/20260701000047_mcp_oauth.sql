-- Servidor OAuth 2.1 próprio do MCP do InfraWork (sem depender do Servidor OAuth do Supabase): registro dinâmico de
-- clientes (Claude.ai, ChatGPT…), código de autorização com PKCE emitido na tela de consentimento do web e tokens de
-- acesso/renovação guardados em mcp_token (tipo 'oauth'), ao lado dos tokens pessoais — o usuário vê e revoga tudo
-- no mesmo lugar. Só o hash dos segredos fica no banco; a troca de código e a renovação rodam no servidor do MCP.

create table if not exists public.mcp_oauth_cliente (
  id            uuid primary key default gen_random_uuid(),
  client_id     text not null unique,
  nome          text not null,
  redirect_uris text[] not null check (cardinality(redirect_uris) between 1 and 10),
  criado_em     timestamptz not null default now()
);
alter table public.mcp_oauth_cliente enable row level security;

create table if not exists public.mcp_oauth_codigo (
  hash           text primary key,
  cliente_id     uuid not null references public.mcp_oauth_cliente(id) on delete cascade,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  redirect_uri   text not null,
  code_challenge text not null,
  escopo         text,
  expira_em      timestamptz not null,
  usado_em       timestamptz,
  criado_em      timestamptz not null default now()
);
alter table public.mcp_oauth_codigo enable row level security;

alter table public.mcp_token
  add column if not exists tipo text not null default 'pessoal',
  add column if not exists cliente_id uuid references public.mcp_oauth_cliente(id) on delete cascade,
  add column if not exists refresh_hash text,
  add column if not exists refresh_expira_em timestamptz;
alter table public.mcp_token drop constraint if exists chk_mcp_token_tipo;
alter table public.mcp_token add constraint chk_mcp_token_tipo check (tipo in ('pessoal', 'oauth'));
create unique index if not exists uq_mcp_token_refresh on public.mcp_token (refresh_hash) where refresh_hash is not null;

-- o limite de 20 vale só para os tokens pessoais
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
  if (select count(*) from public.mcp_token
       where user_id = auth.uid() and tipo = 'pessoal' and revogado_em is null) >= 20 then
    raise exception 'Limite de 20 tokens ativos — revogue algum antes';
  end if;
  v_token := 'iwk_' || translate(encode(gen_random_bytes(30), 'base64'), '+/=', '-_');
  insert into public.mcp_token (user_id, nome, prefixo, hash, expira_em)
  values (auth.uid(), trim(_nome), left(v_token, 10), encode(digest(v_token, 'sha256'), 'hex'),
          case when _dias is null then null else now() + make_interval(days => _dias) end)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'token', v_token);
end $$;

-- tela de consentimento: nome do cliente, conferindo o endereço de retorno registrado
create or replace function public.mcp_oauth_cliente_info(_client_id text, _redirect_uri text)
returns jsonb
language plpgsql
stable security definer
set search_path = public
as $$
declare
  c record;
begin
  if auth.uid() is null then raise exception 'Sessão expirada'; end if;
  select * into c from public.mcp_oauth_cliente where client_id = _client_id;
  if c.id is null then raise exception 'Aplicativo não registrado (client_id desconhecido)'; end if;
  if not (_redirect_uri = any (c.redirect_uris)) then
    raise exception 'Endereço de retorno não registrado para este aplicativo';
  end if;
  return jsonb_build_object('nome', c.nome, 'redirect_uri', _redirect_uri);
end $$;

-- o usuário permitiu: emite o código (uso único, 5 min) para o cliente trocar por tokens com o PKCE
create or replace function public.mcp_oauth_autorizar(
  _client_id text, _redirect_uri text, _code_challenge text, _escopo text default null)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  c record;
  v_code text;
begin
  if auth.uid() is null then raise exception 'Sessão expirada'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and ativo) then
    raise exception 'Usuário inativo';
  end if;
  select * into c from public.mcp_oauth_cliente where client_id = _client_id;
  if c.id is null then raise exception 'Aplicativo não registrado (client_id desconhecido)'; end if;
  if not (_redirect_uri = any (c.redirect_uris)) then
    raise exception 'Endereço de retorno não registrado para este aplicativo';
  end if;
  if coalesce(length(_code_challenge), 0) < 43 then raise exception 'PKCE (S256) obrigatório'; end if;
  v_code := translate(encode(gen_random_bytes(32), 'base64'), '+/=', '-_');
  insert into public.mcp_oauth_codigo (hash, cliente_id, user_id, redirect_uri, code_challenge, escopo, expira_em)
  values (encode(digest(v_code, 'sha256'), 'hex'), c.id, auth.uid(), _redirect_uri, _code_challenge, _escopo,
          now() + interval '5 minutes');
  delete from public.mcp_oauth_codigo where expira_em < now() - interval '1 day';
  return v_code;
end $$;

alter function public.mcp_token_criar(text, int) owner to postgres;
alter function public.mcp_oauth_cliente_info(text, text) owner to postgres;
alter function public.mcp_oauth_autorizar(text, text, text, text) owner to postgres;
revoke all on function public.mcp_oauth_cliente_info(text, text) from public, anon;
revoke all on function public.mcp_oauth_autorizar(text, text, text, text) from public, anon;
grant execute on function public.mcp_oauth_cliente_info(text, text) to authenticated;
grant execute on function public.mcp_oauth_autorizar(text, text, text, text) to authenticated;
