/**
 * PROVISÓRIO — Apresentação ÉTICA.
 *
 * Quando o login é `etica@infrawork.com.br`, o app mostra só a obra 6.508 e
 * mascara na TELA o nome/código da obra e o nome da empresa. Nada muda no
 * banco: os dados exibidos são os reais da 6.508.
 *
 * Para remover: apagar este arquivo e a chamada `aplicarApresentacaoEtica`
 * em `stores/auth-store.ts` (fetchMe).
 */
import type { MePayload } from '@/types/auth'

const EMAIL = 'etica@infrawork.com.br'
const OBRA_CODIGO = '6.508'
const EMPRESA_NOME = 'Apresentação ÉTICA'

const REGRAS: Array<[RegExp, string]> = [
  [/Tecpav Engenharia Ltda\.?/gi, EMPRESA_NOME],
  [/Rota Verde\s*-\s*Tec\s?Pav/gi, 'Restauração Rodoviária'],
  [/Rota Verde/gi, 'Restauração Rodoviária'],
  [/Tec\s?Pav/gi, 'Ética'],
  [/(?<![\d.,-])6\.508(?![\d,])/g, 'EX-001'],
  [/\bRVG\b/g, 'EX']
]
const TEM_ALVO = /tec\s?pav|rota verde|6\.508|\bRVG\b/i

export function mascarar(texto: string): string {
  if (!TEM_ALVO.test(texto)) return texto
  let r = texto
  for (const [re, sub] of REGRAS) r = r.replace(re, sub)
  return r
}

// ─── Máscara no DOM ──────────────────────────────────────────────────────────
// Reescreve textos, atributos visíveis e valores de campos conforme a tela
// renderiza (tabelas, gráficos SVG, mapa, abas, títulos).

const ATRIBUTOS = ['title', 'placeholder', 'aria-label']
let observer: MutationObserver | null = null
let varreduraCampos: ReturnType<typeof setInterval> | null = null

function mascararAtributos(el: Element): void {
  for (const a of ATRIBUTOS) {
    const v = el.getAttribute(a)
    if (v) {
      const m = mascarar(v)
      if (m !== v) el.setAttribute(a, m)
    }
  }
}

function mascararNo(no: Node): void {
  if (no.nodeType === Node.TEXT_NODE) {
    const v = no.nodeValue
    if (v) {
      const m = mascarar(v)
      if (m !== v) no.nodeValue = m
    }
    return
  }
  if (no.nodeType !== Node.ELEMENT_NODE) return
  const el = no as Element
  if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return
  mascararAtributos(el)
  el.querySelectorAll(ATRIBUTOS.map((a) => `[${a}]`).join(',')).forEach(mascararAtributos)
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let t = walker.nextNode(); t; t = walker.nextNode()) mascararNo(t)
}

function mascararCampos(): void {
  document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea').forEach((el) => {
    const m = mascarar(el.value)
    if (m !== el.value) el.value = m
  })
}

function ligar(): void {
  if (observer) return
  mascararNo(document.body)
  observer = new MutationObserver((mutacoes) => {
    for (const mu of mutacoes) {
      if (mu.type === 'characterData') mascararNo(mu.target)
      else if (mu.type === 'attributes') mascararAtributos(mu.target as Element)
      else mu.addedNodes.forEach(mascararNo)
    }
  })
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ATRIBUTOS
  })
  varreduraCampos = setInterval(mascararCampos, 500)
}

function desligar(): void {
  observer?.disconnect()
  observer = null
  if (varreduraCampos) clearInterval(varreduraCampos)
  varreduraCampos = null
}

/** Aplicado ao payload do /me: liga/desliga a máscara conforme o usuário. */
export function aplicarApresentacaoEtica(me: MePayload): MePayload {
  if (me.profile.email?.toLowerCase() !== EMAIL) {
    desligar()
    return me
  }
  ligar()
  return {
    ...me,
    empresa: me.empresa ? { ...me.empresa, nome: EMPRESA_NOME } : me.empresa,
    obras: me.obras
      .filter((o) => o.codigo === OBRA_CODIGO)
      .map((o) => ({ ...o, nome: mascarar(o.nome), codigo: mascarar(o.codigo) }))
  }
}
