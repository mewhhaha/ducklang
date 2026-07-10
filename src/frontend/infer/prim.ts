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
    const value = expr.args[0];

    if (!value) {
      throw new Error("Missing slice value argument");
    }

    const value_type = infer_builtin_text_arg_type(value, env);

    if (value_type) {
      return value_type;
    }

    return { tag: "text" };
  }

  if (
    expr.func.name === "append" && expr.args.length === 2 &&
    !lookup(env, expr.func.name)
  ) {
    const left = expr.args[0];
    const right = expr.args[1];

    if (!left || !right) {
      throw new Error("Missing append argument");
    }

    const left_type = infer_builtin_text_arg_type(left, env);
    const right_type = infer_builtin_text_arg_type(right, env);

    if (
      left_type && right_type &&
      left_type.encoding === right_type.encoding
    ) {
      return left_type;
    }

    return { tag: "text" };
  }

  return undefined;
}

function infer_builtin_text_arg_type(
  expr: FrontExpr,
  env: Env,
): Extract<FrontType, { tag: "text" }> | undefined {
  if (expr.tag === "text") {
    return { tag: "text" };
  }

  if (expr.tag !== "var" && expr.tag !== "linear") {
    return undefined;
  }

  const binding = lookup(env, expr.name);

  if (!binding || binding.type.tag !== "text") {
    return undefined;
  }

  return binding.type;
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
