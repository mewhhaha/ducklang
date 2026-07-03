import { specialize_prim_for_operands, type ValType } from "../../op.ts";
import type { Env, FrontExpr, FrontType } from "../ast.ts";
import { lookup } from "../env.ts";
import { prim_result_type } from "../numeric.ts";
import type { InferExprFn, InferHooks } from "./types.ts";

export function infer_prim_result_type(
  expr: Extract<FrontExpr, { tag: "prim" }>,
  env: Env,
  hooks: InferHooks,
  infer_expr: InferExprFn,
): ValType {
  const left_type = infer_prim_operand_type(expr.left, env, hooks, infer_expr);
  const right_type = infer_prim_operand_type(
    expr.right,
    env,
    hooks,
    infer_expr,
  );
  const prim = specialize_prim_for_operands(
    expr.prim,
    left_type,
    right_type,
  );
  return prim_result_type(prim);
}

export function infer_builtin_call_type(
  expr: Extract<FrontExpr, { tag: "app" }>,
  env: Env,
): FrontType | undefined {
  if (expr.func.tag !== "var") {
    return undefined;
  }

  if (expr.func.name === "len" && expr.args.length === 1) {
    return { tag: "int", type: "i32" };
  }

  if (expr.func.name === "slice" && expr.args.length === 3) {
    return { tag: "text" };
  }

  if (
    expr.func.name === "append" && expr.args.length === 2 &&
    !lookup(env, expr.func.name)
  ) {
    return { tag: "text" };
  }

  return undefined;
}

function infer_prim_operand_type(
  expr: FrontExpr,
  env: Env,
  hooks: InferHooks,
  infer_expr: InferExprFn,
): ValType | undefined {
  const type = infer_expr(expr, env, hooks);

  if (type.tag === "int") {
    return type.type;
  }

  return undefined;
}
