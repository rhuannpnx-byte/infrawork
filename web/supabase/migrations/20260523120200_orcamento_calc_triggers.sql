-- InfraWork — Orçamento (Fase 1.2): triggers de cálculo e helpers
--
-- Pipeline de cálculo (em cascata):
--   preco_recurso  →  cpu_item.custo_total_calc  →  cpu.custo_*_calc
--
-- Helpers SECURITY DEFINER (owner=postgres, BYPASSRLS):
--   - preco_vigente_recurso(_recurso_id, _data) — busca preço vigente em data
--   - recurso_empresa(_recurso_id)              — para policies de recurso_preco
--   - cpu_empresa(_cpu_id)                      — para policies de cpu_item
--   - servico_empresa(_servico_id)              — para validação cruzada
--
-- Triggers locais (sem SECURITY DEFINER — operam só na linha em mutação):
--   - fn_encargos_total_calc        : soma percentuais
--   - fn_servico_nivel_calc         : calcula nivel a partir do parent
--   - fn_cpu_item_calc              : calcula custo da linha
--   - fn_cpu_item_propagate         : dispara fn_cpu_recalc(cpu_id) após mudanças
--   - fn_cpu_recalc                 : agrega cpu_items na cpu
--   - fn_recurso_preco_propagate    : invalida cpu_items que usam o recurso

-- ─────────────────────────────────────────────────────────────────────────
-- Helpers SECURITY DEFINER (BYPASSRLS) — owner postgres
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.recurso_empresa(_recurso_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select empresa_id from public.recurso where id = _recurso_id
$$;

create or replace function public.servico_empresa(_servico_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select empresa_id from public.servico where id = _servico_id
$$;

create or replace function public.cpu_empresa(_cpu_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select empresa_id from public.cpu where id = _cpu_id
$$;

-- Busca o preço vigente de um recurso em uma data específica (default = hoje).
-- Retorna NULL se não existir preço vigente.
create or replace function public.preco_vigente_recurso(
  _recurso_id uuid,
  _data       date default current_date
)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select custo_unitario
    from public.recurso_preco
   where recurso_id = _recurso_id
     and vigencia_inicio <= _data
     and (vigencia_fim is null or vigencia_fim >= _data)
   order by vigencia_inicio desc
   limit 1
$$;

alter function public.recurso_empresa(uuid)              owner to postgres;
alter function public.servico_empresa(uuid)              owner to postgres;
alter function public.cpu_empresa(uuid)                  owner to postgres;
alter function public.preco_vigente_recurso(uuid, date)  owner to postgres;

revoke all on function public.recurso_empresa(uuid)              from public;
revoke all on function public.servico_empresa(uuid)              from public;
revoke all on function public.cpu_empresa(uuid)                  from public;
revoke all on function public.preco_vigente_recurso(uuid, date)  from public;
grant execute on function public.recurso_empresa(uuid)              to authenticated;
grant execute on function public.servico_empresa(uuid)              to authenticated;
grant execute on function public.cpu_empresa(uuid)                  to authenticated;
grant execute on function public.preco_vigente_recurso(uuid, date)  to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- encargos_sociais_regime: total = soma dos percentuais
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.fn_encargos_total_calc()
returns trigger
language plpgsql
as $$
begin
  new.total_perc_calc :=
    coalesce(new.inss_perc, 0) +
    coalesce(new.sat_rat_perc, 0) +
    coalesce(new.salario_educacao_perc, 0) +
    coalesce(new.sesi_senai_sebrae_perc, 0) +
    coalesce(new.incra_perc, 0) +
    coalesce(new.fgts_perc, 0) +
    coalesce(new.ferias_terco_perc, 0) +
    coalesce(new.decimo_terceiro_perc, 0) +
    coalesce(new.fgts_rescisao_perc, 0) +
    coalesce(new.outros_perc, 0);
  return new;
end
$$;

drop trigger if exists trg_encargos_total_calc on public.encargos_sociais_regime;
create trigger trg_encargos_total_calc
  before insert or update on public.encargos_sociais_regime
  for each row execute function public.fn_encargos_total_calc();

-- ─────────────────────────────────────────────────────────────────────────
-- servico: calcula nivel a partir do parent + valida mesma empresa
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.fn_servico_nivel_calc()
returns trigger
language plpgsql
as $$
declare
  parent_empresa uuid;
  parent_nivel   smallint;
begin
  if new.parent_id is null then
    new.nivel := 1;
  else
    select empresa_id, nivel into parent_empresa, parent_nivel
      from public.servico
     where id = new.parent_id;
    if parent_empresa is null then
      raise exception 'parent_id inexistente: %', new.parent_id;
    end if;
    if parent_empresa <> new.empresa_id then
      raise exception 'servico.parent precisa ser da mesma empresa';
    end if;
    new.nivel := parent_nivel + 1;
  end if;
  return new;
end
$$;

drop trigger if exists trg_servico_nivel_calc on public.servico;
create trigger trg_servico_nivel_calc
  before insert or update of parent_id, empresa_id on public.servico
  for each row execute function public.fn_servico_nivel_calc();

-- ─────────────────────────────────────────────────────────────────────────
-- cpu_item: calcula custo_total_calc baseado em preço vigente + grupo
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.fn_cpu_item_calc()
returns trigger
language plpgsql
as $$
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
      -- qtde * preco_horario * horas_dia
      new.custo_total_calc := coalesce(new.quantidade, 0)
                             * preco
                             * coalesce(new.horas_dia, 0);
    when 'MO' then
      -- mão de obra: qtde * preco_horario * horas_dia
      new.custo_total_calc := coalesce(new.quantidade, 0)
                             * preco
                             * coalesce(new.horas_dia, 0);
    when 'MATERIAL' then
      -- Se houver `consumo_material_por_unid`: consumo * producao_diaria * preco
      -- Caso contrário: quantidade * preco (qtde já está em base diária)
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
      -- SOMA sobre EQUIPAMENTOS da mesma CPU:
      --   SUM(qtd_eq * cons_l_h * horas_dia * indice_produtividade) * preco_combustivel
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
  end case;
  return new;
end
$$;

drop trigger if exists trg_cpu_item_calc on public.cpu_item;
create trigger trg_cpu_item_calc
  before insert or update on public.cpu_item
  for each row execute function public.fn_cpu_item_calc();

-- ─────────────────────────────────────────────────────────────────────────
-- cpu: agrega custos da cpu_item
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.fn_cpu_recalc(_cpu_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
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

alter function public.fn_cpu_recalc(uuid) owner to postgres;
revoke all on function public.fn_cpu_recalc(uuid) from public;
grant execute on function public.fn_cpu_recalc(uuid) to authenticated;

-- Trigger AFTER em cpu_item: roda cpu_recalc.
create or replace function public.fn_cpu_item_propagate()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    perform public.fn_cpu_recalc(old.cpu_id);
    return old;
  else
    perform public.fn_cpu_recalc(new.cpu_id);
    return new;
  end if;
end
$$;

drop trigger if exists trg_cpu_item_propagate_iud on public.cpu_item;
create trigger trg_cpu_item_propagate_iud
  after insert or update or delete on public.cpu_item
  for each row execute function public.fn_cpu_item_propagate();

-- ─────────────────────────────────────────────────────────────────────────
-- cpu: quando producao_diaria_qtde muda → recalcular custo_unit
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.fn_cpu_producao_changed()
returns trigger
language plpgsql
as $$
begin
  if new.producao_diaria_qtde is distinct from old.producao_diaria_qtde then
    perform public.fn_cpu_recalc(new.id);
  end if;
  return new;
end
$$;

drop trigger if exists trg_cpu_producao_changed on public.cpu;
create trigger trg_cpu_producao_changed
  after update of producao_diaria_qtde on public.cpu
  for each row execute function public.fn_cpu_producao_changed();

-- ─────────────────────────────────────────────────────────────────────────
-- recurso_preco: propaga mudança de preço para cpu_items dependentes
--
-- Faz UPDATE no-op (touch updated_at) nos cpu_items afetados de CPUs vigentes,
-- o que dispara fn_cpu_item_calc → fn_cpu_item_propagate → fn_cpu_recalc.
-- Também invalida custo dos itens COMBUSTIVEL na mesma CPU (consomem dos EQ).
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.fn_recurso_preco_propagate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

alter function public.fn_recurso_preco_propagate() owner to postgres;

drop trigger if exists trg_recurso_preco_propagate on public.recurso_preco;
create trigger trg_recurso_preco_propagate
  after insert or update or delete on public.recurso_preco
  for each row execute function public.fn_recurso_preco_propagate();

-- ─────────────────────────────────────────────────────────────────────────
-- cpu: ao criar/marcar como vigente, ao mudar `is_vigente` em outras versões,
-- garantir que apenas uma fique vigente por serviço (defesa em profundidade
-- além do índice único parcial — esse já bloqueia mas dá erro feio).
--
-- Estratégia: quando um INSERT/UPDATE marca uma CPU como vigente, marca todas
-- as outras do mesmo serviço como não-vigentes ANTES do commit, evitando o
-- erro do índice único.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.fn_cpu_demarcar_outras()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_vigente = true then
    update public.cpu
       set is_vigente = false
     where servico_id = new.servico_id
       and id <> new.id
       and is_vigente = true;
  end if;
  return new;
end
$$;

alter function public.fn_cpu_demarcar_outras() owner to postgres;

drop trigger if exists trg_cpu_demarcar_outras on public.cpu;
create trigger trg_cpu_demarcar_outras
  before insert or update of is_vigente, servico_id on public.cpu
  for each row execute function public.fn_cpu_demarcar_outras();
