import type { Source as SourceNode, Stmt, Token } from "./ast.ts";
import { expect_snake_case } from "./names.ts";
import { ParserStmtBinding } from "./parser_stmt/binding.ts";
import { unsupported_reserved_feature } from "./parser_support.ts";

export class ParserStmt extends ParserStmtBinding {
  constructor(tokens: Token[]) {
    super(tokens);
  }

  parse_program(): SourceNode {
    const statements: Stmt[] = [];
    this.skip_newlines();

    while (!this.is("eof")) {
      statements.push(this.parse_stmt());
      this.skip_newlines();
    }

    return { tag: "program", statements };
  }

  protected parse_stmt(): Stmt {
    if (this.peek().kind === "name") {
      const feature = unsupported_reserved_feature(this.peek().text);

      if (feature) {
        return this.parse_unsupported_stmt(feature);
      }
    }

    if (this.match_name("let")) {
      return this.parse_bind("let");
    }

    if (this.match_name("const")) {
      return this.parse_bind("const");
    }

    if (this.peek().kind === "name" && this.peek().text === "host_import") {
      return this.parse_host_import_stmt();
    }

    if (this.match_name("return")) {
      return { tag: "return", value: this.parse_expr() };
    }

    if (this.peek().kind === "name" && this.peek().text === "if") {
      return this.parse_if_stmt();
    }

    if (this.peek().kind === "name") {
      const name = this.peek().text;
      const next = this.peek(1);

      if (next.kind === "symbol" && (next.text === "=" || next.text === ":=")) {
        expect_snake_case(name, "Runtime binding");
        this.advance();
        const op = this.advance();
        const value = this.parse_expr();

        if (op.text === "=") {
          return { tag: "assign", name, mode: "same", value };
        }

        return { tag: "assign", name, mode: "change", value };
      }

      if (next.kind === "symbol" && next.text === "[") {
        const close = this.find_matching(this.index + 1, "[", "]");
        let after_index = close + 1;

        while (true) {
          const token = this.tokens[after_index];

          if (!token || token.kind !== "newline") {
            break;
          }

          after_index += 1;
        }

        const after = this.tokens[after_index];

        if (after && after.kind === "symbol" && after.text === "=") {
          expect_snake_case(name, "Runtime binding");
          this.advance();
          this.expect_symbol("[");
          const index = this.parse_expr();
          this.expect_symbol("]");
          this.expect_symbol("=");
          return { tag: "index_assign", name, index, value: this.parse_expr() };
        }
      }
    }

    if (this.peek().kind === "name" && this.peek().text === "module") {
      return this.parse_module_bind();
    }

    if (this.peek().kind === "name" && this.peek().text === "import") {
      return this.parse_import_stmt();
    }

    if (this.peek().kind === "name" && this.peek().text === "for") {
      return this.parse_for_stmt();
    }

    if (
      this.peek().kind === "name" &&
      (this.peek().text === "break" || this.peek().text === "continue")
    ) {
      const keyword = this.advance().text;

      if (keyword === "break") {
        return { tag: "break" };
      }

      return { tag: "continue" };
    }

    return { tag: "expr", expr: this.parse_expr() };
  }
}
