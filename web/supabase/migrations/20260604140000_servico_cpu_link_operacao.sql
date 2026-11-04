-- ─────────────────────────────────────────────────────────────────────────
-- servico_cpu_link.operacao: 'dividir' (default, atual) | 'multiplicar'
-- ─────────────────────────────────────────────────────────────────────────
-- Contexto: o fator de vínculo às vezes divide o custo (conversão de
-- unidade-CPU pra unidade-servico, ex.: R$/m³ → R$/ton com densidade 2,4
-- → divide por 2,4), e às vezes multiplica (consumo > 1 unidade-CPU por
-- 1 unidade-servico, ex.: 5 km de transporte por unidade → multiplica
-- por 5).
--
-- A semântica agora é explícita por vínculo:
--   - operacao = 'dividir' (default):     custo_link = cpu.custo_unit / fator
--   - operacao = 'multiplicar':           custo_link = cpu.custo_unit * fator

alter table public.servico_cpu_link
  add column if not exists operacao text not null default 'dividir';

do $$ begin
  alter table public.servico_cpu_link
    add constraint chk_servico_cpu_link_operacao
    check (operacao in ('dividir', 'multiplicar'));
exception when duplicate_object then null; end $$;

comment on column public.servico_cpu_link.operacao is
  'Operação aplicada com o fator. "dividir" (default): custo_link = cpu.custo_unit / fator. "multiplicar": custo_link = cpu.custo_unit * fator.';

-- ─── Recria vw_servico_custo_agregado com operacao ───────────────────────
-- A view tem coluna "modo" cujo tipo é deduzido pelo CASE — só aceitar o
-- replace de view direto pode falhar por diferença de tipos. Vou dropar e
-- recriar com a mesma assinatura externa.
drop view if exists public.vw_servico_custo_agregado;

create view public.vw_servico_custo_agregado as
with link_custos as (
  select
    l.servico_id,
    l.cpu_id,
    l.fator,
    l.ordem,
    l.operacao,
    c.custo_unit_calc,
    c.producao_diaria_qtde   as cpu_producao_qtde,
    c.producao_diaria_unidade as cpu_producao_unidade,
    case
      when l.fator is null or l.fator = 0 then null
      when l.operacao = 'multiplicar' then c.custo_unit_calc * l.fator
      else                                  c.custo_unit_calc / l.fator
    end as contribuicao_custo
  from public.servico_cpu_link l
  join public.cpu c on c.id = l.cpu_id
),
agregado as (
  select
    servico_id,
    count(*)                                  as cpus_vinculadas,
    sum(contribuicao_custo)                   as custo_unit_agregado,
    (
      select cpu_producao_qtde
        from link_custos l2
       where l2.servico_id = lc.servico_id
       order by l2.ordem, l2.cpu_id
       limit 1
    ) as primeira_cpu_producao_qtde,
    (
      select cpu_producao_unidade
        from link_custos l2
       where l2.servico_id = lc.servico_id
       order by l2.ordem, l2.cpu_id
       limit 1
    ) as primeira_cpu_producao_unidade
  from link_custos lc
  group by servico_id
)
select
  s.id                              as servico_id,
  s.obra_id                         as obra_id,
  s.codigo                          as codigo,
  s.nome                            as nome,
  s.unidade                         as unidade,
  coalesce(a.cpus_vinculadas, 0)    as cpus_vinculadas,
  a.custo_unit_agregado             as custo_unit_agregado,
  coalesce(s.producao_diaria_qtde, a.primeira_cpu_producao_qtde) as producao_diaria_efetiva,
  coalesce(s.producao_diaria_unidade, a.primeira_cpu_producao_unidade, 'DIA') as producao_diaria_unidade_efetiva,
  case
    when coalesce(a.cpus_vinculadas, 0) > 0 then 'agregador'
    else 'legado'
  end as modo
from public.servico s
left join agregado a on a.servico_id = s.id;

comment on view public.vw_servico_custo_agregado is
  'Custo unitário agregado do servico (= Σ contribuição_custo por vínculo). Cada vínculo respeita servico_cpu_link.operacao ("dividir" ou "multiplicar") aplicada ao fator. Servicos sem vínculos retornam modo=legado e custo_unit_agregado NULL.';
