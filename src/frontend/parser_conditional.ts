import { expect } from "../expect.ts";
import type { FrontExpr } from "./ast.ts";
import { front_literal_expr } from "./literal.ts";
import { expect_snake_case, is_no_demand_name } from "./names.ts";
import { binary_prim, i32_expr, truthy_expr } from "./numeric.ts";
import { ParserAggregate } from "./parser_aggregate.ts";

type ParsedIfLetCondition =
  | {
    tag: "union";
    case_name: string;
    value_name: string | undefined;
    target: FrontExpr;
    guard: FrontExpr | undefined;
  }
  | { tag: "literal"; cond: FrontExpr; guard: FrontExpr | undefined };

type MatchPattern =
  | { tag: "wildcard" }
  | { tag: "literal"; literal: FrontExpr }
  | { tag: "union"; case_name: string; value_name: string | undefined };

type MatchArm = {
  pattern: MatchPattern;
  guard: FrontExpr | undefined;
  value: FrontExpr;
};

export abstract class ParserConditional extends ParserAggregate {
  #next_match_target = 0;

  protected abstract parse_expr_without_postfix_block(): FrontExpr;

  protected abstract parse_block(): FrontExpr;

  protected parse_if_expr(): FrontExpr {
    const cond = this.parse_expr_without_postfix_block();
    const then_branch = this.parse_block();
    const else_branch = this.parse_optional_else_branch();

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
    const pattern = this.parse_if_let_condition();
    const then_branch = this.parse_block();
    let else_branch: FrontExpr = { tag: "num", type: "i32", value: 0 };
    let implicit_else = true;
    const parsed_else = this.parse_optional_else_branch();

    if (parsed_else) {
      else_branch = parsed_else;
      implicit_else = false;
    }

    if (pattern.tag === "literal") {
      const result: Extract<FrontExpr, { tag: "if" }> = {
        tag: "if",
        cond: guarded_condition(pattern.cond, pattern.guard),
        then_branch,
        else_branch,
      };

      if (implicit_else) {
        result.implicit_else = true;
      }

      return result;
    }

    // A guarded union pattern nests the guard as an inner branch: the
    // guard failing selects the same else value as the pattern failing.
    let guarded_then = then_branch;

    if (pattern.guard) {
      const inner: Extract<FrontExpr, { tag: "if" }> = {
        tag: "if",
        cond: truthy_expr(pattern.guard),
        then_branch,
        else_branch: structuredClone(else_branch),
      };

      if (implicit_else) {
        inner.implicit_else = true;
      }

      guarded_then = inner;
    }

    const result: Extract<FrontExpr, { tag: "if_let" }> = {
      tag: "if_let",
      case_name: pattern.case_name,
      value_name: pattern.value_name,
      target: pattern.target,
      then_branch: guarded_then,
      else_branch,
    };

    if (implicit_else) {
      result.implicit_else = true;
    }

    return result;
  }

  protected parse_optional_else_branch(): FrontExpr | undefined {
    if (!this.match_name("else")) {
      return undefined;
    }

    if (!this.match_name("if")) {
      return this.parse_block();
    }

    if (this.starts_if_let_condition()) {
      return this.parse_if_let_expr();
    }

    return this.parse_if_expr();
  }

  protected starts_if_let_condition(): boolean {
    let offset = 0;

    if (this.peek().kind === "symbol" && this.peek().text === "(") {
      offset = 1;
    }

    const token = this.peek(offset);
    return token.kind === "name" && token.text === "let";
  }

  protected parse_if_let_condition(): ParsedIfLetCondition {
    const parenthesized = this.match_symbol("(");
    expect(this.match_name("let"), "Expected let");

    if (this.match_symbol(".")) {
      const case_name = this.expect_name("Expected union case name");
      expect_snake_case(case_name, "Union case");
      let value_name: string | undefined;

      if (this.match_symbol("(")) {
        value_name = this.expect_binding_name(
          "Expected union case value name",
        );

        if (!is_no_demand_name(value_name)) {
          expect_snake_case(value_name, "Union case value");
        }
        this.expect_symbol(")");
      }

      this.expect_symbol("=");
      const target = this.parse_expr_without_postfix_block();
      const guard = this.parse_optional_condition_guard();

      if (parenthesized) {
        this.expect_symbol(")");
      }

      return {
        tag: "union",
        case_name,
        value_name,
        target,
        guard,
      };
    }

    const literal_token = this.peek();
    const literal = front_literal_expr(literal_token);
    expect(literal, "Expected union case or literal pattern");
    this.advance();
    this.expect_symbol("=");
    const target = this.parse_expr_without_postfix_block();
    const guard = this.parse_optional_condition_guard();

    if (parenthesized) {
      this.expect_symbol(")");
    }

    const prim = binary_prim("==", target, literal);
    expect(prim, "Missing literal pattern equality primitive");
    return {
      tag: "literal",
      cond: { tag: "prim", prim, left: target, right: literal },
      guard,
    };
  }

  private parse_optional_condition_guard(): FrontExpr | undefined {
    if (!this.match_symbol(",")) {
      return undefined;
    }

    return this.parse_expr_without_postfix_block();
  }

  // `match target { pattern (, guard)? => value ... }` is surface sugar:
  // the parser emits the equivalent `if let` chain, so match adds no new
  // lowering shape. A guarded arm falls through to the remaining arms
  // when its guard fails, and a match without a final `_` arm falls back
  // to an unreachable-arm panic.
  protected parse_match_expr(): FrontExpr {
    const target = this.parse_expr_without_postfix_block();
    this.expect_symbol("{");
    this.skip_newlines();
    const arms: MatchArm[] = [];

    while (!this.match_symbol("}")) {
      arms.push(this.parse_match_arm());
      this.match_symbol(",");
      this.skip_newlines();
    }

    expect(arms.length > 0, "Expected at least one match arm");

    let target_name: string;
    let hoist = false;

    if (target.tag === "var") {
      target_name = target.name;
    } else {
      target_name = "match_target#" + this.#next_match_target.toString();
      this.#next_match_target += 1;
      hoist = true;
    }

    let chain: FrontExpr;
    let remaining = arms;
    const last = arms[arms.length - 1];
    expect(last, "Missing final match arm");

    if (last.pattern.tag === "wildcard" && !last.guard) {
      chain = last.value;
      remaining = arms.slice(0, -1);
    } else {
      chain = {
        tag: "app",
        func: { tag: "var", name: "panic" },
        args: [{ tag: "text", value: "unreachable match arm" }],
      };
    }

    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      const arm = remaining[index];
      expect(arm, "Missing match arm " + index.toString());
      chain = this.match_arm_chain(arm, target_name, chain);
    }

    if (!hoist) {
      return chain;
    }

    return {
      tag: "block",
      statements: [
        {
          tag: "bind",
          kind: "let",
          name: target_name,
          is_linear: false,
          annotation: undefined,
          value: target,
        },
        { tag: "expr", expr: chain },
      ],
    };
  }

  private match_arm_chain(
    arm: MatchArm,
    target_name: string,
    rest: FrontExpr,
  ): FrontExpr {
    if (arm.pattern.tag === "wildcard") {
      expect(arm.guard, "Match arm after a wildcard arm is unreachable");
      return {
        tag: "if",
        cond: truthy_expr(arm.guard),
        then_branch: arm.value,
        else_branch: rest,
      };
    }

    const target: FrontExpr = { tag: "var", name: target_name };

    if (arm.pattern.tag === "literal") {
      const prim = binary_prim("==", target, arm.pattern.literal);
      expect(prim, "Missing literal pattern equality primitive");
      const cond: FrontExpr = {
        tag: "prim",
        prim,
        left: target,
        right: arm.pattern.literal,
      };

      return {
        tag: "if",
        cond: guarded_condition(cond, arm.guard),
        then_branch: arm.value,
        else_branch: rest,
      };
    }

    // A guard failure falls through to the remaining arms, so the rest
    // of the chain appears as both the guard else and the pattern else.
    let then_branch = arm.value;

    if (arm.guard) {
      then_branch = {
        tag: "if",
        cond: truthy_expr(arm.guard),
        then_branch: arm.value,
        else_branch: structuredClone(rest),
      };
    }

    return {
      tag: "if_let",
      case_name: arm.pattern.case_name,
      value_name: arm.pattern.value_name,
      target,
      then_branch,
      else_branch: rest,
    };
  }

  private parse_match_arm(): MatchArm {
    const pattern = this.parse_match_arm_pattern();
    let guard: FrontExpr | undefined;

    if (this.match_symbol(",")) {
      const parsed = this.parse_expr_without_postfix_block();

      // A bare-name guard reads as a lambda because the arm arrow
      // follows it; split the accidental lambda back into guard and
      // arm value.
      if (
        parsed.tag === "lam" &&
        parsed.params.length === 1 &&
        parsed.params[0] &&
        parsed.params[0].annotation === undefined &&
        !parsed.params[0].is_const &&
        !parsed.params[0].is_linear
      ) {
        return {
          pattern,
          guard: { tag: "var", name: parsed.params[0].name },
          value: parsed.body,
        };
      }

      guard = parsed;
    }

    this.expect_symbol("=>");
    return { pattern, guard, value: this.parse_match_arm_value() };
  }

  private parse_match_arm_pattern(): MatchPattern {
    const token = this.peek();

    if (token.kind === "name" && token.text === "_") {
      this.advance();
      return { tag: "wildcard" };
    }

    if (this.match_symbol(".")) {
      const case_name = this.expect_name("Expected union case name");
      expect_snake_case(case_name, "Union case");
      let value_name: string | undefined;

      if (this.match_symbol("(")) {
        value_name = this.expect_binding_name(
          "Expected union case value name",
        );

        if (!is_no_demand_name(value_name)) {
          expect_snake_case(value_name, "Union case value");
        }
        this.expect_symbol(")");
      }

      return { tag: "union", case_name, value_name };
    }

    const literal = front_literal_expr(token);
    expect(literal, "Expected match arm pattern");
    this.advance();
    return { tag: "literal", literal };
  }

  private parse_match_arm_value(): FrontExpr {
    if (this.peek().kind === "symbol" && this.peek().text === "{") {
      return this.parse_block();
    }

    return this.parse_expr_without_postfix_block();
  }
}

export function guarded_condition(
  cond: FrontExpr,
  guard: FrontExpr | undefined,
): FrontExpr {
  if (!guard) {
    return cond;
  }

  // The same shape the parser builds for `cond && guard`.
  return {
    tag: "if",
    cond: truthy_expr(cond),
    then_branch: truthy_expr(guard),
    else_branch: i32_expr(0),
  };
}
