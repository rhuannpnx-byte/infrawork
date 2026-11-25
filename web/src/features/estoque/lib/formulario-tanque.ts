// Os campos do cadastro do tanque (textos digitados, em cm) e a conversão de e para as medidas que o cálculo usa.

import { numeroParaCampo } from '@/lib/mascara/numero'
import { parseNumero } from '@/lib/format'
import { lerTabelaColada, PADROES_TORISFERICO, type FormaTanque, type Tanque } from './tanque'

export type TampoCampo = 'plano' | 'abaulado' | 'semieliptico' | 'hemisferico' | 'torisferico'
export type FundoCampo = 'plano' | 'conico' | 'abaulado'

export interface CamposTanque {
  forma: FormaTanque
  diametro: string
  comprimento: string
  largura: string
  altura: string
  tampo: TampoCampo
  /** flecha do tampo abaulado (horizontal) ou do fundo abaulado (vertical) */
  flecha: string
  /** id de `PADROES_TORISFERICO` */
  torisferico: string
  fundo: FundoCampo
  alturaFundo: string
  /** tabela do fabricante, como foi colada */
  tabela: string
}

export const CAMPOS_VAZIOS: CamposTanque = {
  forma: 'cilindrico_horizontal',
  diametro: '',
  comprimento: '',
  largura: '',
  altura: '',
  tampo: 'abaulado',
  flecha: '',
  torisferico: PADROES_TORISFERICO[1].id,
  fundo: 'plano',
  alturaFundo: '',
  tabela: ''
}

const num = (s: string): number => parseNumero(s) ?? 0
const txt = (v: number | undefined): string => (v ? numeroParaCampo(v, 1) : '')

/** As medidas digitadas viram o tanque que o cálculo entende. Campo vazio vale zero (a validação acusa). */
export function tanqueDosCampos(c: CamposTanque): Tanque {
  switch (c.forma) {
    case 'cilindrico_horizontal': {
      const padrao =
        PADROES_TORISFERICO.find((p) => p.id === c.torisferico) ?? PADROES_TORISFERICO[1]
      return {
        forma: c.forma,
        diametro: num(c.diametro),
        comprimento: num(c.comprimento),
        tampo:
          c.tampo === 'abaulado'
            ? { tipo: 'abaulado', flecha: num(c.flecha) }
            : c.tampo === 'torisferico'
              ? { tipo: 'torisferico', fc: padrao.fc, fk: padrao.fk }
              : { tipo: c.tampo }
      }
    }
    case 'cilindrico_vertical':
      return {
        forma: c.forma,
        diametro: num(c.diametro),
        altura: num(c.altura),
        fundo:
          c.fundo === 'conico'
            ? { tipo: 'conico', altura: num(c.alturaFundo) }
            : c.fundo === 'abaulado'
              ? { tipo: 'abaulado', flecha: num(c.flecha) }
              : { tipo: 'plano' }
      }
    case 'eliptico_horizontal':
    case 'oval_horizontal':
      return {
        forma: c.forma,
        largura: num(c.largura),
        altura: num(c.altura),
        comprimento: num(c.comprimento),
        flecha: c.tampo === 'abaulado' ? num(c.flecha) : 0
      }
    case 'retangular':
      return {
        forma: c.forma,
        comprimento: num(c.comprimento),
        largura: num(c.largura),
        altura: num(c.altura)
      }
    case 'tabela':
      return { forma: c.forma, pontos: lerTabelaColada(c.tabela) }
  }
}

/** As medidas gravadas de volta para os campos, na edição. */
export function camposDoTanque(t: Tanque | null | undefined): CamposTanque {
  if (!t) return CAMPOS_VAZIOS
  const c: CamposTanque = { ...CAMPOS_VAZIOS, forma: t.forma }
  switch (t.forma) {
    case 'cilindrico_horizontal':
      c.diametro = txt(t.diametro)
      c.comprimento = txt(t.comprimento)
      c.tampo = t.tampo.tipo
      if (t.tampo.tipo === 'abaulado') c.flecha = txt(t.tampo.flecha)
      if (t.tampo.tipo === 'torisferico') {
        const { fc, fk } = t.tampo
        c.torisferico =
          PADROES_TORISFERICO.find((p) => p.fc === fc && p.fk === fk)?.id ??
          PADROES_TORISFERICO[1].id
      }
      return c
    case 'cilindrico_vertical':
      c.diametro = txt(t.diametro)
      c.altura = txt(t.altura)
      c.fundo = t.fundo.tipo
      if (t.fundo.tipo === 'conico') c.alturaFundo = txt(t.fundo.altura)
      if (t.fundo.tipo === 'abaulado') c.flecha = txt(t.fundo.flecha)
      return c
    case 'eliptico_horizontal':
    case 'oval_horizontal':
      c.largura = txt(t.largura)
      c.altura = txt(t.altura)
      c.comprimento = txt(t.comprimento)
      c.tampo = t.flecha > 0 ? 'abaulado' : 'plano'
      c.flecha = txt(t.flecha)
      return c
    case 'retangular':
      c.comprimento = txt(t.comprimento)
      c.largura = txt(t.largura)
      c.altura = txt(t.altura)
      return c
    case 'tabela':
      c.tabela = t.pontos
        .map((p) => `${numeroParaCampo(p.altura, 1)}\t${numeroParaCampo(p.volume, 2)}`)
        .join('\n')
      return c
  }
}

/** Tampos que cada formato horizontal aceita. No elíptico e no oval o abaulado é dado pela flecha medida. */
export function tamposDaForma(forma: FormaTanque): TampoCampo[] {
  if (forma === 'cilindrico_horizontal')
    return ['abaulado', 'plano', 'semieliptico', 'hemisferico', 'torisferico']
  if (forma === 'eliptico_horizontal' || forma === 'oval_horizontal') return ['abaulado', 'plano']
  return []
}

const cm = (v: number): string => `${numeroParaCampo(v, 1)} cm`

/** As medidas do tanque numa frase, para a ficha e a folha impressa. */
export function descreverTanque(t: Tanque): string {
  switch (t.forma) {
    case 'cilindrico_horizontal': {
      const tampo =
        t.tampo.tipo === 'plano'
          ? 'tampos planos'
          : t.tampo.tipo === 'abaulado'
            ? `tampos abaulados com flecha de ${cm(t.tampo.flecha)}`
            : t.tampo.tipo === 'semieliptico'
              ? 'tampos semielípticos 2:1'
              : t.tampo.tipo === 'hemisferico'
                ? 'tampos hemisféricos'
                : `tampos torisféricos (${
                    PADROES_TORISFERICO.find(
                      (p) =>
                        t.tampo.tipo === 'torisferico' && p.fc === t.tampo.fc && p.fk === t.tampo.fk
                    )?.nome ?? 'padrão próprio'
                  })`
      return `Diâmetro ${cm(t.diametro)}, costado de ${cm(t.comprimento)}, ${tampo}`
    }
    case 'cilindrico_vertical':
      return `Diâmetro ${cm(t.diametro)}, costado de ${cm(t.altura)}, ${
        t.fundo.tipo === 'plano'
          ? 'fundo plano'
          : t.fundo.tipo === 'conico'
            ? `fundo cônico de ${cm(t.fundo.altura)}`
            : `fundo abaulado com flecha de ${cm(t.fundo.flecha)}`
      }`
    case 'eliptico_horizontal':
    case 'oval_horizontal':
      return `Largura ${cm(t.largura)}, altura ${cm(t.altura)}, costado de ${cm(t.comprimento)}, ${
        t.flecha > 0 ? `tampos abaulados com flecha de ${cm(t.flecha)}` : 'tampos planos'
      }`
    case 'retangular':
      return `Comprimento ${cm(t.comprimento)}, largura ${cm(t.largura)}, altura ${cm(t.altura)}`
    case 'tabela':
      return `Tabela do fabricante com ${t.pontos.length} linhas`
  }
}
