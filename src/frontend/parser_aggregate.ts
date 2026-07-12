import { expect } from "../expect.ts";
import type { Field, FrontExpr, Token, TypeField, TypePattern } from "./ast.ts";
import { expect_snake_case } from "./names.ts";
import { record_name_site } from "./name_site.ts";
import { ParserParams } from "./parser_params.ts";

export abstract class ParserAggregate extends ParserParams {
  protected abstract parse_expr(): FrontExpr;

  protected parse_bracket_value(): FrontExpr {
    const start = this.index;
    const value = this.parse_bracket_value_inner();
    return this.concrete_node(start, value);
  }

  private parse_bracket_value_inner(): FrontExpr {
    this.expect_symbol("[");
    this.skip_newlines();
    const fields: Field[] = [];

    if (this.match_symbol("]")) {
      return {
        tag: "struct_value",
        type_expr: { tag: "var", name: "object_type" },
        fields,
        bracketed: "positional",
      };
    }

    const named = this.peek().kind === "symbol" && this.peek().text === ".";
    let index = 0;

    while (true) {
      if (named) {
        const field_start = this.index;
        this.expect_symbol(".");
        const name = this.expect_name("Expected product field name");
        expect_snake_case(name, "Product field");
        this.expect_symbol("=");
        fields.push(
          this.concrete_node(field_start, { name, value: this.parse_expr() }),
        );
      } else {
        const field_start = this.index;
        const field = {
          name: "item_" + index.toString(),
          value: this.parse_expr(),
        };
        fields.push(this.concrete_node(field_start, field));
      }

      index += 1;

      if (this.match_symbol("]")) {
        break;
      }

      this.expect_symbol(",");
      this.skip_newlines();

      if (named) {
        expect(
          this.peek().kind === "symbol" && this.peek().text === ".",
          "Cannot mix named and positional product entries",
        );
      } else {
        expect(
          !(this.peek().kind === "symbol" && this.peek().text === "."),
          "Cannot mix positional and named product entries",
        );
      }
    }

    let bracketed: "named" | "positional" = "positional";

    if (named) {
      bracketed = "named";
    }

    return {
      tag: "struct_value",
      type_expr: { tag: "var", name: "object_type" },
      fields,
      bracketed,
    };
  }

  protected parse_field_list(): Field[] {
    this.expect_symbol("{");
    this.skip_newlines();
    const fields: Field[] = [];

    while (!this.match_symbol("}")) {
      const field_start = this.index;
      const name = this.expect_name("Expected field name");
      expect_snake_case(name, "Field");
      this.expect_symbol(":");
      const value = this.parse_expr();
      fields.push(this.concrete_node(field_start, { name, value }));

      if (this.match_symbol(",")) {
        this.skip_newlines();
      } else {
        this.skip_newlines();
      }
    }

    return fields;
  }

  protected parse_record_field_list(): Field[] {
    this.expect_symbol("{");
    this.skip_newlines();
    const fields: Field[] = [];

    while (!this.match_symbol("}")) {
      const field_start = this.index;
      const name = this.expect_name("Expected record field name");
      expect_snake_case(name, "Record field");
      let value: FrontExpr = { tag: "var", name };

      if (this.match_symbol(":")) {
        value = this.parse_expr();
      }

      fields.push(this.concrete_node(field_start, { name, value }));

      if (this.match_symbol(",")) {
        this.skip_newlines();
      } else {
        this.skip_newlines();
      }
    }

    return fields;
  }

  protected is_object_literal(): boolean {
    if (this.peek().kind !== "symbol" || this.peek().text !== "{") {
      return false;
    }

    let offset = 1;

    while (this.peek(offset).kind === "newline") {
      offset += 1;
    }

    const first = this.peek(offset);

    if (first.kind !== "name") {
      return false;
    }

    offset += 1;

    while (this.peek(offset).kind === "newline") {
      offset += 1;
    }

    const second = this.peek(offset);

    if (second.kind !== "symbol") {
      return false;
    }

    return second.text === ":" || second.text === ",";
  }

  protected parse_type_field_list(): TypeField[] {
    this.expect_symbol("{");
    this.skip_newlines();
    const fields: TypeField[] = [];

    while (!this.match_symbol("}")) {
      const field_start = this.index;
      const name_token = this.peek();
      const name = this.expect_name("Expected type field name");
      expect_snake_case(name, "Type field");
      this.expect_symbol(":");
      const annotation = this.consume_type_field_annotation();
      const field = { name, type_name: annotation.text };
      record_name_site(field, "name", name, name_token.span);
      record_type_field_annotation_sites(field, annotation.tokens);
      fields.push(this.concrete_node(field_start, field));

      if (this.match_symbol(",")) {
        this.skip_newlines();
      } else {
        this.skip_newlines();
      }
    }

    return fields;
  }

  protected parse_type_pattern(): TypePattern {
    const start = this.index;
    const kind = this.expect_name("Expected type pattern");
    expect(
      kind === "struct" || kind === "union",
      "Expected struct or union type pattern",
    );
    this.expect_symbol("{");
    this.skip_newlines();
    const fields: TypeField[] = [];
    let open = false;

    while (!this.match_symbol("}")) {
      if (this.match_symbol("..")) {
        open = true;

        if (this.match_symbol(",")) {
          this.skip_newlines();
        } else {
          this.skip_newlines();
        }

        continue;
      }

      const name_token = this.peek();
      const name = this.expect_name("Expected type pattern field name");
      const field_start = this.index - 1;
      expect_snake_case(name, "Type pattern field");
      this.expect_symbol(":");
      const annotation = this.consume_type_field_annotation();
      const field = { name, type_name: annotation.text };
      record_name_site(field, "name", name, name_token.span);
      record_type_field_annotation_sites(field, annotation.tokens);
      fields.push(this.concrete_node(field_start, field));

      if (this.match_symbol(",")) {
        this.skip_newlines();
      } else {
        this.skip_newlines();
      }
    }

    return this.concrete_node(start, { kind, fields, open });
  }

  protected consume_type_field_annotation(): { text: string; tokens: Token[] } {
    const tokens: Token[] = [];

    while (!this.is("eof")) {
      const token = this.peek();

      if (
        token.kind === "newline" ||
        (token.kind === "symbol" &&
          (token.text === "," || token.text === "}"))
      ) {
        break;
      }

      if (token.kind === "name") {
        this.expect_type_reference_name(token.text, "Field type annotation");
      }

      tokens.push(this.advance());
    }

    expect(tokens.length > 0, "Expected field type annotation");
    return { text: tokens.map((token) => token.text).join(""), tokens };
  }
}

function record_type_field_annotation_sites(
  field: TypeField,
  tokens: Token[],
): void {
  let index = 0;

  for (const token of tokens) {
    if (token.kind === "name") {
      record_name_site(field, "type_name", token.text, token.span, index);
      index += 1;
    }
  }
}
