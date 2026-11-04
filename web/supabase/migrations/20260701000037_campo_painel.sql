-- Visão estratégica no app de campo (supervisor = engenheiro; adm e god também): um retrato da obra por RPC,
-- agregado no servidor (o celular guarda o último retrato para ver sem sinal). Apontador, apoio e cliente não veem.
--
-- O valor executado segue a MESMA regra do Valor Agregado do web (features/acompanhamento/lib/valor-agregado-calc.ts,
-- montarComparativoPorServico): produção do dia limitada a 100% do serviço × valor do serviço no contrato atual ao
-- preço do dia (reajuste prospectivo); previsto = planejado do dia × venda da premissa da linha de base × fator de
-- reajuste do dia. A paridade é conferida no e2e (seção 12).

-- ── trava ─────────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.campo_assert_painel(_obra_id uuid)
returns void
language plpgsql
stable security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Sessão expirada'; end if;
  if coalesce(public.auth_role()::text, '') not in ('god', 'adm', 'engenheiro')
     or not public.pode_ver_acompanhamento(_obra_id) then
    raise exception 'Sem acesso à visão estratégica desta obra';
  end if;
end $$;

-- ── valor de um serviço (agrupador) numa data: Σ receitas alocadas × preço da receita no dia ──────────────────────
-- preço no dia = preco_antes do primeiro reajuste APLICADO com data posterior ao dia; sem ele, o preço atual.
create or replace function public.fn_valor_servico_em(_grupo_id uuid, _data date)
returns numeric
language sql
stable security definer
set search_path = public
as $$
  select coalesce(sum(
           coalesce(r.quantidade, 0) * coalesce(a.fracao, 0) *
           coalesce((select ri.preco_antes
                       from public.orcamento_reajuste_item ri
                       join public.orcamento_reajuste rj on rj.id = ri.reajuste_id
                      where ri.receita_id = r.id and rj.status = 'aplicado' and ri.preco_antes is not null
                        and rj.data > _data
                      order by rj.data asc
                      limit 1),
                    r.venda_unitaria, 0)), 0)
    from public.item_orc_alocacao a
    join public.item_orcamentario r on r.id = a.receita_id and r.tipo = 'receita'
   where a.grupo_id = _grupo_id
$$;

-- ── retrato da obra ───────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.campo_painel(_obra_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path = public
as $$
declare
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_ref uuid;
  v_ref_nome text;
  v_ref_vigente boolean;
  v_trava date;
  v_reajuste boolean;
  v jsonb;
begin
  perform public.campo_assert_painel(_obra_id);
  v_ref := public.planejamento_referencia(_obra_id);
  select nome, vigente, travada_em::date into v_ref_nome, v_ref_vigente, v_trava
    from public.planejamento where id = v_ref;
  v_reajuste := exists (select 1 from public.orcamento_reajuste where obra_id = _obra_id and status = 'aplicado');

  with
  pxr as (select * from public.vw_acompanhamento_previsto_x_realizado where obra_id = _obra_id),
  io as (
    select i.id, i.codigo, i.descricao, i.unidade_referencia, i.quantidade_referencia as q, i.venda_total_calc,
           coalesce(i.venda_unitaria, i.venda_total_calc / nullif(i.quantidade_referencia, 0), 0) as venda_u
      from public.item_orcamentario i
     where i.obra_id = _obra_id and i.tipo = 'servico_grupo' and i.indireto_id is null
  ),
  -- venda da premissa da linha de base por serviço (mapaPrecosDiretas do web)
  precos as (
    select distinct on (t.item_orcamentario_id) t.item_orcamentario_id as item_id,
           coalesce(t.venda_unitaria_item, 0) as venda_lb
      from public.vw_planejamento_tarefa_completa t
     where t.planejamento_id = v_ref and not coalesce(t.is_indireto, false) and t.item_orcamentario_id is not null
     order by t.item_orcamentario_id, t.id
  ),
  valor_atual as (select io.id, public.fn_valor_servico_em(io.id, '9999-12-31') as valor from io),
  cs as (
    select c.item_orcamentario_id as item_id, c.data, coalesce(c.planejado_dia, 0) as plan,
           coalesce(c.realizado_dia, 0) as real
      from public.vw_acompanhamento_curva_s c
     where c.obra_id = _obra_id
  ),
  -- produção do dia limitada a 100% do serviço (producaoLimitada do web)
  lim as (
    select c.item_id, c.data, c.real,
           case when coalesce(io.q, 0) > 0
                then greatest(0, least(c.real, io.q - coalesce(sum(c.real) over w, 0)))
                else c.real end as cabe
      from cs c left join io on io.id = c.item_id
     where c.real > 0
    window w as (partition by c.item_id order by c.data rows between unbounded preceding and 1 preceding)
  ),
  exec as (
    select l.item_id,
           sum(l.cabe * (case when v_reajuste then public.fn_valor_servico_em(l.item_id, l.data) else va.valor end) / io.q)
             as total,
           sum(l.cabe * (case when v_reajuste then public.fn_valor_servico_em(l.item_id, l.data) else va.valor end) / io.q)
             filter (where date_trunc('month', l.data) = date_trunc('month', hoje)) as mes
      from lim l
      join io on io.id = l.item_id and io.q > 0
      join precos p on p.item_id = l.item_id
      join valor_atual va on va.id = l.item_id
     where l.data <= hoje
     group by l.item_id
  ),
  excedente as (select item_id, sum(real - cabe) as qtd from lim group by item_id having sum(real - cabe) > 0),
  plan as (
    select c.item_id,
           sum(c.plan * p.venda_lb *
               case when v_trava is null or not v_reajuste then 1
                    else coalesce(public.fn_valor_servico_em(c.item_id, c.data)
                                  / nullif(public.fn_valor_servico_em(c.item_id, v_trava), 0), 1) end) as total
      from cs c join precos p on p.item_id = c.item_id
     where c.data <= hoje and c.plan > 0
     group by c.item_id
  ),
  prod as (
    select p.*, p.quantidade * p.fator_conversao as qtd
      from public.acompanhamento_producao p
     where p.obra_id = _obra_id and p.data >= hoje - 30 and p.data <= hoje
  ),
  dias14 as (select generate_series(hoje - 13, hoje, interval '1 day')::date as d),
  servicos as (
    select jsonb_agg(jsonb_build_object(
             'id', x.item_orcamentario_id,
             'codigo', x.codigo,
             'descricao', x.descricao,
             'unidade', x.unidade,
             'qtd_plan', x.qtd_plan,
             'qtd_real', x.qtd_real,
             'pct_avanco', x.pct_avanco,
             'pct_esperado', x.pct_esperado_hoje,
             'status', x.status,
             'desvio_dias', x.desvio_dias_estimado,
             'inicio', x.data_inicio_plan,
             'fim', x.data_fim_plan,
             'ritmo_plan', x.producao_diaria_plan,
             'media_7d', (select round(sum(qtd) / nullif(count(distinct data), 0), 4)
                            from prod where item_orcamentario_id = x.item_orcamentario_id and data > hoje - 7),
             'dias14', (select jsonb_agg(coalesce((select sum(qtd) from prod
                                                    where item_orcamentario_id = x.item_orcamentario_id
                                                      and data = d14.d), 0) order by d14.d)
                          from dias14 d14),
             'valor_executado', round(coalesce(e.total, 0), 2),
             'valor_previsto', round(coalesce(pl.total, 0), 2),
             'excedente_qtd', ex.qtd
           ) order by x.codigo) as j
      from pxr x
      left join exec e on e.item_id = x.item_orcamentario_id
      left join plan pl on pl.item_id = x.item_orcamentario_id
      left join excedente ex on ex.item_id = x.item_orcamentario_id
  ),
  -- curva física semanal (% ponderado pela venda, como o avanço do dashboard)
  peso as (
    select x.item_orcamentario_id as item_id, io.venda_u as w, coalesce(x.qtd_plan, 0) as qp
      from pxr x join io on io.id = x.item_orcamentario_id
  ),
  semanas as (
    select date_trunc('week', c.data)::date as s,
           sum(c.plan * pe.w) as p,
           sum(c.real * pe.w) as r
      from cs c join peso pe on pe.item_id = c.item_id
     group by 1
  ),
  semanas_acum as (
    select s,
           sum(p) over (order by s) / nullif((select sum(qp * w) from peso), 0) as pa,
           sum(r) over (order by s) / nullif((select sum(qp * w) from peso), 0) as ra
      from semanas
  ),
  curva as (
    select jsonb_agg(jsonb_build_object(
             's', s,
             'p', round(pa, 4),
             'r', case when s <= hoje then round(ra, 4) end
           ) order by s) as j
      from semanas_acum
  ),
  grupos_eq as (
    select coalesce(p.equipe_id::text, '') as k, max(e.nome) as nome,
           bool_or(p.data = hoje) as hoje, bool_or(p.data > hoje - 7) as semana,
           count(distinct p.data) as dias_30d, count(*) filter (where p.data > hoje - 7) as registros_7d,
           max(p.data) as ultimo
      from prod p left join public.equipe e on e.id = p.equipe_id
     group by 1
  ),
  serv_eq as (
    select coalesce(p.equipe_id::text, '') as k, p.item_orcamentario_id as item_id,
           sum(p.qtd) filter (where p.data = hoje) as hoje,
           sum(p.qtd) filter (where p.data > hoje - 7) as d7,
           sum(p.qtd) as d30,
           count(distinct p.data) as dias
      from prod p
     where p.item_orcamentario_id is not null
     group by 1, 2
  ),
  equipes as (
    select jsonb_agg(jsonb_build_object(
             'id', nullif(g.k, ''),
             'nome', coalesce(g.nome, 'Sem equipe'),
             'lancou_hoje', g.hoje,
             'ativa_semana', g.semana,
             'dias_30d', g.dias_30d,
             'registros_7d', g.registros_7d,
             'ultimo', g.ultimo,
             'servicos', (select jsonb_agg(jsonb_build_object(
                                 'id', se.item_id, 'codigo', io.codigo, 'descricao', io.descricao,
                                 'unidade', io.unidade_referencia, 'hoje', se.hoje, 'd7', se.d7, 'd30', se.d30,
                                 'dias', se.dias,
                                 'aderencia', (select pe.pct_aderencia_meta
                                                 from public.vw_acompanhamento_produtividade_equipe pe
                                                where pe.obra_id = _obra_id and pe.equipe_id::text = g.k
                                                  and pe.item_orcamentario_id = se.item_id
                                                limit 1)
                               ) order by se.d30 desc nulls last)
                            from serv_eq se left join io on io.id = se.item_id
                           where se.k = g.k)
           ) order by g.hoje, g.nome) as j
      from grupos_eq g
  ),
  grupos_enc as (
    select coalesce(p.encarregado_id::text, '') as k, max(coalesce(en.apelido, en.nome)) as nome,
           bool_or(p.data = hoje) as hoje, bool_or(p.data > hoje - 7) as semana,
           count(distinct p.data) as dias_30d, count(*) filter (where p.data > hoje - 7) as registros_7d,
           max(p.data) as ultimo
      from prod p left join public.encarregado en on en.id = p.encarregado_id
     group by 1
  ),
  serv_enc as (
    select coalesce(p.encarregado_id::text, '') as k, p.item_orcamentario_id as item_id,
           sum(p.qtd) filter (where p.data = hoje) as hoje,
           sum(p.qtd) filter (where p.data > hoje - 7) as d7,
           sum(p.qtd) as d30,
           count(distinct p.data) as dias
      from prod p
     where p.item_orcamentario_id is not null
     group by 1, 2
  ),
  encarregados as (
    select jsonb_agg(jsonb_build_object(
             'id', nullif(g.k, ''),
             'nome', coalesce(g.nome, 'Sem encarregado'),
             'lancou_hoje', g.hoje,
             'ativa_semana', g.semana,
             'dias_30d', g.dias_30d,
             'registros_7d', g.registros_7d,
             'ultimo', g.ultimo,
             'servicos', (select jsonb_agg(jsonb_build_object(
                                 'id', se.item_id, 'codigo', io.codigo, 'descricao', io.descricao,
                                 'unidade', io.unidade_referencia, 'hoje', se.hoje, 'd7', se.d7, 'd30', se.d30,
                                 'dias', se.dias
                               ) order by se.d30 desc nulls last)
                            from serv_enc se left join io on io.id = se.item_id
                           where se.k = g.k)
           ) order by g.hoje, g.nome) as j
      from grupos_enc g
  ),
  ultimos as (
    select jsonb_agg(u.j order by u.data desc, u.created_at desc) as j
      from (select p.data, p.created_at,
                   jsonb_build_object(
                     'data', p.data, 'codigo', i.codigo, 'descricao', coalesce(i.descricao, p.servico_nome),
                     'qtd', p.qtd, 'unidade', coalesce(i.unidade_referencia, p.unidade),
                     'equipe', e.nome, 'encarregado', coalesce(en.apelido, en.nome),
                     'estacas', nullif(concat_ws(' – ', p.estaca_inicial, p.estaca_final), ''),
                     'origem', p.origem, 'por', pr.nome) as j
              from prod p
              left join public.item_orcamentario i on i.id = p.item_orcamentario_id
              left join public.equipe e on e.id = p.equipe_id
              left join public.encarregado en on en.id = p.encarregado_id
              left join public.profiles pr on pr.id = p.criado_por
             order by p.data desc, p.created_at desc
             limit 30) u
  )
  select jsonb_build_object(
    'obra', (select jsonb_build_object('id', o.id, 'codigo', o.codigo, 'nome', o.nome) from public.obras o where o.id = _obra_id),
    'hoje', hoje,
    'referencia', case when v_ref is null then null
                       else jsonb_build_object('nome', v_ref_nome, 'vigente', v_ref_vigente) end,
    'resumo', jsonb_build_object(
      'avanco', (select round(sum(coalesce(x.qtd_real, 0) * io.venda_u) / nullif(sum(coalesce(x.qtd_plan, 0) * io.venda_u), 0), 4)
                   from pxr x join io on io.id = x.item_orcamentario_id),
      'esperado', (select round(sum(coalesce(x.pct_esperado_hoje, 0) * coalesce(x.qtd_plan, 0) * io.venda_u)
                                / nullif(sum(coalesce(x.qtd_plan, 0) * io.venda_u), 0), 4)
                     from pxr x join io on io.id = x.item_orcamentario_id),
      'registros_hoje', (select count(*) from prod where data = hoje),
      'registros_7d', (select count(*) from prod where data > hoje - 7),
      'registros_30d', (select count(*) from prod),
      'servicos_hoje', (select count(distinct item_orcamentario_id) from prod where data = hoje),
      'servicos_7d', (select count(distinct item_orcamentario_id) from prod where data > hoje - 7),
      'dias_30d', (select count(distinct data) from prod),
      'equipes_hoje', (select count(distinct equipe_id) from prod where data = hoje),
      'equipes_7d', (select count(distinct equipe_id) from prod where data > hoje - 7),
      'ultimo_lancamento', (select max(data) from public.acompanhamento_producao where obra_id = _obra_id)
    ),
    'financeiro', jsonb_build_object(
      'contrato', (select round(coalesce(sum(venda_total_calc), 0), 2) from public.item_orcamentario
                    where obra_id = _obra_id and tipo = 'receita'),
      'servicos', (select round(coalesce(sum(venda_total_calc), 0), 2) from io),
      'executado', (select round(coalesce(sum(total), 0), 2) from exec),
      'executado_mes', (select round(coalesce(sum(mes), 0), 2) from exec),
      'previsto', (select round(coalesce(sum(total), 0), 2) from plan),
      'servicos_alem_contrato', (select count(*) from excedente)
    ),
    'curva', coalesce((select j from curva), '[]'::jsonb),
    'servicos', coalesce((select j from servicos), '[]'::jsonb),
    'equipes', coalesce((select j from equipes), '[]'::jsonb),
    'encarregados', coalesce((select j from encarregados), '[]'::jsonb),
    'ultimos', coalesce((select j from ultimos), '[]'::jsonb)
  ) into v;

  return v || jsonb_build_object('versao', md5(v::text), 'gerado_em', now());
end $$;

-- ── permissões: os preços só saem pelo painel (com a trava) ──────────────────────────────────────────────────────
alter function public.campo_assert_painel(uuid) owner to postgres;
alter function public.fn_valor_servico_em(uuid, date) owner to postgres;
alter function public.campo_painel(uuid) owner to postgres;
revoke all on function public.campo_assert_painel(uuid) from public, anon;
revoke all on function public.fn_valor_servico_em(uuid, date) from public, anon, authenticated;
revoke all on function public.campo_painel(uuid) from public, anon;
grant execute on function public.campo_assert_painel(uuid) to authenticated;
grant execute on function public.campo_painel(uuid) to authenticated;
