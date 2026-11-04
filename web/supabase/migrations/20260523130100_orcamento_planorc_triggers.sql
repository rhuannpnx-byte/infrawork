-- InfraWork — Orçamento (Fase 2.B): triggers + função recalcular_orcamento
--
-- Triggers (BEFORE INSERT/UPDATE em item_orcamentario, FOLHA apenas):
--   - fn_item_orc_nivel_calc:   calcula `nivel` a partir do parent (valida obra)
--   - fn_item_orc_codigo_gerar: auto-gera código se NULL (próximo livre no parent)
--   - fn_item_orc_folha_calc:   calcula campos *_calc da folha
--
-- Função PL/pgSQL (chamada pela Edge Function recalcular-orcamento):
--   - recalcular_orcamento(_obra_id) — faz rollup ascendente por nível com lock
--     advisory na obra para evitar concorrência.
--
-- Triggers de bloqueio:
--   - fn_cpu_snapshot_imutavel: bloqueia UPDATE/DELETE de cpu_snapshot
--     (defesa em profundidade — RLS também bloqueia clients normais)

-- ─────────────────────────────────────────────────────────────────────────
-- nivel (a partir do parent)
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.fn_item_orc_nivel_calc()
returns trigger
language plpgsql
as $$
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

drop trigger if exists trg_item_orc_nivel_calc on public.item_orcamentario;
create trigger trg_item_orc_nivel_calc
  before insert or update of parent_id, obra_id on public.item_orcamentario
  for each row execute function public.fn_item_orc_nivel_calc();

-- ─────────────────────────────────────────────────────────────────────────
-- codigo auto-gerado (próximo livre no parent)
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.fn_item_orc_codigo_gerar()
returns trigger
language plpgsql
as $$
declare
  parent_codigo text;
  max_sufixo    int;
begin
  if new.codigo is not null and trim(new.codigo) <> '' then
    return new;
  end if;

  -- Lock por obra para evitar duplicidade em corrida
  perform pg_advisory_xact_lock(hashtext('item_orc:' || new.obra_id::text));

  if new.parent_id is null then
    -- Raiz: pega o maior codigo numérico simples e soma 1
    select coalesce(max((codigo)::int), 0) into max_sufixo
      from public.item_orcamentario
     where obra_id = new.obra_id
       and parent_id is null
       and codigo ~ '^[0-9]+$';
    new.codigo := lpad((max_sufixo + 1)::text, 3, '0');
  else
    select codigo into parent_codigo
      from public.item_orcamentario where id = new.parent_id;
    -- Pega sufixos do tipo parent.XX e soma 1
    select coalesce(max(
             nullif(substring(codigo from length(parent_codigo) + 2), '')::int
           ), 0) into max_sufixo
      from public.item_orcamentario
     where obra_id = new.obra_id
       and parent_id = new.parent_id
       and codigo ~ ('^' || regexp_replace(parent_codigo, '\.', '\\.', 'g') || '\.[0-9]+$');
    new.codigo := parent_codigo || '.' || lpad((max_sufixo + 1)::text, 2, '0');
  end if;
  return new;
end
$$;

drop trigger if exists trg_item_orc_codigo_gerar on public.item_orcamentario;
create trigger trg_item_orc_codigo_gerar
  before insert on public.item_orcamentario
  for each row execute function public.fn_item_orc_codigo_gerar();

-- ─────────────────────────────────────────────────────────────────────────
-- folha: calcula *_calc (custo_unitario, custo_total, venda_total, lucratividade)
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.fn_item_orc_folha_calc()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  obra_bdi_padrao  numeric(14,4);
  obra_aliquota    numeric(7,4);
  snap_custo_unit  numeric(14,4);
  bdi_efetivo      numeric(14,4);
begin
  new.updated_at := now();

  -- Agrupador: zera campos da folha (rollup vem da Edge Function depois)
  if new.unidade is null then
    new.custo_unitario_calc     := null;
    -- custo_total_calc e venda_total_calc são reconstruídos pela EF; mantém o que vier
    new.lucratividade_perc_calc := null;
    return new;
  end if;

  -- Folha: lê obra + snapshot
  select bdi_padrao_perc,
         coalesce(aliquota_iss_perc, 0) + coalesce(aliquota_pis_perc, 0)
         + coalesce(aliquota_cofins_perc, 0) + coalesce(aliquota_outros_perc, 0)
    into obra_bdi_padrao, obra_aliquota
    from public.obras where id = new.obra_id;

  if new.cpu_snapshot_id is not null then
    select custo_unit into snap_custo_unit
      from public.cpu_snapshot where id = new.cpu_snapshot_id;
  else
    snap_custo_unit := 0;
  end if;

  bdi_efetivo := coalesce(new.bdi_perc, obra_bdi_padrao, 0);

  new.custo_unitario_calc := coalesce(snap_custo_unit, 0);
  new.custo_total_calc    := coalesce(new.quantidade, 0) * new.custo_unitario_calc;
  new.venda_total_calc    := coalesce(new.quantidade, 0) * coalesce(new.venda_unitaria, 0) * (1 + bdi_efetivo);

  if new.venda_total_calc > 0 then
    new.lucratividade_perc_calc :=
      (new.venda_total_calc - new.custo_total_calc - new.venda_total_calc * obra_aliquota) / new.venda_total_calc;
  else
    new.lucratividade_perc_calc := null;
  end if;

  return new;
end
$$;

alter function public.fn_item_orc_folha_calc() owner to postgres;

drop trigger if exists trg_item_orc_folha_calc on public.item_orcamentario;
create trigger trg_item_orc_folha_calc
  before insert or update on public.item_orcamentario
  for each row execute function public.fn_item_orc_folha_calc();

-- ─────────────────────────────────────────────────────────────────────────
-- cpu_snapshot: blindar UPDATE e DELETE (defesa em profundidade)
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.fn_cpu_snapshot_imutavel()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'cpu_snapshot é imutável; crie um novo snapshot via Edge Function';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'cpu_snapshot não pode ser deletado diretamente; cascade da obra apaga';
  end if;
  return null;
end
$$;

drop trigger if exists trg_cpu_snapshot_imutavel on public.cpu_snapshot;
create trigger trg_cpu_snapshot_imutavel
  before update or delete on public.cpu_snapshot
  for each row execute function public.fn_cpu_snapshot_imutavel();

-- ─────────────────────────────────────────────────────────────────────────
-- recalcular_orcamento(_obra_id) — rollup ascendente da árvore + lucratividade
--
-- Faz tudo numa transação com lock advisory para evitar duas execuções
-- concorrentes na mesma obra. Retorna resumo em JSONB.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.recalcular_orcamento(_obra_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  obra_bdi_padrao  numeric(14,4);
  obra_aliquota    numeric(7,4);
  max_nivel        smallint;
  lvl              smallint;
  itens_total      int;
  custo_total      numeric(14,2);
  venda_total      numeric(14,2);
  lucr_global      numeric(7,4);
  inicio_ms        bigint;
begin
  inicio_ms := (extract(epoch from clock_timestamp()) * 1000)::bigint;

  perform pg_advisory_xact_lock(hashtext('orc:' || _obra_id::text));

  select bdi_padrao_perc,
         coalesce(aliquota_iss_perc, 0) + coalesce(aliquota_pis_perc, 0)
         + coalesce(aliquota_cofins_perc, 0) + coalesce(aliquota_outros_perc, 0)
    into obra_bdi_padrao, obra_aliquota
    from public.obras where id = _obra_id;

  -- 1) Força recálculo de todas folhas (UPDATE no-op dispara trigger)
  update public.item_orcamentario
     set updated_at = now()
   where obra_id = _obra_id and unidade is not null;

  -- 2) Rollup ascendente para agrupadores, do nível mais profundo até a raiz
  select coalesce(max(nivel), 0) into max_nivel
    from public.item_orcamentario
   where obra_id = _obra_id and unidade is null;

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
       and p.unidade is null
       and p.nivel = lvl;
    lvl := lvl - 1;
  end loop;

  -- 3) Totais globais (raízes)
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
