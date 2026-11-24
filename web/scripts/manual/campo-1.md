# Conhecendo o aplicativo

O **InfraWork Campo** é o aplicativo de celular do InfraWork. Com ele, o apontador registra na frente de serviço o que foi executado no dia, as viagens de cada caminhão e as fotos da obra. Tudo o que é lançado chega ao sistema web, onde o escritório confere a produção, acompanha o avanço da obra e prepara a medição.

O aplicativo foi feito para o campo:

- **Funciona sem sinal.** Os dados da obra ficam guardados no celular. Os lançamentos ficam numa fila e são enviados sozinhos quando a internet volta.
- **Segue a obra.** Os serviços, as equipes, os locais e os caminhões mostrados são os cadastrados pelo engenheiro no sistema web. Os campos de cada lançamento seguem a configuração de cada serviço.
- **Não perde nada.** O que está sendo digitado fica salvo no aparelho, mesmo que o aplicativo feche ou o celular desligue.

## Quem usa

| Papel | O que vê no aplicativo |
|---|---|
| Apontador | Produção, Viagens e Fotos das obras liberadas a ele. |
| Apoio | Produção, Viagens e Fotos. |
| Engenheiro e administrador | Produção, Viagens, Fotos e a **Visão estratégica**, um resumo da obra para consultar no celular. |
| Cliente | Não entra no aplicativo. |

## O que você precisa

- Um celular Android com o navegador Chrome, ou um iPhone com o Safari.
- O e-mail e a senha fornecidos pelo administrador ou pelo engenheiro da obra. São os mesmos do sistema web.
- A obra liberada para você. O engenheiro libera em **Gerencial › Usuários**, no sistema web.
- Internet na primeira vez, para baixar os dados da obra. Depois, o aplicativo trabalha sem sinal.

## Como ler este manual

- Nomes de botões e de opções aparecem assim: [[Nova sessão]]; o sinal › indica um caminho: **Produção › Nova sessão**.
- Os quadros **Nota**, **Dica** e **Atenção** trazem informações complementares, sugestões e cuidados.

# Instalação e acesso

## Abrir o aplicativo pela primeira vez

O aplicativo é aberto pelo navegador do celular, no endereço informado pela sua empresa. Depois de instalado, ele ganha um ícone na tela inicial, como qualquer aplicativo, e abre em tela cheia.

![Tela de acesso do aplicativo](login.jpg){celular}

1. Abra o endereço do aplicativo no navegador do celular.
2. Digite o **E-mail** e a **Senha**.
3. Toque em [[Entrar]].

As mensagens mais comuns ao entrar:

| Mensagem | O que fazer |
|---|---|
| E-mail ou senha inválidos | Confira os dois campos. Se esqueceu a senha, peça ao engenheiro ou ao administrador para redefinir. |
| Usuário inativo | O seu acesso foi desligado. Fale com o administrador da empresa. |
| Este usuário não lança produção | O usuário tem o papel Cliente, que não usa o aplicativo. |
| Sem conexão. Verifique sua rede. | O primeiro acesso precisa de internet. |

:::nota
O aplicativo não tem a opção de recuperar a senha. Quem redefine a senha é o administrador ou o engenheiro, no sistema web.
:::

## Instalar no Android

1. Depois de entrar, toque em [[Instalar]], na barra do topo da tela inicial, e confirme.
2. Se o botão não aparecer, abra o menu do Chrome (os três pontos) e toque em **Adicionar à tela inicial**.
3. Abra o aplicativo pelo novo ícone, com internet, para baixar os dados da obra.

## Instalar no iPhone

No Safari, enquanto o aplicativo não estiver instalado, aparece a faixa **Instale na Tela de Início**:

1. Toque no botão **Compartilhar** do Safari, o quadrado com a seta para cima.
2. Toque em **Adicionar à Tela de Início** e confirme.
3. Abra o aplicativo pelo novo ícone.

:::dica
Sem instalar, a barra do navegador ocupa parte da tela. Instalado, o aplicativo usa a tela inteira e abre mais rápido.
:::

## Escolher a obra

1. Na tela inicial, toque no cartão **Obra atual**.
2. Na folha **Selecionar obra**, busque pelo código ou pelo nome e toque na obra.

Quem tem uma única obra liberada já entra com ela escolhida. Se aparecer **Nenhuma obra liberada para você**, peça ao engenheiro para liberar o acesso e toque em [[Atualizar]].

## Tema claro ou escuro

Na tela inicial, o seletor **Tema** escolhe entre **Claro**, **Escuro** ou **Sistema**, que segue a configuração do celular. O tema escuro ajuda à noite e economiza bateria em telas OLED.

## Atualizar o aplicativo

Quando há uma versão nova, aparece no topo a faixa **Nova versão do app disponível.** Toque em [[Atualizar]]. Nada do que foi lançado se perde: os rascunhos e os itens a enviar ficam guardados no aparelho. O número da versão aparece no rodapé da tela inicial.

## Sair

Toque no ícone de porta, no topo da tela inicial.

:::atencao
Sair **apaga deste aparelho** todos os dados guardados, inclusive os lançamentos, as fichas e as fotos que ainda não foram enviados. Se houver itens pendentes, o aplicativo avisa quantos são antes de sair. Só saia com tudo enviado.
:::

Se outra pessoa tentar entrar no mesmo celular enquanto houver itens de outro usuário a enviar, o aplicativo bloqueia e avisa. O dono dos itens precisa entrar para enviá-los, ou usar Sair para descartá-los.

# Tela inicial

A tela inicial mostra a obra em uso, o que está esperando para ser enviado e os módulos do aplicativo.

![Tela inicial do aplicativo](inicio.jpg){celular}

## O que aparece

- **Topo:** o seu nome, o botão **Instalar** (quando o aplicativo ainda não está instalado), o indicador de envio e o botão de sair.
- **Avisos:** **Sem conexão. O app usa os dados guardados no aparelho.**, ou o aviso de pouco espaço no celular, quando a memória passa de 80% de uso.
- **Obra atual:** o código e o nome da obra.
- **Linha de pendências:** o que ainda não foi enviado, por exemplo "2 lançamentos de produção · 1 ficha de viagens · 3 fotos aguardando rede". Um ponto vermelho indica itens recusados pelo servidor, que precisam de correção.
- **Situação dos dados da obra:** **Funciona sem sinal · dados de** dia e hora da última atualização.
- **Módulos:** [[Visão estratégica]] (engenheiro e administrador), [[Produção]], [[Viagens]] e [[Fotos]]. Um número em âmbar sobre o cartão mostra os itens aguardando envio; em vermelho, os recusados.
- **Rodapé:** a hora da última sincronização e a versão do aplicativo.

Um cartão apagado não pode ser aberto ainda. Os motivos são: nenhuma obra escolhida, dados da obra ainda não baixados, ou, no caso de Viagens, nenhum serviço da obra lançado por viagens.

## O indicador de envio

O ícone no topo das telas resume a situação dos envios. Tocar nele força um envio na hora.

| Aparência | Significado |
|---|---|
| Girando | Enviando |
| Cinza | Sem rede |
| Âmbar com número | Itens aguardando rede |
| Vermelho com número | Itens recusados pelo servidor |
| Verde | Tudo enviado |

# Produção

O módulo **Produção** registra o que cada equipe executou no dia. A produção é organizada em **sessões**: uma sessão reúne a data, o encarregado, a equipe e um lançamento para cada serviço executado.

## Lista de sessões

![Lista das sessões de produção](producao-lista.jpg){celular}

A tela mostra as sessões dos últimos 7 dias e todas as que ainda não foram enviadas. Cada cartão traz a data, o selo de envio, o encarregado e a equipe e quantos lançamentos a sessão tem.

Se uma sessão foi começada e não finalizada, aparece o quadro **Sessão em construção**, com os botões [[Continuar]] e [[Descartar]].

## Lançar a produção do dia

### 1. Abrir a sessão

![Nova sessão: data, encarregado e equipe](producao-nova.jpg){celular}

1. Toque em [[Nova sessão]].
2. Em **Data**, escolha [[Hoje]] ou [[Ontem]].
3. Em **Encarregado**, escolha o encarregado responsável.
4. Em **Equipe**, escolha uma das equipes desse encarregado. Se ele tiver uma só, ela já vem escolhida.
5. Toque em [[Continuar]].

:::nota
Se já existe uma sessão do mesmo dia com o mesmo encarregado e a mesma equipe, o aplicativo avisa e oferece [[Adicionar à sessão existente]], para não duplicar.
:::

### 2. Lançar cada serviço

![Lançamento de um serviço na sessão](producao-lancamento.jpg){celular}

1. Toque em [[Adicionar serviço]] e escolha o serviço na lista. A busca encontra pelo código ou pela descrição.
2. Preencha os campos do serviço. Eles dependem de como o engenheiro configurou o serviço:
   - **Quantidade executada**, sempre, na unidade do serviço. Use vírgula para as casas decimais.
   - **Material** e **Quantidade de material**, quando o serviço controla o material aplicado.
   - **Local**, quando a obra tem locais. Se o serviço exige local, o campo é obrigatório.
   - **Estaca inicial** e **Estaca final**, quando o local é um eixo. Digite no formato da obra, como 125+10, ou em quilômetros. A ordem das duas tanto faz.
   - **Observação**, quando habilitada para o serviço.
3. Toque em [[Adicionar lançamento]].
4. Repita para os demais serviços executados pela equipe.

:::dica
Informar o local e as estacas faz a produção cair na tarefa certa do cronograma e aparecer no lugar certo nos painéis da obra. Mesmo quando não é obrigatório, vale preencher.
:::

### 3. Finalizar

Toque em [[Finalizar sessão]]. O aplicativo grava a sessão, tenta enviar na hora e volta para a lista. Sem internet, a sessão fica com o selo **Aguardando rede** e é enviada sozinha quando a conexão voltar. A sessão aparece na lista com o selo de envio, como na Figura 3.

Mensagens que podem aparecer nos campos:

| Mensagem | Causa |
|---|---|
| Informe a quantidade executada. | A quantidade ficou em branco. |
| Escolha o local: este serviço exige. | O serviço foi configurado para exigir local. |
| Valor inválido ou fora do eixo | A estaca digitada não existe no eixo escolhido; o aplicativo mostra o intervalo válido. |
| Informe um valor diferente do inicial. | A estaca final é igual à inicial. |

## Corrigir ou completar uma sessão

1. Na lista, toque na sessão.
2. Toque no lançamento que quer corrigir, altere e toque em [[Atualizar lançamento]]. Para incluir mais um serviço, use [[Adicionar serviço]].
3. Para excluir um lançamento, toque no X do cartão e confirme.
4. Toque em [[Finalizar sessão]] de novo.

Reenviar não duplica a produção: o servidor reconhece cada lançamento.

:::nota
Correções feitas pelo escritório no sistema web não são desfeitas pelo celular. O aplicativo só reenvia o que foi alterado nele.
:::

## Lançamentos recusados

Quando o servidor não aceita um lançamento, por exemplo porque a estaca está fora do trecho ou falta o material obrigatório, a sessão aparece em vermelho com o selo **Recusado** e o **Motivo**.

1. Toque na sessão recusada.
2. Toque no lançamento, corrija conforme o motivo e toque em [[Atualizar lançamento]].
3. Toque em [[Finalizar sessão]].

## Foto de um lançamento

O ícone de câmera no cartão de cada lançamento abre a câmera já com o serviço, o encarregado e a equipe preenchidos. A foto fica ligada ao lançamento e é enviada depois dele.

# Viagens

O módulo **Viagens** registra o transporte de material: cada caminhão tem uma **ficha** por dia, com as viagens feitas. A produção do dia dos serviços medidos por viagens, como escavação e transporte, é a soma das viagens.

:::nota
O módulo só fica disponível quando a obra tem algum serviço configurado para ser lançado por viagens.
:::

## Lista de fichas

![Fichas de viagens do aparelho](viagens-lista.jpg){celular}

A seção **Em andamento** mostra as fichas ainda abertas, que ficam salvas sozinhas. Podem existir várias ao mesmo tempo, uma por caminhão. A seção **Fichas gravadas** mostra as últimas fichas, com o selo de envio.

## Abrir a ficha do caminhão

![Ficha de viagens: caminhão e data](viagens-ficha.jpg){celular}

1. Toque em [[Nova ficha]].
2. Em **Data**, escolha [[Hoje]] ou [[Ontem]].
3. Em **Caminhão**, escolha o veículo pelo prefixo ou pela placa. A lista mostra o modelo, se a frota é própria ou de terceiro e a capacidade da caçamba.
4. Informe o **Motorista**. O aplicativo lembra o último motorista de cada caminhão.
5. Se quiser, escolha o **Encarregado** e a **Equipe**.
6. Toque em [[Continuar para as viagens]].

## Lançar as viagens

![Formulário de uma viagem](viagens-viagem.jpg){celular}

1. Toque em [[Nova viagem]] a cada carga entregue.
2. Preencha:
   - **Serviço**, entre os lançados por viagens;
   - **Origem** e **Destino**: jazida, caixa de empréstimo, usina, central de concreto, bota-fora, depósito ou a própria pista;
   - **Estaca de carga**, quando a origem é a pista, e **Estaca de descarga**, quando o destino é a pista;
   - **Carregado por**, a máquina que carregou o caminhão, se houver;
   - **Hora da carga** e **Hora da descarga**;
   - **Quantidade**, na unidade do serviço. A capacidade da caçamba aparece como referência;
   - **NF / ticket**. Quando o serviço é medido por peso, o **Ticket da balança** é obrigatório.
3. Confira a **DMT (km)**, calculada pelo aplicativo.
4. Toque em [[Adicionar viagem]].

A próxima viagem já vem com o serviço, a origem, o destino, as estacas, a quantidade e a máquina da anterior. Para repetir uma viagem, use o ícone de copiar no cartão dela: a cópia vem sem os horários e sem o ticket.

Quando a origem ou o destino é a pista, o app pergunta a estaca antes de copiar, porque no dia a dia a carga seguinte tem a mesma origem e o mesmo destino e só a estaca anda. O campo já vem com a estaca da viagem copiada; use [[−]] e [[+]] para voltar ou avançar uma estaca (em eixo marcado em km ou em metros, o passo é de 20 m) ou digite o valor, e toque em [[Adicionar viagem]]. A distância de transporte é recalculada com a estaca nova. No serviço medido por peso, a mesma tela pede também a quantidade e o ticket da balança. Para mudar outro dado da cópia, toque em [[Mais campos]].

### A distância de transporte (DMT)

A DMT é calculada a partir dos cadastros da obra: a distância do acesso da origem até o eixo, mais a distância entre as estacas ao longo do eixo, mais a distância do acesso do destino. Quando o engenheiro cadastrou uma distância fixa para o par de origem e destino, vale a distância fixa.

Para corrigir a DMT de uma viagem, toque no lápis ao lado dela e digite a **DMT ajustada (km)**. A viagem fica marcada como ajustada, e o escritório vê a distância calculada ao lado. Tocar de novo no lápis volta para a DMT calculada.

:::atencao
Se aparecer **Sem DMT**, faltam no cadastro da obra a estaca de acesso de um dos locais ou a distância fixa do par. Avise o engenheiro, ou informe a distância pelo lápis.
:::

## Revisar e gravar a ficha

![Revisão da ficha, com a produção do dia](viagens-revisar.jpg){celular}

1. Toque em [[Revisar]]. A tela mostra os dados da ficha e a **Produção do dia (soma das viagens)** de cada serviço.
2. Toque em [[Gravar ficha]].

A tela seguinte acompanha o envio:

| Resultado | Significado |
|---|---|
| Ficha enviada | O escritório já recebeu a ficha. |
| Ficha gravada no aparelho | Ainda não foi enviada; sai sozinha quando a rede voltar. |
| Ficha gravada, envio com erro | O aplicativo tenta de novo sozinho. |
| Ficha recusada | O servidor não aceitou. Toque em [[Corrigir a ficha]], ajuste conforme o motivo e grave de novo. |

# Fotos

O módulo **Fotos** registra o andamento da obra com data, local e uma marca d'água com o serviço, o encarregado e a equipe. As fotos aparecem no sistema web em **Acompanhamento › Fotos e mapa**, sobre o mapa da obra.

## Tirar uma foto

![Câmera com o sinal de GPS](fotos-camera.jpg){celular}

1. Toque em [[Fotos]] e depois em [[Tirar foto]].
2. Aguarde o selo do GPS no topo ficar com boa precisão, como **GPS ±8 m ✓**. O botão de disparo libera com precisão de até 150 m; o ideal é até 50 m.
3. Toque no botão de disparo.
4. Na tela **Conferir a foto**, escolha o **Serviço**, o **Encarregado** e a **Equipe**. Eles entram na marca d'água.
5. Se quiser, escreva **Observações**.
6. Toque em [[Salvar foto]], ou em [[Refazer]] para tirar outra.

![Conferência da foto com a marca d'água](fotos-conferir.jpg){celular}

:::dica
Se o GPS demorar, vá para uma área aberta. Depois de 20 segundos sem sinal bom, o aplicativo libera a foto **sem coordenadas**. Se a localização estiver bloqueada, habilite-a nas permissões do navegador ou do aplicativo.
:::

## Enviar uma foto da galeria

O botão à esquerda do disparo abre a galeria do celular. A foto da galeria usa a data e a localização gravadas no próprio arquivo; sem essas informações, ela segue sem coordenadas.

## A marca d'água

No canto inferior direito da foto ficam a data e a hora, o serviço, o encarregado e a equipe e as coordenadas com a precisão. A localização e a data também vão gravadas nos dados internos da imagem. A foto é reduzida para no máximo 1920 pixels, para economizar dados.

## Fotos a enviar

A tela **Fotos a enviar** lista só as fotos que ainda não subiram. As já enviadas aparecem apenas no contador. Para cada foto pendente:

- a seta circular força o envio na hora;
- a lixeira exclui a foto, sem volta;
- se houve erro, o botão [[Tentar de novo]] repete o envio.

# Visão estratégica

A **Visão estratégica** é um resumo da obra para o engenheiro e o administrador consultarem no celular, inclusive sem sinal, com os dados da última atualização. Apontadores e apoios não veem este módulo.

No topo de cada tela aparecem a obra e a data dos dados, com um ponto verde (ou âmbar, quando os dados têm mais de 24 horas), e o botão de atualizar. As abas no rodapé levam a **Resumo**, **Serviços**, **Produção** e **Equipes**.

## Resumo da obra

![Resumo da obra na Visão estratégica](painel-resumo.jpg){celular}

- **Avanço físico:** o percentual executado, o esperado para hoje e se a obra está à frente ou atrás do plano, ponderado pelo valor de cada serviço.
- **Valor agregado:** o valor executado, o executado no mês, o previsto até hoje e o valor do contrato.
- **Curva S** semanal do previsto e do realizado.
- **Produção:** hoje, 7 dias e 30 dias; equipes com produção hoje e na semana; último lançamento.
- **Pede atenção:** os serviços atrasados ou em risco e as equipes que trabalharam na semana e ainda não lançaram hoje.
- **Últimos lançamentos.**

:::nota
Sem linha de base vigente na obra, o previsto e o esperado ficam vazios. A linha de base é definida no sistema web, no Planejamento.
:::

## Serviços

![Lista de serviços com a situação de cada um](painel-servicos.jpg){celular}

A lista mostra os serviços com os atrasados primeiro. Os filtros separam por situação: atrasado, em risco, em andamento, no prazo, adiantado, não iniciado, concluído e sem plano. Cada cartão traz os dias de folga ou de atraso, o valor executado e a barra do realizado contra o esperado.

Tocar num serviço abre o detalhe: o avanço com o início e o término previstos, o **Ritmo** (a média por dia nos últimos 7 dias contra o ritmo do plano), o valor agregado e **Quem produziu** nos últimos 30 dias.

## Produção

A tela **Produção diária** mostra, para o serviço, o encarregado e a equipe escolhidos nos filtros, o total produzido nos últimos 90 dias, os dias com produção, a média por dia trabalhado e o melhor dia. O **Mapa de calor** mostra cada dia: quanto mais verde, mais perto do melhor dia. Tocar num dia mostra o total e quem produziu.

![Mapa de calor da produção diária](painel-producao.jpg){celular}

## Equipes

A tela **Equipes e encarregados** mostra quem lançou hoje (ponto verde), quem trabalhou na semana (ponto âmbar) e quem está sem atividade (ponto cinza). O quadro **Sem lançamento hoje** lista as equipes que trabalharam na semana e ainda não têm produção lançada no dia. Tocar numa equipe mostra a produção por serviço e a coluna **Meta**, que compara a produção diária típica com a meta da composição: verde entre 90% e 110%, âmbar entre 70% e 130% e vermelho fora disso.

# Trabalhar sem internet

## O que fica guardado no celular

Ao abrir o aplicativo com internet, ele baixa os dados de cada obra liberada: serviços e as suas configurações, equipes, encarregados, locais, frota, origens e destinos e as distâncias de transporte. Esses dados são renovados ao abrir o aplicativo, quando a rede volta e, durante o uso, a cada 10 minutos, se mudaram. A linha **Funciona sem sinal · dados de** mostra quando foi a última atualização.

## Quando os lançamentos são enviados

Produção, fichas e fotos entram em filas e são enviados nesta ordem: primeiro a produção, depois as fichas e por fim as fotos. O aplicativo tenta enviar:

- ao abrir;
- quando a rede volta (aparece o aviso **Conexão restabelecida**);
- ao voltar para o aplicativo;
- a cada 60 segundos, com o aplicativo na tela;
- logo depois de salvar;
- ao tocar no indicador de envio.

:::atencao
O envio só acontece com o aplicativo aberto. Ao chegar num lugar com sinal, abra o aplicativo e espere o indicador ficar verde.
:::

Reenviar nunca duplica um lançamento: cada item tem um identificador criado no próprio aparelho.

## Os selos de envio

| Selo | Significado |
|---|---|
| Enviado | O servidor recebeu e aceitou. |
| Aguardando rede | Está na fila, esperando internet. |
| Enviando | O envio está em andamento. |
| Erro ao enviar | A tentativa falhou; o aplicativo tenta de novo sozinho. |
| Recusado | O servidor não aceitou. Abra o item, veja o motivo e corrija. |

## Sessão expirada

Com internet, o acesso se renova sozinho. Se o servidor pedir um novo login, aparece a faixa **Sessão expirada. Continue lançando; entre de novo com internet para enviar.** Você pode continuar lançando normalmente. Quando tiver internet, toque em [[Entrar]] e digite a senha: os itens guardados são enviados em seguida. Nada é apagado do aparelho.

## Como saber que tudo foi enviado

- O indicador de envio está verde.
- A tela inicial não mostra a linha de pendências nem números sobre os cartões.
- A tela de fotos mostra **Tudo enviado**.
- Os itens mostram o selo **Enviado**.

# Problemas comuns

| Situação | O que fazer |
|---|---|
| Um cartão está apagado | Escolha a obra, ou abra o aplicativo uma vez com internet para baixar os dados dela. |
| Nenhuma obra aparece | Peça ao engenheiro para liberar a obra em Gerencial › Usuários. Depois toque em Atualizar. |
| Um serviço não aparece na Produção | Ele é lançado por viagens: use o módulo Viagens. Se estiver errado, o engenheiro ajusta em Planejamento › Parametrização; depois toque em Sincronizar agora. |
| O módulo Viagens está apagado | Nenhum serviço da obra é lançado por viagens. |
| O caminhão não aparece | O veículo precisa estar cadastrado e ativo em Gerencial › Frota, no sistema web. Escavadeiras e carregadeiras aparecem só em "Carregado por". |
| A viagem mostra "Sem DMT" | Falta o cadastro da estaca de acesso ou da distância fixa. Avise o engenheiro ou informe a DMT pelo lápis. |
| O GPS demora | Vá para uma área aberta e confira a permissão de localização. Depois de 20 segundos a foto sai sem coordenadas. |
| A câmera não abre | Permita o uso da câmera ao navegador ou ao aplicativo, ou envie a foto pela galeria. |
| Aviso de pouco espaço | Conecte-se à internet para enviar as fotos pendentes, que ocupam memória. |
| Não consigo entrar: há itens de outro usuário | O dono dos itens precisa entrar no aparelho e enviá-los antes. |

## Motivos de recusa mais comuns

| Motivo informado | Como corrigir |
|---|---|
| Informe o local do lançamento | O serviço exige local: escolha o local e as estacas. |
| Informe as estacas inicial e final | Preencha as duas estacas do trecho executado. |
| Data no futuro | Confira a data da sessão e o relógio do celular. |
| O serviço é alimentado por viagens | Lance esse serviço pelo módulo Viagens. |
| Informe o ticket da balança | O serviço é medido por peso: preencha o ticket. |
| Estaca de carga fora do trecho | Confira a estaca digitada; ela precisa estar dentro do eixo escolhido. |
| Informe a quantidade de material aplicado | O serviço controla material: informe a quantidade. |
| A ficha foi alterada por outra pessoa | Abra a ficha de novo e refaça a alteração. |
| Sem acesso a esta obra | A obra deixou de estar liberada para você. Fale com o engenheiro. |

## Rotina recomendada para o apontador

1. No início do dia, com internet, abra o aplicativo e confira a obra e a data dos dados.
2. Ao longo do dia, lance a produção de cada equipe, as viagens de cada caminhão e as fotos.
3. Ao fim do dia, finalize as sessões e grave as fichas em andamento.
4. Assim que tiver sinal, abra o aplicativo e espere o indicador ficar verde.
5. Se houver itens recusados, corrija no mesmo dia: o escritório depende da produção para acompanhar a obra.
