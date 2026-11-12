-- 0054 — Leitura mais rápida: curva S calculada só para a obra pedida e regras de acesso das tabelas mais lidas
-- avaliadas uma vez por consulta, não uma vez por linha.
--
-- Medido em produção (obra CO.081): a curva S levava 1,2 s; o banco montava a curva de todas as obras e, para cada
-- serviço × dia, varria a lista inteira de novo. As viagens de 7 dias levavam 0,35 s só para conferir a permissão
-- (1.971 viagens, 0,2 ms cada; sem a regra a mesma leitura leva 1 ms).

-- ── 1. Conjuntos do que o usuário pode acessar (calculados uma vez por consulta) ──────────────────────────────
-- 'equipe' = god, adm da empresa, engenheiro e apoio da obra (sem o cliente): leitura do orçamento e do plano.
create function public.obras_permitidas(_permissao text)
returns setof uuid
language sql stable security definer
set search_path to 'public'
as $$
  select o.id from public.obras o
   where case _permissao
           when 'ver'            then public.pode_ver_obra(o.id)
           when 'equipe'         then public.pode_ver_obra(o.id) and public.auth_role() <> 'cliente'
           when 'acompanhamento' then public.pode_ver_acompanhamento(o.id)
           when 'planejar'       then public.pode_planejar_obra(o.id)
           when 'orcamento'      then public.pode_editar_orcamento(o.id)
           when 'lancar'         then public.pode_lancar_producao(o.id)
           else false
         end
$$;

create function public.planos_permitidos(_permissao text)
returns setof uuid
language sql stable security definer
set search_path to 'public'
as $$
  select p.id from public.planejamento p where p.obra_id in (select public.obras_permitidas(_permissao))
$$;

create function public.tarefas_permitidas(_permissao text)
returns setof uuid
language sql stable security definer
set search_path to 'public'
as $$
  select t.id
    from public.planejamento_tarefa t
    join public.planejamento p on p.id = t.planejamento_id
   where p.obra_id in (select public.obras_permitidas(_permissao))
$$;

-- ── 2. Regras de acesso: mesma regra de antes, escrita sobre os conjuntos ─────────────────────────────────────
-- viagens: a viagem herda a obra da ficha (fn_viagem_antes) e a ficha não muda de obra
alter policy ficha_select on public.viagem_ficha
  using (obra_id in (select public.obras_permitidas('equipe'))
         or ((select public.auth_role()) = 'apontador' and criado_por = (select auth.uid())));
alter policy viagem_select on public.viagem
  using (obra_id in (select public.obras_permitidas('equipe'))
         or ((select public.auth_role()) = 'apontador'
             and ficha_id in (select f.id from public.viagem_ficha f where f.criado_por = (select auth.uid()))));

alter policy acomp_prod_select on public.acompanhamento_producao
  using (obra_id in (select public.obras_permitidas('equipe')));

alter policy perfil_dia_select on public.planejamento_tarefa_perfil_dia
  using (tarefa_id in (select public.tarefas_permitidas('ver')));

-- god/adm/engenheiro gravam, apoio só lê (antes: quatro regras por tabela)
drop policy planejamento_god_all on public.planejamento;
drop policy planejamento_adm_all on public.planejamento;
drop policy planejamento_eng_all on public.planejamento;
drop policy planejamento_apoio_select on public.planejamento;
create policy planejamento_select on public.planejamento for select to authenticated
  using (obra_id in (select public.obras_permitidas('equipe')));
create policy planejamento_write on public.planejamento for all to authenticated
  using (obra_id in (select public.obras_permitidas('planejar')))
  with check (obra_id in (select public.obras_permitidas('planejar')));

drop policy plan_tarefa_god_all on public.planejamento_tarefa;
drop policy plan_tarefa_adm_all on public.planejamento_tarefa;
drop policy plan_tarefa_eng_all on public.planejamento_tarefa;
drop policy plan_tarefa_apoio_select on public.planejamento_tarefa;
create policy plan_tarefa_select on public.planejamento_tarefa for select to authenticated
  using (planejamento_id in (select public.planos_permitidos('equipe')));
create policy plan_tarefa_write on public.planejamento_tarefa for all to authenticated
  using (planejamento_id in (select public.planos_permitidos('planejar')))
  with check (planejamento_id in (select public.planos_permitidos('planejar')));

drop policy ptps_god_all on public.planejamento_tarefa_perfil_semana;
drop policy ptps_adm_all on public.planejamento_tarefa_perfil_semana;
drop policy ptps_eng_all on public.planejamento_tarefa_perfil_semana;
drop policy ptps_apoio_select on public.planejamento_tarefa_perfil_semana;
create policy ptps_select on public.planejamento_tarefa_perfil_semana for select to authenticated
  using (tarefa_id in (select public.tarefas_permitidas('equipe')));
create policy ptps_write on public.planejamento_tarefa_perfil_semana for all to authenticated
  using (tarefa_id in (select public.tarefas_permitidas('planejar')))
  with check (tarefa_id in (select public.tarefas_permitidas('planejar')));

drop policy item_orc_god_all on public.item_orcamentario;
drop policy item_orc_adm_all on public.item_orcamentario;
drop policy item_orc_eng_all on public.item_orcamentario;
drop policy item_orc_apoio_select on public.item_orcamentario;
create policy item_orc_select on public.item_orcamentario for select to authenticated
  using (obra_id in (select public.obras_permitidas('equipe')));
create policy item_orc_write on public.item_orcamentario for all to authenticated
  using (obra_id in (select public.obras_permitidas('orcamento')))
  with check (obra_id in (select public.obras_permitidas('orcamento')));

-- ── 3. Curva S: planejado e realizado somados num só agrupamento; o filtro da obra chega às tabelas ──────────
create or replace view public.vw_acompanhamento_curva_s with (security_invoker = true) as
WITH baseline_meta AS (
         SELECT pl.obra_id,
            pt.item_orcamentario_id AS item_id,
            io.codigo,
            io.descricao,
            sum(pt.quantidade_alocada)::numeric(14,4) AS qtd_plan
           FROM public.planejamento pl
             JOIN public.planejamento_tarefa pt ON pt.planejamento_id = pl.id
             JOIN public.item_orcamentario io ON io.id = pt.item_orcamentario_id
          WHERE pl.id = public.planejamento_referencia(pl.obra_id) AND pt.quantidade_alocada IS NOT NULL
          GROUP BY pl.obra_id, pt.item_orcamentario_id, io.codigo, io.descricao
        ), dia AS (
         SELECT pl.obra_id,
            pt.item_orcamentario_id AS item_id,
            pd.dia AS data,
            CASE WHEN pt.item_orcamentario_id IS NULL THEN 0::numeric ELSE pd.quantidade END AS planejado,
            0::numeric AS realizado
           FROM public.planejamento pl
             JOIN public.planejamento_tarefa pt ON pt.planejamento_id = pl.id
             JOIN public.planejamento_tarefa_perfil_dia pd ON pd.tarefa_id = pt.id
          WHERE pl.id = public.planejamento_referencia(pl.obra_id)
        UNION ALL
         SELECT pl.obra_id,
            pt.item_orcamentario_id,
            (ps.semana_segunda + ((i.i || ' days'::text)::interval))::date,
            CASE WHEN pt.item_orcamentario_id IS NULL THEN 0::numeric ELSE ps.quantidade_planejada / 5.0 END,
            0::numeric
           FROM public.planejamento pl
             JOIN public.planejamento_tarefa pt ON pt.planejamento_id = pl.id
             JOIN public.planejamento_tarefa_perfil_semana ps ON ps.tarefa_id = pt.id
             CROSS JOIN generate_series(0, 4) i(i)
          WHERE pl.id = public.planejamento_referencia(pl.obra_id) AND NOT (EXISTS ( SELECT 1
                   FROM public.planejamento_tarefa_perfil_dia x
                  WHERE x.tarefa_id = pt.id))
        UNION ALL
         SELECT p.obra_id,
            p.item_orcamentario_id,
            p.data,
            0::numeric,
            COALESCE(sum(p.quantidade * p.fator_conversao), 0::numeric)
           FROM public.acompanhamento_producao p
          WHERE p.item_orcamentario_id IS NOT NULL
          GROUP BY p.obra_id, p.item_orcamentario_id, p.data
        ), agregado AS (
         SELECT dia.obra_id,
            dia.item_id,
            dia.data,
            COALESCE(sum(dia.planejado), 0::numeric) AS planejado_dia,
            COALESCE(sum(dia.realizado), 0::numeric) AS realizado_dia
           FROM dia
          GROUP BY dia.obra_id, dia.item_id, dia.data
        )
 SELECT a.obra_id,
    a.item_id AS item_orcamentario_id,
    bm.codigo AS servico_grupo_codigo,
    bm.descricao AS servico_grupo_descricao,
    a.data,
    a.planejado_dia,
    sum(a.planejado_dia) OVER (PARTITION BY a.obra_id, a.item_id ORDER BY a.data) AS planejado_acumulado,
    a.realizado_dia,
    sum(a.realizado_dia) OVER (PARTITION BY a.obra_id, a.item_id ORDER BY a.data) AS realizado_acumulado,
    bm.qtd_plan AS qtd_planejada_total
   FROM agregado a
     LEFT JOIN baseline_meta bm ON bm.obra_id = a.obra_id AND bm.item_id = a.item_id;

-- ── 4. Quanto de cada serviço já está nos trechos da obra, numa chamada (a tela de Locais fazia uma por serviço) ─
create function public.trechos_servico_totais(_obra_id uuid)
returns table (item_orcamentario_id uuid, total numeric)
language sql stable security definer
set search_path to 'public'
as $$
  select c.item_orcamentario_id, coalesce(sum(ce.valor), 0)
    from public.obra_trecho t
    join public.trecho_quantidade_coluna c on c.versao_id = public.trecho_versao_atual(t.id)
    join public.trecho_quantidade_celula ce on ce.coluna_id = c.id
   where t.obra_id = _obra_id and public.chamada_autorizada(_obra_id, 'ver')
   group by c.item_orcamentario_id
$$;
