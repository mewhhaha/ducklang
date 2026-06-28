import { expect } from "./expect.ts";
import type { ValType } from "./op.ts";
import { indent, type Wat } from "./wat.ts";

export type Func = {
  name: string;
  result: ValType;
  body: Wat;
};

export type Mod = {
  funcs: Func[];
  exports: string[];
};

export function Mod() {}

function hasFunc(mod: Mod, name: string): boolean {
  for (const func of mod.funcs) {
    if (func.name === name) {
      return true;
    }
  }

  return false;
}

function fmtFunc(func: Func): Wat {
  return `(func $${func.name} (result ${func.result})\n${indent(func.body, 2)}\n)`;
}

Mod.emit = function emit(mod: Mod): Wat {
  const parts = ["(module"];
  const funcs = mod.funcs.map(fmtFunc).join("\n\n");

  if (funcs.length > 0) {
    parts.push(indent(funcs, 2));
  }

  for (const name of mod.exports) {
    expect(hasFunc(mod, name), "Unknown export: " + name);
    parts.push(`  (export "${name}" (func $${name}))`);
  }

  parts.push(")");
  return parts.join("\n");
};
