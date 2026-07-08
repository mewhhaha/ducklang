import { emit_expr_with_env, Expr } from "../expr.ts";
import { type FuncParam, Mod, type Mod as ModNode } from "../mod.ts";
import { type ValType } from "../op.ts";
import { Data, Emit, Typed } from "../trait.ts";
import { type Wat } from "../wat.ts";
import type { Ic } from "./ast.ts";
import { reduce_ic_graph } from "./graph_reduce.ts";
import { lower_ic_with_env } from "./lower.ts";
import { infer_open_term_params } from "./open_term/infer.ts";
import { try_recursive_open_mod } from "./open_term/recursive.ts";

export type IcOpenOptions = {
  name?: string;
  params?: Record<string, ValType>;
};

export function ic_open_mod(ic: Ic, options?: IcOpenOptions): ModNode {
  let name = "main";
  let explicit_params: Record<string, ValType> | undefined;

  if (options) {
    if (options.name !== undefined) {
      name = options.name;
    }

    explicit_params = options.params;
  }

  const recursive = try_recursive_open_mod(ic, name, explicit_params);

  if (recursive) {
    return recursive;
  }

  const reduced = reduce_ic_graph(ic);
  const inferred = infer_open_term_params(reduced, explicit_params);
  const expr = lower_ic_with_env(reduced, inferred.types);
  const body = emit_expr_with_env(expr, inferred.types);
  const data = Data.data(Expr, expr);
  const params: FuncParam[] = inferred.params.map((param_name) => {
    const type = inferred.types.get(param_name);

    if (!type) {
      throw new Error("Missing inferred open Ic parameter type: " + param_name);
    }

    return { name: param_name, type };
  });
  const mod: ModNode = {
    funcs: {
      [name]: {
        name,
        params,
        result: Typed.type(Expr, expr),
        body,
      },
    },
    exports: [name],
  };

  if (data.length > 0) {
    mod.memory = {
      name: "memory",
      pages: 1,
      export_name: "memory",
    };
    mod.data = data;
  }

  return mod;
}

export function ic_open_wat(ic: Ic, options?: IcOpenOptions): Wat {
  return Emit.emit(Mod, ic_open_mod(ic, options));
}
