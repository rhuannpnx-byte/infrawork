-- InfraWork — Acompanhamento (Fase B): helpers + RLS para tabelas de matching
--
-- Padrão de RLS (igual ao restante do app):
--   god       -> ALL
--   adm       -> ALL onde obra_empresa(obra_id) = auth_empresa_id()
--   engenheiro-> ALL onde has_obra_permissao(obra_id, auth.uid())
--   apoio     -> SELECT only via auth_engenheiro_id()
--
-- Eng pode ESCREVER nos matches porque a vinculação é tarefa operacional
-- (mesmo critério que para Equipes/CPU no Planejamento).

-- ─────────────────────────────────────────────────────────────────────────
-- Helpers SECURITY DEFINER (lookup obra_id pelo id da linha)
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.acomp_equipe_match_obra(_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select obra_id from public.acompanhamento_equipe_match where id = _id
$$;

create or replace function public.acomp_encarregado_match_obra(_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select obra_id from public.acompanhamento_encarregado_match where id = _id
$$;

create or replace function public.acomp_servico_match_obra(_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select obra_id from public.acompanhamento_servico_match where id = _id
$$;

alter function public.acomp_equipe_match_obra(uuid)       owner to postgres;
alter function public.acomp_encarregado_match_obra(uuid)  owner to postgres;
alter function public.acomp_servico_match_obra(uuid)      owner to postgres;

revoke all on function public.acomp_equipe_match_obra(uuid)      from public;
revoke all on function public.acomp_encarregado_match_obra(uuid) from public;
revoke all on function public.acomp_servico_match_obra(uuid)     from public;

grant execute on function public.acomp_equipe_match_obra(uuid)      to authenticated;
grant execute on function public.acomp_encarregado_match_obra(uuid) to authenticated;
grant execute on function public.acomp_servico_match_obra(uuid)     to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- Enable RLS
-- ─────────────────────────────────────────────────────────────────────────
alter table public.acompanhamento_equipe_match       enable row level security;
alter table public.acompanhamento_encarregado_match  enable row level security;
alter table public.acompanhamento_servico_match      enable row level security;

-- ============== acompanhamento_equipe_match ==============
drop policy if exists acomp_eq_match_god_all on public.acompanhamento_equipe_match;
create policy acomp_eq_match_god_all on public.acompanhamento_equipe_match
  for all to authenticated
  using (public.auth_role() = 'god') with check (public.auth_role() = 'god');

drop policy if exists acomp_eq_match_adm_all on public.acompanhamento_equipe_match;
create policy acomp_eq_match_adm_all on public.acompanhamento_equipe_match
  for all to authenticated
  using      (public.auth_role() = 'adm' and public.obra_empresa(obra_id) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm' and public.obra_empresa(obra_id) = public.auth_empresa_id());

drop policy if exists acomp_eq_match_eng_all on public.acompanhamento_equipe_match;
create policy acomp_eq_match_eng_all on public.acompanhamento_equipe_match
  for all to authenticated
  using      (public.auth_role() = 'engenheiro' and public.has_obra_permissao(obra_id, auth.uid()))
  with check (public.auth_role() = 'engenheiro' and public.has_obra_permissao(obra_id, auth.uid()));

drop policy if exists acomp_eq_match_apoio_select on public.acompanhamento_equipe_match;
create policy acomp_eq_match_apoio_select on public.acompanhamento_equipe_match
  for select to authenticated
  using (public.auth_role() = 'apoio' and public.has_obra_permissao(obra_id, public.auth_engenheiro_id()));

-- ============== acompanhamento_encarregado_match ==============
drop policy if exists acomp_enc_match_god_all on public.acompanhamento_encarregado_match;
create policy acomp_enc_match_god_all on public.acompanhamento_encarregado_match
  for all to authenticated
  using (public.auth_role() = 'god') with check (public.auth_role() = 'god');

drop policy if exists acomp_enc_match_adm_all on public.acompanhamento_encarregado_match;
create policy acomp_enc_match_adm_all on public.acompanhamento_encarregado_match
  for all to authenticated
  using      (public.auth_role() = 'adm' and public.obra_empresa(obra_id) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm' and public.obra_empresa(obra_id) = public.auth_empresa_id());

drop policy if exists acomp_enc_match_eng_all on public.acompanhamento_encarregado_match;
create policy acomp_enc_match_eng_all on public.acompanhamento_encarregado_match
  for all to authenticated
  using      (public.auth_role() = 'engenheiro' and public.has_obra_permissao(obra_id, auth.uid()))
  with check (public.auth_role() = 'engenheiro' and public.has_obra_permissao(obra_id, auth.uid()));

drop policy if exists acomp_enc_match_apoio_select on public.acompanhamento_encarregado_match;
create policy acomp_enc_match_apoio_select on public.acompanhamento_encarregado_match
  for select to authenticated
  using (public.auth_role() = 'apoio' and public.has_obra_permissao(obra_id, public.auth_engenheiro_id()));

-- ============== acompanhamento_servico_match ==============
drop policy if exists acomp_serv_match_god_all on public.acompanhamento_servico_match;
create policy acomp_serv_match_god_all on public.acompanhamento_servico_match
  for all to authenticated
  using (public.auth_role() = 'god') with check (public.auth_role() = 'god');

drop policy if exists acomp_serv_match_adm_all on public.acompanhamento_servico_match;
create policy acomp_serv_match_adm_all on public.acompanhamento_servico_match
  for all to authenticated
  using      (public.auth_role() = 'adm' and public.obra_empresa(obra_id) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm' and public.obra_empresa(obra_id) = public.auth_empresa_id());

drop policy if exists acomp_serv_match_eng_all on public.acompanhamento_servico_match;
create policy acomp_serv_match_eng_all on public.acompanhamento_servico_match
  for all to authenticated
  using      (public.auth_role() = 'engenheiro' and public.has_obra_permissao(obra_id, auth.uid()))
  with check (public.auth_role() = 'engenheiro' and public.has_obra_permissao(obra_id, auth.uid()));

drop policy if exists acomp_serv_match_apoio_select on public.acompanhamento_servico_match;
create policy acomp_serv_match_apoio_select on public.acompanhamento_servico_match
  for select to authenticated
  using (public.auth_role() = 'apoio' and public.has_obra_permissao(obra_id, public.auth_engenheiro_id()));
