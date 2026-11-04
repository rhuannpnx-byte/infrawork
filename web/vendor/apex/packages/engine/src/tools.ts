/**
 * Arredondamentos de `Tools::` (U-61f, AL-MOT-27). Evidência: analises/2026-10-11_dynaroad/evidencias/decompilado/
 * u61f_motor/consts_lote2.txt (ASM de `Tools::DoubleToInt64@0xa13b60`, `Floor64@0xa13200`, `Ceil64@0xa12b50`).
 *
 * - [O] `DoubleToInt64(x)`: x < 0 → `_dtol3(x − 0.5)`, senão `_dtol3(x + 0.5)`; `_dtol3` trunca para zero. Ou seja,
 *   arredondamento ao inteiro mais próximo com o meio afastado de zero (`Math.round` só difere nos negativos: −2,5 →
 *   −3 no original, −2 no `Math.round`). `Tools::Round64@0xa13b60` é o mesmo código (L-R11 fechada).
 * - [O] `Floor64(x)` = piso (truque SSE com 2^52); `Ceil64(x)` = `ceil` + `_dtol3`.
 */

/** `Tools::DoubleToInt64` / `Tools::Round64` [O]. */
export function doubleToInt64(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? Math.trunc(x - 0.5) : Math.trunc(x + 0.5);
}

/** `Tools::Floor64` [O]. */
export const floor64 = (x: number): number => (Number.isFinite(x) ? Math.floor(x) : 0);

/** `Tools::Ceil64` [O]. */
export const ceil64 = (x: number): number => (Number.isFinite(x) ? Math.ceil(x) : 0);
