import type { Env, FrontExpr, FrontType } from "./ast.ts";
import type { StaticRecHooks } from "./rec_hooks.ts";
import {
  infer_rec_field_expr,
  infer_rec_index_expr,
} from "./rec_infer/access.ts";
import { infer_rec_block } from "./rec_infer/block.ts";

export function infer_rec_expr(
  expr: FrontExpr,
  env: Env,
  hooks: StaticRecHooks,
): FrontType {
  if (expr.tag === "captured") {
    return infer_rec_expr(expr.expr, expr.env, hooks);
  }

  if (expr.tag === "block") {
    return infer_rec_block(expr.statements, env, hooks, infer_rec_expr);
  }

  if (expr.tag === "field") {
    const field_type = infer_rec_field_expr(expr, env, hooks, infer_rec_expr);

    if (field_type) {
      return field_type;
    }
  }

  if (expr.tag === "index") {
    const item_type = infer_rec_index_expr(expr, env, hooks, infer_rec_expr);

    if (item_type) {
      return item_type;
    }
  }

  if (expr.tag === "var") {
    const binding = hooks.lookup(env, expr.name);

    if (binding) {
      return binding.type;
    }
  }

  return hooks.infer_expr(expr, env);
}
