import { toast } from 'sonner'

/** Aviso de rotina ("salvo", "criado"): some rápido para não cobrir a tela. */
export const AVISO_MS = 2500
/** Erro e alerta: precisa dar tempo de ler; tem botão de fechar. */
export const AVISO_ERRO_MS = 6000

let ajustado = false

/**
 * Os avisos de sucesso usam o tempo padrão do `<Toaster>` (`AVISO_MS`). Erro e alerta ficam mais tempo, sem cada
 * chamada precisar dizer: quem passar `duration` continua mandando.
 */
export function ajustarTemposDosAvisos(): void {
  if (ajustado) return
  ajustado = true
  const erro = toast.error
  const alerta = toast.warning
  toast.error = (mensagem, dados) => erro(mensagem, { duration: AVISO_ERRO_MS, ...dados })
  toast.warning = (mensagem, dados) => alerta(mensagem, { duration: AVISO_ERRO_MS, ...dados })
}
