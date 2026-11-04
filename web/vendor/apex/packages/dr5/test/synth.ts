// Construtor de payloads DPL sintéticos para testes (porta de validacao/U-01/gen_synth.py, V-002).
export const enc = new TextEncoder();

export function cat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
const bytes = (...b: number[]) => Uint8Array.from(b);
function num(size: number, set: (v: DataView) => void): Uint8Array {
  const b = new Uint8Array(size);
  set(new DataView(b.buffer));
  return b;
}
export const u32 = (v: number) => num(4, (d) => d.setUint32(0, v, true));
export const i32 = (v: number) => num(4, (d) => d.setInt32(0, v, true));
export const u64 = (v: bigint) => num(8, (d) => d.setBigUint64(0, v, true));
export const i64 = (v: bigint) => num(8, (d) => d.setBigInt64(0, v, true));
export const f32 = (v: number) => num(4, (d) => d.setFloat32(0, v, true));
export const f64 = (v: number) => num(8, (d) => d.setFloat64(0, v, true));
export const sized = (b: Uint8Array) => cat(u32(b.length), b);
const utf16 = (s: string) => {
  const b = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) new DataView(b.buffer).setUint16(i * 2, s.charCodeAt(i), true);
  return b;
};

export const field = (id: number, tag: number, body: Uint8Array) => cat(u32(id), bytes(tag), body);

export function record(oid: number, cls: number, fields: Uint8Array[], oid64: boolean): Uint8Array {
  const body = cat(oid64 ? u64(BigInt(oid)) : u32(oid), u32(cls), ...fields);
  return cat(u32(4 + body.length), body);
}

export function payload(fmt: number, recs: Uint8Array[], client = 80006): Uint8Array {
  return cat(enc.encode("DSSDPL File\x1a\x00"), u32(fmt), u32(client), ...recs, u32(0), u32(0xffffffff));
}

/** As 23 tags válidas, incluindo as 8 ausentes dos exemplos (0x02, 0x03, 0x05, 0x0a, 0x0c, 0x11, 0x12, 0x19). */
export function allTags(oid64: boolean): Uint8Array[] {
  const F = [
    field(100, 0x0f, sized(cat(enc.encode("Olá ação ü 中文"), bytes(0)))),
    field(101, 0x16, sized(cat(utf16("wide ÄÖ ✓"), bytes(0, 0)))),
    field(102, 0x01, bytes(1)),
    field(104, 0x02, bytes(0xff)),
    field(105, 0x03, bytes(0x80)),
    field(106, 0x04, bytes(0xff, 0xff)),
    field(107, 0x05, bytes(0x00, 0x80)),
    field(108, 0x06, u32(0xffffffff)),
    field(109, 0x07, i32(-123456)),
    field(110, 0x08, u32(0xdeadbeef)),
    field(111, 0x09, i32(-1)),
    field(112, 0x0a, u64(2n ** 64n - 1n)),
    field(113, 0x0b, i64(-1n)),
    field(114, 0x0b, i64(1427241600n)),
    field(115, 0x0b, i64(2n ** 62n)),
    field(116, 0x0c, f32(0.1)),
    field(118, 0x0d, f64(1e16)),
    field(121, 0x0d, f64(NaN)),
    field(124, 0x10, sized(cat(enc.encode("%PDF-1.4"), bytes(0, 1, 2)))),
    field(125, 0x11, u32(2)),
    field(126, 0x12, sized(cat(u32(2), enc.encode("xx")))),
    field(127, 0x18, u64(2n)),
    field(128, 0x18, u64(0n)),
    field(130, 0x14, u32(0)),
    field(131, 0x14, cat(u32(3), bytes(0x07), i32(0), i32(1), i32(2))),
    field(132, 0x14, cat(u32(2), bytes(0x14), u32(2), bytes(0x0d), f64(1), f64(2.5), u32(0))),
    field(133, 0x15, u32(0)),
    field(134, 0x15, cat(u32(2), bytes(0x07), i32(5), bytes(0x0d), f64(0.25), i32(6), f64(9))),
    field(136, 0x17, cat(u32(2), bytes(0x07), i32(1), bytes(0x0f), sized(enc.encode("a\0")))),
    field(137, 0x19, cat(u32(2), bytes(0x07), i32(1), bytes(0x0d), f64(7))),
  ];
  return [record(1, 29, F, oid64), record(2, 157, [field(100, 0x0f, sized(enc.encode("removida\0")))], oid64)];
}

/** `n` cópias de `unit` seguidas de `tail`, numa única alocação (evita cópias quadráticas). */
export function repeat(unit: Uint8Array, n: number, tail: Uint8Array): Uint8Array {
  const out = new Uint8Array(unit.length * n + tail.length);
  for (let i = 0; i < n; i++) out.set(unit, i * unit.length);
  out.set(tail, unit.length * n);
  return out;
}

/** `depth` tuplas (0x17) ou contêineres (0x14) aninhados em torno de um bool. */
export function nested(kind: "tuple" | "container", depth: number): Uint8Array {
  // tuple:     [17 n=1] × depth + [01 01]
  // container: 14 + [n=1 et=14] × (depth−1) + [n=1 et=01 01]
  const body = kind === "tuple"
    ? repeat(cat(bytes(0x17), u32(1)), depth, bytes(0x01, 0x01))
    : cat(bytes(0x14), repeat(cat(u32(1), bytes(0x14)), depth - 1, cat(u32(1), bytes(0x01, 0x01))));
  return payload(0x803, [record(1, 29, [cat(u32(1), body)], true)]);
}
