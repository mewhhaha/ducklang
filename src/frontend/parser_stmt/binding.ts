import { expect } from "../../expect.ts";
import type { Stmt } from "../ast.ts";
import { expect_snake_case } from "../names.ts";
import { module_value } from "../parser_support.ts";
import { ParserStmtControl } from "./control.ts";

export abstract class ParserStmtBinding extends ParserStmtControl {
  protected parse_module_bind(): Stmt {
    this.expect_name("Expected module");
    const name = this.expect_name("Expected module name");
    this.expect_supported_name(name, "Module");
    expect_snake_case(name, "Module");
    this.expect_symbol("=");
    return {
      tag: "bind",
      kind: "const",
      name,
      is_linear: false,
      annotation: undefined,
      value: module_value(this.parse_expr()),
    };
  }

  protected parse_import_stmt(): Stmt {
    this.expect_name("Expected import");
    const name = this.expect_name("Expected import name");
    this.expect_supported_name(name, "Import");
    expect_snake_case(name, "Import");
    expect(this.match_name("from"), "Expected from");
    const path = this.peek();
    expect(path.kind === "string", "Expected import path");
    this.advance();
    return { tag: "import", name, path: path.text };
  }

  protected parse_bind(kind: "let" | "const"): Stmt {
    if (
      kind === "let" && this.peek().kind === "name" &&
      (this.peek().text === "struct" || this.peek().text === "union")
    ) {
      const pattern = this.parse_type_pattern();
      this.expect_symbol("=");
      return { tag: "type_check", pattern, target: this.parse_expr() };
    }

    let is_recursive = false;

    if (kind === "let" && this.match_name("rec")) {
      is_recursive = true;
    }

    let is_linear = false;

    if (this.match_symbol("!")) {
      is_linear = true;
    }

    const name = this.expect_name("Expected binding name");
    let binding_label = "Const binding";

    if (kind === "let") {
      binding_label = "Runtime binding";
    }

    this.expect_supported_name(name, binding_label);

    if (kind === "let") {
      expect_snake_case(name, "Runtime binding");
    } else {
      this.expect_const_binding_name(name);
    }

    let annotation: string | undefined;

    if (this.match_symbol(":")) {
      annotation = this.consume_annotation();
    }

    this.expect_symbol("=");

    return {
      tag: "bind",
      kind,
      name,
      is_recursive,
      is_linear,
      annotation,
      value: this.parse_expr(),
    };
  }

  protected parse_unsupported_stmt(feature: string): Stmt {
    const text = this.consume_until_boundary();
    return { tag: "unsupported", feature, text };
  }
}
