-- 0073: gravação no SIGA.
-- O que é lançado, alterado ou excluído no InfraWork em obra ligada ao SIGA vai para lá por uma fila de saída.
--   1. integracao_saida: a fila. O gatilho da produção enfileira; o conector (função siga, ação enviar) grava no
--      SIGA e marca o resultado. Em simulação o conector monta o que gravaria e não grava.
--   2. O modo da obra (integracao_obra.gravacao): desligada (só leitura, como até aqui), simulacao, ligada.
--   3. Quem lança precisa estar ligado a um usuário ativo do SIGA com o projeto da obra; o serviço, a equipe, o
--      encarregado e o local do lançamento precisam ter de-para.
-- Nada é apagado no SIGA: a exclusão é uma marca (deletado = 'S'). A produção das viagens fica só no InfraWork.

-- ── 1. A fila de saída ───────────────────────────────────────────────────────────────────────────────────────
create table public.integracao_saida (
  id bigint generated always as identity primary key,
  obra_id uuid not null references public.obras(id) on delete cascade,
  integracao_id uuid not null references public.integracao(id) on delete cascade,
  entidade text not null default 'producao',
  -- o lançamento do InfraWork (vai para o SIGA como app_uuid)
  registro_id uuid not null,
  operacao text not null,
  -- número do lançamento no SIGA, quando ele já existe lá
  externo_id bigint,
  -- quem lançou, alterou ou excluiu: é o nome dele no SIGA que vai gravado
  usuario_id uuid references public.profiles(id) on delete set null,
  simulacao boolean not null default false,
  estado text not null default 'pendente',
  tentativas integer not null default 0,
  erro text,
  -- o que foi (ou, em simulação, seria) gravado
  enviado jsonb,
  -- resumo para a tela: data, serviço e quantidade
  rotulo text,
  created_at timestamptz not null default now(),
  processado_em timestamptz,
  constraint chk_integracao_saida_operacao check (operacao in ('gravar', 'excluir')),
  constraint chk_integracao_saida_estado check (estado in ('pendente', 'enviado', 'simulado', 'erro', 'descartado'))
);
comment on table public.integracao_saida is
  'Fila do que o InfraWork grava no sistema externo (SIGA): um envio por mudança de lançamento, com o resultado.';
create index ix_integracao_saida_fila on public.integracao_saida (integracao_id, id) where estado in ('pendente', 'erro');
create index ix_integracao_saida_registro on public.integracao_saida (registro_id);
create index ix_integracao_saida_obra on public.integracao_saida (obra_id, id desc);

alter table public.integracao_saida enable row level security;
create policy integracao_saida_select on public.integracao_saida for select to authenticated
  using (obra_id in (select public.obras_permitidas('acompanhamento')));
revoke all on table public.integracao_saida from anon, authenticated;
grant select on table public.integracao_saida to authenticated;

-- ── 2. Quem pode lançar em obra do SIGA e com o quê ──────────────────────────────────────────────────────────
-- O usuário da sessão precisa estar ligado a um usuário ativo do SIGA que tenha o projeto da obra.
create function public.siga_exige_usuario(_obra_id uuid) returns void
language plpgsql stable security definer
set search_path to 'public'
as $$
declare
  v record;
begin
  select iu.ativo, iu.projetos, io.externo_projeto_id into v
    from integracao_obra io
    left join integracao_usuario iu on iu.integracao_id = io.integracao_id and iu.user_id = auth.uid()
   where io.obra_id = _obra_id;
  if not found then return; end if;
  if v.ativo is null then
    raise exception 'Para lançar nesta obra, o seu usuário precisa estar ligado ao usuário do SIGA (Gerencial › Usuários).'
      using errcode = '42501';
  end if;
  if not v.ativo then
    raise exception 'O seu usuário está inativo no SIGA.' using errcode = '42501';
  end if;
  if v.projetos is not null and not (v.externo_projeto_id = any (v.projetos)) then
    raise exception 'O seu usuário do SIGA não tem o projeto desta obra.' using errcode = '42501';
  end if;
end
$$;
revoke execute on function public.siga_exige_usuario(uuid) from public, anon, authenticated;

-- Para gravar no SIGA é preciso o código de lá do serviço, da equipe, do encarregado e do local.
create function public.siga_exige_de_para(
  _obra_id uuid, _item uuid, _equipe uuid, _encarregado uuid, _trecho uuid
) returns void
language plpgsql stable security definer
set search_path to 'public'
as $$
begin
  if _item is null then
    raise exception 'Em obra do SIGA o lançamento precisa de um serviço do orçamento.';
  end if;
  if not exists (select 1 from integracao_de_para
                  where obra_id = _obra_id and tipo = 'servico' and interno_id = _item and not ignorado) then
    raise exception 'O serviço "%" não está ligado a um serviço do SIGA (Acompanhamento › Vínculo com o SIGA).',
      (select descricao from item_orcamentario where id = _item);
  end if;
  if _equipe is not null and not exists (select 1 from integracao_de_para
                  where obra_id = _obra_id and tipo = 'equipe' and interno_id = _equipe) then
    raise exception 'A equipe "%" não está ligada a uma equipe do SIGA (Acompanhamento › Vínculo com o SIGA).',
      (select nome from equipe where id = _equipe);
  end if;
  if _encarregado is not null and not exists (select 1 from integracao_de_para
                  where obra_id = _obra_id and tipo = 'encarregado' and interno_id = _encarregado) then
    raise exception 'O encarregado "%" não está ligado a um encarregado do SIGA (Acompanhamento › Vínculo com o SIGA).',
      (select nome from encarregado where id = _encarregado);
  end if;
  if _trecho is not null and not exists (select 1 from integracao_de_para
                  where obra_id = _obra_id and tipo = 'local' and interno_id = _trecho) then
    raise exception 'O local "%" não está ligado a um trecho do SIGA (Acompanhamento › Vínculo com o SIGA).',
      (select nome from obra_trecho where id = _trecho);
  end if;
end
$$;
revoke execute on function public.siga_exige_de_para(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;

-- A trava da produção, agora com os três modos:
--   desligada  o que vem do SIGA só muda lá, e a obra não recebe lançamento feito aqui;
--   simulacao  a obra recebe lançamento feito aqui (fica só aqui; a fila mostra o que seria gravado), mas o que
--              veio do SIGA continua só de leitura;
--   ligada     lançar, alterar e excluir aqui vai para o SIGA, inclusive o que nasceu lá.
-- As cascatas que só zeram item, equipe, encarregado ou local passam, e a exclusão da obra inteira também.
create or replace function public.fn_acomp_prod_siga() returns trigger
    language plpgsql security definer
    set search_path to 'public'
    as $$
declare
  v_modo text;
  v_mudou boolean;
begin
  if coalesce(current_setting('infrawork.siga_sync', true), '') = '1'
     or coalesce(current_setting('infrawork.excluindo_obra', true), '') = '1' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  select gravacao into v_modo from public.integracao_obra
   where obra_id = case when tg_op = 'DELETE' then old.obra_id else new.obra_id end;

  if tg_op = 'DELETE' then
    if old.origem = 'siga' and coalesce(v_modo, 'desligada') <> 'ligada' then
      raise exception 'Este lançamento vem do SIGA: a exclusão é feita lá';
    end if;
    if v_modo in ('simulacao', 'ligada') and old.origem <> 'viagens' then
      perform public.siga_exige_usuario(old.obra_id);
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.origem = 'siga' then
      raise exception 'Lançamento do SIGA só entra pela sincronização';
    end if;
    if new.origem <> 'viagens' and v_modo is not null then
      if v_modo = 'desligada' then
        raise exception 'A produção desta obra vem do SIGA. O lançamento pelo InfraWork ainda não está ligado para ela';
      end if;
      perform public.siga_exige_usuario(new.obra_id);
      perform public.siga_exige_de_para(new.obra_id, new.item_orcamentario_id, new.equipe_id, new.encarregado_id, new.trecho_id);
    end if;
    return new;
  end if;

  if new.origem = 'siga' and old.origem <> 'siga' then
    raise exception 'Lançamento do SIGA só entra pela sincronização';
  end if;
  v_mudou := new.origem is distinct from old.origem
    or new.externo_id is distinct from old.externo_id
    or new.quantidade is distinct from old.quantidade
    or new.data is distinct from old.data
    or new.unidade is distinct from old.unidade
    or new.fator_conversao is distinct from old.fator_conversao
    or new.obs is distinct from old.obs
    or new.posicao_inicio_m is distinct from old.posicao_inicio_m
    or new.posicao_fim_m is distinct from old.posicao_fim_m
    or new.estaca_inicial is distinct from old.estaca_inicial
    or new.estaca_final is distinct from old.estaca_final
    or (new.item_orcamentario_id is not null and new.item_orcamentario_id is distinct from old.item_orcamentario_id)
    or (new.equipe_id is not null and new.equipe_id is distinct from old.equipe_id)
    or (new.encarregado_id is not null and new.encarregado_id is distinct from old.encarregado_id)
    or (new.trecho_id is not null and new.trecho_id is distinct from old.trecho_id);
  if not v_mudou or old.origem = 'viagens' then return new; end if;

  if old.origem = 'siga' then
    if coalesce(v_modo, 'desligada') <> 'ligada' or new.origem is distinct from old.origem
       or new.externo_id is distinct from old.externo_id then
      raise exception 'Este lançamento vem do SIGA: a alteração é feita lá';
    end if;
  elsif v_modo is null or v_modo = 'desligada' then
    return new;
  end if;
  perform public.siga_exige_usuario(new.obra_id);
  perform public.siga_exige_de_para(new.obra_id, new.item_orcamentario_id, new.equipe_id, new.encarregado_id, new.trecho_id);
  return new;
end $$;

-- ── 3. Enfileirar ────────────────────────────────────────────────────────────────────────────────────────────
-- Um envio pendente por lançamento basta: o conector lê o lançamento como está na hora de enviar.
create function public.siga_enfileirar(_producao_id uuid) returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  p public.acompanhamento_producao%rowtype;
  v record;
  v_rotulo text;
begin
  select * into p from acompanhamento_producao where id = _producao_id;
  if not found or p.origem = 'viagens' then return; end if;
  select integracao_id, gravacao into v from integracao_obra where obra_id = p.obra_id;
  if not found or v.gravacao = 'desligada' then return; end if;
  v_rotulo := to_char(p.data, 'DD/MM/YYYY') || ' · ' || p.servico_nome || ' · '
              || rtrim(translate(to_char(p.quantidade, 'FM999G999G990D9999'), ',.', '.,'), ',') || coalesce(' ' || p.unidade, '');

  update integracao_saida
     set usuario_id = coalesce(auth.uid(), usuario_id), rotulo = v_rotulo, erro = null, estado = 'pendente',
         tentativas = 0, simulacao = (v.gravacao = 'simulacao'), externo_id = p.externo_id
   where registro_id = p.id and operacao = 'gravar' and estado in ('pendente', 'erro');
  if not found then
    insert into integracao_saida (obra_id, integracao_id, registro_id, operacao, externo_id, usuario_id, simulacao, rotulo)
    values (p.obra_id, v.integracao_id, p.id, 'gravar', p.externo_id, auth.uid(), v.gravacao = 'simulacao', v_rotulo);
  end if;
end
$$;
revoke execute on function public.siga_enfileirar(uuid) from public, anon, authenticated;

create function public.fn_acomp_prod_saida() returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v record;
begin
  if coalesce(current_setting('infrawork.siga_sync', true), '') = '1'
     or coalesce(current_setting('infrawork.excluindo_obra', true), '') = '1' then
    return null;
  end if;

  if tg_op = 'DELETE' then
    if old.origem = 'viagens' then return null; end if;
    select integracao_id, gravacao into v from integracao_obra where obra_id = old.obra_id;
    if not found or v.gravacao = 'desligada' then return null; end if;
    update integracao_saida set estado = 'descartado', processado_em = now()
     where registro_id = old.id and estado in ('pendente', 'erro');
    -- só há o que excluir lá se o lançamento chegou ao SIGA
    if old.externo_id is not null
       or exists (select 1 from integracao_saida where registro_id = old.id and estado = 'enviado') then
      insert into integracao_saida (obra_id, integracao_id, registro_id, operacao, externo_id, usuario_id, simulacao, rotulo)
      values (old.obra_id, v.integracao_id, old.id, 'excluir', old.externo_id, auth.uid(), v.gravacao = 'simulacao',
              to_char(old.data, 'DD/MM/YYYY') || ' · ' || old.servico_nome || ' · '
              || rtrim(translate(to_char(old.quantidade, 'FM999G999G990D9999'), ',.', '.,'), ',') || coalesce(' ' || old.unidade, ''));
    end if;
    return null;
  end if;

  if tg_op = 'UPDATE' and not (
       new.quantidade is distinct from old.quantidade
    or new.data is distinct from old.data
    or new.fator_conversao is distinct from old.fator_conversao
    or new.obs is distinct from old.obs
    or new.posicao_inicio_m is distinct from old.posicao_inicio_m
    or new.posicao_fim_m is distinct from old.posicao_fim_m
    or new.estaca_inicial is distinct from old.estaca_inicial
    or new.estaca_final is distinct from old.estaca_final
    or (new.item_orcamentario_id is not null and new.item_orcamentario_id is distinct from old.item_orcamentario_id)
    or (new.equipe_id is not null and new.equipe_id is distinct from old.equipe_id)
    or (new.encarregado_id is not null and new.encarregado_id is distinct from old.encarregado_id)
    or (new.trecho_id is not null and new.trecho_id is distinct from old.trecho_id)) then
    return null;
  end if;
  perform public.siga_enfileirar(new.id);
  return null;
end
$$;
revoke execute on function public.fn_acomp_prod_saida() from public, anon, authenticated;
create trigger trg_acomp_prod_saida after insert or update or delete on public.acompanhamento_producao
  for each row execute function public.fn_acomp_prod_saida();

-- o material aplicado vai na mesma linha do SIGA: mudar o material reenvia o lançamento
create function public.fn_acomp_prod_material_saida() returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
begin
  if coalesce(current_setting('infrawork.siga_sync', true), '') = '1'
     or coalesce(current_setting('infrawork.excluindo_obra', true), '') = '1' then
    return null;
  end if;
  perform public.siga_enfileirar(case when tg_op = 'DELETE' then old.producao_id else new.producao_id end);
  return null;
end
$$;
revoke execute on function public.fn_acomp_prod_material_saida() from public, anon, authenticated;
create trigger trg_acomp_prod_material_saida after insert or update or delete on public.acompanhamento_producao_material
  for each row execute function public.fn_acomp_prod_material_saida();

-- Avisa o conector assim que algo entra na fila (uma vez por transação). Sem os segredos do ambiente (stack
-- local), não avisa: o envio acontece na rodada automática ou quando a tela pede.
create function public.fn_integracao_saida_avisa() returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_url text;
  v_chave text;
begin
  if coalesce(current_setting('infrawork.saida_avisada', true), '') = '1' then return null; end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_chave from vault.decrypted_secrets where name = 'service_role_key';
  if v_url is null or v_chave is null then return null; end if;
  perform net.http_post(
    url := v_url || '/functions/v1/siga',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_chave, 'Content-Type', 'application/json'),
    body := '{"acao":"enviar","origem":"fila"}'::jsonb,
    timeout_milliseconds := 60000);
  perform set_config('infrawork.saida_avisada', '1', true);
  return null;
exception when others then
  return null;
end
$$;
revoke execute on function public.fn_integracao_saida_avisa() from public, anon, authenticated;
create trigger trg_integracao_saida_avisa after insert on public.integracao_saida
  for each statement execute function public.fn_integracao_saida_avisa();

create function public.fn_integracao_obra_saida() returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
begin
  update integracao_saida set estado = 'descartado', processado_em = now()
   where obra_id = old.obra_id and estado in ('pendente', 'erro');
  return old;
end
$$;
revoke execute on function public.fn_integracao_obra_saida() from public, anon, authenticated;
create trigger trg_integracao_obra_saida after delete on public.integracao_obra
  for each row execute function public.fn_integracao_obra_saida();

-- ── 4. O que o conector lê e grava ───────────────────────────────────────────────────────────────────────────
-- O próximo lote da fila, com tudo que o conector precisa para montar a linha do SIGA. Erro é tentado de novo
-- até 5 vezes; depois disso só com "tentar de novo" na tela. Quando vários cadastros do SIGA apontam para o mesmo
-- registro daqui, vale o que o lançamento já tem lá (guardado em `externo`); senão, o marcado como principal.
create function public.siga_saida_lote(
  _integracao_id uuid default null, _obra_id uuid default null, _limite integer default 50
) returns jsonb
language sql stable security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(x.item order by x.id), '[]'::jsonb)
  from (
    select s.id, jsonb_build_object(
      'id', s.id, 'obra_id', s.obra_id, 'integracao_id', s.integracao_id, 'empresa_id', i.empresa_id,
      'projeto_id', io.externo_projeto_id, 'operacao', s.operacao,
      'simulacao', s.simulacao or io.gravacao = 'simulacao',
      'registro_id', s.registro_id, 'externo_id', coalesce(p.externo_id, s.externo_id),
      -- lançamento que nasceu no SIGA é alterado pelo número de lá; o que nasceu aqui, pelo nosso id (app_uuid)
      'nasceu_no_siga', coalesce(p.origem = 'siga', false),
      'usuario', (select jsonb_build_object('externo_id', iu.externo_id, 'nome', iu.externo_nome, 'ativo', iu.ativo)
                    from integracao_usuario iu
                   where iu.user_id = s.usuario_id and iu.integracao_id = s.integracao_id),
      'producao', case when p.id is not null then jsonb_build_object(
        'data', p.data, 'quantidade', p.quantidade, 'fator_conversao', p.fator_conversao, 'obs', p.obs,
        'estaca_inicial', p.estaca_inicial, 'estaca_final', p.estaca_final, 'externo_estaca', p.externo->>'estaca',
        'posicao_inicio_m', p.posicao_inicio_m, 'posicao_fim_m', p.posicao_fim_m,
        'chuva', coalesce((p.externo->>'chuva')::boolean, false)) end,
      'servico', (select jsonb_build_object('externo_id', d.externo_id, 'fator', d.fator_conversao)
                    from integracao_de_para d
                   where d.obra_id = s.obra_id and d.tipo = 'servico' and d.interno_id = p.item_orcamentario_id
                     and not d.ignorado
                   order by (d.externo_id = nullif(p.externo->>'servico_id', '')::bigint) desc nulls last,
                            d.principal desc, d.externo_id limit 1),
      'equipe', (select jsonb_build_object('externo_id', d.externo_id, 'nome', d.externo_nome)
                   from integracao_de_para d
                  where d.obra_id = s.obra_id and d.tipo = 'equipe' and d.interno_id = p.equipe_id
                  order by (d.externo_id = nullif(p.externo->>'equipe_id', '')::bigint) desc nulls last,
                           d.principal desc, d.externo_id limit 1),
      'encarregado', (select jsonb_build_object('externo_id', d.externo_id, 'nome', d.externo_nome)
                        from integracao_de_para d
                       where d.obra_id = s.obra_id and d.tipo = 'encarregado' and d.interno_id = p.encarregado_id
                       order by (d.externo_id = nullif(p.externo->>'encarregado_id', '')::bigint) desc nulls last,
                                d.principal desc, d.externo_id limit 1),
      'local', (select jsonb_build_object(
                         'externo_id', d.externo_id, 'nome', d.externo_nome,
                         'eixo', case when t.tipo = 'eixo' then jsonb_build_object(
                                   'unidade', t.unidade_espaco_padrao,
                                   'marcador_inicial', coalesce(t.marcador_valor_inicial, 0),
                                   'sentido', case when t.geometry_sentido = 'invertido' then 'invertido' else 'natural' end) end)
                  from integracao_de_para d
                  join obra_trecho t on t.id = d.interno_id
                 where d.obra_id = s.obra_id and d.tipo = 'local' and d.interno_id = p.trecho_id
                 order by (d.externo_id = nullif(p.externo->>'trecho_id', '')::bigint) desc nulls last,
                          d.principal desc, d.externo_id limit 1),
      'material', (select jsonb_build_object('nome', m.nome, 'quantidade', m.quantidade, 'unidade', m.unidade)
                     from acompanhamento_producao_material m
                    where m.producao_id = p.id and coalesce(m.quantidade, 0) > 0
                    order by m.id limit 1)
    ) as item
    from integracao_saida s
    join integracao_obra io on io.obra_id = s.obra_id and io.gravacao <> 'desligada'
    join integracao i on i.id = s.integracao_id and i.ativa
    left join acompanhamento_producao p on p.id = s.registro_id
    where (s.estado = 'pendente' or (s.estado = 'erro' and s.tentativas < 5))
      and (_integracao_id is null or s.integracao_id = _integracao_id)
      and (_obra_id is null or s.obra_id = _obra_id)
    order by s.id
    limit greatest(1, least(coalesce(_limite, 50), 200))
  ) x
$$;
revoke execute on function public.siga_saida_lote(uuid, uuid, integer) from public, anon, authenticated;

-- O resultado de um envio. Gravado com sucesso, o lançamento daqui passa a conhecer o número dele no SIGA.
create function public.siga_saida_concluir(
  _id bigint, _estado text, _externo_id bigint default null, _enviado jsonb default null, _erro text default null
) returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  s record;
begin
  if _estado not in ('enviado', 'simulado', 'erro', 'descartado') then
    raise exception 'estado inválido: %', _estado;
  end if;
  update integracao_saida
     set estado = _estado, enviado = coalesce(_enviado, enviado), erro = _erro,
         externo_id = coalesce(_externo_id, externo_id),
         tentativas = tentativas + case when _estado = 'erro' then 1 else 0 end,
         processado_em = now()
   where id = _id and estado in ('pendente', 'erro')
   returning registro_id, operacao into s;
  if not found then return; end if;
  if _estado = 'enviado' and s.operacao = 'gravar' and _externo_id is not null then
    -- sem a assinatura, a próxima leitura traz a linha como ficou no SIGA
    perform set_config('infrawork.siga_sync', '1', true);
    update acompanhamento_producao set externo_id = _externo_id, externo = externo - 'assinatura'
     where id = s.registro_id;
    perform set_config('infrawork.siga_sync', '', true);
  end if;
end
$$;
revoke execute on function public.siga_saida_concluir(bigint, text, bigint, jsonb, text) from public, anon, authenticated;

-- ── 5. O que o usuário faz ───────────────────────────────────────────────────────────────────────────────────
-- Liga, simula ou desliga a gravação da obra no SIGA: god e administrador da empresa.
create function public.siga_gravacao_definir(_obra_id uuid, _modo text) returns void
language plpgsql security definer
set search_path to 'public'
as $$
begin
  if not (public.auth_role() in ('god'::public.role_enum, 'adm'::public.role_enum) and public.pode_planejar_obra(_obra_id)) then
    raise exception 'Só o administrador da empresa liga ou desliga a gravação no SIGA' using errcode = '42501';
  end if;
  if _modo not in ('desligada', 'simulacao', 'ligada') then
    raise exception 'Modo de gravação inválido: %', _modo;
  end if;
  update integracao_obra set gravacao = _modo, updated_at = now() where obra_id = _obra_id;
  if not found then raise exception 'Esta obra não está ligada a um projeto do SIGA'; end if;
end
$$;

-- Envio que falhou volta para a fila (o da linha informada, ou todos os da obra).
create function public.siga_saida_reenviar(_obra_id uuid, _id bigint default null) returns integer
language plpgsql security definer
set search_path to 'public'
as $$
declare
  n integer;
begin
  if not public.pode_lancar_producao(_obra_id) then
    raise exception 'Sem permissão para lançar nesta obra' using errcode = '42501';
  end if;
  update integracao_saida set estado = 'pendente', tentativas = 0, erro = null
   where obra_id = _obra_id and estado = 'erro' and (_id is null or id = _id);
  get diagnostics n = row_count;
  return n;
end
$$;

-- Desiste de um envio que falhou. O SIGA é a verdade: o lançamento que nunca chegou lá é excluído daqui, e o
-- que já existe lá volta, na próxima leitura, a ser o que está lá.
create function public.siga_saida_descartar(_obra_id uuid, _id bigint) returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_registro uuid;
  p record;
begin
  if not public.pode_planejar_obra(_obra_id) then
    raise exception 'Sem permissão para descartar envios desta obra' using errcode = '42501';
  end if;
  select registro_id into v_registro from integracao_saida
   where id = _id and obra_id = _obra_id and estado in ('pendente', 'erro');
  if v_registro is null then raise exception 'Envio não encontrado ou já processado'; end if;
  update integracao_saida set estado = 'descartado', processado_em = now()
   where registro_id = v_registro and estado in ('pendente', 'erro');
  select id, origem, externo_id into p from acompanhamento_producao where id = v_registro;
  if not found then return; end if;
  perform set_config('infrawork.siga_sync', '1', true);
  if p.origem <> 'siga' and p.externo_id is null then
    delete from acompanhamento_producao where id = v_registro;
  else
    update acompanhamento_producao set externo = externo - 'assinatura' where id = v_registro;
  end if;
  perform set_config('infrawork.siga_sync', '', true);
end
$$;

-- ── 6. App de campo ──────────────────────────────────────────────────────────────────────────────────────────
-- Em obra do SIGA o catálogo diz como está a gravação e traz só os serviços de produção que têm de-para (com a
-- gravação desligada, nenhum: a produção é lançada no SIGA). Equipes, encarregados e locais vêm todos, porque
-- as fichas de viagens os usam, e cada um diz se tem de-para (`externa`): é o que a produção pode usar.
create or replace function public.campo_catalogo(_obra_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v jsonb;
  v_modo text;
begin
  perform public.campo_assert(_obra_id);
  select gravacao into v_modo from public.integracao_obra where obra_id = _obra_id;
  select jsonb_build_object(
    'obra', (select jsonb_build_object('id', o.id, 'codigo', o.codigo, 'nome', o.nome, 'empresa_id', o.empresa_id,
                                      'aponta_encarregado', o.aponta_encarregado,
                                      'producao_externa', case when v_modo is not null then 'siga' end,
                                      'gravacao_externa', v_modo)
               from public.obras o where o.id = _obra_id),
    'servicos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'codigo', i.codigo, 'descricao', i.descricao,
               'unidade', coalesce(s.unidade, i.unidade_referencia),
               'modo_lancamento', coalesce(p.modo_lancamento, 'quantidade'),
               'controla_material', coalesce(p.controla_material, false),
               'material', case when p.controla_material then jsonb_build_object(
                             'id', r.id, 'nome', r.nome, 'unidade', coalesce(p.material_unidade, r.unidade)) end,
               'material_obrigatorio', coalesce(p.material_obrigatorio, true),
               'habilita_obs', coalesce(p.habilita_obs, true),
               'exige_local', coalesce(p.exige_local, false),
               'medicao_viagem', coalesce(p.medicao_viagem, 'volume'))
             order by i.ordem, i.codigo)
        from public.item_orcamentario i
        join public.servico s on s.id = i.servico_id
        left join public.servico_parametro p on p.item_orcamentario_id = i.id
        left join public.recurso r on r.id = p.material_recurso_id
       where i.obra_id = _obra_id and i.tipo = 'servico_grupo' and i.indireto_id is null
         and (v_modo is null
              or coalesce(p.modo_lancamento, 'quantidade') = 'viagens'
              or (v_modo <> 'desligada' and exists (
                    select 1 from public.integracao_de_para d
                     where d.obra_id = _obra_id and d.tipo = 'servico' and d.interno_id = i.id and not d.ignorado)))),
      '[]'::jsonb),
    'equipes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'nome', e.nome, 'encarregado_id', e.encarregado_id,
               'externa', v_modo is not null and exists (
                    select 1 from public.integracao_de_para d
                     where d.obra_id = _obra_id and d.tipo = 'equipe' and d.interno_id = e.id))
             order by e.ordem, e.nome)
        from public.equipe e
       where e.obra_id = _obra_id and e.ativo and not coalesce(e.is_sistema, false)), '[]'::jsonb),
    'encarregados', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', en.id, 'nome', en.nome, 'apelido', en.apelido,
               'externa', v_modo is not null and exists (
                    select 1 from public.integracao_de_para d
                     where d.obra_id = _obra_id and d.tipo = 'encarregado' and d.interno_id = en.id))
             order by en.nome)
        from public.encarregado en
       where en.obra_id = _obra_id and en.ativo), '[]'::jsonb),
    'locais', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'nome', t.nome, 'tipo', t.tipo, 'ordem', t.ordem,
               'comprimento_m', t.comprimento_m, 'geometry_comprimento_m', t.geometry_comprimento_m,
               'unidade_espaco_padrao', t.unidade_espaco_padrao, 'unidade_custom_label', t.unidade_custom_label,
               'unidade_custom_divisor_m', t.unidade_custom_divisor_m,
               'marcador_valor_inicial', t.marcador_valor_inicial, 'geometry_sentido', t.geometry_sentido,
               'externa', v_modo is not null and exists (
                    select 1 from public.integracao_de_para d
                     where d.obra_id = _obra_id and d.tipo = 'local' and d.interno_id = t.id))
             order by t.tipo, t.ordem, t.nome)
        from public.obra_trecho t where t.obra_id = _obra_id), '[]'::jsonb),
    'veiculos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', v.id, 'prefixo', v.prefixo, 'placa', v.placa, 'tipo', v.tipo, 'modelo', v.modelo,
               'proprietario', v.proprietario, 'capacidade_m3', v.capacidade_m3, 'capacidade_t', v.capacidade_t)
             order by v.prefixo)
        from public.veiculos_da_obra(_obra_id) v), '[]'::jsonb),
    'origens_destinos', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'nome', l.nome, 'tipo', l.tipo, 'trecho_id', l.trecho_id,
                                       'estaca_acesso_m', l.estaca_acesso_m, 'distancia_acesso_km', l.distancia_acesso_km)
             order by l.nome)
        from public.transporte_local l where l.obra_id = _obra_id and l.ativo), '[]'::jsonb),
    'rotas', coalesce((
      select jsonb_agg(jsonb_build_object('origem_id', r.origem_id, 'destino_id', r.destino_id, 'dmt_km', r.dmt_km))
        from public.transporte_rota r where r.obra_id = _obra_id), '[]'::jsonb)
  ) into v;
  return v || jsonb_build_object('versao', md5(v::text));
end $$;

-- ── 7. A leitura reconhece o que saiu daqui ──────────────────────────────────────────────────────────────────
-- O lançamento gravado no SIGA volta na leitura com o nosso id no app_uuid e é a mesma linha. A única mudança
-- nesta função: quando a estaca não volta legível (eixo em metros, texto livre), a posição lançada aqui fica; e
-- o lançamento com envio pendente não é sobrescrito pela leitura (senão a alteração feita aqui se perderia).
create or replace function public.siga_aplicar_producao(_obra_id uuid, _linhas jsonb, _vivos bigint[] default null)
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

      -- alteração feita aqui que ainda não chegou ao SIGA: a leitura não passa por cima dela
      if v_atual.id is not null and exists (select 1 from public.integracao_saida s
                                             where s.registro_id = v_atual.id and s.estado in ('pendente', 'erro')) then
        v_iguais := v_iguais + 1;
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
               trecho_id = v_trecho,
               -- lançamento que saiu daqui: se a estaca não voltou legível, fica a posição que foi lançada
               posicao_inicio_m = case when v_ini is null and origem <> 'siga' and trecho_id is not distinct from v_trecho
                                       then posicao_inicio_m else v_ini end,
               posicao_fim_m = case when v_ini is null and origem <> 'siga' and trecho_id is not distinct from v_trecho
                                    then posicao_fim_m else v_fim end,
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
