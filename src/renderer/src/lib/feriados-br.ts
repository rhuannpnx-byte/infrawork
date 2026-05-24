/**
 * Feriados nacionais brasileiros — datas fixas + móveis calculadas a partir
 * da Páscoa (algoritmo Butcher Gregoriano).
 *
 * Usado pelo módulo Planejamento para popular o calendário de uma obra
 * em massa.
 */

interface Feriado {
  data: string // YYYY-MM-DD
  motivo: string
}

function calcularPascoa(ano: number): Date {
  const a = ano % 19
  const b = Math.floor(ano / 100)
  const c = ano % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mes = Math.floor((h + l - 7 * m + 114) / 31)
  const dia = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(Date.UTC(ano, mes - 1, dia))
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setUTCDate(r.getUTCDate() + n)
  return r
}

export function feriadosNacionaisBR(ano: number): Feriado[] {
  const pascoa = calcularPascoa(ano)
  const cinzas = addDays(pascoa, -46)
  const sextaSanta = addDays(pascoa, -2)
  const corpus = addDays(pascoa, 60)

  return [
    { data: `${ano}-01-01`, motivo: 'Confraternização Universal' },
    { data: isoDate(cinzas), motivo: 'Carnaval (Quarta de Cinzas — meio expediente)' },
    { data: isoDate(addDays(cinzas, -1)), motivo: 'Carnaval (Terça)' },
    { data: isoDate(addDays(cinzas, -2)), motivo: 'Carnaval (Segunda)' },
    { data: isoDate(sextaSanta), motivo: 'Sexta-feira Santa' },
    { data: `${ano}-04-21`, motivo: 'Tiradentes' },
    { data: `${ano}-05-01`, motivo: 'Dia do Trabalhador' },
    { data: isoDate(corpus), motivo: 'Corpus Christi' },
    { data: `${ano}-09-07`, motivo: 'Independência do Brasil' },
    { data: `${ano}-10-12`, motivo: 'Nossa Senhora Aparecida' },
    { data: `${ano}-11-02`, motivo: 'Finados' },
    { data: `${ano}-11-15`, motivo: 'Proclamação da República' },
    { data: `${ano}-11-20`, motivo: 'Consciência Negra' },
    { data: `${ano}-12-25`, motivo: 'Natal' }
  ]
}
