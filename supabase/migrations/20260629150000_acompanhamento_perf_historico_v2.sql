-- InfraWork — Acompanhamento: benchmark histórico v2.
--
-- v1 chaveava por servico.id (catálogo), mas servico é PER-OBRA (tem obra_id),
-- então o id nunca casa entre obras → retornava sempre vazio. A identidade
-- estável entre obras é o servico_executado do SIGA (acompanhamento_producao.
-- servico_id, bigint), igual em todos os projetos do ERP. Re-chaveamos por ele.
--
-- Recebe os IDs SIGA do serviço selecionado (geralmente 1) e devolve UMA
-- distribuição combinada: produção diária de equipe (qtd*fator_conversao) em
-- todas as obras que o caller pode ver, EXCLUINDO a obra atual, sem outliers
-- (IQR 1.5×). Mesma grandeza/unidade do que a página mostra (qtd_convertida).

drop function if exists public.acompanhamento_perf_historico(uuid[], uuid);

create or replace function public.acompanhamento_perf_historico(
  p_siga_servico_ids bigint[],
  p_obra_atual       uuid
)
returns table (
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
    -- 1 amostra = produção de uma equipe nesse serviço (SIGA) num dia
    select p.obra_id, p.equipe_nome, p.data,
           sum(p.qtd * coalesce(sm.fator_conversao, 1)) as qtd_dia
      from public.acompanhamento_producao p
      join allowed a on a.id = p.obra_id
      left join public.acompanhamento_servico_match sm
        on sm.obra_id = p.obra_id
       and sm.siga_servico_executado_id = p.servico_id
     where p.servico_id = any (p_siga_servico_ids)
       and p.qtd is not null
       and p.qtd > 0
     group by p.obra_id, p.equipe_nome, p.data
  ),
  bounds as (
    select percentile_cont(0.25) within group (order by qtd_dia) as q1,
           percentile_cont(0.75) within group (order by qtd_dia) as q3
      from amostras
  ),
  marcadas as (
    select a.qtd_dia,
           (a.qtd_dia < b.q1 - 1.5 * (b.q3 - b.q1)
            or a.qtd_dia > b.q3 + 1.5 * (b.q3 - b.q1)) as is_outlier
      from amostras a
      cross join bounds b
  )
  select count(*) filter (where not is_outlier)::int                                          as n_amostras,
         count(*) filter (where is_outlier)::int                                              as n_outliers,
         percentile_cont(0.25) within group (order by qtd_dia) filter (where not is_outlier)  as p25,
         percentile_cont(0.50) within group (order by qtd_dia) filter (where not is_outlier)  as p50,
         percentile_cont(0.75) within group (order by qtd_dia) filter (where not is_outlier)  as p75,
         avg(qtd_dia) filter (where not is_outlier)                                           as media_trim,
         avg(qtd_dia)                                                                         as media_bruta
    from marcadas;
$$;

alter function public.acompanhamento_perf_historico(bigint[], uuid) owner to postgres;
revoke all on function public.acompanhamento_perf_historico(bigint[], uuid) from public;
grant execute on function public.acompanhamento_perf_historico(bigint[], uuid) to authenticated;

comment on function public.acompanhamento_perf_historico(bigint[], uuid) is
  'Benchmark histórico de produtividade diária de equipe, chaveado pelo serviço '
  'executado do SIGA (global entre obras), no escopo do caller, excluindo a obra '
  'atual, com outliers removidos por IQR. Uma distribuição combinada.';
