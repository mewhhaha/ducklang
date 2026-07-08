import { expect } from "../expect.ts";
import type { FrontExpr } from "./ast.ts";
import { expect_snake_case } from "./names.ts";
import { ParserAggregate } from "./parser_aggregate.ts";

export abstract class ParserConditional extends ParserAggregate {
  protected abstract parse_expr_without_postfix_block(): FrontExpr;

  protected abstract parse_block(): FrontExpr;

  protected parse_if_expr(): FrontExpr {
    const cond = this.parse_expr_without_postfix_block();
    const then_branch = this.parse_block();

    if (!this.match_name("else")) {
      return {
        tag: "if",
        cond,
        then_branch,
        else_branch: { tag: "num", type: "i32", value: 0 },
        implicit_else: true,
      };
    }

    const else_branch = this.parse_block();
    return { tag: "if", cond, then_branch, else_branch };
  }

  protected parse_if_let_expr(): FrontExpr {
    expect(this.match_name("let"), "Expected let");
    this.expect_symbol(".");
    const case_name = this.expect_name("Expected union case name");
    expect_snake_case(case_name, "Union case");
    let value_name: string | undefined;

    if (this.match_symbol("(")) {
      value_name = this.expect_name("Expected union case value name");
      expect_snake_case(value_name, "Union case value");
      this.expect_symbol(")");
    }

    this.expect_symbol("=");
    const target = this.parse_expr_without_postfix_block();
    const then_branch = this.parse_block();

    if (!this.match_name("else")) {
      return {
        tag: "if_let",
        case_name,
        value_name,
        target,
        then_branch,
        else_branch: { tag: "num", type: "i32", value: 0 },
        implicit_else: true,
      };
    }

    const else_branch = this.parse_block();
    return {
      tag: "if_let",
      case_name,
      value_name,
      target,
      then_branch,
      else_branch,
    };
  }
}
