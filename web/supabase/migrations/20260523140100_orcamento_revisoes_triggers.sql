-- InfraWork — Orçamento (Fase 3.B): triggers para Revisões + snapshot helper
--
-- Triggers:
--   - fn_revisao_versao_auto:  BEFORE INSERT — auto-incrementa versao por obra
--   - fn_revisao_imutavel:     bloqueia UPDATE de campos críticos quando status
--                              ∈ {aprovada, homologada}; bloqueia DELETE quando
--                              status = homologada
--   - fn_comentario_obra_calc: BEFORE INSERT — preenche obra_id a partir do item
--   - fn_comentario_touch:     BEFORE UPDATE — atualiza updated_at
--   - fn_memoria_obra_calc:    BEFORE INSERT — preenche obra_id a partir do item
--   - fn_memoria_touch:        BEFORE UPDATE — atualiza updated_at
--
-- Função utilitária:
--   - snapshot_orcamento_atual(_obra_id) returns jsonb
--     produz o snapshot completo da obra (Plan_Orc + Indireto + obra + cpus
--     aplicadas). Usada pela Edge Function criar-revisao-orcamento.

-- ─────────────────────────────────────────────────────────────────────────
-- versao auto
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.fn_revisao_versao_auto()
returns trigger
language plpgsql
as $$
declare
  max_v int;
begin
  if new.versao is null or new.versao = 0 then
    perform pg_advisory_xact_lock(hashtext('revisao:' || new.obra_id::text));
    select coalesce(max(versao), 0) into max_v
      from public.revisao_orcamento where obra_id = new.obra_id;
    new.versao := max_v + 1;
  end if;
  return new;
end
$$;

drop trigger if exists trg_revisao_versao_auto on public.revisao_orcamento;
create trigger trg_revisao_versao_auto
  before insert on public.revisao_orcamento
  for each row execute function public.fn_revisao_versao_auto();

-- ─────────────────────────────────────────────────────────────────────────
-- imutabilidade (aprovada/homologada não permite UPDATE de campos críticos)
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.fn_revisao_imutavel()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'homologada' then
      raise exception 'revisão homologada não pode ser deletada';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    -- Permite transição de status (controlado pela Edge Function) e timestamps,
    -- mas NÃO permite alterar snapshot ou totais quando aprovada/homologada.
    if old.status in ('aprovada', 'homologada') then
      if new.snapshot is distinct from old.snapshot
         or new.custo_total is distinct from old.custo_total
         or new.venda_total is distinct from old.venda_total
         or new.lucratividade_perc is distinct from old.lucratividade_perc
         or new.versao is distinct from old.versao
         or new.obra_id is distinct from old.obra_id then
        raise exception 'revisão % é imutável (status=%)', old.id, old.status;
      end if;
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists trg_revisao_imutavel on public.revisao_orcamento;
create trigger trg_revisao_imutavel
  before update or delete on public.revisao_orcamento
  for each row execute function public.fn_revisao_imutavel();

-- ─────────────────────────────────────────────────────────────────────────
-- comentario_item: obra_id auto a partir do item; updated_at touch
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.fn_comentario_obra_calc()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

alter function public.fn_comentario_obra_calc() owner to postgres;

drop trigger if exists trg_comentario_obra_calc on public.comentario_item;
create trigger trg_comentario_obra_calc
  before insert on public.comentario_item
  for each row execute function public.fn_comentario_obra_calc();

create or replace function public.fn_comentario_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists trg_comentario_touch on public.comentario_item;
create trigger trg_comentario_touch
  before update on public.comentario_item
  for each row execute function public.fn_comentario_touch();

-- ─────────────────────────────────────────────────────────────────────────
-- memoria_calculo_item: obra_id auto + updated_at touch
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.fn_memoria_obra_calc()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

alter function public.fn_memoria_obra_calc() owner to postgres;

drop trigger if exists trg_memoria_obra_calc on public.memoria_calculo_item;
create trigger trg_memoria_obra_calc
  before insert or update on public.memoria_calculo_item
  for each row execute function public.fn_memoria_obra_calc();

-- ─────────────────────────────────────────────────────────────────────────
-- snapshot_orcamento_atual(_obra_id): produz JSONB com toda a obra
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.snapshot_orcamento_atual(_obra_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  resultado jsonb;
  obra_json jsonb;
  itens_json jsonb;
  indireto_json jsonb;
  snapshots_json jsonb;
  totais_custo numeric(14,2);
  totais_venda numeric(14,2);
begin
  -- Obra com parâmetros
  select to_jsonb(o) into obra_json
    from public.obras o where o.id = _obra_id;

  -- Itens orçamentários (ordenados por codigo)
  select coalesce(jsonb_agg(to_jsonb(i) order by i.codigo), '[]'::jsonb) into itens_json
    from public.item_orcamentario i
   where i.obra_id = _obra_id;

  -- Indireto
  select coalesce(jsonb_agg(to_jsonb(ii) order by ii.codigo), '[]'::jsonb) into indireto_json
    from public.indireto_item ii
   where ii.obra_id = _obra_id;

  -- CPU snapshots referenciados pelos itens (deduplicados)
  select coalesce(jsonb_agg(to_jsonb(cs)), '[]'::jsonb) into snapshots_json
    from public.cpu_snapshot cs
   where cs.id in (
     select distinct cpu_snapshot_id
       from public.item_orcamentario
      where obra_id = _obra_id and cpu_snapshot_id is not null
   );

  -- Totais agregados
  select
    coalesce(sum(custo_total_calc) filter (where parent_id is null), 0),
    coalesce(sum(venda_total_calc) filter (where parent_id is null), 0)
  into totais_custo, totais_venda
  from public.item_orcamentario where obra_id = _obra_id;

  resultado := jsonb_build_object(
    'snapshot_em', to_jsonb(now()),
    'obra', obra_json,
    'itens', itens_json,
    'indireto', indireto_json,
    'cpu_snapshots', snapshots_json,
    'totais', jsonb_build_object(
      'custo_direto', totais_custo,
      'venda_total', totais_venda
    )
  );
  return resultado;
end
$$;

alter function public.snapshot_orcamento_atual(uuid) owner to postgres;
revoke all on function public.snapshot_orcamento_atual(uuid) from public;
grant execute on function public.snapshot_orcamento_atual(uuid) to authenticated, service_role;
