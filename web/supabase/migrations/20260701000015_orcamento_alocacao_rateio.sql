-- InfraWork Web — Agrupamentos com RATEIO: a planilha de venda fica intacta.
--
-- Antes: agrupar movia as receitas para dentro do servico_grupo (parent_id),
-- então (a) a planilha de venda perdia a forma do contrato e (b) uma receita
-- só cabia em um agrupador.
--
-- Agora:
--   * etapas + receitas = planilha de venda, exatamente como no contrato;
--   * servico_grupo = serviço executivo, FORA da árvore (sempre na raiz, sem
--     filhos), código próprio "S01", "S02"…;
--   * item_orc_alocacao liga receita → serviço com uma fração (rateio);
--   * venda do serviço  = Σ venda da receita × fração;
--   * qtd do serviço    = manual, ou Σ qtd das receitas que compõem × fração;
--   * custo do serviço  = CPU/indireto × qtd (como antes) e é APROPRIADO de
--     volta às receitas pela venda alocada → receitas e etapas da planilha de
--     venda passam a ter custo e lucratividade;
--   * totais: venda = Σ raízes da planilha de venda; custo direto = Σ serviços.
--
-- Critérios de rateio (por receita, um só):
--   percentual  valor = % do serviço (Σ ≤ 100; < 100 deixa saldo)
--   peso        valor = quantidade física do serviço (fração = valor/Σ valores)
--   venda       sem valor; fração ∝ venda-base de cada serviço = Σ venda×fração
--               das receitas que compõem a quantidade dele (ou `bases`, se
--               informadas). Recalculada a cada recalcular_orcamento.

-- ─── 1. Tabela de alocação ────────────────────────────────────────────────
create table if not exists public.item_orc_alocacao (
  id          uuid        primary key default gen_random_uuid(),
  obra_id     uuid        not null references public.obras(id) on delete cascade,
  grupo_id    uuid        not null references public.item_orcamentario(id) on delete cascade,
  receita_id  uuid        not null references public.item_orcamentario(id) on delete cascade,
  criterio    text        not null default 'percentual'
                          check (criterio in ('percentual', 'peso', 'venda')),
  valor       numeric(18, 6),
  bases       uuid[],
  compoe_qtd  boolean     not null default false,
  fracao      numeric(14, 10) not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (grupo_id, receita_id)
);
create index if not exists idx_item_orc_aloc_obra    on public.item_orc_alocacao(obra_id);
create index if not exists idx_item_orc_aloc_receita on public.item_orc_alocacao(receita_id);

comment on table public.item_orc_alocacao is
  'Rateio: receita da planilha de venda → serviço (servico_grupo), com fração. Uma receita pode ir a vários serviços.';

-- Validação de cada alocação
create or replace function public.fn_item_orc_aloc_validar()
returns trigger language plpgsql security definer set search_path = public as $$
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
alter function public.fn_item_orc_aloc_validar() owner to postgres;

drop trigger if exists trg_item_orc_aloc_validar on public.item_orc_alocacao;
create trigger trg_item_orc_aloc_validar
  before insert or update on public.item_orc_alocacao
  for each row execute function public.fn_item_orc_aloc_validar();

-- RLS: espelha item_orcamentario
alter table public.item_orc_alocacao enable row level security;
drop policy if exists item_orc_aloc_god_all on public.item_orc_alocacao;
create policy item_orc_aloc_god_all on public.item_orc_alocacao
  for all using (auth_role() = 'god') with check (auth_role() = 'god');
drop policy if exists item_orc_aloc_adm_all on public.item_orc_alocacao;
create policy item_orc_aloc_adm_all on public.item_orc_alocacao
  for all using (auth_role() = 'adm' and obra_empresa(obra_id) = auth_empresa_id())
  with check (auth_role() = 'adm' and obra_empresa(obra_id) = auth_empresa_id());
drop policy if exists item_orc_aloc_eng_all on public.item_orc_alocacao;
create policy item_orc_aloc_eng_all on public.item_orc_alocacao
  for all using (auth_role() = 'engenheiro' and has_obra_permissao(obra_id, auth.uid()))
  with check (auth_role() = 'engenheiro' and has_obra_permissao(obra_id, auth.uid()));
drop policy if exists item_orc_aloc_apoio_select on public.item_orc_alocacao;
create policy item_orc_aloc_apoio_select on public.item_orc_alocacao
  for select using (auth_role() = 'apoio' and has_obra_permissao(obra_id, auth_engenheiro_id()));
grant select, insert, update, delete on public.item_orc_alocacao to authenticated;

-- ─── 2. Migra os agrupamentos existentes (receitas filhas → alocação 100%) ─
insert into public.item_orc_alocacao (obra_id, grupo_id, receita_id, criterio, valor, compoe_qtd)
select r.obra_id, g.id, r.id, 'percentual', 100,
       case when g.qtd_ref_modo = 'manual' then false
            when g.qtd_ref_filhos is null or array_length(g.qtd_ref_filhos, 1) is null then true
            else r.id = any(g.qtd_ref_filhos) end
  from public.item_orcamentario r
  join public.item_orcamentario g on g.id = r.parent_id and g.tipo = 'servico_grupo'
 where r.tipo = 'receita'
on conflict (grupo_id, receita_id) do nothing;

-- receitas voltam ao pai original (pelo prefixo do código), senão à raiz
update public.item_orcamentario r
   set parent_id = (
         select p.id from public.item_orcamentario p
          where p.obra_id = r.obra_id and p.tipo = 'etapa'
            and position('.' in r.codigo) > 0
            and p.codigo = left(r.codigo, length(r.codigo) - position('.' in reverse(r.codigo)))
          limit 1)
  from public.item_orcamentario g
 where g.id = r.parent_id and g.tipo = 'servico_grupo' and r.tipo = 'receita';

-- serviços sempre na raiz; qtd_ref_filhos deixa de ser usado (vale compoe_qtd)
update public.item_orcamentario set parent_id = null
 where tipo = 'servico_grupo' and parent_id is not null;
update public.item_orcamentario set qtd_ref_filhos = null
 where tipo = 'servico_grupo' and qtd_ref_filhos is not null;

-- ─── 3. Hierarquia: serviço não tem pai nem filhos ────────────────────────
create or replace function public.fn_item_orc_parent_tipo_check()
returns trigger language plpgsql as $$
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

-- ─── 4. Receita alocada não pode ser excluída ─────────────────────────────
create or replace function public.fn_item_orc_bloqueia_exclusao_alocada()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  servicos text;
begin
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
alter function public.fn_item_orc_bloqueia_exclusao_alocada() owner to postgres;

drop trigger if exists trg_item_orc_bloqueia_exclusao_alocada on public.item_orcamentario;
create trigger trg_item_orc_bloqueia_exclusao_alocada
  before delete on public.item_orcamentario
  for each row execute function public.fn_item_orc_bloqueia_exclusao_alocada();

-- ─── 5. Código dos serviços: S01, S02… (namespace próprio) ────────────────
alter table public.item_orcamentario drop constraint if exists chk_item_orc_codigo;
alter table public.item_orcamentario
  add constraint chk_item_orc_codigo
  check (codigo ~ '^[0-9]+(\.[0-9]+)*$' or (tipo = 'servico_grupo' and codigo ~ '^S[0-9]+$'));

create or replace function public.fn_item_orc_codigo_gerar()
returns trigger
language plpgsql
as $$
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
$$;

-- ─── 6. Linha: receita mantém o custo apropriado (setado no recálculo) ────
create or replace function public.fn_item_orc_linha_calc()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  snap_custo_unit numeric(14,4);
  ind_valor       numeric(14,2);
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
      select valor_total into ind_valor
        from public.indireto_item where id = new.indireto_id;
      new.custo_unitario_calc := coalesce(ind_valor, 0);
    else
      if new.cpu_snapshot_id is not null then
        select custo_unit into snap_custo_unit
          from public.cpu_snapshot where id = new.cpu_snapshot_id;
      else
        snap_custo_unit := 0;
      end if;
      new.custo_unitario_calc := coalesce(snap_custo_unit, 0);
    end if;
    new.custo_total_calc := coalesce(new.quantidade_referencia, 0) * new.custo_unitario_calc;
    -- venda_total_calc e lucratividade_perc_calc: recalcular_orcamento
  else
    new.custo_unitario_calc := null;
  end if;

  return new;
end
$$;

-- ─── 7. Frações do rateio ─────────────────────────────────────────────────
create or replace function public.fn_item_orc_aloc_recalcular(_obra_id uuid)
returns void language plpgsql security definer set search_path = public as $$
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
alter function public.fn_item_orc_aloc_recalcular(uuid) owner to postgres;

-- ─── 8. recalcular_orcamento ──────────────────────────────────────────────
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
begin
  inicio_ms := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  perform pg_advisory_xact_lock(hashtext('orc:' || _obra_id::text));

  select coalesce(aliquota_iss_perc, 0) + coalesce(aliquota_pis_perc, 0)
       + coalesce(aliquota_cofins_perc, 0) + coalesce(aliquota_outros_perc, 0)
    into obra_aliquota
    from public.obras where id = _obra_id;

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

-- ─── 9. Snapshot da revisão: inclui alocações; totais novos ───────────────
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
alter function public.snapshot_orcamento_atual(uuid) owner to postgres;
revoke all on function public.snapshot_orcamento_atual(uuid) from public;
grant execute on function public.snapshot_orcamento_atual(uuid) to authenticated, service_role;

-- ─── 10. Consolidado: venda = planilha de venda; custo direto = serviços ──
create or replace view public.vw_orcamento_consolidado
with (security_invoker = true)
as
with
raizes as (
  select obra_id,
         coalesce(sum(venda_total_calc) filter (where parent_id is null and tipo <> 'servico_grupo'), 0)::numeric(14, 2)
           as venda_total,
         coalesce(sum(custo_total_calc) filter (where tipo = 'servico_grupo'), 0)::numeric(14, 2)
           as custo_direto_calc
    from public.item_orcamentario
   group by obra_id
),
vinculados as (
  select obra_id, indireto_id
    from public.item_orcamentario
   where indireto_id is not null
   group by obra_id, indireto_id
),
indireto_vinc as (
  select io.obra_id,
         coalesce(sum(io.custo_total_calc), 0)::numeric(14, 2) as custo_indireto_vinculado
    from public.item_orcamentario io
   where io.indireto_id is not null
   group by io.obra_id
),
indireto_stand as (
  select i.obra_id,
         coalesce(sum(coalesce(i.valor_total, 0) * coalesce(i.distribuicao_perc, 1)), 0)::numeric(14, 2)
           as custo_indireto_standalone
    from public.indireto_item i
   where not exists (
           select 1 from vinculados v
            where v.obra_id = i.obra_id and v.indireto_id = i.id
         )
   group by i.obra_id
),
taxa as (
  select distinct on (obra_id)
         obra_id,
         coalesce(total_perc_calc, 0)::numeric(7, 4) as aliquota_total_perc
    from public.encargos_sociais_regime
   where ativo = true
     and (vigencia_inicio is null or vigencia_inicio <= current_date)
     and (vigencia_fim    is null or vigencia_fim    >= current_date)
   order by obra_id, vigencia_inicio desc nulls last
)
select
  o.id                                                                          as obra_id,
  coalesce(r.venda_total, 0)                                                    as venda_total,
  coalesce(r.custo_direto_calc, 0)                                              as custo_direto_calc,
  coalesce(s.custo_indireto_standalone, 0)                                      as custo_indireto_standalone,
  coalesce(v.custo_indireto_vinculado, 0)                                       as custo_indireto_vinculado,
  (coalesce(r.custo_direto_calc, 0) - coalesce(v.custo_indireto_vinculado, 0))  as custo_direto_real,
  (coalesce(s.custo_indireto_standalone, 0) + coalesce(v.custo_indireto_vinculado, 0))
                                                                                as custo_indireto_total,
  (coalesce(r.custo_direto_calc, 0) + coalesce(s.custo_indireto_standalone, 0)) as custo_total,
  coalesce(t.aliquota_total_perc, 0)                                            as aliquota_total_perc,
  (coalesce(r.venda_total, 0) * coalesce(t.aliquota_total_perc, 0))::numeric(14, 2)
                                                                                as impostos,
  (
    coalesce(r.venda_total, 0)
    - coalesce(r.custo_direto_calc, 0)
    - coalesce(s.custo_indireto_standalone, 0)
    - (coalesce(r.venda_total, 0) * coalesce(t.aliquota_total_perc, 0))
  )::numeric(14, 2)                                                             as lucro_liquido,
  case
    when coalesce(r.venda_total, 0) = 0 then null
    else round(
      (
        (
          coalesce(r.venda_total, 0)
          - coalesce(r.custo_direto_calc, 0)
          - coalesce(s.custo_indireto_standalone, 0)
          - (coalesce(r.venda_total, 0) * coalesce(t.aliquota_total_perc, 0))
        )
        / nullif(coalesce(r.venda_total, 0), 0)
      )::numeric, 4
    )
  end                                                                           as lucratividade_perc
from public.obras o
left join raizes         r on r.obra_id = o.id
left join indireto_stand s on s.obra_id = o.id
left join indireto_vinc  v on v.obra_id = o.id
left join taxa           t on t.obra_id = o.id;

-- ─── 11. Consolidado por revisão (snapshot): mesmos totais ─────────────────
create or replace function public.vw_orcamento_consolidado_revisao(_revisao_id uuid)
returns table (
  revisao_id uuid,
  versao int,
  status text,
  rotulo text,
  obra_id uuid,
  venda_total numeric,
  custo_direto_calc numeric,
  custo_indireto_standalone numeric,
  custo_total numeric,
  aliquota_total_perc numeric,
  impostos numeric,
  lucro_liquido numeric,
  lucratividade_perc numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  snap jsonb;
  v_obra_id uuid;
  v_venda numeric(14, 2) := 0;
  v_custo_direto numeric(14, 2) := 0;
  v_indireto_stand numeric(14, 2) := 0;
  v_aliquota numeric(7, 4) := 0;
  v_versao int;
  v_status text;
  v_rotulo text;
  vinculados_set jsonb;
begin
  -- Lê snapshot + metadata da revisão.
  select r.snapshot, r.obra_id, r.versao, r.status, r.rotulo
    into snap, v_obra_id, v_versao, v_status, v_rotulo
    from public.revisao_orcamento r
   where r.id = _revisao_id;

  if snap is null then
    return;
  end if;

  -- Set de IDs de indiretos vinculados a algum item via item_orcamentario.indireto_id.
  -- Coletado do array snapshot.itens (filtrando indireto_id IS NOT NULL).
  select coalesce(jsonb_agg(elem -> 'indireto_id'), '[]'::jsonb)
    into vinculados_set
    from jsonb_array_elements(coalesce(snap -> 'itens', '[]'::jsonb)) elem
   where elem ? 'indireto_id' and (elem ->> 'indireto_id') is not null;

  -- venda_total + custo_direto_calc: soma raízes (parent_id IS NULL) do snapshot.
  -- custo_total_calc das raízes já inclui indiretos vinculados via trigger no
  -- momento do snapshot (consistente com a view atual).
  -- venda = raízes da planilha de venda; custo direto = serviços (agrupadores).
  select
    coalesce(sum((elem ->> 'venda_total_calc')::numeric)
             filter (where (elem ->> 'parent_id') is null and coalesce(elem ->> 'tipo', '') <> 'servico_grupo'), 0),
    coalesce(sum((elem ->> 'custo_total_calc')::numeric)
             filter (where (elem ->> 'tipo') = 'servico_grupo'), 0)
    into v_venda, v_custo_direto
    from jsonb_array_elements(coalesce(snap -> 'itens', '[]'::jsonb)) elem;

  -- custo_indireto_standalone: indiretos do snapshot que NÃO estão em vinculados_set.
  select coalesce(sum(
            (elem ->> 'valor_total')::numeric
          * coalesce((elem ->> 'distribuicao_perc')::numeric, 1)
         ), 0)
    into v_indireto_stand
    from jsonb_array_elements(coalesce(snap -> 'indireto', '[]'::jsonb)) elem
   where not (vinculados_set @> jsonb_build_array(elem ->> 'id'));

  -- Alíquota total: pega do regime tributário VIGENTE NA OBRA HOJE (mesmo
  -- comportamento da view atual). Snapshot não captura taxa por design.
  select coalesce(total_perc_calc, 0)
    into v_aliquota
    from public.encargos_sociais_regime
   where obra_id = v_obra_id
     and ativo = true
     and (vigencia_inicio is null or vigencia_inicio <= current_date)
     and (vigencia_fim    is null or vigencia_fim    >= current_date)
   order by vigencia_inicio desc nulls last
   limit 1;

  return query
    select
      _revisao_id,
      v_versao,
      v_status,
      v_rotulo,
      v_obra_id,
      v_venda,
      v_custo_direto,
      v_indireto_stand,
      (v_custo_direto + v_indireto_stand)::numeric(14, 2)               as custo_total,
      v_aliquota,
      (v_venda * v_aliquota)::numeric(14, 2)                            as impostos,
      (v_venda - v_custo_direto - v_indireto_stand - v_venda * v_aliquota)::numeric(14, 2)
                                                                        as lucro_liquido,
      case
        when v_venda = 0 then null
        else round(((v_venda - v_custo_direto - v_indireto_stand - v_venda * v_aliquota)
                    / nullif(v_venda, 0))::numeric, 4)
      end                                                               as lucratividade_perc;
end
$$;

alter function public.vw_orcamento_consolidado_revisao(uuid) owner to postgres;
revoke all on function public.vw_orcamento_consolidado_revisao(uuid) from public;
grant execute on function public.vw_orcamento_consolidado_revisao(uuid) to authenticated, service_role;

