import { expect } from "../../expect.ts";
import { Prim, type ValType } from "../../op.ts";
import { Callable } from "../../trait.ts";
import type { Ic } from "../ast.ts";

type InferCtx = {
  types: Map<string, ValType>;
  params: string[];
  bound: Set<string>;
};

export function infer_open_term_params(
  ic: Ic,
  explicit_params: Record<string, ValType> | undefined,
): { types: Map<string, ValType>; params: string[] } {
  const ctx: InferCtx = {
    types: new Map(),
    params: [],
    bound: new Set(),
  };

  if (explicit_params) {
    for (const name in explicit_params) {
      const type = explicit_params[name];

      if (!type) {
        throw new Error("Missing open Ic parameter type: " + name);
      }

      set_var_type(ctx, name, type, "$.params." + name);
    }
  }

  infer_type(ctx, ic, undefined, "$");
  return { types: ctx.types, params: ctx.params };
}

function set_var_type(
  ctx: InferCtx,
  name: string,
  type: ValType,
  path: string,
): void {
  const previous = ctx.types.get(name);

  if (previous !== undefined) {
    if (previous !== type) {
      throw new Error(
        path + ": Open Ic variable " + name + " inferred as both " +
          previous + " and " + type,
      );
    }

    return;
  }

  ctx.types.set(name, type);

  if (!ctx.bound.has(name)) {
    ctx.params.push(name);
  }
}

function expect_type(
  actual: ValType,
  expected: ValType | undefined,
  path: string,
): ValType {
  if (expected !== undefined && actual !== expected) {
    throw new Error(
      path + ": Expected " + expected + ", got " + actual,
    );
  }

  return actual;
}

function infer_type(
  ctx: InferCtx,
  ic: Ic,
  expected: ValType | undefined,
  path: string,
): ValType {
  switch (ic.tag) {
    case "num":
      return expect_type(ic.type, expected, path);

    case "text":
      return expect_type("i32", expected, path);

    case "var": {
      const current = ctx.types.get(ic.name);

      if (expected !== undefined) {
        set_var_type(ctx, ic.name, expected, path);
        return expected;
      }

      if (current !== undefined) {
        return current;
      }

      throw new Error("Cannot infer open Ic variable type: " + ic.name);
    }

    case "prim": {
      const prim_type = Callable.type(Prim, ic.prim);
      const expected_arity = Callable.arity(Prim, ic.prim);

      if (ic.args.length !== expected_arity) {
        throw new Error(
          path + ": Primitive " + ic.prim + " expects " + expected_arity +
            " arguments",
        );
      }

      for (let index = 0; index < ic.args.length; index += 1) {
        const arg = ic.args[index];
        const arg_type = prim_type.args[index];

        if (!arg) {
          throw new Error(path + ": Missing primitive argument " + index);
        }

        if (!arg_type) {
          throw new Error(path + ": Missing primitive argument type " + index);
        }

        infer_type(
          ctx,
          arg,
          arg_type,
          path + ".args[" + index.toString() + "]",
        );
      }

      return expect_type(prim_type.result, expected, path);
    }

    case "dup":
      return infer_dup_type(ctx, ic, expected, path);

    case "lam":
      throw new Error("Cannot bridge unreduced Ic lambda to open-term Wasm");

    case "app":
      throw new Error(
        "Cannot bridge unreduced Ic application to open-term Wasm",
      );

    case "sup":
      throw new Error(
        "Cannot bridge unreduced Ic superposition to open-term Wasm",
      );

    case "era":
      throw new Error("Cannot bridge unreduced Ic erasure to open-term Wasm");

    case "fix":
      throw new Error(
        "Cannot bridge unreduced Ic recursive binding to open-term Wasm",
      );
  }
}

function infer_dup_type(
  ctx: InferCtx,
  ic: Extract<Ic, { tag: "dup" }>,
  expected: ValType | undefined,
  path: string,
): ValType {
  const left_name = ic.name + "0";
  const right_name = ic.name + "1";
  ctx.bound.add(left_name);
  ctx.bound.add(right_name);
  const body_type = infer_type(ctx, ic.body, expected, path + ".body");
  const left_type = ctx.types.get(left_name);
  const right_type = ctx.types.get(right_name);
  let value_type = left_type;

  if (value_type === undefined) {
    value_type = right_type;
  }

  if (left_type !== undefined && right_type !== undefined) {
    if (left_type !== right_type) {
      throw new Error(
        path + ": Dup projections for " + ic.name + " have different types",
      );
    }
  }

  infer_type(ctx, ic.expr, value_type, path + ".expr");
  return body_type;
}
