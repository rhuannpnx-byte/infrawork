-- InfraWork Web — esquema-base: o estado do banco depois das 213 migrações anteriores (20260522… a 20260701000052),
-- consolidadas aqui. O histórico antigo incluía 40 tabelas e 52 funções criadas e depois removidas (WhatsApp,
-- documentos com IA, contratos, vínculo com o SIGA). As migrações antigas ficam no histórico do git.
--
-- Gerado por pg_dump do banco com todas as migrações aplicadas, mais os objetos fora do esquema public (buckets e
-- políticas do Storage, agendamentos do pg_cron). Os segredos do Vault (project_url, service_role_key) são
-- cadastrados à mão por ambiente — ver README.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--


--
-- Name: role_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.role_enum AS ENUM (
    'god',
    'adm',
    'engenheiro',
    'apoio',
    'cliente',
    'apontador'
);


--
-- Name: acomp_producao_obra(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.acomp_producao_obra(_id uuid) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select obra_id from public.acompanhamento_producao where id = _id
$$;


--
-- Name: acompanhamento_alertas_sincronizar(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.acompanhamento_alertas_sincronizar(p_obra_id uuid, p_alertas jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_resolvidos int := 0;
  v_atualizados int := 0;
  v_reabertos int := 0;
  v_inseridos int := 0;
begin
  perform pg_advisory_xact_lock(hashtext('acompanhamento_alertas:' || p_obra_id::text));

  if to_regclass('pg_temp._alerta_novo') is null then
    create temp table _alerta_novo (
      chave text primary key,
      tipo text,
      severidade text,
      titulo text,
      descricao text,
      contexto jsonb
    ) on commit drop;
  else
    truncate _alerta_novo;
  end if;

  insert into _alerta_novo
  select distinct on (x.chave) x.chave, x.tipo, x.severidade, x.titulo, x.descricao, coalesce(x.contexto, '{}'::jsonb)
    from jsonb_to_recordset(coalesce(p_alertas, '[]'::jsonb))
         as x(chave text, tipo text, severidade text, titulo text, descricao text, contexto jsonb)
   where coalesce(x.chave, '') <> ''
   order by x.chave;

  -- deixou de existir: aberto (ou silenciado vencido) vira resolvido automaticamente
  update public.acompanhamento_alerta a
     set status = 'resolvido', resolvido_em = now(), resolvido_automaticamente = true, silenciado_ate = null
   where a.obra_id = p_obra_id
     and (a.status = 'aberto' or (a.status = 'silenciado' and a.silenciado_ate is not null and a.silenciado_ate <= now()))
     and not exists (select 1 from _alerta_novo n where n.chave = a.chave);
  get diagnostics v_resolvidos = row_count;

  -- continua aberto: atualiza os números, mantém criado_em
  update public.acompanhamento_alerta a
     set severidade = n.severidade, titulo = n.titulo, descricao = n.descricao, contexto = n.contexto, updated_at = now()
    from _alerta_novo n
   where a.obra_id = p_obra_id and a.status = 'aberto' and a.chave = n.chave
     and (a.severidade, a.titulo, a.descricao, a.contexto) is distinct from (n.severidade, n.titulo, n.descricao, n.contexto);
  get diagnostics v_atualizados = row_count;

  -- silenciamento venceu e a condição continua: reabre o mesmo alerta
  update public.acompanhamento_alerta a
     set status = 'aberto', silenciado_ate = null,
         severidade = n.severidade, titulo = n.titulo, descricao = n.descricao, contexto = n.contexto, updated_at = now()
    from _alerta_novo n
   where a.id in (
           select distinct on (s.chave) s.id
             from public.acompanhamento_alerta s
            where s.obra_id = p_obra_id and s.status = 'silenciado'
              and s.silenciado_ate is not null and s.silenciado_ate <= now()
            order by s.chave, s.silenciado_ate desc
         )
     and a.chave = n.chave
     and not exists (
           select 1 from public.acompanhamento_alerta o
            where o.obra_id = p_obra_id and o.chave = a.chave and o.status = 'aberto'
         );
  get diagnostics v_reabertos = row_count;

  -- novo: só se não houver aberto, silenciado ou resolvido à mão com a mesma chave
  insert into public.acompanhamento_alerta (obra_id, chave, tipo, severidade, titulo, descricao, contexto)
  select p_obra_id, n.chave, n.tipo, n.severidade, n.titulo, n.descricao, n.contexto
    from _alerta_novo n
   where not exists (
           select 1 from public.acompanhamento_alerta a
            where a.obra_id = p_obra_id and a.chave = n.chave
              and (a.status in ('aberto', 'silenciado')
                   or (a.status = 'resolvido' and a.resolvido_automaticamente = false))
         );
  get diagnostics v_inseridos = row_count;

  return jsonb_build_object(
    'inseridos', v_inseridos,
    'atualizados', v_atualizados,
    'reabertos', v_reabertos,
    'resolvidos', v_resolvidos,
    'abertos', (select count(*) from public.acompanhamento_alerta where obra_id = p_obra_id and status = 'aberto')
  );
end $$;


--
-- Name: acompanhamento_perf_historico(text[], uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.acompanhamento_perf_historico(p_servico_codigos text[], p_obra_atual uuid) RETURNS TABLE(n_amostras integer, n_outliers integer, p25 numeric, p50 numeric, p75 numeric, media_trim numeric, media_bruta numeric, n_obras integer, unidade text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
    select p.obra_id, p.equipe_id, p.data,
           sum(p.quantidade * p.fator_conversao) as qtd_dia,
           max(coalesce(s.unidade, p.unidade))   as unidade
      from public.acompanhamento_producao p
      join allowed a on a.id = p.obra_id
      join public.servico s on s.id = p.servico_id
     where s.codigo = any (p_servico_codigos)
       and p.quantidade > 0
     group by p.obra_id, p.equipe_id, p.data
  ),
  bounds as (
    select percentile_cont(0.25) within group (order by qtd_dia) as q1,
           percentile_cont(0.75) within group (order by qtd_dia) as q3
      from amostras
  ),
  marcadas as (
    select a.obra_id, a.qtd_dia, a.unidade,
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
         avg(qtd_dia)                                                                         as media_bruta,
         count(distinct obra_id)::int                                                         as n_obras,
         max(unidade)                                                                         as unidade
    from marcadas;
$$;


--
-- Name: alocar_receitas(uuid, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.alocar_receitas(_grupo_id uuid, _receita_ids uuid[]) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_obra uuid; rid uuid; v_crit text; v_soma numeric; v_saldo numeric;
  v_unid_grupo text; v_tem_compoe boolean; v_unids int; v_compoe boolean;
  n_ok int := 0; avisos text[] := '{}'; v_cod text;
begin
  select obra_id, unidade_referencia into v_obra, v_unid_grupo
    from public.item_orcamentario where id = _grupo_id and tipo = 'servico_grupo';
  if v_obra is null then raise exception 'Serviço não encontrado'; end if;

  -- primeiras receitas de um serviço sem referência de quantidade compõem a
  -- quantidade (se tiverem a mesma unidade)
  select exists (select 1 from public.item_orc_alocacao where grupo_id = _grupo_id and compoe_qtd)
    into v_tem_compoe;
  select count(distinct lower(trim(unidade))) into v_unids
    from public.item_orcamentario where id = any(_receita_ids);
  v_compoe := not v_tem_compoe and v_unids = 1;

  foreach rid in array _receita_ids loop
    select codigo into v_cod from public.item_orcamentario where id = rid;
    if exists (select 1 from public.item_orc_alocacao where grupo_id = _grupo_id and receita_id = rid) then
      avisos := avisos || (v_cod || ': já está neste serviço');
      continue;
    end if;
    select min(criterio), coalesce(sum(valor), 0) into v_crit, v_soma
      from public.item_orc_alocacao where receita_id = rid;
    if v_crit is null then
      v_saldo := 100;
    elsif v_crit = 'percentual' then
      v_saldo := 100 - v_soma;
      if v_saldo <= 0.0001 then
        avisos := avisos || (v_cod || ': já está 100% alocada — use Ratear');
        continue;
      end if;
    else
      avisos := avisos || (v_cod || ': rateada por ' || v_crit || ' — use Ratear');
      continue;
    end if;
    insert into public.item_orc_alocacao (obra_id, grupo_id, receita_id, criterio, valor, compoe_qtd)
    values (v_obra, _grupo_id, rid, 'percentual', v_saldo, v_compoe);
    n_ok := n_ok + 1;
  end loop;

  if v_compoe and v_unid_grupo is null then
    update public.item_orcamentario g
       set unidade_referencia = (select min(unidade) from public.item_orcamentario where id = any(_receita_ids))
     where g.id = _grupo_id and g.servico_id is null and g.indireto_id is null;
  end if;

  perform public.fn_item_orc_aloc_sync_modo(v_obra);
  perform public.recalcular_orcamento(v_obra);
  return jsonb_build_object('alocadas', n_ok, 'avisos', to_jsonb(avisos));
end $$;


--
-- Name: aplicar_aditivo(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.aplicar_aditivo(_aditivo_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $_$
declare
  a record; it record; dst jsonb;
  v_rec record; v_parent uuid; prefixo text; v_tipo text; v_receita uuid;
  v_grupo uuid; v_crit text; v_compoe boolean; v_valor numeric;
  venda0 numeric; venda1 numeric; viol text;
  n_qtd int := 0; n_exc int := 0; n_novo int := 0; n_serv int := 0;
begin
  select * into a from public.orcamento_aditivo where id = _aditivo_id for update;
  if a.id is null then raise exception 'Aditivo não encontrado'; end if;
  if not public.pode_editar_orcamento(a.obra_id) then raise exception 'Sem permissão'; end if;
  if a.status = 'aplicado' then raise exception 'Aditivo % já aplicado', a.numero; end if;
  if a.data is null then raise exception 'Informe a data do aditivo'; end if;
  if exists (select 1 from public.orcamento_aditivo
              where obra_id = a.obra_id and status = 'aplicado' and data > a.data) then
    raise exception 'A data do aditivo não pode ser anterior à de um aditivo já aplicado';
  end if;
  if not exists (select 1 from public.orcamento_aditivo_item where aditivo_id = a.id) then
    raise exception 'Aditivo sem itens';
  end if;

  perform pg_advisory_xact_lock(hashtext('orc:' || a.obra_id::text));
  perform set_config('infrawork.via_aditivo', '1', true);

  -- Planilha Inicial (1º aditivo)
  if not exists (select 1 from public.orcamento_planilha_inicial where obra_id = a.obra_id) then
    perform public.recalcular_orcamento(a.obra_id);
    insert into public.orcamento_planilha_inicial (obra_id, aditivo_id, snapshot)
    values (a.obra_id, a.id, public.snapshot_orcamento_atual(a.obra_id));
  end if;

  select coalesce(sum(venda_total_calc), 0) into venda0
    from public.item_orcamentario
   where obra_id = a.obra_id and parent_id is null and tipo <> 'servico_grupo';

  for it in select * from public.orcamento_aditivo_item where aditivo_id = a.id order by ordem, created_at
  loop
    if it.tipo = 'quantidade' then
      select id, tipo, quantidade into v_rec from public.item_orcamentario
       where obra_id = a.obra_id and id = it.receita_id;
      if v_rec.id is null or v_rec.tipo <> 'receita' then
        raise exception 'Item % não é uma receita da planilha', it.codigo;
      end if;
      if it.quantidade_nova is null or it.quantidade_nova <= 0 then
        raise exception 'Item %: quantidade nova deve ser > 0 (para retirar o item use exclusão)', it.codigo;
      end if;
      update public.orcamento_aditivo_item set quantidade_antes = v_rec.quantidade where id = it.id;
      update public.item_orcamentario set quantidade = it.quantidade_nova where id = v_rec.id;
      n_qtd := n_qtd + 1;

    elsif it.tipo = 'exclusao' then
      select id, tipo, quantidade into v_rec from public.item_orcamentario
       where obra_id = a.obra_id and id = it.receita_id;
      if v_rec.id is null then raise exception 'Item % não encontrado', it.codigo; end if;
      if v_rec.tipo = 'etapa' and exists (select 1 from public.item_orcamentario where parent_id = v_rec.id) then
        raise exception 'Etapa % tem itens — exclua os itens antes', it.codigo;
      end if;
      update public.orcamento_aditivo_item set quantidade_antes = v_rec.quantidade where id = it.id;
      delete from public.item_orcamentario where id = v_rec.id;  -- trigger recusa receita alocada
      n_exc := n_exc + 1;

    else -- novo
      if it.codigo is null or it.codigo !~ '^[0-9]+(\.[0-9]+)*$' then
        raise exception 'Código inválido no item novo: %', coalesce(it.codigo, '(vazio)');
      end if;
      if exists (select 1 from public.item_orcamentario where obra_id = a.obra_id and codigo = it.codigo) then
        raise exception 'Código % já existe na planilha', it.codigo;
      end if;
      v_tipo := case when it.unidade is null and it.quantidade_nova is null then 'etapa' else 'receita' end;
      if v_tipo = 'receita' and (it.quantidade_nova is null or it.quantidade_nova <= 0
                                 or it.venda_unitaria is null or it.unidade is null) then
        raise exception 'Item novo %: informe unidade, quantidade (> 0) e preço', it.codigo;
      end if;
      v_parent := null;
      if position('.' in it.codigo) > 0 then
        prefixo := left(it.codigo, length(it.codigo) - position('.' in reverse(it.codigo)));
        select id into v_parent from public.item_orcamentario
         where obra_id = a.obra_id and codigo = prefixo and tipo = 'etapa';
      end if;
      insert into public.item_orcamentario
        (obra_id, parent_id, codigo, descricao, tipo, unidade, quantidade, venda_unitaria, aditivo_id)
      values (a.obra_id, v_parent, it.codigo, coalesce(nullif(trim(it.descricao), ''), it.codigo), v_tipo,
              case when v_tipo = 'receita' then it.unidade end,
              case when v_tipo = 'receita' then it.quantidade_nova end,
              case when v_tipo = 'receita' then it.venda_unitaria end, a.id)
      returning id into v_receita;
      update public.orcamento_aditivo_item set receita_id = v_receita where id = it.id;
      n_novo := n_novo + 1;

      -- alocação opcional do item novo
      if v_tipo = 'receita' and it.alocacao is not null
         and jsonb_array_length(coalesce(it.alocacao->'destinos', '[]'::jsonb)) > 0 then
        v_crit := coalesce(nullif(it.alocacao->>'criterio', ''), 'percentual');
        v_compoe := coalesce((it.alocacao->>'compoe')::boolean, false);
        for dst in select d.value from jsonb_array_elements(it.alocacao->'destinos') d loop
          v_grupo := nullif(dst->>'grupo_id', '')::uuid;
          if v_grupo is null then
            select id into v_grupo from public.item_orcamentario
             where obra_id = a.obra_id and tipo = 'servico_grupo'
               and lower(trim(descricao)) = lower(trim(dst->>'servico'))
             order by codigo limit 1;
          end if;
          if v_grupo is null then
            if coalesce(trim(dst->>'servico'), '') = '' then raise exception 'Destino sem serviço'; end if;
            insert into public.item_orcamentario (obra_id, codigo, descricao, tipo, qtd_ref_modo, quantidade_referencia)
            values (a.obra_id, null, trim(dst->>'servico'), 'servico_grupo',
                    case when v_compoe then 'heranca' else 'manual' end,
                    case when v_compoe then 0 else 1 end)
            returning id into v_grupo;
            update public.item_orcamentario
               set unidade_referencia = case when v_compoe then it.unidade else 'vb' end
             where id = v_grupo;
            n_serv := n_serv + 1;
          end if;
          v_valor := case when v_crit = 'venda' then null else coalesce(nullif(dst->>'valor', '')::numeric, 100) end;
          insert into public.item_orc_alocacao (obra_id, grupo_id, receita_id, criterio, valor, compoe_qtd)
          values (a.obra_id, v_grupo, v_receita, v_crit, v_valor, v_compoe);
        end loop;
        perform public.fn_item_orc_aloc_sync_modo(a.obra_id);
      end if;
    end if;
  end loop;

  perform public.recalcular_orcamento(a.obra_id);

  -- supressão: serviço não pode ficar abaixo do já executado
  select string_agg(format('%s (%s < executado %s)', g.descricao,
                           round(g.quantidade_referencia, 2), round(ex.executado, 2)), '; ')
    into viol
    from public.item_orcamentario g
    join (select item_orcamentario_id, sum(quantidade * coalesce(fator_conversao, 1)) as executado
            from public.acompanhamento_producao
           where obra_id = a.obra_id and item_orcamentario_id is not null
           group by item_orcamentario_id) ex on ex.item_orcamentario_id = g.id
   where g.obra_id = a.obra_id and g.tipo = 'servico_grupo' and g.qtd_ref_modo <> 'manual'
     and g.quantidade_referencia + 0.0001 < ex.executado;
  if viol is not null then
    raise exception 'Supressão abaixo do executado: %', viol;
  end if;

  select coalesce(sum(venda_total_calc), 0) into venda1
    from public.item_orcamentario
   where obra_id = a.obra_id and parent_id is null and tipo <> 'servico_grupo';

  update public.orcamento_aditivo
     set status = 'aplicado', aplicado_em = now(), aplicado_por = auth.uid(),
         venda_antes = venda0, venda_depois = venda1
   where id = a.id;

  perform set_config('infrawork.via_aditivo', '', true);
  return jsonb_build_object('ok', true, 'numero', a.numero,
    'quantidades', n_qtd, 'exclusoes', n_exc, 'novos', n_novo, 'servicos_criados', n_serv,
    'venda_antes', venda0, 'venda_depois', venda1);
end $_$;


--
-- Name: aplicar_reajuste(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.aplicar_reajuste(_reajuste_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  r record; v_base date; v_prev date; venda0 numeric; venda1 numeric; n int;
begin
  select * into r from public.orcamento_reajuste where id = _reajuste_id for update;
  if r.id is null then raise exception 'Reajuste não encontrado'; end if;
  if not public.pode_editar_orcamento(r.obra_id) then raise exception 'Sem permissão'; end if;
  if r.status = 'aplicado' then raise exception 'Reajuste % já aplicado', r.numero; end if;

  select data_base_orcamento into v_base from public.obras where id = r.obra_id;
  select max(data) into v_prev from public.orcamento_reajuste
   where obra_id = r.obra_id and status = 'aplicado';
  if v_prev is not null then
    if r.data < (v_prev + interval '12 months')::date then
      raise exception 'O reajuste precisa de 12 meses do anterior (% → a partir de %)',
        to_char(v_prev, 'DD/MM/YYYY'), to_char((v_prev + interval '12 months')::date, 'DD/MM/YYYY');
    end if;
  else
    if v_base is null then raise exception 'Defina a data-base do orçamento antes do 1º reajuste'; end if;
    if r.data < (v_base + interval '12 months')::date then
      raise exception 'O 1º reajuste precisa de 12 meses da data-base (% → a partir de %)',
        to_char(v_base, 'DD/MM/YYYY'), to_char((v_base + interval '12 months')::date, 'DD/MM/YYYY');
    end if;
  end if;

  select count(*) into n from public.orcamento_reajuste_item where reajuste_id = r.id;
  if n = 0 then raise exception 'Classifique ao menos uma receita num grupo'; end if;
  if exists (select 1 from public.orcamento_reajuste_item ri
              join public.item_orcamentario i on i.id = ri.receita_id
             where ri.reajuste_id = r.id and i.tipo <> 'receita') then
    raise exception 'Só receitas podem ser reajustadas';
  end if;

  perform pg_advisory_xact_lock(hashtext('orc:' || r.obra_id::text));
  perform set_config('infrawork.via_aditivo', '1', true);

  select coalesce(sum(venda_total_calc), 0) into venda0
    from public.item_orcamentario
   where obra_id = r.obra_id and parent_id is null and tipo <> 'servico_grupo';

  update public.orcamento_reajuste_item ri
     set fator = g.indice_atual / g.indice_anterior,
         preco_antes = i.venda_unitaria,
         preco_depois = round(i.venda_unitaria * g.indice_atual / g.indice_anterior, 2)
    from public.orcamento_reajuste_grupo g, public.item_orcamentario i
   where ri.reajuste_id = r.id and g.id = ri.grupo_id and i.id = ri.receita_id;

  update public.item_orcamentario i
     set venda_unitaria = ri.preco_depois
    from public.orcamento_reajuste_item ri
   where ri.reajuste_id = r.id and i.id = ri.receita_id;

  perform public.recalcular_orcamento(r.obra_id);

  select coalesce(sum(venda_total_calc), 0) into venda1
    from public.item_orcamentario
   where obra_id = r.obra_id and parent_id is null and tipo <> 'servico_grupo';

  update public.orcamento_reajuste
     set status = 'aplicado', aplicado_em = now(), aplicado_por = auth.uid(),
         venda_antes = venda0, venda_depois = venda1
   where id = r.id;

  perform set_config('infrawork.via_aditivo', '', true);
  return jsonb_build_object('ok', true, 'numero', r.numero, 'receitas', n,
    'venda_antes', venda0, 'venda_depois', venda1);
end $$;


--
-- Name: atualizar_tarefa_indireta(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.atualizar_tarefa_indireta(p_tarefa_id uuid, p_indireto_config jsonb) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
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


--
-- Name: FUNCTION atualizar_tarefa_indireta(p_tarefa_id uuid, p_indireto_config jsonb); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.atualizar_tarefa_indireta(p_tarefa_id uuid, p_indireto_config jsonb) IS 'Atualiza config de tarefa indireta. Aceita patch parcial (campos ausentes mantêm valor atual).';


--
-- Name: auth_empresa_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auth_empresa_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select empresa_id from public.profiles where id = auth.uid() and ativo
$$;


--
-- Name: auth_engenheiro_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auth_engenheiro_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select engenheiro_id from public.profiles where id = auth.uid() and ativo
$$;


--
-- Name: auth_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auth_role() RETURNS public.role_enum
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select role from public.profiles where id = auth.uid() and ativo
$$;


--
-- Name: cadeia_trava_motivo(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cadeia_trava_motivo(_obra_id uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select case
    when exists (select 1 from public.planejamento where obra_id = _obra_id and vigente) then
      'há um plano vigente ("' || (select nome from public.planejamento where obra_id = _obra_id and vigente) ||
      '") — desmarque o vigente para replanejar, ou lance um aditivo'
    when exists (select 1 from public.planejamento where obra_id = _obra_id and is_baseline)
     and not exists (select 1 from public.planejamento where obra_id = _obra_id and not is_baseline) then
      'não há plano em edição — crie um plano em edição para alterar'
    else null end
$$;


--
-- Name: calendario_fingerprint(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calendario_fingerprint(_obra_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select jsonb_build_object(
    'calendarios', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'nome', c.nome, 'padrao', c.padrao, 'semana', c.semana,
               'definicoes', coalesce((select jsonb_agg(jsonb_build_object(
                   'tipo', d.tipo, 'nome', d.nome, 'data_inicio', d.data_inicio, 'data_fim', d.data_fim,
                   'todo_ano', d.todo_ano, 'dia_semana', d.dia_semana, 'semana', d.semana) order by d.ordem, d.id)
                 from public.calendario_definicao d where d.calendario_id = c.id), '[]'::jsonb)) order by c.id)
        from public.calendario c where c.obra_id = _obra_id), '[]'::jsonb),
    'fatores', coalesce((select jsonb_agg(jsonb_build_array(ano_mes, fator) order by ano_mes)
                           from public.obra_produtividade_mes where obra_id = _obra_id), '[]'::jsonb))
$$;


--
-- Name: calendario_obra(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calendario_obra(_id uuid) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ select obra_id from public.calendario where id = _id $$;


--
-- Name: campo_assert(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.campo_assert(_obra_id uuid) RETURNS void
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if auth.uid() is null or not public.pode_lancar_producao(_obra_id) then
    raise exception 'Sem permissão para lançar nesta obra';
  end if;
end $$;


--
-- Name: campo_assert_painel(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.campo_assert_painel(_obra_id uuid) RETURNS void
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if auth.uid() is null then raise exception 'Sessão expirada'; end if;
  if coalesce(public.auth_role()::text, '') not in ('god', 'adm', 'engenheiro')
     or not public.pode_ver_acompanhamento(_obra_id) then
    raise exception 'Sem acesso à visão estratégica desta obra';
  end if;
end $$;


--
-- Name: campo_catalogo(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.campo_catalogo(_obra_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v jsonb;
begin
  perform public.campo_assert(_obra_id);
  select jsonb_build_object(
    'obra', (select jsonb_build_object('id', o.id, 'codigo', o.codigo, 'nome', o.nome, 'empresa_id', o.empresa_id)
               from public.obras o where o.id = _obra_id),
    'servicos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'codigo', i.codigo, 'descricao', i.descricao,
               'unidade', coalesce(s.unidade, i.unidade_referencia),
               'modo_lancamento', coalesce(p.modo_lancamento, 'quantidade'),
               'controla_material', coalesce(p.controla_material, false),
               'material', case when p.controla_material then jsonb_build_object(
                             'id', r.id, 'nome', r.nome, 'unidade', coalesce(p.material_unidade, r.unidade)) end,
               'material_obrigatorio', coalesce(p.material_obrigatorio, true),
               'habilita_obs', coalesce(p.habilita_obs, true),
               'exige_local', coalesce(p.exige_local, false),
               'medicao_viagem', coalesce(p.medicao_viagem, 'volume'))
             order by i.ordem, i.codigo)
        from public.item_orcamentario i
        join public.servico s on s.id = i.servico_id
        left join public.servico_parametro p on p.item_orcamentario_id = i.id
        left join public.recurso r on r.id = p.material_recurso_id
       where i.obra_id = _obra_id and i.tipo = 'servico_grupo' and i.indireto_id is null), '[]'::jsonb),
    'equipes', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'nome', e.nome, 'encarregado_id', e.encarregado_id) order by e.ordem, e.nome)
        from public.equipe e where e.obra_id = _obra_id and e.ativo and not coalesce(e.is_sistema, false)), '[]'::jsonb),
    'encarregados', coalesce((
      select jsonb_agg(jsonb_build_object('id', en.id, 'nome', en.nome, 'apelido', en.apelido) order by en.nome)
        from public.encarregado en where en.obra_id = _obra_id and en.ativo), '[]'::jsonb),
    'locais', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'nome', t.nome, 'tipo', t.tipo, 'ordem', t.ordem,
               'comprimento_m', t.comprimento_m, 'geometry_comprimento_m', t.geometry_comprimento_m,
               'unidade_espaco_padrao', t.unidade_espaco_padrao, 'unidade_custom_label', t.unidade_custom_label,
               'unidade_custom_divisor_m', t.unidade_custom_divisor_m,
               'marcador_valor_inicial', t.marcador_valor_inicial, 'geometry_sentido', t.geometry_sentido)
             order by t.tipo, t.ordem, t.nome)
        from public.obra_trecho t where t.obra_id = _obra_id), '[]'::jsonb),
    'veiculos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', v.id, 'prefixo', v.prefixo, 'placa', v.placa, 'tipo', v.tipo, 'modelo', v.modelo,
               'proprietario', v.proprietario, 'capacidade_m3', v.capacidade_m3, 'capacidade_t', v.capacidade_t)
             order by v.prefixo)
        from public.veiculos_da_obra(_obra_id) v), '[]'::jsonb),
    'origens_destinos', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'nome', l.nome, 'tipo', l.tipo, 'trecho_id', l.trecho_id,
                                       'estaca_acesso_m', l.estaca_acesso_m, 'distancia_acesso_km', l.distancia_acesso_km)
             order by l.nome)
        from public.transporte_local l where l.obra_id = _obra_id and l.ativo), '[]'::jsonb),
    'rotas', coalesce((
      select jsonb_agg(jsonb_build_object('origem_id', r.origem_id, 'destino_id', r.destino_id, 'dmt_km', r.dmt_km))
        from public.transporte_rota r where r.obra_id = _obra_id), '[]'::jsonb)
  ) into v;
  return v || jsonb_build_object('versao', md5(v::text));
end $$;


--
-- Name: campo_obras(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.campo_obras() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'codigo', o.codigo, 'nome', o.nome, 'empresa_id', o.empresa_id, 'status', o.status)
           order by o.codigo), '[]'::jsonb)
    from public.obras o
   where auth.uid() is not null and public.pode_lancar_producao(o.id)
$$;


--
-- Name: campo_painel(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.campo_painel(_obra_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  desde date := hoje - 89;
  v jsonb;
begin
  v := public.campo_painel_base(_obra_id) - 'versao' - 'gerado_em';

  with
  prod as (
    select p.data, p.item_orcamentario_id as s, p.equipe_id as e, p.encarregado_id as n,
           sum(p.quantidade * p.fator_conversao) as q
      from public.acompanhamento_producao p
     where p.obra_id = _obra_id and p.data between desde and hoje and p.item_orcamentario_id is not null
     group by 1, 2, 3, 4
    having sum(p.quantidade * p.fator_conversao) > 0
  )
  select v || jsonb_build_object('producao', jsonb_build_object(
    'desde', desde,
    'dias', coalesce((select jsonb_agg(jsonb_build_object('d', data, 's', s, 'e', e, 'n', n, 'q', round(q, 4))
                                       order by data, s) from prod), '[]'::jsonb),
    'servicos', coalesce((select jsonb_object_agg(i.id, jsonb_build_object(
                                   'codigo', i.codigo, 'descricao', i.descricao, 'unidade', i.unidade_referencia))
                            from public.item_orcamentario i
                           where i.id in (select s from prod)), '{}'::jsonb),
    'equipes', coalesce((select jsonb_object_agg(eq.id, eq.nome)
                           from public.equipe eq where eq.id in (select e from prod)), '{}'::jsonb),
    'encarregados', coalesce((select jsonb_object_agg(enc.id, coalesce(enc.apelido, enc.nome))
                                from public.encarregado enc where enc.id in (select n from prod)), '{}'::jsonb)
  )) into v;

  return v || jsonb_build_object('versao', md5(v::text), 'gerado_em', now());
end $$;


--
-- Name: campo_painel_base(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.campo_painel_base(_obra_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: campo_registrar_foto(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.campo_registrar_foto(_meta jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uuid uuid := (_meta->>'app_uuid')::uuid; v_obra uuid := (_meta->>'obra_id')::uuid;
  v_id uuid; v_prod uuid; v_item uuid; v_nome text;
begin
  if auth.uid() is null then raise exception 'Sessão expirada'; end if;
  if v_uuid is null or v_obra is null or nullif(_meta->>'storage_key', '') is null then
    raise exception 'app_uuid, obra_id e storage_key são obrigatórios';
  end if;
  perform public.campo_assert(v_obra);
  if split_part(_meta->>'storage_key', '/', 2) <> v_obra::text then
    raise exception 'Arquivo fora da pasta da obra';
  end if;
  select id into v_id from public.acompanhamento_foto where app_uuid = v_uuid;
  if v_id is not null then return jsonb_build_object('id', v_id, 'duplicada', true); end if;
  v_prod := coalesce(nullif(_meta->>'producao_id', '')::uuid,
                     (select id from public.acompanhamento_producao
                       where app_uuid = nullif(_meta->>'producao_app_uuid', '')::uuid));
  v_item := nullif(_meta->>'item_orcamentario_id', '')::uuid;
  if v_item is not null then
    select descricao into v_nome from public.item_orcamentario where id = v_item and obra_id = v_obra;
    if v_nome is null then raise exception 'Serviço de outra obra'; end if;
  end if;
  insert into public.acompanhamento_foto
    (app_uuid, obra_id, producao_id, item_orcamentario_id, servico_nome, encarregado_id, lat, lng, captured_at,
     storage_key, mime, size_bytes, width, height, obs)
  values
    (v_uuid, v_obra, v_prod, v_item, v_nome, nullif(_meta->>'encarregado_id', '')::uuid,
     nullif(_meta->>'lat', '')::numeric, nullif(_meta->>'lng', '')::numeric,
     coalesce(nullif(_meta->>'captured_at', '')::timestamptz, now()),
     _meta->>'storage_key', nullif(_meta->>'mime', ''), nullif(_meta->>'size_bytes', '')::bigint,
     nullif(_meta->>'width', '')::int, nullif(_meta->>'height', '')::int, nullif(_meta->>'obs', ''))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'duplicada', false);
end $$;


--
-- Name: campo_sync_ficha(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.campo_sync_ficha(_ficha jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_id uuid := (_ficha->>'id')::uuid; v_obra uuid := (_ficha->>'obra_id')::uuid;
  v_atual record; v jsonb; v_ids uuid[] := '{}'; n int := 0;
begin
  if auth.uid() is null then raise exception 'Sessão expirada'; end if;
  if v_id is null or v_obra is null then raise exception 'id e obra_id são obrigatórios'; end if;
  perform public.campo_assert(v_obra);
  select obra_id, criado_por into v_atual from public.viagem_ficha where id = v_id;
  if v_atual.obra_id is not null then
    if v_atual.obra_id <> v_obra then raise exception 'Ficha de outra obra'; end if;
    if public.auth_role() in ('apoio', 'apontador') and v_atual.criado_por is distinct from auth.uid() then
      raise exception 'Ficha de outro usuário';
    end if;
  end if;

  if coalesce((_ficha->>'excluir')::boolean, false) then
    delete from public.viagem_ficha where id = v_id;
    return jsonb_build_object('ficha_id', v_id, 'viagens', 0, 'excluida', true);
  end if;

  insert into public.viagem_ficha
    (id, obra_id, data, veiculo_id, motorista, encarregado_id, equipe_id, obs, origem)
  values
    (v_id, v_obra, (_ficha->>'data')::date, nullif(_ficha->>'veiculo_id', '')::uuid,
     nullif(_ficha->>'motorista', ''), nullif(_ficha->>'encarregado_id', '')::uuid,
     nullif(_ficha->>'equipe_id', '')::uuid, nullif(_ficha->>'obs', ''),
     coalesce(nullif(_ficha->>'origem', ''), 'campo'))
  on conflict (id) do update set
    data = excluded.data, veiculo_id = excluded.veiculo_id, motorista = excluded.motorista,
    encarregado_id = excluded.encarregado_id, equipe_id = excluded.equipe_id, obs = excluded.obs;

  for v in select * from jsonb_array_elements(coalesce(_ficha->'viagens', '[]'::jsonb)) loop
    n := n + 1;
    v_ids := v_ids || (v->>'id')::uuid;
    insert into public.viagem
      (id, ficha_id, obra_id, data, item_orcamentario_id, origem_id, destino_id, hora_carga, hora_descarga,
       quantidade, material_qtd, dmt_km, dmt_manual, nf_ticket, estaca_carga_m,
       estaca_descarga_m, obs, ordem, carregador_id)
    values
      ((v->>'id')::uuid, v_id, v_obra, (_ficha->>'data')::date, (v->>'item_orcamentario_id')::uuid,
       nullif(v->>'origem_id', '')::uuid, nullif(v->>'destino_id', '')::uuid,
       nullif(v->>'hora_carga', '')::time, nullif(v->>'hora_descarga', '')::time,
       nullif(v->>'quantidade', '')::numeric, nullif(v->>'material_qtd', '')::numeric,
       nullif(v->>'dmt_km', '')::numeric, coalesce((v->>'dmt_manual')::boolean, false),
       nullif(v->>'nf_ticket', ''), nullif(v->>'estaca_carga_m', '')::numeric,
       nullif(v->>'estaca_descarga_m', '')::numeric, nullif(v->>'obs', ''), n,
       nullif(v->>'carregador_id', '')::uuid)
    on conflict (id) do update set
      item_orcamentario_id = excluded.item_orcamentario_id, origem_id = excluded.origem_id,
      destino_id = excluded.destino_id, hora_carga = excluded.hora_carga, hora_descarga = excluded.hora_descarga,
      quantidade = excluded.quantidade,
      material_qtd = excluded.material_qtd, dmt_km = excluded.dmt_km, dmt_manual = excluded.dmt_manual,
      nf_ticket = excluded.nf_ticket, estaca_carga_m = excluded.estaca_carga_m,
      estaca_descarga_m = excluded.estaca_descarga_m, obs = excluded.obs, ordem = excluded.ordem,
      carregador_id = excluded.carregador_id
    where public.viagem.ficha_id = v_id;
  end loop;
  delete from public.viagem where ficha_id = v_id and not (id = any (v_ids));
  return jsonb_build_object('ficha_id', v_id, 'viagens', n);
end $$;


--
-- Name: campo_sync_producao(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.campo_sync_producao(_registros jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  r jsonb; v_uuid uuid; v_obra uuid; v_id uuid; v_dono uuid; v_mat numeric;
  v_controla boolean; v_obrig boolean; v_rec uuid; v_unid text;
  aceitos jsonb := '[]'::jsonb; rejeitados jsonb := '[]'::jsonb; v_msg text;
begin
  if auth.uid() is null then raise exception 'Sessão expirada'; end if;
  if jsonb_typeof(_registros) <> 'array' or jsonb_array_length(_registros) > 200 then
    raise exception 'Envie de 1 a 200 registros';
  end if;
  for r in select * from jsonb_array_elements(_registros) loop
    begin
      v_uuid := (r->>'app_uuid')::uuid;
      v_obra := (r->>'obra_id')::uuid;
      if v_uuid is null or v_obra is null then raise exception 'app_uuid e obra_id são obrigatórios'; end if;
      perform public.campo_assert(v_obra);
      select id, criado_por into v_id, v_dono from public.acompanhamento_producao where app_uuid = v_uuid and obra_id = v_obra;
      if v_id is not null and public.auth_role() in ('apoio', 'apontador') and v_dono is distinct from auth.uid() then
        raise exception 'Lançamento de outro usuário';
      end if;

      if coalesce((r->>'excluir')::boolean, false) then
        if v_id is not null then delete from public.acompanhamento_producao where id = v_id; end if;
        aceitos := aceitos || to_jsonb(v_uuid::text);
        continue;
      end if;

      v_controla := false; v_obrig := false; v_rec := null; v_unid := null;
      select true, material_obrigatorio, material_recurso_id, material_unidade
        into v_controla, v_obrig, v_rec, v_unid
        from public.servico_parametro
       where item_orcamentario_id = (r->>'item_orcamentario_id')::uuid and controla_material;
      v_controla := coalesce(v_controla, false);
      v_mat := nullif(r->>'material_qtd', '')::numeric;
      if v_controla and v_obrig and v_mat is null then
        raise exception 'Informe a quantidade de material aplicado';
      end if;

      if v_id is null then
        insert into public.acompanhamento_producao
          (app_uuid, obra_id, data, item_orcamentario_id, servico_nome, equipe_id, encarregado_id, quantidade,
           frente, estaca_inicial, estaca_final, trecho_id, posicao_inicio_m, posicao_fim_m, obs, origem)
        values
          (v_uuid, v_obra, (r->>'data')::date, (r->>'item_orcamentario_id')::uuid, '',
           nullif(r->>'equipe_id', '')::uuid, nullif(r->>'encarregado_id', '')::uuid,
           (r->>'quantidade')::numeric, nullif(r->>'frente', ''), nullif(r->>'estaca_inicial', ''),
           nullif(r->>'estaca_final', ''), nullif(r->>'trecho_id', '')::uuid,
           nullif(r->>'posicao_inicio_m', '')::numeric, nullif(r->>'posicao_fim_m', '')::numeric,
           nullif(r->>'obs', ''), 'campo')
        returning id into v_id;
      else
        update public.acompanhamento_producao set
          data = (r->>'data')::date, item_orcamentario_id = (r->>'item_orcamentario_id')::uuid,
          servico_id = null, servico_nome = '', unidade = null,
          equipe_id = nullif(r->>'equipe_id', '')::uuid, encarregado_id = nullif(r->>'encarregado_id', '')::uuid,
          quantidade = (r->>'quantidade')::numeric, frente = nullif(r->>'frente', ''),
          estaca_inicial = nullif(r->>'estaca_inicial', ''), estaca_final = nullif(r->>'estaca_final', ''),
          trecho_id = nullif(r->>'trecho_id', '')::uuid,
          posicao_inicio_m = nullif(r->>'posicao_inicio_m', '')::numeric,
          posicao_fim_m = nullif(r->>'posicao_fim_m', '')::numeric,
          obs = nullif(r->>'obs', '')
         where id = v_id;
      end if;

      delete from public.acompanhamento_producao_material where producao_id = v_id;
      if v_controla and v_mat is not null then
        insert into public.acompanhamento_producao_material (producao_id, recurso_id, nome, quantidade, unidade)
        values (v_id, v_rec, '', v_mat, v_unid);
      end if;
      aceitos := aceitos || to_jsonb(v_uuid::text);
    exception when others then
      get stacked diagnostics v_msg = message_text;
      rejeitados := rejeitados || jsonb_build_object('app_uuid', r->>'app_uuid', 'motivo', v_msg);
    end;
  end loop;
  return jsonb_build_object('aceitos', aceitos, 'rejeitados', rejeitados);
end $$;


--
-- Name: planejamento_referencia(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.planejamento_referencia(_obra_id uuid) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select id from public.planejamento
   where obra_id = _obra_id and is_baseline and vigente_em is not null
   order by vigente desc, vigente_em desc
   limit 1
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: acompanhamento_producao; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acompanhamento_producao (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    obra_id uuid NOT NULL,
    data date NOT NULL,
    item_orcamentario_id uuid,
    servico_id uuid,
    servico_nome text NOT NULL,
    unidade text,
    equipe_id uuid,
    encarregado_id uuid,
    quantidade numeric(14,4) NOT NULL,
    fator_conversao numeric(14,6) DEFAULT 1 NOT NULL,
    frente text,
    estaca_inicial text,
    estaca_final text,
    obs text,
    origem text DEFAULT 'app'::text NOT NULL,
    importacao_id uuid,
    criado_por uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    trecho_id uuid,
    posicao_inicio_m numeric(14,3),
    posicao_fim_m numeric(14,3),
    app_uuid uuid,
    CONSTRAINT chk_acomp_prod_fator CHECK ((fator_conversao > (0)::numeric)),
    CONSTRAINT chk_acomp_prod_origem CHECK ((origem = ANY (ARRAY['app'::text, 'importacao'::text, 'campo'::text, 'viagens'::text]))),
    CONSTRAINT chk_acomp_prod_qtd CHECK ((quantidade >= (0)::numeric))
);


--
-- Name: item_orcamentario; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_orcamentario (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    obra_id uuid NOT NULL,
    parent_id uuid,
    nivel smallint DEFAULT 1 NOT NULL,
    codigo text NOT NULL,
    descricao text NOT NULL,
    unidade text,
    servico_id uuid,
    quantidade numeric(14,4),
    venda_unitaria numeric(14,2),
    ordem integer DEFAULT 0 NOT NULL,
    custo_unitario_calc numeric(14,4),
    custo_total_calc numeric(14,2) DEFAULT 0 NOT NULL,
    venda_total_calc numeric(14,2) DEFAULT 0 NOT NULL,
    lucratividade_perc_calc numeric(7,4),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tipo text DEFAULT 'receita'::text NOT NULL,
    quantidade_referencia numeric(14,4),
    unidade_referencia text,
    qtd_ref_modo text,
    qtd_ref_filhos uuid[],
    indireto_id uuid,
    aditivo_id uuid,
    CONSTRAINT chk_item_orc_codigo CHECK (((codigo ~ '^[0-9]+(\.[0-9]+)*$'::text) OR ((tipo = 'servico_grupo'::text) AND (codigo ~ '^S[0-9]+$'::text)))),
    CONSTRAINT chk_item_orc_qtd_ref_modo CHECK (((qtd_ref_modo IS NULL) OR (qtd_ref_modo = ANY (ARRAY['manual'::text, 'heranca'::text, 'soma_filhos'::text])))),
    CONSTRAINT chk_item_orc_tipo CHECK ((tipo = ANY (ARRAY['etapa'::text, 'servico_grupo'::text, 'receita'::text]))),
    CONSTRAINT chk_item_orc_tipo_coerencia CHECK ((((tipo = 'receita'::text) AND (unidade IS NOT NULL) AND (quantidade IS NOT NULL) AND (venda_unitaria IS NOT NULL) AND (servico_id IS NULL) AND (indireto_id IS NULL) AND (quantidade_referencia IS NULL) AND (unidade_referencia IS NULL) AND (qtd_ref_modo IS NULL) AND (qtd_ref_filhos IS NULL)) OR ((tipo = 'servico_grupo'::text) AND (NOT ((servico_id IS NOT NULL) AND (indireto_id IS NOT NULL))) AND (quantidade_referencia IS NOT NULL) AND (qtd_ref_modo IS NOT NULL) AND ((unidade_referencia IS NOT NULL) OR ((servico_id IS NULL) AND (indireto_id IS NULL))) AND (unidade IS NULL) AND (quantidade IS NULL) AND (venda_unitaria IS NULL)) OR ((tipo = 'etapa'::text) AND (servico_id IS NULL) AND (indireto_id IS NULL) AND (quantidade_referencia IS NULL) AND (unidade_referencia IS NULL) AND (qtd_ref_modo IS NULL) AND (qtd_ref_filhos IS NULL) AND (unidade IS NULL) AND (quantidade IS NULL) AND (venda_unitaria IS NULL))))
);


--
-- Name: planejamento; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.planejamento (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    obra_id uuid NOT NULL,
    nome text NOT NULL,
    descricao text,
    is_baseline boolean DEFAULT false NOT NULL,
    status text DEFAULT 'rascunho'::text NOT NULL,
    data_referencia_inicio date NOT NULL,
    criado_por uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    data_date date,
    vigente boolean DEFAULT false NOT NULL,
    vigente_em timestamp with time zone,
    travada_em timestamp with time zone,
    premissa_calendario jsonb,
    recalculo_pendente boolean DEFAULT false NOT NULL,
    prazo date,
    calendario_id uuid,
    modo text DEFAULT 'programacao'::text NOT NULL,
    premissa_calendarios jsonb,
    premissa_tipos jsonb,
    dados_rev bigint DEFAULT 0 NOT NULL,
    calculo_rev bigint,
    calculado_em timestamp with time zone,
    calculo_aviso text,
    CONSTRAINT chk_planejamento_status CHECK ((status = ANY (ARRAY['rascunho'::text, 'ativo'::text]))),
    CONSTRAINT chk_planejamento_vigente_lb CHECK (((NOT vigente) OR is_baseline)),
    CONSTRAINT planejamento_modo_check CHECK ((modo = ANY (ARRAY['programacao'::text, 'controle'::text])))
);


--
-- Name: COLUMN planejamento.data_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.planejamento.data_date IS 'Status date / Data Date — fronteira entre passado executado e futuro replanejado. NULL = sem freeze (sempre replaneja).';


--
-- Name: COLUMN planejamento.prazo; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.planejamento.prazo IS 'Prazo do projeto (deadline do ApeX); null = sem prazo';


--
-- Name: COLUMN planejamento.calendario_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.planejamento.calendario_id IS 'Calendário padrão do plano; null = o padrão da obra';


--
-- Name: COLUMN planejamento.dados_rev; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.planejamento.dados_rev IS 'Revisão dos dados de entrada do cálculo (sobe a cada edição de tarefa, local, dependência, marco, limite ou equipe)';


--
-- Name: COLUMN planejamento.calculo_rev; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.planejamento.calculo_rev IS 'dados_rev do último cálculo gravado (igual = resultados atuais)';


--
-- Name: planejamento_tarefa; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.planejamento_tarefa (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    planejamento_id uuid NOT NULL,
    item_orcamentario_id uuid,
    data_inicio date,
    data_fim date,
    duracao_dias_uteis_calc numeric(12,2),
    notas text,
    ordem integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tipo_no text DEFAULT 'tarefa'::text NOT NULL,
    parent_id uuid,
    nivel smallint DEFAULT 1 NOT NULL,
    quantidade_alocada numeric(18,6),
    codigo_eap text,
    nome_custom text,
    is_critico boolean DEFAULT false NOT NULL,
    prioridade integer DEFAULT 500 NOT NULL,
    asap boolean DEFAULT false NOT NULL,
    inicio_dia boolean DEFAULT false NOT NULL,
    sentido text DEFAULT 'crescente'::text NOT NULL,
    restricao_inicio text,
    restricao_inicio_em timestamp without time zone,
    restricao_fim text,
    restricao_fim_em timestamp without time zone,
    coef_producao numeric(20,12) DEFAULT 1 NOT NULL,
    qtd_equipes smallint DEFAULT 1 NOT NULL,
    calendario_id uuid,
    derivar_predecessoras boolean DEFAULT true NOT NULL,
    aparencia jsonb,
    inicio_em timestamp without time zone,
    fim_em timestamp without time zone,
    folga_total_h numeric(14,4),
    folga_livre_h numeric(14,4),
    restricao_limite text,
    violacoes jsonb,
    CONSTRAINT chk_plan_tar_nivel CHECK (((nivel >= 1) AND (nivel <= 10))),
    CONSTRAINT chk_plan_tar_qtd_alocada_pos CHECK (((quantidade_alocada IS NULL) OR (quantidade_alocada > (0)::numeric))),
    CONSTRAINT chk_plan_tar_self_parent CHECK (((parent_id IS NULL) OR (parent_id <> id))),
    CONSTRAINT chk_plan_tar_tipo_no CHECK ((tipo_no = ANY (ARRAY['tarefa'::text, 'grupo'::text, 'marco'::text]))),
    CONSTRAINT chk_tarefa_restricao_fim CHECK (((restricao_fim IS NULL) = (restricao_fim_em IS NULL))),
    CONSTRAINT chk_tarefa_restricao_inicio CHECK (((restricao_inicio IS NULL) = (restricao_inicio_em IS NULL))),
    CONSTRAINT planejamento_tarefa_coef_producao_check CHECK ((coef_producao > (0)::numeric)),
    CONSTRAINT planejamento_tarefa_prioridade_check CHECK ((prioridade >= 0)),
    CONSTRAINT planejamento_tarefa_qtd_equipes_check CHECK (((qtd_equipes >= 1) AND (qtd_equipes <= 50))),
    CONSTRAINT planejamento_tarefa_restricao_fim_check CHECK ((restricao_fim = ANY (ARRAY['nao_depois'::text, 'exato'::text]))),
    CONSTRAINT planejamento_tarefa_restricao_inicio_check CHECK ((restricao_inicio = ANY (ARRAY['nao_antes'::text, 'exato'::text]))),
    CONSTRAINT planejamento_tarefa_sentido_check CHECK ((sentido = ANY (ARRAY['crescente'::text, 'decrescente'::text])))
);


--
-- Name: COLUMN planejamento_tarefa.item_orcamentario_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.planejamento_tarefa.item_orcamentario_id IS 'FK para item_orcamentario. NULL para tipo_no IN (grupo,marco). Trigger fn_tarefa_so_aceita_servico_grupo valida que tarefa-folha sempre tem item servico_grupo da mesma obra.';


--
-- Name: COLUMN planejamento_tarefa.tipo_no; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.planejamento_tarefa.tipo_no IS 'tarefa = folha-CPM (default); grupo = nó organizacional EAP sem cálculo; marco = evento sem duração';


--
-- Name: COLUMN planejamento_tarefa.quantidade_alocada; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.planejamento_tarefa.quantidade_alocada IS 'Quantidade alocada nesta tarefa (folha). NULL para grupo/marco. Soma por (planejamento_id, item_orcamentario_id) ≤ item.quantidade_referencia';


--
-- Name: COLUMN planejamento_tarefa.is_critico; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.planejamento_tarefa.is_critico IS 'true quando total_float ≤ 0 (tolerância 0 dia útil). Populado pela edge function calcular-cronograma.';


--
-- Name: COLUMN planejamento_tarefa.asap; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.planejamento_tarefa.asap IS 'O mais cedo possível (m_bASAP): começa no início do projeto ou quando as dependências permitem; desligado, mantém o início atual';


--
-- Name: COLUMN planejamento_tarefa.coef_producao; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.planejamento_tarefa.coef_producao IS 'Coeficiente da taxa de produção (m_dWachCoeff)';


--
-- Name: COLUMN planejamento_tarefa.qtd_equipes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.planejamento_tarefa.qtd_equipes IS 'Equipes (composições) trabalhando juntas: recursos e taxa multiplicados';


--
-- Name: planejamento_tarefa_perfil_dia; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.planejamento_tarefa_perfil_dia (
    tarefa_id uuid NOT NULL,
    dia date NOT NULL,
    quantidade numeric(18,6) NOT NULL
);


--
-- Name: planejamento_tarefa_perfil_semana; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.planejamento_tarefa_perfil_semana (
    tarefa_id uuid NOT NULL,
    semana_segunda date NOT NULL,
    quantidade_planejada numeric(18,6) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_ptps_qtd_nao_neg CHECK ((quantidade_planejada >= (0)::numeric)),
    CONSTRAINT chk_ptps_segunda CHECK ((EXTRACT(isodow FROM semana_segunda) = (1)::numeric))
);


--
-- Name: vw_acompanhamento_curva_s; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_acompanhamento_curva_s WITH (security_invoker='true') AS
 WITH baseline_meta AS (
         SELECT pl.obra_id,
            pt.item_orcamentario_id AS item_id,
            io.codigo,
            io.descricao,
            (sum(pt.quantidade_alocada))::numeric(14,4) AS qtd_plan
           FROM ((public.planejamento pl
             JOIN public.planejamento_tarefa pt ON ((pt.planejamento_id = pl.id)))
             JOIN public.item_orcamentario io ON ((io.id = pt.item_orcamentario_id)))
          WHERE ((pl.id = public.planejamento_referencia(pl.obra_id)) AND (pt.quantidade_alocada IS NOT NULL))
          GROUP BY pl.obra_id, pt.item_orcamentario_id, io.codigo, io.descricao
        ), planejado_dia_raw AS (
         SELECT pl.obra_id,
            pt.item_orcamentario_id AS item_id,
            pd.dia AS data,
            pd.quantidade AS planejado_dia
           FROM ((public.planejamento pl
             JOIN public.planejamento_tarefa pt ON ((pt.planejamento_id = pl.id)))
             JOIN public.planejamento_tarefa_perfil_dia pd ON ((pd.tarefa_id = pt.id)))
          WHERE (pl.id = public.planejamento_referencia(pl.obra_id))
        UNION ALL
         SELECT pl.obra_id,
            pt.item_orcamentario_id,
            ((ps.semana_segunda + ((i.i || ' days'::text))::interval))::date AS date,
            (ps.quantidade_planejada / 5.0)
           FROM (((public.planejamento pl
             JOIN public.planejamento_tarefa pt ON ((pt.planejamento_id = pl.id)))
             JOIN public.planejamento_tarefa_perfil_semana ps ON ((ps.tarefa_id = pt.id)))
             CROSS JOIN generate_series(0, 4) i(i))
          WHERE ((pl.id = public.planejamento_referencia(pl.obra_id)) AND (NOT (EXISTS ( SELECT 1
                   FROM public.planejamento_tarefa_perfil_dia x
                  WHERE (x.tarefa_id = pt.id)))))
        ), real_dia AS (
         SELECT p.obra_id,
            p.item_orcamentario_id AS item_id,
            p.data,
            sum((p.quantidade * p.fator_conversao)) AS qtd
           FROM public.acompanhamento_producao p
          WHERE (p.item_orcamentario_id IS NOT NULL)
          GROUP BY p.obra_id, p.item_orcamentario_id, p.data
        ), todos_pares AS (
         SELECT planejado_dia_raw.obra_id,
            planejado_dia_raw.item_id,
            planejado_dia_raw.data
           FROM planejado_dia_raw
        UNION
         SELECT real_dia.obra_id,
            real_dia.item_id,
            real_dia.data
           FROM real_dia
        ), agregado AS (
         SELECT tp.obra_id,
            tp.item_id,
            tp.data,
            COALESCE(( SELECT sum(pp.planejado_dia) AS sum
                   FROM planejado_dia_raw pp
                  WHERE ((pp.obra_id = tp.obra_id) AND (pp.item_id = tp.item_id) AND (pp.data = tp.data))), (0)::numeric) AS planejado_dia,
            COALESCE(( SELECT rd.qtd
                   FROM real_dia rd
                  WHERE ((rd.obra_id = tp.obra_id) AND (rd.item_id = tp.item_id) AND (rd.data = tp.data))), (0)::numeric) AS realizado_dia
           FROM todos_pares tp
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
   FROM (agregado a
     LEFT JOIN baseline_meta bm ON (((bm.obra_id = a.obra_id) AND (bm.item_id = a.item_id))));


--
-- Name: cliente_curva_s(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cliente_curva_s(_obra_id uuid) RETURNS SETOF public.vw_acompanhamento_curva_s
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select v.* from public.vw_acompanhamento_curva_s v
   where v.obra_id = _obra_id and public.has_obra_permissao(_obra_id, auth.uid())
$$;


--
-- Name: cpu; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cpu (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    servico_id uuid,
    versao integer DEFAULT 1 NOT NULL,
    producao_diaria_qtde numeric(14,4) DEFAULT 1 NOT NULL,
    producao_diaria_unidade text DEFAULT 'DIA'::text NOT NULL,
    encargos_sociais_id uuid,
    notas text,
    custo_eq_dia_calc numeric(14,4) DEFAULT 0 NOT NULL,
    custo_comb_dia_calc numeric(14,4) DEFAULT 0 NOT NULL,
    custo_mo_dia_calc numeric(14,4) DEFAULT 0 NOT NULL,
    custo_mat_dia_calc numeric(14,4) DEFAULT 0 NOT NULL,
    custo_unit_calc numeric(14,4) DEFAULT 0 NOT NULL,
    is_vigente boolean DEFAULT true NOT NULL,
    criado_por uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    obra_id uuid NOT NULL,
    nome text
);


--
-- Name: COLUMN cpu.nome; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.cpu.nome IS 'Nome legível da CPU, independente do servico-dono. NULL = sem nome explícito (UI usa fallback).';


--
-- Name: servico; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.servico (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    codigo text NOT NULL,
    nome text NOT NULL,
    parent_id uuid,
    nivel smallint DEFAULT 1 NOT NULL,
    unidade text,
    ativo boolean DEFAULT true NOT NULL,
    descricao text,
    referencia_externa text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    obra_id uuid NOT NULL,
    producao_diaria_qtde numeric(14,4),
    producao_diaria_unidade text
);


--
-- Name: COLUMN servico.producao_diaria_qtde; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.servico.producao_diaria_qtde IS 'Produção diária do servico-agregador. NULL = herda da 1ª CPU vinculada.';


--
-- Name: servico_cpu_link; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.servico_cpu_link (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    servico_id uuid NOT NULL,
    cpu_id uuid NOT NULL,
    fator numeric(14,6) DEFAULT 1.0 NOT NULL,
    ordem integer DEFAULT 0 NOT NULL,
    observacao text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    operacao text DEFAULT 'dividir'::text NOT NULL,
    CONSTRAINT chk_servico_cpu_link_operacao CHECK ((operacao = ANY (ARRAY['dividir'::text, 'multiplicar'::text])))
);


--
-- Name: TABLE servico_cpu_link; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.servico_cpu_link IS 'Vínculo N:N entre servico-agregador e CPUs. fator é divisor: custo_servico_unit = cpu.custo_unit / fator (fator = qtd unidades-CPU em 1 unidade-servico).';


--
-- Name: COLUMN servico_cpu_link.fator; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.servico_cpu_link.fator IS 'Divisor de conversão de unidade. Custo no servico = cpu.custo_unit / fator. Ex: CPU em m³, servico em ton, densidade 2.4 → fator = 2.4 (custo/m³ ÷ 2.4 = custo/ton). Default 1.0 quando unidades batem.';


--
-- Name: COLUMN servico_cpu_link.operacao; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.servico_cpu_link.operacao IS 'Operação aplicada com o fator. "dividir" (default): custo_link = cpu.custo_unit / fator. "multiplicar": custo_link = cpu.custo_unit * fator.';


--
-- Name: vw_servico_vivo; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_servico_vivo WITH (security_invoker='true') AS
 WITH lk AS (
         SELECT l.servico_id,
            l.ordem,
            l.cpu_id,
            c.producao_diaria_qtde,
            c.producao_diaria_unidade,
                CASE
                    WHEN ((l.fator IS NULL) OR (l.fator = (0)::numeric)) THEN (0)::numeric
                    WHEN (l.operacao = 'multiplicar'::text) THEN l.fator
                    ELSE ((1)::numeric / l.fator)
                END AS k,
            c.custo_unit_calc,
            c.custo_eq_dia_calc,
            c.custo_comb_dia_calc,
            c.custo_mo_dia_calc,
            c.custo_mat_dia_calc
           FROM (public.servico_cpu_link l
             JOIN public.cpu c ON ((c.id = l.cpu_id)))
        ), agg AS (
         SELECT lk.servico_id,
            count(*) AS n,
            sum((lk.custo_unit_calc * lk.k)) AS custo_unit,
            sum((lk.custo_eq_dia_calc * lk.k)) AS eq,
            sum((lk.custo_comb_dia_calc * lk.k)) AS comb,
            sum((lk.custo_mo_dia_calc * lk.k)) AS mo,
            sum((lk.custo_mat_dia_calc * lk.k)) AS mat,
            (array_agg(lk.producao_diaria_qtde ORDER BY lk.ordem, lk.cpu_id))[1] AS prod,
            (array_agg(lk.producao_diaria_unidade ORDER BY lk.ordem, lk.cpu_id))[1] AS prod_un,
            (array_agg(lk.cpu_id ORDER BY lk.ordem, lk.cpu_id))[1] AS cpu1
           FROM lk
          GROUP BY lk.servico_id
        )
 SELECT s.id AS servico_id,
    s.obra_id,
    COALESCE(agg.cpu1, cv.id) AS cpu_id,
    (
        CASE
            WHEN (agg.n > 0) THEN agg.custo_unit
            ELSE cv.custo_unit_calc
        END)::numeric(14,4) AS custo_unit,
    (
        CASE
            WHEN (agg.n > 0) THEN COALESCE(s.producao_diaria_qtde, agg.prod)
            ELSE cv.producao_diaria_qtde
        END)::numeric(14,4) AS producao_diaria_qtde,
        CASE
            WHEN (agg.n > 0) THEN COALESCE(s.producao_diaria_unidade, agg.prod_un, 'DIA'::text)
            ELSE cv.producao_diaria_unidade
        END AS producao_diaria_unidade,
    (
        CASE
            WHEN (agg.n > 0) THEN agg.eq
            ELSE cv.custo_eq_dia_calc
        END)::numeric(14,4) AS custo_eq_dia,
    (
        CASE
            WHEN (agg.n > 0) THEN agg.comb
            ELSE cv.custo_comb_dia_calc
        END)::numeric(14,4) AS custo_comb_dia,
    (
        CASE
            WHEN (agg.n > 0) THEN agg.mo
            ELSE cv.custo_mo_dia_calc
        END)::numeric(14,4) AS custo_mo_dia,
    (
        CASE
            WHEN (agg.n > 0) THEN agg.mat
            ELSE cv.custo_mat_dia_calc
        END)::numeric(14,4) AS custo_mat_dia,
        CASE
            WHEN (agg.n > 0) THEN 'agregador'::text
            ELSE 'legado'::text
        END AS modo
   FROM ((public.servico s
     LEFT JOIN agg ON ((agg.servico_id = s.id)))
     LEFT JOIN public.cpu cv ON (((cv.servico_id = s.id) AND cv.is_vigente AND (COALESCE(agg.n, (0)::bigint) = 0))));


--
-- Name: vw_acompanhamento_previsto_x_realizado; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_acompanhamento_previsto_x_realizado WITH (security_invoker='true') AS
 WITH baseline AS (
         SELECT pl.obra_id,
            (min((pt.id)::text))::uuid AS tarefa_id,
            pt.item_orcamentario_id AS item_id,
            min(pt.data_inicio) AS data_inicio,
            max(pt.data_fim) AS data_fim,
            io.codigo AS servico_grupo_codigo,
            io.descricao AS servico_grupo_descricao,
            (sum(pt.quantidade_alocada))::numeric(14,4) AS quantidade_planejada,
            io.unidade_referencia AS unidade,
            snap.producao_diaria_qtde AS producao_diaria_cpu,
                CASE
                    WHEN (COALESCE(sum(pt.duracao_dias_uteis_calc), (0)::numeric) > (0)::numeric) THEN ((sum(pt.quantidade_alocada) / sum(pt.duracao_dias_uteis_calc)))::numeric(14,4)
                    ELSE NULL::numeric
                END AS producao_diaria_plan
           FROM (((public.planejamento pl
             JOIN public.planejamento_tarefa pt ON ((pt.planejamento_id = pl.id)))
             JOIN public.item_orcamentario io ON ((io.id = pt.item_orcamentario_id)))
             LEFT JOIN public.vw_servico_vivo snap ON ((snap.servico_id = io.servico_id)))
          WHERE ((pl.id = public.planejamento_referencia(pl.obra_id)) AND (io.indireto_id IS NULL))
          GROUP BY pl.obra_id, pt.item_orcamentario_id, io.codigo, io.descricao, io.unidade_referencia, snap.producao_diaria_qtde
        ), plan_periodo AS (
         SELECT x.obra_id,
            x.item_id,
            (sum(x.q))::numeric(14,4) AS qtd_plan_periodo
           FROM ( SELECT pl.obra_id,
                    pt.item_orcamentario_id AS item_id,
                    pd.quantidade AS q
                   FROM ((public.planejamento pl
                     JOIN public.planejamento_tarefa pt ON ((pt.planejamento_id = pl.id)))
                     JOIN public.planejamento_tarefa_perfil_dia pd ON ((pd.tarefa_id = pt.id)))
                  WHERE ((pl.id = public.planejamento_referencia(pl.obra_id)) AND (pd.dia <= CURRENT_DATE))
                UNION ALL
                 SELECT pl.obra_id,
                    pt.item_orcamentario_id,
                    ((ps.quantidade_planejada / 5.0) * (LEAST(5, GREATEST(0, ((CURRENT_DATE - ps.semana_segunda) + 1))))::numeric)
                   FROM ((public.planejamento pl
                     JOIN public.planejamento_tarefa pt ON ((pt.planejamento_id = pl.id)))
                     JOIN public.planejamento_tarefa_perfil_semana ps ON ((ps.tarefa_id = pt.id)))
                  WHERE ((pl.id = public.planejamento_referencia(pl.obra_id)) AND (NOT (EXISTS ( SELECT 1
                           FROM public.planejamento_tarefa_perfil_dia y
                          WHERE (y.tarefa_id = pt.id)))))) x
          GROUP BY x.obra_id, x.item_id
        ), realizado AS (
         SELECT p.obra_id,
            p.item_orcamentario_id AS item_id,
            sum((p.quantidade * p.fator_conversao)) AS quantidade_realizada,
            count(DISTINCT p.data) AS dias_realizado,
            min(p.data) AS data_primeira,
            max(p.data) AS data_ultima
           FROM public.acompanhamento_producao p
          WHERE (p.item_orcamentario_id IS NOT NULL)
          GROUP BY p.obra_id, p.item_orcamentario_id
        )
 SELECT b.obra_id,
    b.tarefa_id,
    b.item_id AS item_orcamentario_id,
    b.servico_grupo_codigo AS codigo,
    b.servico_grupo_descricao AS descricao,
    b.unidade,
    b.quantidade_planejada AS qtd_plan,
    COALESCE(r.quantidade_realizada, (0)::numeric) AS qtd_real,
        CASE
            WHEN ((b.quantidade_planejada IS NULL) OR (b.quantidade_planejada = (0)::numeric)) THEN NULL::numeric
            ELSE round((COALESCE(r.quantidade_realizada, (0)::numeric) / b.quantidade_planejada), 4)
        END AS pct_avanco,
    b.data_inicio AS data_inicio_plan,
    b.data_fim AS data_fim_plan,
        CASE
            WHEN ((b.data_fim IS NULL) OR (b.data_inicio IS NULL)) THEN NULL::integer
            ELSE GREATEST(1, ((b.data_fim - b.data_inicio) + 1))
        END AS dias_plan,
    r.dias_realizado AS dias_real,
    r.data_primeira AS data_primeira_realizacao,
    r.data_ultima AS data_ultima_realizacao,
        CASE
            WHEN ((b.quantidade_planejada IS NULL) OR (b.quantidade_planejada = (0)::numeric)) THEN NULL::numeric
            ELSE LEAST((1)::numeric, round((COALESCE(pp.qtd_plan_periodo, (0)::numeric) / b.quantidade_planejada), 4))
        END AS pct_esperado_hoje,
        CASE
            WHEN (b.data_fim IS NULL) THEN NULL::integer
            WHEN (r.data_ultima IS NULL) THEN NULL::integer
            WHEN ((COALESCE(b.producao_diaria_plan, b.producao_diaria_cpu) IS NULL) OR (COALESCE(b.producao_diaria_plan, b.producao_diaria_cpu) = (0)::numeric)) THEN NULL::integer
            ELSE (b.data_fim - (r.data_ultima + (ceil((GREATEST((0)::numeric, (b.quantidade_planejada - COALESCE(r.quantidade_realizada, (0)::numeric))) / COALESCE(b.producao_diaria_plan, b.producao_diaria_cpu))))::integer))
        END AS desvio_dias_estimado,
        CASE
            WHEN (b.quantidade_planejada IS NULL) THEN 'sem_plano'::text
            WHEN (r.quantidade_realizada IS NULL) THEN 'nao_iniciado'::text
            WHEN (r.quantidade_realizada >= b.quantidade_planejada) THEN 'concluido'::text
            WHEN ((b.data_inicio IS NULL) OR (b.data_fim IS NULL)) THEN 'em_andamento'::text
            WHEN (CURRENT_DATE > b.data_fim) THEN 'atrasado'::text
            WHEN (COALESCE(pp.qtd_plan_periodo, (0)::numeric) <= (0)::numeric) THEN 'em_andamento'::text
            ELSE
            CASE
                WHEN ((COALESCE(r.quantidade_realizada, (0)::numeric) / NULLIF(pp.qtd_plan_periodo, (0)::numeric)) >= 1.05) THEN 'adiantado'::text
                WHEN ((COALESCE(r.quantidade_realizada, (0)::numeric) / NULLIF(pp.qtd_plan_periodo, (0)::numeric)) < 0.7) THEN 'atrasado'::text
                WHEN ((COALESCE(r.quantidade_realizada, (0)::numeric) / NULLIF(pp.qtd_plan_periodo, (0)::numeric)) < 0.95) THEN 'em_risco'::text
                ELSE 'no_prazo'::text
            END
        END AS status,
    COALESCE(pp.qtd_plan_periodo, (0)::numeric) AS qtd_plan_periodo,
    COALESCE(b.producao_diaria_plan, b.producao_diaria_cpu) AS producao_diaria_plan
   FROM ((baseline b
     LEFT JOIN plan_periodo pp ON (((pp.obra_id = b.obra_id) AND (pp.item_id = b.item_id))))
     LEFT JOIN realizado r ON (((r.obra_id = b.obra_id) AND (r.item_id = b.item_id))));


--
-- Name: cliente_previsto_realizado(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cliente_previsto_realizado(_obra_id uuid) RETURNS SETOF public.vw_acompanhamento_previsto_x_realizado
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select v.* from public.vw_acompanhamento_previsto_x_realizado v
   where v.obra_id = _obra_id and public.has_obra_permissao(_obra_id, auth.uid())
$$;


--
-- Name: acompanhamento_foto; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acompanhamento_foto (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    obra_id uuid NOT NULL,
    producao_id uuid,
    item_orcamentario_id uuid,
    servico_nome text,
    encarregado_id uuid,
    lat numeric(10,6),
    lng numeric(10,6),
    captured_at timestamp with time zone,
    storage_bucket text DEFAULT 'acompanhamento-fotos'::text NOT NULL,
    storage_key text NOT NULL,
    mime text,
    size_bytes bigint,
    width integer,
    height integer,
    obs text,
    enviado_por uuid,
    excluida_em timestamp with time zone,
    excluida_por uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    app_uuid uuid
);


--
-- Name: acompanhamento_producao_material; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acompanhamento_producao_material (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    producao_id uuid NOT NULL,
    nome text NOT NULL,
    quantidade numeric(14,4),
    unidade text,
    recurso_id uuid
);


--
-- Name: encarregado; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.encarregado (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    obra_id uuid NOT NULL,
    nome text NOT NULL,
    apelido text,
    telefone text,
    ativo boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: equipe; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.equipe (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    obra_id uuid NOT NULL,
    nome text NOT NULL,
    tipo text NOT NULL,
    cor text DEFAULT '#3b82f6'::text NOT NULL,
    ativo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    is_sistema boolean DEFAULT false NOT NULL,
    ordem integer DEFAULT 0 NOT NULL,
    encarregado_id uuid,
    CONSTRAINT chk_equipe_cor_hex CHECK ((cor ~ '^#[0-9a-fA-F]{6}$'::text))
);


--
-- Name: obra_trecho; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.obra_trecho (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    obra_id uuid NOT NULL,
    nome text NOT NULL,
    ordem integer DEFAULT 0 NOT NULL,
    cor text DEFAULT '#3b82f6'::text NOT NULL,
    unidade_espaco_padrao text DEFAULT 'km'::text NOT NULL,
    unidade_custom_label text,
    unidade_custom_divisor_m numeric(10,3),
    marcador_valor_inicial numeric(12,3) DEFAULT 0 NOT NULL,
    geometry_geojson jsonb,
    geometry_bounds jsonb,
    geometry_comprimento_m numeric(14,2),
    geometry_sentido text DEFAULT 'natural'::text NOT NULL,
    geometry_importado_em timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tipo text DEFAULT 'eixo'::text NOT NULL,
    comprimento_m numeric(14,2),
    CONSTRAINT chk_obra_trecho_comprimento CHECK ((((tipo = 'area'::text) AND (comprimento_m IS NULL)) OR ((tipo = 'eixo'::text) AND (comprimento_m > (0)::numeric)))),
    CONSTRAINT chk_obra_trecho_custom CHECK (((unidade_espaco_padrao <> 'custom'::text) OR ((COALESCE(TRIM(BOTH FROM unidade_custom_label), ''::text) <> ''::text) AND (COALESCE(unidade_custom_divisor_m, (0)::numeric) > (0)::numeric)))),
    CONSTRAINT chk_obra_trecho_tipo CHECK ((tipo = ANY (ARRAY['eixo'::text, 'area'::text]))),
    CONSTRAINT obra_trecho_cor_check CHECK ((cor ~ '^#[0-9a-fA-F]{6}$'::text)),
    CONSTRAINT obra_trecho_geometry_sentido_check CHECK ((geometry_sentido = ANY (ARRAY['natural'::text, 'invertido'::text]))),
    CONSTRAINT obra_trecho_nome_check CHECK ((TRIM(BOTH FROM nome) <> ''::text)),
    CONSTRAINT obra_trecho_unidade_espaco_padrao_check CHECK ((unidade_espaco_padrao = ANY (ARRAY['km'::text, 'm'::text, 'estaca'::text, 'custom'::text])))
);


--
-- Name: COLUMN obra_trecho.tipo; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.obra_trecho.tipo IS 'eixo = estaqueamento linear (road line do ApeX); area = local sem estacas (area do ApeX)';


--
-- Name: COLUMN obra_trecho.comprimento_m; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.obra_trecho.comprimento_m IS 'Eixo: estação final em metros internos (0…comprimento). Com KML é copiado de geometry_comprimento_m; sem KML é digitado.';


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    email text NOT NULL,
    nome text NOT NULL,
    role public.role_enum NOT NULL,
    empresa_id uuid,
    engenheiro_id uuid,
    ativo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    acessos_count integer DEFAULT 0 NOT NULL,
    last_access_at timestamp with time zone,
    last_seen_at timestamp with time zone,
    whatsapp text,
    CONSTRAINT chk_apoio_has_engenheiro CHECK ((((role = 'apoio'::public.role_enum) AND (engenheiro_id IS NOT NULL)) OR ((role <> 'apoio'::public.role_enum) AND (engenheiro_id IS NULL)))),
    CONSTRAINT chk_god_no_empresa CHECK ((((role = 'god'::public.role_enum) AND (empresa_id IS NULL)) OR ((role <> 'god'::public.role_enum) AND (empresa_id IS NOT NULL))))
);


--
-- Name: COLUMN profiles.whatsapp; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.profiles.whatsapp IS 'Número de WhatsApp do usuário (dígitos, formato internacional). Usado pelo RAG do módulo WhatsApp para casar remetente↔usuário.';


--
-- Name: vw_acompanhamento_producao_enriquecida; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_acompanhamento_producao_enriquecida WITH (security_invoker='true') AS
 SELECT p.id,
    p.obra_id,
    p.data,
    p.item_orcamentario_id,
    p.servico_id,
    p.servico_id AS servico_planejamento_id,
    p.servico_nome,
    p.quantidade AS qtd,
    ((p.quantidade * p.fator_conversao))::numeric(14,4) AS qtd_convertida,
    p.fator_conversao,
    p.unidade,
    COALESCE(s.unidade, io.unidade_referencia, p.unidade) AS unidade_plano,
    COALESCE(NULLIF(TRIM(BOTH FROM p.frente), ''::text), '(sem frente)'::text) AS frente,
    p.frente AS frente_raw,
    p.estaca_inicial,
    p.estaca_final,
    p.obs,
    p.origem,
    p.importacao_id,
    p.criado_por,
    pr.nome AS criado_por_nome,
    p.created_at,
    p.updated_at,
    p.equipe_id,
    p.equipe_id AS equipe_planejamento_id,
    COALESCE(e.nome, '—'::text) AS equipe_display_nome,
    COALESCE(e.cor, '#94a3b8'::text) AS equipe_display_cor,
    e.tipo AS equipe_tipo,
    p.encarregado_id,
    COALESCE(en.apelido, en.nome) AS encarregado_display_nome,
    s.codigo AS servico_codigo,
    COALESCE(s.nome, p.servico_nome) AS servico_display_nome,
    s.unidade AS servico_unidade,
    io.codigo AS servico_grupo_codigo,
    io.descricao AS servico_grupo_descricao,
    pta.tarefa_id AS tarefa_baseline_id,
    pta.data_inicio AS tarefa_data_inicio,
    pta.data_fim AS tarefa_data_fim,
    ( SELECT count(*) AS count
           FROM public.acompanhamento_foto f
          WHERE ((f.producao_id = p.id) AND (f.excluida_em IS NULL))) AS fotos_count,
    p.trecho_id,
    p.posicao_inicio_m,
    p.posicao_fim_m,
    tr.nome AS trecho_nome,
    tr.tipo AS trecho_tipo,
    ( SELECT string_agg(TRIM(BOTH FROM concat_ws(' '::text, to_char(m.quantidade, 'FM999999990.####'::text), m.unidade, m.nome)), '; '::text ORDER BY m.nome) AS string_agg
           FROM public.acompanhamento_producao_material m
          WHERE (m.producao_id = p.id)) AS material_resumo,
    p.app_uuid
   FROM ((((((((public.acompanhamento_producao p
     LEFT JOIN public.equipe e ON ((e.id = p.equipe_id)))
     LEFT JOIN public.encarregado en ON ((en.id = p.encarregado_id)))
     LEFT JOIN public.item_orcamentario io ON ((io.id = p.item_orcamentario_id)))
     LEFT JOIN public.servico s ON ((s.id = p.servico_id)))
     LEFT JOIN public.profiles pr ON ((pr.id = p.criado_por)))
     LEFT JOIN public.obra_trecho tr ON ((tr.id = p.trecho_id)))
     LEFT JOIN public.planejamento pl ON (((pl.obra_id = p.obra_id) AND (pl.id = public.planejamento_referencia(p.obra_id)))))
     LEFT JOIN ( SELECT pt.planejamento_id,
            pt.item_orcamentario_id,
            min(pt.data_inicio) AS data_inicio,
            max(pt.data_fim) AS data_fim,
            (array_agg(pt.id ORDER BY pt.data_inicio))[1] AS tarefa_id
           FROM public.planejamento_tarefa pt
          WHERE (pt.item_orcamentario_id IS NOT NULL)
          GROUP BY pt.planejamento_id, pt.item_orcamentario_id) pta ON (((pta.planejamento_id = pl.id) AND (pta.item_orcamentario_id = p.item_orcamentario_id))));


--
-- Name: cliente_producao(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cliente_producao(_obra_id uuid) RETURNS SETOF public.vw_acompanhamento_producao_enriquecida
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select v.* from public.vw_acompanhamento_producao_enriquecida v
   where v.obra_id = _obra_id and public.has_obra_permissao(_obra_id, auth.uid())
$$;


--
-- Name: cpu_obra(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cpu_obra(_cpu_id uuid) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select obra_id from public.cpu where id = _cpu_id
$$;


--
-- Name: criar_tarefa_indireta(uuid, uuid, jsonb, uuid, text, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.criar_tarefa_indireta(p_planejamento_id uuid, p_item_orcamentario_id uuid, p_indireto_config jsonb, p_parent_id uuid DEFAULT NULL::uuid, p_nome_custom text DEFAULT NULL::text, p_ordem integer DEFAULT 0, p_notas text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
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


--
-- Name: FUNCTION criar_tarefa_indireta(p_planejamento_id uuid, p_item_orcamentario_id uuid, p_indireto_config jsonb, p_parent_id uuid, p_nome_custom text, p_ordem integer, p_notas text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.criar_tarefa_indireta(p_planejamento_id uuid, p_item_orcamentario_id uuid, p_indireto_config jsonb, p_parent_id uuid, p_nome_custom text, p_ordem integer, p_notas text) IS 'Cria atômicamente uma tarefa + planejamento_tarefa_indireto. Item orçamentário deve ter indireto_id. Retorna o tarefa_id.';


--
-- Name: definir_data_base(uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.definir_data_base(_obra_id uuid, _data date) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.pode_editar_orcamento(_obra_id) then raise exception 'Sem permissão'; end if;
  if exists (select 1 from public.orcamento_reajuste where obra_id = _obra_id and status = 'aplicado') then
    raise exception 'Já há reajuste aplicado — a data-base não pode mudar';
  end if;
  update public.obras set data_base_orcamento = _data where id = _obra_id;
end $$;


--
-- Name: desmarcar_vigente(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.desmarcar_vigente(_obra_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.pode_planejar_obra(_obra_id) then raise exception 'Sem permissão'; end if;
  update public.planejamento set vigente = false where obra_id = _obra_id and vigente;
end $$;


--
-- Name: diagnostico_cron(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.diagnostico_cron() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare r jsonb;
begin
  if public.auth_role() is distinct from 'god' then raise exception 'Só o god consulta o diagnóstico'; end if;
  select jsonb_build_object(
    'jobs', coalesce((select jsonb_agg(jsonb_build_object('nome', jobname, 'agenda', schedule, 'ativo', active))
                        from cron.job), '[]'::jsonb),
    'ultimas', coalesce((select jsonb_agg(x) from (
                 select jsonb_build_object('status', d.status, 'inicio', d.start_time, 'fim', d.end_time,
                                           'mensagem', left(d.return_message, 300)) as x
                   from cron.job_run_details d order by d.start_time desc limit 10) t), '[]'::jsonb),
    'segredos', coalesce((select jsonb_agg(name order by name) from vault.secrets
                           where name in ('project_url', 'service_role_key')), '[]'::jsonb),
    'respostas_http', coalesce((select jsonb_agg(x) from (
                 select jsonb_build_object('status', status_code, 'criado', created, 'erro', left(error_msg, 200),
                                           'corpo', left(content::text, 200)) as x
                   from net._http_response order by created desc limit 5) t), '[]'::jsonb)
  ) into r;
  return r;
end $$;


--
-- Name: excluindo_obra(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.excluindo_obra() RETURNS boolean
    LANGUAGE sql STABLE
    AS $$ select coalesce(current_setting('infrawork.excluindo_obra', true), '') = '1' $$;


--
-- Name: excluir_obra(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.excluir_obra(_obra_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform set_config('infrawork.excluindo_obra', '1', true);
  -- ordem: as chaves NO ACTION entre ramos da cascata (tarefa → equipe, item de CPU → recurso, item do orçamento →
  -- serviço, viagem → item) são conferidas no fim de cada comando aninhado da cascata
  delete from public.viagem_ficha where obra_id = _obra_id;
  delete from public.planejamento where obra_id = _obra_id;
  delete from public.cpu where obra_id = _obra_id;
  delete from public.item_orcamentario where obra_id = _obra_id;
  delete from public.obras where id = _obra_id;
  perform set_config('infrawork.excluindo_obra', '', true);
end $$;


--
-- Name: fleethub_credencial(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fleethub_credencial(_empresa_id uuid) RETURNS TABLE(email text, senha text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select c.email, s.decrypted_secret
    from public.fleethub_config c
    join vault.decrypted_secrets s on s.id = c.secret_id
   where c.empresa_id = _empresa_id
$$;


--
-- Name: fleethub_gravar_credencial(uuid, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fleethub_gravar_credencial(_empresa_id uuid, _email text, _senha text, _por uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_secret uuid;
begin
  select secret_id into v_secret from public.fleethub_config where empresa_id = _empresa_id;
  if v_secret is null then
    v_secret := vault.create_secret(_senha, 'fleethub_' || _empresa_id::text, 'Senha da FleetHub da empresa');
  else
    perform vault.update_secret(v_secret, _senha);
  end if;
  insert into public.fleethub_config (empresa_id, email, secret_id, conectado_em, conectado_por)
  values (_empresa_id, lower(trim(_email)), v_secret, now(), _por)
  on conflict (empresa_id) do update
    set email = excluded.email, secret_id = excluded.secret_id, conectado_em = now(), conectado_por = excluded.conectado_por;
end $$;


--
-- Name: fleethub_remover_credencial(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fleethub_remover_credencial(_empresa_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_secret uuid;
begin
  delete from public.fleethub_config where empresa_id = _empresa_id returning secret_id into v_secret;
  if v_secret is not null then delete from vault.secrets where id = v_secret; end if;
end $$;


--
-- Name: fn_acomp_foto_before_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_acomp_foto_before_insert() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if new.producao_id is not null then
    select p.obra_id, p.item_orcamentario_id, p.servico_nome, p.encarregado_id
      into new.obra_id, new.item_orcamentario_id, new.servico_nome, new.encarregado_id
      from public.acompanhamento_producao p
     where p.id = new.producao_id;
    if new.obra_id is null then raise exception 'Lançamento inexistente'; end if;
  end if;
  if new.captured_at is null then new.captured_at := now(); end if;
  new.enviado_por := coalesce(new.enviado_por, auth.uid());
  return new;
end $$;


--
-- Name: fn_acomp_foto_update_whitelist(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_acomp_foto_update_whitelist() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if public.auth_role() in ('god', 'adm') or auth.uid() is null then
    return new;
  end if;
  if new.storage_key <> old.storage_key or new.producao_id is distinct from old.producao_id
     or new.obra_id <> old.obra_id or new.excluida_em is distinct from old.excluida_em
     or new.lat is distinct from old.lat or new.lng is distinct from old.lng
     or new.captured_at is distinct from old.captured_at then
    raise exception 'Só a observação da foto pode ser alterada';
  end if;
  return new;
end $$;


--
-- Name: fn_acomp_prod_before_write(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_acomp_prod_before_write() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_item record; v_par record; v_tr record;
begin
  if new.item_orcamentario_id is not null then
    select i.obra_id, i.tipo, i.servico_id, i.descricao,
           coalesce(s.unidade, i.unidade_referencia) as unidade
      into v_item
      from public.item_orcamentario i
      left join public.servico s on s.id = i.servico_id
     where i.id = new.item_orcamentario_id;
    if v_item.obra_id is null then raise exception 'Item orçamentário inexistente'; end if;
    if v_item.obra_id <> new.obra_id then raise exception 'Item orçamentário de outra obra'; end if;
    if v_item.tipo <> 'servico_grupo' then raise exception 'Só itens com composição (servico_grupo) recebem produção'; end if;
    if v_item.servico_id is null then
      raise exception 'Agrupamento sem composição vinculada não recebe produção — vincule uma composição no orçamento';
    end if;
    new.servico_id   := coalesce(new.servico_id, v_item.servico_id);
    new.servico_nome := coalesce(nullif(trim(new.servico_nome), ''), v_item.descricao);
    new.unidade      := coalesce(new.unidade, v_item.unidade);

    -- parametrização do serviço (vale para lançamentos novos e para quem muda quantidade/serviço)
    select * into v_par from public.servico_parametro where item_orcamentario_id = new.item_orcamentario_id;
    if found then
      if v_par.modo_lancamento = 'viagens' and new.origem <> 'viagens'
         and (tg_op = 'INSERT' or new.quantidade is distinct from old.quantidade
              or new.item_orcamentario_id is distinct from old.item_orcamentario_id) then
        raise exception 'O serviço "%" é alimentado por viagens: lance as viagens do dia', v_item.descricao;
      end if;
      -- observação desligada vale para o apontador (a nota "N viagens" da produção das viagens fica)
      if not v_par.habilita_obs and new.origem <> 'viagens' then new.obs := null; end if;
      if v_par.exige_local and new.origem <> 'viagens' then
        if new.trecho_id is null then
          raise exception 'Informe o local do lançamento de "%"', v_item.descricao;
        end if;
        select tipo into v_tr from public.obra_trecho where id = new.trecho_id;
        if v_tr.tipo = 'eixo' and new.posicao_inicio_m is null then
          raise exception 'Informe as estacas inicial e final do lançamento de "%"', v_item.descricao;
        end if;
      end if;
    end if;
  end if;
  -- a produção das viagens só muda pelas viagens (exclusões em cascata — `set null` de item/equipe — passam)
  if new.origem = 'viagens' and coalesce(current_setting('infrawork.viagens_sync', true), '') <> '1'
     and (tg_op = 'INSERT' or new.origem is distinct from old.origem
          or new.quantidade is distinct from old.quantidade or new.data is distinct from old.data
          or new.trecho_id is distinct from old.trecho_id
          or new.posicao_inicio_m is distinct from old.posicao_inicio_m
          or new.posicao_fim_m is distinct from old.posicao_fim_m) then
    raise exception 'A produção das viagens é calculada pelas viagens do dia';
  end if;
  if new.servico_nome is null or trim(new.servico_nome) = '' then
    raise exception 'servico_nome obrigatório';
  end if;
  if new.equipe_id is not null and not exists (
    select 1 from public.equipe e where e.id = new.equipe_id and e.obra_id = new.obra_id
  ) then raise exception 'Equipe de outra obra'; end if;
  if new.encarregado_id is not null and not exists (
    select 1 from public.encarregado en where en.id = new.encarregado_id and en.obra_id = new.obra_id
  ) then raise exception 'Encarregado de outra obra'; end if;
  if new.data > current_date + 1 then raise exception 'Data no futuro'; end if;
  if tg_op = 'INSERT' then new.criado_por := coalesce(new.criado_por, auth.uid()); end if;
  new.updated_at := now();
  return new;
end $$;


--
-- Name: fn_acomp_prod_local(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_acomp_prod_local() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare tr record;
begin
  if new.trecho_id is null then
    new.posicao_inicio_m := null; new.posicao_fim_m := null;
    return new;
  end if;
  select * into tr from public.obra_trecho where id = new.trecho_id;
  if tr.id is null or tr.obra_id <> new.obra_id then raise exception 'Trecho de outra obra'; end if;
  if tr.tipo = 'area' then
    new.posicao_inicio_m := null; new.posicao_fim_m := null;
  elsif (new.posicao_inicio_m is null) <> (new.posicao_fim_m is null) then
    raise exception 'Informe a estaca inicial e a final';
  elsif new.posicao_inicio_m is not null then
    if new.posicao_inicio_m > new.posicao_fim_m then
      select new.posicao_fim_m, new.posicao_inicio_m into new.posicao_inicio_m, new.posicao_fim_m;
    end if;
    if new.posicao_inicio_m < 0 or new.posicao_fim_m > tr.comprimento_m + 0.005 then
      raise exception 'Faixa fora do trecho "%" (0 a % m)', tr.nome, round(tr.comprimento_m, 2);
    end if;
  end if;
  return new;
end $$;


--
-- Name: fn_acomp_prod_mat_antes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_acomp_prod_mat_antes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_rec record;
begin
  if new.recurso_id is not null then
    select nome, unidade into v_rec from public.recurso where id = new.recurso_id;
    new.nome := coalesce(v_rec.nome, new.nome);
    new.unidade := coalesce(nullif(trim(new.unidade), ''), v_rec.unidade);
  end if;
  if new.nome is null or trim(new.nome) = '' then raise exception 'Material sem nome'; end if;
  return new;
end $$;


--
-- Name: fn_acomp_prod_viagens_equipe(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_acomp_prod_viagens_equipe() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if old.origem = 'viagens' and coalesce(current_setting('infrawork.viagens_sync', true), '') <> '1'
     and ((new.equipe_id is distinct from old.equipe_id and new.equipe_id is not null)
       or (new.encarregado_id is distinct from old.encarregado_id and new.encarregado_id is not null)) then
    raise exception 'A equipe e o encarregado da produção das viagens vêm da ficha — altere na ficha';
  end if;
  return new;
end $$;


--
-- Name: fn_aditivo_before(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_aditivo_before() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if public.excluindo_obra() then return coalesce(new, old); end if;
  if tg_op = 'INSERT' then
    if new.numero is null or new.numero = 0 then
      perform pg_advisory_xact_lock(hashtext('aditivo:' || new.obra_id::text));
      select coalesce(max(numero), 0) + 1 into new.numero
        from public.orcamento_aditivo where obra_id = new.obra_id;
    end if;
    new.criado_por := coalesce(new.criado_por, auth.uid());
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status = 'aplicado' then raise exception 'Aditivo aplicado não pode ser excluído'; end if;
    return old;
  end if;
  if old.status = 'aplicado'
     and coalesce(current_setting('infrawork.via_aditivo', true), '') <> '1'
     and (new.data is distinct from old.data or new.status is distinct from old.status
          or new.venda_antes is distinct from old.venda_antes
          or new.venda_depois is distinct from old.venda_depois) then
    raise exception 'Aditivo % já aplicado — só a descrição pode mudar', old.numero;
  end if;
  return new;
end $$;


--
-- Name: fn_aditivo_item_before(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_aditivo_item_before() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare st text; ob uuid;
begin
  if public.excluindo_obra() then return coalesce(new, old); end if;
  select status, obra_id into st, ob
    from public.orcamento_aditivo where id = coalesce(new.aditivo_id, old.aditivo_id);
  if st = 'aplicado' and coalesce(current_setting('infrawork.via_aditivo', true), '') <> '1' then
    raise exception 'Aditivo já aplicado — itens não podem mudar';
  end if;
  if tg_op <> 'DELETE' then new.obra_id := ob; return new; end if;
  return old;
end $$;


--
-- Name: fn_alerta_eng_whitelist(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_alerta_eng_whitelist() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_role text := public.auth_role();
begin
  if auth.uid() is null or v_role in ('god', 'adm') then
    return new;
  end if;
  if new.tipo        <> old.tipo        then raise exception 'eng não pode mudar tipo do alerta';        end if;
  if new.severidade  <> old.severidade  then raise exception 'eng não pode mudar severidade do alerta';  end if;
  if new.contexto    <> old.contexto    then raise exception 'eng não pode mudar contexto do alerta';    end if;
  if new.titulo      <> old.titulo      then raise exception 'eng não pode mudar título do alerta';      end if;
  if new.obra_id     <> old.obra_id     then raise exception 'eng não pode mudar obra do alerta';        end if;
  if new.chave is distinct from old.chave then raise exception 'eng não pode mudar a chave do alerta';   end if;
  new.updated_at := now();
  return new;
end $$;


--
-- Name: fn_cadeia_trava(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_cadeia_trava() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  j jsonb; v_obra uuid; motivo text; v_tipo text; v_id uuid;
begin
  if public.excluindo_obra() then return coalesce(new, old); end if;
  if coalesce(current_setting('infrawork.recalc_em_curso', true), '') = '1'
     or coalesce(current_setting('infrawork.via_aditivo', true), '') = '1' then
    return coalesce(new, old);
  end if;
  j := to_jsonb(coalesce(new, old));
  if tg_table_name = 'recurso_preco' then
    v_obra := public.recurso_obra((j->>'recurso_id')::uuid);
  elsif tg_table_name = 'cpu_item' then
    select obra_id into v_obra from public.cpu where id = (j->>'cpu_id')::uuid;
  elsif tg_table_name = 'servico_cpu_link' then
    select obra_id into v_obra from public.servico where id = (j->>'servico_id')::uuid;
  else
    v_obra := (j->>'obra_id')::uuid;
  end if;
  if v_obra is null or not exists (select 1 from public.obras where id = v_obra) then
    return coalesce(new, old);
  end if;

  -- planilha de venda depois do 1º aditivo: só por aditivo/reajuste
  if tg_table_name = 'item_orcamentario' and j->>'tipo' in ('receita', 'etapa')
     and public.obra_tem_aditivo(v_obra) then
    raise exception 'Planilha com aditivo: a planilha de venda só muda por aditivo (a Planilha Inicial fica arquivada)'
      using errcode = 'P0001';
  end if;

  motivo := public.cadeia_trava_motivo(v_obra);
  if motivo is null then return coalesce(new, old); end if;

  -- exceções com a cadeia travada: escopo novo de aditivo
  if tg_table_name = 'item_orc_alocacao' then
    -- alocação de receita que nasceu de aditivo (saldo do aditivo)
    if exists (select 1 from public.item_orcamentario r
                where r.id = (j->>'receita_id')::uuid and r.aditivo_id is not null) then
      return coalesce(new, old);
    end if;
  elsif tg_table_name = 'item_orcamentario' and j->>'tipo' = 'servico_grupo' then
    v_id := (j->>'id')::uuid;
    -- serviço novo (ainda fora de qualquer plano) pode ser criado/ajustado
    if tg_op = 'INSERT'
       or not exists (select 1 from public.planejamento_tarefa t where t.item_orcamentario_id = v_id) then
      return coalesce(new, old);
    end if;
    -- serviço já planejado: só campos derivados das alocações (herdar ↔ somar)
    if tg_op = 'UPDATE'
       and new.descricao is not distinct from old.descricao
       and new.servico_id is not distinct from old.servico_id
       and new.indireto_id is not distinct from old.indireto_id
       and new.unidade_referencia is not distinct from old.unidade_referencia
       and (new.qtd_ref_modo = old.qtd_ref_modo or (new.qtd_ref_modo <> 'manual' and old.qtd_ref_modo <> 'manual'))
       and (new.qtd_ref_modo <> 'manual' or new.quantidade_referencia is not distinct from old.quantidade_referencia) then
      return new;
    end if;
  end if;

  raise exception 'Orçamento travado: %', motivo using errcode = 'P0001';
end $$;


--
-- Name: fn_calendario_marca_planos(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_calendario_marca_planos() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_obra uuid; r jsonb;
begin
  r := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  v_obra := coalesce((r->>'obra_id')::uuid, public.calendario_obra((r->>'calendario_id')::uuid));
  update public.planejamento set recalculo_pendente = true
   where obra_id = v_obra and not is_baseline and not recalculo_pendente;
  return null;
end $$;


--
-- Name: fn_calendario_padrao(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_calendario_padrao() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if public.excluindo_obra() then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if old.padrao and exists (select 1 from public.obras where id = old.obra_id) then
      raise exception 'O calendário padrão não pode ser removido — marque outro como padrão antes';
    end if;
    return old;
  end if;
  if new.padrao and (tg_op = 'INSERT' or not old.padrao) then
    update public.calendario set padrao = false where obra_id = new.obra_id and padrao and id <> new.id;
  end if;
  if tg_op = 'UPDATE' and old.padrao and not new.padrao
     and not exists (select 1 from public.calendario where obra_id = new.obra_id and padrao and id <> new.id) then
    raise exception 'A obra precisa de um calendário padrão — marque outro como padrão';
  end if;
  return new;
end $$;


--
-- Name: fn_comentario_obra_calc(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_comentario_obra_calc() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if new.obra_id is null then
    select obra_id into new.obra_id
      from public.item_orcamentario where id = new.item_id;
    if new.obra_id is null then
      raise exception 'item_id inexistente: %', new.item_id;
    end if;
  end if;
  return new;
end
$$;


--
-- Name: fn_comentario_touch(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_comentario_touch() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at := now();
  return new;
end
$$;


--
-- Name: fn_cpu_demarcar_outras(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_cpu_demarcar_outras() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if new.is_vigente = true and new.servico_id is not null then
    update public.cpu
       set is_vigente = false
     where servico_id = new.servico_id
       and id <> new.id
       and is_vigente = true;
    update public.servico_cpu_link l
       set cpu_id = new.id
      from public.cpu c
     where l.cpu_id = c.id and c.servico_id = new.servico_id and c.id <> new.id;
  end if;
  return new;
end
$$;


--
-- Name: fn_cpu_item_calc(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_cpu_item_calc() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  preco              numeric(14,4);
  prod_diaria        numeric(14,4);
  total_combustivel  numeric(14,4);
begin
  preco := public.preco_vigente_recurso(new.recurso_id);
  if preco is null then preco := 0; end if;

  new.updated_at := now();

  case new.grupo
    when 'EQUIPAMENTO' then
      new.custo_total_calc := coalesce(new.quantidade, 0)
                             * preco
                             * coalesce(new.horas_dia, 0);
    when 'MO' then
      new.custo_total_calc := coalesce(new.quantidade, 0)
                             * preco
                             * coalesce(new.horas_dia, 0);
    when 'MATERIAL' then
      if new.consumo_material_por_unid is not null then
        select producao_diaria_qtde into prod_diaria
          from public.cpu where id = new.cpu_id;
        new.custo_total_calc := coalesce(new.consumo_material_por_unid, 0)
                               * coalesce(prod_diaria, 0)
                               * preco;
      else
        new.custo_total_calc := coalesce(new.quantidade, 0) * preco;
      end if;
    when 'COMBUSTIVEL' then
      -- Override: quando a planilha importou uma quantidade calculada
      -- específica (ex.: gasolina alocada só para a roçadeira), usa direto.
      if coalesce(new.quantidade, 0) > 0 then
        new.custo_total_calc := new.quantidade * preco;
      else
        -- Comportamento legado: agrega EQ items dessa CPU.
        select coalesce(sum(
                 coalesce(ci.quantidade, 0)
               * coalesce(ci.consumo_combustivel_lh, 0)
               * coalesce(ci.horas_dia, 0)
               * coalesce(ci.indice_produtividade, 1)
               ), 0)
          into total_combustivel
          from public.cpu_item ci
         where ci.cpu_id = new.cpu_id
           and ci.grupo  = 'EQUIPAMENTO';
        new.custo_total_calc := total_combustivel * preco;
      end if;
  end case;
  return new;
end
$$;


--
-- Name: fn_cpu_item_propagate(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_cpu_item_propagate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if tg_op <> 'DELETE' and new.grupo = 'EQUIPAMENTO' or tg_op = 'DELETE' and old.grupo = 'EQUIPAMENTO' then
    update public.cpu_item set updated_at = now()
     where cpu_id = coalesce(new.cpu_id, old.cpu_id) and grupo = 'COMBUSTIVEL'
       and coalesce(quantidade, 0) = 0;
  end if;
  if tg_op = 'DELETE' then
    perform public.fn_cpu_recalc(old.cpu_id);
    return old;
  end if;
  perform public.fn_cpu_recalc(new.cpu_id);
  return new;
end
$$;


--
-- Name: fn_cpu_producao_changed(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_cpu_producao_changed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.producao_diaria_qtde is distinct from old.producao_diaria_qtde then
    update public.cpu_item set updated_at = now()
     where cpu_id = new.id and grupo = 'MATERIAL' and consumo_material_por_unid is not null;
    perform public.fn_cpu_recalc(new.id);
  end if;
  return new;
end
$$;


--
-- Name: fn_cpu_recalc(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_cpu_recalc(_cpu_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  c_eq    numeric(14,4);
  c_comb  numeric(14,4);
  c_mo    numeric(14,4);
  c_mat   numeric(14,4);
  prod    numeric(14,4);
begin
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


--
-- Name: fn_dep_mesmo_planejamento(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_dep_mesmo_planejamento() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  pred_plan uuid;
  suc_plan  uuid;
begin
  select planejamento_id into pred_plan from public.planejamento_tarefa where id = new.predecessora_id;
  select planejamento_id into suc_plan  from public.planejamento_tarefa where id = new.sucessora_id;
  if pred_plan is null or suc_plan is null then
    raise exception 'predecessora/sucessora inexistente';
  end if;
  if pred_plan <> suc_plan then
    raise exception 'dependência só entre tarefas do mesmo planejamento';
  end if;
  if new.planejamento_id is null then
    new.planejamento_id := pred_plan;
  elsif new.planejamento_id <> pred_plan then
    raise exception 'planejamento_id da dependência (%) difere das tarefas (%)',
      new.planejamento_id, pred_plan;
  end if;
  return new;
end
$$;


--
-- Name: fn_encargos_total_calc(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_encargos_total_calc() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.total_perc_calc :=
      coalesce(new.iss_perc, 0)
    + coalesce(new.pis_perc, 0)
    + coalesce(new.cofins_perc, 0)
    + coalesce(new.csll_perc, 0)
    + coalesce(new.irpj_perc, 0)
    + coalesce(new.cprb_perc, 0)
    + coalesce(new.outros_perc, 0);
  return new;
end
$$;


--
-- Name: fn_equipe_encarregado_obra(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_equipe_encarregado_obra() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if new.encarregado_id is not null and not exists (
    select 1 from public.encarregado en where en.id = new.encarregado_id and en.obra_id = new.obra_id
  ) then raise exception 'Encarregado de outra obra'; end if;
  return new;
end $$;


--
-- Name: fn_frota_fleethub_protege(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_frota_fleethub_protege() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if old.origem = 'fleethub' then
      raise exception 'Veículo da FleetHub não pode ser excluído aqui (ele volta na próxima sincronização)';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.origem = 'fleethub' or new.fleet_id is not null or new.capacidade_fleethub then
      raise exception 'Veículos da FleetHub entram só pela sincronização';
    end if;
    return new;
  end if;
  if old.origem = 'fleethub' and (
       new.origem is distinct from old.origem or new.fleet_id is distinct from old.fleet_id
    or new.prefixo is distinct from old.prefixo or new.placa is distinct from old.placa
    or new.marca is distinct from old.marca or new.modelo is distinct from old.modelo
    or new.ano is distinct from old.ano or new.fleet_tipo is distinct from old.fleet_tipo
    or new.fleet_obra_id is distinct from old.fleet_obra_id or new.fleet_status is distinct from old.fleet_status
    or new.ativo is distinct from old.ativo or new.empresa_id is distinct from old.empresa_id
    or new.fleet_capacidade is distinct from old.fleet_capacidade
    or new.capacidade_fleethub is distinct from old.capacidade_fleethub) then
    raise exception 'Este campo vem da FleetHub — altere lá e sincronize';
  end if;
  if old.capacidade_fleethub and new.capacidade_m3 is distinct from old.capacidade_m3 then
    raise exception 'A capacidade deste veículo vem da FleetHub — altere lá e sincronize';
  end if;
  if old.origem = 'manual' and (new.origem <> 'manual' or new.fleet_id is not null or new.capacidade_fleethub) then
    raise exception 'Veículos da FleetHub entram só pela sincronização';
  end if;
  return new;
end $$;


--
-- Name: fn_item_orc_aloc_recalcular(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_item_orc_aloc_recalcular(_obra_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  -- percentual e peso
  update public.item_orc_alocacao a
     set fracao = case
           when a.criterio = 'percentual' then a.valor / 100
           else a.valor / nullif((select sum(b.valor) from public.item_orc_alocacao b
                                   where b.receita_id = a.receita_id), 0)
         end
   where a.obra_id = _obra_id and a.criterio in ('percentual', 'peso');

  -- venda: proporcional à venda-base de cada serviço
  with base as (
    select a.id, a.receita_id,
           coalesce(
             case when a.bases is not null and array_length(a.bases, 1) is not null then
               (select sum(i.venda_total_calc) from public.item_orcamentario i where i.id = any(a.bases))
             else
               (select sum(i.venda_total_calc * b.fracao)
                  from public.item_orc_alocacao b
                  join public.item_orcamentario i on i.id = b.receita_id
                 where b.grupo_id = a.grupo_id and b.compoe_qtd and b.criterio <> 'venda')
             end, 0) as v
      from public.item_orc_alocacao a
     where a.obra_id = _obra_id and a.criterio = 'venda'
  ), tot as (
    select receita_id, sum(v) as t, count(*) as n from base group by receita_id
  )
  update public.item_orc_alocacao a
     set fracao = case when tot.t > 0 then base.v / tot.t else 1.0 / tot.n end
    from base join tot on tot.receita_id = base.receita_id
   where a.id = base.id;
end $$;


--
-- Name: fn_item_orc_aloc_sync_modo(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_item_orc_aloc_sync_modo(_obra_id uuid) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  update public.item_orcamentario g
     set qtd_ref_modo = case
           when (select count(*) from public.item_orc_alocacao a where a.grupo_id = g.id and a.compoe_qtd) = 1
             then 'heranca' else 'soma_filhos' end
   where g.obra_id = _obra_id and g.tipo = 'servico_grupo' and g.qtd_ref_modo <> 'manual';
$$;


--
-- Name: fn_item_orc_aloc_validar(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_item_orc_aloc_validar() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  g record; r record; outro_criterio text; soma_perc numeric;
begin
  select id, obra_id, tipo into g from public.item_orcamentario where id = new.grupo_id;
  select id, obra_id, tipo into r from public.item_orcamentario where id = new.receita_id;
  if g.tipo is distinct from 'servico_grupo' then raise exception 'Alocação: destino não é um serviço (agrupador)'; end if;
  if r.tipo is distinct from 'receita' then raise exception 'Alocação: só receitas podem ser alocadas'; end if;
  if g.obra_id <> r.obra_id then raise exception 'Alocação: serviço e receita de obras diferentes'; end if;
  new.obra_id := r.obra_id;
  new.updated_at := now();

  if new.criterio = 'percentual' then
    if new.valor is null or new.valor <= 0 or new.valor > 100 then
      raise exception 'Rateio percentual: informe um %% entre 0 e 100';
    end if;
  elsif new.criterio = 'peso' then
    if new.valor is null or new.valor <= 0 then
      raise exception 'Rateio por peso: informe uma quantidade > 0';
    end if;
  else
    new.valor := null;
  end if;

  select a.criterio into outro_criterio
    from public.item_orc_alocacao a
   where a.receita_id = new.receita_id and a.id <> new.id and a.criterio <> new.criterio
   limit 1;
  if outro_criterio is not null then
    raise exception 'A receita já está rateada por "%"; use o mesmo critério em todos os serviços', outro_criterio;
  end if;

  if new.criterio = 'percentual' then
    select coalesce(sum(a.valor), 0) into soma_perc
      from public.item_orc_alocacao a
     where a.receita_id = new.receita_id and a.id <> new.id;
    if soma_perc + new.valor > 100.0001 then
      raise exception 'Rateio acima de 100%% (já alocado: % por cento; tentando somar % por cento)', round(soma_perc, 4), round(new.valor, 4);
    end if;
  end if;
  return new;
end $$;


--
-- Name: fn_item_orc_bloqueia_desvinculo(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_item_orc_bloqueia_desvinculo() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if new.tipo = 'servico_grupo'
     and new.servico_id is null and new.indireto_id is null
     and (old.servico_id is not null or old.indireto_id is not null) then
    if exists (select 1 from public.planejamento_tarefa t where t.item_orcamentario_id = new.id) then
      raise exception 'Agrupamento já está na programação — troque a composição em vez de remover o vínculo';
    end if;
    if exists (select 1 from public.acompanhamento_producao p where p.item_orcamentario_id = new.id) then
      raise exception 'Agrupamento já tem produção lançada — troque a composição em vez de remover o vínculo';
    end if;
  end if;
  return new;
end $$;


--
-- Name: fn_item_orc_bloqueia_exclusao_alocada(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_item_orc_bloqueia_exclusao_alocada() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  servicos text;
begin
  if public.excluindo_obra() then return coalesce(new, old); end if;
  if old.tipo <> 'receita' then return old; end if;
  -- exclusão da obra inteira (cascata): libera
  if not exists (select 1 from public.obras where id = old.obra_id) then return old; end if;
  select string_agg(g.descricao, ', ' order by g.codigo) into servicos
    from public.item_orc_alocacao a
    join public.item_orcamentario g on g.id = a.grupo_id
   where a.receita_id = old.id;
  if servicos is not null then
    raise exception 'Receita % está alocada em: % — remova a alocação antes de excluir', old.codigo, servicos;
  end if;
  return old;
end $$;


--
-- Name: fn_item_orc_codigo_gerar(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_item_orc_codigo_gerar() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$
declare
  parent_codigo text;
  n             int;
  candidate     text;
begin
  if new.codigo is not null and trim(new.codigo) <> '' then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('item_orc:' || new.obra_id::text));

  if new.tipo = 'servico_grupo' then
    select coalesce(max(nullif(substring(codigo from '^S([0-9]+)$'), '')::int), 0) into n
      from public.item_orcamentario
     where obra_id = new.obra_id and tipo = 'servico_grupo';
    n := n + 1;
    loop
      candidate := 'S' || lpad(n::text, 2, '0');
      exit when not exists (
        select 1 from public.item_orcamentario
         where obra_id = new.obra_id and codigo = candidate
      );
      n := n + 1;
    end loop;
    new.codigo := candidate;
  elsif new.parent_id is null then
    select coalesce(max((codigo)::int), 0) into n
      from public.item_orcamentario
     where obra_id = new.obra_id
       and parent_id is null
       and codigo ~ '^[0-9]+$';
    n := n + 1;
    loop
      candidate := lpad(n::text, 3, '0');
      exit when not exists (
        select 1 from public.item_orcamentario
         where obra_id = new.obra_id and codigo = candidate
      );
      n := n + 1;
    end loop;
    new.codigo := candidate;
  else
    select codigo into parent_codigo
      from public.item_orcamentario where id = new.parent_id;
    select coalesce(max(
             nullif(substring(codigo from length(parent_codigo) + 2), '')::int
           ), 0) into n
      from public.item_orcamentario
     where obra_id = new.obra_id
       and parent_id = new.parent_id
       and codigo ~ ('^' || regexp_replace(parent_codigo, '\.', '\\.', 'g') || '\.[0-9]+$');
    n := n + 1;
    loop
      candidate := parent_codigo || '.' || lpad(n::text, 2, '0');
      exit when not exists (
        select 1 from public.item_orcamentario
         where obra_id = new.obra_id and codigo = candidate
      );
      n := n + 1;
    end loop;
    new.codigo := candidate;
  end if;
  return new;
end
$_$;


--
-- Name: fn_item_orc_linha_calc(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_item_orc_linha_calc() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  ind_valor numeric(14,2);
begin
  new.updated_at := now();

  if new.tipo = 'receita' then
    new.custo_unitario_calc := null;
    new.venda_total_calc    := coalesce(new.quantidade, 0) * coalesce(new.venda_unitaria, 0);
    -- custo_total_calc/lucratividade: apropriados por recalcular_orcamento
    if tg_op = 'INSERT' then
      new.custo_total_calc        := 0;
      new.lucratividade_perc_calc := null;
    end if;
  elsif new.tipo = 'servico_grupo' then
    if new.indireto_id is not null then
      select valor_total into ind_valor from public.indireto_item where id = new.indireto_id;
      new.custo_unitario_calc := coalesce(ind_valor, 0);
    elsif new.servico_id is not null then
      new.custo_unitario_calc := coalesce(public.servico_custo_unit(new.servico_id), 0);
    else
      new.custo_unitario_calc := 0;
    end if;
    new.custo_total_calc := coalesce(new.quantidade_referencia, 0) * new.custo_unitario_calc;
    -- venda_total_calc e lucratividade_perc_calc: recalcular_orcamento
  else
    new.custo_unitario_calc := null;
  end if;

  return new;
end
$$;


--
-- Name: fn_item_orc_nivel_calc(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_item_orc_nivel_calc() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  parent_nivel smallint;
  parent_obra  uuid;
begin
  if new.parent_id is null then
    new.nivel := 1;
  else
    select nivel, obra_id into parent_nivel, parent_obra
      from public.item_orcamentario
     where id = new.parent_id;
    if parent_obra is null then
      raise exception 'parent_id inexistente: %', new.parent_id;
    end if;
    if parent_obra <> new.obra_id then
      raise exception 'item_orcamentario.parent precisa ser da mesma obra';
    end if;
    if new.parent_id = new.id then
      raise exception 'item_orcamentario.parent_id não pode ser ele mesmo';
    end if;
    new.nivel := parent_nivel + 1;
  end if;
  return new;
end
$$;


--
-- Name: fn_item_orc_parent_tipo_check(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_item_orc_parent_tipo_check() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  parent_tipo text;
begin
  if new.tipo = 'servico_grupo' and new.parent_id is not null then
    raise exception 'Serviço (agrupador) fica fora da planilha de venda: não tem item pai';
  end if;
  if new.parent_id is null then
    return new;
  end if;
  select tipo into parent_tipo from public.item_orcamentario where id = new.parent_id;
  if parent_tipo is null then
    raise exception 'parent_id inexistente: %', new.parent_id;
  end if;
  if parent_tipo = 'servico_grupo' then
    raise exception 'Serviço (agrupador) não tem itens filhos — aloque receitas a ele';
  end if;
  if parent_tipo = 'receita' then
    raise exception 'receita não pode ter filhos';
  end if;
  return new;
end $$;


--
-- Name: fn_lb_imutavel_generica(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_lb_imutavel_generica() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_plan uuid; v_lb boolean;
begin
  if public.excluindo_obra() then return coalesce(new, old); end if;
  if tg_table_name in ('planejamento_tarefa_perfil_dia') then
    select planejamento_id into v_plan from public.planejamento_tarefa where id = coalesce(new.tarefa_id, old.tarefa_id);
  else
    v_plan := case when tg_op = 'DELETE' then old.planejamento_id else new.planejamento_id end;
  end if;
  select is_baseline into v_lb from public.planejamento where id = v_plan;
  -- plano removido (cascata) ou não-LB: segue
  if v_lb is null or not v_lb then return coalesce(new, old); end if;
  raise exception 'Linha de base travada é imutável — crie um plano em edição a partir dela';
end $$;


--
-- Name: fn_limite_antes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_limite_antes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if new.grupo_id is not null and not exists (
       select 1 from public.planejamento_tarefa where id = new.grupo_id and planejamento_id = new.planejamento_id and tipo_no = 'grupo') then
    raise exception 'O limite por tarefa-resumo precisa de uma tarefa-resumo do mesmo plano';
  end if;
  if (select obra_id from public.recurso where id = new.recurso_id) is distinct from public.planejamento_obra(new.planejamento_id) then
    raise exception 'Recurso de outra obra';
  end if;
  return new;
end $$;


--
-- Name: fn_locais_validar(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_locais_validar(_tarefa_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_nome text;
begin
  if exists (select 1 from public.planejamento_tarefa_local a join public.planejamento_tarefa_local b
               on b.tarefa_id = a.tarefa_id and b.id > a.id and b.trecho_id = a.trecho_id
              and a.inicio_m is not null and b.inicio_m is not null
              and a.inicio_m < b.fim_m and b.inicio_m < a.fim_m
             where a.tarefa_id = _tarefa_id) then
    raise exception 'Os locais da tarefa não podem se sobrepor no mesmo trecho';
  end if;
  select tr.nome into v_nome
    from public.planejamento_tarefa_local l join public.obra_trecho tr on tr.id = l.trecho_id
   where l.tarefa_id = _tarefa_id and l.inicio_m is null
   group by tr.nome having count(*) > 1 limit 1;
  if v_nome is not null then raise exception 'A tarefa já tem um local na área "%"', v_nome; end if;
  if (select count(*) from public.planejamento_tarefa_local where tarefa_id = _tarefa_id and trecho_id is null) > 1 then
    raise exception 'A tarefa já tem um local sem trecho';
  end if;
end $$;


--
-- Name: fn_local_antes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_local_antes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_plan uuid; v_tipo text; v_item uuid; v_ind uuid; v_obra uuid; v_tr_obra uuid; q numeric;
  v_tipo_tr text; v_comp numeric; v_nome_tr text; lote boolean; degrada boolean;
begin
  select t.planejamento_id, t.tipo_no, t.item_orcamentario_id, i.indireto_id
    into v_plan, v_tipo, v_item, v_ind
    from public.planejamento_tarefa t left join public.item_orcamentario i on i.id = t.item_orcamentario_id
   where t.id = new.tarefa_id;
  if v_plan is null then raise exception 'Tarefa % inexistente', new.tarefa_id; end if;
  if v_tipo <> 'tarefa' then raise exception 'Só tarefas (não tarefas-resumo) têm locais'; end if;
  if v_ind is not null then raise exception 'Tarefas de indireto não têm locais'; end if;
  new.planejamento_id := v_plan;
  lote := coalesce(current_setting('infrawork.locais_lote', true), '') = '1';
  degrada := coalesce(current_setting('infrawork.trecho_sync', true), '') = '1'
          or coalesce(current_setting('infrawork.copia_plano', true), '') = '1';

  if new.trecho_id is not null then
    select obra_id, tipo, comprimento_m, nome into v_tr_obra, v_tipo_tr, v_comp, v_nome_tr
      from public.obra_trecho where id = new.trecho_id;
    select obra_id into v_obra from public.planejamento where id = v_plan;
    if v_tr_obra is distinct from v_obra then raise exception 'Trecho de outra obra'; end if;
    if v_tipo_tr = 'area' then
      if new.inicio_m is not null or new.fim_m is not null then
        raise exception 'Local na área "%" não tem estacas', v_nome_tr;
      end if;
    else
      if new.inicio_m is null or new.fim_m is null then
        raise exception 'Local no eixo "%" precisa de estaca inicial e final', v_nome_tr;
      end if;
      if new.fim_m > v_comp + 0.005 then
        raise exception 'Local fora do trecho "%": a faixa vai até % m e o eixo tem % m — estenda o eixo em Locais ou encurte a faixa',
          v_nome_tr, round(new.fim_m, 2), round(v_comp, 2);
      end if;
    end if;
  elsif new.inicio_m is not null or new.fim_m is not null then
    raise exception 'Local sem trecho não tem estacas';
  end if;

  if new.qtd_origem = 'trecho' then
    if new.trecho_id is null or v_item is null or not public.trecho_servico_disponivel(new.trecho_id, v_item) then
      if degrada then
        new.qtd_origem := 'manual';
      else
        raise exception 'Quantidade "do template" indisponível no trecho "%": o template não tem o serviço ou a soma dos trechos passa do orçamento',
          coalesce(v_nome_tr, '(sem trecho)');
      end if;
    else
      q := public.trecho_qtd_faixa(new.trecho_id, v_item, new.inicio_m, new.fim_m);
      if q <= 0 then
        if degrada then
          new.qtd_origem := 'manual';
        else
          raise exception 'Não há quantidade do serviço entre % e % m do trecho "%"',
            round(coalesce(new.inicio_m, 0), 2), round(coalesce(new.fim_m, 1), 2), v_nome_tr;
        end if;
      else
        new.quantidade := q;
      end if;
    end if;
  end if;

  if not lote then
    -- "Task locations cannot intersect." (WorkSite::AddWorkPlace)
    if new.inicio_m is not null and exists (
         select 1 from public.planejamento_tarefa_local o
          where o.tarefa_id = new.tarefa_id and o.id <> new.id and o.trecho_id = new.trecho_id
            and o.inicio_m < new.fim_m and new.inicio_m < o.fim_m) then
      raise exception 'Os locais da tarefa não podem se sobrepor no mesmo trecho';
    end if;
    if new.trecho_id is not null and new.inicio_m is null and exists (
         select 1 from public.planejamento_tarefa_local o
          where o.tarefa_id = new.tarefa_id and o.id <> new.id and o.trecho_id = new.trecho_id) then
      raise exception 'A tarefa já tem um local na área "%"', v_nome_tr;
    end if;
    if new.trecho_id is null and exists (
         select 1 from public.planejamento_tarefa_local o
          where o.tarefa_id = new.tarefa_id and o.id <> new.id and o.trecho_id is null) then
      raise exception 'A tarefa já tem um local sem trecho';
    end if;
  end if;
  return new;
end $$;


--
-- Name: fn_local_soma(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_local_soma() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_t uuid; s numeric; n int;
begin
  for v_t in select distinct x from unnest(array[case when tg_op <> 'INSERT' then old.tarefa_id end,
                                                 case when tg_op <> 'DELETE' then new.tarefa_id end]) x where x is not null loop
    select coalesce(sum(quantidade), 0), count(*) into s, n from public.planejamento_tarefa_local where tarefa_id = v_t;
    if n > 0 then
      update public.planejamento_tarefa set quantidade_alocada = nullif(round(s, 4), 0)
       where id = v_t and quantidade_alocada is distinct from nullif(round(s, 4), 0);
    end if;
  end loop;
  return null;
end $$;


--
-- Name: fn_memoria_obra_calc(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_memoria_obra_calc() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if new.obra_id is null then
    select obra_id into new.obra_id
      from public.item_orcamentario where id = new.item_id;
    if new.obra_id is null then
      raise exception 'item_id inexistente: %', new.item_id;
    end if;
  end if;
  new.updated_at := now();
  return new;
end
$$;


--
-- Name: fn_obra_calendario_default(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_obra_calendario_default() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  insert into public.calendario (obra_id, nome, padrao) values (new.id, 'Calendário da obra', true)
    on conflict (obra_id, nome) do nothing;
  return new;
end $$;


--
-- Name: fn_obra_fleet_obra_antes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_obra_fleet_obra_antes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  -- a obra FleetHub tem de ser da mesma empresa da obra
  if not exists (select 1 from public.fleet_obra f
                  where f.id = new.fleet_obra_id and f.empresa_id = public.obra_empresa(new.obra_id)) then
    raise exception 'Obra da FleetHub de outra empresa';
  end if;
  new.created_by := coalesce(new.created_by, auth.uid());
  return new;
end $$;


--
-- Name: fn_orc_marca_cpu(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_orc_marca_cpu() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if tg_op = 'UPDATE'
     and new.custo_unit_calc is not distinct from old.custo_unit_calc
     and new.producao_diaria_qtde is not distinct from old.producao_diaria_qtde
     and new.is_vigente is not distinct from old.is_vigente then
    return null;
  end if;
  perform public.fn_orc_marcar_recalculo(coalesce(new.obra_id, old.obra_id));
  return null;
end $$;


--
-- Name: fn_orc_marca_item(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_orc_marca_item() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform public.fn_orc_marcar_recalculo(coalesce(new.obra_id, old.obra_id));
  return null;
end $$;


--
-- Name: fn_orc_marca_servico(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_orc_marca_servico() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform public.fn_orc_marcar_recalculo(
    (select obra_id from public.servico where id = coalesce(new.servico_id, old.servico_id)));
  return null;
end $$;


--
-- Name: fn_orc_marca_servico_prod(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_orc_marca_servico_prod() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform public.fn_orc_marcar_recalculo(new.obra_id);
  return null;
end $$;


--
-- Name: fn_orc_marca_taxa(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_orc_marca_taxa() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.fn_orc_marcar_recalculo(old.obra_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.fn_orc_marcar_recalculo(new.obra_id);
  end if;
  return null;
end $$;


--
-- Name: fn_orc_marcar_recalculo(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_orc_marcar_recalculo(_obra_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if _obra_id is null or coalesce(current_setting('infrawork.recalc_em_curso', true), '') = '1' then
    return;
  end if;
  insert into public.orcamento_recalculo_pendente (obra_id) values (_obra_id)
  on conflict (obra_id) do nothing;
end $$;


--
-- Name: fn_orc_recalculo_executar(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_orc_recalculo_executar() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not exists (select 1 from public.orcamento_recalculo_pendente where obra_id = new.obra_id) then
    return null;
  end if;
  delete from public.orcamento_recalculo_pendente where obra_id = new.obra_id;
  if exists (select 1 from public.obras where id = new.obra_id) then
    perform set_config('infrawork.recalc_em_curso', '1', true);
    perform public.recalcular_orcamento(new.obra_id);
    perform set_config('infrawork.recalc_em_curso', '', true);
    perform public.trecho_sync_tarefas(new.obra_id);
    update public.planejamento set recalculo_pendente = true
     where obra_id = new.obra_id and not is_baseline and not recalculo_pendente;
  end if;
  return null;
end $$;


--
-- Name: fn_planejamento_baseline_imutavel(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_planejamento_baseline_imutavel() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  plan_id    uuid;
  is_base    boolean;
begin
  if public.excluindo_obra() then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if tg_table_name = 'planejamento_tarefa' then
      plan_id := old.planejamento_id;
    elsif tg_table_name = 'planejamento_dependencia' then
      plan_id := old.planejamento_id;
    elsif tg_table_name = 'planejamento_tarefa_equipe' then
      select planejamento_id into plan_id
        from public.planejamento_tarefa where id = old.tarefa_id;
    end if;
  else
    if tg_table_name = 'planejamento_tarefa' then
      plan_id := new.planejamento_id;
      -- Exceção: orfanização (item_orcamentario_id NOT NULL → NULL).
      -- Ocorre via FK ON DELETE SET NULL quando item do orçamento é apagado.
      -- Esse cenário foi explicitamente aprovado mesmo em baseline.
      if old.item_orcamentario_id is not null
         and new.item_orcamentario_id is null then
        return new;
      end if;
    elsif tg_table_name = 'planejamento_dependencia' then
      plan_id := new.planejamento_id;
    elsif tg_table_name = 'planejamento_tarefa_equipe' then
      select planejamento_id into plan_id
        from public.planejamento_tarefa where id = new.tarefa_id;
    end if;
  end if;

  select is_baseline into is_base from public.planejamento where id = plan_id;
  if coalesce(is_base, false) = false then
    return coalesce(new, old);
  end if;
  raise exception 'Planejamento marcado como baseline é imutável. Crie uma nova revisão para editar.';
end
$$;


--
-- Name: fn_planejamento_estado(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_planejamento_estado() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare n int;
begin
  if public.excluindo_obra() then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if old.vigente then
      raise exception 'A linha de base "%" é a vigente — desmarque-a antes de excluir', old.nome;
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.is_baseline and not new.is_baseline then
    raise exception 'Linha de base travada não volta a ser editável — crie um plano em edição a partir dela';
  end if;
  if new.is_baseline and (tg_op = 'INSERT' or not old.is_baseline) then
    select count(*) into n from public.planejamento
     where obra_id = new.obra_id and is_baseline and id <> new.id;
    if n >= 20 then
      raise exception 'Limite de 20 linhas de base por obra — exclua uma antes de promover outra';
    end if;
    new.travada_em := now();
  end if;
  if new.vigente and (tg_op = 'INSERT' or not old.vigente) then
    new.vigente_em := now();
  end if;
  return new;
end $$;


--
-- Name: fn_plano_assert_editavel(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_plano_assert_editavel(_planejamento_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_obra uuid; v_lb boolean;
begin
  select obra_id, is_baseline into v_obra, v_lb from public.planejamento where id = _planejamento_id;
  if v_obra is null then raise exception 'Plano não encontrado'; end if;
  if not public.pode_planejar_obra(v_obra) then raise exception 'Sem permissão para planejar esta obra'; end if;
  if v_lb then raise exception 'Linha de base travada é imutável — crie um plano em edição a partir dela'; end if;
  return v_obra;
end $$;


--
-- Name: fn_plano_dados_rev(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_plano_dados_rev() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_plan uuid;
begin
  if coalesce(current_setting('infrawork.gravando_calculo', true), '') = '1' then return null; end if;
  if tg_table_name = 'planejamento_tarefa_equipe' then
    select planejamento_id into v_plan from public.planejamento_tarefa where id = coalesce(new.tarefa_id, old.tarefa_id);
  else
    v_plan := case when tg_op = 'DELETE' then old.planejamento_id else new.planejamento_id end;
  end if;
  update public.planejamento set dados_rev = dados_rev + 1 where id = v_plan and not is_baseline;
  return null;
end $$;


--
-- Name: fn_plano_rev_atributos(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_plano_rev_atributos() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if not new.is_baseline
     and (new.data_referencia_inicio, new.prazo, new.calendario_id, new.modo)
         is distinct from (old.data_referencia_inicio, old.prazo, old.calendario_id, old.modo) then
    new.dados_rev := old.dados_rev + 1;
  end if;
  return new;
end $$;


--
-- Name: fn_profiles_protege(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_profiles_protege() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if current_user in ('authenticated', 'anon')
     and coalesce(public.auth_role()::text, '') <> 'god'
     and (new.id is distinct from old.id
          or new.role is distinct from old.role
          or new.empresa_id is distinct from old.empresa_id
          or new.engenheiro_id is distinct from old.engenheiro_id
          or new.ativo is distinct from old.ativo
          or new.email is distinct from old.email) then
    raise exception 'Papel, empresa, vínculo, situação e e-mail do usuário só mudam em Gerencial › Usuários';
  end if;
  return new;
end $$;


--
-- Name: fn_pti_touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_pti_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


--
-- Name: fn_ptps_baseline_imutavel(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_ptps_baseline_imutavel() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  v_tarefa_id uuid;
  v_plan_id   uuid;
  v_is_base   boolean;
begin
  if public.excluindo_obra() then return coalesce(new, old); end if;
  v_tarefa_id := coalesce(new.tarefa_id, old.tarefa_id);

  select planejamento_id into v_plan_id
    from public.planejamento_tarefa where id = v_tarefa_id;

  select is_baseline into v_is_base
    from public.planejamento where id = v_plan_id;

  if coalesce(v_is_base, false) = false then
    return coalesce(new, old);
  end if;

  raise exception 'Perfil semanal de planejamento baseline e imutavel. Crie uma nova revisao para editar.';
end
$$;


--
-- Name: fn_reajuste_before(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_reajuste_before() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if public.excluindo_obra() then return coalesce(new, old); end if;
  if tg_op = 'INSERT' then
    if new.numero is null or new.numero = 0 then
      perform pg_advisory_xact_lock(hashtext('reajuste:' || new.obra_id::text));
      select coalesce(max(numero), 0) + 1 into new.numero
        from public.orcamento_reajuste where obra_id = new.obra_id;
    end if;
    new.criado_por := coalesce(new.criado_por, auth.uid());
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status = 'aplicado' then raise exception 'Reajuste aplicado não pode ser excluído'; end if;
    return old;
  end if;
  if old.status = 'aplicado'
     and coalesce(current_setting('infrawork.via_aditivo', true), '') <> '1'
     and (new.data is distinct from old.data or new.status is distinct from old.status) then
    raise exception 'Reajuste % já aplicado — só a descrição pode mudar', old.numero;
  end if;
  return new;
end $$;


--
-- Name: fn_reajuste_filho_before(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_reajuste_filho_before() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare st text; ob uuid;
begin
  if public.excluindo_obra() then return coalesce(new, old); end if;
  select status, obra_id into st, ob
    from public.orcamento_reajuste where id = coalesce(new.reajuste_id, old.reajuste_id);
  if st = 'aplicado' and coalesce(current_setting('infrawork.via_aditivo', true), '') <> '1' then
    raise exception 'Reajuste já aplicado — grupos e classificação não podem mudar';
  end if;
  if tg_op <> 'DELETE' then new.obra_id := ob; return new; end if;
  return old;
end $$;


--
-- Name: fn_recurso_preco_propagate(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_recurso_preco_propagate() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _recurso uuid;
begin
  if tg_op = 'DELETE' then _recurso := old.recurso_id;
  else                     _recurso := new.recurso_id;
  end if;

  -- 1) cpu_items que usam diretamente o recurso (CPUs vigentes apenas)
  update public.cpu_item ci
     set updated_at = now()
    from public.cpu c
   where ci.cpu_id  = c.id
     and c.is_vigente = true
     and ci.recurso_id = _recurso;

  -- 2) cpu_items COMBUSTIVEL nas mesmas CPUs que tinham EQ afetados (o preço do
  --    diesel pode ter mudado, mas o cálculo do combustivel agrega EQ). Se o
  --    recurso afetado é um EQ, precisamos refazer o combustível.
  update public.cpu_item ci
     set updated_at = now()
    from public.cpu c, public.recurso r
   where ci.cpu_id   = c.id
     and c.is_vigente = true
     and ci.grupo     = 'COMBUSTIVEL'
     and r.id         = _recurso
     and r.grupo      = 'EQUIPAMENTO'
     -- restringe a CPUs que de fato têm EQs (a propria CPU possui ao menos 1 EQ
     -- que referencia esse recurso); evita updates desnecessários.
     and exists (
       select 1 from public.cpu_item ci2
        where ci2.cpu_id = ci.cpu_id and ci2.grupo = 'EQUIPAMENTO' and ci2.recurso_id = _recurso
     );

  if tg_op = 'DELETE' then return old; else return new; end if;
end
$$;


--
-- Name: fn_semana_tem_trabalho(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_semana_tem_trabalho(_s jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$ select exists (select 1 from jsonb_array_elements(_s) d where (d->>'horas')::numeric > 0) $$;


--
-- Name: fn_semana_valida(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_semana_valida(_s jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $_$
declare d jsonb; h numeric; m int;
begin
  if _s is null or jsonb_typeof(_s) <> 'array' or jsonb_array_length(_s) <> 7 then return false; end if;
  for d in select value from jsonb_array_elements(_s) loop
    if jsonb_typeof(d) <> 'object' or coalesce(d->>'inicio', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or jsonb_typeof(d->'horas') <> 'number' then
      return false;
    end if;
    h := (d->>'horas')::numeric;
    m := split_part(d->>'inicio', ':', 1)::int * 60 + split_part(d->>'inicio', ':', 2)::int;
    -- o expediente pode passar da meia-noite, mas não do dia seguinte inteiro
    if h < 0 or h > 24 or m + h * 60 > 48 * 60 then return false; end if;
  end loop;
  return true;
end $_$;


--
-- Name: fn_servdep_antes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_servdep_antes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if (select obra_id from public.servico where id = new.predecessor_id) is distinct from new.obra_id
     or (select obra_id from public.servico where id = new.sucessor_id) is distinct from new.obra_id then
    raise exception 'Serviço de outra obra';
  end if;
  return new;
end $$;


--
-- Name: fn_servico_cpu_link_mesma_obra(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_servico_cpu_link_mesma_obra() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  servico_obra uuid;
  cpu_obra     uuid;
begin
  select obra_id into servico_obra from public.servico where id = new.servico_id;
  select obra_id into cpu_obra     from public.cpu     where id = new.cpu_id;
  if servico_obra is null or cpu_obra is null then
    raise exception 'servico ou cpu inexistente';
  end if;
  if servico_obra <> cpu_obra then
    raise exception 'Servico e CPU devem pertencer à mesma obra (servico: %, cpu: %)',
      servico_obra, cpu_obra;
  end if;
  return new;
end
$$;


--
-- Name: fn_servico_nivel_calc(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_servico_nivel_calc() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  parent_obra  uuid;
  parent_nivel smallint;
begin
  if new.parent_id is null then
    new.nivel := 1;
  else
    select obra_id, nivel into parent_obra, parent_nivel
      from public.servico
     where id = new.parent_id;
    if parent_obra is null then
      raise exception 'parent_id inexistente: %', new.parent_id;
    end if;
    if parent_obra <> new.obra_id then
      raise exception 'servico.parent precisa ser da mesma obra';
    end if;
    new.nivel := parent_nivel + 1;
  end if;
  return new;
end
$$;


--
-- Name: fn_servico_parametro_antes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_servico_parametro_antes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_item record; v_rec record;
begin
  select obra_id, tipo into v_item from public.item_orcamentario where id = new.item_orcamentario_id;
  if v_item.obra_id is null then raise exception 'Serviço do orçamento inexistente'; end if;
  if v_item.tipo <> 'servico_grupo' then raise exception 'Só serviços (agrupadores) são parametrizados'; end if;
  new.obra_id := v_item.obra_id;
  if new.controla_material then
    if new.material_recurso_id is null then
      raise exception 'Escolha o material controlado do serviço';
    end if;
    select obra_id, grupo, unidade into v_rec from public.recurso where id = new.material_recurso_id;
    if v_rec.obra_id is distinct from new.obra_id then raise exception 'Material de outra obra'; end if;
    if v_rec.grupo <> 'MATERIAL' then raise exception 'O recurso escolhido não é um material'; end if;
    new.material_unidade := coalesce(nullif(trim(new.material_unidade), ''), v_rec.unidade);
  else
    new.material_recurso_id := null;
    new.material_unidade := null;
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;


--
-- Name: fn_tarefa_assert_editavel(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_tarefa_assert_editavel(_tarefa_id uuid, OUT planejamento_id uuid, OUT obra_id uuid, OUT item_id uuid, OUT parent_id uuid, OUT nivel smallint, OUT ordem integer) RETURNS record
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_tipo text; v_ind uuid;
begin
  select t.planejamento_id, t.item_orcamentario_id, t.parent_id, t.nivel, t.ordem, t.tipo_no, i.indireto_id
    into planejamento_id, item_id, parent_id, nivel, ordem, v_tipo, v_ind
    from public.planejamento_tarefa t left join public.item_orcamentario i on i.id = t.item_orcamentario_id
   where t.id = _tarefa_id;
  if planejamento_id is null then raise exception 'Tarefa não encontrada'; end if;
  obra_id := public.fn_plano_assert_editavel(planejamento_id);
  if v_tipo <> 'tarefa' then raise exception 'Só tarefas (não tarefas-resumo) têm locais'; end if;
  if v_ind is not null then raise exception 'Tarefas de indireto não se dividem nem se combinam'; end if;
end $$;


--
-- Name: fn_tarefa_clonar(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_tarefa_clonar(_tarefa_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare t record; v_novo uuid; v_nome text; m text[];
begin
  select * into t from public.planejamento_tarefa where id = _tarefa_id;
  update public.planejamento_tarefa set ordem = ordem + 1
   where planejamento_id = t.planejamento_id and parent_id is not distinct from t.parent_id and ordem > t.ordem;
  -- nome: "X" → "X 2"; "X 3" → "X 4"
  v_nome := t.nome_custom;
  if v_nome is not null then
    m := regexp_match(v_nome, '^(.*\S)\s+(\d+)$');
    if m is not null then v_nome := m[1] || ' ' || (m[2]::int + 1); else v_nome := v_nome || ' 2'; end if;
  end if;
  insert into public.planejamento_tarefa (
    planejamento_id, item_orcamentario_id, tipo_no, parent_id, nivel, nome_custom, notas, ordem,
    prioridade, asap, inicio_dia, sentido, restricao_inicio, restricao_inicio_em, restricao_fim, restricao_fim_em,
    coef_producao, qtd_equipes, calendario_id, derivar_predecessoras, aparencia, inicio_em)
  values (
    t.planejamento_id, t.item_orcamentario_id, 'tarefa', t.parent_id, t.nivel, v_nome, t.notas, t.ordem + 1,
    t.prioridade, t.asap, t.inicio_dia, t.sentido, t.restricao_inicio, t.restricao_inicio_em, t.restricao_fim, t.restricao_fim_em,
    t.coef_producao, t.qtd_equipes, t.calendario_id, t.derivar_predecessoras, t.aparencia, t.inicio_em)
  returning id into v_novo;
  insert into public.planejamento_tarefa_equipe (tarefa_id, equipe_id, qtd_equipes)
  select v_novo, e.equipe_id, e.qtd_equipes from public.planejamento_tarefa_equipe e where e.tarefa_id = _tarefa_id;
  insert into public.planejamento_dependencia (planejamento_id, predecessora_id, sucessora_id, tipo, origem, atraso_min, atraso_max, dias_uteis, aparencia)
  select d.planejamento_id, d.predecessora_id, v_novo, d.tipo, d.origem, d.atraso_min, d.atraso_max, d.dias_uteis, d.aparencia
    from public.planejamento_dependencia d where d.sucessora_id = _tarefa_id
  on conflict (predecessora_id, sucessora_id) do nothing;
  insert into public.planejamento_dependencia (planejamento_id, predecessora_id, sucessora_id, tipo, origem, atraso_min, atraso_max, dias_uteis, aparencia)
  select d.planejamento_id, v_novo, d.sucessora_id, d.tipo, d.origem, d.atraso_min, d.atraso_max, d.dias_uteis, d.aparencia
    from public.planejamento_dependencia d where d.predecessora_id = _tarefa_id
  on conflict (predecessora_id, sucessora_id) do nothing;
  return v_novo;
end $_$;


--
-- Name: fn_tarefa_limite_servico(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_tarefa_limite_servico() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ref numeric; v_usado numeric; v_ind uuid; v_desc text; v_lb boolean;
begin
  -- sincronização automática do trecho não bloqueia (a UI mostra o estouro)
  if coalesce(current_setting('infrawork.trecho_sync', true), '') = '1' then return new; end if;
  if new.item_orcamentario_id is null or new.tipo_no <> 'tarefa' or new.quantidade_alocada is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.item_orcamentario_id is not distinct from old.item_orcamentario_id
     and coalesce(new.quantidade_alocada, 0) <= coalesce(old.quantidade_alocada, 0) then
    return new;
  end if;
  select is_baseline into v_lb from public.planejamento where id = new.planejamento_id;
  if v_lb then return new; end if;
  select quantidade_referencia, indireto_id, descricao into v_ref, v_ind, v_desc
    from public.item_orcamentario where id = new.item_orcamentario_id;
  if v_ind is not null then return new; end if;
  select coalesce(sum(quantidade_alocada), 0) into v_usado
    from public.planejamento_tarefa
   where planejamento_id = new.planejamento_id and item_orcamentario_id = new.item_orcamentario_id
     and tipo_no = 'tarefa' and id <> new.id;
  if v_usado + new.quantidade_alocada > coalesce(v_ref, 0) + 0.0001 then
    raise exception 'Quantidade acima do serviço "%": % já programado + % > % do orçamento (restam %)',
      v_desc, round(v_usado, 4), round(new.quantidade_alocada, 4), round(coalesce(v_ref, 0), 4),
      round(greatest(coalesce(v_ref, 0) - v_usado, 0), 4);
  end if;
  return new;
end $$;


--
-- Name: fn_tarefa_prefixo_nome(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_tarefa_prefixo_nome(_tarefa_id uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(i.descricao, s.nome, 'Tarefa') || coalesce(' ' || tr.nome, '')
    from public.planejamento_tarefa t
    left join public.item_orcamentario i on i.id = t.item_orcamentario_id
    left join public.servico s on s.id = i.servico_id
    left join public.obra_trecho tr on tr.id = public.fn_tarefa_trecho_principal(_tarefa_id)
   where t.id = _tarefa_id
$$;


--
-- Name: fn_tarefa_so_aceita_servico_grupo(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_tarefa_so_aceita_servico_grupo() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  item_tipo text;
  item_obra uuid;
  item_serv uuid;
  item_ind  uuid;
  plan_obra uuid;
begin
  if new.item_orcamentario_id is null then
    return new;
  end if;

  select tipo, obra_id, servico_id, indireto_id into item_tipo, item_obra, item_serv, item_ind
    from public.item_orcamentario where id = new.item_orcamentario_id;
  if item_tipo is null then
    raise exception 'item_orcamentario % inexistente', new.item_orcamentario_id;
  end if;
  if item_tipo <> 'servico_grupo' then
    raise exception 'Apenas itens do tipo servico_grupo podem virar tarefa (tipo=%)', item_tipo;
  end if;
  if item_serv is null and item_ind is null then
    raise exception 'Agrupamento sem composição vinculada não pode ser planejado — vincule uma composição no orçamento';
  end if;

  select obra_id into plan_obra from public.planejamento where id = new.planejamento_id;
  if plan_obra <> item_obra then
    raise exception 'tarefa: planejamento.obra_id (%) difere de item_orcamentario.obra_id (%)',
      plan_obra, item_obra;
  end if;
  return new;
end
$$;


--
-- Name: fn_tarefa_trecho_principal(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_tarefa_trecho_principal(_tarefa_id uuid) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select l.trecho_id from public.planejamento_tarefa_local l
   where l.tarefa_id = _tarefa_id and l.trecho_id is not null
   order by l.ordem, l.inicio_m limit 1
$$;


--
-- Name: fn_tarefa_validar_nivel(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_tarefa_validar_nivel() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare pn smallint; pt text; pp uuid;
begin
  if new.parent_id is null then
    if new.nivel <> 1 then raise exception 'parent_id NULL exige nivel=1 (recebido %)', new.nivel; end if;
    return new;
  end if;
  select nivel, tipo_no, planejamento_id into pn, pt, pp from public.planejamento_tarefa where id = new.parent_id;
  if pn is null then raise exception 'parent_id % inexistente', new.parent_id; end if;
  if pt <> 'grupo' then raise exception 'A tarefa superior precisa ser uma tarefa-resumo'; end if;
  if pp <> new.planejamento_id then raise exception 'Tarefa-resumo de outro plano'; end if;
  if new.nivel <> pn + 1 then raise exception 'nivel invalido (esperado %, recebido %)', pn + 1, new.nivel; end if;
  if new.nivel > 10 then raise exception 'A EAP aceita no máximo 10 níveis'; end if;
  return new;
end $$;


--
-- Name: fn_touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at := now();
  return new;
end
$$;


--
-- Name: fn_transporte_local_antes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_transporte_local_antes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_tr record;
begin
  if new.trecho_id is not null then
    select id, obra_id, tipo, nome, comprimento_m into v_tr from public.obra_trecho where id = new.trecho_id;
    if v_tr.id is null or v_tr.obra_id <> new.obra_id then raise exception 'Local de outra obra'; end if;
  end if;
  new.nome := trim(new.nome);
  if new.nome = '' then raise exception 'Informe o nome do local'; end if;
  if new.tipo = 'pista' then
    if new.trecho_id is null then raise exception 'Local na pista precisa do trecho (eixo ou área)'; end if;
    new.estaca_acesso_m := null;
    new.distancia_acesso_km := 0;
  else
    new.distancia_acesso_km := coalesce(new.distancia_acesso_km, 0);
    if new.estaca_acesso_m is not null then
      if new.trecho_id is null then raise exception 'Escolha o trecho onde fica a estaca de acesso'; end if;
      if v_tr.tipo = 'area' then raise exception 'Estaca de acesso só em eixo (não em área)'; end if;
      if new.estaca_acesso_m > coalesce(v_tr.comprimento_m, 0) + 0.005 then
        raise exception 'Estaca de acesso fora do trecho "%"', v_tr.nome;
      end if;
    end if;
  end if;
  return new;
end $$;


--
-- Name: fn_transporte_rota_antes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_transporte_rota_antes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare o1 uuid; o2 uuid;
begin
  select obra_id into o1 from public.transporte_local where id = new.origem_id;
  select obra_id into o2 from public.transporte_local where id = new.destino_id;
  if o1 is null or o1 <> o2 then raise exception 'Origem e destino precisam ser da mesma obra'; end if;
  new.obra_id := o1;
  return new;
end $$;


--
-- Name: fn_trecho_antes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_trecho_antes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_max numeric; v_fonte text;
begin
  if new.tipo = 'area' then
    new.comprimento_m := null;
    if tg_op = 'UPDATE' and old.tipo = 'eixo' and (
         exists (select 1 from public.planejamento_tarefa_local l where l.trecho_id = new.id and l.inicio_m is not null)
      or exists (select 1 from public.trecho_quantidade_template tp where tp.trecho_id = new.id)) then
      raise exception 'O trecho "%" já tem locais ou quantidades por estaca — não dá para transformá-lo em área', new.nome;
    end if;
    return new;
  end if;
  -- eixo
  if tg_op = 'UPDATE' and old.tipo = 'area'
     and exists (select 1 from public.planejamento_tarefa_local l where l.trecho_id = new.id) then
    raise exception 'A área "%" já tem locais de tarefa — não dá para transformá-la em eixo', new.nome;
  end if;
  if new.geometry_comprimento_m is not null then
    new.comprimento_m := new.geometry_comprimento_m;
  end if;
  if new.comprimento_m is null or new.comprimento_m <= 0 then
    raise exception 'Informe o comprimento do eixo "%" (estaca inicial e final)', new.nome;
  end if;
  if tg_op = 'UPDATE' and new.comprimento_m < old.comprimento_m - 0.005 then
    -- "Task outside station span" (ApeX 19): encurtar o eixo deixando algo de fora é recusado
    select max(l.fim_m) into v_max
      from public.planejamento_tarefa_local l join public.planejamento p on p.id = l.planejamento_id
     where l.trecho_id = new.id and not p.is_baseline;
    if v_max is not null and v_max > new.comprimento_m + 0.005 then v_fonte := 'locais de tarefa'; end if;
    if v_fonte is null then
      select max(s.posicao_fim_m) into v_max
        from public.trecho_quantidade_segmento s where s.versao_id = public.trecho_versao_atual(new.id);
      if v_max is not null and v_max > new.comprimento_m + 0.005 then v_fonte := 'quantidades por estaca'; end if;
    end if;
    if v_fonte is null then
      select max((f->>'fim_m')::numeric) into v_max
        from public.planejamento_marco m
        join public.planejamento p on p.id = m.planejamento_id
        cross join lateral jsonb_array_elements(coalesce(m.faixas, '[]'::jsonb)) f
       where p.obra_id = new.obra_id and not p.is_baseline and (f->>'trecho_id')::uuid = new.id;
      if v_max is not null and v_max > new.comprimento_m + 0.005 then v_fonte := 'faixas de marco'; end if;
    end if;
    if v_fonte is not null then
      raise exception 'Trecho "%": há % até % m — encurte-os antes de reduzir o eixo para % m',
        new.nome, v_fonte, round(v_max, 2), round(new.comprimento_m, 2);
    end if;
  end if;
  return new;
end $$;


--
-- Name: fn_trecho_assert_editavel(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_trecho_assert_editavel(_trecho_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_obra uuid; motivo text;
begin
  select obra_id into v_obra from public.obra_trecho where id = _trecho_id;
  if v_obra is null then raise exception 'Trecho não encontrado'; end if;
  if not public.pode_planejar_obra(v_obra) then raise exception 'Sem permissão'; end if;
  motivo := public.cadeia_trava_motivo(v_obra);
  if motivo is not null then raise exception 'Trecho travado: %', motivo; end if;
  return v_obra;
end $$;


--
-- Name: fn_valor_servico_em(uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_valor_servico_em(_grupo_id uuid, _data date) RETURNS numeric
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: fn_viagem_antes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_viagem_antes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_f record; v_item record; v_par record; v_o record; v_d record; v_tro record; v_trd record;
  v_pc numeric; v_pd numeric; v_geo numeric; v_rota numeric;
begin
  select obra_id, data into v_f from public.viagem_ficha where id = new.ficha_id;
  if v_f.obra_id is null then raise exception 'Ficha de viagens inexistente'; end if;
  new.obra_id := v_f.obra_id;
  new.data := v_f.data;
  select obra_id, tipo, descricao into v_item from public.item_orcamentario where id = new.item_orcamentario_id;
  if v_item.obra_id is distinct from new.obra_id or v_item.tipo <> 'servico_grupo' then
    raise exception 'Serviço inválido para a obra';
  end if;
  select modo_lancamento, medicao_viagem into v_par
    from public.servico_parametro where item_orcamentario_id = new.item_orcamentario_id;
  if coalesce(v_par.modo_lancamento, 'quantidade') <> 'viagens' then
    raise exception 'O serviço "%" não está parametrizado para viagens', v_item.descricao;
  end if;

  -- origem e destino
  if new.origem_id is null or new.destino_id is null then
    raise exception 'Informe a origem e o destino da viagem';
  end if;
  select l.obra_id, l.tipo, l.nome, l.trecho_id, l.estaca_acesso_m, l.distancia_acesso_km into v_o
    from public.transporte_local l where l.id = new.origem_id;
  select l.obra_id, l.tipo, l.nome, l.trecho_id, l.estaca_acesso_m, l.distancia_acesso_km into v_d
    from public.transporte_local l where l.id = new.destino_id;
  if v_o.obra_id is distinct from new.obra_id then raise exception 'Origem de outra obra'; end if;
  if v_d.obra_id is distinct from new.obra_id then raise exception 'Destino de outra obra'; end if;
  select id, tipo, nome, comprimento_m into v_tro from public.obra_trecho where id = v_o.trecho_id;
  select id, tipo, nome, comprimento_m into v_trd from public.obra_trecho where id = v_d.trecho_id;

  -- estacas: na pista a viagem informa; fora dela vale a estaca de acesso do local
  if v_o.tipo = 'pista' and v_tro.tipo = 'eixo' then
    if new.estaca_carga_m is null then
      raise exception 'Informe a estaca de carga (a origem "%" é na pista)', v_o.nome;
    end if;
    if new.estaca_carga_m < 0 or new.estaca_carga_m > coalesce(v_tro.comprimento_m, 0) + 0.005 then
      raise exception 'Estaca de carga fora do trecho "%"', v_tro.nome;
    end if;
    v_pc := new.estaca_carga_m;
  else
    new.estaca_carga_m := null;
    v_pc := case when v_tro.tipo = 'eixo' then v_o.estaca_acesso_m end;
  end if;
  if v_d.tipo = 'pista' and v_trd.tipo = 'eixo' then
    if new.estaca_descarga_m is null then
      raise exception 'Informe a estaca de descarga (o destino "%" é na pista)', v_d.nome;
    end if;
    if new.estaca_descarga_m < 0 or new.estaca_descarga_m > coalesce(v_trd.comprimento_m, 0) + 0.005 then
      raise exception 'Estaca de descarga fora do trecho "%"', v_trd.nome;
    end if;
    v_pd := new.estaca_descarga_m;
  else
    new.estaca_descarga_m := null;
    v_pd := case when v_trd.tipo = 'eixo' then v_d.estaca_acesso_m end;
  end if;

  -- local da produção: a ponta na pista (o destino quando os dois são), senão o trecho de algum dos locais
  if v_d.tipo = 'pista' then
    new.trecho_id := v_d.trecho_id;
    new.posicao_inicio_m := new.estaca_descarga_m;
  elsif v_o.tipo = 'pista' then
    new.trecho_id := v_o.trecho_id;
    new.posicao_inicio_m := new.estaca_carga_m;
  else
    new.trecho_id := coalesce(v_d.trecho_id, v_o.trecho_id);
    new.posicao_inicio_m := null;
  end if;
  new.posicao_fim_m := new.posicao_inicio_m;

  -- quantidade: lançada na unidade do serviço (empolamento e densidade ficam com quem lança)
  if new.quantidade is null or new.quantidade <= 0 then
    raise exception 'Informe a quantidade da viagem';
  end if;
  if coalesce(v_par.medicao_viagem, 'volume') = 'peso' and coalesce(trim(new.nf_ticket), '') = '' then
    raise exception 'Informe o ticket da balança (o serviço é medido por peso)';
  end if;

  -- DMT
  if v_o.trecho_id is not null and v_o.trecho_id = v_d.trecho_id and v_pc is not null and v_pd is not null then
    v_geo := round(
      (case when v_o.tipo = 'pista' then 0 else coalesce(v_o.distancia_acesso_km, 0) end)
      + abs(v_pc - v_pd) / 1000.0
      + (case when v_d.tipo = 'pista' then 0 else coalesce(v_d.distancia_acesso_km, 0) end), 3);
  end if;
  select dmt_km into v_rota from public.transporte_rota
   where origem_id = new.origem_id and destino_id = new.destino_id;
  new.dmt_calculada_km := coalesce(v_rota, v_geo);
  if coalesce(new.dmt_manual, false) then
    if new.dmt_km is null then raise exception 'Informe a DMT ajustada (km)'; end if;
    new.dmt_origem := 'manual';
  elsif v_rota is not null then
    new.dmt_km := v_rota;
    new.dmt_origem := 'rota';
  elsif v_geo is not null then
    new.dmt_km := v_geo;
    new.dmt_origem := 'geometria';
  else
    raise exception 'Sem como calcular a DMT de "%" para "%": cadastre a estaca de acesso dos locais (no mesmo trecho) ou a distância fixa do par em Origens e destinos',
      v_o.nome, v_d.nome;
  end if;

  new.updated_at := now();
  return new;
end $$;


--
-- Name: fn_viagem_carregador(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_viagem_carregador() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if new.carregador_id is not null and not exists (
    select 1 from public.frota_veiculo v
     where v.id = new.carregador_id and v.empresa_id = public.obra_empresa(new.obra_id)
  ) then raise exception 'Equipamento de carga de outra empresa'; end if;
  return new;
end $$;


--
-- Name: fn_viagem_depois(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_viagem_depois() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.fn_viagens_recompor(old.obra_id, old.data, old.item_orcamentario_id, old.trecho_id,
                                       old.equipe_id, old.encarregado_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.fn_viagens_recompor(new.obra_id, new.data, new.item_orcamentario_id, new.trecho_id,
                                       new.equipe_id, new.encarregado_id);
  end if;
  return null;
end $$;


--
-- Name: fn_viagem_equipe_da_ficha(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_viagem_equipe_da_ficha() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  select f.equipe_id, f.encarregado_id into new.equipe_id, new.encarregado_id
    from public.viagem_ficha f where f.id = new.ficha_id;
  return new;
end $$;


--
-- Name: fn_viagem_ficha_antes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_viagem_ficha_antes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if new.veiculo_id is not null and not exists (
    select 1 from public.frota_veiculo v
     where v.id = new.veiculo_id and v.empresa_id = public.obra_empresa(new.obra_id)
  ) then raise exception 'Veículo de outra empresa'; end if;
  if new.equipe_id is not null and not exists (
    select 1 from public.equipe e where e.id = new.equipe_id and e.obra_id = new.obra_id
  ) then raise exception 'Equipe de outra obra'; end if;
  if new.encarregado_id is not null and not exists (
    select 1 from public.encarregado en where en.id = new.encarregado_id and en.obra_id = new.obra_id
  ) then raise exception 'Encarregado de outra obra'; end if;
  if new.data > current_date + 1 then raise exception 'Data no futuro'; end if;
  if tg_op = 'INSERT' then new.criado_por := coalesce(new.criado_por, auth.uid());
  elsif new.obra_id <> old.obra_id then raise exception 'A ficha não muda de obra';
  end if;
  new.updated_at := now();
  return new;
end $$;


--
-- Name: fn_viagem_ficha_depois(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_viagem_ficha_depois() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if new.data is distinct from old.data or new.equipe_id is distinct from old.equipe_id
     or new.encarregado_id is distinct from old.encarregado_id then
    update public.viagem set data = new.data, equipe_id = new.equipe_id, encarregado_id = new.encarregado_id
     where ficha_id = new.id;
  end if;
  return null;
end $$;


--
-- Name: fn_viagens_recompor(uuid, date, uuid, uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_viagens_recompor(_obra uuid, _data date, _item uuid, _trecho uuid, _equipe uuid, _enc uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_tot numeric; v_n int; v_ini numeric; v_fim numeric; v_mat numeric; v_unid text;
  v_prod uuid; v_par record; v_tem_mat boolean;
begin
  select sum(quantidade), count(*), min(posicao_inicio_m), max(posicao_fim_m)
    into v_tot, v_n, v_ini, v_fim
    from public.viagem
   where obra_id = _obra and data = _data and item_orcamentario_id = _item
     and trecho_id is not distinct from _trecho
     and equipe_id is not distinct from _equipe and encarregado_id is not distinct from _enc;
  select id into v_prod from public.acompanhamento_producao
   where obra_id = _obra and data = _data and item_orcamentario_id = _item and origem = 'viagens'
     and trecho_id is not distinct from _trecho
     and equipe_id is not distinct from _equipe and encarregado_id is not distinct from _enc;

  perform set_config('infrawork.viagens_sync', '1', true);
  if coalesce(v_tot, 0) <= 0 then
    if v_prod is not null then delete from public.acompanhamento_producao where id = v_prod; end if;
    perform set_config('infrawork.viagens_sync', '', true);
    return;
  end if;
  if v_prod is null then
    insert into public.acompanhamento_producao
      (obra_id, data, item_orcamentario_id, servico_nome, quantidade, origem, trecho_id,
       posicao_inicio_m, posicao_fim_m, obs, criado_por, equipe_id, encarregado_id)
    values (_obra, _data, _item, '', v_tot, 'viagens', _trecho, v_ini, v_fim,
            v_n || case when v_n = 1 then ' viagem' else ' viagens' end, null, _equipe, _enc)
    returning id into v_prod;
  else
    update public.acompanhamento_producao
       set quantidade = v_tot, posicao_inicio_m = v_ini, posicao_fim_m = v_fim,
           obs = v_n || case when v_n = 1 then ' viagem' else ' viagens' end
     where id = v_prod;
  end if;

  select material_recurso_id, material_unidade into v_par
    from public.servico_parametro
   where item_orcamentario_id = _item and controla_material;
  v_tem_mat := found and v_par.material_recurso_id is not null;
  delete from public.acompanhamento_producao_material where producao_id = v_prod;
  if v_tem_mat then
    select unidade into v_unid from public.acompanhamento_producao where id = v_prod;
    select sum(coalesce(material_qtd,
                        case when lower(coalesce(v_par.material_unidade, '')) = lower(coalesce(v_unid, ''))
                             then quantidade end))
      into v_mat
      from public.viagem
     where obra_id = _obra and data = _data and item_orcamentario_id = _item
       and trecho_id is not distinct from _trecho
       and equipe_id is not distinct from _equipe and encarregado_id is not distinct from _enc;
    if v_mat is not null then
      insert into public.acompanhamento_producao_material (producao_id, recurso_id, nome, quantidade, unidade)
      values (v_prod, v_par.material_recurso_id, '', v_mat, v_par.material_unidade);
    end if;
  end if;
  perform set_config('infrawork.viagens_sync', '', true);
end $$;


--
-- Name: get_or_create_indireto_resources(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_or_create_indireto_resources(p_obra_id uuid) RETURNS TABLE(equipe_id uuid)
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
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


--
-- Name: has_obra_permissao(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_obra_permissao(_obra_id uuid, _user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
      from public.obra_permissoes
     where obra_id = _obra_id
       and user_id = _user_id
  )
$$;


--
-- Name: imp_definir_preco_vigente(uuid, numeric, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.imp_definir_preco_vigente(_recurso_id uuid, _preco numeric, _origem text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  atual numeric;
  novo_id uuid;
begin
  if _preco is null then return false; end if;
  atual := public.preco_vigente_recurso(_recurso_id);
  if atual is not null and atual = _preco then return false; end if;
  update public.recurso_preco set is_vigente = false
   where recurso_id = _recurso_id and is_vigente = true;
  insert into public.recurso_preco (recurso_id, custo_unitario, vigencia_inicio, origem, is_vigente, criado_por)
  values (_recurso_id, _preco, current_date, coalesce(_origem, 'importacao_modelo'), true, auth.uid())
  returning id into novo_id;
  return true;
end
$$;


--
-- Name: imp_grupo_recurso(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.imp_grupo_recurso(_grupo_item text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select case _grupo_item
    when 'EQUIPAMENTO' then 'MVE'
    when 'MO' then 'MO'
    when 'MATERIAL' then 'MATERIAL'
    when 'COMBUSTIVEL' then 'COMBUSTIVEL'
    else null end
$$;


--
-- Name: importar_composicoes(uuid, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.importar_composicoes(_obra_id uuid, _composicoes jsonb, _opcoes jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $_$
declare
  t0 timestamptz := clock_timestamp();
  modo_existente text := coalesce(_opcoes->>'modo_existente', 'substituir_itens');
  criar_recursos boolean := coalesce((_opcoes->>'criar_recursos_faltantes')::boolean, true);
  comb_padrao uuid := nullif(_opcoes->>'combustivel_padrao_recurso_id', '')::uuid;
  tudo_ou_nada boolean := coalesce((_opcoes->>'tudo_ou_nada')::boolean, false);
  c jsonb; it jsonb;
  v_row int; v_codigo text; v_nome text; v_unidade text; v_prod numeric; v_obs text;
  partes text[]; prefixo text; v_parent_id uuid; p_id uuid; i int;
  v_servico_id uuid; v_cpu_id uuid; v_cpu_antiga uuid; v_versao int;
  eh_grupo boolean;
  -- itens
  it_row int; it_grupo text; it_grupo_rec text; it_ref text; it_unid text; it_preco numeric;
  it_qtd numeric; it_horas numeric; it_cons_lh numeric; it_idx numeric; it_cons_mat numeric;
  rec_id uuid; ordem int; tem_comb boolean; soma_lh numeric; custo numeric;
  n_grupos int := 0; n_serv_criados int := 0; n_serv_atualizados int := 0;
  n_cpus_criadas int := 0; n_cpus_atualizadas int := 0; n_cpus_puladas int := 0;
  n_itens int := 0; n_rec_criados int := 0; n_precos int := 0;
  erros jsonb := '[]'::jsonb; avisos jsonb := '[]'::jsonb; resultados jsonb := '[]'::jsonb;
begin
  if not public.pode_editar_orcamento(_obra_id) then
    raise exception 'Sem permissão para editar o orçamento desta obra' using errcode = '42501';
  end if;
  if modo_existente not in ('substituir_itens', 'nova_versao', 'pular', 'erro') then
    raise exception 'modo_existente inválido: %', modo_existente;
  end if;
  if comb_padrao is not null and not exists (
    select 1 from public.recurso where id = comb_padrao and obra_id = _obra_id and grupo = 'COMBUSTIVEL'
  ) then
    raise exception 'combustivel_padrao_recurso_id não é um combustível desta obra';
  end if;
  perform pg_advisory_xact_lock(hashtext('import:' || _obra_id::text));

  -- ordena por profundidade do código e depois pelo código
  for c in
    select e.value
      from jsonb_array_elements(coalesce(_composicoes, '[]'::jsonb)) e
     order by array_length(string_to_array(e.value->>'codigo', '.'), 1), e.value->>'codigo'
  loop
    begin
      v_row     := coalesce((c->>'row')::int, 0);
      v_codigo  := trim(c->>'codigo');
      v_nome    := trim(c->>'nome');
      v_unidade := nullif(trim(c->>'unidade'), '');
      v_prod    := nullif(c->>'producao_qtde', '')::numeric;
      v_obs     := nullif(trim(c->>'observacao'), '');
      if v_codigo is null or v_codigo !~ '^[0-9]{1,3}(\.[0-9]{1,3})*$' then
        raise exception 'Código inválido: %', coalesce(v_codigo, '(vazio)');
      end if;
      if v_nome is null or v_nome = '' then raise exception 'Nome obrigatório'; end if;
      eh_grupo := v_unidade is null;
      if not eh_grupo and upper(v_unidade) = 'DIA' then
        raise exception 'Unidade "DIA" não é permitida para composição';
      end if;
      if not eh_grupo and (v_prod is null or v_prod <= 0) then
        raise exception 'Produção por dia deve ser > 0';
      end if;

      -- pais implícitos (grupos) pelos prefixos do código
      partes := string_to_array(v_codigo, '.');
      v_parent_id := null;
      for i in 1 .. array_length(partes, 1) - 1 loop
        prefixo := array_to_string(partes[1:i], '.');
        select id into p_id from public.servico where obra_id = _obra_id and codigo = prefixo;
        if p_id is null then
          insert into public.servico (obra_id, codigo, nome, parent_id, unidade, ativo)
          values (_obra_id, prefixo, 'Grupo ' || prefixo, v_parent_id, null, true)
          returning id into p_id;
          n_grupos := n_grupos + 1;
        end if;
        v_parent_id := p_id;
      end loop;

      -- serviço (grupo ou folha)
      select id into v_servico_id from public.servico where obra_id = _obra_id and codigo = v_codigo;
      if v_servico_id is null then
        insert into public.servico (obra_id, codigo, nome, parent_id, unidade, ativo, descricao)
        values (_obra_id, v_codigo, v_nome, v_parent_id, v_unidade, true, null)
        returning id into v_servico_id;
        n_serv_criados := n_serv_criados + 1;
      else
        update public.servico
           set nome = v_nome, parent_id = v_parent_id, unidade = v_unidade, ativo = true
         where id = v_servico_id;
        n_serv_atualizados := n_serv_atualizados + 1;
      end if;

      if eh_grupo then
        continue;
      end if;

      -- CPU vigente
      select id into v_cpu_antiga from public.cpu where servico_id = v_servico_id and is_vigente = true;
      v_cpu_id := null;
      if v_cpu_antiga is null then
        select coalesce(max(versao), 0) + 1 into v_versao from public.cpu where servico_id = v_servico_id;
        insert into public.cpu (obra_id, servico_id, versao, nome, producao_diaria_qtde, producao_diaria_unidade, notas, is_vigente, criado_por)
        values (_obra_id, v_servico_id, v_versao, v_nome, v_prod, v_unidade, v_obs, true, auth.uid())
        returning id into v_cpu_id;
        n_cpus_criadas := n_cpus_criadas + 1;
      else
        if modo_existente = 'pular' then
          n_cpus_puladas := n_cpus_puladas + 1;
          resultados := resultados || jsonb_build_object('row', v_row, 'codigo', v_codigo, 'servico_id', v_servico_id, 'cpu_id', v_cpu_antiga, 'acao', 'pular');
          continue;
        elsif modo_existente = 'erro' then
          raise exception 'Composição % já existe', v_codigo;
        elsif modo_existente = 'substituir_itens' then
          v_cpu_id := v_cpu_antiga;
          update public.cpu
             set nome = v_nome, producao_diaria_qtde = v_prod, producao_diaria_unidade = v_unidade,
                 notas = coalesce(v_obs, notas)
           where id = v_cpu_id;
          delete from public.cpu_item where cpu_id = v_cpu_id;
          n_cpus_atualizadas := n_cpus_atualizadas + 1;
        else -- nova_versao
          select coalesce(max(versao), 0) + 1 into v_versao from public.cpu where servico_id = v_servico_id;
          insert into public.cpu (obra_id, servico_id, versao, nome, producao_diaria_qtde, producao_diaria_unidade, notas, is_vigente, criado_por)
          values (_obra_id, v_servico_id, v_versao, v_nome, v_prod, v_unidade, v_obs, true, auth.uid())
          returning id into v_cpu_id;
          update public.servico_cpu_link set cpu_id = v_cpu_id
           where servico_id = v_servico_id and cpu_id = v_cpu_antiga;
          n_cpus_criadas := n_cpus_criadas + 1;
        end if;
      end if;

      -- itens: EQ/MO/MAT primeiro, COMBUSTIVEL por último (o cálculo do
      -- combustível agrega os equipamentos já inseridos)
      ordem := 0; tem_comb := false; soma_lh := 0;
      for it in
        select e.value
          from jsonb_array_elements(coalesce(c->'itens', '[]'::jsonb)) with ordinality e(value, ordinality)
         order by case upper(e.value->>'grupo') when 'COMBUSTIVEL' then 1 else 0 end, e.ordinality
      loop
        begin
          it_row   := coalesce((it->>'row')::int, 0);
          it_grupo := upper(trim(it->>'grupo'));
          it_grupo_rec := public.imp_grupo_recurso(it_grupo);
          if it_grupo_rec is null then raise exception 'Tipo inválido: %', it_grupo; end if;
          it_ref   := nullif(trim(it->>'recurso_ref'), '');
          it_unid  := nullif(trim(it->>'recurso_unidade'), '');
          it_preco := nullif(it->>'preco', '')::numeric;
          it_qtd   := nullif(it->>'quantidade', '')::numeric;
          it_horas := nullif(it->>'horas_dia', '')::numeric;
          it_cons_lh := nullif(it->>'consumo_combustivel_lh', '')::numeric;
          it_idx   := nullif(it->>'indice_produtividade', '')::numeric;
          it_cons_mat := nullif(it->>'consumo_material_por_unid', '')::numeric;

          -- resolve recurso: id → código → (grupo, nome normalizado)
          rec_id := nullif(it->>'recurso_id', '')::uuid;
          if rec_id is not null and not exists (
            select 1 from public.recurso where id = rec_id and obra_id = _obra_id
          ) then
            raise exception 'recurso_id de outra obra';
          end if;
          if rec_id is null and it_ref is not null then
            select id into rec_id from public.recurso
             where obra_id = _obra_id and codigo = it_ref limit 1;
            if rec_id is null then
              select id into rec_id from public.recurso
               where obra_id = _obra_id and grupo = it_grupo_rec
                 and public.norm_txt(nome) = public.norm_txt(it_ref)
               limit 1;
            end if;
          end if;
          if rec_id is null then
            if it_ref is null then raise exception 'Recurso obrigatório'; end if;
            if not criar_recursos then
              raise exception 'Recurso não encontrado: % (%)', it_ref, it_grupo_rec;
            end if;
            insert into public.recurso (obra_id, grupo, nome, unidade, ativo, fonte, observacao)
            values (_obra_id, it_grupo_rec, it_ref, coalesce(it_unid, 'un'), true, 'importacao_modelo',
                    'Criado pela importação de composições (' || v_codigo || ')')
            returning id into rec_id;
            n_rec_criados := n_rec_criados + 1;
            if it_preco is not null and public.imp_definir_preco_vigente(rec_id, it_preco, 'importacao_modelo') then
              n_precos := n_precos + 1;
            end if;
          end if;

          -- defaults por grupo
          if it_grupo in ('EQUIPAMENTO', 'MO') then
            it_qtd := coalesce(it_qtd, 1);
            it_horas := coalesce(it_horas, 8);
          elsif it_grupo = 'MATERIAL' then
            it_qtd := coalesce(it_qtd, 0);
            it_horas := null;
          else -- COMBUSTIVEL
            it_qtd := coalesce(it_qtd, 0);
            it_horas := null;
            tem_comb := true;
          end if;
          if it_idx is not null and it_idx > 1 and it_idx <= 100 then it_idx := it_idx / 100; end if;
          it_idx := coalesce(it_idx, 1);
          if it_idx < 0 or it_idx > 1 then raise exception 'Índice produtivo fora de 0..1'; end if;
          if it_grupo = 'EQUIPAMENTO' then soma_lh := soma_lh + coalesce(it_cons_lh, 0) * it_qtd; end if;

          insert into public.cpu_item (cpu_id, grupo, recurso_id, quantidade, horas_dia,
                                       consumo_combustivel_lh, indice_produtividade,
                                       consumo_material_por_unid, ordem)
          values (v_cpu_id, it_grupo, rec_id, it_qtd, it_horas,
                  case when it_grupo = 'EQUIPAMENTO' then it_cons_lh else null end,
                  it_idx,
                  case when it_grupo = 'MATERIAL' then it_cons_mat else null end,
                  ordem);
          ordem := ordem + 1;
          n_itens := n_itens + 1;
        exception when others then
          if tudo_ou_nada then raise; end if;
          erros := erros || jsonb_build_object('row', it_row, 'msg', sqlerrm, 'composicao', v_codigo);
        end;
      end loop;

      -- combustível automático
      if not tem_comb and soma_lh > 0 then
        if comb_padrao is not null then
          insert into public.cpu_item (cpu_id, grupo, recurso_id, quantidade, horas_dia, indice_produtividade, ordem)
          values (v_cpu_id, 'COMBUSTIVEL', comb_padrao, 0, null, 1, ordem);
          n_itens := n_itens + 1;
        else
          avisos := avisos || jsonb_build_object('row', v_row, 'code', 'COMBUSTIVEL_AUSENTE',
            'msg', 'Composição ' || v_codigo || ' tem equipamentos com consumo mas nenhuma linha de combustível');
        end if;
      end if;

      -- vínculo serviço ↔ CPU (fator 1) quando o serviço ainda não tem links
      if not exists (select 1 from public.servico_cpu_link where servico_id = v_servico_id) then
        insert into public.servico_cpu_link (servico_id, cpu_id, fator, operacao, ordem)
        values (v_servico_id, v_cpu_id, 1, 'dividir', 0);
      end if;

      -- garante recálculo (no-op) e coleta custo
      update public.cpu set notas = notas where id = v_cpu_id;
      perform public.fn_cpu_recalc(v_cpu_id);
      select custo_unit_calc into custo from public.cpu where id = v_cpu_id;
      resultados := resultados || jsonb_build_object(
        'row', v_row, 'codigo', v_codigo, 'servico_id', v_servico_id, 'cpu_id', v_cpu_id,
        'custo_unit', custo, 'acao', case when v_cpu_antiga is null then 'criar' else 'atualizar' end);
    exception when others then
      if tudo_ou_nada then raise; end if;
      erros := erros || jsonb_build_object('row', v_row, 'msg', sqlerrm, 'composicao', v_codigo);
    end;
  end loop;

  return jsonb_build_object(
    'ok', jsonb_array_length(erros) = 0,
    'stats', jsonb_build_object(
      'grupos_criados', n_grupos, 'servicos_criados', n_serv_criados,
      'servicos_atualizados', n_serv_atualizados, 'cpus_criadas', n_cpus_criadas,
      'cpus_atualizadas', n_cpus_atualizadas, 'cpus_puladas', n_cpus_puladas,
      'itens_criados', n_itens, 'recursos_criados', n_rec_criados, 'precos_criados', n_precos),
    'resultados', resultados,
    'erros', erros,
    'avisos', avisos,
    'duracao_ms', (extract(epoch from clock_timestamp() - t0) * 1000)::int
  );
end
$_$;


--
-- Name: importar_orcamento(uuid, jsonb, jsonb, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.importar_orcamento(_obra_id uuid, _itens jsonb, _alocacoes jsonb DEFAULT '[]'::jsonb, _servicos jsonb DEFAULT '[]'::jsonb, _opcoes jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $_$
declare
  t0 timestamptz := clock_timestamp();
  existentes text := coalesce(_opcoes->>'existentes', 'pular');
  tudo_ou_nada boolean := coalesce((_opcoes->>'tudo_ou_nada')::boolean, true);
  it jsonb; al jsonb; dst jsonb;
  v_row int; v_codigo text; v_desc text; v_unid text; v_qtd numeric; v_venda numeric;
  prefixo text; v_parent_id uuid; existente_id uuid; existente_tipo text; v_tipo text;
  v_receita_id uuid; v_criterio text; v_compoe boolean; v_servico text; v_valor numeric;
  v_grupo_id uuid; criados uuid[] := '{}'; n_dest int;
  n_etapas int := 0; n_receitas int := 0; n_atualizados int := 0; n_pulados int := 0;
  n_servicos int := 0; n_alocadas int := 0; n_rateadas int := 0; n_aloc_puladas int := 0;
  erros jsonb := '[]'::jsonb;
  g record; n_compoe int; v_unid_ref text; sv jsonb; n_manuais int := 0;
begin
  if existentes not in ('pular', 'atualizar') then
    raise exception 'opção existentes inválida: %', existentes;
  end if;
  perform pg_advisory_xact_lock(hashtext('import:' || _obra_id::text));

  -- ── 1. Planilha de venda: etapas e receitas ─────────────────────────────
  for it in
    select e.value
      from jsonb_array_elements(coalesce(_itens, '[]'::jsonb)) e
     order by array_length(string_to_array(e.value->>'codigo', '.'), 1),
              string_to_array(e.value->>'codigo', '.')::int[]
  loop
    begin
      v_row    := coalesce((it->>'row')::int, 0);
      v_codigo := trim(it->>'codigo');
      v_desc   := trim(it->>'descricao');
      v_unid   := nullif(trim(it->>'unidade'), '');
      v_qtd    := nullif(it->>'quantidade', '')::numeric;
      v_venda  := nullif(it->>'venda_unitaria', '')::numeric;
      if v_codigo is null or v_codigo !~ '^[0-9]+(\.[0-9]+)*$' then
        raise exception 'Código inválido: %', coalesce(v_codigo, '(vazio)');
      end if;
      if v_desc is null or v_desc = '' then raise exception 'Descrição obrigatória'; end if;

      if v_unid is null and v_qtd is null then
        v_tipo := 'etapa';
      else
        if v_unid is null then raise exception 'Unidade obrigatória quando há quantidade'; end if;
        if v_qtd is null or v_qtd <= 0 then raise exception 'Quantidade deve ser > 0'; end if;
        if v_venda is null then raise exception 'Preço unitário de venda obrigatório'; end if;
        v_tipo := 'receita';
      end if;

      v_parent_id := null;
      if position('.' in v_codigo) > 0 then
        prefixo := left(v_codigo, length(v_codigo) - position('.' in reverse(v_codigo)));
        select id into v_parent_id from public.item_orcamentario
         where obra_id = _obra_id and codigo = prefixo and tipo = 'etapa';
      end if;

      select id, tipo into existente_id, existente_tipo
        from public.item_orcamentario where obra_id = _obra_id and codigo = v_codigo;

      if existente_id is not null then
        if existentes = 'pular' then
          n_pulados := n_pulados + 1;
          continue;
        end if;
        if existente_tipo <> v_tipo then
          raise exception 'Item % já existe com outro tipo (%)', v_codigo, existente_tipo;
        end if;
        if v_tipo = 'etapa' then
          update public.item_orcamentario set descricao = v_desc where id = existente_id;
        else
          update public.item_orcamentario
             set descricao = v_desc, unidade = v_unid, quantidade = v_qtd, venda_unitaria = v_venda
           where id = existente_id;
        end if;
        n_atualizados := n_atualizados + 1;
        continue;
      end if;

      if v_tipo = 'etapa' then
        insert into public.item_orcamentario (obra_id, parent_id, codigo, descricao, tipo)
        values (_obra_id, v_parent_id, v_codigo, v_desc, 'etapa');
        n_etapas := n_etapas + 1;
      else
        insert into public.item_orcamentario (obra_id, parent_id, codigo, descricao, tipo, unidade, quantidade, venda_unitaria)
        values (_obra_id, v_parent_id, v_codigo, v_desc, 'receita', v_unid, v_qtd, v_venda);
        n_receitas := n_receitas + 1;
      end if;
    exception when others then
      if tudo_ou_nada then raise; end if;
      erros := erros || jsonb_build_object('row', v_row, 'msg', sqlerrm, 'codigo', v_codigo);
    end;
  end loop;

  -- ── 2. Alocações (serviços e rateios) ───────────────────────────────────
  for al in select e.value from jsonb_array_elements(coalesce(_alocacoes, '[]'::jsonb)) e
  loop
    begin
      v_row      := coalesce((al->>'row')::int, 0);
      v_codigo   := trim(al->>'codigo');
      v_criterio := coalesce(nullif(trim(al->>'criterio'), ''), 'percentual');
      v_compoe   := coalesce((al->>'compoe')::boolean, false);
      n_dest     := jsonb_array_length(coalesce(al->'destinos', '[]'::jsonb));
      if n_dest = 0 then continue; end if;

      select id into v_receita_id from public.item_orcamentario
       where obra_id = _obra_id and codigo = v_codigo and tipo = 'receita';
      if v_receita_id is null then raise exception 'Receita % não encontrada', v_codigo; end if;

      if exists (select 1 from public.item_orc_alocacao where receita_id = v_receita_id) then
        if existentes = 'pular' then
          n_aloc_puladas := n_aloc_puladas + 1;
          continue;
        end if;
        delete from public.item_orc_alocacao where receita_id = v_receita_id;
      end if;

      for dst in select d.value from jsonb_array_elements(al->'destinos') d
      loop
        v_servico := trim(dst->>'servico');
        v_valor   := nullif(dst->>'valor', '')::numeric;
        if v_servico is null or v_servico = '' then raise exception 'Serviço vazio no rateio'; end if;

        select id into v_grupo_id from public.item_orcamentario
         where obra_id = _obra_id and tipo = 'servico_grupo'
           and lower(trim(descricao)) = lower(v_servico)
         order by codigo limit 1;
        if v_grupo_id is null then
          insert into public.item_orcamentario (obra_id, parent_id, codigo, descricao, tipo,
                                                qtd_ref_modo, quantidade_referencia)
          values (_obra_id, null, null, v_servico, 'servico_grupo', 'soma_filhos', 0)
          returning id into v_grupo_id;
          criados := criados || v_grupo_id;
          n_servicos := n_servicos + 1;
        end if;

        insert into public.item_orc_alocacao (obra_id, grupo_id, receita_id, criterio, valor, compoe_qtd)
        values (_obra_id, v_grupo_id, v_receita_id, v_criterio,
                case when v_criterio = 'venda' then null else v_valor end, v_compoe);
      end loop;

      n_alocadas := n_alocadas + 1;
      if n_dest > 1 then n_rateadas := n_rateadas + 1; end if;
    exception when others then
      if tudo_ou_nada then raise; end if;
      erros := erros || jsonb_build_object('row', v_row, 'msg', sqlerrm, 'codigo', v_codigo);
    end;
  end loop;

  -- ── 3. Serviços novos: modo/unidade da quantidade pelo "compõe" ─────────
  for g in select id from public.item_orcamentario where id = any(criados)
  loop
    select count(*),
           case when count(distinct lower(trim(r.unidade))) = 1 then min(r.unidade) end
      into n_compoe, v_unid_ref
      from public.item_orc_alocacao a
      join public.item_orcamentario r on r.id = a.receita_id
     where a.grupo_id = g.id and a.compoe_qtd;
    if n_compoe = 0 then
      update public.item_orcamentario
         set qtd_ref_modo = 'manual', quantidade_referencia = 1, unidade_referencia = 'vb'
       where id = g.id;
    else
      update public.item_orcamentario
         set qtd_ref_modo = case when n_compoe = 1 then 'heranca' else 'soma_filhos' end,
             unidade_referencia = v_unid_ref
       where id = g.id;
    end if;
  end loop;

  -- ── 4. Quantidade manual informada no modelo ─────────────────────────────
  for sv in select e.value from jsonb_array_elements(coalesce(_servicos, '[]'::jsonb)) e
  loop
    begin
      v_servico := trim(sv->>'servico');
      v_qtd     := nullif(sv->>'quantidade', '')::numeric;
      v_unid    := nullif(trim(sv->>'unidade'), '');
      if v_servico is null or v_servico = '' or v_qtd is null then continue; end if;
      if v_qtd <= 0 then raise exception 'Serviço %: quantidade manual deve ser > 0', v_servico; end if;
      if v_unid is null then raise exception 'Serviço %: informe a unidade da quantidade manual', v_servico; end if;

      v_grupo_id := null;
      select id into v_grupo_id from public.item_orcamentario
       where obra_id = _obra_id and tipo = 'servico_grupo'
         and lower(trim(descricao)) = lower(v_servico)
       order by codigo limit 1;
      if v_grupo_id is null then continue; end if;
      if not (v_grupo_id = any(criados)) and existentes <> 'atualizar' then continue; end if;

      update public.item_orcamentario
         set qtd_ref_modo = 'manual', quantidade_referencia = v_qtd, unidade_referencia = v_unid
       where id = v_grupo_id;
      n_manuais := n_manuais + 1;
    exception when others then
      if tudo_ou_nada then raise; end if;
      erros := erros || jsonb_build_object('row', 0, 'msg', sqlerrm, 'codigo', v_servico);
    end;
  end loop;

  perform public.recalcular_orcamento(_obra_id);

  return jsonb_build_object(
    'ok', jsonb_array_length(erros) = 0,
    'stats', jsonb_build_object(
      'etapas_criadas', n_etapas, 'receitas_criadas', n_receitas,
      'atualizados', n_atualizados, 'pulados', n_pulados,
      'servicos_criados', n_servicos, 'receitas_alocadas', n_alocadas,
      'receitas_rateadas', n_rateadas, 'alocacoes_puladas', n_aloc_puladas,
      'servicos_qtd_manual', n_manuais),
    'grupos', '[]'::jsonb,
    'erros', erros,
    'duracao_ms', (extract(epoch from clock_timestamp() - t0) * 1000)::int
  );
end
$_$;


--
-- Name: importar_recursos(uuid, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.importar_recursos(_obra_id uuid, _linhas jsonb, _opcoes jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
declare
  t0 timestamptz := clock_timestamp();
  atualizar_existentes boolean := coalesce((_opcoes->>'atualizar_existentes')::boolean, true);
  atualizar_precos     boolean := coalesce((_opcoes->>'atualizar_precos')::boolean, true);
  tudo_ou_nada         boolean := coalesce((_opcoes->>'tudo_ou_nada')::boolean, false);
  l jsonb;
  v_row int;
  v_grupo text; v_codigo text; v_nome text; v_unidade text; v_obs text;
  v_preco numeric;
  v_id uuid;
  n_criados int := 0; n_atualizados int := 0; n_inalterados int := 0; n_precos int := 0;
  erros jsonb := '[]'::jsonb;
begin
  if not public.pode_editar_orcamento(_obra_id) then
    raise exception 'Sem permissão para editar o orçamento desta obra' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('import:' || _obra_id::text));

  for l in select * from jsonb_array_elements(coalesce(_linhas, '[]'::jsonb)) loop
    begin
      v_row     := coalesce((l->>'row')::int, 0);
      v_grupo   := upper(trim(l->>'grupo'));
      v_codigo  := nullif(trim(l->>'codigo'), '');
      v_nome    := trim(l->>'nome');
      v_unidade := nullif(trim(l->>'unidade'), '');
      v_obs     := nullif(trim(l->>'observacao'), '');
      v_preco   := nullif(l->>'preco', '')::numeric;

      if v_grupo not in ('MO', 'MVE', 'COMBUSTIVEL', 'MATERIAL', 'ADM') then
        raise exception 'Grupo inválido: %', v_grupo;
      end if;
      if v_nome is null or v_nome = '' then raise exception 'Nome obrigatório'; end if;
      if v_unidade is null then raise exception 'Unidade obrigatória'; end if;
      if v_preco is not null and v_preco < 0 then raise exception 'Preço negativo'; end if;

      v_id := null;
      if v_codigo is not null then
        select id into v_id from public.recurso where obra_id = _obra_id and codigo = v_codigo;
      end if;
      if v_id is null then
        select id into v_id from public.recurso
         where obra_id = _obra_id and grupo = v_grupo and public.norm_txt(nome) = public.norm_txt(v_nome)
         limit 1;
      end if;

      if v_id is null then
        insert into public.recurso (obra_id, grupo, codigo, nome, unidade, ativo, fonte, observacao)
        values (_obra_id, v_grupo, v_codigo, v_nome, v_unidade, true, 'importacao_modelo', v_obs)
        returning id into v_id;
        n_criados := n_criados + 1;
        if v_preco is not null and public.imp_definir_preco_vigente(v_id, v_preco, 'importacao_modelo') then
          n_precos := n_precos + 1;
        end if;
      else
        if atualizar_existentes then
          update public.recurso
             set grupo = v_grupo,
                 codigo = coalesce(v_codigo, codigo),
                 nome = v_nome,
                 unidade = v_unidade,
                 observacao = coalesce(v_obs, observacao),
                 ativo = true,
                 updated_at = now()
           where id = v_id;
        end if;
        if atualizar_precos and v_preco is not null
           and public.imp_definir_preco_vigente(v_id, v_preco, 'importacao_modelo') then
          n_precos := n_precos + 1;
          n_atualizados := n_atualizados + 1;
        elsif atualizar_existentes then
          n_inalterados := n_inalterados + 1;
        else
          n_inalterados := n_inalterados + 1;
        end if;
      end if;
    exception when others then
      if tudo_ou_nada then raise; end if;
      erros := erros || jsonb_build_object('row', v_row, 'msg', sqlerrm);
    end;
  end loop;

  return jsonb_build_object(
    'ok', jsonb_array_length(erros) = 0,
    'stats', jsonb_build_object(
      'criados', n_criados, 'atualizados', n_atualizados,
      'inalterados', n_inalterados, 'precos_criados', n_precos),
    'erros', erros,
    'duracao_ms', (extract(epoch from clock_timestamp() - t0) * 1000)::int
  );
end
$$;


--
-- Name: lb_capturar_premissas(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.lb_capturar_premissas(_planejamento_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare n int;
begin
  delete from public.planejamento_lb_premissa where planejamento_id = _planejamento_id;
  insert into public.planejamento_lb_premissa
    (tarefa_id, planejamento_id, item_orcamentario_id, item_quantidade, item_venda_total,
     item_custo_unit, producao_diaria_cpu, producao_diaria_efetiva, equipe)
  select tarefa_id, _planejamento_id, item_orcamentario_id, item_quantidade, item_venda_total,
         item_custo_unit, producao_diaria_cpu, producao_diaria_efetiva, equipe
    from public.planejamento_tarefa_valores_vivos(_planejamento_id);
  get diagnostics n = row_count;
  update public.planejamento p
     set premissa_calendario = public.calendario_fingerprint(p.obra_id),
         premissa_calendarios = public.calendario_fingerprint(p.obra_id),
         premissa_tipos = public.servico_dependencias_fingerprint(p.obra_id)
   where p.id = _planejamento_id;
  return n;
end $$;


--
-- Name: lb_premissas_diff(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.lb_premissas_diff(_planejamento_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare itens jsonb; cal_mudou boolean; tipos_mudou boolean; p record;
begin
  select id, obra_id, is_baseline, premissa_calendarios, premissa_calendario, premissa_tipos into p
    from public.planejamento where id = _planejamento_id;
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


--
-- Name: marcar_vigente(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.marcar_vigente(_planejamento_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare p record; d jsonb;
begin
  select id, obra_id, is_baseline, nome into p from public.planejamento where id = _planejamento_id;
  if p.id is null then raise exception 'Planejamento não encontrado'; end if;
  if not public.pode_planejar_obra(p.obra_id) then raise exception 'Sem permissão'; end if;
  if not p.is_baseline then
    raise exception 'Só uma linha de base pode ser vigente — promova o plano em edição primeiro';
  end if;
  d := public.lb_premissas_diff(_planejamento_id);
  if (d->>'mudou')::boolean then
    raise exception 'As premissas da linha de base "%" mudaram desde que foi travada — use "Restaurar como nova linha de base"', p.nome;
  end if;
  update public.planejamento set vigente = false where obra_id = p.obra_id and vigente and id <> p.id;
  update public.planejamento set vigente = true where id = p.id;
end $$;


--
-- Name: mcp_oauth_autorizar(text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mcp_oauth_autorizar(_client_id text, _redirect_uri text, _code_challenge text, _escopo text DEFAULT NULL::text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
declare
  c record;
  v_code text;
begin
  if auth.uid() is null then raise exception 'Sessão expirada'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and ativo) then
    raise exception 'Usuário inativo';
  end if;
  select * into c from public.mcp_oauth_cliente where client_id = _client_id;
  if c.id is null then raise exception 'Aplicativo não registrado (client_id desconhecido)'; end if;
  if not (_redirect_uri = any (c.redirect_uris)) then
    raise exception 'Endereço de retorno não registrado para este aplicativo';
  end if;
  if coalesce(length(_code_challenge), 0) < 43 then raise exception 'PKCE (S256) obrigatório'; end if;
  v_code := translate(encode(gen_random_bytes(32), 'base64'), '+/=', '-_');
  insert into public.mcp_oauth_codigo (hash, cliente_id, user_id, redirect_uri, code_challenge, escopo, expira_em)
  values (encode(digest(v_code, 'sha256'), 'hex'), c.id, auth.uid(), _redirect_uri, _code_challenge, _escopo,
          now() + interval '5 minutes');
  delete from public.mcp_oauth_codigo where expira_em < now() - interval '1 day';
  return v_code;
end $$;


--
-- Name: mcp_oauth_cliente_info(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mcp_oauth_cliente_info(_client_id text, _redirect_uri text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  c record;
begin
  if auth.uid() is null then raise exception 'Sessão expirada'; end if;
  select * into c from public.mcp_oauth_cliente where client_id = _client_id;
  if c.id is null then raise exception 'Aplicativo não registrado (client_id desconhecido)'; end if;
  if not (_redirect_uri = any (c.redirect_uris)) then
    raise exception 'Endereço de retorno não registrado para este aplicativo';
  end if;
  return jsonb_build_object('nome', c.nome, 'redirect_uri', _redirect_uri);
end $$;


--
-- Name: mcp_token_criar(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mcp_token_criar(_nome text, _dias integer DEFAULT NULL::integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
declare
  v_token text;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Sessão expirada'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and ativo) then
    raise exception 'Usuário inativo';
  end if;
  if _dias is not null and (_dias < 1 or _dias > 730) then
    raise exception 'Validade entre 1 e 730 dias (ou sem validade)';
  end if;
  if (select count(*) from public.mcp_token
       where user_id = auth.uid() and tipo = 'pessoal' and revogado_em is null) >= 20 then
    raise exception 'Limite de 20 tokens ativos — revogue algum antes';
  end if;
  v_token := 'iwk_' || translate(encode(gen_random_bytes(30), 'base64'), '+/=', '-_');
  insert into public.mcp_token (user_id, nome, prefixo, hash, expira_em)
  values (auth.uid(), trim(_nome), left(v_token, 10), encode(digest(v_token, 'sha256'), 'hex'),
          case when _dias is null then null else now() + make_interval(days => _dias) end)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'token', v_token);
end $$;


--
-- Name: mcp_token_revogar(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mcp_token_revogar(_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  update public.mcp_token set revogado_em = now()
   where id = _id and user_id = auth.uid() and revogado_em is null;
  if not found then raise exception 'Token não encontrado ou já revogado'; end if;
end $$;


--
-- Name: norm_txt(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.norm_txt(_s text) RETURNS text
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'extensions'
    AS $$
  select lower(regexp_replace(trim(extensions.unaccent(coalesce(_s, ''))), '\s+', ' ', 'g'))
$$;


--
-- Name: obra_empresa(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.obra_empresa(_obra_id uuid) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select empresa_id from public.obras where id = _obra_id
$$;


--
-- Name: obra_equipes_vivas(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.obra_equipes_vivas(_obra_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(jsonb_agg(public.servico_equipe_viva(s.id) order by s.codigo), '[]'::jsonb)
    from public.servico s
   where s.obra_id = _obra_id and public.pode_ver_obra(_obra_id)
     and (exists (select 1 from public.cpu c where c.servico_id = s.id) or exists (select 1 from public.servico_cpu_link l where l.servico_id = s.id))
$$;


--
-- Name: obra_tem_aditivo(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.obra_tem_aditivo(_obra_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ select exists (select 1 from public.orcamento_aditivo where obra_id = _obra_id and status = 'aplicado') $$;


--
-- Name: planejamento_copiar(uuid, text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.planejamento_copiar(_origem_id uuid, _nome text, _inicio date DEFAULT NULL::date) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare o record; v_novo uuid; n_t int := 0; n_d int := 0; k int; nv int;
begin
  if public.auth_role() not in ('god', 'adm', 'engenheiro') then raise exception 'Sem permissão para criar planos'; end if;
  select * into o from public.planejamento where id = _origem_id;
  if o.id is null then raise exception 'Plano de origem não encontrado'; end if;
  if not public.pode_planejar_obra(o.obra_id) then raise exception 'Sem permissão para planejar esta obra'; end if;
  if coalesce(btrim(_nome), '') = '' then raise exception 'Informe o nome do plano'; end if;
  if exists (select 1 from public.planejamento where obra_id = o.obra_id and not is_baseline) then
    raise exception 'Já existe um plano em edição nesta obra — trave-o como linha de base ou exclua-o antes.';
  end if;
  if exists (select 1 from public.planejamento where obra_id = o.obra_id and nome = btrim(_nome)) then
    raise exception 'Já existe um plano com o nome "%" nesta obra.', btrim(_nome);
  end if;

  insert into public.planejamento (obra_id, nome, descricao, is_baseline, status, data_referencia_inicio, prazo, calendario_id, modo, data_date, criado_por)
  values (o.obra_id, btrim(_nome), o.descricao, false, 'ativo', coalesce(_inicio, o.data_referencia_inicio), o.prazo, o.calendario_id, o.modo, o.data_date, auth.uid())
  returning id into v_novo;

  create temporary table if not exists _mapa_tarefa (velho uuid primary key, novo uuid not null) on commit drop;
  truncate _mapa_tarefa;
  insert into _mapa_tarefa (velho, novo) select id, gen_random_uuid() from public.planejamento_tarefa where planejamento_id = _origem_id;

  for nv in select distinct nivel from public.planejamento_tarefa where planejamento_id = _origem_id order by nivel loop
    insert into public.planejamento_tarefa (
      id, planejamento_id, item_orcamentario_id, tipo_no, parent_id, nivel, codigo_eap, nome_custom, quantidade_alocada, notas, ordem,
      prioridade, asap, inicio_dia, sentido, restricao_inicio, restricao_inicio_em, restricao_fim, restricao_fim_em, coef_producao,
      qtd_equipes, calendario_id, derivar_predecessoras, aparencia, inicio_em)
    select m.novo, v_novo, t.item_orcamentario_id, t.tipo_no, pm.novo, t.nivel, t.codigo_eap, t.nome_custom, t.quantidade_alocada, t.notas, t.ordem,
           t.prioridade, t.asap, t.inicio_dia, t.sentido, t.restricao_inicio, t.restricao_inicio_em, t.restricao_fim, t.restricao_fim_em, t.coef_producao,
           t.qtd_equipes, t.calendario_id, t.derivar_predecessoras, t.aparencia, t.inicio_em
      from public.planejamento_tarefa t
      join _mapa_tarefa m on m.velho = t.id
      left join _mapa_tarefa pm on pm.velho = t.parent_id
     where t.planejamento_id = _origem_id and t.nivel = nv and t.tipo_no in ('tarefa', 'grupo');
    get diagnostics k = row_count;
    n_t := n_t + k;
  end loop;

  -- locais "do template" que ficaram indisponíveis viram manuais (a cópia não pode falhar por isso)
  perform set_config('infrawork.copia_plano', '1', true);
  insert into public.planejamento_tarefa_local (tarefa_id, planejamento_id, ordem, trecho_id, inicio_m, fim_m, quantidade, qtd_origem)
  select m.novo, v_novo, l.ordem, l.trecho_id, l.inicio_m, l.fim_m, l.quantidade, l.qtd_origem
    from public.planejamento_tarefa_local l join _mapa_tarefa m on m.velho = l.tarefa_id
   where l.planejamento_id = _origem_id
   order by l.tarefa_id, l.ordem;
  perform set_config('infrawork.copia_plano', '', true);

  insert into public.planejamento_dependencia (planejamento_id, predecessora_id, sucessora_id, tipo, origem, atraso_min, atraso_max, dias_uteis, aparencia)
  select v_novo, a.novo, b.novo, d.tipo, d.origem, d.atraso_min, d.atraso_max, d.dias_uteis, d.aparencia
    from public.planejamento_dependencia d
    join _mapa_tarefa a on a.velho = d.predecessora_id
    join _mapa_tarefa b on b.velho = d.sucessora_id
   where d.planejamento_id = _origem_id;
  get diagnostics n_d = row_count;

  insert into public.planejamento_tarefa_equipe (tarefa_id, equipe_id, qtd_equipes)
  select m.novo, e.equipe_id, e.qtd_equipes
    from public.planejamento_tarefa_equipe e join _mapa_tarefa m on m.velho = e.tarefa_id;

  insert into public.planejamento_tarefa_indireto (
    tarefa_id, custo_periodicidade, custo_unitario, receita_modo, receita_unitaria, receita_percentual,
    offset_dias_antes, offset_dias_depois, receita_extrapola, aplica_taxas, taxa_regime_id)
  select m.novo, i.custo_periodicidade, i.custo_unitario, i.receita_modo, i.receita_unitaria, i.receita_percentual,
         i.offset_dias_antes, i.offset_dias_depois, i.receita_extrapola, i.aplica_taxas, i.taxa_regime_id
    from public.planejamento_tarefa_indireto i join _mapa_tarefa m on m.velho = i.tarefa_id;

  insert into public.planejamento_marco (planejamento_id, nome, descricao, inicio, fim, filtro_servicos, servicos, filtro_recursos, recursos,
                                         filtro_estacas, faixas, incluidas, excluidas, aparencia, ordem)
  select v_novo, mc.nome, mc.descricao, mc.inicio, mc.fim, mc.filtro_servicos, mc.servicos, mc.filtro_recursos, mc.recursos,
         mc.filtro_estacas, mc.faixas,
         coalesce((select array_agg(m.novo) from unnest(mc.incluidas) x join _mapa_tarefa m on m.velho = x), '{}'),
         coalesce((select array_agg(m.novo) from unnest(mc.excluidas) x join _mapa_tarefa m on m.velho = x), '{}'),
         mc.aparencia, mc.ordem
    from public.planejamento_marco mc where mc.planejamento_id = _origem_id;

  insert into public.planejamento_recurso_limite (planejamento_id, recurso_id, grupo_id, maximo)
  select v_novo, l.recurso_id, m.novo, l.maximo
    from public.planejamento_recurso_limite l left join _mapa_tarefa m on m.velho = l.grupo_id
   where l.planejamento_id = _origem_id and (l.grupo_id is null or m.novo is not null);

  return jsonb_build_object('ok', true, 'novo_id', v_novo, 'tarefas_copiadas', n_t, 'dependencias_copiadas', n_d, 'tarefas_ajustadas', 0);
end $$;


--
-- Name: planejamento_excluir_tarefas(uuid, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.planejamento_excluir_tarefas(_planejamento_id uuid, _ids uuid[]) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_obra uuid; v_lb boolean; n int := 0; k int; p int;
begin
  select obra_id, is_baseline into v_obra, v_lb from public.planejamento where id = _planejamento_id;
  if v_obra is null then raise exception 'Plano não encontrado'; end if;
  if not public.pode_planejar_obra(v_obra) then raise exception 'Sem permissão para planejar esta obra'; end if;
  if v_lb then raise exception 'Linha de base travada é imutável — crie um plano em edição a partir dela'; end if;
  create temporary table if not exists _excluir (id uuid primary key, prof int) on commit drop;
  delete from _excluir where true;
  insert into _excluir (id, prof)
  with recursive sub as (
    select id, 0 as prof from public.planejamento_tarefa where id = any(_ids) and planejamento_id = _planejamento_id
    union all
    select c.id, s.prof + 1 from public.planejamento_tarefa c join sub s on c.parent_id = s.id
  ) select id, max(prof) from sub group by id;
  -- a chave do pai é RESTRICT: das folhas para a raiz
  for p in select distinct prof from _excluir order by prof desc loop
    delete from public.planejamento_tarefa t using _excluir x where x.id = t.id and x.prof = p;
    get diagnostics k = row_count;
    n := n + k;
  end loop;
  return n;
end $$;


--
-- Name: planejamento_gravar_calculo(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.planejamento_gravar_calculo(_planejamento_id uuid, _dados jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare p record; n_t int; n_l int; n_w int; n_d int; n_s int;
begin
  select id, obra_id, is_baseline, dados_rev into p from public.planejamento where id = _planejamento_id;
  if p.id is null then raise exception 'Plano não encontrado'; end if;
  if not public.pode_planejar_obra(p.obra_id) then raise exception 'Sem permissão para planejar esta obra'; end if;
  if p.is_baseline then raise exception 'Linha de base travada não recebe novo cálculo'; end if;
  perform pg_advisory_xact_lock(hashtext('plan-calc:' || _planejamento_id::text));
  -- relê depois da trava
  select dados_rev into p.dados_rev from public.planejamento where id = _planejamento_id;
  if (_dados->>'dados_rev')::bigint is distinct from p.dados_rev then
    return jsonb_build_object('ok', false, 'motivo', 'desatualizado', 'dados_rev', p.dados_rev);
  end if;

  perform set_config('infrawork.gravando_calculo', '1', true);

  update public.planejamento_tarefa t set
    inicio_em = x.inicio_em, fim_em = x.fim_em,
    data_inicio = x.data_inicio, data_fim = x.data_fim,
    duracao_dias_uteis_calc = x.duracao_dias_uteis,
    folga_total_h = x.folga_total_h, folga_livre_h = x.folga_livre_h,
    is_critico = x.critico, restricao_limite = x.restricao_limite, violacoes = x.violacoes,
    -- indiretos: a quantidade é o número de períodos cobertos (como no motor antigo)
    quantidade_alocada = coalesce(x.quantidade, t.quantidade_alocada)
  from jsonb_to_recordset(coalesce(_dados->'tarefas', '[]'::jsonb)) as x(
    id uuid, inicio_em timestamp, fim_em timestamp, data_inicio date, data_fim date, duracao_dias_uteis numeric,
    folga_total_h numeric, folga_livre_h numeric, critico boolean,
    restricao_limite text, violacoes jsonb, quantidade numeric)
  where t.id = x.id and t.planejamento_id = _planejamento_id;
  get diagnostics n_t = row_count;

  update public.planejamento_tarefa_local l set inicio_em = x.inicio_em, fim_em = x.fim_em
    from jsonb_to_recordset(coalesce(_dados->'locais', '[]'::jsonb)) as x(id uuid, inicio_em timestamp, fim_em timestamp)
   where l.id = x.id and l.planejamento_id = _planejamento_id;
  get diagnostics n_l = row_count;

  delete from public.planejamento_tarefa_wp where planejamento_id = _planejamento_id;
  insert into public.planejamento_tarefa_wp (planejamento_id, tarefa_id, local_id, ordem, trecho_id, inicio_m, fim_m, quantidade, inicio_em, fim_em)
  select _planejamento_id, x.tarefa_id, x.local_id, x.ordem, x.trecho_id, x.inicio_m, x.fim_m, x.quantidade, x.inicio_em, x.fim_em
    from jsonb_to_recordset(coalesce(_dados->'wps', '[]'::jsonb)) as x(
      tarefa_id uuid, local_id uuid, ordem int, trecho_id uuid, inicio_m numeric, fim_m numeric, quantidade numeric,
      inicio_em timestamp, fim_em timestamp)
    join public.planejamento_tarefa t on t.id = x.tarefa_id and t.planejamento_id = _planejamento_id;
  get diagnostics n_w = row_count;

  delete from public.planejamento_tarefa_perfil_dia d using public.planejamento_tarefa t
   where t.id = d.tarefa_id and t.planejamento_id = _planejamento_id;
  insert into public.planejamento_tarefa_perfil_dia (tarefa_id, dia, quantidade)
  select x.tarefa_id, x.dia, x.quantidade
    from jsonb_to_recordset(coalesce(_dados->'perfil_dia', '[]'::jsonb)) as x(tarefa_id uuid, dia date, quantidade numeric)
    join public.planejamento_tarefa t on t.id = x.tarefa_id and t.planejamento_id = _planejamento_id
   where x.quantidade <> 0;
  get diagnostics n_d = row_count;

  delete from public.planejamento_tarefa_perfil_semana s using public.planejamento_tarefa t
   where t.id = s.tarefa_id and t.planejamento_id = _planejamento_id;
  insert into public.planejamento_tarefa_perfil_semana (tarefa_id, semana_segunda, quantidade_planejada)
  select x.tarefa_id, x.semana_segunda, x.quantidade
    from jsonb_to_recordset(coalesce(_dados->'perfil_semana', '[]'::jsonb)) as x(tarefa_id uuid, semana_segunda date, quantidade numeric)
    join public.planejamento_tarefa t on t.id = x.tarefa_id and t.planejamento_id = _planejamento_id
   where x.quantidade <> 0;
  get diagnostics n_s = row_count;

  -- indiretos: janela pelas diretas e custo/receita do período (calculados no cliente, como o motor antigo fazia)
  update public.planejamento_tarefa_indireto i set
    custo_total_calc = x.custo_total_calc, receita_total_calc = x.receita_total_calc,
    custo_taxas_calc = x.custo_taxas_calc, periodos_calc = x.periodos_calc
    from jsonb_to_recordset(coalesce(_dados->'indiretos', '[]'::jsonb)) as x(
      tarefa_id uuid, custo_total_calc numeric, receita_total_calc numeric, custo_taxas_calc numeric, periodos_calc numeric)
    join public.planejamento_tarefa t on t.id = x.tarefa_id and t.planejamento_id = _planejamento_id
   where i.tarefa_id = x.tarefa_id;

  update public.planejamento set
    calculo_rev = dados_rev, calculado_em = now(), recalculo_pendente = false,
    calculo_aviso = nullif(_dados->>'aviso', '')
   where id = _planejamento_id;

  if (_dados->>'data_fim_obra') is not null then
    update public.obras set data_fim_planejada = (_dados->>'data_fim_obra')::date where id = p.obra_id;
  end if;

  perform set_config('infrawork.gravando_calculo', '', true);
  return jsonb_build_object('ok', true, 'tarefas', n_t, 'locais', n_l, 'wps', n_w, 'perfil_dia', n_d, 'perfil_semana', n_s);
end $$;


--
-- Name: planejamento_mover_tarefas(uuid, uuid[], uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.planejamento_mover_tarefas(_planejamento_id uuid, _ids uuid[], _pai uuid, _antes uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_obra uuid; v_lb boolean; v_nivel_pai smallint := 0; r record; ordem_nova int := 0; n int := 0;
begin
  select obra_id, is_baseline into v_obra, v_lb from public.planejamento where id = _planejamento_id;
  if v_obra is null then raise exception 'Plano não encontrado'; end if;
  if not public.pode_planejar_obra(v_obra) then raise exception 'Sem permissão para planejar esta obra'; end if;
  if v_lb then raise exception 'Linha de base travada é imutável — crie um plano em edição a partir dela'; end if;
  if _pai is not null then
    select nivel into v_nivel_pai from public.planejamento_tarefa
     where id = _pai and planejamento_id = _planejamento_id and tipo_no = 'grupo';
    if v_nivel_pai is null then raise exception 'O destino precisa ser uma tarefa-resumo do mesmo plano'; end if;
    -- não pode entrar na própria sub-árvore
    if exists (
      with recursive acima as (
        select id, parent_id from public.planejamento_tarefa where id = _pai
        union all
        select t.id, t.parent_id from public.planejamento_tarefa t join acima a on t.id = a.parent_id
      ) select 1 from acima where id = any(_ids)) then
      raise exception 'Uma tarefa-resumo não pode ficar dentro dela mesma';
    end if;
  end if;
  if exists (select 1 from unnest(_ids) x where not exists (
       select 1 from public.planejamento_tarefa t where t.id = x and t.planejamento_id = _planejamento_id)) then
    raise exception 'Tarefa de outro plano';
  end if;

  -- só as raízes da seleção (uma linha cujo ancestral também foi escolhido vai junto com ele)
  create temporary table if not exists _mover (id uuid primary key, pos int) on commit drop;
  delete from _mover where true;
  insert into _mover (id, pos)
  select u.x, u.k
    from unnest(_ids) with ordinality u(x, k)
   where not exists (
     with recursive acima as (
       select parent_id as id from public.planejamento_tarefa where id = u.x
       union all
       select t.parent_id from public.planejamento_tarefa t join acima a on t.id = a.id where a.id is not null
     ) select 1 from acima where acima.id = any(_ids))
  on conflict (id) do nothing;

  -- irmãos do destino na ordem atual, com as movidas antes de `_antes` (ou no fim)
  for r in
    with alvo as (
      select coalesce((select ordem from public.planejamento_tarefa
                        where id = _antes and parent_id is not distinct from _pai
                          and not exists (select 1 from _mover m where m.id = _antes)), 2147483647) as o
    )
    select z.id from (
      select t.id, t.ordem as o, case when t.ordem < (select o from alvo) then 0 else 2 end as faixa, 0::bigint as pos
        from public.planejamento_tarefa t
       where t.planejamento_id = _planejamento_id and t.parent_id is not distinct from _pai
         and not exists (select 1 from _mover m where m.id = t.id)
      union all
      select m.id, 0, 1, m.pos from _mover m
    ) z order by z.faixa, z.o, z.pos
  loop
    ordem_nova := ordem_nova + 1;
    update public.planejamento_tarefa set parent_id = _pai, nivel = v_nivel_pai + 1, ordem = ordem_nova
     where id = r.id and (parent_id is distinct from _pai or nivel <> v_nivel_pai + 1 or ordem <> ordem_nova);
  end loop;

  -- níveis das sub-árvores movidas, do mais raso para o mais fundo (o gatilho confere nível = nível do pai + 1)
  for r in
    with recursive sub as (
      select c.id, (v_nivel_pai + 2)::smallint as nivel, 1 as prof
        from public.planejamento_tarefa c join _mover m on c.parent_id = m.id
      union all
      select c.id, (s.nivel + 1)::smallint, s.prof + 1 from public.planejamento_tarefa c join sub s on c.parent_id = s.id
    ) select id, nivel from sub order by prof
  loop
    update public.planejamento_tarefa set nivel = r.nivel where id = r.id and nivel <> r.nivel;
  end loop;
  select count(*) into n from _mover;
  return n;
end $$;


--
-- Name: planejamento_obra(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.planejamento_obra(_id uuid) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ select obra_id from public.planejamento where id = _id $$;


--
-- Name: planejamento_promover(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.planejamento_promover(_planejamento_id uuid, _marcar_vigente boolean DEFAULT NULL::boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare p record; v_vig uuid; marcar boolean; n_folhas int;
begin
  if public.auth_role() not in ('god', 'adm', 'engenheiro') then raise exception 'Sem permissão para travar linhas de base'; end if;
  select * into p from public.planejamento where id = _planejamento_id for update;
  if p.id is null then raise exception 'Plano não encontrado'; end if;
  if not public.pode_planejar_obra(p.obra_id) then raise exception 'Sem permissão para planejar esta obra'; end if;
  if p.is_baseline then raise exception 'Este plano já é uma linha de base.'; end if;
  select count(*) into n_folhas from public.planejamento_tarefa where planejamento_id = p.id and tipo_no = 'tarefa';
  if n_folhas > 0 and (p.calculo_rev is distinct from p.dados_rev or p.recalculo_pendente) then
    raise exception 'Cronograma desatualizado: abra o cronograma do plano e aguarde o cálculo terminar antes de travar a linha de base.';
  end if;

  update public.planejamento set is_baseline = true, status = 'ativo' where id = p.id;
  perform public.lb_capturar_premissas(p.id);

  select id into v_vig from public.planejamento where obra_id = p.obra_id and vigente;
  marcar := coalesce(_marcar_vigente, v_vig is null);
  if marcar then
    if v_vig is not null then update public.planejamento set vigente = false where id = v_vig; end if;
    update public.planejamento set vigente = true where id = p.id;
  end if;
  return jsonb_build_object('ok', true, 'baseline_id', p.id, 'vigente', marcar);
end $$;


--
-- Name: planejamento_tarefa_criar(uuid, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.planejamento_tarefa_criar(_planejamento_id uuid, _campos jsonb, _locais jsonb DEFAULT '[]'::jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_obra uuid; v_pai uuid; v_nivel smallint := 1; v_ordem int; v_id uuid; l jsonb; k int := 0;
begin
  v_obra := public.fn_plano_assert_editavel(_planejamento_id);
  v_pai := nullif(_campos->>'parent_id', '')::uuid;
  if v_pai is not null then
    select nivel + 1 into v_nivel from public.planejamento_tarefa where id = v_pai and planejamento_id = _planejamento_id and tipo_no = 'grupo';
    if v_nivel is null then raise exception 'Tarefa-resumo de destino não encontrada'; end if;
  end if;
  v_ordem := coalesce(nullif(_campos->>'ordem', '')::int,
    (select coalesce(max(ordem), -1) + 1 from public.planejamento_tarefa where planejamento_id = _planejamento_id and parent_id is not distinct from v_pai));
  insert into public.planejamento_tarefa (planejamento_id, item_orcamentario_id, tipo_no, parent_id, nivel, ordem, nome_custom,
    quantidade_alocada, sentido, asap, prioridade, qtd_equipes, coef_producao, notas)
  values (_planejamento_id, (_campos->>'item_orcamentario_id')::uuid, 'tarefa', v_pai, v_nivel, v_ordem,
    nullif(_campos->>'nome_custom', ''),
    case when jsonb_array_length(coalesce(_locais, '[]'::jsonb)) = 0 then nullif(_campos->>'quantidade', '')::numeric end,
    coalesce(_campos->>'sentido', 'crescente'), coalesce((_campos->>'asap')::boolean, false),
    coalesce((_campos->>'prioridade')::int, 500), coalesce((_campos->>'qtd_equipes')::int, 1),
    coalesce((_campos->>'coef_producao')::numeric, 1), nullif(_campos->>'notas', ''))
  returning id into v_id;
  if jsonb_array_length(coalesce(_locais, '[]'::jsonb)) > 0 then
    perform set_config('infrawork.locais_lote', '1', true);
    for l in select value from jsonb_array_elements(_locais) loop
      insert into public.planejamento_tarefa_local (tarefa_id, planejamento_id, ordem, trecho_id, inicio_m, fim_m, quantidade, qtd_origem)
      values (v_id, _planejamento_id, k, nullif(l->>'trecho_id', '')::uuid, nullif(l->>'inicio_m', '')::numeric,
              nullif(l->>'fim_m', '')::numeric, coalesce(nullif(l->>'quantidade', '')::numeric, 0), coalesce(l->>'qtd_origem', 'manual'));
      k := k + 1;
    end loop;
    perform set_config('infrawork.locais_lote', '', true);
    perform public.fn_locais_validar(v_id);
  end if;
  if _campos ? 'equipes' then
    insert into public.planejamento_tarefa_equipe (tarefa_id, equipe_id, qtd_equipes)
    select v_id, x::uuid, 1 from jsonb_array_elements_text(_campos->'equipes') x
    on conflict do nothing;
  end if;
  return v_id;
end $$;


--
-- Name: planejamento_tarefa_dividir_estaca(uuid, uuid, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.planejamento_tarefa_dividir_estaca(_tarefa_id uuid, _trecho_id uuid, _estaca_m numeric) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare a record; v_novo uuid; l record; b numeric; e numeric; q1 numeric; v_nome text; v_tipo text;
begin
  a := public.fn_tarefa_assert_editavel(_tarefa_id);
  select nome, tipo into v_nome, v_tipo from public.obra_trecho where id = _trecho_id;
  if v_tipo is null or v_tipo <> 'eixo' then raise exception 'Só locais em eixo se dividem por estaca'; end if;
  select min(inicio_m), max(fim_m) into b, e from public.planejamento_tarefa_local where tarefa_id = _tarefa_id and trecho_id = _trecho_id;
  if b is null then raise exception 'A tarefa não tem local no trecho "%"', v_nome; end if;
  if _estaca_m <= b + 0.005 or _estaca_m >= e - 0.005 then
    raise exception 'A estaca % m está fora da faixa da tarefa no trecho "%" (% a % m)', round(_estaca_m, 2), v_nome, round(b, 2), round(e, 2);
  end if;
  v_novo := public.fn_tarefa_clonar(_tarefa_id);
  perform set_config('infrawork.locais_lote', '1', true);
  for l in select * from public.planejamento_tarefa_local where tarefa_id = _tarefa_id and trecho_id = _trecho_id order by inicio_m loop
    if l.fim_m <= _estaca_m + 0.005 then
      continue;                                                     -- fica inteiro na original
    elsif l.inicio_m >= _estaca_m - 0.005 then
      update public.planejamento_tarefa_local set tarefa_id = v_novo where id = l.id;   -- vai inteiro para a cópia
    else
      -- atravessado: a original encolhe antes de a cópia receber (teto do serviço)
      if l.qtd_origem = 'manual' then
        q1 := round(l.quantidade * (_estaca_m - l.inicio_m) / (l.fim_m - l.inicio_m), 4);
        update public.planejamento_tarefa_local set fim_m = _estaca_m, quantidade = q1 where id = l.id;
        insert into public.planejamento_tarefa_local (tarefa_id, planejamento_id, ordem, trecho_id, inicio_m, fim_m, quantidade, qtd_origem)
        values (v_novo, l.planejamento_id, l.ordem, _trecho_id, _estaca_m, l.fim_m, l.quantidade - q1, 'manual');
      else
        update public.planejamento_tarefa_local set fim_m = _estaca_m where id = l.id;
        insert into public.planejamento_tarefa_local (tarefa_id, planejamento_id, ordem, trecho_id, inicio_m, fim_m, quantidade, qtd_origem)
        values (v_novo, l.planejamento_id, l.ordem, _trecho_id, _estaca_m, l.fim_m, 0, 'trecho');
      end if;
    end if;
  end loop;
  perform set_config('infrawork.locais_lote', '', true);
  perform public.fn_locais_validar(_tarefa_id);
  perform public.fn_locais_validar(v_novo);
  if not exists (select 1 from public.planejamento_tarefa_local where tarefa_id = v_novo) then
    raise exception 'Nada ficou depois da estaca % m', round(_estaca_m, 2);
  end if;
  return v_novo;
end $$;


--
-- Name: planejamento_tarefa_dividir_quantidade(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.planejamento_tarefa_dividir_quantidade(_tarefa_id uuid, _partes jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare a record; v_novo uuid; p jsonb; l record; x numeric; total numeric := 0; n_loc int; q_t numeric;
begin
  a := public.fn_tarefa_assert_editavel(_tarefa_id);
  select count(*) into n_loc from public.planejamento_tarefa_local where tarefa_id = _tarefa_id;
  for p in select value from jsonb_array_elements(coalesce(_partes, '[]'::jsonb)) loop
    x := coalesce(nullif(p->>'quantidade', '')::numeric, 0);
    if x < 0 then raise exception 'Quantidade negativa'; end if;
    if nullif(p->>'local_id', '') is not null then
      select * into l from public.planejamento_tarefa_local where id = (p->>'local_id')::uuid and tarefa_id = _tarefa_id;
      if l.id is null then raise exception 'Local não encontrado na tarefa'; end if;
      if l.qtd_origem = 'trecho' and x > 0 then
        raise exception 'Local "do template" não se divide por quantidade — divida por estaca';
      end if;
      if x > l.quantidade + 0.0001 then
        raise exception 'Quantidade fora do intervalo: o local tem % e foram pedidos %', round(l.quantidade, 4), round(x, 4);
      end if;
    else
      if n_loc > 0 then raise exception 'Informe o local da parte'; end if;
      select quantidade_alocada into q_t from public.planejamento_tarefa where id = _tarefa_id;
      if x > coalesce(q_t, 0) + 0.0001 then
        raise exception 'Quantidade fora do intervalo: a tarefa tem % e foram pedidos %', round(coalesce(q_t, 0), 4), round(x, 4);
      end if;
    end if;
    total := total + x;
  end loop;
  if total <= 0 then raise exception 'Informe a quantidade que vai para a nova tarefa'; end if;
  v_novo := public.fn_tarefa_clonar(_tarefa_id);
  perform set_config('infrawork.locais_lote', '1', true);
  for p in select value from jsonb_array_elements(_partes) loop
    x := coalesce(nullif(p->>'quantidade', '')::numeric, 0);
    if x <= 0 then continue; end if;
    if nullif(p->>'local_id', '') is not null then
      select * into l from public.planejamento_tarefa_local where id = (p->>'local_id')::uuid;
      if l.quantidade - x <= 0.0001 and n_loc > 1 then
        delete from public.planejamento_tarefa_local where id = l.id;
      else
        update public.planejamento_tarefa_local set quantidade = greatest(l.quantidade - x, 0), qtd_origem = 'manual' where id = l.id;
      end if;
      insert into public.planejamento_tarefa_local (tarefa_id, planejamento_id, ordem, trecho_id, inicio_m, fim_m, quantidade, qtd_origem)
      values (v_novo, l.planejamento_id, l.ordem, l.trecho_id, l.inicio_m, l.fim_m, x, 'manual');
    else
      update public.planejamento_tarefa set quantidade_alocada = greatest(coalesce(quantidade_alocada, 0) - x, 0) where id = _tarefa_id;
      update public.planejamento_tarefa set quantidade_alocada = x where id = v_novo;
    end if;
  end loop;
  perform set_config('infrawork.locais_lote', '', true);
  perform public.fn_locais_validar(v_novo);
  return v_novo;
end $$;


--
-- Name: planejamento_tarefa_equipes_salvar(uuid, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.planejamento_tarefa_equipes_salvar(_tarefa_id uuid, _equipes uuid[]) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_obra uuid; v_lb boolean; n int;
begin
  select p.obra_id, p.is_baseline into v_obra, v_lb
    from public.planejamento_tarefa t join public.planejamento p on p.id = t.planejamento_id where t.id = _tarefa_id;
  if v_obra is null then raise exception 'Tarefa não encontrada'; end if;
  if not public.pode_planejar_obra(v_obra) then raise exception 'Sem permissão para planejar esta obra'; end if;
  if v_lb then raise exception 'Linha de base travada é imutável — crie um plano em edição a partir dela'; end if;
  if exists (select 1 from unnest(coalesce(_equipes, '{}')) e where not exists (
       select 1 from public.equipe q where q.id = e and q.obra_id = v_obra and not q.is_sistema)) then
    raise exception 'Equipe de outra obra';
  end if;
  delete from public.planejamento_tarefa_equipe x
   using public.equipe q
   where x.tarefa_id = _tarefa_id and q.id = x.equipe_id and not q.is_sistema and not (x.equipe_id = any(coalesce(_equipes, '{}')));
  insert into public.planejamento_tarefa_equipe (tarefa_id, equipe_id, qtd_equipes)
  select _tarefa_id, e, 1 from unnest(coalesce(_equipes, '{}')) e
  on conflict (tarefa_id, equipe_id) do nothing;
  select count(*) into n from public.planejamento_tarefa_equipe where tarefa_id = _tarefa_id;
  return n;
end $$;


--
-- Name: planejamento_tarefa_locais_salvar(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.planejamento_tarefa_locais_salvar(_tarefa_id uuid, _locais jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_plan uuid; v_obra uuid; v_lb boolean; l jsonb; k int := 0; v_id uuid; ids uuid[] := '{}';
begin
  select t.planejamento_id, p.obra_id, p.is_baseline into v_plan, v_obra, v_lb
    from public.planejamento_tarefa t join public.planejamento p on p.id = t.planejamento_id where t.id = _tarefa_id;
  if v_plan is null then raise exception 'Tarefa não encontrada'; end if;
  if not public.pode_planejar_obra(v_obra) then raise exception 'Sem permissão para planejar esta obra'; end if;
  if v_lb then raise exception 'Linha de base travada é imutável — crie um plano em edição a partir dela'; end if;
  perform set_config('infrawork.locais_lote', '1', true);
  delete from public.planejamento_tarefa_local
   where tarefa_id = _tarefa_id
     and id not in (select (x->>'id')::uuid from jsonb_array_elements(coalesce(_locais, '[]'::jsonb)) x
                     where coalesce(x->>'id', '') <> '');
  for l in select value from jsonb_array_elements(coalesce(_locais, '[]'::jsonb)) loop
    v_id := nullif(l->>'id', '')::uuid;
    if v_id is not null and exists (select 1 from public.planejamento_tarefa_local where id = v_id and tarefa_id = _tarefa_id) then
      update public.planejamento_tarefa_local set
        ordem = k,
        trecho_id = nullif(l->>'trecho_id', '')::uuid,
        inicio_m = nullif(l->>'inicio_m', '')::numeric,
        fim_m = nullif(l->>'fim_m', '')::numeric,
        qtd_origem = coalesce(l->>'qtd_origem', 'manual'),
        quantidade = case when coalesce(l->>'qtd_origem', 'manual') = 'manual'
                          then coalesce(nullif(l->>'quantidade', '')::numeric, 0) else quantidade end
       where id = v_id;
    else
      insert into public.planejamento_tarefa_local (tarefa_id, planejamento_id, ordem, trecho_id, inicio_m, fim_m, quantidade, qtd_origem)
      values (_tarefa_id, v_plan, k, nullif(l->>'trecho_id', '')::uuid, nullif(l->>'inicio_m', '')::numeric,
              nullif(l->>'fim_m', '')::numeric, coalesce(nullif(l->>'quantidade', '')::numeric, 0),
              coalesce(l->>'qtd_origem', 'manual'))
      returning id into v_id;
    end if;
    ids := ids || v_id;
    k := k + 1;
  end loop;
  perform set_config('infrawork.locais_lote', '', true);
  perform public.fn_locais_validar(_tarefa_id);
  return jsonb_build_object('ids', to_jsonb(ids), 'n', k);
end $$;


--
-- Name: planejamento_tarefa_mudar_trecho(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.planejamento_tarefa_mudar_trecho(_tarefa_id uuid, _trecho_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  a record; dest record; n_eixos int; v_old uuid; ob numeric; oe numeric; nb numeric; ne numeric; l record; q numeric;
  n int := 0; avisos text[] := '{}'; ini2 numeric; fim2 numeric; origem text;
begin
  a := public.fn_tarefa_assert_editavel(_tarefa_id);
  if _trecho_id is not null then
    select * into dest from public.obra_trecho where id = _trecho_id;
    if dest.id is null or dest.obra_id <> a.obra_id then raise exception 'Trecho não encontrado nesta obra'; end if;
  end if;
  select count(distinct trecho_id), min(trecho_id::text)::uuid into n_eixos, v_old
    from public.planejamento_tarefa_local where tarefa_id = _tarefa_id and inicio_m is not null;
  if n_eixos > 1 then raise exception 'A tarefa tem locais em mais de um trecho — ajuste pelo diálogo da tarefa'; end if;
  select sum(quantidade) into q from public.planejamento_tarefa_local where tarefa_id = _tarefa_id;
  q := coalesce(q, (select quantidade_alocada from public.planejamento_tarefa where id = _tarefa_id), 0);

  perform set_config('infrawork.locais_lote', '1', true);
  if _trecho_id is null or dest.tipo = 'area' then
    -- um local só, manual, sem estacas
    delete from public.planejamento_tarefa_local where tarefa_id = _tarefa_id;
    insert into public.planejamento_tarefa_local (tarefa_id, planejamento_id, ordem, trecho_id, inicio_m, fim_m, quantidade, qtd_origem)
    values (_tarefa_id, a.planejamento_id, 0, _trecho_id, null, null, q, 'manual');
    n := 1;
  elsif n_eixos = 0 then
    -- de área ou sem local para eixo: o eixo inteiro, manual
    delete from public.planejamento_tarefa_local where tarefa_id = _tarefa_id;
    origem := case when a.item_id is not null and public.trecho_servico_disponivel(_trecho_id, a.item_id)
                    and public.trecho_qtd_faixa(_trecho_id, a.item_id, 0, dest.comprimento_m) > 0 then 'trecho' else 'manual' end;
    insert into public.planejamento_tarefa_local (tarefa_id, planejamento_id, ordem, trecho_id, inicio_m, fim_m, quantidade, qtd_origem)
    values (_tarefa_id, a.planejamento_id, 0, _trecho_id, 0, dest.comprimento_m, q, origem);
    n := 1;
  else
    if v_old = _trecho_id then perform set_config('infrawork.locais_lote', '', true); return jsonb_build_object('locais', 0, 'avisos', '[]'::jsonb); end if;
    select min(inicio_m), max(fim_m) into ob, oe from public.planejamento_tarefa_local where tarefa_id = _tarefa_id and trecho_id = v_old;
    -- adjustedSpan: cabe → igual; maior que o eixo → o eixo inteiro; senão desloca para caber
    if oe - ob >= dest.comprimento_m then nb := 0; ne := dest.comprimento_m;
    elsif oe <= dest.comprimento_m then nb := ob; ne := oe;
    else ne := dest.comprimento_m; nb := ne - (oe - ob); end if;
    for l in select * from public.planejamento_tarefa_local where tarefa_id = _tarefa_id and trecho_id = v_old order by inicio_m loop
      ini2 := round(nb + (l.inicio_m - ob) / (oe - ob) * (ne - nb), 3);
      fim2 := round(nb + (l.fim_m - ob) / (oe - ob) * (ne - nb), 3);
      if fim2 <= ini2 then fim2 := ini2 + 0.001; end if;
      origem := l.qtd_origem;
      if origem = 'trecho' and not (a.item_id is not null and public.trecho_servico_disponivel(_trecho_id, a.item_id)
                                    and public.trecho_qtd_faixa(_trecho_id, a.item_id, ini2, fim2) > 0) then
        origem := 'manual';
        avisos := avisos || format('Local %s–%s m ficou manual: o trecho "%s" não tem quantidade do serviço nessa faixa', round(ini2, 1), round(fim2, 1), dest.nome);
      end if;
      update public.planejamento_tarefa_local set trecho_id = _trecho_id, inicio_m = ini2, fim_m = fim2, qtd_origem = origem where id = l.id;
      n := n + 1;
    end loop;
  end if;
  perform set_config('infrawork.locais_lote', '', true);
  perform public.fn_locais_validar(_tarefa_id);
  return jsonb_build_object('locais', n, 'avisos', to_jsonb(avisos));
end $$;


--
-- Name: planejamento_tarefa_valores_vivos(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.planejamento_tarefa_valores_vivos(_planejamento_id uuid) RETURNS TABLE(tarefa_id uuid, item_orcamentario_id uuid, codigo text, descricao text, item_quantidade numeric, item_venda_total numeric, item_custo_unit numeric, producao_diaria_cpu numeric, producao_diaria_efetiva numeric, equipe jsonb)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select t.id, i.id, i.codigo, i.descricao,
         i.quantidade_referencia, i.venda_total_calc, i.custo_unitario_calc,
         v.producao_diaria_qtde,
         v.producao_diaria_qtde * t.qtd_equipes * t.coef_producao,
         case when i.servico_id is not null then public.servico_equipe_viva(i.servico_id) end
    from public.planejamento_tarefa t
    join public.item_orcamentario i on i.id = t.item_orcamentario_id
    left join public.vw_servico_vivo v on v.servico_id = i.servico_id
   where t.planejamento_id = _planejamento_id and t.tipo_no = 'tarefa'
$$;


--
-- Name: planejamento_tarefas_atualizar(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.planejamento_tarefas_atualizar(_planejamento_id uuid, _itens jsonb) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare it jsonb; n int := 0; v_obra uuid; v_lb boolean;
begin
  select obra_id, is_baseline into v_obra, v_lb from public.planejamento where id = _planejamento_id;
  if v_obra is null then raise exception 'Plano não encontrado'; end if;
  if not public.pode_planejar_obra(v_obra) then raise exception 'Sem permissão para planejar esta obra'; end if;
  if v_lb then raise exception 'Linha de base travada é imutável — crie um plano em edição a partir dela'; end if;
  for it in select value from jsonb_array_elements(coalesce(_itens, '[]'::jsonb)) loop
    update public.planejamento_tarefa t set
      inicio_em     = case when it ? 'inicio_em' then (it->>'inicio_em')::timestamp else t.inicio_em end,
      coef_producao = case when it ? 'coef_producao' then (it->>'coef_producao')::numeric else t.coef_producao end,
      prioridade    = case when it ? 'prioridade' then (it->>'prioridade')::int else t.prioridade end,
      asap          = case when it ? 'asap' then (it->>'asap')::boolean else t.asap end,
      sentido       = case when it ? 'sentido' then it->>'sentido' else t.sentido end,
      qtd_equipes   = case when it ? 'qtd_equipes' then (it->>'qtd_equipes')::smallint else t.qtd_equipes end
     where t.id = (it->>'id')::uuid and t.planejamento_id = _planejamento_id;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;


--
-- Name: planejamento_tarefas_combinar(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.planejamento_tarefas_combinar(_ids uuid[]) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_kept uuid; v_plan uuid; a record; l record; cur_tr uuid; cur_ini numeric; cur_fim numeric; cur_q numeric; cur_tpl boolean;
  cur_area boolean; k int := 0; x uuid;
begin
  if _ids is null or array_length(_ids, 1) < 2 then raise exception 'Escolha ao menos duas tarefas'; end if;
  select id into v_kept from public.planejamento_tarefa where id = any(_ids) order by nivel, ordem, created_at limit 1;
  a := public.fn_tarefa_assert_editavel(v_kept);
  v_plan := a.planejamento_id;
  if (select count(distinct planejamento_id) from public.planejamento_tarefa where id = any(_ids)) <> 1
     or (select count(*) from public.planejamento_tarefa where id = any(_ids)) <> array_length(_ids, 1) then
    raise exception 'As tarefas precisam ser do mesmo plano';
  end if;
  if exists (select 1 from public.planejamento_tarefa where id = any(_ids) and tipo_no <> 'tarefa') then
    raise exception 'Só tarefas (não tarefas-resumo) se combinam';
  end if;
  if (select count(distinct item_orcamentario_id) from public.planejamento_tarefa where id = any(_ids)) <> 1 then
    raise exception 'Só tarefas do mesmo serviço podem ser combinadas';
  end if;
  if (select count(distinct coalesce((select string_agg(distinct coalesce(l2.trecho_id::text, '-'), ',' order by coalesce(l2.trecho_id::text, '-'))
                                        from public.planejamento_tarefa_local l2 where l2.tarefa_id = t.id), ''))
        from public.planejamento_tarefa t where t.id = any(_ids)) <> 1 then
    raise exception 'Só tarefas nos mesmos trechos podem ser combinadas';
  end if;

  create temporary table if not exists _fundir (ordem int, trecho_id uuid, inicio_m numeric, fim_m numeric, quantidade numeric, tpl boolean) on commit drop;
  truncate _fundir;
  cur_tr := null; cur_ini := null;
  for l in select * from public.planejamento_tarefa_local where tarefa_id = any(_ids)
            order by coalesce(trecho_id::text, ''), inicio_m nulls first, fim_m loop
    cur_area := l.inicio_m is null;
    if cur_ini is null and not cur_area then
      cur_tr := l.trecho_id; cur_ini := l.inicio_m; cur_fim := l.fim_m; cur_q := l.quantidade; cur_tpl := l.qtd_origem = 'trecho';
      continue;
    end if;
    if cur_area then
      -- área ou sem trecho: uma linha por trecho, somando
      if exists (select 1 from _fundir f where f.trecho_id is not distinct from l.trecho_id and f.inicio_m is null) then
        update _fundir set quantidade = quantidade + l.quantidade, tpl = tpl and l.qtd_origem = 'trecho'
         where trecho_id is not distinct from l.trecho_id and inicio_m is null;
      else
        insert into _fundir values (k, l.trecho_id, null, null, l.quantidade, l.qtd_origem = 'trecho'); k := k + 1;
      end if;
      continue;
    end if;
    -- faixas que se cruzam ou se encostam no mesmo eixo viram uma só (o ApeX só funde as que se cruzam; aqui um local
    -- contínuo é mais útil, e o motor divide pelos segmentos do template de qualquer jeito)
    if l.trecho_id = cur_tr and l.inicio_m <= cur_fim + 0.005 then
      cur_fim := greatest(cur_fim, l.fim_m); cur_q := cur_q + l.quantidade; cur_tpl := cur_tpl and l.qtd_origem = 'trecho';
    else
      insert into _fundir values (k, cur_tr, cur_ini, cur_fim, cur_q, cur_tpl); k := k + 1;
      cur_tr := l.trecho_id; cur_ini := l.inicio_m; cur_fim := l.fim_m; cur_q := l.quantidade; cur_tpl := l.qtd_origem = 'trecho';
    end if;
  end loop;
  if cur_ini is not null then insert into _fundir values (k, cur_tr, cur_ini, cur_fim, cur_q, cur_tpl); end if;

  -- dependências e equipes das absorvidas passam para a que fica; depois elas saem (antes de inserir os locais fundidos:
  -- o teto do serviço conta as quantidades das absorvidas enquanto existirem)
  foreach x in array _ids loop
    if x = v_kept then continue; end if;
    insert into public.planejamento_dependencia (planejamento_id, predecessora_id, sucessora_id, tipo, origem, atraso_min, atraso_max, dias_uteis, aparencia)
    select d.planejamento_id, d.predecessora_id, v_kept, d.tipo, d.origem, d.atraso_min, d.atraso_max, d.dias_uteis, d.aparencia
      from public.planejamento_dependencia d where d.sucessora_id = x and d.predecessora_id <> all(_ids)
    on conflict (predecessora_id, sucessora_id) do nothing;
    insert into public.planejamento_dependencia (planejamento_id, predecessora_id, sucessora_id, tipo, origem, atraso_min, atraso_max, dias_uteis, aparencia)
    select d.planejamento_id, v_kept, d.sucessora_id, d.tipo, d.origem, d.atraso_min, d.atraso_max, d.dias_uteis, d.aparencia
      from public.planejamento_dependencia d where d.predecessora_id = x and d.sucessora_id <> all(_ids)
    on conflict (predecessora_id, sucessora_id) do nothing;
    insert into public.planejamento_tarefa_equipe (tarefa_id, equipe_id, qtd_equipes)
    select v_kept, e.equipe_id, e.qtd_equipes from public.planejamento_tarefa_equipe e where e.tarefa_id = x
    on conflict do nothing;
  end loop;
  update public.planejamento_tarefa set inicio_em = (select min(inicio_em) from public.planejamento_tarefa where id = any(_ids)) where id = v_kept;
  delete from public.planejamento_tarefa where id = any(_ids) and id <> v_kept;
  delete from public.planejamento_tarefa_local where tarefa_id = v_kept;
  perform set_config('infrawork.locais_lote', '1', true);
  insert into public.planejamento_tarefa_local (tarefa_id, planejamento_id, ordem, trecho_id, inicio_m, fim_m, quantidade, qtd_origem)
  select v_kept, v_plan, f.ordem, f.trecho_id, f.inicio_m, f.fim_m, f.quantidade, case when f.tpl then 'trecho' else 'manual' end
    from _fundir f order by f.ordem;
  perform set_config('infrawork.locais_lote', '', true);
  perform public.fn_locais_validar(v_kept);
  return v_kept;
end $$;


--
-- Name: planejamento_tarefas_criar_das_quantidades(uuid, uuid, uuid[], uuid[], jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.planejamento_tarefas_criar_das_quantidades(_planejamento_id uuid, _parent_id uuid, _trechos uuid[], _itens uuid[], _opcoes jsonb DEFAULT '{}'::jsonb) RETURNS uuid[]
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_obra uuid; v_modo text; v_jan numeric; v_sent text; v_nivel smallint := 1; v_ordem int; tr record; it record; seg record;
  seqs numeric[][]; cur_ini numeric; cur_fim numeric; ids uuid[] := '{}'; v_id uuid; n_par int; k int; w0 numeric; w1 numeric;
  faixas numeric[][]; f numeric[]; v_nome text; v_prefixo text; locais jsonb;
begin
  v_obra := public.fn_plano_assert_editavel(_planejamento_id);
  v_modo := coalesce(_opcoes->>'modo', 'sequencia');
  v_jan := nullif(_opcoes->>'janela_m', '')::numeric;
  v_sent := coalesce(_opcoes->>'sentido', 'crescente');
  if v_modo = 'janela' and (v_jan is null or v_jan <= 0) then raise exception 'Informe o tamanho da janela'; end if;
  if _parent_id is not null then
    select nivel + 1 into v_nivel from public.planejamento_tarefa where id = _parent_id and planejamento_id = _planejamento_id and tipo_no = 'grupo';
    if v_nivel is null then raise exception 'Tarefa-resumo de destino não encontrada'; end if;
  end if;
  select coalesce(max(ordem), -1) + 1 into v_ordem from public.planejamento_tarefa
   where planejamento_id = _planejamento_id and parent_id is not distinct from _parent_id;

  for tr in select t.* from public.obra_trecho t where t.id = any(_trechos) and t.obra_id = v_obra order by t.ordem, t.nome loop
    for it in select i.id, i.descricao from public.item_orcamentario i
               where i.id = any(_itens) and i.obra_id = v_obra and i.tipo = 'servico_grupo' and i.servico_id is not null and i.indireto_id is null
               order by i.codigo loop
      -- partes dos segmentos com quantidade do serviço ainda não cobertas por local "do template" no plano
      faixas := '{}';
      for seg in
        with segs as (
          select s.posicao_inicio_m as ini, s.posicao_fim_m as fim
            from public.trecho_quantidade_segmento s
            join public.trecho_quantidade_celula ce on ce.segmento_id = s.id
            join public.trecho_quantidade_coluna c on c.id = ce.coluna_id
           where c.versao_id = public.trecho_versao_atual(tr.id) and c.item_orcamentario_id = it.id and ce.valor > 0),
        cob as (
          select l.inicio_m, l.fim_m
            from public.planejamento_tarefa_local l join public.planejamento_tarefa t on t.id = l.tarefa_id
           where t.planejamento_id = _planejamento_id and t.item_orcamentario_id = it.id and l.trecho_id = tr.id
             and l.qtd_origem = 'trecho'),
        -- área: o segmento 0–1 inteiro está livre ou coberto
        area_livre as (
          select s.ini, s.fim from segs s where tr.tipo = 'area' and not exists (select 1 from cob)),
        -- eixo: cortes do segmento nas bordas dos locais que o cobrem; fica o que não está coberto
        cortes as (
          select s.ini, s.fim, x.p
            from segs s
            cross join lateral (
              select s.ini as p union select s.fim
              union select c.inicio_m from cob c where c.inicio_m > s.ini and c.inicio_m < s.fim
              union select c.fim_m from cob c where c.fim_m > s.ini and c.fim_m < s.fim) x
           where tr.tipo = 'eixo'),
        pedacos as (
          select c.ini as seg_ini, c.p as ini, lead(c.p) over (partition by c.ini, c.fim order by c.p) as fim from cortes c)
        select ini, fim from area_livre
        union all
        select p.ini, p.fim from pedacos p
         where p.fim is not null and p.fim - p.ini > 0.005
           and not exists (select 1 from cob c where c.inicio_m <= p.ini + 0.005 and c.fim_m >= p.fim - 0.005)
        order by 1
      loop
        if tr.tipo = 'area' then
          faixas := faixas || array[array[0::numeric, 1::numeric]];
          exit;
        end if;
        if cur_ini is null then
          cur_ini := seg.ini; cur_fim := seg.fim;
        elsif seg.ini <= cur_fim + 0.005 then
          cur_fim := greatest(cur_fim, seg.fim);
        else
          faixas := faixas || array[array[cur_ini, cur_fim]];
          cur_ini := seg.ini; cur_fim := seg.fim;
        end if;
      end loop;
      if cur_ini is not null then faixas := faixas || array[array[cur_ini, cur_fim]]; cur_ini := null; cur_fim := null; end if;
      if array_length(faixas, 1) is null then continue; end if;

      -- janelas alinhadas a múltiplos de N ("combine quantities within N stations")
      if v_modo = 'janela' and tr.tipo = 'eixo' then
        seqs := '{}';
        for k in 1 .. array_length(faixas, 1) loop
          w0 := floor(faixas[k][1] / v_jan) * v_jan;
          while w0 < faixas[k][2] - 0.005 loop
            w1 := w0 + v_jan;
            seqs := seqs || array[array[greatest(w0, faixas[k][1]), least(w1, faixas[k][2])]];
            w0 := w1;
          end loop;
        end loop;
        faixas := seqs;
      end if;

      v_prefixo := it.descricao || ' ' || tr.nome;
      if v_modo = 'local' or tr.tipo = 'area' then
        -- uma tarefa com um local por sequência
        locais := '[]'::jsonb;
        for k in 1 .. array_length(faixas, 1) loop
          locais := locais || jsonb_build_object('trecho_id', tr.id,
            'inicio_m', case when tr.tipo = 'area' then null else faixas[k][1] end,
            'fim_m', case when tr.tipo = 'area' then null else faixas[k][2] end, 'qtd_origem', 'trecho');
        end loop;
        v_id := public.planejamento_tarefa_criar(_planejamento_id,
          jsonb_build_object('item_orcamentario_id', it.id, 'parent_id', _parent_id, 'ordem', v_ordem, 'sentido', v_sent,
                             'nome_custom', case when exists (select 1 from public.planejamento_tarefa t where t.planejamento_id = _planejamento_id and t.item_orcamentario_id = it.id)
                                                 then v_prefixo end),
          locais);
        ids := ids || v_id; v_ordem := v_ordem + 1;
      else
        n_par := array_length(faixas, 1);
        for k in 1 .. n_par loop
          v_nome := case when n_par > 1 then v_prefixo || ' ' || k
                         when exists (select 1 from public.planejamento_tarefa t where t.planejamento_id = _planejamento_id and t.item_orcamentario_id = it.id)
                         then v_prefixo end;
          v_id := public.planejamento_tarefa_criar(_planejamento_id,
            jsonb_build_object('item_orcamentario_id', it.id, 'parent_id', _parent_id, 'ordem', v_ordem, 'sentido', v_sent, 'nome_custom', v_nome),
            jsonb_build_array(jsonb_build_object('trecho_id', tr.id, 'inicio_m', faixas[k][1], 'fim_m', faixas[k][2], 'qtd_origem', 'trecho')));
          ids := ids || v_id; v_ordem := v_ordem + 1;
        end loop;
      end if;
    end loop;
  end loop;
  return ids;
end $$;


--
-- Name: planejamento_tarefas_renomear_auto(uuid, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.planejamento_tarefas_renomear_auto(_planejamento_id uuid, _ids uuid[] DEFAULT NULL::uuid[]) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare v_obra uuid; r record; n int := 0; v_prefixo text; v_nome text; k int; chave text; ultimo text;
begin
  v_obra := public.fn_plano_assert_editavel(_planejamento_id);
  ultimo := null;
  for r in
    select t.id, t.nome_custom, public.fn_tarefa_prefixo_nome(t.id) as prefixo,
           coalesce(t.item_orcamentario_id::text, '') || '|' || coalesce(public.fn_tarefa_trecho_principal(t.id)::text, '') as grupo,
           (select min(l.inicio_m) from public.planejamento_tarefa_local l where l.tarefa_id = t.id) as ini,
           (select max(l.fim_m) from public.planejamento_tarefa_local l where l.tarefa_id = t.id) as fim
      from public.planejamento_tarefa t
     where t.planejamento_id = _planejamento_id and t.tipo_no = 'tarefa'
     order by 4, 5 nulls last, 6 nulls last, t.ordem
  loop
    if ultimo is distinct from r.grupo then k := 0; ultimo := r.grupo; end if;
    k := k + 1;
    v_nome := r.prefixo || ' ' || k;
    if (_ids is not null and r.id = any(_ids))
       or (_ids is null and (r.nome_custom is null or r.nome_custom ~ ('^' || regexp_replace(r.prefixo, '([.*+?^${}()|\[\]\\])', '\\\1', 'g') || ' \d+$'))) then
      if r.nome_custom is distinct from v_nome then
        update public.planejamento_tarefa set nome_custom = v_nome where id = r.id;
        n := n + 1;
      end if;
    end if;
  end loop;
  return n;
end $_$;


--
-- Name: pode_editar_orcamento(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pode_editar_orcamento(_obra_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select case public.auth_role()
    when 'god'        then true
    when 'adm'        then public.obra_empresa(_obra_id) = public.auth_empresa_id()
    when 'engenheiro' then public.has_obra_permissao(_obra_id, auth.uid())
    else false
  end
$$;


--
-- Name: pode_lancar_producao(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pode_lancar_producao(_obra_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select case public.auth_role()
    when 'god'        then true
    when 'adm'        then public.obra_empresa(_obra_id) = public.auth_empresa_id()
    when 'engenheiro' then public.has_obra_permissao(_obra_id, auth.uid())
    when 'apoio'      then public.has_obra_permissao(_obra_id, public.auth_engenheiro_id())
    when 'apontador'  then public.has_obra_permissao(_obra_id, auth.uid())
    else false
  end
$$;


--
-- Name: pode_planejar_obra(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pode_planejar_obra(_obra_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select case public.auth_role()
    when 'god'        then true
    when 'adm'        then public.obra_empresa(_obra_id) = public.auth_empresa_id()
    when 'engenheiro' then public.has_obra_permissao(_obra_id, auth.uid())
    else false
  end
$$;


--
-- Name: pode_ver_acompanhamento(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pode_ver_acompanhamento(_obra_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select case public.auth_role()
    when 'god'        then true
    when 'adm'        then public.obra_empresa(_obra_id) = public.auth_empresa_id()
    when 'engenheiro' then public.has_obra_permissao(_obra_id, auth.uid())
    when 'apoio'      then public.has_obra_permissao(_obra_id, public.auth_engenheiro_id())
    when 'cliente'    then public.has_obra_permissao(_obra_id, auth.uid())
    else false
  end
$$;


--
-- Name: pode_ver_obra(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pode_ver_obra(_obra_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select public.auth_role() = 'god'
      or (public.auth_role() = 'adm' and public.obra_empresa(_obra_id) = public.auth_empresa_id())
      or (public.auth_role() in ('engenheiro', 'cliente') and public.has_obra_permissao(_obra_id, auth.uid()))
      or (public.auth_role() = 'apoio' and public.has_obra_permissao(_obra_id, public.auth_engenheiro_id()))
$$;


--
-- Name: preco_vigente_recurso(uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.preco_vigente_recurso(_recurso_id uuid, _data date DEFAULT CURRENT_DATE) RETURNS numeric
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select custo_unitario
    from public.recurso_preco
   where recurso_id = _recurso_id
     and is_vigente = true
   limit 1
$$;


--
-- Name: recalcular_orcamento(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recalcular_orcamento(_obra_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
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


--
-- Name: receita_preco_em(uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.receita_preco_em(_receita_id uuid, _data date) RETURNS numeric
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(
    (select ri.preco_antes
       from public.orcamento_reajuste_item ri
       join public.orcamento_reajuste re on re.id = ri.reajuste_id
      where ri.receita_id = _receita_id and re.status = 'aplicado' and re.data > _data
      order by re.data
      limit 1),
    (select venda_unitaria from public.item_orcamentario where id = _receita_id))
$$;


--
-- Name: recurso_obra(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recurso_obra(_recurso_id uuid) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select obra_id from public.recurso where id = _recurso_id
$$;


--
-- Name: registrar_acesso(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.registrar_acesso() RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  update public.profiles
     set acessos_count  = coalesce(acessos_count, 0) + 1,
         last_access_at = now(),
         last_seen_at   = now()
   where id = auth.uid();
$$;


--
-- Name: registrar_presenca(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.registrar_presenca() RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  update public.profiles
     set last_seen_at = now()
   where id = auth.uid();
$$;


--
-- Name: remover_alocacoes(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.remover_alocacoes(_ids uuid[]) RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_obra uuid; n int;
begin
  select obra_id into v_obra from public.item_orc_alocacao where id = any(_ids) limit 1;
  if v_obra is null then return 0; end if;
  delete from public.item_orc_alocacao where id = any(_ids);
  get diagnostics n = row_count;
  perform public.fn_item_orc_aloc_sync_modo(v_obra);
  perform public.recalcular_orcamento(v_obra);
  return n;
end $$;


--
-- Name: salvar_rateio_receita(uuid, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.salvar_rateio_receita(_receita_id uuid, _criterio text, _destinos jsonb) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_obra uuid; d jsonb;
begin
  select obra_id into v_obra from public.item_orcamentario where id = _receita_id and tipo = 'receita';
  if v_obra is null then raise exception 'Receita não encontrada'; end if;
  if _criterio not in ('percentual', 'peso', 'venda') then raise exception 'Critério inválido: %', _criterio; end if;

  delete from public.item_orc_alocacao where receita_id = _receita_id;
  for d in select e.value from jsonb_array_elements(coalesce(_destinos, '[]'::jsonb)) e loop
    insert into public.item_orc_alocacao (obra_id, grupo_id, receita_id, criterio, valor, compoe_qtd, bases)
    values (v_obra, (d->>'grupo_id')::uuid, _receita_id, _criterio,
            nullif(d->>'valor', '')::numeric,
            coalesce((d->>'compoe_qtd')::boolean, false),
            case when jsonb_typeof(d->'bases') = 'array'
                 then (select array_agg(x::uuid) from jsonb_array_elements_text(d->'bases') x) end);
  end loop;

  perform public.fn_item_orc_aloc_sync_modo(v_obra);
  perform public.recalcular_orcamento(v_obra);
end $$;


--
-- Name: servico_custo_unit(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.servico_custo_unit(_servico_id uuid) RETURNS numeric
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ select custo_unit from public.vw_servico_vivo where servico_id = _servico_id $$;


--
-- Name: servico_dependencias_fingerprint(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.servico_dependencias_fingerprint(_obra_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(jsonb_agg(jsonb_build_object('predecessor_id', predecessor_id, 'sucessor_id', sucessor_id, 'atraso_dias', atraso_dias)
                    order by predecessor_id, sucessor_id), '[]'::jsonb)
    from public.servico_dependencia where obra_id = _obra_id
$$;


--
-- Name: servico_equipe_viva(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.servico_equipe_viva(_servico_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with cpus as (
    select l.cpu_id from public.servico_cpu_link l where l.servico_id = _servico_id
    union
    select c.id from public.cpu c
     where c.servico_id = _servico_id and c.is_vigente
       and not exists (select 1 from public.servico_cpu_link l where l.servico_id = _servico_id)
  ), rec as (
    select it.recurso_id, r.nome, r.grupo, sum(coalesce(it.quantidade, 0)) as qtd
      from public.cpu_item it
      join cpus on cpus.cpu_id = it.cpu_id
      join public.recurso r on r.id = it.recurso_id
     where it.grupo in ('EQUIPAMENTO', 'MO') and it.recurso_id is not null
     group by it.recurso_id, r.nome, r.grupo
    having sum(coalesce(it.quantidade, 0)) > 0
  )
  select jsonb_build_object(
    'servico_id', _servico_id,
    'producao_diaria', v.producao_diaria_qtde,
    'unidade', v.producao_diaria_unidade,
    'cpu_ids', coalesce((select jsonb_agg(cpu_id order by cpu_id) from cpus), '[]'::jsonb),
    'recursos', coalesce((select jsonb_agg(jsonb_build_object('recurso_id', recurso_id, 'nome', nome, 'grupo', grupo, 'qtd', qtd) order by nome, recurso_id) from rec), '[]'::jsonb))
    from public.vw_servico_vivo v where v.servico_id = _servico_id
$$;


--
-- Name: servico_obra(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.servico_obra(_servico_id uuid) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select obra_id from public.servico where id = _servico_id
$$;


--
-- Name: set_alocacao_compoe(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_alocacao_compoe(_id uuid, _compoe boolean) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_obra uuid;
begin
  update public.item_orc_alocacao set compoe_qtd = _compoe where id = _id
  returning obra_id into v_obra;
  if v_obra is null then raise exception 'Alocação não encontrada'; end if;
  perform public.fn_item_orc_aloc_sync_modo(v_obra);
  perform public.recalcular_orcamento(v_obra);
end $$;


--
-- Name: set_recurso_preco_vigente(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_recurso_preco_vigente(_preco_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
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

  if not (
    public.auth_role() = 'god'
    or (public.auth_role() = 'adm'
        and public.obra_empresa(_obra) = public.auth_empresa_id())
    or (public.auth_role() = 'engenheiro'
        and public.has_obra_permissao(_obra, auth.uid()))
  ) then
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


--
-- Name: snapshot_orcamento_atual(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.snapshot_orcamento_atual(_obra_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select jsonb_build_object(
    'obra', (select to_jsonb(o) from public.obras o where o.id = _obra_id),
    'itens', coalesce(
      (select jsonb_agg(to_jsonb(i) order by i.codigo)
         from public.item_orcamentario i
        where i.obra_id = _obra_id),
      '[]'::jsonb
    ),
    'alocacoes', coalesce(
      (select jsonb_agg(to_jsonb(a))
         from public.item_orc_alocacao a
        where a.obra_id = _obra_id),
      '[]'::jsonb
    ),
    'indireto', coalesce(
      (select jsonb_agg(to_jsonb(ii) order by ii.codigo)
         from public.indireto_item ii
        where ii.obra_id = _obra_id),
      '[]'::jsonb
    ),
    'totais', jsonb_build_object(
      'custo_direto',
        (select coalesce(sum(custo_total_calc), 0)
           from public.item_orcamentario
          where obra_id = _obra_id and tipo = 'servico_grupo'),
      'venda_total',
        (select coalesce(sum(venda_total_calc), 0)
           from public.item_orcamentario
          where obra_id = _obra_id and parent_id is null and tipo <> 'servico_grupo'),
      'indireto_total',
        (select coalesce(sum(valor_total * distribuicao_perc), 0)
           from public.indireto_item
          where obra_id = _obra_id)
    ),
    'gerado_em', now()
  )
$$;


--
-- Name: tarefa_obra(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tarefa_obra(_id uuid) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select p.obra_id
    from public.planejamento_tarefa t
    join public.planejamento p on p.id = t.planejamento_id
   where t.id = _id
$$;


--
-- Name: trecho_qtd_faixa(uuid, uuid, numeric, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trecho_qtd_faixa(_trecho_id uuid, _item_id uuid, _ini numeric, _fim numeric) RETURNS numeric
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select case
    when _ini is null or _fim is null then round(public.trecho_servico_total(_trecho_id, _item_id), 4)
    else round(coalesce(sum(ce.valor
           * (least(greatest(_ini, _fim), s.posicao_fim_m) - greatest(least(_ini, _fim), s.posicao_inicio_m))
           / (s.posicao_fim_m - s.posicao_inicio_m)), 0), 4) end
    from public.trecho_quantidade_coluna c
    join public.trecho_quantidade_celula ce on ce.coluna_id = c.id
    join public.trecho_quantidade_segmento s on s.id = ce.segmento_id
   where c.versao_id = public.trecho_versao_atual(_trecho_id)
     and c.item_orcamentario_id = _item_id
     and s.posicao_fim_m > s.posicao_inicio_m
     and (_ini is null or _fim is null
          or least(greatest(_ini, _fim), s.posicao_fim_m) > greatest(least(_ini, _fim), s.posicao_inicio_m))
$$;


--
-- Name: trecho_restaurar_versao(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trecho_restaurar_versao(_versao_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_tpl uuid; v_tr uuid; v_obra uuid;
begin
  select v.template_id, t.trecho_id into v_tpl, v_tr
    from public.trecho_quantidade_versao v join public.trecho_quantidade_template t on t.id = v.template_id
   where v.id = _versao_id;
  if v_tpl is null then raise exception 'Versão não encontrada'; end if;
  v_obra := public.fn_trecho_assert_editavel(v_tr);
  update public.trecho_quantidade_versao set is_atual = false where template_id = v_tpl and is_atual;
  update public.trecho_quantidade_versao set is_atual = true where id = _versao_id;
  if exists (select 1 from public.trecho_quantidade_coluna c
              join public.item_orcamentario g on g.id = c.item_orcamentario_id
             where c.versao_id = _versao_id and public.trechos_servico_total(g.id) > g.quantidade_referencia + 0.0005) then
    raise exception 'Essa versão passa do orçamento em algum serviço';
  end if;
  perform public.trecho_sync_tarefas(v_obra);
end $$;


--
-- Name: trecho_salvar_quantidades(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trecho_salvar_quantidades(_trecho_id uuid, _dados jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_obra uuid; v_tpl uuid; v_ver uuid; v_num int; seg jsonb; v_seg uuid; k text; v numeric;
  ord int := 0; col_ids jsonb := '{}'::jsonb; v_col uuid; item uuid; viol text; n_seg int := 0; n_cel int := 0;
  v_tipo text; v_comp numeric; v_nome text; s_ini numeric; s_fim numeric;
begin
  v_obra := public.fn_trecho_assert_editavel(_trecho_id);
  select tipo, comprimento_m, nome into v_tipo, v_comp, v_nome from public.obra_trecho where id = _trecho_id;
  if jsonb_array_length(coalesce(_dados->'servicos', '[]'::jsonb)) = 0 then
    raise exception 'Escolha ao menos um serviço (agrupador) para o template';
  end if;
  if v_tipo = 'area' and jsonb_array_length(coalesce(_dados->'segmentos', '[]'::jsonb)) > 1 then
    raise exception 'Área "%": as quantidades são uma linha só (sem estacas)', v_nome;
  end if;

  select id into v_tpl from public.trecho_quantidade_template where trecho_id = _trecho_id;
  if v_tpl is null then
    insert into public.trecho_quantidade_template (trecho_id, obra_id, modo)
    values (_trecho_id, v_obra, coalesce(_dados->>'modo', 'analitico')) returning id into v_tpl;
  elsif _dados ? 'modo' then
    update public.trecho_quantidade_template set modo = _dados->>'modo' where id = v_tpl;
  end if;

  v_ver := public.trecho_versao_atual(_trecho_id);
  if v_ver is null or coalesce((_dados->>'nova_versao')::boolean, false) then
    select coalesce(max(numero), 0) + 1 into v_num from public.trecho_quantidade_versao where template_id = v_tpl;
    update public.trecho_quantidade_versao set is_atual = false where template_id = v_tpl and is_atual;
    insert into public.trecho_quantidade_versao (template_id, obra_id, numero, is_atual, comentario, criado_por)
    values (v_tpl, v_obra, v_num, true, nullif(_dados->>'comentario', ''), auth.uid())
    returning id into v_ver;
  else
    delete from public.trecho_quantidade_segmento where versao_id = v_ver;
    delete from public.trecho_quantidade_coluna where versao_id = v_ver;
    if _dados ? 'comentario' then
      update public.trecho_quantidade_versao set comentario = nullif(_dados->>'comentario', '') where id = v_ver;
    end if;
  end if;

  for k in select jsonb_array_elements_text(_dados->'servicos') loop
    item := k::uuid;
    if not exists (select 1 from public.item_orcamentario
                    where id = item and obra_id = v_obra and tipo = 'servico_grupo') then
      raise exception 'Serviço % não é um agrupador desta obra', k;
    end if;
    insert into public.trecho_quantidade_coluna (versao_id, item_orcamentario_id, ordem)
    values (v_ver, item, ord) returning id into v_col;
    col_ids := col_ids || jsonb_build_object(k, v_col);
    ord := ord + 1;
  end loop;

  ord := 0;
  for seg in select e.value from jsonb_array_elements(coalesce(_dados->'segmentos', '[]'::jsonb)) e loop
    if v_tipo = 'area' then
      s_ini := 0; s_fim := 1;
    else
      s_ini := (seg->>'ini')::numeric; s_fim := (seg->>'fim')::numeric;
      if s_ini is null or s_fim is null or s_fim <= s_ini or s_ini < 0 then
        raise exception 'Faixa inválida no trecho "%": % a % m', v_nome, s_ini, s_fim;
      end if;
      if s_fim > v_comp + 0.005 then
        raise exception 'Faixa % a % m passa do comprimento do trecho "%" (% m)', s_ini, s_fim, v_nome, v_comp;
      end if;
    end if;
    insert into public.trecho_quantidade_segmento
      (versao_id, ordem, posicao_inicio_m, posicao_fim_m, unidade_inicio_label, unidade_fim_label)
    values (v_ver, ord, s_ini, s_fim, coalesce(seg->>'label_ini', case when v_tipo = 'area' then 'área' end),
            coalesce(seg->>'label_fim', case when v_tipo = 'area' then 'área' end))
    returning id into v_seg;
    n_seg := n_seg + 1;
    ord := ord + 1;
    for k in select jsonb_object_keys(coalesce(seg->'valores', '{}'::jsonb)) loop
      v := nullif(seg->'valores'->>k, '')::numeric;
      if v is null or v = 0 or not (col_ids ? k) then continue; end if;
      if v < 0 then raise exception 'Quantidade negativa no trecho "%"', v_nome; end if;
      insert into public.trecho_quantidade_celula (segmento_id, coluna_id, valor)
      values (v_seg, (col_ids->>k)::uuid, v);
      n_cel := n_cel + 1;
    end loop;
  end loop;

  -- Σ dos trechos por serviço não pode passar do orçamento
  select string_agg(format('%s %s: trechos %s > orçamento %s', g.codigo, g.descricao,
                           round(public.trechos_servico_total(g.id), 3), round(g.quantidade_referencia, 3)), '; ')
    into viol
    from public.item_orcamentario g
   where g.id in (select (jsonb_array_elements_text(_dados->'servicos'))::uuid)
     and public.trechos_servico_total(g.id) > g.quantidade_referencia + 0.0005;
  if viol is not null then
    raise exception 'Quantidade do trecho acima do orçamento — %', viol;
  end if;

  perform public.trecho_sync_tarefas(v_obra);
  return jsonb_build_object('ok', true, 'versao_id', v_ver, 'segmentos', n_seg, 'celulas', n_cel);
end $$;


--
-- Name: trecho_servico_disponivel(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trecho_servico_disponivel(_trecho_id uuid, _item_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select public.trecho_servico_total(_trecho_id, _item_id) > 0
     and public.trechos_servico_total(_item_id)
         <= coalesce((select quantidade_referencia from public.item_orcamentario where id = _item_id), 0) + 0.0005
$$;


--
-- Name: trecho_servico_total(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trecho_servico_total(_trecho_id uuid, _item_id uuid) RETURNS numeric
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(sum(ce.valor), 0)
    from public.trecho_quantidade_coluna c
    join public.trecho_quantidade_celula ce on ce.coluna_id = c.id
   where c.versao_id = public.trecho_versao_atual(_trecho_id) and c.item_orcamentario_id = _item_id
$$;


--
-- Name: trecho_sync_tarefas(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trecho_sync_tarefas(_obra_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare n int;
begin
  perform set_config('infrawork.trecho_sync', '1', true);
  update public.planejamento_tarefa_local l
     set qtd_origem = l.qtd_origem
    from public.planejamento p
   where p.id = l.planejamento_id and p.obra_id = _obra_id and not p.is_baseline and l.qtd_origem = 'trecho';
  get diagnostics n = row_count;
  perform set_config('infrawork.trecho_sync', '', true);
  return n;
end $$;


--
-- Name: trecho_versao_atual(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trecho_versao_atual(_trecho_id uuid) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select v.id from public.trecho_quantidade_template t
    join public.trecho_quantidade_versao v on v.template_id = t.id and v.is_atual
   where t.trecho_id = _trecho_id
$$;


--
-- Name: trechos_servico_total(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trechos_servico_total(_item_id uuid) RETURNS numeric
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(sum(public.trecho_servico_total(t.id, _item_id)), 0)
    from public.obra_trecho t
   where t.obra_id = (select obra_id from public.item_orcamentario where id = _item_id)
$$;


--
-- Name: frota_veiculo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.frota_veiculo (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    empresa_id uuid NOT NULL,
    prefixo text NOT NULL,
    placa text,
    tipo text DEFAULT 'basculante'::text NOT NULL,
    modelo text,
    proprietario text DEFAULT 'proprio'::text NOT NULL,
    fornecedor text,
    capacidade_m3 numeric(10,2),
    capacidade_t numeric(10,2),
    ativo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    origem text DEFAULT 'manual'::text NOT NULL,
    fleet_id integer,
    fleet_tipo text,
    marca text,
    ano integer,
    fleet_obra_id uuid,
    fleet_status text,
    sincronizado_em timestamp with time zone,
    fleet_capacidade text,
    capacidade_fleethub boolean DEFAULT false NOT NULL,
    CONSTRAINT chk_frota_cap CHECK (((COALESCE(capacidade_m3, (0)::numeric) >= (0)::numeric) AND (COALESCE(capacidade_t, (0)::numeric) >= (0)::numeric))),
    CONSTRAINT chk_frota_origem CHECK ((origem = ANY (ARRAY['manual'::text, 'fleethub'::text]))),
    CONSTRAINT chk_frota_prop CHECK ((proprietario = ANY (ARRAY['proprio'::text, 'terceiro'::text]))),
    CONSTRAINT chk_frota_tipo CHECK ((tipo = ANY (ARRAY['basculante'::text, 'carreta'::text, 'betoneira'::text, 'pipa'::text, 'caminhao'::text, 'escavadeira'::text, 'retroescavadeira'::text, 'carregadeira'::text, 'outro'::text])))
);


--
-- Name: veiculos_da_obra(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.veiculos_da_obra(_obra_id uuid) RETURNS SETOF public.frota_veiculo
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select v.*
    from public.frota_veiculo v
   where v.ativo
     and v.empresa_id = public.obra_empresa(_obra_id)
     and (
       not exists (select 1 from public.obra_fleet_obra x where x.obra_id = _obra_id)
       or v.origem = 'manual'
       or v.fleet_obra_id in (select x.fleet_obra_id from public.obra_fleet_obra x where x.obra_id = _obra_id)
     )
$$;


--
-- Name: acompanhamento_alerta; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acompanhamento_alerta (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    obra_id uuid NOT NULL,
    tipo text NOT NULL,
    severidade text DEFAULT 'warn'::text NOT NULL,
    titulo text NOT NULL,
    descricao text,
    contexto jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'aberto'::text NOT NULL,
    silenciado_ate timestamp with time zone,
    resolvido_em timestamp with time zone,
    resolvido_automaticamente boolean DEFAULT false NOT NULL,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    chave text,
    CONSTRAINT chk_acomp_alerta_severidade CHECK ((severidade = ANY (ARRAY['info'::text, 'warn'::text, 'critical'::text]))),
    CONSTRAINT chk_acomp_alerta_status CHECK ((status = ANY (ARRAY['aberto'::text, 'silenciado'::text, 'resolvido'::text]))),
    CONSTRAINT chk_acomp_alerta_tipo CHECK ((tipo = ANY (ARRAY['producao_zero_dias'::text, 'desvio_quantidade'::text, 'desvio_prazo'::text, 'sem_foto_periodo'::text, 'produtividade_baixa'::text, 'lancamento_sem_equipe'::text])))
);


--
-- Name: anexo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.anexo (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    obra_id uuid NOT NULL,
    escopo text NOT NULL,
    escopo_id uuid NOT NULL,
    nome text NOT NULL,
    storage_path text NOT NULL,
    mime text,
    tamanho_bytes bigint,
    autor_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_anexo_escopo CHECK ((escopo = ANY (ARRAY['obra'::text, 'item'::text, 'revisao'::text])))
);


--
-- Name: calendario; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendario (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    obra_id uuid NOT NULL,
    nome text NOT NULL,
    descricao text,
    padrao boolean DEFAULT false NOT NULL,
    semana jsonb DEFAULT '[{"horas": 8, "inicio": "07:00"}, {"horas": 8, "inicio": "07:00"}, {"horas": 8, "inicio": "07:00"}, {"horas": 8, "inicio": "07:00"}, {"horas": 8, "inicio": "07:00"}, {"horas": 0, "inicio": "07:00"}, {"horas": 0, "inicio": "07:00"}]'::jsonb NOT NULL,
    ordem integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT calendario_nome_check CHECK ((btrim(nome) <> ''::text)),
    CONSTRAINT chk_calendario_semana CHECK (public.fn_semana_valida(semana)),
    CONSTRAINT chk_calendario_semana_trabalho CHECK (public.fn_semana_tem_trabalho(semana))
);


--
-- Name: calendario_definicao; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendario_definicao (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    calendario_id uuid NOT NULL,
    tipo text NOT NULL,
    nome text DEFAULT ''::text NOT NULL,
    data_inicio date,
    data_fim date,
    todo_ano boolean DEFAULT false NOT NULL,
    dia_semana smallint,
    semana jsonb,
    ordem integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT calendario_definicao_dia_semana_check CHECK (((dia_semana >= 0) AND (dia_semana <= 6))),
    CONSTRAINT calendario_definicao_tipo_check CHECK ((tipo = ANY (ARRAY['feriado'::text, 'pascoa'::text, 'folga_semana'::text, 'horario_excecao'::text]))),
    CONSTRAINT chk_caldef_campos CHECK ((((tipo = 'feriado'::text) AND (data_inicio IS NOT NULL) AND (data_fim IS NOT NULL) AND (data_fim >= data_inicio)) OR (tipo = 'pascoa'::text) OR ((tipo = 'folga_semana'::text) AND (data_inicio IS NOT NULL) AND (dia_semana IS NOT NULL)) OR ((tipo = 'horario_excecao'::text) AND (data_inicio IS NOT NULL) AND (data_fim IS NOT NULL) AND (data_fim >= data_inicio) AND (semana IS NOT NULL) AND public.fn_semana_valida(semana))))
);


--
-- Name: comentario_item; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comentario_item (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    item_id uuid NOT NULL,
    obra_id uuid NOT NULL,
    autor_id uuid,
    texto text NOT NULL,
    resolvido boolean DEFAULT false NOT NULL,
    resolvido_por uuid,
    resolvido_em timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cpu_item; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cpu_item (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cpu_id uuid NOT NULL,
    grupo text NOT NULL,
    recurso_id uuid NOT NULL,
    quantidade numeric(14,4) DEFAULT 0 NOT NULL,
    horas_dia numeric(6,2),
    consumo_combustivel_lh numeric(8,4),
    indice_produtividade numeric(5,4) DEFAULT 1.0 NOT NULL,
    consumo_material_por_unid numeric(14,6),
    ordem integer DEFAULT 0 NOT NULL,
    custo_total_calc numeric(14,4) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_cpu_item_grupo CHECK ((grupo = ANY (ARRAY['EQUIPAMENTO'::text, 'COMBUSTIVEL'::text, 'MO'::text, 'MATERIAL'::text]))),
    CONSTRAINT chk_cpu_item_horas CHECK ((((grupo = ANY (ARRAY['EQUIPAMENTO'::text, 'MO'::text])) AND (horas_dia IS NOT NULL)) OR (grupo <> ALL (ARRAY['EQUIPAMENTO'::text, 'MO'::text]))))
);


--
-- Name: empresas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.empresas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nome text NOT NULL,
    cnpj text,
    ativo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: encargos_sociais_regime; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.encargos_sociais_regime (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nome text NOT NULL,
    outros_perc numeric(7,4) DEFAULT 0 NOT NULL,
    total_perc_calc numeric(7,4) DEFAULT 0 NOT NULL,
    vigencia_inicio date,
    vigencia_fim date,
    ativo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    obra_id uuid NOT NULL,
    iss_perc numeric(7,4) DEFAULT 0 NOT NULL,
    pis_perc numeric(7,4) DEFAULT 0 NOT NULL,
    cofins_perc numeric(7,4) DEFAULT 0 NOT NULL,
    csll_perc numeric(7,4) DEFAULT 0 NOT NULL,
    irpj_perc numeric(7,4) DEFAULT 0 NOT NULL,
    cprb_perc numeric(7,4) DEFAULT 0 NOT NULL
);


--
-- Name: fleet_obra; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fleet_obra (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    empresa_id uuid NOT NULL,
    fleet_id integer NOT NULL,
    nome text NOT NULL,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE fleet_obra; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.fleet_obra IS 'Obras cadastradas na FleetHub (lidas pela sincronização). Escrita só pelo serviço.';


--
-- Name: fleet_sync_execucao; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fleet_sync_execucao (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    empresa_id uuid NOT NULL,
    iniciado_em timestamp with time zone DEFAULT now() NOT NULL,
    terminado_em timestamp with time zone,
    ok boolean,
    mensagem text,
    novos integer DEFAULT 0 NOT NULL,
    atualizados integer DEFAULT 0 NOT NULL,
    inativados integer DEFAULT 0 NOT NULL,
    lidos integer DEFAULT 0 NOT NULL,
    obras integer DEFAULT 0 NOT NULL,
    disparado_por uuid,
    origem text DEFAULT 'manual'::text NOT NULL,
    capacidades integer,
    CONSTRAINT chk_fleet_sync_origem CHECK ((origem = ANY (ARRAY['manual'::text, 'cron'::text])))
);


--
-- Name: fleethub_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fleethub_config (
    empresa_id uuid NOT NULL,
    email text NOT NULL,
    secret_id uuid NOT NULL,
    conectado_em timestamp with time zone DEFAULT now() NOT NULL,
    conectado_por uuid
);


--
-- Name: TABLE fleethub_config; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.fleethub_config IS 'Conta da FleetHub da empresa: e-mail e referência ao segredo no Vault (a senha não fica nesta tabela).';


--
-- Name: indireto_item; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.indireto_item (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    obra_id uuid NOT NULL,
    parent_id uuid,
    codigo text NOT NULL,
    descricao text NOT NULL,
    tipo text NOT NULL,
    valor_total numeric(14,2) DEFAULT 0 NOT NULL,
    distribuicao_perc numeric(7,4) DEFAULT 1.0 NOT NULL,
    ordem integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_indireto_distribuicao CHECK (((distribuicao_perc >= (0)::numeric) AND (distribuicao_perc <= (1)::numeric)))
);


--
-- Name: item_orc_alocacao; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_orc_alocacao (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    obra_id uuid NOT NULL,
    grupo_id uuid NOT NULL,
    receita_id uuid NOT NULL,
    criterio text DEFAULT 'percentual'::text NOT NULL,
    valor numeric(18,6),
    bases uuid[],
    compoe_qtd boolean DEFAULT false NOT NULL,
    fracao numeric(14,10) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT item_orc_alocacao_criterio_check CHECK ((criterio = ANY (ARRAY['percentual'::text, 'peso'::text, 'venda'::text])))
);


--
-- Name: TABLE item_orc_alocacao; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.item_orc_alocacao IS 'Rateio: receita da planilha de venda → serviço (servico_grupo), com fração. Uma receita pode ir a vários serviços.';


--
-- Name: mcp_oauth_cliente; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mcp_oauth_cliente (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id text NOT NULL,
    nome text NOT NULL,
    redirect_uris text[] NOT NULL,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mcp_oauth_cliente_redirect_uris_check CHECK (((cardinality(redirect_uris) >= 1) AND (cardinality(redirect_uris) <= 10)))
);


--
-- Name: mcp_oauth_codigo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mcp_oauth_codigo (
    hash text NOT NULL,
    cliente_id uuid NOT NULL,
    user_id uuid NOT NULL,
    redirect_uri text NOT NULL,
    code_challenge text NOT NULL,
    escopo text,
    expira_em timestamp with time zone NOT NULL,
    usado_em timestamp with time zone,
    criado_em timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: mcp_token; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mcp_token (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    nome text NOT NULL,
    prefixo text NOT NULL,
    hash text NOT NULL,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    expira_em timestamp with time zone,
    ultimo_uso_em timestamp with time zone,
    revogado_em timestamp with time zone,
    tipo text DEFAULT 'pessoal'::text NOT NULL,
    cliente_id uuid,
    refresh_hash text,
    refresh_expira_em timestamp with time zone,
    CONSTRAINT chk_mcp_token_tipo CHECK ((tipo = ANY (ARRAY['pessoal'::text, 'oauth'::text]))),
    CONSTRAINT mcp_token_nome_check CHECK (((length(TRIM(BOTH FROM nome)) >= 1) AND (length(TRIM(BOTH FROM nome)) <= 80)))
);


--
-- Name: memoria_calculo_item; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.memoria_calculo_item (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    item_id uuid NOT NULL,
    obra_id uuid NOT NULL,
    body_md text DEFAULT ''::text NOT NULL,
    estaca_inicio text,
    estaca_fim text,
    autor_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: obra_fleet_obra; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.obra_fleet_obra (
    obra_id uuid NOT NULL,
    fleet_obra_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid
);


--
-- Name: TABLE obra_fleet_obra; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.obra_fleet_obra IS 'Vínculo feito no InfraWork entre a obra e a(s) obra(s) da FleetHub: filtra os veículos da obra nas viagens.';


--
-- Name: obra_permissoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.obra_permissoes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    obra_id uuid NOT NULL,
    user_id uuid NOT NULL,
    concedido_por uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: obra_produtividade_mes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.obra_produtividade_mes (
    obra_id uuid NOT NULL,
    ano_mes date NOT NULL,
    fator numeric(4,2) DEFAULT 1.0 NOT NULL,
    motivo text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_obra_prod_dia1 CHECK ((EXTRACT(day FROM ano_mes) = (1)::numeric)),
    CONSTRAINT chk_obra_prod_fator CHECK (((fator >= 0.1) AND (fator <= 2.0)))
);


--
-- Name: obras; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.obras (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    empresa_id uuid NOT NULL,
    nome text NOT NULL,
    codigo text NOT NULL,
    status text DEFAULT 'em_andamento'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    rodovia text,
    trecho text,
    extensao_km numeric(10,3),
    data_inicio_planejada date,
    data_fim_planejada date,
    ativa boolean DEFAULT true NOT NULL,
    data_base_orcamento date
);


--
-- Name: COLUMN obras.ativa; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.obras.ativa IS 'false = obra desabilitada: some da seleção (app) e do contexto do agente WhatsApp; permanece na gestão para reabilitar/excluir.';


--
-- Name: orcamento_aditivo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orcamento_aditivo (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    obra_id uuid NOT NULL,
    numero integer DEFAULT 0 NOT NULL,
    data date NOT NULL,
    descricao text,
    status text DEFAULT 'rascunho'::text NOT NULL,
    venda_antes numeric(18,2),
    venda_depois numeric(18,2),
    criado_por uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    aplicado_em timestamp with time zone,
    aplicado_por uuid,
    CONSTRAINT orcamento_aditivo_status_check CHECK ((status = ANY (ARRAY['rascunho'::text, 'aplicado'::text])))
);


--
-- Name: orcamento_aditivo_item; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orcamento_aditivo_item (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    aditivo_id uuid NOT NULL,
    obra_id uuid NOT NULL,
    ordem integer DEFAULT 0 NOT NULL,
    tipo text NOT NULL,
    receita_id uuid,
    codigo text NOT NULL,
    descricao text,
    unidade text,
    quantidade_antes numeric(18,4),
    quantidade_nova numeric(18,4),
    venda_unitaria numeric(18,4),
    alocacao jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT orcamento_aditivo_item_tipo_check CHECK ((tipo = ANY (ARRAY['quantidade'::text, 'exclusao'::text, 'novo'::text])))
);


--
-- Name: orcamento_planilha_inicial; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orcamento_planilha_inicial (
    obra_id uuid NOT NULL,
    aditivo_id uuid,
    snapshot jsonb NOT NULL,
    criada_em timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: orcamento_reajuste; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orcamento_reajuste (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    obra_id uuid NOT NULL,
    numero integer DEFAULT 0 NOT NULL,
    data date NOT NULL,
    descricao text,
    status text DEFAULT 'rascunho'::text NOT NULL,
    venda_antes numeric(18,2),
    venda_depois numeric(18,2),
    criado_por uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    aplicado_em timestamp with time zone,
    aplicado_por uuid,
    CONSTRAINT orcamento_reajuste_status_check CHECK ((status = ANY (ARRAY['rascunho'::text, 'aplicado'::text])))
);


--
-- Name: orcamento_reajuste_grupo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orcamento_reajuste_grupo (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    reajuste_id uuid NOT NULL,
    obra_id uuid NOT NULL,
    ordem integer DEFAULT 0 NOT NULL,
    nome text NOT NULL,
    indice_anterior numeric(18,6) NOT NULL,
    indice_atual numeric(18,6) NOT NULL,
    CONSTRAINT orcamento_reajuste_grupo_indice_anterior_check CHECK ((indice_anterior > (0)::numeric)),
    CONSTRAINT orcamento_reajuste_grupo_indice_atual_check CHECK ((indice_atual > (0)::numeric))
);


--
-- Name: orcamento_reajuste_item; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orcamento_reajuste_item (
    reajuste_id uuid NOT NULL,
    receita_id uuid NOT NULL,
    grupo_id uuid NOT NULL,
    obra_id uuid NOT NULL,
    fator numeric(18,8),
    preco_antes numeric(18,4),
    preco_depois numeric(18,4)
);


--
-- Name: orcamento_recalculo_pendente; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orcamento_recalculo_pendente (
    obra_id uuid NOT NULL,
    marcado_em timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: planejamento_dependencia; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.planejamento_dependencia (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    planejamento_id uuid NOT NULL,
    predecessora_id uuid NOT NULL,
    sucessora_id uuid NOT NULL,
    tipo text DEFAULT 'FS'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    origem text DEFAULT 'manual'::text NOT NULL,
    atraso_min integer DEFAULT 0,
    atraso_max integer,
    dias_uteis boolean DEFAULT false NOT NULL,
    aparencia jsonb,
    CONSTRAINT chk_plan_dep_atrasos CHECK (((atraso_min IS NULL) OR (atraso_max IS NULL) OR (atraso_min <= atraso_max))),
    CONSTRAINT chk_plan_dep_distintos CHECK ((predecessora_id <> sucessora_id)),
    CONSTRAINT chk_plan_dep_origem CHECK ((origem = 'manual'::text)),
    CONSTRAINT chk_plan_dep_tipo CHECK ((tipo = ANY (ARRAY['FS'::text, 'SS'::text, 'FF'::text, 'SF'::text, 'EST'::text])))
);


--
-- Name: COLUMN planejamento_dependencia.tipo; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.planejamento_dependencia.tipo IS 'FS/SS/FF/SF ou EST (por estacas: a sucessora só passa em cada estaca depois da predecessora)';


--
-- Name: COLUMN planejamento_dependencia.atraso_min; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.planejamento_dependencia.atraso_min IS 'Atraso mínimo em dias (null = sem mínimo: a dependência não segura datas, só a máxima vale)';


--
-- Name: planejamento_lb_premissa; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.planejamento_lb_premissa (
    tarefa_id uuid NOT NULL,
    planejamento_id uuid NOT NULL,
    item_orcamentario_id uuid,
    item_quantidade numeric(18,4),
    item_venda_total numeric(18,2),
    item_custo_unit numeric(18,4),
    producao_diaria_cpu numeric(14,4),
    producao_diaria_efetiva numeric(14,4),
    equipe jsonb
);


--
-- Name: COLUMN planejamento_lb_premissa.equipe; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.planejamento_lb_premissa.equipe IS 'Equipe (composição) usada no cálculo: servico_equipe_viva no momento da promoção';


--
-- Name: planejamento_marco; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.planejamento_marco (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    planejamento_id uuid NOT NULL,
    nome text NOT NULL,
    descricao text,
    inicio timestamp without time zone,
    fim timestamp without time zone,
    filtro_servicos boolean DEFAULT false NOT NULL,
    servicos uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    filtro_recursos boolean DEFAULT false NOT NULL,
    recursos uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    filtro_estacas boolean DEFAULT false NOT NULL,
    faixas jsonb DEFAULT '[]'::jsonb NOT NULL,
    incluidas uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    excluidas uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    aparencia jsonb,
    ordem integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT planejamento_marco_check CHECK (((inicio IS NULL) OR (fim IS NULL) OR (inicio <= fim))),
    CONSTRAINT planejamento_marco_nome_check CHECK ((btrim(nome) <> ''::text))
);


--
-- Name: planejamento_recurso_limite; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.planejamento_recurso_limite (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    planejamento_id uuid NOT NULL,
    recurso_id uuid NOT NULL,
    grupo_id uuid,
    maximo numeric(12,3) NOT NULL,
    CONSTRAINT planejamento_recurso_limite_maximo_check CHECK ((maximo > (0)::numeric))
);


--
-- Name: planejamento_tarefa_equipe; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.planejamento_tarefa_equipe (
    tarefa_id uuid NOT NULL,
    equipe_id uuid NOT NULL,
    qtd_equipes smallint DEFAULT 1 NOT NULL,
    CONSTRAINT chk_plan_tar_eq_qtd CHECK (((qtd_equipes >= 1) AND (qtd_equipes <= 10)))
);


--
-- Name: planejamento_tarefa_indireto; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.planejamento_tarefa_indireto (
    tarefa_id uuid NOT NULL,
    custo_periodicidade text NOT NULL,
    custo_unitario numeric(18,4),
    receita_modo text NOT NULL,
    receita_unitaria numeric(18,4),
    receita_percentual numeric(7,4),
    offset_dias_antes integer DEFAULT 0 NOT NULL,
    offset_dias_depois integer DEFAULT 0 NOT NULL,
    receita_extrapola boolean DEFAULT true NOT NULL,
    aplica_taxas boolean DEFAULT false NOT NULL,
    taxa_regime_id uuid,
    custo_total_calc numeric(18,4),
    receita_total_calc numeric(18,4),
    custo_taxas_calc numeric(18,4),
    periodos_calc numeric(12,4),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_pti_custo_periodicidade CHECK ((custo_periodicidade = ANY (ARRAY['dia'::text, 'mes'::text, 'ano'::text]))),
    CONSTRAINT chk_pti_custo_unitario_nonneg CHECK (((custo_unitario IS NULL) OR (custo_unitario >= (0)::numeric))),
    CONSTRAINT chk_pti_offsets_nonneg CHECK (((offset_dias_antes >= 0) AND (offset_dias_depois >= 0))),
    CONSTRAINT chk_pti_receita_coerencia CHECK ((((receita_modo = 'mesma_logica_custo'::text) AND (receita_percentual IS NULL) AND ((receita_unitaria IS NULL) OR (receita_unitaria >= (0)::numeric))) OR ((receita_modo = 'percentual_dos_servicos'::text) AND (receita_unitaria IS NULL) AND (receita_percentual IS NOT NULL) AND (receita_percentual >= (0)::numeric) AND (receita_percentual <= (100)::numeric)))),
    CONSTRAINT chk_pti_receita_modo CHECK ((receita_modo = ANY (ARRAY['mesma_logica_custo'::text, 'percentual_dos_servicos'::text]))),
    CONSTRAINT chk_pti_taxas_coerencia CHECK ((((aplica_taxas = true) AND (taxa_regime_id IS NOT NULL)) OR ((aplica_taxas = false) AND (taxa_regime_id IS NULL))))
);


--
-- Name: TABLE planejamento_tarefa_indireto; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.planejamento_tarefa_indireto IS 'Config 1:1 com planejamento_tarefa pra tarefas que apontam pra item_orcamentario.indireto_id. Custo recorrente, receita modo direto ou percentual, taxas opcionais, cobre dinâmicamente o cronograma.';


--
-- Name: COLUMN planejamento_tarefa_indireto.custo_unitario; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.planejamento_tarefa_indireto.custo_unitario IS 'Override opcional do custo por período. NULL = usa item.custo_unitario_calc do orçamento (derivado de indireto_item.valor_total).';


--
-- Name: COLUMN planejamento_tarefa_indireto.receita_unitaria; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.planejamento_tarefa_indireto.receita_unitaria IS 'Override opcional da receita por período (modo mesma_logica_custo). NULL = usa item.venda_total_calc / quantidade_referencia.';


--
-- Name: planejamento_tarefa_local; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.planejamento_tarefa_local (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tarefa_id uuid NOT NULL,
    planejamento_id uuid NOT NULL,
    ordem integer DEFAULT 0 NOT NULL,
    trecho_id uuid,
    inicio_m numeric(14,3),
    fim_m numeric(14,3),
    quantidade numeric(18,4) DEFAULT 0 NOT NULL,
    qtd_origem text DEFAULT 'manual'::text NOT NULL,
    inicio_em timestamp without time zone,
    fim_em timestamp without time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_local_faixa CHECK ((((trecho_id IS NULL) AND (inicio_m IS NULL) AND (fim_m IS NULL)) OR ((trecho_id IS NOT NULL) AND (inicio_m IS NULL) AND (fim_m IS NULL)) OR ((trecho_id IS NOT NULL) AND (inicio_m IS NOT NULL) AND (fim_m IS NOT NULL) AND (inicio_m >= (0)::numeric) AND (fim_m > inicio_m)))),
    CONSTRAINT planejamento_tarefa_local_qtd_origem_check CHECK ((qtd_origem = ANY (ARRAY['manual'::text, 'trecho'::text]))),
    CONSTRAINT planejamento_tarefa_local_quantidade_check CHECK ((quantidade >= (0)::numeric))
);


--
-- Name: planejamento_tarefa_wp; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.planejamento_tarefa_wp (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    planejamento_id uuid NOT NULL,
    tarefa_id uuid NOT NULL,
    local_id uuid,
    ordem integer NOT NULL,
    trecho_id uuid,
    inicio_m numeric(14,3),
    fim_m numeric(14,3),
    quantidade numeric(18,4) NOT NULL,
    inicio_em timestamp without time zone NOT NULL,
    fim_em timestamp without time zone NOT NULL
);


--
-- Name: recurso; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recurso (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    codigo text,
    grupo text NOT NULL,
    nome text NOT NULL,
    unidade text NOT NULL,
    ativo boolean DEFAULT true NOT NULL,
    fonte text,
    observacao text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    obra_id uuid NOT NULL,
    CONSTRAINT chk_recurso_grupo CHECK ((grupo = ANY (ARRAY['MO'::text, 'MVE'::text, 'COMBUSTIVEL'::text, 'MATERIAL'::text, 'ADM'::text])))
);


--
-- Name: recurso_preco; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recurso_preco (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    recurso_id uuid NOT NULL,
    custo_unitario numeric(14,4) NOT NULL,
    vigencia_inicio date NOT NULL,
    vigencia_fim date,
    origem text,
    documento_url text,
    observacao text,
    criado_por uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_vigente boolean DEFAULT false NOT NULL,
    CONSTRAINT chk_recurso_preco_vigencia CHECK (((vigencia_fim IS NULL) OR (vigencia_fim > vigencia_inicio)))
);


--
-- Name: servico_dependencia; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.servico_dependencia (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    obra_id uuid NOT NULL,
    predecessor_id uuid NOT NULL,
    sucessor_id uuid NOT NULL,
    atraso_dias integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT servico_dependencia_check CHECK ((predecessor_id <> sucessor_id))
);


--
-- Name: servico_parametro; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.servico_parametro (
    item_orcamentario_id uuid NOT NULL,
    obra_id uuid NOT NULL,
    modo_lancamento text DEFAULT 'quantidade'::text NOT NULL,
    controla_material boolean DEFAULT false NOT NULL,
    material_recurso_id uuid,
    material_unidade text,
    material_obrigatorio boolean DEFAULT true NOT NULL,
    habilita_obs boolean DEFAULT true NOT NULL,
    exige_local boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    medicao_viagem text DEFAULT 'volume'::text NOT NULL,
    CONSTRAINT chk_sp_medicao_viagem CHECK ((medicao_viagem = ANY (ARRAY['volume'::text, 'peso'::text]))),
    CONSTRAINT chk_sp_modo CHECK ((modo_lancamento = ANY (ARRAY['quantidade'::text, 'viagens'::text])))
);


--
-- Name: TABLE servico_parametro; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.servico_parametro IS 'Parametrização do serviço (agrupador) para o lançamento: modo, material controlado, observação, local obrigatório. Sem linha = padrão.';


--
-- Name: transporte_local; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transporte_local (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    obra_id uuid NOT NULL,
    nome text NOT NULL,
    tipo text DEFAULT 'outro'::text NOT NULL,
    trecho_id uuid,
    lat numeric(10,6),
    lng numeric(10,6),
    ativo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    estaca_acesso_m numeric(14,3),
    distancia_acesso_km numeric(10,3) DEFAULT 0 NOT NULL,
    CONSTRAINT chk_transp_local_acesso CHECK (((distancia_acesso_km >= (0)::numeric) AND ((estaca_acesso_m IS NULL) OR (estaca_acesso_m >= (0)::numeric)))),
    CONSTRAINT chk_transp_local_tipo CHECK ((tipo = ANY (ARRAY['jazida'::text, 'caixa_emprestimo'::text, 'bota_fora'::text, 'usina'::text, 'central'::text, 'deposito'::text, 'pista'::text, 'outro'::text])))
);


--
-- Name: COLUMN transporte_local.trecho_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.transporte_local.trecho_id IS 'Local da obra (eixo/área) que este ponto representa — na pista, a viagem informa a estaca de descarga';


--
-- Name: transporte_rota; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transporte_rota (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    obra_id uuid NOT NULL,
    origem_id uuid NOT NULL,
    destino_id uuid NOT NULL,
    dmt_km numeric(10,3) NOT NULL,
    CONSTRAINT chk_transp_rota_dmt CHECK ((dmt_km >= (0)::numeric)),
    CONSTRAINT chk_transp_rota_par CHECK ((origem_id <> destino_id))
);


--
-- Name: trecho_quantidade_celula; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trecho_quantidade_celula (
    segmento_id uuid NOT NULL,
    coluna_id uuid NOT NULL,
    valor numeric(18,3) NOT NULL
);


--
-- Name: trecho_quantidade_coluna; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trecho_quantidade_coluna (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    versao_id uuid NOT NULL,
    item_orcamentario_id uuid NOT NULL,
    ordem integer DEFAULT 0 NOT NULL
);


--
-- Name: trecho_quantidade_mapeamento; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trecho_quantidade_mapeamento (
    obra_id uuid NOT NULL,
    chave text NOT NULL,
    item_orcamentario_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE trecho_quantidade_mapeamento; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.trecho_quantidade_mapeamento IS 'Coluna da planilha de quantidades (nome normalizado) → serviço do orçamento; null = não importar';


--
-- Name: trecho_quantidade_segmento; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trecho_quantidade_segmento (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    versao_id uuid NOT NULL,
    ordem integer NOT NULL,
    posicao_inicio_m numeric(14,2) NOT NULL,
    posicao_fim_m numeric(14,2) NOT NULL,
    unidade_inicio_label text,
    unidade_fim_label text,
    CONSTRAINT trecho_quantidade_segmento_check CHECK ((posicao_fim_m >= posicao_inicio_m))
);


--
-- Name: trecho_quantidade_template; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trecho_quantidade_template (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trecho_id uuid NOT NULL,
    obra_id uuid NOT NULL,
    modo text DEFAULT 'analitico'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT trecho_quantidade_template_modo_check CHECK ((modo = ANY (ARRAY['analitico'::text, 'simplificado'::text])))
);


--
-- Name: trecho_quantidade_versao; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trecho_quantidade_versao (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    template_id uuid NOT NULL,
    obra_id uuid NOT NULL,
    numero integer NOT NULL,
    is_atual boolean DEFAULT true NOT NULL,
    comentario text,
    criado_por uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: viagem; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.viagem (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ficha_id uuid NOT NULL,
    obra_id uuid NOT NULL,
    data date NOT NULL,
    item_orcamentario_id uuid NOT NULL,
    origem_id uuid,
    destino_id uuid,
    hora_carga time without time zone,
    hora_descarga time without time zone,
    quantidade numeric(14,4) NOT NULL,
    material_qtd numeric(14,4),
    dmt_km numeric(10,3),
    nf_ticket text,
    trecho_id uuid,
    posicao_inicio_m numeric(14,3),
    posicao_fim_m numeric(14,3),
    obs text,
    ordem integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    carregador_id uuid,
    equipe_id uuid,
    encarregado_id uuid,
    estaca_carga_m numeric(14,3),
    estaca_descarga_m numeric(14,3),
    dmt_calculada_km numeric(10,3),
    dmt_manual boolean DEFAULT false NOT NULL,
    dmt_origem text,
    CONSTRAINT chk_viagem_dmt CHECK (((dmt_km IS NULL) OR (dmt_km >= (0)::numeric))),
    CONSTRAINT chk_viagem_mat CHECK (((material_qtd IS NULL) OR (material_qtd >= (0)::numeric))),
    CONSTRAINT chk_viagem_medidas CHECK (((dmt_origem IS NULL) OR (dmt_origem = ANY (ARRAY['geometria'::text, 'rota'::text, 'manual'::text])))),
    CONSTRAINT chk_viagem_qtd CHECK ((quantidade > (0)::numeric))
);


--
-- Name: viagem_ficha; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.viagem_ficha (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    obra_id uuid NOT NULL,
    data date NOT NULL,
    veiculo_id uuid,
    motorista text,
    encarregado_id uuid,
    equipe_id uuid,
    obs text,
    origem text DEFAULT 'web'::text NOT NULL,
    criado_por uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_ficha_origem CHECK ((origem = ANY (ARRAY['web'::text, 'campo'::text])))
);


--
-- Name: vw_acompanhamento_foto_enriquecida; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_acompanhamento_foto_enriquecida WITH (security_invoker='true') AS
 SELECT f.id,
    f.obra_id,
    f.producao_id,
    f.item_orcamentario_id,
    f.lat,
    f.lng,
    f.captured_at,
    ((f.captured_at AT TIME ZONE 'America/Sao_Paulo'::text))::date AS captured_date,
    f.storage_bucket,
    f.storage_key,
    f.obs,
    f.size_bytes,
    f.mime,
    f.width,
    f.height,
    f.enviado_por,
    f.created_at,
    f.servico_nome,
    COALESCE(s.nome, f.servico_nome) AS servico_display_nome,
    s.codigo AS servico_codigo,
    f.encarregado_id,
    COALESCE(en.apelido, en.nome) AS encarregado_display_nome,
    p.equipe_id,
    COALESCE(e.nome, '—'::text) AS equipe_display_nome,
    COALESCE(e.cor, '#94a3b8'::text) AS equipe_display_cor,
        CASE
            WHEN (f.producao_id IS NOT NULL) THEN 'direto'::text
            WHEN (inf.id IS NOT NULL) THEN 'inferido'::text
            ELSE 'avulso'::text
        END AS correlacao_producao,
    inf.id AS producao_inferida_id,
    COALESCE(NULLIF(TRIM(BOTH FROM p.frente), ''::text), NULLIF(TRIM(BOTH FROM inf.frente), ''::text), '(sem frente)'::text) AS frente
   FROM ((((((public.acompanhamento_foto f
     LEFT JOIN public.acompanhamento_producao p ON ((p.id = f.producao_id)))
     LEFT JOIN public.equipe e ON ((e.id = p.equipe_id)))
     LEFT JOIN public.encarregado en ON ((en.id = f.encarregado_id)))
     LEFT JOIN public.item_orcamentario io ON ((io.id = f.item_orcamentario_id)))
     LEFT JOIN public.servico s ON ((s.id = io.servico_id)))
     LEFT JOIN LATERAL ( SELECT p2.id,
            p2.frente
           FROM public.acompanhamento_producao p2
          WHERE ((f.producao_id IS NULL) AND (f.item_orcamentario_id IS NOT NULL) AND (p2.obra_id = f.obra_id) AND (p2.item_orcamentario_id = f.item_orcamentario_id) AND ((p2.data >= (((f.captured_at AT TIME ZONE 'America/Sao_Paulo'::text))::date - 1)) AND (p2.data <= (((f.captured_at AT TIME ZONE 'America/Sao_Paulo'::text))::date + 1))))
          ORDER BY (abs(EXTRACT(epoch FROM (((p2.data)::timestamp without time zone)::timestamp with time zone - f.captured_at))))
         LIMIT 1) inf ON (true))
  WHERE (f.excluida_em IS NULL);


--
-- Name: vw_acompanhamento_frente_kpis; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_acompanhamento_frente_kpis WITH (security_invoker='true') AS
 SELECT p.obra_id,
    COALESCE(NULLIF(TRIM(BOTH FROM p.frente), ''::text), '(sem frente)'::text) AS frente,
    count(*) AS registros,
    count(DISTINCT p.data) AS dias_ativos,
    count(DISTINCT p.equipe_id) AS equipes_distintas,
    array_remove(array_agg(DISTINCT e.nome ORDER BY e.nome), NULL::text) AS equipes,
    count(DISTINCT p.item_orcamentario_id) AS servicos_distintos,
    sum((p.quantidade * p.fator_conversao)) AS qtd_total,
    min(p.data) AS primeira_data,
    max(p.data) AS ultima_data,
    count(*) FILTER (WHERE (p.data >= (CURRENT_DATE - '7 days'::interval))) AS registros_ultima_semana
   FROM (public.acompanhamento_producao p
     LEFT JOIN public.equipe e ON ((e.id = p.equipe_id)))
  GROUP BY p.obra_id, COALESCE(NULLIF(TRIM(BOTH FROM p.frente), ''::text), '(sem frente)'::text);


--
-- Name: vw_acompanhamento_obra_resumo; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_acompanhamento_obra_resumo WITH (security_invoker='true') AS
 SELECT id AS obra_id,
    ( SELECT round(COALESCE((sum((COALESCE(pr.qtd_real, (0)::numeric) * COALESCE(io.venda_unitaria, (io.venda_total_calc / NULLIF(io.quantidade_referencia, (0)::numeric)), (0)::numeric))) / NULLIF(sum((COALESCE(pr.qtd_plan, (0)::numeric) * COALESCE(io.venda_unitaria, (io.venda_total_calc / NULLIF(io.quantidade_referencia, (0)::numeric)), (0)::numeric))), (0)::numeric)), (0)::numeric), 4) AS round
           FROM (public.vw_acompanhamento_previsto_x_realizado pr
             JOIN public.item_orcamentario io ON ((io.id = pr.item_orcamentario_id)))
          WHERE ((pr.obra_id = o.id) AND (io.indireto_id IS NULL))) AS avanco_pct,
    ( SELECT COALESCE(sum((p.quantidade * p.fator_conversao)), (0)::numeric) AS "coalesce"
           FROM public.acompanhamento_producao p
          WHERE ((p.obra_id = o.id) AND (p.data >= (CURRENT_DATE - '30 days'::interval)))) AS producao_30d_qtd,
    ( SELECT count(*) AS count
           FROM public.acompanhamento_producao p
          WHERE ((p.obra_id = o.id) AND (p.data >= (CURRENT_DATE - '30 days'::interval)))) AS producao_30d_registros,
    ( SELECT count(DISTINCT p.data) AS count
           FROM public.acompanhamento_producao p
          WHERE ((p.obra_id = o.id) AND (p.data >= (CURRENT_DATE - '30 days'::interval)))) AS dias_com_apontamento,
    ( SELECT count(DISTINCT p.equipe_id) AS count
           FROM public.acompanhamento_producao p
          WHERE ((p.obra_id = o.id) AND (p.data = CURRENT_DATE))) AS equipes_ativas_hoje,
    ( SELECT count(DISTINCT p.equipe_id) AS count
           FROM public.acompanhamento_producao p
          WHERE ((p.obra_id = o.id) AND (p.data >= (CURRENT_DATE - '7 days'::interval)))) AS equipes_ativas_semana,
    ( SELECT count(*) AS count
           FROM public.acompanhamento_foto f
          WHERE ((f.obra_id = o.id) AND (f.excluida_em IS NULL))) AS fotos_total,
    ( SELECT count(*) AS count
           FROM public.acompanhamento_foto f
          WHERE ((f.obra_id = o.id) AND (f.lat IS NOT NULL) AND (f.excluida_em IS NULL))) AS fotos_com_geo,
    ( WITH dias_prod AS (
                 SELECT DISTINCT acompanhamento_producao.data
                   FROM public.acompanhamento_producao
                  WHERE ((acompanhamento_producao.obra_id = o.id) AND (acompanhamento_producao.data >= (CURRENT_DATE - '30 days'::interval)))
                ), dias_foto AS (
                 SELECT DISTINCT ((acompanhamento_foto.captured_at AT TIME ZONE 'America/Sao_Paulo'::text))::date AS d
                   FROM public.acompanhamento_foto
                  WHERE ((acompanhamento_foto.obra_id = o.id) AND (acompanhamento_foto.captured_at >= (now() - '30 days'::interval)) AND (acompanhamento_foto.excluida_em IS NULL))
                )
         SELECT
                CASE
                    WHEN (( SELECT count(*) AS count
                       FROM dias_prod) = 0) THEN NULL::numeric
                    ELSE round(((( SELECT count(*) AS count
                       FROM dias_foto))::numeric / (( SELECT count(*) AS count
                       FROM dias_prod))::numeric), 4)
                END AS round) AS cobertura_fotografica_pct,
    ( SELECT count(*) AS count
           FROM public.acompanhamento_alerta a
          WHERE ((a.obra_id = o.id) AND (a.status = 'aberto'::text) AND (a.severidade = 'critical'::text))) AS alertas_criticos,
    ( SELECT count(*) AS count
           FROM public.acompanhamento_alerta a
          WHERE ((a.obra_id = o.id) AND (a.status = 'aberto'::text))) AS alertas_abertos_total,
    ( SELECT max(p.created_at) AS max
           FROM public.acompanhamento_producao p
          WHERE (p.obra_id = o.id)) AS ultimo_lancamento_em,
    ( SELECT max(p.data) AS max
           FROM public.acompanhamento_producao p
          WHERE (p.obra_id = o.id)) AS data_ultima_producao,
    ( SELECT count(*) AS count
           FROM public.acompanhamento_producao p
          WHERE (p.obra_id = o.id)) AS lancamentos_total
   FROM public.obras o
  WHERE (ativa = true);


--
-- Name: vw_acompanhamento_produtividade_equipe; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_acompanhamento_produtividade_equipe WITH (security_invoker='true') AS
 WITH dia AS (
         SELECT p.obra_id,
            p.equipe_id,
            p.item_orcamentario_id,
            p.servico_id,
            p.data,
            max(p.servico_nome) AS servico_nome,
            sum((p.quantidade * p.fator_conversao)) AS qtd
           FROM public.acompanhamento_producao p
          WHERE (p.quantidade > (0)::numeric)
          GROUP BY p.obra_id, p.equipe_id, p.item_orcamentario_id, p.servico_id, p.data
        ), base AS (
         SELECT d.obra_id,
            d.equipe_id,
            d.item_orcamentario_id,
            d.servico_id,
            d.data,
            d.servico_nome,
            d.qtd,
            e.nome AS equipe_nome,
            e.cor AS equipe_cor,
            COALESCE(s.unidade, io.unidade_referencia) AS unidade_plano,
            snap.producao_diaria_qtde AS meta
           FROM ((((dia d
             LEFT JOIN public.equipe e ON ((e.id = d.equipe_id)))
             LEFT JOIN public.item_orcamentario io ON ((io.id = d.item_orcamentario_id)))
             LEFT JOIN public.servico s ON ((s.id = d.servico_id)))
             LEFT JOIN public.vw_servico_vivo snap ON ((snap.servico_id = io.servico_id)))
        )
 SELECT obra_id,
    equipe_id,
    equipe_id AS equipe_planejamento_id,
    COALESCE(equipe_nome, '—'::text) AS equipe_display_nome,
    COALESCE(equipe_cor, '#94a3b8'::text) AS equipe_cor,
    servico_nome,
    servico_id,
    servico_id AS servico_planejamento_id,
    item_orcamentario_id,
    unidade_plano AS unidade,
    count(*) AS registros,
    count(DISTINCT data) AS dias_trabalhados,
    sum(qtd) AS qtd_total,
    avg(qtd) AS qtd_media,
    min(qtd) AS qtd_min,
    max(qtd) AS qtd_max,
    percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((qtd)::double precision)) AS qtd_p50,
    percentile_cont((0.9)::double precision) WITHIN GROUP (ORDER BY ((qtd)::double precision)) AS qtd_p90,
    meta AS producao_diaria_meta,
    meta AS producao_diaria_cpu,
        CASE
            WHEN ((meta IS NULL) OR (meta = (0)::numeric)) THEN NULL::numeric
            ELSE round(((percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((qtd)::double precision)) / (meta)::double precision))::numeric, 4)
        END AS pct_aderencia_meta,
    min(data) AS primeira_data,
    max(data) AS ultima_data
   FROM base
  GROUP BY obra_id, equipe_id, equipe_nome, equipe_cor, servico_nome, servico_id, item_orcamentario_id, unidade_plano, meta;


--
-- Name: vw_orcamento_consolidado; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_orcamento_consolidado WITH (security_invoker='true') AS
 WITH raizes AS (
         SELECT item_orcamentario.obra_id,
            (COALESCE(sum(item_orcamentario.venda_total_calc) FILTER (WHERE ((item_orcamentario.parent_id IS NULL) AND (item_orcamentario.tipo <> 'servico_grupo'::text))), (0)::numeric))::numeric(14,2) AS venda_total,
            (COALESCE(sum(item_orcamentario.custo_total_calc) FILTER (WHERE (item_orcamentario.tipo = 'servico_grupo'::text)), (0)::numeric))::numeric(14,2) AS custo_direto_calc
           FROM public.item_orcamentario
          GROUP BY item_orcamentario.obra_id
        ), vinculados AS (
         SELECT item_orcamentario.obra_id,
            item_orcamentario.indireto_id
           FROM public.item_orcamentario
          WHERE (item_orcamentario.indireto_id IS NOT NULL)
          GROUP BY item_orcamentario.obra_id, item_orcamentario.indireto_id
        ), indireto_vinc AS (
         SELECT io.obra_id,
            (COALESCE(sum(io.custo_total_calc), (0)::numeric))::numeric(14,2) AS custo_indireto_vinculado
           FROM public.item_orcamentario io
          WHERE (io.indireto_id IS NOT NULL)
          GROUP BY io.obra_id
        ), indireto_stand AS (
         SELECT i.obra_id,
            (COALESCE(sum((COALESCE(i.valor_total, (0)::numeric) * COALESCE(i.distribuicao_perc, (1)::numeric))), (0)::numeric))::numeric(14,2) AS custo_indireto_standalone
           FROM public.indireto_item i
          WHERE (NOT (EXISTS ( SELECT 1
                   FROM vinculados v_1
                  WHERE ((v_1.obra_id = i.obra_id) AND (v_1.indireto_id = i.id)))))
          GROUP BY i.obra_id
        ), taxa AS (
         SELECT DISTINCT ON (encargos_sociais_regime.obra_id) encargos_sociais_regime.obra_id,
            (COALESCE(encargos_sociais_regime.total_perc_calc, (0)::numeric))::numeric(7,4) AS aliquota_total_perc
           FROM public.encargos_sociais_regime
          WHERE ((encargos_sociais_regime.ativo = true) AND ((encargos_sociais_regime.vigencia_inicio IS NULL) OR (encargos_sociais_regime.vigencia_inicio <= CURRENT_DATE)) AND ((encargos_sociais_regime.vigencia_fim IS NULL) OR (encargos_sociais_regime.vigencia_fim >= CURRENT_DATE)))
          ORDER BY encargos_sociais_regime.obra_id, encargos_sociais_regime.vigencia_inicio DESC NULLS LAST
        )
 SELECT o.id AS obra_id,
    COALESCE(r.venda_total, (0)::numeric) AS venda_total,
    COALESCE(r.custo_direto_calc, (0)::numeric) AS custo_direto_calc,
    COALESCE(s.custo_indireto_standalone, (0)::numeric) AS custo_indireto_standalone,
    COALESCE(v.custo_indireto_vinculado, (0)::numeric) AS custo_indireto_vinculado,
    (COALESCE(r.custo_direto_calc, (0)::numeric) - COALESCE(v.custo_indireto_vinculado, (0)::numeric)) AS custo_direto_real,
    (COALESCE(s.custo_indireto_standalone, (0)::numeric) + COALESCE(v.custo_indireto_vinculado, (0)::numeric)) AS custo_indireto_total,
    (COALESCE(r.custo_direto_calc, (0)::numeric) + COALESCE(s.custo_indireto_standalone, (0)::numeric)) AS custo_total,
    COALESCE(t.aliquota_total_perc, (0)::numeric) AS aliquota_total_perc,
    ((COALESCE(r.venda_total, (0)::numeric) * COALESCE(t.aliquota_total_perc, (0)::numeric)))::numeric(14,2) AS impostos,
    ((((COALESCE(r.venda_total, (0)::numeric) - COALESCE(r.custo_direto_calc, (0)::numeric)) - COALESCE(s.custo_indireto_standalone, (0)::numeric)) - (COALESCE(r.venda_total, (0)::numeric) * COALESCE(t.aliquota_total_perc, (0)::numeric))))::numeric(14,2) AS lucro_liquido,
        CASE
            WHEN (COALESCE(r.venda_total, (0)::numeric) = (0)::numeric) THEN NULL::numeric
            ELSE round(((((COALESCE(r.venda_total, (0)::numeric) - COALESCE(r.custo_direto_calc, (0)::numeric)) - COALESCE(s.custo_indireto_standalone, (0)::numeric)) - (COALESCE(r.venda_total, (0)::numeric) * COALESCE(t.aliquota_total_perc, (0)::numeric))) / NULLIF(COALESCE(r.venda_total, (0)::numeric), (0)::numeric)), 4)
        END AS lucratividade_perc
   FROM ((((public.obras o
     LEFT JOIN raizes r ON ((r.obra_id = o.id)))
     LEFT JOIN indireto_stand s ON ((s.obra_id = o.id)))
     LEFT JOIN indireto_vinc v ON ((v.obra_id = o.id)))
     LEFT JOIN taxa t ON ((t.obra_id = o.id)));


--
-- Name: VIEW vw_orcamento_consolidado; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.vw_orcamento_consolidado IS 'Lucratividade real por obra. Expõe indiretos VINCULADOS (custo_indireto_vinculado) separado dos standalone, e custo_direto_real (sem indiretos embutidos), pra a UI mostrar os cards corretamente sem duplicar o lucro.';


--
-- Name: vw_planejamento_tarefa_completa; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_planejamento_tarefa_completa WITH (security_invoker='true') AS
 SELECT t.id,
    t.planejamento_id,
    t.item_orcamentario_id,
    t.data_inicio,
    t.data_fim,
    t.duracao_dias_uteis_calc,
    t.notas,
    t.ordem,
    t.created_at,
    t.updated_at,
    t.tipo_no,
    t.parent_id,
    t.nivel,
    t.codigo_eap,
    t.nome_custom,
    t.quantidade_alocada,
    t.is_critico,
    p.obra_id,
    p.is_baseline,
    p.status AS planejamento_status,
    p.data_date AS planejamento_data_date,
    i.codigo AS servico_grupo_codigo,
    i.descricao AS servico_grupo_descricao,
    (COALESCE(pr.item_quantidade, i.quantidade_referencia))::numeric(14,4) AS quantidade_referencia,
    i.servico_id,
    i.indireto_id,
    i.unidade_referencia AS unidade_referencia_item,
    (COALESCE(pr.item_custo_unit, i.custo_unitario_calc))::numeric(14,4) AS custo_unitario_item,
        CASE
            WHEN (i.tipo = 'receita'::text) THEN i.venda_unitaria
            WHEN ((i.tipo = 'servico_grupo'::text) AND (COALESCE(pr.item_quantidade, i.quantidade_referencia) > (0)::numeric)) THEN ((COALESCE(pr.item_venda_total, i.venda_total_calc) / COALESCE(pr.item_quantidade, i.quantidade_referencia)))::numeric(18,4)
            ELSE NULL::numeric
        END AS venda_unitaria_item,
    (COALESCE(pr.item_venda_total, i.venda_total_calc))::numeric(14,2) AS venda_total_item,
    s.codigo AS servico_codigo,
    s.nome AS servico_nome,
    s.unidade AS unidade_servico,
    snap.cpu_id AS cpu_id_origem,
    COALESCE(pr.producao_diaria_cpu, snap.producao_diaria_qtde) AS producao_diaria_qtde,
    snap.producao_diaria_unidade,
    (COALESCE(pr.item_custo_unit, snap.custo_unit))::numeric(14,4) AS custo_unit_snapshot,
    COALESCE(pr.producao_diaria_efetiva, ((COALESCE(pr.producao_diaria_cpu, snap.producao_diaria_qtde) * (t.qtd_equipes)::numeric) * t.coef_producao)) AS producao_diaria_efetiva,
    (i.indireto_id IS NOT NULL) AS is_indireto,
        CASE
            WHEN ((i.indireto_id IS NOT NULL) AND (pti.tarefa_id IS NOT NULL)) THEN jsonb_build_object('custo_periodicidade', pti.custo_periodicidade, 'custo_unitario', pti.custo_unitario, 'receita_modo', pti.receita_modo, 'receita_unitaria', pti.receita_unitaria, 'receita_percentual', pti.receita_percentual, 'offset_dias_antes', pti.offset_dias_antes, 'offset_dias_depois', pti.offset_dias_depois, 'receita_extrapola', pti.receita_extrapola, 'aplica_taxas', pti.aplica_taxas, 'taxa_regime_id', pti.taxa_regime_id, 'periodos_calc', pti.periodos_calc)
            ELSE NULL::jsonb
        END AS indireto_config,
        CASE
            WHEN (i.indireto_id IS NOT NULL) THEN (COALESCE(pti.custo_total_calc, (0)::numeric))::numeric(18,2)
            WHEN ((COALESCE(pr.item_custo_unit, snap.custo_unit) IS NOT NULL) AND (t.quantidade_alocada IS NOT NULL)) THEN ((COALESCE(pr.item_custo_unit, snap.custo_unit) * t.quantidade_alocada))::numeric(18,2)
            ELSE (0)::numeric(18,2)
        END AS custo_total_calc,
        CASE
            WHEN (i.indireto_id IS NOT NULL) THEN (COALESCE(pti.receita_total_calc, (0)::numeric))::numeric(18,2)
            WHEN ((i.tipo = 'servico_grupo'::text) AND (COALESCE(pr.item_quantidade, i.quantidade_referencia) > (0)::numeric) AND (t.quantidade_alocada IS NOT NULL)) THEN (((COALESCE(pr.item_venda_total, i.venda_total_calc) / COALESCE(pr.item_quantidade, i.quantidade_referencia)) * t.quantidade_alocada))::numeric(18,2)
            WHEN ((i.tipo = 'receita'::text) AND (i.venda_unitaria IS NOT NULL) AND (t.quantidade_alocada IS NOT NULL)) THEN ((i.venda_unitaria * t.quantidade_alocada))::numeric(18,2)
            ELSE (0)::numeric(18,2)
        END AS receita_total_calc,
        CASE
            WHEN (i.indireto_id IS NOT NULL) THEN pti.custo_taxas_calc
            ELSE NULL::numeric
        END AS custo_taxas_calc,
        CASE
            WHEN ((COALESCE(pr.item_custo_unit, snap.custo_unit) IS NOT NULL) AND (t.quantidade_alocada IS NOT NULL)) THEN ((COALESCE(pr.item_custo_unit, snap.custo_unit) * t.quantidade_alocada))::numeric(14,2)
            ELSE (0)::numeric(14,2)
        END AS custo_total_tarefa,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', e.id, 'nome', e.nome, 'cor', e.cor, 'tipo', e.tipo, 'ordem', e.ordem, 'qtd_equipes', pte.qtd_equipes, 'producao_diaria_efetiva', ((COALESCE(pr.producao_diaria_cpu, snap.producao_diaria_qtde) * (t.qtd_equipes)::numeric) * t.coef_producao)) ORDER BY e.ordem, e.nome) AS jsonb_agg
           FROM (public.planejamento_tarefa_equipe pte
             JOIN public.equipe e ON ((e.id = pte.equipe_id)))
          WHERE (pte.tarefa_id = t.id)), '[]'::jsonb) AS equipes,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', d.id, 'predecessora_id', d.predecessora_id, 'tipo', d.tipo, 'origem', d.origem, 'atraso_min', d.atraso_min, 'atraso_max', d.atraso_max, 'dias_uteis', d.dias_uteis)) AS jsonb_agg
           FROM public.planejamento_dependencia d
          WHERE (d.sucessora_id = t.id)), '[]'::jsonb) AS predecessoras,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', d.id, 'sucessora_id', d.sucessora_id, 'tipo', d.tipo, 'origem', d.origem, 'atraso_min', d.atraso_min, 'atraso_max', d.atraso_max, 'dias_uteis', d.dias_uteis)) AS jsonb_agg
           FROM public.planejamento_dependencia d
          WHERE (d.predecessora_id = t.id)), '[]'::jsonb) AS sucessoras,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('semana_segunda', ps.semana_segunda, 'quantidade_planejada', ps.quantidade_planejada) ORDER BY ps.semana_segunda) AS jsonb_agg
           FROM public.planejamento_tarefa_perfil_semana ps
          WHERE (ps.tarefa_id = t.id)), '[]'::jsonb) AS perfil_semanas,
    t.prioridade,
    t.asap,
    t.inicio_dia,
    t.sentido,
    t.restricao_inicio,
    t.restricao_inicio_em,
    t.restricao_fim,
    t.restricao_fim_em,
    t.coef_producao,
    t.qtd_equipes,
    t.calendario_id,
    t.derivar_predecessoras,
    t.aparencia,
    t.inicio_em,
    t.fim_em,
    t.folga_total_h,
    t.folga_livre_h,
    t.restricao_limite,
    t.violacoes,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', l.id, 'ordem', l.ordem, 'trecho_id', l.trecho_id, 'inicio_m', l.inicio_m, 'fim_m', l.fim_m, 'quantidade', l.quantidade, 'qtd_origem', l.qtd_origem, 'inicio_em', l.inicio_em, 'fim_em', l.fim_em, 'trecho_nome', tr.nome, 'trecho_tipo', tr.tipo, 'trecho_disponivel',
                CASE
                    WHEN ((l.trecho_id IS NOT NULL) AND (t.item_orcamentario_id IS NOT NULL)) THEN public.trecho_servico_disponivel(l.trecho_id, t.item_orcamentario_id)
                    ELSE false
                END) ORDER BY l.ordem, l.inicio_m) AS jsonb_agg
           FROM (public.planejamento_tarefa_local l
             LEFT JOIN public.obra_trecho tr ON ((tr.id = l.trecho_id)))
          WHERE (l.tarefa_id = t.id)), '[]'::jsonb) AS locais
   FROM ((((((public.planejamento_tarefa t
     JOIN public.planejamento p ON ((p.id = t.planejamento_id)))
     LEFT JOIN public.item_orcamentario i ON ((i.id = t.item_orcamentario_id)))
     LEFT JOIN public.servico s ON ((s.id = i.servico_id)))
     LEFT JOIN public.vw_servico_vivo snap ON ((snap.servico_id = i.servico_id)))
     LEFT JOIN public.planejamento_lb_premissa pr ON ((pr.tarefa_id = t.id)))
     LEFT JOIN public.planejamento_tarefa_indireto pti ON ((pti.tarefa_id = t.id)));


--
-- Name: vw_recurso_com_preco; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_recurso_com_preco WITH (security_invoker='true') AS
 SELECT id,
    obra_id,
    codigo,
    grupo,
    nome,
    unidade,
    ativo,
    fonte,
    observacao,
    created_at,
    updated_at,
    public.preco_vigente_recurso(id) AS preco_vigente
   FROM public.recurso r;


--
-- Name: VIEW vw_recurso_com_preco; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.vw_recurso_com_preco IS 'Recurso + preço vigente em current_date. RLS herda da tabela recurso (security_invoker).';


--
-- Name: vw_servico_consumo_material; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_servico_consumo_material WITH (security_invoker='true') AS
 WITH por_lancamento AS (
         SELECT p.obra_id,
            p.item_orcamentario_id,
            m.recurso_id,
            p.id AS producao_id,
            (p.quantidade * p.fator_conversao) AS producao,
            sum(m.quantidade) AS material,
            max(m.unidade) AS unidade
           FROM (public.acompanhamento_producao p
             JOIN public.acompanhamento_producao_material m ON ((m.producao_id = p.id)))
          WHERE ((m.recurso_id IS NOT NULL) AND (m.quantidade IS NOT NULL) AND (p.item_orcamentario_id IS NOT NULL))
          GROUP BY p.obra_id, p.item_orcamentario_id, m.recurso_id, p.id, p.quantidade, p.fator_conversao
        )
 SELECT obra_id,
    item_orcamentario_id,
    recurso_id,
    max(unidade) AS unidade,
    count(*) AS lancamentos,
    sum(material) AS material_total,
    sum(producao) AS producao_total,
        CASE
            WHEN (sum(producao) > (0)::numeric) THEN (sum(material) / sum(producao))
            ELSE NULL::numeric
        END AS media_por_unidade
   FROM por_lancamento
  GROUP BY obra_id, item_orcamentario_id, recurso_id;


--
-- Name: acompanhamento_alerta acompanhamento_alerta_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acompanhamento_alerta
    ADD CONSTRAINT acompanhamento_alerta_pkey PRIMARY KEY (id);


--
-- Name: acompanhamento_foto acompanhamento_foto_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acompanhamento_foto
    ADD CONSTRAINT acompanhamento_foto_pkey PRIMARY KEY (id);


--
-- Name: acompanhamento_producao_material acompanhamento_producao_material_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acompanhamento_producao_material
    ADD CONSTRAINT acompanhamento_producao_material_pkey PRIMARY KEY (id);


--
-- Name: acompanhamento_producao acompanhamento_producao_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acompanhamento_producao
    ADD CONSTRAINT acompanhamento_producao_pkey PRIMARY KEY (id);


--
-- Name: anexo anexo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.anexo
    ADD CONSTRAINT anexo_pkey PRIMARY KEY (id);


--
-- Name: anexo anexo_storage_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.anexo
    ADD CONSTRAINT anexo_storage_path_key UNIQUE (storage_path);


--
-- Name: calendario_definicao calendario_definicao_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendario_definicao
    ADD CONSTRAINT calendario_definicao_pkey PRIMARY KEY (id);


--
-- Name: calendario calendario_obra_id_nome_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendario
    ADD CONSTRAINT calendario_obra_id_nome_key UNIQUE (obra_id, nome);


--
-- Name: calendario calendario_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendario
    ADD CONSTRAINT calendario_pkey PRIMARY KEY (id);


--
-- Name: comentario_item comentario_item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comentario_item
    ADD CONSTRAINT comentario_item_pkey PRIMARY KEY (id);


--
-- Name: cpu_item cpu_item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cpu_item
    ADD CONSTRAINT cpu_item_pkey PRIMARY KEY (id);


--
-- Name: cpu cpu_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cpu
    ADD CONSTRAINT cpu_pkey PRIMARY KEY (id);


--
-- Name: cpu cpu_servico_id_versao_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cpu
    ADD CONSTRAINT cpu_servico_id_versao_key UNIQUE (servico_id, versao);


--
-- Name: empresas empresas_cnpj_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.empresas
    ADD CONSTRAINT empresas_cnpj_key UNIQUE (cnpj);


--
-- Name: empresas empresas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.empresas
    ADD CONSTRAINT empresas_pkey PRIMARY KEY (id);


--
-- Name: encargos_sociais_regime encargos_obra_nome_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encargos_sociais_regime
    ADD CONSTRAINT encargos_obra_nome_key UNIQUE (obra_id, nome);


--
-- Name: encargos_sociais_regime encargos_sociais_regime_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encargos_sociais_regime
    ADD CONSTRAINT encargos_sociais_regime_pkey PRIMARY KEY (id);


--
-- Name: encarregado encarregado_obra_id_nome_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encarregado
    ADD CONSTRAINT encarregado_obra_id_nome_key UNIQUE (obra_id, nome);


--
-- Name: encarregado encarregado_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encarregado
    ADD CONSTRAINT encarregado_pkey PRIMARY KEY (id);


--
-- Name: equipe equipe_obra_id_nome_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipe
    ADD CONSTRAINT equipe_obra_id_nome_key UNIQUE (obra_id, nome);


--
-- Name: equipe equipe_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipe
    ADD CONSTRAINT equipe_pkey PRIMARY KEY (id);


--
-- Name: fleet_obra fleet_obra_empresa_id_fleet_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fleet_obra
    ADD CONSTRAINT fleet_obra_empresa_id_fleet_id_key UNIQUE (empresa_id, fleet_id);


--
-- Name: fleet_obra fleet_obra_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fleet_obra
    ADD CONSTRAINT fleet_obra_pkey PRIMARY KEY (id);


--
-- Name: fleet_sync_execucao fleet_sync_execucao_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fleet_sync_execucao
    ADD CONSTRAINT fleet_sync_execucao_pkey PRIMARY KEY (id);


--
-- Name: fleethub_config fleethub_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fleethub_config
    ADD CONSTRAINT fleethub_config_pkey PRIMARY KEY (empresa_id);


--
-- Name: frota_veiculo frota_veiculo_empresa_id_prefixo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.frota_veiculo
    ADD CONSTRAINT frota_veiculo_empresa_id_prefixo_key UNIQUE (empresa_id, prefixo);


--
-- Name: frota_veiculo frota_veiculo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.frota_veiculo
    ADD CONSTRAINT frota_veiculo_pkey PRIMARY KEY (id);


--
-- Name: indireto_item indireto_item_obra_id_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.indireto_item
    ADD CONSTRAINT indireto_item_obra_id_codigo_key UNIQUE (obra_id, codigo);


--
-- Name: indireto_item indireto_item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.indireto_item
    ADD CONSTRAINT indireto_item_pkey PRIMARY KEY (id);


--
-- Name: item_orc_alocacao item_orc_alocacao_grupo_id_receita_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_orc_alocacao
    ADD CONSTRAINT item_orc_alocacao_grupo_id_receita_id_key UNIQUE (grupo_id, receita_id);


--
-- Name: item_orc_alocacao item_orc_alocacao_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_orc_alocacao
    ADD CONSTRAINT item_orc_alocacao_pkey PRIMARY KEY (id);


--
-- Name: item_orcamentario item_orcamentario_obra_id_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_orcamentario
    ADD CONSTRAINT item_orcamentario_obra_id_codigo_key UNIQUE (obra_id, codigo);


--
-- Name: item_orcamentario item_orcamentario_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_orcamentario
    ADD CONSTRAINT item_orcamentario_pkey PRIMARY KEY (id);


--
-- Name: mcp_oauth_cliente mcp_oauth_cliente_client_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_oauth_cliente
    ADD CONSTRAINT mcp_oauth_cliente_client_id_key UNIQUE (client_id);


--
-- Name: mcp_oauth_cliente mcp_oauth_cliente_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_oauth_cliente
    ADD CONSTRAINT mcp_oauth_cliente_pkey PRIMARY KEY (id);


--
-- Name: mcp_oauth_codigo mcp_oauth_codigo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_oauth_codigo
    ADD CONSTRAINT mcp_oauth_codigo_pkey PRIMARY KEY (hash);


--
-- Name: mcp_token mcp_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_token
    ADD CONSTRAINT mcp_token_hash_key UNIQUE (hash);


--
-- Name: mcp_token mcp_token_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_token
    ADD CONSTRAINT mcp_token_pkey PRIMARY KEY (id);


--
-- Name: memoria_calculo_item memoria_calculo_item_item_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memoria_calculo_item
    ADD CONSTRAINT memoria_calculo_item_item_id_key UNIQUE (item_id);


--
-- Name: memoria_calculo_item memoria_calculo_item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memoria_calculo_item
    ADD CONSTRAINT memoria_calculo_item_pkey PRIMARY KEY (id);


--
-- Name: obra_fleet_obra obra_fleet_obra_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.obra_fleet_obra
    ADD CONSTRAINT obra_fleet_obra_pkey PRIMARY KEY (obra_id, fleet_obra_id);


--
-- Name: obra_permissoes obra_permissoes_obra_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.obra_permissoes
    ADD CONSTRAINT obra_permissoes_obra_id_user_id_key UNIQUE (obra_id, user_id);


--
-- Name: obra_permissoes obra_permissoes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.obra_permissoes
    ADD CONSTRAINT obra_permissoes_pkey PRIMARY KEY (id);


--
-- Name: obra_produtividade_mes obra_produtividade_mes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.obra_produtividade_mes
    ADD CONSTRAINT obra_produtividade_mes_pkey PRIMARY KEY (obra_id, ano_mes);


--
-- Name: obra_trecho obra_trecho_obra_id_nome_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.obra_trecho
    ADD CONSTRAINT obra_trecho_obra_id_nome_key UNIQUE (obra_id, nome);


--
-- Name: obra_trecho obra_trecho_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.obra_trecho
    ADD CONSTRAINT obra_trecho_pkey PRIMARY KEY (id);


--
-- Name: obras obras_empresa_id_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.obras
    ADD CONSTRAINT obras_empresa_id_codigo_key UNIQUE (empresa_id, codigo);


--
-- Name: obras obras_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.obras
    ADD CONSTRAINT obras_pkey PRIMARY KEY (id);


--
-- Name: orcamento_aditivo_item orcamento_aditivo_item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orcamento_aditivo_item
    ADD CONSTRAINT orcamento_aditivo_item_pkey PRIMARY KEY (id);


--
-- Name: orcamento_aditivo orcamento_aditivo_obra_id_numero_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orcamento_aditivo
    ADD CONSTRAINT orcamento_aditivo_obra_id_numero_key UNIQUE (obra_id, numero);


--
-- Name: orcamento_aditivo orcamento_aditivo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orcamento_aditivo
    ADD CONSTRAINT orcamento_aditivo_pkey PRIMARY KEY (id);


--
-- Name: orcamento_planilha_inicial orcamento_planilha_inicial_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orcamento_planilha_inicial
    ADD CONSTRAINT orcamento_planilha_inicial_pkey PRIMARY KEY (obra_id);


--
-- Name: orcamento_reajuste_grupo orcamento_reajuste_grupo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orcamento_reajuste_grupo
    ADD CONSTRAINT orcamento_reajuste_grupo_pkey PRIMARY KEY (id);


--
-- Name: orcamento_reajuste_grupo orcamento_reajuste_grupo_reajuste_id_nome_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orcamento_reajuste_grupo
    ADD CONSTRAINT orcamento_reajuste_grupo_reajuste_id_nome_key UNIQUE (reajuste_id, nome);


--
-- Name: orcamento_reajuste_item orcamento_reajuste_item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orcamento_reajuste_item
    ADD CONSTRAINT orcamento_reajuste_item_pkey PRIMARY KEY (reajuste_id, receita_id);


--
-- Name: orcamento_reajuste orcamento_reajuste_obra_id_numero_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orcamento_reajuste
    ADD CONSTRAINT orcamento_reajuste_obra_id_numero_key UNIQUE (obra_id, numero);


--
-- Name: orcamento_reajuste orcamento_reajuste_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orcamento_reajuste
    ADD CONSTRAINT orcamento_reajuste_pkey PRIMARY KEY (id);


--
-- Name: orcamento_recalculo_pendente orcamento_recalculo_pendente_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orcamento_recalculo_pendente
    ADD CONSTRAINT orcamento_recalculo_pendente_pkey PRIMARY KEY (obra_id);


--
-- Name: planejamento_dependencia planejamento_dependencia_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento_dependencia
    ADD CONSTRAINT planejamento_dependencia_pkey PRIMARY KEY (id);


--
-- Name: planejamento_dependencia planejamento_dependencia_predecessora_id_sucessora_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento_dependencia
    ADD CONSTRAINT planejamento_dependencia_predecessora_id_sucessora_id_key UNIQUE (predecessora_id, sucessora_id);


--
-- Name: planejamento_lb_premissa planejamento_lb_premissa_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento_lb_premissa
    ADD CONSTRAINT planejamento_lb_premissa_pkey PRIMARY KEY (tarefa_id);


--
-- Name: planejamento_marco planejamento_marco_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento_marco
    ADD CONSTRAINT planejamento_marco_pkey PRIMARY KEY (id);


--
-- Name: planejamento planejamento_obra_id_nome_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento
    ADD CONSTRAINT planejamento_obra_id_nome_key UNIQUE (obra_id, nome);


--
-- Name: planejamento planejamento_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento
    ADD CONSTRAINT planejamento_pkey PRIMARY KEY (id);


--
-- Name: planejamento_recurso_limite planejamento_recurso_limite_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento_recurso_limite
    ADD CONSTRAINT planejamento_recurso_limite_pkey PRIMARY KEY (id);


--
-- Name: planejamento_tarefa_equipe planejamento_tarefa_equipe_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento_tarefa_equipe
    ADD CONSTRAINT planejamento_tarefa_equipe_pkey PRIMARY KEY (tarefa_id, equipe_id);


--
-- Name: planejamento_tarefa_indireto planejamento_tarefa_indireto_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento_tarefa_indireto
    ADD CONSTRAINT planejamento_tarefa_indireto_pkey PRIMARY KEY (tarefa_id);


--
-- Name: planejamento_tarefa_local planejamento_tarefa_local_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento_tarefa_local
    ADD CONSTRAINT planejamento_tarefa_local_pkey PRIMARY KEY (id);


--
-- Name: planejamento_tarefa_perfil_dia planejamento_tarefa_perfil_dia_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento_tarefa_perfil_dia
    ADD CONSTRAINT planejamento_tarefa_perfil_dia_pkey PRIMARY KEY (tarefa_id, dia);


--
-- Name: planejamento_tarefa_perfil_semana planejamento_tarefa_perfil_semana_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento_tarefa_perfil_semana
    ADD CONSTRAINT planejamento_tarefa_perfil_semana_pkey PRIMARY KEY (tarefa_id, semana_segunda);


--
-- Name: planejamento_tarefa planejamento_tarefa_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento_tarefa
    ADD CONSTRAINT planejamento_tarefa_pkey PRIMARY KEY (id);


--
-- Name: planejamento_tarefa_wp planejamento_tarefa_wp_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento_tarefa_wp
    ADD CONSTRAINT planejamento_tarefa_wp_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_email_key UNIQUE (email);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: recurso recurso_obra_grupo_nome_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurso
    ADD CONSTRAINT recurso_obra_grupo_nome_key UNIQUE (obra_id, grupo, nome);


--
-- Name: recurso recurso_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurso
    ADD CONSTRAINT recurso_pkey PRIMARY KEY (id);


--
-- Name: recurso_preco recurso_preco_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurso_preco
    ADD CONSTRAINT recurso_preco_pkey PRIMARY KEY (id);


--
-- Name: servico_cpu_link servico_cpu_link_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servico_cpu_link
    ADD CONSTRAINT servico_cpu_link_pkey PRIMARY KEY (id);


--
-- Name: servico_cpu_link servico_cpu_link_servico_id_cpu_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servico_cpu_link
    ADD CONSTRAINT servico_cpu_link_servico_id_cpu_id_key UNIQUE (servico_id, cpu_id);


--
-- Name: servico_dependencia servico_dependencia_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servico_dependencia
    ADD CONSTRAINT servico_dependencia_pkey PRIMARY KEY (id);


--
-- Name: servico_dependencia servico_dependencia_predecessor_id_sucessor_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servico_dependencia
    ADD CONSTRAINT servico_dependencia_predecessor_id_sucessor_id_key UNIQUE (predecessor_id, sucessor_id);


--
-- Name: servico servico_obra_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servico
    ADD CONSTRAINT servico_obra_codigo_key UNIQUE (obra_id, codigo);


--
-- Name: servico_parametro servico_parametro_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servico_parametro
    ADD CONSTRAINT servico_parametro_pkey PRIMARY KEY (item_orcamentario_id);


--
-- Name: servico servico_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servico
    ADD CONSTRAINT servico_pkey PRIMARY KEY (id);


--
-- Name: transporte_local transporte_local_obra_id_nome_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transporte_local
    ADD CONSTRAINT transporte_local_obra_id_nome_key UNIQUE (obra_id, nome);


--
-- Name: transporte_local transporte_local_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transporte_local
    ADD CONSTRAINT transporte_local_pkey PRIMARY KEY (id);


--
-- Name: transporte_rota transporte_rota_origem_id_destino_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transporte_rota
    ADD CONSTRAINT transporte_rota_origem_id_destino_id_key UNIQUE (origem_id, destino_id);


--
-- Name: transporte_rota transporte_rota_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transporte_rota
    ADD CONSTRAINT transporte_rota_pkey PRIMARY KEY (id);


--
-- Name: trecho_quantidade_celula trecho_quantidade_celula_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trecho_quantidade_celula
    ADD CONSTRAINT trecho_quantidade_celula_pkey PRIMARY KEY (segmento_id, coluna_id);


--
-- Name: trecho_quantidade_coluna trecho_quantidade_coluna_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trecho_quantidade_coluna
    ADD CONSTRAINT trecho_quantidade_coluna_pkey PRIMARY KEY (id);


--
-- Name: trecho_quantidade_coluna trecho_quantidade_coluna_versao_id_item_orcamentario_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trecho_quantidade_coluna
    ADD CONSTRAINT trecho_quantidade_coluna_versao_id_item_orcamentario_id_key UNIQUE (versao_id, item_orcamentario_id);


--
-- Name: trecho_quantidade_mapeamento trecho_quantidade_mapeamento_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trecho_quantidade_mapeamento
    ADD CONSTRAINT trecho_quantidade_mapeamento_pkey PRIMARY KEY (obra_id, chave);


--
-- Name: trecho_quantidade_segmento trecho_quantidade_segmento_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trecho_quantidade_segmento
    ADD CONSTRAINT trecho_quantidade_segmento_pkey PRIMARY KEY (id);


--
-- Name: trecho_quantidade_template trecho_quantidade_template_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trecho_quantidade_template
    ADD CONSTRAINT trecho_quantidade_template_pkey PRIMARY KEY (id);


--
-- Name: trecho_quantidade_template trecho_quantidade_template_trecho_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trecho_quantidade_template
    ADD CONSTRAINT trecho_quantidade_template_trecho_id_key UNIQUE (trecho_id);


--
-- Name: trecho_quantidade_versao trecho_quantidade_versao_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trecho_quantidade_versao
    ADD CONSTRAINT trecho_quantidade_versao_pkey PRIMARY KEY (id);


--
-- Name: trecho_quantidade_versao trecho_quantidade_versao_template_id_numero_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trecho_quantidade_versao
    ADD CONSTRAINT trecho_quantidade_versao_template_id_numero_key UNIQUE (template_id, numero);


--
-- Name: viagem_ficha viagem_ficha_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.viagem_ficha
    ADD CONSTRAINT viagem_ficha_pkey PRIMARY KEY (id);


--
-- Name: viagem viagem_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.viagem
    ADD CONSTRAINT viagem_pkey PRIMARY KEY (id);


--
-- Name: idx_acomp_alerta_chave_aberto; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_acomp_alerta_chave_aberto ON public.acompanhamento_alerta USING btree (obra_id, chave) WHERE (status = 'aberto'::text);


--
-- Name: idx_acomp_alerta_criado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_acomp_alerta_criado ON public.acompanhamento_alerta USING btree (obra_id, criado_em DESC);


--
-- Name: idx_acomp_alerta_obra_chave; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_acomp_alerta_obra_chave ON public.acompanhamento_alerta USING btree (obra_id, chave);


--
-- Name: idx_acomp_alerta_obra_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_acomp_alerta_obra_status ON public.acompanhamento_alerta USING btree (obra_id, status, severidade);


--
-- Name: idx_acomp_alerta_obra_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_acomp_alerta_obra_tipo ON public.acompanhamento_alerta USING btree (obra_id, tipo);


--
-- Name: idx_acomp_foto_geo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_acomp_foto_geo ON public.acompanhamento_foto USING btree (obra_id) WHERE ((lat IS NOT NULL) AND (lng IS NOT NULL) AND (excluida_em IS NULL));


--
-- Name: idx_acomp_foto_obra_data; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_acomp_foto_obra_data ON public.acompanhamento_foto USING btree (obra_id, captured_at DESC);


--
-- Name: idx_acomp_foto_producao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_acomp_foto_producao ON public.acompanhamento_foto USING btree (producao_id);


--
-- Name: idx_acomp_foto_viva; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_acomp_foto_viva ON public.acompanhamento_foto USING btree (obra_id) WHERE (excluida_em IS NULL);


--
-- Name: idx_acomp_prod_importacao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_acomp_prod_importacao ON public.acompanhamento_producao USING btree (importacao_id) WHERE (importacao_id IS NOT NULL);


--
-- Name: idx_acomp_prod_mat; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_acomp_prod_mat ON public.acompanhamento_producao_material USING btree (producao_id);


--
-- Name: idx_acomp_prod_mat_recurso; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_acomp_prod_mat_recurso ON public.acompanhamento_producao_material USING btree (recurso_id) WHERE (recurso_id IS NOT NULL);


--
-- Name: idx_acomp_prod_obra_data; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_acomp_prod_obra_data ON public.acompanhamento_producao USING btree (obra_id, data DESC);


--
-- Name: idx_acomp_prod_obra_enc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_acomp_prod_obra_enc ON public.acompanhamento_producao USING btree (obra_id, encarregado_id);


--
-- Name: idx_acomp_prod_obra_equipe; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_acomp_prod_obra_equipe ON public.acompanhamento_producao USING btree (obra_id, equipe_id, data);


--
-- Name: idx_acomp_prod_obra_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_acomp_prod_obra_item ON public.acompanhamento_producao USING btree (obra_id, item_orcamentario_id, data);


--
-- Name: idx_acomp_prod_servico; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_acomp_prod_servico ON public.acompanhamento_producao USING btree (servico_id);


--
-- Name: idx_acomp_prod_trecho; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_acomp_prod_trecho ON public.acompanhamento_producao USING btree (trecho_id);


--
-- Name: idx_aditivo_item_aditivo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_aditivo_item_aditivo ON public.orcamento_aditivo_item USING btree (aditivo_id);


--
-- Name: idx_anexo_escopo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_anexo_escopo ON public.anexo USING btree (escopo, escopo_id);


--
-- Name: idx_anexo_obra; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_anexo_obra ON public.anexo USING btree (obra_id);


--
-- Name: idx_caldef_calendario; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_caldef_calendario ON public.calendario_definicao USING btree (calendario_id);


--
-- Name: idx_comentario_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comentario_item ON public.comentario_item USING btree (item_id, created_at DESC);


--
-- Name: idx_comentario_obra; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comentario_obra ON public.comentario_item USING btree (obra_id);


--
-- Name: idx_cpu_item_cpu; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cpu_item_cpu ON public.cpu_item USING btree (cpu_id, ordem);


--
-- Name: idx_cpu_item_grupo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cpu_item_grupo ON public.cpu_item USING btree (cpu_id, grupo);


--
-- Name: idx_cpu_item_recurso; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cpu_item_recurso ON public.cpu_item USING btree (recurso_id);


--
-- Name: idx_cpu_obra_nome; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cpu_obra_nome ON public.cpu USING btree (obra_id, nome);


--
-- Name: idx_encarregado_obra; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_encarregado_obra ON public.encarregado USING btree (obra_id) WHERE ativo;


--
-- Name: idx_equipe_encarregado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_equipe_encarregado ON public.equipe USING btree (encarregado_id) WHERE (encarregado_id IS NOT NULL);


--
-- Name: idx_equipe_is_sistema; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_equipe_is_sistema ON public.equipe USING btree (obra_id) WHERE is_sistema;


--
-- Name: idx_fleet_sync_empresa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fleet_sync_empresa ON public.fleet_sync_execucao USING btree (empresa_id, iniciado_em DESC);


--
-- Name: idx_frota_empresa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_frota_empresa ON public.frota_veiculo USING btree (empresa_id) WHERE ativo;


--
-- Name: idx_frota_fleet_obra; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_frota_fleet_obra ON public.frota_veiculo USING btree (fleet_obra_id) WHERE ativo;


--
-- Name: idx_item_orc_aloc_obra; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_item_orc_aloc_obra ON public.item_orc_alocacao USING btree (obra_id);


--
-- Name: idx_item_orc_aloc_receita; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_item_orc_aloc_receita ON public.item_orc_alocacao USING btree (receita_id);


--
-- Name: idx_item_orc_indireto; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_item_orc_indireto ON public.item_orcamentario USING btree (indireto_id);


--
-- Name: idx_item_orc_nivel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_item_orc_nivel ON public.item_orcamentario USING btree (obra_id, nivel);


--
-- Name: idx_item_orc_obra_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_item_orc_obra_parent ON public.item_orcamentario USING btree (obra_id, parent_id, ordem);


--
-- Name: idx_item_orc_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_item_orc_parent ON public.item_orcamentario USING btree (parent_id);


--
-- Name: idx_item_orc_servico; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_item_orc_servico ON public.item_orcamentario USING btree (servico_id);


--
-- Name: idx_item_orc_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_item_orc_tipo ON public.item_orcamentario USING btree (obra_id, tipo);


--
-- Name: idx_lb_premissa_plan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lb_premissa_plan ON public.planejamento_lb_premissa USING btree (planejamento_id);


--
-- Name: idx_local_plan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_local_plan ON public.planejamento_tarefa_local USING btree (planejamento_id);


--
-- Name: idx_local_tarefa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_local_tarefa ON public.planejamento_tarefa_local USING btree (tarefa_id);


--
-- Name: idx_local_trecho; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_local_trecho ON public.planejamento_tarefa_local USING btree (trecho_id);


--
-- Name: idx_marco_plan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_marco_plan ON public.planejamento_marco USING btree (planejamento_id);


--
-- Name: idx_mcp_token_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mcp_token_user ON public.mcp_token USING btree (user_id);


--
-- Name: idx_memoria_obra; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_memoria_obra ON public.memoria_calculo_item USING btree (obra_id);


--
-- Name: idx_obra_fleet_obra_fleet; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_obra_fleet_obra_fleet ON public.obra_fleet_obra USING btree (fleet_obra_id);


--
-- Name: idx_obra_perm_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_obra_perm_user ON public.obra_permissoes USING btree (user_id);


--
-- Name: idx_obra_trecho_obra; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_obra_trecho_obra ON public.obra_trecho USING btree (obra_id, ordem);


--
-- Name: idx_plan_dep_origem; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plan_dep_origem ON public.planejamento_dependencia USING btree (planejamento_id, origem);


--
-- Name: idx_plan_dep_suc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plan_dep_suc ON public.planejamento_dependencia USING btree (sucessora_id);


--
-- Name: idx_plan_tar_eq_equipe; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plan_tar_eq_equipe ON public.planejamento_tarefa_equipe USING btree (equipe_id);


--
-- Name: idx_plan_tarefa_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plan_tarefa_item ON public.planejamento_tarefa USING btree (item_orcamentario_id);


--
-- Name: idx_plan_tarefa_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plan_tarefa_parent ON public.planejamento_tarefa USING btree (parent_id);


--
-- Name: idx_plan_tarefa_plan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plan_tarefa_plan ON public.planejamento_tarefa USING btree (planejamento_id);


--
-- Name: idx_plan_tarefa_tipo_no; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plan_tarefa_tipo_no ON public.planejamento_tarefa USING btree (tipo_no);


--
-- Name: idx_profiles_empresa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_empresa ON public.profiles USING btree (empresa_id);


--
-- Name: idx_profiles_engenheiro; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_engenheiro ON public.profiles USING btree (engenheiro_id);


--
-- Name: idx_profiles_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_role ON public.profiles USING btree (role);


--
-- Name: idx_pti_taxa_regime; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pti_taxa_regime ON public.planejamento_tarefa_indireto USING btree (taxa_regime_id);


--
-- Name: idx_ptps_semana; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ptps_semana ON public.planejamento_tarefa_perfil_semana USING btree (semana_segunda);


--
-- Name: idx_reajuste_item_receita; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reajuste_item_receita ON public.orcamento_reajuste_item USING btree (receita_id);


--
-- Name: idx_recurso_preco_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recurso_preco_created ON public.recurso_preco USING btree (recurso_id, created_at DESC);


--
-- Name: idx_recurso_preco_recurso; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recurso_preco_recurso ON public.recurso_preco USING btree (recurso_id, vigencia_inicio DESC);


--
-- Name: idx_servdep_obra; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_servdep_obra ON public.servico_dependencia USING btree (obra_id);


--
-- Name: idx_servico_cpu_link_cpu; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_servico_cpu_link_cpu ON public.servico_cpu_link USING btree (cpu_id);


--
-- Name: idx_servico_cpu_link_servico; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_servico_cpu_link_servico ON public.servico_cpu_link USING btree (servico_id, ordem);


--
-- Name: idx_servico_parametro_obra; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_servico_parametro_obra ON public.servico_parametro USING btree (obra_id);


--
-- Name: idx_servico_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_servico_parent ON public.servico USING btree (parent_id);


--
-- Name: idx_tqc_coluna; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tqc_coluna ON public.trecho_quantidade_celula USING btree (coluna_id);


--
-- Name: idx_tqs_versao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tqs_versao ON public.trecho_quantidade_segmento USING btree (versao_id, ordem);


--
-- Name: idx_viagem_chave; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_viagem_chave ON public.viagem USING btree (obra_id, data, item_orcamentario_id);


--
-- Name: idx_viagem_ficha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_viagem_ficha ON public.viagem USING btree (ficha_id, ordem);


--
-- Name: idx_viagem_ficha_obra_data; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_viagem_ficha_obra_data ON public.viagem_ficha USING btree (obra_id, data DESC);


--
-- Name: idx_wp_plan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wp_plan ON public.planejamento_tarefa_wp USING btree (planejamento_id);


--
-- Name: idx_wp_tarefa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wp_tarefa ON public.planejamento_tarefa_wp USING btree (tarefa_id);


--
-- Name: uq_acomp_foto_app_uuid; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_acomp_foto_app_uuid ON public.acompanhamento_foto USING btree (app_uuid) WHERE (app_uuid IS NOT NULL);


--
-- Name: uq_acomp_prod_app_uuid; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_acomp_prod_app_uuid ON public.acompanhamento_producao USING btree (app_uuid) WHERE (app_uuid IS NOT NULL);


--
-- Name: uq_acomp_prod_viagens; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_acomp_prod_viagens ON public.acompanhamento_producao USING btree (obra_id, data, item_orcamentario_id, COALESCE(trecho_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(equipe_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(encarregado_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE (origem = 'viagens'::text);


--
-- Name: uq_calendario_padrao; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_calendario_padrao ON public.calendario USING btree (obra_id) WHERE padrao;


--
-- Name: uq_cpu_vigente; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_cpu_vigente ON public.cpu USING btree (servico_id) WHERE (is_vigente = true);


--
-- Name: uq_frota_fleet_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_frota_fleet_id ON public.frota_veiculo USING btree (empresa_id, fleet_id) WHERE (fleet_id IS NOT NULL);


--
-- Name: uq_mcp_token_refresh; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_mcp_token_refresh ON public.mcp_token USING btree (refresh_hash) WHERE (refresh_hash IS NOT NULL);


--
-- Name: uq_planejamento_edicao; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_planejamento_edicao ON public.planejamento USING btree (obra_id) WHERE (NOT is_baseline);


--
-- Name: uq_planejamento_vigente; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_planejamento_vigente ON public.planejamento USING btree (obra_id) WHERE vigente;


--
-- Name: uq_recurso_limite; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_recurso_limite ON public.planejamento_recurso_limite USING btree (planejamento_id, recurso_id, COALESCE(grupo_id, '00000000-0000-0000-0000-000000000000'::uuid));


--
-- Name: uq_recurso_obra_codigo; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_recurso_obra_codigo ON public.recurso USING btree (obra_id, codigo) WHERE (codigo IS NOT NULL);


--
-- Name: uq_recurso_preco_vigente; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_recurso_preco_vigente ON public.recurso_preco USING btree (recurso_id) WHERE is_vigente;


--
-- Name: uq_tqv_atual; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_tqv_atual ON public.trecho_quantidade_versao USING btree (template_id) WHERE is_atual;


--
-- Name: acompanhamento_foto trg_acomp_foto_before_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_acomp_foto_before_insert BEFORE INSERT ON public.acompanhamento_foto FOR EACH ROW EXECUTE FUNCTION public.fn_acomp_foto_before_insert();


--
-- Name: acompanhamento_foto trg_acomp_foto_update_whitelist; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_acomp_foto_update_whitelist BEFORE UPDATE ON public.acompanhamento_foto FOR EACH ROW EXECUTE FUNCTION public.fn_acomp_foto_update_whitelist();


--
-- Name: acompanhamento_producao trg_acomp_prod_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_acomp_prod_before_write BEFORE INSERT OR UPDATE ON public.acompanhamento_producao FOR EACH ROW EXECUTE FUNCTION public.fn_acomp_prod_before_write();


--
-- Name: acompanhamento_producao trg_acomp_prod_local; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_acomp_prod_local BEFORE INSERT OR UPDATE ON public.acompanhamento_producao FOR EACH ROW EXECUTE FUNCTION public.fn_acomp_prod_local();


--
-- Name: acompanhamento_producao_material trg_acomp_prod_mat_antes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_acomp_prod_mat_antes BEFORE INSERT OR UPDATE ON public.acompanhamento_producao_material FOR EACH ROW EXECUTE FUNCTION public.fn_acomp_prod_mat_antes();


--
-- Name: acompanhamento_producao trg_acomp_prod_viagens_equipe; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_acomp_prod_viagens_equipe BEFORE UPDATE OF equipe_id, encarregado_id ON public.acompanhamento_producao FOR EACH ROW EXECUTE FUNCTION public.fn_acomp_prod_viagens_equipe();


--
-- Name: orcamento_aditivo trg_aditivo_before; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_aditivo_before BEFORE INSERT OR DELETE OR UPDATE ON public.orcamento_aditivo FOR EACH ROW EXECUTE FUNCTION public.fn_aditivo_before();


--
-- Name: orcamento_aditivo_item trg_aditivo_item_before; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_aditivo_item_before BEFORE INSERT OR DELETE OR UPDATE ON public.orcamento_aditivo_item FOR EACH ROW EXECUTE FUNCTION public.fn_aditivo_item_before();


--
-- Name: acompanhamento_alerta trg_alerta_eng_whitelist; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_alerta_eng_whitelist BEFORE UPDATE ON public.acompanhamento_alerta FOR EACH ROW EXECUTE FUNCTION public.fn_alerta_eng_whitelist();


--
-- Name: planejamento_dependencia trg_baseline_imutavel_dep; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_baseline_imutavel_dep BEFORE DELETE OR UPDATE ON public.planejamento_dependencia FOR EACH ROW EXECUTE FUNCTION public.fn_planejamento_baseline_imutavel();


--
-- Name: planejamento_tarefa_equipe trg_baseline_imutavel_equipe; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_baseline_imutavel_equipe BEFORE DELETE OR UPDATE ON public.planejamento_tarefa_equipe FOR EACH ROW EXECUTE FUNCTION public.fn_planejamento_baseline_imutavel();


--
-- Name: planejamento_tarefa trg_baseline_imutavel_tarefa; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_baseline_imutavel_tarefa BEFORE DELETE OR UPDATE OF item_orcamentario_id, notas, ordem, tipo_no, parent_id, nivel, quantidade_alocada, codigo_eap, nome_custom, prioridade, asap, inicio_dia, sentido, restricao_inicio, restricao_inicio_em, restricao_fim, restricao_fim_em, coef_producao, qtd_equipes, derivar_predecessoras, inicio_em ON public.planejamento_tarefa FOR EACH ROW EXECUTE FUNCTION public.fn_planejamento_baseline_imutavel();


--
-- Name: cpu trg_cadeia_trava; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cadeia_trava BEFORE INSERT OR DELETE OR UPDATE ON public.cpu FOR EACH ROW EXECUTE FUNCTION public.fn_cadeia_trava();


--
-- Name: cpu_item trg_cadeia_trava; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cadeia_trava BEFORE INSERT OR DELETE OR UPDATE ON public.cpu_item FOR EACH ROW EXECUTE FUNCTION public.fn_cadeia_trava();


--
-- Name: indireto_item trg_cadeia_trava; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cadeia_trava BEFORE INSERT OR DELETE OR UPDATE ON public.indireto_item FOR EACH ROW EXECUTE FUNCTION public.fn_cadeia_trava();


--
-- Name: item_orc_alocacao trg_cadeia_trava; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cadeia_trava BEFORE INSERT OR DELETE OR UPDATE ON public.item_orc_alocacao FOR EACH ROW EXECUTE FUNCTION public.fn_cadeia_trava();


--
-- Name: item_orcamentario trg_cadeia_trava; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cadeia_trava BEFORE INSERT OR DELETE OR UPDATE ON public.item_orcamentario FOR EACH ROW EXECUTE FUNCTION public.fn_cadeia_trava();


--
-- Name: obra_trecho trg_cadeia_trava; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cadeia_trava BEFORE INSERT OR DELETE OR UPDATE ON public.obra_trecho FOR EACH ROW EXECUTE FUNCTION public.fn_cadeia_trava();


--
-- Name: recurso trg_cadeia_trava; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cadeia_trava BEFORE INSERT OR DELETE OR UPDATE ON public.recurso FOR EACH ROW EXECUTE FUNCTION public.fn_cadeia_trava();


--
-- Name: recurso_preco trg_cadeia_trava; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cadeia_trava BEFORE INSERT OR DELETE OR UPDATE ON public.recurso_preco FOR EACH ROW EXECUTE FUNCTION public.fn_cadeia_trava();


--
-- Name: servico trg_cadeia_trava; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cadeia_trava BEFORE INSERT OR DELETE OR UPDATE ON public.servico FOR EACH ROW EXECUTE FUNCTION public.fn_cadeia_trava();


--
-- Name: servico_cpu_link trg_cadeia_trava; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cadeia_trava BEFORE INSERT OR DELETE OR UPDATE ON public.servico_cpu_link FOR EACH ROW EXECUTE FUNCTION public.fn_cadeia_trava();


--
-- Name: calendario_definicao trg_caldef_marca; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_caldef_marca AFTER INSERT OR DELETE OR UPDATE ON public.calendario_definicao FOR EACH ROW EXECUTE FUNCTION public.fn_calendario_marca_planos();


--
-- Name: calendario trg_calendario_marca; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_calendario_marca AFTER INSERT OR DELETE OR UPDATE ON public.calendario FOR EACH ROW EXECUTE FUNCTION public.fn_calendario_marca_planos();


--
-- Name: calendario trg_calendario_padrao; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_calendario_padrao BEFORE INSERT OR DELETE OR UPDATE OF padrao ON public.calendario FOR EACH ROW EXECUTE FUNCTION public.fn_calendario_padrao();


--
-- Name: calendario trg_calendario_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_calendario_touch BEFORE UPDATE ON public.calendario FOR EACH ROW EXECUTE FUNCTION public.fn_touch_updated_at();


--
-- Name: comentario_item trg_comentario_obra_calc; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_comentario_obra_calc BEFORE INSERT ON public.comentario_item FOR EACH ROW EXECUTE FUNCTION public.fn_comentario_obra_calc();


--
-- Name: comentario_item trg_comentario_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_comentario_touch BEFORE UPDATE ON public.comentario_item FOR EACH ROW EXECUTE FUNCTION public.fn_comentario_touch();


--
-- Name: cpu trg_cpu_demarcar_outras; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cpu_demarcar_outras BEFORE INSERT OR UPDATE OF is_vigente, servico_id ON public.cpu FOR EACH ROW EXECUTE FUNCTION public.fn_cpu_demarcar_outras();


--
-- Name: cpu_item trg_cpu_item_calc; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cpu_item_calc BEFORE INSERT OR UPDATE ON public.cpu_item FOR EACH ROW EXECUTE FUNCTION public.fn_cpu_item_calc();


--
-- Name: cpu_item trg_cpu_item_propagate_iud; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cpu_item_propagate_iud AFTER INSERT OR DELETE OR UPDATE ON public.cpu_item FOR EACH ROW EXECUTE FUNCTION public.fn_cpu_item_propagate();


--
-- Name: cpu trg_cpu_producao_changed; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cpu_producao_changed AFTER UPDATE OF producao_diaria_qtde ON public.cpu FOR EACH ROW EXECUTE FUNCTION public.fn_cpu_producao_changed();


--
-- Name: planejamento_dependencia trg_dep_mesmo_planejamento; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_dep_mesmo_planejamento BEFORE INSERT OR UPDATE OF predecessora_id, sucessora_id, planejamento_id ON public.planejamento_dependencia FOR EACH ROW EXECUTE FUNCTION public.fn_dep_mesmo_planejamento();


--
-- Name: encargos_sociais_regime trg_encargos_total_calc; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_encargos_total_calc BEFORE INSERT OR UPDATE ON public.encargos_sociais_regime FOR EACH ROW EXECUTE FUNCTION public.fn_encargos_total_calc();


--
-- Name: encarregado trg_encarregado_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_encarregado_touch BEFORE UPDATE ON public.encarregado FOR EACH ROW EXECUTE FUNCTION public.fn_touch_updated_at();


--
-- Name: equipe trg_equipe_encarregado_obra; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_equipe_encarregado_obra BEFORE INSERT OR UPDATE OF encarregado_id, obra_id ON public.equipe FOR EACH ROW EXECUTE FUNCTION public.fn_equipe_encarregado_obra();


--
-- Name: frota_veiculo trg_frota_fleethub_protege; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_frota_fleethub_protege BEFORE INSERT OR DELETE OR UPDATE ON public.frota_veiculo FOR EACH ROW EXECUTE FUNCTION public.fn_frota_fleethub_protege();


--
-- Name: frota_veiculo trg_frota_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_frota_touch BEFORE UPDATE ON public.frota_veiculo FOR EACH ROW EXECUTE FUNCTION public.fn_touch_updated_at();


--
-- Name: item_orc_alocacao trg_item_orc_aloc_validar; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_item_orc_aloc_validar BEFORE INSERT OR UPDATE ON public.item_orc_alocacao FOR EACH ROW EXECUTE FUNCTION public.fn_item_orc_aloc_validar();


--
-- Name: item_orcamentario trg_item_orc_bloqueia_desvinculo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_item_orc_bloqueia_desvinculo BEFORE UPDATE OF servico_id, indireto_id ON public.item_orcamentario FOR EACH ROW EXECUTE FUNCTION public.fn_item_orc_bloqueia_desvinculo();


--
-- Name: item_orcamentario trg_item_orc_bloqueia_exclusao_alocada; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_item_orc_bloqueia_exclusao_alocada BEFORE DELETE ON public.item_orcamentario FOR EACH ROW EXECUTE FUNCTION public.fn_item_orc_bloqueia_exclusao_alocada();


--
-- Name: item_orcamentario trg_item_orc_codigo_gerar; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_item_orc_codigo_gerar BEFORE INSERT ON public.item_orcamentario FOR EACH ROW EXECUTE FUNCTION public.fn_item_orc_codigo_gerar();


--
-- Name: item_orcamentario trg_item_orc_linha_calc; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_item_orc_linha_calc BEFORE INSERT OR UPDATE ON public.item_orcamentario FOR EACH ROW EXECUTE FUNCTION public.fn_item_orc_linha_calc();


--
-- Name: item_orcamentario trg_item_orc_nivel_calc; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_item_orc_nivel_calc BEFORE INSERT OR UPDATE OF parent_id, obra_id ON public.item_orcamentario FOR EACH ROW EXECUTE FUNCTION public.fn_item_orc_nivel_calc();


--
-- Name: item_orcamentario trg_item_orc_parent_tipo_check; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_item_orc_parent_tipo_check BEFORE INSERT OR UPDATE OF parent_id, tipo ON public.item_orcamentario FOR EACH ROW EXECUTE FUNCTION public.fn_item_orc_parent_tipo_check();


--
-- Name: planejamento_recurso_limite trg_lb_imutavel_limite; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_lb_imutavel_limite BEFORE INSERT OR DELETE OR UPDATE ON public.planejamento_recurso_limite FOR EACH ROW EXECUTE FUNCTION public.fn_lb_imutavel_generica();


--
-- Name: planejamento_tarefa_local trg_lb_imutavel_local; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_lb_imutavel_local BEFORE INSERT OR DELETE OR UPDATE ON public.planejamento_tarefa_local FOR EACH ROW EXECUTE FUNCTION public.fn_lb_imutavel_generica();


--
-- Name: planejamento_marco trg_lb_imutavel_marco; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_lb_imutavel_marco BEFORE INSERT OR DELETE OR UPDATE ON public.planejamento_marco FOR EACH ROW EXECUTE FUNCTION public.fn_lb_imutavel_generica();


--
-- Name: planejamento_tarefa_perfil_dia trg_lb_imutavel_perfil_dia; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_lb_imutavel_perfil_dia BEFORE INSERT OR DELETE OR UPDATE ON public.planejamento_tarefa_perfil_dia FOR EACH ROW EXECUTE FUNCTION public.fn_lb_imutavel_generica();


--
-- Name: planejamento_tarefa_wp trg_lb_imutavel_wp; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_lb_imutavel_wp BEFORE INSERT OR DELETE OR UPDATE ON public.planejamento_tarefa_wp FOR EACH ROW EXECUTE FUNCTION public.fn_lb_imutavel_generica();


--
-- Name: planejamento_recurso_limite trg_limite_antes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_limite_antes BEFORE INSERT OR UPDATE ON public.planejamento_recurso_limite FOR EACH ROW EXECUTE FUNCTION public.fn_limite_antes();


--
-- Name: planejamento_tarefa_local trg_local_antes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_local_antes BEFORE INSERT OR UPDATE ON public.planejamento_tarefa_local FOR EACH ROW EXECUTE FUNCTION public.fn_local_antes();


--
-- Name: planejamento_tarefa_local trg_local_soma; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_local_soma AFTER INSERT OR DELETE OR UPDATE ON public.planejamento_tarefa_local FOR EACH ROW EXECUTE FUNCTION public.fn_local_soma();


--
-- Name: planejamento_tarefa_local trg_local_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_local_touch BEFORE UPDATE ON public.planejamento_tarefa_local FOR EACH ROW EXECUTE FUNCTION public.fn_touch_updated_at();


--
-- Name: memoria_calculo_item trg_memoria_obra_calc; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_memoria_obra_calc BEFORE INSERT OR UPDATE ON public.memoria_calculo_item FOR EACH ROW EXECUTE FUNCTION public.fn_memoria_obra_calc();


--
-- Name: obras trg_obra_calendario_default; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_obra_calendario_default AFTER INSERT ON public.obras FOR EACH ROW EXECUTE FUNCTION public.fn_obra_calendario_default();


--
-- Name: obra_fleet_obra trg_obra_fleet_obra_antes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_obra_fleet_obra_antes BEFORE INSERT OR UPDATE ON public.obra_fleet_obra FOR EACH ROW EXECUTE FUNCTION public.fn_obra_fleet_obra_antes();


--
-- Name: obra_trecho trg_obra_trecho_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_obra_trecho_touch BEFORE UPDATE ON public.obra_trecho FOR EACH ROW EXECUTE FUNCTION public.fn_touch_updated_at();


--
-- Name: item_orc_alocacao trg_orc_marca_alocacao; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_orc_marca_alocacao AFTER INSERT OR DELETE OR UPDATE ON public.item_orc_alocacao FOR EACH ROW EXECUTE FUNCTION public.fn_orc_marca_item();


--
-- Name: cpu trg_orc_marca_cpu; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_orc_marca_cpu AFTER INSERT OR DELETE OR UPDATE ON public.cpu FOR EACH ROW EXECUTE FUNCTION public.fn_orc_marca_cpu();


--
-- Name: indireto_item trg_orc_marca_indireto; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_orc_marca_indireto AFTER INSERT OR DELETE OR UPDATE OF valor_total, distribuicao_perc ON public.indireto_item FOR EACH ROW EXECUTE FUNCTION public.fn_orc_marca_item();


--
-- Name: item_orcamentario trg_orc_marca_item; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_orc_marca_item AFTER INSERT OR DELETE OR UPDATE OF quantidade, venda_unitaria, parent_id, tipo, qtd_ref_modo, quantidade_referencia, servico_id, indireto_id ON public.item_orcamentario FOR EACH ROW EXECUTE FUNCTION public.fn_orc_marca_item();


--
-- Name: servico_cpu_link trg_orc_marca_link; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_orc_marca_link AFTER INSERT OR DELETE OR UPDATE ON public.servico_cpu_link FOR EACH ROW EXECUTE FUNCTION public.fn_orc_marca_servico();


--
-- Name: servico trg_orc_marca_servico_prod; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_orc_marca_servico_prod AFTER UPDATE OF producao_diaria_qtde, producao_diaria_unidade ON public.servico FOR EACH ROW EXECUTE FUNCTION public.fn_orc_marca_servico_prod();


--
-- Name: encargos_sociais_regime trg_orc_marca_taxa; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_orc_marca_taxa AFTER INSERT OR DELETE OR UPDATE ON public.encargos_sociais_regime FOR EACH ROW EXECUTE FUNCTION public.fn_orc_marca_taxa();


--
-- Name: orcamento_recalculo_pendente trg_orc_recalculo_executar; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER trg_orc_recalculo_executar AFTER INSERT ON public.orcamento_recalculo_pendente DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.fn_orc_recalculo_executar();


--
-- Name: planejamento_tarefa trg_plan_tarefa_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_plan_tarefa_updated_at BEFORE UPDATE ON public.planejamento_tarefa FOR EACH ROW EXECUTE FUNCTION public.fn_touch_updated_at();


--
-- Name: planejamento trg_planejamento_estado; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_planejamento_estado BEFORE INSERT OR DELETE OR UPDATE ON public.planejamento FOR EACH ROW EXECUTE FUNCTION public.fn_planejamento_estado();


--
-- Name: planejamento trg_planejamento_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_planejamento_updated_at BEFORE UPDATE ON public.planejamento FOR EACH ROW EXECUTE FUNCTION public.fn_touch_updated_at();


--
-- Name: planejamento trg_plano_rev_atributos; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_plano_rev_atributos BEFORE UPDATE ON public.planejamento FOR EACH ROW EXECUTE FUNCTION public.fn_plano_rev_atributos();


--
-- Name: obra_produtividade_mes trg_produtividade_mes_marca; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_produtividade_mes_marca AFTER INSERT OR DELETE OR UPDATE ON public.obra_produtividade_mes FOR EACH ROW EXECUTE FUNCTION public.fn_calendario_marca_planos();


--
-- Name: profiles trg_profiles_protege; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_profiles_protege BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.fn_profiles_protege();


--
-- Name: planejamento_tarefa_indireto trg_pti_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_pti_touch BEFORE UPDATE ON public.planejamento_tarefa_indireto FOR EACH ROW EXECUTE FUNCTION public.fn_pti_touch_updated_at();


--
-- Name: planejamento_tarefa_perfil_semana trg_ptps_baseline_imutavel; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ptps_baseline_imutavel BEFORE INSERT OR DELETE OR UPDATE ON public.planejamento_tarefa_perfil_semana FOR EACH ROW EXECUTE FUNCTION public.fn_ptps_baseline_imutavel();


--
-- Name: planejamento_tarefa_perfil_semana trg_ptps_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ptps_updated_at BEFORE UPDATE ON public.planejamento_tarefa_perfil_semana FOR EACH ROW EXECUTE FUNCTION public.fn_touch_updated_at();


--
-- Name: orcamento_reajuste trg_reajuste_before; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_reajuste_before BEFORE INSERT OR DELETE OR UPDATE ON public.orcamento_reajuste FOR EACH ROW EXECUTE FUNCTION public.fn_reajuste_before();


--
-- Name: orcamento_reajuste_grupo trg_reajuste_grupo_before; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_reajuste_grupo_before BEFORE INSERT OR DELETE OR UPDATE ON public.orcamento_reajuste_grupo FOR EACH ROW EXECUTE FUNCTION public.fn_reajuste_filho_before();


--
-- Name: orcamento_reajuste_item trg_reajuste_item_before; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_reajuste_item_before BEFORE INSERT OR DELETE OR UPDATE ON public.orcamento_reajuste_item FOR EACH ROW EXECUTE FUNCTION public.fn_reajuste_filho_before();


--
-- Name: recurso_preco trg_recurso_preco_propagate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_recurso_preco_propagate AFTER INSERT OR DELETE OR UPDATE ON public.recurso_preco FOR EACH ROW EXECUTE FUNCTION public.fn_recurso_preco_propagate();


--
-- Name: planejamento_dependencia trg_rev_dep; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_rev_dep AFTER INSERT OR DELETE OR UPDATE ON public.planejamento_dependencia FOR EACH ROW EXECUTE FUNCTION public.fn_plano_dados_rev();


--
-- Name: planejamento_tarefa_equipe trg_rev_equipe; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_rev_equipe AFTER INSERT OR DELETE OR UPDATE ON public.planejamento_tarefa_equipe FOR EACH ROW EXECUTE FUNCTION public.fn_plano_dados_rev();


--
-- Name: planejamento_recurso_limite trg_rev_limite; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_rev_limite AFTER INSERT OR DELETE OR UPDATE ON public.planejamento_recurso_limite FOR EACH ROW EXECUTE FUNCTION public.fn_plano_dados_rev();


--
-- Name: planejamento_tarefa_local trg_rev_local; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_rev_local AFTER INSERT OR DELETE OR UPDATE ON public.planejamento_tarefa_local FOR EACH ROW EXECUTE FUNCTION public.fn_plano_dados_rev();


--
-- Name: planejamento_marco trg_rev_marco; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_rev_marco AFTER INSERT OR DELETE OR UPDATE ON public.planejamento_marco FOR EACH ROW EXECUTE FUNCTION public.fn_plano_dados_rev();


--
-- Name: planejamento_tarefa trg_rev_tarefa; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_rev_tarefa AFTER INSERT OR DELETE OR UPDATE ON public.planejamento_tarefa FOR EACH ROW EXECUTE FUNCTION public.fn_plano_dados_rev();


--
-- Name: servico_dependencia trg_servdep_antes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_servdep_antes BEFORE INSERT OR UPDATE ON public.servico_dependencia FOR EACH ROW EXECUTE FUNCTION public.fn_servdep_antes();


--
-- Name: servico_dependencia trg_servdep_marca; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_servdep_marca AFTER INSERT OR DELETE OR UPDATE ON public.servico_dependencia FOR EACH ROW EXECUTE FUNCTION public.fn_calendario_marca_planos();


--
-- Name: servico_cpu_link trg_servico_cpu_link_mesma_obra; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_servico_cpu_link_mesma_obra BEFORE INSERT OR UPDATE OF servico_id, cpu_id ON public.servico_cpu_link FOR EACH ROW EXECUTE FUNCTION public.fn_servico_cpu_link_mesma_obra();


--
-- Name: servico_cpu_link trg_servico_cpu_link_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_servico_cpu_link_touch BEFORE UPDATE ON public.servico_cpu_link FOR EACH ROW EXECUTE FUNCTION public.fn_touch_updated_at();


--
-- Name: servico trg_servico_nivel_calc; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_servico_nivel_calc BEFORE INSERT OR UPDATE OF parent_id, obra_id ON public.servico FOR EACH ROW EXECUTE FUNCTION public.fn_servico_nivel_calc();


--
-- Name: servico_parametro trg_servico_parametro_antes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_servico_parametro_antes BEFORE INSERT OR UPDATE ON public.servico_parametro FOR EACH ROW EXECUTE FUNCTION public.fn_servico_parametro_antes();


--
-- Name: planejamento_tarefa trg_tarefa_limite_servico; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_tarefa_limite_servico BEFORE INSERT OR UPDATE ON public.planejamento_tarefa FOR EACH ROW EXECUTE FUNCTION public.fn_tarefa_limite_servico();


--
-- Name: planejamento_tarefa trg_tarefa_so_aceita_servico_grupo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_tarefa_so_aceita_servico_grupo BEFORE INSERT OR UPDATE OF item_orcamentario_id, planejamento_id, tipo_no ON public.planejamento_tarefa FOR EACH ROW EXECUTE FUNCTION public.fn_tarefa_so_aceita_servico_grupo();


--
-- Name: planejamento_tarefa trg_tarefa_validar_nivel; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_tarefa_validar_nivel BEFORE INSERT OR UPDATE OF parent_id, nivel, tipo_no, planejamento_id ON public.planejamento_tarefa FOR EACH ROW EXECUTE FUNCTION public.fn_tarefa_validar_nivel();


--
-- Name: transporte_local trg_transporte_local_antes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_transporte_local_antes BEFORE INSERT OR UPDATE ON public.transporte_local FOR EACH ROW EXECUTE FUNCTION public.fn_transporte_local_antes();


--
-- Name: transporte_rota trg_transporte_rota_antes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_transporte_rota_antes BEFORE INSERT OR UPDATE ON public.transporte_rota FOR EACH ROW EXECUTE FUNCTION public.fn_transporte_rota_antes();


--
-- Name: obra_trecho trg_trecho_antes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_trecho_antes BEFORE INSERT OR UPDATE ON public.obra_trecho FOR EACH ROW EXECUTE FUNCTION public.fn_trecho_antes();


--
-- Name: obra_trecho trg_trecho_marca_planos; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_trecho_marca_planos AFTER UPDATE OF comprimento_m, tipo ON public.obra_trecho FOR EACH ROW EXECUTE FUNCTION public.fn_calendario_marca_planos();


--
-- Name: viagem trg_viagem_antes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_viagem_antes BEFORE INSERT OR UPDATE ON public.viagem FOR EACH ROW EXECUTE FUNCTION public.fn_viagem_antes();


--
-- Name: viagem trg_viagem_carregador; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_viagem_carregador BEFORE INSERT OR UPDATE OF carregador_id ON public.viagem FOR EACH ROW EXECUTE FUNCTION public.fn_viagem_carregador();


--
-- Name: viagem trg_viagem_depois; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_viagem_depois AFTER INSERT OR DELETE OR UPDATE ON public.viagem FOR EACH ROW EXECUTE FUNCTION public.fn_viagem_depois();


--
-- Name: viagem trg_viagem_equipe; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_viagem_equipe BEFORE INSERT OR UPDATE ON public.viagem FOR EACH ROW EXECUTE FUNCTION public.fn_viagem_equipe_da_ficha();


--
-- Name: viagem_ficha trg_viagem_ficha_antes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_viagem_ficha_antes BEFORE INSERT OR UPDATE ON public.viagem_ficha FOR EACH ROW EXECUTE FUNCTION public.fn_viagem_ficha_antes();


--
-- Name: viagem_ficha trg_viagem_ficha_depois; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_viagem_ficha_depois AFTER UPDATE OF data, equipe_id, encarregado_id ON public.viagem_ficha FOR EACH ROW EXECUTE FUNCTION public.fn_viagem_ficha_depois();


--
-- Name: acompanhamento_alerta acompanhamento_alerta_obra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acompanhamento_alerta
    ADD CONSTRAINT acompanhamento_alerta_obra_id_fkey FOREIGN KEY (obra_id) REFERENCES public.obras(id) ON DELETE CASCADE;


--
-- Name: acompanhamento_foto acompanhamento_foto_encarregado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acompanhamento_foto
    ADD CONSTRAINT acompanhamento_foto_encarregado_id_fkey FOREIGN KEY (encarregado_id) REFERENCES public.encarregado(id) ON DELETE SET NULL;


--
-- Name: acompanhamento_foto acompanhamento_foto_enviado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acompanhamento_foto
    ADD CONSTRAINT acompanhamento_foto_enviado_por_fkey FOREIGN KEY (enviado_por) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: acompanhamento_foto acompanhamento_foto_excluida_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acompanhamento_foto
    ADD CONSTRAINT acompanhamento_foto_excluida_por_fkey FOREIGN KEY (excluida_por) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: acompanhamento_foto acompanhamento_foto_item_orcamentario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acompanhamento_foto
    ADD CONSTRAINT acompanhamento_foto_item_orcamentario_id_fkey FOREIGN KEY (item_orcamentario_id) REFERENCES public.item_orcamentario(id) ON DELETE SET NULL;


--
-- Name: acompanhamento_foto acompanhamento_foto_obra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acompanhamento_foto
    ADD CONSTRAINT acompanhamento_foto_obra_id_fkey FOREIGN KEY (obra_id) REFERENCES public.obras(id) ON DELETE CASCADE;


--
-- Name: acompanhamento_foto acompanhamento_foto_producao_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acompanhamento_foto
    ADD CONSTRAINT acompanhamento_foto_producao_id_fkey FOREIGN KEY (producao_id) REFERENCES public.acompanhamento_producao(id) ON DELETE SET NULL;


--
-- Name: acompanhamento_producao acompanhamento_producao_criado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acompanhamento_producao
    ADD CONSTRAINT acompanhamento_producao_criado_por_fkey FOREIGN KEY (criado_por) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: acompanhamento_producao acompanhamento_producao_encarregado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acompanhamento_producao
    ADD CONSTRAINT acompanhamento_producao_encarregado_id_fkey FOREIGN KEY (encarregado_id) REFERENCES public.encarregado(id) ON DELETE SET NULL;


--
-- Name: acompanhamento_producao acompanhamento_producao_equipe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acompanhamento_producao
    ADD CONSTRAINT acompanhamento_producao_equipe_id_fkey FOREIGN KEY (equipe_id) REFERENCES public.equipe(id) ON DELETE SET NULL;


--
-- Name: acompanhamento_producao acompanhamento_producao_item_orcamentario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acompanhamento_producao
    ADD CONSTRAINT acompanhamento_producao_item_orcamentario_id_fkey FOREIGN KEY (item_orcamentario_id) REFERENCES public.item_orcamentario(id) ON DELETE SET NULL;


--
-- Name: acompanhamento_producao_material acompanhamento_producao_material_producao_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acompanhamento_producao_material
    ADD CONSTRAINT acompanhamento_producao_material_producao_id_fkey FOREIGN KEY (producao_id) REFERENCES public.acompanhamento_producao(id) ON DELETE CASCADE;


--
-- Name: acompanhamento_producao_material acompanhamento_producao_material_recurso_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acompanhamento_producao_material
    ADD CONSTRAINT acompanhamento_producao_material_recurso_id_fkey FOREIGN KEY (recurso_id) REFERENCES public.recurso(id) ON DELETE SET NULL;


--
-- Name: acompanhamento_producao acompanhamento_producao_obra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acompanhamento_producao
    ADD CONSTRAINT acompanhamento_producao_obra_id_fkey FOREIGN KEY (obra_id) REFERENCES public.obras(id) ON DELETE CASCADE;


--
-- Name: acompanhamento_producao acompanhamento_producao_servico_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acompanhamento_producao
    ADD CONSTRAINT acompanhamento_producao_servico_id_fkey FOREIGN KEY (servico_id) REFERENCES public.servico(id) ON DELETE SET NULL;


--
-- Name: acompanhamento_producao acompanhamento_producao_trecho_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acompanhamento_producao
    ADD CONSTRAINT acompanhamento_producao_trecho_id_fkey FOREIGN KEY (trecho_id) REFERENCES public.obra_trecho(id) ON DELETE SET NULL;


--
-- Name: anexo anexo_autor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.anexo
    ADD CONSTRAINT anexo_autor_id_fkey FOREIGN KEY (autor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: anexo anexo_obra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.anexo
    ADD CONSTRAINT anexo_obra_id_fkey FOREIGN KEY (obra_id) REFERENCES public.obras(id) ON DELETE CASCADE;


--
-- Name: calendario_definicao calendario_definicao_calendario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendario_definicao
    ADD CONSTRAINT calendario_definicao_calendario_id_fkey FOREIGN KEY (calendario_id) REFERENCES public.calendario(id) ON DELETE CASCADE;


--
-- Name: calendario calendario_obra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendario
    ADD CONSTRAINT calendario_obra_id_fkey FOREIGN KEY (obra_id) REFERENCES public.obras(id) ON DELETE CASCADE;


--
-- Name: comentario_item comentario_item_autor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comentario_item
    ADD CONSTRAINT comentario_item_autor_id_fkey FOREIGN KEY (autor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: comentario_item comentario_item_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comentario_item
    ADD CONSTRAINT comentario_item_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.item_orcamentario(id) ON DELETE CASCADE;


--
-- Name: comentario_item comentario_item_obra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comentario_item
    ADD CONSTRAINT comentario_item_obra_id_fkey FOREIGN KEY (obra_id) REFERENCES public.obras(id) ON DELETE CASCADE;


--
-- Name: comentario_item comentario_item_resolvido_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comentario_item
    ADD CONSTRAINT comentario_item_resolvido_por_fkey FOREIGN KEY (resolvido_por) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: cpu cpu_criado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cpu
    ADD CONSTRAINT cpu_criado_por_fkey FOREIGN KEY (criado_por) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: cpu cpu_encargos_sociais_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cpu
    ADD CONSTRAINT cpu_encargos_sociais_id_fkey FOREIGN KEY (encargos_sociais_id) REFERENCES public.encargos_sociais_regime(id) ON DELETE SET NULL;


--
-- Name: cpu_item cpu_item_cpu_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cpu_item
    ADD CONSTRAINT cpu_item_cpu_id_fkey FOREIGN KEY (cpu_id) REFERENCES public.cpu(id) ON DELETE CASCADE;


--
-- Name: cpu_item cpu_item_recurso_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cpu_item
    ADD CONSTRAINT cpu_item_recurso_id_fkey FOREIGN KEY (recurso_id) REFERENCES public.recurso(id);


--
-- Name: cpu cpu_obra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cpu
    ADD CONSTRAINT cpu_obra_id_fkey FOREIGN KEY (obra_id) REFERENCES public.obras(id) ON DELETE CASCADE;


--
-- Name: cpu cpu_servico_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cpu
    ADD CONSTRAINT cpu_servico_id_fkey FOREIGN KEY (servico_id) REFERENCES public.servico(id) ON DELETE SET NULL;


--
-- Name: encargos_sociais_regime encargos_sociais_regime_obra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encargos_sociais_regime
    ADD CONSTRAINT encargos_sociais_regime_obra_id_fkey FOREIGN KEY (obra_id) REFERENCES public.obras(id) ON DELETE CASCADE;


--
-- Name: encarregado encarregado_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encarregado
    ADD CONSTRAINT encarregado_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: encarregado encarregado_obra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encarregado
    ADD CONSTRAINT encarregado_obra_id_fkey FOREIGN KEY (obra_id) REFERENCES public.obras(id) ON DELETE CASCADE;


--
-- Name: equipe equipe_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipe
    ADD CONSTRAINT equipe_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: equipe equipe_encarregado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipe
    ADD CONSTRAINT equipe_encarregado_id_fkey FOREIGN KEY (encarregado_id) REFERENCES public.encarregado(id) ON DELETE SET NULL;


--
-- Name: equipe equipe_obra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipe
    ADD CONSTRAINT equipe_obra_id_fkey FOREIGN KEY (obra_id) REFERENCES public.obras(id) ON DELETE CASCADE;


--
-- Name: planejamento_tarefa fk_plan_tarefa_parent; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento_tarefa
    ADD CONSTRAINT fk_plan_tarefa_parent FOREIGN KEY (parent_id) REFERENCES public.planejamento_tarefa(id);


--
-- Name: fleet_obra fleet_obra_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fleet_obra
    ADD CONSTRAINT fleet_obra_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;


--
-- Name: fleet_sync_execucao fleet_sync_execucao_disparado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fleet_sync_execucao
    ADD CONSTRAINT fleet_sync_execucao_disparado_por_fkey FOREIGN KEY (disparado_por) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: fleet_sync_execucao fleet_sync_execucao_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fleet_sync_execucao
    ADD CONSTRAINT fleet_sync_execucao_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;


--
-- Name: fleethub_config fleethub_config_conectado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fleethub_config
    ADD CONSTRAINT fleethub_config_conectado_por_fkey FOREIGN KEY (conectado_por) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: fleethub_config fleethub_config_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fleethub_config
    ADD CONSTRAINT fleethub_config_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;


--
-- Name: frota_veiculo frota_veiculo_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.frota_veiculo
    ADD CONSTRAINT frota_veiculo_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;


--
-- Name: frota_veiculo frota_veiculo_fleet_obra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.frota_veiculo
    ADD CONSTRAINT frota_veiculo_fleet_obra_id_fkey FOREIGN KEY (fleet_obra_id) REFERENCES public.fleet_obra(id) ON DELETE SET NULL;


--
-- Name: indireto_item indireto_item_obra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.indireto_item
    ADD CONSTRAINT indireto_item_obra_id_fkey FOREIGN KEY (obra_id) REFERENCES public.obras(id) ON DELETE CASCADE;


--
-- Name: indireto_item indireto_item_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.indireto_item
    ADD CONSTRAINT indireto_item_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.indireto_item(id);


--
-- Name: item_orc_alocacao item_orc_alocacao_grupo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_orc_alocacao
    ADD CONSTRAINT item_orc_alocacao_grupo_id_fkey FOREIGN KEY (grupo_id) REFERENCES public.item_orcamentario(id) ON DELETE CASCADE;


--
-- Name: item_orc_alocacao item_orc_alocacao_obra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_orc_alocacao
    ADD CONSTRAINT item_orc_alocacao_obra_id_fkey FOREIGN KEY (obra_id) REFERENCES public.obras(id) ON DELETE CASCADE;


--
-- Name: item_orc_alocacao item_orc_alocacao_receita_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_orc_alocacao
    ADD CONSTRAINT item_orc_alocacao_receita_id_fkey FOREIGN KEY (receita_id) REFERENCES public.item_orcamentario(id) ON DELETE CASCADE;


--
-- Name: item_orcamentario item_orcamentario_aditivo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_orcamentario
    ADD CONSTRAINT item_orcamentario_aditivo_id_fkey FOREIGN KEY (aditivo_id) REFERENCES public.orcamento_aditivo(id) ON DELETE SET NULL;


--
-- Name: item_orcamentario item_orcamentario_indireto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_orcamentario
    ADD CONSTRAINT item_orcamentario_indireto_id_fkey FOREIGN KEY (indireto_id) REFERENCES public.indireto_item(id) ON DELETE SET NULL;


--
-- Name: item_orcamentario item_orcamentario_obra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_orcamentario
    ADD CONSTRAINT item_orcamentario_obra_id_fkey FOREIGN KEY (obra_id) REFERENCES public.obras(id) ON DELETE CASCADE;


--
-- Name: item_orcamentario item_orcamentario_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_orcamentario
    ADD CONSTRAINT item_orcamentario_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.item_orcamentario(id);


--
-- Name: item_orcamentario item_orcamentario_servico_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_orcamentario
    ADD CONSTRAINT item_orcamentario_servico_id_fkey FOREIGN KEY (servico_id) REFERENCES public.servico(id);


--
-- Name: mcp_oauth_codigo mcp_oauth_codigo_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_oauth_codigo
    ADD CONSTRAINT mcp_oauth_codigo_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.mcp_oauth_cliente(id) ON DELETE CASCADE;


--
-- Name: mcp_oauth_codigo mcp_oauth_codigo_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_oauth_codigo
    ADD CONSTRAINT mcp_oauth_codigo_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: mcp_token mcp_token_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_token
    ADD CONSTRAINT mcp_token_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.mcp_oauth_cliente(id) ON DELETE CASCADE;


--
-- Name: mcp_token mcp_token_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_token
    ADD CONSTRAINT mcp_token_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: memoria_calculo_item memoria_calculo_item_autor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memoria_calculo_item
    ADD CONSTRAINT memoria_calculo_item_autor_id_fkey FOREIGN KEY (autor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: memoria_calculo_item memoria_calculo_item_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memoria_calculo_item
    ADD CONSTRAINT memoria_calculo_item_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.item_orcamentario(id) ON DELETE CASCADE;


--
-- Name: memoria_calculo_item memoria_calculo_item_obra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memoria_calculo_item
    ADD CONSTRAINT memoria_calculo_item_obra_id_fkey FOREIGN KEY (obra_id) REFERENCES public.obras(id) ON DELETE CASCADE;


--
-- Name: obra_fleet_obra obra_fleet_obra_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.obra_fleet_obra
    ADD CONSTRAINT obra_fleet_obra_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: obra_fleet_obra obra_fleet_obra_fleet_obra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.obra_fleet_obra
    ADD CONSTRAINT obra_fleet_obra_fleet_obra_id_fkey FOREIGN KEY (fleet_obra_id) REFERENCES public.fleet_obra(id) ON DELETE CASCADE;


--
-- Name: obra_fleet_obra obra_fleet_obra_obra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.obra_fleet_obra
    ADD CONSTRAINT obra_fleet_obra_obra_id_fkey FOREIGN KEY (obra_id) REFERENCES public.obras(id) ON DELETE CASCADE;


--
-- Name: obra_permissoes obra_permissoes_concedido_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.obra_permissoes
    ADD CONSTRAINT obra_permissoes_concedido_por_fkey FOREIGN KEY (concedido_por) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: obra_permissoes obra_permissoes_obra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.obra_permissoes
    ADD CONSTRAINT obra_permissoes_obra_id_fkey FOREIGN KEY (obra_id) REFERENCES public.obras(id) ON DELETE CASCADE;


--
-- Name: obra_permissoes obra_permissoes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.obra_permissoes
    ADD CONSTRAINT obra_permissoes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: obra_produtividade_mes obra_produtividade_mes_obra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.obra_produtividade_mes
    ADD CONSTRAINT obra_produtividade_mes_obra_id_fkey FOREIGN KEY (obra_id) REFERENCES public.obras(id) ON DELETE CASCADE;


--
-- Name: obra_trecho obra_trecho_obra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.obra_trecho
    ADD CONSTRAINT obra_trecho_obra_id_fkey FOREIGN KEY (obra_id) REFERENCES public.obras(id) ON DELETE CASCADE;


--
-- Name: obras obras_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.obras
    ADD CONSTRAINT obras_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE RESTRICT;


--
-- Name: orcamento_aditivo orcamento_aditivo_aplicado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orcamento_aditivo
    ADD CONSTRAINT orcamento_aditivo_aplicado_por_fkey FOREIGN KEY (aplicado_por) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: orcamento_aditivo orcamento_aditivo_criado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orcamento_aditivo
    ADD CONSTRAINT orcamento_aditivo_criado_por_fkey FOREIGN KEY (criado_por) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: orcamento_aditivo_item orcamento_aditivo_item_aditivo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orcamento_aditivo_item
    ADD CONSTRAINT orcamento_aditivo_item_aditivo_id_fkey FOREIGN KEY (aditivo_id) REFERENCES public.orcamento_aditivo(id) ON DELETE CASCADE;


--
-- Name: orcamento_aditivo_item orcamento_aditivo_item_obra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orcamento_aditivo_item
    ADD CONSTRAINT orcamento_aditivo_item_obra_id_fkey FOREIGN KEY (obra_id) REFERENCES public.obras(id) ON DELETE CASCADE;


--
-- Name: orcamento_aditivo_item orcamento_aditivo_item_receita_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orcamento_aditivo_item
    ADD CONSTRAINT orcamento_aditivo_item_receita_id_fkey FOREIGN KEY (receita_id) REFERENCES public.item_orcamentario(id) ON DELETE SET NULL;


--
-- Name: orcamento_aditivo orcamento_aditivo_obra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orcamento_aditivo
    ADD CONSTRAINT orcamento_aditivo_obra_id_fkey FOREIGN KEY (obra_id) REFERENCES public.obras(id) ON DELETE CASCADE;


--
-- Name: orcamento_planilha_inicial orcamento_planilha_inicial_aditivo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orcamento_planilha_inicial
    ADD CONSTRAINT orcamento_planilha_inicial_aditivo_id_fkey FOREIGN KEY (aditivo_id) REFERENCES public.orcamento_aditivo(id) ON DELETE SET NULL;


--
-- Name: orcamento_planilha_inicial orcamento_planilha_inicial_obra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orcamento_planilha_inicial
    ADD CONSTRAINT orcamento_planilha_inicial_obra_id_fkey FOREIGN KEY (obra_id) REFERENCES public.obras(id) ON DELETE CASCADE;


--
-- Name: orcamento_reajuste orcamento_reajuste_aplicado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orcamento_reajuste
    ADD CONSTRAINT orcamento_reajuste_aplicado_por_fkey FOREIGN KEY (aplicado_por) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: orcamento_reajuste orcamento_reajuste_criado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orcamento_reajuste
    ADD CONSTRAINT orcamento_reajuste_criado_por_fkey FOREIGN KEY (criado_por) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: orcamento_reajuste_grupo orcamento_reajuste_grupo_obra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orcamento_reajuste_grupo
    ADD CONSTRAINT orcamento_reajuste_grupo_obra_id_fkey FOREIGN KEY (obra_id) REFERENCES public.obras(id) ON DELETE CASCADE;


--
-- Name: orcamento_reajuste_grupo orcamento_reajuste_grupo_reajuste_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orcamento_reajuste_grupo
    ADD CONSTRAINT orcamento_reajuste_grupo_reajuste_id_fkey FOREIGN KEY (reajuste_id) REFERENCES public.orcamento_reajuste(id) ON DELETE CASCADE;


--
-- Name: orcamento_reajuste_item orcamento_reajuste_item_grupo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orcamento_reajuste_item
    ADD CONSTRAINT orcamento_reajuste_item_grupo_id_fkey FOREIGN KEY (grupo_id) REFERENCES public.orcamento_reajuste_grupo(id) ON DELETE CASCADE;


--
-- Name: orcamento_reajuste_item orcamento_reajuste_item_obra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orcamento_reajuste_item
    ADD CONSTRAINT orcamento_reajuste_item_obra_id_fkey FOREIGN KEY (obra_id) REFERENCES public.obras(id) ON DELETE CASCADE;


--
-- Name: orcamento_reajuste_item orcamento_reajuste_item_reajuste_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orcamento_reajuste_item
    ADD CONSTRAINT orcamento_reajuste_item_reajuste_id_fkey FOREIGN KEY (reajuste_id) REFERENCES public.orcamento_reajuste(id) ON DELETE CASCADE;


--
-- Name: orcamento_reajuste_item orcamento_reajuste_item_receita_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orcamento_reajuste_item
    ADD CONSTRAINT orcamento_reajuste_item_receita_id_fkey FOREIGN KEY (receita_id) REFERENCES public.item_orcamentario(id) ON DELETE CASCADE;


--
-- Name: orcamento_reajuste orcamento_reajuste_obra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orcamento_reajuste
    ADD CONSTRAINT orcamento_reajuste_obra_id_fkey FOREIGN KEY (obra_id) REFERENCES public.obras(id) ON DELETE CASCADE;


--
-- Name: planejamento planejamento_calendario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento
    ADD CONSTRAINT planejamento_calendario_id_fkey FOREIGN KEY (calendario_id) REFERENCES public.calendario(id) ON DELETE SET NULL;


--
-- Name: planejamento planejamento_criado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento
    ADD CONSTRAINT planejamento_criado_por_fkey FOREIGN KEY (criado_por) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: planejamento_dependencia planejamento_dependencia_planejamento_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento_dependencia
    ADD CONSTRAINT planejamento_dependencia_planejamento_id_fkey FOREIGN KEY (planejamento_id) REFERENCES public.planejamento(id) ON DELETE CASCADE;


--
-- Name: planejamento_dependencia planejamento_dependencia_predecessora_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento_dependencia
    ADD CONSTRAINT planejamento_dependencia_predecessora_id_fkey FOREIGN KEY (predecessora_id) REFERENCES public.planejamento_tarefa(id) ON DELETE CASCADE;


--
-- Name: planejamento_dependencia planejamento_dependencia_sucessora_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento_dependencia
    ADD CONSTRAINT planejamento_dependencia_sucessora_id_fkey FOREIGN KEY (sucessora_id) REFERENCES public.planejamento_tarefa(id) ON DELETE CASCADE;


--
-- Name: planejamento_lb_premissa planejamento_lb_premissa_planejamento_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento_lb_premissa
    ADD CONSTRAINT planejamento_lb_premissa_planejamento_id_fkey FOREIGN KEY (planejamento_id) REFERENCES public.planejamento(id) ON DELETE CASCADE;


--
-- Name: planejamento_lb_premissa planejamento_lb_premissa_tarefa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento_lb_premissa
    ADD CONSTRAINT planejamento_lb_premissa_tarefa_id_fkey FOREIGN KEY (tarefa_id) REFERENCES public.planejamento_tarefa(id) ON DELETE CASCADE;


--
-- Name: planejamento_marco planejamento_marco_planejamento_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento_marco
    ADD CONSTRAINT planejamento_marco_planejamento_id_fkey FOREIGN KEY (planejamento_id) REFERENCES public.planejamento(id) ON DELETE CASCADE;


--
-- Name: planejamento planejamento_obra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento
    ADD CONSTRAINT planejamento_obra_id_fkey FOREIGN KEY (obra_id) REFERENCES public.obras(id) ON DELETE CASCADE;


--
-- Name: planejamento_recurso_limite planejamento_recurso_limite_grupo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento_recurso_limite
    ADD CONSTRAINT planejamento_recurso_limite_grupo_id_fkey FOREIGN KEY (grupo_id) REFERENCES public.planejamento_tarefa(id) ON DELETE CASCADE;


--
-- Name: planejamento_recurso_limite planejamento_recurso_limite_planejamento_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento_recurso_limite
    ADD CONSTRAINT planejamento_recurso_limite_planejamento_id_fkey FOREIGN KEY (planejamento_id) REFERENCES public.planejamento(id) ON DELETE CASCADE;


--
-- Name: planejamento_recurso_limite planejamento_recurso_limite_recurso_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento_recurso_limite
    ADD CONSTRAINT planejamento_recurso_limite_recurso_id_fkey FOREIGN KEY (recurso_id) REFERENCES public.recurso(id) ON DELETE CASCADE;


--
-- Name: planejamento_tarefa planejamento_tarefa_calendario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento_tarefa
    ADD CONSTRAINT planejamento_tarefa_calendario_id_fkey FOREIGN KEY (calendario_id) REFERENCES public.calendario(id) ON DELETE SET NULL;


--
-- Name: planejamento_tarefa_equipe planejamento_tarefa_equipe_equipe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento_tarefa_equipe
    ADD CONSTRAINT planejamento_tarefa_equipe_equipe_id_fkey FOREIGN KEY (equipe_id) REFERENCES public.equipe(id);


--
-- Name: planejamento_tarefa_equipe planejamento_tarefa_equipe_tarefa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento_tarefa_equipe
    ADD CONSTRAINT planejamento_tarefa_equipe_tarefa_id_fkey FOREIGN KEY (tarefa_id) REFERENCES public.planejamento_tarefa(id) ON DELETE CASCADE;


--
-- Name: planejamento_tarefa_indireto planejamento_tarefa_indireto_tarefa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento_tarefa_indireto
    ADD CONSTRAINT planejamento_tarefa_indireto_tarefa_id_fkey FOREIGN KEY (tarefa_id) REFERENCES public.planejamento_tarefa(id) ON DELETE CASCADE;


--
-- Name: planejamento_tarefa_indireto planejamento_tarefa_indireto_taxa_regime_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento_tarefa_indireto
    ADD CONSTRAINT planejamento_tarefa_indireto_taxa_regime_id_fkey FOREIGN KEY (taxa_regime_id) REFERENCES public.encargos_sociais_regime(id) ON DELETE RESTRICT;


--
-- Name: planejamento_tarefa planejamento_tarefa_item_orcamentario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento_tarefa
    ADD CONSTRAINT planejamento_tarefa_item_orcamentario_id_fkey FOREIGN KEY (item_orcamentario_id) REFERENCES public.item_orcamentario(id) ON DELETE SET NULL;


--
-- Name: planejamento_tarefa_local planejamento_tarefa_local_planejamento_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento_tarefa_local
    ADD CONSTRAINT planejamento_tarefa_local_planejamento_id_fkey FOREIGN KEY (planejamento_id) REFERENCES public.planejamento(id) ON DELETE CASCADE;


--
-- Name: planejamento_tarefa_local planejamento_tarefa_local_tarefa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento_tarefa_local
    ADD CONSTRAINT planejamento_tarefa_local_tarefa_id_fkey FOREIGN KEY (tarefa_id) REFERENCES public.planejamento_tarefa(id) ON DELETE CASCADE;


--
-- Name: planejamento_tarefa_local planejamento_tarefa_local_trecho_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento_tarefa_local
    ADD CONSTRAINT planejamento_tarefa_local_trecho_id_fkey FOREIGN KEY (trecho_id) REFERENCES public.obra_trecho(id);


--
-- Name: planejamento_tarefa_perfil_dia planejamento_tarefa_perfil_dia_tarefa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento_tarefa_perfil_dia
    ADD CONSTRAINT planejamento_tarefa_perfil_dia_tarefa_id_fkey FOREIGN KEY (tarefa_id) REFERENCES public.planejamento_tarefa(id) ON DELETE CASCADE;


--
-- Name: planejamento_tarefa_perfil_semana planejamento_tarefa_perfil_semana_tarefa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento_tarefa_perfil_semana
    ADD CONSTRAINT planejamento_tarefa_perfil_semana_tarefa_id_fkey FOREIGN KEY (tarefa_id) REFERENCES public.planejamento_tarefa(id) ON DELETE CASCADE;


--
-- Name: planejamento_tarefa planejamento_tarefa_planejamento_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento_tarefa
    ADD CONSTRAINT planejamento_tarefa_planejamento_id_fkey FOREIGN KEY (planejamento_id) REFERENCES public.planejamento(id) ON DELETE CASCADE;


--
-- Name: planejamento_tarefa_wp planejamento_tarefa_wp_local_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento_tarefa_wp
    ADD CONSTRAINT planejamento_tarefa_wp_local_id_fkey FOREIGN KEY (local_id) REFERENCES public.planejamento_tarefa_local(id) ON DELETE CASCADE;


--
-- Name: planejamento_tarefa_wp planejamento_tarefa_wp_planejamento_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento_tarefa_wp
    ADD CONSTRAINT planejamento_tarefa_wp_planejamento_id_fkey FOREIGN KEY (planejamento_id) REFERENCES public.planejamento(id) ON DELETE CASCADE;


--
-- Name: planejamento_tarefa_wp planejamento_tarefa_wp_tarefa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento_tarefa_wp
    ADD CONSTRAINT planejamento_tarefa_wp_tarefa_id_fkey FOREIGN KEY (tarefa_id) REFERENCES public.planejamento_tarefa(id) ON DELETE CASCADE;


--
-- Name: planejamento_tarefa_wp planejamento_tarefa_wp_trecho_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planejamento_tarefa_wp
    ADD CONSTRAINT planejamento_tarefa_wp_trecho_id_fkey FOREIGN KEY (trecho_id) REFERENCES public.obra_trecho(id) ON DELETE SET NULL;


--
-- Name: profiles profiles_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE RESTRICT;


--
-- Name: profiles profiles_engenheiro_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_engenheiro_id_fkey FOREIGN KEY (engenheiro_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: recurso recurso_obra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurso
    ADD CONSTRAINT recurso_obra_id_fkey FOREIGN KEY (obra_id) REFERENCES public.obras(id) ON DELETE CASCADE;


--
-- Name: recurso_preco recurso_preco_criado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurso_preco
    ADD CONSTRAINT recurso_preco_criado_por_fkey FOREIGN KEY (criado_por) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: recurso_preco recurso_preco_recurso_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurso_preco
    ADD CONSTRAINT recurso_preco_recurso_id_fkey FOREIGN KEY (recurso_id) REFERENCES public.recurso(id) ON DELETE CASCADE;


--
-- Name: servico_cpu_link servico_cpu_link_cpu_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servico_cpu_link
    ADD CONSTRAINT servico_cpu_link_cpu_id_fkey FOREIGN KEY (cpu_id) REFERENCES public.cpu(id) ON DELETE CASCADE;


--
-- Name: servico_cpu_link servico_cpu_link_servico_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servico_cpu_link
    ADD CONSTRAINT servico_cpu_link_servico_id_fkey FOREIGN KEY (servico_id) REFERENCES public.servico(id) ON DELETE CASCADE;


--
-- Name: servico_dependencia servico_dependencia_obra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servico_dependencia
    ADD CONSTRAINT servico_dependencia_obra_id_fkey FOREIGN KEY (obra_id) REFERENCES public.obras(id) ON DELETE CASCADE;


--
-- Name: servico_dependencia servico_dependencia_predecessor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servico_dependencia
    ADD CONSTRAINT servico_dependencia_predecessor_id_fkey FOREIGN KEY (predecessor_id) REFERENCES public.servico(id) ON DELETE CASCADE;


--
-- Name: servico_dependencia servico_dependencia_sucessor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servico_dependencia
    ADD CONSTRAINT servico_dependencia_sucessor_id_fkey FOREIGN KEY (sucessor_id) REFERENCES public.servico(id) ON DELETE CASCADE;


--
-- Name: servico servico_obra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servico
    ADD CONSTRAINT servico_obra_id_fkey FOREIGN KEY (obra_id) REFERENCES public.obras(id) ON DELETE CASCADE;


--
-- Name: servico_parametro servico_parametro_item_orcamentario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servico_parametro
    ADD CONSTRAINT servico_parametro_item_orcamentario_id_fkey FOREIGN KEY (item_orcamentario_id) REFERENCES public.item_orcamentario(id) ON DELETE CASCADE;


--
-- Name: servico_parametro servico_parametro_material_recurso_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servico_parametro
    ADD CONSTRAINT servico_parametro_material_recurso_id_fkey FOREIGN KEY (material_recurso_id) REFERENCES public.recurso(id) ON DELETE RESTRICT;


--
-- Name: servico_parametro servico_parametro_obra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servico_parametro
    ADD CONSTRAINT servico_parametro_obra_id_fkey FOREIGN KEY (obra_id) REFERENCES public.obras(id) ON DELETE CASCADE;


--
-- Name: servico_parametro servico_parametro_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servico_parametro
    ADD CONSTRAINT servico_parametro_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: servico servico_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servico
    ADD CONSTRAINT servico_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.servico(id);


--
-- Name: transporte_local transporte_local_obra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transporte_local
    ADD CONSTRAINT transporte_local_obra_id_fkey FOREIGN KEY (obra_id) REFERENCES public.obras(id) ON DELETE CASCADE;


--
-- Name: transporte_local transporte_local_trecho_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transporte_local
    ADD CONSTRAINT transporte_local_trecho_id_fkey FOREIGN KEY (trecho_id) REFERENCES public.obra_trecho(id) ON DELETE SET NULL;


--
-- Name: transporte_rota transporte_rota_destino_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transporte_rota
    ADD CONSTRAINT transporte_rota_destino_id_fkey FOREIGN KEY (destino_id) REFERENCES public.transporte_local(id) ON DELETE CASCADE;


--
-- Name: transporte_rota transporte_rota_obra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transporte_rota
    ADD CONSTRAINT transporte_rota_obra_id_fkey FOREIGN KEY (obra_id) REFERENCES public.obras(id) ON DELETE CASCADE;


--
-- Name: transporte_rota transporte_rota_origem_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transporte_rota
    ADD CONSTRAINT transporte_rota_origem_id_fkey FOREIGN KEY (origem_id) REFERENCES public.transporte_local(id) ON DELETE CASCADE;


--
-- Name: trecho_quantidade_celula trecho_quantidade_celula_coluna_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trecho_quantidade_celula
    ADD CONSTRAINT trecho_quantidade_celula_coluna_id_fkey FOREIGN KEY (coluna_id) REFERENCES public.trecho_quantidade_coluna(id) ON DELETE CASCADE;


--
-- Name: trecho_quantidade_celula trecho_quantidade_celula_segmento_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trecho_quantidade_celula
    ADD CONSTRAINT trecho_quantidade_celula_segmento_id_fkey FOREIGN KEY (segmento_id) REFERENCES public.trecho_quantidade_segmento(id) ON DELETE CASCADE;


--
-- Name: trecho_quantidade_coluna trecho_quantidade_coluna_item_orcamentario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trecho_quantidade_coluna
    ADD CONSTRAINT trecho_quantidade_coluna_item_orcamentario_id_fkey FOREIGN KEY (item_orcamentario_id) REFERENCES public.item_orcamentario(id) ON DELETE CASCADE;


--
-- Name: trecho_quantidade_coluna trecho_quantidade_coluna_versao_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trecho_quantidade_coluna
    ADD CONSTRAINT trecho_quantidade_coluna_versao_id_fkey FOREIGN KEY (versao_id) REFERENCES public.trecho_quantidade_versao(id) ON DELETE CASCADE;


--
-- Name: trecho_quantidade_mapeamento trecho_quantidade_mapeamento_item_orcamentario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trecho_quantidade_mapeamento
    ADD CONSTRAINT trecho_quantidade_mapeamento_item_orcamentario_id_fkey FOREIGN KEY (item_orcamentario_id) REFERENCES public.item_orcamentario(id) ON DELETE CASCADE;


--
-- Name: trecho_quantidade_mapeamento trecho_quantidade_mapeamento_obra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trecho_quantidade_mapeamento
    ADD CONSTRAINT trecho_quantidade_mapeamento_obra_id_fkey FOREIGN KEY (obra_id) REFERENCES public.obras(id) ON DELETE CASCADE;


--
-- Name: trecho_quantidade_segmento trecho_quantidade_segmento_versao_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trecho_quantidade_segmento
    ADD CONSTRAINT trecho_quantidade_segmento_versao_id_fkey FOREIGN KEY (versao_id) REFERENCES public.trecho_quantidade_versao(id) ON DELETE CASCADE;


--
-- Name: trecho_quantidade_template trecho_quantidade_template_obra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trecho_quantidade_template
    ADD CONSTRAINT trecho_quantidade_template_obra_id_fkey FOREIGN KEY (obra_id) REFERENCES public.obras(id) ON DELETE CASCADE;


--
-- Name: trecho_quantidade_template trecho_quantidade_template_trecho_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trecho_quantidade_template
    ADD CONSTRAINT trecho_quantidade_template_trecho_id_fkey FOREIGN KEY (trecho_id) REFERENCES public.obra_trecho(id) ON DELETE CASCADE;


--
-- Name: trecho_quantidade_versao trecho_quantidade_versao_criado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trecho_quantidade_versao
    ADD CONSTRAINT trecho_quantidade_versao_criado_por_fkey FOREIGN KEY (criado_por) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: trecho_quantidade_versao trecho_quantidade_versao_obra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trecho_quantidade_versao
    ADD CONSTRAINT trecho_quantidade_versao_obra_id_fkey FOREIGN KEY (obra_id) REFERENCES public.obras(id) ON DELETE CASCADE;


--
-- Name: trecho_quantidade_versao trecho_quantidade_versao_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trecho_quantidade_versao
    ADD CONSTRAINT trecho_quantidade_versao_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.trecho_quantidade_template(id) ON DELETE CASCADE;


--
-- Name: viagem viagem_carregador_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.viagem
    ADD CONSTRAINT viagem_carregador_id_fkey FOREIGN KEY (carregador_id) REFERENCES public.frota_veiculo(id) ON DELETE SET NULL;


--
-- Name: viagem viagem_destino_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.viagem
    ADD CONSTRAINT viagem_destino_id_fkey FOREIGN KEY (destino_id) REFERENCES public.transporte_local(id) ON DELETE SET NULL;


--
-- Name: viagem_ficha viagem_ficha_criado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.viagem_ficha
    ADD CONSTRAINT viagem_ficha_criado_por_fkey FOREIGN KEY (criado_por) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: viagem_ficha viagem_ficha_encarregado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.viagem_ficha
    ADD CONSTRAINT viagem_ficha_encarregado_id_fkey FOREIGN KEY (encarregado_id) REFERENCES public.encarregado(id) ON DELETE SET NULL;


--
-- Name: viagem_ficha viagem_ficha_equipe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.viagem_ficha
    ADD CONSTRAINT viagem_ficha_equipe_id_fkey FOREIGN KEY (equipe_id) REFERENCES public.equipe(id) ON DELETE SET NULL;


--
-- Name: viagem viagem_ficha_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.viagem
    ADD CONSTRAINT viagem_ficha_id_fkey FOREIGN KEY (ficha_id) REFERENCES public.viagem_ficha(id) ON DELETE CASCADE;


--
-- Name: viagem_ficha viagem_ficha_obra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.viagem_ficha
    ADD CONSTRAINT viagem_ficha_obra_id_fkey FOREIGN KEY (obra_id) REFERENCES public.obras(id) ON DELETE CASCADE;


--
-- Name: viagem_ficha viagem_ficha_veiculo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.viagem_ficha
    ADD CONSTRAINT viagem_ficha_veiculo_id_fkey FOREIGN KEY (veiculo_id) REFERENCES public.frota_veiculo(id) ON DELETE SET NULL;


--
-- Name: viagem viagem_item_orcamentario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.viagem
    ADD CONSTRAINT viagem_item_orcamentario_id_fkey FOREIGN KEY (item_orcamentario_id) REFERENCES public.item_orcamentario(id);


--
-- Name: viagem viagem_obra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.viagem
    ADD CONSTRAINT viagem_obra_id_fkey FOREIGN KEY (obra_id) REFERENCES public.obras(id) ON DELETE CASCADE;


--
-- Name: viagem viagem_origem_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.viagem
    ADD CONSTRAINT viagem_origem_id_fkey FOREIGN KEY (origem_id) REFERENCES public.transporte_local(id) ON DELETE SET NULL;


--
-- Name: viagem viagem_trecho_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.viagem
    ADD CONSTRAINT viagem_trecho_id_fkey FOREIGN KEY (trecho_id) REFERENCES public.obra_trecho(id) ON DELETE SET NULL;


--
-- Name: acompanhamento_alerta acomp_alerta_adm_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY acomp_alerta_adm_select ON public.acompanhamento_alerta FOR SELECT TO authenticated USING (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(obra_id) = public.auth_empresa_id())));


--
-- Name: acompanhamento_alerta acomp_alerta_adm_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY acomp_alerta_adm_update ON public.acompanhamento_alerta FOR UPDATE TO authenticated USING (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(obra_id) = public.auth_empresa_id()))) WITH CHECK (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(obra_id) = public.auth_empresa_id())));


--
-- Name: acompanhamento_alerta acomp_alerta_apoio_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY acomp_alerta_apoio_select ON public.acompanhamento_alerta FOR SELECT TO authenticated USING (((public.auth_role() = 'apoio'::public.role_enum) AND public.has_obra_permissao(obra_id, public.auth_engenheiro_id())));


--
-- Name: acompanhamento_alerta acomp_alerta_eng_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY acomp_alerta_eng_select ON public.acompanhamento_alerta FOR SELECT TO authenticated USING (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(obra_id, auth.uid())));


--
-- Name: acompanhamento_alerta acomp_alerta_eng_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY acomp_alerta_eng_update ON public.acompanhamento_alerta FOR UPDATE TO authenticated USING (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(obra_id, auth.uid()))) WITH CHECK (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(obra_id, auth.uid())));


--
-- Name: acompanhamento_alerta acomp_alerta_god_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY acomp_alerta_god_select ON public.acompanhamento_alerta FOR SELECT TO authenticated USING ((public.auth_role() = 'god'::public.role_enum));


--
-- Name: acompanhamento_alerta acomp_alerta_god_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY acomp_alerta_god_update ON public.acompanhamento_alerta FOR UPDATE TO authenticated USING ((public.auth_role() = 'god'::public.role_enum)) WITH CHECK ((public.auth_role() = 'god'::public.role_enum));


--
-- Name: acompanhamento_foto acomp_foto_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY acomp_foto_insert ON public.acompanhamento_foto FOR INSERT TO authenticated WITH CHECK ((public.pode_lancar_producao(obra_id) AND ((enviado_por IS NULL) OR (enviado_por = auth.uid()))));


--
-- Name: acompanhamento_foto acomp_foto_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY acomp_foto_select ON public.acompanhamento_foto FOR SELECT TO authenticated USING (public.pode_ver_acompanhamento(obra_id));


--
-- Name: acompanhamento_foto acomp_foto_select_proprio; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY acomp_foto_select_proprio ON public.acompanhamento_foto FOR SELECT USING (((enviado_por = auth.uid()) AND (public.auth_role() IS NOT NULL)));


--
-- Name: acompanhamento_foto acomp_foto_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY acomp_foto_update ON public.acompanhamento_foto FOR UPDATE TO authenticated USING ((public.pode_lancar_producao(obra_id) AND ((public.auth_role() <> ALL (ARRAY['apoio'::public.role_enum, 'apontador'::public.role_enum])) OR (enviado_por = auth.uid())))) WITH CHECK (public.pode_lancar_producao(obra_id));


--
-- Name: acompanhamento_producao acomp_prod_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY acomp_prod_delete ON public.acompanhamento_producao FOR DELETE TO authenticated USING ((public.pode_lancar_producao(obra_id) AND ((public.auth_role() <> ALL (ARRAY['apoio'::public.role_enum, 'apontador'::public.role_enum])) OR (criado_por = auth.uid()))));


--
-- Name: acompanhamento_producao acomp_prod_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY acomp_prod_insert ON public.acompanhamento_producao FOR INSERT TO authenticated WITH CHECK ((public.pode_lancar_producao(obra_id) AND ((criado_por IS NULL) OR (criado_por = auth.uid()))));


--
-- Name: acompanhamento_producao_material acomp_prod_mat_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY acomp_prod_mat_select ON public.acompanhamento_producao_material FOR SELECT TO authenticated USING (((public.auth_role() <> 'cliente'::public.role_enum) AND public.pode_ver_acompanhamento(public.acomp_producao_obra(producao_id))));


--
-- Name: acompanhamento_producao_material acomp_prod_mat_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY acomp_prod_mat_write ON public.acompanhamento_producao_material TO authenticated USING (public.pode_lancar_producao(public.acomp_producao_obra(producao_id))) WITH CHECK (public.pode_lancar_producao(public.acomp_producao_obra(producao_id)));


--
-- Name: acompanhamento_producao acomp_prod_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY acomp_prod_select ON public.acompanhamento_producao FOR SELECT TO authenticated USING (((public.auth_role() <> 'cliente'::public.role_enum) AND public.pode_ver_acompanhamento(obra_id)));


--
-- Name: acompanhamento_producao acomp_prod_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY acomp_prod_update ON public.acompanhamento_producao FOR UPDATE TO authenticated USING ((public.pode_lancar_producao(obra_id) AND ((public.auth_role() <> ALL (ARRAY['apoio'::public.role_enum, 'apontador'::public.role_enum])) OR (criado_por = auth.uid())))) WITH CHECK (public.pode_lancar_producao(obra_id));


--
-- Name: acompanhamento_alerta; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.acompanhamento_alerta ENABLE ROW LEVEL SECURITY;

--
-- Name: acompanhamento_foto; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.acompanhamento_foto ENABLE ROW LEVEL SECURITY;

--
-- Name: acompanhamento_producao; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.acompanhamento_producao ENABLE ROW LEVEL SECURITY;

--
-- Name: acompanhamento_producao_material; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.acompanhamento_producao_material ENABLE ROW LEVEL SECURITY;

--
-- Name: anexo; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.anexo ENABLE ROW LEVEL SECURITY;

--
-- Name: anexo anexo_adm_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anexo_adm_all ON public.anexo TO authenticated USING (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(obra_id) = public.auth_empresa_id()))) WITH CHECK (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(obra_id) = public.auth_empresa_id())));


--
-- Name: anexo anexo_apoio_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anexo_apoio_select ON public.anexo FOR SELECT TO authenticated USING (((public.auth_role() = 'apoio'::public.role_enum) AND public.has_obra_permissao(obra_id, public.auth_engenheiro_id())));


--
-- Name: anexo anexo_eng_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anexo_eng_all ON public.anexo TO authenticated USING (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(obra_id, auth.uid()))) WITH CHECK (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(obra_id, auth.uid())));


--
-- Name: anexo anexo_god_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anexo_god_all ON public.anexo TO authenticated USING ((public.auth_role() = 'god'::public.role_enum)) WITH CHECK ((public.auth_role() = 'god'::public.role_enum));


--
-- Name: calendario_definicao caldef_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY caldef_select ON public.calendario_definicao FOR SELECT USING (public.pode_ver_obra(public.calendario_obra(calendario_id)));


--
-- Name: calendario_definicao caldef_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY caldef_write ON public.calendario_definicao USING (public.pode_planejar_obra(public.calendario_obra(calendario_id))) WITH CHECK (public.pode_planejar_obra(public.calendario_obra(calendario_id)));


--
-- Name: calendario; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.calendario ENABLE ROW LEVEL SECURITY;

--
-- Name: calendario_definicao; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.calendario_definicao ENABLE ROW LEVEL SECURITY;

--
-- Name: calendario calendario_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY calendario_select ON public.calendario FOR SELECT USING (public.pode_ver_obra(obra_id));


--
-- Name: calendario calendario_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY calendario_write ON public.calendario USING (public.pode_planejar_obra(obra_id)) WITH CHECK (public.pode_planejar_obra(obra_id));


--
-- Name: comentario_item comentario_adm_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY comentario_adm_insert ON public.comentario_item FOR INSERT TO authenticated WITH CHECK (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(obra_id) = public.auth_empresa_id()) AND (autor_id = auth.uid())));


--
-- Name: comentario_item comentario_adm_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY comentario_adm_select ON public.comentario_item FOR SELECT TO authenticated USING (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(obra_id) = public.auth_empresa_id())));


--
-- Name: comentario_item comentario_apoio_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY comentario_apoio_insert ON public.comentario_item FOR INSERT TO authenticated WITH CHECK (((public.auth_role() = 'apoio'::public.role_enum) AND public.has_obra_permissao(obra_id, public.auth_engenheiro_id()) AND (autor_id = auth.uid())));


--
-- Name: comentario_item comentario_apoio_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY comentario_apoio_select ON public.comentario_item FOR SELECT TO authenticated USING (((public.auth_role() = 'apoio'::public.role_enum) AND public.has_obra_permissao(obra_id, public.auth_engenheiro_id())));


--
-- Name: comentario_item comentario_autor_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY comentario_autor_delete ON public.comentario_item FOR DELETE TO authenticated USING ((autor_id = auth.uid()));


--
-- Name: comentario_item comentario_autor_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY comentario_autor_update ON public.comentario_item FOR UPDATE TO authenticated USING ((autor_id = auth.uid())) WITH CHECK ((autor_id = auth.uid()));


--
-- Name: comentario_item comentario_eng_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY comentario_eng_insert ON public.comentario_item FOR INSERT TO authenticated WITH CHECK (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(obra_id, auth.uid()) AND (autor_id = auth.uid())));


--
-- Name: comentario_item comentario_eng_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY comentario_eng_select ON public.comentario_item FOR SELECT TO authenticated USING (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(obra_id, auth.uid())));


--
-- Name: comentario_item comentario_god_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY comentario_god_all ON public.comentario_item TO authenticated USING ((public.auth_role() = 'god'::public.role_enum)) WITH CHECK ((public.auth_role() = 'god'::public.role_enum));


--
-- Name: comentario_item; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.comentario_item ENABLE ROW LEVEL SECURITY;

--
-- Name: cpu; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cpu ENABLE ROW LEVEL SECURITY;

--
-- Name: cpu cpu_adm_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cpu_adm_all ON public.cpu TO authenticated USING (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(obra_id) = public.auth_empresa_id()))) WITH CHECK (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(obra_id) = public.auth_empresa_id())));


--
-- Name: cpu cpu_apoio_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cpu_apoio_select ON public.cpu FOR SELECT TO authenticated USING (((public.auth_role() = 'apoio'::public.role_enum) AND public.has_obra_permissao(obra_id, public.auth_engenheiro_id())));


--
-- Name: cpu cpu_eng_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cpu_eng_all ON public.cpu TO authenticated USING (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(obra_id, auth.uid()))) WITH CHECK (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(obra_id, auth.uid())));


--
-- Name: cpu cpu_god_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cpu_god_all ON public.cpu TO authenticated USING ((public.auth_role() = 'god'::public.role_enum)) WITH CHECK ((public.auth_role() = 'god'::public.role_enum));


--
-- Name: cpu_item; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cpu_item ENABLE ROW LEVEL SECURITY;

--
-- Name: cpu_item cpu_item_adm_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cpu_item_adm_all ON public.cpu_item TO authenticated USING (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(public.cpu_obra(cpu_id)) = public.auth_empresa_id()))) WITH CHECK (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(public.cpu_obra(cpu_id)) = public.auth_empresa_id())));


--
-- Name: cpu_item cpu_item_apoio_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cpu_item_apoio_select ON public.cpu_item FOR SELECT TO authenticated USING (((public.auth_role() = 'apoio'::public.role_enum) AND public.has_obra_permissao(public.cpu_obra(cpu_id), public.auth_engenheiro_id())));


--
-- Name: cpu_item cpu_item_eng_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cpu_item_eng_all ON public.cpu_item TO authenticated USING (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(public.cpu_obra(cpu_id), auth.uid()))) WITH CHECK (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(public.cpu_obra(cpu_id), auth.uid())));


--
-- Name: cpu_item cpu_item_god_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cpu_item_god_all ON public.cpu_item TO authenticated USING ((public.auth_role() = 'god'::public.role_enum)) WITH CHECK ((public.auth_role() = 'god'::public.role_enum));


--
-- Name: empresas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.empresas ENABLE ROW LEVEL SECURITY;

--
-- Name: empresas empresas_adm_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresas_adm_select_own ON public.empresas FOR SELECT TO authenticated USING (((public.auth_role() = 'adm'::public.role_enum) AND (id = public.auth_empresa_id())));


--
-- Name: empresas empresas_god_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresas_god_all ON public.empresas TO authenticated USING ((public.auth_role() = 'god'::public.role_enum)) WITH CHECK ((public.auth_role() = 'god'::public.role_enum));


--
-- Name: empresas empresas_user_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresas_user_select_own ON public.empresas FOR SELECT TO authenticated USING (((public.auth_role() = ANY (ARRAY['engenheiro'::public.role_enum, 'apoio'::public.role_enum, 'cliente'::public.role_enum])) AND (id = public.auth_empresa_id())));


--
-- Name: encargos_sociais_regime encargos_adm_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY encargos_adm_all ON public.encargos_sociais_regime TO authenticated USING (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(obra_id) = public.auth_empresa_id()))) WITH CHECK (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(obra_id) = public.auth_empresa_id())));


--
-- Name: encargos_sociais_regime encargos_apoio_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY encargos_apoio_select ON public.encargos_sociais_regime FOR SELECT TO authenticated USING (((public.auth_role() = 'apoio'::public.role_enum) AND public.has_obra_permissao(obra_id, public.auth_engenheiro_id())));


--
-- Name: encargos_sociais_regime encargos_eng_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY encargos_eng_all ON public.encargos_sociais_regime TO authenticated USING (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(obra_id, auth.uid()))) WITH CHECK (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(obra_id, auth.uid())));


--
-- Name: encargos_sociais_regime encargos_god_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY encargos_god_all ON public.encargos_sociais_regime TO authenticated USING ((public.auth_role() = 'god'::public.role_enum)) WITH CHECK ((public.auth_role() = 'god'::public.role_enum));


--
-- Name: encargos_sociais_regime; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.encargos_sociais_regime ENABLE ROW LEVEL SECURITY;

--
-- Name: encarregado; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.encarregado ENABLE ROW LEVEL SECURITY;

--
-- Name: encarregado encarregado_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY encarregado_delete ON public.encarregado FOR DELETE TO authenticated USING (((public.auth_role() = ANY (ARRAY['god'::public.role_enum, 'adm'::public.role_enum, 'engenheiro'::public.role_enum])) AND public.pode_lancar_producao(obra_id)));


--
-- Name: encarregado encarregado_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY encarregado_insert ON public.encarregado FOR INSERT TO authenticated WITH CHECK (public.pode_lancar_producao(obra_id));


--
-- Name: encarregado encarregado_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY encarregado_select ON public.encarregado FOR SELECT TO authenticated USING (((public.auth_role() <> 'cliente'::public.role_enum) AND public.pode_ver_acompanhamento(obra_id)));


--
-- Name: encarregado encarregado_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY encarregado_update ON public.encarregado FOR UPDATE TO authenticated USING (public.pode_lancar_producao(obra_id)) WITH CHECK (public.pode_lancar_producao(obra_id));


--
-- Name: equipe; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.equipe ENABLE ROW LEVEL SECURITY;

--
-- Name: equipe equipe_adm_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY equipe_adm_all ON public.equipe TO authenticated USING (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(obra_id) = public.auth_empresa_id()))) WITH CHECK (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(obra_id) = public.auth_empresa_id())));


--
-- Name: equipe equipe_apoio_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY equipe_apoio_select ON public.equipe FOR SELECT TO authenticated USING (((public.auth_role() = 'apoio'::public.role_enum) AND public.has_obra_permissao(obra_id, public.auth_engenheiro_id())));


--
-- Name: equipe equipe_eng_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY equipe_eng_all ON public.equipe TO authenticated USING (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(obra_id, auth.uid()))) WITH CHECK (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(obra_id, auth.uid())));


--
-- Name: equipe equipe_god_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY equipe_god_all ON public.equipe TO authenticated USING ((public.auth_role() = 'god'::public.role_enum)) WITH CHECK ((public.auth_role() = 'god'::public.role_enum));


--
-- Name: viagem_ficha ficha_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ficha_delete ON public.viagem_ficha FOR DELETE TO authenticated USING ((public.pode_lancar_producao(obra_id) AND ((public.auth_role() <> ALL (ARRAY['apoio'::public.role_enum, 'apontador'::public.role_enum])) OR (criado_por = auth.uid()))));


--
-- Name: viagem_ficha ficha_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ficha_insert ON public.viagem_ficha FOR INSERT TO authenticated WITH CHECK ((public.pode_lancar_producao(obra_id) AND ((criado_por IS NULL) OR (criado_por = auth.uid()))));


--
-- Name: viagem_ficha ficha_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ficha_select ON public.viagem_ficha FOR SELECT TO authenticated USING ((((public.auth_role() <> 'cliente'::public.role_enum) AND public.pode_ver_acompanhamento(obra_id)) OR ((public.auth_role() = 'apontador'::public.role_enum) AND (criado_por = auth.uid()))));


--
-- Name: viagem_ficha ficha_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ficha_update ON public.viagem_ficha FOR UPDATE TO authenticated USING ((public.pode_lancar_producao(obra_id) AND ((public.auth_role() <> ALL (ARRAY['apoio'::public.role_enum, 'apontador'::public.role_enum])) OR (criado_por = auth.uid())))) WITH CHECK (public.pode_lancar_producao(obra_id));


--
-- Name: fleet_obra; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fleet_obra ENABLE ROW LEVEL SECURITY;

--
-- Name: fleet_obra fleet_obra_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fleet_obra_select ON public.fleet_obra FOR SELECT TO authenticated USING (((public.auth_role() = 'god'::public.role_enum) OR (empresa_id = public.auth_empresa_id())));


--
-- Name: fleet_sync_execucao; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fleet_sync_execucao ENABLE ROW LEVEL SECURITY;

--
-- Name: fleet_sync_execucao fleet_sync_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fleet_sync_select ON public.fleet_sync_execucao FOR SELECT TO authenticated USING (((public.auth_role() = 'god'::public.role_enum) OR ((public.auth_role() = ANY (ARRAY['adm'::public.role_enum, 'engenheiro'::public.role_enum])) AND (empresa_id = public.auth_empresa_id()))));


--
-- Name: fleethub_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fleethub_config ENABLE ROW LEVEL SECURITY;

--
-- Name: fleethub_config fleethub_config_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fleethub_config_select ON public.fleethub_config FOR SELECT TO authenticated USING (((public.auth_role() = 'god'::public.role_enum) OR ((public.auth_role() = ANY (ARRAY['adm'::public.role_enum, 'engenheiro'::public.role_enum])) AND (empresa_id = public.auth_empresa_id()))));


--
-- Name: frota_veiculo frota_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY frota_select ON public.frota_veiculo FOR SELECT TO authenticated USING (((public.auth_role() = 'god'::public.role_enum) OR (empresa_id = public.auth_empresa_id())));


--
-- Name: frota_veiculo; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.frota_veiculo ENABLE ROW LEVEL SECURITY;

--
-- Name: frota_veiculo frota_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY frota_write ON public.frota_veiculo TO authenticated USING (((public.auth_role() = 'god'::public.role_enum) OR ((public.auth_role() = ANY (ARRAY['adm'::public.role_enum, 'engenheiro'::public.role_enum])) AND (empresa_id = public.auth_empresa_id())))) WITH CHECK (((public.auth_role() = 'god'::public.role_enum) OR ((public.auth_role() = ANY (ARRAY['adm'::public.role_enum, 'engenheiro'::public.role_enum])) AND (empresa_id = public.auth_empresa_id()))));


--
-- Name: indireto_item indireto_adm_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY indireto_adm_all ON public.indireto_item TO authenticated USING (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(obra_id) = public.auth_empresa_id()))) WITH CHECK (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(obra_id) = public.auth_empresa_id())));


--
-- Name: indireto_item indireto_apoio_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY indireto_apoio_select ON public.indireto_item FOR SELECT TO authenticated USING (((public.auth_role() = 'apoio'::public.role_enum) AND public.has_obra_permissao(obra_id, public.auth_engenheiro_id())));


--
-- Name: indireto_item indireto_eng_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY indireto_eng_all ON public.indireto_item TO authenticated USING (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(obra_id, auth.uid()))) WITH CHECK (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(obra_id, auth.uid())));


--
-- Name: indireto_item indireto_god_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY indireto_god_all ON public.indireto_item TO authenticated USING ((public.auth_role() = 'god'::public.role_enum)) WITH CHECK ((public.auth_role() = 'god'::public.role_enum));


--
-- Name: indireto_item; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.indireto_item ENABLE ROW LEVEL SECURITY;

--
-- Name: item_orcamentario item_orc_adm_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY item_orc_adm_all ON public.item_orcamentario TO authenticated USING (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(obra_id) = public.auth_empresa_id()))) WITH CHECK (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(obra_id) = public.auth_empresa_id())));


--
-- Name: item_orc_alocacao item_orc_aloc_adm_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY item_orc_aloc_adm_all ON public.item_orc_alocacao USING (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(obra_id) = public.auth_empresa_id()))) WITH CHECK (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(obra_id) = public.auth_empresa_id())));


--
-- Name: item_orc_alocacao item_orc_aloc_apoio_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY item_orc_aloc_apoio_select ON public.item_orc_alocacao FOR SELECT USING (((public.auth_role() = 'apoio'::public.role_enum) AND public.has_obra_permissao(obra_id, public.auth_engenheiro_id())));


--
-- Name: item_orc_alocacao item_orc_aloc_eng_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY item_orc_aloc_eng_all ON public.item_orc_alocacao USING (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(obra_id, auth.uid()))) WITH CHECK (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(obra_id, auth.uid())));


--
-- Name: item_orc_alocacao item_orc_aloc_god_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY item_orc_aloc_god_all ON public.item_orc_alocacao USING ((public.auth_role() = 'god'::public.role_enum)) WITH CHECK ((public.auth_role() = 'god'::public.role_enum));


--
-- Name: item_orc_alocacao; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.item_orc_alocacao ENABLE ROW LEVEL SECURITY;

--
-- Name: item_orcamentario item_orc_apoio_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY item_orc_apoio_select ON public.item_orcamentario FOR SELECT TO authenticated USING (((public.auth_role() = 'apoio'::public.role_enum) AND public.has_obra_permissao(obra_id, public.auth_engenheiro_id())));


--
-- Name: item_orcamentario item_orc_eng_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY item_orc_eng_all ON public.item_orcamentario TO authenticated USING (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(obra_id, auth.uid()))) WITH CHECK (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(obra_id, auth.uid())));


--
-- Name: item_orcamentario item_orc_god_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY item_orc_god_all ON public.item_orcamentario TO authenticated USING ((public.auth_role() = 'god'::public.role_enum)) WITH CHECK ((public.auth_role() = 'god'::public.role_enum));


--
-- Name: item_orcamentario; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.item_orcamentario ENABLE ROW LEVEL SECURITY;

--
-- Name: planejamento_lb_premissa lb_premissa_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lb_premissa_select ON public.planejamento_lb_premissa FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.planejamento p
  WHERE (p.id = planejamento_lb_premissa.planejamento_id))));


--
-- Name: planejamento_recurso_limite limite_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY limite_select ON public.planejamento_recurso_limite FOR SELECT USING (public.pode_ver_obra(public.planejamento_obra(planejamento_id)));


--
-- Name: planejamento_recurso_limite limite_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY limite_write ON public.planejamento_recurso_limite USING (public.pode_planejar_obra(public.planejamento_obra(planejamento_id))) WITH CHECK (public.pode_planejar_obra(public.planejamento_obra(planejamento_id)));


--
-- Name: planejamento_tarefa_local local_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY local_select ON public.planejamento_tarefa_local FOR SELECT USING (public.pode_ver_obra(public.planejamento_obra(planejamento_id)));


--
-- Name: planejamento_tarefa_local local_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY local_write ON public.planejamento_tarefa_local USING (public.pode_planejar_obra(public.planejamento_obra(planejamento_id))) WITH CHECK (public.pode_planejar_obra(public.planejamento_obra(planejamento_id)));


--
-- Name: planejamento_marco marco_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY marco_select ON public.planejamento_marco FOR SELECT USING (public.pode_ver_obra(public.planejamento_obra(planejamento_id)));


--
-- Name: planejamento_marco marco_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY marco_write ON public.planejamento_marco USING (public.pode_planejar_obra(public.planejamento_obra(planejamento_id))) WITH CHECK (public.pode_planejar_obra(public.planejamento_obra(planejamento_id)));


--
-- Name: mcp_oauth_cliente; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mcp_oauth_cliente ENABLE ROW LEVEL SECURITY;

--
-- Name: mcp_oauth_codigo; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mcp_oauth_codigo ENABLE ROW LEVEL SECURITY;

--
-- Name: mcp_token; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mcp_token ENABLE ROW LEVEL SECURITY;

--
-- Name: mcp_token mcp_token_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mcp_token_select ON public.mcp_token FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: memoria_calculo_item memoria_adm_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY memoria_adm_all ON public.memoria_calculo_item TO authenticated USING (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(obra_id) = public.auth_empresa_id()))) WITH CHECK (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(obra_id) = public.auth_empresa_id())));


--
-- Name: memoria_calculo_item memoria_apoio_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY memoria_apoio_select ON public.memoria_calculo_item FOR SELECT TO authenticated USING (((public.auth_role() = 'apoio'::public.role_enum) AND public.has_obra_permissao(obra_id, public.auth_engenheiro_id())));


--
-- Name: memoria_calculo_item; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.memoria_calculo_item ENABLE ROW LEVEL SECURITY;

--
-- Name: memoria_calculo_item memoria_eng_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY memoria_eng_all ON public.memoria_calculo_item TO authenticated USING (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(obra_id, auth.uid()))) WITH CHECK (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(obra_id, auth.uid())));


--
-- Name: memoria_calculo_item memoria_god_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY memoria_god_all ON public.memoria_calculo_item TO authenticated USING ((public.auth_role() = 'god'::public.role_enum)) WITH CHECK ((public.auth_role() = 'god'::public.role_enum));


--
-- Name: obra_fleet_obra; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.obra_fleet_obra ENABLE ROW LEVEL SECURITY;

--
-- Name: obra_fleet_obra obra_fleet_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY obra_fleet_select ON public.obra_fleet_obra FOR SELECT TO authenticated USING ((public.pode_ver_obra(obra_id) OR public.pode_lancar_producao(obra_id)));


--
-- Name: obra_fleet_obra obra_fleet_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY obra_fleet_write ON public.obra_fleet_obra TO authenticated USING (public.pode_planejar_obra(obra_id)) WITH CHECK (public.pode_planejar_obra(obra_id));


--
-- Name: obra_permissoes obra_perm_adm_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY obra_perm_adm_all ON public.obra_permissoes TO authenticated USING (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(obra_id) = public.auth_empresa_id()))) WITH CHECK (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(obra_id) = public.auth_empresa_id())));


--
-- Name: obra_permissoes obra_perm_apoio_select_via_eng; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY obra_perm_apoio_select_via_eng ON public.obra_permissoes FOR SELECT TO authenticated USING (((public.auth_role() = 'apoio'::public.role_enum) AND (user_id = public.auth_engenheiro_id())));


--
-- Name: obra_permissoes obra_perm_eng_select_suas_obras; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY obra_perm_eng_select_suas_obras ON public.obra_permissoes FOR SELECT USING (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(obra_id, auth.uid())));


--
-- Name: obra_permissoes obra_perm_god_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY obra_perm_god_all ON public.obra_permissoes TO authenticated USING ((public.auth_role() = 'god'::public.role_enum)) WITH CHECK ((public.auth_role() = 'god'::public.role_enum));


--
-- Name: obra_permissoes obra_perm_user_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY obra_perm_user_select_own ON public.obra_permissoes FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: obra_permissoes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.obra_permissoes ENABLE ROW LEVEL SECURITY;

--
-- Name: obra_produtividade_mes obra_prod_adm_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY obra_prod_adm_all ON public.obra_produtividade_mes TO authenticated USING (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(obra_id) = public.auth_empresa_id()))) WITH CHECK (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(obra_id) = public.auth_empresa_id())));


--
-- Name: obra_produtividade_mes obra_prod_apoio_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY obra_prod_apoio_select ON public.obra_produtividade_mes FOR SELECT TO authenticated USING (((public.auth_role() = 'apoio'::public.role_enum) AND public.has_obra_permissao(obra_id, public.auth_engenheiro_id())));


--
-- Name: obra_produtividade_mes obra_prod_eng_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY obra_prod_eng_all ON public.obra_produtividade_mes TO authenticated USING (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(obra_id, auth.uid()))) WITH CHECK (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(obra_id, auth.uid())));


--
-- Name: obra_produtividade_mes obra_prod_god_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY obra_prod_god_all ON public.obra_produtividade_mes TO authenticated USING ((public.auth_role() = 'god'::public.role_enum)) WITH CHECK ((public.auth_role() = 'god'::public.role_enum));


--
-- Name: obra_produtividade_mes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.obra_produtividade_mes ENABLE ROW LEVEL SECURITY;

--
-- Name: obra_trecho; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.obra_trecho ENABLE ROW LEVEL SECURITY;

--
-- Name: obra_trecho obra_trecho_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY obra_trecho_select ON public.obra_trecho FOR SELECT USING (public.pode_ver_obra(obra_id));


--
-- Name: obra_trecho obra_trecho_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY obra_trecho_write ON public.obra_trecho USING (public.pode_planejar_obra(obra_id)) WITH CHECK (public.pode_planejar_obra(obra_id));


--
-- Name: obras; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.obras ENABLE ROW LEVEL SECURITY;

--
-- Name: obras obras_adm_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY obras_adm_select ON public.obras FOR SELECT TO authenticated USING (((public.auth_role() = 'adm'::public.role_enum) AND (empresa_id = public.auth_empresa_id())));


--
-- Name: obras obras_adm_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY obras_adm_write ON public.obras TO authenticated USING (((public.auth_role() = 'adm'::public.role_enum) AND (empresa_id = public.auth_empresa_id()))) WITH CHECK (((public.auth_role() = 'adm'::public.role_enum) AND (empresa_id = public.auth_empresa_id())));


--
-- Name: obras obras_apoio_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY obras_apoio_select ON public.obras FOR SELECT TO authenticated USING (((public.auth_role() = 'apoio'::public.role_enum) AND public.has_obra_permissao(id, public.auth_engenheiro_id())));


--
-- Name: obras obras_cliente_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY obras_cliente_select ON public.obras FOR SELECT TO authenticated USING (((public.auth_role() = 'cliente'::public.role_enum) AND public.has_obra_permissao(id, auth.uid())));


--
-- Name: obras obras_engenheiro_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY obras_engenheiro_select ON public.obras FOR SELECT TO authenticated USING (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(id, auth.uid())));


--
-- Name: obras obras_god_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY obras_god_select ON public.obras FOR SELECT TO authenticated USING ((public.auth_role() = 'god'::public.role_enum));


--
-- Name: obras obras_god_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY obras_god_write ON public.obras TO authenticated USING ((public.auth_role() = 'god'::public.role_enum)) WITH CHECK ((public.auth_role() = 'god'::public.role_enum));


--
-- Name: orcamento_aditivo; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.orcamento_aditivo ENABLE ROW LEVEL SECURITY;

--
-- Name: orcamento_aditivo_item; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.orcamento_aditivo_item ENABLE ROW LEVEL SECURITY;

--
-- Name: orcamento_aditivo_item orcamento_aditivo_item_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY orcamento_aditivo_item_select ON public.orcamento_aditivo_item FOR SELECT USING (((public.auth_role() = 'god'::public.role_enum) OR ((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(obra_id) = public.auth_empresa_id())) OR ((public.auth_role() = ANY (ARRAY['engenheiro'::public.role_enum, 'cliente'::public.role_enum])) AND public.has_obra_permissao(obra_id, auth.uid())) OR ((public.auth_role() = 'apoio'::public.role_enum) AND public.has_obra_permissao(obra_id, public.auth_engenheiro_id()))));


--
-- Name: orcamento_aditivo_item orcamento_aditivo_item_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY orcamento_aditivo_item_write ON public.orcamento_aditivo_item USING (public.pode_editar_orcamento(obra_id)) WITH CHECK (public.pode_editar_orcamento(obra_id));


--
-- Name: orcamento_aditivo orcamento_aditivo_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY orcamento_aditivo_select ON public.orcamento_aditivo FOR SELECT USING (((public.auth_role() = 'god'::public.role_enum) OR ((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(obra_id) = public.auth_empresa_id())) OR ((public.auth_role() = ANY (ARRAY['engenheiro'::public.role_enum, 'cliente'::public.role_enum])) AND public.has_obra_permissao(obra_id, auth.uid())) OR ((public.auth_role() = 'apoio'::public.role_enum) AND public.has_obra_permissao(obra_id, public.auth_engenheiro_id()))));


--
-- Name: orcamento_aditivo orcamento_aditivo_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY orcamento_aditivo_write ON public.orcamento_aditivo USING (public.pode_editar_orcamento(obra_id)) WITH CHECK (public.pode_editar_orcamento(obra_id));


--
-- Name: orcamento_planilha_inicial; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.orcamento_planilha_inicial ENABLE ROW LEVEL SECURITY;

--
-- Name: orcamento_planilha_inicial orcamento_planilha_inicial_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY orcamento_planilha_inicial_select ON public.orcamento_planilha_inicial FOR SELECT USING (((public.auth_role() = 'god'::public.role_enum) OR ((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(obra_id) = public.auth_empresa_id())) OR ((public.auth_role() = ANY (ARRAY['engenheiro'::public.role_enum, 'cliente'::public.role_enum])) AND public.has_obra_permissao(obra_id, auth.uid())) OR ((public.auth_role() = 'apoio'::public.role_enum) AND public.has_obra_permissao(obra_id, public.auth_engenheiro_id()))));


--
-- Name: orcamento_reajuste; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.orcamento_reajuste ENABLE ROW LEVEL SECURITY;

--
-- Name: orcamento_reajuste_grupo; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.orcamento_reajuste_grupo ENABLE ROW LEVEL SECURITY;

--
-- Name: orcamento_reajuste_grupo orcamento_reajuste_grupo_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY orcamento_reajuste_grupo_select ON public.orcamento_reajuste_grupo FOR SELECT USING (((public.auth_role() = 'god'::public.role_enum) OR ((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(obra_id) = public.auth_empresa_id())) OR ((public.auth_role() = ANY (ARRAY['engenheiro'::public.role_enum, 'cliente'::public.role_enum])) AND public.has_obra_permissao(obra_id, auth.uid())) OR ((public.auth_role() = 'apoio'::public.role_enum) AND public.has_obra_permissao(obra_id, public.auth_engenheiro_id()))));


--
-- Name: orcamento_reajuste_grupo orcamento_reajuste_grupo_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY orcamento_reajuste_grupo_write ON public.orcamento_reajuste_grupo USING (public.pode_editar_orcamento(obra_id)) WITH CHECK (public.pode_editar_orcamento(obra_id));


--
-- Name: orcamento_reajuste_item; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.orcamento_reajuste_item ENABLE ROW LEVEL SECURITY;

--
-- Name: orcamento_reajuste_item orcamento_reajuste_item_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY orcamento_reajuste_item_select ON public.orcamento_reajuste_item FOR SELECT USING (((public.auth_role() = 'god'::public.role_enum) OR ((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(obra_id) = public.auth_empresa_id())) OR ((public.auth_role() = ANY (ARRAY['engenheiro'::public.role_enum, 'cliente'::public.role_enum])) AND public.has_obra_permissao(obra_id, auth.uid())) OR ((public.auth_role() = 'apoio'::public.role_enum) AND public.has_obra_permissao(obra_id, public.auth_engenheiro_id()))));


--
-- Name: orcamento_reajuste_item orcamento_reajuste_item_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY orcamento_reajuste_item_write ON public.orcamento_reajuste_item USING (public.pode_editar_orcamento(obra_id)) WITH CHECK (public.pode_editar_orcamento(obra_id));


--
-- Name: orcamento_reajuste orcamento_reajuste_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY orcamento_reajuste_select ON public.orcamento_reajuste FOR SELECT USING (((public.auth_role() = 'god'::public.role_enum) OR ((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(obra_id) = public.auth_empresa_id())) OR ((public.auth_role() = ANY (ARRAY['engenheiro'::public.role_enum, 'cliente'::public.role_enum])) AND public.has_obra_permissao(obra_id, auth.uid())) OR ((public.auth_role() = 'apoio'::public.role_enum) AND public.has_obra_permissao(obra_id, public.auth_engenheiro_id()))));


--
-- Name: orcamento_reajuste orcamento_reajuste_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY orcamento_reajuste_write ON public.orcamento_reajuste USING (public.pode_editar_orcamento(obra_id)) WITH CHECK (public.pode_editar_orcamento(obra_id));


--
-- Name: orcamento_recalculo_pendente; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.orcamento_recalculo_pendente ENABLE ROW LEVEL SECURITY;

--
-- Name: planejamento_tarefa_perfil_dia perfil_dia_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY perfil_dia_select ON public.planejamento_tarefa_perfil_dia FOR SELECT USING (public.pode_ver_obra(public.tarefa_obra(tarefa_id)));


--
-- Name: planejamento_dependencia plan_dep_adm_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY plan_dep_adm_all ON public.planejamento_dependencia TO authenticated USING (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(public.planejamento_obra(planejamento_id)) = public.auth_empresa_id()))) WITH CHECK (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(public.planejamento_obra(planejamento_id)) = public.auth_empresa_id())));


--
-- Name: planejamento_dependencia plan_dep_apoio_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY plan_dep_apoio_select ON public.planejamento_dependencia FOR SELECT TO authenticated USING (((public.auth_role() = 'apoio'::public.role_enum) AND public.has_obra_permissao(public.planejamento_obra(planejamento_id), public.auth_engenheiro_id())));


--
-- Name: planejamento_dependencia plan_dep_eng_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY plan_dep_eng_all ON public.planejamento_dependencia TO authenticated USING (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(public.planejamento_obra(planejamento_id), auth.uid()))) WITH CHECK (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(public.planejamento_obra(planejamento_id), auth.uid())));


--
-- Name: planejamento_dependencia plan_dep_god_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY plan_dep_god_all ON public.planejamento_dependencia TO authenticated USING ((public.auth_role() = 'god'::public.role_enum)) WITH CHECK ((public.auth_role() = 'god'::public.role_enum));


--
-- Name: planejamento_tarefa_equipe plan_tar_eq_adm_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY plan_tar_eq_adm_all ON public.planejamento_tarefa_equipe TO authenticated USING (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(public.tarefa_obra(tarefa_id)) = public.auth_empresa_id()))) WITH CHECK (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(public.tarefa_obra(tarefa_id)) = public.auth_empresa_id())));


--
-- Name: planejamento_tarefa_equipe plan_tar_eq_apoio_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY plan_tar_eq_apoio_select ON public.planejamento_tarefa_equipe FOR SELECT TO authenticated USING (((public.auth_role() = 'apoio'::public.role_enum) AND public.has_obra_permissao(public.tarefa_obra(tarefa_id), public.auth_engenheiro_id())));


--
-- Name: planejamento_tarefa_equipe plan_tar_eq_eng_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY plan_tar_eq_eng_all ON public.planejamento_tarefa_equipe TO authenticated USING (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(public.tarefa_obra(tarefa_id), auth.uid()))) WITH CHECK (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(public.tarefa_obra(tarefa_id), auth.uid())));


--
-- Name: planejamento_tarefa_equipe plan_tar_eq_god_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY plan_tar_eq_god_all ON public.planejamento_tarefa_equipe TO authenticated USING ((public.auth_role() = 'god'::public.role_enum)) WITH CHECK ((public.auth_role() = 'god'::public.role_enum));


--
-- Name: planejamento_tarefa plan_tarefa_adm_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY plan_tarefa_adm_all ON public.planejamento_tarefa TO authenticated USING (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(public.planejamento_obra(planejamento_id)) = public.auth_empresa_id()))) WITH CHECK (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(public.planejamento_obra(planejamento_id)) = public.auth_empresa_id())));


--
-- Name: planejamento_tarefa plan_tarefa_apoio_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY plan_tarefa_apoio_select ON public.planejamento_tarefa FOR SELECT TO authenticated USING (((public.auth_role() = 'apoio'::public.role_enum) AND public.has_obra_permissao(public.planejamento_obra(planejamento_id), public.auth_engenheiro_id())));


--
-- Name: planejamento_tarefa plan_tarefa_eng_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY plan_tarefa_eng_all ON public.planejamento_tarefa TO authenticated USING (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(public.planejamento_obra(planejamento_id), auth.uid()))) WITH CHECK (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(public.planejamento_obra(planejamento_id), auth.uid())));


--
-- Name: planejamento_tarefa plan_tarefa_god_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY plan_tarefa_god_all ON public.planejamento_tarefa TO authenticated USING ((public.auth_role() = 'god'::public.role_enum)) WITH CHECK ((public.auth_role() = 'god'::public.role_enum));


--
-- Name: planejamento; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.planejamento ENABLE ROW LEVEL SECURITY;

--
-- Name: planejamento planejamento_adm_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY planejamento_adm_all ON public.planejamento TO authenticated USING (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(obra_id) = public.auth_empresa_id()))) WITH CHECK (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(obra_id) = public.auth_empresa_id())));


--
-- Name: planejamento planejamento_apoio_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY planejamento_apoio_select ON public.planejamento FOR SELECT TO authenticated USING (((public.auth_role() = 'apoio'::public.role_enum) AND public.has_obra_permissao(obra_id, public.auth_engenheiro_id())));


--
-- Name: planejamento_dependencia; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.planejamento_dependencia ENABLE ROW LEVEL SECURITY;

--
-- Name: planejamento planejamento_eng_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY planejamento_eng_all ON public.planejamento TO authenticated USING (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(obra_id, auth.uid()))) WITH CHECK (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(obra_id, auth.uid())));


--
-- Name: planejamento planejamento_god_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY planejamento_god_all ON public.planejamento TO authenticated USING ((public.auth_role() = 'god'::public.role_enum)) WITH CHECK ((public.auth_role() = 'god'::public.role_enum));


--
-- Name: planejamento_lb_premissa; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.planejamento_lb_premissa ENABLE ROW LEVEL SECURITY;

--
-- Name: planejamento_marco; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.planejamento_marco ENABLE ROW LEVEL SECURITY;

--
-- Name: planejamento_recurso_limite; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.planejamento_recurso_limite ENABLE ROW LEVEL SECURITY;

--
-- Name: planejamento_tarefa; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.planejamento_tarefa ENABLE ROW LEVEL SECURITY;

--
-- Name: planejamento_tarefa_equipe; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.planejamento_tarefa_equipe ENABLE ROW LEVEL SECURITY;

--
-- Name: planejamento_tarefa_indireto; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.planejamento_tarefa_indireto ENABLE ROW LEVEL SECURITY;

--
-- Name: planejamento_tarefa_local; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.planejamento_tarefa_local ENABLE ROW LEVEL SECURITY;

--
-- Name: planejamento_tarefa_perfil_dia; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.planejamento_tarefa_perfil_dia ENABLE ROW LEVEL SECURITY;

--
-- Name: planejamento_tarefa_perfil_semana; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.planejamento_tarefa_perfil_semana ENABLE ROW LEVEL SECURITY;

--
-- Name: planejamento_tarefa_wp; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.planejamento_tarefa_wp ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_adm_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_adm_insert ON public.profiles FOR INSERT TO authenticated WITH CHECK (((public.auth_role() = 'adm'::public.role_enum) AND (empresa_id = public.auth_empresa_id()) AND (role = ANY (ARRAY['adm'::public.role_enum, 'engenheiro'::public.role_enum, 'apoio'::public.role_enum]))));


--
-- Name: profiles profiles_adm_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_adm_update ON public.profiles FOR UPDATE TO authenticated USING (((public.auth_role() = 'adm'::public.role_enum) AND (empresa_id = public.auth_empresa_id()))) WITH CHECK (((public.auth_role() = 'adm'::public.role_enum) AND (empresa_id = public.auth_empresa_id())));


--
-- Name: profiles profiles_engenheiro_insert_apoio; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_engenheiro_insert_apoio ON public.profiles FOR INSERT TO authenticated WITH CHECK (((public.auth_role() = 'engenheiro'::public.role_enum) AND (role = 'apoio'::public.role_enum) AND (engenheiro_id = auth.uid()) AND (empresa_id = public.auth_empresa_id())));


--
-- Name: profiles profiles_god_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_god_insert ON public.profiles FOR INSERT TO authenticated WITH CHECK ((public.auth_role() = 'god'::public.role_enum));


--
-- Name: profiles profiles_god_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_god_select ON public.profiles FOR SELECT TO authenticated USING ((public.auth_role() = 'god'::public.role_enum));


--
-- Name: profiles profiles_god_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_god_update ON public.profiles FOR UPDATE TO authenticated USING ((public.auth_role() = 'god'::public.role_enum)) WITH CHECK ((public.auth_role() = 'god'::public.role_enum));


--
-- Name: profiles profiles_self_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_self_select ON public.profiles FOR SELECT TO authenticated USING ((id = auth.uid()));


--
-- Name: profiles profiles_self_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_self_update ON public.profiles FOR UPDATE TO authenticated USING ((id = auth.uid())) WITH CHECK ((id = auth.uid()));


--
-- Name: profiles profiles_user_select_empresa; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_user_select_empresa ON public.profiles FOR SELECT TO authenticated USING (((public.auth_role() = ANY (ARRAY['adm'::public.role_enum, 'engenheiro'::public.role_enum, 'apoio'::public.role_enum])) AND (empresa_id = public.auth_empresa_id()) AND (role <> 'god'::public.role_enum)));


--
-- Name: planejamento_tarefa_indireto pti_adm_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pti_adm_all ON public.planejamento_tarefa_indireto TO authenticated USING (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(public.tarefa_obra(tarefa_id)) = public.auth_empresa_id()))) WITH CHECK (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(public.tarefa_obra(tarefa_id)) = public.auth_empresa_id())));


--
-- Name: planejamento_tarefa_indireto pti_apoio_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pti_apoio_select ON public.planejamento_tarefa_indireto FOR SELECT TO authenticated USING (((public.auth_role() = 'apoio'::public.role_enum) AND public.has_obra_permissao(public.tarefa_obra(tarefa_id), public.auth_engenheiro_id())));


--
-- Name: planejamento_tarefa_indireto pti_eng_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pti_eng_all ON public.planejamento_tarefa_indireto TO authenticated USING (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(public.tarefa_obra(tarefa_id), auth.uid()))) WITH CHECK (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(public.tarefa_obra(tarefa_id), auth.uid())));


--
-- Name: planejamento_tarefa_indireto pti_god_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pti_god_all ON public.planejamento_tarefa_indireto TO authenticated USING ((public.auth_role() = 'god'::public.role_enum)) WITH CHECK ((public.auth_role() = 'god'::public.role_enum));


--
-- Name: planejamento_tarefa_perfil_semana ptps_adm_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ptps_adm_all ON public.planejamento_tarefa_perfil_semana TO authenticated USING (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(public.tarefa_obra(tarefa_id)) = public.auth_empresa_id()))) WITH CHECK (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(public.tarefa_obra(tarefa_id)) = public.auth_empresa_id())));


--
-- Name: planejamento_tarefa_perfil_semana ptps_apoio_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ptps_apoio_select ON public.planejamento_tarefa_perfil_semana FOR SELECT TO authenticated USING (((public.auth_role() = 'apoio'::public.role_enum) AND public.has_obra_permissao(public.tarefa_obra(tarefa_id), public.auth_engenheiro_id())));


--
-- Name: planejamento_tarefa_perfil_semana ptps_eng_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ptps_eng_all ON public.planejamento_tarefa_perfil_semana TO authenticated USING (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(public.tarefa_obra(tarefa_id), auth.uid()))) WITH CHECK (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(public.tarefa_obra(tarefa_id), auth.uid())));


--
-- Name: planejamento_tarefa_perfil_semana ptps_god_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ptps_god_all ON public.planejamento_tarefa_perfil_semana TO authenticated USING ((public.auth_role() = 'god'::public.role_enum)) WITH CHECK ((public.auth_role() = 'god'::public.role_enum));


--
-- Name: recurso; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.recurso ENABLE ROW LEVEL SECURITY;

--
-- Name: recurso recurso_adm_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recurso_adm_all ON public.recurso TO authenticated USING (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(obra_id) = public.auth_empresa_id()))) WITH CHECK (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(obra_id) = public.auth_empresa_id())));


--
-- Name: recurso recurso_apoio_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recurso_apoio_select ON public.recurso FOR SELECT TO authenticated USING (((public.auth_role() = 'apoio'::public.role_enum) AND public.has_obra_permissao(obra_id, public.auth_engenheiro_id())));


--
-- Name: recurso recurso_eng_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recurso_eng_all ON public.recurso TO authenticated USING (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(obra_id, auth.uid()))) WITH CHECK (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(obra_id, auth.uid())));


--
-- Name: recurso recurso_god_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recurso_god_all ON public.recurso TO authenticated USING ((public.auth_role() = 'god'::public.role_enum)) WITH CHECK ((public.auth_role() = 'god'::public.role_enum));


--
-- Name: recurso_preco; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.recurso_preco ENABLE ROW LEVEL SECURITY;

--
-- Name: recurso_preco recurso_preco_adm_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recurso_preco_adm_all ON public.recurso_preco TO authenticated USING (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(public.recurso_obra(recurso_id)) = public.auth_empresa_id()))) WITH CHECK (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(public.recurso_obra(recurso_id)) = public.auth_empresa_id())));


--
-- Name: recurso_preco recurso_preco_apoio_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recurso_preco_apoio_select ON public.recurso_preco FOR SELECT TO authenticated USING (((public.auth_role() = 'apoio'::public.role_enum) AND public.has_obra_permissao(public.recurso_obra(recurso_id), public.auth_engenheiro_id())));


--
-- Name: recurso_preco recurso_preco_eng_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recurso_preco_eng_all ON public.recurso_preco TO authenticated USING (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(public.recurso_obra(recurso_id), auth.uid()))) WITH CHECK (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(public.recurso_obra(recurso_id), auth.uid())));


--
-- Name: recurso_preco recurso_preco_god_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recurso_preco_god_all ON public.recurso_preco TO authenticated USING ((public.auth_role() = 'god'::public.role_enum)) WITH CHECK ((public.auth_role() = 'god'::public.role_enum));


--
-- Name: servico_dependencia servdep_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY servdep_select ON public.servico_dependencia FOR SELECT USING (public.pode_ver_obra(obra_id));


--
-- Name: servico_dependencia servdep_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY servdep_write ON public.servico_dependencia USING (public.pode_planejar_obra(obra_id)) WITH CHECK (public.pode_planejar_obra(obra_id));


--
-- Name: servico; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.servico ENABLE ROW LEVEL SECURITY;

--
-- Name: servico servico_adm_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY servico_adm_all ON public.servico TO authenticated USING (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(obra_id) = public.auth_empresa_id()))) WITH CHECK (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(obra_id) = public.auth_empresa_id())));


--
-- Name: servico servico_apoio_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY servico_apoio_select ON public.servico FOR SELECT TO authenticated USING (((public.auth_role() = 'apoio'::public.role_enum) AND public.has_obra_permissao(obra_id, public.auth_engenheiro_id())));


--
-- Name: servico_cpu_link; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.servico_cpu_link ENABLE ROW LEVEL SECURITY;

--
-- Name: servico_cpu_link servico_cpu_link_adm_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY servico_cpu_link_adm_all ON public.servico_cpu_link TO authenticated USING (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(public.servico_obra(servico_id)) = public.auth_empresa_id()))) WITH CHECK (((public.auth_role() = 'adm'::public.role_enum) AND (public.obra_empresa(public.servico_obra(servico_id)) = public.auth_empresa_id())));


--
-- Name: servico_cpu_link servico_cpu_link_apoio_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY servico_cpu_link_apoio_select ON public.servico_cpu_link FOR SELECT TO authenticated USING (((public.auth_role() = 'apoio'::public.role_enum) AND public.has_obra_permissao(public.servico_obra(servico_id), public.auth_engenheiro_id())));


--
-- Name: servico_cpu_link servico_cpu_link_eng_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY servico_cpu_link_eng_all ON public.servico_cpu_link TO authenticated USING (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(public.servico_obra(servico_id), auth.uid()))) WITH CHECK (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(public.servico_obra(servico_id), auth.uid())));


--
-- Name: servico_cpu_link servico_cpu_link_god_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY servico_cpu_link_god_all ON public.servico_cpu_link TO authenticated USING ((public.auth_role() = 'god'::public.role_enum)) WITH CHECK ((public.auth_role() = 'god'::public.role_enum));


--
-- Name: servico_dependencia; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.servico_dependencia ENABLE ROW LEVEL SECURITY;

--
-- Name: servico servico_eng_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY servico_eng_all ON public.servico TO authenticated USING (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(obra_id, auth.uid()))) WITH CHECK (((public.auth_role() = 'engenheiro'::public.role_enum) AND public.has_obra_permissao(obra_id, auth.uid())));


--
-- Name: servico servico_god_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY servico_god_all ON public.servico TO authenticated USING ((public.auth_role() = 'god'::public.role_enum)) WITH CHECK ((public.auth_role() = 'god'::public.role_enum));


--
-- Name: servico_parametro; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.servico_parametro ENABLE ROW LEVEL SECURITY;

--
-- Name: servico_parametro sp_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sp_select ON public.servico_parametro FOR SELECT TO authenticated USING ((public.pode_ver_obra(obra_id) OR public.pode_lancar_producao(obra_id)));


--
-- Name: servico_parametro sp_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sp_write ON public.servico_parametro TO authenticated USING (public.pode_planejar_obra(obra_id)) WITH CHECK (public.pode_planejar_obra(obra_id));


--
-- Name: trecho_quantidade_celula tqce_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tqce_select ON public.trecho_quantidade_celula FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.trecho_quantidade_segmento s
  WHERE (s.id = trecho_quantidade_celula.segmento_id))));


--
-- Name: trecho_quantidade_coluna tqco_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tqco_select ON public.trecho_quantidade_coluna FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.trecho_quantidade_versao v
  WHERE (v.id = trecho_quantidade_coluna.versao_id))));


--
-- Name: trecho_quantidade_mapeamento tqm_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tqm_select ON public.trecho_quantidade_mapeamento FOR SELECT USING (public.pode_ver_obra(obra_id));


--
-- Name: trecho_quantidade_mapeamento tqm_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tqm_write ON public.trecho_quantidade_mapeamento USING (public.pode_planejar_obra(obra_id)) WITH CHECK (public.pode_planejar_obra(obra_id));


--
-- Name: trecho_quantidade_segmento tqs_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tqs_select ON public.trecho_quantidade_segmento FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.trecho_quantidade_versao v
  WHERE (v.id = trecho_quantidade_segmento.versao_id))));


--
-- Name: trecho_quantidade_template tqt_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tqt_select ON public.trecho_quantidade_template FOR SELECT USING (public.pode_ver_obra(obra_id));


--
-- Name: trecho_quantidade_versao tqv_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tqv_select ON public.trecho_quantidade_versao FOR SELECT USING (public.pode_ver_obra(obra_id));


--
-- Name: transporte_local transp_local_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY transp_local_select ON public.transporte_local FOR SELECT TO authenticated USING ((public.pode_ver_acompanhamento(obra_id) OR public.pode_lancar_producao(obra_id)));


--
-- Name: transporte_local transp_local_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY transp_local_write ON public.transporte_local TO authenticated USING (((public.auth_role() = ANY (ARRAY['god'::public.role_enum, 'adm'::public.role_enum, 'engenheiro'::public.role_enum])) AND public.pode_lancar_producao(obra_id))) WITH CHECK (((public.auth_role() = ANY (ARRAY['god'::public.role_enum, 'adm'::public.role_enum, 'engenheiro'::public.role_enum])) AND public.pode_lancar_producao(obra_id)));


--
-- Name: transporte_rota transp_rota_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY transp_rota_select ON public.transporte_rota FOR SELECT TO authenticated USING ((public.pode_ver_acompanhamento(obra_id) OR public.pode_lancar_producao(obra_id)));


--
-- Name: transporte_rota transp_rota_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY transp_rota_write ON public.transporte_rota TO authenticated USING (((public.auth_role() = ANY (ARRAY['god'::public.role_enum, 'adm'::public.role_enum, 'engenheiro'::public.role_enum])) AND public.pode_lancar_producao(obra_id))) WITH CHECK (((public.auth_role() = ANY (ARRAY['god'::public.role_enum, 'adm'::public.role_enum, 'engenheiro'::public.role_enum])) AND public.pode_lancar_producao(obra_id)));


--
-- Name: transporte_local; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.transporte_local ENABLE ROW LEVEL SECURITY;

--
-- Name: transporte_rota; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.transporte_rota ENABLE ROW LEVEL SECURITY;

--
-- Name: trecho_quantidade_celula; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trecho_quantidade_celula ENABLE ROW LEVEL SECURITY;

--
-- Name: trecho_quantidade_coluna; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trecho_quantidade_coluna ENABLE ROW LEVEL SECURITY;

--
-- Name: trecho_quantidade_mapeamento; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trecho_quantidade_mapeamento ENABLE ROW LEVEL SECURITY;

--
-- Name: trecho_quantidade_segmento; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trecho_quantidade_segmento ENABLE ROW LEVEL SECURITY;

--
-- Name: trecho_quantidade_template; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trecho_quantidade_template ENABLE ROW LEVEL SECURITY;

--
-- Name: trecho_quantidade_versao; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trecho_quantidade_versao ENABLE ROW LEVEL SECURITY;

--
-- Name: viagem; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.viagem ENABLE ROW LEVEL SECURITY;

--
-- Name: viagem_ficha; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.viagem_ficha ENABLE ROW LEVEL SECURITY;

--
-- Name: viagem viagem_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY viagem_select ON public.viagem FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.viagem_ficha f
  WHERE (f.id = viagem.ficha_id))));


--
-- Name: viagem viagem_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY viagem_write ON public.viagem TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.viagem_ficha f
  WHERE ((f.id = viagem.ficha_id) AND public.pode_lancar_producao(f.obra_id) AND ((public.auth_role() <> ALL (ARRAY['apoio'::public.role_enum, 'apontador'::public.role_enum])) OR (f.criado_por = auth.uid())))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.viagem_ficha f
  WHERE ((f.id = viagem.ficha_id) AND public.pode_lancar_producao(f.obra_id) AND ((public.auth_role() <> ALL (ARRAY['apoio'::public.role_enum, 'apontador'::public.role_enum])) OR (f.criado_por = auth.uid()))))));


--
-- Name: planejamento_tarefa_wp wp_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wp_select ON public.planejamento_tarefa_wp FOR SELECT USING (public.pode_ver_obra(public.planejamento_obra(planejamento_id)));


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION acomp_producao_obra(_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.acomp_producao_obra(_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.acomp_producao_obra(_id uuid) TO anon;
GRANT ALL ON FUNCTION public.acomp_producao_obra(_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.acomp_producao_obra(_id uuid) TO service_role;


--
-- Name: FUNCTION acompanhamento_alertas_sincronizar(p_obra_id uuid, p_alertas jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.acompanhamento_alertas_sincronizar(p_obra_id uuid, p_alertas jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.acompanhamento_alertas_sincronizar(p_obra_id uuid, p_alertas jsonb) TO service_role;


--
-- Name: FUNCTION acompanhamento_perf_historico(p_servico_codigos text[], p_obra_atual uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.acompanhamento_perf_historico(p_servico_codigos text[], p_obra_atual uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.acompanhamento_perf_historico(p_servico_codigos text[], p_obra_atual uuid) TO anon;
GRANT ALL ON FUNCTION public.acompanhamento_perf_historico(p_servico_codigos text[], p_obra_atual uuid) TO authenticated;
GRANT ALL ON FUNCTION public.acompanhamento_perf_historico(p_servico_codigos text[], p_obra_atual uuid) TO service_role;


--
-- Name: FUNCTION alocar_receitas(_grupo_id uuid, _receita_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.alocar_receitas(_grupo_id uuid, _receita_ids uuid[]) TO anon;
GRANT ALL ON FUNCTION public.alocar_receitas(_grupo_id uuid, _receita_ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.alocar_receitas(_grupo_id uuid, _receita_ids uuid[]) TO service_role;


--
-- Name: FUNCTION aplicar_aditivo(_aditivo_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.aplicar_aditivo(_aditivo_id uuid) TO anon;
GRANT ALL ON FUNCTION public.aplicar_aditivo(_aditivo_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.aplicar_aditivo(_aditivo_id uuid) TO service_role;


--
-- Name: FUNCTION aplicar_reajuste(_reajuste_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.aplicar_reajuste(_reajuste_id uuid) TO anon;
GRANT ALL ON FUNCTION public.aplicar_reajuste(_reajuste_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.aplicar_reajuste(_reajuste_id uuid) TO service_role;


--
-- Name: FUNCTION atualizar_tarefa_indireta(p_tarefa_id uuid, p_indireto_config jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.atualizar_tarefa_indireta(p_tarefa_id uuid, p_indireto_config jsonb) TO anon;
GRANT ALL ON FUNCTION public.atualizar_tarefa_indireta(p_tarefa_id uuid, p_indireto_config jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.atualizar_tarefa_indireta(p_tarefa_id uuid, p_indireto_config jsonb) TO service_role;


--
-- Name: FUNCTION auth_empresa_id(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.auth_empresa_id() FROM PUBLIC;
GRANT ALL ON FUNCTION public.auth_empresa_id() TO anon;
GRANT ALL ON FUNCTION public.auth_empresa_id() TO authenticated;
GRANT ALL ON FUNCTION public.auth_empresa_id() TO service_role;


--
-- Name: FUNCTION auth_engenheiro_id(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.auth_engenheiro_id() FROM PUBLIC;
GRANT ALL ON FUNCTION public.auth_engenheiro_id() TO anon;
GRANT ALL ON FUNCTION public.auth_engenheiro_id() TO authenticated;
GRANT ALL ON FUNCTION public.auth_engenheiro_id() TO service_role;


--
-- Name: FUNCTION auth_role(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.auth_role() FROM PUBLIC;
GRANT ALL ON FUNCTION public.auth_role() TO anon;
GRANT ALL ON FUNCTION public.auth_role() TO authenticated;
GRANT ALL ON FUNCTION public.auth_role() TO service_role;


--
-- Name: FUNCTION cadeia_trava_motivo(_obra_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.cadeia_trava_motivo(_obra_id uuid) TO anon;
GRANT ALL ON FUNCTION public.cadeia_trava_motivo(_obra_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.cadeia_trava_motivo(_obra_id uuid) TO service_role;


--
-- Name: FUNCTION calendario_fingerprint(_obra_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.calendario_fingerprint(_obra_id uuid) TO anon;
GRANT ALL ON FUNCTION public.calendario_fingerprint(_obra_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.calendario_fingerprint(_obra_id uuid) TO service_role;


--
-- Name: FUNCTION calendario_obra(_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.calendario_obra(_id uuid) TO anon;
GRANT ALL ON FUNCTION public.calendario_obra(_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.calendario_obra(_id uuid) TO service_role;


--
-- Name: FUNCTION campo_assert(_obra_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.campo_assert(_obra_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.campo_assert(_obra_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.campo_assert(_obra_id uuid) TO service_role;


--
-- Name: FUNCTION campo_assert_painel(_obra_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.campo_assert_painel(_obra_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.campo_assert_painel(_obra_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.campo_assert_painel(_obra_id uuid) TO service_role;


--
-- Name: FUNCTION campo_catalogo(_obra_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.campo_catalogo(_obra_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.campo_catalogo(_obra_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.campo_catalogo(_obra_id uuid) TO service_role;


--
-- Name: FUNCTION campo_obras(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.campo_obras() FROM PUBLIC;
GRANT ALL ON FUNCTION public.campo_obras() TO authenticated;
GRANT ALL ON FUNCTION public.campo_obras() TO service_role;


--
-- Name: FUNCTION campo_painel(_obra_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.campo_painel(_obra_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.campo_painel(_obra_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.campo_painel(_obra_id uuid) TO service_role;


--
-- Name: FUNCTION campo_painel_base(_obra_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.campo_painel_base(_obra_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.campo_painel_base(_obra_id uuid) TO service_role;


--
-- Name: FUNCTION campo_registrar_foto(_meta jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.campo_registrar_foto(_meta jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.campo_registrar_foto(_meta jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.campo_registrar_foto(_meta jsonb) TO service_role;


--
-- Name: FUNCTION campo_sync_ficha(_ficha jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.campo_sync_ficha(_ficha jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.campo_sync_ficha(_ficha jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.campo_sync_ficha(_ficha jsonb) TO service_role;


--
-- Name: FUNCTION campo_sync_producao(_registros jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.campo_sync_producao(_registros jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.campo_sync_producao(_registros jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.campo_sync_producao(_registros jsonb) TO service_role;


--
-- Name: FUNCTION planejamento_referencia(_obra_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.planejamento_referencia(_obra_id uuid) TO anon;
GRANT ALL ON FUNCTION public.planejamento_referencia(_obra_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.planejamento_referencia(_obra_id uuid) TO service_role;


--
-- Name: TABLE acompanhamento_producao; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.acompanhamento_producao TO anon;
GRANT ALL ON TABLE public.acompanhamento_producao TO authenticated;
GRANT ALL ON TABLE public.acompanhamento_producao TO service_role;


--
-- Name: TABLE item_orcamentario; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.item_orcamentario TO anon;
GRANT ALL ON TABLE public.item_orcamentario TO authenticated;
GRANT ALL ON TABLE public.item_orcamentario TO service_role;


--
-- Name: TABLE planejamento; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.planejamento TO anon;
GRANT ALL ON TABLE public.planejamento TO authenticated;
GRANT ALL ON TABLE public.planejamento TO service_role;


--
-- Name: TABLE planejamento_tarefa; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.planejamento_tarefa TO anon;
GRANT ALL ON TABLE public.planejamento_tarefa TO authenticated;
GRANT ALL ON TABLE public.planejamento_tarefa TO service_role;


--
-- Name: TABLE planejamento_tarefa_perfil_dia; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.planejamento_tarefa_perfil_dia TO anon;
GRANT ALL ON TABLE public.planejamento_tarefa_perfil_dia TO authenticated;
GRANT ALL ON TABLE public.planejamento_tarefa_perfil_dia TO service_role;


--
-- Name: TABLE planejamento_tarefa_perfil_semana; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.planejamento_tarefa_perfil_semana TO anon;
GRANT ALL ON TABLE public.planejamento_tarefa_perfil_semana TO authenticated;
GRANT ALL ON TABLE public.planejamento_tarefa_perfil_semana TO service_role;


--
-- Name: TABLE vw_acompanhamento_curva_s; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vw_acompanhamento_curva_s TO anon;
GRANT ALL ON TABLE public.vw_acompanhamento_curva_s TO authenticated;
GRANT ALL ON TABLE public.vw_acompanhamento_curva_s TO service_role;


--
-- Name: FUNCTION cliente_curva_s(_obra_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cliente_curva_s(_obra_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cliente_curva_s(_obra_id uuid) TO anon;
GRANT ALL ON FUNCTION public.cliente_curva_s(_obra_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.cliente_curva_s(_obra_id uuid) TO service_role;


--
-- Name: TABLE cpu; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.cpu TO anon;
GRANT ALL ON TABLE public.cpu TO authenticated;
GRANT ALL ON TABLE public.cpu TO service_role;


--
-- Name: TABLE servico; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.servico TO anon;
GRANT ALL ON TABLE public.servico TO authenticated;
GRANT ALL ON TABLE public.servico TO service_role;


--
-- Name: TABLE servico_cpu_link; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.servico_cpu_link TO anon;
GRANT ALL ON TABLE public.servico_cpu_link TO authenticated;
GRANT ALL ON TABLE public.servico_cpu_link TO service_role;


--
-- Name: TABLE vw_servico_vivo; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vw_servico_vivo TO anon;
GRANT ALL ON TABLE public.vw_servico_vivo TO authenticated;
GRANT ALL ON TABLE public.vw_servico_vivo TO service_role;


--
-- Name: TABLE vw_acompanhamento_previsto_x_realizado; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vw_acompanhamento_previsto_x_realizado TO anon;
GRANT ALL ON TABLE public.vw_acompanhamento_previsto_x_realizado TO authenticated;
GRANT ALL ON TABLE public.vw_acompanhamento_previsto_x_realizado TO service_role;


--
-- Name: FUNCTION cliente_previsto_realizado(_obra_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cliente_previsto_realizado(_obra_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cliente_previsto_realizado(_obra_id uuid) TO anon;
GRANT ALL ON FUNCTION public.cliente_previsto_realizado(_obra_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.cliente_previsto_realizado(_obra_id uuid) TO service_role;


--
-- Name: TABLE acompanhamento_foto; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.acompanhamento_foto TO anon;
GRANT ALL ON TABLE public.acompanhamento_foto TO authenticated;
GRANT ALL ON TABLE public.acompanhamento_foto TO service_role;


--
-- Name: TABLE acompanhamento_producao_material; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.acompanhamento_producao_material TO anon;
GRANT ALL ON TABLE public.acompanhamento_producao_material TO authenticated;
GRANT ALL ON TABLE public.acompanhamento_producao_material TO service_role;


--
-- Name: TABLE encarregado; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.encarregado TO anon;
GRANT ALL ON TABLE public.encarregado TO authenticated;
GRANT ALL ON TABLE public.encarregado TO service_role;


--
-- Name: TABLE equipe; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.equipe TO anon;
GRANT ALL ON TABLE public.equipe TO authenticated;
GRANT ALL ON TABLE public.equipe TO service_role;


--
-- Name: TABLE obra_trecho; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.obra_trecho TO anon;
GRANT ALL ON TABLE public.obra_trecho TO authenticated;
GRANT ALL ON TABLE public.obra_trecho TO service_role;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.profiles TO anon;
GRANT ALL ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;


--
-- Name: TABLE vw_acompanhamento_producao_enriquecida; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vw_acompanhamento_producao_enriquecida TO anon;
GRANT ALL ON TABLE public.vw_acompanhamento_producao_enriquecida TO authenticated;
GRANT ALL ON TABLE public.vw_acompanhamento_producao_enriquecida TO service_role;


--
-- Name: FUNCTION cliente_producao(_obra_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cliente_producao(_obra_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cliente_producao(_obra_id uuid) TO anon;
GRANT ALL ON FUNCTION public.cliente_producao(_obra_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.cliente_producao(_obra_id uuid) TO service_role;


--
-- Name: FUNCTION cpu_obra(_cpu_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cpu_obra(_cpu_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cpu_obra(_cpu_id uuid) TO anon;
GRANT ALL ON FUNCTION public.cpu_obra(_cpu_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.cpu_obra(_cpu_id uuid) TO service_role;


--
-- Name: FUNCTION criar_tarefa_indireta(p_planejamento_id uuid, p_item_orcamentario_id uuid, p_indireto_config jsonb, p_parent_id uuid, p_nome_custom text, p_ordem integer, p_notas text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.criar_tarefa_indireta(p_planejamento_id uuid, p_item_orcamentario_id uuid, p_indireto_config jsonb, p_parent_id uuid, p_nome_custom text, p_ordem integer, p_notas text) TO anon;
GRANT ALL ON FUNCTION public.criar_tarefa_indireta(p_planejamento_id uuid, p_item_orcamentario_id uuid, p_indireto_config jsonb, p_parent_id uuid, p_nome_custom text, p_ordem integer, p_notas text) TO authenticated;
GRANT ALL ON FUNCTION public.criar_tarefa_indireta(p_planejamento_id uuid, p_item_orcamentario_id uuid, p_indireto_config jsonb, p_parent_id uuid, p_nome_custom text, p_ordem integer, p_notas text) TO service_role;


--
-- Name: FUNCTION definir_data_base(_obra_id uuid, _data date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.definir_data_base(_obra_id uuid, _data date) TO anon;
GRANT ALL ON FUNCTION public.definir_data_base(_obra_id uuid, _data date) TO authenticated;
GRANT ALL ON FUNCTION public.definir_data_base(_obra_id uuid, _data date) TO service_role;


--
-- Name: FUNCTION desmarcar_vigente(_obra_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.desmarcar_vigente(_obra_id uuid) TO anon;
GRANT ALL ON FUNCTION public.desmarcar_vigente(_obra_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.desmarcar_vigente(_obra_id uuid) TO service_role;


--
-- Name: FUNCTION diagnostico_cron(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.diagnostico_cron() FROM PUBLIC;
GRANT ALL ON FUNCTION public.diagnostico_cron() TO authenticated;
GRANT ALL ON FUNCTION public.diagnostico_cron() TO service_role;


--
-- Name: FUNCTION excluindo_obra(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.excluindo_obra() TO anon;
GRANT ALL ON FUNCTION public.excluindo_obra() TO authenticated;
GRANT ALL ON FUNCTION public.excluindo_obra() TO service_role;


--
-- Name: FUNCTION excluir_obra(_obra_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.excluir_obra(_obra_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.excluir_obra(_obra_id uuid) TO service_role;


--
-- Name: FUNCTION fleethub_credencial(_empresa_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fleethub_credencial(_empresa_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fleethub_credencial(_empresa_id uuid) TO service_role;


--
-- Name: FUNCTION fleethub_gravar_credencial(_empresa_id uuid, _email text, _senha text, _por uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fleethub_gravar_credencial(_empresa_id uuid, _email text, _senha text, _por uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fleethub_gravar_credencial(_empresa_id uuid, _email text, _senha text, _por uuid) TO service_role;


--
-- Name: FUNCTION fleethub_remover_credencial(_empresa_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fleethub_remover_credencial(_empresa_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fleethub_remover_credencial(_empresa_id uuid) TO service_role;


--
-- Name: FUNCTION fn_acomp_foto_before_insert(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_acomp_foto_before_insert() TO anon;
GRANT ALL ON FUNCTION public.fn_acomp_foto_before_insert() TO authenticated;
GRANT ALL ON FUNCTION public.fn_acomp_foto_before_insert() TO service_role;


--
-- Name: FUNCTION fn_acomp_foto_update_whitelist(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_acomp_foto_update_whitelist() TO anon;
GRANT ALL ON FUNCTION public.fn_acomp_foto_update_whitelist() TO authenticated;
GRANT ALL ON FUNCTION public.fn_acomp_foto_update_whitelist() TO service_role;


--
-- Name: FUNCTION fn_acomp_prod_before_write(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_acomp_prod_before_write() TO anon;
GRANT ALL ON FUNCTION public.fn_acomp_prod_before_write() TO authenticated;
GRANT ALL ON FUNCTION public.fn_acomp_prod_before_write() TO service_role;


--
-- Name: FUNCTION fn_acomp_prod_local(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_acomp_prod_local() TO anon;
GRANT ALL ON FUNCTION public.fn_acomp_prod_local() TO authenticated;
GRANT ALL ON FUNCTION public.fn_acomp_prod_local() TO service_role;


--
-- Name: FUNCTION fn_acomp_prod_mat_antes(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_acomp_prod_mat_antes() TO anon;
GRANT ALL ON FUNCTION public.fn_acomp_prod_mat_antes() TO authenticated;
GRANT ALL ON FUNCTION public.fn_acomp_prod_mat_antes() TO service_role;


--
-- Name: FUNCTION fn_acomp_prod_viagens_equipe(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_acomp_prod_viagens_equipe() TO anon;
GRANT ALL ON FUNCTION public.fn_acomp_prod_viagens_equipe() TO authenticated;
GRANT ALL ON FUNCTION public.fn_acomp_prod_viagens_equipe() TO service_role;


--
-- Name: FUNCTION fn_aditivo_before(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_aditivo_before() TO anon;
GRANT ALL ON FUNCTION public.fn_aditivo_before() TO authenticated;
GRANT ALL ON FUNCTION public.fn_aditivo_before() TO service_role;


--
-- Name: FUNCTION fn_aditivo_item_before(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_aditivo_item_before() TO anon;
GRANT ALL ON FUNCTION public.fn_aditivo_item_before() TO authenticated;
GRANT ALL ON FUNCTION public.fn_aditivo_item_before() TO service_role;


--
-- Name: FUNCTION fn_alerta_eng_whitelist(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_alerta_eng_whitelist() TO anon;
GRANT ALL ON FUNCTION public.fn_alerta_eng_whitelist() TO authenticated;
GRANT ALL ON FUNCTION public.fn_alerta_eng_whitelist() TO service_role;


--
-- Name: FUNCTION fn_cadeia_trava(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_cadeia_trava() TO anon;
GRANT ALL ON FUNCTION public.fn_cadeia_trava() TO authenticated;
GRANT ALL ON FUNCTION public.fn_cadeia_trava() TO service_role;


--
-- Name: FUNCTION fn_calendario_marca_planos(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_calendario_marca_planos() TO anon;
GRANT ALL ON FUNCTION public.fn_calendario_marca_planos() TO authenticated;
GRANT ALL ON FUNCTION public.fn_calendario_marca_planos() TO service_role;


--
-- Name: FUNCTION fn_calendario_padrao(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_calendario_padrao() TO anon;
GRANT ALL ON FUNCTION public.fn_calendario_padrao() TO authenticated;
GRANT ALL ON FUNCTION public.fn_calendario_padrao() TO service_role;


--
-- Name: FUNCTION fn_comentario_obra_calc(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_comentario_obra_calc() TO anon;
GRANT ALL ON FUNCTION public.fn_comentario_obra_calc() TO authenticated;
GRANT ALL ON FUNCTION public.fn_comentario_obra_calc() TO service_role;


--
-- Name: FUNCTION fn_comentario_touch(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_comentario_touch() TO anon;
GRANT ALL ON FUNCTION public.fn_comentario_touch() TO authenticated;
GRANT ALL ON FUNCTION public.fn_comentario_touch() TO service_role;


--
-- Name: FUNCTION fn_cpu_demarcar_outras(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_cpu_demarcar_outras() TO anon;
GRANT ALL ON FUNCTION public.fn_cpu_demarcar_outras() TO authenticated;
GRANT ALL ON FUNCTION public.fn_cpu_demarcar_outras() TO service_role;


--
-- Name: FUNCTION fn_cpu_item_calc(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_cpu_item_calc() TO anon;
GRANT ALL ON FUNCTION public.fn_cpu_item_calc() TO authenticated;
GRANT ALL ON FUNCTION public.fn_cpu_item_calc() TO service_role;


--
-- Name: FUNCTION fn_cpu_item_propagate(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_cpu_item_propagate() TO anon;
GRANT ALL ON FUNCTION public.fn_cpu_item_propagate() TO authenticated;
GRANT ALL ON FUNCTION public.fn_cpu_item_propagate() TO service_role;


--
-- Name: FUNCTION fn_cpu_producao_changed(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_cpu_producao_changed() TO anon;
GRANT ALL ON FUNCTION public.fn_cpu_producao_changed() TO authenticated;
GRANT ALL ON FUNCTION public.fn_cpu_producao_changed() TO service_role;


--
-- Name: FUNCTION fn_cpu_recalc(_cpu_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fn_cpu_recalc(_cpu_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fn_cpu_recalc(_cpu_id uuid) TO anon;
GRANT ALL ON FUNCTION public.fn_cpu_recalc(_cpu_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.fn_cpu_recalc(_cpu_id uuid) TO service_role;


--
-- Name: FUNCTION fn_dep_mesmo_planejamento(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_dep_mesmo_planejamento() TO anon;
GRANT ALL ON FUNCTION public.fn_dep_mesmo_planejamento() TO authenticated;
GRANT ALL ON FUNCTION public.fn_dep_mesmo_planejamento() TO service_role;


--
-- Name: FUNCTION fn_encargos_total_calc(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_encargos_total_calc() TO anon;
GRANT ALL ON FUNCTION public.fn_encargos_total_calc() TO authenticated;
GRANT ALL ON FUNCTION public.fn_encargos_total_calc() TO service_role;


--
-- Name: FUNCTION fn_equipe_encarregado_obra(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_equipe_encarregado_obra() TO anon;
GRANT ALL ON FUNCTION public.fn_equipe_encarregado_obra() TO authenticated;
GRANT ALL ON FUNCTION public.fn_equipe_encarregado_obra() TO service_role;


--
-- Name: FUNCTION fn_frota_fleethub_protege(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_frota_fleethub_protege() TO anon;
GRANT ALL ON FUNCTION public.fn_frota_fleethub_protege() TO authenticated;
GRANT ALL ON FUNCTION public.fn_frota_fleethub_protege() TO service_role;


--
-- Name: FUNCTION fn_item_orc_aloc_recalcular(_obra_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_item_orc_aloc_recalcular(_obra_id uuid) TO anon;
GRANT ALL ON FUNCTION public.fn_item_orc_aloc_recalcular(_obra_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.fn_item_orc_aloc_recalcular(_obra_id uuid) TO service_role;


--
-- Name: FUNCTION fn_item_orc_aloc_sync_modo(_obra_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_item_orc_aloc_sync_modo(_obra_id uuid) TO anon;
GRANT ALL ON FUNCTION public.fn_item_orc_aloc_sync_modo(_obra_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.fn_item_orc_aloc_sync_modo(_obra_id uuid) TO service_role;


--
-- Name: FUNCTION fn_item_orc_aloc_validar(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_item_orc_aloc_validar() TO anon;
GRANT ALL ON FUNCTION public.fn_item_orc_aloc_validar() TO authenticated;
GRANT ALL ON FUNCTION public.fn_item_orc_aloc_validar() TO service_role;


--
-- Name: FUNCTION fn_item_orc_bloqueia_desvinculo(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_item_orc_bloqueia_desvinculo() TO anon;
GRANT ALL ON FUNCTION public.fn_item_orc_bloqueia_desvinculo() TO authenticated;
GRANT ALL ON FUNCTION public.fn_item_orc_bloqueia_desvinculo() TO service_role;


--
-- Name: FUNCTION fn_item_orc_bloqueia_exclusao_alocada(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_item_orc_bloqueia_exclusao_alocada() TO anon;
GRANT ALL ON FUNCTION public.fn_item_orc_bloqueia_exclusao_alocada() TO authenticated;
GRANT ALL ON FUNCTION public.fn_item_orc_bloqueia_exclusao_alocada() TO service_role;


--
-- Name: FUNCTION fn_item_orc_codigo_gerar(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_item_orc_codigo_gerar() TO anon;
GRANT ALL ON FUNCTION public.fn_item_orc_codigo_gerar() TO authenticated;
GRANT ALL ON FUNCTION public.fn_item_orc_codigo_gerar() TO service_role;


--
-- Name: FUNCTION fn_item_orc_linha_calc(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_item_orc_linha_calc() TO anon;
GRANT ALL ON FUNCTION public.fn_item_orc_linha_calc() TO authenticated;
GRANT ALL ON FUNCTION public.fn_item_orc_linha_calc() TO service_role;


--
-- Name: FUNCTION fn_item_orc_nivel_calc(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_item_orc_nivel_calc() TO anon;
GRANT ALL ON FUNCTION public.fn_item_orc_nivel_calc() TO authenticated;
GRANT ALL ON FUNCTION public.fn_item_orc_nivel_calc() TO service_role;


--
-- Name: FUNCTION fn_item_orc_parent_tipo_check(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_item_orc_parent_tipo_check() TO anon;
GRANT ALL ON FUNCTION public.fn_item_orc_parent_tipo_check() TO authenticated;
GRANT ALL ON FUNCTION public.fn_item_orc_parent_tipo_check() TO service_role;


--
-- Name: FUNCTION fn_lb_imutavel_generica(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_lb_imutavel_generica() TO anon;
GRANT ALL ON FUNCTION public.fn_lb_imutavel_generica() TO authenticated;
GRANT ALL ON FUNCTION public.fn_lb_imutavel_generica() TO service_role;


--
-- Name: FUNCTION fn_limite_antes(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_limite_antes() TO anon;
GRANT ALL ON FUNCTION public.fn_limite_antes() TO authenticated;
GRANT ALL ON FUNCTION public.fn_limite_antes() TO service_role;


--
-- Name: FUNCTION fn_locais_validar(_tarefa_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_locais_validar(_tarefa_id uuid) TO anon;
GRANT ALL ON FUNCTION public.fn_locais_validar(_tarefa_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.fn_locais_validar(_tarefa_id uuid) TO service_role;


--
-- Name: FUNCTION fn_local_antes(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_local_antes() TO anon;
GRANT ALL ON FUNCTION public.fn_local_antes() TO authenticated;
GRANT ALL ON FUNCTION public.fn_local_antes() TO service_role;


--
-- Name: FUNCTION fn_local_soma(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_local_soma() TO anon;
GRANT ALL ON FUNCTION public.fn_local_soma() TO authenticated;
GRANT ALL ON FUNCTION public.fn_local_soma() TO service_role;


--
-- Name: FUNCTION fn_memoria_obra_calc(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_memoria_obra_calc() TO anon;
GRANT ALL ON FUNCTION public.fn_memoria_obra_calc() TO authenticated;
GRANT ALL ON FUNCTION public.fn_memoria_obra_calc() TO service_role;


--
-- Name: FUNCTION fn_obra_calendario_default(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_obra_calendario_default() TO anon;
GRANT ALL ON FUNCTION public.fn_obra_calendario_default() TO authenticated;
GRANT ALL ON FUNCTION public.fn_obra_calendario_default() TO service_role;


--
-- Name: FUNCTION fn_obra_fleet_obra_antes(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_obra_fleet_obra_antes() TO anon;
GRANT ALL ON FUNCTION public.fn_obra_fleet_obra_antes() TO authenticated;
GRANT ALL ON FUNCTION public.fn_obra_fleet_obra_antes() TO service_role;


--
-- Name: FUNCTION fn_orc_marca_cpu(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_orc_marca_cpu() TO anon;
GRANT ALL ON FUNCTION public.fn_orc_marca_cpu() TO authenticated;
GRANT ALL ON FUNCTION public.fn_orc_marca_cpu() TO service_role;


--
-- Name: FUNCTION fn_orc_marca_item(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_orc_marca_item() TO anon;
GRANT ALL ON FUNCTION public.fn_orc_marca_item() TO authenticated;
GRANT ALL ON FUNCTION public.fn_orc_marca_item() TO service_role;


--
-- Name: FUNCTION fn_orc_marca_servico(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_orc_marca_servico() TO anon;
GRANT ALL ON FUNCTION public.fn_orc_marca_servico() TO authenticated;
GRANT ALL ON FUNCTION public.fn_orc_marca_servico() TO service_role;


--
-- Name: FUNCTION fn_orc_marca_servico_prod(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_orc_marca_servico_prod() TO anon;
GRANT ALL ON FUNCTION public.fn_orc_marca_servico_prod() TO authenticated;
GRANT ALL ON FUNCTION public.fn_orc_marca_servico_prod() TO service_role;


--
-- Name: FUNCTION fn_orc_marca_taxa(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_orc_marca_taxa() TO anon;
GRANT ALL ON FUNCTION public.fn_orc_marca_taxa() TO authenticated;
GRANT ALL ON FUNCTION public.fn_orc_marca_taxa() TO service_role;


--
-- Name: FUNCTION fn_orc_marcar_recalculo(_obra_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_orc_marcar_recalculo(_obra_id uuid) TO anon;
GRANT ALL ON FUNCTION public.fn_orc_marcar_recalculo(_obra_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.fn_orc_marcar_recalculo(_obra_id uuid) TO service_role;


--
-- Name: FUNCTION fn_orc_recalculo_executar(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_orc_recalculo_executar() TO anon;
GRANT ALL ON FUNCTION public.fn_orc_recalculo_executar() TO authenticated;
GRANT ALL ON FUNCTION public.fn_orc_recalculo_executar() TO service_role;


--
-- Name: FUNCTION fn_planejamento_baseline_imutavel(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_planejamento_baseline_imutavel() TO anon;
GRANT ALL ON FUNCTION public.fn_planejamento_baseline_imutavel() TO authenticated;
GRANT ALL ON FUNCTION public.fn_planejamento_baseline_imutavel() TO service_role;


--
-- Name: FUNCTION fn_planejamento_estado(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_planejamento_estado() TO anon;
GRANT ALL ON FUNCTION public.fn_planejamento_estado() TO authenticated;
GRANT ALL ON FUNCTION public.fn_planejamento_estado() TO service_role;


--
-- Name: FUNCTION fn_plano_assert_editavel(_planejamento_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_plano_assert_editavel(_planejamento_id uuid) TO anon;
GRANT ALL ON FUNCTION public.fn_plano_assert_editavel(_planejamento_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.fn_plano_assert_editavel(_planejamento_id uuid) TO service_role;


--
-- Name: FUNCTION fn_plano_dados_rev(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_plano_dados_rev() TO anon;
GRANT ALL ON FUNCTION public.fn_plano_dados_rev() TO authenticated;
GRANT ALL ON FUNCTION public.fn_plano_dados_rev() TO service_role;


--
-- Name: FUNCTION fn_plano_rev_atributos(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_plano_rev_atributos() TO anon;
GRANT ALL ON FUNCTION public.fn_plano_rev_atributos() TO authenticated;
GRANT ALL ON FUNCTION public.fn_plano_rev_atributos() TO service_role;


--
-- Name: FUNCTION fn_profiles_protege(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_profiles_protege() TO anon;
GRANT ALL ON FUNCTION public.fn_profiles_protege() TO authenticated;
GRANT ALL ON FUNCTION public.fn_profiles_protege() TO service_role;


--
-- Name: FUNCTION fn_pti_touch_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_pti_touch_updated_at() TO anon;
GRANT ALL ON FUNCTION public.fn_pti_touch_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.fn_pti_touch_updated_at() TO service_role;


--
-- Name: FUNCTION fn_ptps_baseline_imutavel(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_ptps_baseline_imutavel() TO anon;
GRANT ALL ON FUNCTION public.fn_ptps_baseline_imutavel() TO authenticated;
GRANT ALL ON FUNCTION public.fn_ptps_baseline_imutavel() TO service_role;


--
-- Name: FUNCTION fn_reajuste_before(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_reajuste_before() TO anon;
GRANT ALL ON FUNCTION public.fn_reajuste_before() TO authenticated;
GRANT ALL ON FUNCTION public.fn_reajuste_before() TO service_role;


--
-- Name: FUNCTION fn_reajuste_filho_before(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_reajuste_filho_before() TO anon;
GRANT ALL ON FUNCTION public.fn_reajuste_filho_before() TO authenticated;
GRANT ALL ON FUNCTION public.fn_reajuste_filho_before() TO service_role;


--
-- Name: FUNCTION fn_recurso_preco_propagate(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_recurso_preco_propagate() TO anon;
GRANT ALL ON FUNCTION public.fn_recurso_preco_propagate() TO authenticated;
GRANT ALL ON FUNCTION public.fn_recurso_preco_propagate() TO service_role;


--
-- Name: FUNCTION fn_semana_tem_trabalho(_s jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_semana_tem_trabalho(_s jsonb) TO anon;
GRANT ALL ON FUNCTION public.fn_semana_tem_trabalho(_s jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.fn_semana_tem_trabalho(_s jsonb) TO service_role;


--
-- Name: FUNCTION fn_semana_valida(_s jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_semana_valida(_s jsonb) TO anon;
GRANT ALL ON FUNCTION public.fn_semana_valida(_s jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.fn_semana_valida(_s jsonb) TO service_role;


--
-- Name: FUNCTION fn_servdep_antes(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_servdep_antes() TO anon;
GRANT ALL ON FUNCTION public.fn_servdep_antes() TO authenticated;
GRANT ALL ON FUNCTION public.fn_servdep_antes() TO service_role;


--
-- Name: FUNCTION fn_servico_cpu_link_mesma_obra(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_servico_cpu_link_mesma_obra() TO anon;
GRANT ALL ON FUNCTION public.fn_servico_cpu_link_mesma_obra() TO authenticated;
GRANT ALL ON FUNCTION public.fn_servico_cpu_link_mesma_obra() TO service_role;


--
-- Name: FUNCTION fn_servico_nivel_calc(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_servico_nivel_calc() TO anon;
GRANT ALL ON FUNCTION public.fn_servico_nivel_calc() TO authenticated;
GRANT ALL ON FUNCTION public.fn_servico_nivel_calc() TO service_role;


--
-- Name: FUNCTION fn_servico_parametro_antes(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_servico_parametro_antes() TO anon;
GRANT ALL ON FUNCTION public.fn_servico_parametro_antes() TO authenticated;
GRANT ALL ON FUNCTION public.fn_servico_parametro_antes() TO service_role;


--
-- Name: FUNCTION fn_tarefa_assert_editavel(_tarefa_id uuid, OUT planejamento_id uuid, OUT obra_id uuid, OUT item_id uuid, OUT parent_id uuid, OUT nivel smallint, OUT ordem integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_tarefa_assert_editavel(_tarefa_id uuid, OUT planejamento_id uuid, OUT obra_id uuid, OUT item_id uuid, OUT parent_id uuid, OUT nivel smallint, OUT ordem integer) TO anon;
GRANT ALL ON FUNCTION public.fn_tarefa_assert_editavel(_tarefa_id uuid, OUT planejamento_id uuid, OUT obra_id uuid, OUT item_id uuid, OUT parent_id uuid, OUT nivel smallint, OUT ordem integer) TO authenticated;
GRANT ALL ON FUNCTION public.fn_tarefa_assert_editavel(_tarefa_id uuid, OUT planejamento_id uuid, OUT obra_id uuid, OUT item_id uuid, OUT parent_id uuid, OUT nivel smallint, OUT ordem integer) TO service_role;


--
-- Name: FUNCTION fn_tarefa_clonar(_tarefa_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_tarefa_clonar(_tarefa_id uuid) TO anon;
GRANT ALL ON FUNCTION public.fn_tarefa_clonar(_tarefa_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.fn_tarefa_clonar(_tarefa_id uuid) TO service_role;


--
-- Name: FUNCTION fn_tarefa_limite_servico(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_tarefa_limite_servico() TO anon;
GRANT ALL ON FUNCTION public.fn_tarefa_limite_servico() TO authenticated;
GRANT ALL ON FUNCTION public.fn_tarefa_limite_servico() TO service_role;


--
-- Name: FUNCTION fn_tarefa_prefixo_nome(_tarefa_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_tarefa_prefixo_nome(_tarefa_id uuid) TO anon;
GRANT ALL ON FUNCTION public.fn_tarefa_prefixo_nome(_tarefa_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.fn_tarefa_prefixo_nome(_tarefa_id uuid) TO service_role;


--
-- Name: FUNCTION fn_tarefa_so_aceita_servico_grupo(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_tarefa_so_aceita_servico_grupo() TO anon;
GRANT ALL ON FUNCTION public.fn_tarefa_so_aceita_servico_grupo() TO authenticated;
GRANT ALL ON FUNCTION public.fn_tarefa_so_aceita_servico_grupo() TO service_role;


--
-- Name: FUNCTION fn_tarefa_trecho_principal(_tarefa_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_tarefa_trecho_principal(_tarefa_id uuid) TO anon;
GRANT ALL ON FUNCTION public.fn_tarefa_trecho_principal(_tarefa_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.fn_tarefa_trecho_principal(_tarefa_id uuid) TO service_role;


--
-- Name: FUNCTION fn_tarefa_validar_nivel(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_tarefa_validar_nivel() TO anon;
GRANT ALL ON FUNCTION public.fn_tarefa_validar_nivel() TO authenticated;
GRANT ALL ON FUNCTION public.fn_tarefa_validar_nivel() TO service_role;


--
-- Name: FUNCTION fn_touch_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_touch_updated_at() TO anon;
GRANT ALL ON FUNCTION public.fn_touch_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.fn_touch_updated_at() TO service_role;


--
-- Name: FUNCTION fn_transporte_local_antes(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_transporte_local_antes() TO anon;
GRANT ALL ON FUNCTION public.fn_transporte_local_antes() TO authenticated;
GRANT ALL ON FUNCTION public.fn_transporte_local_antes() TO service_role;


--
-- Name: FUNCTION fn_transporte_rota_antes(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_transporte_rota_antes() TO anon;
GRANT ALL ON FUNCTION public.fn_transporte_rota_antes() TO authenticated;
GRANT ALL ON FUNCTION public.fn_transporte_rota_antes() TO service_role;


--
-- Name: FUNCTION fn_trecho_antes(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_trecho_antes() TO anon;
GRANT ALL ON FUNCTION public.fn_trecho_antes() TO authenticated;
GRANT ALL ON FUNCTION public.fn_trecho_antes() TO service_role;


--
-- Name: FUNCTION fn_trecho_assert_editavel(_trecho_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_trecho_assert_editavel(_trecho_id uuid) TO anon;
GRANT ALL ON FUNCTION public.fn_trecho_assert_editavel(_trecho_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.fn_trecho_assert_editavel(_trecho_id uuid) TO service_role;


--
-- Name: FUNCTION fn_valor_servico_em(_grupo_id uuid, _data date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fn_valor_servico_em(_grupo_id uuid, _data date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fn_valor_servico_em(_grupo_id uuid, _data date) TO service_role;


--
-- Name: FUNCTION fn_viagem_antes(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_viagem_antes() TO anon;
GRANT ALL ON FUNCTION public.fn_viagem_antes() TO authenticated;
GRANT ALL ON FUNCTION public.fn_viagem_antes() TO service_role;


--
-- Name: FUNCTION fn_viagem_carregador(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_viagem_carregador() TO anon;
GRANT ALL ON FUNCTION public.fn_viagem_carregador() TO authenticated;
GRANT ALL ON FUNCTION public.fn_viagem_carregador() TO service_role;


--
-- Name: FUNCTION fn_viagem_depois(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_viagem_depois() TO anon;
GRANT ALL ON FUNCTION public.fn_viagem_depois() TO authenticated;
GRANT ALL ON FUNCTION public.fn_viagem_depois() TO service_role;


--
-- Name: FUNCTION fn_viagem_equipe_da_ficha(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_viagem_equipe_da_ficha() TO anon;
GRANT ALL ON FUNCTION public.fn_viagem_equipe_da_ficha() TO authenticated;
GRANT ALL ON FUNCTION public.fn_viagem_equipe_da_ficha() TO service_role;


--
-- Name: FUNCTION fn_viagem_ficha_antes(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_viagem_ficha_antes() TO anon;
GRANT ALL ON FUNCTION public.fn_viagem_ficha_antes() TO authenticated;
GRANT ALL ON FUNCTION public.fn_viagem_ficha_antes() TO service_role;


--
-- Name: FUNCTION fn_viagem_ficha_depois(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_viagem_ficha_depois() TO anon;
GRANT ALL ON FUNCTION public.fn_viagem_ficha_depois() TO authenticated;
GRANT ALL ON FUNCTION public.fn_viagem_ficha_depois() TO service_role;


--
-- Name: FUNCTION fn_viagens_recompor(_obra uuid, _data date, _item uuid, _trecho uuid, _equipe uuid, _enc uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fn_viagens_recompor(_obra uuid, _data date, _item uuid, _trecho uuid, _equipe uuid, _enc uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fn_viagens_recompor(_obra uuid, _data date, _item uuid, _trecho uuid, _equipe uuid, _enc uuid) TO anon;
GRANT ALL ON FUNCTION public.fn_viagens_recompor(_obra uuid, _data date, _item uuid, _trecho uuid, _equipe uuid, _enc uuid) TO authenticated;
GRANT ALL ON FUNCTION public.fn_viagens_recompor(_obra uuid, _data date, _item uuid, _trecho uuid, _equipe uuid, _enc uuid) TO service_role;


--
-- Name: FUNCTION get_or_create_indireto_resources(p_obra_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_or_create_indireto_resources(p_obra_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_or_create_indireto_resources(p_obra_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_or_create_indireto_resources(p_obra_id uuid) TO service_role;


--
-- Name: FUNCTION has_obra_permissao(_obra_id uuid, _user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.has_obra_permissao(_obra_id uuid, _user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.has_obra_permissao(_obra_id uuid, _user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.has_obra_permissao(_obra_id uuid, _user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.has_obra_permissao(_obra_id uuid, _user_id uuid) TO service_role;


--
-- Name: FUNCTION imp_definir_preco_vigente(_recurso_id uuid, _preco numeric, _origem text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.imp_definir_preco_vigente(_recurso_id uuid, _preco numeric, _origem text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.imp_definir_preco_vigente(_recurso_id uuid, _preco numeric, _origem text) TO anon;
GRANT ALL ON FUNCTION public.imp_definir_preco_vigente(_recurso_id uuid, _preco numeric, _origem text) TO authenticated;
GRANT ALL ON FUNCTION public.imp_definir_preco_vigente(_recurso_id uuid, _preco numeric, _origem text) TO service_role;


--
-- Name: FUNCTION imp_grupo_recurso(_grupo_item text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.imp_grupo_recurso(_grupo_item text) TO anon;
GRANT ALL ON FUNCTION public.imp_grupo_recurso(_grupo_item text) TO authenticated;
GRANT ALL ON FUNCTION public.imp_grupo_recurso(_grupo_item text) TO service_role;


--
-- Name: FUNCTION importar_composicoes(_obra_id uuid, _composicoes jsonb, _opcoes jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.importar_composicoes(_obra_id uuid, _composicoes jsonb, _opcoes jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.importar_composicoes(_obra_id uuid, _composicoes jsonb, _opcoes jsonb) TO anon;
GRANT ALL ON FUNCTION public.importar_composicoes(_obra_id uuid, _composicoes jsonb, _opcoes jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.importar_composicoes(_obra_id uuid, _composicoes jsonb, _opcoes jsonb) TO service_role;


--
-- Name: FUNCTION importar_orcamento(_obra_id uuid, _itens jsonb, _alocacoes jsonb, _servicos jsonb, _opcoes jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.importar_orcamento(_obra_id uuid, _itens jsonb, _alocacoes jsonb, _servicos jsonb, _opcoes jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.importar_orcamento(_obra_id uuid, _itens jsonb, _alocacoes jsonb, _servicos jsonb, _opcoes jsonb) TO anon;
GRANT ALL ON FUNCTION public.importar_orcamento(_obra_id uuid, _itens jsonb, _alocacoes jsonb, _servicos jsonb, _opcoes jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.importar_orcamento(_obra_id uuid, _itens jsonb, _alocacoes jsonb, _servicos jsonb, _opcoes jsonb) TO service_role;


--
-- Name: FUNCTION importar_recursos(_obra_id uuid, _linhas jsonb, _opcoes jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.importar_recursos(_obra_id uuid, _linhas jsonb, _opcoes jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.importar_recursos(_obra_id uuid, _linhas jsonb, _opcoes jsonb) TO anon;
GRANT ALL ON FUNCTION public.importar_recursos(_obra_id uuid, _linhas jsonb, _opcoes jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.importar_recursos(_obra_id uuid, _linhas jsonb, _opcoes jsonb) TO service_role;


--
-- Name: FUNCTION lb_capturar_premissas(_planejamento_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.lb_capturar_premissas(_planejamento_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.lb_capturar_premissas(_planejamento_id uuid) TO service_role;


--
-- Name: FUNCTION lb_premissas_diff(_planejamento_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.lb_premissas_diff(_planejamento_id uuid) TO anon;
GRANT ALL ON FUNCTION public.lb_premissas_diff(_planejamento_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.lb_premissas_diff(_planejamento_id uuid) TO service_role;


--
-- Name: FUNCTION marcar_vigente(_planejamento_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.marcar_vigente(_planejamento_id uuid) TO anon;
GRANT ALL ON FUNCTION public.marcar_vigente(_planejamento_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.marcar_vigente(_planejamento_id uuid) TO service_role;


--
-- Name: FUNCTION mcp_oauth_autorizar(_client_id text, _redirect_uri text, _code_challenge text, _escopo text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mcp_oauth_autorizar(_client_id text, _redirect_uri text, _code_challenge text, _escopo text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mcp_oauth_autorizar(_client_id text, _redirect_uri text, _code_challenge text, _escopo text) TO authenticated;
GRANT ALL ON FUNCTION public.mcp_oauth_autorizar(_client_id text, _redirect_uri text, _code_challenge text, _escopo text) TO service_role;


--
-- Name: FUNCTION mcp_oauth_cliente_info(_client_id text, _redirect_uri text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mcp_oauth_cliente_info(_client_id text, _redirect_uri text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mcp_oauth_cliente_info(_client_id text, _redirect_uri text) TO authenticated;
GRANT ALL ON FUNCTION public.mcp_oauth_cliente_info(_client_id text, _redirect_uri text) TO service_role;


--
-- Name: FUNCTION mcp_token_criar(_nome text, _dias integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mcp_token_criar(_nome text, _dias integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mcp_token_criar(_nome text, _dias integer) TO authenticated;
GRANT ALL ON FUNCTION public.mcp_token_criar(_nome text, _dias integer) TO service_role;


--
-- Name: FUNCTION mcp_token_revogar(_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mcp_token_revogar(_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mcp_token_revogar(_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.mcp_token_revogar(_id uuid) TO service_role;


--
-- Name: FUNCTION norm_txt(_s text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.norm_txt(_s text) TO anon;
GRANT ALL ON FUNCTION public.norm_txt(_s text) TO authenticated;
GRANT ALL ON FUNCTION public.norm_txt(_s text) TO service_role;


--
-- Name: FUNCTION obra_empresa(_obra_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.obra_empresa(_obra_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.obra_empresa(_obra_id uuid) TO anon;
GRANT ALL ON FUNCTION public.obra_empresa(_obra_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.obra_empresa(_obra_id uuid) TO service_role;


--
-- Name: FUNCTION obra_equipes_vivas(_obra_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.obra_equipes_vivas(_obra_id uuid) TO anon;
GRANT ALL ON FUNCTION public.obra_equipes_vivas(_obra_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.obra_equipes_vivas(_obra_id uuid) TO service_role;


--
-- Name: FUNCTION obra_tem_aditivo(_obra_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.obra_tem_aditivo(_obra_id uuid) TO anon;
GRANT ALL ON FUNCTION public.obra_tem_aditivo(_obra_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.obra_tem_aditivo(_obra_id uuid) TO service_role;


--
-- Name: FUNCTION planejamento_copiar(_origem_id uuid, _nome text, _inicio date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.planejamento_copiar(_origem_id uuid, _nome text, _inicio date) TO anon;
GRANT ALL ON FUNCTION public.planejamento_copiar(_origem_id uuid, _nome text, _inicio date) TO authenticated;
GRANT ALL ON FUNCTION public.planejamento_copiar(_origem_id uuid, _nome text, _inicio date) TO service_role;


--
-- Name: FUNCTION planejamento_excluir_tarefas(_planejamento_id uuid, _ids uuid[]); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.planejamento_excluir_tarefas(_planejamento_id uuid, _ids uuid[]) TO anon;
GRANT ALL ON FUNCTION public.planejamento_excluir_tarefas(_planejamento_id uuid, _ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.planejamento_excluir_tarefas(_planejamento_id uuid, _ids uuid[]) TO service_role;


--
-- Name: FUNCTION planejamento_gravar_calculo(_planejamento_id uuid, _dados jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.planejamento_gravar_calculo(_planejamento_id uuid, _dados jsonb) TO anon;
GRANT ALL ON FUNCTION public.planejamento_gravar_calculo(_planejamento_id uuid, _dados jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.planejamento_gravar_calculo(_planejamento_id uuid, _dados jsonb) TO service_role;


--
-- Name: FUNCTION planejamento_mover_tarefas(_planejamento_id uuid, _ids uuid[], _pai uuid, _antes uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.planejamento_mover_tarefas(_planejamento_id uuid, _ids uuid[], _pai uuid, _antes uuid) TO anon;
GRANT ALL ON FUNCTION public.planejamento_mover_tarefas(_planejamento_id uuid, _ids uuid[], _pai uuid, _antes uuid) TO authenticated;
GRANT ALL ON FUNCTION public.planejamento_mover_tarefas(_planejamento_id uuid, _ids uuid[], _pai uuid, _antes uuid) TO service_role;


--
-- Name: FUNCTION planejamento_obra(_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.planejamento_obra(_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.planejamento_obra(_id uuid) TO anon;
GRANT ALL ON FUNCTION public.planejamento_obra(_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.planejamento_obra(_id uuid) TO service_role;


--
-- Name: FUNCTION planejamento_promover(_planejamento_id uuid, _marcar_vigente boolean); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.planejamento_promover(_planejamento_id uuid, _marcar_vigente boolean) TO anon;
GRANT ALL ON FUNCTION public.planejamento_promover(_planejamento_id uuid, _marcar_vigente boolean) TO authenticated;
GRANT ALL ON FUNCTION public.planejamento_promover(_planejamento_id uuid, _marcar_vigente boolean) TO service_role;


--
-- Name: FUNCTION planejamento_tarefa_criar(_planejamento_id uuid, _campos jsonb, _locais jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.planejamento_tarefa_criar(_planejamento_id uuid, _campos jsonb, _locais jsonb) TO anon;
GRANT ALL ON FUNCTION public.planejamento_tarefa_criar(_planejamento_id uuid, _campos jsonb, _locais jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.planejamento_tarefa_criar(_planejamento_id uuid, _campos jsonb, _locais jsonb) TO service_role;


--
-- Name: FUNCTION planejamento_tarefa_dividir_estaca(_tarefa_id uuid, _trecho_id uuid, _estaca_m numeric); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.planejamento_tarefa_dividir_estaca(_tarefa_id uuid, _trecho_id uuid, _estaca_m numeric) TO anon;
GRANT ALL ON FUNCTION public.planejamento_tarefa_dividir_estaca(_tarefa_id uuid, _trecho_id uuid, _estaca_m numeric) TO authenticated;
GRANT ALL ON FUNCTION public.planejamento_tarefa_dividir_estaca(_tarefa_id uuid, _trecho_id uuid, _estaca_m numeric) TO service_role;


--
-- Name: FUNCTION planejamento_tarefa_dividir_quantidade(_tarefa_id uuid, _partes jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.planejamento_tarefa_dividir_quantidade(_tarefa_id uuid, _partes jsonb) TO anon;
GRANT ALL ON FUNCTION public.planejamento_tarefa_dividir_quantidade(_tarefa_id uuid, _partes jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.planejamento_tarefa_dividir_quantidade(_tarefa_id uuid, _partes jsonb) TO service_role;


--
-- Name: FUNCTION planejamento_tarefa_equipes_salvar(_tarefa_id uuid, _equipes uuid[]); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.planejamento_tarefa_equipes_salvar(_tarefa_id uuid, _equipes uuid[]) TO anon;
GRANT ALL ON FUNCTION public.planejamento_tarefa_equipes_salvar(_tarefa_id uuid, _equipes uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.planejamento_tarefa_equipes_salvar(_tarefa_id uuid, _equipes uuid[]) TO service_role;


--
-- Name: FUNCTION planejamento_tarefa_locais_salvar(_tarefa_id uuid, _locais jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.planejamento_tarefa_locais_salvar(_tarefa_id uuid, _locais jsonb) TO anon;
GRANT ALL ON FUNCTION public.planejamento_tarefa_locais_salvar(_tarefa_id uuid, _locais jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.planejamento_tarefa_locais_salvar(_tarefa_id uuid, _locais jsonb) TO service_role;


--
-- Name: FUNCTION planejamento_tarefa_mudar_trecho(_tarefa_id uuid, _trecho_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.planejamento_tarefa_mudar_trecho(_tarefa_id uuid, _trecho_id uuid) TO anon;
GRANT ALL ON FUNCTION public.planejamento_tarefa_mudar_trecho(_tarefa_id uuid, _trecho_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.planejamento_tarefa_mudar_trecho(_tarefa_id uuid, _trecho_id uuid) TO service_role;


--
-- Name: FUNCTION planejamento_tarefa_valores_vivos(_planejamento_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.planejamento_tarefa_valores_vivos(_planejamento_id uuid) TO anon;
GRANT ALL ON FUNCTION public.planejamento_tarefa_valores_vivos(_planejamento_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.planejamento_tarefa_valores_vivos(_planejamento_id uuid) TO service_role;


--
-- Name: FUNCTION planejamento_tarefas_atualizar(_planejamento_id uuid, _itens jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.planejamento_tarefas_atualizar(_planejamento_id uuid, _itens jsonb) TO anon;
GRANT ALL ON FUNCTION public.planejamento_tarefas_atualizar(_planejamento_id uuid, _itens jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.planejamento_tarefas_atualizar(_planejamento_id uuid, _itens jsonb) TO service_role;


--
-- Name: FUNCTION planejamento_tarefas_combinar(_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.planejamento_tarefas_combinar(_ids uuid[]) TO anon;
GRANT ALL ON FUNCTION public.planejamento_tarefas_combinar(_ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.planejamento_tarefas_combinar(_ids uuid[]) TO service_role;


--
-- Name: FUNCTION planejamento_tarefas_criar_das_quantidades(_planejamento_id uuid, _parent_id uuid, _trechos uuid[], _itens uuid[], _opcoes jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.planejamento_tarefas_criar_das_quantidades(_planejamento_id uuid, _parent_id uuid, _trechos uuid[], _itens uuid[], _opcoes jsonb) TO anon;
GRANT ALL ON FUNCTION public.planejamento_tarefas_criar_das_quantidades(_planejamento_id uuid, _parent_id uuid, _trechos uuid[], _itens uuid[], _opcoes jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.planejamento_tarefas_criar_das_quantidades(_planejamento_id uuid, _parent_id uuid, _trechos uuid[], _itens uuid[], _opcoes jsonb) TO service_role;


--
-- Name: FUNCTION planejamento_tarefas_renomear_auto(_planejamento_id uuid, _ids uuid[]); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.planejamento_tarefas_renomear_auto(_planejamento_id uuid, _ids uuid[]) TO anon;
GRANT ALL ON FUNCTION public.planejamento_tarefas_renomear_auto(_planejamento_id uuid, _ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.planejamento_tarefas_renomear_auto(_planejamento_id uuid, _ids uuid[]) TO service_role;


--
-- Name: FUNCTION pode_editar_orcamento(_obra_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.pode_editar_orcamento(_obra_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.pode_editar_orcamento(_obra_id uuid) TO anon;
GRANT ALL ON FUNCTION public.pode_editar_orcamento(_obra_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.pode_editar_orcamento(_obra_id uuid) TO service_role;


--
-- Name: FUNCTION pode_lancar_producao(_obra_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.pode_lancar_producao(_obra_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.pode_lancar_producao(_obra_id uuid) TO anon;
GRANT ALL ON FUNCTION public.pode_lancar_producao(_obra_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.pode_lancar_producao(_obra_id uuid) TO service_role;


--
-- Name: FUNCTION pode_planejar_obra(_obra_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.pode_planejar_obra(_obra_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.pode_planejar_obra(_obra_id uuid) TO anon;
GRANT ALL ON FUNCTION public.pode_planejar_obra(_obra_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.pode_planejar_obra(_obra_id uuid) TO service_role;


--
-- Name: FUNCTION pode_ver_acompanhamento(_obra_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.pode_ver_acompanhamento(_obra_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.pode_ver_acompanhamento(_obra_id uuid) TO anon;
GRANT ALL ON FUNCTION public.pode_ver_acompanhamento(_obra_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.pode_ver_acompanhamento(_obra_id uuid) TO service_role;


--
-- Name: FUNCTION pode_ver_obra(_obra_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.pode_ver_obra(_obra_id uuid) TO anon;
GRANT ALL ON FUNCTION public.pode_ver_obra(_obra_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.pode_ver_obra(_obra_id uuid) TO service_role;


--
-- Name: FUNCTION preco_vigente_recurso(_recurso_id uuid, _data date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.preco_vigente_recurso(_recurso_id uuid, _data date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.preco_vigente_recurso(_recurso_id uuid, _data date) TO anon;
GRANT ALL ON FUNCTION public.preco_vigente_recurso(_recurso_id uuid, _data date) TO authenticated;
GRANT ALL ON FUNCTION public.preco_vigente_recurso(_recurso_id uuid, _data date) TO service_role;


--
-- Name: FUNCTION recalcular_orcamento(_obra_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.recalcular_orcamento(_obra_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.recalcular_orcamento(_obra_id uuid) TO anon;
GRANT ALL ON FUNCTION public.recalcular_orcamento(_obra_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.recalcular_orcamento(_obra_id uuid) TO service_role;


--
-- Name: FUNCTION receita_preco_em(_receita_id uuid, _data date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.receita_preco_em(_receita_id uuid, _data date) TO anon;
GRANT ALL ON FUNCTION public.receita_preco_em(_receita_id uuid, _data date) TO authenticated;
GRANT ALL ON FUNCTION public.receita_preco_em(_receita_id uuid, _data date) TO service_role;


--
-- Name: FUNCTION recurso_obra(_recurso_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.recurso_obra(_recurso_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.recurso_obra(_recurso_id uuid) TO anon;
GRANT ALL ON FUNCTION public.recurso_obra(_recurso_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.recurso_obra(_recurso_id uuid) TO service_role;


--
-- Name: FUNCTION registrar_acesso(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.registrar_acesso() FROM PUBLIC;
GRANT ALL ON FUNCTION public.registrar_acesso() TO anon;
GRANT ALL ON FUNCTION public.registrar_acesso() TO authenticated;
GRANT ALL ON FUNCTION public.registrar_acesso() TO service_role;


--
-- Name: FUNCTION registrar_presenca(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.registrar_presenca() FROM PUBLIC;
GRANT ALL ON FUNCTION public.registrar_presenca() TO anon;
GRANT ALL ON FUNCTION public.registrar_presenca() TO authenticated;
GRANT ALL ON FUNCTION public.registrar_presenca() TO service_role;


--
-- Name: FUNCTION remover_alocacoes(_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.remover_alocacoes(_ids uuid[]) TO anon;
GRANT ALL ON FUNCTION public.remover_alocacoes(_ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.remover_alocacoes(_ids uuid[]) TO service_role;


--
-- Name: FUNCTION salvar_rateio_receita(_receita_id uuid, _criterio text, _destinos jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.salvar_rateio_receita(_receita_id uuid, _criterio text, _destinos jsonb) TO anon;
GRANT ALL ON FUNCTION public.salvar_rateio_receita(_receita_id uuid, _criterio text, _destinos jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.salvar_rateio_receita(_receita_id uuid, _criterio text, _destinos jsonb) TO service_role;


--
-- Name: FUNCTION servico_custo_unit(_servico_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.servico_custo_unit(_servico_id uuid) TO anon;
GRANT ALL ON FUNCTION public.servico_custo_unit(_servico_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.servico_custo_unit(_servico_id uuid) TO service_role;


--
-- Name: FUNCTION servico_dependencias_fingerprint(_obra_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.servico_dependencias_fingerprint(_obra_id uuid) TO anon;
GRANT ALL ON FUNCTION public.servico_dependencias_fingerprint(_obra_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.servico_dependencias_fingerprint(_obra_id uuid) TO service_role;


--
-- Name: FUNCTION servico_equipe_viva(_servico_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.servico_equipe_viva(_servico_id uuid) TO anon;
GRANT ALL ON FUNCTION public.servico_equipe_viva(_servico_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.servico_equipe_viva(_servico_id uuid) TO service_role;


--
-- Name: FUNCTION servico_obra(_servico_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.servico_obra(_servico_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.servico_obra(_servico_id uuid) TO anon;
GRANT ALL ON FUNCTION public.servico_obra(_servico_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.servico_obra(_servico_id uuid) TO service_role;


--
-- Name: FUNCTION set_alocacao_compoe(_id uuid, _compoe boolean); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_alocacao_compoe(_id uuid, _compoe boolean) TO anon;
GRANT ALL ON FUNCTION public.set_alocacao_compoe(_id uuid, _compoe boolean) TO authenticated;
GRANT ALL ON FUNCTION public.set_alocacao_compoe(_id uuid, _compoe boolean) TO service_role;


--
-- Name: FUNCTION set_recurso_preco_vigente(_preco_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_recurso_preco_vigente(_preco_id uuid) TO anon;
GRANT ALL ON FUNCTION public.set_recurso_preco_vigente(_preco_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.set_recurso_preco_vigente(_preco_id uuid) TO service_role;


--
-- Name: FUNCTION snapshot_orcamento_atual(_obra_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.snapshot_orcamento_atual(_obra_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.snapshot_orcamento_atual(_obra_id uuid) TO anon;
GRANT ALL ON FUNCTION public.snapshot_orcamento_atual(_obra_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.snapshot_orcamento_atual(_obra_id uuid) TO service_role;


--
-- Name: FUNCTION tarefa_obra(_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.tarefa_obra(_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.tarefa_obra(_id uuid) TO anon;
GRANT ALL ON FUNCTION public.tarefa_obra(_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.tarefa_obra(_id uuid) TO service_role;


--
-- Name: FUNCTION trecho_qtd_faixa(_trecho_id uuid, _item_id uuid, _ini numeric, _fim numeric); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.trecho_qtd_faixa(_trecho_id uuid, _item_id uuid, _ini numeric, _fim numeric) TO anon;
GRANT ALL ON FUNCTION public.trecho_qtd_faixa(_trecho_id uuid, _item_id uuid, _ini numeric, _fim numeric) TO authenticated;
GRANT ALL ON FUNCTION public.trecho_qtd_faixa(_trecho_id uuid, _item_id uuid, _ini numeric, _fim numeric) TO service_role;


--
-- Name: FUNCTION trecho_restaurar_versao(_versao_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.trecho_restaurar_versao(_versao_id uuid) TO anon;
GRANT ALL ON FUNCTION public.trecho_restaurar_versao(_versao_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.trecho_restaurar_versao(_versao_id uuid) TO service_role;


--
-- Name: FUNCTION trecho_salvar_quantidades(_trecho_id uuid, _dados jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.trecho_salvar_quantidades(_trecho_id uuid, _dados jsonb) TO anon;
GRANT ALL ON FUNCTION public.trecho_salvar_quantidades(_trecho_id uuid, _dados jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.trecho_salvar_quantidades(_trecho_id uuid, _dados jsonb) TO service_role;


--
-- Name: FUNCTION trecho_servico_disponivel(_trecho_id uuid, _item_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.trecho_servico_disponivel(_trecho_id uuid, _item_id uuid) TO anon;
GRANT ALL ON FUNCTION public.trecho_servico_disponivel(_trecho_id uuid, _item_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.trecho_servico_disponivel(_trecho_id uuid, _item_id uuid) TO service_role;


--
-- Name: FUNCTION trecho_servico_total(_trecho_id uuid, _item_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.trecho_servico_total(_trecho_id uuid, _item_id uuid) TO anon;
GRANT ALL ON FUNCTION public.trecho_servico_total(_trecho_id uuid, _item_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.trecho_servico_total(_trecho_id uuid, _item_id uuid) TO service_role;


--
-- Name: FUNCTION trecho_sync_tarefas(_obra_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.trecho_sync_tarefas(_obra_id uuid) TO anon;
GRANT ALL ON FUNCTION public.trecho_sync_tarefas(_obra_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.trecho_sync_tarefas(_obra_id uuid) TO service_role;


--
-- Name: FUNCTION trecho_versao_atual(_trecho_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.trecho_versao_atual(_trecho_id uuid) TO anon;
GRANT ALL ON FUNCTION public.trecho_versao_atual(_trecho_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.trecho_versao_atual(_trecho_id uuid) TO service_role;


--
-- Name: FUNCTION trechos_servico_total(_item_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.trechos_servico_total(_item_id uuid) TO anon;
GRANT ALL ON FUNCTION public.trechos_servico_total(_item_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.trechos_servico_total(_item_id uuid) TO service_role;


--
-- Name: TABLE frota_veiculo; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.frota_veiculo TO anon;
GRANT ALL ON TABLE public.frota_veiculo TO authenticated;
GRANT ALL ON TABLE public.frota_veiculo TO service_role;


--
-- Name: FUNCTION veiculos_da_obra(_obra_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.veiculos_da_obra(_obra_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.veiculos_da_obra(_obra_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.veiculos_da_obra(_obra_id uuid) TO service_role;


--
-- Name: TABLE acompanhamento_alerta; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.acompanhamento_alerta TO anon;
GRANT ALL ON TABLE public.acompanhamento_alerta TO authenticated;
GRANT ALL ON TABLE public.acompanhamento_alerta TO service_role;


--
-- Name: TABLE anexo; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.anexo TO anon;
GRANT ALL ON TABLE public.anexo TO authenticated;
GRANT ALL ON TABLE public.anexo TO service_role;


--
-- Name: TABLE calendario; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.calendario TO anon;
GRANT ALL ON TABLE public.calendario TO authenticated;
GRANT ALL ON TABLE public.calendario TO service_role;


--
-- Name: TABLE calendario_definicao; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.calendario_definicao TO anon;
GRANT ALL ON TABLE public.calendario_definicao TO authenticated;
GRANT ALL ON TABLE public.calendario_definicao TO service_role;


--
-- Name: TABLE comentario_item; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.comentario_item TO anon;
GRANT ALL ON TABLE public.comentario_item TO authenticated;
GRANT ALL ON TABLE public.comentario_item TO service_role;


--
-- Name: TABLE cpu_item; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.cpu_item TO anon;
GRANT ALL ON TABLE public.cpu_item TO authenticated;
GRANT ALL ON TABLE public.cpu_item TO service_role;


--
-- Name: TABLE empresas; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.empresas TO anon;
GRANT ALL ON TABLE public.empresas TO authenticated;
GRANT ALL ON TABLE public.empresas TO service_role;


--
-- Name: TABLE encargos_sociais_regime; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.encargos_sociais_regime TO anon;
GRANT ALL ON TABLE public.encargos_sociais_regime TO authenticated;
GRANT ALL ON TABLE public.encargos_sociais_regime TO service_role;


--
-- Name: TABLE fleet_obra; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.fleet_obra TO anon;
GRANT ALL ON TABLE public.fleet_obra TO authenticated;
GRANT ALL ON TABLE public.fleet_obra TO service_role;


--
-- Name: TABLE fleet_sync_execucao; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.fleet_sync_execucao TO anon;
GRANT ALL ON TABLE public.fleet_sync_execucao TO authenticated;
GRANT ALL ON TABLE public.fleet_sync_execucao TO service_role;


--
-- Name: TABLE fleethub_config; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.fleethub_config TO service_role;


--
-- Name: COLUMN fleethub_config.empresa_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(empresa_id) ON TABLE public.fleethub_config TO authenticated;


--
-- Name: COLUMN fleethub_config.email; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(email) ON TABLE public.fleethub_config TO authenticated;


--
-- Name: COLUMN fleethub_config.conectado_em; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(conectado_em) ON TABLE public.fleethub_config TO authenticated;


--
-- Name: COLUMN fleethub_config.conectado_por; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(conectado_por) ON TABLE public.fleethub_config TO authenticated;


--
-- Name: TABLE indireto_item; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.indireto_item TO anon;
GRANT ALL ON TABLE public.indireto_item TO authenticated;
GRANT ALL ON TABLE public.indireto_item TO service_role;


--
-- Name: TABLE item_orc_alocacao; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.item_orc_alocacao TO anon;
GRANT ALL ON TABLE public.item_orc_alocacao TO authenticated;
GRANT ALL ON TABLE public.item_orc_alocacao TO service_role;


--
-- Name: TABLE mcp_oauth_cliente; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.mcp_oauth_cliente TO anon;
GRANT ALL ON TABLE public.mcp_oauth_cliente TO authenticated;
GRANT ALL ON TABLE public.mcp_oauth_cliente TO service_role;


--
-- Name: TABLE mcp_oauth_codigo; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.mcp_oauth_codigo TO anon;
GRANT ALL ON TABLE public.mcp_oauth_codigo TO authenticated;
GRANT ALL ON TABLE public.mcp_oauth_codigo TO service_role;


--
-- Name: TABLE mcp_token; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.mcp_token TO anon;
GRANT ALL ON TABLE public.mcp_token TO authenticated;
GRANT ALL ON TABLE public.mcp_token TO service_role;


--
-- Name: TABLE memoria_calculo_item; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.memoria_calculo_item TO anon;
GRANT ALL ON TABLE public.memoria_calculo_item TO authenticated;
GRANT ALL ON TABLE public.memoria_calculo_item TO service_role;


--
-- Name: TABLE obra_fleet_obra; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.obra_fleet_obra TO anon;
GRANT ALL ON TABLE public.obra_fleet_obra TO authenticated;
GRANT ALL ON TABLE public.obra_fleet_obra TO service_role;


--
-- Name: TABLE obra_permissoes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.obra_permissoes TO anon;
GRANT ALL ON TABLE public.obra_permissoes TO authenticated;
GRANT ALL ON TABLE public.obra_permissoes TO service_role;


--
-- Name: TABLE obra_produtividade_mes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.obra_produtividade_mes TO anon;
GRANT ALL ON TABLE public.obra_produtividade_mes TO authenticated;
GRANT ALL ON TABLE public.obra_produtividade_mes TO service_role;


--
-- Name: TABLE obras; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.obras TO anon;
GRANT ALL ON TABLE public.obras TO authenticated;
GRANT ALL ON TABLE public.obras TO service_role;


--
-- Name: TABLE orcamento_aditivo; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.orcamento_aditivo TO anon;
GRANT ALL ON TABLE public.orcamento_aditivo TO authenticated;
GRANT ALL ON TABLE public.orcamento_aditivo TO service_role;


--
-- Name: TABLE orcamento_aditivo_item; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.orcamento_aditivo_item TO anon;
GRANT ALL ON TABLE public.orcamento_aditivo_item TO authenticated;
GRANT ALL ON TABLE public.orcamento_aditivo_item TO service_role;


--
-- Name: TABLE orcamento_planilha_inicial; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.orcamento_planilha_inicial TO anon;
GRANT ALL ON TABLE public.orcamento_planilha_inicial TO authenticated;
GRANT ALL ON TABLE public.orcamento_planilha_inicial TO service_role;


--
-- Name: TABLE orcamento_reajuste; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.orcamento_reajuste TO anon;
GRANT ALL ON TABLE public.orcamento_reajuste TO authenticated;
GRANT ALL ON TABLE public.orcamento_reajuste TO service_role;


--
-- Name: TABLE orcamento_reajuste_grupo; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.orcamento_reajuste_grupo TO anon;
GRANT ALL ON TABLE public.orcamento_reajuste_grupo TO authenticated;
GRANT ALL ON TABLE public.orcamento_reajuste_grupo TO service_role;


--
-- Name: TABLE orcamento_reajuste_item; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.orcamento_reajuste_item TO anon;
GRANT ALL ON TABLE public.orcamento_reajuste_item TO authenticated;
GRANT ALL ON TABLE public.orcamento_reajuste_item TO service_role;


--
-- Name: TABLE orcamento_recalculo_pendente; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.orcamento_recalculo_pendente TO service_role;


--
-- Name: TABLE planejamento_dependencia; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.planejamento_dependencia TO anon;
GRANT ALL ON TABLE public.planejamento_dependencia TO authenticated;
GRANT ALL ON TABLE public.planejamento_dependencia TO service_role;


--
-- Name: TABLE planejamento_lb_premissa; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.planejamento_lb_premissa TO anon;
GRANT ALL ON TABLE public.planejamento_lb_premissa TO authenticated;
GRANT ALL ON TABLE public.planejamento_lb_premissa TO service_role;


--
-- Name: TABLE planejamento_marco; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.planejamento_marco TO anon;
GRANT ALL ON TABLE public.planejamento_marco TO authenticated;
GRANT ALL ON TABLE public.planejamento_marco TO service_role;


--
-- Name: TABLE planejamento_recurso_limite; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.planejamento_recurso_limite TO anon;
GRANT ALL ON TABLE public.planejamento_recurso_limite TO authenticated;
GRANT ALL ON TABLE public.planejamento_recurso_limite TO service_role;


--
-- Name: TABLE planejamento_tarefa_equipe; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.planejamento_tarefa_equipe TO anon;
GRANT ALL ON TABLE public.planejamento_tarefa_equipe TO authenticated;
GRANT ALL ON TABLE public.planejamento_tarefa_equipe TO service_role;


--
-- Name: TABLE planejamento_tarefa_indireto; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.planejamento_tarefa_indireto TO anon;
GRANT ALL ON TABLE public.planejamento_tarefa_indireto TO authenticated;
GRANT ALL ON TABLE public.planejamento_tarefa_indireto TO service_role;


--
-- Name: TABLE planejamento_tarefa_local; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.planejamento_tarefa_local TO anon;
GRANT ALL ON TABLE public.planejamento_tarefa_local TO authenticated;
GRANT ALL ON TABLE public.planejamento_tarefa_local TO service_role;


--
-- Name: TABLE planejamento_tarefa_wp; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.planejamento_tarefa_wp TO anon;
GRANT ALL ON TABLE public.planejamento_tarefa_wp TO authenticated;
GRANT ALL ON TABLE public.planejamento_tarefa_wp TO service_role;


--
-- Name: TABLE recurso; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.recurso TO anon;
GRANT ALL ON TABLE public.recurso TO authenticated;
GRANT ALL ON TABLE public.recurso TO service_role;


--
-- Name: TABLE recurso_preco; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.recurso_preco TO anon;
GRANT ALL ON TABLE public.recurso_preco TO authenticated;
GRANT ALL ON TABLE public.recurso_preco TO service_role;


--
-- Name: TABLE servico_dependencia; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.servico_dependencia TO anon;
GRANT ALL ON TABLE public.servico_dependencia TO authenticated;
GRANT ALL ON TABLE public.servico_dependencia TO service_role;


--
-- Name: TABLE servico_parametro; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.servico_parametro TO anon;
GRANT ALL ON TABLE public.servico_parametro TO authenticated;
GRANT ALL ON TABLE public.servico_parametro TO service_role;


--
-- Name: TABLE transporte_local; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.transporte_local TO anon;
GRANT ALL ON TABLE public.transporte_local TO authenticated;
GRANT ALL ON TABLE public.transporte_local TO service_role;


--
-- Name: TABLE transporte_rota; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.transporte_rota TO anon;
GRANT ALL ON TABLE public.transporte_rota TO authenticated;
GRANT ALL ON TABLE public.transporte_rota TO service_role;


--
-- Name: TABLE trecho_quantidade_celula; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.trecho_quantidade_celula TO anon;
GRANT ALL ON TABLE public.trecho_quantidade_celula TO authenticated;
GRANT ALL ON TABLE public.trecho_quantidade_celula TO service_role;


--
-- Name: TABLE trecho_quantidade_coluna; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.trecho_quantidade_coluna TO anon;
GRANT ALL ON TABLE public.trecho_quantidade_coluna TO authenticated;
GRANT ALL ON TABLE public.trecho_quantidade_coluna TO service_role;


--
-- Name: TABLE trecho_quantidade_mapeamento; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.trecho_quantidade_mapeamento TO anon;
GRANT ALL ON TABLE public.trecho_quantidade_mapeamento TO authenticated;
GRANT ALL ON TABLE public.trecho_quantidade_mapeamento TO service_role;


--
-- Name: TABLE trecho_quantidade_segmento; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.trecho_quantidade_segmento TO anon;
GRANT ALL ON TABLE public.trecho_quantidade_segmento TO authenticated;
GRANT ALL ON TABLE public.trecho_quantidade_segmento TO service_role;


--
-- Name: TABLE trecho_quantidade_template; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.trecho_quantidade_template TO anon;
GRANT ALL ON TABLE public.trecho_quantidade_template TO authenticated;
GRANT ALL ON TABLE public.trecho_quantidade_template TO service_role;


--
-- Name: TABLE trecho_quantidade_versao; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.trecho_quantidade_versao TO anon;
GRANT ALL ON TABLE public.trecho_quantidade_versao TO authenticated;
GRANT ALL ON TABLE public.trecho_quantidade_versao TO service_role;


--
-- Name: TABLE viagem; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.viagem TO anon;
GRANT ALL ON TABLE public.viagem TO authenticated;
GRANT ALL ON TABLE public.viagem TO service_role;


--
-- Name: TABLE viagem_ficha; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.viagem_ficha TO anon;
GRANT ALL ON TABLE public.viagem_ficha TO authenticated;
GRANT ALL ON TABLE public.viagem_ficha TO service_role;


--
-- Name: TABLE vw_acompanhamento_foto_enriquecida; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vw_acompanhamento_foto_enriquecida TO anon;
GRANT ALL ON TABLE public.vw_acompanhamento_foto_enriquecida TO authenticated;
GRANT ALL ON TABLE public.vw_acompanhamento_foto_enriquecida TO service_role;


--
-- Name: TABLE vw_acompanhamento_frente_kpis; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vw_acompanhamento_frente_kpis TO anon;
GRANT ALL ON TABLE public.vw_acompanhamento_frente_kpis TO authenticated;
GRANT ALL ON TABLE public.vw_acompanhamento_frente_kpis TO service_role;


--
-- Name: TABLE vw_acompanhamento_obra_resumo; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vw_acompanhamento_obra_resumo TO anon;
GRANT ALL ON TABLE public.vw_acompanhamento_obra_resumo TO authenticated;
GRANT ALL ON TABLE public.vw_acompanhamento_obra_resumo TO service_role;


--
-- Name: TABLE vw_acompanhamento_produtividade_equipe; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vw_acompanhamento_produtividade_equipe TO anon;
GRANT ALL ON TABLE public.vw_acompanhamento_produtividade_equipe TO authenticated;
GRANT ALL ON TABLE public.vw_acompanhamento_produtividade_equipe TO service_role;


--
-- Name: TABLE vw_orcamento_consolidado; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vw_orcamento_consolidado TO anon;
GRANT ALL ON TABLE public.vw_orcamento_consolidado TO authenticated;
GRANT ALL ON TABLE public.vw_orcamento_consolidado TO service_role;


--
-- Name: TABLE vw_planejamento_tarefa_completa; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vw_planejamento_tarefa_completa TO anon;
GRANT ALL ON TABLE public.vw_planejamento_tarefa_completa TO authenticated;
GRANT ALL ON TABLE public.vw_planejamento_tarefa_completa TO service_role;


--
-- Name: TABLE vw_recurso_com_preco; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vw_recurso_com_preco TO anon;
GRANT ALL ON TABLE public.vw_recurso_com_preco TO authenticated;
GRANT ALL ON TABLE public.vw_recurso_com_preco TO service_role;


--
-- Name: TABLE vw_servico_consumo_material; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vw_servico_consumo_material TO anon;
GRANT ALL ON TABLE public.vw_servico_consumo_material TO authenticated;
GRANT ALL ON TABLE public.vw_servico_consumo_material TO service_role;


--


--


--


--


--


--

-- volta o search_path normal (o pg_dump zera) antes dos objetos fora do public
reset all;

-- ── Privilégios revogados (o resto segue o padrão do Supabase) ──────────────────────────────────────

revoke all on function public.acompanhamento_alertas_sincronizar(p_obra_id uuid, p_alertas jsonb) from anon, authenticated;
revoke all on function public.campo_assert(_obra_id uuid) from anon;
revoke all on function public.campo_assert_painel(_obra_id uuid) from anon;
revoke all on function public.campo_catalogo(_obra_id uuid) from anon;
revoke all on function public.campo_obras() from anon;
revoke all on function public.campo_painel(_obra_id uuid) from anon;
revoke all on function public.campo_painel_base(_obra_id uuid) from anon, authenticated;
revoke all on function public.campo_registrar_foto(_meta jsonb) from anon;
revoke all on function public.campo_sync_ficha(_ficha jsonb) from anon;
revoke all on function public.campo_sync_producao(_registros jsonb) from anon;
revoke all on function public.diagnostico_cron() from anon;
revoke all on function public.excluir_obra(_obra_id uuid) from anon, authenticated;
revoke all on function public.fleethub_credencial(_empresa_id uuid) from anon, authenticated;
revoke all on function public.fleethub_gravar_credencial(_empresa_id uuid, _email text, _senha text, _por uuid) from anon, authenticated;
revoke all on function public.fleethub_remover_credencial(_empresa_id uuid) from anon, authenticated;
revoke all on function public.fn_valor_servico_em(_grupo_id uuid, _data date) from anon, authenticated;
revoke all on function public.lb_capturar_premissas(_planejamento_id uuid) from anon, authenticated;
revoke all on function public.mcp_oauth_autorizar(_client_id text, _redirect_uri text, _code_challenge text, _escopo text) from anon;
revoke all on function public.mcp_oauth_cliente_info(_client_id text, _redirect_uri text) from anon;
revoke all on function public.mcp_token_criar(_nome text, _dias integer) from anon;
revoke all on function public.mcp_token_revogar(_id uuid) from anon;
revoke all on function public.veiculos_da_obra(_obra_id uuid) from anon;
revoke all on table public.fleethub_config from anon, authenticated;
revoke all on table public.orcamento_recalculo_pendente from anon, authenticated;

-- ── Storage: buckets e políticas ───────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('acompanhamento-fotos', 'acompanhamento-fotos', false, 15728640, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('orcamento', 'orcamento', false, null, null)
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "acomp_fotos_storage_delete" on storage.objects;
create policy "acomp_fotos_storage_delete" on storage.objects
  for delete to authenticated
  using (((bucket_id = 'acompanhamento-fotos'::text) AND (auth_role() = ANY (ARRAY['god'::role_enum, 'adm'::role_enum])) AND pode_lancar_producao((split_part(name, '/'::text, 2))::uuid)));

drop policy if exists "acomp_fotos_storage_insert" on storage.objects;
create policy "acomp_fotos_storage_insert" on storage.objects
  for insert to authenticated
  with check (((bucket_id = 'acompanhamento-fotos'::text) AND pode_lancar_producao((split_part(name, '/'::text, 2))::uuid)));

drop policy if exists "acomp_fotos_storage_select" on storage.objects;
create policy "acomp_fotos_storage_select" on storage.objects
  for select to authenticated
  using (((bucket_id = 'acompanhamento-fotos'::text) AND pode_ver_acompanhamento((split_part(name, '/'::text, 2))::uuid)));

drop policy if exists "acomp_fotos_storage_select_dono" on storage.objects;
create policy "acomp_fotos_storage_select_dono" on storage.objects
  for select to public
  using (((bucket_id = 'acompanhamento-fotos'::text) AND (owner_id = (auth.uid())::text) AND (auth_role() IS NOT NULL)));

drop policy if exists "orcamento_storage_adm_select" on storage.objects;
create policy "orcamento_storage_adm_select" on storage.objects
  for select to authenticated
  using (((bucket_id = 'orcamento'::text) AND (auth_role() = 'adm'::role_enum) AND (obra_empresa((split_part(name, '/'::text, 1))::uuid) = auth_empresa_id())));

drop policy if exists "orcamento_storage_adm_write" on storage.objects;
create policy "orcamento_storage_adm_write" on storage.objects
  for all to authenticated
  using (((bucket_id = 'orcamento'::text) AND (auth_role() = 'adm'::role_enum) AND (obra_empresa((split_part(name, '/'::text, 1))::uuid) = auth_empresa_id())))
  with check (((bucket_id = 'orcamento'::text) AND (auth_role() = 'adm'::role_enum) AND (obra_empresa((split_part(name, '/'::text, 1))::uuid) = auth_empresa_id())));

drop policy if exists "orcamento_storage_apoio_select" on storage.objects;
create policy "orcamento_storage_apoio_select" on storage.objects
  for select to authenticated
  using (((bucket_id = 'orcamento'::text) AND (auth_role() = 'apoio'::role_enum) AND has_obra_permissao((split_part(name, '/'::text, 1))::uuid, auth_engenheiro_id())));

drop policy if exists "orcamento_storage_eng_select" on storage.objects;
create policy "orcamento_storage_eng_select" on storage.objects
  for select to authenticated
  using (((bucket_id = 'orcamento'::text) AND (auth_role() = 'engenheiro'::role_enum) AND has_obra_permissao((split_part(name, '/'::text, 1))::uuid, auth.uid())));

drop policy if exists "orcamento_storage_eng_write" on storage.objects;
create policy "orcamento_storage_eng_write" on storage.objects
  for all to authenticated
  using (((bucket_id = 'orcamento'::text) AND (auth_role() = 'engenheiro'::role_enum) AND has_obra_permissao((split_part(name, '/'::text, 1))::uuid, auth.uid())))
  with check (((bucket_id = 'orcamento'::text) AND (auth_role() = 'engenheiro'::role_enum) AND has_obra_permissao((split_part(name, '/'::text, 1))::uuid, auth.uid())));

drop policy if exists "orcamento_storage_god_select" on storage.objects;
create policy "orcamento_storage_god_select" on storage.objects
  for select to authenticated
  using (((bucket_id = 'orcamento'::text) AND (auth_role() = 'god'::role_enum)));

drop policy if exists "orcamento_storage_god_write" on storage.objects;
create policy "orcamento_storage_god_write" on storage.objects
  for all to authenticated
  using (((bucket_id = 'orcamento'::text) AND (auth_role() = 'god'::role_enum)))
  with check (((bucket_id = 'orcamento'::text) AND (auth_role() = 'god'::role_enum)));


-- ── Agendamentos (pg_cron) ─────────────────────────────────────────────────────────────────────────

select cron.unschedule(jobid) from cron.job where jobname = 'acompanhamento-alertas-todos';
select cron.schedule('acompanhamento-alertas-todos', '0 * * * *', $cron$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
             || '/functions/v1/acompanhamento-alertas-recalcular',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    ) as request_id;
  $cron$);

select cron.unschedule(jobid) from cron.job where jobname = 'fleethub-sync-diario';
select cron.schedule('fleethub-sync-diario', '0 8 * * *', $cron$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
             || '/functions/v1/fleethub-sync',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
        'Content-Type', 'application/json'
      ),
      body := '{"origem":"cron"}'::jsonb,
      timeout_milliseconds := 180000
    ) as request_id;
  $cron$);
