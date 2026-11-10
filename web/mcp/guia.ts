/** Guia do domínio para a IA (recurso infrawork://guia). Atualize junto com as ferramentas. */
export const GUIA = `# InfraWork — guia para a IA

O InfraWork planeja e acompanha obras rodoviárias (terraplenagem, pavimentação, drenagem). Você age como o usuário
conectado: o banco aplica as permissões dele (papel e obras liberadas). Mensagens de erro do banco explicam a regra
violada — repasse-as ao usuário em vez de tentar contornar.

## Ordem para montar uma obra do zero
1. **obras.criar** (nome, código). Cria o calendário padrão.
2. **trechos.criar**: eixos (estaqueamento; posições em metros internos a partir do início) e áreas. Ajuste o comprimento
   ou importe a geometria (KML/KMZ ou coordenadas).
3. **recursos**: insumos com preço (MO, MVE, COMBUSTIVEL, MATERIAL, ADM). Importe em lote quando possível.
4. **composicoes**: serviço de custo + CPU (insumos × horas/consumo) e a produção diária da equipe.
5. **orcamento_importar**: a planilha de venda (etapas e receitas) e o agrupamento das receitas em serviços
   (agrupadores) com rateio (percentual, peso ou venda). Peça o modelo (acao "modelo") se o usuário tiver planilha.
6. **agrupadores.editar** com servico_id: liga cada serviço à composição. Serviço sem composição não tem custo,
   não entra no cronograma e não recebe produção.
7. **calendarios**, **equipes** (equipes e encarregados).
8. **planos.criar** → **quantidades_locais** (quanto de cada serviço em cada trecho/faixa) → **tarefas** (criar ou
   quantidades_locais.criar_tarefas) → **dependencias_marcos** → o cronograma é recalculado sozinho a cada mudança.
9. **planos.promover** trava o plano como linha de base (LB). A LB vigente é a régua do previsto.
10. Execução: **parametros_servico** (como cada serviço é lançado), **producao**, **transporte** (origens/destinos e
    DMT), **viagens** (fichas), **fotos**. Análises: **analises** (previsto × realizado, curva S, valor agregado,
    medição em xlsx).

## Regras do domínio
- **Cadeia viva**: o custo de cada serviço do orçamento vem ao vivo da composição; mudar preço de recurso ou
  composição recalcula o orçamento no banco.
- **Travas**: com LB vigente o orçamento fica travado; depois do 1º aditivo a planilha de venda só muda por
  **aditivos**. Reajuste por índices em **reajustes** (12 meses da data-base e entre reajustes).
- **Indireto**: custo = valor unitário × períodos (não há modo verba).
- **Rateio**: a receita pode ir para vários serviços; "compõe" diz se a quantidade dela forma a quantidade do serviço.
  Receita agrupada não pode ser excluída sem remover a alocação.
- **Cronograma (motor do ApeX/DynaRoad)**: duração = quantidade ÷ (produção da composição × coef_producao × nº de
  equipes). Arrastar o término muda o nº de equipes, nunca o coeficiente. "Não antes de" (restricao_inicio) só alerta;
  para fixar o início use asap=false + inicio_em (ou cronograma.comando "inicio"). Promover a LB exige o cálculo em
  dia (as ferramentas recalculam sozinhas; em lote passe recalcular=false e chame cronograma.calcular no fim).
- **Previsto**: vem do perfil semanal da LB vigente (planejamento_tarefa_perfil_semana).
- **Produção**: sem data futura; serviço lançado por viagens não aceita produção manual (a produção vem das fichas,
  uma por dia/serviço/local/equipe/encarregado — equipe e encarregado vêm da ficha); serviço com exige_local pede
  trecho e faixa.
- **Viagens**: origem e destino obrigatórios. DMT = acesso da origem + |estaca de carga − estaca de descarga| +
  acesso do destino, pelo eixo do mesmo trecho. Local pista entra com a estaca da viagem (estaca_carga_m /
  estaca_descarga_m); jazida, caixa de empréstimo, bota-fora etc. entram com estaca_acesso_m + distancia_acesso_km
  do cadastro (transporte). A distância fixa do par (transporte.rota) prevalece — use para pares fora do eixo.
  Sem nenhum dos dois, o banco recusa. DMT ajustada (dmt_manual) guarda a calculada ao lado. A quantidade é a que
  o usuário informa, na unidade do serviço: o sistema não aplica empolamento nem densidade (variam por material e
  ensaio) — pergunte, não presuma. Serviço medido por peso (parametros_servico.medicao_viagem) exige o ticket.
- **Alertas**: recalculados de hora em hora. Cada um tem uma chave (tipo + tarefa/serviço/equipe + semana, mês ou
  episódio): o que continua mantém a data de abertura e só atualiza os números; o que sumiu fica "resolvido"
  automaticamente. Silenciado (até a data) ou resolvido à mão não reabre com a mesma chave. "Sem foto" é um por
  serviço nos últimos 7 dias e ignora produção importada e de viagens (a evidência é a planilha/ficha).
  Não há hodômetro. A medição desses serviços sai como quadro de distribuição (origem → destino com as estacas,
  DMT, momento).
- **Estacas**: as posições são metros internos do eixo; o rótulo (km, estaca, custom) depende da unidade do trecho.

## Como usar as ferramentas
- Quase tudo pede obra_id: comece por **quem_sou**.
- Ferramentas por área com o campo "acao". Ações destrutivas ou em massa devolvem "precisa_confirmar" e o impacto:
  mostre ao usuário e só repita com confirmar=true se ele concordar.
- **consultar** lê qualquer tabela/view permitida (paginando) quando nenhuma ferramenta responde.
- Planilhas entram em base64 (arquivo_base64) ou por URL; arquivos gerados (modelos, medição) voltam em base64.
`
