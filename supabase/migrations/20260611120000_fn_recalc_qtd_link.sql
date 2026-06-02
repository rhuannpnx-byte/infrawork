-- InfraWork — Função que recalcula `quantidade_alocada` para todas as tarefas
-- com `qtd_link` de um planejamento, baseado no template ativo do trecho de
-- cada uma. Substitui o cálculo JS no edge function `calcular-cronograma`
-- (bloco 4.5), que estava retornando 0 no runtime Deno por motivo ainda não
-- diagnosticado, apesar de simulação Node local + SQL retornarem positivos.
--
-- Mover pro Postgres elimina qualquer ambiguidade de tipos (numeric vem como
-- string em PostgREST e foi confundido em algum ponto) e usa a mesma fórmula
-- testada em diag SQL.
--
-- Fórmula: SUM(valor_célula × interseção / comprimento_segmento) por tarefa,
-- filtrando segmentos onde a tarefa cruza o segmento.

create or replace function public.recalc_qtd_link_tarefas(p_planejamento_id uuid)
returns table (
  tarefa_id uuid,
  qtd_calc numeric
)
language sql
security definer
set search_path = public
as $$
  with task_data as (
    select
      t.id as tid,
      t.trecho_id,
      t.qtd_link,
      t.posicao_inicio_m::numeric as ini,
      t.posicao_fim_m::numeric as fim
    from public.planejamento_tarefa t
    where t.planejamento_id = p_planejamento_id
      and t.tipo_no = 'tarefa'
      and t.qtd_link is not null
      and t.trecho_id is not null
      and t.posicao_inicio_m is not null
      and t.posicao_fim_m is not null
  )
  select
    td.tid as tarefa_id,
    round(
      coalesce(
        sum(
          cel.valor *
          (least(td.fim, s.posicao_fim_m) - greatest(td.ini, s.posicao_inicio_m)) /
          (s.posicao_fim_m - s.posicao_inicio_m)
        ),
        0
      )::numeric,
      4
    ) as qtd_calc
  from task_data td
  -- Pega o template MAIS ANTIGO do trecho (mesma regra do edge)
  inner join lateral (
    select id
    from public.trecho_quantidade_template
    where trecho_id = td.trecho_id
    order by created_at asc
    limit 1
  ) tpl on true
  -- Versão atual desse template
  inner join public.trecho_quantidade_versao v
    on v.template_id = tpl.id and v.is_atual = true
  -- Coluna que bate com o qtd_link (nome da coluna)
  inner join public.trecho_quantidade_coluna c
    on c.versao_id = v.id and c.nome = td.qtd_link
  -- Segmentos da versão
  inner join public.trecho_quantidade_segmento s
    on s.versao_id = v.id
  -- Células do segmento+coluna
  inner join public.trecho_quantidade_celula cel
    on cel.segmento_id = s.id and cel.coluna_id = c.id
  where
    -- Segmento com comprimento positivo
    (s.posicao_fim_m - s.posicao_inicio_m) > 0
    -- Tarefa cruza segmento
    and least(td.fim, s.posicao_fim_m) - greatest(td.ini, s.posicao_inicio_m) > 0
  group by td.tid
$$;

grant execute on function public.recalc_qtd_link_tarefas(uuid) to authenticated, service_role;

comment on function public.recalc_qtd_link_tarefas(uuid) is
  'Retorna (tarefa_id, qtd_calc) pra cada tarefa do planejamento com qtd_link válido. Usada pela edge function calcular-cronograma pra recalcular quantidade_alocada antes do forward pass.';
