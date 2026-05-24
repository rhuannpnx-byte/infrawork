-- InfraWork — Orçamento (Revisão Maior): semântica nova da Planilha Orçamentária
--
-- Mudança conceitual:
--   antes: item_orcamentario = folha (com unidade+qtd+venda+CPU) OU agrupador (sem nada).
--   agora: 3 tipos:
--     - 'etapa'         → estrutural/EAP; agrega filhos; sem CPU; sem qtd própria.
--     - 'servico_grupo' → vincula serviço + CPU; tem quantidade_referencia (que
--                         multiplica a CPU pra dar o custo); só aceita receita
--                         como filho; venda = soma das receitas filhas.
--     - 'receita'       → tarefa cobrada do cliente; tem unidade+qtd+venda_unit;
--                         NÃO tem CPU; só compõe venda.
--
-- BDI deixa de existir como conceito separado — preço de venda já vem com BDI
-- embutido (é orçamento de governo/edital, onde o BDI é regra de mercado).
--
-- A função recalcular_orcamento é reescrita com a nova lógica.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Drop triggers/constraints velhos do item_orcamentario
-- ─────────────────────────────────────────────────────────────────────────
drop trigger if exists trg_item_orc_folha_calc on public.item_orcamentario;
drop function if exists public.fn_item_orc_folha_calc();

alter table public.item_orcamentario
  drop constraint if exists chk_item_orc_folha_agrupador,
  drop constraint if exists chk_item_orc_bdi;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Drop bdi_perc
-- ─────────────────────────────────────────────────────────────────────────
alter table public.item_orcamentario drop column if exists bdi_perc;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Adiciona campos novos
-- ─────────────────────────────────────────────────────────────────────────
alter table public.item_orcamentario
  add column if not exists tipo                   text not null default 'receita',
  add column if not exists quantidade_referencia  numeric(14,4),
  add column if not exists unidade_referencia     text,
  add column if not exists qtd_ref_modo           text,
  add column if not exists qtd_ref_filhos         uuid[];

do $$ begin
  alter table public.item_orcamentario
    add constraint chk_item_orc_tipo
    check (tipo in ('etapa', 'servico_grupo', 'receita'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.item_orcamentario
    add constraint chk_item_orc_qtd_ref_modo
    check (qtd_ref_modo is null or qtd_ref_modo in ('manual', 'heranca', 'soma_filhos'));
exception when duplicate_object then null; end $$;

-- Coerência entre tipo e campos preenchidos:
--   receita:        unidade NOT NULL, quantidade NOT NULL, venda_unitaria NOT NULL;
--                   servico_id NULL, cpu_snapshot_id NULL, quantidade_referencia NULL.
--   servico_grupo:  servico_id NOT NULL (FK livre), quantidade_referencia NOT NULL,
--                   unidade_referencia NOT NULL, qtd_ref_modo NOT NULL;
--                   unidade NULL, quantidade NULL, venda_unitaria NULL.
--   etapa:          tudo NULL exceto descricao/codigo.
do $$ begin
  alter table public.item_orcamentario
    add constraint chk_item_orc_tipo_coerencia
    check (
      (tipo = 'receita'
         and unidade is not null and quantidade is not null and venda_unitaria is not null
         and servico_id is null and cpu_snapshot_id is null
         and quantidade_referencia is null and unidade_referencia is null
         and qtd_ref_modo is null and qtd_ref_filhos is null)
      or
      (tipo = 'servico_grupo'
         and servico_id is not null
         and quantidade_referencia is not null and unidade_referencia is not null
         and qtd_ref_modo is not null
         and unidade is null and quantidade is null and venda_unitaria is null)
      or
      (tipo = 'etapa'
         and servico_id is null and cpu_snapshot_id is null
         and quantidade_referencia is null and unidade_referencia is null
         and qtd_ref_modo is null and qtd_ref_filhos is null
         and unidade is null and quantidade is null and venda_unitaria is null)
    );
exception when duplicate_object then null; end $$;

create index if not exists idx_item_orc_tipo on public.item_orcamentario(obra_id, tipo);

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Trigger BEFORE para validar hierarquia (filho de servico_grupo só receita)
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.fn_item_orc_parent_tipo_check()
returns trigger
language plpgsql
as $$
declare
  parent_tipo text;
begin
  if new.parent_id is null then
    return new;
  end if;
  select tipo into parent_tipo from public.item_orcamentario where id = new.parent_id;
  if parent_tipo is null then
    raise exception 'parent_id inexistente: %', new.parent_id;
  end if;
  if parent_tipo = 'servico_grupo' and new.tipo <> 'receita' then
    raise exception 'servico_grupo só aceita receita como filho (tentou inserir %)', new.tipo;
  end if;
  if parent_tipo = 'receita' then
    raise exception 'receita não pode ter filhos';
  end if;
  return new;
end
$$;

drop trigger if exists trg_item_orc_parent_tipo_check on public.item_orcamentario;
create trigger trg_item_orc_parent_tipo_check
  before insert or update of parent_id, tipo on public.item_orcamentario
  for each row execute function public.fn_item_orc_parent_tipo_check();

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Trigger BEFORE de cálculo da linha (recalcula campos *_calc da linha
-- conforme tipo; rollup de servico_grupo/etapa fica no recalcular_orcamento)
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.fn_item_orc_linha_calc()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  snap_custo_unit numeric(14,4);
begin
  new.updated_at := now();

  if new.tipo = 'receita' then
    -- Receita: venda = qtd × venda_unit; sem custo, sem lucratividade na linha.
    new.custo_unitario_calc     := null;
    new.custo_total_calc        := 0;
    new.venda_total_calc        := coalesce(new.quantidade, 0) * coalesce(new.venda_unitaria, 0);
    new.lucratividade_perc_calc := null;
  elsif new.tipo = 'servico_grupo' then
    -- Custo unitário da CPU (snapshot); custo_total = unit × qtd_ref.
    -- Venda do agrupador é soma das receitas filhas — feita no recalcular_orcamento.
    if new.cpu_snapshot_id is not null then
      select custo_unit into snap_custo_unit
        from public.cpu_snapshot where id = new.cpu_snapshot_id;
    else
      snap_custo_unit := 0;
    end if;
    new.custo_unitario_calc := coalesce(snap_custo_unit, 0);
    new.custo_total_calc    := coalesce(new.quantidade_referencia, 0) * new.custo_unitario_calc;
    -- venda_total_calc e lucratividade_perc_calc preenchidos por recalcular_orcamento
  else
    -- etapa: tudo zerado na linha; rollup faz a soma depois.
    new.custo_unitario_calc := null;
    new.custo_total_calc    := 0;
    new.venda_total_calc    := 0;
    new.lucratividade_perc_calc := null;
  end if;

  return new;
end
$$;

alter function public.fn_item_orc_linha_calc() owner to postgres;

create trigger trg_item_orc_linha_calc
  before insert or update on public.item_orcamentario
  for each row execute function public.fn_item_orc_linha_calc();

-- ─────────────────────────────────────────────────────────────────────────
-- 6. recalcular_orcamento reescrito para a nova semântica
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.recalcular_orcamento(_obra_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  obra_aliquota   numeric(7,4);
  max_nivel       smallint;
  lvl             smallint;
  itens_total     int;
  custo_total     numeric(14,2);
  venda_total     numeric(14,2);
  lucr_global     numeric(7,4);
  inicio_ms       bigint;
  sg              record;
  qtd_calc        numeric(14,4);
begin
  inicio_ms := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  perform pg_advisory_xact_lock(hashtext('orc:' || _obra_id::text));

  select coalesce(aliquota_iss_perc, 0) + coalesce(aliquota_pis_perc, 0)
       + coalesce(aliquota_cofins_perc, 0) + coalesce(aliquota_outros_perc, 0)
    into obra_aliquota
    from public.obras where id = _obra_id;

  -- 1) Recálculo das receitas: força UPDATE no-op pra disparar trigger linha_calc
  update public.item_orcamentario
     set updated_at = now()
   where obra_id = _obra_id and tipo = 'receita';

  -- 2) servico_grupo: atualiza quantidade_referencia conforme modo + recalc
  for sg in
    select id, qtd_ref_modo, qtd_ref_filhos, quantidade_referencia
      from public.item_orcamentario
     where obra_id = _obra_id and tipo = 'servico_grupo'
  loop
    case sg.qtd_ref_modo
      when 'manual' then
        qtd_calc := sg.quantidade_referencia;
      when 'heranca' then
        -- pega quantidade do primeiro id em qtd_ref_filhos
        if sg.qtd_ref_filhos is null or array_length(sg.qtd_ref_filhos, 1) is null then
          qtd_calc := sg.quantidade_referencia;
        else
          select quantidade into qtd_calc
            from public.item_orcamentario
           where id = sg.qtd_ref_filhos[1];
          if qtd_calc is null then qtd_calc := 0; end if;
        end if;
      when 'soma_filhos' then
        if sg.qtd_ref_filhos is null or array_length(sg.qtd_ref_filhos, 1) is null then
          qtd_calc := sg.quantidade_referencia;
        else
          select coalesce(sum(quantidade), 0) into qtd_calc
            from public.item_orcamentario
           where id = any(sg.qtd_ref_filhos);
        end if;
    end case;

    update public.item_orcamentario
       set quantidade_referencia = qtd_calc,
           venda_total_calc = coalesce(
             (select sum(venda_total_calc)
                from public.item_orcamentario c
               where c.parent_id = sg.id), 0),
           updated_at = now()
     where id = sg.id;
  end loop;

  -- Após reset de venda_total dos servico_grupo, recalcula lucratividade deles
  update public.item_orcamentario
     set lucratividade_perc_calc = case
       when venda_total_calc > 0 then
         (venda_total_calc - custo_total_calc - venda_total_calc * obra_aliquota) / venda_total_calc
       else null
     end
   where obra_id = _obra_id and tipo = 'servico_grupo';

  -- 3) Rollup das etapas, do nível mais profundo até a raiz
  select coalesce(max(nivel), 0) into max_nivel
    from public.item_orcamentario
   where obra_id = _obra_id and tipo = 'etapa';

  lvl := max_nivel;
  while lvl >= 1 loop
    update public.item_orcamentario p
       set custo_total_calc = coalesce(
             (select sum(custo_total_calc)
                from public.item_orcamentario c
               where c.parent_id = p.id), 0),
           venda_total_calc = coalesce(
             (select sum(venda_total_calc)
                from public.item_orcamentario c
               where c.parent_id = p.id), 0),
           lucratividade_perc_calc = case
             when coalesce((select sum(venda_total_calc)
                              from public.item_orcamentario c
                             where c.parent_id = p.id), 0) > 0 then
               ((select sum(venda_total_calc) from public.item_orcamentario c where c.parent_id = p.id)
                - (select sum(custo_total_calc) from public.item_orcamentario c where c.parent_id = p.id)
                - (select sum(venda_total_calc) from public.item_orcamentario c where c.parent_id = p.id) * obra_aliquota
               )
               / (select sum(venda_total_calc) from public.item_orcamentario c where c.parent_id = p.id)
             else null
           end,
           updated_at = now()
     where p.obra_id = _obra_id
       and p.tipo = 'etapa'
       and p.nivel = lvl;
    lvl := lvl - 1;
  end loop;

  -- 4) Totais globais (raízes)
  select count(*),
         coalesce(sum(custo_total_calc) filter (where parent_id is null), 0),
         coalesce(sum(venda_total_calc) filter (where parent_id is null), 0)
    into itens_total, custo_total, venda_total
    from public.item_orcamentario
   where obra_id = _obra_id;

  if venda_total > 0 then
    lucr_global := (venda_total - custo_total - venda_total * obra_aliquota) / venda_total;
  else
    lucr_global := null;
  end if;

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

alter function public.recalcular_orcamento(uuid) owner to postgres;
revoke all on function public.recalcular_orcamento(uuid) from public;
grant execute on function public.recalcular_orcamento(uuid) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Atualiza snapshot_orcamento_atual (usada por criar-revisao-orcamento)
-- para incluir os novos campos (tipo, quantidade_referencia, etc.)
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.snapshot_orcamento_atual(_obra_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'obra', (select to_jsonb(o) from public.obras o where o.id = _obra_id),
    'itens', coalesce(
      (select jsonb_agg(to_jsonb(i) order by i.codigo)
         from public.item_orcamentario i
        where i.obra_id = _obra_id),
      '[]'::jsonb
    ),
    'indireto', coalesce(
      (select jsonb_agg(to_jsonb(ii) order by ii.codigo)
         from public.indireto_item ii
        where ii.obra_id = _obra_id),
      '[]'::jsonb
    ),
    'cpu_snapshots', coalesce(
      (select jsonb_agg(distinct to_jsonb(s))
         from public.cpu_snapshot s
        where s.id in (
          select cpu_snapshot_id from public.item_orcamentario
           where obra_id = _obra_id and cpu_snapshot_id is not null
        )),
      '[]'::jsonb
    ),
    'totais', jsonb_build_object(
      'custo_direto',
        (select coalesce(sum(custo_total_calc), 0)
           from public.item_orcamentario
          where obra_id = _obra_id and parent_id is null),
      'venda_total',
        (select coalesce(sum(venda_total_calc), 0)
           from public.item_orcamentario
          where obra_id = _obra_id and parent_id is null),
      'indireto_total',
        (select coalesce(sum(valor_total * distribuicao_perc), 0)
           from public.indireto_item
          where obra_id = _obra_id)
    ),
    'gerado_em', now()
  )
$$;

alter function public.snapshot_orcamento_atual(uuid) owner to postgres;
revoke all on function public.snapshot_orcamento_atual(uuid) from public;
grant execute on function public.snapshot_orcamento_atual(uuid) to authenticated, service_role;
