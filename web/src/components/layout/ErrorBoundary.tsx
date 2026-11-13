import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { navigateActiveTab } from '@/app/navigateActiveTab'

interface Props {
  children: ReactNode
  /** Nome da área na mensagem de erro (ex.: "Acompanhamento"). */
  scope?: string
  onError?: (error: Error, info: ErrorInfo) => void
}

interface State {
  error: Error | null
  errorInfo: ErrorInfo | null
}

/**
 * Captura erros de render e troca só a subárvore que falhou. Mostra o escopo, a mensagem original e a pilha
 * (recolhida), com "Tentar de novo" e "Ir para o início".
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorInfo: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo })

    console.error('[ErrorBoundary]', error, errorInfo)
    this.props.onError?.(error, errorInfo)
  }

  private reset = (): void => {
    this.setState({ error: null, errorInfo: null })
  }

  private irParaInicio = (): void => {
    navigateActiveTab('/')
    this.reset()
  }

  render(): ReactNode {
    const { error, errorInfo } = this.state
    if (!error) return this.props.children

    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div role="alert" className="rounded border border-danger/40 bg-danger/10 p-4">
          <h2 className="text-lg font-semibold text-danger">
            Esta tela parou por um erro{this.props.scope ? ` em ${this.props.scope}` : ''}
          </h2>
          <p className="text-sm text-text-muted mt-1">
            O que você digitou em outras telas não foi perdido. Tente de novo; se o erro voltar,
            envie a mensagem abaixo para o suporte.
          </p>

          <pre className="mt-3 text-sm text-text whitespace-pre-wrap break-words bg-bg-panel p-3 rounded border border-border">
            {error.name}: {error.message}
          </pre>

          {errorInfo?.componentStack || error.stack ? (
            <details className="mt-3">
              <summary className="text-sm text-text-muted cursor-pointer hover:text-text">
                Detalhes técnicos
              </summary>
              <pre className="mt-2 text-xs text-text-muted whitespace-pre-wrap break-words bg-bg-panel p-3 rounded border border-border max-h-64 overflow-auto">
                {error.stack}
                {errorInfo?.componentStack}
              </pre>
            </details>
          ) : null}

          <div className="flex items-center gap-2 mt-4">
            <Button onClick={this.reset}>Tentar de novo</Button>
            <Button variant="secondary" onClick={this.irParaInicio}>
              Ir para o início
            </Button>
          </div>
        </div>
      </div>
    )
  }
}
