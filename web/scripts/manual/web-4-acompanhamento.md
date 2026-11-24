# Acompanhamento

O módulo **Acompanhamento** recebe a produção da obra e a compara com o planejado. A produção chega de três formas: do aplicativo de campo, digitada no próprio web ou importada de uma planilha. Com ela, o sistema mostra o avanço físico, o valor agregado, a medição, a curva S, a produtividade das equipes, as fotos no mapa e os alertas da obra.

## Como a produção é registrada

Cada **lançamento** registra a data, o serviço, a equipe, o encarregado, a quantidade executada e, quando o serviço pede, o material aplicado, o local e as estacas. Só recebem produção os serviços que têm composição vinculada no orçamento.

O comportamento de cada serviço segue a **Parametrização** (seção 8.3):

- **Por quantidade:** a produção do dia é informada diretamente.
- **Por viagens:** a produção do dia é a soma das viagens dos caminhões. O serviço não aparece no formulário de lançamento nem na importação; ele é lançado em **Viagens**, no web ou no aplicativo.
- **Local obrigatório:** o lançamento sem local e sem estacas é recusado.
- **Material controlado:** o lançamento pede a quantidade do material, e a tela mostra o consumo previsto por unidade produzida.

### Onde a produção cai no cronograma

Com o local e as estacas, o sistema converte as estacas em metros e lança o realizado na tarefa do cronograma que cobre aquela faixa. Sem local, o realizado vai para as tarefas do serviço pela ordem de início, sem posição no tempo-caminho.

### De onde vem o previsto

O previsto de todas as telas vem da **linha de base vigente** (seção 8.8). Sem ela, as telas avisam **Sem linha de base vigente** e oferecem o botão [[Abrir o cronograma]].

## Lançar produção

Em **Acompanhamento › Lançar produção** a produção é digitada no web, um serviço de cada vez ou vários de uma só vez.

![Lançamento de produção](lancar.jpg)

### Um lançamento

1. Confira a **Data**. Datas futuras não são aceitas.
2. Escolha a **Equipe**. O encarregado dela é preenchido sozinho; ajuste o **Encarregado** se precisar.
3. Escolha o **Serviço**. Abaixo dele aparece quanto já foi executado do total. Se o serviço tem tarefa num único local, o local é preenchido sozinho.
4. Digite a **Quantidade**, com vírgula para as casas decimais, como 1.250,5.
5. Escolha o **Local** e, num eixo, a **Estaca inicial** e a **Estaca final**. Os locais em que o serviço tem tarefa aparecem marcados com **no cronograma**.
6. Se quiser, preencha a **Frente**, anexe **Fotos** (até 20) e abra **Mais detalhes** para a observação e os materiais aplicados.
7. Clique em [[Lançar produção]].

O lançamento aparece na lista **Lançamentos do dia**, ao lado do formulário. O formulário guarda a equipe, o encarregado, a frente e o local para o próximo lançamento.

:::atencao
Se já existe um lançamento do mesmo serviço, para a mesma equipe, no mesmo dia, o sistema avisa antes de gravar: salvar cria um registro adicional. Confira para não duplicar a produção.
:::

### Vários lançamentos de uma vez

A aba **Em lote** lança a produção de vários serviços do mesmo dia numa tabela:

1. No cabeçalho, informe a **Data** e os valores padrão: **Equipe padrão**, **Encarregado padrão**, **Frente padrão** e **Local padrão**.
2. Digite a **Quantidade** de cada serviço. Enter e as setas andam pela coluna, e é possível colar uma coluna copiada de uma planilha.
3. Ajuste, linha a linha, a equipe, o encarregado, o local e as estacas que forem diferentes do padrão.
4. Clique em [[Registrar N lançamentos]].

![Lançamento em lote](lancar-lote.jpg)

Linhas sem quantidade são ignoradas. O lote é gravado por inteiro ou não é gravado: se uma linha for recusada, nenhuma entra, e a tela mostra o que corrigir.

### Corrigir e excluir

Na lista do dia, clique em [[Editar]] para corrigir um lançamento ou em [[Excluir]] para apagá-lo. O administrador e o engenheiro corrigem qualquer lançamento; o apoio corrige só os que ele criou. Lançamentos que vêm das viagens só mudam pelas viagens.

### Modo campo

O botão [[Modo campo]] abre uma versão do lançamento feita para o celular, sem os menus do sistema. É útil para quem lança pelo navegador do celular, sem o aplicativo de campo.

## Importar produção por planilha

Para trazer a produção de controles em Excel, use a importação:

1. Em **Lançar produção**, clique em [[Importar planilha]] (ou em [[Importar]], na página **Produção**).
2. Clique em [[Baixar modelo (.xlsx)]] e preencha a aba **Produção**, uma linha por lançamento. As colunas estão no capítulo 10.
3. Clique em [[Escolher arquivo]] e escolha o arquivo.
4. Confira a **prévia**: cada linha aparece como **Criar** ou **Erro**, com as mensagens. Nada é gravado antes de você confirmar.
5. Deixe marcada a opção **Criar os encarregados que ainda não existem**, se quiser que os nomes novos virem encarregados da obra.
6. Clique em [[Importar N linhas válidas]].

![Prévia da importação de produção](importar-producao.jpg)

As linhas válidas entram num único lote, com a origem **Importação**. Logo depois, o botão [[Desfazer importação]] remove o lote inteiro, caso algo tenha saído errado.

## Produção

A página **Acompanhamento › Produção** lista todos os lançamentos da obra, de todas as origens: o site, o aplicativo de campo, as viagens e as importações.

![Lista de lançamentos da obra](producao.jpg)

- **Filtros:** período, serviços, equipes, encarregados e origem, além da busca.
- **Detalhe:** clique numa linha para ver o item do orçamento, a equipe, o local e as estacas, os materiais, a tarefa da linha de base e as fotos do lançamento.
- **Corrigir:** no detalhe, [[Editar]] abre o lançamento no formulário; [[Excluir]] apaga, deixando as fotos como avulsas.
- **Exportar:** o botão [[Exportar]] gera uma planilha .xlsx ou um CSV com os lançamentos filtrados.

O cliente vê esta página apenas para consulta.

## Viagens

A página **Acompanhamento › Viagens** reúne as fichas de viagens dos caminhões: uma ficha por veículo e por dia, com as viagens feitas. Nos serviços lançados por viagens, a produção do dia é a soma das viagens.

![Fichas e viagens do período](viagens.jpg)

A tabela mostra cada viagem com o veículo, o motorista, o equipamento de carga (a máquina que carregou o caminhão), o serviço, a origem e o destino com as estacas, o horário, a quantidade, a **DMT** e a nota ou o ticket, além de quem lançou. O topo traz o total do período por serviço.

O botão [[Exportar]] leva as viagens filtradas para uma planilha. No Excel, a aba **Por equip. de carga** soma, para cada equipamento de carga e serviço, as viagens, o volume, a DMT média e o momento de transporte.

### Lançar ou corrigir uma ficha

1. Clique em [[Nova ficha]], ou clique numa linha para abrir a ficha existente.
2. Informe a **Data**, o **Veículo**, o **Motorista**, o **Encarregado** e a **Equipe**.
3. Clique em [[Adicionar viagem]] para cada carga. A nova viagem repete os dados da anterior.
4. Em cada viagem, informe o serviço, a origem, a estaca de carga (quando a origem é a pista), o destino, a estaca de descarga (quando o destino é a pista), a máquina que carregou, os horários, a quantidade, o material (quando a unidade dele é diferente da do serviço) e a nota ou o ticket.
5. Confira a **DMT (km)** e clique em [[Gravar ficha]].

![Ficha de viagens de um caminhão](ficha-viagens.jpg)

### Como a DMT é calculada

1. Se existe uma **distância fixa** cadastrada para o par origem → destino, ela vale. O par tem sentido: A → B não vale para B → A.
2. Se não, e se a origem e o destino estão no mesmo eixo, a DMT é o acesso da origem, mais a distância entre as estacas ao longo do eixo, mais o acesso do destino. A pista entra com a estaca da própria viagem e acesso zero.
3. Se nenhum dos dois casos se aplica, a viagem fica **sem DMT**.

O lápis **Ajustar a DMT** permite digitar outra distância numa viagem; a calculada continua guardada ao lado, e a viagem aparece como **ajustada**. Os cadastros que alimentam a DMT ficam em **Origens e destinos** (seção 9.13).

## Dashboard

O **Dashboard** é o painel gerencial da obra.

![Dashboard da obra](dashboard.jpg)

- **Filtros:** período (7, 30 ou 90 dias, ou outro) e serviço.
- **Indicadores:** avanço físico, dias com produção, equipes que lançaram hoje e na semana, cobertura de fotos e alertas críticos. Com um serviço escolhido, aparecem a produção no período e o ritmo por dia.
- **Prazo e avanço:** a curva S, os alertas abertos e a faixa da obra, que mostra onde cada serviço já foi executado ao longo do eixo.
- **Serviços:** o previsto e realizado até hoje e no período, a aderência de cada serviço ao plano e o quadro de previsto e realizado por serviço, com a quantidade total, a planejada e a realizada.
- **Equipes:** a produtividade de cada equipe contra a meta da composição.
- **Registros de campo:** os últimos lançamentos, o calendário de cobertura de fotos e o mapa das fotos.

:::nota
Na aderência à meta, entre 90% e 110% a equipe está no alvo; entre 70% e 89% ou entre 111% e 130%, pede atenção; abaixo de 70%, está atrasada; acima de 130%, vale revisar a produtividade da composição.
:::

## Calendário de produção

O **Calendário** mostra, mês a mês, o previsto e o realizado de cada serviço, dia a dia, com o total do mês. O dia de hoje fica em destaque.

![Calendário de previsto e realizado](calendario-producao.jpg)

O botão [[Exportar para Excel]] gera a **Programação Mensal** do período escolhido (a obra toda, o mês do calendário ou os meses marcados), com as linhas de previsto e realizado de cada atividade. É a programação que costuma ir para a fiscalização e para as equipes.

## Previsto e realizado

A página **Previsto e realizado** compara, serviço a serviço, a quantidade prevista com a realizada.

![Previsto e realizado por serviço](comparativo.jpg)

A tabela traz a quantidade prevista no total e até hoje, a realizada, o avanço, os dias previstos e realizados, o **Desvio (dias)** e a **Situação**: sem plano, não iniciado, em andamento, no prazo, em risco, atrasado, adiantado ou concluído.

Ao clicar num serviço, a curva S dele aparece com duas projeções:

- **Média atual:** quando o serviço termina se mantiver a produção média dos últimos 15 dias trabalhados;
- **Média necessária:** a produção por dia necessária para terminar no prazo da linha de base.

![Curva S de um serviço com as projeções](curva-servico.jpg)

A exportação gera um PDF com um relatório por serviço, uma planilha .xlsx com uma aba por serviço ou um CSV.

:::nota
O cliente vê esta página sem o desvio, a situação, as projeções e os valores em reais.
:::

## Valor agregado e medição

A página **Valor agregado** mostra quanto a obra executou em valor e prepara a medição do período.

![Valor agregado e medição do período](valor-agregado.jpg)

- **Indicadores:** receita executada, custo executado (produzido, indireto e impostos), margem e medição do período.
- **Curva S** da receita e do custo, previstos e executados.
- **Previsto e executado por serviço** no período.
- **Medição unitária do período:** para cada item da planilha, a quantidade contratual, o avanço no período, a quantidade medida, a venda unitária e o valor medido.

O avanço de um serviço no período é a produção do período dividida pela quantidade do serviço. Esse percentual é aplicado à quantidade contratual de cada receita ligada ao serviço. O que passa de 100% do serviço não agrega valor até um aditivo, e aparece separado como **Executado além do contrato**.

### Exportar a medição

1. Escolha o **Período** e, se quiser, um serviço.
2. Clique em [[Exportar para Excel]].

A planilha da medição tem:

- a aba **Medição**, com o resumo por serviço e o total medido;
- uma aba de **memória de cálculo** por item, com a produção dia a dia, as estacas, os materiais, as equipes e as observações;
- nos serviços lançados por viagens, a memória vira o **quadro de distribuição das viagens**: origem e destino com as estacas, número de viagens, volume, DMT, momento de transporte e faixa de DMT, com o resumo por faixa, o **Total por equipamento de carga** e a relação das viagens uma a uma, com o equipamento que carregou cada uma;
- a aba **Equip. de carga**, quando há viagens no período, com o total de cada equipamento de carga por serviço;
- a aba **Fotos**, com o relatório fotográfico do período.

## Fotos e mapa

A página **Fotos e mapa** mostra as fotos da obra em grade, no mapa ou nas duas formas lado a lado.

![Fotos da obra no mapa](fotos.jpg)

- **Filtros:** período, serviços e **Só fotos com GPS**.
- **Mapa:** camadas de satélite, rodovias, os trechos da obra e a **Sequência de ataque**, que liga a primeira à última foto do dia de cada frente. Os trechos são os eixos com traçado e as áreas com contorno vinculados em **Planejamento › Locais** (seção 8.6); as áreas aparecem preenchidas na cor do local. Os pontos das fotos ficam sempre por cima do traçado e podem ter a cor da equipe ou do serviço. Fotos muito próximas se juntam num círculo com a contagem; clique nele para aproximar.
- Clique numa foto para ampliá-la.

As fotos chegam do aplicativo de campo e do lançamento no web. O administrador pode excluir fotos.

## Performance de equipes

A página **Performance** analisa a produtividade das equipes e dos encarregados num serviço.

![Performance das equipes num serviço](performance.jpg)

Escolha **Agrupar por** (equipes ou encarregados), o **Serviço** e o **Período**. A tela mostra a média, a mediana e o melhor dia, os dias trabalhados, a **Aderência à meta** da composição e a **Tendência**, além da produção diária, do mapa de calor, do ranking e do comparativo entre equipes. Clicar numa equipe põe o foco nela. O mapa de calor mostra um mês de calendário por vez; quando o período passa de um mês, as setas levam ao mês anterior ou ao seguinte, e os dias fora do período aparecem apagados.

:::dica
A média também é comparada com a mediana histórica de outras obras da empresa no mesmo serviço, o que ajuda a revisar a produtividade usada nas composições.
:::

## Equipes e encarregados

É a mesma tela descrita na seção 8.5, com as equipes, a ordem de prioridade, os encarregados e o número de lançamentos de cada um.

## Origens e destinos

Em **Acompanhamento › Origens e destinos** ficam os locais de carga e de descarga das viagens e as distâncias usadas no cálculo da DMT.

![Locais de carga e descarga e distâncias fixas](transporte.jpg)

### Locais de carga e descarga

1. Clique em [[Criar pista dos eixos]] para criar, de uma vez, um local **Pista** para cada eixo da obra. Na pista, a estaca é informada em cada viagem.
2. Para os demais locais, informe o **Nome** (por exemplo, Jazida km 8), o **Tipo** (jazida, caixa de empréstimo, usina, central de concreto, bota-fora, depósito ou outro), o **Trecho**, a **Estaca do acesso**, onde o acesso encontra o eixo, e o **Acesso (km)**, a distância do local até o eixo.
3. Clique em [[Incluir local]].

As alterações na tabela são gravadas ao sair do campo. Local que saiu de uso deve ser desmarcado em **Ativo**, para não perder o histórico das viagens.

### Distâncias fixas

Para os pares que não se ligam pelo eixo, como uma usina distante ou um local de outro trecho, cadastre a distância fixa: escolha a **Origem** e o **Destino**, informe a **Distância (km)** e clique em [[Incluir distância]]. A distância fixa vale no lugar do cálculo pelo eixo, só no sentido cadastrado.

## Alertas

A página **Alertas** reúne os pontos que pedem atenção na obra, calculados a partir do plano e da produção.

![Alertas da obra](alertas.jpg)

| Alerta | Gravidade | Quando aparece |
|---|---|---|
| Produção parada | Aviso | Serviço em andamento na linha de base sem lançamento há 3 dias ou mais. |
| Desvio de quantidade | Crítico abaixo de 40% do esperado; aviso abaixo de 70% | Avanço do serviço comparado com o esperado para hoje. |
| Desvio de prazo | Crítico | Projeção de atraso maior que 7 dias. |
| Produtividade abaixo da meta | Aviso | Equipe com 5 ou mais dias trabalhados e produção típica abaixo de 60% da meta da composição. |
| Sem evidência fotográfica | Informativo | Lançamentos dos últimos 7 dias sem foto. |
| Lançamentos sem equipe | Informativo | Lançamentos sem equipe nos últimos 7 dias. |

Em cada alerta é possível [[Silenciar por 7 dias]], [[Resolver]] ou [[Reabrir]]. O botão [[Recalcular]] confere a obra de novo na hora. Os filtros separam os alertas abertos, silenciados e resolvidos, e os críticos, os avisos e os informativos.

## O que o cliente vê

O usuário com papel Cliente acompanha a obra sem lançar nada e sem ver valores. No Acompanhamento ele tem acesso a:

- **Calendário** de previsto e realizado;
- **Produção**, para consulta;
- **Fotos e mapa**;
- **Previsto e realizado**, sem desvios, situação, projeções e valores em reais.
