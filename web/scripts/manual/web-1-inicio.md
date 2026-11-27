# Conhecendo o InfraWork

O InfraWork é um sistema para orçar, planejar e acompanhar obras de infraestrutura, em especial obras rodoviárias. Ele reúne num só lugar a planilha orçamentária e as composições de custo, o cronograma da obra com as quantidades por local e por estaca, e a produção lançada no dia a dia pelas equipes de campo. Com isso, a mesma informação alimenta o planejamento, a medição e os painéis de acompanhamento, sem planilhas paralelas.

O sistema tem duas partes:

- **InfraWork Web**, usado no computador pelo escritório da obra e pela engenharia. É o assunto deste manual.
- **InfraWork Campo**, o aplicativo de celular usado pelos apontadores na frente de serviço para lançar produção, viagens e fotos, inclusive sem internet. Ele tem um manual próprio.

## Como o trabalho flui no sistema

O trabalho segue a ordem natural de uma obra, e cada módulo usa o que o anterior deixou pronto:

1. **Orçamento.** A planilha orçamentária do contrato é importada, e cada item é ligado a uma composição de custo. A composição diz quanto custa e quanto uma equipe produz por dia.
2. **Planejamento.** Os locais da obra (eixos com estacas e áreas) recebem as quantidades de cada serviço; o cronograma calcula a duração das tarefas a partir da produtividade das composições e do número de equipes. O plano aprovado é travado como **linha de base**, que passa a ser a referência do previsto.
3. **Acompanhamento.** As equipes lançam a produção diária, pelo celular ou pelo web. O sistema compara o realizado com o previsto da linha de base, por serviço, por local e por estaca, e mostra o avanço físico, o valor agregado, a curva S, a produtividade e os alertas.

O módulo **Gerencial** fica à parte: nele o administrador cadastra os usuários, as obras e a frota.

:::nota
Este manual segue a mesma ordem: depois dos capítulos de acesso e navegação, vêm o Gerencial, o Orçamento, o Planejamento e o Acompanhamento. O capítulo 3 traz o roteiro completo para colocar uma obra em andamento.
:::

## Papéis de usuário

Cada usuário tem um papel, e o papel decide o que ele vê. Itens de menu fora do papel simplesmente não aparecem.

| Papel | Onde trabalha | O que pode fazer |
|---|---|---|
| Administrador | Web | Tudo na empresa: usuários, obras, frota, orçamento, planejamento e acompanhamento de todas as obras. |
| Engenheiro | Web e app | Orça, planeja e acompanha as obras liberadas a ele. Cadastra os seus apoios e os apontadores. |
| Apoio | Web e app | Ajuda um engenheiro: consulta o orçamento e o planejamento e lança produção nas obras desse engenheiro. |
| Cliente | Web | Acompanha o avanço da obra (calendário, produção, fotos e previsto e realizado), sem acesso a preços e custos. |
| Apontador | Só o app | Lança produção, viagens e fotos no aplicativo de campo. Não entra no sistema web. |

Existe ainda o **administrador geral**, papel reservado à equipe do InfraWork, que cadastra as empresas clientes e atende todas elas.

## O que você precisa para usar

- Um computador com navegador atualizado: Google Chrome, Microsoft Edge, Firefox ou Safari.
- Conexão com a internet.
- O endereço do sistema, seu e-mail e a senha inicial, que o administrador da sua empresa fornece.
- Para importar e exportar planilhas, um programa que abra arquivos .xlsx, como o Microsoft Excel ou o LibreOffice.

## Conceitos que aparecem em todo o sistema

| Termo | Significado |
|---|---|
| Obra | O contrato acompanhado no sistema. Quase toda tela trabalha sobre a obra escolhida no topo. |
| Serviço | O que a obra executa e mede, como escavação, base de brita ou sarjeta. Vem da planilha orçamentária. |
| Composição | A receita de um serviço: recursos (mão de obra, equipamentos e materiais), consumos e produção da equipe por dia. |
| Recurso | Insumo de uma composição: mão de obra, equipamento, material ou serviço de terceiro. |
| Local | Onde o serviço acontece: um **eixo**, medido por estacas ou quilômetros, ou uma **área**, como uma obra de arte. |
| Estaca | Posição ao longo do eixo. O sistema aceita estaca (20 m), quilômetro ou numeração própria do trecho. |
| Plano | Um cronograma da obra. Pode estar em edição ou travado como linha de base. |
| Linha de base | O plano aprovado e congelado. É dela que sai o **previsto** do acompanhamento. |
| Lançamento | O registro da produção de um dia: data, serviço, equipe, quantidade e, quando o serviço pede, o local e as estacas. |

<!-- quebra -->

# Acesso ao sistema

## Entrar no sistema

Abra o endereço do InfraWork no navegador. Quem ainda não entrou vê a tela de acesso.

![Tela de acesso ao sistema](login.jpg)

1. No campo **E-mail**, digite o e-mail cadastrado pelo administrador.
2. No campo **Senha**, digite a sua senha. O ícone de olho ao lado mostra ou oculta o que foi digitado.
3. Clique em [[Entrar]].

O sistema abre na página **Início**, com as obras da empresa. Clique numa obra para escolhê-la (veja também o capítulo 4).

:::dica
Se aparecer o aviso **Caps Lock ativado**, desligue a tecla Caps Lock antes de digitar a senha.
:::

As mensagens mais comuns ao entrar são:

| Mensagem | O que fazer |
|---|---|
| E-mail ou senha incorretos. | Confira os dois campos. A senha diferencia maiúsculas de minúsculas. |
| Muitas tentativas. Aguarde alguns instantes e tente novamente. | Espere alguns minutos antes de tentar de novo. |
| Conta suspensa. Contate o administrador. | O usuário foi marcado como inativo. Fale com o administrador da empresa. |
| Sem conexão com o servidor. Verifique sua internet e tente novamente. | Confira a internet do computador. |

## Esqueci minha senha

1. Na tela de acesso, clique em [[Esqueci minha senha]].
2. Digite o seu **E-mail** e clique em [[Enviar link]].
3. Abra o e-mail recebido e clique no link. Ele vale por 1 hora.
4. Na tela **Criar nova senha**, preencha **Nova senha** e **Confirmar nova senha**, com pelo menos 8 caracteres, e clique em [[Salvar nova senha]].

:::nota
Se o e-mail não chegar, confira a caixa de spam. O caminho mais rápido é pedir ao administrador da sua empresa que redefina a senha em **Gerencial › Usuários** (seção 6.3).
:::

Não há tela para o próprio usuário trocar a senha depois de entrar: quem quiser uma senha nova usa o **Esqueci minha senha** ou pede ao administrador.

## Sair do sistema

Clique no seu avatar, no canto superior direito, e em [[Sair]]. Também é possível usar a busca (Ctrl K) e escolher a ação **Sair**. Sair numa aba do navegador encerra a sessão nas demais.

## Acesso do apontador

O apontador trabalha só no aplicativo de campo. Se ele entrar no sistema web, verá a tela **Use o app de campo**, com o botão [[Abrir o app de campo]] e a opção de sair.

<!-- quebra -->

# Roteiro de implantação de uma obra

Este capítulo resume, na ordem certa, tudo o que é preciso para levar uma obra do cadastro até o lançamento da produção em campo. Cada passo indica o capítulo em que ele é detalhado.

## Cadastros (administrador)

1. **Usuários.** Em **Gerencial › Usuários**, cadastre os engenheiros, os apoios, os apontadores e, se houver, o cliente. Passe a cada pessoa o e-mail e a senha inicial (seção 6.3).
2. **Obra.** Em **Gerencial › Obras**, crie a obra com código, nome e situação. Depois, em **Editar dados**, informe a rodovia, o trecho, a extensão e as datas (seção 6.4).
3. **Acesso.** Na página da obra, use [[Conceder acesso]] para liberar a obra ao engenheiro e ao cliente. O apoio herda o acesso do seu engenheiro.
4. **Frota.** Em **Gerencial › Frota**, conecte a FleetHub ou cadastre os caminhões e as máquinas de carga usados no transporte (seção 6.5).

## Orçamento (engenheiro)

5. **Planilha orçamentária.** Importe a planilha do contrato e confira os totais (capítulo 7).
6. **Composições.** Ligue cada serviço à composição que o executa. É a composição que informa a produção da equipe por dia, base do cronograma.
7. **Indireto e taxas.** Lance os custos indiretos e as taxas da obra para que a lucratividade fique completa.

## Planejamento (engenheiro)

8. **Parametrização.** Defina como cada serviço é lançado em campo: por quantidade ou por viagens, se controla material e se exige local e estacas (capítulo 8).
9. **Calendário.** Ajuste a semana de trabalho, os feriados, os períodos sem trabalho e os fatores de chuva.
10. **Locais.** Cadastre o eixo da obra, com a estaca inicial e a final, e as áreas. Importe as quantidades por local.
11. **Cronograma.** Monte as tarefas e as dependências e confira o cálculo.
12. **Linha de base.** Com o plano pronto, trave-o como linha de base e torne-o vigente. Sem linha de base vigente, o acompanhamento não tem previsto.

## Acompanhamento e campo (engenheiro e apontadores)

13. **Equipes e encarregados.** Cadastre as equipes e os encarregados, ligando cada encarregado às suas equipes (capítulo 9).
14. **Origens e destinos.** Se houver transporte, cadastre a pista, as jazidas, os bota-foras e as usinas, com a estaca e a distância do acesso.
15. **Apontadores.** Libere a obra para cada apontador e instale o aplicativo no celular dele (manual do aplicativo de campo).
16. **Dia a dia.** A produção chega do campo; o escritório confere em **Acompanhamento › Produção**, corrige quando preciso e acompanha os painéis.

:::dica
A **Visão geral** do Orçamento e a do Planejamento trazem o quadro **Prontidão da obra**, que lista as etapas que ainda faltam e leva direto à tela de cada uma pelo botão [[Resolver]].
:::

<!-- quebra -->

# Navegação

## A tela do sistema

Toda página do InfraWork tem a mesma moldura:

![Moldura das páginas: barra superior, barra de módulos, menu do módulo e área de trabalho](inicio.jpg)

- **Barra superior.** Da esquerda para a direita: o logotipo (volta ao Início), o seletor da obra, a busca, o botão de tema claro ou escuro e o seu avatar.
- **Barra de módulos.** A coluna de ícones à esquerda: Início; Orçamento, Planejamento e Acompanhamento; Gerencial. No rodapé ficam os atalhos de teclado, as configurações e o controle da barra.
- **Menu do módulo.** A segunda coluna, com as páginas do módulo em uso, organizadas em grupos.
- **Área de trabalho.** O conteúdo da página aberta.

Ao clicar num módulo, o sistema volta à última página que você abriu nele. Um ponto vermelho ou amarelo sobre o ícone do Acompanhamento indica que a obra tem alertas críticos ou avisos.

O botão **Controle da sidebar**, no rodapé da barra de módulos, define o comportamento do menu: **Expandida**, **Recolhida** ou **Expandir ao passar o mouse**, que é o padrão.

## Escolher a obra

Quase todas as páginas trabalham sobre uma obra. A obra em uso aparece no topo, com o código e o nome.

![Escolha da obra](seletor-obra.jpg)

1. Clique no seletor da obra, na barra superior.
2. Na janela **Escolher a obra**, digite parte do código ou do nome para filtrar a lista.
3. Clique na obra desejada, ou use as setas do teclado e a tecla Enter.

A escolha fica guardada no navegador e vale para todos os módulos. Páginas que dependem de obra aparecem apagadas no menu enquanto nenhuma obra estiver escolhida.

:::nota
Se a lista vier vazia com a mensagem **Nenhuma obra disponível**, o administrador ainda não liberou nenhuma obra para você.
:::

## Buscar páginas, obras e ações

A busca, na barra superior ou pelo atalho **Ctrl K**, encontra qualquer página que o seu papel permite abrir, qualquer obra e as ações mais usadas, como lançar produção, trocar de obra, mudar o tema e sair.

![Busca de páginas, obras e ações](busca.jpg)

Digite parte do nome, ande pelos resultados com as setas e abra com Enter. A busca ignora acentos. A tecla Esc fecha a janela.

## Atalhos de teclado

| Atalho | Faz |
|---|---|
| Ctrl K | Abre a busca |
| G e depois H | Vai para o Início |
| G e depois O | Vai para o Orçamento |
| G e depois P | Vai para o Planejamento |
| G e depois A | Vai para o Acompanhamento |
| G e depois G | Vai para o Gerencial |
| Ctrl B | Fixa ou solta a barra de módulos |
| ? | Mostra a lista de atalhos |
| Esc | Fecha a janela aberta |

Os atalhos com G não funcionam enquanto o cursor está num campo de texto, e a segunda tecla precisa vir logo depois da primeira.

## Menu do usuário e configurações

O tema claro ou escuro troca pelo botão do sol e da lua, ao lado do avatar. O avatar, no canto superior direito, abre o menu com o seu nome, o e-mail e a empresa. Nele ficam:

- **App de campo (celular)**, que abre uma janela com o QR code do endereço do aplicativo de campo. Aponte a câmera do celular para o código, entre com o seu e-mail e a sua senha e instale o aplicativo (manual do aplicativo de campo).
- **Conectar IA, tokens e status**, para ligar um assistente de inteligência artificial ao InfraWork (capítulo 11).
- **Sair.**

As **Configurações**, no rodapé da barra de módulos, têm três abas:

- **Aparência:** o tema e o **Tamanho do texto**. O tamanho **Compacto** mostra mais linhas por tela; o cronograma, o tempo-caminho e a planilha orçamentária usam sempre o compacto.
- **Conta:** nome, e-mail, papel e empresa. Para mudar esses dados, fale com o administrador.
- **Sobre:** a versão do sistema.

![Configurações do sistema](configuracoes.jpg){pequena}

## Tabelas, filtros e exportação

As listas do sistema seguem o mesmo padrão:

- **Busca** no topo da tabela, que filtra as linhas enquanto você digita.
- **Ordenação:** clique no título de uma coluna para ordenar; clique de novo para inverter.
- **Colunas:** o botão [[Colunas]] escolhe quais colunas aparecem.
- **Largura das colunas:** em qualquer tabela do sistema, arraste a borda direita do título da coluna para alargar ou estreitar. Com a borda em foco (tecla Tab), as setas para a esquerda e para a direita também ajustam. Duplo clique na borda volta a tabela às larguras automáticas. A largura escolhida fica guardada no navegador e volta quando você abre a tela de novo.
- **Exportar:** o botão [[Exportar]] gera um arquivo PDF, uma planilha .xlsx ou um CSV com as linhas visíveis.

## Campos de número

Nos campos de número, em formulários e em células de tabela, o ponto de milhar aparece sozinho enquanto você digita, e as casas decimais vão depois da vírgula: 1.250,5. Se você digitar um ponto, ele vira vírgula. Cada campo aceita só as casas decimais que a coluna guarda. Telefone, CNPJ e placa também são formatados na digitação.

<!-- quebra -->

# Página Início

A página **Início** é a entrada do sistema: reúne as obras da empresa e mostra, numa tela só, como está a carteira e o que pede ação. Ela abre ao entrar, pelo logotipo e pelo primeiro ícone da barra de módulos.

## O que a página mostra

- **Saudação e data**, com o nome da empresa. O administrador tem o botão [[Nova obra]], e o administrador geral também [[Trocar empresa]].
- **Resumo da carteira:**
  - **Obras em andamento**, entre todas as obras da empresa;
  - **Avanço físico médio** das obras com linha de base vigente;
  - **Alertas críticos** abertos e em quantas obras;
  - **Lançamentos em 7 dias**, com a data da última produção.
- **Suas obras:** um cartão por obra, com as em andamento primeiro. O cartão mostra a imagem de satélite com o traçado do eixo (quando o traçado já foi importado em Locais), a situação, o código, a extensão, o avanço físico, os serviços atrasados ou em risco e o último lançamento. A obra em uso tem o selo **obra em uso**. Com obras em situações diferentes, os botões acima dos cartões filtram por situação.
- **Pendências:** o que precisa de ação em todas as obras: alertas críticos abertos, serviços atrasados, obra em andamento sem linha de base vigente e obra em andamento sem lançamento há 7 dias ou mais. Cada item escolhe a obra e abre a tela onde se resolve.
- **Atividade recente:** os últimos lançamentos de produção das obras, com quantidade, encarregado e data.

Clique no cartão para escolher a obra e abrir o **Dashboard** dela (seção 9.6). O botão [[Lançar]] do cartão escolhe a obra e vai direto ao lançamento de produção.

:::nota
O administrador geral escolhe antes a empresa, numa lista com o número de obras de cada uma.
:::

## O que o cliente vê

Na página Início, o cliente vê os cartões das obras liberadas para ele, sem o resumo, as pendências e a atividade. O cartão abre o **Previsto e realizado** da obra, já que o Dashboard é do escritório.

<!-- quebra -->

# Gerencial

O módulo **Gerencial** reúne os cadastros da empresa: usuários, obras, frota e integrações com outros sistemas. Ele é usado pelo administrador e, em parte, pelo engenheiro.

## Visão geral do Gerencial

A primeira página do módulo mostra a quantidade de usuários, separada por papel, e de obras, além de um quadro que explica o que o seu papel permite fazer. Os indicadores levam às listas correspondentes.

## Empresas

A página **Empresas** é usada só pelo administrador geral, da equipe do InfraWork, para cadastrar as empresas clientes. Cada empresa tem os seus dados separados das demais. Depois de criar a empresa, ele cadastra o administrador dela em **Usuários**.

## Usuários

Em **Gerencial › Usuários** ficam as contas de acesso da empresa.

![Lista de usuários da empresa](usuarios.jpg)

A lista mostra nome, papel, empresa, engenheiro responsável (no caso do apoio), situação e data de criação. Na coluna **Ações**, cada linha tem:

- **prédio:** obras liberadas, só nas linhas de apontador;
- **chave:** redefinir a senha;
- **lápis:** editar o usuário;
- **lixeira:** excluir o usuário.

Quem pode cadastrar:

- o **administrador** cadastra administradores, engenheiros, apoios, clientes e apontadores;
- o **engenheiro** cadastra os seus apoios e os apontadores, e pode redefinir a senha deles e liberar obras aos apontadores.

### Cadastrar um usuário

![Cadastro de um novo usuário](usuario-novo.jpg){pequena}

1. Clique em [[Novo usuário]].
2. Preencha **E-mail** e **Nome**.
3. Escolha o **Papel**.
4. Se o papel for Apoio, escolha o **Engenheiro responsável**. O apoio herda o acesso às obras desse engenheiro.
5. Se quiser, informe o **WhatsApp**, com DDI e DDD.
6. Em **Senha inicial**, digite uma senha com pelo menos 10 caracteres ou clique em [[Gerar senha]].
7. Clique em [[Criar usuário]].
8. Passe à pessoa o e-mail e a senha inicial. O sistema não envia convite por e-mail.

:::dica
A senha criada por **Gerar senha** tem 12 caracteres e evita letras e números que se confundem, como 0 e O, ou 1 e l, para ser fácil de ditar por telefone.
:::

### Editar e inativar

1. Clique no lápis da linha.
2. Altere nome, WhatsApp, papel, engenheiro responsável ou **Situação**. O e-mail não pode ser alterado.
3. Clique em [[Salvar]].

Marcar o usuário como **Inativo** impede a entrada no web e no aplicativo de campo, sem apagar nada do que ele lançou. Prefira inativar a excluir.

### Redefinir a senha

1. Clique na chave da linha. A janela já traz uma senha nova gerada.
2. Se quiser, use **Gerar outra senha**.
3. Clique em [[Redefinir senha]]. A senha nova é copiada para a área de transferência; passe-a ao usuário.

### Liberar obras para um apontador

1. Na linha do apontador, clique no ícone de prédio.
2. Marque as obras em que ele vai lançar. Cada marcação é gravada na hora.
3. Clique em [[Fechar]].

### Excluir um usuário

Clique na lixeira e confirme em [[Excluir usuário]]. A exclusão é definitiva. Para só impedir a entrada, edite o usuário e marque-o como inativo.

## Obras

Em **Gerencial › Obras** o administrador cadastra as obras da empresa e controla quem acessa cada uma.

![Lista de obras](obras.jpg)

A lista mostra código, nome, situação da obra (Planejamento, Em andamento, Paralisada ou Concluída), se ela está ativa ou desabilitada e a data de criação. Clicar numa linha abre a página da obra.

### Cadastrar uma obra

1. Clique em [[Nova obra]].
2. Preencha **Código** (por exemplo, OB-2026-001), **Status** e **Nome da obra**.
3. Clique em [[Criar obra]].

A obra já aparece no seletor. Rodovia, trecho, extensão e datas são preenchidos depois, em **Editar dados**.

### Página da obra

![Página da obra, com os usuários que têm acesso](obra-detalhe.jpg)

No topo ficam os botões [[Voltar]], [[Desabilitar]], [[Editar dados]] e [[Conceder acesso]]. Abaixo, o resumo da obra e a lista **Usuários com acesso**, com quem concedeu e quando.

**Editar dados.** Altere código, nome, rodovia, trecho, extensão em km, situação, data-base, início e término e clique em [[Salvar]]. Se a empresa usa a FleetHub, marque aqui as **Obras na FleetHub** correspondentes: as viagens desta obra passam a oferecer os veículos dessas obras, além dos cadastrados à mão no InfraWork. Enquanto a obra não estiver ligada a nenhuma obra da FleetHub, ela oferece só os veículos cadastrados à mão.

**Conceder acesso.**

1. Clique em [[Conceder acesso]].
2. Escolha o usuário. A lista traz os engenheiros, clientes e apontadores ativos que ainda não têm acesso.
3. Clique em [[Conceder acesso]].

:::nota
O administrador da empresa e o administrador geral veem todas as obras da empresa sem precisar de acesso. Se a empresa ainda não tem engenheiro, cliente nem apontador, a janela avisa e oferece [[Cadastrar usuário]]: cadastre a pessoa em Gerencial › Usuários e depois volte para conceder o acesso.
:::

**Revogar acesso.** Clique em [[Revogar]] na linha do usuário e confirme. Os apoios ligados a um engenheiro perdem o acesso junto com ele.

**Desabilitar.** Tira a obra da seleção no web e no aplicativo, sem apagar nada. [[Reabilitar]] desfaz.

**Excluir a obra.** No fim da página, [[Excluir obra]] apaga orçamento, planejamento, acompanhamento, fotos e acessos, sem volta. Para confirmar, é preciso digitar o código da obra.

:::atencao
A exclusão de uma obra não pode ser desfeita. Para tirar uma obra de uso, prefira **Desabilitar**.
:::

## Frota

Em **Gerencial › Frota** ficam os caminhões e as máquinas de carga usados no registro de viagens.

![Cadastro da frota](frota.jpg)

A tabela mostra código, placa, tipo (basculante, carreta, betoneira, pipa, caminhão, escavadeira, retroescavadeira, carregadeira ou outro), modelo, obra na FleetHub, propriedade (próprio ou terceiro), fornecedor, **Capacidade (m³)** e se o veículo está ativo. Os filtros no topo buscam por código, placa ou modelo, separam por obra e por tipo e mostram os veículos sem capacidade ou inativos.

### Integração com a FleetHub

Empresas que usam a FleetHub podem trazer a frota de lá, sem digitar:

1. Clique em [[Conectar FleetHub]] (administrador).
2. Informe o **E-mail da FleetHub** e a **Senha** e clique em [[Testar e conectar]]. O acesso é testado e a senha fica guardada de forma cifrada no servidor.
3. Clique em [[Sincronizar agora]].

A sincronização também roda sozinha todos os dias de madrugada. Vêm os caminhões, as carretas, as pipas, as escavadeiras e as carregadeiras ativos, com a cubagem informada na FleetHub. Os dados que vêm de lá aparecem com o selo **FH** e só mudam na FleetHub.

:::nota
Quando a capacidade na FleetHub não está em m³ (por exemplo, em toneladas) ou está vazia, a coluna mostra o sinal ⚠. Digite a capacidade correta e use o ícone de copiar para aplicá-la a todos os veículos do mesmo modelo.
:::

### Cadastro manual

Sem FleetHub, ou para veículos de terceiros, use a seção **Cadastro manual**: informe **Código**, **Placa** e **Tipo** e clique em [[Incluir veículo]]. Os demais campos são editados direto na tabela e gravados ao sair do campo. Veículo que saiu de uso deve ser desmarcado em **Ativo**, para não apagar o histórico das viagens.

## Integrações

Em **Gerencial › Integrações** o administrador vê as conexões da empresa com outros sistemas. A página só mostra o que está habilitado para a empresa; a habilitação é feita pelo suporte do InfraWork. A conta da FleetHub continua em **Gerencial › Frota**.

### SIGA

Para empresas que usam o SIGA, a produção e as fotos passam a vir de lá. O que muda é só a origem desses dados: as telas, os relatórios e o aplicativo de campo são os mesmos.

1. Clique em [[Conectar SIGA]].
2. Informe o **Servidor**, a **Porta**, o **Banco de dados**, o **Usuário** e a **Senha** do banco do SIGA.
3. Clique em [[Testar e conectar]]. A conexão é testada antes de salvar; se falhar, a mensagem diz o motivo (usuário ou senha recusados, banco inexistente, servidor que não responde).

A senha fica cifrada no servidor e não é exibida de novo. Use [[Alterar credenciais]] para trocá-la e [[Desconectar]] para apagá-la: a produção já trazida continua no InfraWork, mas deixa de ser atualizada.

:::atencao
O servidor do SIGA precisa aceitar conexões de fora da rede da empresa. Peça essa liberação a quem administra o banco.
:::
