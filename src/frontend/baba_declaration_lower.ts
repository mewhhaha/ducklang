import { Applicative } from "@mewhhaha/typeclasses";
import { compiler_diagnostic, diagnostic_codes } from "../diagnostic.ts";
import { expect } from "../expect.ts";
import { classify_abi_primitive } from "../abi_primitive.ts";
import type {
  ArrayLengthExpr,
  Declaration,
  EffectOperation,
  EffectParam,
  EffectResult,
  FrontExpr,
  RecordDeclaration,
  TypeDeclaration,
  TypeExpr,
  TypeField,
} from "./ast.ts";
import type { EffectRowExpr } from "../type_syntax.ts";
import type { BabaCstNode } from "./baba_parser.ts";
import { lower_baba_type_reference } from "./baba_type_lower.ts";
import {
  type Checked,
  checked_value,
  diagnostics_of,
  fail,
  ok,
} from "./checked.ts";
import { is_effect_scalar_type } from "./effect_operation.ts";
import { is_snake_case } from "./names.ts";
import {
  is_builtin_type_reference_name,
  unsupported_reserved_feature,
} from "./parser_support.ts";
import { mark_source_span, source_span, type SourceSpan } from "./syntax.ts";
import { format_type_expr } from "./type_expr.ts";

type LoweredTypeDeclarationBody = {
  body: TypeDeclaration["body"];
  recursive: boolean;
};

export type BabaEffectTypeContext = {
  representations: ReadonlyMap<string, "scalar" | "rich" | "unknown">;
  definitions: ReadonlyMap<string, readonly TypeExpr[]>;
  arities: ReadonlyMap<string, number>;
  parameters: ReadonlyMap<string, readonly string[]>;
  effects: ReadonlyMap<string, "host" | "duck">;
};

export function lower_baba_type_declaration(
  node: BabaCstNode,
  source: string,
): Checked<Declaration> {
  const names = node.children.filter((child) => child.kind === "identifier");
  const name_node = names[0];
  if (name_node === undefined) return unsupported_declaration(node);
  const name = source.slice(name_node.start, name_node.end);
  const param_nodes = names.slice(1);
  const params = param_nodes.map((parameter) =>
    source.slice(parameter.start, parameter.end)
  );
  const declaration_diagnostics = [];
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) {
    declaration_diagnostics.push(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        "Type name must use PascalCase: " + name,
        { start: name_node.start, end: name_node.end },
      ),
    );
  }
  if (is_builtin_type_reference_name(name)) {
    declaration_diagnostics.push(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        "Type declaration conflicts with builtin type: " + name,
        { start: name_node.start, end: name_node.end },
      ),
    );
  }
  const seen_params = new Set<string>();
  for (let index = 0; index < params.length; index += 1) {
    const param = params[index];
    const param_node = param_nodes[index];
    expect(
      param !== undefined && param_node !== undefined,
      "Baba declaration parameter lost its source node.",
    );
    if (!is_snake_case(param)) {
      declaration_diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Type parameter must use snake_case: " + param,
          { start: param_node.start, end: param_node.end },
        ),
      );
    }
    const reserved_feature = unsupported_reserved_feature(param);
    if (reserved_feature !== undefined) {
      declaration_diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Type parameter is reserved for unsupported " + reserved_feature +
            ": " + param,
          { start: param_node.start, end: param_node.end },
        ),
      );
    }
    if (seen_params.has(param)) {
      declaration_diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Duplicate type parameter: " + param,
          { start: param_node.start, end: param_node.end },
        ),
      );
    }
    seen_params.add(param);
  }
  let declaration_check: Checked<null> = ok(null);
  if (declaration_diagnostics.length > 0) {
    declaration_check = fail(...declaration_diagnostics);
  }
  const definition = node.children.find((child) =>
    child.kind === "type_sum" || child.kind === "type_product" ||
    child.kind === "struct_type" || child.kind === "newtype_type" ||
    child.kind === "packed_type" || child.kind === "type_reference"
  );
  if (definition === undefined) return unsupported_declaration(node);

  let lowered_body: Checked<LoweredTypeDeclarationBody>;
  if (definition.kind === "type_sum") {
    lowered_body = lower_sum_body(definition, source, name);
  } else if (definition.kind === "struct_type") {
    lowered_body = lower_struct_body(definition, source, name);
  } else if (definition.kind === "packed_type") {
    lowered_body = lower_packed_body(definition, source, name);
  } else if (
    definition.kind === "type_product" &&
    source.slice(definition.start, definition.start + 1) === "["
  ) {
    lowered_body = lower_product_body(definition, source, "product", name);
  } else {
    lowered_body = lower_alias_body(definition, source, name);
  }

  return Applicative.lift(
    (_declaration: null, body: LoweredTypeDeclarationBody) => {
      const declaration: Declaration = {
        tag: "type",
        name,
        params,
        body: body.body,
        recursive: body.recursive,
      };
      mark_source_span(declaration, { start: node.start, end: node.end });
      return declaration;
    },
    declaration_check,
    lowered_body,
  );
}

export function lower_baba_record_declaration(
  node: BabaCstNode,
  source: string,
): Checked<Declaration> {
  const name_node = node.children.find((child) => child.kind === "identifier");
  const field_block = node.children.find((child) =>
    child.kind === "type_field_block"
  );
  if (name_node === undefined || field_block === undefined) {
    return unsupported_declaration(node);
  }
  const name = source.slice(name_node.start, name_node.end);
  let declaration_check: Checked<null> = ok(null);
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) {
    declaration_check = fail(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        "Record declaration must use PascalCase: " + name,
        { start: name_node.start, end: name_node.end },
      ),
    );
  } else if (is_builtin_type_reference_name(name)) {
    declaration_check = fail(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        "Record declaration conflicts with builtin type: " + name,
        { start: name_node.start, end: name_node.end },
      ),
    );
  }
  const names = new Set<string>();
  let lowered_fields: Checked<TypeField[]> = ok([]);
  for (
    const field_node of field_block.children.filter((child) =>
      child.kind === "type_field"
    )
  ) {
    const field_name_node = field_node.children.find((child) =>
      child.kind === "identifier"
    );
    const type_node = field_node.children.find((child) =>
      child.kind === "type_reference"
    );
    if (field_name_node === undefined || type_node === undefined) {
      return unsupported_declaration(field_node);
    }
    const field_name = source.slice(
      field_name_node.start,
      field_name_node.end,
    );
    const field_diagnostics = [];
    if (!is_snake_case(field_name)) {
      field_diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Type field must use snake_case: " + field_name,
          { start: field_name_node.start, end: field_name_node.end },
        ),
      );
    }
    if (names.has(field_name)) {
      field_diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Duplicate type field: " + field_name,
          { start: field_name_node.start, end: field_name_node.end },
        ),
      );
    }
    names.add(field_name);
    let field_check: Checked<null> = ok(null);
    if (field_diagnostics.length > 0) {
      field_check = fail(...field_diagnostics);
    }
    const lowered_field = Applicative.lift(
      (_field: null, type: TypeExpr) => {
        const field: TypeField = {
          name: field_name,
          type_name: format_type_expr(type),
        };
        mark_source_span(field, {
          start: field_node.start,
          end: field_node.end,
        });
        return field;
      },
      field_check,
      lower_baba_type_reference(type_node, source),
    );
    lowered_fields = Applicative.lift(
      (fields: TypeField[], field: TypeField) => [...fields, field],
      lowered_fields,
      lowered_field,
    );
  }
  return Applicative.lift(
    (_declaration: null, fields: TypeField[]) => {
      const declaration: RecordDeclaration = { tag: "record", name, fields };
      mark_source_span(declaration, { start: node.start, end: node.end });
      return declaration;
    },
    declaration_check,
    lowered_fields,
  );
}

export function lower_baba_effect_declaration(
  node: BabaCstNode,
  source: string,
  type_context: BabaEffectTypeContext,
): Checked<Declaration> {
  let implementation: "host" | "duck" = "duck";
  if (node.kind === "declare_effect_statement") implementation = "host";
  const name_node = node.children.find((child) =>
    child.kind === "effect_identifier"
  );
  const operation_block = node.children.find((child) =>
    child.kind === "effect_operation_block"
  );
  if (name_node === undefined || operation_block === undefined) {
    return unsupported_declaration(node);
  }
  const name = source.slice(name_node.start, name_node.end);
  const parameter_nodes = node.children.filter((child) =>
    child.kind === "identifier"
  );
  const params = parameter_nodes.map((parameter) =>
    source.slice(parameter.start, parameter.end)
  );
  const declaration_diagnostics = [];
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) {
    declaration_diagnostics.push(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        "Effect declaration must use PascalCase: " + name,
        { start: name_node.start, end: name_node.end },
      ),
    );
  }
  if (is_builtin_type_reference_name(name)) {
    declaration_diagnostics.push(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        "Effect declaration conflicts with builtin type: " + name,
        { start: name_node.start, end: name_node.end },
      ),
    );
  }
  const seen_params = new Set<string>();
  for (let index = 0; index < params.length; index += 1) {
    const param = params[index];
    const parameter_node = parameter_nodes[index];
    expect(
      param !== undefined && parameter_node !== undefined,
      "Baba effect parameter lost its source node.",
    );
    if (!is_snake_case(param)) {
      declaration_diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Effect type parameter must use snake_case: " + param,
          { start: parameter_node.start, end: parameter_node.end },
        ),
      );
    }
    const reserved_feature = unsupported_reserved_feature(param);
    if (reserved_feature !== undefined) {
      declaration_diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Effect type parameter is reserved for unsupported " +
            reserved_feature + ": " + param,
          { start: parameter_node.start, end: parameter_node.end },
        ),
      );
    }
    if (seen_params.has(param)) {
      declaration_diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Duplicate effect type parameter: " + param,
          { start: parameter_node.start, end: parameter_node.end },
        ),
      );
    }
    seen_params.add(param);
  }
  if (implementation === "host" && params.length > 0) {
    declaration_diagnostics.push(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        "Host effects require concrete ABI types",
        { start: name_node.start, end: operation_block.start },
      ),
    );
  }
  let declaration_check: Checked<null> = ok(null);
  if (declaration_diagnostics.length > 0) {
    declaration_check = fail(...declaration_diagnostics);
  }
  let lowered_operations: Checked<EffectOperation[]> = ok([]);
  const operation_names = new Map<string, BabaCstNode>();
  for (
    const operation_node of operation_block.children.filter((child) =>
      child.kind === "effect_operation"
    )
  ) {
    let lowered_operation = lower_effect_operation(
      operation_node,
      source,
      implementation,
      new Set(params),
      type_context,
    );
    const operation_name_node = operation_node.children.find((child) =>
      child.kind === "identifier"
    );
    if (operation_name_node === undefined) {
      return unsupported_declaration(operation_node);
    }
    const operation_name = source.slice(
      operation_name_node.start,
      operation_name_node.end,
    );
    const previous_operation = operation_names.get(operation_name);
    if (previous_operation !== undefined) {
      lowered_operation = Applicative.lift(
        (_duplicate: null, operation: EffectOperation) => operation,
        fail(
          compiler_diagnostic(
            diagnostic_codes.syntax_error,
            "Duplicate effect operation: " + operation_name,
            {
              start: operation_name_node.start,
              end: operation_name_node.end,
            },
            [{
              message: "First effect operation is here.",
              span: {
                start: previous_operation.start,
                end: previous_operation.end,
              },
            }],
          ),
        ),
        lowered_operation,
      );
    } else {
      operation_names.set(operation_name, operation_name_node);
    }
    lowered_operations = Applicative.lift(
      (
        operations: EffectOperation[],
        operation: EffectOperation,
      ) => [...operations, operation],
      lowered_operations,
      lowered_operation,
    );
  }
  return Applicative.lift(
    (_declaration: null, operations: EffectOperation[]) => {
      const declaration: Extract<Declaration, { tag: "effect" }> = {
        tag: "effect",
        implementation,
        name,
        params,
        operations,
      };
      mark_source_span(declaration, { start: node.start, end: node.end });
      return declaration;
    },
    declaration_check,
    lowered_operations,
  );
}

function lower_effect_operation(
  node: BabaCstNode,
  source: string,
  implementation: "host" | "duck",
  effect_params: ReadonlySet<string>,
  type_context: BabaEffectTypeContext,
): Checked<EffectOperation> {
  const name_node = node.children.find((child) => child.kind === "identifier");
  const parameter_list = node.children.find((child) =>
    child.kind === "host_parameter_list"
  );
  const result_node = node.children.find((child) =>
    child.kind === "host_result"
  );
  if (
    name_node === undefined || parameter_list === undefined ||
    result_node === undefined
  ) {
    return unsupported_declaration(node);
  }
  const name = source.slice(name_node.start, name_node.end);
  const forall_node = node.children.find((child) =>
    child.kind === "effect_operation_forall"
  );
  const type_param_nodes = forall_node?.children.filter((child) =>
    child.kind === "identifier"
  );
  const type_params = (type_param_nodes || []).map((parameter) =>
    source.slice(parameter.start, parameter.end)
  );
  const operation_diagnostics = [];
  if (!is_snake_case(name)) {
    operation_diagnostics.push(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        "Effect operation must use snake_case: " + name,
        { start: name_node.start, end: name_node.end },
      ),
    );
  }
  const reserved_operation_feature = unsupported_reserved_feature(name);
  if (reserved_operation_feature !== undefined) {
    operation_diagnostics.push(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        "Effect operation is reserved for unsupported " +
          reserved_operation_feature + ": " + name,
        { start: name_node.start, end: name_node.end },
      ),
    );
  }
  if (implementation === "host" && type_params.length > 0) {
    expect(
      forall_node !== undefined,
      "Baba host generic operation lost its forall node.",
    );
    operation_diagnostics.push(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        "Host effect operations require concrete ABI types",
        { start: forall_node.start, end: forall_node.end },
      ),
    );
  }
  const seen_type_params = new Set<string>();
  for (let index = 0; index < type_params.length; index += 1) {
    const param = type_params[index];
    const type_param_node = type_param_nodes?.[index];
    expect(
      param !== undefined && type_param_node !== undefined,
      "Baba effect operation parameter lost its source node.",
    );
    if (!is_snake_case(param)) {
      operation_diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Effect operation type parameter must use snake_case: " + param,
          { start: type_param_node.start, end: type_param_node.end },
        ),
      );
    }
    const reserved_feature = unsupported_reserved_feature(param);
    if (reserved_feature !== undefined) {
      operation_diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Effect operation type parameter is reserved for unsupported " +
            reserved_feature + ": " + param,
          { start: type_param_node.start, end: type_param_node.end },
        ),
      );
    }
    if (seen_type_params.has(param)) {
      operation_diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Duplicate effect operation type parameter: " + param,
          { start: type_param_node.start, end: type_param_node.end },
        ),
      );
    }
    if (effect_params.has(param)) {
      operation_diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Effect operation type parameter shadows effect parameter: " +
            param,
          { start: type_param_node.start, end: type_param_node.end },
        ),
      );
    }
    seen_type_params.add(param);
  }
  let operation_check: Checked<null> = ok(null);
  if (operation_diagnostics.length > 0) {
    operation_check = fail(...operation_diagnostics);
  }
  let lowered_params: Checked<EffectParam[]> = ok([]);
  for (
    const parameter_node of parameter_list.children.filter((child) =>
      child.kind === "host_parameter"
    )
  ) {
    const type_node = parameter_node.children.find((child) =>
      child.kind === "type_reference"
    );
    if (type_node === undefined) return unsupported_declaration(parameter_node);
    const leading_ownership_markers = leading_effect_ownership_markers(
      parameter_node,
      source,
    );
    const ownership_marker = parameter_node.children.find((child) => {
      const text = source.slice(child.start, child.end);
      return text === "&" || text === "#" || text === "scalar";
    });
    let ownership_text: string | undefined;
    if (ownership_marker !== undefined) {
      ownership_text = source.slice(
        ownership_marker.start,
        ownership_marker.end,
      );
    }
    const lowered_type = lower_baba_type_reference(type_node, source);
    const parsed_type = checked_value(lowered_type);
    let nested_ownership_span: SourceSpan | undefined;
    if (
      parsed_type?.tag === "borrow" || parsed_type?.tag === "frozen"
    ) {
      nested_ownership_span = qualified_type_marker_span(
        type_node,
        source,
        parsed_type,
      );
    }
    let embedded_ownership_span: SourceSpan | undefined;
    if (
      parsed_type?.tag === "borrow" || parsed_type?.tag === "frozen"
    ) {
      embedded_ownership_span = nested_qualified_type_marker_span(
        type_node,
        source,
        parsed_type,
      );
    }
    let ownership_check: Checked<null> = ok(null);
    const has_stacked_ownership = leading_ownership_markers.length > 1;
    const parenthesized_scalar_span = leading_ownership_markers.find(
      (span) =>
        ownership_marker === undefined &&
        source.slice(span.start, span.end) === "scalar",
    );
    const has_ownership_conflict = has_stacked_ownership ||
      parenthesized_scalar_span !== undefined ||
      (ownership_marker !== undefined &&
        nested_ownership_span !== undefined) ||
      (embedded_ownership_span !== undefined &&
        nested_ownership_span !== undefined);
    if (has_stacked_ownership) {
      const outer_marker = leading_ownership_markers[0];
      const inner_marker = leading_ownership_markers[1];
      expect(
        outer_marker !== undefined && inner_marker !== undefined,
        "Stacked Baba ownership markers lost their source spans.",
      );
      ownership_check = fail(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Effect parameter cannot combine ownership qualifiers",
          inner_marker,
          [{
            message: "Outer ownership qualifier is here.",
            span: outer_marker,
          }],
        ),
      );
    } else if (parenthesized_scalar_span !== undefined) {
      ownership_check = fail(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Effect parameter scalar ownership must precede its parentheses",
          parenthesized_scalar_span,
        ),
      );
    } else if (
      ownership_marker !== undefined &&
      nested_ownership_span !== undefined
    ) {
      ownership_check = fail(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Effect parameter cannot combine ownership qualifiers",
          nested_ownership_span,
          [{
            message: "Outer ownership qualifier is here.",
            span: {
              start: ownership_marker.start,
              end: ownership_marker.end,
            },
          }],
        ),
      );
    } else if (
      embedded_ownership_span !== undefined &&
      nested_ownership_span !== undefined
    ) {
      ownership_check = fail(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Effect parameter cannot combine ownership qualifiers",
          embedded_ownership_span,
          [{
            message: "Outer ownership qualifier is here.",
            span: nested_ownership_span,
          }],
        ),
      );
    }
    if (parsed_type !== undefined && !has_ownership_conflict) {
      ownership_check = Applicative.lift(
        (_ownership: null, _representation: null) => null,
        ownership_check,
        check_effect_ownership_representation(
          ownership_marker,
          ownership_text,
          type_node,
          parsed_type,
          source,
          "parameter",
          type_context,
        ),
      );
    }
    if (
      parsed_type !== undefined && implementation === "host" &&
      !has_ownership_conflict
    ) {
      ownership_check = Applicative.lift(
        (_ownership: null, _abi: null) => null,
        ownership_check,
        check_host_effect_abi_type(parsed_type, type_context, new Map()),
      );
    }
    const lowered_param = Applicative.lift(
      (_ownership: null, type: TypeExpr) => {
        let type_name = format_type_expr(type);
        let ownership: EffectParam["ownership"] = "ownership_transfer";
        if (ownership_text === "&") {
          ownership = "bounded_borrow";
        } else if (ownership_text === "#") {
          ownership = "frozen_shareable";
        } else if (ownership_text === "scalar") {
          ownership = "scalar";
        } else if (type.tag === "borrow") {
          type_name = format_type_expr(type.value);
          ownership = "bounded_borrow";
        } else if (type.tag === "frozen") {
          type_name = format_type_expr(type.value);
          ownership = "frozen_shareable";
        } else if (is_effect_scalar_type(type_name)) {
          ownership = "scalar";
        }
        const parameter: EffectParam = { type_name, ownership };
        mark_source_span(parameter, {
          start: parameter_node.start,
          end: parameter_node.end,
        });
        return parameter;
      },
      ownership_check,
      lowered_type,
    );
    lowered_params = Applicative.lift(
      (params: EffectParam[], parameter: EffectParam) => [
        ...params,
        parameter,
      ],
      lowered_params,
      lowered_param,
    );
  }
  const result_type_node = result_node.children.find((child) =>
    child.kind === "type_reference"
  );
  if (result_type_node === undefined) {
    return unsupported_declaration(
      result_node,
    );
  }
  const leading_result_ownership_markers = leading_effect_ownership_markers(
    result_node,
    source,
  );
  let result_check: Checked<null> = ok(null);
  const result_ownership_marker = result_node.children.find((child) => {
    const text = source.slice(child.start, child.end);
    return text === "&" || text === "#" || text === "scalar";
  });
  let result_ownership_text: string | undefined;
  if (result_ownership_marker !== undefined) {
    result_ownership_text = source.slice(
      result_ownership_marker.start,
      result_ownership_marker.end,
    );
  }
  const lowered_result_type = lower_baba_type_reference(
    result_type_node,
    source,
  );
  const parsed_result_type = checked_value(lowered_result_type);
  let nested_result_ownership_span: SourceSpan | undefined;
  if (
    parsed_result_type?.tag === "borrow" ||
    parsed_result_type?.tag === "frozen"
  ) {
    nested_result_ownership_span = qualified_type_marker_span(
      result_type_node,
      source,
      parsed_result_type,
    );
  }
  let embedded_result_ownership_span: SourceSpan | undefined;
  if (
    parsed_result_type?.tag === "borrow" ||
    parsed_result_type?.tag === "frozen"
  ) {
    embedded_result_ownership_span = nested_qualified_type_marker_span(
      result_type_node,
      source,
      parsed_result_type,
    );
  }
  const has_stacked_result_ownership =
    leading_result_ownership_markers.length > 1;
  const parenthesized_result_scalar_span = leading_result_ownership_markers
    .find(
      (span) =>
        result_ownership_marker === undefined &&
        source.slice(span.start, span.end) === "scalar",
    );
  const has_result_ownership_conflict = has_stacked_result_ownership ||
    parenthesized_result_scalar_span !== undefined ||
    (result_ownership_marker !== undefined &&
      nested_result_ownership_span !== undefined) ||
    (embedded_result_ownership_span !== undefined &&
      nested_result_ownership_span !== undefined);
  if (has_stacked_result_ownership) {
    const outer_marker = leading_result_ownership_markers[0];
    const inner_marker = leading_result_ownership_markers[1];
    expect(
      outer_marker !== undefined && inner_marker !== undefined,
      "Stacked Baba result ownership markers lost their source spans.",
    );
    result_check = fail(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        "Effect result cannot combine ownership qualifiers",
        inner_marker,
        [{
          message: "Outer ownership qualifier is here.",
          span: outer_marker,
        }],
      ),
    );
  } else if (parenthesized_result_scalar_span !== undefined) {
    result_check = fail(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        "Effect result scalar ownership must precede its parentheses",
        parenthesized_result_scalar_span,
      ),
    );
  } else if (
    result_ownership_marker !== undefined &&
    nested_result_ownership_span !== undefined
  ) {
    result_check = fail(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        "Effect result cannot combine ownership qualifiers",
        nested_result_ownership_span,
        [{
          message: "Outer ownership qualifier is here.",
          span: {
            start: result_ownership_marker.start,
            end: result_ownership_marker.end,
          },
        }],
      ),
    );
  } else if (
    embedded_result_ownership_span !== undefined &&
    nested_result_ownership_span !== undefined
  ) {
    result_check = fail(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        "Effect result cannot combine ownership qualifiers",
        embedded_result_ownership_span,
        [{
          message: "Outer ownership qualifier is here.",
          span: nested_result_ownership_span,
        }],
      ),
    );
  } else if (
    result_ownership_text === "&" || parsed_result_type?.tag === "borrow"
  ) {
    result_check = fail(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        "Effect results cannot use bounded borrow ownership",
        { start: result_node.start, end: result_node.end },
      ),
    );
  }
  if (parsed_result_type !== undefined && !has_result_ownership_conflict) {
    result_check = Applicative.lift(
      (_ownership: null, _representation: null) => null,
      result_check,
      check_effect_ownership_representation(
        result_ownership_marker,
        result_ownership_text,
        result_type_node,
        parsed_result_type,
        source,
        "result",
        type_context,
      ),
    );
  }
  if (
    parsed_result_type !== undefined && implementation === "host" &&
    !has_result_ownership_conflict
  ) {
    result_check = Applicative.lift(
      (_ownership: null, _abi: null) => null,
      result_check,
      check_host_effect_abi_type(
        parsed_result_type,
        type_context,
        new Map(),
      ),
    );
  }
  const lowered_result = Applicative.lift(
    (_result: null, type: TypeExpr) => {
      let type_name = format_type_expr(type);
      let ownership: EffectResult["ownership"] = "unique_heap";
      expect(
        type.tag !== "borrow",
        "Checked Baba effect result retained bounded borrow ownership.",
      );
      if (type.tag === "frozen") {
        type_name = format_type_expr(type.value);
        ownership = "frozen_shareable";
      } else if (result_ownership_text === "#") {
        ownership = "frozen_shareable";
      } else if (result_ownership_text === "scalar") {
        ownership = "scalar";
      } else if (is_effect_scalar_type(type_name)) {
        ownership = "scalar";
      }
      const result: EffectResult = { type_name, ownership };
      mark_source_span(result, {
        start: result_node.start,
        end: result_node.end,
      });
      return result;
    },
    result_check,
    lowered_result_type,
  );
  return Applicative.lift(
    (
      _operation: null,
      params: EffectParam[],
      result: EffectResult,
    ) => {
      const operation: EffectOperation = {
        name,
        type_params,
        params,
        result,
      };
      if (
        node.children.some((child) =>
          source.slice(child.start, child.end) === "suspending"
        )
      ) {
        operation.execution = "suspending";
      }
      mark_source_span(operation, { start: node.start, end: node.end });
      return operation;
    },
    operation_check,
    lowered_params,
    lowered_result,
  );
}

function qualified_type_marker_span(
  node: BabaCstNode,
  source: string,
  type: Extract<TypeExpr, { tag: "borrow" | "frozen" }>,
): SourceSpan {
  let marker = "&";
  if (type.tag === "frozen") marker = "freeze";
  const start = source.indexOf(marker, node.start);
  expect(
    start >= node.start && start < node.end,
    "Qualified Baba type lost its ownership marker.",
  );
  return { start, end: start + marker.length };
}

function leading_effect_ownership_markers(
  node: BabaCstNode,
  source: string,
): SourceSpan[] {
  const markers: SourceSpan[] = [];
  let cursor = node.start;
  while (cursor < node.end) {
    const character = source[cursor];
    if (
      character === " " || character === "\t" || character === "\n" ||
      character === "\r" || character === "("
    ) {
      cursor += 1;
      continue;
    }
    if (character === "#" || character === "&") {
      markers.push({ start: cursor, end: cursor + 1 });
      cursor += 1;
      continue;
    }
    let marker: string | undefined;
    if (source.startsWith("scalar", cursor)) marker = "scalar";
    if (source.startsWith("freeze", cursor)) marker = "freeze";
    if (marker === undefined) break;
    const following = source[cursor + marker.length];
    if (
      following !== undefined && /[A-Za-z0-9_]/.test(following)
    ) {
      break;
    }
    markers.push({ start: cursor, end: cursor + marker.length });
    cursor += marker.length;
  }
  return markers;
}

function check_effect_ownership_representation(
  marker_node: BabaCstNode | undefined,
  marker_text: string | undefined,
  type_node: BabaCstNode,
  type: TypeExpr,
  source: string,
  label: "parameter" | "result",
  type_context: BabaEffectTypeContext,
): Checked<null> {
  let ownership_kind: "scalar" | "heap" | undefined;
  let ownership_span: SourceSpan | undefined;
  if (marker_node !== undefined) {
    if (marker_text === "scalar") {
      ownership_kind = "scalar";
    } else {
      ownership_kind = "heap";
    }
    ownership_span = { start: marker_node.start, end: marker_node.end };
  } else if (type.tag === "borrow" || type.tag === "frozen") {
    ownership_kind = "heap";
    ownership_span = qualified_type_marker_span(type_node, source, type);
  }
  if (ownership_kind === undefined || ownership_span === undefined) {
    return ok(null);
  }

  let representation = type;
  if (type.tag === "borrow" || type.tag === "frozen") {
    representation = type.value;
  }
  if (representation.tag === "borrow" || representation.tag === "frozen") {
    return ok(null);
  }
  const type_name = format_type_expr(representation);
  const representation_kind = effect_type_representation(
    representation,
    type_context,
    new Set(),
  );
  let capitalized_label = "Parameter";
  if (label === "result") capitalized_label = "Result";
  if (
    ownership_kind === "scalar" && representation_kind === "rich"
  ) {
    return fail(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        capitalized_label + " scalar ownership requires a scalar type, got " +
          type_name,
        ownership_span,
      ),
    );
  }
  if (ownership_kind === "heap" && representation_kind === "scalar") {
    return fail(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        capitalized_label + " heap ownership requires a rich type, got " +
          type_name,
        ownership_span,
      ),
    );
  }
  return ok(null);
}

function effect_type_representation(
  type: TypeExpr,
  type_context: BabaEffectTypeContext,
  resolving: ReadonlySet<string>,
): "scalar" | "rich" | "unknown" {
  if (type.tag === "borrow" || type.tag === "frozen") {
    return effect_type_representation(type.value, type_context, resolving);
  }
  if (type.tag === "name") {
    if (is_effect_scalar_type(type.name)) return "scalar";
    if (
      type.name === "Text" || type.name === "Bytes" ||
      type.name === "I32Slice" || type.name === "TextSlice"
    ) {
      return "rich";
    }
    const known = type_context.representations.get(type.name);
    if (known !== undefined) return known;
    const parameters = type_context.parameters.get(type.name);
    const definitions = type_context.definitions.get(type.name);
    if (
      parameters === undefined || parameters.length !== 0 ||
      definitions === undefined || definitions.length !== 1 ||
      resolving.has(type.name)
    ) {
      return "unknown";
    }
    const next = new Set(resolving);
    next.add(type.name);
    const definition = definitions[0];
    expect(definition !== undefined, "Declared type definition disappeared.");
    return effect_type_representation(definition, type_context, next);
  }
  if (type.tag === "apply") {
    const args: TypeExpr[] = [];
    let head: TypeExpr = type;
    while (head.tag === "apply") {
      args.unshift(head.arg);
      head = head.func;
    }
    if (head.tag !== "name") return "unknown";
    const known = type_context.representations.get(head.name);
    if (known !== undefined) return known;
    const parameters = type_context.parameters.get(head.name);
    const definitions = type_context.definitions.get(head.name);
    if (
      parameters === undefined || parameters.length !== args.length ||
      definitions === undefined || definitions.length !== 1 ||
      resolving.has(head.name)
    ) {
      return "unknown";
    }
    const substitutions = new Map<string, TypeExpr>();
    for (let index = 0; index < parameters.length; index += 1) {
      const parameter = parameters[index];
      const arg = args[index];
      expect(
        parameter !== undefined && arg !== undefined,
        "Declared type application lost an argument.",
      );
      substitutions.set(parameter, arg);
    }
    const definition = definitions[0];
    expect(definition !== undefined, "Declared type definition disappeared.");
    const next = new Set(resolving);
    next.add(head.name);
    return effect_type_representation(
      substitute_type_expr(definition, substitutions),
      type_context,
      next,
    );
  }
  if (
    type.tag === "array" || type.tag === "tuple" ||
    type.tag === "product" || type.tag === "arrow" ||
    type.tag === "union" || type.tag === "intersection" ||
    type.tag === "difference"
  ) {
    return "rich";
  }
  if (type.tag === "literal") {
    if (type.value.tag === "text") return "rich";
    return "scalar";
  }
  return "unknown";
}

function substitute_type_expr(
  type: TypeExpr,
  substitutions: ReadonlyMap<string, TypeExpr>,
): TypeExpr {
  if (type.tag === "name") {
    const replacement = substitutions.get(type.name);
    if (replacement !== undefined) return replacement;
    return type;
  }
  if (type.tag === "frozen" || type.tag === "borrow") {
    const substituted: TypeExpr = {
      tag: type.tag,
      value: substitute_type_expr(type.value, substitutions),
    };
    mark_source_span(substituted, source_span(type));
    return substituted;
  }
  if (
    type.tag === "union" || type.tag === "intersection" ||
    type.tag === "difference"
  ) {
    const substituted: TypeExpr = {
      tag: type.tag,
      left: substitute_type_expr(type.left, substitutions),
      right: substitute_type_expr(type.right, substitutions),
    };
    mark_source_span(substituted, source_span(type));
    return substituted;
  }
  if (type.tag === "apply") {
    const substituted: TypeExpr = {
      tag: "apply",
      func: substitute_type_expr(type.func, substitutions),
      arg: substitute_type_expr(type.arg, substitutions),
    };
    mark_source_span(substituted, source_span(type));
    return substituted;
  }
  if (type.tag === "tuple") {
    const substituted: TypeExpr = {
      tag: "tuple",
      items: type.items.map((item) =>
        substitute_type_expr(item, substitutions)
      ),
    };
    mark_source_span(substituted, source_span(type));
    return substituted;
  }
  if (type.tag === "product") {
    const substituted: TypeExpr = {
      tag: "product",
      entries: type.entries.map((entry) => ({
        label: entry.label,
        type_expr: substitute_type_expr(entry.type_expr, substitutions),
      })),
      value_pack: type.value_pack,
      repeat: type.repeat,
    };
    mark_source_span(substituted, source_span(type));
    return substituted;
  }
  if (type.tag === "array") {
    const substituted: TypeExpr = {
      tag: "array",
      element: substitute_type_expr(type.element, substitutions),
      length: type.length,
    };
    mark_source_span(substituted, source_span(type));
    return substituted;
  }
  if (type.tag === "arrow") {
    const substituted: TypeExpr = {
      tag: "arrow",
      param: substitute_type_expr(type.param, substitutions),
      effects: type.effects,
      result: substitute_type_expr(type.result, substitutions),
    };
    mark_source_span(substituted, source_span(type));
    return substituted;
  }
  if (type.tag === "forall") {
    const nested_substitutions = new Map(substitutions);
    for (const parameter of type.params) nested_substitutions.delete(parameter);
    const substituted: TypeExpr = {
      tag: "forall",
      params: [...type.params],
      body: substitute_type_expr(type.body, nested_substitutions),
    };
    mark_source_span(substituted, source_span(type));
    return substituted;
  }
  return type;
}

function check_host_effect_abi_type(
  type: TypeExpr,
  type_context: BabaEffectTypeContext,
  resolving: ReadonlyMap<string, SourceSpan>,
  declared_exposure?: { name: string; span: SourceSpan },
): Checked<null> {
  if (type.tag === "borrow" || type.tag === "frozen") {
    return check_host_effect_abi_type(
      type.value,
      type_context,
      resolving,
      declared_exposure,
    );
  }
  if (type.tag === "name") {
    const classification = classify_abi_primitive(type.name);
    if (classification.tag === "supported") return ok(null);
    if (classification.tag === "unsupported") {
      return host_effect_abi_failure(
        "Host effect type is not ABI-representable: " + type.name +
          " (" + classification.message + ")",
        source_span(type),
        declared_exposure,
      );
    }
    const arity = type_context.arities.get(type.name);
    if (arity !== undefined && arity > 0) {
      return host_effect_abi_failure(
        "Host effect type constructor " + type.name + " expects " +
          arity.toString() + " arguments, got 0",
        source_span(type),
        declared_exposure,
      );
    }
    const fields = type_context.definitions.get(type.name);
    if (fields === undefined) return ok(null);
    const exposure_span = resolving.get(type.name);
    if (exposure_span !== undefined) {
      return recursive_host_effect_abi_failure(
        type.name,
        exposure_span,
        source_span(type),
        declared_exposure,
      );
    }
    const next = new Map(resolving);
    next.set(type.name, source_span(type));
    let nested_exposure = declared_exposure;
    if (nested_exposure === undefined) {
      nested_exposure = { name: type.name, span: source_span(type) };
    }
    let field_check: Checked<null> = ok(null);
    for (const field of fields) {
      field_check = Applicative.lift(
        (_fields: null, _field: null) => null,
        field_check,
        check_host_effect_abi_type(
          field,
          type_context,
          next,
          nested_exposure,
        ),
      );
    }
    return field_check;
  }
  if (type.tag === "array") {
    return check_host_effect_abi_type(
      type.element,
      type_context,
      resolving,
      declared_exposure,
    );
  }
  if (type.tag === "apply") {
    const args: TypeExpr[] = [];
    let head: TypeExpr = type;
    while (head.tag === "apply") {
      args.unshift(head.arg);
      head = head.func;
    }
    if (head.tag !== "name") {
      return host_effect_abi_failure(
        "Host effect type application requires a named constructor",
        source_span(type),
        declared_exposure,
      );
    }
    const primitive = classify_abi_primitive(head.name);
    if (primitive.tag !== "unknown") {
      return host_effect_abi_failure(
        "Host effect primitive type is not a constructor: " + head.name,
        source_span(type),
        declared_exposure,
      );
    }
    const arity = type_context.arities.get(head.name);
    if (arity !== undefined && arity !== args.length) {
      return host_effect_abi_failure(
        "Host effect type constructor " + head.name + " expects " +
          arity.toString() + " arguments, got " + args.length.toString(),
        source_span(type),
        declared_exposure,
      );
    }
    const recursive_exposure = resolving.get(head.name);
    if (recursive_exposure !== undefined) {
      return recursive_host_effect_abi_failure(
        head.name,
        recursive_exposure,
        source_span(type),
        declared_exposure,
      );
    }
    let application_check: Checked<null> = ok(null);
    if (arity !== undefined) {
      const fields = type_context.definitions.get(head.name);
      const parameters = type_context.parameters.get(head.name);
      const next = new Map(resolving);
      next.set(head.name, source_span(type));
      let nested_exposure = declared_exposure;
      if (nested_exposure === undefined) {
        nested_exposure = { name: head.name, span: source_span(type) };
      }
      if (fields !== undefined && parameters !== undefined) {
        const substitutions = new Map<string, TypeExpr>();
        for (let index = 0; index < parameters.length; index += 1) {
          const parameter = parameters[index];
          const arg = args[index];
          expect(
            parameter !== undefined && arg !== undefined,
            "Checked host type application lost an argument.",
          );
          substitutions.set(parameter, arg);
        }
        for (const field of fields) {
          application_check = Applicative.lift(
            (_fields: null, _field: null) => null,
            application_check,
            check_host_effect_abi_type(
              substitute_type_expr(field, substitutions),
              type_context,
              next,
              nested_exposure,
            ),
          );
        }
      }
    }
    return application_check;
  }
  return host_effect_abi_failure(
    "Host effect type is not ABI-representable: " +
      format_type_expr(type),
    source_span(type),
    declared_exposure,
  );
}

function host_effect_abi_failure(
  message: string,
  invalid_span: SourceSpan,
  exposure: { name: string; span: SourceSpan } | undefined,
): Checked<null> {
  if (exposure === undefined) {
    return fail(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        message,
        invalid_span,
      ),
    );
  }
  return fail(
    compiler_diagnostic(
      diagnostic_codes.syntax_error,
      "Host effect exposure of " + exposure.name +
        " is not ABI-representable",
      exposure.span,
      [{ message, span: invalid_span }],
    ),
  );
}

function recursive_host_effect_abi_failure(
  name: string,
  cycle_entry: SourceSpan,
  recursive_reference: SourceSpan,
  exposure: { name: string; span: SourceSpan } | undefined,
): Checked<null> {
  if (exposure === undefined) {
    return fail(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        "Recursive ABI type is not supported: " + name,
        cycle_entry,
        [{
          message: "Recursive reference is here.",
          span: recursive_reference,
        }],
      ),
    );
  }
  let related = [{
    message: "Recursive reference is here.",
    span: recursive_reference,
  }];
  if (
    cycle_entry.start !== exposure.span.start ||
    cycle_entry.end !== exposure.span.end
  ) {
    related = [{
      message: "Declared type graph enters the cycle here.",
      span: cycle_entry,
    }, ...related];
  }
  return fail(
    compiler_diagnostic(
      diagnostic_codes.syntax_error,
      "Host effect exposure of " + exposure.name +
        " reaches recursive ABI type " + name,
      exposure.span,
      related,
    ),
  );
}

function nested_qualified_type_marker_span(
  node: BabaCstNode,
  source: string,
  type: Extract<TypeExpr, { tag: "borrow" | "frozen" }>,
): SourceSpan | undefined {
  const inner = type.value;
  if (inner.tag !== "borrow" && inner.tag !== "frozen") return undefined;
  const outer_span = qualified_type_marker_span(node, source, type);
  let marker = "&";
  if (inner.tag === "frozen") marker = "freeze";
  const start = source.indexOf(marker, outer_span.end);
  expect(
    start >= outer_span.end && start < node.end,
    "Nested qualified Baba type lost its ownership marker.",
  );
  return { start, end: start + marker.length };
}

function lower_sum_body(
  node: BabaCstNode,
  source: string,
  declaration_name: string,
): Checked<LoweredTypeDeclarationBody> {
  const names = new Set<string>();
  const case_nodes = node.children.filter((child) =>
    child.kind === "type_case"
  );
  if (case_nodes.length === 0) return unsupported_declaration(node);
  let sum_check: Checked<null> = ok(null);
  const has_leading_pipe = source.slice(node.start, node.end).trimStart()
    .startsWith("|");
  if (
    case_nodes.length === 1 &&
    has_leading_pipe
  ) {
    sum_check = fail(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        "Single-case sums omit the leading `|`",
        { start: node.start, end: node.end },
      ),
    );
  } else if (case_nodes.length > 1 && !has_leading_pipe) {
    sum_check = fail(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        "Multiple-case sums require a leading `|`",
        { start: node.start, end: node.end },
      ),
    );
  }
  let lowered_cases: Checked<
    { cases: TypeField[]; recursive: boolean }
  > = ok({ cases: [], recursive: false });
  for (const case_node of case_nodes) {
    const name_node = case_node.children.find((child) =>
      child.kind === "constructor_identifier"
    );
    if (name_node === undefined) return unsupported_declaration(case_node);
    const case_name = source.slice(name_node.start, name_node.end);
    const case_diagnostics = [];
    if (!/^[A-Z][A-Za-z0-9]*$/.test(case_name)) {
      case_diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Sum case must use PascalCase: " + case_name,
          { start: name_node.start, end: name_node.end },
        ),
      );
    }
    if (names.has(case_name)) {
      case_diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Duplicate sum case: " + case_name,
          { start: name_node.start, end: name_node.end },
        ),
      );
    }
    names.add(case_name);
    let case_check: Checked<null> = ok(null);
    if (case_diagnostics.length > 0) {
      case_check = fail(...case_diagnostics);
    }
    const payload_node = find_descendant(case_node, "type_reference");
    let lowered_payload: Checked<{ type_name: string; recursive: boolean }> =
      ok({ type_name: "Unit", recursive: false });
    if (payload_node !== undefined) {
      lowered_payload = lower_baba_type_reference(payload_node, source).map(
        (payload) => ({
          type_name: format_type_expr(payload),
          recursive: type_references_name(payload, declaration_name),
        }),
      );
    }
    const lowered_case = Applicative.lift(
      (
        payload: { type_name: string; recursive: boolean },
        _case: null,
      ) => {
        const field: TypeField = {
          name: case_name,
          type_name: payload.type_name,
        };
        mark_source_span(field, { start: case_node.start, end: case_node.end });
        return { field, recursive: payload.recursive };
      },
      lowered_payload,
      case_check,
    );
    lowered_cases = Applicative.lift(
      (
        current: { cases: TypeField[]; recursive: boolean },
        next: { field: TypeField; recursive: boolean },
      ) => ({
        cases: [...current.cases, next.field],
        recursive: current.recursive || next.recursive,
      }),
      lowered_cases,
      lowered_case,
    );
  }
  return Applicative.lift(
    (
      lowered: { cases: TypeField[]; recursive: boolean },
      _sum: null,
    ) => {
      const body: TypeDeclaration["body"] = {
        tag: "sum",
        cases: lowered.cases,
      };
      mark_source_span(body, { start: node.start, end: node.end });
      return { body, recursive: lowered.recursive };
    },
    lowered_cases,
    sum_check,
  );
}

function lower_struct_body(
  node: BabaCstNode,
  source: string,
  declaration_name: string,
): Checked<LoweredTypeDeclarationBody> {
  const lowered_entries = lower_named_fields(node, source);
  const entries = checked_value(lowered_entries);
  if (entries === undefined) return propagate_failure(lowered_entries);
  const fields = entries.map((entry) => entry.field);
  const shape: FrontExpr = {
    tag: "shape",
    entries: entries.map((entry) => {
      const value: FrontExpr = { tag: "set_type", type_expr: entry.type };
      return { label: entry.field.name, value };
    }),
  };
  const initializer: FrontExpr = {
    tag: "app",
    func: { tag: "var", name: "struct" },
    arg: shape,
    args: [shape],
  };
  const body: TypeDeclaration["body"] = {
    tag: "product",
    fields,
    positional: false,
    initializer,
  };
  mark_source_span(body, { start: node.start, end: node.end });
  return ok({
    body,
    recursive: entries.some((entry) =>
      type_references_name(entry.type, declaration_name)
    ),
  });
}

function lower_packed_body(
  node: BabaCstNode,
  source: string,
  declaration_name: string,
): Checked<LoweredTypeDeclarationBody> {
  const struct = node.children.find((child) => child.kind === "struct_type");
  if (struct !== undefined) {
    const lowered_entries = lower_named_fields(struct, source);
    const entries = checked_value(lowered_entries);
    if (entries === undefined) return propagate_failure(lowered_entries);
    const body: TypeDeclaration["body"] = {
      tag: "packed",
      fields: entries.map((entry) => entry.field),
      positional: false,
    };
    mark_source_span(body, { start: node.start, end: node.end });
    return ok({
      body,
      recursive: entries.some((entry) =>
        type_references_name(entry.type, declaration_name)
      ),
    });
  }
  const product = node.children.find((child) => child.kind === "type_product");
  if (product === undefined) return unsupported_declaration(node);
  return lower_product_body(product, source, "packed", declaration_name);
}

function lower_product_body(
  node: BabaCstNode,
  source: string,
  tag: "product" | "packed",
  declaration_name: string,
): Checked<LoweredTypeDeclarationBody> {
  let product: BabaCstNode | undefined;
  if (node.kind === "positional_type_product") {
    product = node;
  } else {
    product = node.children.find((child) =>
      child.kind === "positional_type_product"
    );
  }
  if (product === undefined) return unsupported_declaration(node);
  let lowered_fields: Checked<
    { fields: TypeField[]; recursive: boolean }
  > = ok({ fields: [], recursive: false });
  for (
    const type_node of product.children.filter((child) =>
      child.kind === "type_reference"
    )
  ) {
    const lowered_type = lower_baba_type_reference(type_node, source);
    lowered_fields = Applicative.lift(
      (
        current: { fields: TypeField[]; recursive: boolean },
        type: TypeExpr,
      ) => {
        const field: TypeField = {
          name: "item_" + current.fields.length.toString(),
          type_name: format_type_expr(type),
        };
        mark_source_span(field, { start: type_node.start, end: type_node.end });
        return {
          fields: [...current.fields, field],
          recursive: current.recursive ||
            type_references_name(type, declaration_name),
        };
      },
      lowered_fields,
      lowered_type,
    );
  }
  return lowered_fields.map((lowered) => {
    const body: TypeDeclaration["body"] = {
      tag,
      fields: lowered.fields,
      positional: true,
    };
    mark_source_span(body, { start: node.start, end: node.end });
    return { body, recursive: lowered.recursive };
  });
}

function lower_alias_body(
  node: BabaCstNode,
  source: string,
  declaration_name: string,
): Checked<LoweredTypeDeclarationBody> {
  let type_node = node;
  let opaque = false;
  if (node.kind === "newtype_type") {
    opaque = true;
    const representation = find_descendant(node, "type_reference");
    if (representation === undefined) return unsupported_declaration(node);
    type_node = representation;
  }
  if (!opaque && starts_with_value_pack_type(node, source)) {
    return fail(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        "Product types use `[...]`; parentheses only group types",
        { start: node.start, end: node.end },
      ),
    );
  }
  const lowered_type = lower_baba_type_reference(type_node, source);
  const type = checked_value(lowered_type);
  if (type === undefined) return propagate_failure(lowered_type);
  const body: Extract<TypeDeclaration["body"], { tag: "alias" }> = {
    tag: "alias",
    type_name: format_type_expr(type),
  };
  if (opaque) body.opaque = true;
  mark_source_span(body, { start: node.start, end: node.end });
  return ok({
    body,
    recursive: type_references_name(type, declaration_name),
  });
}

function starts_with_value_pack_type(
  node: BabaCstNode,
  source: string,
): boolean {
  if (source.slice(node.start, node.start + 1) !== "(") return false;
  if (node.kind === "unit_type") return true;
  if (node.kind === "type_product") {
    return find_descendant(node, '";"') === undefined;
  }
  const leading_child = node.children.find((child) =>
    child.start === node.start && is_type_syntax_node(child)
  );
  if (leading_child === undefined) return false;
  return starts_with_value_pack_type(leading_child, source);
}

function is_type_syntax_node(node: BabaCstNode): boolean {
  return node.kind === "type_reference" ||
    node.kind === "type_union" ||
    node.kind === "type_intersection" ||
    node.kind === "type_difference" ||
    node.kind === "function_type" ||
    node.kind === "type_application" ||
    node.kind === "type_parenthesized" ||
    node.kind === "type_product" ||
    node.kind === "positional_type_product" ||
    node.kind === "unit_type";
}

function lower_named_fields(
  node: BabaCstNode,
  source: string,
): Checked<Array<{ field: TypeField; type: TypeExpr }>> {
  let lowered_entries: Checked<Array<{ field: TypeField; type: TypeExpr }>> =
    ok([]);
  const names = new Set<string>();
  const field_nodes = descendants_of_kind(node, "named_type_field");
  if (field_nodes.length === 0) return unsupported_declaration(node);
  for (const field_node of field_nodes) {
    const name_node = field_node.children.find((child) =>
      child.kind === "identifier" || child.kind === '"end"'
    );
    const type_node = find_descendant(field_node, "type_reference");
    if (name_node === undefined || type_node === undefined) {
      return unsupported_declaration(field_node);
    }
    const name = source.slice(name_node.start, name_node.end);
    const field_diagnostics = [];
    if (name !== "end" && !is_snake_case(name)) {
      field_diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "product member must use snake_case: " + name,
          { start: name_node.start, end: name_node.end },
        ),
      );
    }
    if (names.has(name)) {
      field_diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Duplicate product member: " + name,
          { start: name_node.start, end: name_node.end },
        ),
      );
    }
    names.add(name);
    const lowered_type = lower_baba_type_reference(type_node, source);
    let field_check: Checked<null> = ok(null);
    if (field_diagnostics.length > 0) {
      field_check = fail(...field_diagnostics);
    }
    const lowered_entry = Applicative.lift(
      (type: TypeExpr, _field: null) => {
        const field: TypeField = {
          name,
          type_name: format_type_expr(type),
        };
        mark_source_span(field, {
          start: field_node.start,
          end: field_node.end,
        });
        return { field, type };
      },
      lowered_type,
      field_check,
    );
    lowered_entries = Applicative.lift(
      (
        entries: Array<{ field: TypeField; type: TypeExpr }>,
        entry: { field: TypeField; type: TypeExpr },
      ) => [...entries, entry],
      lowered_entries,
      lowered_entry,
    );
  }
  return lowered_entries;
}

function type_references_name(
  type_expr: TypeExpr,
  name: string,
): boolean {
  if (type_expr.tag === "name") return type_expr.name === name;
  if (
    type_expr.tag === "top" || type_expr.tag === "never" ||
    type_expr.tag === "atom" ||
    type_expr.tag === "literal"
  ) {
    return false;
  }
  if (type_expr.tag === "forall") {
    if (type_expr.params.includes(name)) return false;
    return type_references_name(type_expr.body, name);
  }
  if (type_expr.tag === "frozen" || type_expr.tag === "borrow") {
    return type_references_name(type_expr.value, name);
  }
  if (
    type_expr.tag === "union" || type_expr.tag === "intersection" ||
    type_expr.tag === "difference"
  ) {
    return type_references_name(type_expr.left, name) ||
      type_references_name(type_expr.right, name);
  }
  if (type_expr.tag === "apply") {
    return type_references_name(type_expr.func, name) ||
      type_references_name(type_expr.arg, name);
  }
  if (type_expr.tag === "tuple") {
    return type_expr.items.some((item) => type_references_name(item, name));
  }
  if (type_expr.tag === "product") {
    const entry_reference = type_expr.entries.some((entry) =>
      type_references_name(entry.type_expr, name)
    );
    return entry_reference ||
      array_length_references_name(type_expr.repeat, name);
  }
  if (type_expr.tag === "array") {
    return type_references_name(type_expr.element, name) ||
      array_length_references_name(type_expr.length, name);
  }
  if (type_expr.tag === "arrow") {
    return type_references_name(type_expr.param, name) ||
      effect_references_name(type_expr.effects, name) ||
      type_references_name(type_expr.result, name);
  }
  type_expr satisfies never;
  throw new Error("Unknown Baba declaration type.");
}

function array_length_references_name(
  length: ArrayLengthExpr | undefined,
  name: string,
): boolean {
  if (length === undefined || length.tag === "number") return false;
  if (length.tag === "name") return length.name === name;
  return array_length_references_name(length.left, name) ||
    array_length_references_name(length.right, name);
}

function effect_references_name(
  effect: EffectRowExpr | undefined,
  name: string,
): boolean {
  if (effect === undefined) return false;
  if (effect.tag === "family") return effect.name === name;
  if (effect.tag === "operation") return effect.effect === name;
  if (effect.tag === "variable") return effect.name === name;
  if (effect.tag === "group") {
    return effect_references_name(effect.value, name);
  }
  return effect_references_name(effect.left, name) ||
    effect_references_name(effect.right, name);
}

function find_descendant(
  node: BabaCstNode,
  kind: string,
): BabaCstNode | undefined {
  for (const child of node.children) {
    if (child.kind === kind) return child;
    const found = find_descendant(child, kind);
    if (found !== undefined) return found;
  }
  return undefined;
}

function descendants_of_kind(
  node: BabaCstNode,
  kind: string,
): BabaCstNode[] {
  const descendants: BabaCstNode[] = [];
  for (const child of node.children) {
    if (child.kind === kind) descendants.push(child);
    descendants.push(...descendants_of_kind(child, kind));
  }
  return descendants;
}

function propagate_failure<value, result>(
  check: Checked<value>,
): Checked<result> {
  const diagnostics = diagnostics_of(check);
  expect(
    diagnostics.length > 0,
    "Failed Baba declaration verdict has no diagnostic.",
  );
  return fail(...diagnostics);
}

function unsupported_declaration(node: BabaCstNode): Checked<never> {
  return fail(
    compiler_diagnostic(
      diagnostic_codes.syntax_error,
      `Baba declaration lowering does not support ${node.kind}.`,
      { start: node.start, end: node.end },
    ),
  );
}
