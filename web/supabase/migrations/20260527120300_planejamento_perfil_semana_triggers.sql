-- InfraWork — Planejamento: triggers do perfil semanal
--
-- (1) Validacao de soma — CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED.
--     Garante que SUM(quantidade_planejada) por tarefa esta dentro de 0.1%
--     de item_orcamentario.quantidade_referencia. DEFERRED permite que
--     callers (edge function) facam DELETE + INSERT em batch numa unica
--     transacao sem violar invariante em estado intermediario.
--
-- (2) Imutabilidade em baseline — espelha fn_planejamento_baseline_imutavel.
--     Bloqueia INSERT/UPDATE/DELETE quando o planejamento da tarefa e baseline.
--     service_role bypassa (a edge function rodando como service_role pode
--     inserir snapshots do baseline payload).

-- ─────────────────────────────────────────────────────────────────────────
-- (1) Validacao de soma
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.fn_ptps_validar_soma()
returns trigger
language plpgsql
as $$
declare
  v_tarefa_id  uuid;
  v_total      numeric;
  v_referencia numeric;
  v_tolerancia numeric;
begin
  v_tarefa_id := coalesce(new.tarefa_id, old.tarefa_id);

  select coalesce(sum(quantidade_planejada), 0)
    into v_total
    from public.planejamento_tarefa_perfil_semana
   where tarefa_id = v_tarefa_id;

  -- Perfil vazio e estado valido (entre DELETE e proximo INSERT da regen).
  -- Soma zero passa; caller decide se essa e config final ou estado temporario.
  if v_total = 0 then
    return null;
  end if;

  select io.quantidade_referencia
    into v_referencia
    from public.planejamento_tarefa pt
    join public.item_orcamentario   io on io.id = pt.item_orcamentario_id
   where pt.id = v_tarefa_id;

  -- Tarefa pode ter sido removida via CASCADE; nao ha o que validar.
  if v_referencia is null then
    return null;
  end if;

  v_tolerancia := greatest(abs(v_referencia) * 0.001, 0.0001);

  if abs(v_total - v_referencia) > v_tolerancia then
    raise exception
      'perfil semanal da tarefa %: soma=% diverge de quantidade_referencia=% alem da tolerancia 0.1%% (delta=%)',
      v_tarefa_id, v_total, v_referencia, v_total - v_referencia
      using errcode = 'check_violation';
  end if;

  return null;
end
$$;

alter function public.fn_ptps_validar_soma() owner to postgres;

-- CONSTRAINT TRIGGER FOR EACH ROW DEFERRABLE INITIALLY DEFERRED:
--   Cada linha modificada agenda o trigger; PG executa todos no commit.
--   A query SUM(...) e indexada (idx_ptps_tarefa) — custo amortizado.
drop trigger if exists trg_ptps_validar_soma on public.planejamento_tarefa_perfil_semana;
create constraint trigger trg_ptps_validar_soma
  after insert or update or delete on public.planejamento_tarefa_perfil_semana
  deferrable initially deferred
  for each row execute function public.fn_ptps_validar_soma();

-- ─────────────────────────────────────────────────────────────────────────
-- (2) Imutabilidade em baseline
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.fn_ptps_baseline_imutavel()
returns trigger
language plpgsql
as $$
declare
  v_tarefa_id uuid;
  v_plan_id   uuid;
  v_is_base   boolean;
begin
  v_tarefa_id := coalesce(new.tarefa_id, old.tarefa_id);

  select planejamento_id into v_plan_id
    from public.planejamento_tarefa where id = v_tarefa_id;

  select is_baseline into v_is_base
    from public.planejamento where id = v_plan_id;

  if coalesce(v_is_base, false) = false then
    return coalesce(new, old);
  end if;

  raise exception 'Perfil semanal de planejamento baseline e imutavel. Crie uma nova revisao para editar.';
end
$$;

alter function public.fn_ptps_baseline_imutavel() owner to postgres;

drop trigger if exists trg_ptps_baseline_imutavel on public.planejamento_tarefa_perfil_semana;
create trigger trg_ptps_baseline_imutavel
  before insert or update or delete on public.planejamento_tarefa_perfil_semana
  for each row execute function public.fn_ptps_baseline_imutavel();
