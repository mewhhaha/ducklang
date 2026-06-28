export type ValType = "i32" | "i64";

export const PRIMS = {
  add: {
    fmt: "+",
    arity: 2,
    wat: {
      i32: "i32.add",
      i64: "i64.add",
    },
  },
  sub: {
    fmt: "-",
    arity: 2,
    wat: {
      i32: "i32.sub",
      i64: "i64.sub",
    },
  },
  mul: {
    fmt: "*",
    arity: 2,
    wat: {
      i32: "i32.mul",
      i64: "i64.mul",
    },
  },
} as const;

export type Prim = keyof typeof PRIMS;

export function expectArity(prim: Prim, args: readonly unknown[]): void {
  const arity = PRIMS[prim].arity;

  if (args.length !== arity) {
    throw new Error("Primitive " + prim + " expects " + arity + " arguments");
  }
}

export function watPrim(type: ValType, prim: Prim): string {
  return PRIMS[prim].wat[type];
}
