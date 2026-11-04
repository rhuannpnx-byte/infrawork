-- InfraWork Web — controle por estaca: a produção enriquecida expõe o local do lançamento (0031 §7 criou as colunas
-- trecho_id / posicao_inicio_m / posicao_fim_m em acompanhamento_producao). Colunas novas no fim da view (create or
-- replace só acrescenta no fim).
create or replace view public.vw_acompanhamento_producao_enriquecida with (security_invoker = true) as
SELECT p.id,
    p.obra_id,
    p.data,
    p.item_orcamentario_id,
    p.servico_id,
    p.servico_id AS servico_planejamento_id,
    p.servico_nome,
    p.quantidade AS qtd,
    (p.quantidade * p.fator_conversao)::numeric(14,4) AS qtd_convertida,
    p.fator_conversao,
    p.unidade,
    COALESCE(s.unidade, io.unidade_referencia, p.unidade) AS unidade_plano,
    COALESCE(NULLIF(TRIM(BOTH FROM p.frente), ''::text), '(sem frente)'::text) AS frente,
    p.frente AS frente_raw,
    p.estaca_inicial,
    p.estaca_final,
    p.obs,
    p.origem,
    p.importacao_id,
    p.criado_por,
    pr.nome AS criado_por_nome,
    p.created_at,
    p.updated_at,
    p.equipe_id,
    p.equipe_id AS equipe_planejamento_id,
    COALESCE(e.nome, '—'::text) AS equipe_display_nome,
    COALESCE(e.cor, '#94a3b8'::text) AS equipe_display_cor,
    e.tipo AS equipe_tipo,
    p.encarregado_id,
    COALESCE(en.apelido, en.nome) AS encarregado_display_nome,
    s.codigo AS servico_codigo,
    COALESCE(s.nome, p.servico_nome) AS servico_display_nome,
    s.unidade AS servico_unidade,
    io.codigo AS servico_grupo_codigo,
    io.descricao AS servico_grupo_descricao,
    pta.tarefa_id AS tarefa_baseline_id,
    pta.data_inicio AS tarefa_data_inicio,
    pta.data_fim AS tarefa_data_fim,
    ( SELECT count(*) AS count
           FROM acompanhamento_foto f
          WHERE f.producao_id = p.id AND f.excluida_em IS NULL) AS fotos_count,
    p.trecho_id,
    p.posicao_inicio_m,
    p.posicao_fim_m,
    tr.nome AS trecho_nome,
    tr.tipo AS trecho_tipo
   FROM acompanhamento_producao p
     LEFT JOIN equipe e ON e.id = p.equipe_id
     LEFT JOIN encarregado en ON en.id = p.encarregado_id
     LEFT JOIN item_orcamentario io ON io.id = p.item_orcamentario_id
     LEFT JOIN servico s ON s.id = p.servico_id
     LEFT JOIN profiles pr ON pr.id = p.criado_por
     LEFT JOIN obra_trecho tr ON tr.id = p.trecho_id
     LEFT JOIN planejamento pl ON pl.obra_id = p.obra_id AND pl.id = planejamento_referencia(p.obra_id)
     LEFT JOIN ( SELECT pt.planejamento_id,
            pt.item_orcamentario_id,
            min(pt.data_inicio) AS data_inicio,
            max(pt.data_fim) AS data_fim,
            (array_agg(pt.id ORDER BY pt.data_inicio))[1] AS tarefa_id
           FROM planejamento_tarefa pt
          WHERE pt.item_orcamentario_id IS NOT NULL
          GROUP BY pt.planejamento_id, pt.item_orcamentario_id) pta ON pta.planejamento_id = pl.id AND pta.item_orcamentario_id = p.item_orcamentario_id;

grant select on public.vw_acompanhamento_producao_enriquecida to authenticated;

notify pgrst, 'reload schema';
