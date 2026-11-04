-- InfraWork Web — agrupador (servico_grupo) pode existir SEM composição.
--
-- Fluxo: importa-se a planilha de venda, agrupam-se as receitas e só depois
-- criam-se/vinculam-se as composições. Um agrupador sem vínculo só soma a
-- venda das receitas; ele NÃO hidrata o que depende do serviço (custo/CPU,
-- programação por equipes, lançamento de produção) até ser vinculado a uma
-- composição (ou a um indireto).

-- ─── 1. Coerência por tipo: vínculo opcional no servico_grupo ─────────────
alter table public.item_orcamentario drop constraint if exists chk_item_orc_tipo_coerencia;
alter table public.item_orcamentario
  add constraint chk_item_orc_tipo_coerencia
  check (
    (tipo = 'receita'
       and unidade is not null and quantidade is not null and venda_unitaria is not null
       and servico_id is null and cpu_snapshot_id is null and indireto_id is null
       and quantidade_referencia is null and unidade_referencia is null
       and qtd_ref_modo is null and qtd_ref_filhos is null)
    or
    (tipo = 'servico_grupo'
       -- composição OU indireto OU nenhum (ainda não vinculado) — nunca os dois
       and not (servico_id is not null and indireto_id is not null)
       and (servico_id is not null or cpu_snapshot_id is null)
       and quantidade_referencia is not null and qtd_ref_modo is not null
       and (unidade_referencia is not null or (servico_id is null and indireto_id is null))
       and unidade is null and quantidade is null and venda_unitaria is null)
    or
    (tipo = 'etapa'
       and servico_id is null and cpu_snapshot_id is null and indireto_id is null
       and quantidade_referencia is null and unidade_referencia is null
       and qtd_ref_modo is null and qtd_ref_filhos is null
       and unidade is null and quantidade is null and venda_unitaria is null)
  );

-- ─── 2. Programação: só agrupador vinculado vira tarefa ───────────────────
create or replace function public.fn_tarefa_so_aceita_servico_grupo()
returns trigger
language plpgsql
as $$
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

-- ─── 3. Produção: só agrupador com composição recebe lançamento ───────────
create or replace function public.fn_acomp_prod_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_item record;
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
alter function public.fn_acomp_prod_before_write() owner to postgres;

-- ─── 4. Não desvincular agrupador que já alimenta programação/produção ────
create or replace function public.fn_item_orc_bloqueia_desvinculo()
returns trigger language plpgsql security definer set search_path = public as $$
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
alter function public.fn_item_orc_bloqueia_desvinculo() owner to postgres;

drop trigger if exists trg_item_orc_bloqueia_desvinculo on public.item_orcamentario;
create trigger trg_item_orc_bloqueia_desvinculo
  before update of servico_id, indireto_id on public.item_orcamentario
  for each row execute function public.fn_item_orc_bloqueia_desvinculo();
