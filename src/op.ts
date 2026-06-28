export const OPS = {
  add: { fmt: "+", wat: "i32.add" },
  sub: { fmt: "-", wat: "i32.sub" },
  mul: { fmt: "*", wat: "i32.mul" },
} as const;

export type Op = keyof typeof OPS;

export function isOp(tag: string): tag is Op {
  return tag in OPS;
}
