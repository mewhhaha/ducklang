import { specialize_prim_for_operands } from "../op.ts";
import type {
  Binding,
  Declaration,
  Env,
  Field,
  FrontExpr,
  FrontType,
  Param,
  Source,
  Stmt,
  TypeDeclaration,
  TypeExpr,
  TypeField,
} from "./ast.ts";
import { call_message, lookup_type_field } from "./fields.ts";
import { validate_const_expr } from "./constness.ts";
import { clone_env, create_env, push_binding } from "./env.ts";
import { is_no_demand_name } from "./names.ts";
import { require_struct_field } from "./struct_access.ts";
import {
  source_diagnostic,
  type SourceDiagnostic,
} from "./semantic_diagnostic.ts";
import { prim_result_type } from "./numeric.ts";
import { front_type_from_type_name, same_type } from "./types.ts";
import { scan_source, source_tokens } from "./tokenize.ts";
import { validate_union_payload_type } from "./union_payload.ts";

type SemanticBinding = {
  type: FrontType;
  value: FrontExpr | undefined;
  struct_fields: Field[] | undefined;
  declaration: Extract<Stmt, { tag: "bind" }> | undefined;
  used: boolean;
};

type SemanticEnv = {
  all_bindings: SemanticBinding[];
  bindings: Map<string, SemanticBinding>;
  const_env: Env;
  declarations: Map<string, TypeDeclaration>;
};

export type SemanticValidationOptions = {
  warnings?: boolean;
};

export function validate_frontend_semantics(
  source: Source,
  options: SemanticValidationOptions = {},
): SourceDiagnostic[] {
  const env: SemanticEnv = {
    all_bindings: [],
    bindings: new Map(),
    const_env: create_env(),
    declarations: declaration_index(source.declarations || []),
  };
  const diagnostics: SourceDiagnostic[] = [];

  validate_statements(source.statements, env, diagnostics);

  if (options.warnings === true) {
    append_unused_binding_warnings(env.all_bindings, diagnostics);
  }

  return diagnostics;
}

function declaration_index(
  declarations: Declaration[],
): Map<string, TypeDeclaration> {
  const index = new Map<string, TypeDeclaration>();

  for (const declaration of declarations) {
    if (declaration.tag === "type") {
      index.set(declaration.name, declaration);
    }
  }

  return index;
}

function validate_statements(
  statements: Stmt[],
  env: SemanticEnv,
  diagnostics: SourceDiagnostic[],
): void {
  for (const stmt of statements) {
    validate_statement(stmt, env, diagnostics);
  }
}

function validate_statement(
  stmt: Stmt,
  env: SemanticEnv,
  diagnostics: SourceDiagnostic[],
): void {
  if (stmt.tag === "bind") {
    mark_annotation_use(stmt.annotation, stmt.type_annotation, env);
    let binding: SemanticBinding | undefined;

    if (stmt.is_recursive) {
      binding = {
        type: { tag: "unknown" },
        value: stmt.value,
        struct_fields: undefined,
        declaration: stmt,
        used: false,
      };
      env.bindings.set(stmt.name, binding);
      env.all_bindings.push(binding);
      bind_constness(env.const_env, stmt, binding.type);
    }

    if (stmt.kind === "const") {
      try {
        validate_const_expr(
          stmt.value,
          env.const_env,
          new Set(),
          "Const binding captures runtime value",
        );
      } catch (error) {
        if (error instanceof Error) {
          diagnostics.push(
            source_diagnostic("IX2101", "error", error.message, stmt.value),
          );
        } else {
          throw error;
        }
      }
    }

    const before = diagnostics.length;
    validate_expr(
      stmt.value,
      env,
      diagnostics,
      stmt.kind !== "const",
    );
    let type: FrontType = { tag: "unknown" };

    if (diagnostics.length === before) {
      type = infer_type(stmt.value, env);
    }

    validate_basic_annotation(stmt, type, diagnostics);

    if (binding === undefined) {
      binding = {
        type,
        value: stmt.value,
        struct_fields: struct_fields_of(stmt.value, env),
        declaration: stmt,
        used: false,
      };
      env.all_bindings.push(binding);
      bind_constness(env.const_env, stmt, type);
    } else {
      binding.type = type;
      binding.struct_fields = struct_fields_of(stmt.value, env);
    }

    env.bindings.set(stmt.name, binding);
    return;
  }

  if (stmt.tag === "assign") {
    const before = diagnostics.length;
    validate_expr(stmt.value, env, diagnostics);
    const previous = env.bindings.get(stmt.name);

    if (!previous) {
      return;
    }

    if (diagnostics.length !== before) {
      bind_assignment_constness(env.const_env, stmt.name);
      return;
    }

    const value_type = infer_type(stmt.value, env);

    if (stmt.mode === "same" && !same_type(previous.type, value_type)) {
      diagnostics.push(source_diagnostic(
        "IX2301",
        "error",
        "Assignment changes type for " + stmt.name,
        stmt,
      ));
      return;
    }

    env.bindings.set(stmt.name, {
      type: value_type,
      value: stmt.value,
      struct_fields: struct_fields_of(stmt.value, env),
      declaration: undefined,
      used: false,
    });
    bind_assignment_constness(env.const_env, stmt.name);
    return;
  }

  if (stmt.tag === "expr") {
    validate_expr(stmt.expr, env, diagnostics);
    return;
  }

  if (stmt.tag === "return") {
    validate_expr(stmt.value, env, diagnostics);
    return;
  }

  if (stmt.tag === "if_stmt") {
    validate_expr(stmt.cond, env, diagnostics);
    validate_statements(stmt.body, child_env(env), diagnostics);
    return;
  }

  if (stmt.tag === "for_range") {
    validate_expr(stmt.start, env, diagnostics);
    validate_expr(stmt.end, env, diagnostics);
    validate_expr(stmt.step, env, diagnostics);
    const body = child_env(env);
    bind_local(body, stmt.index, { tag: "int", type: "i32" }, false, false);
    validate_statements(stmt.body, body, diagnostics);
    return;
  }

  if (stmt.tag === "for_collection") {
    validate_expr(stmt.collection, env, diagnostics);
    const body = child_env(env);

    if (stmt.index !== undefined) {
      bind_local(
        body,
        stmt.index,
        { tag: "int", type: "i32" },
        false,
        false,
      );
    }

    bind_local(body, stmt.item, { tag: "unknown" }, false, false);
    validate_statements(stmt.body, body, diagnostics);
    return;
  }

  if (stmt.tag === "if_let_stmt") {
    validate_expr(stmt.target, env, diagnostics);
    const body = child_env(env);

    if (stmt.value_name !== undefined) {
      bind_local(
        body,
        stmt.value_name,
        { tag: "unknown" },
        false,
        false,
      );
    }

    validate_statements(stmt.body, body, diagnostics);
    return;
  }

  if (stmt.tag === "index_assign") {
    mark_binding_used(stmt.name, env);
    validate_expr(stmt.index, env, diagnostics);
    validate_expr(stmt.value, env, diagnostics);
    return;
  }

  if (stmt.tag === "state_bind") {
    validate_expr(stmt.value, env, diagnostics);

    if (stmt.value_name !== undefined) {
      bind_local(
        env,
        stmt.value_name,
        { tag: "unknown" },
        false,
        false,
      );
    }

    return;
  }

  if (stmt.tag === "bind_pattern") {
    validate_expr(stmt.value, env, diagnostics);

    for (const item of stmt.items) {
      bind_local(
        env,
        item.name,
        { tag: "unknown" },
        stmt.kind === "const",
        item.is_linear,
      );
    }

    return;
  }

  if (stmt.tag === "resume_dup") {
    validate_expr(stmt.value, env, diagnostics);
    bind_local(env, stmt.left, { tag: "unknown" }, false, true);
    bind_local(env, stmt.right, { tag: "unknown" }, false, true);
    return;
  }

  if (stmt.tag === "type_check") {
    validate_expr(stmt.target, env, diagnostics);

    for (const field of stmt.pattern.fields) {
      mark_annotation_text_use(field.type_name, env);

      if (field.set_member !== undefined) {
        mark_type_expr_uses(field.set_member, env);
      }
    }

    return;
  }

  if (stmt.tag === "break") {
    if (stmt.value !== undefined) {
      validate_expr(stmt.value, env, diagnostics);
    }

    return;
  }

  if (stmt.tag === "import") {
    bind_local(env, stmt.name, { tag: "unknown" }, true, false);
    return;
  }

  if (stmt.tag === "host_import") {
    bind_local(env, stmt.value.name, { tag: "unknown" }, true, false);
  }
}

function validate_expr(
  expr: FrontExpr,
  env: SemanticEnv,
  diagnostics: SourceDiagnostic[],
  check_comptime = true,
): void {
  if (expr.tag === "var" || expr.tag === "linear") {
    mark_binding_used(expr.name, env);
    return;
  }

  if (expr.tag === "prim") {
    const before = diagnostics.length;
    validate_expr(expr.left, env, diagnostics, check_comptime);
    validate_expr(expr.right, env, diagnostics, check_comptime);

    if (diagnostics.length !== before) {
      return;
    }

    try {
      specialize_prim_for_operands(
        expr.prim,
        numeric_type(expr.left, env),
        numeric_type(expr.right, env),
      );
    } catch (error) {
      if (error instanceof Error) {
        diagnostics.push(
          source_diagnostic("IX2302", "error", error.message, expr),
        );
        return;
      }

      throw error;
    }

    return;
  }

  if (expr.tag === "if") {
    const before = diagnostics.length;
    validate_expr(expr.cond, env, diagnostics, check_comptime);

    if (diagnostics.length === before) {
      const condition = infer_type(expr.cond, env);

      if (
        condition.tag !== "unknown" &&
        (condition.tag !== "int" || condition.type === "i64")
      ) {
        diagnostics.push(source_diagnostic(
          "IX2303",
          "error",
          "If condition expects i32, got " + type_name(condition),
          expr.cond,
        ));
      }
    }

    validate_expr(
      expr.then_branch,
      child_env(env),
      diagnostics,
      check_comptime,
    );
    validate_expr(
      expr.else_branch,
      child_env(env),
      diagnostics,
      check_comptime,
    );
    return;
  }

  if (expr.tag === "if_let") {
    validate_expr(expr.target, env, diagnostics, check_comptime);
    const then_env = child_env(env);

    if (expr.value_name !== undefined) {
      bind_local(
        then_env,
        expr.value_name,
        { tag: "unknown" },
        false,
        false,
      );
    }

    validate_expr(
      expr.then_branch,
      then_env,
      diagnostics,
      check_comptime,
    );
    validate_expr(
      expr.else_branch,
      child_env(env),
      diagnostics,
      check_comptime,
    );
    return;
  }

  if (expr.tag === "field") {
    const before = diagnostics.length;
    validate_expr(expr.object, env, diagnostics, check_comptime);

    if (diagnostics.length !== before) {
      return;
    }

    const object = struct_fields_of(expr.object, env);

    if (object) {
      try {
        require_struct_field(find_field(object, expr.name), expr.name);
      } catch (error) {
        if (error instanceof Error) {
          diagnostics.push(
            source_diagnostic("IX2304", "error", error.message, expr),
          );
          return;
        }

        throw error;
      }
    }

    return;
  }

  if (expr.tag === "app") {
    const before = diagnostics.length;
    validate_expr(expr.func, env, diagnostics, check_comptime);

    for (const arg of expr.args) {
      validate_expr(arg, env, diagnostics, check_comptime);
    }

    if (diagnostics.length === before) {
      validate_union_constructor(expr, env, diagnostics);
    }

    validate_comptime_fail(expr, diagnostics);
    return;
  }

  if (expr.tag === "block") {
    validate_statements(expr.statements, child_env(env), diagnostics);
    return;
  }

  if (expr.tag === "lam" || expr.tag === "rec") {
    const body = child_env(env);
    bind_params(body, expr.params);
    validate_expr(expr.body, body, diagnostics, check_comptime);
    return;
  }

  if (expr.tag === "comptime") {
    if (check_comptime) {
      try {
        validate_const_expr(
          expr.expr,
          env.const_env,
          new Set(),
          "Comptime expression captures runtime value",
        );
      } catch (error) {
        if (error instanceof Error) {
          diagnostics.push(
            source_diagnostic("IX2101", "error", error.message, expr),
          );
        } else {
          throw error;
        }
      }
    }

    validate_expr(expr.expr, env, diagnostics, false);
    return;
  }

  if (expr.tag === "borrow" || expr.tag === "freeze") {
    validate_expr(expr.value, env, diagnostics, check_comptime);
    return;
  }

  if (expr.tag === "scratch") {
    validate_expr(expr.body, env, diagnostics, check_comptime);
    return;
  }

  if (expr.tag === "loop") {
    validate_statements(expr.body, child_env(env), diagnostics);
    return;
  }

  if (expr.tag === "captured") {
    validate_expr(expr.expr, env, diagnostics, check_comptime);
    return;
  }

  if (expr.tag === "handler") {
    const handler_env = child_env(env);

    for (const state of expr.state) {
      mark_annotation_text_use(state.annotation, handler_env);
      validate_expr(
        state.value,
        handler_env,
        diagnostics,
        check_comptime,
      );
      bind_local(
        handler_env,
        state.name,
        { tag: "unknown" },
        false,
        false,
      );
    }

    for (const clause of expr.clauses) {
      const clause_env = child_env(handler_env);
      bind_params(clause_env, clause.params);
      validate_expr(
        clause.body,
        clause_env,
        diagnostics,
        check_comptime,
      );
    }

    const return_env = child_env(handler_env);
    bind_params(return_env, [expr.return_clause.param]);
    validate_expr(
      expr.return_clause.body,
      return_env,
      diagnostics,
      check_comptime,
    );
    return;
  }

  if (expr.tag === "try_with") {
    validate_expr(expr.body, env, diagnostics, check_comptime);
    validate_expr(expr.handler, env, diagnostics, check_comptime);
    return;
  }

  if (expr.tag === "with" || expr.tag === "struct_update") {
    validate_expr(expr.base, env, diagnostics, check_comptime);

    for (const field of expr.fields) {
      validate_expr(field.value, env, diagnostics, check_comptime);
    }

    return;
  }

  if (expr.tag === "struct_value") {
    validate_expr(expr.type_expr, env, diagnostics, check_comptime);

    for (const field of expr.fields) {
      validate_expr(field.value, env, diagnostics, check_comptime);
    }

    return;
  }

  if (expr.tag === "set_type") {
    mark_type_expr_uses(expr.type_expr, env);
    return;
  }

  if (expr.tag === "struct_type") {
    mark_type_field_uses(expr.fields, env);
    return;
  }

  if (expr.tag === "union_type") {
    mark_type_field_uses(expr.cases, env);
    return;
  }

  if (expr.tag === "index") {
    validate_expr(expr.object, env, diagnostics, check_comptime);
    validate_expr(expr.index, env, diagnostics, check_comptime);
    return;
  }

  if (expr.tag === "is") {
    validate_expr(expr.value, env, diagnostics, check_comptime);
    mark_type_expr_uses(expr.type_expr, env);
    return;
  }

  if (expr.tag === "union_case") {
    if (expr.type_expr !== undefined) {
      validate_expr(expr.type_expr, env, diagnostics, check_comptime);
    }

    if (expr.value !== undefined) {
      validate_expr(expr.value, env, diagnostics, check_comptime);
    }
  }
}

function validate_union_constructor(
  expr: Extract<FrontExpr, { tag: "app" }>,
  env: SemanticEnv,
  diagnostics: SourceDiagnostic[],
): void {
  if (expr.func.tag !== "field" || expr.func.object.tag !== "var") {
    return;
  }

  const declaration = env.declarations.get(expr.func.object.name);

  if (!declaration || declaration.body.tag !== "sum") {
    return;
  }

  const declared = lookup_type_field(declaration.body.cases, expr.func.name);

  if (!declared) {
    return;
  }

  const payload = expr.args[0];

  if (!payload) {
    return;
  }

  try {
    validate_union_payload_type(
      expr.func.name,
      declared.type_name,
      payload,
      create_env(),
      { infer_expr: (value) => infer_type(value, env) },
    );
  } catch (error) {
    if (error instanceof Error) {
      diagnostics.push(
        source_diagnostic("IX2305", "error", error.message, expr),
      );
      return;
    }

    throw error;
  }
}

function validate_comptime_fail(
  expr: Extract<FrontExpr, { tag: "app" }>,
  diagnostics: SourceDiagnostic[],
): void {
  if (expr.func.tag !== "var" || expr.func.name !== "fail") {
    return;
  }

  diagnostics.push(source_diagnostic(
    "IX2102",
    "error",
    "fail: " + call_message(expr.args),
    expr,
  ));
}

function infer_type(expr: FrontExpr, env: SemanticEnv): FrontType {
  if (expr.tag === "num") {
    return { tag: "int", type: expr.type };
  }

  if (expr.tag === "text") {
    return { tag: "text" };
  }

  if (expr.tag === "var" || expr.tag === "linear") {
    const binding = env.bindings.get(expr.name);

    if (binding) {
      return binding.type;
    }
  }

  if (expr.tag === "prim") {
    return { tag: "int", type: numeric_type(expr, env) };
  }

  if (expr.tag === "if") {
    const then_type = infer_type(expr.then_branch, env);
    const else_type = infer_type(expr.else_branch, env);

    if (same_type(then_type, else_type)) {
      return then_type;
    }
  }

  return { tag: "unknown" };
}

function numeric_type(
  expr: FrontExpr,
  env: SemanticEnv,
): "i32" | "i64" | undefined {
  if (expr.tag === "prim") {
    const specialized = specialize_prim_for_operands(
      expr.prim,
      numeric_type(expr.left, env),
      numeric_type(expr.right, env),
    );
    return prim_result_type(specialized);
  }

  const type = infer_type(expr, env);

  if (type.tag === "int") {
    return type.type;
  }

  return undefined;
}

function struct_fields_of(
  expr: FrontExpr,
  env: SemanticEnv,
): Field[] | undefined {
  if (expr.tag === "struct_value") {
    return expr.fields;
  }

  if (expr.tag === "var" || expr.tag === "linear") {
    const binding = env.bindings.get(expr.name);

    if (binding) {
      return binding.struct_fields;
    }
  }

  return undefined;
}

function find_field(fields: Field[], name: string): Field | undefined {
  for (const field of fields) {
    if (field.name === name) {
      return field;
    }
  }

  return undefined;
}

function child_env(env: SemanticEnv): SemanticEnv {
  return {
    all_bindings: env.all_bindings,
    bindings: new Map(env.bindings),
    const_env: clone_env(env.const_env),
    declarations: env.declarations,
  };
}

function bind_params(env: SemanticEnv, params: Param[]): void {
  for (const param of params) {
    mark_annotation_use(param.annotation, param.type_annotation, env);
    let type: FrontType = { tag: "unknown" };

    if (param.annotation !== undefined) {
      type = front_type_from_type_name(param.annotation);
    } else if (
      param.type_annotation !== undefined &&
      param.type_annotation.tag === "name"
    ) {
      type = front_type_from_type_name(param.type_annotation.name);
    }

    bind_local(
      env,
      param.name,
      type,
      param.is_const,
      param.is_linear,
    );
  }
}

function bind_local(
  env: SemanticEnv,
  name: string,
  type: FrontType,
  is_const: boolean,
  is_linear: boolean,
): void {
  env.bindings.set(name, {
    type,
    value: undefined,
    struct_fields: undefined,
    declaration: undefined,
    used: false,
  });
  push_binding(env.const_env, {
    name,
    ic_name: name,
    type,
    is_const,
    is_linear,
    value: undefined,
    value_env: undefined,
  });
}

function mark_binding_used(name: string, env: SemanticEnv): void {
  const binding = env.bindings.get(name);

  if (binding !== undefined) {
    binding.used = true;
  }
}

function mark_annotation_use(
  annotation: string | undefined,
  type_annotation: TypeExpr | undefined,
  env: SemanticEnv,
): void {
  mark_annotation_text_use(annotation, env);

  if (type_annotation !== undefined) {
    mark_type_expr_uses(type_annotation, env);
  }
}

function mark_annotation_text_use(
  annotation: string | undefined,
  env: SemanticEnv,
): void {
  if (annotation === undefined) {
    return;
  }

  const syntax = scan_source(annotation);

  for (const token of source_tokens(syntax)) {
    if (token.kind === "name") {
      mark_binding_used(token.text, env);
    }
  }
}

function mark_type_field_uses(
  fields: TypeField[],
  env: SemanticEnv,
): void {
  for (const field of fields) {
    mark_annotation_text_use(field.type_name, env);

    if (field.set_member !== undefined) {
      mark_type_expr_uses(field.set_member, env);
    }
  }
}

function mark_type_expr_uses(type: TypeExpr, env: SemanticEnv): void {
  if (type.tag === "name") {
    mark_binding_used(type.name, env);
    return;
  }

  if (type.tag === "frozen" || type.tag === "borrow") {
    mark_type_expr_uses(type.value, env);
    return;
  }

  if (
    type.tag === "union" || type.tag === "intersection" ||
    type.tag === "difference"
  ) {
    mark_type_expr_uses(type.left, env);
    mark_type_expr_uses(type.right, env);
    return;
  }

  if (type.tag === "apply") {
    mark_type_expr_uses(type.func, env);
    mark_type_expr_uses(type.arg, env);
    return;
  }

  if (type.tag === "tuple") {
    for (const item of type.items) {
      mark_type_expr_uses(item, env);
    }

    return;
  }

  if (type.tag === "arrow") {
    mark_type_expr_uses(type.param, env);
    mark_type_expr_uses(type.result, env);
  }
}

function append_unused_binding_warnings(
  bindings: SemanticBinding[],
  diagnostics: SourceDiagnostic[],
): void {
  for (const binding of bindings) {
    const declaration = binding.declaration;

    if (
      declaration === undefined || binding.used || declaration.is_linear ||
      is_no_demand_name(declaration.name)
    ) {
      continue;
    }

    let label = "runtime";

    if (declaration.kind === "const") {
      label = "const";
    }

    diagnostics.push(source_diagnostic(
      "IX2003",
      "warning",
      "Unused " + label + " binding " + declaration.name,
      declaration,
    ));
  }
}

function bind_constness(
  env: Env,
  stmt: Extract<Stmt, { tag: "bind" }>,
  type: FrontType,
): void {
  const binding: Binding = {
    name: stmt.name,
    ic_name: stmt.name,
    type,
    is_const: stmt.kind === "const",
    is_linear: stmt.is_linear,
    value: stmt.value,
    value_env: undefined,
  };
  push_binding(env, binding);
}

function bind_assignment_constness(env: Env, name: string): void {
  push_binding(env, {
    name,
    ic_name: name,
    type: { tag: "unknown" },
    is_const: false,
    is_linear: false,
    value: undefined,
    value_env: undefined,
  });
}

function validate_basic_annotation(
  stmt: Extract<Stmt, { tag: "bind" }>,
  type: FrontType,
  diagnostics: SourceDiagnostic[],
): void {
  const annotation = stmt.annotation;

  if (annotation === undefined || type.tag === "unknown") {
    return;
  }

  let matches = true;

  if (annotation === "Text") {
    matches = type.tag === "text" && type.encoding !== "bytes";
  } else if (annotation === "Bytes") {
    matches = type.tag === "text";
  } else if (
    annotation === "Int" || annotation === "I32" || annotation === "U32"
  ) {
    matches = type.tag === "int" && type.type === "i32";
  } else if (annotation === "I64") {
    matches = type.tag === "int" && type.type === "i64";
  } else {
    return;
  }

  if (matches) {
    return;
  }

  diagnostics.push(source_diagnostic(
    "IX2306",
    "error",
    "Binding annotation expects " + annotation + ", got " + type_name(type),
    stmt.value,
  ));
}

function type_name(type: FrontType): string {
  if (type.tag === "text") {
    return "Text";
  }

  if (type.tag === "int" && type.type === "i64") {
    return "I64";
  }

  if (type.tag === "int") {
    return "I32";
  }

  return type.tag;
}
