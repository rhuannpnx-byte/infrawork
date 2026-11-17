/**
 * O contrato `infrawork-4d` em texto, para quem gera o modelo (prompt da tela, ferramenta do MCP e
 * `docs/MODELO-4D.md`, que um teste mantém igual a este texto).
 */
export const CONTRATO_TEXTO = `# Contrato do modelo 4D do InfraWork (infrawork-4d, versão 1)

Um arquivo JSON (UTF-8) com a obra em 3D, pronto para o Acompanhamento 4D do InfraWork. O InfraWork cruza cada
peça do modelo com o plano (linha de base) e com a produção lançada **pela estaca**: o que importa em cada
elemento é a classe (que serviço ele é) e onde ele fica no eixo.

## Convenções

- Coordenadas locais em metros: \`x\` (leste), \`n\` (norte), \`z\` (cota). Um ponto é \`[x, n, z]\`. Use uma origem
  perto da obra (por exemplo UTM menos um deslocamento) e informe-a em \`origem\`.
- Posição no eixo (\`s\`): metros desde a estaca 0 do projeto. Estaca 100 = 2000; km 12+500 = 12500. É o mesmo
  estaqueamento do plano no InfraWork.
- Afastamento do eixo: negativo = lado esquerdo, positivo = lado direito (no sentido crescente das estacas).

## Estrutura

\`\`\`json
{
  "formato": "infrawork-4d",
  "versao": 1,
  "nome": "GO-425 · implantação e pavimentação",
  "origem": { "e": 784540, "n": 8216000, "fuso": "22S" },
  "eixos": [{ "id": "E1", "nome": "Eixo principal", "pontos": [[0, 5620.1, 17739.8, 962.0], [10, 5615.9, 17730.7, 962.4]] }],
  "terreno": [{ "nx": 62, "ny": 106, "res": 12, "x0": 5124, "ytop": 17866, "zb": 945, "atual": "<base64>", "projeto": "<base64>", "imagem": "<jpeg base64>" }],
  "classes": [
    { "id": "TERRA.ATERRO", "nome": "Aterro compactado", "disciplina": "Terraplenagem", "servico": "S03", "terreno": true },
    { "id": "PAV.BASE", "nome": "Base", "disciplina": "Pavimentação", "servico": "S06" },
    { "id": "CTX.FAIXA", "nome": "Faixa de domínio", "disciplina": "Contexto", "contexto": true }
  ],
  "secoes": [{ "s": 120, "perfil": [[-8.6, 972.2], [-7.3, 972.5], [0, 972.6], [7.3, 972.5], [8.3, 971.9]] }],
  "camadas": [
    { "classe": "TERRA.ATERRO", "s0": 120, "s1": 140, "faixas": [[-8.6, 8.3]], "quantidade": 161.9 },
    { "classe": "PAV.BASE", "s0": 0, "s1": 22460, "faixas": [[-6.4, 6.4]], "elevacao": 0.15 }
  ],
  "elementos": [
    { "id": "stc-1", "classe": "DREN.STC", "quantidade": 164.5, "geo": { "t": "linha", "pts": [[5443.1, 17388.6, 995.5], [5442.4, 17386.7, 995.7]], "largura": 1.0 } },
    { "id": "bueiro-1", "classe": "OAC.BUEIROS", "nome": "BSTC Ø 1,0 · est. 109", "s0": 2180, "s1": 2180, "quantidade": 24.2,
      "geo": { "t": "tubo", "p0": [4185.9, 16364.6, 1030.6], "p1": [4170.2, 16383.0, 1029.4], "diametro": 1.0, "linhas": 1 } }
  ]
}
\`\`\`

### eixos

Polilinha do eixo, com um ponto \`[s, x, n, z]\` a cada 10 ou 20 m, em ordem crescente de \`s\`. \`z\` é a cota do
greide. Mais de um eixo (ramos, acessos) é permitido; cada um se liga a um local da obra no InfraWork.

### terreno (opcional)

Blocos de grade regular. \`x0\` e \`ytop\` são o canto noroeste; os pontos andam \`res\` metros para leste a cada
coluna e para o sul a cada linha. \`atual\` e \`projeto\` são as cotas em Uint16 little-endian, em base64, valendo
centímetros acima de \`zb\` (65535 = sem dado). Com \`projeto\`, o terreno muda do atual para o de projeto conforme a
terraplenagem avança. \`imagem\` é um JPEG (ortofoto) estendido sobre o bloco; \`imagem_larg\` e \`imagem_alt\` dizem
quantos metros ela cobre quando é maior que a grade.

### classes

Cada tipo de elemento é uma classe. É a classe que se vincula a um serviço do plano.

- \`servico\`: o **código do serviço no InfraWork** (o serviço do cronograma, por exemplo "S06"). Com ele o vínculo
  já vem pronto na importação. Sem ele, o vínculo é feito na tela.
- \`contexto: true\`: só aparece na cena (faixa de domínio, interferências, jazidas); não entra no 4D.
- \`terreno: true\`: classes de terraplenagem cujo avanço move o terreno.
- Use uma classe por serviço do plano. Se o plano separa sub-base e base, o modelo também separa.

### secoes e camadas (a plataforma)

\`secoes\` descreve a seção transversal acabada em cada estaca: pontos \`[afastamento, cota]\` da esquerda para a
direita (off-set, bordo, eixo, bordo, off-set). \`camadas\` diz que classe ocupa que faixa de afastamento entre duas
estacas. O InfraWork corta cada camada em fatias, uma por intervalo de seção, e cada fatia tem o seu estado.

- \`faixas\`: uma ou mais faixas \`[de, até]\` de afastamento. Um valor além do perfil vale até a ponta da seção
  (use -9999 e 9999 para "até o off-set").
- \`elevacao\`: metros acima do perfil, para empilhar as camadas do pavimento na ordem de execução.
- \`quantidade\`: a quantidade do serviço naquele trecho, na unidade do serviço. Na terraplenagem, mande uma
  camada por intervalo de seção com o volume da cubação: o avanço é medido por ele.

### elementos

Tudo o que não é camada da plataforma. \`id\` único e estável. \`quantidade\` na unidade do serviço (metros de
sarjeta, 1 por dispositivo). \`s0\` e \`s1\` são opcionais: sem eles o InfraWork projeta a geometria no eixo.

- \`{ "t": "linha", "pts": [...], "largura": 1.0, "altura": 0.2 }\`: sarjeta, meio-fio, valeta, dreno, cerca,
  defensa. É cortada em peças de até 20 m de eixo.
- \`{ "t": "caixa", "p": [x, n, z], "dim": [comprimento, largura, altura], "rumo": 1.57 }\`: dispositivos, placas,
  terminais. \`rumo\` em radianos a partir do leste.
- \`{ "t": "tubo", "p0": [...], "p1": [...], "diametro": 1.0, "linhas": 2 }\`: bueiro tubular; para o celular,
  \`largura\` e \`altura\` no lugar de \`diametro\`.
- \`{ "t": "malha", "pos": [x, n, z, ...], "idx": [...] }\`: malha de triângulos pronta.

## O que faz um bom modelo

1. Todo elemento com estaca certa: é ela que liga o elemento ao plano e à produção.
2. Uma classe por serviço do plano, com o código em \`servico\`.
3. Quantidade nas camadas de terraplenagem (volume por intervalo) e nos elementos lineares (comprimento).
4. Arquivo de até 40 MB. Arredonde as coordenadas a 2 casas.
`
