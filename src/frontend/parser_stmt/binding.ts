import { expect } from "../../expect.ts";
import type { FrontExpr, Stmt, TypeExpr } from "../ast.ts";
import { expect_snake_case, is_no_demand_name } from "../names.ts";
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

    if (this.peek().kind === "symbol" && this.peek().text === "{") {
      return this.parse_bind_pattern(kind);
    }

    if (kind === "let" && this.is_resume_dup()) {
      return this.parse_resume_dup();
    }

    if (kind === "let" && this.is_effect_bind()) {
      throw new Error(
        "Do not prefix an effect bind with `let`; use " +
          "`value <- Effect.operation()`",
      );
    }

    if (
      kind === "let" && this.peek().kind === "symbol" &&
      this.peek().text === "(" && this.peek(1).kind === "symbol" &&
      this.peek(1).text === "!"
    ) {
      throw new Error(
        "Legacy effect state bindings are not supported; use " +
          "`value <- Effect.operation()`",
      );
    }

    if (
      this.peek().kind === "symbol" && this.peek().text === "(" &&
      this.peek(1).kind === "name" &&
      this.peek(2).kind === "symbol" && this.peek(2).text === "::"
    ) {
      throw new Error(
        "Legacy effect contexts are not supported; annotate the function " +
          "with `-> <row>`",
      );
    }

    if (
      this.peek().kind === "name" && this.peek(1).kind === "name" &&
      /^[A-Z][A-Za-z0-9]*$/.test(this.peek().text)
    ) {
      throw new Error(
        "Legacy effect contexts are not supported; remove the context name " +
          "and use `-> <row>`",
      );
    }

    let is_recursive = false;

    if (kind === "let" && this.match_name("rec")) {
      is_recursive = true;
    }

    let is_linear = false;

    if (this.match_symbol("!")) {
      is_linear = true;
    }

    const name = this.expect_binding_name("Expected binding name");
    let binding_label = "Const binding";

    if (kind === "let") {
      binding_label = "Runtime binding";
    }

    if (is_linear && is_no_demand_name(name)) {
      throw new Error("`!_` is not supported");
    }

    if (!is_no_demand_name(name)) {
      this.expect_supported_name(name, binding_label);

      if (kind === "let") {
        expect_snake_case(name, "Runtime binding");
      } else {
        this.expect_const_binding_name(name);
      }
    }

    let annotation: string | undefined;
    let type_annotation: TypeExpr | undefined;

    if (this.match_symbol(":")) {
      const parsed = this.consume_annotation();
      annotation = parsed.annotation;
      type_annotation = parsed.type_annotation;
    }

    this.expect_symbol("=");
    this.skip_newlines();
    const value = this.parse_expr();

    if (is_linear) {
      this.affine_call_names.add(name);
    } else {
      this.affine_call_names.delete(name);
    }

    const stmt: Extract<Stmt, { tag: "bind" }> = {
      tag: "bind",
      kind,
      name,
      is_recursive,
      is_linear,
      annotation,
      value,
    };

    if (type_annotation) {
      stmt.type_annotation = type_annotation;
    }

    return stmt;
  }

  private is_resume_dup(): boolean {
    return this.peek().kind === "symbol" && this.peek().text === "(" &&
      this.peek(1).kind === "symbol" && this.peek(1).text === "!" &&
      this.peek(2).kind === "name" &&
      this.peek(3).kind === "symbol" && this.peek(3).text === "," &&
      this.peek(4).kind === "symbol" && this.peek(4).text === "!" &&
      this.peek(5).kind === "name" &&
      this.peek(6).kind === "symbol" && this.peek(6).text === ")" &&
      this.peek(7).kind === "symbol" && this.peek(7).text === "=" &&
      this.peek(8).kind === "name" && this.peek(8).text === "dup";
  }

  private parse_resume_dup(): Stmt {
    this.expect_symbol("(");
    this.expect_symbol("!");
    const left = this.expect_name("Expected left duplicated resumption");
    expect_snake_case(left, "Duplicated resumption");
    this.expect_symbol(",");
    this.expect_symbol("!");
    const right = this.expect_name("Expected right duplicated resumption");
    expect_snake_case(right, "Duplicated resumption");
    this.expect_symbol(")");
    this.expect_symbol("=");
    expect(this.match_name("dup"), "Expected dup");
    this.affine_call_names.add(left);
    this.affine_call_names.add(right);
    return { tag: "resume_dup", left, right, value: this.parse_expr() };
  }

  private is_effect_bind(): boolean {
    if (
      this.peek().kind === "name" && this.peek(1).kind === "symbol" &&
      this.peek(1).text === "<-"
    ) {
      return true;
    }

    return this.peek().kind === "symbol" && this.peek().text === "(" &&
      this.peek(1).kind === "symbol" && this.peek(1).text === ")" &&
      this.peek(2).kind === "symbol" && this.peek(2).text === "<-";
  }

  protected parse_effect_bind(): Stmt {
    let value_name: string | undefined;

    if (this.match_symbol("(")) {
      this.expect_symbol(")");
    } else {
      const name = this.expect_name("Expected effect result binding");

      if (name !== "_") {
        expect_snake_case(name, "Effect result binding");
        value_name = name;
      }
    }

    this.expect_symbol("<-");
    const value = this.parse_expr();

    if (this.is_direct_effect_call(value)) {
      return { tag: "state_bind", value_name, value };
    }

    if (!value_name) {
      return { tag: "expr", expr: value, effectful: true };
    }

    return {
      tag: "bind",
      kind: "let",
      name: value_name,
      is_linear: false,
      annotation: undefined,
      effectful: true,
      value,
    };
  }

  private is_direct_effect_call(value: FrontExpr): boolean {
    if (value.tag !== "app" || value.func.tag !== "field") {
      return false;
    }

    const object = value.func.object;

    if (object.tag === "var") {
      return /^[A-Z][A-Za-z0-9]*$/.test(object.name);
    }

    return object.tag === "field" && object.object.tag === "var" &&
      /^[A-Z][A-Za-z0-9]*$/.test(object.object.name);
  }

  private parse_bind_pattern(kind: "let" | "const"): Stmt {
    this.expect_symbol("{");
    const items = [];

    while (!this.match_symbol("}")) {
      const is_linear = this.match_symbol("!");
      const name = this.expect_binding_name(
        "Expected destructured binding name",
      );

      if (is_linear && is_no_demand_name(name)) {
        throw new Error("`!_` is not supported");
      }

      if (!is_no_demand_name(name)) {
        expect_snake_case(name, "Destructured binding");
      }
      items.push({ name, is_linear });

      if (!this.match_symbol("}")) {
        this.expect_symbol(",");
      } else {
        break;
      }
    }

    this.expect_symbol("=");
    return { tag: "bind_pattern", kind, items, value: this.parse_expr() };
  }

  protected parse_unsupported_stmt(feature: string): Stmt {
    const text = this.consume_until_boundary();
    return { tag: "unsupported", feature, text };
  }
}
