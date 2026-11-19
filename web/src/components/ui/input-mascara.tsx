import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type InputHTMLAttributes,
  type SyntheticEvent
} from 'react'
import {
  agrupar,
  canonicoDeDigitacao,
  canonicoDeTexto,
  contarSignificativos,
  limparCanonico,
  mascaraCnpj,
  mascaraCpf,
  mascaraPlaca,
  mascaraTelefone,
  mesmoNumero,
  posicaoApos
} from '@/lib/mascara/numero'

export type TipoMascara = 'decimal' | 'inteiro' | 'telefone' | 'cnpj' | 'cpf' | 'placa'

export interface MascaraProps {
  /**
   * Máscara do campo. `decimal` e `inteiro` mostram o ponto de milhar enquanto se digita e entregam ao `onChange`
   * o texto sem milhar e com vírgula decimal ("1234,56"), que `parseBR` e `parseNumero` leem sem ambiguidade.
   */
  mascara: TipoMascara
  /** Casas decimais aceitas (só `decimal`; padrão 4). */
  casas?: number
  /** Casas completadas com zero quando o campo perde o foco (2 em valor em reais). */
  casasMin?: number
  /** Aceita número negativo. */
  negativo?: boolean
  /** Texto exibido fora do foco, a partir do valor canônico (ex.: "R$ 1.234,56"). */
  formatoSemFoco?: (canonico: string) => string
}

type Nativo = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'type'> & {
  value?: string | number | null
  defaultValue?: string | number | null
}

interface Regra {
  deFora: (t: string) => string
  deDigitacao: (t: string) => string
  exibir: (c: string, focado: boolean) => string
  conta: (ch: string) => boolean
  igual: (a: string, b: string) => boolean
  limpar: (c: string) => string
  /** Número: o campo tem separador decimal (ponto digitado vira vírgula)? `null` em máscara de texto. */
  decimal: boolean | null
  inputMode: InputHTMLAttributes<HTMLInputElement>['inputMode']
}

const ALGARISMO = /\d/
const ALFANUM = /[A-Za-z0-9]/

function regraDe(p: MascaraProps): Regra {
  if (p.mascara === 'decimal' || p.mascara === 'inteiro') {
    const o = { casas: p.mascara === 'inteiro' ? 0 : (p.casas ?? 4), negativo: p.negativo }
    return {
      deFora: (t) => canonicoDeTexto(t, o),
      deDigitacao: (t) => canonicoDeDigitacao(t, o),
      exibir: (c, focado) => {
        if (focado) return agrupar(c)
        const limpo = limparCanonico(c)
        if (limpo === '') return ''
        return p.formatoSemFoco ? p.formatoSemFoco(limpo) : agrupar(limpo, p.casasMin ?? 0)
      },
      conta: (ch) => ALGARISMO.test(ch) || ch === ',' || ch === '-',
      igual: mesmoNumero,
      limpar: limparCanonico,
      decimal: o.casas > 0,
      inputMode: o.negativo ? 'text' : o.casas > 0 ? 'decimal' : 'numeric'
    }
  }
  const f =
    p.mascara === 'telefone'
      ? mascaraTelefone
      : p.mascara === 'cnpj'
        ? mascaraCnpj
        : p.mascara === 'cpf'
          ? mascaraCpf
          : mascaraPlaca
  return {
    deFora: f,
    deDigitacao: f,
    exibir: (c) => c,
    conta: (ch) => ALFANUM.test(ch) || (p.mascara === 'placa' && ch === '-'),
    igual: (a, b) => a === b,
    limpar: (c) => c,
    decimal: null,
    inputMode: p.mascara === 'telefone' || p.mascara === 'cpf' ? 'numeric' : 'text'
  }
}

/**
 * Evento com `target.value` trocado pelo valor canônico: quem usa o campo lê e grava `e.target.value` como num
 * `<input>` comum, sem saber da exibição agrupada. Vale para `onChange`, `onFocus` e `onBlur`; os eventos de teclado
 * recebem o elemento de verdade (quem navega entre células compara o elemento).
 */
function eventoCom<E extends SyntheticEvent<HTMLInputElement>>(
  e: E,
  valor: () => string,
  padrao: string,
  aoAtribuir: (v: string) => void
): E {
  const alvo = new Proxy(e.currentTarget, {
    get(t, k) {
      if (k === 'value') return valor()
      if (k === 'defaultValue') return padrao
      const v = Reflect.get(t, k, t) as unknown
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v
    },
    set(t, k, v) {
      if (k === 'value') {
        aoAtribuir(String(v ?? ''))
        return true
      }
      return Reflect.set(t, k, v, t)
    }
  })
  const copia = Object.create(e) as E
  Object.defineProperty(copia, 'target', { value: alvo })
  Object.defineProperty(copia, 'currentTarget', { value: alvo })
  return copia
}

/**
 * `<input>` com máscara. Sem classes próprias: o `Input` do sistema o usa quando recebe `mascara`, e as células de
 * tabela o usam direto com as classes delas.
 */
export const InputMascara = forwardRef<HTMLInputElement, Nativo & MascaraProps>(
  (
    {
      mascara,
      casas,
      casasMin,
      negativo,
      formatoSemFoco,
      value,
      defaultValue,
      onChange,
      onBlur,
      onFocus,
      onPaste,
      inputMode,
      ...resto
    },
    ref
  ) => {
    const regra = useMemo(
      () => regraDe({ mascara, casas, casasMin, negativo, formatoSemFoco }),
      [mascara, casas, casasMin, negativo, formatoSemFoco]
    )
    const controlado = value !== undefined
    const el = useRef<HTMLInputElement>(null)
    useImperativeHandle(ref, () => el.current as HTMLInputElement)

    const [focado, setFocado] = useState(false)
    // o que está sendo digitado (controlado) ou o valor do campo (não controlado)
    const [rascunho, setRascunho] = useState<string | null>(() =>
      controlado ? null : regra.deFora(String(defaultValue ?? ''))
    )
    const [, repintar] = useState(0)
    const cursor = useRef<number | null>(null)
    const selecionarTudo = useRef(false)

    const deFora = controlado ? regra.deFora(String(value ?? '')) : ''
    // o rascunho vale enquanto disser o mesmo que o valor de quem usa o campo ("7," e 7)
    // campo apagado continua vazio quando quem usa guarda o vazio como zero
    const casa =
      rascunho !== null &&
      (regra.igual(rascunho, deFora) ||
        (regra.decimal !== null && regra.limpar(rascunho) === '' && regra.igual(deFora, '0')))
    const atual = controlado ? (casa ? rascunho : deFora) : (rascunho ?? '')
    // quem usa o campo trocou o que foi digitado (limite, arredondamento): o cursor vai para o fim
    const trocado = controlado && rascunho !== null && !casa
    const exibido = regra.exibir(atual, focado)
    // o valor mais recente, para os eventos que chegam antes da próxima pintura (Esc que desfaz e sai do campo)
    const recente = useRef(atual)
    useLayoutEffect(() => {
      recente.current = atual
    }, [atual])
    const padrao = regra.deFora(String((controlado ? value : defaultValue) ?? ''))

    useLayoutEffect(() => {
      const campo = el.current
      if (!campo) return
      if (selecionarTudo.current) {
        // o texto muda ao ganhar o foco (sai o formato de leitura): mantém a seleção do Tab
        selecionarTudo.current = false
        if (document.activeElement === campo) campo.select()
        return
      }
      const n = cursor.current
      if (n === null) return
      cursor.current = null
      if (document.activeElement !== campo) return
      const pos = trocado ? campo.value.length : posicaoApos(campo.value, n, regra.conta)
      campo.setSelectionRange(pos, pos)
    })

    const atribuir = (v: string): void => {
      const novo = regra.deFora(v)
      recente.current = novo
      setRascunho(novo)
    }
    const evento = <E extends SyntheticEvent<HTMLInputElement>>(e: E, fixo?: string): E =>
      eventoCom(e, () => fixo ?? recente.current, padrao, atribuir)

    /** Guarda o texto novo, marca o cursor e avisa quem usa o campo. */
    const aplicar = (
      e: SyntheticEvent<HTMLInputElement>,
      novo: string,
      significativosAntes: number
    ): void => {
      const antes = recente.current
      cursor.current = significativosAntes
      recente.current = novo
      setRascunho(novo)
      repintar((x) => x + 1)
      if (novo !== antes) onChange?.(evento(e as React.ChangeEvent<HTMLInputElement>, novo))
    }

    const aoDigitar = (e: React.ChangeEvent<HTMLInputElement>): void => {
      const campo = e.currentTarget
      let texto = campo.value
      let pos = campo.selectionStart ?? texto.length
      const nativo = e.nativeEvent as InputEvent
      const tipo = nativo.inputType as string | undefined
      if (tipo === undefined || tipo === 'insertReplacementText') {
        // preenchimento de fora (automação, corretor): o texto inteiro, lido como número escrito
        const novo =
          mascara === 'decimal' || mascara === 'inteiro'
            ? canonicoDeTexto(
                texto,
                { casas: mascara === 'inteiro' ? 0 : (casas ?? 4), negativo },
                true
              )
            : regra.deFora(texto)
        aplicar(e, novo, Number.MAX_SAFE_INTEGER)
        return
      }
      if (tipo === 'insertText' && (nativo.data === '.' || nativo.data === ',') && pos > 0) {
        // ponto ou vírgula digitados são o separador decimal; o segundo é ignorado
        const antes = texto.slice(0, pos - 1)
        const depois = texto.slice(pos)
        const cabe = regra.decimal === true && !`${antes}${depois}`.includes(',')
        texto = `${antes}${cabe ? ',' : ''}${depois}`
        if (!cabe) pos -= 1
      }
      aplicar(e, regra.deDigitacao(texto), contarSignificativos(texto, pos, regra.conta))
    }

    const aoColar = (e: ClipboardEvent<HTMLInputElement>): void => {
      onPaste?.(e)
      if (e.defaultPrevented || resto.readOnly || resto.disabled) return
      const colado = e.clipboardData.getData('text')
      if (!colado) return
      e.preventDefault()
      const campo = e.currentTarget
      const ini = campo.selectionStart ?? campo.value.length
      const fim = campo.selectionEnd ?? ini
      const numerico = mascara === 'decimal' || mascara === 'inteiro'
      // o número colado entra sem milhar; o resto do campo segue com os pontos de exibição
      const trecho = numerico
        ? canonicoDeTexto(colado, { casas: 20, negativo: ini === 0 && negativo })
        : colado
      const texto = `${campo.value.slice(0, ini)}${trecho}${campo.value.slice(fim)}`
      aplicar(
        e,
        regra.deDigitacao(texto),
        contarSignificativos(campo.value, ini, regra.conta) +
          contarSignificativos(trecho, trecho.length, regra.conta)
      )
    }

    return (
      <input
        {...resto}
        ref={el}
        type="text"
        inputMode={inputMode ?? regra.inputMode}
        autoComplete={resto.autoComplete ?? 'off'}
        value={exibido}
        onChange={aoDigitar}
        onPaste={aoColar}
        onFocus={(e) => {
          setFocado(true)
          onFocus?.(evento(e))
          const campo = e.currentTarget
          selecionarTudo.current =
            campo.value.length > 0 &&
            campo.selectionStart === 0 &&
            campo.selectionEnd === campo.value.length
        }}
        onBlur={(e) => {
          const antes = recente.current
          const limpo = regra.limpar(antes)
          recente.current = limpo
          setFocado(false)
          setRascunho(controlado ? null : limpo)
          if (limpo !== antes)
            onChange?.(evento(e as unknown as React.ChangeEvent<HTMLInputElement>, limpo))
          onBlur?.(evento(e))
        }}
      />
    )
  }
)
InputMascara.displayName = 'InputMascara'
