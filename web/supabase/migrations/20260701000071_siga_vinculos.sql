-- SIGA: vínculos e leitura (plano de 27/11/2026, etapas A e C).
--
--   1. integracao_obra: a obra ligada a um projeto do sistema externo (data de corte, fotos, modo de gravação).
--   2. integracao_de_para: serviço, equipe, encarregado e local de fora ↔ os do InfraWork, por obra.
--   3. A produção e as fotos ganham `externo_id` (o número do registro lá) e `externo` (o que veio em texto), e a
--      origem `siga`. O lote vindo do conector é aplicado por siga_aplicar_producao, numa transação.
--   4. Travas: lançamento do SIGA só muda pela sincronização; em obra vinculada, o lançamento feito aqui só entra
--      com a gravação ligada (a fila de saída é a próxima migração).
--
-- O SIGA é a verdade: o que está aqui com origem `siga` é espelho. Obra sem vínculo (todas as da Ética) não muda.

-- ── 1. Produção e fotos: de onde veio ────────────────────────────────────────────────────────────────────────
alter table public.acompanhamento_producao drop constraint chk_acomp_prod_origem;
alter table public.acompanhamento_producao
  add constraint chk_acomp_prod_origem
    check (origem = any (array['app'::text, 'importacao'::text, 'campo'::text, 'viagens'::text, 'siga'::text])),
  add column externo_id bigint,
  add column externo jsonb;
comment on column public.acompanhamento_producao.externo_id is
  'Número do lançamento no sistema externo (controle_producao_id do SIGA). Único por obra.';
comment on column public.acompanhamento_producao.externo is
  'O que veio do sistema externo em texto (serviço, equipe, encarregado, trecho, estaca, quem lançou) e a assinatura da linha, para mostrar o que ainda não tem vínculo e saber se mudou.';
create unique index uq_acomp_prod_externo on public.acompanhamento_producao (obra_id, externo_id)
  where externo_id is not null;

alter table public.acompanhamento_foto
  add column externo_id bigint,
  add column externo jsonb;
create unique index uq_acomp_foto_externo on public.acompanhamento_foto (obra_id, externo_id)
  where externo_id is not null;

alter table public.integracao_execucao drop constraint chk_integracao_exec_acao;
alter table public.integracao_execucao
  add constraint chk_integracao_exec_acao check (acao in ('diagnostico', 'sync', 'envio'));

-- ── 2. Vínculo da obra e de-para ─────────────────────────────────────────────────────────────────────────────
create table public.integracao_obra (
  obra_id uuid primary key references public.obras(id) on delete cascade,
  integracao_id uuid not null references public.integracao(id) on delete cascade,
  externo_projeto_id bigint not null,
  externo_projeto_codigo text,
  -- lançamentos anteriores a esta data não são trazidos
  data_corte date,
  traz_fotos boolean not null default true,
  -- o que é lançado aqui vai para o sistema externo? desligada | simulacao | ligada
  gravacao text not null default 'desligada',
  ultimo_sync_em timestamptz,
  ultimo_sync_ok boolean,
  ultimo_sync_resumo jsonb,
  ultimo_sync_erro text,
  criado_por uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_integracao_obra_projeto unique (integracao_id, externo_projeto_id),
  constraint chk_integracao_obra_gravacao check (gravacao in ('desligada', 'simulacao', 'ligada'))
);
comment on table public.integracao_obra is
  'Obra ligada a um projeto do sistema externo (SIGA). Com o vínculo, a produção da obra vem de lá.';

create table public.integracao_de_para (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.integracao_obra(obra_id) on delete cascade,
  tipo text not null,
  externo_id bigint not null,
  externo_nome text not null,
  -- serviço: a unidade em que o sistema externo lança
  externo_unidade text,
  -- o registro do InfraWork: agrupador do orçamento, equipe, encarregado ou local, conforme o tipo
  interno_id uuid,
  -- serviço: quantidade no InfraWork = quantidade de fora × fator
  fator_conversao numeric not null default 1,
  -- entre os de fora que apontam para o mesmo registro daqui, o que recebe a gravação
  principal boolean not null default false,
  -- serviço que fica fora do orçamento de propósito: não aparece como pendência
  ignorado boolean not null default false,
  -- o que mais o cadastro de fora diz (material do serviço, encarregado da equipe)
  dados jsonb,
  atualizado_por uuid default auth.uid() references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint uq_integracao_de_para unique (obra_id, tipo, externo_id),
  constraint chk_integracao_de_para_tipo check (tipo in ('servico', 'equipe', 'encarregado', 'local')),
  constraint chk_integracao_de_para_fator check (fator_conversao > 0)
);
comment on table public.integracao_de_para is
  'De-para por obra entre o cadastro do sistema externo e o do InfraWork (serviço, equipe, encarregado, local).';
create index idx_integracao_de_para_interno on public.integracao_de_para (obra_id, tipo, interno_id);

alter table public.integracao_obra enable row level security;
alter table public.integracao_de_para enable row level security;

-- leitura: quem acompanha a obra. Gravação: só pelas funções abaixo.
create policy integracao_obra_select on public.integracao_obra for select to authenticated
  using (obra_id in (select public.obras_permitidas('acompanhamento')));
create policy integracao_de_para_select on public.integracao_de_para for select to authenticated
  using (obra_id in (select public.obras_permitidas('acompanhamento')));
revoke all on table public.integracao_obra from authenticated;
grant select on table public.integracao_obra to authenticated;
revoke all on table public.integracao_de_para from authenticated;
grant select on table public.integracao_de_para to authenticated;

-- ── 3. Travas na produção ────────────────────────────────────────────────────────────────────────────────────
-- A regra de sempre, com uma mudança: lançamento do SIGA não passa pela parametrização do serviço nem pela data
-- (o que vale é o que está lá).
create or replace function public.fn_acomp_prod_before_write() returns trigger
    language plpgsql security definer
    set search_path to 'public'
    as $$
declare v_item record; v_par record; v_tr record;
        v_siga boolean := new.origem = 'siga';
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

    -- parametrização do serviço (vale para lançamentos novos e para quem muda quantidade/serviço)
    select * into v_par from public.servico_parametro where item_orcamentario_id = new.item_orcamentario_id;
    if found and not v_siga then
      if v_par.modo_lancamento = 'viagens' and new.origem <> 'viagens'
         and (tg_op = 'INSERT' or new.quantidade is distinct from old.quantidade
              or new.item_orcamentario_id is distinct from old.item_orcamentario_id) then
        raise exception 'O serviço "%" é alimentado por viagens: lance as viagens do dia', v_item.descricao;
      end if;
      -- observação desligada vale para o apontador (a nota "N viagens" da produção das viagens fica)
      if not v_par.habilita_obs and new.origem <> 'viagens' then new.obs := null; end if;
      if v_par.exige_local and new.origem <> 'viagens' then
        if new.trecho_id is null then
          raise exception 'Informe o local do lançamento de "%"', v_item.descricao;
        end if;
        select tipo into v_tr from public.obra_trecho where id = new.trecho_id;
        if v_tr.tipo = 'eixo' and new.posicao_inicio_m is null then
          raise exception 'Informe as estacas inicial e final do lançamento de "%"', v_item.descricao;
        end if;
      end if;
    end if;
  end if;
  -- a produção das viagens só muda pelas viagens (exclusões em cascata — `set null` de item/equipe — passam)
  if new.origem = 'viagens' and coalesce(current_setting('infrawork.viagens_sync', true), '') <> '1'
     and (tg_op = 'INSERT' or new.origem is distinct from old.origem
          or new.quantidade is distinct from old.quantidade or new.data is distinct from old.data
          or new.trecho_id is distinct from old.trecho_id
          or new.posicao_inicio_m is distinct from old.posicao_inicio_m
          or new.posicao_fim_m is distinct from old.posicao_fim_m) then
    raise exception 'A produção das viagens é calculada pelas viagens do dia';
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
  if new.data > current_date + 1 and not v_siga then raise exception 'Data no futuro'; end if;
  if tg_op = 'INSERT' then new.criado_por := coalesce(new.criado_por, auth.uid()); end if;
  new.updated_at := now();
  return new;
end $$;

-- O que vem do SIGA só muda pela sincronização; em obra vinculada, o que é lançado aqui só entra com a gravação
-- ligada (senão ficaria um lançamento que o SIGA não conhece). As cascatas que só zeram item, equipe, encarregado
-- ou local passam, e a exclusão da obra inteira também.
create function public.fn_acomp_prod_siga() returns trigger
    language plpgsql security definer
    set search_path to 'public'
    as $$
declare v_modo text;
begin
  if coalesce(current_setting('infrawork.siga_sync', true), '') = '1'
     or coalesce(current_setting('infrawork.excluindo_obra', true), '') = '1' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.origem = 'siga' then
      raise exception 'Este lançamento vem do SIGA: a exclusão é feita lá';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.origem = 'siga' then
      raise exception 'Lançamento do SIGA só entra pela sincronização';
    end if;
    if new.origem <> 'viagens' then
      select gravacao into v_modo from public.integracao_obra where obra_id = new.obra_id;
      if v_modo is not null and v_modo <> 'ligada' then
        raise exception 'A produção desta obra vem do SIGA. O lançamento pelo InfraWork ainda não está ligado para ela';
      end if;
    end if;
    return new;
  end if;

  if old.origem = 'siga' and (
       new.origem is distinct from old.origem
    or new.externo_id is distinct from old.externo_id
    or new.quantidade is distinct from old.quantidade
    or new.data is distinct from old.data
    or new.unidade is distinct from old.unidade
    or new.fator_conversao is distinct from old.fator_conversao
    or new.obs is distinct from old.obs
    or (new.item_orcamentario_id is not null and new.item_orcamentario_id is distinct from old.item_orcamentario_id)
    or (new.equipe_id is not null and new.equipe_id is distinct from old.equipe_id)
    or (new.encarregado_id is not null and new.encarregado_id is distinct from old.encarregado_id)
    or (new.trecho_id is not null and new.trecho_id is distinct from old.trecho_id)) then
    raise exception 'Este lançamento vem do SIGA: a alteração é feita lá';
  end if;
  if new.origem = 'siga' and old.origem <> 'siga' then
    raise exception 'Lançamento do SIGA só entra pela sincronização';
  end if;
  return new;
end $$;
create trigger trg_acomp_prod_siga before insert or update or delete on public.acompanhamento_producao
  for each row execute function public.fn_acomp_prod_siga();

-- ── 4. Vínculo da obra ───────────────────────────────────────────────────────────────────────────────────────
-- Liga a obra a um projeto do SIGA (ou troca o projeto). Trocar o projeto descarta o espelho e os de-para do
-- anterior: são de outro projeto.
create function public.siga_vincular_obra(
  _obra_id uuid, _projeto_id bigint, _projeto_codigo text, _data_corte date default null,
  _traz_fotos boolean default true
) returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_empresa uuid;
  v_integracao uuid;
  v_atual bigint;
begin
  if not public.pode_planejar_obra(_obra_id) then
    raise exception 'Sem permissão para vincular esta obra' using errcode = '42501';
  end if;
  if _projeto_id is null then raise exception 'Informe o projeto do SIGA'; end if;
  select empresa_id into v_empresa from public.obras where id = _obra_id;
  if not public.empresa_tem(v_empresa, 'integracao_siga', false) then
    raise exception 'A integração com o SIGA não está habilitada para esta empresa';
  end if;
  select id into v_integracao from public.integracao where empresa_id = v_empresa and tipo = 'siga' and ativa;
  if v_integracao is null then
    raise exception 'O SIGA ainda não foi conectado: conecte em Gerencial › Integrações';
  end if;
  if exists (select 1 from public.integracao_obra
              where integracao_id = v_integracao and externo_projeto_id = _projeto_id and obra_id <> _obra_id) then
    raise exception 'Este projeto do SIGA já está ligado a outra obra';
  end if;

  select externo_projeto_id into v_atual from public.integracao_obra where obra_id = _obra_id;
  if v_atual is not null and v_atual <> _projeto_id then
    perform set_config('infrawork.siga_sync', '1', true);
    delete from public.acompanhamento_producao where obra_id = _obra_id and origem = 'siga';
    update public.acompanhamento_producao set externo_id = null, externo = null
     where obra_id = _obra_id and externo_id is not null;
    delete from public.acompanhamento_foto where obra_id = _obra_id and externo_id is not null;
    delete from public.integracao_de_para where obra_id = _obra_id;
    perform set_config('infrawork.siga_sync', '', true);
  end if;

  insert into public.integracao_obra (obra_id, integracao_id, externo_projeto_id, externo_projeto_codigo,
                                      data_corte, traz_fotos)
  values (_obra_id, v_integracao, _projeto_id, nullif(trim(_projeto_codigo), ''), _data_corte,
          coalesce(_traz_fotos, true))
  on conflict (obra_id) do update
    set integracao_id = excluded.integracao_id,
        externo_projeto_id = excluded.externo_projeto_id,
        externo_projeto_codigo = excluded.externo_projeto_codigo,
        data_corte = excluded.data_corte,
        traz_fotos = excluded.traz_fotos,
        ultimo_sync_em = case when integracao_obra.externo_projeto_id = excluded.externo_projeto_id
                              then integracao_obra.ultimo_sync_em end,
        updated_at = now();
end
$$;

-- Desfaz o vínculo: o espelho do SIGA sai da obra (os lançamentos continuam no SIGA).
create function public.siga_desvincular_obra(_obra_id uuid) returns void
language plpgsql security definer
set search_path to 'public'
as $$
begin
  if not public.pode_planejar_obra(_obra_id) then
    raise exception 'Sem permissão para desvincular esta obra' using errcode = '42501';
  end if;
  perform set_config('infrawork.siga_sync', '1', true);
  delete from public.acompanhamento_producao where obra_id = _obra_id and origem = 'siga';
  update public.acompanhamento_producao set externo_id = null, externo = null
   where obra_id = _obra_id and externo_id is not null;
  delete from public.acompanhamento_foto where obra_id = _obra_id and externo_id is not null;
  perform set_config('infrawork.siga_sync', '', true);
  delete from public.integracao_obra where obra_id = _obra_id;
end
$$;

-- ── 5. De-para ───────────────────────────────────────────────────────────────────────────────────────────────
-- Aplica os de-para nos lançamentos que já vieram: o vínculo criado depois vale para trás. As posições no eixo
-- dependem do texto da estaca, que só o conector lê: a assinatura é apagada para a próxima sincronização refazer.
create function public.siga_reaplicar(_obra_id uuid) returns integer
language plpgsql security definer
set search_path to 'public'
as $$
declare v_n integer;
begin
  perform set_config('infrawork.siga_sync', '1', true);
  update public.acompanhamento_producao p
     set item_orcamentario_id = s.item_id,
         -- o serviço de custo é reescolhido pela regra da produção, a partir do agrupador
         servico_id = null,
         fator_conversao = coalesce(s.fator, 1),
         equipe_id = e.equipe_id,
         encarregado_id = en.encarregado_id,
         trecho_id = t.trecho_id,
         posicao_inicio_m = case when t.trecho_id is not distinct from p.trecho_id then p.posicao_inicio_m end,
         posicao_fim_m = case when t.trecho_id is not distinct from p.trecho_id then p.posicao_fim_m end,
         externo = p.externo - 'assinatura'
    from public.acompanhamento_producao q
    left join lateral (
      select i.id as item_id, d.fator_conversao as fator
        from public.integracao_de_para d
        join public.item_orcamentario i
          on i.id = d.interno_id and i.obra_id = d.obra_id and i.tipo = 'servico_grupo' and i.servico_id is not null
       where d.obra_id = q.obra_id and d.tipo = 'servico' and not d.ignorado
         and d.externo_id = nullif(q.externo->>'servico_id', '')::bigint
    ) s on true
    left join lateral (
      select eq.id as equipe_id
        from public.integracao_de_para d join public.equipe eq on eq.id = d.interno_id and eq.obra_id = d.obra_id
       where d.obra_id = q.obra_id and d.tipo = 'equipe'
         and d.externo_id = nullif(q.externo->>'equipe_id', '')::bigint
    ) e on true
    left join lateral (
      select enc.id as encarregado_id
        from public.integracao_de_para d
        join public.encarregado enc on enc.id = d.interno_id and enc.obra_id = d.obra_id
       where d.obra_id = q.obra_id and d.tipo = 'encarregado'
         and d.externo_id = nullif(q.externo->>'encarregado_id', '')::bigint
    ) en on true
    left join lateral (
      select tr.id as trecho_id
        from public.integracao_de_para d join public.obra_trecho tr on tr.id = d.interno_id and tr.obra_id = d.obra_id
       where d.obra_id = q.obra_id and d.tipo = 'local'
         and d.externo_id = nullif(q.externo->>'trecho_id', '')::bigint
    ) t on true
   where q.id = p.id and p.obra_id = _obra_id and p.origem = 'siga';
  get diagnostics v_n = row_count;
  perform set_config('infrawork.siga_sync', '', true);
  return v_n;
end
$$;
revoke execute on function public.siga_reaplicar(uuid) from authenticated;

-- Grava um lote de de-para. Cada linha: { tipo, externo_id, externo_nome, externo_unidade?, interno_id?,
-- fator_conversao?, principal?, ignorado?, dados?, criar? }. `criar` (equipe e encarregado) cria o registro no
-- InfraWork com o nome de fora quando não há um com esse nome. `remover: true` apaga o de-para.
create function public.siga_de_para_salvar(_obra_id uuid, _linhas jsonb) returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
  l jsonb;
  v_tipo text;
  v_ext bigint;
  v_nome text;
  v_interno uuid;
  v_gravados integer := 0;
  v_criados integer := 0;
  v_enc uuid;
begin
  if not public.pode_planejar_obra(_obra_id) then
    raise exception 'Sem permissão para alterar os vínculos desta obra' using errcode = '42501';
  end if;
  if not exists (select 1 from public.integracao_obra where obra_id = _obra_id) then
    raise exception 'Ligue a obra a um projeto do SIGA antes de vincular os cadastros';
  end if;

  for l in select * from jsonb_array_elements(coalesce(_linhas, '[]'::jsonb)) loop
    v_tipo := l->>'tipo';
    v_ext := (l->>'externo_id')::bigint;
    v_nome := nullif(trim(l->>'externo_nome'), '');
    v_interno := nullif(l->>'interno_id', '')::uuid;
    if v_tipo is null or v_ext is null then raise exception 'De-para sem tipo ou sem o código do SIGA'; end if;

    if coalesce((l->>'remover')::boolean, false) then
      delete from public.integracao_de_para where obra_id = _obra_id and tipo = v_tipo and externo_id = v_ext;
      continue;
    end if;
    if v_nome is null then raise exception 'De-para sem o nome que veio do SIGA'; end if;

    if v_interno is null and coalesce((l->>'criar')::boolean, false) then
      if v_tipo = 'encarregado' then
        select id into v_interno from public.encarregado where obra_id = _obra_id and lower(nome) = lower(v_nome);
        if v_interno is null then
          insert into public.encarregado (obra_id, nome) values (_obra_id, v_nome) returning id into v_interno;
          v_criados := v_criados + 1;
        end if;
      elsif v_tipo = 'equipe' then
        select id into v_interno from public.equipe where obra_id = _obra_id and lower(nome) = lower(v_nome);
        if v_interno is null then
          insert into public.equipe (obra_id, nome, tipo, ordem)
          values (_obra_id, v_nome, coalesce(nullif(l->>'equipe_tipo', ''), 'Geral'),
                  coalesce((select max(ordem) + 1 from public.equipe where obra_id = _obra_id), 0))
          returning id into v_interno;
          v_criados := v_criados + 1;
        end if;
      else
        raise exception 'Só equipe e encarregado podem ser criados a partir do SIGA';
      end if;
    end if;

    if v_interno is not null then
      if v_tipo = 'servico' and not exists (
           select 1 from public.item_orcamentario where id = v_interno and obra_id = _obra_id and tipo = 'servico_grupo') then
        raise exception 'O serviço "%" precisa ser ligado a um serviço (agrupador) do orçamento desta obra', v_nome;
      elsif v_tipo = 'equipe' and not exists (
           select 1 from public.equipe where id = v_interno and obra_id = _obra_id) then
        raise exception 'A equipe ligada a "%" não é desta obra', v_nome;
      elsif v_tipo = 'encarregado' and not exists (
           select 1 from public.encarregado where id = v_interno and obra_id = _obra_id) then
        raise exception 'O encarregado ligado a "%" não é desta obra', v_nome;
      elsif v_tipo = 'local' and not exists (
           select 1 from public.obra_trecho where id = v_interno and obra_id = _obra_id) then
        raise exception 'O local ligado a "%" não é desta obra', v_nome;
      end if;
    end if;

    insert into public.integracao_de_para (obra_id, tipo, externo_id, externo_nome, externo_unidade, interno_id,
                                           fator_conversao, principal, ignorado, dados, atualizado_por, updated_at)
    values (_obra_id, v_tipo, v_ext, v_nome, nullif(trim(l->>'externo_unidade'), ''), v_interno,
            coalesce((l->>'fator_conversao')::numeric, 1), coalesce((l->>'principal')::boolean, false),
            coalesce((l->>'ignorado')::boolean, false), l->'dados', auth.uid(), now())
    on conflict (obra_id, tipo, externo_id) do update
      set externo_nome = excluded.externo_nome,
          externo_unidade = coalesce(excluded.externo_unidade, integracao_de_para.externo_unidade),
          interno_id = excluded.interno_id,
          fator_conversao = excluded.fator_conversao,
          principal = excluded.principal,
          ignorado = excluded.ignorado,
          dados = coalesce(excluded.dados, integracao_de_para.dados),
          atualizado_por = auth.uid(),
          updated_at = now();
    v_gravados := v_gravados + 1;

    -- um só "de gravação" por registro do InfraWork
    if v_interno is not null and coalesce((l->>'principal')::boolean, false) then
      update public.integracao_de_para set principal = false
       where obra_id = _obra_id and tipo = v_tipo and interno_id = v_interno and externo_id <> v_ext and principal;
    end if;
  end loop;

  -- a equipe que veio do SIGA com encarregado ganha o encarregado, se ainda não tem
  for l in select * from jsonb_array_elements(coalesce(_linhas, '[]'::jsonb)) loop
    if l->>'tipo' = 'equipe' and nullif(l->'dados'->>'encarregado_id', '') is not null then
      select d.interno_id into v_enc from public.integracao_de_para d
       where d.obra_id = _obra_id and d.tipo = 'encarregado'
         and d.externo_id = (l->'dados'->>'encarregado_id')::bigint;
      if v_enc is not null then
        update public.equipe e set encarregado_id = v_enc
          from public.integracao_de_para d
         where d.obra_id = _obra_id and d.tipo = 'equipe' and d.externo_id = (l->>'externo_id')::bigint
           and e.id = d.interno_id and e.encarregado_id is null;
      end if;
    end if;
  end loop;

  return jsonb_build_object('gravados', v_gravados, 'criados', v_criados,
                            'reaplicados', public.siga_reaplicar(_obra_id));
end
$$;

-- ── 6. Lote vindo do SIGA ────────────────────────────────────────────────────────────────────────────────────
-- Aplica os lançamentos lidos do SIGA numa transação. Só o serviço (a função do conector) chama. Cada linha:
-- { externo_id, app_uuid?, data, servico_id, servico, unidade, quantidade, equipe_id?, equipe?, encarregado_id?,
--   encarregado?, trecho_id?, trecho?, estaca?, estaca_inicial?, estaca_final?, pos_inicio_m?, pos_fim_m?, obs?,
--   cadastrador?, chuva?, material?: {nome, quantidade, unidade}, excluido?, assinatura }.
-- `_vivos` é a lista de todos os lançamentos que existem no SIGA para a obra: quando vem, o que é espelho e não
-- está nela sai (foi apagado lá ou ficou antes do corte). O conector manda a lista no último pedaço do lote.
create function public.siga_aplicar_producao(_obra_id uuid, _linhas jsonb, _vivos bigint[] default null)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
  l jsonb;
  v_ext bigint;
  v_id uuid;
  v_atual record;
  v_item uuid; v_fator numeric; v_equipe uuid; v_enc uuid; v_trecho uuid;
  v_ini numeric; v_fim numeric; v_comp numeric; v_tipo_tr text;
  v_externo jsonb;
  v_novos integer := 0; v_alterados integer := 0; v_removidos integer := 0; v_iguais integer := 0;
  v_erros jsonb := '[]'::jsonb;
  v_n integer;
begin
  if not exists (select 1 from public.integracao_obra where obra_id = _obra_id) then
    raise exception 'Obra sem vínculo com o SIGA';
  end if;
  perform set_config('infrawork.siga_sync', '1', true);

  for l in select * from jsonb_array_elements(coalesce(_linhas, '[]'::jsonb)) loop
    v_ext := (l->>'externo_id')::bigint;
    begin
      -- o nosso lançamento que foi para o SIGA volta com o nosso id no app_uuid: é a mesma linha
      select id, origem, externo into v_atual from public.acompanhamento_producao
       where obra_id = _obra_id and externo_id = v_ext;
      if v_atual.id is null and nullif(l->>'app_uuid', '') is not null then
        select id, origem, externo into v_atual from public.acompanhamento_producao
         where obra_id = _obra_id and id::text = l->>'app_uuid';
      end if;

      if coalesce((l->>'excluido')::boolean, false) then
        if v_atual.id is not null then
          delete from public.acompanhamento_producao where id = v_atual.id;
          v_removidos := v_removidos + 1;
        end if;
        continue;
      end if;

      if v_atual.id is not null and v_atual.externo->>'assinatura' is not distinct from l->>'assinatura' then
        v_iguais := v_iguais + 1;
        continue;
      end if;

      -- de-para (o que não tem vínculo, ou cujo registro daqui sumiu, fica em branco e vira pendência)
      v_item := null; v_fator := 1; v_equipe := null; v_enc := null; v_trecho := null; v_ini := null; v_fim := null;
      select i.id, d.fator_conversao into v_item, v_fator
        from public.integracao_de_para d
        join public.item_orcamentario i
          on i.id = d.interno_id and i.obra_id = d.obra_id and i.tipo = 'servico_grupo' and i.servico_id is not null
       where d.obra_id = _obra_id and d.tipo = 'servico' and not d.ignorado
         and d.externo_id = nullif(l->>'servico_id', '')::bigint;
      v_fator := coalesce(v_fator, 1);
      select eq.id into v_equipe
        from public.integracao_de_para d join public.equipe eq on eq.id = d.interno_id and eq.obra_id = d.obra_id
       where d.obra_id = _obra_id and d.tipo = 'equipe' and d.externo_id = nullif(l->>'equipe_id', '')::bigint;
      select en.id into v_enc
        from public.integracao_de_para d join public.encarregado en on en.id = d.interno_id and en.obra_id = d.obra_id
       where d.obra_id = _obra_id and d.tipo = 'encarregado'
         and d.externo_id = nullif(l->>'encarregado_id', '')::bigint;
      select tr.id, tr.tipo, tr.comprimento_m into v_trecho, v_tipo_tr, v_comp
        from public.integracao_de_para d join public.obra_trecho tr on tr.id = d.interno_id and tr.obra_id = d.obra_id
       where d.obra_id = _obra_id and d.tipo = 'local' and d.externo_id = nullif(l->>'trecho_id', '')::bigint;
      -- posição no eixo: só quando o conector conseguiu ler a estaca e ela cabe no local
      if v_trecho is not null and v_tipo_tr = 'eixo'
         and nullif(l->>'pos_inicio_m', '') is not null and nullif(l->>'pos_fim_m', '') is not null then
        v_ini := least((l->>'pos_inicio_m')::numeric, (l->>'pos_fim_m')::numeric);
        v_fim := greatest((l->>'pos_inicio_m')::numeric, (l->>'pos_fim_m')::numeric);
        if v_ini < 0 or v_comp is null or v_fim > v_comp + 0.005 then v_ini := null; v_fim := null; end if;
      end if;

      v_externo := jsonb_strip_nulls(jsonb_build_object(
        'servico_id', nullif(l->>'servico_id', '')::bigint, 'servico', l->>'servico',
        'equipe_id', nullif(l->>'equipe_id', '')::bigint, 'equipe', l->>'equipe',
        'encarregado_id', nullif(l->>'encarregado_id', '')::bigint, 'encarregado', l->>'encarregado',
        'trecho_id', nullif(l->>'trecho_id', '')::bigint, 'trecho', l->>'trecho',
        'estaca', l->>'estaca', 'cadastrador', l->>'cadastrador',
        'chuva', (l->>'chuva')::boolean, 'assinatura', l->>'assinatura'));

      if v_atual.id is null then
        insert into public.acompanhamento_producao (
          obra_id, data, item_orcamentario_id, servico_nome, unidade, equipe_id, encarregado_id, quantidade,
          fator_conversao, estaca_inicial, estaca_final, obs, origem, trecho_id, posicao_inicio_m, posicao_fim_m,
          externo_id, externo)
        values (
          _obra_id, (l->>'data')::date, v_item, coalesce(nullif(trim(l->>'servico'), ''), 'Serviço do SIGA'),
          l->>'unidade', v_equipe, v_enc, coalesce((l->>'quantidade')::numeric, 0), v_fator,
          coalesce(nullif(l->>'estaca_inicial', ''), nullif(l->>'estaca', '')), nullif(l->>'estaca_final', ''),
          nullif(l->>'obs', ''), 'siga', v_trecho, v_ini, v_fim, v_ext, v_externo)
        returning id into v_id;
        v_novos := v_novos + 1;
      else
        v_id := v_atual.id;
        update public.acompanhamento_producao
           set data = (l->>'data')::date,
               item_orcamentario_id = v_item,
               servico_id = null,
               servico_nome = coalesce(nullif(trim(l->>'servico'), ''), servico_nome),
               unidade = l->>'unidade',
               equipe_id = v_equipe,
               encarregado_id = v_enc,
               quantidade = coalesce((l->>'quantidade')::numeric, 0),
               fator_conversao = v_fator,
               estaca_inicial = coalesce(nullif(l->>'estaca_inicial', ''), nullif(l->>'estaca', '')),
               estaca_final = nullif(l->>'estaca_final', ''),
               obs = nullif(l->>'obs', ''),
               trecho_id = v_trecho, posicao_inicio_m = v_ini, posicao_fim_m = v_fim,
               externo_id = v_ext, externo = v_externo
         where id = v_id;
        v_alterados := v_alterados + 1;
      end if;

      delete from public.acompanhamento_producao_material where producao_id = v_id;
      if nullif(trim(l->'material'->>'nome'), '') is not null
         and coalesce((l->'material'->>'quantidade')::numeric, 0) > 0 then
        insert into public.acompanhamento_producao_material (producao_id, nome, quantidade, unidade)
        values (v_id, trim(l->'material'->>'nome'), (l->'material'->>'quantidade')::numeric,
                nullif(l->'material'->>'unidade', ''));
      end if;
    exception when others then
      -- uma linha ruim não derruba o lote: fica registrada e as outras entram
      if jsonb_array_length(v_erros) < 20 then
        v_erros := v_erros || jsonb_build_object('externo_id', v_ext, 'erro', sqlerrm);
      end if;
    end;
  end loop;

  if _vivos is not null then
    delete from public.acompanhamento_producao
     where obra_id = _obra_id and origem = 'siga' and not (externo_id = any (_vivos));
    get diagnostics v_n = row_count;
    v_removidos := v_removidos + v_n;
  end if;

  perform set_config('infrawork.siga_sync', '', true);
  return jsonb_build_object('novos', v_novos, 'alterados', v_alterados, 'iguais', v_iguais,
                            'removidos', v_removidos, 'erros', v_erros);
end
$$;
revoke execute on function public.siga_aplicar_producao(uuid, jsonb, bigint[]) from authenticated;

-- ── 7. O que a tela lê ───────────────────────────────────────────────────────────────────────────────────────
-- A produção mostra o nome que veio do SIGA enquanto não há vínculo (equipe, encarregado, local, quem lançou).
create or replace view public.vw_acompanhamento_producao_enriquecida with (security_invoker = 'true') as
 select p.id,
    p.obra_id,
    p.data,
    p.item_orcamentario_id,
    p.servico_id,
    p.servico_id as servico_planejamento_id,
    p.servico_nome,
    p.quantidade as qtd,
    ((p.quantidade * p.fator_conversao))::numeric(14,4) as qtd_convertida,
    p.fator_conversao,
    p.unidade,
    coalesce(s.unidade, io.unidade_referencia, p.unidade) as unidade_plano,
    coalesce(nullif(trim(both from p.frente), ''::text), '(sem frente)'::text) as frente,
    p.frente as frente_raw,
    p.estaca_inicial,
    p.estaca_final,
    p.obs,
    p.origem,
    p.importacao_id,
    p.criado_por,
    coalesce(pr.nome, p.externo->>'cadastrador') as criado_por_nome,
    p.created_at,
    p.updated_at,
    p.equipe_id,
    p.equipe_id as equipe_planejamento_id,
    coalesce(e.nome, p.externo->>'equipe', '—'::text) as equipe_display_nome,
    coalesce(e.cor, '#94a3b8'::text) as equipe_display_cor,
    e.tipo as equipe_tipo,
    p.encarregado_id,
    coalesce(en.apelido, en.nome, p.externo->>'encarregado') as encarregado_display_nome,
    s.codigo as servico_codigo,
    coalesce(s.nome, p.servico_nome) as servico_display_nome,
    s.unidade as servico_unidade,
    io.codigo as servico_grupo_codigo,
    io.descricao as servico_grupo_descricao,
    pta.tarefa_id as tarefa_baseline_id,
    pta.data_inicio as tarefa_data_inicio,
    pta.data_fim as tarefa_data_fim,
    ( select count(*) as count
           from public.acompanhamento_foto f
          where ((f.producao_id = p.id) and (f.excluida_em is null))) as fotos_count,
    p.trecho_id,
    p.posicao_inicio_m,
    p.posicao_fim_m,
    coalesce(tr.nome, p.externo->>'trecho') as trecho_nome,
    tr.tipo as trecho_tipo,
    ( select string_agg(trim(both from concat_ws(' '::text, to_char(m.quantidade, 'FM999999990.####'::text), m.unidade, m.nome)), '; '::text order by m.nome) as string_agg
           from public.acompanhamento_producao_material m
          where (m.producao_id = p.id)) as material_resumo,
    p.app_uuid,
    p.externo_id
   from ((((((((public.acompanhamento_producao p
     left join public.equipe e on ((e.id = p.equipe_id)))
     left join public.encarregado en on ((en.id = p.encarregado_id)))
     left join public.item_orcamentario io on ((io.id = p.item_orcamentario_id)))
     left join public.servico s on ((s.id = p.servico_id)))
     left join public.profiles pr on ((pr.id = p.criado_por)))
     left join public.obra_trecho tr on ((tr.id = p.trecho_id)))
     left join public.planejamento pl on (((pl.obra_id = p.obra_id) and (pl.id = public.planejamento_referencia(p.obra_id)))))
     left join ( select pt.planejamento_id,
            pt.item_orcamentario_id,
            min(pt.data_inicio) as data_inicio,
            max(pt.data_fim) as data_fim,
            (array_agg(pt.id order by pt.data_inicio))[1] as tarefa_id
           from public.planejamento_tarefa pt
          where (pt.item_orcamentario_id is not null)
          group by pt.planejamento_id, pt.item_orcamentario_id) pta on (((pta.planejamento_id = pl.id) and (pta.item_orcamentario_id = p.item_orcamentario_id))));

-- O que veio do SIGA e ainda não tem vínculo, por cadastro: é a lista de pendências da tela e da prontidão.
create view public.vw_siga_pendencias with (security_invoker = 'true') as
select p.obra_id, 'servico'::text as tipo, (p.externo->>'servico_id')::bigint as externo_id,
       max(p.externo->>'servico') as externo_nome, count(*)::integer as lancamentos, max(p.data) as ultimo
  from public.acompanhamento_producao p
 where p.origem = 'siga' and p.item_orcamentario_id is null and p.externo ? 'servico_id'
   and not exists (select 1 from public.integracao_de_para d
                    where d.obra_id = p.obra_id and d.tipo = 'servico' and d.ignorado
                      and d.externo_id = (p.externo->>'servico_id')::bigint)
 group by 1, 3
union all
select p.obra_id, 'equipe', (p.externo->>'equipe_id')::bigint, max(p.externo->>'equipe'), count(*)::integer, max(p.data)
  from public.acompanhamento_producao p
 where p.origem = 'siga' and p.equipe_id is null and p.externo ? 'equipe_id'
 group by 1, 3
union all
select p.obra_id, 'encarregado', (p.externo->>'encarregado_id')::bigint, max(p.externo->>'encarregado'),
       count(*)::integer, max(p.data)
  from public.acompanhamento_producao p
 where p.origem = 'siga' and p.encarregado_id is null and p.externo ? 'encarregado_id'
 group by 1, 3
union all
select p.obra_id, 'local', (p.externo->>'trecho_id')::bigint, max(p.externo->>'trecho'), count(*)::integer, max(p.data)
  from public.acompanhamento_producao p
 where p.origem = 'siga' and p.trecho_id is null and p.externo ? 'trecho_id'
 group by 1, 3;
revoke all on public.vw_siga_pendencias from anon;
grant select on public.vw_siga_pendencias to authenticated;

-- ── 8. Prontidão da obra ─────────────────────────────────────────────────────────────────────────────────────
-- Obra ligada ao SIGA ganha a etapa "Vínculo com o SIGA": serviço sem vínculo é pendência (a produção dele não
-- entra no previsto e realizado); equipe, encarregado e local sem vínculo são aviso.
create or replace function public.obra_prontidao(_obra_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $$
declare
  v_plano record;
  v_ref uuid;
  v_ref_vigente boolean;
  etapas jsonb := '[]'::jsonb;
  n int; n2 int; n3 int; itens jsonb; v_ultima date;
  v_aponta boolean;
  v_siga boolean;
begin
  if not public.chamada_autorizada(_obra_id, 'ver') then
    raise exception 'Sem acesso a esta obra' using errcode = '42501';
  end if;

  -- 1. planilha de venda
  select count(*) into n from item_orcamentario where obra_id = _obra_id and tipo = 'receita';
  select count(*) into n2 from item_orcamentario r
   where r.obra_id = _obra_id and r.tipo = 'receita'
     and not exists (select 1 from item_orc_alocacao a where a.receita_id = r.id);
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'codigo', codigo, 'descricao', descricao) order by ordem, codigo), '[]')
    into itens from (select r.id, r.codigo, r.descricao, r.ordem from item_orcamentario r
                      where r.obra_id = _obra_id and r.tipo = 'receita'
                        and not exists (select 1 from item_orc_alocacao a where a.receita_id = r.id)
                      order by r.ordem, r.codigo limit 30) x;
  etapas := etapas || jsonb_build_object(
    'chave', 'orcamento', 'titulo', 'Planilha de venda',
    'situacao', case when n = 0 then 'pendente' when n2 > 0 then 'aviso' else 'ok' end,
    'resumo', case when n = 0 then 'Importe a planilha orçamentária da obra.'
                   when n2 > 0 then n2 || ' de ' || n || ' itens da planilha não estão em nenhum serviço: não entram em custo, plano nem produção.'
                   else 'Itens: ' || n || ', todos dentro de serviços.' end,
    'rota', '/orcamento/obra/plan-orc', 'itens', itens);

  -- 2. serviços com composição (sem ela o serviço não tem custo nem produção e some do lançamento)
  select count(*) into n from item_orcamentario where obra_id = _obra_id and tipo = 'servico_grupo' and indireto_id is null;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'codigo', codigo, 'descricao', descricao) order by ordem, codigo), '[]'), count(*)
    into itens, n2
    from (select i.id, i.codigo, i.descricao, i.ordem from item_orcamentario i
           where i.obra_id = _obra_id and i.tipo = 'servico_grupo' and i.indireto_id is null
             and (i.servico_id is null
                  or not (exists (select 1 from cpu c where c.servico_id = i.servico_id)
                          or exists (select 1 from servico_cpu_link l where l.servico_id = i.servico_id)))) x;
  etapas := etapas || jsonb_build_object(
    'chave', 'composicoes', 'titulo', 'Serviços com composição',
    'situacao', case when n = 0 then 'pendente' when n2 > 0 then 'pendente' else 'ok' end,
    'resumo', case when n = 0 then 'Agrupe os itens da planilha em serviços.'
                   when n2 > 0 then n2 || ' de ' || n || ' serviços sem composição: sem custo, sem produção por dia e fora da lista de lançamento.'
                   else 'Serviços: ' || n || ', todos com composição.' end,
    'rota', case when n = 0 then '/orcamento/obra/plan-orc' else '/orcamento/servicos' end, 'itens', itens);

  -- 3. equipes (a obra que não aponta o encarregado no lançamento não é cobrada por equipe sem encarregado)
  select aponta_encarregado into v_aponta from obras where id = _obra_id;
  select count(*), count(*) filter (where encarregado_id is null and v_aponta) into n, n2
    from equipe where obra_id = _obra_id and ativo and not is_sistema;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'descricao', nome) order by ordem, nome), '[]') into itens
    from equipe where obra_id = _obra_id and ativo and not is_sistema and encarregado_id is null and v_aponta;
  etapas := etapas || jsonb_build_object(
    'chave', 'equipes', 'titulo', 'Equipes e encarregados',
    'situacao', case when n = 0 then 'pendente' when n2 > 0 then 'aviso' else 'ok' end,
    'resumo', case when n = 0 and v_aponta then 'Cadastre as equipes da obra e o encarregado de cada uma.'
                   when n = 0 then 'Cadastre as equipes da obra.'
                   when n2 > 0 then n2 || ' de ' || n || ' equipes sem encarregado: o lançamento pede o encarregado à mão.'
                   when not v_aponta then 'Equipes: ' || n || '. O lançamento pede só a equipe.'
                   else 'Equipes: ' || n || ', todas com encarregado.' end,
    'rota', '/acompanhamento/equipes', 'itens', itens);

  -- 4. locais (eixos e áreas): exigidos quando algum serviço pede local ou quando o plano usa quantidades por local
  select count(*) into n from obra_trecho where obra_id = _obra_id;
  select count(*) into n2 from servico_parametro where obra_id = _obra_id and exige_local;
  etapas := etapas || jsonb_build_object(
    'chave', 'locais', 'titulo', 'Locais da obra',
    'situacao', case when n > 0 then 'ok' when n2 > 0 then 'pendente' else 'opcional' end,
    'resumo', case when n > 0 then 'Locais: ' || n || ' (eixos e áreas).'
                   when n2 > 0 then 'Serviços que exigem local no lançamento: ' || n2 || ', mas a obra não tem locais.'
                   else 'Opcional: cadastre os eixos e as áreas para planejar e lançar por estaca.' end,
    'rota', '/planejamento/trechos', 'itens', '[]'::jsonb);

  -- 5. plano: o plano em edição ou, sem ele, a referência; serviços sem tarefa ou com quantidade a menos
  select p.* into v_plano from planejamento p where p.obra_id = _obra_id and not p.is_baseline order by p.created_at desc limit 1;
  if v_plano.id is null then
    select p.* into v_plano from planejamento p where p.id = public.planejamento_referencia(_obra_id);
  end if;
  if v_plano.id is null then
    etapas := etapas || jsonb_build_object(
      'chave', 'plano', 'titulo', 'Plano com todos os serviços', 'situacao', 'pendente',
      'resumo', 'Crie o plano em edição com a data de início da obra.',
      'rota', '/planejamento/cronograma', 'itens', '[]'::jsonb);
  else
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'codigo', codigo, 'descricao', descricao,
                                                 'planejado', planejado, 'orcado', orcado) order by ordem, codigo), '[]'),
           count(*)
      into itens, n
      from (select i.id, i.codigo, i.descricao, i.ordem, coalesce(i.quantidade_referencia, 0) as orcado,
                   coalesce((select sum(t.quantidade_alocada) from planejamento_tarefa t
                              where t.planejamento_id = v_plano.id and t.item_orcamentario_id = i.id), 0) as planejado
              from item_orcamentario i
             where i.obra_id = _obra_id and i.tipo = 'servico_grupo' and i.indireto_id is null and i.servico_id is not null) x
     where planejado < orcado - 0.0005;
    etapas := etapas || jsonb_build_object(
      'chave', 'plano', 'titulo', 'Plano com todos os serviços',
      'situacao', case when n > 0 then 'pendente' else 'ok' end,
      'resumo', case when n > 0 then 'Serviços com quantidade fora do plano "' || v_plano.nome || '": ' || n || '.'
                     else 'Plano "' || v_plano.nome || '" cobre a quantidade de todos os serviços.' end,
      'rota', '/planejamento/cronograma', 'itens', itens, 'plano_id', v_plano.id);

    -- 6. cronograma calculado (só o plano em edição muda; a linha de base é travada já calculada)
    etapas := etapas || jsonb_build_object(
      'chave', 'cronograma', 'titulo', 'Cronograma calculado',
      'situacao', case when v_plano.is_baseline or (v_plano.calculo_rev is not distinct from v_plano.dados_rev and not v_plano.recalculo_pendente)
                       then 'ok' else 'pendente' end,
      'resumo', case when v_plano.is_baseline then 'Linha de base travada já calculada.'
                     when v_plano.calculo_rev is null then 'O plano "' || v_plano.nome || '" ainda não foi calculado: abra o cronograma.'
                     when v_plano.calculo_rev is distinct from v_plano.dados_rev or v_plano.recalculo_pendente
                       then 'O plano "' || v_plano.nome || '" mudou desde o último cálculo: abra o cronograma para recalcular.'
                     else 'Datas do plano "' || v_plano.nome || '" em dia com os dados.' end,
      'rota', '/planejamento/cronograma', 'itens', '[]'::jsonb);
  end if;

  -- 7. linha de base vigente (régua do previsto)
  v_ref := public.planejamento_referencia(_obra_id);
  select vigente into v_ref_vigente from planejamento where id = v_ref;
  etapas := etapas || jsonb_build_object(
    'chave', 'linha_base', 'titulo', 'Linha de base vigente',
    'situacao', case when v_ref is null then 'pendente' when not v_ref_vigente then 'aviso' else 'ok' end,
    'resumo', case when v_ref is null then 'Trave o plano como linha de base e torne-a vigente: sem ela não há previsto.'
                   when not v_ref_vigente then 'Sem linha de base vigente: o previsto usa a última que foi vigente.'
                   else 'Previsto pela linha de base "' || (select nome from planejamento where id = v_ref) || '".' end,
    'rota', '/planejamento/cronograma', 'itens', '[]'::jsonb);

  -- 8. lançamento por viagens: origens e destinos que fecham a DMT
  select count(*) into n from servico_parametro where obra_id = _obra_id and modo_lancamento = 'viagens';
  if n > 0 then
    select count(*) into n2 from transporte_local where obra_id = _obra_id and ativo;
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'descricao', nome) order by nome), '[]'), count(*) into itens, n3
      from transporte_local l
     where l.obra_id = _obra_id and l.ativo and l.tipo <> 'pista'
       and (l.trecho_id is null or l.estaca_acesso_m is null)
       and not exists (select 1 from transporte_rota r where r.origem_id = l.id or r.destino_id = l.id);
    etapas := etapas || jsonb_build_object(
      'chave', 'transporte', 'titulo', 'Origens e destinos das viagens',
      'situacao', case when n2 = 0 or n3 > 0 then 'pendente' else 'ok' end,
      'resumo', case when n2 = 0 then 'Serviços lançados por viagens: ' || n || ', mas a obra não tem origens e destinos.'
                     when n3 > 0 then 'Locais sem estaca de acesso nem distância fixa: ' || n3 || '; a viagem com eles é recusada no campo.'
                     else 'Origens e destinos: ' || n2 || ', todos com DMT calculável.' end,
      'rota', '/acompanhamento/transporte', 'itens', itens);
  end if;

  -- 9. quem lança no campo
  select count(*) into n from obra_permissoes op join profiles p on p.id = op.user_id
   where op.obra_id = _obra_id and p.ativo and p.role = 'apontador';
  etapas := etapas || jsonb_build_object(
    'chave', 'campo', 'titulo', 'Apontadores no app de campo',
    'situacao', case when n > 0 then 'ok' else 'opcional' end,
    'resumo', case when n > 0 then 'Apontadores com acesso à obra: ' || n || '.'
                   else 'Opcional: libere a obra para os apontadores que lançam pelo app de campo.' end,
    'rota', '/gerencial/usuarios', 'itens', '[]'::jsonb);

  -- 10. vínculo com o SIGA (só em obra ligada a um projeto de lá)
  v_siga := exists (select 1 from integracao_obra where obra_id = _obra_id);
  if v_siga then
    select count(*) filter (where tipo = 'servico'), count(*) into n, n2 from vw_siga_pendencias where obra_id = _obra_id;
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'descricao', descricao) order by ord), '[]') into itens
      from (select tipo || ':' || externo_id as id,
                   case tipo when 'servico' then 'Serviço' when 'equipe' then 'Equipe'
                             when 'encarregado' then 'Encarregado' else 'Local' end
                   || ': ' || coalesce(externo_nome, externo_id::text) || ' (lançamentos: ' || lancamentos || ')' as descricao,
                   row_number() over (order by (tipo = 'servico') desc, lancamentos desc, externo_id) as ord
              from vw_siga_pendencias where obra_id = _obra_id
             order by 3 limit 30) x;
    etapas := etapas || jsonb_build_object(
      'chave', 'siga', 'titulo', 'Vínculo com o SIGA',
      'situacao', case when n > 0 then 'pendente' when n2 > 0 then 'aviso' else 'ok' end,
      'resumo', case when n > 0 then 'Serviços do SIGA sem vínculo: ' || n || '; a produção deles não entra no previsto e realizado.'
                     when n2 > 0 then 'Equipes, encarregados ou locais do SIGA sem vínculo: ' || n2 || '.'
                     else 'Tudo que veio do SIGA está vinculado.' end,
      'rota', '/acompanhamento/siga', 'itens', itens);
  end if;

  -- 11. produção
  select count(*), max(data) into n, v_ultima from acompanhamento_producao where obra_id = _obra_id;
  etapas := etapas || jsonb_build_object(
    'chave', 'producao', 'titulo', 'Produção lançada',
    'situacao', case when n > 0 then 'ok' else 'pendente' end,
    'resumo', case when n > 0 then 'Lançamentos: ' || n || '; o último em ' || to_char(v_ultima, 'DD/MM/YYYY') || '.'
                   when v_siga then 'Nenhuma produção veio do SIGA ainda.'
                   else 'Nenhuma produção lançada ainda.' end,
    'rota', case when v_siga then '/acompanhamento/siga' else '/acompanhamento/lancar' end, 'itens', '[]'::jsonb);

  return jsonb_build_object(
    'etapas', etapas,
    'pendentes', (select count(*) from jsonb_array_elements(etapas) e where e->>'situacao' = 'pendente'),
    'avisos', (select count(*) from jsonb_array_elements(etapas) e where e->>'situacao' = 'aviso'));
end
$$;

-- ── 9. Rodada automática ─────────────────────────────────────────────────────────────────────────────────────
-- A cada 10 minutos o conector lê o SIGA de todas as obras vinculadas (função `siga`, ação sincronizar).
select cron.unschedule(jobid) from cron.job where jobname = 'siga-sync';
select cron.schedule('siga-sync', '*/10 * * * *', $cron$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
             || '/functions/v1/siga',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
        'Content-Type', 'application/json'
      ),
      body := '{"acao":"sincronizar","origem":"cron"}'::jsonb,
      timeout_milliseconds := 120000
    ) as request_id;
  $cron$);
