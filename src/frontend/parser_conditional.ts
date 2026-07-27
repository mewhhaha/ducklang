import { expect } from "../expect.ts";
import type { FrontExpr, MatchArm, Pattern } from "./ast.ts";
import { front_literal_expr } from "./literal.ts";
import { expect_snake_case, is_no_demand_name } from "./names.ts";
import { binary_prim } from "./numeric.ts";
import { ParserAggregate } from "./parser_aggregate.ts";

type ParsedIfLetCondition =
  | {
    tag: "union";
    case_name: string;
    value_name: string | undefined;
    target: FrontExpr;
  }
  | { tag: "literal"; cond: FrontExpr }
  | { tag: "pattern"; pattern: Pattern; target: FrontExpr };

export abstract class ParserConditional extends ParserAggregate {
  protected abstract parse_expr_without_postfix_block(): FrontExpr;

  protected abstract parse_expr_before_arrow(): FrontExpr;

  protected abstract parse_block(): FrontExpr;

  protected abstract parse_conditional_branch(): FrontExpr;

  protected parse_if_expr(): FrontExpr {
    const start = this.index - 1;
    const expr = this.parse_if_expr_inner();
    return this.concrete_node(start, expr);
  }

  private parse_if_expr_inner(): FrontExpr {
    const cond = this.parse_expr_without_postfix_block();
    this.expect_keyword("then");
    const then_branch = this.parse_conditional_branch();
    const else_branch = this.parse_optional_else_branch();
    this.expect_keyword("end");

    if (!else_branch) {
      return {
        tag: "if",
        cond,
        then_branch,
        else_branch: { tag: "num", type: "i32", value: 0 },
        implicit_else: true,
      };
    }

    return { tag: "if", cond, then_branch, else_branch };
  }

  protected parse_if_let_expr(): FrontExpr {
    const start = this.index - 1;
    const expr = this.parse_if_let_expr_inner();
    return this.concrete_node(start, expr);
  }

  private parse_if_let_expr_inner(): FrontExpr {
    const pattern = this.parse_if_let_condition();
    this.expect_keyword("then");
    const then_branch = this.parse_conditional_branch();
    const else_branch = this.parse_optional_else_branch();
    this.expect_keyword("end");
    return conditional_from_pattern(pattern, then_branch, else_branch);
  }

  protected parse_optional_else_branch(): FrontExpr | undefined {
    if (!this.match_name("else")) {
      return undefined;
    }

    const chained = this.parse_chained_else_branch();

    if (chained !== undefined) {
      return chained;
    }

    return this.parse_conditional_branch();
  }

  private parse_chained_else_branch(): FrontExpr | undefined {
    const state = this.parser_state();

    try {
      if (this.starts_if_let_condition()) {
        const pattern = this.parse_if_let_condition();

        if (!this.match_name("then")) {
          this.restore_parser_state(state);
          return undefined;
        }

        const then_branch = this.parse_conditional_branch();
        const else_branch = this.parse_optional_else_branch();
        return conditional_from_pattern(pattern, then_branch, else_branch);
      }

      const cond = this.parse_expr_without_postfix_block();

      if (!this.match_name("then")) {
        this.restore_parser_state(state);
        return undefined;
      }

      const then_branch = this.parse_conditional_branch();
      const else_branch = this.parse_optional_else_branch();

      if (else_branch === undefined) {
        return {
          tag: "if",
          cond,
          then_branch,
          else_branch: { tag: "num", type: "i32", value: 0 },
          implicit_else: true,
        };
      }

      return { tag: "if", cond, then_branch, else_branch };
    } catch {
      this.restore_parser_state(state);
      return undefined;
    }
  }

  protected starts_if_let_condition(): boolean {
    let offset = 0;

    if (this.peek().kind === "symbol" && this.peek().text === "(") {
      offset = 1;
    }

    const token = this.peek(offset);
    return token.kind === "name" && token.text === "let";
  }

  protected parse_case_expr(): FrontExpr {
    if (this.match_symbol("=>")) {
      this.expect_keyword("of");
      this.skip_newlines();
      const arms = this.parse_case_arms();
      return case_function_from_arms(arms);
    }

    const target = this.parse_expr_without_postfix_block();
    this.skip_newlines();
    this.expect_keyword("of");
    this.skip_newlines();
    return { tag: "match", target, arms: this.parse_case_arms() };
  }

  private parse_case_arms(): MatchArm[] {
    const arms: MatchArm[] = [];

    while (true) {
      let pattern: import("./ast.ts").Pattern;

      if (
        this.peek().kind === "name" &&
        (this.peek().text === "struct" || this.peek().text === "union") &&
        this.peek(1).kind === "symbol" && this.peek(1).text === "{"
      ) {
        pattern = { tag: "type", pattern: this.parse_type_pattern() };
      } else {
        pattern = this.parse_pattern();
      }
      let guard: FrontExpr | undefined;

      if (this.match_name("if")) {
        guard = this.parse_expr_before_arrow();
      }

      this.expect_symbol("=>");
      let body: FrontExpr;

      if (this.at_keyword("do")) {
        body = this.parse_block();
      } else {
        body = this.parse_expr_without_postfix_block();
      }

      arms.push({ pattern, guard, body });

      while (this.peek().kind === "newline" && this.peek().raw !== ";") {
        this.advance();
      }

      if (!this.match_symbol(",")) {
        const terminator = this.peek();

        if (terminator.kind !== "newline" || terminator.raw !== ";") {
          throw this.error("Expected `;` after final case arm");
        }

        break;
      }

      this.skip_newlines();
    }

    return arms;
  }

  protected parse_if_let_condition(): ParsedIfLetCondition {
    const parenthesized = this.match_symbol("(");
    expect(this.match_name("let"), "Expected let");
    const union_case_token = this.peek();
    const union_payload_token = this.peek(2);
    const nullary = union_payload_token.kind === "symbol" &&
      union_payload_token.text === "=";
    const binding_payload = union_payload_token.kind === "name" &&
      /^[_a-z]/.test(union_payload_token.text);
    const simple_union_pattern = union_case_token.kind === "symbol" &&
      union_case_token.text === "#" && (nullary || binding_payload);

    if (simple_union_pattern) {
      this.expect_symbol("#");
      const case_name = this.expect_name("Expected union case name");
      expect(
        /^[A-Z][A-Za-z0-9]*$/.test(case_name),
        "Union case must use PascalCase: " + case_name,
      );
      let value_name: string | undefined;

      if (!nullary) {
        value_name = this.expect_binding_name(
          "Expected union case value name",
        );

        if (!is_no_demand_name(value_name)) {
          expect_snake_case(value_name, "Union case value");
        }
      }

      this.expect_symbol("=");
      const target = this.parse_expr_without_postfix_block();

      if (parenthesized) {
        this.expect_symbol(")");
      }

      return {
        tag: "union",
        case_name,
        value_name,
        target,
      };
    }

    const literal = front_literal_expr(this.peek());
    const interpolated_text = literal?.tag === "text" &&
      /\$\{[a-z_][A-Za-z0-9_]*\}/.test(literal.value);
    const alternative = this.peek(1).kind === "symbol" &&
      this.peek(1).text === "|";

    if (literal !== undefined && !interpolated_text && !alternative) {
      this.advance();
      this.expect_symbol("=");
      const target = this.parse_expr_without_postfix_block();

      if (parenthesized) {
        this.expect_symbol(")");
      }

      const prim = binary_prim("==", target, literal);
      expect(prim, "Missing literal pattern equality primitive");
      return {
        tag: "literal",
        cond: { tag: "prim", prim, left: target, right: literal },
      };
    }

    const pattern = this.parse_pattern();
    this.expect_symbol("=");
    const target = this.parse_expr_without_postfix_block();

    if (parenthesized) {
      this.expect_symbol(")");
    }

    return { tag: "pattern", pattern, target };
  }
}

function case_function_from_arms(arms: MatchArm[]): FrontExpr {
  const packed = arms.find((arm) => {
    return arm.pattern.tag === "product" &&
      arm.pattern.value_pack === true;
  });
  let parameter_count = 1;

  if (packed?.pattern.tag === "product") {
    parameter_count = packed.pattern.entries.length;
  }

  for (const arm of arms) {
    const pattern = arm.pattern;

    if (pattern.tag === "binding" || pattern.tag === "wildcard") {
      continue;
    }

    let arm_parameter_count = 1;

    if (pattern.tag === "product" && pattern.value_pack === true) {
      arm_parameter_count = pattern.entries.length;
    }

    expect(
      arm_parameter_count === parameter_count,
      "`case => of` arms must match the same argument count",
    );
  }

  const params = Array.from({ length: parameter_count }, (_, index) => ({
    name: "_case#param" + index.toString(),
    is_const: false,
    is_linear: false,
    annotation: undefined,
  }));
  let pattern: Pattern;
  let target: FrontExpr;

  if (parameter_count === 1) {
    const param = params[0];
    expect(param, "Missing case-function parameter");
    pattern = {
      tag: "binding",
      name: param.name,
      mode: "default",
      annotation: undefined,
    };
    target = { tag: "var", name: param.name };
  } else {
    pattern = {
      tag: "product",
      entries: params.map((param) => ({
        pattern: {
          tag: "binding",
          name: param.name,
          mode: "default",
          annotation: undefined,
        },
      })),
      value_pack: true,
    };
    target = {
      tag: "product",
      entries: params.map((param) => ({
        value: { tag: "var", name: param.name },
      })),
      value_pack: true,
    };
  }

  return {
    tag: "lam",
    pattern,
    params,
    body: { tag: "match", target, arms },
    case_function: true,
  };
}

function conditional_from_pattern(
  pattern: ParsedIfLetCondition,
  then_branch: FrontExpr,
  parsed_else: FrontExpr | undefined,
): FrontExpr {
  let else_branch: FrontExpr = { tag: "num", type: "i32", value: 0 };
  const implicit_else = parsed_else === undefined;

  if (parsed_else !== undefined) {
    else_branch = parsed_else;
  }

  if (pattern.tag === "literal") {
    const result: Extract<FrontExpr, { tag: "if" }> = {
      tag: "if",
      cond: pattern.cond,
      then_branch,
      else_branch,
    };

    if (implicit_else) {
      result.implicit_else = true;
    }

    return result;
  }

  if (pattern.tag === "pattern") {
    return {
      tag: "match",
      target: pattern.target,
      arms: [
        { pattern: pattern.pattern, guard: undefined, body: then_branch },
        {
          pattern: { tag: "wildcard", mode: "default" },
          guard: undefined,
          body: else_branch,
        },
      ],
    };
  }

  const result: Extract<FrontExpr, { tag: "if_let" }> = {
    tag: "if_let",
    case_name: pattern.case_name,
    value_name: pattern.value_name,
    target: pattern.target,
    then_branch,
    else_branch,
  };

  if (implicit_else) {
    result.implicit_else = true;
  }

  return result;
}
