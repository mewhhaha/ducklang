import type { FrontExpr, Param } from "./ast.ts";
import { expr_collects_from_names } from "./visible_params/collect.ts";
import { expr_iterates_collection_from_names } from "./visible_params/iterate.ts";

type LamExpr = Extract<FrontExpr, { tag: "lam" }>;

export function has_visible_value_param(
  expr: LamExpr,
): boolean {
  const names = new Set<string>();

  for (const param of expr.params) {
    names.add(param.name);
  }

  return expr_collects_from_names(expr.body, names);
}

export function param_can_defer_visible_text(
  target: LamExpr,
  param: Param,
): boolean {
  if (!param_needs_visible_value(target, param.name)) {
    return false;
  }

  if (!param.annotation) {
    return true;
  }

  return param_iterates_collection_value(target, param.name);
}

function param_needs_visible_value(
  target: LamExpr,
  name: string,
): boolean {
  return expr_collects_from_names(target.body, new Set([name]));
}

function param_iterates_collection_value(
  target: LamExpr,
  name: string,
): boolean {
  return expr_iterates_collection_from_names(target.body, new Set([name]));
}
