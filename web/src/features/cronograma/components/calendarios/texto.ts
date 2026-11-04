/** Textos das definições de calendário. */
import type { DefinicaoRow } from '../../hooks/calendarios'

export const NOME_DIA = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo']

const fmtDia = (iso: string | null): string =>
  iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : ''
const fmtDiaMes = (iso: string | null): string =>
  iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : ''

/** Texto da regra de uma definição. */
export function descricaoDefinicao(
  d: Pick<DefinicaoRow, 'tipo' | 'data_inicio' | 'data_fim' | 'todo_ano' | 'dia_semana' | 'semana'>
): string {
  switch (d.tipo) {
    case 'feriado':
      if (d.todo_ano)
        return d.data_inicio === d.data_fim
          ? `${fmtDiaMes(d.data_inicio)}, todo ano`
          : `${fmtDiaMes(d.data_inicio)} a ${fmtDiaMes(d.data_fim)}, todo ano`
      return d.data_inicio === d.data_fim
        ? fmtDia(d.data_inicio)
        : `${fmtDia(d.data_inicio)} a ${fmtDia(d.data_fim)}`
    case 'pascoa':
      return 'Carnaval (segunda e terça), Sexta-feira Santa e Corpus Christi, todo ano'
    case 'folga_semana':
      return `${d.dia_semana !== null ? NOME_DIA[d.dia_semana] : ''} a partir de ${fmtDiaMes(d.data_inicio)}, todo ano`
    case 'horario_excecao': {
      const h = (d.semana ?? []).reduce((s, x) => s + Number(x.horas), 0)
      return `${fmtDia(d.data_inicio)} a ${fmtDia(d.data_fim)} · ${String(h).replace('.', ',')} h por semana`
    }
  }
}
