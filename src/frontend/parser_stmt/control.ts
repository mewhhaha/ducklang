import { expect } from "../../expect.ts";
import type { FrontExpr, Stmt } from "../ast.ts";
import { expect_snake_case } from "../names.ts";
import { ParserHostImport } from "../parser_host_import.ts";

export abstract class ParserStmtControl extends ParserHostImport {
  protected parse_if_stmt(): Stmt {
    this.expect_name("Expected if");

    if (this.peek().kind === "name" && this.peek().text === "let") {
      return this.parse_if_let_stmt_after_if();
    }

    const cond = this.parse_expr_without_postfix_block();
    const then_branch = this.parse_block();
    expect(then_branch.tag === "block", "Expected if body block");

    if (this.match_name("else")) {
      const else_branch = this.parse_block();
      return {
        tag: "expr",
        expr: { tag: "if", cond, then_branch, else_branch },
      };
    }

    return { tag: "if_stmt", cond, body: then_branch.statements };
  }

  protected parse_for_stmt(): Stmt {
    this.expect_name("Expected for");
    const index = this.expect_name("Expected loop index");
    expect_snake_case(index, "Loop index");

    if (this.match_symbol(",")) {
      const item = this.expect_name("Expected collection item");
      expect_snake_case(item, "Collection item");
      expect(this.match_name("in"), "Expected in");
      const collection = this.parse_expr_without_postfix_block();
      const body = this.parse_block();
      expect(body.tag === "block", "Expected collection for body block");

      return {
        tag: "for_collection",
        index,
        item,
        collection,
        body: body.statements,
      };
    }

    expect(this.match_name("in"), "Expected in");
    const start = this.parse_expr_without_postfix_block();

    if (!this.match_symbol("..")) {
      const body = this.parse_block();
      expect(body.tag === "block", "Expected collection for body block");

      return {
        tag: "for_collection",
        index: undefined,
        item: index,
        collection: start,
        body: body.statements,
      };
    }

    const end = this.parse_expr_without_postfix_block();

    let step: FrontExpr = { tag: "num", type: "i32", value: 1 };

    if (this.match_name("by")) {
      step = this.parse_expr_without_postfix_block();
    }

    const body = this.parse_block();
    expect(body.tag === "block", "Expected for body block");
    return {
      tag: "for_range",
      index,
      start,
      end,
      step,
      body: body.statements,
    };
  }

  private parse_if_let_stmt_after_if(): Stmt {
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
    expect(then_branch.tag === "block", "Expected if let body block");

    if (this.match_name("else")) {
      const else_branch = this.parse_block();
      return {
        tag: "expr",
        expr: {
          tag: "if_let",
          case_name,
          value_name,
          target,
          then_branch,
          else_branch,
        },
      };
    }

    return {
      tag: "if_let_stmt",
      case_name,
      value_name,
      target,
      body: then_branch.statements,
    };
  }
}
