import { storageKey } from '@/lib/storage-keys'
import type { Material } from '../lib/contrato'

/**
 * Aparência da cena 4D: o estilo de exibição (textura por material, cor lisa ou linhas), a luz (da câmera ou do
 * sol) e os efeitos. Os shaders são nossos: a cor da peça continua vindo do estado, e o material (no canal alfa da
 * cor) escolhe o padrão que a modula.
 */

export type Estilo = 'realista' | 'sombreado' | 'linhas'
export type Luz = 'frontal' | 'sol'

export interface Exibicao {
  estilo: Estilo
  luz: Luz
  /** Sombras projetadas; só com a luz do sol. */
  sombras: boolean
  /** Sombra de contato entre as peças (oclusão de ambiente). */
  contato: boolean
}

export const EXIBICAO_PADRAO: Exibicao = {
  estilo: 'realista',
  luz: 'frontal',
  sombras: true,
  contato: true
}

const CHAVE = storageKey('modelo4d.exibicao')

export function lerExibicao(): Exibicao {
  try {
    const v = JSON.parse(window.localStorage.getItem(CHAVE) ?? 'null') as Partial<Exibicao> | null
    return {
      estilo:
        v?.estilo === 'sombreado' || v?.estilo === 'linhas' ? v.estilo : EXIBICAO_PADRAO.estilo,
      luz: v?.luz === 'sol' ? 'sol' : EXIBICAO_PADRAO.luz,
      sombras: typeof v?.sombras === 'boolean' ? v.sombras : EXIBICAO_PADRAO.sombras,
      contato: typeof v?.contato === 'boolean' ? v.contato : EXIBICAO_PADRAO.contato
    }
  } catch {
    return EXIBICAO_PADRAO
  }
}

export function gravarExibicao(e: Exibicao): void {
  try {
    window.localStorage.setItem(CHAVE, JSON.stringify(e))
  } catch {
    // sem armazenamento, a escolha vale só nesta visita
  }
}

/** Padrão de cada material no shader; vai no canal alfa da cor da peça (0 = sem padrão). */
const PADRAO = { liso: 0, solo: 1, granular: 2, asfalto: 3, concreto: 4, grama: 5, madeira: 6 }

export const PADRAO_DO_MATERIAL: Record<Material, number> = {
  corte: PADRAO.solo,
  aterro: PADRAO.solo,
  solo: PADRAO.solo,
  granular: PADRAO.granular,
  betume: PADRAO.asfalto,
  asfalto: PADRAO.asfalto,
  concreto: PADRAO.concreto,
  metal: PADRAO.liso,
  madeira: PADRAO.madeira,
  grama: PADRAO.grama,
  'sinal-branco': PADRAO.liso,
  'sinal-amarelo': PADRAO.liso,
  'sinal-vermelho': PADRAO.liso,
  'sinal-verde': PADRAO.liso,
  'sinal-azul': PADRAO.liso,
  contexto: PADRAO.liso
}

/** Vértice: o do Cesium, mais a posição para o padrão e a vertical do lugar para a luz do céu. */
export const VERTICE = `
in vec3 position3DHigh;
in vec3 position3DLow;
in vec3 normal;
in vec4 color;
in float batchId;

out vec3 v_positionEC;
out vec3 v_normalEC;
out vec4 v_color;
out vec3 v_padrao;
out vec3 v_cimaEC;

void main()
{
    vec4 p = czm_computePosition();

    v_positionEC = (czm_modelViewRelativeToEye * p).xyz;
    v_normalEC = czm_normal * normal;
    v_color = color;
    // a parte baixa da posição tem precisão de milímetros e não se mexe com a câmera: serve de coordenada do padrão
    v_padrao = position3DLow;
    v_cimaEC = czm_normal * normalize(position3DHigh + position3DLow);

    gl_Position = czm_modelViewProjectionRelativeToEye * p;
}
`

const RUIDO = `
float acaso(vec3 p)
{
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float ruido(vec3 x)
{
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(mix(acaso(i), acaso(i + vec3(1.0, 0.0, 0.0)), f.x),
            mix(acaso(i + vec3(0.0, 1.0, 0.0)), acaso(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
        mix(mix(acaso(i + vec3(0.0, 0.0, 1.0)), acaso(i + vec3(1.0, 0.0, 1.0)), f.x),
            mix(acaso(i + vec3(0.0, 1.0, 1.0)), acaso(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
        f.z);
}

// Grão fino: a coordenada (até 65 km) vezes a escala passaria da precisão do float e o grão viraria um
// quadriculado. Por isso a coordenada dá a volta a cada 64 m, e a grade do ruído repete no mesmo período, sem emenda.
float grao(vec3 p, float escala)
{
    vec3 x = (p - floor(p / 64.0) * 64.0) * escala;
    float per = 64.0 * escala;
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    vec3 j = mod(i + 1.0, per);
    return mix(
        mix(mix(acaso(i), acaso(vec3(j.x, i.y, i.z)), f.x),
            mix(acaso(vec3(i.x, j.y, i.z)), acaso(vec3(j.x, j.y, i.z)), f.x), f.y),
        mix(mix(acaso(vec3(i.x, i.y, j.z)), acaso(vec3(j.x, i.y, j.z)), f.x),
            mix(acaso(vec3(i.x, j.y, j.z)), acaso(vec3(j.x, j.y, j.z)), f.x), f.y),
        f.z);
}

float nuvem(vec3 p)
{
    return 0.55 * ruido(p) + 0.3 * ruido(p * 2.1) + 0.15 * ruido(p * 4.3);
}
`

/** Fragmento da peça para o estilo e a luz escolhidos. */
export function fragmento(estilo: Estilo, luz: Luz): string {
  return `
${estilo === 'realista' ? '#define REALISTA' : ''}
${estilo === 'linhas' ? '#define LINHAS' : ''}
${luz === 'sol' ? '#define SOL' : ''}

in vec3 v_positionEC;
in vec3 v_normalEC;
in vec4 v_color;
in vec3 v_padrao;
in vec3 v_cimaEC;
${RUIDO}
void main()
{
    vec3 n = normalize(v_normalEC);
    n = faceforward(n, vec3(0.0, 0.0, 1.0), -n);
    vec3 cima = normalize(v_cimaEC);
    vec3 base = czm_gammaCorrect(vec4(v_color.rgb, 1.0)).rgb;

#ifdef REALISTA
    float padrao = floor(v_color.a * 255.0 + 0.5);
    float dist = length(v_positionEC);
    // o grão some de longe, para não cintilar; as manchas largas ficam
    float perto = 1.0 - smoothstep(12.0, 70.0, dist);
    float medio = 1.0 - smoothstep(150.0, 900.0, dist);
    if (padrao > 0.5) {
        float fino = 0.6 * grao(v_padrao, 38.0) + 0.4 * grao(v_padrao, 13.0) - 0.5;
        float mancha = nuvem(v_padrao * 0.9) - 0.5;
        float larga = ruido(v_padrao * 0.07) - 0.5;
        if (padrao < 1.5) {
            // solo: torrões, veios e variação de tom
            base *= 1.0 + 0.22 * mancha * medio + 0.16 * fino * perto + 0.14 * larga;
            base = mix(base, base * vec3(1.08, 0.96, 0.86), clamp(larga + 0.5, 0.0, 1.0) * 0.5);
        } else if (padrao < 2.5) {
            // granular: brita miúda
            base *= 1.0 + 0.3 * fino * perto + 0.1 * mancha * medio;
        } else if (padrao < 3.5) {
            // asfalto: grão fino e manchas suaves de rolagem
            base *= 1.0 + 0.24 * fino * perto + 0.1 * mancha * medio + 0.06 * larga;
        } else if (padrao < 4.5) {
            // concreto: nuvens claras e poros
            base *= 1.0 + 0.1 * mancha * medio + 0.08 * fino * perto;
        } else if (padrao < 5.5) {
            // grama: tufos, falhas secas e trechos mais verdes
            float tufo = grao(v_padrao, 9.0) - 0.5;
            base *= 1.0 + 0.3 * tufo * perto + 0.26 * mancha * medio;
            base = mix(base, base * vec3(1.25, 1.12, 0.7), smoothstep(0.1, 0.45, larga + 0.35 * mancha) * 0.55);
        } else {
            // madeira: veios ao longo da peça
            base *= 1.0 + 0.2 * (grao(v_padrao, 30.0) - 0.5) * perto;
        }
    }
#endif
#ifdef LINHAS
    // linhas ocultas: superfície clara, com um resto da cor para o estado continuar legível
    base = mix(vec3(0.94), base, 0.22);
#endif

    // luz do céu de cima e rebatida do chão por baixo, mais a luz principal
    float ceu = 0.5 + 0.5 * dot(n, cima);
    vec3 ambiente = mix(vec3(0.40, 0.38, 0.36), vec3(0.60, 0.64, 0.70), ceu);
#ifdef SOL
    float direta = max(dot(n, czm_lightDirectionEC), 0.0);
    vec3 cor = base * (ambiente * 1.05 + direta * 0.55 * czm_lightColor);
#else
    // luz frontal: parte da câmera, um pouco de cima e de lado, e nenhuma face fica preta
    float direta = max(dot(n, normalize(vec3(0.2, 0.4, 1.0))), 0.0);
    vec3 cor = base * (ambiente * 0.8 + direta * 0.6);
#endif

    out_FragColor = vec4(cor, 1.0);
}
`
}

/**
 * Arestas depois da cena: onde o inverso da profundidade deixa de ser linear na tela há uma quina ou um contorno.
 * `forca` vai de 0 (sem aresta) a 1 (linha cheia).
 */
export const ARESTAS = `
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
uniform float forca;
in vec2 v_textureCoordinates;

float inverso(vec2 desvio)
{
    vec2 uv = v_textureCoordinates + desvio / czm_viewport.zw;
    float d = czm_readDepth(depthTexture, uv);
    vec4 p = czm_inverseProjection * vec4(2.0 * uv - 1.0, d, 1.0);
    return p.w / p.z;
}

void main()
{
    vec4 cor = texture(colorTexture, v_textureCoordinates);
    float d = czm_readDepth(depthTexture, v_textureCoordinates);
    if (forca <= 0.0 || d >= 1.0) {
        out_FragColor = cor;
        return;
    }
    float c = inverso(vec2(0.0));
    float passo = czm_pixelRatio;
    float h = inverso(vec2(passo, 0.0)) + inverso(vec2(-passo, 0.0)) - 2.0 * c;
    float v = inverso(vec2(0.0, passo)) + inverso(vec2(0.0, -passo)) - 2.0 * c;
    // relativo à própria profundidade, para a linha ter o mesmo peso perto e longe
    float quina = (abs(h) + abs(v)) / abs(c);
    float aresta = smoothstep(0.004, 0.02, quina);
    out_FragColor = vec4(mix(cor.rgb, cor.rgb * 0.25, aresta * forca), cor.a);
}
`

/** Peso das arestas em cada estilo. */
export const FORCA_ARESTA: Record<Estilo, number> = { realista: 0.3, sombreado: 0.55, linhas: 1 }
