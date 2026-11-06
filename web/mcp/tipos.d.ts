/** Modelo do motor (.dr5), embutido como bytes pelo esbuild (loader binary). */
declare module '*.dr5' {
  const bytes: Uint8Array
  export default bytes
}
