-- InfraWork Web — Cronograma (motor do ApeX): locais centrados no DynaRoad (DECISOES D-11…D-17).
--
-- 1. Trecho = eixo (estaqueamento: estaca inicial + comprimento, mapa opcional) ou área (sem estacas).
-- 2. Locais da tarefa (work places): local em área sem estacas; "do template" indisponível é ERRO para o usuário
--    (degrada para manual só na cópia de plano e na sincronização do template).
-- 3. Gravar locais é upsert por id (mantém ids e datas calculadas).
-- 4. Colunas legadas de local na tarefa saem; gatilho de linha de base cobre os atributos do ApeX; a view volta a
--    respeitar a RLS (security_invoker, perdido na 0027).
-- 5–6. Helpers e RPCs: criar tarefa (transacional), dividir por estaca / por quantidade, combinar, criar das
--    quantidades por local, renomear automaticamente, mudar de trecho.
-- 7. Produção lançada com trecho + faixa de estacas (controle por estaca).
-- 8. Mapeamento salvo da importação da planilha de quantidades por local.

-- ═══ 1. obra_trecho: eixo ou área, comprimento sem mapa ════════════════════════════════════════════════════════
alter table public.obra_trecho
  add column if not exists tipo text not null default 'eixo',
  add column if not exists comprimento_m numeric(14,2);
alter table public.obra_trecho drop constraint if exists chk_obra_trecho_tipo;
alter table public.obra_trecho add constraint chk_obra_trecho_tipo check (tipo in ('eixo', 'area'));

-- backfill: o mapa; senão o maior fim já usado por locais ou pelo template; senão 1 km
update public.obra_trecho t
   set comprimento_m = coalesce(
     t.geometry_comprimento_m,
     (select max(l.fim_m) from public.planejamento_tarefa_local l where l.trecho_id = t.id),
     (select max(s.posicao_fim_m) from public.trecho_quantidade_segmento s
        join public.trecho_quantidade_versao v on v.id = s.versao_id
        join public.trecho_quantidade_template tp on tp.id = v.template_id
       where tp.trecho_id = t.id),
     1000)
 where t.comprimento_m is null and t.tipo = 'eixo';

alter table public.obra_trecho drop constraint if exists chk_obra_trecho_comprimento;
alter table public.obra_trecho add constraint chk_obra_trecho_comprimento check (
  (tipo = 'area' and comprimento_m is null) or (tipo = 'eixo' and comprimento_m > 0));
comment on column public.obra_trecho.tipo is 'eixo = estaqueamento linear (road line do ApeX); area = local sem estacas (area do ApeX)';
comment on column public.obra_trecho.comprimento_m is 'Eixo: estação final em metros internos (0…comprimento). Com KML é copiado de geometry_comprimento_m; sem KML é digitado.';

create or replace function public.fn_trecho_antes()
returns trigger
language plpgsql security definer set search_path = public
as $$
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
drop trigger if exists trg_trecho_antes on public.obra_trecho;
create trigger trg_trecho_antes before insert or update on public.obra_trecho
  for each row execute function public.fn_trecho_antes();

-- a estação final do eixo entra no documento do motor: planos em edição recalculam
drop trigger if exists trg_trecho_marca_planos on public.obra_trecho;
create trigger trg_trecho_marca_planos after update of comprimento_m, tipo on public.obra_trecho
  for each row execute function public.fn_calendario_marca_planos();

-- quantidade do serviço numa faixa; sem faixa (área) = o total do local
create or replace function public.trecho_qtd_faixa(_trecho_id uuid, _item_id uuid, _ini numeric, _fim numeric)
returns numeric
language sql stable security definer set search_path = public
as $$
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

-- template: segmentos dentro do eixo; área = um único segmento 0–1
create or replace function public.trecho_salvar_quantidades(_trecho_id uuid, _dados jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
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

-- ═══ 2. Locais da tarefa: área sem estacas; erro em vez de degradação silenciosa ═══════════════════════════════
alter table public.planejamento_tarefa_local drop constraint if exists chk_local_faixa;
alter table public.planejamento_tarefa_local add constraint chk_local_faixa check (
  (trecho_id is null and inicio_m is null and fim_m is null)
  or (trecho_id is not null and inicio_m is null and fim_m is null)
  or (trecho_id is not null and inicio_m is not null and fim_m is not null and inicio_m >= 0 and fim_m > inicio_m));

create or replace function public.fn_local_antes()
returns trigger
language plpgsql security definer set search_path = public
as $$
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

-- as unicidades sobre o conjunto final (depois de um lote de alterações com infrawork.locais_lote)
create or replace function public.fn_locais_validar(_tarefa_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
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

-- ═══ 3. Gravar locais = upsert por id; cópia de plano degrada em vez de falhar ═══════════════════════════════════
drop function if exists public.planejamento_tarefa_locais_salvar(uuid, jsonb);
create function public.planejamento_tarefa_locais_salvar(_tarefa_id uuid, _locais jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
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
grant execute on function public.planejamento_tarefa_locais_salvar(uuid, jsonb) to authenticated;

create or replace function public.planejamento_copiar(_origem_id uuid, _nome text, _inicio date default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
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

  insert into public.planejamento_dependencia (planejamento_id, predecessora_id, sucessora_id, tipo, lag_dias, origem, atraso_min, atraso_max, dias_uteis, aparencia)
  select v_novo, a.novo, b.novo, d.tipo, d.lag_dias, d.origem, d.atraso_min, d.atraso_max, d.dias_uteis, d.aparencia
    from public.planejamento_dependencia d
    join _mapa_tarefa a on a.velho = d.predecessora_id
    join _mapa_tarefa b on b.velho = d.sucessora_id
   where d.planejamento_id = _origem_id;
  get diagnostics n_d = row_count;

  insert into public.planejamento_tarefa_equipe (tarefa_id, equipe_id, qtd_equipes, producao_diaria_override)
  select m.novo, e.equipe_id, e.qtd_equipes, e.producao_diaria_override
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

-- ═══ 4. Legado da tarefa: colunas de local saem; LB cobre os atributos do ApeX; view com RLS ═══════════════════
drop view if exists public.vw_planejamento_tarefa_completa;

drop trigger if exists trg_baseline_imutavel_tarefa on public.planejamento_tarefa;
create trigger trg_baseline_imutavel_tarefa
  before delete or update of item_orcamentario_id, data_inicio_manual, notas, ordem, tipo_no, parent_id,
    nivel, quantidade_alocada, codigo_eap, nome_custom, schedule_mode, constraint_type, constraint_date,
    prioridade, asap, inicio_dia, sentido, restricao_inicio, restricao_inicio_em, restricao_fim, restricao_fim_em,
    coef_producao, qtd_equipes, derivar_predecessoras, inicio_em
  on public.planejamento_tarefa
  for each row execute function public.fn_planejamento_baseline_imutavel();

drop trigger if exists trg_tarefa_a_qtd_trecho on public.planejamento_tarefa;
drop function if exists public.fn_tarefa_qtd_trecho();
alter table public.planejamento_tarefa
  drop constraint if exists chk_tarefa_qtd_origem,
  drop constraint if exists chk_tarefa_pos_par;
drop index if exists public.idx_plan_tarefa_trecho;
alter table public.planejamento_tarefa
  drop column if exists trecho_id,
  drop column if exists posicao_inicio_m,
  drop column if exists posicao_fim_m,
  drop column if exists qtd_origem;

create view public.vw_planejamento_tarefa_completa with (security_invoker = true) as
 select t.id, t.planejamento_id, t.item_orcamentario_id, t.data_inicio, t.data_fim, t.duracao_dias_uteis_calc,
    t.data_inicio_manual, t.notas, t.ordem, t.created_at, t.updated_at, t.tipo_no, t.parent_id, t.nivel, t.codigo_eap,
    t.nome_custom, t.quantidade_alocada, t.early_start, t.early_finish, t.late_start, t.late_finish, t.total_float,
    t.free_float, t.is_critico, t.schedule_mode, t.constraint_type, t.constraint_date,
    p.obra_id, p.is_baseline, p.status as planejamento_status, p.data_date as planejamento_data_date,
    i.codigo as servico_grupo_codigo, i.descricao as servico_grupo_descricao,
    coalesce(pr.item_quantidade, i.quantidade_referencia)::numeric(14,4) as quantidade_referencia,
    i.servico_id, i.indireto_id, i.unidade_referencia as unidade_referencia_item,
    coalesce(pr.item_custo_unit, i.custo_unitario_calc)::numeric(14,4) as custo_unitario_item,
    case
      when i.tipo = 'receita' then i.venda_unitaria
      when i.tipo = 'servico_grupo' and coalesce(pr.item_quantidade, i.quantidade_referencia) > 0
        then (coalesce(pr.item_venda_total, i.venda_total_calc) / coalesce(pr.item_quantidade, i.quantidade_referencia))::numeric(18,4)
      else null::numeric
    end as venda_unitaria_item,
    coalesce(pr.item_venda_total, i.venda_total_calc)::numeric(14,2) as venda_total_item,
    s.codigo as servico_codigo, s.nome as servico_nome, s.unidade as unidade_servico,
    i.cpu_snapshot_id, snap.cpu_id as cpu_id_origem,
    coalesce(pr.producao_diaria_cpu, snap.producao_diaria_qtde) as producao_diaria_qtde,
    snap.producao_diaria_unidade,
    coalesce(pr.item_custo_unit, snap.custo_unit)::numeric(14,4) as custo_unit_snapshot,
    coalesce(pr.producao_diaria_efetiva, coalesce(pr.producao_diaria_cpu, snap.producao_diaria_qtde) * t.qtd_equipes * t.coef_producao) as producao_diaria_efetiva,
    (i.indireto_id is not null) as is_indireto,
    case when i.indireto_id is not null and pti.tarefa_id is not null then jsonb_build_object(
      'custo_periodicidade', pti.custo_periodicidade, 'custo_unitario', pti.custo_unitario, 'receita_modo', pti.receita_modo,
      'receita_unitaria', pti.receita_unitaria, 'receita_percentual', pti.receita_percentual,
      'offset_dias_antes', pti.offset_dias_antes, 'offset_dias_depois', pti.offset_dias_depois,
      'receita_extrapola', pti.receita_extrapola, 'aplica_taxas', pti.aplica_taxas, 'taxa_regime_id', pti.taxa_regime_id,
      'periodos_calc', pti.periodos_calc) end as indireto_config,
    case
      when i.indireto_id is not null then coalesce(pti.custo_total_calc, 0)::numeric(18,2)
      when coalesce(pr.item_custo_unit, snap.custo_unit) is not null and t.quantidade_alocada is not null
        then (coalesce(pr.item_custo_unit, snap.custo_unit) * t.quantidade_alocada)::numeric(18,2)
      else 0::numeric(18,2)
    end as custo_total_calc,
    case
      when i.indireto_id is not null then coalesce(pti.receita_total_calc, 0)::numeric(18,2)
      when i.tipo = 'servico_grupo' and coalesce(pr.item_quantidade, i.quantidade_referencia) > 0 and t.quantidade_alocada is not null
        then ((coalesce(pr.item_venda_total, i.venda_total_calc) / coalesce(pr.item_quantidade, i.quantidade_referencia)) * t.quantidade_alocada)::numeric(18,2)
      when i.tipo = 'receita' and i.venda_unitaria is not null and t.quantidade_alocada is not null
        then (i.venda_unitaria * t.quantidade_alocada)::numeric(18,2)
      else 0::numeric(18,2)
    end as receita_total_calc,
    case when i.indireto_id is not null then pti.custo_taxas_calc else null::numeric end as custo_taxas_calc,
    case
      when coalesce(pr.item_custo_unit, snap.custo_unit) is not null and t.quantidade_alocada is not null
        then (coalesce(pr.item_custo_unit, snap.custo_unit) * t.quantidade_alocada)::numeric(14,2)
      else 0::numeric(14,2)
    end as custo_total_tarefa,
    coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'nome', e.nome, 'cor', e.cor, 'tipo', e.tipo, 'ordem', e.ordem,
                 'qtd_equipes', pte.qtd_equipes, 'producao_diaria_override', pte.producao_diaria_override,
                 'producao_diaria_equipe', ep.producao_diaria,
                 'producao_diaria_efetiva', coalesce(pr.producao_diaria_cpu, snap.producao_diaria_qtde) * t.qtd_equipes * t.coef_producao)
               order by e.ordem, e.nome)
        from public.planejamento_tarefa_equipe pte
        join public.equipe e on e.id = pte.equipe_id
        left join public.equipe_produtividade ep on ep.equipe_id = pte.equipe_id and ep.servico_id = i.servico_id
       where pte.tarefa_id = t.id), '[]'::jsonb) as equipes,
    coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'predecessora_id', d.predecessora_id, 'tipo', d.tipo, 'lag_dias', d.lag_dias,
                 'origem', d.origem, 'atraso_min', d.atraso_min, 'atraso_max', d.atraso_max, 'dias_uteis', d.dias_uteis))
        from public.planejamento_dependencia d where d.sucessora_id = t.id), '[]'::jsonb) as predecessoras,
    coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'sucessora_id', d.sucessora_id, 'tipo', d.tipo, 'lag_dias', d.lag_dias,
                 'origem', d.origem, 'atraso_min', d.atraso_min, 'atraso_max', d.atraso_max, 'dias_uteis', d.dias_uteis))
        from public.planejamento_dependencia d where d.predecessora_id = t.id), '[]'::jsonb) as sucessoras,
    coalesce((select jsonb_agg(jsonb_build_object('semana_segunda', ps.semana_segunda, 'quantidade_planejada', ps.quantidade_planejada) order by ps.semana_segunda)
        from public.planejamento_tarefa_perfil_semana ps where ps.tarefa_id = t.id), '[]'::jsonb) as perfil_semanas,
    -- ApeX
    t.prioridade, t.asap, t.inicio_dia, t.sentido, t.restricao_inicio, t.restricao_inicio_em, t.restricao_fim, t.restricao_fim_em,
    t.coef_producao, t.qtd_equipes, t.calendario_id, t.derivar_predecessoras, t.aparencia,
    t.inicio_em, t.fim_em, t.folga_total_h, t.folga_livre_h, t.restricao_limite, t.violacoes,
    coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'ordem', l.ordem, 'trecho_id', l.trecho_id, 'inicio_m', l.inicio_m,
                 'fim_m', l.fim_m, 'quantidade', l.quantidade, 'qtd_origem', l.qtd_origem, 'inicio_em', l.inicio_em, 'fim_em', l.fim_em,
                 'trecho_nome', tr.nome, 'trecho_tipo', tr.tipo,
                 'trecho_disponivel', case when l.trecho_id is not null and t.item_orcamentario_id is not null
                                           then public.trecho_servico_disponivel(l.trecho_id, t.item_orcamentario_id) else false end)
               order by l.ordem, l.inicio_m)
        from public.planejamento_tarefa_local l left join public.obra_trecho tr on tr.id = l.trecho_id
       where l.tarefa_id = t.id), '[]'::jsonb) as locais
   from public.planejamento_tarefa t
   join public.planejamento p on p.id = t.planejamento_id
   left join public.item_orcamentario i on i.id = t.item_orcamentario_id
   left join public.servico s on s.id = i.servico_id
   left join public.vw_servico_vivo snap on snap.servico_id = i.servico_id
   left join public.planejamento_lb_premissa pr on pr.tarefa_id = t.id
   left join public.planejamento_tarefa_indireto pti on pti.tarefa_id = t.id;
grant select on public.vw_planejamento_tarefa_completa to authenticated, service_role;

-- ═══ 5. Helpers das RPCs de tarefa ═══════════════════════════════════════════════════════════════════════════════
create or replace function public.fn_plano_assert_editavel(_planejamento_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_obra uuid; v_lb boolean;
begin
  select obra_id, is_baseline into v_obra, v_lb from public.planejamento where id = _planejamento_id;
  if v_obra is null then raise exception 'Plano não encontrado'; end if;
  if not public.pode_planejar_obra(v_obra) then raise exception 'Sem permissão para planejar esta obra'; end if;
  if v_lb then raise exception 'Linha de base travada é imutável — crie um plano em edição a partir dela'; end if;
  return v_obra;
end $$;

create or replace function public.fn_tarefa_assert_editavel(_tarefa_id uuid,
  out planejamento_id uuid, out obra_id uuid, out item_id uuid, out parent_id uuid, out nivel smallint, out ordem int)
language plpgsql security definer set search_path = public
as $$
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

-- trecho do primeiro local (ordem) da tarefa
create or replace function public.fn_tarefa_trecho_principal(_tarefa_id uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select l.trecho_id from public.planejamento_tarefa_local l
   where l.tarefa_id = _tarefa_id and l.trecho_id is not null
   order by l.ordem, l.inicio_m limit 1
$$;

-- "<descrição do serviço> <nome do trecho>" (o prefixo do nome automático; o número vem depois)
create or replace function public.fn_tarefa_prefixo_nome(_tarefa_id uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select coalesce(i.descricao, s.nome, 'Tarefa') || coalesce(' ' || tr.nome, '')
    from public.planejamento_tarefa t
    left join public.item_orcamentario i on i.id = t.item_orcamentario_id
    left join public.servico s on s.id = i.servico_id
    left join public.obra_trecho tr on tr.id = public.fn_tarefa_trecho_principal(_tarefa_id)
   where t.id = _tarefa_id
$$;

-- cópia da tarefa logo abaixo dela (atributos, equipes nomeadas e dependências do usuário), sem locais
create or replace function public.fn_tarefa_clonar(_tarefa_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
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
  insert into public.planejamento_tarefa_equipe (tarefa_id, equipe_id, qtd_equipes, producao_diaria_override)
  select v_novo, e.equipe_id, e.qtd_equipes, e.producao_diaria_override from public.planejamento_tarefa_equipe e where e.tarefa_id = _tarefa_id;
  insert into public.planejamento_dependencia (planejamento_id, predecessora_id, sucessora_id, tipo, lag_dias, origem, atraso_min, atraso_max, dias_uteis, aparencia)
  select d.planejamento_id, d.predecessora_id, v_novo, d.tipo, d.lag_dias, d.origem, d.atraso_min, d.atraso_max, d.dias_uteis, d.aparencia
    from public.planejamento_dependencia d where d.sucessora_id = _tarefa_id
  on conflict (predecessora_id, sucessora_id) do nothing;
  insert into public.planejamento_dependencia (planejamento_id, predecessora_id, sucessora_id, tipo, lag_dias, origem, atraso_min, atraso_max, dias_uteis, aparencia)
  select d.planejamento_id, v_novo, d.sucessora_id, d.tipo, d.lag_dias, d.origem, d.atraso_min, d.atraso_max, d.dias_uteis, d.aparencia
    from public.planejamento_dependencia d where d.predecessora_id = _tarefa_id
  on conflict (predecessora_id, sucessora_id) do nothing;
  return v_novo;
end $$;

-- ═══ 6. RPCs ═════════════════════════════════════════════════════════════════════════════════════════════════════
-- 6.1 criar tarefa com locais numa transação
create or replace function public.planejamento_tarefa_criar(_planejamento_id uuid, _campos jsonb, _locais jsonb default '[]'::jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
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
grant execute on function public.planejamento_tarefa_criar(uuid, jsonb, jsonb) to authenticated;

-- 6.2 dividir por estaca (SplitWorkSiteByStation): a parte alta vai para a cópia; o local atravessado é cortado
--     proporcionalmente ao comprimento (manual) ou recalculado pelo template ("do trecho")
create or replace function public.planejamento_tarefa_dividir_estaca(_tarefa_id uuid, _trecho_id uuid, _estaca_m numeric)
returns uuid
language plpgsql security definer set search_path = public
as $$
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
grant execute on function public.planejamento_tarefa_dividir_estaca(uuid, uuid, numeric) to authenticated;

-- 6.3 dividir por quantidade (SplitWorkSiteByAmounts): _partes = [{local_id, quantidade}] = o que vai para a nova
--     tarefa, nas mesmas faixas; as duas partes ficam manuais. Tarefa sem locais: {local_id: null, quantidade}.
create or replace function public.planejamento_tarefa_dividir_quantidade(_tarefa_id uuid, _partes jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
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
grant execute on function public.planejamento_tarefa_dividir_quantidade(uuid, jsonb) to authenticated;

-- 6.4 combinar (CombineWorkSites): mesmo serviço e mesmos trechos; faixas que se cruzam ou encostam fundem; fica a primeira
create or replace function public.planejamento_tarefas_combinar(_ids uuid[])
returns uuid
language plpgsql security definer set search_path = public
as $$
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
    insert into public.planejamento_dependencia (planejamento_id, predecessora_id, sucessora_id, tipo, lag_dias, origem, atraso_min, atraso_max, dias_uteis, aparencia)
    select d.planejamento_id, d.predecessora_id, v_kept, d.tipo, d.lag_dias, d.origem, d.atraso_min, d.atraso_max, d.dias_uteis, d.aparencia
      from public.planejamento_dependencia d where d.sucessora_id = x and d.predecessora_id <> all(_ids)
    on conflict (predecessora_id, sucessora_id) do nothing;
    insert into public.planejamento_dependencia (planejamento_id, predecessora_id, sucessora_id, tipo, lag_dias, origem, atraso_min, atraso_max, dias_uteis, aparencia)
    select d.planejamento_id, v_kept, d.sucessora_id, d.tipo, d.lag_dias, d.origem, d.atraso_min, d.atraso_max, d.dias_uteis, d.aparencia
      from public.planejamento_dependencia d where d.predecessora_id = x and d.sucessora_id <> all(_ids)
    on conflict (predecessora_id, sucessora_id) do nothing;
    insert into public.planejamento_tarefa_equipe (tarefa_id, equipe_id, qtd_equipes, producao_diaria_override)
    select v_kept, e.equipe_id, e.qtd_equipes, e.producao_diaria_override from public.planejamento_tarefa_equipe e where e.tarefa_id = x
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
grant execute on function public.planejamento_tarefas_combinar(uuid[]) to authenticated;

-- 6.5 criar tarefas a partir das quantidades por local (a importação de quantidades do DynaRoad)
--     _opcoes: {modo: 'sequencia' (padrão: uma tarefa por sequência contígua) | 'local' (uma por local) | 'janela',
--               janela_m, sentido}
create or replace function public.planejamento_tarefas_criar_das_quantidades(
  _planejamento_id uuid, _parent_id uuid, _trechos uuid[], _itens uuid[], _opcoes jsonb default '{}'::jsonb)
returns uuid[]
language plpgsql security definer set search_path = public
as $$
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
grant execute on function public.planejamento_tarefas_criar_das_quantidades(uuid, uuid, uuid[], uuid[], jsonb) to authenticated;

-- 6.6 renomear automaticamente ("Rename tasks automatically"): "<serviço> <trecho> N" por (serviço, trecho principal)
--     em ordem de estaca; só tarefas sem nome fixado (nome nulo ou já no padrão), ou as _ids dadas
create or replace function public.planejamento_tarefas_renomear_auto(_planejamento_id uuid, _ids uuid[] default null)
returns int
language plpgsql security definer set search_path = public
as $$
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
end $$;
grant execute on function public.planejamento_tarefas_renomear_auto(uuid, uuid[]) to authenticated;

-- 6.7 mudar de trecho (SetRoadLine / MoveToArea): faixa remapeada linearmente (adjustedSpan do ApeX)
create or replace function public.planejamento_tarefa_mudar_trecho(_tarefa_id uuid, _trecho_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
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
grant execute on function public.planejamento_tarefa_mudar_trecho(uuid, uuid) to authenticated;

-- ═══ 7. Produção lançada com local e faixa de estacas (controle por estaca) ═════════════════════════════════════
alter table public.acompanhamento_producao
  add column if not exists trecho_id uuid references public.obra_trecho(id) on delete set null,
  add column if not exists posicao_inicio_m numeric(14,3),
  add column if not exists posicao_fim_m numeric(14,3);
create index if not exists idx_acomp_prod_trecho on public.acompanhamento_producao (trecho_id);

create or replace function public.fn_acomp_prod_local()
returns trigger
language plpgsql security definer set search_path = public
as $$
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
drop trigger if exists trg_acomp_prod_local on public.acompanhamento_producao;
create trigger trg_acomp_prod_local before insert or update on public.acompanhamento_producao
  for each row execute function public.fn_acomp_prod_local();

-- ═══ 8. Mapeamento salvo da importação da planilha de quantidades (QuantityImportSettings do DynaRoad) ═════════
create table if not exists public.trecho_quantidade_mapeamento (
  obra_id               uuid not null references public.obras(id) on delete cascade,
  chave                 text not null,
  item_orcamentario_id  uuid references public.item_orcamentario(id) on delete cascade,
  updated_at            timestamptz not null default now(),
  primary key (obra_id, chave)
);
comment on table public.trecho_quantidade_mapeamento is 'Coluna da planilha de quantidades (nome normalizado) → serviço do orçamento; null = não importar';
alter table public.trecho_quantidade_mapeamento enable row level security;
drop policy if exists tqm_select on public.trecho_quantidade_mapeamento;
create policy tqm_select on public.trecho_quantidade_mapeamento for select using (public.pode_ver_obra(obra_id));
drop policy if exists tqm_write on public.trecho_quantidade_mapeamento;
create policy tqm_write on public.trecho_quantidade_mapeamento for all
  using (public.pode_planejar_obra(obra_id)) with check (public.pode_planejar_obra(obra_id));
grant select, insert, update, delete on public.trecho_quantidade_mapeamento to authenticated;

notify pgrst, 'reload schema';
