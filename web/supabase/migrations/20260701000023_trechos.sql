-- InfraWork Web — Trechos (estaqueamento) e quantidades por local.
--
--   * obra_trecho: eixo do trecho (KMZ/KML → LineString), unidade de exibição
--     (km / estaca 20 m / m / custom), valor inicial e sentido da numeração.
--     Posições são sempre METROS internos ao longo do eixo (0 = 1º ponto).
--   * Template de quantidades: 1 por trecho, com versões. As COLUNAS são os
--     agrupadores (servico_grupo) escolhidos pelo usuário — vínculo nativo por
--     id, nada de nomes digitados. Cada versão = segmentos (faixas em metros)
--     × colunas → valor (célula; zero não é gravado).
--   * Regra: o total de um serviço no trecho NUNCA passa da quantidade do
--     serviço no orçamento. Se o orçamento cair abaixo (supressão), "obter do
--     trecho" fica bloqueado para aquele serviço e as tarefas vinculadas voltam
--     para quantidade manual até o usuário corrigir o trecho.
--   * Tarefa: qtd_origem 'manual' | 'trecho'. Com 'trecho' (+ trecho e faixa),
--     a quantidade alocada = Σ valor × sobreposição/segmento (calculado no
--     banco). Só tarefas 'trecho' entram no diagrama tempo-caminho.
--   * Trecho e template seguem a trava da cadeia (plano vigente).

-- ─── 1. Trecho ─────────────────────────────────────────────────────────────
create table if not exists public.obra_trecho (
  id                       uuid primary key default gen_random_uuid(),
  obra_id                  uuid not null references public.obras(id) on delete cascade,
  nome                     text not null check (trim(nome) <> ''),
  ordem                    int not null default 0,
  cor                      text not null default '#3b82f6' check (cor ~ '^#[0-9a-fA-F]{6}$'),
  unidade_espaco_padrao    text not null default 'km'
                           check (unidade_espaco_padrao in ('km', 'm', 'estaca', 'custom')),
  unidade_custom_label     text,
  unidade_custom_divisor_m numeric(10,3),
  marcador_valor_inicial   numeric(12,3) not null default 0,
  geometry_geojson         jsonb,
  geometry_bounds          jsonb,
  geometry_comprimento_m   numeric(14,2),
  geometry_sentido         text not null default 'natural' check (geometry_sentido in ('natural', 'invertido')),
  geometry_importado_em    timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (obra_id, nome),
  constraint chk_obra_trecho_custom check (
    unidade_espaco_padrao <> 'custom'
    or (coalesce(trim(unidade_custom_label), '') <> '' and coalesce(unidade_custom_divisor_m, 0) > 0))
);
create index if not exists idx_obra_trecho_obra on public.obra_trecho (obra_id, ordem);

drop trigger if exists trg_obra_trecho_touch on public.obra_trecho;
create trigger trg_obra_trecho_touch before update on public.obra_trecho
  for each row execute function public.fn_touch_updated_at();

-- ─── 2. Template de quantidades (1 por trecho) + versões ───────────────────
create table if not exists public.trecho_quantidade_template (
  id         uuid primary key default gen_random_uuid(),
  trecho_id  uuid not null unique references public.obra_trecho(id) on delete cascade,
  obra_id    uuid not null references public.obras(id) on delete cascade,
  modo       text not null default 'analitico' check (modo in ('analitico', 'simplificado')),
  created_at timestamptz not null default now()
);

create table if not exists public.trecho_quantidade_versao (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.trecho_quantidade_template(id) on delete cascade,
  obra_id     uuid not null references public.obras(id) on delete cascade,
  numero      int not null,
  is_atual    boolean not null default true,
  comentario  text,
  criado_por  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (template_id, numero)
);
create unique index if not exists uq_tqv_atual on public.trecho_quantidade_versao (template_id) where is_atual;

create table if not exists public.trecho_quantidade_coluna (
  id                   uuid primary key default gen_random_uuid(),
  versao_id            uuid not null references public.trecho_quantidade_versao(id) on delete cascade,
  item_orcamentario_id uuid not null references public.item_orcamentario(id) on delete cascade,
  ordem                int not null default 0,
  unique (versao_id, item_orcamentario_id)
);

create table if not exists public.trecho_quantidade_segmento (
  id                  uuid primary key default gen_random_uuid(),
  versao_id           uuid not null references public.trecho_quantidade_versao(id) on delete cascade,
  ordem               int not null,
  posicao_inicio_m    numeric(14,2) not null,
  posicao_fim_m       numeric(14,2) not null check (posicao_fim_m >= posicao_inicio_m),
  unidade_inicio_label text,
  unidade_fim_label    text
);
create index if not exists idx_tqs_versao on public.trecho_quantidade_segmento (versao_id, ordem);

create table if not exists public.trecho_quantidade_celula (
  segmento_id uuid not null references public.trecho_quantidade_segmento(id) on delete cascade,
  coluna_id   uuid not null references public.trecho_quantidade_coluna(id) on delete cascade,
  valor       numeric(18,3) not null,
  primary key (segmento_id, coluna_id)
);
create index if not exists idx_tqc_coluna on public.trecho_quantidade_celula (coluna_id);

-- RLS: leitura como o planejamento; escrita do trecho direta (com trava),
-- do template só pelas RPCs abaixo.
alter table public.obra_trecho enable row level security;
alter table public.trecho_quantidade_template enable row level security;
alter table public.trecho_quantidade_versao enable row level security;
alter table public.trecho_quantidade_coluna enable row level security;
alter table public.trecho_quantidade_segmento enable row level security;
alter table public.trecho_quantidade_celula enable row level security;

create or replace function public.pode_ver_obra(_obra_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.auth_role() = 'god'
      or (public.auth_role() = 'adm' and public.obra_empresa(_obra_id) = public.auth_empresa_id())
      or (public.auth_role() in ('engenheiro', 'cliente') and public.has_obra_permissao(_obra_id, auth.uid()))
      or (public.auth_role() = 'apoio' and public.has_obra_permissao(_obra_id, public.auth_engenheiro_id()))
$$;

drop policy if exists obra_trecho_select on public.obra_trecho;
drop policy if exists obra_trecho_write on public.obra_trecho;
create policy obra_trecho_select on public.obra_trecho for select using (public.pode_ver_obra(obra_id));
create policy obra_trecho_write on public.obra_trecho for all
  using (public.pode_planejar_obra(obra_id)) with check (public.pode_planejar_obra(obra_id));

drop policy if exists tqt_select on public.trecho_quantidade_template;
create policy tqt_select on public.trecho_quantidade_template for select using (public.pode_ver_obra(obra_id));
drop policy if exists tqv_select on public.trecho_quantidade_versao;
create policy tqv_select on public.trecho_quantidade_versao for select using (public.pode_ver_obra(obra_id));
drop policy if exists tqco_select on public.trecho_quantidade_coluna;
create policy tqco_select on public.trecho_quantidade_coluna for select using (
  exists (select 1 from public.trecho_quantidade_versao v where v.id = versao_id));
drop policy if exists tqs_select on public.trecho_quantidade_segmento;
create policy tqs_select on public.trecho_quantidade_segmento for select using (
  exists (select 1 from public.trecho_quantidade_versao v where v.id = versao_id));
drop policy if exists tqce_select on public.trecho_quantidade_celula;
create policy tqce_select on public.trecho_quantidade_celula for select using (
  exists (select 1 from public.trecho_quantidade_segmento s where s.id = segmento_id));

grant select, insert, update, delete on public.obra_trecho to authenticated;
grant select on public.trecho_quantidade_template, public.trecho_quantidade_versao,
  public.trecho_quantidade_coluna, public.trecho_quantidade_segmento, public.trecho_quantidade_celula
  to authenticated;

drop trigger if exists trg_cadeia_trava on public.obra_trecho;
create trigger trg_cadeia_trava before insert or update or delete on public.obra_trecho
  for each row execute function public.fn_cadeia_trava();

-- ─── 3. Quantidades do serviço no trecho ───────────────────────────────────
create or replace function public.trecho_versao_atual(_trecho_id uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select v.id from public.trecho_quantidade_template t
    join public.trecho_quantidade_versao v on v.template_id = t.id and v.is_atual
   where t.trecho_id = _trecho_id
$$;

create or replace function public.trecho_servico_total(_trecho_id uuid, _item_id uuid)
returns numeric
language sql stable security definer set search_path = public
as $$
  select coalesce(sum(ce.valor), 0)
    from public.trecho_quantidade_coluna c
    join public.trecho_quantidade_celula ce on ce.coluna_id = c.id
   where c.versao_id = public.trecho_versao_atual(_trecho_id) and c.item_orcamentario_id = _item_id
$$;

-- Σ de todos os trechos da obra para o serviço (não pode passar do orçamento)
create or replace function public.trechos_servico_total(_item_id uuid)
returns numeric
language sql stable security definer set search_path = public
as $$
  select coalesce(sum(public.trecho_servico_total(t.id, _item_id)), 0)
    from public.obra_trecho t
   where t.obra_id = (select obra_id from public.item_orcamentario where id = _item_id)
$$;

-- "obter do trecho" disponível: o trecho tem quantidade do serviço e a soma
-- dos trechos cabe no orçamento.
create or replace function public.trecho_servico_disponivel(_trecho_id uuid, _item_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.trecho_servico_total(_trecho_id, _item_id) > 0
     and public.trechos_servico_total(_item_id)
         <= coalesce((select quantidade_referencia from public.item_orcamentario where id = _item_id), 0) + 0.0005
$$;
grant execute on function public.trecho_servico_total(uuid, uuid), public.trechos_servico_total(uuid),
  public.trecho_servico_disponivel(uuid, uuid), public.trecho_versao_atual(uuid) to authenticated;

-- quantidade numa faixa [ini, fim] (metros) — rateio pela sobreposição
create or replace function public.trecho_qtd_faixa(_trecho_id uuid, _item_id uuid, _ini numeric, _fim numeric)
returns numeric
language sql stable security definer set search_path = public
as $$
  select round(coalesce(sum(ce.valor
           * (least(greatest(_ini, _fim), s.posicao_fim_m) - greatest(least(_ini, _fim), s.posicao_inicio_m))
           / (s.posicao_fim_m - s.posicao_inicio_m)), 0), 4)
    from public.trecho_quantidade_coluna c
    join public.trecho_quantidade_celula ce on ce.coluna_id = c.id
    join public.trecho_quantidade_segmento s on s.id = ce.segmento_id
   where c.versao_id = public.trecho_versao_atual(_trecho_id)
     and c.item_orcamentario_id = _item_id
     and s.posicao_fim_m > s.posicao_inicio_m
     and least(greatest(_ini, _fim), s.posicao_fim_m) > greatest(least(_ini, _fim), s.posicao_inicio_m)
$$;
grant execute on function public.trecho_qtd_faixa(uuid, uuid, numeric, numeric) to authenticated;

-- ─── 4. Tarefa: trecho, faixa e origem da quantidade ──────────────────────
alter table public.planejamento_tarefa
  add column if not exists trecho_id uuid references public.obra_trecho(id) on delete set null,
  add column if not exists posicao_inicio_m numeric(14,2),
  add column if not exists posicao_fim_m numeric(14,2),
  add column if not exists qtd_origem text not null default 'manual';
alter table public.planejamento_tarefa drop constraint if exists chk_tarefa_qtd_origem;
alter table public.planejamento_tarefa add constraint chk_tarefa_qtd_origem check (qtd_origem in ('manual', 'trecho'));
alter table public.planejamento_tarefa drop constraint if exists chk_tarefa_pos_par;
alter table public.planejamento_tarefa add constraint chk_tarefa_pos_par
  check ((posicao_inicio_m is null) = (posicao_fim_m is null));
create index if not exists idx_plan_tarefa_trecho on public.planejamento_tarefa (trecho_id);

create or replace function public.fn_tarefa_qtd_trecho()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_obra uuid; v_tr_obra uuid; q numeric;
begin
  if new.trecho_id is not null then
    select obra_id into v_tr_obra from public.obra_trecho where id = new.trecho_id;
    select obra_id into v_obra from public.planejamento where id = new.planejamento_id;
    if v_tr_obra is distinct from v_obra then raise exception 'Trecho de outra obra'; end if;
  end if;
  if new.qtd_origem <> 'trecho' then return new; end if;

  if new.trecho_id is null or new.posicao_inicio_m is null or new.item_orcamentario_id is null
     or not public.trecho_servico_disponivel(new.trecho_id, new.item_orcamentario_id) then
    -- inserções (cópia de plano) degradam para manual; o usuário recebe erro
    if tg_op = 'INSERT' or coalesce(current_setting('infrawork.trecho_sync', true), '') = '1' then
      new.qtd_origem := 'manual';
      return new;
    end if;
    raise exception 'Quantidade do trecho indisponível para este serviço: defina trecho e faixa, e confira se o template do trecho tem o serviço e não passa do orçamento';
  end if;

  q := public.trecho_qtd_faixa(new.trecho_id, new.item_orcamentario_id, new.posicao_inicio_m, new.posicao_fim_m);
  if q <= 0 then
    if tg_op = 'INSERT' or coalesce(current_setting('infrawork.trecho_sync', true), '') = '1' then
      new.qtd_origem := 'manual';
      return new;
    end if;
    raise exception 'Não há quantidade do serviço nessa faixa do trecho';
  end if;
  new.quantidade_alocada := q;
  return new;
end $$;

drop trigger if exists trg_tarefa_a_qtd_trecho on public.planejamento_tarefa;
create trigger trg_tarefa_a_qtd_trecho
  before insert or update of qtd_origem, trecho_id, posicao_inicio_m, posicao_fim_m, item_orcamentario_id
  on public.planejamento_tarefa
  for each row execute function public.fn_tarefa_qtd_trecho();

-- limite por serviço: roda em qualquer update (a quantidade pode vir do trecho)
drop trigger if exists trg_tarefa_limite_servico on public.planejamento_tarefa;
create trigger trg_tarefa_limite_servico
  before insert or update on public.planejamento_tarefa
  for each row execute function public.fn_tarefa_limite_servico();

-- linha de base: trecho/faixa/origem também ficam congelados
drop trigger if exists trg_baseline_imutavel_tarefa on public.planejamento_tarefa;
create trigger trg_baseline_imutavel_tarefa
  before delete or update of item_orcamentario_id, data_inicio_manual, notas, ordem, tipo_no, parent_id,
    nivel, quantidade_alocada, codigo_eap, nome_custom, schedule_mode, constraint_type, constraint_date,
    trecho_id, posicao_inicio_m, posicao_fim_m, qtd_origem
  on public.planejamento_tarefa
  for each row execute function public.fn_planejamento_baseline_imutavel();

-- recalcula as tarefas vinculadas dos planos em edição (template ou orçamento
-- mudou); as que ficaram indisponíveis voltam para manual
create or replace function public.trecho_sync_tarefas(_obra_id uuid)
returns int
language plpgsql security definer set search_path = public
as $$
declare n int;
begin
  perform set_config('infrawork.trecho_sync', '1', true);
  update public.planejamento_tarefa t
     set qtd_origem = t.qtd_origem
    from public.planejamento p
   where p.id = t.planejamento_id and p.obra_id = _obra_id and not p.is_baseline
     and t.qtd_origem = 'trecho';
  get diagnostics n = row_count;
  perform set_config('infrawork.trecho_sync', '', true);
  return n;
end $$;

-- ─── 5. RPCs do template ────────────────────────────────────────────────────
create or replace function public.fn_trecho_assert_editavel(_trecho_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_obra uuid; motivo text;
begin
  select obra_id into v_obra from public.obra_trecho where id = _trecho_id;
  if v_obra is null then raise exception 'Trecho não encontrado'; end if;
  if not public.pode_planejar_obra(v_obra) then raise exception 'Sem permissão'; end if;
  motivo := public.cadeia_trava_motivo(v_obra);
  if motivo is not null then raise exception 'Trecho travado: %', motivo; end if;
  return v_obra;
end $$;

-- Grava uma versão do template (substituir a atual ou criar nova):
--   _dados = { modo, comentario, nova_versao: bool,
--              servicos: [item_id…],
--              segmentos: [{ ini, fim, label_ini, label_fim, valores: { item_id: valor } }] }
-- Valida: serviços são agrupadores da obra; Σ trechos por serviço ≤ orçamento.
create or replace function public.trecho_salvar_quantidades(_trecho_id uuid, _dados jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_obra uuid; v_tpl uuid; v_ver uuid; v_num int; seg jsonb; v_seg uuid; k text; v numeric;
  ord int := 0; col_ids jsonb := '{}'::jsonb; v_col uuid; item uuid; viol text; n_seg int := 0; n_cel int := 0;
begin
  v_obra := public.fn_trecho_assert_editavel(_trecho_id);
  if jsonb_array_length(coalesce(_dados->'servicos', '[]'::jsonb)) = 0 then
    raise exception 'Escolha ao menos um serviço (agrupador) para o template';
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
    insert into public.trecho_quantidade_segmento
      (versao_id, ordem, posicao_inicio_m, posicao_fim_m, unidade_inicio_label, unidade_fim_label)
    values (v_ver, ord, (seg->>'ini')::numeric, (seg->>'fim')::numeric, seg->>'label_ini', seg->>'label_fim')
    returning id into v_seg;
    n_seg := n_seg + 1;
    ord := ord + 1;
    for k in select jsonb_object_keys(coalesce(seg->'valores', '{}'::jsonb)) loop
      v := nullif(seg->'valores'->>k, '')::numeric;
      if v is null or v = 0 or not (col_ids ? k) then continue; end if;
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
grant execute on function public.trecho_salvar_quantidades(uuid, jsonb) to authenticated;

-- Volta uma versão antiga a ser a atual (histórico)
create or replace function public.trecho_restaurar_versao(_versao_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
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
grant execute on function public.trecho_restaurar_versao(uuid) to authenticated;

-- ─── 6. Orçamento recalculado → tarefas vinculadas conferidas ──────────────
create or replace function public.fn_orc_recalculo_executar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

-- ─── 7. Limite por serviço tolera a sincronização do trecho ────────────────
CREATE OR REPLACE FUNCTION public.fn_tarefa_limite_servico()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

-- ─── 8. View da tarefa: trecho, faixa e origem da quantidade ───────────────
create or replace view public.vw_planejamento_tarefa_completa with (security_invoker = true) as
SELECT t.id,
    t.planejamento_id,
    t.item_orcamentario_id,
    t.data_inicio,
    t.data_fim,
    t.duracao_dias_uteis_calc,
    t.data_inicio_manual,
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
    t.early_start,
    t.early_finish,
    t.late_start,
    t.late_finish,
    t.total_float,
    t.free_float,
    t.is_critico,
    t.schedule_mode,
    t.constraint_type,
    t.constraint_date,
    p.obra_id,
    p.is_baseline,
    p.status AS planejamento_status,
    p.data_date AS planejamento_data_date,
    i.codigo AS servico_grupo_codigo,
    i.descricao AS servico_grupo_descricao,
    COALESCE(pr.item_quantidade, i.quantidade_referencia)::numeric(14,4) AS quantidade_referencia,
    i.servico_id,
    i.indireto_id,
    i.unidade_referencia AS unidade_referencia_item,
    COALESCE(pr.item_custo_unit, i.custo_unitario_calc)::numeric(14,4) AS custo_unitario_item,
        CASE
            WHEN i.tipo = 'receita'::text THEN i.venda_unitaria
            WHEN i.tipo = 'servico_grupo'::text AND COALESCE(pr.item_quantidade, i.quantidade_referencia) > 0::numeric THEN (COALESCE(pr.item_venda_total, i.venda_total_calc) / COALESCE(pr.item_quantidade, i.quantidade_referencia))::numeric(18,4)
            ELSE NULL::numeric
        END AS venda_unitaria_item,
    COALESCE(pr.item_venda_total, i.venda_total_calc)::numeric(14,2) AS venda_total_item,
    s.codigo AS servico_codigo,
    s.nome AS servico_nome,
    s.unidade AS unidade_servico,
    i.cpu_snapshot_id,
    snap.cpu_id AS cpu_id_origem,
    COALESCE(pr.producao_diaria_cpu, snap.producao_diaria_qtde) AS producao_diaria_qtde,
    snap.producao_diaria_unidade,
    COALESCE(pr.item_custo_unit, snap.custo_unit)::numeric(14,4) AS custo_unit_snapshot,
    COALESCE(pr.producao_diaria_efetiva, ( SELECT sum(COALESCE(pte.producao_diaria_override, ep.producao_diaria, COALESCE(pr.producao_diaria_cpu, snap.producao_diaria_qtde)) * GREATEST(1, pte.qtd_equipes::integer)::numeric) AS sum
           FROM planejamento_tarefa_equipe pte
             LEFT JOIN equipe_produtividade ep ON ep.equipe_id = pte.equipe_id AND ep.servico_id = i.servico_id
          WHERE pte.tarefa_id = t.id), COALESCE(pr.producao_diaria_cpu, snap.producao_diaria_qtde)) AS producao_diaria_efetiva,
    i.indireto_id IS NOT NULL AS is_indireto,
        CASE
            WHEN i.indireto_id IS NOT NULL AND pti.tarefa_id IS NOT NULL THEN jsonb_build_object('custo_periodicidade', pti.custo_periodicidade, 'custo_unitario', pti.custo_unitario, 'receita_modo', pti.receita_modo, 'receita_unitaria', pti.receita_unitaria, 'receita_percentual', pti.receita_percentual, 'offset_dias_antes', pti.offset_dias_antes, 'offset_dias_depois', pti.offset_dias_depois, 'receita_extrapola', pti.receita_extrapola, 'aplica_taxas', pti.aplica_taxas, 'taxa_regime_id', pti.taxa_regime_id, 'periodos_calc', pti.periodos_calc)
            ELSE NULL::jsonb
        END AS indireto_config,
        CASE
            WHEN i.indireto_id IS NOT NULL THEN COALESCE(pti.custo_total_calc, 0::numeric)::numeric(18,2)
            WHEN COALESCE(pr.item_custo_unit, snap.custo_unit) IS NOT NULL AND t.quantidade_alocada IS NOT NULL THEN (COALESCE(pr.item_custo_unit, snap.custo_unit) * t.quantidade_alocada)::numeric(18,2)
            ELSE 0::numeric(18,2)
        END AS custo_total_calc,
        CASE
            WHEN i.indireto_id IS NOT NULL THEN COALESCE(pti.receita_total_calc, 0::numeric)::numeric(18,2)
            WHEN i.tipo = 'servico_grupo'::text AND COALESCE(pr.item_quantidade, i.quantidade_referencia) > 0::numeric AND t.quantidade_alocada IS NOT NULL THEN (COALESCE(pr.item_venda_total, i.venda_total_calc) / COALESCE(pr.item_quantidade, i.quantidade_referencia) * t.quantidade_alocada)::numeric(18,2)
            WHEN i.tipo = 'receita'::text AND i.venda_unitaria IS NOT NULL AND t.quantidade_alocada IS NOT NULL THEN (i.venda_unitaria * t.quantidade_alocada)::numeric(18,2)
            ELSE 0::numeric(18,2)
        END AS receita_total_calc,
        CASE
            WHEN i.indireto_id IS NOT NULL THEN pti.custo_taxas_calc
            ELSE NULL::numeric
        END AS custo_taxas_calc,
        CASE
            WHEN COALESCE(pr.item_custo_unit, snap.custo_unit) IS NOT NULL AND t.quantidade_alocada IS NOT NULL THEN (COALESCE(pr.item_custo_unit, snap.custo_unit) * t.quantidade_alocada)::numeric(14,2)
            ELSE 0::numeric(14,2)
        END AS custo_total_tarefa,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', e.id, 'nome', e.nome, 'cor', e.cor, 'tipo', e.tipo, 'ordem', e.ordem, 'qtd_equipes', pte.qtd_equipes, 'producao_diaria_override', pte.producao_diaria_override, 'producao_diaria_equipe', ep.producao_diaria, 'producao_diaria_efetiva', COALESCE(pte.producao_diaria_override, ep.producao_diaria, COALESCE(pr.producao_diaria_cpu, snap.producao_diaria_qtde)) * GREATEST(1, pte.qtd_equipes::integer)::numeric) ORDER BY e.ordem, e.nome) AS jsonb_agg
           FROM planejamento_tarefa_equipe pte
             JOIN equipe e ON e.id = pte.equipe_id
             LEFT JOIN equipe_produtividade ep ON ep.equipe_id = pte.equipe_id AND ep.servico_id = i.servico_id
          WHERE pte.tarefa_id = t.id), '[]'::jsonb) AS equipes,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', d.id, 'predecessora_id', d.predecessora_id, 'tipo', d.tipo, 'lag_dias', d.lag_dias, 'origem', d.origem)) AS jsonb_agg
           FROM planejamento_dependencia d
          WHERE d.sucessora_id = t.id), '[]'::jsonb) AS predecessoras,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', d.id, 'sucessora_id', d.sucessora_id, 'tipo', d.tipo, 'lag_dias', d.lag_dias, 'origem', d.origem)) AS jsonb_agg
           FROM planejamento_dependencia d
          WHERE d.predecessora_id = t.id), '[]'::jsonb) AS sucessoras,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('semana_segunda', ps.semana_segunda, 'quantidade_planejada', ps.quantidade_planejada) ORDER BY ps.semana_segunda) AS jsonb_agg
           FROM planejamento_tarefa_perfil_semana ps
          WHERE ps.tarefa_id = t.id), '[]'::jsonb) AS perfil_semanas,
    t.trecho_id,
    tr.nome AS trecho_nome,
    tr.ordem AS trecho_ordem,
    t.posicao_inicio_m,
    t.posicao_fim_m,
    t.qtd_origem,
        CASE
            WHEN t.trecho_id IS NOT NULL AND t.item_orcamentario_id IS NOT NULL THEN trecho_servico_disponivel(t.trecho_id, t.item_orcamentario_id)
            ELSE false
        END AS trecho_disponivel
   FROM planejamento_tarefa t
     JOIN planejamento p ON p.id = t.planejamento_id
     LEFT JOIN item_orcamentario i ON i.id = t.item_orcamentario_id
     LEFT JOIN servico s ON s.id = i.servico_id
     LEFT JOIN vw_servico_vivo snap ON snap.servico_id = i.servico_id
     LEFT JOIN planejamento_lb_premissa pr ON pr.tarefa_id = t.id
     LEFT JOIN planejamento_tarefa_indireto pti ON pti.tarefa_id = t.id
     LEFT JOIN obra_trecho tr ON tr.id = t.trecho_id;
