/**
 * O contrato `infrawork-4d` em texto (versão 1, geometria pronta, e versão 2, dados de projeto), para quem gera
 * o modelo (prompt da tela, ferramenta do MCP e
 * `docs/MODELO-4D.md`, que um teste mantém igual a este texto).
 */
export const CONTRATO_TEXTO = `# Contrato do modelo 4D do InfraWork (infrawork-4d)

Um arquivo JSON (UTF-8) com a obra, pronto para o Acompanhamento 4D do InfraWork. A cena põe a obra sobre o
terreno real com imagem de satélite e cruza cada peça com o plano (linha de base) e com a produção lançada **pela
estaca**. Há duas formas de entregar a obra:

- **Dados de projeto (versão 2, a recomendada para rodovia)**: o arquivo traz as tabelas do projeto (notas de
  serviço, cubação, seção-tipo, estrutura do pavimento, quadros de drenagem, bueiros, defensas, cercas e placas) e
  o InfraWork monta a geometria, com a seção de cada estaca e os dispositivos dos projetos-tipo. Não desenhe o que
  cabe nas tabelas: copie o projeto.
- **Geometria pronta (versão 1)**: o arquivo traz as seções, as camadas e os elementos já desenhados. Serve para o
  que não cabe nas tabelas (uma interseção, uma obra especial) e para obra sem nota de serviço.

As duas podem ir no mesmo arquivo: na versão 2, o que vier em \`secoes\`, \`camadas\` e \`elementos\` é somado ao que o
InfraWork monta.

## Convenções

- Coordenadas locais em metros: \`x\` (leste), \`n\` (norte), \`z\` (cota). Um ponto é \`[x, n, z]\`.
- \`origem\` é **obrigatória**: o UTM do ponto (0, 0) local e o fuso (\`"22S"\`). É ela que põe a obra no lugar certo do
  terreno e da imagem de satélite. Use o datum do projeto (SIRGAS 2000) e confira com uma coordenada conhecida.
- Posição no eixo (\`s\`): metros desde a estaca 0 do projeto. Estaca 100 = 2000; km 12+500 = 12500. É o mesmo
  estaqueamento do plano no InfraWork.
- Afastamento do eixo: negativo = lado esquerdo, positivo = lado direito (no sentido crescente das estacas).

## Dados de projeto (versão 2)

\`\`\`json
{
  "formato": "infrawork-4d",
  "versao": 2,
  "nome": "Vicinal · implantação e pavimentação",
  "origem": { "e": 750000, "n": 8175000, "fuso": "22S" },
  "classes": [
    { "id": "TERRA.CORTE", "nome": "Escavação, carga e transporte", "disciplina": "Terraplenagem", "servico": "S02", "terreno": true, "material": "corte" },
    { "id": "TERRA.ATERRO", "nome": "Compactação de aterro", "disciplina": "Terraplenagem", "servico": "S03", "terreno": true, "material": "aterro" },
    { "id": "PAV.SUBBASE", "nome": "Sub-base", "disciplina": "Pavimentação", "servico": "S05" },
    { "id": "PAV.BASE", "nome": "Base", "disciplina": "Pavimentação", "servico": "S06" },
    { "id": "PAV.IMPRIM", "nome": "Imprimação", "disciplina": "Pavimentação", "servico": "S07" },
    { "id": "PAV.CBUQ", "nome": "CBUQ", "disciplina": "Pavimentação", "servico": "S10" },
    { "id": "DREN.SARJ", "nome": "Sarjetas e valetas", "disciplina": "Drenagem", "servico": "S12" },
    { "id": "OAC.TUB", "nome": "Bueiros tubulares", "disciplina": "Obras de arte correntes", "servico": "S15" },
    { "id": "SIN.HORIZ", "nome": "Sinalização horizontal", "disciplina": "Sinalização", "servico": "S18" },
    { "id": "OC.CERCA", "nome": "Cerca", "disciplina": "Obras complementares", "servico": "S20" },
    { "id": "OC.SEMEAD", "nome": "Semeadura dos taludes", "disciplina": "Obras complementares", "servico": "S21" }
  ],
  "projeto": {
    "secao_tipo": { "pista": 3.5, "acostamento": 2.0, "caimento": -2, "faixa_dominio": 80 },
    "pavimento": [
      { "classe": "PAV.CBUQ", "onde": "pista", "espessura": 0.05 },
      { "classe": "PAV.IMPRIM", "onde": "tudo" },
      { "classe": "PAV.BASE", "onde": "tudo", "espessura": 0.17, "sobra": 0.28 },
      { "classe": "PAV.SUBBASE", "onde": "tudo", "espessura": 0.16, "sobra": 0.52 }
    ],
    "terraplenagem": { "corte": "TERRA.CORTE", "aterro": "TERRA.ATERRO", "protecao_vegetal": "OC.SEMEAD" },
    "pintura": "SIN.HORIZ",
    "nota_servico": [
      { "eixo": "E1", "nome": "Eixo principal", "estacas": [
        { "s": 40, "e": 750524.83, "n": 8180503.88, "z": 1053.55, "zt": 1053.2, "zn": 1052.89, "ie": -1.6, "id": -2,
          "esq": [[6.6, 1053.09], [7.41, 1052.88]], "dir": [[6.6, 1053.07], [7.21, 1052.85]] },
        { "s": 60, "e": 750544.58, "n": 8180507.1, "z": 1053.83, "zt": 1053.48, "zn": 1053.05, "ie": -1.4, "id": -2,
          "esq": [[6.6, 1053.39], [7.41, 1053.04]], "dir": [[6.6, 1053.35], [7.19, 1053.08]] }
      ] }
    ],
    "cubacao": [{ "eixo": "E1", "volumes": [[60, 0, 109.9]] }],
    "drenagem": [{ "tipo": "VPAC 160-30", "lado": "E", "s0": 40, "s1": 60, "classe": "DREN.SARJ", "quantidade": 20 }],
    "bueiros": [
      { "s": 50, "tipo": "BSTC", "diametro": 1.0, "comprimento": 20, "cota_montante": 1050.01, "cota_jusante": 1049.81,
        "montante": "E", "classe": "OAC.TUB" }
    ],
    "cercas": [{ "lado": "E", "s0": 40, "s1": 60, "classe": "OC.CERCA" }]
  }
}
\`\`\`

\`origem\`, \`classes\` e \`terreno\` são os mesmos da versão 1, descritos adiante. Todo item de \`projeto\` cita a
\`classe\` a que pertence: é por ela que a peça se liga ao serviço do plano.

### projeto.secao_tipo

Da prancha de seção-tipo: \`pista\` (semilargura da pista, em metros), \`acostamento\` (largura de cada um),
\`caimento\` em tangente (em %, negativo) e \`faixa_dominio\` (largura total, usada para pôr a cerca).

### projeto.nota_servico

Uma entrada por alinhamento (eixo principal, ramos, interseções), com as notas de serviço de terraplenagem e de
pavimentação juntas, uma linha por estaca:

- \`s\`: posição em metros desde a estaca 0; \`e\` e \`n\`: coordenadas UTM do eixo, no mesmo datum da \`origem\`.
- \`z\`: cota do eixo acabado (nota de pavimentação). \`zt\`: cota do eixo da terraplenagem. \`zn\`: cota do terreno
  natural no eixo.
- \`ie\` e \`id\`: caimento do lado esquerdo e do direito, em %, **negativo quando o bordo é mais baixo que o eixo**.
  Calcule pelas cotas da nota de serviço, (cota do bordo − cota do eixo) ÷ distância × 100, e não pelo sinal que o
  relatório imprime: a convenção de sinal muda de um programa para outro.
- \`le\` e \`ld\`: semilargura da pista naquela estaca, só quando difere da seção-tipo (superlargura, faixa adicional).
- \`esq\` e \`dir\`: a terraplenagem daquele lado, do bordo da plataforma para fora, em pontos \`[afastamento, cota]\`
  com o afastamento sempre positivo: o bordo, as bermas (se houver) e o off-set, que é o último.

A estaca sem \`esq\` e \`dir\` entra só no traçado do eixo. Com eles, o InfraWork monta a seção acabada: pista e
acostamento no caimento informado, o bordo do pavimento, a plataforma, os taludes e as bermas até o off-set. Um
alinhamento só com a nota de pavimentação (sem \`esq\` e \`dir\` em nenhuma estaca) é desenhado só com o pavimento.

O eixo do modelo sai daqui (não é preciso mandar \`eixos\`); cada alinhamento se liga a um local da obra.

### projeto.pavimento

A estrutura do pavimento, **de cima para baixo**, como na seção-tipo de pavimentação. Em cada camada: \`classe\`,
\`onde\` (\`pista\`, \`acostamento\` ou \`tudo\`), \`espessura\` em metros (sem ela é película: imprimação, pintura de
ligação) e \`sobra\` (quanto a camada passa do bordo do acostamento, de cada lado). O InfraWork empilha as camadas
de cada zona e as corta por estaca.

### projeto.terraplenagem e projeto.cubacao

\`terraplenagem\` diz que classe é o \`corte\`, qual é o \`aterro\` e, opcionalmente, a de \`protecao_vegetal\` (semeadura,
hidrossemeadura: é desenhada sobre os taludes). \`cubacao\` traz, por alinhamento, os volumes \`[s, corte, aterro]\`
do intervalo que **termina** na estaca \`s\`, como na planilha de cubação. É por eles que o avanço da terraplenagem
é medido; o InfraWork também calcula os volumes pelas seções e mostra a diferença na importação.

### projeto.pintura

A classe da sinalização horizontal: o InfraWork desenha os bordos da pista e o eixo.

### Dispositivos ao longo do eixo

Todos trazem \`classe\`, \`lado\` (\`"E"\` ou \`"D"\`, no sentido crescente das estacas) e a posição: \`s0\` e \`s1\` para os
lineares, \`s\` para os pontuais. \`eixo\` só é preciso quando há mais de um alinhamento. \`quantidade\` é a do quadro
do projeto, na unidade do serviço (sem ela vale a extensão).

- \`drenagem\`: \`{ "tipo": "STC 73-15", "lado", "s0", "s1", "classe" }\`. \`tipo\` é o código do projeto, com as
  medidas que ele traz (largura e profundidade em centímetros). Famílias no catálogo: \`STC\`/\`SCC\` (sarjeta
  triangular de corte), \`SZC\` (sarjeta trapezoidal), \`MFC\` (meio-fio com sarjeta), \`MF\` (meio-fio), \`VPC…\` e
  \`VPA…\` (valetas de proteção de corte e de aterro; terminadas em \`G\` são de grama) e \`DP…\`/\`DS…\` (drenos). O
  InfraWork põe cada uma no lugar dela na seção: a sarjeta junto ao acostamento, o meio-fio no bordo, a valeta além
  do off-set.
- \`descidas\`: \`{ "s", "lado", "classe" }\`. Descida d'água do bordo do aterro ao pé, com dissipador.
- \`bueiros\`: \`{ "s", "tipo", "diametro", "comprimento", "cota_montante", "cota_jusante", "montante", "esconsidade",
  "classe" }\`. \`tipo\` como no projeto (\`BSTC\`, \`BDTC\`, \`BTTC\`, \`BSCC\`…): a segunda letra dá as linhas e a terceira,
  tubular ou celular (para o celular, \`largura\` e \`altura\` no lugar de \`diametro\`). \`montante\` é o lado de
  montante; \`esconsidade\` em graus, a partir da perpendicular ao eixo.
- \`defensas\`: \`{ "lado", "s0", "s1", "classe" }\`. Lâmina e postes, junto ao acostamento.
- \`cercas\`: \`{ "lado", "s0", "s1", "classe" }\`. Mourões e fios no limite da faixa de domínio (ou em
  \`afastamento\`, em metros do eixo); \`"fauna": true\` para a cerca de condução de fauna.
- \`placas\`: \`{ "s", "lado", "codigo", "classe" }\`. \`codigo\` de sinalização (\`R-19\`, \`A-2b\`, indicativas); a forma e
  a cor saem dele. \`dimensoes\` é o texto das medidas, quando o projeto as traz.
- \`postes\`: \`{ "s", "lado", "classe" }\`. Poste existente ou a relocar.

### Conferência na importação

Ao importar, o InfraWork mostra o que merece conferência: estacas com os dois bordos acima do eixo (seção em V),
plataforma mais estreita que o pavimento, a diferença entre os volumes das seções e os da cubação, dispositivos
fora do catálogo e itens fora das estacas da nota de serviço. Corrija o dado na origem e importe de novo.

## Geometria pronta (versão 1)

\`\`\`json
{
  "formato": "infrawork-4d",
  "versao": 1,
  "nome": "GO-425 · implantação e pavimentação",
  "origem": { "e": 784540, "n": 8216000, "fuso": "22S" },
  "eixos": [{ "id": "E1", "nome": "Eixo principal", "pontos": [[0, 5620.1, 17739.8, 962.0], [10, 5615.9, 17730.7, 962.4]] }],
  "terreno": [{ "nx": 62, "ny": 106, "res": 12, "x0": 5124, "ytop": 17866, "zb": 945, "atual": "<base64>", "projeto": "<base64>" }],
  "classes": [
    { "id": "TERRA.ATERRO", "nome": "Aterro compactado", "disciplina": "Terraplenagem", "servico": "S03", "terreno": true, "material": "aterro" },
    { "id": "PAV.BASE", "nome": "Base", "disciplina": "Pavimentação", "servico": "S06", "material": "granular" },
    { "id": "DREN.STC", "nome": "Sarjeta triangular", "disciplina": "Drenagem", "servico": "S12", "material": "concreto" },
    { "id": "OAC.BUEIROS", "nome": "Bueiros", "disciplina": "Obras de arte correntes", "servico": "S15", "material": "concreto" },
    { "id": "SIN.VERTICAL", "nome": "Sinalização vertical", "disciplina": "Sinalização", "servico": "S19" },
    { "id": "CTX.FAIXA", "nome": "Faixa de domínio", "disciplina": "Contexto", "contexto": true }
  ],
  "secoes": [{ "s": 120, "perfil": [[-8.6, 972.2], [-7.3, 972.5], [0, 972.6], [7.3, 972.5], [8.3, 971.9]] }],
  "camadas": [
    { "classe": "TERRA.ATERRO", "s0": 120, "s1": 140, "faixas": [[-9999, -6.4], [-6.4, 6.4, -0.375], [6.4, 9999]], "quantidade": 161.9 },
    { "classe": "PAV.BASE", "s0": 0, "s1": 22460, "faixas": [[-6.4, 6.4]], "elevacao": -0.025, "espessura": 0.15 }
  ],
  "elementos": [
    { "id": "stc-1", "classe": "DREN.STC", "quantidade": 164.5,
      "geo": { "t": "linha", "pts": [[5443.1, 17388.6, 995.5], [5442.4, 17386.7, 995.7]], "largura": 1.2,
               "perfil": [[-0.6, -0.1], [-0.6, 0.03], [-0.5, 0.03], [0, -0.13], [0.5, 0.03], [0.6, 0.03], [0.6, -0.1]] } },
    { "id": "bueiro-1", "classe": "OAC.BUEIROS", "nome": "BSTC Ø 1,0 · est. 109", "s0": 2180, "s1": 2180, "quantidade": 24.2,
      "geo": { "t": "tubo", "p0": [4185.9, 16364.6, 1029.6], "p1": [4170.2, 16383.0, 1028.4], "diametro": 1.0, "linhas": 1 } },
    { "id": "placa-1", "classe": "SIN.VERTICAL", "nome": "R-19 · est. 12", "s0": 240, "s1": 240, "quantidade": 1,
      "material": "sinal-vermelho", "no_terreno": true,
      "geo": { "t": "placa", "p": [5560.2, 17650.1, 0], "rumo": 1.2, "forma": "circulo", "largura": 0.75 } }
  ]
}
\`\`\`

### eixos

Polilinha do eixo, com um ponto \`[s, x, n, z]\` a cada 10 ou 20 m, em ordem crescente de \`s\`. \`z\` é a cota do
greide. Mais de um eixo (ramos, acessos) é permitido; cada um se liga a um local da obra no InfraWork.

### terreno (opcional, recomendado)

O levantamento topográfico do projeto na faixa da obra, em blocos de grade regular. \`x0\` e \`ytop\` são o canto
noroeste; os pontos andam \`res\` metros para leste a cada coluna e para o sul a cada linha. \`atual\` (o terreno
natural) e \`projeto\` são as cotas em Uint16 little-endian, em base64, valendo centímetros acima de \`zb\` (65535 =
sem dado). Fora da faixa a cena usa o relevo regional aberto (30 m) e o ajusta para encostar no do projeto; sem
\`terreno\`, a obra fica sobre o relevo regional, que erra alguns metros.

### classes

Cada tipo de elemento é uma classe. É a classe que se vincula a um serviço do plano.

- \`servico\`: o **código do serviço no InfraWork** (o serviço do cronograma, por exemplo "S06"). Com ele o vínculo
  já vem pronto na importação. Sem ele, o vínculo é feito na tela.
- \`contexto: true\`: só aparece na cena (faixa de domínio, interferências); não entra no 4D.
- \`terreno: true\`: classes de terraplenagem. Onde elas avançam, o terreno natural sai e a obra aparece.
- \`material\`: a cor da peça na cena. Um de: corte, aterro, solo, granular, betume, asfalto, concreto, metal,
  madeira, grama, sinal-branco, sinal-amarelo, sinal-vermelho, sinal-verde, sinal-azul, contexto. Sem ele, o InfraWork
  escolhe pelo nome. Camadas e elementos podem trazer o seu próprio \`material\` (a placa vermelha, a faixa amarela).
- Use uma classe por serviço do plano. Se o plano separa sub-base e base, o modelo também separa.

### secoes e camadas (a plataforma)

\`secoes\` descreve a seção transversal **acabada** em cada estaca (a cada 20 m ou menos): pontos \`[afastamento,
cota]\` da esquerda para a direita, do off-set ao off-set, passando pelos bordos e pelo eixo. As pontas são os
off-sets: é entre elas que o terreno natural dá lugar à obra. \`camadas\` diz que classe ocupa que faixa de
afastamento entre duas estacas. O InfraWork corta cada camada em fatias, uma por intervalo de seção, e cada fatia
tem o seu estado.

- \`faixas\`: uma ou mais faixas \`[de, até]\` de afastamento. Um valor além do perfil vale até a ponta da seção
  (use -9999 e 9999 para "até o off-set"). Um terceiro número sobe ou desce só aquela faixa.
- \`elevacao\`: o topo da camada em relação ao perfil acabado, em metros (negativo = abaixo dele).
- \`espessura\`: com ela a camada é um sólido, do topo para baixo. Mande a espessura real de cada camada do
  pavimento e empilhe de cima para baixo: a de cima tem \`elevacao\` 0, a seguinte tem menos a espessura da de cima,
  e assim por diante. Camada sem corpo (imprimação, pintura) vai sem \`espessura\`.
- Terraplenagem: uma camada por intervalo de seção, com o volume da cubação em \`quantidade\` (o avanço é medido
  por ele). Separe corte e aterro. Os taludes vão até o off-set; sob o pavimento, desça a faixa até o subleito
  (o terceiro número da faixa = menos a espessura total do pavimento).
- \`quantidade\`: a quantidade do serviço naquele trecho, na unidade do serviço.

### elementos

Tudo o que não é camada da plataforma. \`id\` único e estável. \`quantidade\` na unidade do serviço (metros de
sarjeta, 1 por dispositivo). \`s0\` e \`s1\` são opcionais: sem eles o InfraWork projeta a geometria no eixo.
\`no_terreno: true\` assenta a peça no terreno natural (cerca, placa, poste): a cota informada é ignorada.

- \`{ "t": "linha", "pts": [...], "largura": 1.2, "perfil": [[lateral, vertical], ...] }\`: peça ao longo de uma
  polilinha. \`perfil\` é a seção da peça como no projeto-tipo (sarjeta, meio-fio, valeta), extrudada pela linha.
  Sem \`perfil\`, é um prisma de \`largura\` × \`altura\`. Com \`postes\` (\`{ "passo": 2.5, "altura": 1.6 }\`) e \`fios\`
  (alturas em metros), faz cerca e defensa. É cortada em peças de até 20 m de eixo.
- \`{ "t": "caixa", "p": [x, n, z], "dim": [comprimento, largura, altura], "rumo": 1.57 }\`: dispositivos e
  terminais. \`rumo\` em radianos a partir do leste.
- \`{ "t": "tubo", "p0": [...], "p1": [...], "diametro": 1.0, "linhas": 2 }\`: bueiro tubular, com as bocas (testa,
  soleira e alas) desenhadas nas pontas; para o celular, \`largura\` e \`altura\` no lugar de \`diametro\`. \`p0\` e
  \`p1\` são a base da peça em cada boca.
- \`{ "t": "placa", "p": [...], "rumo": 1.2, "forma": "circulo", "largura": 0.75 }\`: placa em poste. \`forma\`:
  circulo, losango, octogono, triangulo ou retangulo (este com \`altura\`). \`rumo\` é para onde a face olha.
- \`{ "t": "malha", "pos": [x, n, z, ...], "idx": [...] }\`: malha de triângulos pronta, para o que não couber nos
  outros tipos.

## O que faz um bom modelo

0. Rodovia com nota de serviço vai em dados de projeto (versão 2): as tabelas entram como estão no projeto.
1. Origem e fuso certos: a obra tem de cair sobre o traçado na imagem de satélite.
2. Todo elemento com estaca certa: é ela que liga o elemento ao plano e à produção.
3. Uma classe por serviço do plano, com o código em \`servico\`.
4. Geometria do projeto, não genérica: seções da nota de serviço, espessuras do quadro de pavimentação, perfis dos
   dispositivos de drenagem do projeto-tipo, bueiros com diâmetro, linhas e esconsidade reais.
5. Quantidade nas camadas de terraplenagem (volume por intervalo) e nos elementos lineares (comprimento).
6. Arquivo de até 40 MB. Arredonde as coordenadas a 2 casas.
`
