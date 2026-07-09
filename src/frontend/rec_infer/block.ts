import { expect } from "../../expect.ts";
import type { Env, FrontType, Stmt } from "../ast.ts";
import type { StaticRecHooks } from "../rec_hooks.ts";
import type { RecExprInfer } from "./types.ts";
import {
  lookup_rec_type_field,
  rec_front_type_for_type_name,
} from "../rec_util.ts";
import { common_front_type } from "../types.ts";

export function infer_rec_block(
  stmts: Stmt[],
  env: Env,
  hooks: StaticRecHooks,
  infer_rec_expr: RecExprInfer,
): FrontType {
  const local = hooks.clone_env(env);

  for (let index = 0; index < stmts.length; index += 1) {
    const stmt = stmts[index];
    expect(stmt, "Missing rec inference statement " + index);
    const is_final = index + 1 >= stmts.length;

    if (stmt.tag === "expr") {
      if (is_final) {
        return infer_rec_expr(stmt.expr, local, hooks);
      }

      continue;
    }

    if (stmt.tag === "return") {
      return infer_rec_expr(stmt.value, local, hooks);
    }

    if (stmt.tag === "bind") {
      infer_rec_bind_statement(stmt, local, hooks, infer_rec_expr);
      continue;
    }

    if (stmt.tag === "assign") {
      infer_rec_assign_statement(stmt, local, hooks, infer_rec_expr);
      continue;
    }

    if (stmt.tag === "index_assign") {
      const value = hooks.apply_index_assignment(stmt, local);
      hooks.push_binding(local, {
        name: stmt.name,
        ic_name: hooks.fresh(local, stmt.name),
        type: infer_rec_expr(value, local, hooks),
        is_const: false,
        is_linear: false,
        value,
        value_env: hooks.clone_env(local),
      });
      continue;
    }

    if (stmt.tag === "for_range") {
      const expanded = hooks.expand_for_range(stmt, local);
      const rest = stmts.slice(index + 1);
      return infer_rec_block(
        [...expanded, ...rest],
        local,
        hooks,
        infer_rec_expr,
      );
    }

    if (stmt.tag === "for_collection") {
      const expanded = hooks.expand_for_collection(stmt, local);
      const rest = stmts.slice(index + 1);
      return infer_rec_block(
        [...expanded, ...rest],
        local,
        hooks,
        infer_rec_expr,
      );
    }

    if (stmt.tag === "if_stmt") {
      const cond = hooks.resolve_static_i32_expr(stmt.cond, local);

      if (cond !== undefined && cond !== 0) {
        const rest = stmts.slice(index + 1);
        return infer_rec_block(
          [...stmt.body, ...rest],
          hooks.clone_env(local),
          hooks,
          infer_rec_expr,
        );
      }

      continue;
    }

    if (stmt.tag === "type_check") {
      hooks.check_type_pattern(stmt.pattern, stmt.target, local);
      continue;
    }

    if (stmt.tag === "import" || stmt.tag === "host_import") {
      return { tag: "unknown" };
    }

    if (stmt.tag === "break" || stmt.tag === "continue") {
      return { tag: "unknown" };
    }

    if (stmt.tag === "if_let_stmt") {
      const inferred = infer_rec_if_let_statement(
        stmt,
        stmts,
        index,
        local,
        hooks,
        infer_rec_expr,
      );

      if (inferred) {
        return inferred;
      }

      return { tag: "unknown" };
    }
  }

  return { tag: "unknown" };
}

function infer_rec_if_let_statement(
  stmt: Extract<Stmt, { tag: "if_let_stmt" }>,
  stmts: Stmt[],
  index: number,
  env: Env,
  hooks: StaticRecHooks,
  infer_rec_expr: RecExprInfer,
): FrontType | undefined {
  const rest = stmts.slice(index + 1);
  const target = hooks.resolve_union_value(stmt.target, env);

  if (target) {
    if (target.expr.name !== stmt.case_name) {
      return infer_rec_block(rest, env, hooks, infer_rec_expr);
    }

    const branch_env = hooks.clone_env(env);

    if (stmt.value_name) {
      const value = target.expr.value;

      if (!value) {
        throw new Error("Union case has no payload: " + stmt.case_name);
      }

      hooks.push_binding(branch_env, {
        name: stmt.value_name,
        ic_name: hooks.fresh(branch_env, stmt.value_name),
        type: infer_rec_expr(value, target.env, hooks),
        is_const: false,
        is_linear: false,
        value,
        value_env: target.env,
      });
    }

    return infer_rec_block(
      [...stmt.body, ...rest],
      branch_env,
      hooks,
      infer_rec_expr,
    );
  }

  const target_type = infer_rec_expr(stmt.target, env, hooks);

  if (target_type.tag !== "union_value") {
    return undefined;
  }

  const matched = lookup_rec_type_field(target_type.cases, stmt.case_name);

  if (!matched) {
    throw new Error("Missing union case: " + stmt.case_name);
  }

  const then_env = hooks.clone_env(env);

  if (stmt.value_name) {
    if (matched.type_name === "Unit") {
      throw new Error("Union case has no payload: " + stmt.case_name);
    }

    hooks.push_binding(then_env, {
      name: stmt.value_name,
      ic_name: hooks.fresh(then_env, stmt.value_name),
      type: rec_front_type_for_type_name(matched.type_name, env, hooks),
      is_const: false,
      is_linear: false,
      value: undefined,
      value_env: undefined,
    });
  }

  const then_type = infer_rec_block(
    [...stmt.body, ...rest],
    then_env,
    hooks,
    infer_rec_expr,
  );
  const else_type = infer_rec_block(
    rest,
    hooks.clone_env(env),
    hooks,
    infer_rec_expr,
  );
  return common_front_type(then_type, else_type);
}

function infer_rec_bind_statement(
  stmt: Extract<Stmt, { tag: "bind" }>,
  env: Env,
  hooks: StaticRecHooks,
  infer_rec_expr: RecExprInfer,
): void {
  let value = stmt.value;

  if (stmt.kind === "const") {
    value = hooks.prepare_const_value(value, env);
    hooks.push_binding(env, {
      name: stmt.name,
      ic_name: stmt.name,
      type: infer_rec_expr(value, env, hooks),
      is_const: true,
      is_linear: stmt.is_linear,
      value,
      value_env: undefined,
    });
    return;
  }

  value = hooks.prepare_runtime_value(value, env);
  let value_type = infer_rec_expr(value, env, hooks);

  if (stmt.annotation) {
    const annotated = hooks.apply_runtime_binding_annotation(
      stmt.annotation,
      value,
      env,
    );
    value = annotated.value;
    value_type = annotated.type;
  }

  hooks.push_binding(env, {
    name: stmt.name,
    ic_name: hooks.fresh(env, stmt.name),
    type: value_type,
    is_const: false,
    is_linear: stmt.is_linear,
    value,
    value_env: hooks.clone_env(env),
  });
}

function infer_rec_assign_statement(
  stmt: Extract<Stmt, { tag: "assign" }>,
  env: Env,
  hooks: StaticRecHooks,
  infer_rec_expr: RecExprInfer,
): void {
  const previous = hooks.lookup(env, stmt.name);
  expect(previous, "Cannot assign unbound name: " + stmt.name);
  const value = hooks.prepare_runtime_value(stmt.value, env);
  let value_type = infer_rec_expr(value, env, hooks);

  if (stmt.mode === "same" && !hooks.same_type(previous.type, value_type)) {
    throw new Error("Assignment changes type for " + stmt.name);
  }

  value_type = hooks.assignment_type(
    previous.type,
    value_type,
    stmt.mode,
  );

  hooks.push_binding(env, {
    name: stmt.name,
    ic_name: hooks.fresh(env, stmt.name),
    type: value_type,
    is_const: false,
    is_linear: previous.is_linear,
    value,
    value_env: hooks.clone_env(env),
  });
}
