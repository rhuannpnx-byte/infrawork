-- cronograma_validar_ciclo: detecção de ciclo eficiente (fecho transitivo).
--
-- A versão anterior usava uma CTE recursiva com UNION ALL que ENUMERAVA TODOS
-- OS CAMINHOS do grafo (guardava o array `caminho` inteiro e só parava ao
-- revisitar um nó). Em grafos densos isso é exponencial no nº de caminhos —
-- o cronograma da 6.493 (307 tarefas, 472 dependências) levava ~21 s e estourava
-- o statement_timeout, fazendo o calcular-cronograma retornar 400. Planos
-- pequenos (8 tarefas) nunca expunham o problema.
--
-- Nova abordagem: fecho transitivo com UNION (semântica de conjunto → dedupe →
-- terminação garantida, O(V·E)). Um nó alcançável a partir de si mesmo (a = b)
-- está em um ciclo. Mesma assinatura e mesmo formato de retorno
-- ({ tem_ciclo, nodes }); `nodes` passa a ser o conjunto de nós em ciclo (o
-- consumidor — calcular-cronograma — só usa isso para exibir no erro).

create or replace function public.cronograma_validar_ciclo(_planejamento_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  with recursive reach as (
    select predecessora_id as a, sucessora_id as b
      from public.planejamento_dependencia
     where planejamento_id = _planejamento_id
    union
    select r.a, d.sucessora_id
      from reach r
      join public.planejamento_dependencia d
        on d.predecessora_id = r.b
       and d.planejamento_id = _planejamento_id
  ),
  ciclos as (
    select distinct a as node from reach where a = b
  )
  select jsonb_build_object(
    'tem_ciclo', exists (select 1 from ciclos),
    'nodes', coalesce((select jsonb_agg(node) from ciclos), '[]'::jsonb)
  );
$function$;
