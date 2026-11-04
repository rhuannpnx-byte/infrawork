-- InfraWork — Acompanhamento: benchmark histórico de produtividade por serviço.
--
-- RPC que devolve, por serviço (servico.id global do catálogo), a distribuição
-- da PRODUÇÃO DIÁRIA de equipe (sum(qtd*fator_conversao) por obra×equipe×serviço×dia)
-- em TODAS as obras que o caller pode ver, EXCLUINDO a obra atual, com OUTLIERS
-- removidos por IQR (1.5×). Mesma grandeza que a CPU define como produção diária,
-- então comparável com a meta e entre obras (unidade do plano).
--
-- security definer + escopo manual por papel (mesmos helpers das RLS). A view
-- enriquecida tem security_invoker, então cross-obra exige definer com escopo
-- explícito — não vaza obra fora do alcance do caller.

create or replace function public.acompanhamento_perf_historico(
  p_servico_ids uuid[],
  p_obra_atual  uuid
)
returns table (
  servico_id   uuid,
  unidade      text,
  n_amostras   int,
  n_outliers   int,
  p25          numeric,
  p50          numeric,
  p75          numeric,
  media_trim   numeric,
  media_bruta  numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with allowed as (
    -- obras visíveis ao caller, conforme papel, EXCLUINDO a obra atual
    select o.id
      from public.obras o
     where o.id <> p_obra_atual
       and (
            public.auth_role() = 'god'
         or (public.auth_role() = 'adm'
             and public.obra_empresa(o.id) = public.auth_empresa_id())
         or (public.auth_role() = 'engenheiro'
             and public.has_obra_permissao(o.id, auth.uid()))
         or (public.auth_role() = 'apoio'
             and public.has_obra_permissao(o.id, public.auth_engenheiro_id()))
       )
  ),
  amostras as (
    -- 1 amostra = produção de uma equipe num serviço num dia (unidade do plano)
    select sm.servico_id                                    as servico_id,
           coalesce(s.unidade, io.unidade_referencia)       as unidade,
           p.obra_id,
           p.equipe_nome,
           p.data,
           sum(p.qtd * coalesce(sm.fator_conversao, 1))     as qtd_dia
      from public.acompanhamento_producao p
      join allowed a
        on a.id = p.obra_id
      join public.acompanhamento_servico_match sm
        on sm.obra_id = p.obra_id
       and sm.siga_servico_executado_id = p.servico_id
      left join public.servico s            on s.id = sm.servico_id
      left join public.item_orcamentario io on io.id = sm.item_orcamentario_id
     where sm.servico_id = any (p_servico_ids)
       and p.qtd is not null
       and p.qtd > 0
     group by sm.servico_id, coalesce(s.unidade, io.unidade_referencia),
              p.obra_id, p.equipe_nome, p.data
  ),
  bounds as (
    select servico_id,
           percentile_cont(0.25) within group (order by qtd_dia) as q1,
           percentile_cont(0.75) within group (order by qtd_dia) as q3
      from amostras
     group by servico_id
  ),
  marcadas as (
    select a.servico_id,
           a.unidade,
           a.qtd_dia,
           (a.qtd_dia < b.q1 - 1.5 * (b.q3 - b.q1)
            or a.qtd_dia > b.q3 + 1.5 * (b.q3 - b.q1)) as is_outlier
      from amostras a
      join bounds b using (servico_id)
  )
  select servico_id,
         max(unidade)                                                                        as unidade,
         count(*) filter (where not is_outlier)::int                                          as n_amostras,
         count(*) filter (where is_outlier)::int                                              as n_outliers,
         percentile_cont(0.25) within group (order by qtd_dia) filter (where not is_outlier)  as p25,
         percentile_cont(0.50) within group (order by qtd_dia) filter (where not is_outlier)  as p50,
         percentile_cont(0.75) within group (order by qtd_dia) filter (where not is_outlier)  as p75,
         avg(qtd_dia) filter (where not is_outlier)                                           as media_trim,
         avg(qtd_dia)                                                                         as media_bruta
    from marcadas
   group by servico_id;
$$;

alter function public.acompanhamento_perf_historico(uuid[], uuid) owner to postgres;
revoke all on function public.acompanhamento_perf_historico(uuid[], uuid) from public;
grant execute on function public.acompanhamento_perf_historico(uuid[], uuid) to authenticated;

comment on function public.acompanhamento_perf_historico(uuid[], uuid) is
  'Benchmark histórico de produtividade diária por serviço (catálogo global), '
  'cross-obra dentro do escopo do caller, excluindo a obra atual, com outliers '
  'removidos por IQR. Retorna p25/p50/p75, média aparada e bruta, n e n_outliers.';
