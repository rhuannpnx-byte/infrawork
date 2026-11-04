-- Cronograma ApeX (F1): modelo de dados do cronograma copiado do ApeX/DynaRoad, adaptado ao InfraWork.
-- Ver web/docs/cronograma-apex/{PLANO,DECISOES}.md. O cálculo roda no cliente (motor do ApeX em vendor/apex) e os
-- resultados voltam por planejamento_gravar_calculo (migração 0027).

-- ═══ 1. Calendários (vários por obra) ═══════════════════════════════════════════════════════════════════════════
-- Semana: 7 dias (segunda … domingo), cada um {"inicio":"HH:MM","horas":n} (0 = sem expediente) — a semana padrão
-- do calendário do ApeX. Definições: feriado (período; "todo ano" repete mês/dia), Páscoa (sexta-feira santa,
-- domingo e segunda de Páscoa e Ascensão), folga anual em dia da semana (o primeiro <dia> a partir de dd/mm, todo
-- ano) e horário excepcional (outra semana num período; vale também sobre feriados, como no original).

create or replace function public.fn_semana_valida(_s jsonb)
returns boolean
language plpgsql immutable
as $$
declare d jsonb; h numeric; m int;
begin
  if _s is null or jsonb_typeof(_s) <> 'array' or jsonb_array_length(_s) <> 7 then return false; end if;
  for d in select value from jsonb_array_elements(_s) loop
    if jsonb_typeof(d) <> 'object' or coalesce(d->>'inicio', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or jsonb_typeof(d->'horas') <> 'number' then
      return false;
    end if;
    h := (d->>'horas')::numeric;
    m := split_part(d->>'inicio', ':', 1)::int * 60 + split_part(d->>'inicio', ':', 2)::int;
    -- o expediente pode passar da meia-noite, mas não do dia seguinte inteiro
    if h < 0 or h > 24 or m + h * 60 > 48 * 60 then return false; end if;
  end loop;
  return true;
end $$;

create or replace function public.fn_semana_tem_trabalho(_s jsonb)
returns boolean
language sql immutable
as $$ select exists (select 1 from jsonb_array_elements(_s) d where (d->>'horas')::numeric > 0) $$;

create table public.calendario (
  id         uuid primary key default gen_random_uuid(),
  obra_id    uuid not null references public.obras(id) on delete cascade,
  nome       text not null check (btrim(nome) <> ''),
  descricao  text,
  padrao     boolean not null default false,
  semana     jsonb not null default '[{"inicio":"07:00","horas":8},{"inicio":"07:00","horas":8},{"inicio":"07:00","horas":8},{"inicio":"07:00","horas":8},{"inicio":"07:00","horas":8},{"inicio":"07:00","horas":0},{"inicio":"07:00","horas":0}]'::jsonb,
  ordem      int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (obra_id, nome),
  constraint chk_calendario_semana check (public.fn_semana_valida(semana)),
  -- o original recusa uma semana sem nenhuma hora de trabalho ("No work hours during the week.")
  constraint chk_calendario_semana_trabalho check (public.fn_semana_tem_trabalho(semana))
);
create unique index uq_calendario_padrao on public.calendario(obra_id) where padrao;
create index idx_calendario_obra on public.calendario(obra_id);

create table public.calendario_definicao (
  id            uuid primary key default gen_random_uuid(),
  calendario_id uuid not null references public.calendario(id) on delete cascade,
  tipo          text not null check (tipo in ('feriado', 'pascoa', 'folga_semana', 'horario_excecao')),
  nome          text not null default '',
  data_inicio   date,
  data_fim      date,
  todo_ano      boolean not null default false,
  dia_semana    smallint check (dia_semana between 0 and 6),
  semana        jsonb,
  ordem         int not null default 0,
  created_at    timestamptz not null default now(),
  constraint chk_caldef_campos check (
    (tipo = 'feriado' and data_inicio is not null and data_fim is not null and data_fim >= data_inicio)
    or tipo = 'pascoa'
    or (tipo = 'folga_semana' and data_inicio is not null and dia_semana is not null)
    or (tipo = 'horario_excecao' and data_inicio is not null and data_fim is not null and data_fim >= data_inicio
        and semana is not null and public.fn_semana_valida(semana)))
);
create index idx_caldef_calendario on public.calendario_definicao(calendario_id);

create or replace function public.calendario_obra(_id uuid)
returns uuid
language sql stable security definer set search_path = public
as $$ select obra_id from public.calendario where id = _id $$;

alter table public.calendario enable row level security;
alter table public.calendario_definicao enable row level security;
create policy calendario_select on public.calendario for select using (public.pode_ver_obra(obra_id));
create policy calendario_write on public.calendario for all using (public.pode_planejar_obra(obra_id)) with check (public.pode_planejar_obra(obra_id));
create policy caldef_select on public.calendario_definicao for select using (public.pode_ver_obra(public.calendario_obra(calendario_id)));
create policy caldef_write on public.calendario_definicao for all
  using (public.pode_planejar_obra(public.calendario_obra(calendario_id)))
  with check (public.pode_planejar_obra(public.calendario_obra(calendario_id)));
grant select, insert, update, delete on public.calendario, public.calendario_definicao to authenticated;

create trigger trg_calendario_touch before update on public.calendario
  for each row execute function public.fn_touch_updated_at();

-- um só padrão por obra: marcar um desmarca os outros; o padrão não se remove (o original também não deixa)
create or replace function public.fn_calendario_padrao()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.padrao and exists (select 1 from public.obras where id = old.obra_id) then
      raise exception 'O calendário padrão não pode ser removido — marque outro como padrão antes';
    end if;
    return old;
  end if;
  if new.padrao and (tg_op = 'INSERT' or not old.padrao) then
    update public.calendario set padrao = false where obra_id = new.obra_id and padrao and id <> new.id;
  end if;
  if tg_op = 'UPDATE' and old.padrao and not new.padrao
     and not exists (select 1 from public.calendario where obra_id = new.obra_id and padrao and id <> new.id) then
    raise exception 'A obra precisa de um calendário padrão — marque outro como padrão';
  end if;
  return new;
end $$;
create trigger trg_calendario_padrao before insert or update of padrao or delete on public.calendario
  for each row execute function public.fn_calendario_padrao();

-- mudar calendário pede novo cálculo dos planos em edição da obra
create or replace function public.fn_calendario_marca_planos()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_obra uuid; r jsonb;
begin
  r := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  v_obra := coalesce((r->>'obra_id')::uuid, public.calendario_obra((r->>'calendario_id')::uuid));
  update public.planejamento set recalculo_pendente = true
   where obra_id = v_obra and not is_baseline and not recalculo_pendente;
  return null;
end $$;
create trigger trg_calendario_marca after insert or update or delete on public.calendario
  for each row execute function public.fn_calendario_marca_planos();
create trigger trg_caldef_marca after insert or update or delete on public.calendario_definicao
  for each row execute function public.fn_calendario_marca_planos();
create trigger trg_produtividade_mes_marca after insert or update or delete on public.obra_produtividade_mes
  for each row execute function public.fn_calendario_marca_planos();

-- obra nova nasce com um calendário padrão (seg–sex 07:00, 8 h)
create or replace function public.fn_obra_calendario_default()
returns trigger
language plpgsql
as $$
begin
  insert into public.obra_calendario (obra_id) values (new.id) on conflict (obra_id) do nothing;
  insert into public.calendario (obra_id, nome, padrao) values (new.id, 'Calendário da obra', true)
    on conflict (obra_id, nome) do nothing;
  return new;
end $$;

-- migração: o calendário antigo (dias úteis por bitmask + exceções por dia) vira o calendário padrão
insert into public.calendario (obra_id, nome, padrao, semana)
select o.id, 'Calendário da obra', true,
       (select jsonb_agg(jsonb_build_object('inicio', '07:00',
                 'horas', case when ((coalesce(c.dias_uteis_bitmask, 31) >> d) & 1) = 1 then 8 else 0 end) order by d)
          from generate_series(0, 6) d)
  from public.obras o
  left join public.obra_calendario c on c.obra_id = o.id
 where not exists (select 1 from public.calendario k where k.obra_id = o.id);

insert into public.calendario_definicao (calendario_id, tipo, nome, data_inicio, data_fim, semana, ordem)
select k.id,
       case when e.eh_util then 'horario_excecao' else 'feriado' end,
       coalesce(e.motivo, ''), e.data, e.data,
       case when e.eh_util then
         '[{"inicio":"07:00","horas":8},{"inicio":"07:00","horas":8},{"inicio":"07:00","horas":8},{"inicio":"07:00","horas":8},{"inicio":"07:00","horas":8},{"inicio":"07:00","horas":8},{"inicio":"07:00","horas":8}]'::jsonb
       end,
       row_number() over (partition by k.id order by e.data)
  from public.obra_calendario_excecao e
  join public.calendario k on k.obra_id = e.obra_id and k.padrao;

-- ═══ 2. Plano ════════════════════════════════════════════════════════════════════════════════════════════════════
alter table public.planejamento
  add column prazo                date,
  add column calendario_id        uuid references public.calendario(id) on delete set null,
  add column modo                 text not null default 'programacao' check (modo in ('programacao', 'controle')),
  add column premissa_calendarios jsonb,
  add column premissa_tipos       jsonb,
  add column dados_rev            bigint not null default 0,
  add column calculo_rev          bigint,
  add column calculado_em         timestamptz,
  add column calculo_aviso        text;

comment on column public.planejamento.prazo is 'Prazo do projeto (deadline do ApeX); null = sem prazo';
comment on column public.planejamento.calendario_id is 'Calendário padrão do plano; null = o padrão da obra';
comment on column public.planejamento.dados_rev is 'Revisão dos dados de entrada do cálculo (sobe a cada edição de tarefa, local, dependência, marco, limite ou equipe)';
comment on column public.planejamento.calculo_rev is 'dados_rev do último cálculo gravado (igual = resultados atuais)';

-- ═══ 3. Tarefa: atributos de programação do ApeX ═════════════════════════════════════════════════════════════════
alter table public.planejamento_tarefa
  add column prioridade            int not null default 500 check (prioridade >= 0),
  add column asap                  boolean not null default false,
  add column inicio_dia            boolean not null default false,
  add column sentido               text not null default 'crescente' check (sentido in ('crescente', 'decrescente')),
  add column restricao_inicio      text check (restricao_inicio in ('nao_antes', 'exato')),
  add column restricao_inicio_em   timestamp,
  add column restricao_fim         text check (restricao_fim in ('nao_depois', 'exato')),
  add column restricao_fim_em      timestamp,
  add column coef_producao         numeric(20,12) not null default 1 check (coef_producao > 0),
  add column qtd_equipes           smallint not null default 1 check (qtd_equipes between 1 and 50),
  add column calendario_id         uuid references public.calendario(id) on delete set null,
  add column derivar_predecessoras boolean not null default true,
  add column aparencia             jsonb,
  -- resultados do cálculo (gravados por planejamento_gravar_calculo)
  add column inicio_em             timestamp,
  add column fim_em                timestamp,
  add column folga_total_h         numeric(14,4),
  add column folga_livre_h         numeric(14,4),
  add column restricao_limite      text,
  add column violacoes             jsonb,
  add constraint chk_tarefa_restricao_inicio check ((restricao_inicio is null) = (restricao_inicio_em is null)),
  add constraint chk_tarefa_restricao_fim check ((restricao_fim is null) = (restricao_fim_em is null));

comment on column public.planejamento_tarefa.asap is 'O mais cedo possível (m_bASAP): começa no início do projeto ou quando as dependências permitem; desligado, mantém o início atual';
comment on column public.planejamento_tarefa.coef_producao is 'Coeficiente da taxa de produção (m_dWachCoeff)';
comment on column public.planejamento_tarefa.qtd_equipes is 'Equipes (composições) trabalhando juntas: recursos e taxa multiplicados';

-- EAP do ApeX não tem limite fixo de níveis; o InfraWork passa de 3 para 10
alter table public.planejamento_tarefa drop constraint chk_plan_tar_nivel;
alter table public.planejamento_tarefa add constraint chk_plan_tar_nivel check (nivel between 1 and 10);
create or replace function public.fn_tarefa_validar_nivel()
returns trigger
language plpgsql
as $$
declare pn smallint; pt text; pp uuid;
begin
  if new.parent_id is null then
    if new.nivel <> 1 then raise exception 'parent_id NULL exige nivel=1 (recebido %)', new.nivel; end if;
    return new;
  end if;
  select nivel, tipo_no, planejamento_id into pn, pt, pp from public.planejamento_tarefa where id = new.parent_id;
  if pn is null then raise exception 'parent_id % inexistente', new.parent_id; end if;
  if pt <> 'grupo' then raise exception 'A tarefa superior precisa ser uma tarefa-resumo'; end if;
  if pp <> new.planejamento_id then raise exception 'Tarefa-resumo de outro plano'; end if;
  if new.nivel <> pn + 1 then raise exception 'nivel invalido (esperado %, recebido %)', pn + 1, new.nivel; end if;
  if new.nivel > 10 then raise exception 'A EAP aceita no máximo 10 níveis'; end if;
  return new;
end $$;

-- migração dos atributos antigos (motor CPM do InfraWork) para os do ApeX:
-- as tarefas existentes andavam pelas dependências (ASAP); início manual = mantém o início (não ASAP)
update public.planejamento_tarefa set
  asap = not coalesce(data_inicio_manual, false) and coalesce(constraint_type, '') <> 'mso',
  restricao_inicio = case constraint_type when 'snet' then 'nao_antes' when 'mso' then 'exato' end,
  restricao_inicio_em = case when constraint_type in ('snet', 'mso') then constraint_date::timestamp end,
  restricao_fim = case constraint_type when 'fnlt' then 'nao_depois' when 'mfo' then 'exato' end,
  restricao_fim_em = case when constraint_type in ('fnlt', 'mfo') then constraint_date::timestamp + interval '1 day' - interval '1 second' end,
  sentido = case when posicao_inicio_m is not null and posicao_fim_m < posicao_inicio_m then 'decrescente' else 'crescente' end,
  qtd_equipes = least(50, greatest(1, coalesce((select sum(greatest(1, pte.qtd_equipes)) from public.planejamento_tarefa_equipe pte
                                                where pte.tarefa_id = planejamento_tarefa.id), 1)))::smallint,
  inicio_em = data_inicio::timestamp,
  fim_em = data_fim::timestamp
 where tipo_no = 'tarefa';

-- ═══ 4. Locais da tarefa (work places) ═══════════════════════════════════════════════════════════════════════════
-- Um ou mais trechos por tarefa, sem sobreposição no mesmo eixo. Posições em metros internos ao eixo do trecho
-- (início < fim; o sentido de execução é da tarefa). Sem trecho = "sem local" (fora do tempo-caminho). Quantidade
-- manual ou obtida do template de quantidades do trecho (calculada aqui no banco).
create table public.planejamento_tarefa_local (
  id              uuid primary key default gen_random_uuid(),
  tarefa_id       uuid not null references public.planejamento_tarefa(id) on delete cascade,
  planejamento_id uuid not null references public.planejamento(id) on delete cascade,
  ordem           int not null default 0,
  -- sem ação na remoção: apagar um trecho usado por tarefas é recusado; a remoção da obra passa (cascata)
  trecho_id       uuid references public.obra_trecho(id),
  inicio_m        numeric(14,3),
  fim_m           numeric(14,3),
  quantidade      numeric(18,4) not null default 0 check (quantidade >= 0),
  qtd_origem      text not null default 'manual' check (qtd_origem in ('manual', 'trecho')),
  -- resultado (planejamento_gravar_calculo)
  inicio_em       timestamp,
  fim_em          timestamp,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint chk_local_faixa check (
    (trecho_id is null and inicio_m is null and fim_m is null)
    or (trecho_id is not null and inicio_m is not null and fim_m is not null and fim_m > inicio_m))
);
create index idx_local_tarefa on public.planejamento_tarefa_local(tarefa_id);
create index idx_local_plan on public.planejamento_tarefa_local(planejamento_id);
create index idx_local_trecho on public.planejamento_tarefa_local(trecho_id);

alter table public.planejamento_tarefa_local enable row level security;
create policy local_select on public.planejamento_tarefa_local for select
  using (public.pode_ver_obra(public.planejamento_obra(planejamento_id)));
create policy local_write on public.planejamento_tarefa_local for all
  using (public.pode_planejar_obra(public.planejamento_obra(planejamento_id)))
  with check (public.pode_planejar_obra(public.planejamento_obra(planejamento_id)));
grant select, insert, update, delete on public.planejamento_tarefa_local to authenticated;

create trigger trg_local_touch before update on public.planejamento_tarefa_local
  for each row execute function public.fn_touch_updated_at();

-- antes de gravar: plano da tarefa, trecho da mesma obra, quantidade do trecho, sem sobreposição
create or replace function public.fn_local_antes()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_plan uuid; v_tipo text; v_item uuid; v_ind uuid; v_obra uuid; v_tr_obra uuid; q numeric;
begin
  select t.planejamento_id, t.tipo_no, t.item_orcamentario_id, i.indireto_id
    into v_plan, v_tipo, v_item, v_ind
    from public.planejamento_tarefa t left join public.item_orcamentario i on i.id = t.item_orcamentario_id
   where t.id = new.tarefa_id;
  if v_plan is null then raise exception 'Tarefa % inexistente', new.tarefa_id; end if;
  if v_tipo <> 'tarefa' then raise exception 'Só tarefas (não tarefas-resumo) têm locais'; end if;
  if v_ind is not null then raise exception 'Tarefas de indireto não têm locais'; end if;
  new.planejamento_id := v_plan;
  if new.trecho_id is not null then
    select obra_id into v_tr_obra from public.obra_trecho where id = new.trecho_id;
    select obra_id into v_obra from public.planejamento where id = v_plan;
    if v_tr_obra is distinct from v_obra then raise exception 'Trecho de outra obra'; end if;
  end if;
  if new.qtd_origem = 'trecho' then
    if new.trecho_id is null or v_item is null or not public.trecho_servico_disponivel(new.trecho_id, v_item) then
      -- inserções (cópia de plano) e a sincronização do trecho degradam para manual; o usuário recebe erro
      if tg_op = 'INSERT' or coalesce(current_setting('infrawork.trecho_sync', true), '') = '1' then
        new.qtd_origem := 'manual';
      else
        raise exception 'Quantidade do trecho indisponível para este serviço: defina trecho e faixa, e confira se o template do trecho tem o serviço e não passa do orçamento';
      end if;
    else
      q := public.trecho_qtd_faixa(new.trecho_id, v_item, new.inicio_m, new.fim_m);
      if q <= 0 then
        if tg_op = 'INSERT' or coalesce(current_setting('infrawork.trecho_sync', true), '') = '1' then
          new.qtd_origem := 'manual';
        else
          raise exception 'Não há quantidade do serviço nessa faixa do trecho';
        end if;
      else
        new.quantidade := q;
      end if;
    end if;
  end if;
  -- "Task locations cannot intersect." (WorkSite::AddWorkPlace): faixas do mesmo eixo não se sobrepõem
  if new.trecho_id is not null and exists (
       select 1 from public.planejamento_tarefa_local o
        where o.tarefa_id = new.tarefa_id and o.id <> new.id and o.trecho_id = new.trecho_id
          and o.inicio_m < new.fim_m and new.inicio_m < o.fim_m) then
    raise exception 'Os locais da tarefa não podem se sobrepor no mesmo trecho';
  end if;
  if new.trecho_id is null and exists (
       select 1 from public.planejamento_tarefa_local o
        where o.tarefa_id = new.tarefa_id and o.id <> new.id and o.trecho_id is null) then
    raise exception 'A tarefa já tem um local sem trecho';
  end if;
  return new;
end $$;
create trigger trg_local_antes before insert or update on public.planejamento_tarefa_local
  for each row execute function public.fn_local_antes();

-- depois: a quantidade da tarefa é a soma dos locais (o limite do serviço valida na própria tarefa)
create or replace function public.fn_local_soma()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_t uuid; s numeric; n int;
begin
  for v_t in select distinct x from unnest(array[case when tg_op <> 'INSERT' then old.tarefa_id end,
                                                 case when tg_op <> 'DELETE' then new.tarefa_id end]) x where x is not null loop
    select coalesce(sum(quantidade), 0), count(*) into s, n from public.planejamento_tarefa_local where tarefa_id = v_t;
    if n > 0 then
      update public.planejamento_tarefa set quantidade_alocada = nullif(round(s, 4), 0)
       where id = v_t and quantidade_alocada is distinct from nullif(round(s, 4), 0);
    end if;
  end loop;
  return null;
end $$;
-- qualquer update: a quantidade também muda pelo gatilho "antes" (local "do trecho" quando o template muda), e
-- `update of quantidade` só dispara com a coluna no SET
create trigger trg_local_soma after insert or update or delete on public.planejamento_tarefa_local
  for each row execute function public.fn_local_soma();

-- migração: o trecho/faixa/origem de cada tarefa vira o primeiro local
insert into public.planejamento_tarefa_local (tarefa_id, planejamento_id, ordem, trecho_id, inicio_m, fim_m, quantidade, qtd_origem, inicio_em, fim_em)
select t.id, t.planejamento_id, 0,
       case when t.posicao_inicio_m is not null and t.posicao_fim_m is not null and t.posicao_fim_m <> t.posicao_inicio_m then t.trecho_id end,
       case when t.posicao_inicio_m is not null and t.posicao_fim_m <> t.posicao_inicio_m and t.trecho_id is not null then least(t.posicao_inicio_m, t.posicao_fim_m) end,
       case when t.posicao_inicio_m is not null and t.posicao_fim_m <> t.posicao_inicio_m and t.trecho_id is not null then greatest(t.posicao_inicio_m, t.posicao_fim_m) end,
       coalesce(t.quantidade_alocada, 0),
       case when t.qtd_origem = 'trecho' and t.trecho_id is not null and t.posicao_inicio_m is not null and t.posicao_fim_m <> t.posicao_inicio_m then 'trecho' else 'manual' end,
       t.data_inicio::timestamp, t.data_fim::timestamp
  from public.planejamento_tarefa t
  left join public.item_orcamentario i on i.id = t.item_orcamentario_id
 where t.tipo_no = 'tarefa' and i.indireto_id is null;

-- o trecho saiu da tarefa para os locais: o gatilho antigo da quantidade do trecho na tarefa não vale mais
drop trigger if exists trg_tarefa_a_qtd_trecho on public.planejamento_tarefa;

create or replace function public.trecho_sync_tarefas(_obra_id uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare n int;
begin
  perform set_config('infrawork.trecho_sync', '1', true);
  update public.planejamento_tarefa_local l
     set qtd_origem = l.qtd_origem
    from public.planejamento p
   where p.id = l.planejamento_id and p.obra_id = _obra_id and not p.is_baseline and l.qtd_origem = 'trecho';
  get diagnostics n = row_count;
  perform set_config('infrawork.trecho_sync', '', true);
  return n;
end $$;

-- ═══ 5. Resultados por trecho de tarefa e perfil diário ══════════════════════════════════════════════════════════
-- planejamento_tarefa_wp: os work places que o motor calculou (um por local; um por segmento do template quando a
-- quantidade vem do trecho), com datas. Congelados na linha de base (a linha de base remonta o tempo-caminho por eles).
create table public.planejamento_tarefa_wp (
  id              uuid primary key default gen_random_uuid(),
  planejamento_id uuid not null references public.planejamento(id) on delete cascade,
  tarefa_id       uuid not null references public.planejamento_tarefa(id) on delete cascade,
  local_id        uuid references public.planejamento_tarefa_local(id) on delete cascade,
  ordem           int not null,
  trecho_id       uuid references public.obra_trecho(id) on delete set null,
  inicio_m        numeric(14,3),
  fim_m           numeric(14,3),
  quantidade      numeric(18,4) not null,
  inicio_em       timestamp not null,
  fim_em          timestamp not null
);
create index idx_wp_tarefa on public.planejamento_tarefa_wp(tarefa_id);
create index idx_wp_plan on public.planejamento_tarefa_wp(planejamento_id);

create table public.planejamento_tarefa_perfil_dia (
  tarefa_id  uuid not null references public.planejamento_tarefa(id) on delete cascade,
  dia        date not null,
  quantidade numeric(18,6) not null,
  primary key (tarefa_id, dia)
);

alter table public.planejamento_tarefa_wp enable row level security;
alter table public.planejamento_tarefa_perfil_dia enable row level security;
create policy wp_select on public.planejamento_tarefa_wp for select using (public.pode_ver_obra(public.planejamento_obra(planejamento_id)));
create policy perfil_dia_select on public.planejamento_tarefa_perfil_dia for select using (public.pode_ver_obra(public.tarefa_obra(tarefa_id)));
grant select on public.planejamento_tarefa_wp, public.planejamento_tarefa_perfil_dia to authenticated;

-- ═══ 6. Dependências: por estacas, atraso mínimo e máximo, dias corridos ou úteis ════════════════════════════════
alter table public.planejamento_dependencia drop constraint chk_plan_dep_tipo;
alter table public.planejamento_dependencia
  add constraint chk_plan_dep_tipo check (tipo in ('FS', 'SS', 'FF', 'SF', 'EST')),
  add column atraso_min int default 0,
  add column atraso_max int,
  add column dias_uteis boolean not null default false,
  add column aparencia  jsonb,
  add constraint chk_plan_dep_atrasos check (atraso_min is null or atraso_max is null or atraso_min <= atraso_max);
comment on column public.planejamento_dependencia.atraso_min is 'Atraso mínimo em dias (null = sem mínimo: a dependência não segura datas, só a máxima vale)';
comment on column public.planejamento_dependencia.tipo is 'FS/SS/FF/SF ou EST (por estacas: a sucessora só passa em cada estaca depois da predecessora)';
-- o motor antigo media o atraso em dias úteis
update public.planejamento_dependencia set atraso_min = coalesce(lag_dias, 0), dias_uteis = true;

-- ═══ 7. Dependências entre serviços (tipos) ══════════════════════════════════════════════════════════════════════
-- Tarefas do serviço sucessor seguem as do predecessor onde dividem estacas (dependência "por estacas" automática).
create table public.servico_dependencia (
  id             uuid primary key default gen_random_uuid(),
  obra_id        uuid not null references public.obras(id) on delete cascade,
  predecessor_id uuid not null references public.servico(id) on delete cascade,
  sucessor_id    uuid not null references public.servico(id) on delete cascade,
  atraso_dias    int not null default 0,
  created_at     timestamptz not null default now(),
  unique (predecessor_id, sucessor_id),
  check (predecessor_id <> sucessor_id)
);
create index idx_servdep_obra on public.servico_dependencia(obra_id);
alter table public.servico_dependencia enable row level security;
create policy servdep_select on public.servico_dependencia for select using (public.pode_ver_obra(obra_id));
create policy servdep_write on public.servico_dependencia for all using (public.pode_planejar_obra(obra_id)) with check (public.pode_planejar_obra(obra_id));
grant select, insert, update, delete on public.servico_dependencia to authenticated;

create or replace function public.fn_servdep_antes()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if (select obra_id from public.servico where id = new.predecessor_id) is distinct from new.obra_id
     or (select obra_id from public.servico where id = new.sucessor_id) is distinct from new.obra_id then
    raise exception 'Serviço de outra obra';
  end if;
  return new;
end $$;
create trigger trg_servdep_antes before insert or update on public.servico_dependencia
  for each row execute function public.fn_servdep_antes();
create trigger trg_servdep_marca after insert or update or delete on public.servico_dependencia
  for each row execute function public.fn_calendario_marca_planos();

-- ═══ 8. Marcos ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- Janela de datas em que as tarefas incluídas devem caber (por tarefa, ou por serviço, recurso e faixa de estacas).
create table public.planejamento_marco (
  id               uuid primary key default gen_random_uuid(),
  planejamento_id  uuid not null references public.planejamento(id) on delete cascade,
  nome             text not null check (btrim(nome) <> ''),
  descricao        text,
  inicio           timestamp,
  fim              timestamp,
  filtro_servicos  boolean not null default false,
  servicos         uuid[] not null default '{}',
  filtro_recursos  boolean not null default false,
  recursos         uuid[] not null default '{}',
  filtro_estacas   boolean not null default false,
  faixas           jsonb not null default '[]'::jsonb,
  incluidas        uuid[] not null default '{}',
  excluidas        uuid[] not null default '{}',
  aparencia        jsonb,
  ordem            int not null default 0,
  created_at       timestamptz not null default now(),
  check (inicio is null or fim is null or inicio <= fim)
);
create index idx_marco_plan on public.planejamento_marco(planejamento_id);
alter table public.planejamento_marco enable row level security;
create policy marco_select on public.planejamento_marco for select using (public.pode_ver_obra(public.planejamento_obra(planejamento_id)));
create policy marco_write on public.planejamento_marco for all
  using (public.pode_planejar_obra(public.planejamento_obra(planejamento_id)))
  with check (public.pode_planejar_obra(public.planejamento_obra(planejamento_id)));
grant select, insert, update, delete on public.planejamento_marco to authenticated;

-- marcos antigos (tarefa de duração zero) viram marcos do ApeX com a data como fim da janela
insert into public.planejamento_marco (planejamento_id, nome, fim)
select t.planejamento_id, coalesce(nullif(t.nome_custom, ''), 'Marco'), coalesce(t.constraint_date, t.data_inicio)::timestamp
  from public.planejamento_tarefa t where t.tipo_no = 'marco';
delete from public.planejamento_tarefa t
 where t.tipo_no = 'marco' and not exists (select 1 from public.planejamento p where p.id = t.planejamento_id and p.is_baseline);

-- ═══ 9. Limites de recursos (nivelamento) ════════════════════════════════════════════════════════════════════════
-- Quantidade máxima de um recurso usada ao mesmo tempo, no projeto (grupo nulo) ou numa tarefa-resumo.
create table public.planejamento_recurso_limite (
  id              uuid primary key default gen_random_uuid(),
  planejamento_id uuid not null references public.planejamento(id) on delete cascade,
  recurso_id      uuid not null references public.recurso(id) on delete cascade,
  grupo_id        uuid references public.planejamento_tarefa(id) on delete cascade,
  maximo          numeric(12,3) not null check (maximo > 0)
);
create unique index uq_recurso_limite on public.planejamento_recurso_limite
  (planejamento_id, recurso_id, coalesce(grupo_id, '00000000-0000-0000-0000-000000000000'::uuid));
alter table public.planejamento_recurso_limite enable row level security;
create policy limite_select on public.planejamento_recurso_limite for select using (public.pode_ver_obra(public.planejamento_obra(planejamento_id)));
create policy limite_write on public.planejamento_recurso_limite for all
  using (public.pode_planejar_obra(public.planejamento_obra(planejamento_id)))
  with check (public.pode_planejar_obra(public.planejamento_obra(planejamento_id)));
grant select, insert, update, delete on public.planejamento_recurso_limite to authenticated;

create or replace function public.fn_limite_antes()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.grupo_id is not null and not exists (
       select 1 from public.planejamento_tarefa where id = new.grupo_id and planejamento_id = new.planejamento_id and tipo_no = 'grupo') then
    raise exception 'O limite por tarefa-resumo precisa de uma tarefa-resumo do mesmo plano';
  end if;
  if (select obra_id from public.recurso where id = new.recurso_id) is distinct from public.planejamento_obra(new.planejamento_id) then
    raise exception 'Recurso de outra obra';
  end if;
  return new;
end $$;
create trigger trg_limite_antes before insert or update on public.planejamento_recurso_limite
  for each row execute function public.fn_limite_antes();

-- ═══ 10. Linha de base: tudo congelado ═══════════════════════════════════════════════════════════════════════════
create or replace function public.fn_lb_imutavel_generica()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_plan uuid; v_lb boolean;
begin
  if tg_table_name in ('planejamento_tarefa_perfil_dia') then
    select planejamento_id into v_plan from public.planejamento_tarefa where id = coalesce(new.tarefa_id, old.tarefa_id);
  else
    v_plan := case when tg_op = 'DELETE' then old.planejamento_id else new.planejamento_id end;
  end if;
  select is_baseline into v_lb from public.planejamento where id = v_plan;
  -- plano removido (cascata) ou não-LB: segue
  if v_lb is null or not v_lb then return coalesce(new, old); end if;
  raise exception 'Linha de base travada é imutável — crie um plano em edição a partir dela';
end $$;
create trigger trg_lb_imutavel_local before insert or update or delete on public.planejamento_tarefa_local
  for each row execute function public.fn_lb_imutavel_generica();
create trigger trg_lb_imutavel_wp before insert or update or delete on public.planejamento_tarefa_wp
  for each row execute function public.fn_lb_imutavel_generica();
create trigger trg_lb_imutavel_perfil_dia before insert or update or delete on public.planejamento_tarefa_perfil_dia
  for each row execute function public.fn_lb_imutavel_generica();
create trigger trg_lb_imutavel_marco before insert or update or delete on public.planejamento_marco
  for each row execute function public.fn_lb_imutavel_generica();
create trigger trg_lb_imutavel_limite before insert or update or delete on public.planejamento_recurso_limite
  for each row execute function public.fn_lb_imutavel_generica();

-- ═══ 11. Revisão dos dados de entrada ════════════════════════════════════════════════════════════════════════════
-- dados_rev sobe a cada edição que muda a entrada do cálculo; a gravação dos resultados (GUC
-- infrawork.gravando_calculo) não conta. planejamento_gravar_calculo só aceita resultados da revisão atual.
create or replace function public.fn_plano_dados_rev()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_plan uuid;
begin
  if coalesce(current_setting('infrawork.gravando_calculo', true), '') = '1' then return null; end if;
  if tg_table_name = 'planejamento_tarefa_equipe' then
    select planejamento_id into v_plan from public.planejamento_tarefa where id = coalesce(new.tarefa_id, old.tarefa_id);
  else
    v_plan := case when tg_op = 'DELETE' then old.planejamento_id else new.planejamento_id end;
  end if;
  update public.planejamento set dados_rev = dados_rev + 1 where id = v_plan and not is_baseline;
  return null;
end $$;
create trigger trg_rev_tarefa after insert or update or delete on public.planejamento_tarefa
  for each row execute function public.fn_plano_dados_rev();
create trigger trg_rev_local after insert or update or delete on public.planejamento_tarefa_local
  for each row execute function public.fn_plano_dados_rev();
create trigger trg_rev_dep after insert or update or delete on public.planejamento_dependencia
  for each row execute function public.fn_plano_dados_rev();
create trigger trg_rev_marco after insert or update or delete on public.planejamento_marco
  for each row execute function public.fn_plano_dados_rev();
create trigger trg_rev_limite after insert or update or delete on public.planejamento_recurso_limite
  for each row execute function public.fn_plano_dados_rev();
create trigger trg_rev_equipe after insert or update or delete on public.planejamento_tarefa_equipe
  for each row execute function public.fn_plano_dados_rev();
