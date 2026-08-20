// Ambient declaration for the `lzma1` package, which ships its `types` field
// pointing at its own raw .ts source. tsc's noUnusedLocals then trips on an
// unused `interface Mode` inside that source — declare the surface here so
// our own checks don't have to follow the chain.
declare module 'lzma1' {
  export const compress: (data: Uint8Array | ArrayBuffer, mode?: number) => Uint8Array;
  export const decompress: (data: Uint8Array | ArrayBuffer) => Uint8Array;
}
