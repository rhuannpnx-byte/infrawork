-- InfraWork — rastreio de acesso/presença dos usuários (visível só p/ God na UI).
--
-- profiles ganha:
--   * acessos_count  — nº de acessos (login OU abertura do app com sessão).
--   * last_access_at — timestamp do último acesso.
--   * last_seen_at   — heartbeat de presença (atualizado a cada ~60s enquanto
--                      o app está aberto). "Online agora" = last_seen_at nos
--                      últimos ~2,5 min.
--
-- Atualização via RPCs SECURITY DEFINER escopadas a auth.uid() (cada usuário só
-- mexe na própria linha). Token refresh NÃO conta acesso (o cliente só chama
-- registrar_acesso no boot/login).

alter table public.profiles
  add column if not exists acessos_count  integer     not null default 0,
  add column if not exists last_access_at timestamptz,
  add column if not exists last_seen_at   timestamptz;

-- Registra um acesso: +1 na contagem, marca último acesso e presença.
create or replace function public.registrar_acesso()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
     set acessos_count  = coalesce(acessos_count, 0) + 1,
         last_access_at = now(),
         last_seen_at   = now()
   where id = auth.uid();
$$;

-- Heartbeat de presença: só atualiza last_seen_at.
create or replace function public.registrar_presenca()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
     set last_seen_at = now()
   where id = auth.uid();
$$;

revoke all on function public.registrar_acesso()   from public;
revoke all on function public.registrar_presenca() from public;
grant execute on function public.registrar_acesso()   to authenticated;
grant execute on function public.registrar_presenca() to authenticated;
