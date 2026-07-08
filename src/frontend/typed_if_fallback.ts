import { expect } from "../expect.ts";
import type { Env, FrontExpr, FrontType } from "./ast.ts";
import { implicit_fallback_expr } from "./implicit_fallback.ts";
import { front_type_name } from "./types.ts";
import type { FrontTypedLowerHooks } from "./typed_hooks.ts";

export function typed_if_else_branch(
  expr: Extract<FrontExpr, { tag: "if" }>,
  type: FrontType,
  env: Env,
  hooks: FrontTypedLowerHooks,
): FrontExpr {
  if (!expr.implicit_else) {
    return expr.else_branch;
  }

  const fallback = implicit_fallback_expr(type, env, {
    resolve_annotation_type: (annotation, annotation_env) => {
      if (hooks.resolve_annotation_type) {
        return hooks.resolve_annotation_type(annotation, annotation_env);
      }

      return undefined;
    },
  });
  expect(
    fallback,
    "Missing typed implicit fallback for " + front_type_name(type),
  );
  return fallback;
}

export function typed_if_let_else_branch(
  expr: Extract<FrontExpr, { tag: "if_let" }>,
  type: FrontType,
  env: Env,
  hooks: FrontTypedLowerHooks,
): FrontExpr {
  if (!expr.implicit_else) {
    return expr.else_branch;
  }

  const fallback = implicit_fallback_expr(type, env, {
    resolve_annotation_type: (annotation, annotation_env) => {
      if (hooks.resolve_annotation_type) {
        return hooks.resolve_annotation_type(annotation, annotation_env);
      }

      return undefined;
    },
  });
  expect(
    fallback,
    "Missing typed implicit fallback for " + front_type_name(type),
  );
  return fallback;
}
