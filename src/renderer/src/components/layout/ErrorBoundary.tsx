import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

interface Props {
  /** O que isolar. Se um filho explodir, o boundary substitui apenas essa subarvore. */
  children: ReactNode
  /** Rotulo que vai no header da tela de erro. Ex.: "Acompanhamento", "Dashboard". */
  scope?: string
  /** Callback opcional pra reportar (Sentry, log). */
  onError?: (error: Error, info: ErrorInfo) => void
}

interface State {
  error: Error | null
  errorInfo: ErrorInfo | null
}

/**
 * Captura erros de render em React. PRODUCT.md proibe mensagem generica
 * simpatica ("Oops, algo deu errado"). Mostramos: escopo + mensagem original +
 * stack (toggle) + botoes "Tentar novamente" e "Voltar pra Home".
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorInfo: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo })
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, errorInfo)
    this.props.onError?.(error, errorInfo)
  }

  private reset = (): void => {
    this.setState({ error: null, errorInfo: null })
  }

  private goHome = (): void => {
    this.reset()
    window.location.hash = '#/'
  }

  render(): ReactNode {
    const { error, errorInfo } = this.state
    if (!error) return this.props.children

    const scopeLabel = this.props.scope ? `em ${this.props.scope}` : ''

    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="rounded border border-danger/30 bg-danger/5 p-4">
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <h2 className="text-sm font-semibold text-danger">
              Erro ao renderizar tela {scopeLabel}
            </h2>
            <span className="text-2xs font-mono uppercase tracking-wide text-text-dim">
              {error.name}
            </span>
          </div>

          <pre className="text-xs font-mono text-text whitespace-pre-wrap break-words bg-bg p-3 rounded border border-border">
            {error.message}
          </pre>

          {errorInfo?.componentStack ? (
            <details className="mt-3">
              <summary className="text-2xs font-mono text-text-dim cursor-pointer hover:text-text">
                Stack do componente
              </summary>
              <pre className="mt-2 text-2xs font-mono text-text-muted whitespace-pre-wrap break-words bg-bg p-3 rounded border border-border max-h-64 overflow-auto">
                {errorInfo.componentStack}
              </pre>
            </details>
          ) : null}

          {error.stack ? (
            <details className="mt-2">
              <summary className="text-2xs font-mono text-text-dim cursor-pointer hover:text-text">
                Stack trace
              </summary>
              <pre className="mt-2 text-2xs font-mono text-text-muted whitespace-pre-wrap break-words bg-bg p-3 rounded border border-border max-h-64 overflow-auto">
                {error.stack}
              </pre>
            </details>
          ) : null}

          <div className="flex items-center gap-2 mt-4">
            <Button onClick={this.reset}>Tentar novamente</Button>
            <Button variant="secondary" onClick={this.goHome}>
              Voltar pra Home
            </Button>
          </div>
        </div>
      </div>
    )
  }
}
