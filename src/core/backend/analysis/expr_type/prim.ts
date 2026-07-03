import { expect } from "../../../../expect.ts";
import {
  type Prim as PrimNode,
  specialize_prim_for_operands,
  type ValType,
} from "../../../../op.ts";
import type { CoreExpr } from "../../../ast.ts";
import type { StaticCtx } from "../../../local_collect.ts";

export function core_typed_prim(
  expr: Extract<CoreExpr, { tag: "prim" }>,
  ctx: StaticCtx,
  expr_type: (expr: CoreExpr, ctx: StaticCtx) => ValType,
): PrimNode {
  if (expr.args.length !== 2) {
    return expr.prim;
  }

  const left = expr.args[0];
  const right = expr.args[1];
  expect(left, "Missing core primitive left operand");
  expect(right, "Missing core primitive right operand");
  return specialize_prim_for_operands(
    expr.prim,
    expr_type(left, ctx),
    expr_type(right, ctx),
  );
}
