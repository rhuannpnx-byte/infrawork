-- 0053 — Fecha o acesso sem login ao esquema public e confere a permissão nas funções SECURITY DEFINER que o
-- usuário chama direto.
--
-- Até aqui 94 funções eram executáveis pelo papel anon (basta a chave pública do site) e 38 delas não conferiam
-- permissão: snapshot_orcamento_atual devolvia o orçamento inteiro e importar_orcamento o substituía, para quem
-- soubesse o id da obra. As tabelas já estavam protegidas por RLS.

-- ── 1. Sem login não há acesso a nada do public; objetos novos já nascem assim ───────────────────────────────
revoke execute on all routines in schema public from public, anon;
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

alter default privileges for role postgres in schema public revoke execute on functions from anon;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres revoke execute on functions from public;

-- ── 2. Políticas que valiam para qualquer papel passam a valer só para quem está logado ──────────────────────
alter policy acomp_foto_select_proprio on public.acompanhamento_foto to authenticated;
alter policy calendario_select on public.calendario to authenticated;
alter policy calendario_write on public.calendario to authenticated;
alter policy caldef_select on public.calendario_definicao to authenticated;
alter policy caldef_write on public.calendario_definicao to authenticated;
alter policy item_orc_aloc_adm_all on public.item_orc_alocacao to authenticated;
alter policy item_orc_aloc_apoio_select on public.item_orc_alocacao to authenticated;
alter policy item_orc_aloc_eng_all on public.item_orc_alocacao to authenticated;
alter policy item_orc_aloc_god_all on public.item_orc_alocacao to authenticated;
alter policy obra_perm_eng_select_suas_obras on public.obra_permissoes to authenticated;
alter policy obra_trecho_select on public.obra_trecho to authenticated;
alter policy obra_trecho_write on public.obra_trecho to authenticated;
alter policy orcamento_aditivo_select on public.orcamento_aditivo to authenticated;
alter policy orcamento_aditivo_write on public.orcamento_aditivo to authenticated;
alter policy orcamento_aditivo_item_select on public.orcamento_aditivo_item to authenticated;
alter policy orcamento_aditivo_item_write on public.orcamento_aditivo_item to authenticated;
alter policy orcamento_planilha_inicial_select on public.orcamento_planilha_inicial to authenticated;
alter policy orcamento_reajuste_select on public.orcamento_reajuste to authenticated;
alter policy orcamento_reajuste_write on public.orcamento_reajuste to authenticated;
alter policy orcamento_reajuste_grupo_select on public.orcamento_reajuste_grupo to authenticated;
alter policy orcamento_reajuste_grupo_write on public.orcamento_reajuste_grupo to authenticated;
alter policy orcamento_reajuste_item_select on public.orcamento_reajuste_item to authenticated;
alter policy orcamento_reajuste_item_write on public.orcamento_reajuste_item to authenticated;
alter policy lb_premissa_select on public.planejamento_lb_premissa to authenticated;
alter policy marco_select on public.planejamento_marco to authenticated;
alter policy marco_write on public.planejamento_marco to authenticated;
alter policy limite_select on public.planejamento_recurso_limite to authenticated;
alter policy limite_write on public.planejamento_recurso_limite to authenticated;
alter policy local_select on public.planejamento_tarefa_local to authenticated;
alter policy local_write on public.planejamento_tarefa_local to authenticated;
alter policy perfil_dia_select on public.planejamento_tarefa_perfil_dia to authenticated;
alter policy wp_select on public.planejamento_tarefa_wp to authenticated;
alter policy servdep_select on public.servico_dependencia to authenticated;
alter policy servdep_write on public.servico_dependencia to authenticated;
alter policy tqce_select on public.trecho_quantidade_celula to authenticated;
alter policy tqco_select on public.trecho_quantidade_coluna to authenticated;
alter policy tqm_select on public.trecho_quantidade_mapeamento to authenticated;
alter policy tqm_write on public.trecho_quantidade_mapeamento to authenticated;
alter policy tqs_select on public.trecho_quantidade_segmento to authenticated;
alter policy tqt_select on public.trecho_quantidade_template to authenticated;
alter policy tqv_select on public.trecho_quantidade_versao to authenticated;
alter policy acomp_fotos_storage_select_dono on storage.objects to authenticated;

-- ── 3. Auxiliares de permissão devolvem false, nunca NULL ("if not pode_x(...)" deixava NULL passar) ─────────
CREATE OR REPLACE FUNCTION public.pode_ver_obra(_obra_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  select coalesce((
    public.auth_role() = 'god'
        or (public.auth_role() = 'adm' and public.obra_empresa(_obra_id) = public.auth_empresa_id())
        or (public.auth_role() in ('engenheiro', 'cliente') and public.has_obra_permissao(_obra_id, auth.uid()))
        or (public.auth_role() = 'apoio' and public.has_obra_permissao(_obra_id, public.auth_engenheiro_id()))
  ), false)
$$;

CREATE OR REPLACE FUNCTION public.pode_editar_orcamento(_obra_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  select coalesce((
    case public.auth_role()
      when 'god'        then true
      when 'adm'        then public.obra_empresa(_obra_id) = public.auth_empresa_id()
      when 'engenheiro' then public.has_obra_permissao(_obra_id, auth.uid())
      else false
    end
  ), false)
$$;

CREATE OR REPLACE FUNCTION public.pode_planejar_obra(_obra_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  select coalesce((
    case public.auth_role()
      when 'god'        then true
      when 'adm'        then public.obra_empresa(_obra_id) = public.auth_empresa_id()
      when 'engenheiro' then public.has_obra_permissao(_obra_id, auth.uid())
      else false
    end
  ), false)
$$;

CREATE OR REPLACE FUNCTION public.pode_lancar_producao(_obra_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  select coalesce((
    case public.auth_role()
      when 'god'        then true
      when 'adm'        then public.obra_empresa(_obra_id) = public.auth_empresa_id()
      when 'engenheiro' then public.has_obra_permissao(_obra_id, auth.uid())
      when 'apoio'      then public.has_obra_permissao(_obra_id, public.auth_engenheiro_id())
      when 'apontador'  then public.has_obra_permissao(_obra_id, auth.uid())
      else false
    end
  ), false)
$$;

CREATE OR REPLACE FUNCTION public.pode_ver_acompanhamento(_obra_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  select coalesce((
    case public.auth_role()
      when 'god'        then true
      when 'adm'        then public.obra_empresa(_obra_id) = public.auth_empresa_id()
      when 'engenheiro' then public.has_obra_permissao(_obra_id, auth.uid())
      when 'apoio'      then public.has_obra_permissao(_obra_id, public.auth_engenheiro_id())
      when 'cliente'    then public.has_obra_permissao(_obra_id, auth.uid())
      else false
    end
  ), false)
$$;

-- ── 4. Checagem de permissão nas funções que o usuário alcança ───────────────────────────────────────────────
-- Passa sem conferir quando a chamada vem de gatilho (a escrita que o disparou já passou pela RLS) ou do serviço
-- (Edge Function com a service key, pg_cron). 'ver' = equipe interna da obra (sem o cliente).
create function public.chamada_autorizada(_obra_id uuid, _permissao text)
returns boolean
language sql stable
set search_path to 'public'
as $$
  select pg_trigger_depth() > 0
      or coalesce(auth.role(), '') not in ('anon', 'authenticated')
      or coalesce(case _permissao
           when 'ver'       then public.pode_ver_obra(_obra_id) and public.auth_role() <> 'cliente'
           when 'orcamento' then public.pode_editar_orcamento(_obra_id)
           when 'planejar'  then public.pode_planejar_obra(_obra_id)
         end, false)
$$;
revoke execute on function public.chamada_autorizada(uuid, text) from authenticated;

CREATE OR REPLACE FUNCTION public.recalcular_orcamento(_obra_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  obra_aliquota   numeric(7,4);
  max_nivel       smallint;
  lvl             smallint;
  itens_total     int;
  custo_total     numeric(14,2);
  venda_total     numeric(14,2);
  lucr_global     numeric(7,4);
  inicio_ms       bigint;
begin
  if not public.chamada_autorizada(_obra_id, 'orcamento') then
    raise exception 'Sem permissão para recalcular o orçamento desta obra' using errcode = '42501';
  end if;
  inicio_ms := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  perform pg_advisory_xact_lock(hashtext('orc:' || _obra_id::text));
  -- as escritas do próprio recálculo não marcam a obra de novo
  perform set_config('infrawork.recalc_em_curso', '1', true);

  -- impostos = taxa vigente cadastrada em Taxas (mesma regra de vw_orcamento_consolidado)
  select coalesce(total_perc_calc, 0)
    into obra_aliquota
    from public.encargos_sociais_regime
   where obra_id = _obra_id
     and ativo = true
     and (vigencia_inicio is null or vigencia_inicio <= current_date)
     and (vigencia_fim    is null or vigencia_fim    >= current_date)
   order by vigencia_inicio desc nulls last
   limit 1;
  obra_aliquota := coalesce(obra_aliquota, 0);

  -- 1) receitas: venda da linha
  update public.item_orcamentario
     set updated_at = now()
   where obra_id = _obra_id and tipo = 'receita';

  -- 2) frações do rateio
  perform public.fn_item_orc_aloc_recalcular(_obra_id);

  -- 3) serviços: quantidade (não-manual) e venda rateada; o trigger refaz o custo
  update public.item_orcamentario g
     set qtd_ref_modo = case
           when g.qtd_ref_modo = 'manual' then 'manual'
           when (select count(*) from public.item_orc_alocacao a
                  where a.grupo_id = g.id and a.compoe_qtd) = 1 then 'heranca'
           else 'soma_filhos'
         end,
         quantidade_referencia = case
           when g.qtd_ref_modo = 'manual' then g.quantidade_referencia
           else coalesce((select sum(r.quantidade * a.fracao)
                            from public.item_orc_alocacao a
                            join public.item_orcamentario r on r.id = a.receita_id
                           where a.grupo_id = g.id and a.compoe_qtd), 0)
         end,
         venda_total_calc = coalesce((select sum(r.venda_total_calc * a.fracao)
                                        from public.item_orc_alocacao a
                                        join public.item_orcamentario r on r.id = a.receita_id
                                       where a.grupo_id = g.id), 0),
         updated_at = now()
   where g.obra_id = _obra_id and g.tipo = 'servico_grupo';

  update public.item_orcamentario
     set lucratividade_perc_calc = case
       when venda_total_calc > 0 and custo_total_calc > 0 then
         (venda_total_calc - custo_total_calc - venda_total_calc * obra_aliquota) / venda_total_calc
       else null
     end
   where obra_id = _obra_id and tipo = 'servico_grupo';

  -- 4) apropriação do custo dos serviços nas receitas (pela venda alocada)
  update public.item_orcamentario r
     set custo_total_calc = coalesce((
           select sum(g.custo_total_calc * (r.venda_total_calc * a.fracao) / g.venda_total_calc)
             from public.item_orc_alocacao a
             join public.item_orcamentario g on g.id = a.grupo_id
            where a.receita_id = r.id and g.venda_total_calc > 0), 0)
   where r.obra_id = _obra_id and r.tipo = 'receita';

  update public.item_orcamentario
     set lucratividade_perc_calc = case
       when venda_total_calc > 0 and custo_total_calc > 0 then
         (venda_total_calc - custo_total_calc - venda_total_calc * obra_aliquota) / venda_total_calc
       else null
     end
   where obra_id = _obra_id and tipo = 'receita';

  -- 5) rollup das etapas (planilha de venda), do nível mais profundo até a raiz
  select coalesce(max(nivel), 0) into max_nivel
    from public.item_orcamentario
   where obra_id = _obra_id and tipo = 'etapa';

  lvl := max_nivel;
  while lvl >= 1 loop
    update public.item_orcamentario p
       set custo_total_calc = s.custo,
           venda_total_calc = s.venda,
           lucratividade_perc_calc = case when s.venda > 0 and s.custo > 0
             then (s.venda - s.custo - s.venda * obra_aliquota) / s.venda else null end,
           updated_at = now()
      from (select c.parent_id,
                   coalesce(sum(c.custo_total_calc), 0) as custo,
                   coalesce(sum(c.venda_total_calc), 0) as venda
              from public.item_orcamentario c
             where c.obra_id = _obra_id and c.parent_id is not null
             group by c.parent_id) s
     where p.id = s.parent_id
       and p.obra_id = _obra_id
       and p.tipo = 'etapa'
       and p.nivel = lvl;
    -- etapa sem filhos
    update public.item_orcamentario p
       set custo_total_calc = 0, venda_total_calc = 0, lucratividade_perc_calc = null
     where p.obra_id = _obra_id and p.tipo = 'etapa' and p.nivel = lvl
       and not exists (select 1 from public.item_orcamentario c where c.parent_id = p.id);
    lvl := lvl - 1;
  end loop;

  -- 6) totais: venda = planilha de venda; custo direto = serviços
  select count(*),
         coalesce(sum(custo_total_calc) filter (where tipo = 'servico_grupo'), 0),
         coalesce(sum(venda_total_calc) filter (where parent_id is null and tipo <> 'servico_grupo'), 0)
    into itens_total, custo_total, venda_total
    from public.item_orcamentario
   where obra_id = _obra_id;

  if venda_total > 0 then
    lucr_global := (venda_total - custo_total - venda_total * obra_aliquota) / venda_total;
  else
    lucr_global := null;
  end if;

  perform set_config('infrawork.recalc_em_curso', '', true);

  return jsonb_build_object(
    'ok', true,
    'itens_atualizados', itens_total,
    'custo_total',       custo_total,
    'venda_total',       venda_total,
    'lucratividade_global', lucr_global,
    'duracao_ms', ((extract(epoch from clock_timestamp()) * 1000)::bigint - inicio_ms)
  );
end
$$;

CREATE OR REPLACE FUNCTION public.fn_item_orc_aloc_sync_modo(_obra_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
begin
  if not public.chamada_autorizada(_obra_id, 'orcamento') then
    raise exception 'Sem permissão para editar o orçamento desta obra' using errcode = '42501';
  end if;
  update public.item_orcamentario g
     set qtd_ref_modo = case
           when (select count(*) from public.item_orc_alocacao a where a.grupo_id = g.id and a.compoe_qtd) = 1
             then 'heranca' else 'soma_filhos' end
   where g.obra_id = _obra_id and g.tipo = 'servico_grupo' and g.qtd_ref_modo <> 'manual';
end $$;

CREATE OR REPLACE FUNCTION public.fn_cpu_recalc(_cpu_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  c_eq    numeric(14,4);
  c_comb  numeric(14,4);
  c_mo    numeric(14,4);
  c_mat   numeric(14,4);
  prod    numeric(14,4);
begin
  if pg_trigger_depth() = 0 and not public.chamada_autorizada(public.cpu_obra(_cpu_id), 'orcamento') then
    raise exception 'Sem permissão para editar o orçamento desta obra' using errcode = '42501';
  end if;
  select
    coalesce(sum(custo_total_calc) filter (where grupo = 'EQUIPAMENTO'), 0),
    coalesce(sum(custo_total_calc) filter (where grupo = 'COMBUSTIVEL'), 0),
    coalesce(sum(custo_total_calc) filter (where grupo = 'MO'),          0),
    coalesce(sum(custo_total_calc) filter (where grupo = 'MATERIAL'),    0)
  into c_eq, c_comb, c_mo, c_mat
  from public.cpu_item
  where cpu_id = _cpu_id;

  select producao_diaria_qtde into prod
    from public.cpu where id = _cpu_id;
  if prod is null or prod = 0 then prod := 1; end if;

  update public.cpu
     set custo_eq_dia_calc   = c_eq,
         custo_comb_dia_calc = c_comb,
         custo_mo_dia_calc   = c_mo,
         custo_mat_dia_calc  = c_mat,
         custo_unit_calc     = (c_eq + c_comb + c_mo + c_mat) / prod
   where id = _cpu_id;
end
$$;

CREATE OR REPLACE FUNCTION public.set_recurso_preco_vigente(_preco_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  _recurso uuid;
  _obra    uuid;
begin
  select recurso_id into _recurso from public.recurso_preco where id = _preco_id;
  if _recurso is null then
    raise exception 'Preço não encontrado';
  end if;

  _obra := public.recurso_obra(_recurso);

  if not public.pode_editar_orcamento(_obra) then
    raise exception 'Sem permissão para alterar o preço vigente';
  end if;

  update public.recurso_preco
     set is_vigente = false
   where recurso_id = _recurso and is_vigente = true and id <> _preco_id;

  update public.recurso_preco
     set is_vigente = true
   where id = _preco_id;
end
$$;

CREATE OR REPLACE FUNCTION public.trecho_sync_tarefas(_obra_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare n int;
begin
  if not public.chamada_autorizada(_obra_id, 'planejar') then
    raise exception 'Sem permissão para planejar esta obra' using errcode = '42501';
  end if;
  perform set_config('infrawork.trecho_sync', '1', true);
  update public.planejamento_tarefa_local l
     set qtd_origem = l.qtd_origem
    from public.planejamento p
   where p.id = l.planejamento_id and p.obra_id = _obra_id and not p.is_baseline and l.qtd_origem = 'trecho';
  get diagnostics n = row_count;
  perform set_config('infrawork.trecho_sync', '', true);
  return n;
end $$;

CREATE OR REPLACE FUNCTION public.lb_premissas_diff(_planejamento_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare itens jsonb; cal_mudou boolean; tipos_mudou boolean; p record;
begin
  select id, obra_id, is_baseline, premissa_calendarios, premissa_calendario, premissa_tipos into p
    from public.planejamento where id = _planejamento_id;
  if p.id is not null and not public.chamada_autorizada(p.obra_id, 'ver') then
    raise exception 'Sem permissão para ver este plano' using errcode = '42501';
  end if;
  if p.id is null or not p.is_baseline then
    return jsonb_build_object('mudou', false, 'itens', '[]'::jsonb, 'calendario', false, 'tipos', false);
  end if;
  with antes as (
    select pr.* from public.planejamento_lb_premissa pr where pr.planejamento_id = _planejamento_id
  ), agora as (
    select * from public.planejamento_tarefa_valores_vivos(_planejamento_id)
  ), cmp as (
    select a.item_orcamentario_id,
           coalesce(v.codigo, '?') as codigo, coalesce(v.descricao, '(serviço excluído)') as descricao,
           a.item_quantidade as qtd_antes, v.item_quantidade as qtd_agora,
           a.item_venda_total as venda_antes, v.item_venda_total as venda_agora,
           a.item_custo_unit as custo_antes, v.item_custo_unit as custo_agora,
           a.producao_diaria_efetiva as prod_antes, v.producao_diaria_efetiva as prod_agora,
           (a.equipe is not null and v.equipe is not null and (a.equipe->'recursos') is distinct from (v.equipe->'recursos')) as equipe_mudou
      from antes a left join agora v on v.tarefa_id = a.tarefa_id
  )
  select coalesce(jsonb_agg(distinct jsonb_build_object(
           'item_orcamentario_id', item_orcamentario_id, 'codigo', codigo, 'descricao', descricao,
           'quantidade', case when abs(coalesce(qtd_antes,0) - coalesce(qtd_agora,0)) > 0.0001 then jsonb_build_array(qtd_antes, qtd_agora) end,
           'venda', case when abs(coalesce(venda_antes,0) - coalesce(venda_agora,0)) > 0.005 then jsonb_build_array(venda_antes, venda_agora) end,
           'custo_unit', case when abs(coalesce(custo_antes,0) - coalesce(custo_agora,0)) > 0.00005 then jsonb_build_array(custo_antes, custo_agora) end,
           'producao', case when abs(coalesce(prod_antes,0) - coalesce(prod_agora,0)) > 0.0001 then jsonb_build_array(prod_antes, prod_agora) end,
           'equipe', case when equipe_mudou then true end)), '[]'::jsonb)
    into itens
    from cmp
   where abs(coalesce(qtd_antes,0) - coalesce(qtd_agora,0)) > 0.0001
      or abs(coalesce(venda_antes,0) - coalesce(venda_agora,0)) > 0.005
      or abs(coalesce(custo_antes,0) - coalesce(custo_agora,0)) > 0.00005
      or abs(coalesce(prod_antes,0) - coalesce(prod_agora,0)) > 0.0001
      or equipe_mudou;
  cal_mudou := coalesce(p.premissa_calendarios, p.premissa_calendario) is not null
           and coalesce(p.premissa_calendarios, p.premissa_calendario) is distinct from public.calendario_fingerprint(p.obra_id);
  tipos_mudou := p.premissa_tipos is not null and p.premissa_tipos is distinct from public.servico_dependencias_fingerprint(p.obra_id);
  return jsonb_build_object(
    'mudou', jsonb_array_length(itens) > 0 or cal_mudou or tipos_mudou,
    'itens', itens, 'calendario', cal_mudou, 'tipos', tipos_mudou);
end $$;

CREATE OR REPLACE FUNCTION public.cadeia_trava_motivo(_obra_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  select case
    when not public.chamada_autorizada(_obra_id, 'ver') then null
    when exists (select 1 from public.planejamento where obra_id = _obra_id and vigente) then
      'há um plano vigente ("' || (select nome from public.planejamento where obra_id = _obra_id and vigente) ||
      '") — desmarque o vigente para replanejar, ou lance um aditivo'
    when exists (select 1 from public.planejamento where obra_id = _obra_id and is_baseline)
     and not exists (select 1 from public.planejamento where obra_id = _obra_id and not is_baseline) then
      'não há plano em edição — crie um plano em edição para alterar'
    else null end
$$;

CREATE OR REPLACE FUNCTION public.receita_preco_em(_receita_id uuid, _data date)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  select case when public.chamada_autorizada(
      (select i.obra_id from public.item_orcamentario i where i.id = _receita_id), 'ver') then coalesce(
    (select ri.preco_antes
       from public.orcamento_reajuste_item ri
       join public.orcamento_reajuste re on re.id = ri.reajuste_id
      where ri.receita_id = _receita_id and re.status = 'aplicado' and re.data > _data
      order by re.data
      limit 1),
    (select venda_unitaria from public.item_orcamentario where id = _receita_id)) end
$$;

-- ── 5. Funções internas (só outras funções SECURITY DEFINER chamam) saem do alcance do usuário ───────────────
revoke execute on function public.calendario_fingerprint(_obra_id uuid) from authenticated;
revoke execute on function public.campo_assert(_obra_id uuid) from authenticated;
revoke execute on function public.campo_assert_painel(_obra_id uuid) from authenticated;
revoke execute on function public.fn_item_orc_aloc_recalcular(_obra_id uuid) from authenticated;
revoke execute on function public.fn_locais_validar(_tarefa_id uuid) from authenticated;
revoke execute on function public.fn_orc_marcar_recalculo(_obra_id uuid) from authenticated;
revoke execute on function public.fn_plano_assert_editavel(_planejamento_id uuid) from authenticated;
revoke execute on function public.fn_tarefa_assert_editavel(_tarefa_id uuid, OUT planejamento_id uuid, OUT obra_id uuid, OUT item_id uuid, OUT parent_id uuid, OUT nivel smallint, OUT ordem integer) from authenticated;
revoke execute on function public.fn_tarefa_clonar(_tarefa_id uuid) from authenticated;
revoke execute on function public.fn_tarefa_prefixo_nome(_tarefa_id uuid) from authenticated;
revoke execute on function public.fn_tarefa_trecho_principal(_tarefa_id uuid) from authenticated;
revoke execute on function public.fn_trecho_assert_editavel(_trecho_id uuid) from authenticated;
revoke execute on function public.fn_viagens_recompor(_obra uuid, _data date, _item uuid, _trecho uuid, _equipe uuid, _enc uuid) from authenticated;
revoke execute on function public.imp_definir_preco_vigente(_recurso_id uuid, _preco numeric, _origem text) from authenticated;
revoke execute on function public.imp_grupo_recurso(_grupo_item text) from authenticated;
revoke execute on function public.importar_orcamento(_obra_id uuid, _itens jsonb, _alocacoes jsonb, _servicos jsonb, _opcoes jsonb) from authenticated;
revoke execute on function public.norm_txt(_s text) from authenticated;
revoke execute on function public.obra_tem_aditivo(_obra_id uuid) from authenticated;
revoke execute on function public.planejamento_tarefa_valores_vivos(_planejamento_id uuid) from authenticated;
revoke execute on function public.servico_custo_unit(_servico_id uuid) from authenticated;
revoke execute on function public.servico_dependencias_fingerprint(_obra_id uuid) from authenticated;
revoke execute on function public.servico_equipe_viva(_servico_id uuid) from authenticated;
revoke execute on function public.snapshot_orcamento_atual(_obra_id uuid) from authenticated;
revoke execute on function public.trecho_versao_atual(_trecho_id uuid) from authenticated;
