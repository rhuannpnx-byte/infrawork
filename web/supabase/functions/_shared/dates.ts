// Datas "de calendário" no fuso da obra. `new Date().toISOString().slice(0,10)`
// devolve a data em UTC — às 21h+ no Brasil isso já é "amanhã".

const TZ = Deno.env.get('APP_TIMEZONE') ?? 'America/Sao_Paulo'

/** 'YYYY-MM-DD' de um instante no fuso da aplicação. */
export function dataLocal(d: Date | string | number, tz: string = TZ): string {
  const date = d instanceof Date ? d : new Date(d)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** Hoje ('YYYY-MM-DD') no fuso da aplicação. */
export function hojeLocal(tz: string = TZ): string {
  return dataLocal(new Date(), tz)
}

/** Soma dias a uma data ISO 'YYYY-MM-DD' (aritmética em UTC, sem fuso). */
export function addDiasIso(iso: string, dias: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/** Semana ISO aproximada 'YYYY-Www' de hoje (uso em chaves de contexto). */
export function semanaIsoLocal(tz: string = TZ): string {
  const hoje = hojeLocal(tz)
  const d = new Date(hoje + 'T00:00:00Z')
  const ano = d.getUTCFullYear()
  const start = new Date(Date.UTC(ano, 0, 1))
  const semana = Math.ceil(((d.getTime() - start.getTime()) / 86400000 + start.getUTCDay() + 1) / 7)
  return `${ano}-W${String(semana).padStart(2, '0')}`
}
