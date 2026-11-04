# Decisões — cronograma ApeX no InfraWork Web

## D-01 Motor copiado intacto (F0)

`web/vendor/apex/packages/{dr5,model,calendar,engine,lp,obra,mcp-obra}` vêm do ApeX (commit em `vendor/apex/ORIGEM.txt`).
Mudanças locais, todas marcadas com "InfraWork (vendor)" no código:

1. `lp`: sem o solver HiGHS (transportes fora do escopo); qualquer uso rejeita. Os testes usam o `lp` original
   (`test-support/lp-original.ts`, `highs` só em devDependencies).
2. `engine/postpone.ts` (novo): adiador de cálculo para montagem em lote — o `TimingCalculationPostponer` do
   original, que no ApeX vive no app. `resetTimings` e `applyAutoDependencies` consultam o adiador.
3. `engine/autodeps.ts` `planAutoDependencies`: mesmos resultados com locais/tipos lidos uma vez por passada e a
   relação entre tipos testada antes da interseção (600 tarefas: 3,8 s → 0,09 s).
4. `mcp-obra`: só `obra-format.ts` + o tipo `JsonSchema`.

Prova: `npm run test:apex` com `APEX_ORACLES` (27 `.dr5` do DynaRoad) — 442/442.

Tipos: o vendor compila com as opções do ApeX (`vendor/apex/tsconfig.json`) e emite declarações em
`vendor/apex/.types`, que o InfraWork lê pelos paths `@apex/*` (`npm run typecheck` gera antes).

## D-02 Remontar a cada alteração, num Web Worker

Medido (projeto sintético, carga do modelo + `buildObra` + dependências automáticas + cálculo + folgas/violações):
300 tarefas × 3 trechos ≈ 0,6 s; 600 × 4 ≈ 1,6 s. O banco é a fonte; cada edição grava no banco, o worker
remonta o projeto ApeX a partir dos dados do plano, calcula e devolve resultados; a gravação dos resultados é uma
RPC única e transacional. As visões consultam o worker (folgas, faixas de arraste, violações) e o projeto montado.

Semântica preservada: o início "desejado" de uma tarefa não ASAP é o início atual dela (como no DynaRoad); o
adaptador grava cada trecho com o início/fim do último cálculo, então o próximo cálculo parte do estado salvo.

## D-03 Correspondências

- Equipe (crew) do ApeX = composição do serviço (`vw_servico_vivo` + itens EQ/MO das CPUs ligadas). Taxa por hora
  = produção/dia ÷ jornada de referência do calendário padrão do plano (maior número de horas de um dia da semana
  padrão). Uma tarefa com N equipes usa a equipe "composição × N" (recursos e taxa multiplicados).
- Equipe nomeada do InfraWork (`equipe`) = recurso identificado do ApeX (limite 1): a mesma equipe não trabalha em
  duas tarefas ao mesmo tempo; o nivelamento sequencia pela prioridade (substitui as "lanes").
- Tipo de tarefa = serviço do catálogo do agrupador (`item_orcamentario.servico_id`); dependências entre tipos em
  `servico_dependencia`.
- Tarefa-resumo = tarefa `grupo` do plano.
- Local da tarefa (work place) = `planejamento_tarefa_local`; com origem "trecho", o local vira um work place por
  segmento do template de quantidades (a velocidade no tempo-caminho acompanha a quantidade por segmento).
- Tarefa sem trecho: área "Sem local" (não aparece no tempo-caminho).
- Calendários do ApeX = `calendario` + `calendario_definicao` (vários por obra). O fator de produtividade mensal
  do InfraWork vira horários excepcionais (horas × fator) nos dias do mês que não são feriado.
- Dependências: FS/SS/FF/SF/por estacas; atraso mínimo (null = sem), máximo (null = sem), dias corridos ou úteis.
  Migração: `lag_dias` (dias úteis no motor antigo) → atraso mínimo em dias úteis.
- Indiretos ficam fora do motor (janela pelas tarefas diretas, como antes).

## D-04 Feriados móveis brasileiros no lugar do gerador "Easter"

O gerador `Easter` do ApeX reproduz o DynaRoad (Finlândia): sexta-feira santa, domingo e segunda de Páscoa e a
Ascensão. No Brasil a segunda de Páscoa e a Ascensão são dias de trabalho, e Carnaval e Corpus Christi param a obra.
A definição "Páscoa" do InfraWork (`calendario_definicao.tipo = 'pascoa'`) vira feriados fixos de cada ano de 1998 a
2100 — segunda e terça de Carnaval (Páscoa − 48 e − 47), Sexta-feira Santa (− 2) e Corpus Christi (+ 60) — com a data
da Páscoa do próprio `findEaster` do ApeX. Para trabalhar num deles, um horário excepcional no dia.

`motor/calendario.ts` `especificacaoCalendario` monta o `CalendarSpec` direto das definições, pelas mesmas regras do
`calendarFromDoc`; o teste compara com o calendário que o motor monta pelo documento (dois anos, amostrado a cada
7 h 13 min) — usado pela prévia da tela de calendários.

## D-05 Coeficiente de produção com 12 casas

Arrastar o término muda `m_dWachCoeff` (double no ApeX). Com `numeric(12,6)` o término recalculado a partir do banco
caía alguns segundos antes do fim do expediente (15:59:57). A coluna `planejamento_tarefa.coef_producao` passou a
`numeric(20,12)` (migração 0026 ajustada; o banco local foi migrado à parte): prévia e recálculo coincidem.

## D-06 Visões em React/SVG alimentadas pelo resultado do motor

As visões do ApeX (`views/gantt`, `views/time/roadtime.ts`, `views/time/resource.ts`) desenham sobre a cena própria
(`@apex/scene`, canvas) a partir do `Project` vivo na thread da interface. No InfraWork o projeto vive no Web Worker
(D-02); as visões foram reescritas em React/SVG no visual do InfraWork, com a lógica copiada do ApeX em módulos puros
(`visoes/`): eixo comprimido pelo calendário de interface (`MakeUICalendar`), níveis do cabeçalho
(`DrawIntervals`), snap do arraste, linhas e barras do Gantt (`buildGanttData`), roteamento das dependências
(`GetLineInfo`), a escada do tempo-caminho (`CreateLineBetweenXCoords`/`CreateWorkPlaceLine`), o empilhamento da
visão de recursos. Os comandos (`SetBeginTime`, `SetEndTime`, `AddDependency`, `PackSchedule`) rodam no worker sobre
o projeto calculado: a tela mostra a prévia na hora e o banco recebe só o que muda; o recálculo a partir do banco
chega ao mesmo resultado (testado).

## D-07 Previsão a partir da data de controle também para tarefas ASAP

O `ForecastCalculator` do ApeX agenda o saldo de cada tarefa a partir do início desejado (data de controle ou fim do
último realizado), mas o `Scheduler` põe tarefas ASAP no início do projeto — a previsão cairia no passado. Durante a
previsão as tarefas ASAP usam o início desejado; depois o projeto volta como estava.

## D-08 Controle como leitura sobre o plano

No ApeX os apontamentos de tarefas "outras" (`OtherActual`) não travam work places: o planejado não muda no modo
Control. No InfraWork o controle é calculado junto com o plano (modo "controle" do plano) e não entra na gravação dos
resultados. Os apontamentos vêm da produção lançada (`acompanhamento_producao`, quantidade × fator de conversão) até
a data de controle (`planejamento.data_date`, ou hoje), um por dia com o expediente do calendário da tarefa. A produção
é por serviço do orçamento; entre as tarefas do mesmo serviço, vai primeiro para as da equipe nomeada do lançamento e
depois em ordem de início planejado, cada tarefa até a sua quantidade (o excesso fica na última). Tarefa com o
realizado ≥ planejado fica concluída (`m_bFinished`).

## D-09 Desenho do controle

- Tempo-caminho: as séries do `DWorkSiteLine` (planejado SOLID, realizado DOT, previsão DASH), com as frentes do
  `ForecastCalculator` (`frontPieces`); a previsão vale para todas as tarefas (opção "Previsão" da visão, no lugar do
  atributo de look `FORECAST` por tarefa). No controle o planejado fica translúcido e o realizado e a previsão ganham
  um contorno da cor do fundo, para não sumirem sobre a linha planejada. Data de controle = linha vermelha.
- Gantt: faixa de execução dentro da barra (grau do motor; grupos pela regra `SetCompletedXCoord`), linha de progresso
  vermelha (`DCompletionLine`), data de controle e, quando o término previsto difere do planejado, extensão tracejada
  com losango (laranja = depois, verde = antes) — o rótulo da barra vai depois do losango.
- A data de controle mostrada é o dia escolhido (o motor usa o fim desse dia).

## D-10 Desempate pela ordem do plano

O `Scheduler` do ApeX ordena as tarefas prontas por prioridade e desempata pelo nome (`NamePred`, ordem "lógica").
No InfraWork o nome do work site era o id (UUID): o desempate virava a ordem aleatória dos ids, e a cópia de um plano
(ids novos) podia reprogramar diferente — duas tarefas da mesma equipe trocavam de lugar. O nome do work site passou a
ser a posição da tarefa no plano (pré-ordem da árvore, irmãs por `ordem`) seguida do id (`nomeTarefa`), e a entrada é
carregada nessa ordem: com a mesma prioridade, vai antes quem vem antes no cronograma — o usuário controla o empate
reordenando as linhas ou mudando a prioridade. Os resultados são lidos de volta pelo id (`idDaTarefa`).

## D-11 Trecho = eixo (sem mapa obrigatório) ou área

No ApeX a road line é só nome + estaca inicial e final; a geometria é opcional. No InfraWork Web o trecho passou a ter
`tipo` (`eixo` | `area`) e `comprimento_m` editável sem KML (com KML, o gatilho copia `geometry_comprimento_m`). A
estaca inicial continua em `marcador_valor_inicial`. Encurtar o eixo abaixo de um local de tarefa (planos em edição),
de um segmento do template ou de uma faixa de marco é recusado, como o "Task outside station span" do ApeX; ao
contrário do ApeX, o eixo não cresce sozinho quando um local passa do fim — o usuário recebe o erro e estende o eixo.
Área = local sem estacas: o local da tarefa em área não tem faixa (work place 0…1 do ApeX), no máximo um por tarefa;
o template de quantidades da área tem um único segmento 0–1 (para a planilha de áreas e para "criar tarefas das
quantidades" funcionarem igual aos eixos). Em área a dependência automática entre serviços é término-início (ApeX).

## D-12 Gravar locais é upsert; "do template" indisponível é erro

`planejamento_tarefa_locais_salvar` apagava e reinseria os locais, e `fn_local_antes` degradava "do template" para
manual em todo INSERT: salvar o diálogo podia zerar a quantidade da tarefa sem aviso. Agora a gravação é um upsert
por id (mantém ids e as datas calculadas), e a degradação silenciosa só acontece na cópia de plano
(`infrawork.copia_plano`) e na sincronização do template (`infrawork.trecho_sync`); para o usuário é erro. As
unicidades (sobreposição, um local por área, um "sem local") podem ser adiadas num lote (`infrawork.locais_lote`) e
conferidas no fim por `fn_locais_validar`. `planejamento_tarefa_criar` grava tarefa e locais numa transação.

## D-13 Dividir e combinar nas regras do ApeX

Por estaca (`SplitWorkSiteByStation`): a parte alta vai para a cópia (logo abaixo, com atributos, equipes nomeadas e
dependências do usuário); o local atravessado é cortado proporcionalmente ao comprimento quando é manual e
recalculado pelo template quando é "do template" (as duas partes continuam "do template"). Por quantidade
(`SplitWorkSiteByAmounts`): só locais manuais, mesmas estacas. Combinar (`CombineWorkSites`): mesmo serviço e mesmos
trechos; fica a primeira na ordem do plano; faixas que se cruzam **ou se encostam** viram uma só (o ApeX só funde as
que se cruzam; um local contínuo é mais útil e o motor divide pelos segmentos do template de qualquer jeito); "do
template" só se todas as partes eram "do template". Divergências: tarefas podem ter locais em mais de um trecho
(dividir age só no trecho informado; combinar exige os mesmos trechos); equipes nomeadas são copiadas ao dividir (no
ApeX os recursos identificados são esvaziados).

## D-14 Nome automático sem coluna nova

"Rename tasks automatically" = `<descrição do serviço> <nome do trecho principal> N`, numerado por (serviço, trecho)
em ordem de estaca inicial. Sem coluna `nome_auto`: renomeia tarefas com `nome_custom` nulo ou já no padrão (regex do
prefixo), ou as ids pedidas. O clone de uma tarefa com nome fixado recebe "nome 2" (ou N+1).

## D-15 Criar tarefas das quantidades por local (a importação de quantidades do DynaRoad)

A planilha de quantidades por local do InfraWork é o template do trecho (segmentos × serviços), versionado e
separado das tarefas — no DynaRoad a planilha se dissolve em work places e reimportar aplica a diferença; aqui a
tarefa "do template" aponta para a fonte e acompanha. `planejamento_tarefas_criar_das_quantidades` cria, por
(serviço, local), uma tarefa por sequência contígua de segmentos com quantidade (o zero fecha a sequência, como no
DynaRoad), ou uma por local, ou uma por janela de N m alinhada a múltiplos de N ("combine quantities within N
stations"; lá funde work places dentro da tarefa, aqui gera uma tarefa por janela). Só entram as partes ainda não
cobertas por um local "do template" do mesmo serviço no plano: chamar de novo não duplica.

## D-16 Mudar o trecho da tarefa

`SetRoadLine`/`MoveToArea`: eixo → eixo (um só eixo de origem) remapeia os locais linearmente pela regra
`adjustedSpan` (cabe → mesmas estacas; maior que o eixo → eixo inteiro; senão desloca para caber); "do template" só
continua se o eixo novo tiver quantidade do serviço na faixa (senão vira manual, com aviso no retorno); → área funde
em um local manual; área ou sem local → eixo inteiro.

## D-17 Produção lançada com local e faixa

`acompanhamento_producao` ganhou `trecho_id`, `posicao_inicio_m` e `posicao_fim_m` (faixa dentro do eixo; em área sem
faixa). O controle do cronograma passa a repartir o realizado pela faixa (tarefas do mesmo serviço cujo local a cobre)
e só sem faixa cai na regra por equipe nomeada e ordem de início — os apontamentos do ApeX têm sentido e estaca.

## D-18 Filtro da visão

Gantt e tempo-caminho compartilham um filtro por plano (tarefa-resumo, locais — inclusive "sem local" —, serviços e
equipes nomeadas), aplicado à entrada antes de montar a visão: ficam as tarefas que passam e as suas tarefas-resumo;
dependências só entre as que ficaram. Os diálogos e o cálculo seguem com o plano inteiro (é o filtro ativo por visão
do ApeX, persistido por plano no navegador).

## D-19 Importação da planilha de quantidades por local

Três layouts por aba (por ponto = DynaRoad, por faixa = modelo do InfraWork, áreas), erros com aba e célula,
mapeamento colunas → serviços salvo na obra (`trecho_quantidade_mapeamento`, chave = cabeçalho normalizado; a
planilha exportada pelo sistema leva o mapeamento numa aba oculta). Gravar = nova versão do template por local: os
serviços importados substituem os existentes e os demais ficam — as duas grades são reamostradas na união das bordas
sem mudar somas (`fundirSegmentos`); é o "aplica a diferença" do DynaRoad sem tocar nas tarefas, porque as "do
template" acompanham. Planilha além do fim do eixo: o usuário escolhe estender o eixo ao gravar (o ApeX cresce a road
line sozinho). Eixo de numeração decrescente: uma aba em ordem de marcador é invertida para metros internos
crescentes. Estação numérica é sempre valor do marcador na unidade do eixo; só cabeçalhos "(m)" são metros internos.

## D-20 Quantidades, áreas e divisão no tempo-caminho

A faixa de quantidades por estaca sob o cabeçalho (uma fila por serviço com a densidade da planilha) foi retirada a
pedido do usuário: não ajudava a ler o plano; as quantidades por local ficam na página Locais. Áreas entram como colunas fixas
de 80 px à direita dos eixos (work place 0…1 do ApeX). Modo Dividir: o clique na estaca abre o diálogo de divisão
com todas as tarefas que a cruzam naquele eixo (o `SplitWorkSiteByStation` em lote). Áreas das tarefas-resumo = fecho
convexo das linhas das filhas (`SHOW_SUM_TASK_AREAS`). Tarefas sem local ou com locais fora da seleção aparecem no
indicador "fora da visão", com atalhos para definir o local ou mostrar o trecho.

## D-21 Esticar o término muda equipes, não a produtividade

No ApeX, arrastar o fim da barra (`SetEndTime`) reescreve o coeficiente da taxa de produção (`m_dWachCoeff`). No
InfraWork a produção de uma tarefa é a da composição do serviço × número de equipes, e a produtividade não pode ser
editada por um caminho indireto. O término arrastado (Gantt e tempo-caminho) ou digitado (Propriedades › Término) vira
o número inteiro de equipes que mais se aproxima da duração pedida (`n' = round(n · duração atual / pedida)`, 1–50,
em horas de trabalho do calendário da tarefa); a prévia é um recálculo com as equipes novas e o banco grava só
`qtd_equipes`. O coeficiente sai da edição: tarefas que ficaram com coeficiente ≠ 1 por arrastes antigos mostram um
aviso e a ação "Usar a produtividade da composição". Estabilidade das visões: o fantasma do arraste fica na tela até
a prévia do motor chegar (antes a barra voltava à posição antiga por um instante e saltava), a prévia sobrevive a
comandos seguidos (contador de comandos pendentes por plano) e os cursores seguem as zonas do `DGanttRect` (borda
direita de min(10 px, metade) estica; o resto move só tarefa com início modificável).

## D-22 Auditoria do tempo-caminho contra a RoadTimeView do ApeX

Auditoria item a item contra `views/time/{roadtime,common,tl-edit}.ts` da reconstrução e conferência numérica
(`visoes/conferir-tempo-caminho.ts`, testes em `motor/calculo.test.ts` e `scripts/verificar-tempo-caminho.mjs`):
cada ponta de linha = estaca e data do trecho de trabalho calculado; avanço monotônico; estaca proporcional às horas de
trabalho da tarefa (vertical onde ela para); duração de cada trecho = quantidade ÷ produção da equipe; faixa = locais;
barra do Gantt = envelope; sentido de execução. Iguais à referência: eixos (tempo para baixo, estacas para a direita),
fórmula da escada, subdivisão útil/não útil, simplificação, junção, âncoras e tipos das dependências, marcos com filtro
de estacas, séries do controle, rótulo ao longo da linha. Corrigido para ficar como o ApeX: bandeira de violação de
dependência FF/SF no fim (também no Gantt, inclusive derivadas); `MakeUICalendar` do tempo-caminho só com os dias úteis
(o Gantt do ApeX usa os 7 dias e ficou assim); período do eixo (`GetDateSpan`: data de controle no início e no fim,
margem truncada, plano vazio = início → prazo); acerto < 5 px em cada polilinha separada, inclusive realizado e
previsão; zonas de mover/esticar só no 1.º/último segmento até 50 px (`IsWithinStadium`); cursores por zona ("proibido"
no início de tarefa ASAP); duplo clique na dependência; retângulo da área da tarefa-resumo quando o fecho não tem área.
Extensão própria corrigida: com vários trechos os pedaços seguem a ordem do tempo (num eixo só, a ordem do ApeX).
Fora de propósito ou ainda não feitos: transportes e "sem transporte" (D-01), estilo do controle e previsão global
(D-09), áreas como colunas e eixos lado a lado (D-20), esticar = equipes (D-21); rótulo arrastável, caixinha da
tarefa-resumo, bits de exibição por tarefa/dependência, notas, bloqueios de uso e linhas de travamento do realizado não
existem no InfraWork; "dependências derivadas" seguem desligadas por padrão (no ApeX visíveis).

## D-23 Histograma na apresentação do desktop

O histograma de recursos segue a tela do InfraWork desktop (`HistogramaRecursosChart` e a exportação XLSX portados):
grupos Mão de obra / Equipamentos / Combustível / Material, Semanal (por recurso) e Visão geral (total por semana),
Recursos / Dias / Horas e a matriz recurso × semana com total e pico. Os números vêm do cálculo do web
(`visoes/histograma.ts`): mão de obra e equipamentos do uso calculado pelo motor (composição × equipes, já nivelado e
no calendário; recursos = pico da semana, horas = unidades × horas de trabalho, dias = horas ÷ jornada de referência);
material = perfil semanal da tarefa × consumo por unidade da CPU (fator/operação do vínculo); combustível = litros/dia
dos equipamentos × equipes × dias com produção. A visão de uso contínuo do ApeX com os limites de recursos continua na
aba "Uso contínuo e limites".

## D-24 Regras entre serviços dentro do cronograma (sem tela à parte)

A página Planejamento › Serviços saiu (o endereço antigo leva ao cronograma): o cronograma é autossuficiente. A regra
entre serviços do ApeX (`WorkTypeDependency`, tabela `servico_dependencia`) nasce no diálogo da dependência: numa
dependência "por estacas" entre tarefas de serviços diferentes, a opção "Valer para todas as tarefas de X depois de Y"
grava a regra (atraso em dias por estaca, para todos os planos da obra) em vez da ligação de uma tarefa só. As
dependências derivadas (tracejadas) abrem o mesmo diálogo, por duplo clique ou pelo menu de contexto, para mudar o
atraso ou remover a regra. Uma tarefa ainda pode recusar as regras em Propriedades › Geral. A equipe de cada serviço
continua visível em Orçamento › Composições.
