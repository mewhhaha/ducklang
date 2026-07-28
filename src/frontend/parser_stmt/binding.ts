import { expect } from "../../expect.ts";
import type { FrontExpr, RecursiveBinding, Stmt } from "../ast.ts";
import { apply_function_result_context } from "../function_context.ts";
import { expect_snake_case } from "../names.ts";
import { module_value } from "../parser_support.ts";
import { pattern_bindings } from "../pattern.ts";
import { expression_does_not_fall_through } from "../termination.ts";
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

  protected parse_bind(kind: "let" | "const"): Stmt {
    if (
      kind === "let" && this.peek().kind === "name" &&
      (this.peek().text === "struct" || this.peek().text === "union") &&
      this.peek(1).kind === "symbol" && this.peek(1).text === "{"
    ) {
      const pattern = this.parse_type_pattern();
      this.expect_symbol("=");
      const target = this.parse_expr();
      const terminator = this.peek();

      if (terminator.kind !== "newline" || terminator.raw !== ";") {
        throw this.error("Expected `;` after binding");
      }

      this.advance();
      return { tag: "type_check", pattern, target };
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

    let is_recursive = false;
    let opens_import = false;

    if (kind === "let" && this.match_name("rec")) {
      is_recursive = true;
    }

    if (kind === "const" && this.match_name("open")) {
      opens_import = true;
    }

    const pattern = this.parse_pattern();

    if (opens_import) {
      expect(
        pattern.tag === "product" &&
          pattern.entries.every((entry) => entry.label !== undefined),
        "Open imports require a named product pattern",
      );
    }

    if (pattern.tag === "value") {
      expect_snake_case(pattern.name, "Parameter");
    }

    const bindings = pattern_bindings(pattern);
    let name: string;
    let is_linear = false;
    let annotation: string | undefined;

    if (pattern.tag === "binding") {
      name = pattern.name;
      is_linear = pattern.mode === "linear";
      annotation = pattern.annotation;
    } else {
      name = this.fresh_no_demand_name();
    }

    this.expect_symbol("=");
    this.skip_newlines();
    let value = this.parse_expr();

    if (pattern.tag === "binding" && pattern.type_annotation !== undefined) {
      value = apply_function_result_context(value, pattern.type_annotation);
    }

    let else_branch: FrontExpr | undefined;
    const else_checkpoint = this.index;
    this.skip_newlines();

    if (this.match_name("else")) {
      expect(kind === "let", "Only let bindings support else branches");
      expect(!is_recursive, "Recursive bindings do not support else branches");
      expect(!opens_import, "Open bindings do not support else branches");
      else_branch = this.parse_block();
      expect(
        expression_does_not_fall_through(else_branch),
        "Let-else branch must return, break, continue, or trap",
      );
    } else {
      this.index = else_checkpoint;
    }

    if (opens_import) {
      expect(
        value.tag === "app" && value.func.tag === "import",
        "Open bindings require a direct module import invocation",
      );
    }
    const mutual: RecursiveBinding[] = [];
    const recursive_names = new Set([name]);

    if (is_recursive) {
      let checkpoint = this.index;
      this.skip_newlines();

      while (this.match_name("and")) {
        const member_pattern = this.parse_pattern();
        expect(
          member_pattern.tag === "binding",
          "Mutually recursive bindings require a name",
        );
        expect(
          !recursive_names.has(member_pattern.name),
          "Duplicate mutually recursive binding: " + member_pattern.name,
        );
        recursive_names.add(member_pattern.name);
        this.expect_symbol("=");
        this.skip_newlines();
        const member: RecursiveBinding = {
          pattern: member_pattern,
          name: member_pattern.name,
          is_linear: member_pattern.mode === "linear",
          annotation: member_pattern.annotation,
          value: apply_function_result_context(
            this.parse_expr(),
            member_pattern.type_annotation,
          ),
        };

        if (member_pattern.type_annotation !== undefined) {
          member.type_annotation = member_pattern.type_annotation;
        }

        mutual.push(member);
        checkpoint = this.index;
        this.skip_newlines();
      }

      this.index = checkpoint;
    }

    const terminator = this.peek();

    if (terminator.kind !== "newline" || terminator.raw !== ";") {
      throw this.error("Expected `;` after binding");
    }

    this.advance();

    for (const binding of bindings) {
      if (binding.mode === "linear") {
        this.affine_call_names.add(binding.name);
      } else {
        this.affine_call_names.delete(binding.name);
      }
    }

    const stmt: Extract<Stmt, { tag: "bind" }> = {
      tag: "bind",
      kind,
      pattern,
      name,
      is_recursive,
      is_linear,
      annotation,
      value,
    };

    if (else_branch !== undefined) {
      stmt.else_branch = else_branch;
    }

    if (opens_import) {
      stmt.opens_import = true;
    }

    if (pattern.tag === "binding" && pattern.type_annotation) {
      stmt.type_annotation = pattern.type_annotation;
    }

    if (mutual.length > 0) {
      stmt.mutual = mutual;
    }

    if (
      kind === "const" && pattern.tag === "binding" &&
      ((value.tag === "var" && this.effect_names.has(value.name)) ||
        (value.tag === "app" && value.func.tag === "var" &&
          (this.effect_names.has(value.func.name) ||
            /^[A-Z][A-Za-z0-9]*$/.test(value.func.name))))
    ) {
      this.effect_instance_names.add(pattern.name);
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
    const left = this.expect_variable_name(
      "Expected left duplicated resumption",
    );
    this.expect_supported_name(left, "Duplicated resumption");
    expect_snake_case(left, "Duplicated resumption");
    this.expect_symbol(",");
    this.expect_symbol("!");
    const right = this.expect_variable_name(
      "Expected right duplicated resumption",
    );
    this.expect_supported_name(right, "Duplicated resumption");
    expect_snake_case(right, "Duplicated resumption");
    this.expect_symbol(")");
    this.expect_symbol("=");
    expect(this.match_name("dup"), "Expected dup");
    this.affine_call_names.add(left);
    this.affine_call_names.add(right);
    const value = this.parse_expr();
    const terminator = this.peek();

    if (terminator.kind !== "newline" || terminator.raw !== ";") {
      throw this.error("Expected `;` after binding");
    }

    this.advance();
    return { tag: "resume_dup", left, right, value };
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
      const name = this.expect_variable_name(
        "Expected effect result binding",
      );

      if (name !== "_") {
        this.expect_supported_name(name, "Effect result binding");
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
      return this.effect_names.has(object.name) ||
        this.effect_instance_names.has(object.name) ||
        /^[A-Z][A-Za-z0-9]*$/.test(object.name);
    }

    return object.tag === "field" && object.object.tag === "var" &&
      /^[A-Z][A-Za-z0-9]*$/.test(object.object.name);
  }

  protected parse_unsupported_stmt(feature: string): Stmt {
    const text = this.consume_until_boundary();
    return { tag: "unsupported", feature, text };
  }
}
