import { expect } from "./expect.ts";
import type { ValType } from "./op.ts";
import { indent, type Wat } from "./wat.ts";

export type Func = {
  result: ValType;
  body: Wat;
};

function Func() {}

Func.fmt = function fmt(name: string, func: Func): Wat {
  return `(func $${name} (result ${func.result})\n${indent(func.body, 2)}\n)`;
};

export type Mod = {
  funcs: Record<string, Func>;
  exports: string[];
};

export function Mod() {}

Mod.emit = function emit(mod: Mod): Wat {
  const parts = ["(module"];
  const funcs = Object.entries(mod.funcs)
    .map(([name, func]) => Func.fmt(name, func))
    .join("\n\n");

  if (funcs.length > 0) {
    parts.push(indent(funcs, 2));
  }

  for (const name of mod.exports) {
    expect(mod.funcs[name], "Missing function for export: " + name);
    parts.push(`  (export "${name}" (func $${name}))`);
  }

  parts.push(")");
  return parts.join("\n");
};
