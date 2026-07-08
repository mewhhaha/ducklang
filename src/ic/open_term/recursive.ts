import { type Mod as ModNode } from "../../mod.ts";
import { type ValType } from "../../op.ts";
import type { Ic } from "../ast.ts";
import {
  emit_recursive_func_body,
  emit_recursive_main_body,
} from "./recursive/emit.ts";
import {
  infer_recursive_open_term,
  recursive_func_params,
  recursive_main_params,
} from "./recursive/infer.ts";

export function try_recursive_open_mod(
  ic: Ic,
  name: string,
  explicit_params: Record<string, ValType> | undefined,
): ModNode | undefined {
  if (ic.tag !== "fix") {
    return undefined;
  }

  const inferred = infer_recursive_open_term(ic, name, explicit_params);
  const mod_funcs: Record<string, ModNode["funcs"][string]> = {};
  mod_funcs[inferred.func.name] = {
    name: inferred.func.name,
    params: recursive_func_params(inferred.func),
    result: inferred.func_result,
    body: emit_recursive_func_body(
      inferred.func,
      inferred.types,
      inferred.funcs,
    ),
  };
  mod_funcs[name] = {
    name,
    params: recursive_main_params(inferred),
    result: inferred.main_result,
    body: emit_recursive_main_body(
      ic.body,
      inferred.types,
      inferred.funcs,
    ),
  };

  return {
    funcs: mod_funcs,
    exports: [name],
  };
}
