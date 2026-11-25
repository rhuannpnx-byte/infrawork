-- 0069 — Controle de estoque da obra: tanques de material betuminoso e depósitos (agregado, solo).
--
-- Até aqui o sistema sabia o material aplicado pela produção, mas não quanto havia na obra. Cada ativo de estoque é
-- da obra, guarda um material (recurso do grupo MATERIAL) e fica num ponto do mapa.
--
-- Regra do saldo: a leitura marcada para ajustar é o ponto de partida; saldo = quantidade dessa leitura + entradas −
-- saídas lançadas depois dela. A diferença entre o medido e o que os movimentos davam é sempre calculada (view), nunca
-- gravada: corrigir ou apagar um lançamento antigo não desarruma o saldo atual. Saldo negativo não é bloqueado.
--
-- Tanque: o saldo é em litros. A tabela de arqueação (litros acumulados a cada 1 cm, do fundo ao topo) chega pronta
-- do cliente, que a calcula das dimensões (web/src/features/estoque/lib/tanque.ts, o mesmo módulo no MCP); o banco
-- confere a tabela e converte a leitura da régua em litros por interpolação.
--
-- Gravação direta nas tabelas, decidida pelas regras de acesso: não há função chamada pelo usuário.

-- ── 1. Tabelas ───────────────────────────────────────────────────────────────────────────────────────────────

create table public.estoque_ativo (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obras(id) on delete cascade,
  tipo text not null,
  nome text not null,
  recurso_id uuid not null references public.recurso(id) on delete restrict,
  unidade text not null,
  capacidade numeric(14,2) not null,
  estoque_minimo numeric(14,2) not null default 0,
  lat numeric(10,6) not null,
  lng numeric(10,6) not null,
  ativo boolean not null default true,
  obs text,
  -- só do tanque
  forma text,
  dimensoes jsonb,
  leitura_por text not null default 'cheio',
  altura_referencia_cm numeric(8,1),
  densidade_kg_l numeric(8,4),
  tabela numeric(14,2)[],
  tabela_versao integer,
  criado_por uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_estoque_ativo_nome unique (obra_id, nome),
  constraint chk_estoque_ativo_tipo check (tipo in ('tanque', 'deposito')),
  constraint chk_estoque_ativo_forma check (forma is null or forma in (
    'cilindrico_horizontal', 'cilindrico_vertical', 'eliptico_horizontal', 'oval_horizontal', 'retangular', 'tabela')),
  constraint chk_estoque_ativo_leitura check (leitura_por in ('cheio', 'vazio')),
  constraint chk_estoque_ativo_numeros check (
    capacidade > 0 and estoque_minimo >= 0
    and lat between -90 and 90 and lng between -180 and 180
    and (densidade_kg_l is null or densidade_kg_l > 0)
    and (altura_referencia_cm is null or altura_referencia_cm > 0))
);

comment on table public.estoque_ativo is
  'Ativo de estoque da obra: tanque (saldo em litros, com tabela de arqueação) ou depósito (saldo na unidade do material).';
comment on column public.estoque_ativo.tabela is
  'Tanque: litros acumulados a cada 1 cm, do fundo (índice 1 = 0 cm) ao topo. Calculada pelo cliente; o último ponto é a capacidade.';
comment on column public.estoque_ativo.altura_referencia_cm is
  'Régua lida pelo vazio: altura da boca de medição até o fundo. A altura do líquido é esta altura menos a leitura.';

create index idx_estoque_ativo_obra on public.estoque_ativo (obra_id);

create table public.estoque_movimento (
  id uuid primary key default gen_random_uuid(),
  ativo_id uuid not null references public.estoque_ativo(id) on delete cascade,
  obra_id uuid not null references public.obras(id) on delete cascade,
  momento timestamptz not null default now(),
  tipo text not null,
  quantidade numeric(14,2) not null,
  -- como a quantidade foi informada, quando a nota veio em toneladas e o tanque é em litros
  quantidade_informada numeric(14,3),
  unidade_informada text,
  densidade_kg_l numeric(8,4),
  documento text,
  terceiro text,
  obs text,
  criado_por uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_estoque_mov_tipo check (tipo in ('entrada', 'saida')),
  constraint chk_estoque_mov_qtd check (quantidade > 0 and (densidade_kg_l is null or densidade_kg_l > 0))
);

comment on column public.estoque_movimento.terceiro is 'Fornecedor, na entrada; destino, na saída.';

create index idx_estoque_mov_ativo on public.estoque_movimento (ativo_id, momento);
create index idx_estoque_mov_obra on public.estoque_movimento (obra_id);

create table public.estoque_leitura (
  id uuid primary key default gen_random_uuid(),
  ativo_id uuid not null references public.estoque_ativo(id) on delete cascade,
  obra_id uuid not null references public.obras(id) on delete cascade,
  momento timestamptz not null default now(),
  -- tanque: o número lido na régua e a altura do líquido que ele dá (iguais, quando a régua mede o cheio)
  leitura_cm numeric(8,1),
  nivel_cm numeric(8,1),
  quantidade numeric(14,2) not null,
  temperatura_c numeric(5,1),
  ajusta_saldo boolean not null default true,
  obs text,
  criado_por uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_estoque_leitura_qtd check (quantidade >= 0)
);

comment on column public.estoque_leitura.ajusta_saldo is
  'true = esta leitura é o ponto de partida do saldo; false = só conferência (fica no extrato com a diferença).';

create index idx_estoque_leitura_ativo on public.estoque_leitura (ativo_id, momento);
create index idx_estoque_leitura_obra on public.estoque_leitura (obra_id);

-- ── 2. Conversão da régua em litros ──────────────────────────────────────────────────────────────────────────
-- Mesma conta de volumeNaTabela (tanque.ts): interpolação linear entre os pontos de 1 cm.
create function public.estoque_volume_na_tabela(_tabela numeric[], _nivel_cm numeric)
returns numeric
language sql immutable
set search_path to 'public'
as $$
  select case
    when _tabela is null or coalesce(array_length(_tabela, 1), 0) < 2 or _nivel_cm is null then null
    else (
      select round(_tabela[i + 1] + (_tabela[i + 2] - _tabela[i + 1]) * (x - i), 2)
        from (select least(greatest(_nivel_cm, 0), array_length(_tabela, 1) - 1) as x) a,
             lateral (select least(array_length(_tabela, 1) - 2, floor(a.x)::int) as i) b)
  end
$$;

-- ── 3. Gatilhos ──────────────────────────────────────────────────────────────────────────────────────────────

create function public.fn_estoque_ativo_antes()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_rec record;
  n int;
  i int;
begin
  new.nome := btrim(coalesce(new.nome, ''));
  if new.nome = '' then raise exception 'Informe o nome do ativo de estoque'; end if;
  if tg_op = 'UPDATE' then
    if new.obra_id is distinct from old.obra_id then raise exception 'O ativo de estoque não muda de obra'; end if;
    if new.tipo is distinct from old.tipo then
      raise exception 'O tipo do ativo não muda: cadastre outro ativo';
    end if;
  end if;

  select obra_id, grupo, unidade into v_rec from public.recurso where id = new.recurso_id;
  if v_rec.obra_id is distinct from new.obra_id or v_rec.grupo <> 'MATERIAL' then
    raise exception 'O material precisa ser um recurso do grupo MATERIAL desta obra';
  end if;

  if new.tipo = 'tanque' then
    if new.forma is null or new.dimensoes is null then
      raise exception 'Informe o formato e as dimensões do tanque';
    end if;
    n := coalesce(array_length(new.tabela, 1), 0);
    if n < 2 or new.tabela_versao is null then
      raise exception 'O tanque precisa da tabela de arqueação calculada';
    end if;
    if new.tabela[1] <> 0 then raise exception 'A tabela de arqueação precisa começar em zero'; end if;
    for i in 2..n loop
      if new.tabela[i] is null or new.tabela[i] < new.tabela[i - 1] then
        raise exception 'A tabela de arqueação não pode diminuir (linha de % cm)', i - 1;
      end if;
    end loop;
    if new.tabela[n] <= 0 then raise exception 'A tabela de arqueação não tem volume'; end if;
    -- o saldo do tanque é em litros e a capacidade é o topo da tabela
    new.unidade := 'L';
    new.capacidade := new.tabela[n];
    if new.leitura_por = 'vazio' then
      if new.altura_referencia_cm is null then
        raise exception 'Régua lida pelo vazio: informe a altura da boca de medição até o fundo';
      end if;
    else
      new.altura_referencia_cm := null;
    end if;
  else
    new.unidade := btrim(coalesce(nullif(btrim(new.unidade), ''), v_rec.unidade, ''));
    if new.unidade = '' then raise exception 'Informe a unidade de controle do depósito'; end if;
    new.forma := null;
    new.dimensoes := null;
    new.tabela := null;
    new.tabela_versao := null;
    new.leitura_por := 'cheio';
    new.altura_referencia_cm := null;
    new.densidade_kg_l := null;
  end if;
  new.updated_at := now();
  return new;
end
$$;

create trigger trg_estoque_ativo_antes before insert or update on public.estoque_ativo
  for each row execute function public.fn_estoque_ativo_antes();

-- Mudou a tabela ou a forma de ler a régua: as leituras já feitas são recalculadas (o fato é o número lido).
create function public.fn_estoque_ativo_depois()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
begin
  if new.tipo = 'tanque' and (new.tabela is distinct from old.tabela
       or new.leitura_por is distinct from old.leitura_por
       or new.altura_referencia_cm is distinct from old.altura_referencia_cm) then
    update public.estoque_leitura set updated_at = now() where ativo_id = new.id;
  end if;
  return new;
end
$$;

create trigger trg_estoque_ativo_depois after update on public.estoque_ativo
  for each row execute function public.fn_estoque_ativo_depois();

-- A obra do movimento vem do ativo, nunca do que o cliente manda.
create function public.fn_estoque_movimento_antes()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare v_obra uuid;
begin
  if tg_op = 'UPDATE' and new.ativo_id is distinct from old.ativo_id then
    raise exception 'O movimento não muda de ativo: exclua e lance de novo';
  end if;
  select obra_id into v_obra from public.estoque_ativo where id = new.ativo_id;
  if v_obra is null then raise exception 'Ativo de estoque inexistente'; end if;
  new.obra_id := v_obra;
  new.documento := nullif(btrim(coalesce(new.documento, '')), '');
  new.terceiro := nullif(btrim(coalesce(new.terceiro, '')), '');
  new.updated_at := now();
  return new;
end
$$;

create trigger trg_estoque_movimento_antes before insert or update on public.estoque_movimento
  for each row execute function public.fn_estoque_movimento_antes();

-- A leitura do tanque guarda o número lido e daí saem a altura do líquido e os litros, pela tabela do ativo.
create function public.fn_estoque_leitura_antes()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_a record;
  v_topo int;
begin
  if tg_op = 'UPDATE' and new.ativo_id is distinct from old.ativo_id then
    raise exception 'A leitura não muda de ativo: exclua e lance de novo';
  end if;
  select obra_id, tipo, tabela, leitura_por, altura_referencia_cm into v_a
    from public.estoque_ativo where id = new.ativo_id;
  if v_a.obra_id is null then raise exception 'Ativo de estoque inexistente'; end if;
  new.obra_id := v_a.obra_id;
  if v_a.tipo = 'tanque' then
    if new.leitura_cm is null then raise exception 'Informe a leitura da régua, em centímetros'; end if;
    v_topo := array_length(v_a.tabela, 1) - 1;
    new.nivel_cm := case when v_a.leitura_por = 'vazio'
                         then v_a.altura_referencia_cm - new.leitura_cm else new.leitura_cm end;
    if new.nivel_cm < 0 or new.nivel_cm > v_topo then
      raise exception 'Leitura fora da régua do tanque: a altura do líquido daria % cm (o tanque vai de 0 a % cm)',
        new.nivel_cm, v_topo;
    end if;
    new.quantidade := public.estoque_volume_na_tabela(v_a.tabela, new.nivel_cm);
  else
    if new.quantidade is null then raise exception 'Informe a quantidade medida no depósito'; end if;
    new.leitura_cm := null;
    new.nivel_cm := null;
  end if;
  new.updated_at := now();
  return new;
end
$$;

create trigger trg_estoque_leitura_antes before insert or update on public.estoque_leitura
  for each row execute function public.fn_estoque_leitura_antes();

-- ── 4. Extrato e saldo ───────────────────────────────────────────────────────────────────────────────────────
-- Movimentos e leituras em ordem. A leitura num momento T vale depois dos movimentos de momento ≤ T.
create view public.vw_estoque_extrato with (security_invoker = true) as
with linhas as (
  select m.ativo_id, m.obra_id, m.id, 'movimento'::text as origem, m.tipo, m.momento, m.created_at,
         case m.tipo when 'entrada' then m.quantidade else -m.quantidade end as delta,
         null::numeric as medido, false as ancora, m.quantidade,
         m.quantidade_informada, m.unidade_informada, m.densidade_kg_l,
         m.documento, m.terceiro, m.obs, m.criado_por,
         null::numeric as leitura_cm, null::numeric as nivel_cm, null::numeric as temperatura_c
    from public.estoque_movimento m
  union all
  select l.ativo_id, l.obra_id, l.id, 'leitura', 'leitura', l.momento, l.created_at,
         0, l.quantidade, l.ajusta_saldo, l.quantidade,
         null, null, null,
         null, null, l.obs, l.criado_por,
         l.leitura_cm, l.nivel_cm, l.temperatura_c
    from public.estoque_leitura l
),
ordenadas as (
  select linhas.*,
         row_number() over (partition by ativo_id
                            order by momento, (origem = 'leitura'), created_at, id) as ordem
    from linhas
),
agrupadas as (
  select ordenadas.*,
         count(*) filter (where ancora) over (partition by ativo_id order by ordem) as grupo
    from ordenadas
),
saldos as (
  select agrupadas.*,
         coalesce(first_value(case when ancora then medido end)
                    over (partition by ativo_id, grupo order by ordem), 0)
         + sum(case when ancora then 0 else delta end)
             over (partition by ativo_id, grupo order by ordem) as saldo
    from agrupadas
)
select s.ativo_id, s.obra_id, s.id, s.origem, s.tipo, s.momento, s.ordem, s.quantidade,
       s.quantidade_informada, s.unidade_informada, s.densidade_kg_l,
       s.documento, s.terceiro, s.obs, s.criado_por,
       s.leitura_cm, s.nivel_cm, s.temperatura_c, s.ancora as ajusta_saldo,
       s.saldo,
       -- diferença da leitura: o medido menos o saldo que os movimentos davam até ali
       case when s.origem = 'leitura'
            then s.medido - coalesce(lag(s.saldo) over (partition by s.ativo_id order by s.ordem), 0) end as diferenca
  from saldos s;

comment on view public.vw_estoque_extrato is
  'Extrato do ativo: movimentos e leituras em ordem, com o saldo depois de cada linha e a diferença de cada leitura.';

-- Uma linha por ativo. Não traz a tabela de arqueação (centenas de números): quem precisa lê o ativo pelo id.
create view public.vw_estoque_saldo with (security_invoker = true) as
with hoje as (select (now() at time zone 'America/Sao_Paulo')::date as dia),
ultimo as (
  select distinct on (e.ativo_id) e.ativo_id, e.saldo, e.momento
    from public.vw_estoque_extrato e
   order by e.ativo_id, e.ordem desc
),
ultima_leitura as (
  select distinct on (e.ativo_id) e.ativo_id, e.momento, e.quantidade, e.diferenca, e.leitura_cm, e.nivel_cm,
         e.ajusta_saldo
    from public.vw_estoque_extrato e
   where e.origem = 'leitura'
   order by e.ativo_id, e.ordem desc
),
saidas as (
  select m.ativo_id,
         sum(m.quantidade) filter (
           where (m.momento at time zone 'America/Sao_Paulo')::date > (select dia from hoje) - 14) as saidas_14d,
         min((m.momento at time zone 'America/Sao_Paulo')::date) as primeira_saida
    from public.estoque_movimento m
   where m.tipo = 'saida'
   group by m.ativo_id
)
select a.id, a.obra_id, a.tipo, a.nome, a.recurso_id, r.nome as material, a.unidade,
       a.capacidade, a.estoque_minimo, a.lat, a.lng, a.ativo, a.obs,
       a.forma, a.dimensoes, a.leitura_por, a.altura_referencia_cm, a.densidade_kg_l, a.tabela_versao,
       a.created_at, a.updated_at,
       u.saldo,
       u.momento as ultimo_momento,
       case when a.capacidade > 0 then u.saldo / a.capacidade end as nivel,
       ul.momento as leitura_momento,
       ul.quantidade as leitura_quantidade,
       ul.diferenca as leitura_diferenca,
       ul.leitura_cm, ul.nivel_cm,
       coalesce(s.saidas_14d, 0) as saidas_14d,
       -- autonomia: saldo ÷ média diária das saídas dos últimos 14 dias (ou do que houver de histórico)
       case when coalesce(s.saidas_14d, 0) > 0 and u.saldo > 0
            then round(u.saldo / (s.saidas_14d
                   / least(14, greatest(1, (select dia from hoje) - s.primeira_saida + 1))), 1) end as autonomia_dias,
       case when u.ativo_id is null then 'sem_saldo'
            when u.saldo < 0 then 'negativo'
            when u.saldo = 0 then 'zerado'
            when a.estoque_minimo > 0 and u.saldo <= a.estoque_minimo then 'baixo'
            else 'normal' end as status
  from public.estoque_ativo a
  join public.recurso r on r.id = a.recurso_id
  left join ultimo u on u.ativo_id = a.id
  left join ultima_leitura ul on ul.ativo_id = a.id
  left join saidas s on s.ativo_id = a.id;

comment on view public.vw_estoque_saldo is
  'Saldo, nível, status, última leitura e autonomia de cada ativo de estoque.';

-- ── 5. Regras de acesso ──────────────────────────────────────────────────────────────────────────────────────
-- Leitura: a equipe da obra (o cliente não vê). Cadastro do ativo: quem planeja a obra. Movimentos e leituras: quem
-- lança produção; apoio e apontador só mexem no que eles mesmos lançaram.
alter table public.estoque_ativo enable row level security;
alter table public.estoque_movimento enable row level security;
alter table public.estoque_leitura enable row level security;

create policy estoque_ativo_select on public.estoque_ativo for select to authenticated
  using (obra_id in (select public.obras_permitidas('equipe')));
create policy estoque_ativo_insert on public.estoque_ativo for insert to authenticated
  with check (obra_id in (select public.obras_permitidas('planejar')));
create policy estoque_ativo_update on public.estoque_ativo for update to authenticated
  using (obra_id in (select public.obras_permitidas('planejar')))
  with check (obra_id in (select public.obras_permitidas('planejar')));
create policy estoque_ativo_delete on public.estoque_ativo for delete to authenticated
  using (obra_id in (select public.obras_permitidas('planejar')));

create policy estoque_mov_select on public.estoque_movimento for select to authenticated
  using (obra_id in (select public.obras_permitidas('equipe')));
create policy estoque_mov_insert on public.estoque_movimento for insert to authenticated
  with check (obra_id in (select public.obras_permitidas('lancar'))
              and (criado_por is null or criado_por = (select auth.uid())));
create policy estoque_mov_update on public.estoque_movimento for update to authenticated
  using (obra_id in (select public.obras_permitidas('lancar'))
         and ((select public.auth_role()) not in ('apoio', 'apontador') or criado_por = (select auth.uid())))
  with check (obra_id in (select public.obras_permitidas('lancar')));
create policy estoque_mov_delete on public.estoque_movimento for delete to authenticated
  using (obra_id in (select public.obras_permitidas('lancar'))
         and ((select public.auth_role()) not in ('apoio', 'apontador') or criado_por = (select auth.uid())));

create policy estoque_leitura_select on public.estoque_leitura for select to authenticated
  using (obra_id in (select public.obras_permitidas('equipe')));
create policy estoque_leitura_insert on public.estoque_leitura for insert to authenticated
  with check (obra_id in (select public.obras_permitidas('lancar'))
              and (criado_por is null or criado_por = (select auth.uid())));
create policy estoque_leitura_update on public.estoque_leitura for update to authenticated
  using (obra_id in (select public.obras_permitidas('lancar'))
         and ((select public.auth_role()) not in ('apoio', 'apontador') or criado_por = (select auth.uid())))
  with check (obra_id in (select public.obras_permitidas('lancar')));
create policy estoque_leitura_delete on public.estoque_leitura for delete to authenticated
  using (obra_id in (select public.obras_permitidas('lancar'))
         and ((select public.auth_role()) not in ('apoio', 'apontador') or criado_por = (select auth.uid())));
