-- InfraWork — Planejamento: RPC criar_tarefa_indireta.
--
-- INSERT atômico em planejamento_tarefa + planejamento_tarefa_indireto.
-- Não dá pra fazer via 2 chamadas client-side (PostgREST = 2 transações), e a
-- view v10 exige que ambas existam pra um item ser is_indireto coerente.
--
-- Retorna o id da tarefa criada. Erros: PostgREST repassa exception SQL com
-- detalhe (UI mostra via `detalhe` no error body).
--
-- Permissão: SECURITY INVOKER — caller precisa de write em planejamento_tarefa
-- (RLS já garante isso via obra_permissoes).

create or replace function public.criar_tarefa_indireta(
  p_planejamento_id   uuid,
  p_item_orcamentario_id uuid,
  p_indireto_config   jsonb,
  p_parent_id         uuid    default null,
  p_nome_custom       text    default null,
  p_ordem             int     default 0,
  p_notas             text    default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tarefa_id uuid;
  v_indireto_id uuid;
begin
  -- Valida que o item realmente é indireto
  select indireto_id into v_indireto_id
  from public.item_orcamentario
  where id = p_item_orcamentario_id;
  if v_indireto_id is null then
    raise exception 'Item % não é indireto (não tem indireto_id)', p_item_orcamentario_id
      using errcode = '22023';
  end if;

  -- Valida config obrigatória
  if p_indireto_config is null
     or p_indireto_config->>'custo_periodicidade' is null
     or p_indireto_config->>'custo_unitario' is null
     or p_indireto_config->>'receita_modo' is null then
    raise exception 'indireto_config deve conter custo_periodicidade, custo_unitario e receita_modo'
      using errcode = '22023';
  end if;

  -- 1) INSERT na tarefa (tipo_no='tarefa', sem quantidade_alocada — indireta
  --    é dimensionada por período, não por quantidade física).
  insert into public.planejamento_tarefa (
    planejamento_id,
    item_orcamentario_id,
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
    'tarefa',
    p_parent_id,
    p_nome_custom,
    coalesce(p_ordem, 0),
    p_notas,
    1,  -- raiz; nivel real recalcula via trigger fn_planejamento_tarefa_nivel_calc se houver
    'uniforme'
  )
  returning id into v_tarefa_id;

  -- 2) INSERT na config indireta
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
    (p_indireto_config->>'custo_unitario')::numeric,
    p_indireto_config->>'receita_modo',
    nullif(p_indireto_config->>'receita_unitaria','')::numeric,
    nullif(p_indireto_config->>'receita_percentual','')::numeric,
    coalesce((p_indireto_config->>'offset_dias_antes')::int, 0),
    coalesce((p_indireto_config->>'offset_dias_depois')::int, 0),
    coalesce((p_indireto_config->>'receita_extrapola')::boolean, true),
    coalesce((p_indireto_config->>'aplica_taxas')::boolean, false),
    nullif(p_indireto_config->>'taxa_regime_id','')::uuid
  );

  return v_tarefa_id;
end;
$$;

grant execute on function public.criar_tarefa_indireta(uuid, uuid, jsonb, uuid, text, int, text) to authenticated;

comment on function public.criar_tarefa_indireta(uuid, uuid, jsonb, uuid, text, int, text) is
  'Cria atômicamente uma tarefa + planejamento_tarefa_indireto. Item orçamentário deve ter indireto_id. Retorna o tarefa_id.';

-- Função análoga pra ATUALIZAR a config indireta (idempotente).
create or replace function public.atualizar_tarefa_indireta(
  p_tarefa_id       uuid,
  p_indireto_config jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_indireto_config is null then
    raise exception 'indireto_config nulo' using errcode = '22023';
  end if;

  update public.planejamento_tarefa_indireto set
    custo_periodicidade = coalesce(p_indireto_config->>'custo_periodicidade', custo_periodicidade),
    custo_unitario      = coalesce(nullif(p_indireto_config->>'custo_unitario','')::numeric, custo_unitario),
    receita_modo        = coalesce(p_indireto_config->>'receita_modo', receita_modo),
    receita_unitaria    = case
                            when p_indireto_config ? 'receita_unitaria'
                              then nullif(p_indireto_config->>'receita_unitaria','')::numeric
                            else receita_unitaria
                          end,
    receita_percentual  = case
                            when p_indireto_config ? 'receita_percentual'
                              then nullif(p_indireto_config->>'receita_percentual','')::numeric
                            else receita_percentual
                          end,
    offset_dias_antes   = coalesce((p_indireto_config->>'offset_dias_antes')::int, offset_dias_antes),
    offset_dias_depois  = coalesce((p_indireto_config->>'offset_dias_depois')::int, offset_dias_depois),
    receita_extrapola   = coalesce((p_indireto_config->>'receita_extrapola')::boolean, receita_extrapola),
    aplica_taxas        = coalesce((p_indireto_config->>'aplica_taxas')::boolean, aplica_taxas),
    taxa_regime_id      = case
                            when p_indireto_config ? 'taxa_regime_id'
                              then nullif(p_indireto_config->>'taxa_regime_id','')::uuid
                            else taxa_regime_id
                          end
  where tarefa_id = p_tarefa_id;
end;
$$;

grant execute on function public.atualizar_tarefa_indireta(uuid, jsonb) to authenticated;

comment on function public.atualizar_tarefa_indireta(uuid, jsonb) is
  'Atualiza config de tarefa indireta. Aceita patch parcial (campos ausentes mantêm valor atual).';
