import { expect } from "../expect.ts";
import type { FrontExpr, TypeExpr } from "./ast.ts";
import { has_source_span, inherit_source_span } from "./syntax.ts";
import { format_type_expr } from "./type_expr.ts";

export function apply_function_result_context(
  value: FrontExpr,
  annotation: TypeExpr | undefined,
): FrontExpr {
  if (annotation === undefined) return value;

  let callable = annotation;
  while (callable.tag === "forall") callable = callable.body;

  if (
    callable.tag !== "arrow" ||
    (value.tag !== "lam" && value.tag !== "rec")
  ) {
    return value;
  }

  let parameter_types = [callable.param];
  if (callable.param.tag === "tuple") {
    parameter_types = callable.param.items;
  } else if (
    callable.param.tag === "product" &&
    callable.param.value_pack === true &&
    callable.param.entries.length === value.params.length
  ) {
    parameter_types = callable.param.entries.map((entry) => entry.type_expr);
  }

  let params = value.params;
  if (parameter_types.length === value.params.length) {
    params = value.params.map((param, index) => {
      if (
        param.annotation !== undefined || param.type_annotation !== undefined
      ) {
        return param;
      }
      const parameter_type = parameter_types[index];
      expect(parameter_type, "Missing function parameter type " + index);
      return preserve_source_span({
        ...param,
        annotation: format_type_expr(parameter_type),
        type_annotation: parameter_type,
      }, param);
    });
  }

  return preserve_source_span({
    ...value,
    params,
    body: apply_result_context(value.body, callable.result),
  }, value);
}

function apply_result_context(
  expr: FrontExpr,
  result_type: TypeExpr,
): FrontExpr {
  if (expr.tag === "union_case") {
    if (expr.type_expr !== undefined) return expr;
    const type_expr = preserve_source_span<FrontExpr>(
      type_value_expr(result_type),
      expr,
    );
    return preserve_source_span({ ...expr, type_expr }, expr);
  }

  if (expr.tag === "if") {
    return preserve_source_span({
      ...expr,
      then_branch: apply_result_context(expr.then_branch, result_type),
      else_branch: apply_result_context(expr.else_branch, result_type),
    }, expr);
  }

  if (expr.tag === "if_let") {
    return preserve_source_span({
      ...expr,
      then_branch: apply_result_context(expr.then_branch, result_type),
      else_branch: apply_result_context(expr.else_branch, result_type),
    }, expr);
  }

  if (expr.tag === "match") {
    return preserve_source_span({
      ...expr,
      arms: expr.arms.map((arm) =>
        preserve_source_span({
          ...arm,
          body: apply_result_context(arm.body, result_type),
        }, arm)
      ),
    }, expr);
  }

  if (expr.tag === "captured") {
    return preserve_source_span({
      ...expr,
      expr: apply_result_context(expr.expr, result_type),
    }, expr);
  }

  if (expr.tag !== "block") return expr;

  const statements = expr.statements.map((stmt, index) => {
    if (stmt.tag === "return") {
      return preserve_source_span({
        ...stmt,
        value: apply_result_context(stmt.value, result_type),
      }, stmt);
    }

    if (index !== expr.statements.length - 1 || stmt.tag !== "expr") {
      return stmt;
    }

    return preserve_source_span({
      ...stmt,
      expr: apply_result_context(stmt.expr, result_type),
    }, stmt);
  });
  return preserve_source_span({ ...expr, statements }, expr);
}

function type_value_expr(type: TypeExpr): FrontExpr {
  if (type.tag === "name") return { tag: "var", name: type.name };

  if (type.tag === "apply") {
    const func = type_value_expr(type.func);
    const arg = type_value_expr(type.arg);
    return { tag: "app", func, arg, args: [arg] };
  }

  return { tag: "var", name: format_type_expr(type) };
}

function preserve_source_span<value extends object>(
  result: value,
  source: object,
): value {
  if (!has_source_span(source)) return result;
  return inherit_source_span(result, source);
}
