<!-- O contrato abaixo é o texto de src/features/modelo4d/lib/contrato-texto.ts (um teste mantém os dois iguais). -->

# Modelo 4D: como gerar e importar

O Acompanhamento 4D (Acompanhamento › Acompanhamento 4D, em beta) mostra a obra em 3D sobre o terreno real, com
imagem de satélite, e no tempo: o previsto da linha de base e o realizado dos lançamentos, pela estaca. O modelo
entra por um destes caminhos:

1. **HTML da construção digital** (o visualizador autônomo gerado no Claude): a importação lê os dados do próprio
   HTML e converte para o contrato. Não traz o serviço de cada classe: o vínculo é sugerido pelo nome e conferido
   na tela.
2. **Arquivo no contrato `infrawork-4d`** (`.json`), gerado com o **prompt do modelo**: o botão "Prompt do
   modelo" da tela monta o texto com este contrato, o estaqueamento e os serviços da linha de base da obra. Cole no
   Claude aberto na pasta de projeto. O modelo sai com o código do serviço em cada classe e o vínculo vem pronto.
3. **Pelo MCP**: `modelo_da_obra.contexto` devolve o mesmo prompt, e `modelo_da_obra.enviar` importa o arquivo e vincula.
   Com o MCP ligado, o Claude lê o plano, gera o modelo e envia sem passar pela tela.

Como o vínculo funciona: cada **classe** do modelo aponta para um serviço do plano e cada **eixo** para um local da
obra. A estaca de cada peça decide quando ela é prevista e quando foi feita. Serviço vinculado passa a exigir o
local com estacas no lançamento; produção sem estaca conta nos percentuais, mas não aparece na cena.

Para a skill `construcao-digital-rodovia`: além do HTML, grave o `modelo.iw4d.json` neste contrato. Os dados são
os mesmos que o HTML já embute (eixo, seções, terreno, cubação, camadas de pavimento, drenagem, bueiros, obras
complementares e sinalização).

# Contrato do modelo 4D do InfraWork (infrawork-4d, versão 1)

Um arquivo JSON (UTF-8) com a obra em 3D, pronto para o Acompanhamento 4D do InfraWork. A cena põe a obra sobre o
terreno real com imagem de satélite e cruza cada peça com o plano (linha de base) e com a produção lançada **pela
estaca**. O que importa em cada elemento é a classe (que serviço ele é), onde ele fica no eixo e a geometria fiel
ao projeto.

## Convenções

- Coordenadas locais em metros: `x` (leste), `n` (norte), `z` (cota). Um ponto é `[x, n, z]`.
- `origem` é **obrigatória**: o UTM do ponto (0, 0) local e o fuso (`"22S"`). É ela que põe a obra no lugar certo do
  terreno e da imagem de satélite. Use o datum do projeto (SIRGAS 2000) e confira com uma coordenada conhecida.
- Posição no eixo (`s`): metros desde a estaca 0 do projeto. Estaca 100 = 2000; km 12+500 = 12500. É o mesmo
  estaqueamento do plano no InfraWork.
- Afastamento do eixo: negativo = lado esquerdo, positivo = lado direito (no sentido crescente das estacas).

## Estrutura

```json
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
```

### eixos

Polilinha do eixo, com um ponto `[s, x, n, z]` a cada 10 ou 20 m, em ordem crescente de `s`. `z` é a cota do
greide. Mais de um eixo (ramos, acessos) é permitido; cada um se liga a um local da obra no InfraWork.

### terreno (opcional, recomendado)

O levantamento topográfico do projeto na faixa da obra, em blocos de grade regular. `x0` e `ytop` são o canto
noroeste; os pontos andam `res` metros para leste a cada coluna e para o sul a cada linha. `atual` (o terreno
natural) e `projeto` são as cotas em Uint16 little-endian, em base64, valendo centímetros acima de `zb` (65535 =
sem dado). Fora da faixa a cena usa o relevo regional aberto (30 m) e o ajusta para encostar no do projeto; sem
`terreno`, a obra fica sobre o relevo regional, que erra alguns metros.

### classes

Cada tipo de elemento é uma classe. É a classe que se vincula a um serviço do plano.

- `servico`: o **código do serviço no InfraWork** (o serviço do cronograma, por exemplo "S06"). Com ele o vínculo
  já vem pronto na importação. Sem ele, o vínculo é feito na tela.
- `contexto: true`: só aparece na cena (faixa de domínio, interferências); não entra no 4D.
- `terreno: true`: classes de terraplenagem. Onde elas avançam, o terreno natural sai e a obra aparece.
- `material`: a cor da peça na cena. Um de: corte, aterro, solo, granular, betume, asfalto, concreto, metal,
  madeira, sinal-branco, sinal-amarelo, sinal-vermelho, sinal-verde, sinal-azul, contexto. Sem ele, o InfraWork
  escolhe pelo nome. Camadas e elementos podem trazer o seu próprio `material` (a placa vermelha, a faixa amarela).
- Use uma classe por serviço do plano. Se o plano separa sub-base e base, o modelo também separa.

### secoes e camadas (a plataforma)

`secoes` descreve a seção transversal **acabada** em cada estaca (a cada 20 m ou menos): pontos `[afastamento,
cota]` da esquerda para a direita, do off-set ao off-set, passando pelos bordos e pelo eixo. As pontas são os
off-sets: é entre elas que o terreno natural dá lugar à obra. `camadas` diz que classe ocupa que faixa de
afastamento entre duas estacas. O InfraWork corta cada camada em fatias, uma por intervalo de seção, e cada fatia
tem o seu estado.

- `faixas`: uma ou mais faixas `[de, até]` de afastamento. Um valor além do perfil vale até a ponta da seção
  (use -9999 e 9999 para "até o off-set"). Um terceiro número sobe ou desce só aquela faixa.
- `elevacao`: o topo da camada em relação ao perfil acabado, em metros (negativo = abaixo dele).
- `espessura`: com ela a camada é um sólido, do topo para baixo. Mande a espessura real de cada camada do
  pavimento e empilhe de cima para baixo: a de cima tem `elevacao` 0, a seguinte tem menos a espessura da de cima,
  e assim por diante. Camada sem corpo (imprimação, pintura) vai sem `espessura`.
- Terraplenagem: uma camada por intervalo de seção, com o volume da cubação em `quantidade` (o avanço é medido
  por ele). Separe corte e aterro. Os taludes vão até o off-set; sob o pavimento, desça a faixa até o subleito
  (o terceiro número da faixa = menos a espessura total do pavimento).
- `quantidade`: a quantidade do serviço naquele trecho, na unidade do serviço.

### elementos

Tudo o que não é camada da plataforma. `id` único e estável. `quantidade` na unidade do serviço (metros de
sarjeta, 1 por dispositivo). `s0` e `s1` são opcionais: sem eles o InfraWork projeta a geometria no eixo.
`no_terreno: true` assenta a peça no terreno natural (cerca, placa, poste): a cota informada é ignorada.

- `{ "t": "linha", "pts": [...], "largura": 1.2, "perfil": [[lateral, vertical], ...] }`: peça ao longo de uma
  polilinha. `perfil` é a seção da peça como no projeto-tipo (sarjeta, meio-fio, valeta), extrudada pela linha.
  Sem `perfil`, é um prisma de `largura` × `altura`. Com `postes` (`{ "passo": 2.5, "altura": 1.6 }`) e `fios`
  (alturas em metros), faz cerca e defensa. É cortada em peças de até 20 m de eixo.
- `{ "t": "caixa", "p": [x, n, z], "dim": [comprimento, largura, altura], "rumo": 1.57 }`: dispositivos e
  terminais. `rumo` em radianos a partir do leste.
- `{ "t": "tubo", "p0": [...], "p1": [...], "diametro": 1.0, "linhas": 2 }`: bueiro tubular, com as bocas (testa,
  soleira e alas) desenhadas nas pontas; para o celular, `largura` e `altura` no lugar de `diametro`. `p0` e
  `p1` são a base da peça em cada boca.
- `{ "t": "placa", "p": [...], "rumo": 1.2, "forma": "circulo", "largura": 0.75 }`: placa em poste. `forma`:
  circulo, losango, octogono, triangulo ou retangulo (este com `altura`). `rumo` é para onde a face olha.
- `{ "t": "malha", "pos": [x, n, z, ...], "idx": [...] }`: malha de triângulos pronta, para o que não couber nos
  outros tipos.

## O que faz um bom modelo

1. Origem e fuso certos: a obra tem de cair sobre o traçado na imagem de satélite.
2. Todo elemento com estaca certa: é ela que liga o elemento ao plano e à produção.
3. Uma classe por serviço do plano, com o código em `servico`.
4. Geometria do projeto, não genérica: seções da nota de serviço, espessuras do quadro de pavimentação, perfis dos
   dispositivos de drenagem do projeto-tipo, bueiros com diâmetro, linhas e esconsidade reais.
5. Quantidade nas camadas de terraplenagem (volume por intervalo) e nos elementos lineares (comprimento).
6. Arquivo de até 40 MB. Arredonde as coordenadas a 2 casas.
