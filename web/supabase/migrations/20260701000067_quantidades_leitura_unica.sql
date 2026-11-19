-- Quantidades por local: ler numa chamada só.
--
-- O que estava errado (obra com um eixo de 2.742 faixas, 24 serviços e 41 mil valores):
--   * a tela lia as faixas direto da tabela. A API devolve no máximo 1.000 linhas por consulta e corta o resto sem
--     avisar: 1.742 faixas ficavam de fora, a soma por serviço saía menor que a gravada e a tela mostrava "saldo sem
--     local" que não existia. O cronograma lia do mesmo jeito e via zero nas tarefas além da milésima faixa;
--   * os valores vinham em páginas de 1.000, uma depois da outra (42 consultas), cada uma conferindo a permissão
--     linha a linha.
--
-- Agora:
--   * trecho_quantidades_atual(local): a versão atual inteira (colunas, faixas e valores) num JSON só. Um valor JSON
--     não passa pelo corte de linhas da API. Formato compacto: cada faixa é [início, fim, rótulo inicial, rótulo
--     final, {posição da coluna: valor}];
--   * trechos_quantidades_resumo(obra): por local, a versão, quantas faixas e serviços e o total de cada serviço. É o
--     que a página de Locais mostra, sem trazer valor nenhum.
--
-- A gravação (trecho_salvar_quantidades) fica como está: medida com esse volume, leva 0,8 s.

-- ── 1. Leitura completa de um local ─────────────────────────────────────────────────────────────────────────────
create function public.trecho_quantidades_atual(_trecho_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_obra uuid; v_ver uuid; r jsonb;
begin
  select obra_id into v_obra from public.obra_trecho where id = _trecho_id;
  if v_obra is null then return null; end if;
  if not public.chamada_autorizada(v_obra, 'ver') then
    raise exception 'Sem permissão para ver as quantidades deste local' using errcode = '42501';
  end if;
  v_ver := public.trecho_versao_atual(_trecho_id);
  if v_ver is null then return null; end if;

  with cols as (
    select c.id, c.item_orcamentario_id, c.ordem, i.codigo, i.descricao, i.unidade_referencia,
           (row_number() over (order by c.ordem, c.id) - 1)::int as k
      from public.trecho_quantidade_coluna c
      left join public.item_orcamentario i on i.id = c.item_orcamentario_id
     where c.versao_id = v_ver
  ), cel as (
    select ce.segmento_id, jsonb_object_agg(cols.k::text, trim_scale(ce.valor)) as v
      from cols
      join public.trecho_quantidade_celula ce on ce.coluna_id = cols.id
     group by ce.segmento_id
  )
  select jsonb_build_object(
           'versao', jsonb_build_object(
             'id', v.id, 'template_id', v.template_id, 'numero', v.numero, 'is_atual', v.is_atual,
             'comentario', v.comentario, 'criado_por', v.criado_por, 'created_at', v.created_at),
           'modo', t.modo,
           'colunas', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', c.id, 'item_orcamentario_id', c.item_orcamentario_id, 'ordem', c.ordem,
                      'codigo', c.codigo, 'descricao', c.descricao, 'unidade', c.unidade_referencia) order by c.k)
               from cols c), '[]'::jsonb),
           'segmentos', coalesce((
             select jsonb_agg(jsonb_build_array(
                      trim_scale(s.posicao_inicio_m), trim_scale(s.posicao_fim_m),
                      s.unidade_inicio_label, s.unidade_fim_label, coalesce(cel.v, '{}'::jsonb))
                      order by s.ordem, s.posicao_inicio_m, s.id)
               from public.trecho_quantidade_segmento s
               left join cel on cel.segmento_id = s.id
              where s.versao_id = v_ver), '[]'::jsonb))
    into r
    from public.trecho_quantidade_versao v
    join public.trecho_quantidade_template t on t.id = v.template_id
   where v.id = v_ver;
  return r;
end $function$;

revoke all on function public.trecho_quantidades_atual(uuid) from public, anon;
grant execute on function public.trecho_quantidades_atual(uuid) to authenticated, service_role;

-- ── 2. Resumo dos locais da obra (a página de Locais) ───────────────────────────────────────────────────────────
create function public.trechos_quantidades_resumo(_obra_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'trecho_id', t.id,
           'versao_id', v.id,
           'numero', v.numero,
           'faixas', (select count(*) from public.trecho_quantidade_segmento s where s.versao_id = v.id),
           'servicos', (select count(*) from public.trecho_quantidade_coluna c where c.versao_id = v.id),
           'totais', coalesce((
             select jsonb_object_agg(x.item, x.total)
               from (select c.item_orcamentario_id as item, trim_scale(sum(ce.valor)) as total
                       from public.trecho_quantidade_coluna c
                       join public.trecho_quantidade_celula ce on ce.coluna_id = c.id
                      where c.versao_id = v.id
                      group by c.item_orcamentario_id) x), '{}'::jsonb))), '[]'::jsonb)
    from public.obra_trecho t
    join public.trecho_quantidade_template q on q.trecho_id = t.id
    join public.trecho_quantidade_versao v on v.template_id = q.id and v.is_atual
   where t.obra_id = _obra_id and public.chamada_autorizada(_obra_id, 'ver')
$function$;

revoke all on function public.trechos_quantidades_resumo(uuid) from public, anon;
grant execute on function public.trechos_quantidades_resumo(uuid) to authenticated, service_role;
