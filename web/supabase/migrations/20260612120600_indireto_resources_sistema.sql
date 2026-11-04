-- InfraWork — Planejamento: trecho + equipe "Indireto" exclusivos por obra.
--
-- Tarefa indireta precisa de trecho + equipe pra renderizar no Gantt, mas
-- conceitualmente NÃO ocupa nenhum dos dois (cobre cronograma, sem recurso).
-- Solução: criar trecho "Indireto" e equipe "Indireto" auto por obra, marcadas
-- com `is_sistema=true` pra ficarem ocultas em selects normais (UI filtra).
--
-- Flag is_sistema permite que essas linhas existam no DB mas não poluam
-- listagens de trechos/equipes em modais de criação de tarefas diretas,
-- alocação de equipes manuais, etc.

-- ─── 1. Coluna is_sistema ────────────────────────────────────────────────

alter table public.obra_trecho
  add column if not exists is_sistema boolean not null default false;

alter table public.equipe
  add column if not exists is_sistema boolean not null default false;

create index if not exists idx_obra_trecho_is_sistema on public.obra_trecho(obra_id) where is_sistema;
create index if not exists idx_equipe_is_sistema on public.equipe(obra_id) where is_sistema;

-- ─── 2. Função get_or_create_indireto_resources ──────────────────────────
-- Idempotente. Retorna ids do trecho + equipe "Indireto" da obra, criando
-- se ainda não existirem.

create or replace function public.get_or_create_indireto_resources(p_obra_id uuid)
returns table (trecho_id uuid, equipe_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_trecho_id uuid;
  v_equipe_id uuid;
  v_max_ordem int;
begin
  -- Trecho "Indireto"
  select id into v_trecho_id
  from public.obra_trecho
  where obra_id = p_obra_id and is_sistema = true
  limit 1;

  if v_trecho_id is null then
    select coalesce(max(ordem), 0) + 1 into v_max_ordem
    from public.obra_trecho where obra_id = p_obra_id;
    insert into public.obra_trecho (obra_id, nome, ordem, is_sistema, cor)
    values (p_obra_id, 'Indireto', v_max_ordem, true, '#64748b')
    returning id into v_trecho_id;
  end if;

  -- Equipe "Indireto"
  select id into v_equipe_id
  from public.equipe
  where obra_id = p_obra_id and is_sistema = true
  limit 1;

  if v_equipe_id is null then
    insert into public.equipe (obra_id, nome, tipo, cor, ativo, is_sistema)
    values (p_obra_id, 'Indireto', 'Geral', '#64748b', true, true)
    returning id into v_equipe_id;
  end if;

  return query select v_trecho_id, v_equipe_id;
end;
$$;

grant execute on function public.get_or_create_indireto_resources(uuid) to authenticated;

-- ─── 3. RPC criar_tarefa_indireta usa esses recursos + atribui equipe ────

create or replace function public.criar_tarefa_indireta(
  p_planejamento_id      uuid,
  p_item_orcamentario_id uuid,
  p_indireto_config      jsonb,
  p_parent_id            uuid    default null,
  p_nome_custom          text    default null,
  p_ordem                int     default 0,
  p_notas                text    default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tarefa_id    uuid;
  v_indireto_id  uuid;
  v_obra_id      uuid;
  v_trecho_id    uuid;
  v_equipe_id    uuid;
begin
  select indireto_id into v_indireto_id
  from public.item_orcamentario
  where id = p_item_orcamentario_id;
  if v_indireto_id is null then
    raise exception 'Item % não é indireto (não tem indireto_id)', p_item_orcamentario_id
      using errcode = '22023';
  end if;

  if p_indireto_config is null
     or p_indireto_config->>'custo_periodicidade' is null
     or p_indireto_config->>'receita_modo' is null then
    raise exception 'indireto_config deve conter custo_periodicidade e receita_modo'
      using errcode = '22023';
  end if;

  select obra_id into v_obra_id
  from public.planejamento where id = p_planejamento_id;

  -- Garante trecho + equipe sistema da obra
  select t.trecho_id, t.equipe_id
    into v_trecho_id, v_equipe_id
    from public.get_or_create_indireto_resources(v_obra_id) t;

  insert into public.planejamento_tarefa (
    planejamento_id,
    item_orcamentario_id,
    trecho_id,
    quantidade_alocada,
    tipo_no,
    parent_id,
    nome_custom,
    ordem,
    notas,
    nivel,
    perfil_default
  ) values (
    p_planejamento_id,
    p_item_orcamentario_id,
    v_trecho_id,
    1,
    'tarefa',
    p_parent_id,
    p_nome_custom,
    coalesce(p_ordem, 0),
    p_notas,
    1,
    'uniforme'
  )
  returning id into v_tarefa_id;

  insert into public.planejamento_tarefa_indireto (
    tarefa_id,
    custo_periodicidade,
    custo_unitario,
    receita_modo,
    receita_unitaria,
    receita_percentual,
    offset_dias_antes,
    offset_dias_depois,
    receita_extrapola,
    aplica_taxas,
    taxa_regime_id
  ) values (
    v_tarefa_id,
    p_indireto_config->>'custo_periodicidade',
    nullif(p_indireto_config->>'custo_unitario','')::numeric,
    p_indireto_config->>'receita_modo',
    nullif(p_indireto_config->>'receita_unitaria','')::numeric,
    nullif(p_indireto_config->>'receita_percentual','')::numeric,
    coalesce((p_indireto_config->>'offset_dias_antes')::int, 0),
    coalesce((p_indireto_config->>'offset_dias_depois')::int, 0),
    coalesce((p_indireto_config->>'receita_extrapola')::boolean, true),
    coalesce((p_indireto_config->>'aplica_taxas')::boolean, false),
    nullif(p_indireto_config->>'taxa_regime_id','')::uuid
  );

  -- Atribui equipe sistema com qtd_equipes=1
  insert into public.planejamento_tarefa_equipe (tarefa_id, equipe_id, qtd_equipes)
  values (v_tarefa_id, v_equipe_id, 1)
  on conflict do nothing;

  return v_tarefa_id;
end;
$$;
