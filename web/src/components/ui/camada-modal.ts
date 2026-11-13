import { useEffect, useRef, type RefObject } from 'react'

const FOCAVEIS =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

/** Pilha das camadas modais abertas: só a de cima responde ao Esc e prende o Tab. */
const pilha: symbol[] = []

const focaveis = (caixa: HTMLElement): HTMLElement[] =>
  [...caixa.querySelectorAll<HTMLElement>(FOCAVEIS)].filter(
    (el) => el.getClientRects().length > 0 && el.getAttribute('aria-hidden') !== 'true'
  )

/**
 * Comportamento de camada modal (diálogo, painel lateral, busca): Esc fecha só a camada de cima, o Tab circula
 * dentro dela, o foco entra ao abrir e volta para onde estava ao fechar.
 *
 * O Tab só é interceptado nas bordas da camada; popovers e menus que abrem em portal a partir dela continuam
 * recebendo foco normalmente.
 */
export function useCamadaModal(
  aberto: boolean,
  caixa: RefObject<HTMLElement | null>,
  opcoes: { aoFechar?: () => void; focoInicial?: boolean }
): void {
  const aoFechar = useRef(opcoes.aoFechar)
  aoFechar.current = opcoes.aoFechar
  const focoInicial = opcoes.focoInicial ?? true

  useEffect(() => {
    if (!aberto) return
    const id = Symbol('camada')
    pilha.push(id)
    const anterior = document.activeElement as HTMLElement | null

    const el = caixa.current
    if (el && focoInicial && !el.contains(document.activeElement)) {
      const alvo =
        el.querySelector<HTMLElement>('[data-foco-inicial]') ??
        focaveis(el).find((f) => !f.hasAttribute('data-fechar')) ??
        el
      alvo.focus({ preventScroll: true })
    }

    const aoTeclar = (e: KeyboardEvent): void => {
      if (pilha[pilha.length - 1] !== id) return
      if (e.key === 'Escape') {
        if (e.defaultPrevented || !aoFechar.current) return
        e.preventDefault()
        aoFechar.current()
        return
      }
      if (e.key !== 'Tab') return
      const box = caixa.current
      if (!box) return
      const ativo = document.activeElement as HTMLElement | null
      // Foco num popover ou menu em portal aberto a partir da camada: deixa o Tab seguir.
      if (ativo && ativo !== document.body && !box.contains(ativo)) return
      const itens = focaveis(box)
      if (itens.length === 0) {
        e.preventDefault()
        box.focus({ preventScroll: true })
        return
      }
      const primeiro = itens[0]
      const ultimo = itens[itens.length - 1]
      if (
        e.shiftKey &&
        (ativo === primeiro || ativo === box || !ativo || ativo === document.body)
      ) {
        e.preventDefault()
        ultimo.focus()
      } else if (!e.shiftKey && (ativo === ultimo || !ativo || ativo === document.body)) {
        e.preventDefault()
        primeiro.focus()
      }
    }
    document.addEventListener('keydown', aoTeclar)

    return () => {
      document.removeEventListener('keydown', aoTeclar)
      const i = pilha.indexOf(id)
      if (i >= 0) pilha.splice(i, 1)
      if (anterior && document.contains(anterior)) anterior.focus({ preventScroll: true })
    }
  }, [aberto, caixa, focoInicial])
}

/**
 * Marca um popover ou menu aberto como a camada de cima, para o Esc fechar só ele e não o diálogo de onde abriu.
 * O próprio popover trata o seu Esc.
 */
export function useCamadaAberta(aberto: boolean): void {
  useEffect(() => {
    if (!aberto) return
    const id = Symbol('popover')
    pilha.push(id)
    return () => {
      const i = pilha.indexOf(id)
      if (i >= 0) pilha.splice(i, 1)
    }
  }, [aberto])
}
