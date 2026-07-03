import type { Ic as IcNode } from "../ic.ts";
import type { Env, FrontExpr, Stmt } from "./ast.ts";
import { structured_core_route } from "./diagnostic.ts";
import type { StaticRecHooks } from "./rec_hooks.ts";
import {
  lower_rec_get_call,
  lower_rec_len_call,
  lower_rec_runtime_text_byte_index,
} from "./rec_text.ts";
import {
  lower_rec_runtime_struct_field_access,
  lower_rec_runtime_struct_index_access,
  lower_rec_struct_get_call,
} from "./rec_struct.ts";
import {
  lower_rec_bound_if_let_union_result_app,
  lower_rec_if_let,
} from "./rec_union.ts";
import {
  create_rec_struct_hooks,
  lower_rec_if as lower_rec_if_with_hooks,
} from "./rec_if.ts";

export type StaticRecResult =
  | { tag: "done"; value: IcNode }
  | { tag: "call"; args: FrontExpr[] };

export type StaticRecBlockLowerer = (
  stmts: Stmt[],
  env: Env,
  hooks: StaticRecHooks,
) => StaticRecResult | undefined;

export function lower_rec_result_expr(
  expr: FrontExpr,
  env: Env,
  hooks: StaticRecHooks,
  lower_static_rec_block: StaticRecBlockLowerer,
): IcNode {
  const value = hooks.lower_static_expr(expr, env, new Set());

  if (value) {
    return value;
  }

  if (expr.tag === "captured") {
    return lower_rec_result_expr(
      expr.expr,
      expr.env,
      hooks,
      lower_static_rec_block,
    );
  }

  if (expr.tag === "block") {
    const result = lower_static_rec_block(expr.statements, env, hooks);

    if (!result) {
      throw new Error(
        "Cannot lower empty rec block to Ic frontend yet" +
          structured_core_route,
      );
    }

    if (result.tag === "call") {
      throw new Error(
        "Cannot lower dynamic rec call to Ic frontend yet" +
          structured_core_route,
      );
    }

    return result.value;
  }

  if (expr.tag === "var") {
    const binding = hooks.lookup(env, expr.name);

    if (!binding) {
      return hooks.lower_expr(expr, env);
    }

    if (binding.value) {
      let value_env = env;

      if (binding.value_env) {
        value_env = binding.value_env;
      }

      const bound = hooks.lower_static_expr(
        binding.value,
        value_env,
        new Set(),
      );

      if (bound) {
        return bound;
      }

      if (binding.value.tag !== "lam" && binding.value.tag !== "rec") {
        return lower_rec_result_expr(
          binding.value,
          value_env,
          hooks,
          lower_static_rec_block,
        );
      }
    }

    return { tag: "var", name: binding.ic_name };
  }

  if (expr.tag === "app") {
    const struct_hooks = create_rec_struct_hooks(hooks);
    const len = lower_rec_len_call(
      expr,
      env,
      hooks,
      (value, value_env) =>
        lower_rec_result_expr(
          value,
          value_env,
          hooks,
          lower_static_rec_block,
        ),
    );

    if (len) {
      return len;
    }

    const get = lower_rec_get_call(
      expr,
      env,
      hooks,
      (value, value_env) =>
        lower_rec_result_expr(
          value,
          value_env,
          hooks,
          lower_static_rec_block,
        ),
    );

    if (get) {
      return get;
    }

    const struct_get = lower_rec_struct_get_call(
      expr,
      env,
      struct_hooks,
      (value, value_env) =>
        lower_rec_result_expr(
          value,
          value_env,
          hooks,
          lower_static_rec_block,
        ),
    );

    if (struct_get) {
      return struct_get;
    }

    const bound_value_app = lower_rec_bound_value_app(
      expr,
      env,
      hooks,
      lower_static_rec_block,
    );

    if (bound_value_app) {
      return bound_value_app;
    }
  }

  if (expr.tag === "prim") {
    return {
      tag: "prim",
      prim: expr.prim,
      args: [
        lower_rec_result_expr(
          expr.left,
          env,
          hooks,
          lower_static_rec_block,
        ),
        lower_rec_result_expr(
          expr.right,
          env,
          hooks,
          lower_static_rec_block,
        ),
      ],
    };
  }

  if (expr.tag === "field") {
    const struct_hooks = create_rec_struct_hooks(hooks);
    const field = hooks.resolve_struct_field_expr(expr, env);

    if (field) {
      return lower_rec_result_expr(
        field.expr,
        field.env,
        hooks,
        lower_static_rec_block,
      );
    }

    const runtime_field = lower_rec_runtime_struct_field_access(
      expr,
      env,
      struct_hooks,
      (value, value_env) =>
        lower_rec_result_expr(
          value,
          value_env,
          hooks,
          lower_static_rec_block,
        ),
    );

    if (runtime_field) {
      return runtime_field;
    }
  }

  if (expr.tag === "if") {
    const lowered_if = lower_rec_if_with_hooks(
      expr,
      env,
      hooks,
      (value, value_env) =>
        lower_rec_result_expr(
          value,
          value_env,
          hooks,
          lower_static_rec_block,
        ),
    );

    if (lowered_if) {
      return lowered_if;
    }
  }

  if (expr.tag === "struct_value") {
    return lower_rec_struct_value(expr, env, hooks, lower_static_rec_block);
  }

  if (expr.tag === "if_let") {
    const if_let = lower_rec_if_let(
      expr,
      env,
      hooks,
      (value, value_env) =>
        lower_rec_result_expr(
          value,
          value_env,
          hooks,
          lower_static_rec_block,
        ),
    );

    if (if_let) {
      return if_let;
    }
  }

  if (expr.tag === "index") {
    const struct_hooks = create_rec_struct_hooks(hooks);
    const static_index = hooks.resolve_static_i32_expr(expr.index, env);

    if (static_index !== undefined) {
      const item = hooks.resolve_index_expr(expr, env);

      if (item) {
        return lower_rec_result_expr(
          item.expr,
          item.env,
          hooks,
          lower_static_rec_block,
        );
      }
    }

    const runtime_struct_index = lower_rec_runtime_struct_index_access(
      expr.object,
      expr.index,
      env,
      struct_hooks,
      (value, value_env) =>
        lower_rec_result_expr(
          value,
          value_env,
          hooks,
          lower_static_rec_block,
        ),
    );

    if (runtime_struct_index) {
      return runtime_struct_index;
    }

    const runtime_text_byte = lower_rec_runtime_text_byte_index(
      expr.object,
      expr.index,
      env,
      hooks,
      (value, value_env) =>
        lower_rec_result_expr(
          value,
          value_env,
          hooks,
          lower_static_rec_block,
        ),
    );

    if (runtime_text_byte) {
      return runtime_text_byte;
    }
  }

  return hooks.lower_expr(expr, env);
}

function lower_rec_bound_value_app(
  expr: Extract<FrontExpr, { tag: "app" }>,
  env: Env,
  hooks: StaticRecHooks,
  lower_static_rec_block: StaticRecBlockLowerer,
): IcNode | undefined {
  if (expr.func.tag !== "var") {
    return undefined;
  }

  const binding = hooks.lookup(env, expr.func.name);

  if (!binding) {
    return undefined;
  }

  if (!binding.value) {
    return undefined;
  }

  if (binding.value.tag === "lam" || binding.value.tag === "rec") {
    return undefined;
  }

  let value_env = env;

  if (binding.value_env) {
    value_env = binding.value_env;
  }

  const union_result_app = lower_rec_bound_if_let_union_result_app(
    binding.value,
    value_env,
    expr.args,
    env,
    hooks,
    (value, value_env) =>
      lower_rec_result_expr(
        value,
        value_env,
        hooks,
        lower_static_rec_block,
      ),
  );

  if (union_result_app) {
    return union_result_app;
  }

  let result = lower_rec_result_expr(
    expr.func,
    env,
    hooks,
    lower_static_rec_block,
  );

  for (const arg of expr.args) {
    result = {
      tag: "app",
      func: result,
      arg: lower_rec_result_expr(
        arg,
        env,
        hooks,
        lower_static_rec_block,
      ),
    };
  }

  return result;
}

function lower_rec_lambda_binding(name: string, body: IcNode): IcNode {
  return { tag: "lam", name, body };
}

function lower_rec_struct_value(
  expr: Extract<FrontExpr, { tag: "struct_value" }>,
  env: Env,
  hooks: StaticRecHooks,
  lower_static_rec_block: StaticRecBlockLowerer,
): IcNode {
  const handler_name = hooks.fresh(env, "pick");
  let body: IcNode = { tag: "var", name: handler_name };

  for (const field of expr.fields) {
    body = {
      tag: "app",
      func: body,
      arg: lower_rec_result_expr(
        field.value,
        env,
        hooks,
        lower_static_rec_block,
      ),
    };
  }

  return lower_rec_lambda_binding(handler_name, body);
}
