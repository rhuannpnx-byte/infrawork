/**
 * Blob do calendário (Calendar classe 100, f100 tipo 0x10) — RD-019, L-001 fechada em 2026-10-13.
 * Evidência: analises/2026-10-11_dynaroad/handoff/docs/formato_calendario.md; handoff/funcoes/8_calendario/
 * (DDL::Calendar::Serialize @008ea860 / UnSerialize @008eab80; DDLHelpers::StoreInt @008f08a0 i32 BIG-endian,
 * StoreInt64 @008f0770 i64 LITTLE-endian, StoreString @008f0900 i32 BE n + n × i32 BE por caractere).
 * Leitura defensiva: o blob vem de um .dr5, entrada não confiável.
 */

export class CalendarBlobError extends Error {
  constructor(message: string, readonly offset: number) {
    super(`${message} (offset 0x${offset.toString(16)})`);
    this.name = "CalendarBlobError";
  }
}

/** Jornada de um dia: início em segundos desde 00:00 e duração em segundos (0 = sem expediente). */
export interface WorkDay {
  begin: number;
  length: number;
}

/** Gerador semanal: o byte inicial é pulado na leitura (@008ed8c0) e vale 01 nas amostras. */
export interface WeekSpec {
  flag: number;
  /** segunda … domingo (DDL::WeekDay MON = 0). */
  days: [WorkDay, WorkDay, WorkDay, WorkDay, WorkDay, WorkDay, WorkDay];
}

export type GeneratorSpec =
  | { type: "StaticHoliday"; name: string; begin: bigint; end: bigint; yearly: number }
  | { type: "Easter"; name: string }
  | { type: "StaticWeekDay"; name: string; date: bigint; weekday: number };

/** Exceção de jornada num período (WorkTimeSpan @008f0640). */
export interface SpanSpec {
  week: WeekSpec;
  name: string;
  first: bigint;
  last: bigint;
}

export interface CalendarSpec {
  version: number;
  week: WeekSpec;
  generators: GeneratorSpec[];
  /** Gravado sempre 0…n−1 (Serialize); o uso exato na leitura é [I]. */
  order: number[];
  spans: SpanSpec[];
}

export const CALENDAR_BLOB_VERSION = 12;
const GEN_CODE = { StaticHoliday: 3, Easter: 4, StaticWeekDay: 5 } as const;

class Reader {
  pos = 0;
  private readonly view: DataView;
  constructor(private readonly b: Uint8Array) {
    this.view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  get done(): boolean {
    return this.pos === this.b.length;
  }
  private need(n: number): void {
    if (this.pos + n > this.b.length) throw new CalendarBlobError("fim inesperado do calendário", this.pos);
  }
  u8(): number {
    this.need(1);
    return this.b[this.pos++]!;
  }
  i32(): number {
    this.need(4);
    const v = this.view.getInt32(this.pos, false);
    this.pos += 4;
    return v;
  }
  i64(): bigint {
    this.need(8);
    const v = this.view.getBigInt64(this.pos, true);
    this.pos += 8;
    return v;
  }
  count(what: string, minBytes: number): number {
    const at = this.pos;
    const n = this.i32();
    if (n < 0 || n * minBytes > this.b.length - this.pos) throw new CalendarBlobError(`contagem inválida de ${what}: ${n}`, at);
    return n;
  }
  string(): string {
    const n = this.count("caracteres", 4);
    let s = "";
    // wchar_t do Windows tem 16 bits: cada u32 é uma unidade UTF-16
    for (let i = 0; i < n; i++) {
      const c = this.i32();
      s += String.fromCharCode(c >= 0 && c <= 0xffff ? c : 0xfffd);
    }
    return s;
  }
}

function readWeek(r: Reader): WeekSpec {
  const flag = r.u8();
  const days = Array.from({ length: 7 }, () => ({ begin: r.i32(), length: r.i32() })) as WeekSpec["days"];
  return { flag, days };
}

/** Lê o blob. Só a versão 12 (a que o original grava); outras são recusadas em vez de adivinhadas. */
export function parseCalendarBlob(b: Uint8Array): CalendarSpec {
  const r = new Reader(b);
  const version = r.i32();
  if (version !== CALENDAR_BLOB_VERSION) throw new CalendarBlobError(`versão de calendário ${version} não suportada (só 12)`, 0);
  const week = readWeek(r);
  const generators: GeneratorSpec[] = [];
  for (let i = 0, n = r.count("geradores", 5); i < n; i++) {
    const name = r.string();
    const at = r.pos;
    const t = r.u8();
    if (t === 3) generators.push({ type: "StaticHoliday", name, begin: r.i64(), end: r.i64(), yearly: r.u8() });
    else if (t === 4) generators.push({ type: "Easter", name });
    else if (t === 5) generators.push({ type: "StaticWeekDay", name, date: r.i64(), weekday: r.u8() });
    else throw new CalendarBlobError(`tipo de gerador ${t} não suportado`, at);
  }
  const order = Array.from({ length: r.count("ordem", 4) }, () => r.i32());
  const spans: SpanSpec[] = [];
  for (let i = 0, n = r.count("spans", 74); i < n; i++) {
    const w = readWeek(r);
    const at = r.pos;
    if (r.u8() !== 2) throw new CalendarBlobError("WorkTimeSpan sem o tipo 2", at);
    spans.push({ week: w, name: r.string(), first: r.i64(), last: r.i64() });
  }
  if (!r.done) throw new CalendarBlobError("bytes sobrando no calendário", r.pos);
  return { version, week, generators, order, spans };
}

class Writer {
  private out: number[] = [];
  u8(v: number): void {
    this.out.push(v & 0xff);
  }
  i32(v: number): void {
    const b = new DataView(new ArrayBuffer(4));
    b.setInt32(0, v, false);
    for (let i = 0; i < 4; i++) this.out.push(b.getUint8(i));
  }
  i64(v: bigint): void {
    const b = new DataView(new ArrayBuffer(8));
    b.setBigInt64(0, v, true);
    for (let i = 0; i < 8; i++) this.out.push(b.getUint8(i));
  }
  string(s: string): void {
    this.i32(s.length);
    for (let i = 0; i < s.length; i++) this.i32(s.charCodeAt(i));
  }
  bytes(): Uint8Array {
    return Uint8Array.from(this.out);
  }
}

function writeWeek(w: Writer, s: WeekSpec): void {
  w.u8(s.flag);
  for (const d of s.days) {
    w.i32(d.begin);
    w.i32(d.length);
  }
}

/** Grava o blob na mesma ordem do original (Serialize @008ea860). */
export function serializeCalendarBlob(c: CalendarSpec): Uint8Array {
  const w = new Writer();
  w.i32(c.version);
  writeWeek(w, c.week);
  w.i32(c.generators.length);
  for (const g of c.generators) {
    w.string(g.name);
    w.u8(GEN_CODE[g.type]);
    if (g.type === "StaticHoliday") {
      w.i64(g.begin);
      w.i64(g.end);
      w.u8(g.yearly);
    } else if (g.type === "StaticWeekDay") {
      w.i64(g.date);
      w.u8(g.weekday);
    }
  }
  w.i32(c.order.length);
  c.order.forEach((i) => w.i32(i));
  w.i32(c.spans.length);
  for (const s of c.spans) {
    writeWeek(w, s.week);
    w.u8(2);
    w.string(s.name);
    w.i64(s.first);
    w.i64(s.last);
  }
  return w.bytes();
}
