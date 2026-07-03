import type { CoreExpr, CoreField } from "./ast.ts";
import type { TempNameCtx } from "./backend/util.ts";
import { scoped_static_core_call_block } from "./static_call_rewrite/stmt.ts";
import {
  shadow_core_call_name,
  shadow_core_call_params,
} from "./static_call_rewrite/names.ts";

export function scoped_static_core_call_expr(
  expr: CoreExpr,
  replacements: Map<string, CoreExpr>,
  ctx: TempNameCtx,
): CoreExpr {
  switch (expr.tag) {
    case "num":
    case "text":
    case "type_name":
    case "linear":
    case "struct_type":
    case "union_type":
    case "unsupported":
      return expr;

    case "var": {
      const replacement = replacements.get(expr.name);

      if (replacement) {
        return replacement;
      }

      return expr;
    }

    case "prim":
      return {
        tag: "prim",
        prim: expr.prim,
        args: expr.args.map((arg) =>
          scoped_static_core_call_expr(arg, replacements, ctx)
        ),
      };

    case "lam": {
      const local = shadow_core_call_params(replacements, expr.params);
      return {
        tag: "lam",
        params: expr.params,
        body: scoped_static_core_call_expr(expr.body, local, ctx),
      };
    }

    case "rec": {
      const local = shadow_core_call_params(replacements, expr.params);
      return {
        tag: "rec",
        params: expr.params,
        body: scoped_static_core_call_expr(expr.body, local, ctx),
      };
    }

    case "app":
      return {
        tag: "app",
        func: scoped_static_core_call_expr(expr.func, replacements, ctx),
        args: expr.args.map((arg) =>
          scoped_static_core_call_expr(arg, replacements, ctx)
        ),
      };

    case "block":
      return {
        tag: "block",
        statements: scoped_static_core_call_block(
          expr.statements,
          new Map(replacements),
          ctx,
          scoped_static_core_call_expr,
        ),
      };

    case "comptime":
      return {
        tag: "comptime",
        expr: scoped_static_core_call_expr(expr.expr, replacements, ctx),
      };

    case "borrow":
      return {
        tag: "borrow",
        value: scoped_static_core_call_expr(expr.value, replacements, ctx),
      };

    case "freeze":
      return {
        tag: "freeze",
        value: scoped_static_core_call_expr(expr.value, replacements, ctx),
      };

    case "scratch":
      return {
        tag: "scratch",
        body: scoped_static_core_call_expr(expr.body, replacements, ctx),
      };

    case "with":
      return {
        tag: "with",
        base: scoped_static_core_call_expr(expr.base, replacements, ctx),
        fields: scoped_static_core_call_fields(expr.fields, replacements, ctx),
      };

    case "struct_value":
      return {
        tag: "struct_value",
        type_expr: scoped_static_core_call_expr(
          expr.type_expr,
          replacements,
          ctx,
        ),
        fields: scoped_static_core_call_fields(expr.fields, replacements, ctx),
      };

    case "struct_update":
      return {
        tag: "struct_update",
        base: scoped_static_core_call_expr(expr.base, replacements, ctx),
        fields: scoped_static_core_call_fields(expr.fields, replacements, ctx),
      };

    case "if":
      return {
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
      };

    case "if_let": {
      let then_replacements = replacements;

      if (expr.value_name) {
        then_replacements = shadow_core_call_name(
          replacements,
          expr.value_name,
        );
      }

      return {
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
      };
    }

    case "field":
      return {
        tag: "field",
        object: scoped_static_core_call_expr(expr.object, replacements, ctx),
        name: expr.name,
      };

    case "index":
      return {
        tag: "index",
        object: scoped_static_core_call_expr(expr.object, replacements, ctx),
        index: scoped_static_core_call_expr(expr.index, replacements, ctx),
      };

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

      return {
        tag: "union_case",
        name: expr.name,
        value,
        type_expr,
      };
    }
  }
}

function scoped_static_core_call_fields(
  fields: CoreField[],
  replacements: Map<string, CoreExpr>,
  ctx: TempNameCtx,
): CoreField[] {
  return fields.map((field) => ({
    name: field.name,
    value: scoped_static_core_call_expr(field.value, replacements, ctx),
  }));
}
