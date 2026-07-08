import { expect } from "../../expect.ts";
import type { Ic as IcNode } from "../../ic.ts";
import type { Binding, Env, FrontExpr, FrontType, Stmt } from "../ast.ts";
import { structured_core_route } from "../diagnostic.ts";
import { clone_env, fresh, push_binding } from "../env.ts";
import { lower_bound_value } from "../ic_share.ts";
import { linear_param_names, validate_linear_lam } from "../linear.ts";
import { validate_rec_tail } from "../rec.ts";
import { lower_expr_as_front_type } from "../typed_lower.ts";
import { lower_binding_body } from "./binding_body.ts";
import { can_defer_call_only_runtime_lam_binding } from "./call_only_defer.ts";
import type {
  LowerStatementsWithDone,
  StatementDone,
  StatementLowerHooks,
} from "./types.ts";

export function lower_recursive_runtime_binding(
  name: string,
  stmt_value: FrontExpr,
  value_type: FrontType,
  stmts: Stmt[],
  index: number,
  env: Env,
  hooks: StatementLowerHooks,
  on_done: StatementDone,
  lower_statements_with_done: LowerStatementsWithDone,
  is_linear: boolean,
): IcNode {
  if (is_linear) {
    throw new Error("Recursive binding cannot be linear: " + name);
  }

  if (stmt_value.tag !== "lam") {
    throw new Error("Recursive binding requires a lambda: " + name);
  }

  if (hooks.requires_specialized_call(stmt_value, env)) {
    throw new Error(
      "Cannot lower specialized recursive function to Ic frontend: " + name,
    );
  }

  const ic_name = fresh(env, name);
  const binding: Binding = {
    name,
    ic_name,
    type: value_type,
    is_const: false,
    is_linear: false,
    value: undefined,
    value_env: undefined,
  };
  push_binding(env, binding);

  const value = lower_expr_as_front_type(stmt_value, value_type, env, hooks);
  const body = lower_binding_body(
    stmts,
    index,
    env,
    ic_name,
    hooks,
    on_done,
    lower_statements_with_done,
  );

  return { tag: "fix", name: ic_name, expr: value, body };
}

export function lower_runtime_binding(
  name: string,
  stmt_value: FrontExpr,
  value_type: FrontType,
  stmts: Stmt[],
  index: number,
  env: Env,
  hooks: StatementLowerHooks,
  on_done: StatementDone,
  lower_statements_with_done: LowerStatementsWithDone,
  is_linear = false,
): IcNode {
  if (stmt_value.tag === "rec") {
    validate_rec_tail(stmt_value.body);
    const ic_name = fresh(env, name);
    const binding: Binding = {
      name,
      ic_name,
      type: value_type,
      is_const: false,
      is_linear,
      value: stmt_value,
      value_env: clone_env(env),
    };
    push_binding(env, binding);

    if (index + 1 >= stmts.length) {
      throw new Error(
        "Cannot lower rec function value to Ic frontend yet" +
          structured_core_route,
      );
    }

    return lower_statements_with_done(
      stmts,
      index + 1,
      env,
      hooks,
      on_done,
    );
  }

  if (
    stmt_value.tag === "lam" && hooks.requires_specialized_call(stmt_value, env)
  ) {
    const ic_name = fresh(env, name);
    const binding: Binding = {
      name,
      ic_name,
      type: value_type,
      is_const: false,
      is_linear,
      value: stmt_value,
      value_env: clone_env(env),
    };
    push_binding(env, binding);

    if (index + 1 >= stmts.length) {
      if (linear_param_names(stmt_value).size > 0) {
        validate_linear_lam(stmt_value);
        throw new Error(
          "Cannot lower linear function to Ic frontend yet" +
            structured_core_route,
        );
      }

      throw new Error(
        "Cannot lower specialized function as runtime value without call-site specialization: " +
          name,
      );
    }

    return lower_statements_with_done(
      stmts,
      index + 1,
      env,
      hooks,
      on_done,
    );
  }

  const bind_typed_value = should_bind_typed_runtime_value(
    stmt_value,
    value_type,
    env,
    hooks,
  );

  if (hooks.is_deferred_frontend_value(stmt_value, env) && !bind_typed_value) {
    const ic_name = fresh(env, name);
    const binding: Binding = {
      name,
      ic_name,
      type: value_type,
      is_const: false,
      is_linear,
      value: stmt_value,
      value_env: clone_env(env),
      is_deferred: true,
    };
    push_binding(env, binding);

    if (index + 1 >= stmts.length) {
      if (on_done) {
        return on_done();
      }

      return hooks.lower_expr(stmt_value, env);
    }

    return lower_statements_with_done(
      stmts,
      index + 1,
      env,
      hooks,
      on_done,
    );
  }

  let value: IcNode;

  try {
    value = lower_expr_as_front_type(stmt_value, value_type, env, hooks);
  } catch (error) {
    if (
      can_defer_call_only_runtime_lam_binding(
        name,
        stmt_value,
        stmts,
        index,
        is_linear,
        error,
      )
    ) {
      const ic_name = fresh(env, name);
      const binding: Binding = {
        name,
        ic_name,
        type: value_type,
        is_const: false,
        is_linear,
        value: stmt_value,
        value_env: clone_env(env),
      };
      push_binding(env, binding);

      return lower_statements_with_done(
        stmts,
        index + 1,
        env,
        hooks,
        on_done,
      );
    }

    throw error;
  }

  const ic_name = fresh(env, name);
  const binding: Binding = {
    name,
    ic_name,
    type: value_type,
    is_const: false,
    is_linear,
    value: runtime_binding_value(stmt_value, bind_typed_value),
    value_env: clone_env(env),
  };
  push_binding(env, binding);
  const body = lower_binding_body(
    stmts,
    index,
    env,
    ic_name,
    hooks,
    on_done,
    lower_statements_with_done,
  );
  return lower_bound_value(value, body, ic_name);
}

function should_bind_typed_runtime_value(
  value: FrontExpr,
  type: FrontType,
  env: Env,
  hooks: StatementLowerHooks,
): boolean {
  if (value.tag !== "if" || type.tag !== "union_value") {
    return false;
  }

  return hooks.lower_dynamic_union_if(value, env) === undefined;
}

function runtime_binding_value(
  value: FrontExpr,
  bind_typed_value: boolean,
): FrontExpr | undefined {
  if (bind_typed_value) {
    return undefined;
  }

  return value;
}
