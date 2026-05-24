-- InfraWork — Planejamento (Fase P1.A): helpers SECURITY DEFINER + triggers
--
-- Helpers (owner=postgres, BYPASSRLS) seguem padrão de Fase 1/2 do Orçamento:
--   equipe_obra(_id), planejamento_obra(_id), tarefa_obra(_id), dependencia_obra(_id)
--   pode_planejar_obra(_obra_id) — encapsula matriz: god | adm | engenheiro | apoio=false
--
-- Triggers:
--   fn_tarefa_so_aceita_servico_grupo — só item.tipo='servico_grupo' vira tarefa
--   fn_calendario_default              — auto-cria obra_calendario ao inserir obra
--   fn_planejamento_baseline_unica     — desmarca outras baselines da obra
--   fn_planejamento_baseline_imutavel  — bloqueia edição em baseline (com whitelist)
--   fn_planejamento_updated_at         — touch trigger
--   cronograma_validar_ciclo()         — RPC chamada pela Edge Function

-- ─────────────────────────────────────────────────────────────────────────
-- Helpers SECURITY DEFINER
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.equipe_obra(_id uuid)
returns uuid
language sql stable security definer
set search_path = public
as $$ select obra_id from public.equipe where id = _id $$;

create or replace function public.planejamento_obra(_id uuid)
returns uuid
language sql stable security definer
set search_path = public
as $$ select obra_id from public.planejamento where id = _id $$;

create or replace function public.tarefa_obra(_id uuid)
returns uuid
language sql stable security definer
set search_path = public
as $$
  select p.obra_id
    from public.planejamento_tarefa t
    join public.planejamento p on p.id = t.planejamento_id
   where t.id = _id
$$;

create or replace function public.dependencia_obra(_id uuid)
returns uuid
language sql stable security definer
set search_path = public
as $$
  select p.obra_id
    from public.planejamento_dependencia d
    join public.planejamento p on p.id = d.planejamento_id
   where d.id = _id
$$;

-- Matriz de permissão: igual ao orçamento (god | adm same-empresa | eng com permissão | apoio nunca)
create or replace function public.pode_planejar_obra(_obra_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select case public.auth_role()
    when 'god'        then true
    when 'adm'        then public.obra_empresa(_obra_id) = public.auth_empresa_id()
    when 'engenheiro' then public.has_obra_permissao(_obra_id, auth.uid())
    else false
  end
$$;

alter function public.equipe_obra(uuid)        owner to postgres;
alter function public.planejamento_obra(uuid)  owner to postgres;
alter function public.tarefa_obra(uuid)        owner to postgres;
alter function public.dependencia_obra(uuid)   owner to postgres;
alter function public.pode_planejar_obra(uuid) owner to postgres;

revoke all on function public.equipe_obra(uuid)        from public;
revoke all on function public.planejamento_obra(uuid)  from public;
revoke all on function public.tarefa_obra(uuid)        from public;
revoke all on function public.dependencia_obra(uuid)   from public;
revoke all on function public.pode_planejar_obra(uuid) from public;

grant execute on function public.equipe_obra(uuid)        to authenticated;
grant execute on function public.planejamento_obra(uuid)  to authenticated;
grant execute on function public.tarefa_obra(uuid)        to authenticated;
grant execute on function public.dependencia_obra(uuid)   to authenticated;
grant execute on function public.pode_planejar_obra(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- Trigger: planejamento_tarefa só aceita item_orcamentario.tipo='servico_grupo'
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.fn_tarefa_so_aceita_servico_grupo()
returns trigger
language plpgsql
as $$
declare
  item_tipo text;
  item_obra uuid;
  plan_obra uuid;
begin
  select tipo, obra_id into item_tipo, item_obra
    from public.item_orcamentario where id = new.item_orcamentario_id;
  if item_tipo is null then
    raise exception 'item_orcamentario % inexistente', new.item_orcamentario_id;
  end if;
  if item_tipo <> 'servico_grupo' then
    raise exception 'Apenas itens do tipo servico_grupo podem virar tarefa (tipo=%)', item_tipo;
  end if;

  select obra_id into plan_obra from public.planejamento where id = new.planejamento_id;
  if plan_obra <> item_obra then
    raise exception 'tarefa: planejamento.obra_id (%) difere de item_orcamentario.obra_id (%)',
      plan_obra, item_obra;
  end if;
  return new;
end
$$;

drop trigger if exists trg_tarefa_so_aceita_servico_grupo on public.planejamento_tarefa;
create trigger trg_tarefa_so_aceita_servico_grupo
  before insert or update of item_orcamentario_id, planejamento_id on public.planejamento_tarefa
  for each row execute function public.fn_tarefa_so_aceita_servico_grupo();

-- ─────────────────────────────────────────────────────────────────────────
-- Trigger: dependência deve ser entre tarefas do MESMO planejamento
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.fn_dep_mesmo_planejamento()
returns trigger
language plpgsql
as $$
declare
  pred_plan uuid;
  suc_plan  uuid;
begin
  select planejamento_id into pred_plan from public.planejamento_tarefa where id = new.predecessora_id;
  select planejamento_id into suc_plan  from public.planejamento_tarefa where id = new.sucessora_id;
  if pred_plan is null or suc_plan is null then
    raise exception 'predecessora/sucessora inexistente';
  end if;
  if pred_plan <> suc_plan then
    raise exception 'dependência só entre tarefas do mesmo planejamento';
  end if;
  if new.planejamento_id is null then
    new.planejamento_id := pred_plan;
  elsif new.planejamento_id <> pred_plan then
    raise exception 'planejamento_id da dependência (%) difere das tarefas (%)',
      new.planejamento_id, pred_plan;
  end if;
  return new;
end
$$;

drop trigger if exists trg_dep_mesmo_planejamento on public.planejamento_dependencia;
create trigger trg_dep_mesmo_planejamento
  before insert or update of predecessora_id, sucessora_id, planejamento_id on public.planejamento_dependencia
  for each row execute function public.fn_dep_mesmo_planejamento();

-- ─────────────────────────────────────────────────────────────────────────
-- Trigger: auto-cria obra_calendario ao inserir obra
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.fn_obra_calendario_default()
returns trigger
language plpgsql
as $$
begin
  insert into public.obra_calendario (obra_id) values (new.id)
    on conflict (obra_id) do nothing;
  return new;
end
$$;

drop trigger if exists trg_obra_calendario_default on public.obras;
create trigger trg_obra_calendario_default
  after insert on public.obras
  for each row execute function public.fn_obra_calendario_default();

-- Backfill calendário das obras existentes
insert into public.obra_calendario (obra_id)
select id from public.obras
on conflict (obra_id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- Trigger: 1 baseline única por obra
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.fn_planejamento_baseline_unica()
returns trigger
language plpgsql
as $$
begin
  if new.is_baseline = true and (old.is_baseline is null or old.is_baseline = false) then
    update public.planejamento
       set is_baseline = false,
           updated_at  = now()
     where obra_id = new.obra_id
       and id <> new.id
       and is_baseline = true;
  end if;
  return new;
end
$$;

drop trigger if exists trg_planejamento_baseline_unica on public.planejamento;
create trigger trg_planejamento_baseline_unica
  before update of is_baseline on public.planejamento
  for each row execute function public.fn_planejamento_baseline_unica();

-- ─────────────────────────────────────────────────────────────────────────
-- Trigger: planejamento baseline imutável (com whitelist de colunas)
-- ─────────────────────────────────────────────────────────────────────────
-- Bloqueia UPDATE/DELETE em tarefa/dependencia/equipe quando o planejamento
-- está marcado como baseline. WHITELIST: data_inicio, data_fim,
-- duracao_dias_uteis_calc — esses 3 podem ser atualizados pela Edge Function
-- de cálculo (rodando como service_role, que bypassa este trigger).
create or replace function public.fn_planejamento_baseline_imutavel()
returns trigger
language plpgsql
as $$
declare
  plan_id    uuid;
  is_base    boolean;
begin
  if tg_op = 'DELETE' then
    if tg_table_name = 'planejamento_tarefa' then
      plan_id := old.planejamento_id;
    elsif tg_table_name = 'planejamento_dependencia' then
      plan_id := old.planejamento_id;
    elsif tg_table_name = 'planejamento_tarefa_equipe' then
      select planejamento_id into plan_id
        from public.planejamento_tarefa where id = old.tarefa_id;
    end if;
  else
    if tg_table_name = 'planejamento_tarefa' then
      plan_id := new.planejamento_id;
    elsif tg_table_name = 'planejamento_dependencia' then
      plan_id := new.planejamento_id;
    elsif tg_table_name = 'planejamento_tarefa_equipe' then
      select planejamento_id into plan_id
        from public.planejamento_tarefa where id = new.tarefa_id;
    end if;
  end if;

  select is_baseline into is_base from public.planejamento where id = plan_id;
  if coalesce(is_base, false) = false then
    return coalesce(new, old);
  end if;
  raise exception 'Planejamento marcado como baseline é imutável. Crie uma nova revisão para editar.';
end
$$;

drop trigger if exists trg_baseline_imutavel_tarefa on public.planejamento_tarefa;
create trigger trg_baseline_imutavel_tarefa
  before delete or update of
    item_orcamentario_id, data_inicio_manual, notas, ordem
  on public.planejamento_tarefa
  for each row execute function public.fn_planejamento_baseline_imutavel();

drop trigger if exists trg_baseline_imutavel_dep on public.planejamento_dependencia;
create trigger trg_baseline_imutavel_dep
  before delete or update on public.planejamento_dependencia
  for each row execute function public.fn_planejamento_baseline_imutavel();

drop trigger if exists trg_baseline_imutavel_equipe on public.planejamento_tarefa_equipe;
create trigger trg_baseline_imutavel_equipe
  before delete or update on public.planejamento_tarefa_equipe
  for each row execute function public.fn_planejamento_baseline_imutavel();

-- ─────────────────────────────────────────────────────────────────────────
-- Trigger genérico: touch updated_at
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.fn_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists trg_planejamento_updated_at on public.planejamento;
create trigger trg_planejamento_updated_at
  before update on public.planejamento
  for each row execute function public.fn_touch_updated_at();

drop trigger if exists trg_plan_tarefa_updated_at on public.planejamento_tarefa;
create trigger trg_plan_tarefa_updated_at
  before update on public.planejamento_tarefa
  for each row execute function public.fn_touch_updated_at();

drop trigger if exists trg_obra_calendario_updated_at on public.obra_calendario;
create trigger trg_obra_calendario_updated_at
  before update on public.obra_calendario
  for each row execute function public.fn_touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- RPC: cronograma_validar_ciclo
-- Detecta ciclos no grafo de dependências de um planejamento via CTE recursiva.
-- Retorna { tem_ciclo: bool, nodes: uuid[] }.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.cronograma_validar_ciclo(_planejamento_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ciclo_nodes uuid[];
begin
  with recursive grafo as (
    select predecessora_id as origem,
           sucessora_id    as destino,
           array[predecessora_id, sucessora_id]::uuid[] as caminho,
           false as tem_ciclo
      from public.planejamento_dependencia
     where planejamento_id = _planejamento_id

    union all

    select g.origem,
           d.sucessora_id,
           g.caminho || d.sucessora_id,
           d.sucessora_id = any(g.caminho)
      from grafo g
      join public.planejamento_dependencia d
        on d.predecessora_id = g.destino
       and d.planejamento_id = _planejamento_id
     where not g.tem_ciclo
       and array_length(g.caminho, 1) < 500
  )
  select caminho into ciclo_nodes
    from grafo
   where tem_ciclo
   limit 1;

  if ciclo_nodes is null then
    return jsonb_build_object('tem_ciclo', false, 'nodes', '[]'::jsonb);
  end if;
  return jsonb_build_object('tem_ciclo', true, 'nodes', to_jsonb(ciclo_nodes));
end
$$;

alter function public.cronograma_validar_ciclo(uuid) owner to postgres;
revoke all on function public.cronograma_validar_ciclo(uuid) from public;
grant execute on function public.cronograma_validar_ciclo(uuid) to authenticated;
