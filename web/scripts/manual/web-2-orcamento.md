# Orçamento

O módulo **Orçamento** guarda a planilha de venda da obra, os catálogos de custo (recursos, composições e serviços), os custos indiretos e as taxas. Dele saem o custo de cada serviço, a lucratividade da obra e, principalmente, a **produção por dia** de cada serviço, que o Planejamento usa para calcular o cronograma.

## Como o orçamento é organizado

A planilha orçamentária tem dois tipos de item:

- **Índices:** os títulos e as etapas, como TERRAPLENAGEM ou PAVIMENTAÇÃO. Não têm valor próprio.
- **Receitas:** as linhas cobradas do cliente, com unidade, quantidade e preço unitário de venda.

As receitas são reunidas em **serviços**, que são a unidade de trabalho do sistema: é o serviço que recebe uma composição de custo, entra no cronograma e recebe os lançamentos de produção. Um serviço pode reunir várias receitas (por exemplo, duas faixas de distância da mesma escavação), e uma receita pode ser dividida entre vários serviços, num **rateio**.

O custo de cada serviço vem de uma **composição**, que lista os recursos usados (equipamentos, mão de obra, materiais e combustível) e a produção da equipe por dia:

| Tipo de recurso | Como entra no custo por dia |
|---|---|
| Equipamento e mão de obra | quantidade × preço por hora × horas por dia |
| Material | consumo por unidade × produção por dia × preço, ou quantidade × preço |
| Combustível | litros por hora de cada equipamento × horas por dia × índice produtivo × preço, ou os litros por dia informados |

O **custo unitário** do serviço é o custo por dia dividido pela produção por dia. O custo total do serviço é o custo unitário vezes a quantidade do serviço, e ele é distribuído de volta às receitas na proporção da venda.

:::nota
A venda vem da planilha e é gravada exatamente como foi informada. O sistema não aplica BDI sobre o custo: o resultado da obra é a venda menos o custo direto, o indireto e os impostos.
:::

### Quando o orçamento fica somente leitura

Para proteger o que já foi planejado, a planilha, os recursos, os serviços, as composições e o indireto ficam **somente leitura** quando a obra tem uma linha de base vigente ou quando não há nenhum plano em edição. A tela mostra uma faixa amarela com o motivo e o link **Ver linhas de base no cronograma**. Depois do primeiro aditivo, a venda só muda por meio de novos aditivos.

Quem edita o orçamento são o administrador e o engenheiro; o apoio apenas consulta.

## Visão geral

A página **Orçamento › Visão geral** resume a obra: **Venda total**, **Lucratividade** (com a margem e o aviso de margem baixa abaixo de 10%), **Indireto** e **Itens da planilha**. Os indicadores levam às telas correspondentes.

![Visão geral do orçamento](orcamento-visao.jpg)

A seção **O que falta nesta obra** lista as pendências do orçamento, como receitas sem serviço ou serviços sem composição, cada uma com o botão [[Resolver]].

## Planilha orçamentária

A **Planilha orçamentária** é a tela principal do módulo: à esquerda, a árvore da planilha de venda; à direita, o painel **Serviços**.

![Planilha orçamentária com o painel de serviços](plan-orc.jpg)

As colunas mostram item, unidade, quantidade, venda unitária, venda total, custo total e **Lucro %**, que fica vermelho abaixo de zero e amarelo abaixo de 10%. A faixa **Agrupado em serviços** mostra quanto da venda já está ligado a serviços, e o rodapé traz venda, custo, impostos, lucro e margem líquida.

### Importar a planilha do contrato

O caminho mais rápido para montar a planilha é importar o arquivo do contrato no modelo do InfraWork:

1. Clique em [[Importar planilha]].
2. Clique em [[Baixar modelo (.xlsx)]] e preencha a aba **Orçamento** com a planilha do contrato. As colunas estão descritas no capítulo 10.
3. Volte à janela, clique em [[Escolher arquivo]] e escolha o arquivo preenchido.
4. Confira a **prévia**. Nada é gravado antes de você confirmar. Cada linha aparece com a ação prevista (**Criar**, **Atualizar**, **Ignorar** ou **Erro**) e as mensagens dela; a caixa **Só linhas com erro ou aviso** filtra o que pede atenção.
5. Em **Códigos que já existem na planilha**, escolha entre ignorar ou atualizar os itens que já estão no sistema.
6. Clique em [[Importar]]. O resultado mostra quantos índices, receitas e serviços foram criados.

![Prévia da importação da planilha orçamentária](importar-orcamento.jpg)

:::dica
O modelo já permite indicar o **Serviço** de cada receita e o rateio entre serviços. Assim, a planilha chega agrupada e só falta ligar cada serviço à sua composição. Quando a obra já tem planilha, o botão **Baixar planilha atual** exporta o que está no sistema no mesmo formato, para revisar e reimportar.
:::

### Incluir e editar itens

- **Novo item:** clique em [[Novo item]], escolha o **Tipo** (Receita ou Índice), preencha descrição, unidade, quantidade e venda unitária e confirme. O botão **+** ao lado de um índice cria um item dentro dele.
- **Editar:** a quantidade e a venda unitária são editadas direto na célula. Clicar no item abre o painel com as abas **Geral**, **Composição**, **Comentários**, **Memória** e **Anexos**.
- **Organizar:** o menu ⋮ de cada linha tem **Subir**, **Descer**, **Mover para…** e **Excluir**.

Uma receita ligada a um serviço não pode ser excluída antes de remover a alocação. Excluir um índice apaga tudo o que está dentro dele.

### Agrupar receitas em serviços

Há três formas de ligar receitas a um serviço:

1. Marque as receitas, clique em [[Agrupar em um serviço]] e escolha um serviço existente ou digite o nome de um novo.
2. Arraste as receitas da planilha para um serviço do painel.
3. Digite o nome no campo **Novo serviço** do painel e tecle Enter; depois agrupe as receitas nele.

A opção **Compõe** marca as receitas cuja quantidade forma a quantidade do serviço. Por exemplo, as duas receitas de escavação em faixas de distância diferentes compõem o serviço de escavação, que soma as duas quantidades.

### Ratear uma receita entre serviços

Quando uma receita é executada por mais de um serviço, use o menu ⋮ › [[Ratear…]]:

1. Escolha o **Critério do rateio**:
   - **Percentual:** cada serviço recebe uma parte em %. Abaixo de 100% fica saldo; acima não é permitido.
   - **Quantidade física:** cada serviço recebe uma parte na unidade da receita; o total sempre fecha 100%.
   - **Proporcional à venda:** a divisão é automática, pela venda das receitas que compõem cada serviço.
2. Em cada linha, escolha o serviço, informe a parte e marque **Compõe** quando a quantidade daquela parte formar a do serviço.
3. Use [[Adicionar linha]] para mais serviços e [[Pôr o restante na última linha]] para fechar a conta.
4. Confira **Alocado** e **Saldo** e clique em [[Salvar rateio]].

![Rateio de uma receita entre serviços](rateio.jpg){pequena}

### Ligar o serviço à composição

1. No painel **Serviços**, clique duas vezes no serviço.
2. Em **Custo vem de**, escolha:
   - **Composição**, e escolha a composição em **Composição de custo**; ou
   - **Indireto**, e escolha o item do indireto, para serviços cobrados como verba de administração.
3. Confira a **Quantidade de referência**: **Automática** soma as receitas que compõem o serviço; **Manual** usa um valor fixo.
4. Clique em [[Salvar alterações]].

![Painel de um serviço, com a composição de custo](servico-painel.jpg){pequena}

:::atencao
Um serviço **sem composição** soma a venda, mas fica fora do custo, do cronograma e da produção. Todo serviço que será executado precisa da sua composição.
:::

## Lucratividade

A página **Lucratividade** mostra o resultado previsto da obra: **Venda total**, **Custo direto** (dos serviços), **Custo indireto**, **Impostos** e **Lucro líquido**, com a margem. A tabela **Resultado por etapa** abre o resultado por item de primeiro nível da planilha.

![Resultado previsto por etapa](lucratividade.jpg)

O lucro líquido é a venda menos o custo direto, menos o indireto lançado que não está ligado a serviços, menos os impostos da taxa em vigor.

## Recursos

Em **Orçamento › Recursos** fica o catálogo de insumos da obra, agrupados em **Mão de obra**, **Equipamento**, **Combustível**, **Material** e **Administrativo**, cada um com código, unidade e preço vigente.

![Catálogo de recursos da obra](recursos.jpg)

- **Novo recurso:** clique em [[Novo recurso]] e informe nome, grupo, unidade, código e preço inicial. Mão de obra e equipamento têm preço por hora.
- **Mudar o preço:** clique no ícone de relógio (**Histórico de preços**), em [[Novo preço]], informe o custo unitário e a data a partir da qual ele vale e marque-o como vigente. O histórico fica guardado.
- **Desativar:** recursos fora de uso podem ser desativados sem perder o histórico.
- **Importar:** [[Importar planilha]] cria e atualiza recursos e preços em lote (capítulo 10).

:::nota
Mudar o preço de um recurso muda o custo de todas as composições que o usam.
:::

## Composições

Em **Orçamento › Composições** ficam as composições de custo, com código, serviço, unidade, **Produção/dia**, **Custo unitário** e versão.

![Lista de composições](composicoes.jpg)

### Criar ou editar uma composição

![Editor de composição, com os insumos e o custo](composicao-editor.jpg)

1. Clique em [[Nova composição]], ou abra uma composição da lista.
2. Preencha **Código**, **Nome do serviço**, **Unidade** e **Produção por dia**. A varinha ao lado do código sugere o próximo número.
3. Em **Insumos**, use [[+ Equipamento]], [[+ Mão de obra]] e [[+ Material]] para incluir os recursos. Para cada um, informe a quantidade, as horas por dia, o consumo em litros por hora (equipamentos), o **Índice** produtivo e o consumo por unidade (materiais). Se o recurso não existir, use **Cadastrar recurso**.
4. Em **Combustível**, escolha o combustível dos equipamentos. O consumo é calculado sozinho; marque **Informar os litros por dia** para digitar o valor.
5. Confira o custo por dia e o custo unitário, calculados enquanto você digita.
6. Clique em [[Criar composição]] ou [[Salvar]].

Para mudar uma composição já usada sem perder o histórico, use [[Salvar como nova versão]]. Uma versão antiga pode voltar a valer com **Tornar vigente**.

:::nota
O **Índice** produtivo reduz só o consumo de combustível do equipamento; o custo horário do equipamento não muda. A unidade **DIA** não é aceita na composição, e a produção por dia precisa ser maior que zero.
:::

As composições também podem ser importadas em lote por planilha, com os insumos de cada uma, pelo botão [[Importar planilha]] (capítulo 10).

## Serviços (catálogo)

Em **Orçamento › Serviços** fica a árvore de grupos e serviços do catálogo da obra, cada serviço com a sua unidade. Ao clicar num serviço, aparecem o **Custo unitário do serviço**, a **Produção diária** e as **Composições vinculadas**.

![Catálogo de serviços](servicos.jpg)

Um serviço pode usar uma composição ou a soma de várias, cada uma com um **Fator** e a operação de dividir ou multiplicar. Use [[Vincular outra composição]] para somar composições, por exemplo uma de escavação e outra de transporte. Serviços em uso na planilha orçamentária não podem ser excluídos.

:::dica
Os serviços do catálogo são criados automaticamente ao importar as composições. O botão [[Novo serviço]] permite criar um serviço do zero ou a partir de uma composição existente.
:::

## Indireto

Em **Orçamento › Indireto** ficam os custos indiretos da obra, como mobilização, desmobilização e administração local.

![Custos indiretos de uma obra com plano vigente, em somente leitura](indireto.jpg)

A figura mostra a página numa obra já em acompanhamento, com a faixa de somente leitura (seção 7.1). Com um plano em edição, aparece o botão de cadastro:

1. Clique em [[Novo custo indireto]].
2. Informe **Código**, **Tipo** (Mobilização, Desmobilização, Administração local ou Outros), **Descrição**, **Valor total (R$)** e **Distribuição (%)**.
3. Clique em [[Criar custo indireto]].

O **Valor efetivo** é o valor total vezes a distribuição, e os custos indiretos entram na lucratividade da obra. Quando um serviço da planilha tem o custo vindo do indireto, o custo é calculado pelo serviço, e o lançamento não é somado de novo.

Para corrigir um custo indireto, clique no lápis da linha: ele abre o mesmo formulário preenchido; altere e clique em [[Salvar alterações]]. A lixeira da linha exclui o custo.

No cronograma, cada custo indireto vira uma tarefa, que distribui o valor no tempo de forma contínua, pontual ou parcelada (seção 8.7).

## Taxas

Em **Orçamento › Taxas** ficam os impostos sobre a receita: ISS, PIS, COFINS, CSLL, IRPJ, CPRB e outros.

![Taxas da obra](taxas.jpg)

1. Clique em [[Nova taxa]].
2. Confira os percentuais sugeridos e ajuste-os aos da sua empresa. O **Total descontado da receita** aparece abaixo.
3. Clique em [[Criar taxa]].

Vale uma única taxa por vez, a que estiver **Ativa**. Para corrigir o nome ou os percentuais de uma taxa, clique no lápis da linha, altere e clique em [[Salvar alterações]]. O outro botão da linha desativa ou reativa a taxa. Sem taxa ativa, a planilha avisa que o lucro está sem os impostos. A página de taxas não aparece para o apoio.

## Aditivos

Um **aditivo** muda a planilha de venda do contrato: altera quantidades, exclui itens ou inclui itens novos.

![Aditivo em rascunho, com a variação da venda](aditivos.jpg)

1. Em **Orçamento › Aditivos**, clique em [[Novo aditivo]], informe a **Data do aditivo** e a **Descrição** e clique em [[Criar rascunho]].
2. Monte o aditivo com os botões:
   - [[Alterar quantidade]]: escolha a receita e digite a nova quantidade;
   - [[Excluir item]]: escolha a receita a retirar;
   - [[Incluir item novo]]: informe código, descrição, unidade, quantidade, preço e, se quiser, o serviço.
3. Confira a tabela e o total **Variação da venda com o aditivo**.
4. Clique em [[Aplicar aditivo]].

:::atencao
Aplicar um aditivo não pode ser desfeito. No primeiro aditivo, o sistema guarda a planilha original como **Planilha inicial**, e as linhas de base passam a avisar que as premissas mudaram. Uma quantidade não pode ser reduzida abaixo do que já foi executado.
:::

Enquanto estiver em rascunho, o aditivo pode ser alterado ou excluído com [[Excluir rascunho]].

## Planilha inicial

A **Planilha inicial** é a cópia congelada da planilha de venda, guardada automaticamente quando o primeiro aditivo é aplicado. A tela compara a venda inicial com a atual, item a item, e marca os itens excluídos e os incluídos por aditivo. A caixa **Só o que mudou** mostra apenas as diferenças.

## Reajustes

Em **Orçamento › Reajustes** é feita a correção anual dos preços de venda pelos índices do contrato.

![Reajuste com os grupos de índices](reajustes.jpg)

1. Defina a **Data-base do orçamento**. Ela fica fixa depois do primeiro reajuste.
2. Clique em [[Novo reajuste]], informe a **Data do reajuste** e a **Descrição** e clique em [[Criar rascunho]].
3. Em **Grupos de índices**, clique em [[Adicionar grupo]] e informe o nome do grupo, o **Índice anterior** e o **Índice atual**. O percentual de reajuste é calculado.
4. Em **Classificação das receitas**, ponha cada receita no seu grupo. A opção **Mostrar só as receitas sem grupo** ajuda a achar as que faltam.
5. Confira o **Preço reajustado** e a variação da venda e clique em [[Aplicar reajuste]].

O primeiro reajuste exige 12 meses desde a data-base, e os seguintes, 12 meses desde o anterior; a tela mostra a partir de quando o próximo é possível. Receitas sem grupo ficam sem reajuste, e o que foi executado antes da data do reajuste mantém o preço anterior.

## Exportar

As telas de Recursos, Composições, Indireto e Taxas têm o botão [[Exportar]], que gera uma planilha .xlsx ou um arquivo CSV. A planilha orçamentária é exportada pelo botão **Baixar planilha atual**, dentro da janela de importação.
