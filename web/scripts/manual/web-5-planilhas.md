# Modelos de planilha (Excel)

O InfraWork importa cinco tipos de planilha. Em todos, o modelo é baixado no próprio sistema, já com o nome da empresa, a obra e a data, e a importação passa por uma **prévia** antes de gravar qualquer coisa.

| Planilha | Onde importar | Modelo |
|---|---|---|
| Planilha orçamentária | Orçamento › Planilha orçamentária › Importar planilha | Baixar modelo (.xlsx), ou Baixar planilha atual |
| Composições e insumos | Orçamento › Composições › Importar planilha | Baixar modelo (.xlsx) |
| Recursos e preços | Orçamento › Recursos › Importar planilha | Baixar modelo (.xlsx) |
| Quantidades por local | Planejamento › Locais › Importar quantidades… | Exportar planilha |
| Produção diária | Acompanhamento › Lançar produção › Importar planilha | Baixar modelo (.xlsx) |

## Regras comuns

- Use sempre o modelo baixado do sistema e **não altere os nomes das colunas nem das abas**. Colunas marcadas com asterisco (*) são obrigatórias.
- Cada modelo tem uma aba **Instruções** e uma aba **Exemplo**, que não são importadas.
- O cabeçalho pode estar em qualquer uma das 10 primeiras linhas da aba.
- Cada importação aceita até 5.000 linhas.
- Digite números como números, e não como texto. Quando um número vem como texto, a prévia avisa como ele foi lido.
- Os arquivos aceitos são .xlsx e .xlsm.

### Como ler a prévia

A prévia mostra cada linha com a ação que será feita (**Criar**, **Atualizar**, **Ignorar** ou **Erro**) e as mensagens da linha. O resumo no topo conta as linhas válidas, os erros e os avisos, e a caixa **Só linhas com erro ou aviso** filtra o que pede atenção.

- **Erro:** a linha não será importada. Corrija no arquivo e envie de novo.
- **Aviso:** a linha será importada, mas algo merece conferência, como um encarregado que será criado ou um serviço que ficará sem quantidade.

Linhas com erro nunca são gravadas. O botão de importar grava só as linhas válidas.

## Planilha orçamentária

Arquivo **modelo-orcamento.xlsx**. A aba lida é **Orçamento**; a aba **Agrupamentos** é calculada pelas fórmulas do próprio arquivo e serve só de conferência. As colunas de rateio ficam agrupadas e podem ser abertas pelo botão ⊞ do Excel.

| Coluna | Como preencher |
|---|---|
| Código * | Hierárquico, com pontos: 1, 1.1, 1.1.3. O prefixo define o item pai. Só números e pontos. |
| Descrição * | Texto do item. |
| Unidade | Unidade da receita. Unidade e quantidade vazias juntas indicam um índice (título). |
| Quantidade | Maior que zero nas receitas. |
| Preço unitário de venda | Preço de venda por unidade, como no contrato. Obrigatório nas receitas. |
| Total | Fórmula. Não preencha. |
| Serviço | O serviço em que a receita será agrupada. Aceita um nome novo, que será criado. Vazio deixa a receita sem serviço. |
| Compõe a quantidade | Sim ou Não: se a quantidade da receita forma a quantidade do serviço. |
| Alocado | Fórmula de conferência: verde em 100%, amarelo quando parcial. |
| Rateio por | %, Peso ou Venda. Obrigatório quando a receita vai para mais de um serviço. |
| Parte 1 a 5 e Serviço 2 a 5 | Até cinco destinos do rateio. Em %, a parte é o percentual; em Peso, a quantidade física; em Venda, deixe vazio. |
| Qtd. manual do serviço e Unidade do serviço | Quantidade fixa para o serviço da coluna Serviço, como 1 vb. Prevalece sobre a coluna Compõe. |

Na janela de importação, a opção **Códigos que já existem na planilha** decide entre ignorar os itens que já estão no sistema ou atualizar a descrição, a quantidade, o preço e os serviços deles.

Ao importar, o sistema cria os índices, as receitas e os serviços, faz os agrupamentos e os rateios e recalcula o orçamento. Os serviços novos nascem sem composição: o vínculo é feito depois, na planilha orçamentária (seção 7.3).

:::nota
Erros comuns nesta planilha: código repetido, receita com quantidade mas sem unidade, rateio acima de 100%, o mesmo serviço duas vezes na mesma linha e receita com mais de um serviço sem a coluna **Rateio por**.
:::

## Composições

Arquivo **modelo-composicoes.xlsx**, com duas abas de dados.

**Aba Composições**

| Coluna | Como preencher |
|---|---|
| Código * | 01, 01.02 (de um a três algarismos por nível). Linha sem unidade é um grupo. |
| Nome do serviço * | Nome da composição e do serviço. |
| Unidade | Unidade produzida. A unidade DIA não é aceita. |
| Produção por dia | Maior que zero nas composições. |
| Observações | Notas livres. |

**Aba Insumos** (uma linha por insumo de cada composição)

| Coluna | Como preencher |
|---|---|
| Código da composição * | Precisa existir na aba Composições. |
| Tipo * | Equipamento, Mão de obra, Material ou Combustível. |
| Recurso * | Código ou nome do recurso. |
| Nome do recurso | Nome a usar quando o recurso for informado pelo código e ainda não existir. |
| Unidade do recurso e Preço unitário | Usados só ao criar um recurso novo. |
| Quantidade | Equipamento e mão de obra: número de unidades (padrão 1). Material: quantidade por dia. Combustível: litros por dia (vazio = calculado). |
| Horas por dia | De 0 a 24 (padrão 8). |
| Consumo | Equipamento: litros por hora. Material: consumo por unidade produzida. |
| Índice produtivo | De 0 a 1 (aceita de 0 a 100). Padrão 1. |

Opções da importação:

- **Composições que já existem:** substituir os insumos na mesma versão, criar uma versão nova vigente, ignorar ou tratar como erro.
- **Combustível padrão:** o combustível incluído nas composições com equipamentos que consomem combustível.
- **Criar os recursos que ainda não existem.**

## Recursos

Arquivo **modelo-recursos.xlsx**, aba **Recursos**.

| Coluna | Como preencher |
|---|---|
| Grupo * | Mão de obra, Equipamento, Combustível, Material ou Administrativo. Mão de obra e equipamento com preço por hora. |
| Código | Opcional e único na obra. Quando existe, é a chave para atualizar o recurso. |
| Nome * | Único dentro do grupo. |
| Unidade * | h, L, m³, kg, t, un… |
| Preço unitário | Passa a ser o preço vigente. Em branco, mantém o preço atual. |
| Observação | Fonte da cotação, fornecedor. |

Opções: **Atualizar nome, unidade e código dos recursos que já existem** e **O preço informado vira o preço vigente**. O preço anterior fica no histórico do recurso.

## Quantidades por local

O modelo das quantidades é a própria planilha exportada pelo sistema em **Planejamento › Locais › Exportar planilha**, já com os locais e os serviços da obra. O diálogo de quantidades de um local também exporta só aquele local.

- **Uma aba por eixo**, com o nome do local e uma linha por faixa de estacas.
- **Aba Áreas**, com uma linha por área.
- **Aba oculta Servicos**, que liga cada coluna ao serviço do orçamento. Não altere nem apague essa aba.

| Aba | Coluna | Como preencher |
|---|---|---|
| Eixo | Início (m) e Fim (m) | Início e fim da faixa, em metros desde o começo do eixo. Sem "(m)" no cabeçalho, o valor é lido como estaca na unidade do eixo (1,5 km; 125; 125+10). |
| Eixo | Unid inicial e Unid final | Rótulos das estacas, só para leitura. A importação usa as colunas de metros. |
| Eixo e Áreas | Uma coluna por serviço | A quantidade do serviço naquela faixa ou área. Vazio = sem quantidade. Não aceita valores negativos. |
| Áreas | Área | Nome da área. |

A planilha também aceita o formato **por estaca**, com uma coluna **Estaca** e uma linha por estaca em ordem crescente, como nos programas de projeto rodoviário. Nesse formato, a quantidade de cada estaca vale até o meio do caminho para as estacas vizinhas.

:::atencao
Não deixe linhas de total abaixo ou dentro da tabela: a importação acusa o erro "Linha de soma". A soma de cada serviço em todos os locais não pode passar da quantidade orçada.
:::

Ao importar, cada aba é ligada a um local (existente, novo ou não importar) e cada coluna a um serviço. Essa ligação fica salva na obra para as próximas importações. Nos serviços importados, a planilha substitui todas as quantidades daquele local, e cada local importado ganha uma nova versão das quantidades. Um local que já existe e não tem quantidade na planilha nem no sistema fica de fora da importação. Para recomeçar do zero, use antes **Excluir quantidades…** (seção 8.6).

## Produção diária

Arquivo **modelo-producao.xlsx**, aba **Produção**, uma linha por lançamento.

| Coluna | Obrigatória | Como preencher |
|---|---|---|
| Data | Sim | dd/mm/aaaa ou célula de data do Excel. Datas futuras não são aceitas. |
| Código do item | Sim | O código do serviço no orçamento. O serviço precisa ter composição. |
| Equipe | Não | Nome de uma equipe cadastrada na obra. |
| Encarregado | Não | Nome ou apelido. Nomes novos podem ser criados na importação. |
| Quantidade | Sim | Número maior ou igual a zero, na unidade do serviço. |
| Frente | Não | Texto livre. |
| Local | Quando o serviço exige | Nome do eixo ou da área cadastrados em Planejamento › Locais. |
| Estaca inicial e Estaca final | Quando o local é um eixo | No padrão do eixo, como 12+300. Precisam estar dentro do eixo e ser diferentes. |
| Obs | Não | Observação. |

Serviços lançados por viagens não entram por esta planilha: as viagens são lançadas pelo aplicativo de campo ou em **Acompanhamento › Viagens**.

Os lançamentos importados ficam com a origem **Importação** e formam um lote, que pode ser desfeito por inteiro logo após a importação.

<!-- quebra -->

# Integração com assistentes de IA

O InfraWork pode ser ligado a assistentes de inteligência artificial, como o Claude e o ChatGPT, por meio do protocolo MCP. Com a ligação feita, o assistente consulta e opera o sistema em seu nome, **sempre com as permissões do seu usuário**: ele vê as mesmas obras que você e faz apenas o que o seu papel permite. Ações que apagam dados ou mexem em muitos registros pedem a sua confirmação.

Exemplos do que se pode pedir ao assistente:

- "Quais serviços da obra BR-000 estão atrasados e quanto falta de cada um?"
- "Monte a programação da próxima semana com as equipes disponíveis."
- "Lance a produção desta planilha de apontamentos."

## Conectar um assistente

1. Clique no seu avatar e em **Conectar IA, tokens e status**.
2. Confira se o servidor está no ar e copie o **Endereço do servidor**.
3. Em **Como conectar**, escolha o assistente (Claude, ChatGPT, Claude Code, Cursor ou agentes como o n8n) e siga as instruções da aba.
4. Na primeira conexão, o assistente abre a tela **Conectar IA ao InfraWork**. Confira o nome do aplicativo e o usuário e clique em [[Permitir]].

![Conexão de assistentes de IA ao InfraWork](conectar-ia.jpg)

## Tokens pessoais

Ferramentas que não usam o login pelo navegador, como agentes de automação, usam um **token pessoal**:

1. Em **Tokens pessoais**, informe o **Nome do novo token** e a **Validade** (30 dias, 90 dias, 1 ano ou sem validade).
2. Clique em [[Gerar token]] e copie o token na hora: ele não aparece de novo.
3. Para cortar o acesso, clique em [[Revogar]] na linha do token.

:::atencao
Um token dá acesso ao sistema com as suas permissões. Guarde-o como uma senha e revogue os tokens que não usa mais.
:::

<!-- quebra -->

# Perguntas frequentes

### O previsto, o avanço e a curva S aparecem vazios.

A obra não tem linha de base vigente. No Planejamento, abra o cronograma, aguarde o cálculo e use **Travar como linha de base** com a opção **Tornar vigente** (seção 8.8).

### Não consigo editar o orçamento: aparece "Somente leitura".

Há uma linha de base vigente, ou não há plano em edição. Para alterar, desmarque a linha de base vigente e crie um plano em edição a partir dela; para mudar o contrato, lance um aditivo.

### Um serviço não aparece para lançar produção.

O serviço precisa ter composição vinculada no orçamento. Se ele é lançado por viagens, aparece em Viagens, e não no formulário de produção.

### O cronograma mostra tarefas "sem produção".

A composição do serviço não tem produção por dia, ou o serviço não está ligado a uma composição. Confira em Orçamento › Composições e no painel do serviço na planilha orçamentária.

### Arrastei a barra e a produtividade não mudou.

É o comportamento esperado: o término muda o número de equipes, e a produtividade vem da composição. Para mudar a produtividade, altere a composição.

### O cronograma não mostra o % executado nem o término previsto.

Essas colunas aparecem só no plano travado, que fica no modo Controle. Abra a linha de base no seletor do plano, no topo do cronograma. No plano em edição, o modo é Programação (seção 8.8).

### Um serviço aparece com saldo "Sem local" em Planejamento › Locais.

Parte da quantidade orçada do serviço ainda não foi informada em nenhum local. Abra a grade do local e complete, ou confira se a coluna do serviço veio preenchida na planilha importada. Um serviço que não acontece num lugar específico, como um projeto, pode ficar sem local.

### A produção lançada não aparece no tempo-caminho.

O lançamento foi feito sem local e estacas. Edite o lançamento em Acompanhamento › Produção e informe o local e as estacas. Para evitar, marque **Local obrigatório** na parametrização do serviço.

### Uma viagem ficou sem DMT.

Falta a estaca de acesso de um dos locais (no mesmo eixo) ou a distância fixa do par origem → destino. Complete o cadastro em Acompanhamento › Origens e destinos, ou ajuste a DMT na viagem.

### Um caminhão não aparece nas viagens.

O veículo precisa estar ativo em Gerencial › Frota. Se a empresa usa a FleetHub, confira as obras da FleetHub marcadas em Gerencial › Obras › Editar dados.

### O apontador não vê a obra no aplicativo.

Libere a obra para ele em Gerencial › Usuários, no ícone de prédio da linha dele. Depois, ele toca em Atualizar no aplicativo.

### Esqueci a senha.

Use **Esqueci minha senha** na tela de acesso ou peça ao administrador para redefinir em Gerencial › Usuários.

### Importei uma planilha de produção errada.

Logo depois da importação, use **Desfazer importação** na tela Lançar produção para remover o lote inteiro.

<!-- quebra -->

# Glossário

| Termo | Significado |
|---|---|
| Aditivo | Alteração formal da planilha de venda do contrato: quantidades, exclusões e itens novos. |
| Agrupar | Ligar receitas da planilha orçamentária a um serviço. |
| Área | Local da obra sem estaqueamento, como uma obra de arte ou um pátio. |
| Composição | Receita de custo de um serviço: recursos, consumos e produção da equipe por dia. |
| Controle | Modo do plano travado: mostra o executado e o término previsto a partir da produção lançada. |
| Curva S | Gráfico do avanço acumulado no tempo, previsto e realizado. |
| Dependência | Ligação entre tarefas que define a ordem de execução. |
| DMT | Distância média de transporte entre a origem e o destino de uma viagem, em km. |
| Eixo | Local linear da obra, com estaqueamento. |
| Encarregado | Responsável por uma ou mais equipes e pelos lançamentos delas. |
| Equipamento de carga | A máquina que carrega o caminhão numa viagem, como uma escavadeira ou uma carregadeira. |
| Equipes (na tarefa) | Quantas equipes executam a tarefa ao mesmo tempo. Multiplica a produção da composição. |
| Escopo | Quanto da quantidade orçada de cada serviço já está em tarefas do plano. |
| Estaca | Posição ao longo do eixo. |
| Faixa da obra | Representação do eixo que mostra onde cada serviço já foi executado. |
| Índice | Item-título da planilha orçamentária, sem valor próprio. |
| Indireto | Custos da obra que não pertencem a um serviço: mobilização, administração local. |
| Lançamento | Registro da produção de um serviço num dia. |
| Linha de base | Plano travado e aprovado, referência do previsto. |
| Linha de base vigente | A linha de base em uso pelo acompanhamento. |
| Medição | Apuração do valor executado num período, por item da planilha de venda. |
| Parametrização | Configuração de como cada serviço é lançado em campo. |
| Plano em edição | Versão do cronograma ainda aberta a alterações. |
| Produção por dia | Quanto uma equipe executa por dia, segundo a composição. |
| Rateio | Divisão de uma receita entre dois ou mais serviços. |
| Receita | Item cobrado do cliente na planilha de venda. |
| Recurso | Insumo: mão de obra, equipamento, combustível, material ou administrativo. |
| Serviço | Unidade de trabalho do sistema: reúne receitas, tem composição, entra no cronograma e recebe produção. |
| Tempo-caminho | Diagrama de estacas por tempo que mostra o avanço das frentes de serviço. |
| Valor agregado | Valor do que foi executado, pelos preços do contrato. |
| Viagem | Transporte de uma carga por um caminhão, com origem, destino, quantidade e DMT. |
