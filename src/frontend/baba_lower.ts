import { Applicative } from "@mewhhaha/typeclasses";
import { compiler_diagnostic, diagnostic_codes } from "../diagnostic.ts";
import { expect } from "../expect.ts";
import { integer_literal_fits, integer_type_name } from "../integer.ts";
import { is_snake_case, no_demand_name } from "./names.ts";
import type {
  Declaration,
  FrontExpr,
  Param,
  Pattern,
  Source,
  Stmt,
  TypeExpr,
} from "./ast.ts";
import type { BabaCstNode, BabaParseResult } from "./baba_parser.ts";
import { lower_baba_type_declaration } from "./baba_declaration_lower.ts";
import { lower_baba_type_reference } from "./baba_type_lower.ts";
import {
  type Checked,
  checked_value,
  diagnostics_of,
  fail,
  ok,
} from "./checked.ts";
import { binary_prim, numeric_expr_type } from "./numeric.ts";
import { parse_number_expr } from "./number_literal.ts";
import { apply_function_result_context } from "./function_context.ts";
import { decode_literal_escape } from "./literal.ts";
import { format_type_expr } from "./type_expr.ts";
import {
  derive_missing_source_spans,
  mark_source_span,
  source_span,
  type SourceSpan,
} from "./syntax.ts";

const conditional_branch_spans = new WeakMap<object, SourceSpan>();
const no_demand_names = new WeakMap<BabaCstNode, string>();
const synthetic_parameter_names = new WeakMap<BabaCstNode, string>();

export function lower_baba_source(parsed: BabaParseResult): Checked<Source> {
  const root = parsed.cst.root;
  if (root === undefined) {
    const source: Source = { tag: "program", statements: [] };
    mark_source_span(source, { start: 0, end: parsed.cst.text.length });
    return ok(source);
  }
  index_synthetic_names(root, parsed.cst.text, parsed.tokens);

  const contents = lower_top_level_sequence(
    root.children,
    parsed.cst.text,
  );

  return contents.map((lowered) => {
    let source: Source = { tag: "program", statements: lowered.statements };
    if (lowered.declarations.length > 0) {
      source = {
        tag: "program",
        module: undefined,
        declarations: lowered.declarations,
        statements: lowered.statements,
      };
    }
    mark_source_span(source, { start: root.start, end: root.end });
    derive_missing_source_spans(source, { start: root.start, end: root.end });
    return source;
  });
}

function index_synthetic_names(
  root: BabaCstNode,
  source: string,
  tokens: readonly { text: string; start: number; end: number }[],
): void {
  let next_no_demand = 0;
  function visit(node: BabaCstNode): void {
    if (node.kind === "binding_statement") {
      const pattern = node.children.find((child) => child.kind === "wildcard");
      if (pattern !== undefined) {
        no_demand_names.set(pattern, no_demand_name(next_no_demand));
        next_no_demand += 1;
      }
    }
    if (node.kind === "arrow_function") {
      const parameter_container = node.children.find((child) =>
        child.kind === "parameter" || child.kind === "parameter_list"
      );
      if (parameter_container !== undefined) {
        const source_offset = source_token_index(
          source,
          tokens,
          parameter_container.start,
        );
        if (parameter_container.kind === "parameter") {
          const wildcard = parameter_container.children.find((child) =>
            child.kind === "wildcard"
          );
          if (wildcard !== undefined) {
            synthetic_parameter_names.set(
              parameter_container,
              "_pattern#param" + source_offset.toString(),
            );
          }
        } else {
          let ignored = 0;
          for (
            const parameter of parameter_container.children.filter((child) =>
              child.kind === "parameter"
            )
          ) {
            const wildcard = parameter.children.find((child) =>
              child.kind === "wildcard"
            );
            if (wildcard === undefined) continue;
            synthetic_parameter_names.set(
              parameter,
              "_pattern#ignored" + source_offset.toString() + "#" +
                ignored.toString(),
            );
            ignored += 1;
          }
        }
      }
    }
    for (const child of node.children) visit(child);
  }
  visit(root);
}

function source_token_index(
  source: string,
  tokens: readonly { text: string; start: number; end: number }[],
  offset: number,
): number {
  let index = 0;
  let cursor = 0;
  for (const token of tokens) {
    if (token.start >= offset) break;
    index += line_break_count(source.slice(cursor, token.start));
    if (!token.text.startsWith("//")) index += 1;
    cursor = token.end;
  }
  index += line_break_count(source.slice(cursor, offset));
  return index;
}

function line_break_count(text: string): number {
  let count = 0;
  for (const character of text) {
    if (character === "\n") count += 1;
  }
  return count;
}

type LoweredTopLevel = {
  declarations: Declaration[];
  statements: Stmt[];
};

function lower_top_level_sequence(
  nodes: readonly BabaCstNode[],
  source: string,
): Checked<LoweredTopLevel> {
  const declaration_names = new Map<string, BabaCstNode>();
  let contents: Checked<LoweredTopLevel> = ok({
    declarations: [],
    statements: [],
  });
  for (const node of nodes) {
    if (node.kind === "type_declaration_statement") {
      let declaration = lower_baba_type_declaration(node, source);
      const name_node = node.children.find((child) =>
        child.kind === "identifier"
      );
      if (name_node !== undefined) {
        const name = source.slice(name_node.start, name_node.end);
        const previous = declaration_names.get(name);
        if (previous !== undefined) {
          declaration = Applicative.lift(
            (value: Declaration, _duplicate: null) => value,
            declaration,
            fail(
              compiler_diagnostic(
                diagnostic_codes.syntax_error,
                "Duplicate declaration name: " + name,
                { start: name_node.start, end: name_node.end },
                [{
                  message: "First declaration is here.",
                  span: { start: previous.start, end: previous.end },
                }],
              ),
            ),
          );
        } else {
          declaration_names.set(name, name_node);
        }
      }
      contents = Applicative.lift(
        (current: LoweredTopLevel, declaration: Declaration) => ({
          declarations: [...current.declarations, declaration],
          statements: current.statements,
        }),
        contents,
        declaration,
      );
      continue;
    }
    contents = Applicative.lift(
      (current: LoweredTopLevel, statement: Stmt | undefined) => {
        if (statement === undefined) return current;
        return {
          declarations: current.declarations,
          statements: [...current.statements, statement],
        };
      },
      contents,
      lower_statement(node, source),
    );
  }
  return contents;
}

function lower_statement(
  node: BabaCstNode,
  source: string,
): Checked<Stmt | undefined> {
  if (
    node.kind === "ERROR" || node.kind === "MISSING" ||
    contains_non_nested_recovery(node)
  ) {
    return ok(undefined);
  }

  if (
    node.kind === "prefix_signature_statement" ||
    node.kind === "prefix_fact_statement" ||
    node.kind === "comment" ||
    node.kind === '";"'
  ) {
    return ok(undefined);
  }

  if (node.kind === "binding_statement") {
    return lower_binding(node, source);
  }

  if (node.kind === "assignment") {
    return lower_assignment(node, source);
  }

  if (node.kind === "return_statement") {
    return lower_return(node, source);
  }

  if (node.kind === "break_statement") {
    return lower_break(node, source);
  }

  if (node.kind === "continue_statement") {
    const statement: Stmt = { tag: "continue" };
    mark_source_span(statement, { start: node.start, end: node.end });
    return ok(statement);
  }

  if (node.kind === "expression_statement") {
    const expression_node = semantic_child(node);
    if (expression_node === undefined) {
      return unsupported(node);
    }
    if (
      expression_node.kind === "if_expression" &&
      !expression_node.children.some((child) =>
        child.kind === "else_clause" || child.kind === "else_if_clause"
      )
    ) {
      return lower_if_statement(expression_node, source);
    }
    return lower_expression(expression_node, source).map((expr) => {
      const statement: Stmt = { tag: "expr", expr };
      mark_source_span(statement, { start: node.start, end: node.end });
      return statement;
    });
  }

  return unsupported(node);
}

function lower_statement_sequence(
  nodes: readonly BabaCstNode[],
  source: string,
): Checked<Stmt[]> {
  let statements: Checked<Stmt[]> = ok([]);
  for (const node of nodes) {
    statements = Applicative.lift(
      (current: Stmt[], next: Stmt | undefined) => {
        if (next === undefined) return current;
        return [...current, next];
      },
      statements,
      lower_statement(node, source),
    );
  }
  return statements;
}

function contains_non_nested_recovery(
  node: BabaCstNode,
  inside_nested_sequence = false,
): boolean {
  for (const child of node.children) {
    if (child.kind === "ERROR" || child.kind === "MISSING") {
      if (!inside_nested_sequence) return true;
      continue;
    }
    const nested_sequence = inside_nested_sequence ||
      child.kind === "block" || child.kind === "conditional_branch";
    if (contains_non_nested_recovery(child, nested_sequence)) return true;
  }
  return false;
}

function lower_binding(
  node: BabaCstNode,
  source: string,
): Checked<Stmt> {
  const name_node = node.children.find((child) =>
    child.kind === "identifier" || child.kind === "wildcard"
  );
  const type_node = node.children.find((child) =>
    child.kind === "type_reference"
  );
  const value_nodes = node.children.filter((child) =>
    child !== name_node && is_expression_node(child)
  );
  const value_node = value_nodes[0];
  if (name_node === undefined || value_node === undefined) {
    return unsupported(node);
  }
  if (name_node.kind === "wildcard" && type_node !== undefined) {
    return unsupported(type_node);
  }
  let name_check: Checked<null> = ok(null);
  if (
    name_node.kind === "identifier" &&
    !is_snake_case(source.slice(name_node.start, name_node.end))
  ) {
    const name = source.slice(name_node.start, name_node.end);
    name_check = fail(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        "Runtime binding must use snake_case: " + name,
        { start: name_node.start, end: name_node.end },
      ),
    );
  }
  if (value_nodes.length !== 1) return unsupported(node);
  for (const child of node.children) {
    if (child === name_node || child === value_node) continue;
    if (child === type_node || child.kind === '":"') continue;
    if (
      child.kind === '"let"' ||
      child.kind === '"const"' ||
      child.kind === '"="' ||
      child.kind === '";"'
    ) {
      continue;
    }
    return unsupported(child);
  }

  let kind: "let" | "const" = "let";
  if (source.slice(node.start, node.start + 5) === "const") {
    kind = "const";
  }
  let lowered_type: Checked<TypeExpr | undefined> = ok(undefined);
  if (type_node !== undefined) {
    lowered_type = lower_baba_type_reference(type_node, source);
  }
  const lowered_value = lower_expression(value_node, source);
  return Applicative.lift(
    (
      _name: null,
      parsed_type: TypeExpr | undefined,
      value: FrontExpr,
    ) => {
      let name = source.slice(name_node.start, name_node.end);
      let pattern: Pattern;
      let annotation: string | undefined;
      let type_annotation: TypeExpr | undefined;
      let pattern_end = name_node.end;
      if (name_node.kind === "wildcard") {
        const generated_name = no_demand_names.get(name_node);
        expect(
          generated_name !== undefined,
          "Baba wildcard binding has no no-demand identity.",
        );
        name = generated_name;
        pattern = { tag: "wildcard", mode: "default" };
      } else if (parsed_type !== undefined) {
        annotation = format_type_expr(parsed_type);
        expect(
          type_node !== undefined,
          "Baba binding annotation lost its node.",
        );
        pattern_end = type_node.end;
        if (parsed_type.tag !== "name") type_annotation = parsed_type;
        pattern = {
          tag: "binding",
          name,
          mode: "default",
          annotation,
        };
      } else {
        pattern = {
          tag: "binding",
          name,
          mode: "default",
          annotation: undefined,
        };
      }
      if (type_annotation !== undefined && pattern.tag === "binding") {
        pattern.type_annotation = type_annotation;
      }
      mark_source_span(pattern, {
        start: name_node.start,
        end: pattern_end,
      });
      const statement: Stmt = {
        tag: "bind",
        kind,
        pattern,
        name,
        is_recursive: false,
        is_linear: false,
        annotation,
        value: apply_function_result_context(value, type_annotation),
      };
      if (type_annotation !== undefined) {
        statement.type_annotation = type_annotation;
      }
      mark_source_span(statement, { start: node.start, end: node.end });
      return statement;
    },
    name_check,
    lowered_type,
    lowered_value,
  );
}

function lower_assignment(
  node: BabaCstNode,
  source: string,
): Checked<Stmt> {
  const name_node = node.children.find((child) => child.kind === "identifier");
  const value_node = [...node.children].reverse().find((child) =>
    is_expression_node(child)
  );
  if (name_node === undefined || value_node === undefined) {
    return unsupported(node);
  }
  const name = source.slice(name_node.start, name_node.end);
  let name_check: Checked<null> = ok(null);
  if (!is_snake_case(name)) {
    name_check = fail(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        "Runtime binding must use snake_case: " + name,
        { start: name_node.start, end: name_node.end },
      ),
    );
  }

  return Applicative.lift(
    (_name: null, value: FrontExpr) => {
      let mode: "same" | "change" = "same";
      if (
        node.children.some((child) =>
          source.slice(child.start, child.end) === ":="
        )
      ) {
        mode = "change";
      }
      const statement: Stmt = {
        tag: "assign",
        name,
        mode,
        value,
      };
      mark_source_span(statement, { start: node.start, end: node.end });
      return statement;
    },
    name_check,
    lower_expression(value_node, source),
  );
}

function lower_return(
  node: BabaCstNode,
  source: string,
): Checked<Stmt> {
  const value_node = node.children.find((child) => is_expression_node(child));
  if (value_node === undefined) {
    const statement: Stmt = { tag: "return", value: { tag: "unit" } };
    mark_source_span(statement, { start: node.start, end: node.end });
    return ok(statement);
  }

  return lower_expression(value_node, source).map((value) => {
    const statement: Stmt = { tag: "return", value };
    mark_source_span(statement, { start: node.start, end: node.end });
    return statement;
  });
}

function lower_break(
  node: BabaCstNode,
  source: string,
): Checked<Stmt> {
  const value_node = node.children.find((child) => is_expression_node(child));
  if (value_node === undefined) {
    const statement: Stmt = { tag: "break" };
    mark_source_span(statement, { start: node.start, end: node.end });
    return ok(statement);
  }
  return lower_expression(value_node, source).map((value) => {
    const statement: Stmt = { tag: "break", value };
    mark_source_span(statement, { start: node.start, end: node.end });
    return statement;
  });
}

function lower_if_statement(
  node: BabaCstNode,
  source: string,
): Checked<Stmt> {
  if (has_direct_token(node, source, "let")) return unsupported(node);
  const condition_node = node.children.find((child) =>
    child.kind === "condition_expression"
  );
  const branch_node = node.children.find((child) =>
    child.kind === "conditional_branch"
  );
  if (condition_node === undefined || branch_node === undefined) {
    return unsupported(node);
  }

  return Applicative.lift(
    (cond: FrontExpr, branch: FrontExpr) => {
      expect(
        branch.tag === "block",
        "Baba conditional branch did not lower to a block.",
      );
      const statement: Stmt = {
        tag: "if_stmt",
        cond,
        body: branch.statements,
      };
      mark_source_span(statement, { start: node.start, end: node.end });
      conditional_branch_spans.set(statement, source_span(branch));
      return statement;
    },
    lower_expression(condition_node, source),
    lower_conditional_branch(
      branch_node,
      source,
      conditional_branch_span(node, branch_node, source),
    ),
  );
}

function lower_expression(
  node: BabaCstNode,
  source: string,
): Checked<FrontExpr> {
  if (
    node.kind === "postfix_expression" ||
    node.kind === "parenthesized_expression" ||
    node.kind === "parenthesized_or_product" ||
    node.kind === "condition_expression"
  ) {
    const child = semantic_child(node);
    if (child === undefined) return unsupported(node);
    return lower_expression(child, source);
  }

  if (node.kind === "identifier" || node.kind === "intrinsic_identifier") {
    const expression: FrontExpr = {
      tag: "var",
      name: source.slice(node.start, node.end),
    };
    mark_source_span(expression, { start: node.start, end: node.end });
    return ok(expression);
  }

  if (node.kind === "number") {
    try {
      const expression = parse_number_expr(source.slice(node.start, node.end));
      mark_source_span(expression, { start: node.start, end: node.end });
      return ok(expression);
    } catch (error) {
      let message = String(error);
      if (error instanceof Error) message = error.message;
      return fail(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          message,
          { start: node.start, end: node.end },
        ),
      );
    }
  }

  if (node.kind === "boolean") {
    const expression: FrontExpr = {
      tag: "bool",
      value: source.slice(node.start, node.end) === "true",
    };
    mark_source_span(expression, { start: node.start, end: node.end });
    return ok(expression);
  }

  if (node.kind === "string") {
    const raw = source.slice(node.start, node.end);
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch (_error) {
      return unsupported(node);
    }
    if (typeof value !== "string") return unsupported(node);
    const expression: FrontExpr = { tag: "text", value };
    mark_source_span(expression, { start: node.start, end: node.end });
    return ok(expression);
  }

  if (node.kind === "character") {
    const raw = source.slice(node.start, node.end);
    const body = raw.slice(1, raw.length - 1);
    let character = body;
    if (body.startsWith("\\")) {
      const escaped = body[1];
      if (body.length !== 2 || escaped === undefined) return unsupported(node);
      const decoded = decode_literal_escape(escaped, "'");
      if (decoded === undefined) return unsupported(node);
      character = decoded;
    }
    if (Array.from(character).length !== 1) return unsupported(node);
    const code_point = character.codePointAt(0);
    expect(code_point !== undefined, "Baba character has no code point.");
    const expression: FrontExpr = {
      tag: "num",
      type: "i32",
      value: code_point,
      character,
    };
    mark_source_span(expression, { start: node.start, end: node.end });
    return ok(expression);
  }

  if (node.kind === "atom_expression") {
    const name_node = node.children.find((child) =>
      child.kind === "identifier"
    );
    if (name_node === undefined) return unsupported(node);
    const expression: FrontExpr = {
      tag: "atom",
      name: source.slice(name_node.start, name_node.end),
    };
    mark_source_span(expression, { start: node.start, end: node.end });
    return ok(expression);
  }

  if (node.kind === "linear_reference") {
    const name_node = node.children.find((child) =>
      child.kind === "identifier"
    );
    if (name_node === undefined) return unsupported(node);
    const expression: FrontExpr = {
      tag: "linear",
      name: source.slice(name_node.start, name_node.end),
    };
    mark_source_span(expression, { start: node.start, end: node.end });
    return ok(expression);
  }

  if (node.kind === "unit_pattern") {
    const expression: FrontExpr = { tag: "unit" };
    mark_source_span(expression, { start: node.start, end: node.end });
    return ok(expression);
  }

  if (
    node.kind === "binary_expression" ||
    node.kind === "condition_binary_expression"
  ) {
    return lower_binary(node, source);
  }

  if (node.kind === "arrow_function") {
    return lower_arrow(node, source);
  }

  if (node.kind === "application_expression") {
    return lower_application(node, source);
  }

  if (node.kind === "positional_product") {
    const entries = node.children.filter((child) => is_expression_node(child))
      .map((child) =>
        lower_expression(child, source).map((value) => ({ value }))
      );
    let lowered_entries: Checked<{ value: FrontExpr }[]> = ok([]);
    for (const entry of entries) {
      lowered_entries = Applicative.lift(
        (
          current: { value: FrontExpr }[],
          next: { value: FrontExpr },
        ) => [...current, next],
        lowered_entries,
        entry,
      );
    }
    return lowered_entries.map((product_entries) => {
      const expression: FrontExpr = {
        tag: "product",
        entries: product_entries,
        value_pack: true,
      };
      mark_source_span(expression, { start: node.start, end: node.end });
      return expression;
    });
  }

  if (node.kind === "block") {
    return lower_block(node, source);
  }

  if (node.kind === "if_expression") {
    return lower_if_expression(node, source);
  }

  if (node.kind === "condition_unary_expression") {
    return lower_condition_unary(node, source);
  }

  if (node.kind === "unary_expression") {
    return lower_unary(node, source);
  }

  if (node.kind === "array_expression") {
    return lower_array_expression(node, source);
  }

  if (node.kind === "shape_value") {
    const block = node.children.find((child) =>
      child.kind === "shape_field_block"
    );
    if (block === undefined) return unsupported(node);
    const names = new Set<string>();
    let entries: Checked<Array<{ label?: string; value: FrontExpr }>> = ok([]);
    for (
      const field of block.children.filter((child) =>
        child.kind === "shape_field" || child.kind === "shorthand_field"
      )
    ) {
      const name_node = field.children.find((child) =>
        child.kind === "identifier" || child.kind === '"end"'
      );
      if (name_node === undefined) return unsupported(field);
      const name = source.slice(name_node.start, name_node.end);
      const field_diagnostics = [];
      if (name !== "end" && !is_snake_case(name)) {
        field_diagnostics.push(
          compiler_diagnostic(
            diagnostic_codes.syntax_error,
            "Shape member must use snake_case: " + name,
            { start: name_node.start, end: name_node.end },
          ),
        );
      }
      if (names.has(name)) {
        field_diagnostics.push(
          compiler_diagnostic(
            diagnostic_codes.syntax_error,
            "Duplicate shape member: " + name,
            { start: name_node.start, end: name_node.end },
          ),
        );
      }
      names.add(name);
      let field_check: Checked<null> = ok(null);
      if (field_diagnostics.length > 0) {
        field_check = fail(...field_diagnostics);
      }
      let lowered_value: Checked<FrontExpr>;
      if (field.kind === "shorthand_field") {
        const value: FrontExpr = { tag: "var", name };
        mark_source_span(value, {
          start: name_node.start,
          end: name_node.end,
        });
        lowered_value = ok(value);
      } else {
        const value_node = field.children.find((child) =>
          child !== name_node && is_expression_node(child)
        );
        if (value_node === undefined) return unsupported(field);
        lowered_value = lower_expression(value_node, source);
      }
      const lowered_entry = Applicative.lift(
        (_field: null, value: FrontExpr) => {
          const entry = { label: name, value };
          mark_source_span(entry, { start: field.start, end: field.end });
          return entry;
        },
        field_check,
        lowered_value,
      );
      entries = Applicative.lift(
        (
          current: Array<{ label?: string; value: FrontExpr }>,
          entry: { label?: string; value: FrontExpr },
        ) => [...current, entry],
        entries,
        lowered_entry,
      );
    }
    return entries.map((lowered_entries) => {
      const expression: FrontExpr = {
        tag: "shape",
        entries: lowered_entries,
      };
      mark_source_span(expression, { start: node.start, end: node.end });
      return expression;
    });
  }

  if (node.kind === "named_product") {
    let entries: Checked<Array<{ label?: string; value: FrontExpr }>> = ok([]);
    for (
      const field of node.children.filter((child) =>
        child.kind === "product_field"
      )
    ) {
      const name_node = field.children.find((child) =>
        child.kind === "identifier" || child.kind === '"end"'
      );
      const value_node = field.children.find((child) =>
        child !== name_node && is_expression_node(child)
      );
      if (name_node === undefined || value_node === undefined) {
        return unsupported(field);
      }
      const name = source.slice(name_node.start, name_node.end);
      let field_check: Checked<null> = ok(null);
      if (name !== "end" && !is_snake_case(name)) {
        field_check = fail(
          compiler_diagnostic(
            diagnostic_codes.syntax_error,
            "Product label must use snake_case: " + name,
            { start: name_node.start, end: name_node.end },
          ),
        );
      }
      const lowered_entry = Applicative.lift(
        (_field: null, value: FrontExpr) => {
          const entry = { label: name, value };
          mark_source_span(entry, { start: field.start, end: field.end });
          return entry;
        },
        field_check,
        lower_expression(value_node, source),
      );
      entries = Applicative.lift(
        (
          current: Array<{ label?: string; value: FrontExpr }>,
          entry: { label?: string; value: FrontExpr },
        ) => [...current, entry],
        entries,
        lowered_entry,
      );
    }
    return entries.map((lowered_entries) => {
      const expression: FrontExpr = {
        tag: "product",
        entries: lowered_entries,
      };
      mark_source_span(expression, { start: node.start, end: node.end });
      return expression;
    });
  }

  if (node.kind === "index_expression") {
    return lower_index_expression(node, source);
  }

  if (
    node.kind === "field_expression" ||
    node.kind === "condition_field_expression"
  ) {
    const object_node = node.children.find((child) =>
      is_expression_node(child)
    );
    const field_node = node.children.find((child) =>
      child.kind === "identifier" || child.kind === '"end"'
    );
    if (object_node === undefined || field_node === undefined) {
      return unsupported(node);
    }
    return lower_expression(object_node, source).map((object) => {
      const expression: FrontExpr = {
        tag: "field",
        object,
        name: source.slice(field_node.start, field_node.end),
      };
      mark_source_span(expression, { start: node.start, end: node.end });
      return expression;
    });
  }

  if (node.kind === "import_expression") {
    return lower_import_expression(node, source);
  }

  if (node.kind === "union_case") {
    return lower_union_case(node, source);
  }

  if (node.kind === "loop_expression") {
    return lower_loop_expression(node, source);
  }

  return unsupported(node);
}

function lower_block(
  node: BabaCstNode,
  source: string,
): Checked<FrontExpr> {
  const statement_nodes = node.children.filter((child) =>
    child.kind !== '"do"' && child.kind !== '"end"'
  );
  return lower_statement_sequence(statement_nodes, source).map(
    (statements) => {
      const expression: FrontExpr = {
        tag: "block",
        statements: finalize_block_statements(statements),
      };
      mark_source_span(expression, { start: node.start, end: node.end });
      return expression;
    },
  );
}

function finalize_block_statements(statements: readonly Stmt[]): Stmt[] {
  const block_statements = [...statements];
  const final_statement = block_statements[block_statements.length - 1];
  if (
    final_statement === undefined || final_statement.tag !== "if_stmt" ||
    final_statement.body[final_statement.body.length - 1]?.tag !== "expr"
  ) {
    return block_statements;
  }
  const statement_span = source_span(final_statement);
  const then_branch: FrontExpr = {
    tag: "block",
    statements: final_statement.body,
  };
  const branch_span = conditional_branch_spans.get(final_statement);
  if (branch_span !== undefined) {
    mark_source_span(then_branch, branch_span);
  }
  const conditional: FrontExpr = {
    tag: "if",
    cond: final_statement.cond,
    then_branch,
    else_branch: { tag: "num", type: "i32", value: 0 },
    implicit_else: true,
  };
  mark_source_span(conditional, statement_span);
  const conditional_statement: Stmt = {
    tag: "expr",
    expr: conditional,
  };
  mark_source_span(conditional_statement, statement_span);
  block_statements[block_statements.length - 1] = conditional_statement;
  return block_statements;
}

function lower_if_expression(
  node: BabaCstNode,
  source: string,
): Checked<FrontExpr> {
  if (has_direct_token(node, source, "let")) return unsupported(node);
  const condition_node = node.children.find((child) =>
    child.kind === "condition_expression"
  );
  const branch_node = node.children.find((child) =>
    child.kind === "conditional_branch"
  );
  if (condition_node === undefined || branch_node === undefined) {
    return unsupported(node);
  }

  const alternatives = node.children.filter((child) =>
    child.kind === "else_if_clause" || child.kind === "else_clause"
  );
  const end_token = [...node.children].reverse().find((child) =>
    source.slice(child.start, child.end) === "end"
  );
  if (end_token === undefined) return unsupported(node);
  let else_branch: Checked<FrontExpr> = ok({
    tag: "num",
    type: "i32",
    value: 0,
  });
  let implicit_else = true;
  for (let index = alternatives.length - 1; index >= 0; index -= 1) {
    const alternative = alternatives[index];
    expect(alternative !== undefined, "Missing Baba conditional alternative.");
    if (alternative.kind === "else_clause") {
      const alternative_branch = alternative.children.find((child) =>
        child.kind === "conditional_branch"
      );
      if (alternative_branch === undefined) return unsupported(alternative);
      const next_alternative = alternatives[index + 1];
      let branch_end = end_token.start;
      if (next_alternative !== undefined) {
        branch_end = next_alternative.start;
      }
      else_branch = lower_conditional_branch(
        alternative_branch,
        source,
        conditional_branch_span(
          alternative,
          alternative_branch,
          source,
          branch_end,
        ),
      );
      implicit_else = false;
      continue;
    }

    if (has_direct_token(alternative, source, "let")) {
      return unsupported(alternative);
    }
    const alternative_condition = alternative.children.find((child) =>
      is_expression_node(child)
    );
    const alternative_branch = alternative.children.find((child) =>
      child.kind === "conditional_branch"
    );
    if (
      alternative_condition === undefined || alternative_branch === undefined
    ) {
      return unsupported(alternative);
    }
    const alternative_has_implicit_else = implicit_else;
    const next_alternative = alternatives[index + 1];
    let branch_end = end_token.start;
    if (next_alternative !== undefined) {
      branch_end = next_alternative.start;
    }
    else_branch = Applicative.lift(
      (
        cond: FrontExpr,
        then_branch: FrontExpr,
        nested_else: FrontExpr,
      ) => {
        const expression: Extract<FrontExpr, { tag: "if" }> = {
          tag: "if",
          cond,
          then_branch,
          else_branch: nested_else,
        };
        if (alternative_has_implicit_else) {
          expression.implicit_else = true;
        }
        return expression;
      },
      lower_expression(alternative_condition, source),
      lower_conditional_branch(
        alternative_branch,
        source,
        conditional_branch_span(
          alternative,
          alternative_branch,
          source,
          branch_end,
        ),
      ),
      else_branch,
    );
    implicit_else = false;
  }

  return Applicative.lift(
    (
      cond: FrontExpr,
      then_branch: FrontExpr,
      lowered_else: FrontExpr,
    ) => {
      const expression: Extract<FrontExpr, { tag: "if" }> = {
        tag: "if",
        cond,
        then_branch,
        else_branch: lowered_else,
      };
      if (implicit_else) expression.implicit_else = true;
      mark_source_span(expression, { start: node.start, end: node.end });
      return expression;
    },
    lower_expression(condition_node, source),
    lower_conditional_branch(
      branch_node,
      source,
      conditional_branch_span(
        node,
        branch_node,
        source,
        alternatives[0]?.start,
      ),
    ),
    else_branch,
  );
}

function conditional_branch_span(
  parent: BabaCstNode,
  branch: BabaCstNode,
  source: string,
  explicit_end?: number,
): SourceSpan {
  const branch_index = parent.children.indexOf(branch);
  const previous = parent.children[branch_index - 1];
  expect(previous !== undefined, "Baba conditional branch has no introducer.");
  let end = explicit_end;
  if (end === undefined) {
    const next = parent.children[branch_index + 1];
    expect(next !== undefined, "Baba conditional branch has no terminator.");
    end = next.start;
  }
  const introducer = source.slice(previous.start, previous.end);
  expect(
    introducer === "then" || introducer === "else",
    "Baba conditional branch has an invalid introducer.",
  );
  return { start: previous.end, end };
}

function has_direct_token(
  node: BabaCstNode,
  source: string,
  token: string,
): boolean {
  return node.children.some((child) =>
    source.slice(child.start, child.end) === token
  );
}

function lower_condition_unary(
  node: BabaCstNode,
  source: string,
): Checked<FrontExpr> {
  return lower_unary(node, source);
}

function lower_unary(
  node: BabaCstNode,
  source: string,
): Checked<FrontExpr> {
  const value_node = node.children.find((child) => is_expression_node(child));
  const operator_node = node.children.find((child) =>
    !is_expression_node(child)
  );
  if (value_node === undefined || operator_node === undefined) {
    return unsupported(node);
  }
  const operator = source.slice(operator_node.start, operator_node.end);
  if (
    operator !== "!" && operator !== "-" && operator !== "&" &&
    operator !== "freeze" && operator !== "comptime"
  ) {
    return unsupported(operator_node);
  }
  if (operator === "-") {
    const literal_node = unwrapped_numeric_literal(value_node);
    let unsigned: RegExpMatchArray | null = null;
    if (literal_node !== undefined) {
      unsigned = source.slice(literal_node.start, literal_node.end).match(
        /u(\d+)$/,
      );
    }
    if (unsigned !== null) {
      const width = unsigned[1];
      expect(width !== undefined, "Unsigned Baba literal lost its width.");
      return fail(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          `Unsigned U${width} literal cannot be negated.`,
          { start: node.start, end: node.end },
        ),
      );
    }
  }
  const lowered_value = lower_expression(value_node, source);
  const value = checked_value(lowered_value);
  if (value === undefined) return fail(...diagnostics_of(lowered_value));

  let expression: FrontExpr;
  if (operator === "!") {
    expression = {
      tag: "if",
      cond: value,
      then_branch: { tag: "bool", value: false },
      else_branch: { tag: "bool", value: true },
    };
  } else if (operator === "-") {
    if (value.tag === "num") {
      if (value.type === "i32" || value.type === "i64") {
        const negated = -value.value;
        if (value.integer !== undefined) {
          let integer_value: bigint;
          if (typeof negated === "bigint") {
            integer_value = negated;
          } else {
            integer_value = BigInt(negated);
          }
          if (!integer_literal_fits(value.integer, integer_value)) {
            return fail(
              compiler_diagnostic(
                diagnostic_codes.syntax_error,
                "Integer literal " + integer_value.toString() +
                  " is out of range for " +
                  integer_type_name(value.integer),
                { start: node.start, end: node.end },
              ),
            );
          }
        }
        expression = {
          ...value,
          value: negated,
          integer: value.integer,
        };
      } else {
        expression = { ...value, value: -value.value };
      }
    } else {
      const type = numeric_expr_type(value);
      let zero: FrontExpr = { tag: "num", type: "i32", value: 0 };
      if (type === "i64") {
        zero = { tag: "num", type: "i64", value: 0n };
      } else if (type === "f32") {
        zero = { tag: "num", type: "f32", value: 0 };
      } else if (type === "f64") {
        zero = { tag: "num", type: "f64", value: 0 };
      }
      const prim = binary_prim("-", zero, value);
      expect(prim !== undefined, "Numeric negation has no subtraction.");
      expression = {
        tag: "prim",
        prim,
        left: zero,
        right: value,
      };
    }
  } else if (operator === "&") {
    expression = { tag: "borrow", value };
  } else if (operator === "freeze") {
    expression = { tag: "freeze", value };
  } else {
    expression = { tag: "comptime", expr: value };
  }
  mark_source_span(expression, { start: node.start, end: node.end });
  return ok(expression);
}

function unwrapped_numeric_literal(
  node: BabaCstNode,
): BabaCstNode | undefined {
  let current = node;
  while (
    current.kind === "postfix_expression" ||
    current.kind === "parenthesized_expression" ||
    current.kind === "parenthesized_or_product"
  ) {
    const child = semantic_child(current);
    if (child === undefined) return undefined;
    current = child;
  }
  if (current.kind === "number") return current;
  return undefined;
}

function lower_array_expression(
  node: BabaCstNode,
  source: string,
): Checked<FrontExpr> {
  const spread = node.children.find((child) =>
    child.kind === "array_spread" ||
    child.kind === "_array_spread_with_tail"
  );
  if (spread !== undefined) return unsupported(spread);
  const entries = node.children.filter((child) => is_expression_node(child))
    .map((child) =>
      lower_expression(child, source).map((value) => ({ value }))
    );
  let lowered_entries: Checked<{ value: FrontExpr }[]> = ok([]);
  for (const entry of entries) {
    lowered_entries = Applicative.lift(
      (current: { value: FrontExpr }[], next: { value: FrontExpr }) => [
        ...current,
        next,
      ],
      lowered_entries,
      entry,
    );
  }
  return lowered_entries.map((product_entries) => {
    const expression: FrontExpr = {
      tag: "product",
      entries: product_entries,
    };
    mark_source_span(expression, { start: node.start, end: node.end });
    return expression;
  });
}

function lower_index_expression(
  node: BabaCstNode,
  source: string,
): Checked<FrontExpr> {
  const values = node.children.filter((child) => is_expression_node(child));
  const object_node = values[0];
  const index_node = values[1];
  if (object_node === undefined || index_node === undefined) {
    return unsupported(node);
  }
  return Applicative.lift(
    (object: FrontExpr, index: FrontExpr) => {
      const expression: FrontExpr = { tag: "index", object, index };
      mark_source_span(expression, { start: node.start, end: node.end });
      return expression;
    },
    lower_expression(object_node, source),
    lower_expression(index_node, source),
  );
}

function lower_import_expression(
  node: BabaCstNode,
  source: string,
): Checked<FrontExpr> {
  const path_node = node.children.find((child) => child.kind === "string");
  if (path_node === undefined) return unsupported(node);
  const raw_path = source.slice(path_node.start, path_node.end);
  let path: unknown;
  try {
    path = JSON.parse(raw_path);
  } catch (_error) {
    return unsupported(path_node);
  }
  if (typeof path !== "string") return unsupported(path_node);
  const expression: FrontExpr = { tag: "import", path };
  mark_source_span(expression, { start: node.start, end: node.end });
  return ok(expression);
}

function lower_union_case(
  node: BabaCstNode,
  source: string,
): Checked<FrontExpr> {
  const name_node = node.children.find((child) =>
    child.kind === "constructor_identifier"
  );
  if (name_node === undefined) return unsupported(node);
  const value_node = node.children.find((child) => is_expression_node(child));
  if (value_node === undefined) {
    const expression: FrontExpr = {
      tag: "union_case",
      name: source.slice(name_node.start, name_node.end),
      value: { tag: "unit" },
      type_expr: undefined,
    };
    mark_source_span(expression, { start: node.start, end: node.end });
    return ok(expression);
  }
  return lower_expression(value_node, source).map((value) => {
    const expression: FrontExpr = {
      tag: "union_case",
      name: source.slice(name_node.start, name_node.end),
      value,
      type_expr: undefined,
    };
    mark_source_span(expression, { start: node.start, end: node.end });
    return expression;
  });
}

function lower_loop_expression(
  node: BabaCstNode,
  source: string,
): Checked<FrontExpr> {
  const block_node = node.children.find((child) => child.kind === "block");
  if (block_node === undefined) return unsupported(node);
  return lower_block(block_node, source).map((block) => {
    expect(block.tag === "block", "Baba loop body did not lower to a block.");
    const expression: FrontExpr = { tag: "loop", body: block.statements };
    mark_source_span(expression, { start: node.start, end: node.end });
    return expression;
  });
}

function lower_conditional_branch(
  node: BabaCstNode,
  source: string,
  span: SourceSpan,
): Checked<FrontExpr> {
  return lower_statement_sequence(node.children, source).map(
    (statements) => {
      const expression: FrontExpr = {
        tag: "block",
        statements: finalize_block_statements(statements),
      };
      mark_source_span(expression, span);
      return expression;
    },
  );
}

function lower_binary(
  node: BabaCstNode,
  source: string,
): Checked<FrontExpr> {
  const parts: BinaryPart[] = [];
  if (!collect_binary_parts(node, parts)) return unsupported(node);
  const first = parts[0];
  if (first === undefined || first.tag !== "operand") {
    return unsupported(node);
  }
  const values: Checked<FrontExpr>[] = [
    lower_expression(first.node, source),
  ];
  const operators: BinaryOperator[] = [];
  for (let index = 1; index < parts.length; index += 2) {
    const operator_part = parts[index];
    const operand_part = parts[index + 1];
    if (
      operator_part === undefined || operator_part.tag !== "operator" ||
      operand_part === undefined || operand_part.tag !== "operand"
    ) {
      return unsupported(node);
    }
    const operator = source.slice(
      operator_part.node.start,
      operator_part.node.end,
    );
    const fixity = binary_fixity(operator);
    if (fixity === undefined) return unsupported(operator_part.node);
    while (true) {
      const pending = operators[operators.length - 1];
      if (
        pending === undefined || pending.precedence <= fixity.precedence
      ) {
        break;
      }
      reduce_binary_operator(values, operators);
    }
    const previous = operators[operators.length - 1];
    if (
      previous !== undefined && previous.precedence === fixity.precedence &&
      (previous.associativity === "none" ||
        fixity.associativity === "none" ||
        previous.associativity !== fixity.associativity)
    ) {
      return fail(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Conflicting associativity at precedence " +
            fixity.precedence.toString() + ": " + previous.operator +
            " and " + operator,
          { start: operator_part.node.start, end: operator_part.node.end },
        ),
      );
    }
    while (
      should_reduce_binary_operator(
        operators[operators.length - 1],
        fixity,
      )
    ) {
      reduce_binary_operator(values, operators);
    }
    operators.push({ operator, ...fixity });
    values.push(lower_expression(operand_part.node, source));
  }
  while (operators.length > 0) reduce_binary_operator(values, operators);
  const result = values[0];
  expect(
    result !== undefined && values.length === 1,
    "Baba binary reduction did not produce one expression.",
  );
  return result.map((expression) => {
    mark_source_span(expression, { start: node.start, end: node.end });
    return expression;
  });
}

function should_reduce_binary_operator(
  previous: BinaryOperator | undefined,
  current: Omit<BinaryOperator, "operator">,
): boolean {
  if (previous === undefined) return false;
  if (previous.precedence > current.precedence) return true;
  if (previous.precedence < current.precedence) return false;
  return current.associativity === "left";
}

type BinaryPart =
  | { tag: "operand"; node: BabaCstNode }
  | { tag: "operator"; node: BabaCstNode };

type BinaryOperator = {
  operator: string;
  precedence: number;
  associativity: "left" | "right" | "none";
};

function collect_binary_parts(
  node: BabaCstNode,
  parts: BinaryPart[],
): boolean {
  if (node.kind === "condition_expression") {
    const child = semantic_child(node);
    if (
      child !== undefined &&
      (child.kind === "binary_expression" ||
        child.kind === "condition_binary_expression")
    ) {
      return collect_binary_parts(child, parts);
    }
  }
  if (
    node.kind !== "binary_expression" &&
    node.kind !== "condition_binary_expression"
  ) {
    parts.push({ tag: "operand", node });
    return true;
  }
  const operands = node.children.filter((child) => is_expression_node(child));
  const operator = node.children.find((child) =>
    child.kind === "operator_symbol"
  );
  const left = operands[0];
  const right = operands[1];
  if (left === undefined || right === undefined || operator === undefined) {
    return false;
  }
  if (!collect_binary_parts(left, parts)) return false;
  parts.push({ tag: "operator", node: operator });
  return collect_binary_parts(right, parts);
}

function reduce_binary_operator(
  values: Checked<FrontExpr>[],
  operators: BinaryOperator[],
): void {
  const operator = operators.pop();
  const right = values.pop();
  const left = values.pop();
  expect(
    operator !== undefined && left !== undefined && right !== undefined,
    "Baba binary reduction stack is incomplete.",
  );
  values.push(
    Applicative.lift(
      (left_value: FrontExpr, right_value: FrontExpr) =>
        binary_expression(operator.operator, left_value, right_value),
      left,
      right,
    ),
  );
}

function binary_expression(
  operator: string,
  left: FrontExpr,
  right: FrontExpr,
): FrontExpr {
  const span = {
    start: source_span(left).start,
    end: source_span(right).end,
  };
  let expression: FrontExpr;
  if (operator === "&&") {
    expression = {
      tag: "if",
      cond: left,
      then_branch: truth_expression(right),
      else_branch: { tag: "bool", value: false },
    };
  } else if (operator === "||") {
    expression = {
      tag: "if",
      cond: left,
      then_branch: { tag: "bool", value: true },
      else_branch: truth_expression(right),
    };
  } else {
    const prim = binary_prim(operator, left, right);
    if (prim === undefined) {
      expression = {
        tag: "unsupported",
        feature: "operator " + operator,
        text: operator,
      };
    } else {
      expression = { tag: "prim", prim, left, right };
    }
  }
  mark_source_span(expression, span);
  return expression;
}

function truth_expression(cond: FrontExpr): FrontExpr {
  return {
    tag: "if",
    cond,
    then_branch: { tag: "bool", value: true },
    else_branch: { tag: "bool", value: false },
  };
}

function binary_fixity(
  operator: string,
): Omit<BinaryOperator, "operator"> | undefined {
  if (operator === "||") return { precedence: 20, associativity: "right" };
  if (operator === "&&") return { precedence: 30, associativity: "right" };
  if (
    operator === "==" || operator === "!=" || operator === "<" ||
    operator === "<=" || operator === ">" || operator === ">="
  ) {
    return { precedence: 40, associativity: "none" };
  }
  if (operator === "+" || operator === "-") {
    return { precedence: 60, associativity: "left" };
  }
  if (operator === "*" || operator === "/" || operator === "%") {
    return { precedence: 70, associativity: "left" };
  }
  return undefined;
}

function lower_arrow(
  node: BabaCstNode,
  source: string,
): Checked<FrontExpr> {
  const parameter_nodes: BabaCstNode[] = [];
  const parameter_container = node.children.find((child) =>
    child.kind === "parameter" || child.kind === "parameter_list"
  );
  if (parameter_container === undefined) return unsupported(node);
  let parsed_parameter_nodes = [parameter_container];
  if (parameter_container.kind === "parameter_list") {
    parsed_parameter_nodes = parameter_container.children.filter((child) =>
      child.kind === "parameter"
    );
  }
  let lowered_parameters: Checked<Param[]> = ok([]);
  for (const parameter_node of parsed_parameter_nodes) {
    const name_node = parameter_node.children.find((child) =>
      child.kind === "identifier" || child.kind === "wildcard"
    );
    if (name_node === undefined) return unsupported(parameter_node);
    const type_node = parameter_node.children.find((child) =>
      child.kind === "type_reference"
    );
    const is_const = parameter_node.children.some((child) =>
      source.slice(child.start, child.end) === "const"
    );
    const is_linear = parameter_node.children.some((child) =>
      source.slice(child.start, child.end) === "!"
    );
    const is_variadic = parameter_node.children.some((child) =>
      source.slice(child.start, child.end) === "..."
    );
    const parameter_diagnostics = [];
    if (
      name_node.kind === "identifier" &&
      !is_snake_case(source.slice(name_node.start, name_node.end))
    ) {
      const name = source.slice(name_node.start, name_node.end);
      parameter_diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Parameter must use snake_case: " + name,
          { start: name_node.start, end: name_node.end },
        ),
      );
    }
    if (name_node.kind === "wildcard" && is_linear) {
      parameter_diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Baba semantic lowering does not support linear wildcard parameters.",
          { start: parameter_node.start, end: parameter_node.end },
        ),
      );
    }
    if (name_node.kind === "wildcard" && is_variadic) {
      parameter_diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Variadic parameter requires a binding name",
          { start: parameter_node.start, end: parameter_node.end },
        ),
      );
    }
    let parameter_check: Checked<null> = ok(null);
    if (parameter_diagnostics.length > 0) {
      parameter_check = fail(...parameter_diagnostics);
    }
    let parameter_is_const = is_const;
    if (
      name_node.kind === "wildcard" &&
      parameter_container.kind === "parameter"
    ) {
      parameter_is_const = false;
    }
    for (const child of parameter_node.children) {
      if (
        child === name_node || child === type_node || child.kind === '":"' ||
        source.slice(child.start, child.end) === "const" ||
        source.slice(child.start, child.end) === "!" ||
        source.slice(child.start, child.end) === "..."
      ) {
        continue;
      }
      return unsupported(child);
    }
    let lowered_type: Checked<TypeExpr | undefined> = ok(undefined);
    if (type_node !== undefined) {
      lowered_type = lower_baba_type_reference(type_node, source);
    }
    const lowered_parameter = Applicative.lift(
      (_parameter: null, parsed_type: TypeExpr | undefined) => {
        let annotation: string | undefined;
        let type_annotation: TypeExpr | undefined;
        if (parsed_type !== undefined) {
          annotation = format_type_expr(parsed_type);
          if (parsed_type.tag !== "name") type_annotation = parsed_type;
        }
        let name = source.slice(name_node.start, name_node.end);
        if (name_node.kind === "wildcard") {
          const generated_name = synthetic_parameter_names.get(parameter_node);
          expect(
            generated_name !== undefined,
            "Baba wildcard parameter has no synthetic identity.",
          );
          name = generated_name;
        }
        const parameter: Param = {
          name,
          is_const: parameter_is_const,
          is_linear,
          annotation,
        };
        if (is_variadic) parameter.is_variadic = true;
        if (type_annotation !== undefined) {
          parameter.type_annotation = type_annotation;
        }
        mark_source_span(parameter, {
          start: parameter_node.start,
          end: parameter_node.end,
        });
        return parameter;
      },
      parameter_check,
      lowered_type,
    );
    lowered_parameters = Applicative.lift(
      (parameters: Param[], parameter: Param) => [...parameters, parameter],
      lowered_parameters,
      lowered_parameter,
    );
    parameter_nodes.push(parameter_node);
  }
  const body_node = [...node.children].reverse().find((child) =>
    is_expression_node(child)
  );
  if (body_node === undefined) return unsupported(node);

  return Applicative.lift(
    (parameters: Param[], body: FrontExpr) => {
      let pattern: Pattern;
      if (parameters.length === 0) {
        pattern = { tag: "unit" };
        mark_source_span(pattern, {
          start: parameter_container.start,
          end: parameter_container.end,
        });
      } else if (parameters.length === 1) {
        const parameter = parameters[0];
        const parameter_node = parameter_nodes[0];
        expect(
          parameter !== undefined,
          "Single-parameter Baba lambda lost its parameter.",
        );
        expect(
          parameter_node !== undefined,
          "Single-parameter Baba lambda lost its parameter node.",
        );
        if (
          parameter_node.children.some((child) => child.kind === "wildcard")
        ) {
          let mode: "default" | "const" = "default";
          if (
            parameter_node.children.some((child) =>
              source.slice(child.start, child.end) === "const"
            )
          ) {
            mode = "const";
          }
          pattern = { tag: "wildcard", mode };
        } else {
          pattern = {
            tag: "binding",
            name: parameter.name,
            mode: parameter_mode(parameter),
            annotation: parameter.annotation,
          };
          if (parameter.is_variadic === true) pattern.is_variadic = true;
          if (parameter.type_annotation !== undefined) {
            pattern.type_annotation = parameter.type_annotation;
          }
        }
        mark_source_span(pattern, {
          start: parameter_node.start,
          end: parameter_node.end,
        });
      } else {
        const entries = parameters.map((parameter, index) => {
          const parameter_node = parameter_nodes[index];
          expect(
            parameter_node !== undefined,
            "Baba lambda product pattern lost a parameter node.",
          );
          let entry_pattern: Pattern;
          if (
            parameter_node.children.some((child) => child.kind === "wildcard")
          ) {
            let mode: "default" | "const" = "default";
            if (parameter.is_const) mode = "const";
            entry_pattern = { tag: "wildcard", mode };
          } else {
            const binding: Extract<Pattern, { tag: "binding" }> = {
              tag: "binding",
              name: parameter.name,
              mode: parameter_mode(parameter),
              annotation: parameter.annotation,
            };
            if (parameter.is_variadic === true) binding.is_variadic = true;
            if (parameter.type_annotation !== undefined) {
              binding.type_annotation = parameter.type_annotation;
            }
            entry_pattern = binding;
          }
          mark_source_span(entry_pattern, {
            start: parameter_node.start,
            end: parameter_node.end,
          });
          const entry = { pattern: entry_pattern };
          mark_source_span(entry, {
            start: parameter_container.start,
            end: parameter_container.end,
          });
          return entry;
        });
        pattern = {
          tag: "product",
          entries,
          rest: undefined,
          value_pack: true,
        };
        mark_source_span(pattern, {
          start: parameter_container.start,
          end: parameter_container.end,
        });
      }
      const expression: FrontExpr = {
        tag: "lam",
        pattern,
        params: parameters,
        body,
      };
      mark_source_span(expression, { start: node.start, end: node.end });
      return expression;
    },
    lowered_parameters,
    lower_expression(body_node, source),
  );
}

function parameter_mode(parameter: Param): "default" | "const" | "linear" {
  if (parameter.is_const) return "const";
  if (parameter.is_linear) return "linear";
  return "default";
}

function lower_application(
  node: BabaCstNode,
  source: string,
): Checked<FrontExpr> {
  const expression_nodes = node.children.filter((child) =>
    is_expression_node(child)
  );
  const function_node = expression_nodes[0];
  const argument_node = expression_nodes[1];
  if (function_node === undefined || argument_node === undefined) {
    return unsupported(node);
  }
  return Applicative.lift(
    (func: FrontExpr, arg: FrontExpr) => {
      let args = [arg];
      if (arg.tag === "unit") args = [];
      if (arg.tag === "product" && arg.value_pack === true) {
        args = arg.entries.map((entry) => entry.value);
      }
      const expression: FrontExpr = {
        tag: "app",
        func,
        arg,
        args,
      };
      mark_source_span(expression, { start: node.start, end: node.end });
      return expression;
    },
    lower_expression(function_node, source),
    lower_expression(argument_node, source),
  );
}

function semantic_child(node: BabaCstNode): BabaCstNode | undefined {
  return node.children.find((child) => is_expression_node(child));
}

function is_expression_node(node: BabaCstNode): boolean {
  return node.kind === "postfix_expression" ||
    node.kind === "parenthesized_expression" ||
    node.kind === "parenthesized_or_product" ||
    node.kind === "condition_expression" ||
    node.kind === "identifier" ||
    node.kind === "intrinsic_identifier" ||
    node.kind === "number" ||
    node.kind === "boolean" ||
    node.kind === "string" ||
    node.kind === "character" ||
    node.kind === "atom_expression" ||
    node.kind === "linear_reference" ||
    node.kind === "unit_pattern" ||
    node.kind === "binary_expression" ||
    node.kind === "condition_binary_expression" ||
    node.kind === "arrow_function" ||
    node.kind === "application_expression" ||
    node.kind === "positional_product" ||
    node.kind === "block" ||
    node.kind === "if_expression" ||
    node.kind === "condition_unary_expression" ||
    node.kind === "unary_expression" ||
    node.kind === "array_expression" ||
    node.kind === "shape_value" ||
    node.kind === "named_product" ||
    node.kind === "index_expression" ||
    node.kind === "field_expression" ||
    node.kind === "condition_field_expression" ||
    node.kind === "import_expression" ||
    node.kind === "union_case" ||
    node.kind === "loop_expression";
}

function unsupported(node: BabaCstNode): Checked<never> {
  return fail(
    compiler_diagnostic(
      diagnostic_codes.syntax_error,
      `Baba semantic lowering does not support ${node.kind}.`,
      { start: node.start, end: node.end },
    ),
  );
}
