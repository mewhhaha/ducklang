import type { Env, FrontExpr, FrontType, Stmt } from "../ast.ts";
import { assignment_type } from "../annotations.ts";
import { clone_env, lookup, push_binding } from "../env.ts";
import { infer_stmt_result_with } from "./stmt.ts";
import type { InferExprFn, InferHooks } from "./types.ts";

export function infer_block_type(
  statements: Stmt[],
  env: Env,
  hooks: InferHooks,
  infer_expr: InferExprFn,
): FrontType {
  if (statements.length === 0) {
    return { tag: "unknown" };
  }

  const local = clone_env(env);
  let result: FrontType = { tag: "unknown" };

  for (const stmt of statements) {
    result = infer_stmt_result_with(stmt, local, hooks, infer_expr);
    record_inferred_statement(stmt, result, local, hooks);

    if (stmt.tag === "return") {
      return result;
    }
  }

  return result;
}

function record_inferred_statement(
  stmt: Stmt,
  value_type: FrontType,
  env: Env,
  hooks: InferHooks,
): void {
  if (stmt.tag === "bind") {
    let type = value_type;

    if (stmt.annotation) {
      const annotation_type = hooks.resolve_annotation_type(
        stmt.annotation,
        env,
      );

      if (annotation_type) {
        type = annotation_type;
      }
    }

    push_inferred_binding(
      stmt.name,
      type,
      stmt.kind === "const",
      stmt.is_linear,
      stmt.value,
      env,
    );
    return;
  }

  if (stmt.tag === "assign") {
    const previous = lookup(env, stmt.name);

    if (!previous) {
      return;
    }

    push_inferred_binding(
      stmt.name,
      assignment_type(previous.type, value_type, stmt.mode),
      previous.is_const,
      previous.is_linear,
      stmt.value,
      env,
    );
    return;
  }

  if (stmt.tag === "index_assign") {
    const previous = lookup(env, stmt.name);

    if (!previous) {
      return;
    }

    push_inferred_binding(
      stmt.name,
      previous.type,
      previous.is_const,
      previous.is_linear,
      undefined,
      env,
    );
  }
}

function push_inferred_binding(
  name: string,
  type: FrontType,
  is_const: boolean,
  is_linear: boolean,
  value: FrontExpr | undefined,
  env: Env,
): void {
  push_binding(env, {
    name,
    ic_name: name,
    type,
    is_const,
    is_linear,
    value,
    value_env: clone_env(env),
  });
}
