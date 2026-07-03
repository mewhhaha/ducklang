import type { Env, Field, FrontExpr, FrontType, Stmt } from "../ast.ts";
import { capture_expr } from "../capture.ts";
import { clone_env } from "../env.ts";
import {
  contains_loop_control,
  dynamic_conditional_loop_control_body,
  type DynamicLoopState,
  guard_loop_step,
  loop_break_statements,
  loop_continue_statements,
  stmt_value_contains_loop_control,
} from "./dynamic_control.ts";
import { bind_static_if_let_payload } from "./if_let_payload.ts";
import type { ExpandedLoopBody, StaticLoopHooks } from "./types.ts";

export function expand_dynamic_loop_control_body(
  stmts: Stmt[],
  env: Env,
  hooks: StaticLoopHooks,
  state: DynamicLoopState,
): ExpandedLoopBody {
  const statements: Stmt[] = [];

  for (const stmt of stmts) {
    if (stmt.tag === "break") {
      statements.push(guard_loop_step(state, loop_break_statements(state)));
      return { statements, control: "none" };
    }

    if (stmt.tag === "continue") {
      statements.push(guard_loop_step(state, loop_continue_statements(state)));
      return { statements, control: "none" };
    }

    if (stmt.tag === "return") {
      statements.push(guard_loop_step(state, [stmt]));
      return { statements, control: "none" };
    }

    if (stmt.tag === "bind") {
      statements.push(dynamic_loop_control_binding(stmt, env, hooks, state));
      continue;
    }

    if (stmt.tag === "for_range" || stmt.tag === "for_collection") {
      throw new Error(
        "Cannot lower nested loop after dynamic loop control yet",
      );
    }

    if (stmt.tag === "if_stmt") {
      const cond = hooks.resolve_static_i32_expr(stmt.cond, env);

      if (cond !== undefined) {
        if (cond !== 0) {
          const body = expand_dynamic_loop_control_body(
            stmt.body,
            env,
            hooks,
            state,
          );
          statements.push(...body.statements);
        }

        continue;
      }

      const conditional_body = dynamic_conditional_loop_control_body(
        stmt.body,
        state,
      );

      if (conditional_body) {
        statements.push(
          guard_loop_step(state, [{
            tag: "if_stmt",
            cond: stmt.cond,
            body: conditional_body,
          }]),
        );
        continue;
      }

      if (contains_loop_control(stmt.body)) {
        const body = expand_dynamic_loop_control_body(
          stmt.body,
          env,
          hooks,
          state,
        );
        statements.push(
          guard_loop_step(state, [{
            tag: "if_stmt",
            cond: stmt.cond,
            body: body.statements,
          }]),
        );
        continue;
      }

      statements.push(guard_loop_step(state, [stmt]));
      continue;
    }

    if (stmt.tag === "if_let_stmt") {
      const target = hooks.resolve_union_value(stmt.target, env);

      if (target) {
        if (target.expr.name !== stmt.case_name) {
          continue;
        }

        const body = expand_dynamic_if_let_control_body(
          stmt,
          target,
          env,
          hooks,
          state,
        );
        statements.push(...body.statements);
        continue;
      }

      const conditional_body = dynamic_conditional_loop_control_body(
        stmt.body,
        state,
      );

      if (conditional_body) {
        statements.push(
          guard_loop_step(state, [{
            tag: "if_let_stmt",
            case_name: stmt.case_name,
            value_name: stmt.value_name,
            target: stmt.target,
            body: conditional_body,
          }]),
        );
        continue;
      }

      if (contains_loop_control(stmt.body)) {
        const body = expand_dynamic_loop_control_body(
          stmt.body,
          env,
          hooks,
          state,
        );
        statements.push(
          guard_loop_step(state, [{
            tag: "if_let_stmt",
            case_name: stmt.case_name,
            value_name: stmt.value_name,
            target: stmt.target,
            body: body.statements,
          }]),
        );
        continue;
      }

      statements.push(guard_loop_step(state, [stmt]));
      continue;
    }

    statements.push(guard_loop_step(state, [stmt]));
  }

  return { statements, control: "none" };
}

function dynamic_loop_control_binding(
  stmt: Extract<Stmt, { tag: "bind" }>,
  env: Env,
  hooks: StaticLoopHooks,
  state: DynamicLoopState,
): Extract<Stmt, { tag: "bind" }> {
  if (
    stmt.kind !== "let" ||
    stmt.is_linear ||
    stmt_value_contains_loop_control(stmt)
  ) {
    throw new Error(
      "Cannot lower local binding after dynamic loop control yet: " +
        stmt.name,
    );
  }

  const fallback = dynamic_loop_control_binding_fallback(
    stmt.name,
    hooks.infer_expr(stmt.value, env),
    stmt.value,
    env,
    hooks,
  );

  return {
    ...stmt,
    value: {
      tag: "if",
      cond: { tag: "var", name: state.step_name },
      then_branch: stmt.value,
      else_branch: fallback,
    },
  };
}

function dynamic_loop_control_binding_fallback(
  name: string,
  type: FrontType,
  value: FrontExpr,
  env: Env,
  hooks: StaticLoopHooks,
): FrontExpr {
  if (type.tag !== "int") {
    if (type.tag === "text") {
      return { tag: "text", value: "" };
    }

    if (type.tag === "struct") {
      const target = hooks.resolve_struct_value(value, env);

      if (target) {
        return dynamic_loop_control_struct_fallback(
          name,
          target,
          hooks,
        );
      }
    }

    if (type.tag === "union_value" || type.tag === "union") {
      const target = hooks.resolve_union_value(value, env);

      if (target) {
        return dynamic_loop_control_union_fallback(
          name,
          target,
          hooks,
        );
      }
    }

    if (type.tag === "unknown") {
      const resolved = dynamic_loop_control_unknown_fallback(
        name,
        value,
        env,
        hooks,
      );

      if (resolved) {
        return resolved;
      }
    }

    throw new Error(
      "Cannot lower local binding after dynamic loop control yet: " + name,
    );
  }

  if (type.type === "i64") {
    return { tag: "num", type: "i64", value: 0n };
  }

  if (type.type === "i32") {
    return { tag: "num", type: "i32", value: 0 };
  }

  throw new Error(
    "Cannot lower local binding after dynamic loop control yet: " + name,
  );
}

function dynamic_loop_control_unknown_fallback(
  name: string,
  value: FrontExpr,
  env: Env,
  hooks: StaticLoopHooks,
): FrontExpr | undefined {
  if (value.tag === "num") {
    if (value.type === "i64") {
      return { tag: "num", type: "i64", value: 0n };
    }

    return { tag: "num", type: "i32", value: 0 };
  }

  const static_i32 = hooks.resolve_static_i32_expr(value, env);

  if (static_i32 !== undefined) {
    return { tag: "num", type: "i32", value: 0 };
  }

  const text_bytes = hooks.resolve_text_bytes(value, env);

  if (text_bytes) {
    return { tag: "text", value: "" };
  }

  const target = hooks.resolve_struct_value(value, env);

  if (target) {
    return dynamic_loop_control_struct_fallback(name, target, hooks);
  }

  const union_target = hooks.resolve_union_value(value, env);

  if (union_target) {
    return dynamic_loop_control_union_fallback(name, union_target, hooks);
  }

  return undefined;
}

function dynamic_loop_control_struct_fallback(
  name: string,
  target: {
    expr: Extract<FrontExpr, { tag: "struct_value" }>;
    env: Env;
  },
  hooks: StaticLoopHooks,
): Extract<FrontExpr, { tag: "struct_value" }> {
  const fields: Field[] = [];

  for (const field of target.expr.fields) {
    const field_type = hooks.infer_expr(field.value, target.env);
    fields.push({
      name: field.name,
      value: dynamic_loop_control_binding_fallback(
        name + "." + field.name,
        field_type,
        field.value,
        target.env,
        hooks,
      ),
    });
  }

  return {
    tag: "struct_value",
    type_expr: capture_expr(target.expr.type_expr, target.env),
    fields,
  };
}

function dynamic_loop_control_union_fallback(
  name: string,
  target: {
    expr: Extract<FrontExpr, { tag: "union_case" }>;
    env: Env;
  },
  hooks: StaticLoopHooks,
): Extract<FrontExpr, { tag: "union_case" }> {
  let value: FrontExpr | undefined;

  if (target.expr.value) {
    const payload_type = hooks.infer_expr(target.expr.value, target.env);
    value = dynamic_loop_control_binding_fallback(
      name + "." + target.expr.name,
      payload_type,
      target.expr.value,
      target.env,
      hooks,
    );
  }

  return {
    tag: "union_case",
    name: target.expr.name,
    value,
    type_expr: target.expr.type_expr
      ? capture_expr(target.expr.type_expr, target.env)
      : undefined,
  };
}

function expand_dynamic_if_let_control_body(
  stmt: Extract<Stmt, { tag: "if_let_stmt" }>,
  target: { expr: Extract<FrontExpr, { tag: "union_case" }>; env: Env },
  env: Env,
  hooks: StaticLoopHooks,
  state: DynamicLoopState,
): ExpandedLoopBody {
  if (!stmt.value_name) {
    return expand_dynamic_loop_control_body(stmt.body, env, hooks, state);
  }

  const body_env = clone_env(env);
  bind_static_if_let_payload(stmt, target, body_env, hooks);
  return expand_dynamic_loop_control_body(stmt.body, body_env, hooks, state);
}
