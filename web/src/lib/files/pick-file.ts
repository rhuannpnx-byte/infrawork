/**
 * Seletor de arquivo do browser (substitui o dialog nativo do Electron).
 * Resolve com o `File` escolhido ou `null` se o usuário cancelar.
 */
export function pickFile(opts: { accept: string }): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = opts.accept
    input.style.display = 'none'
    let done = false
    const finish = (file: File | null): void => {
      if (done) return
      done = true
      input.remove()
      resolve(file)
    }
    input.addEventListener('change', () => finish(input.files?.[0] ?? null))
    // 'cancel' é disparado por browsers modernos; o fallback por foco cobre os demais.
    input.addEventListener('cancel', () => finish(null))
    window.addEventListener(
      'focus',
      () => {
        setTimeout(() => {
          if (!done && !input.files?.length) finish(null)
        }, 800)
      },
      { once: true }
    )
    document.body.appendChild(input)
    input.click()
  })
}
