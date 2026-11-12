-- 0056 — Prontidão da obra: o que falta para a obra ter previsto e realizado, etapa por etapa, com os itens pendentes.
-- Substitui os textos fixos de "como começar" (três, com ordens diferentes) e mostra o que hoje some sem aviso,
-- como o serviço sem composição que não aparece na lista de lançamento.

create function public.obra_prontidao(_obra_id uuid)
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

  -- 3. equipes
  select count(*), count(*) filter (where encarregado_id is null) into n, n2
    from equipe where obra_id = _obra_id and ativo and not is_sistema;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'descricao', nome) order by ordem, nome), '[]') into itens
    from equipe where obra_id = _obra_id and ativo and not is_sistema and encarregado_id is null;
  etapas := etapas || jsonb_build_object(
    'chave', 'equipes', 'titulo', 'Equipes e encarregados',
    'situacao', case when n = 0 then 'pendente' when n2 > 0 then 'aviso' else 'ok' end,
    'resumo', case when n = 0 then 'Cadastre as equipes da obra e o encarregado de cada uma.'
                   when n2 > 0 then n2 || ' de ' || n || ' equipes sem encarregado: o lançamento pede o encarregado à mão.'
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

  -- 10. produção
  select count(*), max(data) into n, v_ultima from acompanhamento_producao where obra_id = _obra_id;
  etapas := etapas || jsonb_build_object(
    'chave', 'producao', 'titulo', 'Produção lançada',
    'situacao', case when n > 0 then 'ok' else 'pendente' end,
    'resumo', case when n > 0 then 'Lançamentos: ' || n || '; o último em ' || to_char(v_ultima, 'DD/MM/YYYY') || '.'
                   else 'Nenhuma produção lançada ainda.' end,
    'rota', '/acompanhamento/lancar', 'itens', '[]'::jsonb);

  return jsonb_build_object(
    'etapas', etapas,
    'pendentes', (select count(*) from jsonb_array_elements(etapas) e where e->>'situacao' = 'pendente'),
    'avisos', (select count(*) from jsonb_array_elements(etapas) e where e->>'situacao' = 'aviso'));
end
$$;
