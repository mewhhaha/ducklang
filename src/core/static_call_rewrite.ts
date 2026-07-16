import type { CoreExpr, CoreField } from "./ast.ts";
import { record_core_expr_provenance } from "./subject_provenance.ts";
import {
  scoped_static_core_call_block,
  type ScopedStaticCoreCallCtx,
} from "./static_call_rewrite/stmt.ts";
import {
  shadow_core_call_name,
  shadow_core_call_params,
} from "./static_call_rewrite/names.ts";

export function scoped_static_core_call_expr(
  expr: CoreExpr,
  replacements: Map<string, CoreExpr>,
  ctx: ScopedStaticCoreCallCtx,
): CoreExpr {
  switch (expr.tag) {
    case "num":
    case "text":
    case "type_name":
    case "struct_type":
    case "union_type":
    case "unsupported":
      return expr;

    case "linear": {
      const replacement = replacements.get(expr.name);

      if (!replacement) {
        return expr;
      }

      if (replacement.tag === "var") {
        return record_core_expr_provenance({
          tag: "linear",
          name: replacement.name,
        }, expr);
      }

      return replacement;
    }

    case "var": {
      const replacement = replacements.get(expr.name);

      if (replacement) {
        return replacement;
      }

      return expr;
    }

    case "prim":
      return record_core_expr_provenance({
        tag: "prim",
        prim: expr.prim,
        args: expr.args.map((arg) =>
          scoped_static_core_call_expr(arg, replacements, ctx)
        ),
      }, expr);

    case "lam": {
      const local = shadow_core_call_params(replacements, expr.params);
      return record_core_expr_provenance({
        tag: "lam",
        params: expr.params,
        body: scoped_static_core_call_expr(expr.body, local, ctx),
        is_linear_closure: expr.is_linear_closure,
      }, expr);
    }

    case "rec": {
      const local = shadow_core_call_params(replacements, expr.params);
      return record_core_expr_provenance({
        tag: "rec",
        params: expr.params,
        body: scoped_static_core_call_expr(expr.body, local, ctx),
      }, expr);
    }

    case "rec_ref":
      return expr;

    case "app":
      return record_core_expr_provenance({
        tag: "app",
        func: scoped_static_core_call_expr(expr.func, replacements, ctx),
        args: expr.args.map((arg) =>
          scoped_static_core_call_expr(arg, replacements, ctx)
        ),
        resume_payload: expr.resume_payload,
      }, expr);

    case "block":
      return record_core_expr_provenance({
        tag: "block",
        statements: scoped_static_core_call_block(
          expr.statements,
          new Map(replacements),
          ctx,
          scoped_static_core_call_expr,
        ),
      }, expr);

    case "loop":
      return record_core_expr_provenance({
        tag: "loop",
        body: scoped_static_core_call_block(
          expr.body,
          new Map(replacements),
          ctx,
          scoped_static_core_call_expr,
        ),
      }, expr);

    case "comptime":
      return record_core_expr_provenance({
        tag: "comptime",
        expr: scoped_static_core_call_expr(expr.expr, replacements, ctx),
      }, expr);

    case "borrow":
      return record_core_expr_provenance({
        tag: "borrow",
        value: scoped_static_core_call_expr(expr.value, replacements, ctx),
      }, expr);

    case "freeze":
      return record_core_expr_provenance({
        tag: "freeze",
        value: scoped_static_core_call_expr(expr.value, replacements, ctx),
      }, expr);

    case "scratch":
      return record_core_expr_provenance({
        tag: "scratch",
        body: scoped_static_core_call_expr(expr.body, replacements, ctx),
      }, expr);

    case "with":
      return record_core_expr_provenance({
        tag: "with",
        base: scoped_static_core_call_expr(expr.base, replacements, ctx),
        fields: scoped_static_core_call_fields(expr.fields, replacements, ctx),
      }, expr);

    case "struct_value":
      return record_core_expr_provenance({
        tag: "struct_value",
        type_expr: scoped_static_core_call_expr(
          expr.type_expr,
          replacements,
          ctx,
        ),
        fields: scoped_static_core_call_fields(expr.fields, replacements, ctx),
      }, expr);

    case "struct_update":
      return record_core_expr_provenance({
        tag: "struct_update",
        base: scoped_static_core_call_expr(expr.base, replacements, ctx),
        fields: scoped_static_core_call_fields(expr.fields, replacements, ctx),
      }, expr);

    case "if":
      return record_core_expr_provenance({
        tag: "if",
        cond: scoped_static_core_call_expr(expr.cond, replacements, ctx),
        then_branch: scoped_static_core_call_expr(
          expr.then_branch,
          replacements,
          ctx,
        ),
        else_branch: scoped_static_core_call_expr(
          expr.else_branch,
          replacements,
          ctx,
        ),
        implicit_else: expr.implicit_else,
      }, expr);

    case "if_let": {
      let then_replacements = replacements;

      if (expr.value_name) {
        then_replacements = shadow_core_call_name(
          replacements,
          expr.value_name,
        );
      }

      return record_core_expr_provenance({
        tag: "if_let",
        case_name: expr.case_name,
        value_name: expr.value_name,
        target: scoped_static_core_call_expr(expr.target, replacements, ctx),
        then_branch: scoped_static_core_call_expr(
          expr.then_branch,
          then_replacements,
          ctx,
        ),
        else_branch: scoped_static_core_call_expr(
          expr.else_branch,
          replacements,
          ctx,
        ),
      }, expr);
    }

    case "field":
      return record_core_expr_provenance({
        tag: "field",
        object: scoped_static_core_call_expr(expr.object, replacements, ctx),
        name: expr.name,
      }, expr);

    case "index":
      return record_core_expr_provenance({
        tag: "index",
        object: scoped_static_core_call_expr(expr.object, replacements, ctx),
        index: scoped_static_core_call_expr(expr.index, replacements, ctx),
      }, expr);

    case "union_case": {
      let value: CoreExpr | undefined;
      let type_expr: CoreExpr | undefined;

      if (expr.value) {
        value = scoped_static_core_call_expr(expr.value, replacements, ctx);
      }

      if (expr.type_expr) {
        type_expr = scoped_static_core_call_expr(
          expr.type_expr,
          replacements,
          ctx,
        );
      }

      return record_core_expr_provenance({
        tag: "union_case",
        name: expr.name,
        value,
        type_expr,
        resume_payload: expr.resume_payload,
      }, expr);
    }
  }
}

function scoped_static_core_call_fields(
  fields: CoreField[],
  replacements: Map<string, CoreExpr>,
  ctx: ScopedStaticCoreCallCtx,
): CoreField[] {
  return fields.map((field) => ({
    name: field.name,
    value: scoped_static_core_call_expr(field.value, replacements, ctx),
  }));
}
