import { Color, SRGBColorSpace } from 'three'
import type { Classe4D } from '../lib/contrato'

let tela: CanvasRenderingContext2D | null = null

/** Cor de um token do tema, já no espaço de trabalho do three (o tema é em oklch, que o three não lê). */
export function cor(nome: string): Color {
  const valor = getComputedStyle(document.documentElement).getPropertyValue(`--${nome}`).trim()
  tela ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!tela || !valor) return new Color(0.5, 0.5, 0.5)
  tela.clearRect(0, 0, 1, 1)
  tela.fillStyle = valor
  tela.fillRect(0, 0, 1, 1)
  const [r, g, b] = tela.getImageData(0, 0, 1, 1).data
  return new Color().setRGB(r / 255, g / 255, b / 255, SRGBColorSpace)
}

const sem = (t: string): string => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Token de material de uma classe, pelo nome: a cena mostra a obra com cara de obra nos modos previsto e realizado. */
export function tokenDoMaterial(c: Classe4D): string {
  if (c.contexto) return 'm4d-contexto'
  const t = sem(`${c.id} ${c.nome} ${c.disciplina}`)
  if (/sinaliza|placa|pintura de faixa/.test(t)) return 'm4d-sinal'
  if (/corte|escava/.test(t)) return 'm4d-corte'
  if (/aterro|terraplen|compacta/.test(t)) return 'm4d-aterro'
  if (/imprima|pintura de liga|betum/.test(t)) return 'm4d-betume'
  if (/tratamento superficial|tsd|cbuq|cauq|asfalt|micro|revest|capa/.test(t)) return 'm4d-asfalto'
  if (/sub-?base|base|regulariza|subleito|granul|brita|paviment/.test(t)) return 'm4d-granular'
  if (/defensa|cerca|metal|terminal/.test(t)) return 'm4d-metal'
  return 'm4d-concreto'
}
