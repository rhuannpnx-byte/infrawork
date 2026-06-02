-- InfraWork — Planejamento (Refator EAP/Marcos/Multi-tarefa, M5):
-- Atualiza/cria triggers para suportar:
--   1) tipo_no IN ('tarefa','grupo','marco') — tarefa-folha exige item;
--      grupo/marco proíbem item.
--   2) Hierarquia EAP: parent.tipo_no='grupo', parent.nivel+1=nivel, max 3.
--   3) Soma de quantidade_alocada por item ≤ item.quantidade_referencia
--      (CONSTRAINT TRIGGER DEFERRABLE).
--   4) Perfil semanal valida vs tarefa.quantidade_alocada (não mais vs
--      item.quantidade_referencia).

-- ─────────────────────────────────────────────────────────────────────────
-- (1) fn_tarefa_so_aceita_servico_grupo: tolerar grupo/marco
-- ─────────────────────────────────────────────────────────────────────────
-- Versão original em 20260524120100:88-118. Esta versão aceita:
--   tipo_no='tarefa' → exige item_orcamentario_id NOT NULL com tipo='servico_grupo' + obra casada
--   tipo_no='grupo'  → exige item_orcamentario_id NULL
--   tipo_no='marco'  → exige item_orcamentario_id NULL
create or replace function public.fn_tarefa_so_aceita_servico_grupo()
returns trigger
language plpgsql
as $$
declare
  item_tipo text;
  item_obra uuid;
  plan_obra uuid;
begin
  if new.tipo_no in ('grupo', 'marco') then
    if new.item_orcamentario_id is not null then
      raise exception 'tipo_no=% nao pode ter item_orcamentario_id (so tarefa-folha)', new.tipo_no;
    end if;
    return new;
  end if;

  -- tipo_no='tarefa' (default): exige item servico_grupo da mesma obra
  if new.item_orcamentario_id is null then
    raise exception 'tarefa-folha exige item_orcamentario_id';
  end if;
  select tipo, obra_id into item_tipo, item_obra
    from public.item_orcamentario where id = new.item_orcamentario_id;
  if item_tipo is null then
    raise exception 'item_orcamentario % inexistente', new.item_orcamentario_id;
  end if;
  if item_tipo <> 'servico_grupo' then
    raise exception 'Apenas itens do tipo servico_grupo podem virar tarefa-folha (tipo=%)', item_tipo;
  end if;

  select obra_id into plan_obra from public.planejamento where id = new.planejamento_id;
  if plan_obra <> item_obra then
    raise exception 'tarefa: planejamento.obra_id (%) difere de item_orcamentario.obra_id (%)',
      plan_obra, item_obra;
  end if;
  return new;
end
$$;

-- Recriar trigger pra disparar também em UPDATE de tipo_no.
drop trigger if exists trg_tarefa_so_aceita_servico_grupo on public.planejamento_tarefa;
create trigger trg_tarefa_so_aceita_servico_grupo
  before insert or update of item_orcamentario_id, planejamento_id, tipo_no
  on public.planejamento_tarefa
  for each row execute function public.fn_tarefa_so_aceita_servico_grupo();

-- ─────────────────────────────────────────────────────────────────────────
-- (2) fn_tarefa_validar_nivel — hierarquia EAP de até 3 níveis
-- ─────────────────────────────────────────────────────────────────────────
-- Regras:
--   * parent_id null → nivel deve ser 1 (raiz)
--   * parent_id not null →
--        parent precisa existir, ser tipo_no='grupo' e estar no mesmo planejamento
--        nivel deve ser parent.nivel + 1
--   * nivel max = 3 (regra de produto: 2 níveis de grupo + 1 nível de folha)
create or replace function public.fn_tarefa_validar_nivel()
returns trigger
language plpgsql
as $$
declare
  pn smallint;
  pt text;
  pp uuid;
begin
  if new.parent_id is null then
    if new.nivel <> 1 then
      raise exception 'parent_id NULL exige nivel=1 (recebido %)', new.nivel;
    end if;
    return new;
  end if;

  select nivel, tipo_no, planejamento_id into pn, pt, pp
    from public.planejamento_tarefa where id = new.parent_id;
  if pn is null then
    raise exception 'parent_id % inexistente', new.parent_id;
  end if;
  if pt <> 'grupo' then
    raise exception 'parent deve ser tipo_no=grupo (parent.tipo_no=%)', pt;
  end if;
  if pp <> new.planejamento_id then
    raise exception 'parent em planejamento diferente (parent.planejamento_id=%, atual=%)',
      pp, new.planejamento_id;
  end if;
  if new.nivel <> pn + 1 then
    raise exception 'nivel invalido (esperado %, recebido %)', pn + 1, new.nivel;
  end if;
  if new.nivel > 3 then
    raise exception 'nivel maximo da EAP = 3 (recebido %)', new.nivel;
  end if;
  return new;
end
$$;

drop trigger if exists trg_tarefa_validar_nivel on public.planejamento_tarefa;
create trigger trg_tarefa_validar_nivel
  before insert or update of parent_id, nivel, tipo_no, planejamento_id
  on public.planejamento_tarefa
  for each row execute function public.fn_tarefa_validar_nivel();

-- ─────────────────────────────────────────────────────────────────────────
-- (3) fn_tarefa_validar_qtd_alocada — soma por item ≤ quantidade_referencia
-- ─────────────────────────────────────────────────────────────────────────
-- CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED — valida no commit, permite
-- transações intermediárias (ex: UPDATE de duas tarefas + DELETE de uma).
-- Tolerância 0.1% (ou mínimo 0.0001) para acomodar arredondamento de numeric.
create or replace function public.fn_tarefa_validar_qtd_alocada()
returns trigger
language plpgsql
as $$
declare
  v_item uuid;
  v_plan uuid;
  v_total numeric;
  v_ref numeric;
  v_tol numeric;
begin
  -- Em DELETE: revalida a soma do item afetado.
  -- Em INSERT/UPDATE: idem com base no novo registro.
  if tg_op = 'DELETE' then
    v_item := old.item_orcamentario_id;
    v_plan := old.planejamento_id;
  else
    v_item := new.item_orcamentario_id;
    v_plan := new.planejamento_id;
  end if;

  -- Grupos/marcos não têm item — nada a validar.
  if v_item is null then return null; end if;

  select coalesce(sum(quantidade_alocada), 0) into v_total
    from public.planejamento_tarefa
   where planejamento_id = v_plan
     and item_orcamentario_id = v_item
     and tipo_no = 'tarefa'
     and quantidade_alocada is not null;

  select quantidade_referencia into v_ref
    from public.item_orcamentario where id = v_item;
  if v_ref is null then return null; end if;

  v_tol := greatest(abs(v_ref) * 0.001, 0.0001);
  if v_total > v_ref + v_tol then
    raise exception 'Quantidade alocada total (%) excede a quantidade orcada (%) do item %',
      v_total, v_ref, v_item
      using errcode = 'check_violation';
  end if;
  return null;
end
$$;

drop trigger if exists trg_tarefa_validar_qtd_alocada on public.planejamento_tarefa;
create constraint trigger trg_tarefa_validar_qtd_alocada
  after insert or update of quantidade_alocada, item_orcamentario_id, planejamento_id, tipo_no
  or delete on public.planejamento_tarefa
  deferrable initially deferred
  for each row execute function public.fn_tarefa_validar_qtd_alocada();

-- ─────────────────────────────────────────────────────────────────────────
-- (4) fn_ptps_validar_soma — comparar perfil com tarefa.quantidade_alocada
-- ─────────────────────────────────────────────────────────────────────────
-- Versão original em 20260527120300:17-73 comparava SUM(perfil) com
-- item.quantidade_referencia. Como agora N tarefas dividem o mesmo item,
-- cada tarefa deve bater com SUA quantidade_alocada.
-- Backfill (M4) garante: tarefas pré-existentes têm quantidade_alocada = item.quantidade_referencia.
create or replace function public.fn_ptps_validar_soma()
returns trigger
language plpgsql
as $$
declare
  v_tid uuid;
  v_total numeric;
  v_ref numeric;
  v_tol numeric;
  v_tipo_no text;
begin
  v_tid := coalesce(new.tarefa_id, old.tarefa_id);

  select coalesce(sum(quantidade_planejada), 0) into v_total
    from public.planejamento_tarefa_perfil_semana where tarefa_id = v_tid;
  if v_total = 0 then return null; end if;

  select quantidade_alocada, tipo_no into v_ref, v_tipo_no
    from public.planejamento_tarefa where id = v_tid;

  -- Grupos/marcos não têm perfil semanal. Se aparecer perfil, é estado inconsistente.
  if v_tipo_no in ('grupo', 'marco') then
    raise exception 'tarefa % (tipo_no=%) nao deve ter perfil semanal', v_tid, v_tipo_no
      using errcode = 'check_violation';
  end if;

  -- Tarefa-folha sem quantidade_alocada: sem comparação possível (backfill garante NOT NULL).
  if v_ref is null then return null; end if;

  v_tol := greatest(abs(v_ref) * 0.001, 0.0001);
  if abs(v_total - v_ref) > v_tol then
    raise exception 'Soma do perfil semanal (%) diverge da quantidade alocada (%) da tarefa (delta=%)',
      v_total, v_ref, v_total - v_ref
      using errcode = 'check_violation';
  end if;
  return null;
end
$$;
