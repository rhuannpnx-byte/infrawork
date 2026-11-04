-- InfraWork Web — Aditivos contratuais e Planilha Inicial.
--
--   * Um aditivo (N por obra, numerados, sempre DATADOS) altera a planilha de
--     venda: quantidade de receitas existentes (acréscimo/supressão), exclusão
--     (só receita não alocada) e itens novos (entram como saldo, ou já
--     alocados/rateados a serviços existentes ou novos).
--   * No 1º aditivo aplicado, a planilha atual é arquivada como PLANILHA
--     INICIAL (consultável a qualquer tempo). Daí em diante a planilha de
--     venda (receitas/etapas) só muda por aditivo (ou reajuste).
--   * Aditivo é permitido mesmo com plano vigente (passa pela trava com
--     infrawork.via_aditivo). As linhas de base continuam com as premissas
--     antigas e passam a acusar "premissas mudaram".
--   * Supressão: bloqueia só se a quantidade do SERVIÇO ficar abaixo do já
--     executado; receitas que não compõem a quantidade nunca bloqueiam.
--   * Valor agregado usa sempre o contrato atual (a data do aditivo é registro).

-- ─── 1. Tabelas ─────────────────────────────────────────────────────────────
alter table public.item_orcamentario
  add column if not exists aditivo_id uuid;

create table if not exists public.orcamento_aditivo (
  id           uuid primary key default gen_random_uuid(),
  obra_id      uuid not null references public.obras(id) on delete cascade,
  numero       int not null,
  data         date not null,
  descricao    text,
  status       text not null default 'rascunho' check (status in ('rascunho', 'aplicado')),
  venda_antes  numeric(18,2),
  venda_depois numeric(18,2),
  criado_por   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  aplicado_em  timestamptz,
  aplicado_por uuid references public.profiles(id) on delete set null,
  unique (obra_id, numero)
);

alter table public.item_orcamentario drop constraint if exists item_orcamentario_aditivo_id_fkey;
alter table public.item_orcamentario
  add constraint item_orcamentario_aditivo_id_fkey
  foreign key (aditivo_id) references public.orcamento_aditivo(id) on delete set null;

create table if not exists public.orcamento_aditivo_item (
  id               uuid primary key default gen_random_uuid(),
  aditivo_id       uuid not null references public.orcamento_aditivo(id) on delete cascade,
  obra_id          uuid not null references public.obras(id) on delete cascade,
  ordem            int not null default 0,
  tipo             text not null check (tipo in ('quantidade', 'exclusao', 'novo')),
  receita_id       uuid references public.item_orcamentario(id) on delete set null,
  codigo           text not null,
  descricao        text,
  unidade          text,
  quantidade_antes numeric(18,4),
  quantidade_nova  numeric(18,4),
  venda_unitaria   numeric(18,4),
  -- item novo: { criterio, compoe, destinos: [{ servico: nome, valor }] }
  alocacao         jsonb,
  created_at       timestamptz not null default now()
);
create index if not exists idx_aditivo_item_aditivo on public.orcamento_aditivo_item (aditivo_id);

create table if not exists public.orcamento_planilha_inicial (
  obra_id    uuid primary key references public.obras(id) on delete cascade,
  aditivo_id uuid references public.orcamento_aditivo(id) on delete set null,
  snapshot   jsonb not null,
  criada_em  timestamptz not null default now()
);

-- numeração automática e imutabilidade do aplicado
create or replace function public.fn_aditivo_before()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
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

drop trigger if exists trg_aditivo_before on public.orcamento_aditivo;
create trigger trg_aditivo_before
  before insert or update or delete on public.orcamento_aditivo
  for each row execute function public.fn_aditivo_before();

alter table public.orcamento_aditivo alter column numero set default 0;

create or replace function public.fn_aditivo_item_before()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare st text; ob uuid;
begin
  select status, obra_id into st, ob
    from public.orcamento_aditivo where id = coalesce(new.aditivo_id, old.aditivo_id);
  if st = 'aplicado' and coalesce(current_setting('infrawork.via_aditivo', true), '') <> '1' then
    raise exception 'Aditivo já aplicado — itens não podem mudar';
  end if;
  if tg_op <> 'DELETE' then new.obra_id := ob; return new; end if;
  return old;
end $$;

drop trigger if exists trg_aditivo_item_before on public.orcamento_aditivo_item;
create trigger trg_aditivo_item_before
  before insert or update or delete on public.orcamento_aditivo_item
  for each row execute function public.fn_aditivo_item_before();

-- RLS: mesma regra do orçamento
alter table public.orcamento_aditivo enable row level security;
alter table public.orcamento_aditivo_item enable row level security;
alter table public.orcamento_planilha_inicial enable row level security;

do $$
declare t text;
begin
  foreach t in array array['orcamento_aditivo', 'orcamento_aditivo_item', 'orcamento_planilha_inicial'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format($p$create policy %I on public.%I for select using (
        public.auth_role() = 'god'
        or (public.auth_role() = 'adm' and public.obra_empresa(obra_id) = public.auth_empresa_id())
        or (public.auth_role() in ('engenheiro', 'cliente') and public.has_obra_permissao(obra_id, auth.uid()))
        or (public.auth_role() = 'apoio' and public.has_obra_permissao(obra_id, public.auth_engenheiro_id())))$p$,
      t || '_select', t);
    if t <> 'orcamento_planilha_inicial' then
      execute format('create policy %I on public.%I for all using (public.pode_editar_orcamento(obra_id)) with check (public.pode_editar_orcamento(obra_id))',
        t || '_write', t);
    end if;
  end loop;
end $$;
grant select, insert, update, delete on public.orcamento_aditivo, public.orcamento_aditivo_item to authenticated;
grant select on public.orcamento_planilha_inicial to authenticated;

-- ─── 2. Trava: planilha de venda só por aditivo após o 1º; exceções ─────────
create or replace function public.obra_tem_aditivo(_obra_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.orcamento_aditivo where obra_id = _obra_id and status = 'aplicado') $$;
grant execute on function public.obra_tem_aditivo(uuid) to authenticated;

create or replace function public.fn_cadeia_trava()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  j jsonb; v_obra uuid; motivo text; v_tipo text; v_id uuid;
begin
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

-- ─── 3. Aplicar aditivo ─────────────────────────────────────────────────────
create or replace function public.aplicar_aditivo(_aditivo_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
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
end $$;
grant execute on function public.aplicar_aditivo(uuid) to authenticated;

-- RPCs de alocação: dentro delas o trigger decide (receita de aditivo passa)
