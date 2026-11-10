/**
 * Manifesto de cobertura do MCP. Junto com o `cobre` de cada ferramenta, diz como o MCP trata cada objeto do banco:
 *  - tabela: escrita por alguma ferramenta (cobre.tabelas) ou ignorada com motivo;
 *  - tabela/view: legível pela ferramenta `consultar` (LEGIVEIS) ou fora dela com motivo (NAO_LEGIVEIS);
 *  - RPC (função que não é de gatilho) e Edge Function: chamada por alguma ferramenta ou ignorada com motivo.
 *
 * O teste cobertura.test.ts lê as migrações e as Edge Functions e falha se algo novo não estiver aqui ou numa
 * ferramenta. Ao mudar o sistema: crie/ajuste a ferramenta (cobre) ou registre o motivo de ignorar.
 */

export const LEGIVEIS: string[] = [
  'acompanhamento_alerta',
  'acompanhamento_foto',
  'acompanhamento_producao',
  'acompanhamento_producao_material',
  'anexo',
  'calendario',
  'calendario_definicao',
  'comentario_item',
  'cpu',
  'cpu_item',
  'empresas',
  'encargos_sociais_regime',
  'encarregado',
  'equipe',
  'equipe_produtividade',
  'fleet_obra',
  'fleet_sync_execucao',
  'frota_veiculo',
  'indireto_item',
  'item_orc_alocacao',
  'item_orcamentario',
  'memoria_calculo_item',
  'obra_fleet_obra',
  'obra_permissoes',
  'obra_produtividade_mes',
  'obra_trecho',
  'obras',
  'orcamento_aditivo',
  'orcamento_aditivo_item',
  'orcamento_planilha_inicial',
  'orcamento_reajuste',
  'orcamento_reajuste_grupo',
  'orcamento_reajuste_item',
  'planejamento',
  'planejamento_dependencia',
  'planejamento_lb_premissa',
  'planejamento_marco',
  'planejamento_recurso_limite',
  'planejamento_tarefa',
  'planejamento_tarefa_equipe',
  'planejamento_tarefa_indireto',
  'planejamento_tarefa_local',
  'planejamento_tarefa_perfil_dia',
  'planejamento_tarefa_perfil_semana',
  'planejamento_tarefa_wp',
  'profiles',
  'recurso',
  'recurso_preco',
  'servico',
  'servico_cpu_link',
  'servico_dependencia',
  'servico_parametro',
  'transporte_local',
  'transporte_rota',
  'trecho_quantidade_celula',
  'trecho_quantidade_coluna',
  'trecho_quantidade_mapeamento',
  'trecho_quantidade_segmento',
  'trecho_quantidade_template',
  'trecho_quantidade_versao',
  'viagem',
  'viagem_ficha',
  'vw_acompanhamento_curva_s',
  'vw_acompanhamento_foto_enriquecida',
  'vw_acompanhamento_frente_kpis',
  'vw_acompanhamento_heatmap_dia_servico',
  'vw_acompanhamento_obra_resumo',
  'vw_acompanhamento_previsto_x_realizado',
  'vw_acompanhamento_producao_enriquecida',
  'vw_acompanhamento_produtividade_equipe',
  'vw_orcamento_consolidado',
  'vw_planejamento_tarefa_completa',
  'vw_recurso_com_preco',
  'vw_servico_consumo_material',
  'vw_servico_custo_agregado',
  'vw_servico_vivo'
]

/** Tabelas/views fora da `consultar`, com o motivo. */
export const NAO_LEGIVEIS: Record<string, string> = {
  fleethub_config: 'credencial da FleetHub (só o status de conexão aparece pela ferramenta frota)',
  mcp_token: 'hash dos tokens pessoais (gerenciados no web)',
  orcamento_recalculo_pendente: 'fila interna de recálculo (sem acesso do usuário)',
  mcp_oauth_cliente: 'clientes OAuth do próprio MCP (infraestrutura de login)',
  mcp_oauth_codigo: 'códigos de autorização OAuth (infraestrutura de login)',
  cpu_snapshot:
    'legado: imutável, o web não usa mais (as LBs congelam em planejamento_lb_premissa)',
  planejamento_baseline_snapshot: 'legado, sem uso no web',
  obra_calendario: 'legado (substituído por calendario/calendario_definicao)',
  obra_calendario_excecao: 'legado (substituído por calendario_definicao)'
}

/** Tabelas que nenhuma ferramenta grava, com o motivo. */
export const TABELAS_IGNORADAS: Record<string, string> = {
  cpu_snapshot: 'legado imutável (as LBs congelam em planejamento_lb_premissa)',
  planejamento_baseline_snapshot: 'legado, sem uso',
  obra_calendario: 'legado (calendario)',
  obra_calendario_excecao: 'legado (calendario_definicao)',
  equipe_produtividade: 'o web não grava (só leitura pela consultar)',
  fleethub_config: 'credencial da FleetHub: só pela tela do web (nunca passa pela IA)',
  mcp_token: 'tokens pessoais: criados e revogados só na tela do web',
  orcamento_recalculo_pendente: 'fila interna do banco (processada por recalcular_orcamento)',
  mcp_oauth_cliente: 'registro dinâmico de clientes OAuth (servidor do MCP, /oauth/registrar)',
  mcp_oauth_codigo: 'códigos OAuth (tela de consentimento do web e /oauth/token)'
}

/** RPCs que as ferramentas acionam por outro caminho (Edge Function ou módulo do web), com o caminho. */
export const RPCS_INDIRETAS: Record<string, string> = {
  importar_orcamento: 'Edge Function import-orcamento (orcamento_importar)',
  excluir_obra: 'Edge Function delete-obra (obras.excluir)',
  planejamento_gravar_calculo: 'mcp/lib/motor.ts (recalcularPlano)',
  obra_equipes_vivas: 'carregarPlanoEntrada do web, dentro do motor',
  acompanhamento_alertas_sincronizar:
    'Edge Function acompanhamento-alertas-recalcular (alertas.recalcular)'
}

const RLS = 'auxiliar de RLS/permissão usada pelas políticas do banco'
const INTERNA = 'função interna do banco (chamada por gatilhos/outras funções)'
const CAMPO = 'API do app de campo; o MCP grava as mesmas tabelas pelas ferramentas próprias'

/** RPCs que nenhuma ferramenta chama, com o motivo. */
export const RPCS_IGNORADAS: Record<string, string> = {
  auth_role: RLS,
  auth_empresa_id: RLS,
  auth_engenheiro_id: RLS,
  obra_empresa: RLS,
  has_obra_permissao: RLS,
  pode_editar_orcamento: RLS,
  pode_planejar_obra: RLS,
  pode_lancar_producao: RLS,
  pode_ver_acompanhamento: RLS,
  pode_ver_obra: RLS,
  item_orc_obra: RLS,
  cpu_snap_obra: RLS,
  indireto_obra: RLS,
  comentario_obra: RLS,
  memoria_obra: RLS,
  recurso_obra: RLS,
  servico_obra: RLS,
  cpu_obra: RLS,
  encargos_obra: RLS,
  equipe_obra: RLS,
  planejamento_obra: RLS,
  tarefa_obra: RLS,
  dependencia_obra: RLS,
  acomp_alerta_obra: RLS,
  servico_cpu_link_obra: RLS,
  acomp_producao_obra: RLS,
  acomp_foto_obra: RLS,
  encarregado_obra: RLS,
  calendario_obra: RLS,
  preco_vigente_recurso: INTERNA,
  fn_cpu_recalc: INTERNA,
  snapshot_orcamento_atual: INTERNA,
  cronograma_validar_ciclo: INTERNA,
  norm_txt: INTERNA,
  imp_grupo_recurso: INTERNA,
  imp_definir_preco_vigente: INTERNA,
  get_or_create_indireto_resources: INTERNA,
  fn_item_orc_aloc_recalcular: INTERNA,
  fn_item_orc_aloc_sync_modo: INTERNA,
  servico_custo_unit: INTERNA,
  fn_orc_marcar_recalculo: INTERNA,
  calendario_fingerprint: INTERNA,
  lb_capturar_premissas: 'chamada por planejamento_promover',
  obra_tem_aditivo: INTERNA,
  trecho_versao_atual: INTERNA,
  fn_trecho_assert_editavel: INTERNA,
  fn_semana_valida: INTERNA,
  fn_semana_tem_trabalho: INTERNA,
  servico_equipe_viva: 'usada pelas views e pela carga do motor',
  servico_dependencias_fingerprint: INTERNA,
  planejamento_tarefa_valores_vivos: 'usada pela view vw_planejamento_tarefa_completa',
  excluindo_obra: INTERNA,
  fn_locais_validar: INTERNA,
  fn_plano_assert_editavel: INTERNA,
  fn_tarefa_assert_editavel: INTERNA,
  fn_tarefa_trecho_principal: INTERNA,
  fn_tarefa_prefixo_nome: INTERNA,
  fn_tarefa_clonar: INTERNA,
  fn_valor_servico_em: INTERNA,
  fn_viagens_recompor: 'recompõe a produção das viagens (gatilho de viagem)',
  campo_painel_base: 'base de campo_painel',
  campo_assert: CAMPO,
  campo_assert_painel: CAMPO,
  campo_obras: CAMPO,
  campo_catalogo: CAMPO,
  campo_sync_producao: CAMPO,
  campo_registrar_foto: CAMPO,
  registrar_acesso: 'presença no web (contagem de acessos)',
  registrar_presenca: 'presença no web (último visto)',
  diagnostico_cron: 'diagnóstico de administração do banco',
  fleethub_gravar_credencial: 'credencial da FleetHub: só pela tela do web',
  fleethub_credencial: 'credencial da FleetHub: só a Edge Function lê',
  fleethub_remover_credencial: 'credencial da FleetHub: só pela tela do web',
  mcp_token_criar: 'tokens pessoais: só pela tela do web',
  mcp_token_revogar: 'tokens pessoais: só pela tela do web',
  mcp_oauth_cliente_info: 'login OAuth: tela de consentimento do web',
  mcp_oauth_autorizar: 'login OAuth: tela de consentimento do web'
}

/** Edge Functions que nenhuma ferramenta chama, com o motivo. */
export const FUNCOES_IGNORADAS: Record<string, string> = {
  me: 'perfil da sessão do web; o MCP usa quem_sou'
}
