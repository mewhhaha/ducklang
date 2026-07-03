import { expect } from "../expect.ts";
import type { Env, FrontExpr, FrontType, Stmt, TypeField } from "./ast.ts";
import type { StaticRecHooks } from "./rec_hooks.ts";
import {
  lookup_rec_type_field,
  rec_front_type_for_type_name,
} from "./rec_util.ts";
import { common_front_type, val_type_from_type_name } from "./types.ts";

export function infer_rec_expr(
  expr: FrontExpr,
  env: Env,
  hooks: StaticRecHooks,
): FrontType {
  if (expr.tag === "captured") {
    return infer_rec_expr(expr.expr, expr.env, hooks);
  }

  if (expr.tag === "block") {
    return infer_rec_block(expr.statements, env, hooks);
  }

  if (expr.tag === "field") {
    const field_type = infer_rec_field_expr(expr, env, hooks);

    if (field_type) {
      return field_type;
    }
  }

  if (expr.tag === "index") {
    const item_type = infer_rec_index_expr(expr, env, hooks);

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

function infer_rec_block(
  stmts: Stmt[],
  env: Env,
  hooks: StaticRecHooks,
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
      infer_rec_bind_statement(stmt, local, hooks);
      continue;
    }

    if (stmt.tag === "assign") {
      infer_rec_assign_statement(stmt, local, hooks);
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
      return infer_rec_block([...expanded, ...rest], local, hooks);
    }

    if (stmt.tag === "for_collection") {
      const expanded = hooks.expand_for_collection(stmt, local);
      const rest = stmts.slice(index + 1);
      return infer_rec_block([...expanded, ...rest], local, hooks);
    }

    if (stmt.tag === "if_stmt") {
      const cond = hooks.resolve_static_i32_expr(stmt.cond, local);

      if (cond !== undefined && cond !== 0) {
        const rest = stmts.slice(index + 1);
        return infer_rec_block(
          [...stmt.body, ...rest],
          hooks.clone_env(local),
          hooks,
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
): FrontType | undefined {
  const rest = stmts.slice(index + 1);
  const target = hooks.resolve_union_value(stmt.target, env);

  if (target) {
    if (target.expr.name !== stmt.case_name) {
      return infer_rec_block(rest, env, hooks);
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

    return infer_rec_block([...stmt.body, ...rest], branch_env, hooks);
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
  );
  const else_type = infer_rec_block(rest, hooks.clone_env(env), hooks);
  return common_front_type(then_type, else_type);
}

function infer_rec_bind_statement(
  stmt: Extract<Stmt, { tag: "bind" }>,
  env: Env,
  hooks: StaticRecHooks,
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

function infer_rec_field_expr(
  expr: Extract<FrontExpr, { tag: "field" }>,
  env: Env,
  hooks: StaticRecHooks,
): FrontType | undefined {
  const field = hooks.resolve_struct_field_expr(expr, env);

  if (field) {
    return infer_rec_expr(field.expr, field.env, hooks);
  }

  const object_type = infer_rec_expr(expr.object, env, hooks);

  if (object_type.tag !== "struct" || !object_type.field_types) {
    return undefined;
  }

  const field_type = lookup_rec_type_field(object_type.field_types, expr.name);

  if (!field_type) {
    throw new Error("Missing struct field: " + expr.name);
  }

  return rec_front_type_for_type_name(field_type.type_name, env, hooks);
}

function infer_rec_index_expr(
  expr: Extract<FrontExpr, { tag: "index" }>,
  env: Env,
  hooks: StaticRecHooks,
): FrontType | undefined {
  const static_index = hooks.resolve_static_i32_expr(expr.index, env);

  if (static_index !== undefined) {
    const item = hooks.resolve_index_expr(expr, env);

    if (item) {
      return infer_rec_expr(item.expr, item.env, hooks);
    }
  }

  const object_type = infer_rec_expr(expr.object, env, hooks);

  if (object_type.tag !== "struct" || !object_type.field_types) {
    return undefined;
  }

  if (static_index !== undefined) {
    if (static_index < 0 || static_index >= object_type.field_types.length) {
      throw new Error("Index out of bounds: " + static_index.toString());
    }

    const field = object_type.field_types[static_index];
    expect(field, "Missing indexed field " + static_index.toString());
    return rec_front_type_for_type_name(field.type_name, env, hooks);
  }

  return infer_rec_dynamic_struct_index_type(object_type.field_types);
}

function infer_rec_dynamic_struct_index_type(fields: TypeField[]): FrontType {
  let all_text = fields.length > 0;

  for (const field of fields) {
    if (field.type_name !== "Text") {
      all_text = false;
    }
  }

  if (all_text) {
    return { tag: "text" };
  }

  let result_type: "i32" | "i64" | undefined;

  for (const field of fields) {
    const field_type = val_type_from_type_name(field.type_name);

    if (!field_type) {
      return { tag: "unknown" };
    }

    if (result_type && result_type !== field_type) {
      throw new Error("Mixed i32 and i64 indexed values");
    }

    result_type = field_type;
  }

  if (result_type === "i64") {
    return { tag: "int", type: "i64" };
  }

  return { tag: "int", type: "i32" };
}
