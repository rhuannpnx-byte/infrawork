import { useEffect, useRef } from 'react'

// Folhas abertas, da mais antiga para a de cima (o seletor abre por cima do formulário).
const pilha: symbol[] = []

const FOCAVEIS =
  'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

/**
 * Folha que sobe de baixo (seletor, formulário). O Esc fecha só a de cima, o Tab fica dentro dela e o foco volta
 * para onde estava ao fechar. O foco vai para a própria folha (não para um campo: no celular abriria o teclado).
 */
export function useFolha<T extends HTMLElement = HTMLDivElement>(
  aberta: boolean,
  aoFechar: () => void,
) {
  const ref = useRef<T>(null)
  const fechar = useRef(aoFechar)
  fechar.current = aoFechar

  useEffect(() => {
    if (!aberta) return
    const id = Symbol('folha')
    pilha.push(id)
    const anterior = document.activeElement instanceof HTMLElement ? document.activeElement : null
    ref.current?.focus({ preventScroll: true })

    function onKey(e: KeyboardEvent) {
      if (pilha[pilha.length - 1] !== id) return
      if (e.key === 'Escape') {
        e.stopPropagation()
        fechar.current()
        return
      }
      const folha = ref.current
      if (e.key !== 'Tab' || !folha) return
      const itens = [...folha.querySelectorAll<HTMLElement>(FOCAVEIS)].filter(
        (el) => el.offsetParent !== null,
      )
      if (itens.length === 0) {
        e.preventDefault()
        return
      }
      const primeiro = itens[0]!
      const ultimo = itens[itens.length - 1]!
      const ativo = document.activeElement
      if (!folha.contains(ativo)) {
        e.preventDefault()
        primeiro.focus()
      } else if (e.shiftKey && (ativo === primeiro || ativo === folha)) {
        e.preventDefault()
        ultimo.focus()
      } else if (!e.shiftKey && ativo === ultimo) {
        e.preventDefault()
        primeiro.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      const i = pilha.indexOf(id)
      if (i !== -1) pilha.splice(i, 1)
      if (anterior && document.contains(anterior)) anterior.focus({ preventScroll: true })
    }
  }, [aberta])

  return ref
}

/**
 * Leva o foco ao primeiro campo com erro dentro de `raiz`. Chame depois de a tela já ter desenhado os erros
 * (`flushSync(() => setErros(...))`).
 */
export function focarPrimeiroInvalido(raiz: HTMLElement | null): void {
  const alvo = raiz?.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalido="true"]')
  if (!alvo) return
  alvo.focus({ preventScroll: true })
  alvo.scrollIntoView({ block: 'center' })
}
