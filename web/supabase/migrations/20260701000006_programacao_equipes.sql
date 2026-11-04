-- InfraWork Web — Planejamento simplificado: "Programação por equipes".
--
-- A duração de cada tarefa passa a vir da PRODUÇÃO DIÁRIA DAS EQUIPES
-- alocadas (taxa por serviço), com fallback na produção da composição (CPU):
--
--   producao_diaria_efetiva = Σ_equipes coalesce(override, equipe_produtividade, cpu) × qtd_equipes
--
--   equipe.ordem                               ordem das lanes na tela.
--   equipe_produtividade(equipe, servico)      taxa/dia da equipe por serviço do catálogo.
--   planejamento_tarefa_equipe.producao_diaria_override   taxa específica da alocação.
--   planejamento_dependencia.origem            'lane' = cadeia FS gerada pela ordem na lane;
--                                              'manual' = "após X" escolhido pelo usuário.
--
-- Recria também o que a poda derrubou/invalidou: trigger de imutabilidade da
-- baseline (sem colunas de trecho/perfil), RPCs de tarefa indireta (sem
-- trecho) e a view vw_planejamento_tarefa_completa (v12).

-- ─── equipe.ordem ─────────────────────────────────────────────────────────
alter table public.equipe add column if not exists ordem int not null default 0;

-- ─── equipe_produtividade ─────────────────────────────────────────────────
create table if not exists public.equipe_produtividade (
  equipe_id        uuid          not null references public.equipe(id)  on delete cascade,
  servico_id       uuid          not null references public.servico(id) on delete cascade,
  producao_diaria  numeric(14,4) not null,
  unidade          text,
  observacao       text,
  updated_at       timestamptz   not null default now(),
  primary key (equipe_id, servico_id),
  constraint chk_equipe_prod_positiva check (producao_diaria > 0)
);
create index if not exists idx_equipe_prod_servico on public.equipe_produtividade(servico_id);

drop trigger if exists trg_equipe_prod_touch on public.equipe_produtividade;
create trigger trg_equipe_prod_touch
  before update on public.equipe_produtividade
  for each row execute function public.fn_touch_updated_at();

create or replace function public.fn_equipe_prod_mesma_obra()
returns trigger language plpgsql as $$
declare eo uuid; so uuid;
begin
  select obra_id into eo from public.equipe where id = new.equipe_id;
  select obra_id into so from public.servico where id = new.servico_id;
  if eo is null or so is null then raise exception 'equipe ou servico inexistente'; end if;
  if eo <> so then raise exception 'Equipe e serviço devem ser da mesma obra'; end if;
  return new;
end $$;
drop trigger if exists trg_equipe_prod_mesma_obra on public.equipe_produtividade;
create trigger trg_equipe_prod_mesma_obra
  before insert or update of equipe_id, servico_id on public.equipe_produtividade
  for each row execute function public.fn_equipe_prod_mesma_obra();

alter table public.equipe_produtividade enable row level security;

drop policy if exists equipe_prod_god_all on public.equipe_produtividade;
create policy equipe_prod_god_all on public.equipe_produtividade
  for all to authenticated
  using (public.auth_role() = 'god') with check (public.auth_role() = 'god');

drop policy if exists equipe_prod_adm_all on public.equipe_produtividade;
create policy equipe_prod_adm_all on public.equipe_produtividade
  for all to authenticated
  using      (public.auth_role() = 'adm' and public.obra_empresa(public.equipe_obra(equipe_id)) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm' and public.obra_empresa(public.equipe_obra(equipe_id)) = public.auth_empresa_id());

drop policy if exists equipe_prod_eng_all on public.equipe_produtividade;
create policy equipe_prod_eng_all on public.equipe_produtividade
  for all to authenticated
  using      (public.auth_role() = 'engenheiro' and public.has_obra_permissao(public.equipe_obra(equipe_id), auth.uid()))
  with check (public.auth_role() = 'engenheiro' and public.has_obra_permissao(public.equipe_obra(equipe_id), auth.uid()));

drop policy if exists equipe_prod_apoio_select on public.equipe_produtividade;
create policy equipe_prod_apoio_select on public.equipe_produtividade
  for select to authenticated
  using (public.auth_role() = 'apoio' and public.has_obra_permissao(public.equipe_obra(equipe_id), public.auth_engenheiro_id()));

-- ─── alocação: taxa específica ────────────────────────────────────────────
alter table public.planejamento_tarefa_equipe
  add column if not exists producao_diaria_override numeric(14,4);
do $$ begin
  alter table public.planejamento_tarefa_equipe
    add constraint chk_pte_override_positivo
    check (producao_diaria_override is null or producao_diaria_override > 0);
exception when duplicate_object then null; end $$;

-- ─── dependência: origem ──────────────────────────────────────────────────
alter table public.planejamento_dependencia
  add column if not exists origem text not null default 'manual';
do $$ begin
  alter table public.planejamento_dependencia
    add constraint chk_plan_dep_origem check (origem in ('manual', 'lane'));
exception when duplicate_object then null; end $$;
create index if not exists idx_plan_dep_origem on public.planejamento_dependencia(planejamento_id, origem);

-- ─── baseline imutável: lista de colunas sem trecho/perfil ────────────────
drop trigger if exists trg_baseline_imutavel_tarefa on public.planejamento_tarefa;
create trigger trg_baseline_imutavel_tarefa
  before delete or update of
    item_orcamentario_id, data_inicio_manual, notas, ordem,
    tipo_no, parent_id, nivel, quantidade_alocada, codigo_eap, nome_custom,
    schedule_mode, constraint_type, constraint_date
  on public.planejamento_tarefa
  for each row execute function public.fn_planejamento_baseline_imutavel();

-- ─── indiretos: só a equipe "Indireto" (sem trecho) ───────────────────────
drop function if exists public.get_or_create_indireto_resources(uuid);
create function public.get_or_create_indireto_resources(p_obra_id uuid)
returns table (equipe_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_equipe_id uuid;
begin
  select id into v_equipe_id
    from public.equipe
   where obra_id = p_obra_id and is_sistema = true
   limit 1;
  if v_equipe_id is null then
    insert into public.equipe (obra_id, nome, tipo, cor, ativo, is_sistema)
    values (p_obra_id, 'Indireto', 'Geral', '#64748b', true, true)
    returning id into v_equipe_id;
  end if;
  return query select v_equipe_id;
end;
$$;
grant execute on function public.get_or_create_indireto_resources(uuid) to authenticated;

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

  select obra_id into v_obra_id from public.planejamento where id = p_planejamento_id;

  select t.equipe_id into v_equipe_id
    from public.get_or_create_indireto_resources(v_obra_id) t;

  insert into public.planejamento_tarefa (
    planejamento_id, item_orcamentario_id, quantidade_alocada, tipo_no,
    parent_id, nome_custom, ordem, notas, nivel
  ) values (
    p_planejamento_id, p_item_orcamentario_id, 1, 'tarefa',
    p_parent_id, p_nome_custom, coalesce(p_ordem, 0), p_notas, 1
  )
  returning id into v_tarefa_id;

  insert into public.planejamento_tarefa_indireto (
    tarefa_id, custo_periodicidade, custo_unitario, receita_modo, receita_unitaria,
    receita_percentual, offset_dias_antes, offset_dias_depois, receita_extrapola,
    aplica_taxas, taxa_regime_id
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

  insert into public.planejamento_tarefa_equipe (tarefa_id, equipe_id, qtd_equipes)
  values (v_tarefa_id, v_equipe_id, 1)
  on conflict do nothing;

  return v_tarefa_id;
end;
$$;
grant execute on function public.criar_tarefa_indireta(uuid, uuid, jsonb, uuid, text, int, text) to authenticated;

-- ─── vw_planejamento_tarefa_completa v12 ──────────────────────────────────
drop view if exists public.vw_planejamento_tarefa_completa cascade;

create view public.vw_planejamento_tarefa_completa
with (security_invoker = true)
as
select
  t.id                          as id,
  t.planejamento_id             as planejamento_id,
  t.item_orcamentario_id        as item_orcamentario_id,
  t.data_inicio                 as data_inicio,
  t.data_fim                    as data_fim,
  t.duracao_dias_uteis_calc     as duracao_dias_uteis_calc,
  t.data_inicio_manual          as data_inicio_manual,
  t.notas                       as notas,
  t.ordem                       as ordem,
  t.created_at                  as created_at,
  t.updated_at                  as updated_at,
  t.tipo_no                     as tipo_no,
  t.parent_id                   as parent_id,
  t.nivel                       as nivel,
  t.codigo_eap                  as codigo_eap,
  t.nome_custom                 as nome_custom,
  t.quantidade_alocada          as quantidade_alocada,
  t.early_start                 as early_start,
  t.early_finish                as early_finish,
  t.late_start                  as late_start,
  t.late_finish                 as late_finish,
  t.total_float                 as total_float,
  t.free_float                  as free_float,
  t.is_critico                  as is_critico,
  t.schedule_mode               as schedule_mode,
  t.constraint_type             as constraint_type,
  t.constraint_date             as constraint_date,

  p.obra_id                     as obra_id,
  p.is_baseline                 as is_baseline,
  p.status                      as planejamento_status,
  p.data_date                   as planejamento_data_date,

  i.codigo                      as servico_grupo_codigo,
  i.descricao                   as servico_grupo_descricao,
  i.quantidade_referencia       as quantidade_referencia,
  i.servico_id                  as servico_id,
  i.indireto_id                 as indireto_id,
  i.unidade_referencia          as unidade_referencia_item,
  i.custo_unitario_calc         as custo_unitario_item,
  case
    when i.tipo = 'receita' then i.venda_unitaria
    when i.tipo = 'servico_grupo' and i.quantidade_referencia > 0 then
      (i.venda_total_calc / i.quantidade_referencia)::numeric(18,4)
    else null
  end                           as venda_unitaria_item,
  i.venda_total_calc            as venda_total_item,
  s.codigo                      as servico_codigo,
  s.nome                        as servico_nome,
  s.unidade                     as unidade_servico,
  i.cpu_snapshot_id             as cpu_snapshot_id,
  snap.cpu_id_origem            as cpu_id_origem,
  snap.producao_diaria_qtde     as producao_diaria_qtde,
  snap.producao_diaria_unidade  as producao_diaria_unidade,
  snap.custo_unit               as custo_unit_snapshot,

  -- Taxa efetiva da tarefa (equipes × taxa por serviço, fallback CPU)
  coalesce(
    (select sum(coalesce(pte.producao_diaria_override, ep.producao_diaria, snap.producao_diaria_qtde)
                * greatest(1, pte.qtd_equipes))
       from public.planejamento_tarefa_equipe pte
       left join public.equipe_produtividade ep
              on ep.equipe_id = pte.equipe_id and ep.servico_id = i.servico_id
      where pte.tarefa_id = t.id),
    snap.producao_diaria_qtde
  )                             as producao_diaria_efetiva,

  (i.indireto_id is not null)   as is_indireto,
  case
    when i.indireto_id is not null and pti.tarefa_id is not null then
      jsonb_build_object(
        'custo_periodicidade', pti.custo_periodicidade,
        'custo_unitario',      pti.custo_unitario,
        'receita_modo',        pti.receita_modo,
        'receita_unitaria',    pti.receita_unitaria,
        'receita_percentual',  pti.receita_percentual,
        'offset_dias_antes',   pti.offset_dias_antes,
        'offset_dias_depois',  pti.offset_dias_depois,
        'receita_extrapola',   pti.receita_extrapola,
        'aplica_taxas',        pti.aplica_taxas,
        'taxa_regime_id',      pti.taxa_regime_id,
        'periodos_calc',       pti.periodos_calc
      )
    else null
  end                           as indireto_config,

  case
    when i.indireto_id is not null then coalesce(pti.custo_total_calc, 0)::numeric(18,2)
    when snap.custo_unit is not null and t.quantidade_alocada is not null then
      (snap.custo_unit * t.quantidade_alocada)::numeric(18,2)
    else 0::numeric(18,2)
  end                           as custo_total_calc,

  case
    when i.indireto_id is not null then coalesce(pti.receita_total_calc, 0)::numeric(18,2)
    when i.tipo = 'servico_grupo' and i.quantidade_referencia > 0
         and t.quantidade_alocada is not null then
      ((i.venda_total_calc / i.quantidade_referencia) * t.quantidade_alocada)::numeric(18,2)
    when i.tipo = 'receita' and i.venda_unitaria is not null
         and t.quantidade_alocada is not null then
      (i.venda_unitaria * t.quantidade_alocada)::numeric(18,2)
    else 0::numeric(18,2)
  end                           as receita_total_calc,

  case
    when i.indireto_id is not null then pti.custo_taxas_calc
    else null
  end                           as custo_taxas_calc,

  case
    when snap.custo_unit is not null and t.quantidade_alocada is not null
      then (snap.custo_unit * t.quantidade_alocada)::numeric(14, 2)
    else 0::numeric(14, 2)
  end                           as custo_total_tarefa,

  coalesce(
    (select jsonb_agg(jsonb_build_object(
              'id',                       e.id,
              'nome',                     e.nome,
              'cor',                      e.cor,
              'tipo',                     e.tipo,
              'ordem',                    e.ordem,
              'qtd_equipes',              pte.qtd_equipes,
              'producao_diaria_override', pte.producao_diaria_override,
              'producao_diaria_equipe',   ep.producao_diaria,
              'producao_diaria_efetiva',  coalesce(pte.producao_diaria_override, ep.producao_diaria, snap.producao_diaria_qtde)
                                           * greatest(1, pte.qtd_equipes)
            ) order by e.ordem, e.nome)
       from public.planejamento_tarefa_equipe pte
       join public.equipe e on e.id = pte.equipe_id
       left join public.equipe_produtividade ep
              on ep.equipe_id = pte.equipe_id and ep.servico_id = i.servico_id
      where pte.tarefa_id = t.id),
    '[]'::jsonb
  )                             as equipes,
  coalesce(
    (select jsonb_agg(jsonb_build_object(
              'id',              d.id,
              'predecessora_id', d.predecessora_id,
              'tipo',            d.tipo,
              'lag_dias',        d.lag_dias,
              'origem',          d.origem
            ))
       from public.planejamento_dependencia d
      where d.sucessora_id = t.id),
    '[]'::jsonb
  )                             as predecessoras,
  coalesce(
    (select jsonb_agg(jsonb_build_object(
              'id',           d.id,
              'sucessora_id', d.sucessora_id,
              'tipo',         d.tipo,
              'lag_dias',     d.lag_dias,
              'origem',       d.origem
            ))
       from public.planejamento_dependencia d
      where d.predecessora_id = t.id),
    '[]'::jsonb
  )                             as sucessoras,
  coalesce(
    (select jsonb_agg(jsonb_build_object(
              'semana_segunda',       ps.semana_segunda,
              'quantidade_planejada', ps.quantidade_planejada
            ) order by ps.semana_segunda)
       from public.planejamento_tarefa_perfil_semana ps
      where ps.tarefa_id = t.id),
    '[]'::jsonb
  )                             as perfil_semanas
from public.planejamento_tarefa t
join public.planejamento p           on p.id = t.planejamento_id
left join public.item_orcamentario i on i.id = t.item_orcamentario_id
left join public.servico s           on s.id = i.servico_id
left join public.cpu_snapshot snap   on snap.id = i.cpu_snapshot_id
left join public.planejamento_tarefa_indireto pti on pti.tarefa_id = t.id;

grant select on public.vw_planejamento_tarefa_completa to authenticated;
