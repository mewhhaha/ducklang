import type { FrontExpr, Param, Stmt } from "../ast.ts";
import { expect } from "../../expect.ts";
import { Prim } from "../../op.ts";
import { Format } from "../../trait.ts";
import { format_binding_name } from "../names.ts";
import { format_type_expr } from "../type_expr.ts";
import { create_fixity_table } from "../fixity.ts";
import { format_character_literal } from "../literal.ts";
import { import_meta_binding_name } from "../import_meta.ts";
import {
  format_field,
  format_params,
  format_pattern,
  format_type_field,
} from "./common.ts";
import { format_statement_sequence } from "./stmt.ts";
import { integer_literal_suffix } from "../../integer.ts";

const type_extend_fixity = (() => {
  const fixity = [...create_fixity_table().infix.values()].find(
    (candidate) => candidate.target === "@type.extend",
  );
  expect(fixity, "Prelude has no infix declaration for @type.extend");
  return fixity;
})();

const runtime_merge_fixity = (() => {
  const fixity = create_fixity_table().infix.get("<&");
  expect(fixity, "Prelude has no infix declaration for runtime merge");
  return fixity;
})();

export function format_expr_with_stmt(
  expr: FrontExpr,
  format_stmt: (stmt: Stmt) => string,
): string {
  return format_expr(expr, format_stmt, 0);
}

function format_expr(
  expr: FrontExpr,
  format_stmt: (stmt: Stmt) => string,
  parent_precedence: number,
): string {
  const nested = (value: FrontExpr, precedence = 0) =>
    format_expr(value, format_stmt, precedence);

  if (expr.tag === "bool") {
    return expr.value.toString();
  }

  if (expr.tag === "num") {
    if (expr.character !== undefined) {
      return format_character_literal(expr.character);
    }

    if (expr.integer) {
      return expr.value.toString() + integer_literal_suffix(expr.integer);
    }

    if (expr.type === "i64") {
      return expr.value.toString() + "i64";
    }

    if (expr.type === "f32") {
      return expr.value.toString() + "f32";
    }

    if (expr.type === "f64") {
      return expr.value.toString() + "f64";
    }

    return expr.value.toString();
  }

  if (expr.tag === "unit") {
    return "()";
  }

  if (expr.tag === "text") {
    if (expr.encoding === "bytes") {
      return "Bytes.empty";
    }

    return Deno.inspect(expr.value);
  }

  if (expr.tag === "type_name") {
    return expr.name;
  }

  if (expr.tag === "set_type") {
    return "set " + format_type_expr(expr.type_expr);
  }

  if (expr.tag === "var") {
    if (expr.name === import_meta_binding_name) {
      return "import.meta";
    }

    return expr.name;
  }

  if (expr.tag === "atom") {
    return "#" + expr.name;
  }

  if (expr.tag === "prim") {
    const symbol = Format.fmt(Prim, expr.prim);
    const precedence = primitive_precedence(symbol);
    const text = nested(expr.left, precedence) + " " + symbol + " " +
      nested(expr.right, precedence + 1);
    return parenthesize(text, precedence, parent_precedence);
  }

  // A lambda the parser lifted out of argument holes prints as the hole form
  // it was written in, so formatting does not rewrite `f [a, _]` into the
  // generated parameter.
  if (
    expr.tag === "lam" && expr.hole_params !== undefined &&
    expr.hole_params.length > 0
  ) {
    const holes = new Set(expr.hole_params);
    return nested(restore_holes(expr.body, holes), parent_precedence);
  }

  if (expr.tag === "lam" && expr.case_function === true) {
    expect(expr.body.tag === "match", "Case function body must be a match");
    const arms = expr.body.arms.map((arm) => {
      let text = format_pattern(arm.pattern, nested);

      if (arm.guard) {
        text += " if " + nested(arm.guard);
      }

      return text + " => " + nested(arm.body);
    });
    return parenthesize(
      "case => of " + arms.join(", ") + ";",
      0,
      parent_precedence,
    );
  }

  if (expr.tag === "lam" || expr.tag === "rec") {
    let text = "";

    if (expr.tag === "rec") {
      text += "rec ";
    }

    text += format_callable_pattern(expr.pattern, expr.params, nested) +
      " => " +
      nested(expr.body);
    return parenthesize(text, 0, parent_precedence);
  }

  if (expr.tag === "app") {
    if (
      expr.func.tag === "var" && expr.func.name === "@include" &&
      expr.args.length === 1 && expr.args[0]?.tag === "text"
    ) {
      return "include " + Deno.inspect(expr.args[0].value);
    }

    if (expr.operator_syntax !== undefined) {
      const syntax = expr.operator_syntax;

      if (syntax.kind === "prefix") {
        const value = expr.args[0];

        if (value === undefined) {
          throw new Error("Missing prefix operator operand");
        }

        const text = syntax.operator + nested(value, syntax.precedence);
        return parenthesize(text, syntax.precedence, parent_precedence);
      }

      const left = expr.args[0];
      const right = expr.args[1];

      if (left === undefined || right === undefined) {
        throw new Error("Missing infix operator operand");
      }

      let left_precedence = syntax.precedence;
      let right_precedence = syntax.precedence + 1;

      if (syntax.associativity === "right") {
        left_precedence += 1;
        right_precedence = syntax.precedence;
      }

      const text = nested(left, left_precedence) + " " + syntax.operator +
        " " + nested(right, right_precedence);
      return parenthesize(text, syntax.precedence, parent_precedence);
    }

    const precedence = 110;
    const arg = application_arg(expr);
    const text = nested(expr.func, precedence) + " " +
      nested(arg, precedence + 1);
    return parenthesize(text, precedence, parent_precedence);
  }

  if (expr.tag === "product") {
    if (expr.template_literal === true) {
      const strings = expr.entries[0]?.value;
      const values = expr.entries[1]?.value;

      if (strings?.tag !== "product" || values?.tag !== "product") {
        throw new Error(
          "Template literal requires strings and values tuples",
        );
      }
      if (strings.entries.length !== values.entries.length + 1) {
        throw new Error(
          "Template literal requires one more string than value",
        );
      }

      let text = "`";

      for (let index = 0; index < strings.entries.length; index += 1) {
        const string = strings.entries[index]?.value;

        if (string?.tag !== "text") {
          throw new Error(
            "Template literal string " + index.toString() + " is not Text",
          );
        }

        for (const char of string.value) {
          if (char === "\\") {
            text += "\\\\";
          } else if (char === "`") {
            text += "\\`";
          } else if (char === "\n") {
            text += "\\n";
          } else if (char === "\t") {
            text += "\\t";
          } else if (char === "\r") {
            text += "\\r";
          } else if (char === "{") {
            text += "{{";
          } else if (char === "}") {
            text += "}}";
          } else {
            text += char;
          }
        }

        const value = values.entries[index]?.value;
        if (value !== undefined) {
          text += "{" + nested(value) + "}";
        }
      }

      return text + "`";
    }

    const entries = expr.entries.map((entry) => {
      let text = nested(entry.value);

      if (entry.label !== undefined) {
        text = "." + entry.label + " = " + text;
      }

      return text;
    });
    if (expr.value_pack === true) {
      return "(" + entries.join(", ") + ")";
    }

    return "[" + entries.join(", ") + "]";
  }

  if (expr.tag === "shape") {
    const entries = expr.entries.map((entry) => {
      if (entry.label === undefined) {
        throw new Error("Shape entry is missing its label");
      }

      if (entry.value.tag === "var" && entry.value.name === entry.label) {
        return "." + entry.label;
      }

      return "." + entry.label + " = " + nested(entry.value);
    });
    return "{ " + entries.join(", ") + " }";
  }

  if (expr.tag === "array") {
    const items = expr.items.map((item) => nested(item));

    if (expr.rest) {
      const rest = "..." + nested(expr.rest);

      if (expr.leading_rest === true) {
        items.unshift(rest);
      } else {
        items.push(rest);
      }
    }

    return "[" + items.join(", ") + "]";
  }

  if (expr.tag === "array_repeat") {
    return "[" + nested(expr.value) + "; " + nested(expr.length) + "]";
  }

  if (expr.tag === "import") {
    return "import " + Deno.inspect(expr.path);
  }

  if (expr.tag === "block") {
    return "do " + format_statement_sequence(expr.statements, format_stmt) +
      " end";
  }

  if (expr.tag === "comptime") {
    if (expr.implicit) {
      return nested(expr.expr, 0);
    }

    return "comptime " + nested(expr.expr, 31);
  }

  if (expr.tag === "borrow") {
    return "&" + nested(expr.value, 31);
  }

  if (expr.tag === "freeze") {
    return "freeze " + nested(expr.value, 31);
  }

  if (expr.tag === "scratch") {
    return "scratch " + nested(expr.body);
  }

  if (expr.tag === "loop") {
    return "loop do " + format_statement_sequence(expr.body, format_stmt) +
      " end";
  }

  if (expr.tag === "captured") {
    return nested(expr.expr, parent_precedence);
  }

  if (expr.tag === "handler") {
    const state = expr.state.map((item) => {
      let text = "let " + format_binding_name(item.name);

      if (item.annotation) {
        text += ": " + item.annotation;
      }

      return text + " = " + nested(item.value);
    });
    const clauses = expr.clauses.map((clause) => {
      return clause.name + ": (" + format_params(clause.params) + ") => " +
        nested(clause.body);
    });
    clauses.push(
      "return: " + format_params([expr.return_clause.param]) + " => " +
        nested(expr.return_clause.body),
    );
    const literal = "handler " + expr.effect + " { " +
      clauses.join(", ") + " }";

    if (state.length === 0) {
      return literal;
    }

    state.push(literal);
    return "{ " + state.join("; ") + " }";
  }

  if (expr.tag === "try_with") {
    if (expr.infer_default_handlers === true) {
      return parenthesize(
        "try " + nested(expr.body, 1),
        0,
        parent_precedence,
      );
    }

    const text = "try " + nested(expr.body, 1) + " with " +
      nested(expr.handler, 1);
    return parenthesize(text, 0, parent_precedence);
  }

  if (expr.tag === "struct_update") {
    const text = nested(expr.base, runtime_merge_fixity.precedence) + " " +
      runtime_merge_fixity.operator + " { " +
      expr.fields.map((field) => {
        if (field.value.tag === "var" && field.value.name === field.name) {
          return field.name;
        }

        return "." + field.name + " = " + nested(field.value);
      }).join(", ") +
      " }";
    return parenthesize(
      text,
      runtime_merge_fixity.precedence,
      parent_precedence,
    );
  }

  if (expr.tag === "with") {
    const text = nested(expr.base, type_extend_fixity.precedence) + " " +
      type_extend_fixity.operator + " { " +
      expr.fields.map((field) => {
        if (field.value.tag === "var" && field.value.name === field.name) {
          return field.name;
        }

        return "." + field.name + " = " + nested(field.value);
      }).join(", ") +
      " }";
    return parenthesize(text, type_extend_fixity.precedence, parent_precedence);
  }

  if (expr.tag === "type_with") {
    const text = nested(expr.base, type_extend_fixity.precedence) + " " +
      type_extend_fixity.operator + " { " +
      expr.members.map((member) =>
        ".[" + nested(member.name) + "] = " + nested(member.value)
      ).join(", ") +
      " }";
    return parenthesize(text, type_extend_fixity.precedence, parent_precedence);
  }

  if (expr.tag === "struct_type") {
    return "struct { " + expr.fields.map(format_type_field).join(", ") +
      " }";
  }

  if (expr.tag === "struct_value") {
    if (expr.bracketed === "named" || expr.bracketed === "positional") {
      const entries = expr.fields.map((field) => {
        let text = nested(field.value);

        if (expr.bracketed === "named") {
          text = "." + field.name + " = " + text;
        }

        return text;
      });
      return "[" + entries.join(", ") + "]";
    }

    if (expr.type_expr.tag === "var" && expr.type_expr.name === "object_type") {
      const fields = expr.fields.map((field) => {
        if (field.value.tag === "var" && field.value.name === field.name) {
          return "." + field.name;
        }

        return "." + field.name + " = " + nested(field.value);
      });
      return "{ " + fields.join(", ") + " }";
    }

    return nested(expr.type_expr, 110) + " { " +
      expr.fields.map((field) => format_field(field, nested)).join(", ") +
      " }";
  }

  if (expr.tag === "union_type") {
    return "union { " + expr.cases.map(format_type_field).join(", ") + " }";
  }

  if (expr.tag === "if") {
    let text = "if " + nested(expr.cond) + " then " +
      format_conditional_branch(expr.then_branch, format_stmt, nested);

    if (expr.implicit_else !== true) {
      text += format_conditional_else(expr.else_branch, format_stmt, nested);
    }

    text += " end";
    return parenthesize(text, 0, parent_precedence);
  }

  if (expr.tag === "if_let") {
    let pattern = "#" + expr.case_name;

    if (expr.value_name) {
      pattern += " " + format_binding_name(expr.value_name);
    } else {
      pattern += " _";
    }

    let text = "if let " + pattern + " = " + nested(expr.target) + " then " +
      format_conditional_branch(expr.then_branch, format_stmt, nested);

    if (expr.implicit_else !== true) {
      text += format_conditional_else(expr.else_branch, format_stmt, nested);
    }

    text += " end";
    return parenthesize(text, 0, parent_precedence);
  }

  if (expr.tag === "field") {
    const text = nested(expr.object, 120) + "." + expr.name;
    return parenthesize(text, 120, parent_precedence);
  }

  if (expr.tag === "index") {
    const text = nested(expr.object, 120) + "[" + nested(expr.index) + "]";
    return parenthesize(text, 120, parent_precedence);
  }

  if (expr.tag === "is" || expr.tag === "as") {
    let precedence = 40;

    if (expr.tag === "as") {
      precedence = 80;
    }

    const text = nested(expr.value, precedence) + " " + expr.tag + " " +
      format_type_expr(expr.type_expr);
    return parenthesize(text, precedence, parent_precedence);
  }

  if (expr.tag === "match") {
    const arms = expr.arms.map((arm) => {
      let text = format_pattern(arm.pattern, nested);

      if (arm.guard) {
        text += " if " + nested(arm.guard);
      }

      let body = nested(arm.body);

      if (arm.body.tag === "match") {
        body = "do " + body + " end";
      }

      return text + " => " + body;
    });
    let target = nested(expr.target);

    if (expr.target.tag === "match") {
      target = "do " + target + " end";
    }

    const text = "case " + target + " of " + arms.join(", ") + ";";

    if (parent_precedence > 0) {
      return "do " + text + " end";
    }

    return text;
  }

  if (expr.tag === "union_case") {
    if (expr.value && expr.value.tag !== "unit") {
      const precedence = 110;
      const text = "#" + expr.name + " " + nested(expr.value, precedence + 1);
      return parenthesize(text, precedence, parent_precedence);
    }

    return "#" + expr.name;
  }

  if (expr.tag === "linear") {
    return "!" + expr.name;
  }

  return "<unsupported " + expr.feature + ">";
}

function format_conditional_branch(
  branch: FrontExpr,
  format_stmt: (stmt: Stmt) => string,
  format_expr: (expr: FrontExpr, precedence?: number) => string,
): string {
  if (branch.tag === "block") {
    return format_statement_sequence(branch.statements, format_stmt);
  }

  return format_expr(branch);
}

function format_conditional_else(
  branch: FrontExpr,
  format_stmt: (stmt: Stmt) => string,
  format_expr: (expr: FrontExpr, precedence?: number) => string,
): string {
  if (branch.tag === "if") {
    let text = " else " + format_expr(branch.cond) + " then " +
      format_conditional_branch(branch.then_branch, format_stmt, format_expr);

    if (branch.implicit_else !== true) {
      text += format_conditional_else(
        branch.else_branch,
        format_stmt,
        format_expr,
      );
    }

    return text;
  }

  return " else " + format_conditional_branch(branch, format_stmt, format_expr);
}

function application_arg(expr: Extract<FrontExpr, { tag: "app" }>): FrontExpr {
  if (expr.arg) {
    return expr.arg;
  }

  if (expr.args.length === 1) {
    const arg = expr.args[0];

    if (arg) {
      return arg;
    }
  }

  return {
    tag: "product",
    entries: expr.args.map((value) => ({ value })),
  };
}

function format_callable_pattern(
  pattern: Extract<FrontExpr, { tag: "lam" | "rec" }>["pattern"],
  params: Param[],
  format_expr: (expr: FrontExpr) => string,
): string {
  if (pattern) {
    return format_pattern(pattern, format_expr);
  }

  if (params.length === 0) {
    return "()";
  }

  if (params.length === 1) {
    return format_params(params);
  }

  return "(" + format_params(params) + ")";
}

function primitive_precedence(symbol: string): number {
  if (symbol === "||") {
    return 20;
  }

  if (symbol === "&&") {
    return 30;
  }

  if (
    symbol === "==" || symbol === "!=" || symbol === "<" || symbol === ">" ||
    symbol === "<=" || symbol === ">="
  ) {
    return 40;
  }

  if (symbol === "+" || symbol === "-") {
    return 60;
  }

  return 70;
}

function parenthesize(
  text: string,
  precedence: number,
  parent_precedence: number,
): string {
  if (precedence < parent_precedence) {
    return "(" + text + ")";
  }

  return text;
}

/** Put `_` back where a lifted hole's generated parameter is referenced. */
function restore_holes(expr: FrontExpr, holes: ReadonlySet<string>): FrontExpr {
  if (expr.tag === "var") {
    if (holes.has(expr.name)) {
      return { tag: "var", name: "_" };
    }

    return expr;
  }

  if (expr.tag === "product") {
    return {
      ...expr,
      entries: expr.entries.map((entry) => ({
        ...entry,
        value: restore_holes(entry.value, holes),
      })),
    };
  }

  if (expr.tag === "app") {
    let arg: FrontExpr | undefined;
    if (expr.arg !== undefined) {
      arg = restore_holes(expr.arg, holes);
    }

    return {
      ...expr,
      func: restore_holes(expr.func, holes),
      arg,
      args: expr.args.map((arg) => restore_holes(arg, holes)),
    };
  }

  return expr;
}
