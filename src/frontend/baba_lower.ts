import { Applicative } from "@mewhhaha/typeclasses";
import { classify_abi_primitive } from "../abi_primitive.ts";
import { compiler_diagnostic, diagnostic_codes } from "../diagnostic.ts";
import { expect } from "../expect.ts";
import { integer_literal_fits, integer_type_name } from "../integer.ts";
import { is_snake_case, no_demand_name } from "./names.ts";
import type {
  Declaration,
  FrontExpr,
  ModuleHeader,
  Param,
  Pattern,
  ProductPatternEntry,
  Source,
  Stmt,
  TypeExpr,
  TypeField,
  TypePattern,
} from "./ast.ts";
import type { BabaCstNode, BabaParseResult } from "./baba_parser.ts";
import {
  type BabaEffectTypeContext,
  lower_baba_effect_declaration,
  lower_baba_record_declaration,
  lower_baba_type_declaration,
} from "./baba_declaration_lower.ts";
import { lower_baba_type_reference } from "./baba_type_lower.ts";
import {
  type Checked,
  checked_value,
  diagnostics_of,
  fail,
  ok,
} from "./checked.ts";
import { is_effect_scalar_type } from "./effect_operation.ts";
import { import_meta_binding_name } from "./import_meta.ts";
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
import {
  is_runtime_binding_name,
  unsupported_reserved_feature,
} from "./parser_support.ts";
import {
  pattern_binding_occurrences,
  pattern_bindings,
  record_pattern_binding_span,
} from "./pattern.ts";
import { expression_does_not_fall_through } from "./termination.ts";

const conditional_branch_spans = new WeakMap<object, SourceSpan>();
const no_demand_names = new WeakMap<BabaCstNode, string>();
const synthetic_parameter_names = new WeakMap<BabaCstNode, string>();
const direct_effect_bindings = new WeakSet<BabaCstNode>();
const maximum_pattern_nesting = 128;

export function lower_baba_source(parsed: BabaParseResult): Checked<Source> {
  const root = parsed.cst.root;
  if (root === undefined) {
    const source: Source = { tag: "program", statements: [] };
    mark_source_span(source, { start: 0, end: parsed.cst.text.length });
    return ok(source);
  }
  const pending_nodes = [{ node: root, pattern_depth: 0 }];
  while (pending_nodes.length > 0) {
    const pending = pending_nodes.pop();
    expect(pending !== undefined, "Baba pattern depth work disappeared.");
    for (const child of pending.node.children) {
      let pattern_depth = pending.pattern_depth;
      if (is_pattern_node(child)) pattern_depth += 1;
      if (pattern_depth > maximum_pattern_nesting) {
        return fail(
          compiler_diagnostic(
            diagnostic_codes.syntax_error,
            "Pattern nesting exceeds the maximum of " +
              maximum_pattern_nesting.toString(),
            { start: child.start, end: child.end },
          ),
        );
      }
      pending_nodes.push({ node: child, pattern_depth });
    }
  }
  index_synthetic_names(root, parsed.cst.text, parsed.tokens);
  index_direct_effect_bindings(root, parsed.cst.text);
  const declared_effect_type_context = collect_declared_effect_type_context(
    root.children,
    parsed.cst.text,
  );

  const contents = lower_top_level_sequence(
    root.children,
    parsed.cst.text,
    declared_effect_type_context,
  );

  return contents.map((lowered) => {
    let source: Source = { tag: "program", statements: lowered.statements };
    if (
      lowered.module !== undefined || lowered.declarations.length > 0
    ) {
      source = {
        tag: "program",
        module: lowered.module,
        declarations: lowered.declarations,
        statements: lowered.statements,
      };
    }
    mark_source_span(source, { start: root.start, end: root.end });
    derive_missing_source_spans(source, { start: root.start, end: root.end });
    return source;
  });
}

type EffectRepresentation = "scalar" | "rich" | "unknown";

function collect_declared_effect_type_context(
  nodes: readonly BabaCstNode[],
  source: string,
): BabaEffectTypeContext {
  const representations = new Map<string, EffectRepresentation>();
  const aliases = new Map<string, TypeExpr>();
  const definitions = new Map<string, readonly TypeExpr[]>();
  const arities = new Map<string, number>();
  const parameters = new Map<string, readonly string[]>();
  const effects = new Map<string, "host" | "duck">();
  const declared_names = new Set<string>();
  for (const node of nodes) {
    if (
      node.kind === "declare_effect_statement" ||
      node.kind === "effect_statement"
    ) {
      const name_node = node.children.find((child) =>
        child.kind === "effect_identifier"
      );
      if (name_node !== undefined) {
        const name = source.slice(name_node.start, name_node.end);
        if (!declared_names.has(name)) {
          declared_names.add(name);
          let implementation: "host" | "duck" = "duck";
          if (node.kind === "declare_effect_statement") {
            implementation = "host";
          }
          effects.set(name, implementation);
        }
      }
      continue;
    }
    if (node.kind === "declare_record_statement") {
      const name_node = node.children.find((child) =>
        child.kind === "identifier"
      );
      if (name_node !== undefined) {
        const name = source.slice(name_node.start, name_node.end);
        if (declared_names.has(name)) continue;
        declared_names.add(name);
        representations.set(name, "rich");
        arities.set(name, 0);
        parameters.set(name, []);
        definitions.set(
          name,
          lowered_type_references(node, source),
        );
      }
      continue;
    }
    if (node.kind !== "type_declaration_statement") continue;
    const name_node = node.children.find((child) =>
      child.kind === "identifier"
    );
    if (name_node === undefined) continue;
    const name = source.slice(name_node.start, name_node.end);
    if (declared_names.has(name)) continue;
    declared_names.add(name);
    const parameter_names = node.children
      .filter((child) => child.kind === "identifier")
      .slice(1)
      .map((child) => source.slice(child.start, child.end));
    arities.set(name, parameter_names.length);
    parameters.set(name, parameter_names);
    const definition = node.children.find((child) =>
      child.kind === "type_sum" || child.kind === "type_product" ||
      child.kind === "struct_type" || child.kind === "newtype_type" ||
      child.kind === "packed_type" || child.kind === "type_reference"
    );
    if (definition === undefined) continue;
    if (
      definition.kind === "type_sum" ||
      definition.kind === "struct_type" ||
      definition.kind === "packed_type" ||
      (definition.kind === "type_product" &&
        source.slice(definition.start, definition.start + 1) === "[")
    ) {
      representations.set(name, "rich");
      definitions.set(
        name,
        lowered_type_references(definition, source),
      );
      continue;
    }
    let representation_node = definition;
    if (definition.kind === "newtype_type") {
      const nested = find_descendant_of_kind(definition, "type_reference");
      if (nested === undefined) continue;
      representation_node = nested;
    }
    const lowered = checked_value(
      lower_baba_type_reference(representation_node, source),
    );
    if (lowered !== undefined) {
      aliases.set(name, lowered);
      definitions.set(name, [lowered]);
    }
  }
  for (const [name, alias] of aliases) {
    const representation = declared_effect_representation(
      alias,
      representations,
      aliases,
      new Set([name]),
    );
    if (representation !== "unknown") representations.set(name, representation);
  }
  return { representations, definitions, arities, parameters, effects };
}

function lowered_type_references(
  node: BabaCstNode,
  source: string,
): TypeExpr[] {
  const types: TypeExpr[] = [];
  for (const reference of descendants_of_kind(node, "type_reference")) {
    const type = checked_value(lower_baba_type_reference(reference, source));
    if (type !== undefined) types.push(type);
  }
  return types;
}

function declared_effect_representation(
  type: TypeExpr,
  representations: ReadonlyMap<string, EffectRepresentation>,
  aliases: ReadonlyMap<string, TypeExpr>,
  resolving: ReadonlySet<string>,
): EffectRepresentation {
  if (type.tag === "name") {
    if (is_effect_scalar_type(type.name)) return "scalar";
    if (
      type.name === "Text" || type.name === "Bytes" ||
      type.name === "I32Slice" || type.name === "TextSlice"
    ) {
      return "rich";
    }
    const known = representations.get(type.name);
    if (known !== undefined) return known;
    const alias = aliases.get(type.name);
    if (alias === undefined) return "unknown";
    if (resolving.has(type.name)) return "unknown";
    const next = new Set(resolving);
    next.add(type.name);
    return declared_effect_representation(
      alias,
      representations,
      aliases,
      next,
    );
  }
  if (type.tag === "borrow" || type.tag === "frozen") {
    return declared_effect_representation(
      type.value,
      representations,
      aliases,
      resolving,
    );
  }
  if (type.tag === "apply") {
    let head: TypeExpr = type;
    while (head.tag === "apply") head = head.func;
    if (head.tag !== "name") return "unknown";
    const known = representations.get(head.name);
    if (known !== undefined) return known;
    const alias = aliases.get(head.name);
    if (alias === undefined) return "unknown";
    if (resolving.has(head.name)) return "unknown";
    const next = new Set(resolving);
    next.add(head.name);
    return declared_effect_representation(
      alias,
      representations,
      aliases,
      next,
    );
  }
  if (
    type.tag === "array" || type.tag === "tuple" ||
    type.tag === "product" || type.tag === "arrow"
  ) {
    return "rich";
  }
  if (type.tag === "literal") {
    if (type.value.tag === "text") return "rich";
    return "scalar";
  }
  return "unknown";
}

function find_descendant_of_kind(
  node: BabaCstNode,
  kind: string,
): BabaCstNode | undefined {
  for (const child of node.children) {
    if (child.kind === kind) return child;
    const nested = find_descendant_of_kind(child, kind);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function descendants_of_kind(
  node: BabaCstNode,
  kind: string,
): BabaCstNode[] {
  const descendants: BabaCstNode[] = [];
  for (const child of node.children) {
    if (child.kind === kind) {
      descendants.push(child);
      continue;
    }
    descendants.push(...descendants_of_kind(child, kind));
  }
  return descendants;
}

function index_direct_effect_bindings(
  root: BabaCstNode,
  source: string,
): void {
  function snapshot_known_value(
    value: FrontExpr,
    known_values: ReadonlyMap<string, FrontExpr>,
  ): FrontExpr {
    if (value.tag === "var") {
      const resolved = known_values.get(value.name);
      if (resolved === undefined) return value;
      return resolved;
    }
    if (value.tag === "comptime" || value.tag === "captured") {
      return {
        ...value,
        expr: snapshot_known_value(value.expr, known_values),
      };
    }
    if (value.tag === "array") {
      const snapshot: FrontExpr = {
        ...value,
        items: value.items.map((item) =>
          snapshot_known_value(item, known_values)
        ),
      };
      if (value.rest !== undefined) {
        snapshot.rest = snapshot_known_value(
          value.rest,
          known_values,
        );
      }
      return snapshot;
    }
    if (value.tag === "product" || value.tag === "shape") {
      return {
        ...value,
        entries: value.entries.map((entry) => ({
          ...entry,
          value: snapshot_known_value(entry.value, known_values),
        })),
      };
    }
    if (value.tag === "struct_value") {
      return {
        ...value,
        fields: value.fields.map((field) => ({
          ...field,
          value: snapshot_known_value(field.value, known_values),
        })),
      };
    }
    if (value.tag === "app") {
      return {
        ...value,
        func: snapshot_known_value(value.func, known_values),
        args: value.args.map((arg) => snapshot_known_value(arg, known_values)),
      };
    }
    return value;
  }

  function same_const_value(left: FrontExpr, right: FrontExpr): boolean {
    while (left.tag === "comptime" || left.tag === "captured") {
      left = left.expr;
    }
    while (right.tag === "comptime" || right.tag === "captured") {
      right = right.expr;
    }
    if (left.tag !== right.tag) return false;
    if (left.tag === "unit") return true;
    if (left.tag === "bool" && right.tag === "bool") {
      return left.value === right.value;
    }
    if (left.tag === "num" && right.tag === "num") {
      return left.type === right.type && left.value === right.value;
    }
    if (left.tag === "text" && right.tag === "text") {
      return left.value === right.value && left.encoding === right.encoding;
    }
    if (left.tag === "atom" && right.tag === "atom") {
      return left.name === right.name;
    }
    if (left.tag === "var" && right.tag === "var") {
      return left.name === right.name;
    }
    if (left.tag === "union_case" && right.tag === "union_case") {
      if (left.name !== right.name) return false;
      if (left.value === undefined || right.value === undefined) {
        return left.value === undefined && right.value === undefined;
      }
      return same_const_value(left.value, right.value);
    }
    return false;
  }

  function collect_structural_known_bindings(
    pattern: Pattern,
    value: FrontExpr,
    instances: ReadonlySet<string>,
    effects: ReadonlySet<string>,
    ordinary_constructors: ReadonlySet<string>,
    known_values: ReadonlyMap<string, FrontExpr>,
    effect_bindings: Set<string>,
    projected_values: Map<string, FrontExpr>,
  ): boolean {
    if (pattern.tag === "or") {
      for (const alternative of pattern.alternatives) {
        const alternative_effects = new Set<string>();
        const alternative_values = new Map<string, FrontExpr>();
        const matches = collect_structural_known_bindings(
          alternative,
          value,
          instances,
          effects,
          ordinary_constructors,
          known_values,
          alternative_effects,
          alternative_values,
        );
        if (!matches) continue;
        for (const name of alternative_effects) effect_bindings.add(name);
        for (const [name, projected] of alternative_values) {
          projected_values.set(name, projected);
        }
        return true;
      }
      return false;
    }
    if (pattern.tag === "union_case") {
      if (value.tag !== "union_case" || value.name !== pattern.name) {
        return false;
      }
      if (pattern.value === undefined) return value.value === undefined;
      if (value.value === undefined) return false;
      return collect_structural_known_bindings(
        pattern.value,
        value.value,
        instances,
        effects,
        ordinary_constructors,
        known_values,
        effect_bindings,
        projected_values,
      );
    }
    if (pattern.tag === "literal") {
      let literal: FrontExpr;
      if (pattern.value.tag === "atom") {
        literal = { tag: "atom", name: pattern.value.name };
      } else if (pattern.value.tag === "bool") {
        literal = { tag: "bool", value: pattern.value.value };
      } else if (pattern.value.tag === "num") {
        literal = {
          tag: "num",
          type: pattern.value.type,
          value: pattern.value.value,
        };
      } else {
        literal = {
          tag: "text",
          value: pattern.value.value,
        };
      }
      return same_const_value(literal, value);
    }
    if (pattern.tag === "const_value") {
      const expected = snapshot_known_value(
        pattern.value,
        known_values,
      );
      return same_const_value(expected, value);
    }
    if (pattern.tag === "value") {
      const expected = snapshot_known_value(
        { tag: "var", name: pattern.name },
        known_values,
      );
      return same_const_value(expected, value);
    }
    if (pattern.tag === "binding") {
      projected_values.set(pattern.name, value);
      let candidate = value;
      while (candidate.tag === "comptime" || candidate.tag === "captured") {
        candidate = candidate.expr;
      }
      let name: string | undefined;
      let applied = false;
      if (candidate.tag === "var") {
        name = candidate.name;
      } else if (candidate.tag === "app") {
        let func = candidate.func;
        while (func.tag === "app") func = func.func;
        if (func.tag === "var") name = func.name;
        applied = true;
      }
      if (name === undefined) return true;
      let is_effect_instance = effects.has(name) ||
        (!applied && instances.has(name));
      if (
        applied && /^[A-Z][A-Za-z0-9]*$/.test(name) &&
        !ordinary_constructors.has(name)
      ) {
        is_effect_instance = true;
      }
      if (is_effect_instance) effect_bindings.add(pattern.name);
      return true;
    }
    if (pattern.tag === "product") {
      let available = 0;
      if (
        value.tag === "product" || value.tag === "shape"
      ) {
        available = value.entries.length;
      } else if (value.tag === "array") {
        available = value.items.length;
      } else if (value.tag === "struct_value") {
        available = value.fields.length;
      } else {
        return false;
      }
      if (
        pattern.rest === undefined && available !== pattern.entries.length
      ) {
        return false;
      }
      if (
        pattern.rest !== undefined && available < pattern.entries.length
      ) {
        return false;
      }
      for (let index = 0; index < pattern.entries.length; index += 1) {
        const entry = pattern.entries[index];
        expect(entry !== undefined, "Effect pattern entry disappeared.");
        let child: FrontExpr | undefined;
        if (value.tag === "product" || value.tag === "shape") {
          if (entry.label === undefined) {
            child = value.entries[index]?.value;
          } else {
            child = value.entries.find((candidate) =>
              candidate.label === entry.label
            )?.value;
          }
        } else if (value.tag === "array") {
          child = value.items[index];
        } else if (value.tag === "struct_value") {
          if (entry.label === undefined) {
            child = value.fields[index]?.value;
          } else {
            child = value.fields.find((candidate) =>
              candidate.name === entry.label
            )?.value;
          }
        }
        if (child === undefined) return false;
        const child_matches = collect_structural_known_bindings(
          entry.pattern,
          child,
          instances,
          effects,
          ordinary_constructors,
          known_values,
          effect_bindings,
          projected_values,
        );
        if (!child_matches) return false;
      }
      if (pattern.rest !== undefined && pattern.rest.tag !== "wildcard") {
        let rest_value: FrontExpr;
        if (value.tag === "product" || value.tag === "shape") {
          const labels = new Set(
            pattern.entries.flatMap((entry) => {
              if (entry.label === undefined) return [];
              return [entry.label];
            }),
          );
          let entries = value.entries.slice(pattern.entries.length);
          if (labels.size === pattern.entries.length) {
            entries = value.entries.filter((entry) => {
              if (entry.label === undefined) return true;
              return !labels.has(entry.label);
            });
          }
          rest_value = { ...value, entries };
        } else if (value.tag === "array") {
          rest_value = {
            ...value,
            items: value.items.slice(pattern.entries.length),
          };
        } else {
          const labels = new Set(
            pattern.entries.flatMap((entry) => {
              if (entry.label === undefined) return [];
              return [entry.label];
            }),
          );
          let fields = value.fields.slice(pattern.entries.length);
          if (labels.size === pattern.entries.length) {
            fields = value.fields.filter((field) => !labels.has(field.name));
          }
          rest_value = { ...value, fields };
        }
        return collect_structural_known_bindings(
          pattern.rest,
          rest_value,
          instances,
          effects,
          ordinary_constructors,
          known_values,
          effect_bindings,
          projected_values,
        );
      }
      return true;
    }
    if (pattern.tag !== "array") {
      if (pattern.tag === "wildcard") return true;
      if (pattern.tag === "unit") return value.tag === "unit";
      return false;
    }
    let values: FrontExpr[] = [];
    if (value.tag === "array") {
      values = value.items;
    } else if (value.tag === "product") {
      values = value.entries.map((entry) => entry.value);
    } else {
      return false;
    }
    if (pattern.rest === undefined && values.length !== pattern.items.length) {
      return false;
    }
    if (
      pattern.rest !== undefined && values.length < pattern.items.length
    ) {
      return false;
    }
    for (let index = 0; index < pattern.items.length; index += 1) {
      const child = values[index];
      const item = pattern.items[index];
      if (child === undefined || item === undefined) return false;
      const child_matches = collect_structural_known_bindings(
        item,
        child,
        instances,
        effects,
        ordinary_constructors,
        known_values,
        effect_bindings,
        projected_values,
      );
      if (!child_matches) return false;
    }
    if (pattern.rest !== undefined && pattern.rest.tag !== "wildcard") {
      let rest_value: FrontExpr;
      if (value.tag === "array") {
        rest_value = {
          ...value,
          items: value.items.slice(pattern.items.length),
        };
      } else {
        rest_value = {
          ...value,
          entries: value.entries.slice(pattern.items.length),
        };
      }
      return collect_structural_known_bindings(
        pattern.rest,
        rest_value,
        instances,
        effects,
        ordinary_constructors,
        known_values,
        effect_bindings,
        projected_values,
      );
    }
    return true;
  }

  function index_sequence(
    nodes: readonly BabaCstNode[],
    inherited_instances: ReadonlySet<string>,
    inherited_effects: ReadonlySet<string>,
    inherited_ordinary_constructors: ReadonlySet<string>,
    inherited_known_values: ReadonlyMap<string, FrontExpr>,
  ): void {
    const instances = new Set(inherited_instances);
    const effects = new Set(inherited_effects);
    const ordinary_constructors = new Set(inherited_ordinary_constructors);
    const known_values = new Map(inherited_known_values);
    const local_declarations = new Set<string>();
    for (const node of nodes) {
      const is_effect_declaration = node.kind === "declare_effect_statement" ||
        node.kind === "effect_statement";
      if (
        !is_effect_declaration &&
        node.kind !== "type_declaration_statement" &&
        node.kind !== "declare_record_statement"
      ) {
        continue;
      }
      let name_node = node.children.find((child) =>
        child.kind === "identifier"
      );
      if (is_effect_declaration) {
        name_node = node.children.find((child) =>
          child.kind === "effect_identifier"
        );
      }
      if (name_node === undefined) continue;
      const name = source.slice(name_node.start, name_node.end);
      if (local_declarations.has(name)) continue;
      local_declarations.add(name);
      if (is_effect_declaration) {
        effects.add(name);
      } else {
        ordinary_constructors.add(name);
      }
    }
    for (const node of nodes) {
      const tracked_names = new Set(instances);
      for (const name of known_values.keys()) tracked_names.add(name);
      const assigned_outer_names = nested_assigned_outer_names(
        node,
        tracked_names,
        source,
      );
      index_nested_sequences(
        node,
        instances,
        effects,
        ordinary_constructors,
        known_values,
      );
      for (const assigned_name of assigned_outer_names) {
        instances.delete(assigned_name);
        known_values.delete(assigned_name);
      }
      if (node.kind === "effect_binding_statement") {
        const receiver = effect_binding_receiver(node, source);
        if (receiver !== undefined && instances.has(receiver)) {
          direct_effect_bindings.add(node);
        }
        const result_name_node = node.children.find((child) =>
          child.kind === "identifier"
        );
        if (result_name_node !== undefined) {
          const result_name = source.slice(
            result_name_node.start,
            result_name_node.end,
          );
          instances.delete(result_name);
          known_values.delete(result_name);
        }
        continue;
      }
      if (
        node.kind === "assignment" ||
        node.kind === "index_assignment"
      ) {
        const assigned_name = node.children.find((child) =>
          child.kind === "identifier"
        );
        let assigns_effect_instance = false;
        let assigned_value: FrontExpr | undefined;
        if (node.kind === "assignment") {
          const value_node = node.children.find((child) =>
            child !== assigned_name && is_expression_node(child)
          );
          if (value_node !== undefined) {
            assigned_value = checked_value(
              lower_expression(value_node, source),
            );
            const constructor = effect_instance_constructor(
              value_node,
              source,
            );
            if (constructor !== undefined) {
              assigns_effect_instance = effects.has(constructor.name) ||
                (!constructor.applied &&
                  instances.has(constructor.name));
              if (
                constructor.applied &&
                /^[A-Z][A-Za-z0-9]*$/.test(constructor.name) &&
                !ordinary_constructors.has(constructor.name)
              ) {
                assigns_effect_instance = true;
              }
            }
          }
        }
        if (assigned_name !== undefined) {
          let assigned_snapshot: FrontExpr | undefined;
          if (assigned_value !== undefined) {
            assigned_snapshot = snapshot_known_value(
              assigned_value,
              known_values,
            );
          }
          const assigned_name_text = source.slice(
            assigned_name.start,
            assigned_name.end,
          );
          instances.delete(assigned_name_text);
          known_values.delete(assigned_name_text);
          if (assigns_effect_instance) instances.add(assigned_name_text);
          if (assigned_snapshot !== undefined) {
            known_values.set(assigned_name_text, assigned_snapshot);
          }
        }
        continue;
      }
      if (node.kind !== "binding_statement") continue;
      const equals_node = node.children.find((child) =>
        source.slice(child.start, child.end) === "="
      );
      if (equals_node === undefined) continue;
      const pattern_nodes = node.children.filter((child) =>
        child.end <= equals_node.start && is_pattern_node(child)
      );
      const pattern = checked_value(
        lower_pattern_alternatives(pattern_nodes, source),
      );
      if (pattern === undefined) continue;
      const incoming_instances = new Set(instances);
      const incoming_known_values = new Map(known_values);
      const value_node = node.children.find((child) =>
        child.start >= equals_node.end && is_expression_node(child)
      );
      if (value_node === undefined) {
        for (const binding of pattern_bindings(pattern)) {
          instances.delete(binding.name);
        }
        continue;
      }
      const value = checked_value(lower_expression(value_node, source));
      if (value === undefined) {
        for (const binding of pattern_bindings(pattern)) {
          instances.delete(binding.name);
          known_values.delete(binding.name);
        }
        continue;
      }
      let resolved_value = value;
      let resolved_from_known_value = false;
      const resolving = new Set<string>();
      while (
        resolved_value.tag === "var" &&
        !resolving.has(resolved_value.name)
      ) {
        const resolved = incoming_known_values.get(resolved_value.name);
        if (resolved === undefined) break;
        resolving.add(resolved_value.name);
        resolved_value = resolved;
        resolved_from_known_value = true;
      }
      let snapshot_value = resolved_value;
      if (!resolved_from_known_value) {
        snapshot_value = snapshot_known_value(
          resolved_value,
          incoming_known_values,
        );
      }
      const introduced_effects = new Set<string>();
      const introduced_values = new Map<string, FrontExpr>();
      collect_structural_known_bindings(
        pattern,
        snapshot_value,
        incoming_instances,
        effects,
        ordinary_constructors,
        incoming_known_values,
        introduced_effects,
        introduced_values,
      );
      for (const binding of pattern_bindings(pattern)) {
        instances.delete(binding.name);
        known_values.delete(binding.name);
      }
      for (const name of introduced_effects) instances.add(name);
      for (const [name, projected_value] of introduced_values) {
        known_values.set(name, projected_value);
      }
    }
  }

  function index_nested_sequences(
    node: BabaCstNode,
    instances: ReadonlySet<string>,
    effects: ReadonlySet<string>,
    ordinary_constructors: ReadonlySet<string>,
    known_values: ReadonlyMap<string, FrontExpr>,
  ): void {
    let nested_instances = instances;
    let nested_known_values = known_values;
    if (node.kind === "arrow_function") {
      const shadowed = new Set(instances);
      const shadowed_known_values = new Map(known_values);
      const parameter_container = node.children.find((child) =>
        child.kind === "parameter" || child.kind === "parameter_list"
      );
      if (parameter_container !== undefined) {
        let parameters = [parameter_container];
        if (parameter_container.kind === "parameter_list") {
          parameters = parameter_container.children.filter((child) =>
            child.kind === "parameter"
          );
        }
        for (const parameter of parameters) {
          const identifier = parameter.children.find((child) =>
            child.kind === "identifier"
          );
          if (identifier !== undefined) {
            const name = source.slice(identifier.start, identifier.end);
            shadowed.delete(name);
            shadowed_known_values.delete(name);
          }
        }
      }
      nested_instances = shadowed;
      nested_known_values = shadowed_known_values;
    }
    let conditional_instances = nested_instances;
    let conditional_known_values = nested_known_values;
    const conditional_bindings = conditional_pattern_binding_names(
      node,
      source,
    );
    if (conditional_bindings.length > 0) {
      const shadowed = new Set(nested_instances);
      const shadowed_known_values = new Map(nested_known_values);
      for (const name of conditional_bindings) {
        shadowed.delete(name);
        shadowed_known_values.delete(name);
      }
      conditional_instances = shadowed;
      conditional_known_values = shadowed_known_values;
    }
    for (const child of node.children) {
      if (
        child.kind === "block" ||
        child.kind === "conditional_branch"
      ) {
        let child_instances = nested_instances;
        let child_known_values = nested_known_values;
        if (child.kind === "conditional_branch") {
          child_instances = conditional_instances;
          child_known_values = conditional_known_values;
        }
        index_sequence(
          child.children,
          child_instances,
          effects,
          ordinary_constructors,
          child_known_values,
        );
        continue;
      }
      index_nested_sequences(
        child,
        nested_instances,
        effects,
        ordinary_constructors,
        nested_known_values,
      );
    }
  }

  index_sequence(root.children, new Set(), new Set(), new Set(), new Map());
}

function nested_assigned_outer_names(
  node: BabaCstNode,
  outer_names: ReadonlySet<string>,
  source: string,
): ReadonlySet<string> {
  const assigned_names = new Set<string>();

  function visit_sequence(
    nodes: readonly BabaCstNode[],
    inherited_names: ReadonlySet<string>,
  ): void {
    const visible_names = new Set(inherited_names);
    for (const current of nodes) {
      if (current.kind === "arrow_function") continue;
      if (
        current.kind === "assignment" ||
        current.kind === "index_assignment"
      ) {
        const assigned_name_node = current.children.find((child) =>
          child.kind === "identifier"
        );
        if (assigned_name_node !== undefined) {
          const assigned_name = source.slice(
            assigned_name_node.start,
            assigned_name_node.end,
          );
          if (visible_names.has(assigned_name)) {
            assigned_names.add(assigned_name);
          }
        }
      }
      visit_nested(current, visible_names);
      if (
        current.kind !== "binding_statement" &&
        current.kind !== "effect_binding_statement"
      ) {
        continue;
      }
      if (current.kind === "effect_binding_statement") {
        const binding_name_node = current.children.find((child) =>
          child.kind === "identifier"
        );
        if (binding_name_node !== undefined) {
          visible_names.delete(
            source.slice(binding_name_node.start, binding_name_node.end),
          );
        }
        continue;
      }
      const equals_node = current.children.find((child) =>
        source.slice(child.start, child.end) === "="
      );
      if (equals_node === undefined) continue;
      const pattern_nodes = current.children.filter((child) =>
        child.end <= equals_node.start && is_pattern_node(child)
      );
      const pattern = checked_value(
        lower_pattern_alternatives(pattern_nodes, source),
      );
      if (pattern === undefined) continue;
      for (const binding of pattern_bindings(pattern)) {
        visible_names.delete(binding.name);
      }
    }
  }

  function visit_nested(
    current: BabaCstNode,
    visible_names: ReadonlySet<string>,
  ): void {
    if (current.kind === "arrow_function") return;
    let conditional_names = visible_names;
    const bindings = conditional_pattern_binding_names(current, source);
    if (bindings.length > 0) {
      const shadowed = new Set(visible_names);
      for (const name of bindings) shadowed.delete(name);
      conditional_names = shadowed;
    }
    for (const child of current.children) {
      if (
        child.kind === "block" ||
        child.kind === "conditional_branch"
      ) {
        if (child.kind === "conditional_branch") {
          visit_sequence(child.children, conditional_names);
        } else {
          visit_sequence(child.children, visible_names);
        }
        continue;
      }
      visit_nested(child, visible_names);
    }
  }

  visit_nested(node, outer_names);
  return assigned_names;
}

function conditional_pattern_binding_names(
  node: BabaCstNode,
  source: string,
): string[] {
  if (
    node.kind !== "if_expression" && node.kind !== "else_if_clause"
  ) {
    return [];
  }
  if (
    !node.children.some((child) =>
      source.slice(child.start, child.end) === "let"
    )
  ) {
    return [];
  }
  const equals_node = node.children.find((child) =>
    source.slice(child.start, child.end) === "="
  );
  if (equals_node === undefined) return [];
  const pattern_nodes = node.children.filter((child) =>
    child.end <= equals_node.start && is_pattern_node(child)
  );
  if (pattern_nodes.length === 0) return [];
  const pattern = checked_value(
    lower_pattern_alternatives(pattern_nodes, source),
  );
  if (pattern === undefined) return [];
  return pattern_bindings(pattern).map((binding) => binding.name);
}

function effect_binding_receiver(
  node: BabaCstNode,
  source: string,
): string | undefined {
  const binding = node.children.find((child) =>
    child.kind === "identifier" || child.kind === "wildcard" ||
    child.kind === "unit_pattern"
  );
  const value_node = node.children.find((child) =>
    child !== binding && is_expression_node(child)
  );
  if (value_node === undefined) return undefined;
  const value = unwrap_transparent_expression(value_node);
  if (value.kind !== "application_expression") return undefined;
  const function_node = value.children.find((child) =>
    is_expression_node(child)
  );
  if (function_node === undefined) return undefined;
  const field = unwrap_transparent_expression(function_node);
  if (field.kind !== "field_expression") return undefined;
  const object = field.children.find((child) => is_expression_node(child));
  if (object === undefined) return undefined;
  const receiver = unwrap_transparent_expression(object);
  if (receiver.kind !== "identifier") return undefined;
  return source.slice(receiver.start, receiver.end);
}

function effect_instance_constructor(
  node: BabaCstNode,
  source: string,
): { name: string; applied: boolean } | undefined {
  const expression = unwrap_transparent_expression(node);
  let applied = false;
  let function_node = expression;
  if (expression.kind === "application_expression") {
    const child = expression.children.find((candidate) =>
      is_expression_node(candidate)
    );
    if (child === undefined) return undefined;
    function_node = child;
    applied = true;
  }
  const constructor = unwrap_transparent_expression(function_node);
  if (constructor.kind !== "identifier") return undefined;
  return {
    name: source.slice(constructor.start, constructor.end),
    applied,
  };
}

function unwrap_transparent_expression(node: BabaCstNode): BabaCstNode {
  let expression = node;
  while (
    expression.kind === "postfix_expression" ||
    expression.kind === "parenthesized_expression"
  ) {
    const child = expression.children.find((candidate) =>
      is_expression_node(candidate)
    );
    if (child === undefined) return expression;
    expression = child;
  }
  return expression;
}

function index_synthetic_names(
  root: BabaCstNode,
  source: string,
  tokens: readonly { text: string; start: number; end: number }[],
): void {
  let next_no_demand = 0;
  function visit(node: BabaCstNode): void {
    if (node.kind === "module_header") {
      const parameter_list = node.children.find((child) =>
        child.kind === "parameter_list"
      );
      if (parameter_list !== undefined) {
        for (
          const parameter of parameter_list.children.filter((child) =>
            child.kind === "parameter"
          )
        ) {
          const wildcard = parameter.children.find((child) =>
            child.kind === "wildcard"
          );
          if (wildcard === undefined) continue;
          no_demand_names.set(wildcard, no_demand_name(next_no_demand));
          next_no_demand += 1;
        }
      }
    }
    if (node.kind === "binding_statement") {
      const equals_node = node.children.find((child) =>
        source.slice(child.start, child.end) === "="
      );
      if (equals_node === undefined) {
        for (const child of node.children) visit(child);
        return;
      }
      const pattern_nodes = node.children.filter((child) =>
        child.end <= equals_node.start && is_pattern_node(child)
      );
      const first_pattern = pattern_nodes[0];
      let needs_no_demand_name = pattern_nodes.length !== 1;
      if (
        pattern_nodes.length === 1 &&
        first_pattern !== undefined && first_pattern.kind === "identifier"
      ) {
        const name = source.slice(first_pattern.start, first_pattern.end);
        needs_no_demand_name = !is_snake_case(name) ||
          name === "true" || name === "false";
      } else if (
        pattern_nodes.length === 1 && first_pattern !== undefined
      ) {
        needs_no_demand_name = true;
      }
      if (needs_no_demand_name) {
        no_demand_names.set(node, no_demand_name(next_no_demand));
        next_no_demand += 1;
      }
    }
    if (
      node.kind === "if_expression" || node.kind === "else_if_clause"
    ) {
      const wildcard = node.children.find((child) =>
        child.kind === "union_pattern"
      )?.children.find((child) => child.kind === "wildcard");
      if (wildcard !== undefined) {
        no_demand_names.set(wildcard, no_demand_name(next_no_demand));
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
  module: ModuleHeader | undefined;
  declarations: Declaration[];
  statements: Stmt[];
};

function lower_top_level_sequence(
  nodes: readonly BabaCstNode[],
  source: string,
  declared_effect_type_context: BabaEffectTypeContext,
): Checked<LoweredTopLevel> {
  const declaration_names = new Map<string, BabaCstNode>();
  let contents: Checked<LoweredTopLevel> = ok({
    module: undefined,
    declarations: [],
    statements: [],
  });
  for (const node of nodes) {
    if (node.kind === "module_header") {
      contents = Applicative.lift(
        (current: LoweredTopLevel, module: ModuleHeader) => ({
          module,
          declarations: current.declarations,
          statements: current.statements,
        }),
        contents,
        lower_module_header(node, source),
      );
      continue;
    }
    let declaration: Checked<Declaration> | undefined;
    if (node.kind === "type_declaration_statement") {
      declaration = lower_baba_type_declaration(node, source);
    } else if (
      node.kind === "declare_effect_statement" ||
      node.kind === "effect_statement"
    ) {
      declaration = lower_baba_effect_declaration(
        node,
        source,
        declared_effect_type_context,
      );
    } else if (node.kind === "declare_record_statement") {
      declaration = lower_baba_record_declaration(node, source);
    }
    if (declaration !== undefined) {
      const name_node = node.children.find((child) =>
        child.kind === "identifier" || child.kind === "effect_identifier"
      );
      if (name_node !== undefined) {
        const name = source.slice(name_node.start, name_node.end);
        let checks_init_fields = node.kind === "declare_record_statement";
        if (node.kind === "type_declaration_statement") {
          const type_parameter_count = node.children.filter((child) =>
            child.kind === "identifier"
          ).length - 1;
          checks_init_fields = type_parameter_count === 0 &&
            node.children.some((child) => child.kind === "struct_type");
        }
        if (name === "Init" && checks_init_fields) {
          let init_check: Checked<null> = ok(null);
          const init_field_nodes = [
            ...descendants_of_kind(node, "type_field"),
            ...descendants_of_kind(node, "named_type_field"),
          ].sort((left, right) => left.start - right.start);
          for (const field_node of init_field_nodes) {
            const field_name_node = field_node.children.find((child) =>
              child.kind === "identifier"
            );
            const type_node = field_node.children.find((child) =>
              child.kind === "type_reference"
            );
            if (field_name_node === undefined || type_node === undefined) {
              continue;
            }
            const field_name = source.slice(
              field_name_node.start,
              field_name_node.end,
            );
            const parsed_type = checked_value(
              lower_baba_type_reference(type_node, source),
            );
            if (parsed_type === undefined) continue;
            let invalid_init_type = false;
            let invalid_init_message = "Init field must name a host effect: " +
              field_name;
            if (parsed_type.tag !== "name") {
              invalid_init_type = true;
              invalid_init_message += ", got " +
                format_type_expr(parsed_type);
            } else {
              const effect_implementation = declared_effect_type_context
                .effects.get(parsed_type.name);
              if (effect_implementation === "duck") {
                invalid_init_type = true;
                invalid_init_message =
                  "Init field cannot provide Duck effect " +
                  parsed_type.name + ": " + field_name;
              } else if (effect_implementation === undefined) {
                const primitive = classify_abi_primitive(parsed_type.name);
                if (
                  primitive.tag !== "unknown" ||
                  declared_effect_type_context.arities.has(parsed_type.name)
                ) {
                  invalid_init_type = true;
                  invalid_init_message += ", got " + parsed_type.name;
                }
              }
            }
            if (!invalid_init_type) continue;
            init_check = Applicative.lift(
              (_fields: null, _field: null) => null,
              init_check,
              fail(
                compiler_diagnostic(
                  diagnostic_codes.syntax_error,
                  invalid_init_message,
                  { start: type_node.start, end: type_node.end },
                ),
              ),
            );
          }
          const declaration_with_init = Applicative.lift(
            (value: Declaration, _init: null) => value,
            declaration,
            init_check,
          );
          const init_diagnostics = diagnostics_of(declaration_with_init)
            .toSorted((left, right) => {
              if (left.span.start !== right.span.start) {
                return left.span.start - right.span.start;
              }
              if (left.span.end !== right.span.end) {
                return left.span.end - right.span.end;
              }
              return 0;
            });
          declaration = declaration_with_init;
          if (init_diagnostics.length > 0) {
            declaration = fail(...init_diagnostics);
          }
        }
        const previous = declaration_names.get(name);
        if (previous !== undefined) {
          declaration = Applicative.lift(
            (_duplicate: null, value: Declaration) => value,
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
            declaration,
          );
        } else {
          declaration_names.set(name, name_node);
        }
      }
      contents = Applicative.lift(
        (current: LoweredTopLevel, declaration: Declaration) => ({
          module: current.module,
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
          module: current.module,
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

function lower_module_header(
  node: BabaCstNode,
  source: string,
): Checked<ModuleHeader> {
  const parameter_list = node.children.find((child) =>
    child.kind === "parameter_list"
  );
  if (parameter_list === undefined) return unsupported(node);
  let lowered_params: Checked<Param[]> = ok([]);
  for (
    const parameter_node of parameter_list.children.filter((child) =>
      child.kind === "parameter"
    )
  ) {
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
    if (name_node.kind === "identifier") {
      const name = source.slice(name_node.start, name_node.end);
      if (!is_runtime_binding_name(name)) {
        parameter_diagnostics.push(
          compiler_diagnostic(
            diagnostic_codes.syntax_error,
            "Parameter name is reserved syntax: " + name,
            { start: name_node.start, end: name_node.end },
          ),
        );
      }
      const reserved_feature = unsupported_reserved_feature(name);
      if (reserved_feature !== undefined) {
        parameter_diagnostics.push(
          compiler_diagnostic(
            diagnostic_codes.syntax_error,
            "Parameter is reserved for unsupported " + reserved_feature +
              ": " + name,
            { start: name_node.start, end: name_node.end },
          ),
        );
      }
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
          const generated_name = no_demand_names.get(name_node);
          expect(
            generated_name !== undefined,
            "Baba module wildcard parameter has no no-demand identity.",
          );
          name = generated_name;
        }
        const parameter: Param = {
          name,
          is_const,
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
    lowered_params = Applicative.lift(
      (params: Param[], parameter: Param) => [...params, parameter],
      lowered_params,
      lowered_parameter,
    );
  }
  return lowered_params.map((params) => {
    const module: ModuleHeader = { params };
    mark_source_span(module, { start: node.start, end: node.end });
    return module;
  });
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

  if (node.kind === "effect_binding_statement") {
    return lower_effect_binding(node, source);
  }

  if (node.kind === "return_statement") {
    return lower_return(node, source);
  }

  if (node.kind === "module_return_statement") {
    return lower_module_return(node, source);
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

function lower_pattern_alternatives(
  nodes: readonly BabaCstNode[],
  source: string,
  mode: "default" | "linear" = "default",
): Checked<Pattern> {
  const first_node = nodes[0];
  if (first_node === undefined) {
    return fail(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        "Binding requires a pattern",
        { start: 0, end: 0 },
      ),
    );
  }
  let lowered_alternatives: Checked<Pattern[]> = ok([]);
  for (const node of nodes) {
    lowered_alternatives = Applicative.lift(
      (alternatives: Pattern[], pattern: Pattern) => [
        ...alternatives,
        pattern,
      ],
      lowered_alternatives,
      lower_pattern(node, source, mode),
    );
  }
  let signature_check: Checked<null> = ok(null);
  const alternatives = checked_value(lowered_alternatives);
  if (alternatives !== undefined) {
    const first = alternatives[0];
    expect(first !== undefined, "Baba pattern alternatives disappeared.");
    const expected = pattern_signature(first);
    for (let index = 1; index < alternatives.length; index += 1) {
      const alternative = alternatives[index];
      const alternative_node = nodes[index];
      expect(
        alternative !== undefined && alternative_node !== undefined,
        "Baba pattern alternative lost its source node.",
      );
      const actual = pattern_signature(alternative);
      if (actual === expected) continue;
      signature_check = Applicative.lift(
        (_previous: null, _next: null) => null,
        signature_check,
        fail(
          compiler_diagnostic(
            diagnostic_codes.syntax_error,
            "Pattern alternatives must bind the same names, modes, and " +
              "annotations: expected " + expected + ", got " + actual,
            { start: alternative_node.start, end: alternative_node.end },
            [{
              message: "First pattern alternative is here.",
              span: { start: first_node.start, end: first_node.end },
            }],
          ),
        ),
      );
    }
  }
  let duplicate_check: Checked<null> = ok(null);
  if (alternatives !== undefined) {
    for (const alternative of alternatives) {
      const names = new Map<
        string,
        { source: Pattern; binding_span: SourceSpan | undefined }
      >();
      for (const occurrence of pattern_binding_occurrences(alternative)) {
        const previous = names.get(occurrence.binding.name);
        if (previous === undefined) {
          names.set(occurrence.binding.name, {
            source: occurrence.source,
            binding_span: occurrence.binding_span,
          });
          continue;
        }
        let duplicate_span = source_span(occurrence.source);
        if (occurrence.binding_span !== undefined) {
          duplicate_span = occurrence.binding_span;
        }
        let first_span = source_span(previous.source);
        if (previous.binding_span !== undefined) {
          first_span = previous.binding_span;
        }
        duplicate_check = Applicative.lift(
          (_previous: null, _duplicate: null) => null,
          duplicate_check,
          fail(
            compiler_diagnostic(
              diagnostic_codes.syntax_error,
              "Duplicate pattern binding: " + occurrence.binding.name,
              duplicate_span,
              [{
                message: "First pattern binding is here.",
                span: first_span,
              }],
            ),
          ),
        );
      }
    }
  }
  const pattern_check = Applicative.lift(
    (
      alternatives: Pattern[],
      _signatures: null,
      _duplicates: null,
    ) => {
      if (alternatives.length === 1) {
        const pattern = alternatives[0];
        expect(pattern !== undefined, "Baba pattern disappeared.");
        return pattern;
      }
      const pattern: Pattern = { tag: "or", alternatives };
      const last_node = nodes[nodes.length - 1];
      expect(last_node !== undefined, "Baba pattern alternatives disappeared.");
      mark_source_span(pattern, {
        start: first_node.start,
        end: last_node.end,
      });
      return pattern;
    },
    lowered_alternatives,
    signature_check,
    duplicate_check,
  );
  const diagnostics = diagnostics_of(pattern_check).toSorted((left, right) => {
    if (left.span.start !== right.span.start) {
      return left.span.start - right.span.start;
    }
    if (left.span.end !== right.span.end) {
      return left.span.end - right.span.end;
    }
    return 0;
  });
  if (diagnostics.length > 0) return fail(...diagnostics);
  return pattern_check;
}

function lower_pattern(
  node: BabaCstNode,
  source: string,
  mode: "default" | "linear" = "default",
): Checked<Pattern> {
  if (node.kind === "alternative_pattern") {
    const alternatives = node.children.filter((child) =>
      is_pattern_node(child)
    );
    return lower_pattern_alternatives(alternatives, source, mode);
  }
  if (
    node.kind === "identifier" &&
    (source.slice(node.start, node.end) === "true" ||
      source.slice(node.start, node.end) === "false")
  ) {
    if (mode === "linear") return unsupported(node);
    const name = source.slice(node.start, node.end);
    const literal: FrontExpr = { tag: "bool", value: name === "true" };
    mark_source_span(literal, { start: node.start, end: node.end });
    const pattern: Pattern = { tag: "literal", value: literal };
    mark_source_span(pattern, { start: node.start, end: node.end });
    return ok(pattern);
  }
  if (node.kind === "identifier") {
    const name = source.slice(node.start, node.end);
    if (/^[A-Z][A-Za-z0-9]*$/.test(name)) {
      const pattern: Pattern = { tag: "value", name };
      mark_source_span(pattern, { start: node.start, end: node.end });
      return ok(pattern);
    }
    let name_check: Checked<null> = ok(null);
    const name_diagnostics = [];
    if (!is_snake_case(name)) {
      name_diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Runtime binding must use snake_case: " + name,
          { start: node.start, end: node.end },
        ),
      );
    }
    const reserved_feature = unsupported_reserved_feature(name);
    if (reserved_feature !== undefined) {
      name_diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Pattern binding is reserved for unsupported " + reserved_feature +
            ": " + name,
          { start: node.start, end: node.end },
        ),
      );
    }
    if (!is_runtime_binding_name(name)) {
      name_diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Pattern binding name is reserved syntax: " + name,
          { start: node.start, end: node.end },
        ),
      );
    }
    if (name_diagnostics.length > 0) {
      name_check = fail(...name_diagnostics);
    }
    return name_check.map((_name) => {
      const pattern: Pattern = {
        tag: "binding",
        name,
        mode,
        annotation: undefined,
      };
      mark_source_span(pattern, { start: node.start, end: node.end });
      record_pattern_binding_span(pattern, {
        start: node.start,
        end: node.end,
      });
      return pattern;
    });
  }
  if (node.kind === "wildcard") {
    if (mode === "linear") {
      return fail(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Linear wildcard patterns are not supported",
          { start: node.start, end: node.end },
        ),
      );
    }
    const pattern: Pattern = { tag: "wildcard", mode: "default" };
    mark_source_span(pattern, { start: node.start, end: node.end });
    return ok(pattern);
  }
  if (node.kind === "unit_pattern") {
    if (mode === "linear") return unsupported(node);
    const pattern: Pattern = { tag: "unit" };
    mark_source_span(pattern, { start: node.start, end: node.end });
    return ok(pattern);
  }
  if (
    node.kind === "number" || node.kind === "string" ||
    node.kind === "character" || node.kind === "boolean"
  ) {
    if (mode === "linear") return unsupported(node);
    let text_captures: RegExpMatchArray[] = [];
    let text_capture_check: Checked<null> = ok(null);
    let text_capture_span: SourceSpan | undefined;
    if (node.kind === "string") {
      const raw = source.slice(node.start, node.end);
      let decoded: unknown;
      try {
        decoded = JSON.parse(raw);
      } catch (_error) {
        return unsupported(node);
      }
      if (typeof decoded !== "string") return unsupported(node);
      text_captures = Array.from(
        decoded.matchAll(/\$\{([a-z_][A-Za-z0-9_]*)\}/g),
      );
      if (text_captures.length > 1) {
        return fail(
          compiler_diagnostic(
            diagnostic_codes.syntax_error,
            "Text patterns support at most one capture",
            { start: node.start, end: node.end },
          ),
        );
      }
      const capture = text_captures[0];
      if (capture !== undefined) {
        const name = capture[1];
        expect(name !== undefined, "Baba text capture lost its binding.");
        const raw_capture = "${" + name + "}";
        const raw_capture_start = raw.indexOf(raw_capture);
        const capture_diagnostics = [];
        let capture_span = { start: node.start, end: node.end };
        if (raw_capture_start >= 0) {
          capture_span = {
            start: node.start + raw_capture_start + 2,
            end: node.start + raw_capture_start + 2 + name.length,
          };
        }
        text_capture_span = capture_span;
        if (!is_snake_case(name)) {
          capture_diagnostics.push(
            compiler_diagnostic(
              diagnostic_codes.syntax_error,
              "Text pattern binding must use snake_case: " + name,
              capture_span,
            ),
          );
        }
        if (!is_runtime_binding_name(name)) {
          capture_diagnostics.push(
            compiler_diagnostic(
              diagnostic_codes.syntax_error,
              "Pattern binding name is reserved syntax: " + name,
              capture_span,
            ),
          );
        }
        const reserved_feature = unsupported_reserved_feature(name);
        if (reserved_feature !== undefined) {
          capture_diagnostics.push(
            compiler_diagnostic(
              diagnostic_codes.syntax_error,
              "Text pattern binding is reserved for unsupported " +
                reserved_feature + ": " + name,
              capture_span,
            ),
          );
        }
        if (capture_diagnostics.length > 0) {
          text_capture_check = fail(...capture_diagnostics);
        }
      }
    }
    return Applicative.lift(
      (_capture: null, literal: FrontExpr) => {
        expect(
          literal.tag === "num" || literal.tag === "text" ||
            literal.tag === "bool",
          "Baba pattern literal lowered to a non-literal expression.",
        );
        if (literal.tag === "text") {
          if (text_captures.length === 1) {
            const capture = text_captures[0];
            expect(capture !== undefined, "Baba text capture disappeared.");
            const name = capture[1];
            const start = capture.index;
            expect(
              name !== undefined && start !== undefined,
              "Baba text capture lost its binding.",
            );
            const pattern: Pattern = {
              tag: "text_capture",
              prefix: literal.value.slice(0, start),
              name,
              suffix: literal.value.slice(start + capture[0].length),
            };
            mark_source_span(pattern, { start: node.start, end: node.end });
            if (text_capture_span !== undefined) {
              record_pattern_binding_span(pattern, text_capture_span);
            }
            return pattern;
          }
        }
        const pattern: Pattern = { tag: "literal", value: literal };
        mark_source_span(pattern, { start: node.start, end: node.end });
        return pattern;
      },
      text_capture_check,
      lower_expression(node, source),
    );
  }
  if (node.kind === "const_value_pattern") {
    if (mode === "linear") return unsupported(node);
    const value_node = node.children.find((child) => is_expression_node(child));
    if (value_node === undefined) return unsupported(node);
    return lower_expression(value_node, source).map((value) => {
      const pattern: Pattern = { tag: "const_value", value };
      mark_source_span(pattern, { start: node.start, end: node.end });
      return pattern;
    });
  }
  if (node.kind === "union_pattern") {
    if (mode === "linear") return unsupported(node);
    const name_node = node.children.find((child) =>
      child.kind === "constructor_identifier"
    );
    if (name_node === undefined) return unsupported(node);
    const payload_node = node.children.find((child) =>
      child !== name_node && is_pattern_node(child)
    );
    let lowered_payload: Checked<Pattern>;
    if (payload_node === undefined) {
      const unit: Pattern = { tag: "unit" };
      mark_source_span(unit, { start: name_node.end, end: name_node.end });
      lowered_payload = ok(unit);
    } else {
      lowered_payload = lower_pattern(payload_node, source);
      if (checked_value(lowered_payload)?.tag === "unit") {
        lowered_payload = Applicative.lift(
          (_payload: null, value: Pattern) => value,
          fail(
            compiler_diagnostic(
              diagnostic_codes.syntax_error,
              "Nullary union case pattern #" +
                source.slice(name_node.start, name_node.end) + " omits `()`",
              { start: payload_node.start, end: payload_node.end },
            ),
          ),
          lowered_payload,
        );
      }
    }
    return lowered_payload.map((value) => {
      const pattern: Pattern = {
        tag: "union_case",
        name: source.slice(name_node.start, name_node.end),
        value,
      };
      mark_source_span(pattern, { start: node.start, end: node.end });
      return pattern;
    });
  }
  if (node.kind === "array_pattern") {
    if (mode === "linear") return unsupported(node);
    if (
      !node.children.some((child) =>
        child.kind === "array_rest_pattern" || is_pattern_node(child)
      )
    ) {
      return fail(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Empty array binding patterns are not supported",
          { start: node.start, end: node.end },
        ),
      );
    }
    let lowered_items: Checked<Pattern[]> = ok([]);
    let lowered_rest: Checked<Pattern | undefined> = ok(undefined);
    for (const child of node.children) {
      if (child.kind === "array_rest_pattern") {
        const rest_node = child.children.find((nested) =>
          is_pattern_node(nested)
        );
        if (rest_node === undefined) return unsupported(child);
        lowered_rest = lower_pattern(rest_node, source);
        continue;
      }
      if (!is_pattern_node(child)) continue;
      lowered_items = Applicative.lift(
        (items: Pattern[], item: Pattern) => [...items, item],
        lowered_items,
        lower_pattern(child, source),
      );
    }
    return Applicative.lift(
      (items: Pattern[], rest: Pattern | undefined) => {
        let pattern: Pattern;
        if (rest === undefined) {
          pattern = {
            tag: "product",
            entries: items.map((item) => {
              const entry: ProductPatternEntry = { pattern: item };
              mark_source_span(entry, source_span(item));
              return entry;
            }),
          };
        } else {
          pattern = { tag: "array", items, rest };
        }
        mark_source_span(pattern, { start: node.start, end: node.end });
        return pattern;
      },
      lowered_items,
      lowered_rest,
    );
  }
  if (node.kind === "positional_product_pattern") {
    if (mode === "linear") return unsupported(node);
    let lowered_entries: Checked<ProductPatternEntry[]> = ok([]);
    let lowered_rest: Checked<Pattern | undefined> = ok(undefined);
    for (const child of node.children) {
      if (child.kind === "product_rest_pattern") {
        const rest_node = child.children.find((nested) =>
          is_pattern_node(nested)
        );
        if (rest_node === undefined) return unsupported(child);
        lowered_rest = lower_pattern(rest_node, source);
        continue;
      }
      if (!is_pattern_node(child)) continue;
      lowered_entries = Applicative.lift(
        (entries: ProductPatternEntry[], pattern: Pattern) => {
          const entry: ProductPatternEntry = { pattern };
          mark_source_span(entry, { start: child.start, end: child.end });
          return [...entries, entry];
        },
        lowered_entries,
        lower_pattern(child, source),
      );
    }
    return Applicative.lift(
      (entries: ProductPatternEntry[], rest: Pattern | undefined) => {
        const pattern: Pattern = {
          tag: "product",
          entries,
          rest,
          value_pack: true,
        };
        mark_source_span(pattern, { start: node.start, end: node.end });
        return pattern;
      },
      lowered_entries,
      lowered_rest,
    );
  }
  if (node.kind === "named_shape_pattern") {
    if (mode === "linear") return unsupported(node);
    if (
      !node.children.some((child) => child.kind === "named_shape_pattern_field")
    ) {
      return fail(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Empty named binding patterns are not supported",
          { start: node.start, end: node.end },
        ),
      );
    }
    const names = new Map<string, BabaCstNode>();
    let lowered_entries: Checked<ProductPatternEntry[]> = ok([]);
    for (
      const field of node.children.filter((child) =>
        child.kind === "named_shape_pattern_field"
      )
    ) {
      const name_node = field.children.find((child) =>
        child.kind === "identifier" || child.kind === '"end"'
      );
      if (name_node === undefined) return unsupported(field);
      const name = source.slice(name_node.start, name_node.end);
      const field_diagnostics = [];
      if (!is_snake_case(name)) {
        field_diagnostics.push(
          compiler_diagnostic(
            diagnostic_codes.syntax_error,
            "Pattern field must use snake_case: " + name,
            { start: name_node.start, end: name_node.end },
          ),
        );
      }
      const previous = names.get(name);
      if (previous !== undefined) {
        field_diagnostics.push(
          compiler_diagnostic(
            diagnostic_codes.syntax_error,
            "Duplicate pattern field: " + name,
            { start: name_node.start, end: name_node.end },
            [{
              message: "First pattern field is here.",
              span: { start: previous.start, end: previous.end },
            }],
          ),
        );
      } else {
        names.set(name, name_node);
      }
      let field_check: Checked<null> = ok(null);
      if (field_diagnostics.length > 0) {
        field_check = fail(...field_diagnostics);
      }
      const explicit_pattern = field.children.find((child) =>
        child !== name_node && is_pattern_node(child)
      );
      const type_node = field.children.find((child) =>
        child.kind === "type_reference"
      );
      let binding_name_check: Checked<null> = ok(null);
      if (explicit_pattern === undefined) {
        const binding_name_diagnostics = [];
        if (!is_runtime_binding_name(name)) {
          binding_name_diagnostics.push(
            compiler_diagnostic(
              diagnostic_codes.syntax_error,
              "Pattern binding name is reserved syntax: " + name,
              { start: name_node.start, end: name_node.end },
            ),
          );
        }
        const reserved_feature = unsupported_reserved_feature(name);
        if (reserved_feature !== undefined) {
          binding_name_diagnostics.push(
            compiler_diagnostic(
              diagnostic_codes.syntax_error,
              "Pattern binding is reserved for unsupported " +
                reserved_feature + ": " + name,
              { start: name_node.start, end: name_node.end },
            ),
          );
        }
        if (binding_name_diagnostics.length > 0) {
          binding_name_check = fail(...binding_name_diagnostics);
        }
      }
      let lowered_field_pattern: Checked<Pattern>;
      if (explicit_pattern !== undefined) {
        lowered_field_pattern = lower_pattern(explicit_pattern, source);
      } else if (type_node !== undefined) {
        lowered_field_pattern = Applicative.lift(
          (_name: null, type: TypeExpr) => {
            const pattern: Extract<Pattern, { tag: "binding" }> = {
              tag: "binding",
              name,
              mode: "default",
              annotation: format_type_expr(type),
            };
            if (type.tag !== "name") pattern.type_annotation = type;
            mark_source_span(pattern, {
              start: name_node.start,
              end: type_node.end,
            });
            record_pattern_binding_span(pattern, {
              start: name_node.start,
              end: name_node.end,
            });
            return pattern;
          },
          binding_name_check,
          lower_baba_type_reference(type_node, source),
        );
      } else if (name === "end") {
        lowered_field_pattern = fail(
          compiler_diagnostic(
            diagnostic_codes.syntax_error,
            "`end` is reserved; bind the `.end` field to another name",
            { start: name_node.start, end: name_node.end },
          ),
        );
      } else {
        lowered_field_pattern = binding_name_check.map((_name) => {
          const pattern: Pattern = {
            tag: "binding",
            name,
            mode: "default",
            annotation: undefined,
          };
          mark_source_span(pattern, {
            start: name_node.start,
            end: name_node.end,
          });
          record_pattern_binding_span(pattern, {
            start: name_node.start,
            end: name_node.end,
          });
          return pattern;
        });
      }
      const lowered_entry = Applicative.lift(
        (_field: null, pattern: Pattern) => {
          const entry: ProductPatternEntry = { label: name, pattern };
          mark_source_span(entry, { start: field.start, end: field.end });
          return entry;
        },
        field_check,
        lowered_field_pattern,
      );
      lowered_entries = Applicative.lift(
        (entries: ProductPatternEntry[], entry: ProductPatternEntry) => [
          ...entries,
          entry,
        ],
        lowered_entries,
        lowered_entry,
      );
    }
    return lowered_entries.map((entries) => {
      const pattern: Pattern = { tag: "product", entries };
      mark_source_span(pattern, { start: node.start, end: node.end });
      return pattern;
    });
  }
  if (node.kind === "type_pattern") {
    if (mode === "linear") return unsupported(node);
    return lower_type_pattern(node, source).map((type_pattern) => {
      const pattern: Pattern = { tag: "type", pattern: type_pattern };
      mark_source_span(pattern, { start: node.start, end: node.end });
      return pattern;
    });
  }
  return unsupported(node);
}

function lower_type_pattern(
  node: BabaCstNode,
  source: string,
): Checked<TypePattern> {
  const kind_node = node.children.find((child) => {
    const text = source.slice(child.start, child.end);
    return text === "struct" || text === "union";
  });
  if (kind_node === undefined) return unsupported(node);
  const kind_text = source.slice(kind_node.start, kind_node.end);
  let kind: TypePattern["kind"];
  if (kind_text === "struct") {
    kind = "struct";
  } else if (kind_text === "union") {
    kind = "union";
  } else {
    return unsupported(kind_node);
  }
  const names = new Map<string, BabaCstNode>();
  let lowered_fields: Checked<TypeField[]> = ok([]);
  for (
    const field_node of node.children.filter((child) =>
      child.kind === "type_pattern_field"
    )
  ) {
    const name_node = field_node.children.find((child) =>
      child.kind === "identifier" || child.kind === '"end"'
    );
    const type_node = field_node.children.find((child) =>
      child.kind === "type_reference"
    );
    if (name_node === undefined || type_node === undefined) {
      return unsupported(field_node);
    }
    const name = source.slice(name_node.start, name_node.end);
    const field_diagnostics = [];
    if (kind === "struct" && !is_snake_case(name)) {
      field_diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Type pattern field must use snake_case: " + name,
          { start: name_node.start, end: name_node.end },
        ),
      );
    }
    if (kind === "union" && !/^[A-Z][A-Za-z0-9]*$/.test(name)) {
      field_diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Union case must use PascalCase: " + name,
          { start: name_node.start, end: name_node.end },
        ),
      );
    }
    const previous = names.get(name);
    if (previous !== undefined) {
      field_diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Duplicate type pattern field: " + name,
          { start: name_node.start, end: name_node.end },
          [{
            message: "First type pattern field is here.",
            span: { start: previous.start, end: previous.end },
          }],
        ),
      );
    } else {
      names.set(name, name_node);
    }
    let field_check: Checked<null> = ok(null);
    if (field_diagnostics.length > 0) {
      field_check = fail(...field_diagnostics);
    }
    const lowered_field = Applicative.lift(
      (_field: null, type: TypeExpr) => {
        const field: TypeField = {
          name,
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
  const open = node.children.some((child) =>
    source.slice(child.start, child.end) === ".."
  );
  return lowered_fields.map((fields) => {
    const pattern: TypePattern = { kind, fields, open };
    mark_source_span(pattern, { start: node.start, end: node.end });
    return pattern;
  });
}

function pattern_signature(pattern: Pattern): string {
  return pattern_bindings(pattern).map((binding) => {
    let annotation = "";
    if (binding.annotation !== undefined) annotation = binding.annotation;
    return binding.name + ":" + binding.mode + ":" + annotation;
  }).toSorted().join("|");
}

function is_pattern_node(node: BabaCstNode): boolean {
  return node.kind === "alternative_pattern" ||
    node.kind === "identifier" ||
    node.kind === "wildcard" ||
    node.kind === "unit_pattern" ||
    node.kind === "number" ||
    node.kind === "string" ||
    node.kind === "character" ||
    node.kind === "boolean" ||
    node.kind === "const_value_pattern" ||
    node.kind === "union_pattern" ||
    node.kind === "array_pattern" ||
    node.kind === "positional_product_pattern" ||
    node.kind === "named_shape_pattern" ||
    node.kind === "type_pattern";
}

function lower_binding(
  node: BabaCstNode,
  source: string,
): Checked<Stmt> {
  const equals_node = node.children.find((child) =>
    source.slice(child.start, child.end) === "="
  );
  if (equals_node === undefined) return unsupported(node);
  const else_node = node.children.find((child) =>
    source.slice(child.start, child.end) === "else"
  );
  const else_block = node.children.find((child) =>
    child.kind === "block" &&
    else_node !== undefined && child.start >= else_node.end
  );
  const pattern_nodes = node.children.filter((child) =>
    child.end <= equals_node.start && is_pattern_node(child)
  );
  const type_node = node.children.find((child) =>
    child.kind === "type_reference"
  );
  const value_nodes = node.children.filter((child) =>
    child.start >= equals_node.end &&
    (else_node === undefined || child.end <= else_node.start) &&
    is_expression_node(child)
  );
  const value_node = value_nodes[0];
  if (pattern_nodes.length === 0 || value_node === undefined) {
    return unsupported(node);
  }
  if (value_nodes.length !== 1) return unsupported(node);
  if (
    (else_node === undefined && else_block !== undefined) ||
    (else_node !== undefined && else_block === undefined)
  ) {
    return unsupported(node);
  }
  let mode: "default" | "linear" = "default";
  if (
    node.children.some((child) => source.slice(child.start, child.end) === "!")
  ) {
    mode = "linear";
  }
  for (const child of node.children) {
    if (
      pattern_nodes.includes(child) || child === value_node ||
      child === else_block
    ) {
      continue;
    }
    if (child === type_node || child.kind === '":"') continue;
    if (
      child.kind === '"let"' ||
      child.kind === '"const"' ||
      child.kind === '"!"' ||
      child.kind === '"|"' ||
      child.kind === '"="' ||
      child.kind === '"else"' ||
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
  let lowered_else: Checked<FrontExpr | undefined> = ok(undefined);
  if (else_block !== undefined) {
    let else_check: Checked<null> = ok(null);
    const lowered_block = lower_expression(else_block, source);
    const parsed_block = checked_value(lowered_block);
    if (
      parsed_block !== undefined &&
      !expression_does_not_fall_through(parsed_block)
    ) {
      else_check = fail(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Let-else branch must return, break, continue, or trap",
          { start: else_block.start, end: else_block.end },
        ),
      );
    }
    if (kind !== "let") {
      expect(else_node !== undefined, "Baba let-else keyword disappeared.");
      else_check = Applicative.lift(
        (_previous: null, _kind: null) => null,
        else_check,
        fail(
          compiler_diagnostic(
            diagnostic_codes.syntax_error,
            "Only let bindings support else branches",
            {
              start: else_node.start,
              end: else_node.end,
            },
          ),
        ),
      );
    }
    lowered_else = Applicative.lift(
      (_check: null, branch: FrontExpr) => branch,
      else_check,
      lowered_block,
    );
    const else_diagnostics = diagnostics_of(lowered_else).toSorted(
      (left, right) => {
        if (left.span.start !== right.span.start) {
          return left.span.start - right.span.start;
        }
        if (left.span.end !== right.span.end) {
          return left.span.end - right.span.end;
        }
        return 0;
      },
    );
    if (else_diagnostics.length > 0) {
      lowered_else = fail(...else_diagnostics);
    }
  }
  let lowered_type: Checked<TypeExpr | undefined> = ok(undefined);
  if (type_node !== undefined) {
    lowered_type = lower_baba_type_reference(type_node, source);
  }
  const lowered_pattern = lower_pattern_alternatives(
    pattern_nodes,
    source,
    mode,
  );
  let pattern_check = lowered_pattern;
  const parsed_pattern = checked_value(lowered_pattern);
  if (
    type_node !== undefined && parsed_pattern !== undefined &&
    parsed_pattern.tag !== "binding"
  ) {
    pattern_check = Applicative.lift(
      (_annotation: null, pattern: Pattern) => pattern,
      fail(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Binding annotations require a single name",
          { start: type_node.start, end: type_node.end },
        ),
      ),
      lowered_pattern,
    );
  }
  if (parsed_pattern?.tag === "value") {
    pattern_check = Applicative.lift(
      (_name: null, pattern: Pattern) => pattern,
      fail(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Parameter must use snake_case: " + parsed_pattern.name,
          source_span(parsed_pattern),
        ),
      ),
      pattern_check,
    );
  }
  const lowered_value = lower_expression(value_node, source);
  return Applicative.lift(
    (
      parsed_pattern: Pattern,
      parsed_type: TypeExpr | undefined,
      value: FrontExpr,
      else_branch: FrontExpr | undefined,
    ) => {
      let annotation: string | undefined;
      let type_annotation: TypeExpr | undefined;
      if (parsed_type !== undefined) {
        expect(
          parsed_pattern.tag === "binding",
          "Checked Baba aggregate binding retained a type annotation.",
        );
        annotation = format_type_expr(parsed_type);
        if (parsed_type.tag !== "name") type_annotation = parsed_type;
        parsed_pattern.annotation = annotation;
        if (type_annotation !== undefined) {
          parsed_pattern.type_annotation = type_annotation;
        }
        mark_source_span(parsed_pattern, {
          start: source_span(parsed_pattern).start,
          end: source_span(parsed_type).end,
        });
      }
      let name: string;
      if (parsed_pattern.tag === "binding") {
        name = parsed_pattern.name;
      } else {
        const generated_name = no_demand_names.get(node);
        expect(
          generated_name !== undefined,
          "Baba aggregate binding has no no-demand identity.",
        );
        name = generated_name;
      }
      const statement: Stmt = {
        tag: "bind",
        kind,
        pattern: parsed_pattern,
        name,
        is_recursive: false,
        is_linear: parsed_pattern.tag === "binding" &&
          parsed_pattern.mode === "linear",
        annotation,
        value: apply_function_result_context(value, type_annotation),
      };
      if (type_annotation !== undefined) {
        statement.type_annotation = type_annotation;
      }
      if (else_branch !== undefined) statement.else_branch = else_branch;
      mark_source_span(statement, { start: node.start, end: node.end });
      return statement;
    },
    pattern_check,
    lowered_type,
    lowered_value,
    lowered_else,
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

function lower_effect_binding(
  node: BabaCstNode,
  source: string,
): Checked<Stmt> {
  const binding_node = node.children.find((child) =>
    child.kind === "identifier" || child.kind === "wildcard" ||
    child.kind === "unit_pattern"
  );
  const value_node = node.children.find((child) =>
    child !== binding_node && is_expression_node(child)
  );
  if (binding_node === undefined || value_node === undefined) {
    return unsupported(node);
  }
  let value_name: string | undefined;
  let binding_check: Checked<null> = ok(null);
  if (binding_node.kind === "identifier") {
    value_name = source.slice(binding_node.start, binding_node.end);
    if (!is_snake_case(value_name)) {
      binding_check = fail(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Effect result binding must use snake_case: " + value_name,
          { start: binding_node.start, end: binding_node.end },
        ),
      );
    }
    if (!is_runtime_binding_name(value_name)) {
      binding_check = Applicative.lift(
        (_name: null, _reserved: null) => null,
        binding_check,
        fail(
          compiler_diagnostic(
            diagnostic_codes.syntax_error,
            "Effect result binding name is reserved syntax: " + value_name,
            { start: binding_node.start, end: binding_node.end },
          ),
        ),
      );
    }
    const reserved_feature = unsupported_reserved_feature(value_name);
    if (reserved_feature !== undefined) {
      binding_check = Applicative.lift(
        (_name: null, _reserved: null) => null,
        binding_check,
        fail(
          compiler_diagnostic(
            diagnostic_codes.syntax_error,
            "Effect result binding is reserved for unsupported " +
              reserved_feature + ": " + value_name,
            { start: binding_node.start, end: binding_node.end },
          ),
        ),
      );
    }
  }
  return Applicative.lift(
    (_binding: null, value: FrontExpr) => {
      let statement: Stmt;
      if (direct_effect_bindings.has(node) || is_direct_effect_call(value)) {
        statement = { tag: "state_bind", value_name, value };
      } else if (value_name === undefined) {
        statement = { tag: "expr", expr: value, effectful: true };
      } else {
        statement = {
          tag: "bind",
          kind: "let",
          name: value_name,
          is_linear: false,
          annotation: undefined,
          effectful: true,
          value,
        };
      }
      mark_source_span(statement, { start: node.start, end: node.end });
      return statement;
    },
    binding_check,
    lower_expression(value_node, source),
  );
}

function is_direct_effect_call(value: FrontExpr): boolean {
  if (value.tag !== "app" || value.func.tag !== "field") return false;
  const object = value.func.object;
  if (object.tag === "var") {
    return /^[A-Z][A-Za-z0-9]*$/.test(object.name);
  }
  return object.tag === "field" && object.object.tag === "var" &&
    /^[A-Z][A-Za-z0-9]*$/.test(object.object.name);
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

function lower_module_return(
  node: BabaCstNode,
  source: string,
): Checked<Stmt> {
  const value_node = node.children.find((child) => is_expression_node(child));
  if (value_node === undefined) return lower_return(node, source);
  return lower_expression(value_node, source).map((value) => {
    let return_value = value;
    if (value.tag === "shape") {
      const fields = value.entries.map((entry) => {
        expect(
          entry.label !== undefined,
          "Baba module export shape entry has no label.",
        );
        const field = { name: entry.label, value: entry.value };
        mark_source_span(field, source_span(entry));
        return field;
      });
      return_value = {
        tag: "struct_value",
        type_expr: { tag: "var", name: "object_type" },
        fields,
      };
      mark_source_span(return_value, {
        start: value_node.start,
        end: value_node.end,
      });
    }
    const statement: Stmt = { tag: "return", value: return_value };
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
  const branch_node = node.children.find((child) =>
    child.kind === "conditional_branch"
  );
  if (branch_node === undefined) return unsupported(node);

  return Applicative.lift(
    (test: IfTest, branch: FrontExpr) => {
      expect(
        branch.tag === "block",
        "Baba conditional branch did not lower to a block.",
      );
      const statement = statement_from_if_test(test, branch);
      mark_source_span(statement, { start: node.start, end: node.end });
      if (
        statement.tag === "if_stmt" || statement.tag === "if_let_stmt"
      ) {
        conditional_branch_spans.set(statement, source_span(branch));
      }
      return statement;
    },
    lower_if_test(node, source),
    lower_conditional_branch(
      branch_node,
      source,
      conditional_branch_span(node, branch_node, source),
    ),
  );
}

type IfTest =
  | { tag: "boolean"; condition: FrontExpr }
  | {
    tag: "pattern";
    pattern: Pattern;
    target: FrontExpr;
    span: SourceSpan;
    wildcard_value_name: string | undefined;
  };

function lower_if_test(
  node: BabaCstNode,
  source: string,
): Checked<IfTest> {
  if (!has_direct_token(node, source, "let")) {
    const condition_node = node.children.find((child) =>
      child.kind !== "conditional_branch" && is_expression_node(child)
    );
    if (condition_node === undefined) return unsupported(node);
    return lower_expression(condition_node, source).map((condition) => ({
      tag: "boolean",
      condition,
    }));
  }

  const equals_node = node.children.find((child) =>
    source.slice(child.start, child.end) === "="
  );
  const then_node = node.children.find((child) =>
    source.slice(child.start, child.end) === "then"
  );
  if (equals_node === undefined || then_node === undefined) {
    return unsupported(node);
  }
  const pattern_nodes = node.children.filter((child) =>
    child.end <= equals_node.start && is_pattern_node(child)
  );
  const target_nodes = node.children.filter((child) =>
    child.start >= equals_node.end && child.end <= then_node.start &&
    is_expression_node(child)
  );
  if (pattern_nodes.length === 0 || target_nodes.length !== 1) {
    return unsupported(node);
  }
  const target_node = target_nodes[0];
  expect(target_node !== undefined, "Baba if-let target disappeared.");
  const let_node = node.children.find((child) =>
    source.slice(child.start, child.end) === "let"
  );
  expect(let_node !== undefined, "Baba if-let keyword disappeared.");
  const wildcard_node = pattern_nodes.find((child) =>
    child.kind === "union_pattern"
  )?.children.find((child) => child.kind === "wildcard");
  let wildcard_value_name: string | undefined;
  if (wildcard_node !== undefined) {
    wildcard_value_name = no_demand_names.get(wildcard_node);
    expect(
      wildcard_value_name !== undefined,
      "Baba if-let wildcard has no no-demand identity.",
    );
  }
  return Applicative.lift(
    (pattern: Pattern, target: FrontExpr) => ({
      tag: "pattern",
      pattern,
      target,
      span: { start: let_node.start, end: target_node.end },
      wildcard_value_name,
    }),
    lower_pattern_alternatives(pattern_nodes, source),
    lower_expression(target_node, source),
  );
}

function statement_from_if_test(
  test: IfTest,
  branch: Extract<FrontExpr, { tag: "block" }>,
): Stmt {
  if (test.tag === "boolean") {
    return {
      tag: "if_stmt",
      cond: test.condition,
      body: branch.statements,
    };
  }
  if (test.pattern.tag === "literal") {
    const condition = binary_expression(
      "==",
      test.target,
      test.pattern.value,
    );
    mark_source_span(condition, test.span);
    return {
      tag: "if_stmt",
      cond: condition,
      body: branch.statements,
    };
  }
  const simple_union = simple_if_let_pattern(
    test.pattern,
    test.wildcard_value_name,
  );
  if (simple_union !== undefined) {
    return {
      tag: "if_let_stmt",
      case_name: simple_union.case_name,
      value_name: simple_union.value_name,
      target: test.target,
      body: branch.statements,
    };
  }
  const expression: FrontExpr = {
    tag: "match",
    target: test.target,
    arms: [
      {
        pattern: test.pattern,
        guard: undefined,
        body: branch,
      },
      {
        pattern: { tag: "wildcard", mode: "default" },
        guard: undefined,
        body: { tag: "unit" },
      },
    ],
  };
  return { tag: "expr", expr: expression };
}

function simple_if_let_pattern(
  pattern: Pattern,
  wildcard_value_name: string | undefined,
): { case_name: string; value_name: string | undefined } | undefined {
  if (pattern.tag !== "union_case") return undefined;
  if (pattern.value === undefined || pattern.value.tag === "unit") {
    return { case_name: pattern.name, value_name: undefined };
  }
  if (
    pattern.value.tag === "wildcard" &&
    pattern.value.mode === "default" &&
    wildcard_value_name !== undefined
  ) {
    return { case_name: pattern.name, value_name: wildcard_value_name };
  }
  if (
    pattern.value.tag !== "binding" ||
    pattern.value.mode !== "default" ||
    pattern.value.annotation !== undefined ||
    pattern.value.type_annotation !== undefined
  ) {
    return undefined;
  }
  return { case_name: pattern.name, value_name: pattern.value.name };
}

function lower_expression(
  node: BabaCstNode,
  source: string,
): Checked<FrontExpr> {
  if (
    node.kind === "postfix_expression" ||
    node.kind === "parenthesized_expression" ||
    node.kind === "parenthesized_or_product" ||
    node.kind === "condition_expression" ||
    node.kind === "condition_parenthesized_expression"
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

  if (
    node.kind === "application_expression" ||
    node.kind === "condition_call_expression" ||
    node.kind === "condition_application_expression"
  ) {
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

  if (
    node.kind === "index_expression" ||
    node.kind === "condition_index_expression"
  ) {
    return lower_index_expression(node, source);
  }

  if (
    node.kind === "is_expression" ||
    node.kind === "condition_is_expression"
  ) {
    return lower_type_operator(node, source, "is");
  }

  if (node.kind === "as_expression") {
    return lower_type_operator(node, source, "as");
  }

  if (
    node.kind === "field_expression" ||
    node.kind === "condition_field_expression"
  ) {
    const object_node = node.children.find((child) =>
      is_expression_node(child)
    );
    const field_node = node.children.find((child) =>
      child !== object_node &&
      (child.kind === "identifier" || child.kind === '"end"')
    );
    if (object_node === undefined || field_node === undefined) {
      return unsupported(node);
    }
    const name = source.slice(field_node.start, field_node.end);
    let field_check: Checked<null> = ok(null);
    if (
      name !== "end" && !is_snake_case(name) &&
      !/^[A-Z][A-Za-z0-9]*$/.test(name)
    ) {
      field_check = fail(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Field must use snake_case: " + name,
          { start: field_node.start, end: field_node.end },
        ),
      );
    }
    return Applicative.lift(
      (object: FrontExpr, _field: null) => {
        let expression: FrontExpr;
        if (
          object.tag === "var" && object.name === "Bytes" && name === "empty"
        ) {
          expression = { tag: "text", value: "", encoding: "bytes" };
        } else if (
          object.tag === "var" && object.name === "Bytes" &&
          name === "generate"
        ) {
          expression = { tag: "var", name: "@Bytes.generate" };
        } else if (
          object.tag === "var" && object.name === "Utf8" &&
          (name === "encode" || name === "decode")
        ) {
          expression = { tag: "var", name: "Utf8." + name };
        } else {
          expression = {
            tag: "field",
            object,
            name,
          };
        }
        mark_source_span(expression, { start: node.start, end: node.end });
        return expression;
      },
      lower_expression(object_node, source),
      field_check,
    );
  }

  if (node.kind === "import_expression") {
    return lower_import_expression(node, source);
  }

  if (node.kind === "import_meta_expression") {
    const expression: FrontExpr = {
      tag: "var",
      name: import_meta_binding_name,
    };
    mark_source_span(expression, { start: node.start, end: node.end });
    return ok(expression);
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
    final_statement === undefined ||
    (final_statement.tag !== "if_stmt" &&
      final_statement.tag !== "if_let_stmt") ||
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
  let conditional: FrontExpr;
  if (final_statement.tag === "if_stmt") {
    conditional = {
      tag: "if",
      cond: final_statement.cond,
      then_branch,
      else_branch: { tag: "num", type: "i32", value: 0 },
      implicit_else: true,
    };
  } else {
    conditional = {
      tag: "if_let",
      case_name: final_statement.case_name,
      value_name: final_statement.value_name,
      target: final_statement.target,
      then_branch,
      else_branch: { tag: "num", type: "i32", value: 0 },
      implicit_else: true,
    };
  }
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
  const branch_node = node.children.find((child) =>
    child.kind === "conditional_branch"
  );
  if (branch_node === undefined) return unsupported(node);

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

    const alternative_branch = alternative.children.find((child) =>
      child.kind === "conditional_branch"
    );
    if (alternative_branch === undefined) {
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
        test: IfTest,
        then_branch: FrontExpr,
        nested_else: FrontExpr,
      ) => {
        const expression = expression_from_if_test(
          test,
          then_branch,
          nested_else,
          alternative_has_implicit_else,
        );
        let expression_end = source_span(then_branch).end;
        if (!alternative_has_implicit_else) {
          expression_end = source_span(nested_else).end;
        }
        mark_source_span(expression, {
          start: alternative.start,
          end: expression_end,
        });
        return expression;
      },
      lower_if_test(alternative, source),
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
      test: IfTest,
      then_branch: FrontExpr,
      lowered_else: FrontExpr,
    ) => {
      const expression = expression_from_if_test(
        test,
        then_branch,
        lowered_else,
        implicit_else,
      );
      mark_source_span(expression, { start: node.start, end: node.end });
      return expression;
    },
    lower_if_test(node, source),
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

function expression_from_if_test(
  test: IfTest,
  then_branch: FrontExpr,
  else_branch: FrontExpr,
  implicit_else: boolean,
): FrontExpr {
  if (test.tag === "boolean") {
    const expression: Extract<FrontExpr, { tag: "if" }> = {
      tag: "if",
      cond: test.condition,
      then_branch,
      else_branch,
    };
    if (implicit_else) expression.implicit_else = true;
    return expression;
  }
  if (test.pattern.tag === "literal") {
    const condition = binary_expression(
      "==",
      test.target,
      test.pattern.value,
    );
    mark_source_span(condition, test.span);
    const expression: Extract<FrontExpr, { tag: "if" }> = {
      tag: "if",
      cond: condition,
      then_branch,
      else_branch,
    };
    if (implicit_else) expression.implicit_else = true;
    return expression;
  }
  const simple_union = simple_if_let_pattern(
    test.pattern,
    test.wildcard_value_name,
  );
  if (simple_union !== undefined) {
    const expression: Extract<FrontExpr, { tag: "if_let" }> = {
      tag: "if_let",
      case_name: simple_union.case_name,
      value_name: simple_union.value_name,
      target: test.target,
      then_branch,
      else_branch,
    };
    if (implicit_else) expression.implicit_else = true;
    return expression;
  }
  return {
    tag: "match",
    target: test.target,
    arms: [
      {
        pattern: test.pattern,
        guard: undefined,
        body: then_branch,
      },
      {
        pattern: { tag: "wildcard", mode: "default" },
        guard: undefined,
        body: else_branch,
      },
    ],
  };
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
  let start = previous.end;
  if (!/[\r\n]/.test(source.slice(previous.end, branch.start))) {
    start = branch.start;
  }
  if (!/[\r\n]/.test(source.slice(branch.end, end))) {
    end = branch.end;
  }
  return { start, end };
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

function lower_type_operator(
  node: BabaCstNode,
  source: string,
  operator: "is" | "as",
): Checked<FrontExpr> {
  const value_node = node.children.find((child) => is_expression_node(child));
  const type_node = node.children.find((child) =>
    child.kind === "type_reference"
  );
  if (value_node === undefined || type_node === undefined) {
    return unsupported(node);
  }
  return Applicative.lift(
    (value: FrontExpr, type_expr: TypeExpr) => {
      let expression: FrontExpr;
      if (operator === "is") {
        expression = { tag: "is", value, type_expr };
      } else {
        expression = { tag: "as", value, type_expr };
      }
      mark_source_span(expression, { start: node.start, end: node.end });
      return expression;
    },
    lower_expression(value_node, source),
    lower_baba_type_reference(type_node, source),
  );
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
    operator !== "freeze" && operator !== "comptime" &&
    operator !== "perform"
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
  } else if (operator === "comptime") {
    expression = { tag: "comptime", expr: value };
  } else {
    expression = {
      tag: "app",
      func: {
        tag: "field",
        object: { tag: "var", name: "Do" },
        name: "unwrap",
      },
      args: [value],
    };
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
  const left_span = source_span(left);
  const right_span = source_span(right);
  const span = {
    start: Math.min(left_span.start, right_span.start),
    end: Math.max(left_span.end, right_span.end),
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
    if (name_node.kind === "identifier") {
      const name = source.slice(name_node.start, name_node.end);
      if (!is_runtime_binding_name(name)) {
        parameter_diagnostics.push(
          compiler_diagnostic(
            diagnostic_codes.syntax_error,
            "Parameter name is reserved syntax: " + name,
            { start: name_node.start, end: name_node.end },
          ),
        );
      }
      const reserved_feature = unsupported_reserved_feature(name);
      if (reserved_feature !== undefined) {
        parameter_diagnostics.push(
          compiler_diagnostic(
            diagnostic_codes.syntax_error,
            "Parameter is reserved for unsupported " + reserved_feature +
              ": " + name,
            { start: name_node.start, end: name_node.end },
          ),
        );
      }
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
    node.kind === "condition_parenthesized_expression" ||
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
    node.kind === "condition_call_expression" ||
    node.kind === "condition_application_expression" ||
    node.kind === "positional_product" ||
    node.kind === "block" ||
    node.kind === "if_expression" ||
    node.kind === "condition_unary_expression" ||
    node.kind === "unary_expression" ||
    node.kind === "array_expression" ||
    node.kind === "shape_value" ||
    node.kind === "named_product" ||
    node.kind === "index_expression" ||
    node.kind === "condition_index_expression" ||
    node.kind === "is_expression" ||
    node.kind === "condition_is_expression" ||
    node.kind === "as_expression" ||
    node.kind === "field_expression" ||
    node.kind === "condition_field_expression" ||
    node.kind === "import_meta_expression" ||
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
