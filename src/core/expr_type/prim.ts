import { expect } from "../../expect.ts";
import { Prim, type ValType } from "../../op.ts";
import { Callable } from "../../trait.ts";
import type { CoreExpr } from "../ast.ts";
import type {
  CoreExprTypeBlockCtx,
  CoreExprTypeCtx,
  CoreExprTypeHooks,
  CoreInferExprType,
} from "./types.ts";

export function prim_expr_type<
  ctx extends CoreExprTypeCtx,
  block_ctx extends ctx & CoreExprTypeBlockCtx,
>(
  expr: Extract<CoreExpr, { tag: "prim" }>,
  ctx: ctx,
  hooks: CoreExprTypeHooks<ctx, block_ctx>,
  infer_expr_type: CoreInferExprType<ctx, block_ctx>,
): ValType {
  const text_value = hooks.static_text_value(expr, ctx);

  if (text_value) {
    return "i32";
  }

  if (hooks.core_runtime_text_concat_operands(expr, ctx)) {
    return "i32";
  }

  if (hooks.core_runtime_text_eq_operands(expr, ctx)) {
    return "i32";
  }

  hooks.check_core_text_concat_operand_visibility(expr, ctx);
  const prim = hooks.core_typed_prim(expr, ctx);
  const expected = Callable.arity(Prim, prim);
  expect(
    expr.args.length === expected,
    "Primitive " + prim + " expects " + expected + " arguments",
  );
  const prim_type = Callable.type(Prim, prim);

  for (let index = 0; index < expr.args.length; index += 1) {
    const arg = expr.args[index];
    expect(arg, "Missing primitive argument " + index);
    const expected_type = prim_type.args[index];
    expect(expected_type, "Missing primitive argument type " + index);
    const actual = infer_expr_type(arg, ctx, hooks);
    expect(
      actual === expected_type,
      "Primitive " + prim + " argument " + index + " expects " +
        expected_type + ", got " + actual,
    );
  }

  return prim_type.result;
}
