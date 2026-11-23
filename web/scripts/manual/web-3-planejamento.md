# Planejamento

O módulo **Planejamento** transforma o orçamento num cronograma executável. Os serviços do orçamento recebem quantidades por local, viram tarefas, e o sistema calcula a duração de cada tarefa a partir da produção da composição e do número de equipes. O plano aprovado é travado como **linha de base**, e é ela que alimenta o previsto de todo o acompanhamento.

A ordem recomendada de trabalho é:

1. **Parametrização**: como cada serviço será lançado em campo.
2. **Calendário**: dias e horas de trabalho, feriados e fatores de chuva.
3. **Equipes**: as equipes que executam, na ordem de prioridade.
4. **Locais**: os eixos e as áreas da obra, com as quantidades de cada serviço.
5. **Cronograma**: as tarefas, as dependências e o cálculo.
6. **Linha de base**: travar o plano aprovado e torná-lo vigente.

## Conceitos do planejamento

### Plano em edição e linhas de base

Um **plano** é uma versão do cronograma. A obra tem no máximo **um plano em edição** e até **20 linhas de base**.

- O **plano em edição** é o rascunho de trabalho: pode ser alterado à vontade.
- Uma **linha de base** é um plano travado, somente leitura. Ao travar, ficam congelados as tarefas, as datas, as equipes e as premissas: quantidades, valores, produção de cada serviço e calendário.
- A **linha de base vigente** é a régua do acompanhamento. Só uma pode ser vigente por vez. A curva S, o previsto e realizado, o avanço físico e os alertas de prazo vêm dela.

:::atencao
Sem linha de base vigente, o acompanhamento não tem previsto: as telas mostram **Sem linha de base vigente** e os indicadores de prazo ficam vazios. Durante um replanejamento, a última linha de base vigente continua como referência, com o selo **provisória**.
:::

Enquanto houver linha de base vigente, o orçamento, as composições, os recursos e as quantidades por local ficam somente leitura, para que o previsto não mude sem registro. Para replanejar, veja a seção 8.8.

### Produtividade e equipes

A produção por dia de uma tarefa é a **produção da composição** do serviço multiplicada pelo número de **Equipes** da tarefa (de 1 a 50). A duração é a quantidade dividida pela produção por dia, contada nos dias e horas do calendário.

:::nota
Arrastar o término de uma barra no cronograma **muda o número de equipes**, nunca a produtividade da composição. Se o arraste não chega a mudar o número de equipes, o sistema avisa quantas equipes aquele término ainda dá. Para mudar a produtividade, altere a composição no Orçamento.
:::

### Datas, restrições e dependências

- **O mais cedo possível:** a tarefa começa no início do plano ou assim que as suas dependências permitem. Mover o início de uma tarefa desliga essa opção e fixa a data desejada.
- **Restrições de data** (Não antes de, Exatamente em, Não depois de): não empurram a tarefa. Quando a data não é respeitada, a tarefa ganha a marca ⚑ de violação, para você decidir o ajuste.
- **Dependências:** término → início, início → início, término → término, início → término e **por estacas**, em que a tarefa sucessora passa em cada estaca depois da predecessora. Cada dependência pode ter atraso mínimo e máximo, em dias corridos ou úteis.
- **Equipes nomeadas:** a mesma equipe não trabalha em duas tarefas ao mesmo tempo. O cálculo sequencia as tarefas pela prioridade, que é a ordem das equipes.

## Visão geral

A página **Planejamento › Visão geral** mostra o plano em edição, a linha de base vigente (ou a referência provisória), as equipes e quantas linhas de base já foram usadas, das 20 permitidas.

![Visão geral do planejamento, com o que falta na obra](planejamento-visao.jpg)

O painel **O que falta nesta obra** percorre as etapas da implantação, da planilha de venda até a produção lançada, e indica as pendências e os avisos de cada uma. Quando tudo está certo, ele mostra **Obra pronta**.

## Parametrização dos serviços

Em **Planejamento › Parametrização** você define como cada serviço será lançado em campo. Faça isso antes de montar o cronograma e de levar os apontadores a campo.

![Parametrização dos serviços](parametrizacao.jpg)

Para cada serviço com composição, a tabela tem:

| Coluna | O que define |
|---|---|
| Lançamento | **Quantidade:** o apontador informa a produção do dia. **Viagens:** a produção do dia é a soma das viagens dos caminhões. |
| Medição da viagem | **Volume** ou **Peso**. Por peso, o ticket da balança passa a ser obrigatório em cada viagem. |
| Controla material | Pede, em cada lançamento, a quantidade de um material, para comparar o consumo com o previsto. |
| Material controlado e unidade | O material acompanhado. O sugerido é o da composição do serviço. |
| Material obrigatório | Torna obrigatório informar a quantidade de material. |
| Observação | Mostra ou esconde o campo de observação no lançamento. |
| Local obrigatório | Exige o local e as estacas em cada lançamento. |
| Consumo | Compara o material lançado com o previsto. |

As alterações são gravadas na hora, sem botão de salvar.

:::dica
Marque **Local obrigatório** nos serviços lineares (terraplenagem, pavimentação, drenagem). Com o local e as estacas, a produção cai na tarefa certa do cronograma e aparece no tempo-caminho e na faixa da obra.
:::

O material só pode ser controlado se estiver cadastrado nos recursos da obra, no grupo Material. Nos serviços por viagens, o local vem da própria viagem (a estaca de carga ou de descarga na pista).

## Calendário

Em **Planejamento › Calendário** ficam os calendários de trabalho usados pelo cronograma: a semana padrão, os feriados, os períodos sem trabalho e os fatores mensais de produtividade.

![Calendário de trabalho com a prévia do ano](calendario.jpg)

### Montar o calendário da obra

1. Clique em [[Novo calendário]], ou use o calendário padrão da obra, marcado com ★.
2. Em **Semana padrão**, informe o início e as horas de cada dia, ou use **Aplicar modelo…** (por exemplo, Seg–Sex 8 h ou Seg–Sex 8 h, Sáb 4 h). Clique em [[Salvar semana]].
3. Clique em [[Nacionais]] para incluir os feriados nacionais fixos e os móveis.
4. Use [[Incluir]] para acrescentar:
   - **Feriado ou período sem trabalho**, como feriados municipais ou uma paralisação;
   - **Feriados móveis**, como Carnaval, Sexta-feira Santa e Corpus Christi;
   - **Folga anual num dia da semana**;
   - **Horário excepcional**, outra semana de trabalho num período.
5. Na aba **Fatores mensais**, informe os meses em que a produção cai, com o **Fator** e o motivo. Por exemplo, 0,6 num mês de chuvas significa 60% das horas produtivas.

A **Prévia** mostra o ano inteiro: dia cheio, jornada reduzida, dia de trabalho perdido e dia sem trabalho. Clique ou arraste sobre os dias da prévia para marcar um período sem trabalho, um horário diferente ou um fator.

:::nota
Cada tarefa usa o calendário padrão do plano ou um calendário próprio. O apoio e o cliente apenas consultam os calendários.
:::

## Equipes e encarregados

Em **Planejamento › Equipes** (a mesma tela de **Acompanhamento › Equipes e encarregados**) ficam as equipes que executam a obra e os encarregados que respondem pelos lançamentos.

![Equipes e encarregados da obra](equipes.jpg)

### Equipes

1. Clique em [[Nova equipe]].
2. Informe o **Nome** (por exemplo, Pavimentação 01), o **Tipo**, o **Encarregado** e a **Cor no cronograma**.
3. Clique em [[Criar equipe]].

A **ordem** das equipes na tabela é a prioridade no cronograma; use as setas para reordenar. A tabela também mostra quantas tarefas e lançamentos cada equipe tem. Para tirar uma equipe de uso, desmarque **Equipe ativa** em vez de excluir.

### Encarregados

Clique em [[Novo encarregado]] e informe nome, apelido, telefone e as **Equipes** dele. No aplicativo de campo, o apontador escolhe o encarregado e vê só as equipes dele.

## Locais e quantidades

Em **Planejamento › Locais** ficam os eixos e as áreas da obra, cada um com a sua planilha de quantidades por serviço. É daqui que as tarefas tiram a posição e a quantidade.

![Eixos e áreas da obra, com as quantidades](locais.jpg)

### Criar um eixo ou uma área

1. Clique em [[Novo eixo]] ou em [[Nova área]].
2. Informe o **Nome** e, no eixo, a **Unidade** do estaqueamento: Quilômetro, Estaca (20 m), Metro ou uma unidade personalizada.
3. No eixo, informe a **Estaca inicial** e a **Estaca final**. Se a final for menor que a inicial, a numeração é decrescente. O comprimento é calculado.
4. Escolha a cor e clique em [[Criar eixo]].

O botão **Vincular mapa** liga o eixo ao traçado num arquivo .kml ou .kmz, para mostrar a obra no mapa de fotos.

A área também pode ter mapa. Na tabela de áreas, **Vincular mapa** abre a janela **Mapa da área**, que lê o contorno de um arquivo .kmz ou .kml (um polígono desenhado no Google Earth; se o arquivo tiver mais de um, vale o primeiro). Confira o contorno e salve. Depois de vinculado, o botão passa a mostrar **Contorno**, e na mesma janela dá para trocar o arquivo ou remover o contorno. O contorno aparece no mapa de fotos, preenchido na cor do local.

### Informar as quantidades

1. Na coluna **Quantidades** do local, clique no botão do local.
2. À esquerda, marque os serviços do orçamento que acontecem nesse local. Cada um vira uma coluna.
3. Escolha as **Faixas**: a cada estaca, a cada N estacas, a cada N metros ou faixas livres.
4. Digite as quantidades de cada faixa. O rodapé mostra o total no local, o que já está em tarefas, o que está em outros locais, o orçado e o disponível.
5. Clique em [[Salvar quantidades]]. Cada gravação cria uma nova versão, e as anteriores podem ser restauradas em **Versões**.

![Quantidades de um eixo por faixa de estacas](quantidades.jpg)

:::atencao
A soma das quantidades de um serviço em todos os locais não pode passar da quantidade orçada. Locais usados por tarefas do cronograma não podem ser removidos.
:::

:::nota
Quando as quantidades foram informadas direto nas tarefas do cronograma (por exemplo, num cronograma importado), o local não tem grade e o botão mostra **N serviços nas tarefas**. Ele abre, só para leitura, as quantidades de cada serviço somadas das tarefas do plano em uso, com as faixas que elas ocupam. Para mudá-las, edite as tarefas no cronograma, num plano em edição.
:::

### Conferir as quantidades por local

Abaixo das tabelas de eixos e de áreas, a seção **Quantidades por local** reúne tudo numa tabela só: uma linha por serviço, uma coluna por local e, ao fim, **Nos locais** (a soma do serviço em todos os locais), **Orçado** e **Sem local** (o que ainda não foi para nenhum local). O saldo sem local aparece em amarelo; quando os locais passam do orçado, em vermelho. Clique num número para abrir a grade daquele local.

Como cada serviço tem a sua unidade, a tabela não soma serviços diferentes.

### Excluir as quantidades

Para refazer as quantidades do zero, por exemplo antes de importar outra planilha:

- [[Excluir quantidades…]], no topo da página, apaga as quantidades de todos os locais que têm quantidade;
- [[Excluir quantidades]], dentro da grade de um local, apaga só as daquele local.

:::atencao
A exclusão não tem volta: saem as quantidades e todas as versões guardadas. As tarefas do plano em edição que tiram a quantidade desses locais ficam com zero até a nova importação, que as recalcula. Com linha de base vigente, as quantidades ficam somente leitura e a exclusão não é permitida.
:::

### Importar as quantidades por planilha

Para obras grandes, as quantidades vêm de uma planilha, como a nota de serviço ou a planilha de volumes do projeto:

1. Clique em [[Exportar planilha]] para baixar o modelo já com os locais e os serviços da obra, e preencha-o. As regras do arquivo estão no capítulo 10.
2. Clique em [[Importar quantidades…]] e em [[Escolher planilha]].
3. No passo **Locais e serviços**, confira para qual local vai cada aba da planilha (um local existente, um eixo novo ou não importar) e para qual serviço vai cada coluna. O sistema sugere pelo nome e lembra as escolhas para a próxima vez.
4. No passo **Prévia**, confira, por local e serviço, o importado, o atual, os outros locais e o orçado.
5. Clique em [[Importar para N locais]].

![Importação das quantidades: ligação das abas e das colunas](importar-quantidades.jpg)

Cada local importado recebe uma nova versão das quantidades. Um local que já existe e não tem quantidade na planilha nem no sistema fica de fora, porque não há o que gravar. As tarefas cuja quantidade vem **Do template** são recalculadas sozinhas.

## Cronograma

O **Cronograma** é o gráfico de Gantt do plano: a grade de tarefas à esquerda e as barras no tempo à direita.

![Cronograma da obra](cronograma.jpg)

No topo ficam o estado do cálculo (**Cronograma em dia**, **Calculando…**), o seletor do plano e o botão [[Travar como linha de base]]. A barra de ferramentas tem o modo do ponteiro (**Selecionar** ou **Dependências**), o zoom, os filtros por local, serviço e equipe, o menu **Exibir**, que escolhe as colunas da grade e o que as barras mostram, e os botões [[Escopo]] e [[Plano]]. O rodapé resume o início, o término, o prazo, as tarefas com violação e as tarefas sem produção; numa linha de base, mostra também o término previsto da obra (seção 8.8).

O cálculo roda sozinho ao abrir a tela e a cada alteração.

### Criar o plano

1. Sem plano, clique em [[Criar plano]].
2. Informe o **Nome**, o **Início da obra** e, se quiser, copie as tarefas de um plano existente.
3. Clique em [[Criar plano]].

### Criar as tarefas

O jeito mais rápido é criar as tarefas a partir das quantidades por local:

1. Clique em [[Criar tarefas]] e use a aba **Das quantidades por local**.
2. Na matriz de serviços × locais, marque as células com quantidade livre.
3. Escolha a tarefa-resumo de destino, o **Sentido** de execução (crescente ou decrescente) e como dividir: uma tarefa por sequência contígua, por local ou por janela de N metros.
4. Confira a prévia e clique em [[Criar N tarefas]].

![Criação de tarefas a partir das quantidades por local](criar-tarefas.jpg)

A aba **Manual** cria tarefas uma a uma, escolhendo serviço, local, estacas e quantidade. É nela também que os custos indiretos viram tarefas.

### Custos indiretos no cronograma

Na aba **Manual**, os custos indiretos do orçamento aparecem na lista com o selo **indireto**. A tarefa de indireto não tem local nem equipes: a janela dela vem das tarefas dos serviços diretos. Ao marcar um indireto, escolha a **Distribuição do custo**:

- **Contínuo**, para custos que duram a obra toda, como a administração local. Informe a **Periodicidade do custo orçado** (dia útil, mês ou ano): o custo total é o valor orçado por período vezes os períodos cobertos pelo cronograma. Se preciso, informe quantos dias úteis a tarefa começa antes e termina depois das diretas.
- **Pontual**, para um custo que entra de uma vez, como o canteiro. Informe **Quando** (Primeiros ou Últimos) e os **Dias úteis**: o valor total orçado do item entra nesse período, repartido por igual nos dias úteis.
- **Parcelado**, para custos em parcelas, como a mobilização no início e a desmobilização no fim. Informe, em cada parcela, o percentual, **Quando** e os **Dias úteis**. O botão [[Parcela]] acrescenta outra. Cada parcela vira uma tarefa do mesmo item, com a parcela no nome.

Os dias são contados na janela dos serviços diretos: "primeiros 30" começa no início da primeira tarefa direta, e "últimos 30" termina no fim da última. As parcelas de um item somam no máximo 100%, e o mesmo item não pode ser contínuo e parcelado ao mesmo tempo.

No contínuo, a **Receita** segue a mesma lógica do custo ou o ritmo do faturamento dos serviços diretos. Em qualquer distribuição, a opção **Aplicar taxas (regime) sobre o faturamento como custo** desconta os impostos da taxa escolhida.

Depois de criada, a tarefa de indireto tem a aba **Indireto** nas propriedades, com os mesmos campos.

### Conferir o escopo

O botão [[Escopo]] abre uma gaveta ao lado do Gantt que mostra quanto do orçamento já virou tarefa:

- no topo, o percentual do **valor orçado** que já está em tarefas e quantos serviços ainda têm quantidade a distribuir;
- para cada serviço, a quantidade em tarefas, a orçada e a situação. Os botões **Todos**, **Falta** e **Completos** filtram a lista, e **Acima** aparece quando algum serviço passa do orçado;
- clicar num serviço lista as tarefas dele, e clicar numa tarefa leva até ela no cronograma.

![Gaveta de escopo ao lado do cronograma](escopo.jpg)

A gaveta acompanha a edição do plano. Como cada serviço tem a sua unidade, o total da obra sai em valor de venda, e não em quantidade.

### Ajustar uma tarefa

Clique duas vezes numa barra para abrir as propriedades. As abas são:

- **Geral:** início, término, **O mais cedo possível**, restrições de data, calendário e prioridade.
- **Locais:** o sentido de execução e os trechos da tarefa, com as estacas e as quantidades.
- **Equipes:** a produção por dia da composição, o número de **Equipes**, a produção efetiva, os recursos e as equipes nomeadas.
- **Dependências:** as predecessoras e as sucessoras.
- **Aparência** e **Comentário.**

![Propriedades de uma tarefa](tarefa.jpg)

Também é possível:

- **arrastar** a barra para mover o início, ou a borda direita para mudar o término, o que muda as equipes;
- editar na grade o nome, o local, as equipes e a prioridade;
- usar o menu da barra (botão direito) para dividir por estaca ou por quantidade, combinar tarefas do mesmo serviço, mudar de trecho ou criar dependências.

### Ligar as tarefas

1. Mude o ponteiro para **Dependências**.
2. Arraste de uma barra até a outra: do fim para o início cria término → início; do início para o início, início → início; do meio da barra, uma dependência **por estacas**.
3. Na janela **Nova dependência**, confira o tipo e informe os atrasos mínimo e máximo, se houver.

Marque **Valer para todas as tarefas** para transformar a dependência numa **regra entre serviços**, que vale para todos os planos da obra (por exemplo, a base sempre depois da sub-base, em cada estaca).

### Marcos e propriedades do plano

- **Marcos** são janelas de datas em que um conjunto de tarefas deve caber, como a entrega de um trecho. Tarefas que passam do marco ficam marcadas.
- O botão [[Plano]] abre as propriedades: nome, início, **Prazo** (quem terminar depois recebe ⚑) e calendário padrão. O campo **Modo** é só informativo: o plano em edição está em **Programação** e, ao ser travado como linha de base, passa sozinho para **Controle** (seção 8.8).
- **Mais › Compactar o cronograma** traz as tarefas para o início mais cedo possível e refaz as prioridades pela folga.

### Relatório de viabilidade

Com o cronograma calculado, **Mais › Relatório de viabilidade (Excel)** gera uma planilha que reúne o plano e o orçamento num arquivo só. Ela tem nove abas:

| Aba | Conteúdo |
|---|---|
| Gantt | A estrutura de tópicos do plano, com duração, início, término e predecessoras, e a grade de tempo com as barras e as setas das ligações. A aba é protegida, só para visualização. |
| Premissas | Datas e calendário do plano, as taxas que entram no resultado e o custo indireto, cadastrado e no plano. |
| Orçamento | O resultado da obra (venda, custo direto, indireto, impostos, lucro e margem) e a planilha orçamentária com o resultado e a margem de cada item. |
| Agrupadores | Os serviços do orçamento, com as receitas que cada um reúne, o rateio e a composição que o executa. |
| Composições | Cada composição com a produção diária, o custo unitário e os recursos, com preço e custo por dia. |
| Mão de obra, Equipamentos, Materiais e Combustíveis | Uma tabela por tipo de recurso, com a necessidade de cada recurso semana a semana. |

O relatório usa o plano inteiro, mesmo com filtro aplicado na tela. Quando o plano tem tarefas-resumo, o Gantt segue a estrutura delas; sem tarefas-resumo, segue o agrupamento por local e serviço escolhido na tela.

No Gantt do relatório, as tarefas do **caminho crítico** aparecem em vermelho. São as de menor folga total, que definem o término do plano, contando também as que passam dessa folga em menos de um dia útil. O cálculo mede a folga até o prazo do contrato; quando o plano termina antes do prazo, as tarefas críticas ficam com a folga igual a essa distância. Se o prazo estourar, é crítica toda tarefa sem folga. Atrasar uma tarefa crítica atrasa o término do plano. A mesma regra vale para a opção **Destacar o caminho crítico** do Gantt da tela.

:::nota
Nas abas de materiais, as linhas não são somadas, porque cada material tem a sua unidade. Em mão de obra e equipamentos, a última linha soma a necessidade da semana.
:::

## Linha de base e replanejamento

### Travar a linha de base

1. Com o plano pronto e o cálculo em dia, clique em [[Travar como linha de base]].
2. Mantenha marcada a opção **Tornar vigente**.
3. Confirme.

![Travar o plano como linha de base](travar-linha-de-base.jpg){pequena}

O plano deixa de ser editável e passa a ser a referência do acompanhamento. O seletor do plano, no topo do cronograma, alterna entre o plano em edição e as linhas de base.

### Acompanhar o plano travado (controle)

Uma linha de base aberta no cronograma fica sozinha no modo **Controle**, que mostra o realizado e a previsão a partir da produção lançada:

- a grade ganha as colunas **% exec.**, o grau de execução de cada tarefa, e **Prev. término**, o término previsto pelo ritmo realizado e pelo planejado;
- o rodapé mostra **Previsto**, o maior término previsto das tarefas diretas, com a diferença em dias para o término do plano; em vermelho quando a obra está atrasada;
- em [[Plano]], a **Data de controle** define até que dia vale o realizado; a previsão parte dela. Vazia, vale hoje. É o único campo que pode mudar numa linha de base, e o apoio e o cliente não o alteram.

![Linha de base no modo Controle, com o executado e o término previsto de cada tarefa](cronograma-controle.jpg)

No gráfico, a parte executada aparece destacada dentro de cada barra, a linha tracejada com o losango leva ao término previsto, e a linha vermelha liga, de barra em barra, até onde cada tarefa chegou na data de controle.

Quando a previsão passa do término planejado, o indireto **contínuo** continua correndo até o término previsto: a barra dele ganha um complemento hachurado em vermelho, a dica mostra os períodos e o custo a mais, e o rodapé soma o **Indireto a mais**. O pontual e o parcelado têm valor fechado e não mudam.

:::nota
No plano em edição (modo **Programação**), as colunas de execução e o término previsto não aparecem.
:::

### Excluir um plano ou uma linha de base

O seletor do plano lista o plano em edição e as linhas de base. Nele:

- [[Excluir plano em edição]] apaga o rascunho, com as tarefas e as dependências dele;
- a lixeira ao lado de cada linha de base exclui aquela linha de base e as premissas guardadas. A **vigente** não pode ser excluída: desmarque-a como vigente antes.

As duas exclusões não têm volta. Se a linha de base excluída for a referência provisória do acompanhamento, o previsto passa a vir da linha de base anterior.

### Replanejar

Quando o plano precisa mudar, por exemplo depois de um aditivo:

1. Abra a linha de base vigente no seletor e clique em [[Desmarcar vigente]]. O orçamento volta a ser editável, e esta linha de base continua como referência provisória do acompanhamento.
2. Clique em [[Editar a partir desta]]. Um novo plano em edição é criado com as tarefas dela, ajustadas às quantidades atuais do orçamento.
3. Faça os ajustes, aguarde o cálculo e trave de novo como linha de base vigente.

Quando o orçamento ou o calendário mudam depois de uma linha de base ser travada, ela mostra o aviso **Premissas mudaram**, com a lista do que mudou. O botão **Restaurar com premissas atuais** cria uma linha de base nova, recalculada, sem alterar a original.

:::nota
Cada linha de base travada é uma revisão do planejamento e fica guardada para consulta e comparação. Use a página **Comparar planos** para ver o que mudou entre duas revisões.
:::

## Tempo-caminho

O **Tempo-caminho** mostra o plano num gráfico de estacas no eixo horizontal e tempo no vertical: cada tarefa é uma linha que avança pelo eixo ao longo do tempo. É a forma mais clara de ver a sequência de ataque da obra e os conflitos entre frentes de serviço.

![Diagrama tempo-caminho](tempo-caminho.jpg)

O diagrama tem os mesmos filtros e as mesmas janelas do cronograma. Arraste o começo de uma linha para mover o início ou o fim para mudar o término. O modo **Dividir** corta as tarefas que cruzam a estaca clicada. Tarefas sem local não aparecem aqui.

## Curva S do plano

A página **Curva S** mostra o custo e a receita acumulados do plano escolhido, comparados com a linha de base, além da margem, do início e do término. A tabela **Distribuição semanal** detalha os valores semana a semana.

![Curva S do plano comparada com a linha de base](curva-s.jpg)

## Histograma de recursos

O **Histograma de recursos** mostra a demanda semanal de mão de obra, equipamentos, combustível e materiais, calculada pelo cronograma (composição × equipes), em quantidade de recursos, dias ou horas.

![Histograma de recursos por semana](histograma.jpg)

A aba **Uso contínuo e limites** permite informar um **Limite** por recurso, por exemplo o número de motoniveladoras disponíveis. O cálculo atrasa as tarefas que passariam do limite. O botão [[Exportar Excel]] gera a planilha do histograma.

## Comparar planos

A página **Comparar planos** mostra, tarefa por tarefa, a diferença de datas entre dois planos: por padrão, a linha de base vigente e o plano em edição. Atrasos aparecem em vermelho, como **+N d**, e adiantamentos em verde. A curva S dos dois planos aparece no topo.

![Comparação entre dois planos](comparar.jpg)
