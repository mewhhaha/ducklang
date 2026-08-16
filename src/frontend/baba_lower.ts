import { Applicative } from "@mewhhaha/typeclasses";
import { classify_abi_primitive } from "../abi_primitive.ts";
import {
  compiler_diagnostic,
  diagnostic_codes,
  diagnostic_sequence,
} from "../diagnostic.ts";
import { expect } from "../expect.ts";
import { integer_literal_fits, integer_type_name } from "../integer.ts";
import { wasm_intrinsic_prim } from "../op.ts";
import { is_snake_case, no_demand_name } from "./names.ts";
import type {
  AttributeGroup,
  Declaration,
  FrontExpr,
  HandlerClause,
  HandlerReturnClause,
  HandlerState,
  MatchArm,
  ModuleHeader,
  Param,
  Pattern,
  ProductPatternEntry,
  RecursiveBinding,
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
import {
  contains_hole,
  contains_hole_lambda,
  hole_name,
  mark_hole_lambda,
} from "./hole.ts";
import { import_meta_binding_name } from "./import_meta.ts";
import { binary_prim, numeric_expr_type } from "./numeric.ts";
import { parse_number_expr } from "./number_literal.ts";
import { apply_function_result_context } from "./function_context.ts";
import { decode_literal_escape } from "./literal.ts";
import { format_type_expr } from "./type_expr.ts";
import {
  derive_missing_source_spans,
  derive_source_span,
  mark_source_span,
  source_span,
  source_span_origin,
  type SourceSpan,
} from "./syntax.ts";
import {
  is_builtin_type_reference_name,
  is_runtime_binding_name,
  module_value,
  unsupported_reserved_feature,
} from "./parser_support.ts";
import {
  pattern_binding_occurrences,
  pattern_bindings,
  record_pattern_binding_span,
} from "./pattern.ts";
import { expression_does_not_fall_through } from "./termination.ts";
import {
  baba_infix_fixity,
  baba_prefix_fixity,
  type BabaPrefixFixity,
  index_baba_fixities,
  lower_indexed_baba_fixity,
} from "./baba_fixity.ts";

const conditional_branch_spans = new WeakMap<object, SourceSpan>();
const no_demand_names = new WeakMap<BabaCstNode, string>();
const synthetic_parameter_names = new WeakMap<BabaCstNode, string>();
const direct_effect_bindings = new WeakSet<BabaCstNode>();
const lifted_expression_prefixes = new WeakMap<
  BabaCstNode,
  BabaPrefixFixity
>();
const lifted_prefix_references = new WeakSet<BabaCstNode>();
const suppressed_expression_prefixes = new WeakSet<BabaCstNode>();
const semantic_proof_placeholders = new WeakSet<BabaCstNode>();
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
  index_baba_fixities(parsed);
  index_expression_prefixes(root, parsed.cst.text);
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

function index_expression_prefixes(root: BabaCstNode, source: string): void {
  const parents = new WeakMap<BabaCstNode, BabaCstNode>();
  const references: BabaCstNode[] = [];
  const scopes: BabaCstNode[] = [];
  const pending = [root];

  while (pending.length > 0) {
    const node = pending.pop();
    expect(node !== undefined, "Baba linear-call indexing work disappeared.");
    if (node.kind === "block" || node.kind === "source_file") {
      scopes.push(node);
    }
    if (node.kind === "linear_reference") references.push(node);
    for (const child of node.children) {
      parents.set(child, node);
      pending.push(child);
    }
  }

  type IndexedBindingMode = {
    end: number;
    linear: boolean;
  };
  const scoped_bindings = new WeakMap<
    BabaCstNode,
    Map<string, IndexedBindingMode[]>
  >();

  for (const scope of scopes) {
    const bindings = new Map<string, IndexedBindingMode[]>();

    for (const statement of scope.children) {
      if (statement.kind !== "binding_statement") continue;
      const equals = statement.children.find((child) =>
        source.slice(child.start, child.end) === "="
      );
      if (equals === undefined) continue;
      const pattern_nodes = statement.children.filter((child) =>
        child.end <= equals.start && is_pattern_node(child)
      );
      if (pattern_nodes.length === 0) continue;
      let default_mode: "default" | "linear" = "default";
      if (
        statement.children.some((child) =>
          source.slice(child.start, child.end) === "!"
        )
      ) {
        default_mode = "linear";
      }
      const pattern = checked_value(
        lower_pattern_alternatives(pattern_nodes, source, default_mode),
      );
      if (pattern === undefined) continue;

      for (const binding of pattern_bindings(pattern)) {
        let modes = bindings.get(binding.name);
        if (modes === undefined) {
          modes = [];
          bindings.set(binding.name, modes);
        }
        modes.push({
          end: statement.end,
          linear: binding.mode === "linear",
        });
      }
    }

    scoped_bindings.set(scope, bindings);
  }

  const parameter_mode = (
    parameter: BabaCstNode,
    name: string,
  ): boolean | undefined => {
    const name_node = parameter.children.find((child) =>
      child.kind === "identifier"
    );
    if (
      name_node === undefined ||
      source.slice(name_node.start, name_node.end) !== name
    ) {
      return undefined;
    }
    return parameter.children.some((child) =>
      source.slice(child.start, child.end) === "!"
    );
  };

  const arrow_parameter_mode = (
    arrow: BabaCstNode,
    name: string,
  ): boolean | undefined => {
    const parameter_list = arrow.children.find((child) =>
      child.kind === "parameter_list"
    );
    if (parameter_list !== undefined) {
      for (
        const parameter of parameter_list.children.filter((child) =>
          child.kind === "parameter"
        )
      ) {
        const mode = parameter_mode(parameter, name);
        if (mode !== undefined) return mode;
      }
      return undefined;
    }
    const parameter = arrow.children.find((child) =>
      child.kind === "parameter"
    );
    if (parameter === undefined) return undefined;
    return parameter_mode(parameter, name);
  };

  const scoped_binding_mode = (
    scope: BabaCstNode,
    name: string,
    before: number,
  ): boolean | undefined => {
    const modes = scoped_bindings.get(scope)?.get(name);
    if (modes === undefined) return undefined;
    let lower = 0;
    let upper = modes.length;

    while (lower < upper) {
      const middle = Math.floor((lower + upper) / 2);
      const candidate = modes[middle];
      expect(candidate !== undefined, "Baba binding-mode index has a hole.");
      if (candidate.end <= before) {
        lower = middle + 1;
      } else {
        upper = middle;
      }
    }

    if (lower === 0) return undefined;
    const mode = modes[lower - 1];
    expect(mode !== undefined, "Baba binding-mode search lost its result.");
    return mode.linear;
  };

  const module_parameter_mode = (
    header: BabaCstNode,
    name: string,
  ): boolean | undefined => {
    const parameter_list = header.children.find((child) =>
      child.kind === "parameter_list"
    );
    if (parameter_list === undefined) return undefined;
    for (
      const parameter of parameter_list.children.filter((child) =>
        child.kind === "parameter"
      )
    ) {
      const mode = parameter_mode(parameter, name);
      if (mode !== undefined) return mode;
    }
    return undefined;
  };

  for (const reference of references) {
    const operator_node = reference.children.find((child) =>
      source.slice(child.start, child.end) === "!"
    );
    const name_node = reference.children.find((child) =>
      child.kind === "identifier"
    );
    if (operator_node === undefined || name_node === undefined) continue;
    const name = source.slice(name_node.start, name_node.end);
    let branch = reference;
    let ancestor = parents.get(branch);
    let mode: boolean | undefined;
    if (name === "resume") {
      mode = true;
    }

    while (ancestor !== undefined && mode === undefined) {
      if (ancestor.kind === "arrow_function") {
        mode = arrow_parameter_mode(ancestor, name);
      }
      if (ancestor.kind === "block" || ancestor.kind === "source_file") {
        mode = scoped_binding_mode(ancestor, name, branch.start);
        if (mode === undefined && ancestor.kind === "source_file") {
          const header = ancestor.children.find((child) =>
            child.kind === "module_header" && child.end <= branch.start
          );
          if (header !== undefined) {
            mode = module_parameter_mode(header, name);
          }
        }
      }
      branch = ancestor;
      ancestor = parents.get(ancestor);
    }

    const fixity = baba_prefix_fixity(operator_node);
    if (fixity === undefined) continue;
    let direct_function: BabaCstNode = reference;
    let direct_parent = parents.get(direct_function);
    while (
      direct_parent !== undefined &&
      (
        direct_parent.kind === "postfix_expression" ||
        direct_parent.kind === "condition_postfix_expression"
      ) &&
      semantic_child(direct_parent) === direct_function
    ) {
      direct_function = direct_parent;
      direct_parent = parents.get(direct_function);
    }
    let parenthesized_call = false;
    if (
      direct_parent?.kind === "application_expression" ||
      direct_parent?.kind === "call_expression" ||
      direct_parent?.kind === "condition_call_expression"
    ) {
      const direct_expressions = direct_parent.children.filter((child) =>
        is_expression_node(child)
      );
      const argument_node = direct_expressions[1];
      let direct_argument_node: BabaCstNode | undefined = argument_node;
      while (
        direct_argument_node?.kind === "postfix_expression" ||
        direct_argument_node?.kind === "condition_postfix_expression"
      ) {
        direct_argument_node = semantic_child(direct_argument_node);
      }
      parenthesized_call = direct_expressions[0] === direct_function &&
        argument_node !== undefined &&
        !/[\r\n]/.test(
          source.slice(direct_function.end, argument_node.start),
        ) &&
        direct_argument_node !== undefined &&
        (
          direct_argument_node.kind === "parenthesized_or_product" ||
          direct_argument_node.kind === "parenthesized_expression" ||
          direct_argument_node.kind === "positional_product" ||
          direct_argument_node.kind === "named_product" ||
          direct_argument_node.kind === "unit_pattern" ||
          direct_argument_node.kind === "condition_call_arguments" ||
          direct_argument_node.kind === "condition_parenthesized_expression" ||
          direct_argument_node.kind === "condition_positional_product"
        );
    }
    if (
      fixity.target === "@syntax.not" &&
      (mode === true || !parenthesized_call)
    ) {
      continue;
    }

    let prefix_owner = reference;
    let outer = parents.get(prefix_owner);
    while (outer !== undefined) {
      const outer_expressions = outer.children.filter((child) =>
        is_expression_node(child)
      );
      if (outer_expressions[0] !== prefix_owner) break;
      const outer_argument = outer_expressions[1];
      if (
        outer_argument !== undefined &&
        (
          outer.kind === "application_expression" ||
          outer.kind === "call_expression" ||
          outer.kind === "condition_call_expression" ||
          outer.kind === "condition_application_expression"
        ) &&
        /[\r\n]/.test(
          source.slice(prefix_owner.end, outer_argument.start),
        )
      ) {
        break;
      }
      if (
        outer.kind !== "postfix_expression" &&
        outer.kind !== "condition_postfix_expression" &&
        outer.kind !== "condition_expression" &&
        outer.kind !== "application_expression" &&
        outer.kind !== "call_expression" &&
        outer.kind !== "condition_call_expression" &&
        outer.kind !== "condition_application_expression" &&
        outer.kind !== "field_expression" &&
        outer.kind !== "condition_field_expression" &&
        outer.kind !== "index_expression" &&
        outer.kind !== "condition_index_expression"
      ) {
        break;
      }
      prefix_owner = outer;
      outer = parents.get(prefix_owner);
    }
    if (
      fixity.target === "@syntax.not" &&
      outer !== undefined &&
      (
        outer.kind === "application_expression" ||
        outer.kind === "condition_application_expression"
      )
    ) {
      const outer_expressions = outer.children.filter((child) =>
        is_expression_node(child)
      );
      if (outer_expressions[1] === prefix_owner) continue;
    }
    lifted_expression_prefixes.set(prefix_owner, fixity);
    lifted_prefix_references.add(reference);
  }
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
        node.kind !== "declare_record_statement" &&
        node.kind !== "duck_declaration_statement"
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
      let inherited_instances: ReadonlySet<string> = instances;
      let inherited_known_values: ReadonlyMap<string, FrontExpr> = known_values;
      if (
        node.kind === "binding_statement" &&
        node.children.some((child) => child.kind === '"rec"')
      ) {
        const recursive_instances = new Set(instances);
        const recursive_known_values = new Map(known_values);
        for (const name of binding_statement_names(node, source)) {
          recursive_instances.delete(name);
          recursive_known_values.delete(name);
        }
        inherited_instances = recursive_instances;
        inherited_known_values = recursive_known_values;
      }
      const tracked_names = new Set(inherited_instances);
      for (const name of inherited_known_values.keys()) tracked_names.add(name);
      const assigned_outer_names = nested_assigned_outer_names(
        node,
        tracked_names,
        source,
      );
      index_nested_sequences(
        node,
        inherited_instances,
        effects,
        ordinary_constructors,
        inherited_known_values,
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
      if (node.kind === "module_binding_statement") {
        const module_name_node = node.children.find((child) =>
          child.kind === "identifier"
        );
        if (module_name_node !== undefined) {
          const module_name = source.slice(
            module_name_node.start,
            module_name_node.end,
          );
          instances.delete(module_name);
          known_values.delete(module_name);
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
      for (const name of binding_statement_names(node, source)) {
        instances.delete(name);
        known_values.delete(name);
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
    if (
      node.kind === "arrow_function" || node.kind === "recursive_function"
    ) {
      const shadowed = new Set(instances);
      const shadowed_known_values = new Map(known_values);
      const parameter_container = node.children.find((child) =>
        child.kind === "parameter" || child.kind === "parameter_list" ||
        child.kind === "bracket_parameter_list" ||
        (node.kind === "recursive_function" &&
          (child.kind === "identifier" || child.kind === "wildcard"))
      );
      if (parameter_container !== undefined) {
        let parameters = [parameter_container];
        if (
          parameter_container.kind === "parameter_list" ||
          parameter_container.kind === "bracket_parameter_list"
        ) {
          parameters = parameter_container.children.filter((child) =>
            child.kind === "parameter"
          );
        }
        for (const parameter of parameters) {
          let identifier: BabaCstNode | undefined;
          if (parameter.kind === "identifier") {
            identifier = parameter;
          } else {
            identifier = parameter.children.find((child) =>
              child.kind === "identifier"
            );
          }
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
    const case_bindings = case_arm_pattern_binding_names(node, source);
    if (case_bindings.length > 0) {
      const shadowed = new Set(nested_instances);
      const shadowed_known_values = new Map(nested_known_values);
      for (const name of case_bindings) {
        shadowed.delete(name);
        shadowed_known_values.delete(name);
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
    let loop_instances = nested_instances;
    let loop_known_values = nested_known_values;
    const loop_bindings = for_pattern_binding_names(node, source);
    if (loop_bindings.length > 0) {
      const shadowed = new Set(nested_instances);
      const shadowed_known_values = new Map(nested_known_values);
      for (const name of loop_bindings) {
        shadowed.delete(name);
        shadowed_known_values.delete(name);
      }
      loop_instances = shadowed;
      loop_known_values = shadowed_known_values;
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
        } else if (node.kind === "for_statement") {
          child_instances = loop_instances;
          child_known_values = loop_known_values;
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
      if (
        current.kind === "arrow_function" ||
        current.kind === "recursive_function"
      ) {
        continue;
      }
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
      for (const name of binding_statement_names(current, source)) {
        visible_names.delete(name);
      }
    }
  }

  function visit_nested(
    current: BabaCstNode,
    visible_names: ReadonlySet<string>,
  ): void {
    if (
      current.kind === "arrow_function" ||
      current.kind === "recursive_function"
    ) {
      return;
    }
    let conditional_names = visible_names;
    const bindings = conditional_pattern_binding_names(current, source);
    if (bindings.length > 0) {
      const shadowed = new Set(visible_names);
      for (const name of bindings) shadowed.delete(name);
      conditional_names = shadowed;
    }
    let case_names = visible_names;
    const case_bindings = case_arm_pattern_binding_names(current, source);
    if (case_bindings.length > 0) {
      const shadowed = new Set(visible_names);
      for (const name of case_bindings) shadowed.delete(name);
      case_names = shadowed;
    }
    let loop_names = visible_names;
    const loop_bindings = for_pattern_binding_names(current, source);
    if (loop_bindings.length > 0) {
      const shadowed = new Set(visible_names);
      for (const name of loop_bindings) shadowed.delete(name);
      loop_names = shadowed;
    }
    for (const child of current.children) {
      if (
        child.kind === "block" ||
        child.kind === "conditional_branch"
      ) {
        if (child.kind === "conditional_branch") {
          visit_sequence(child.children, conditional_names);
        } else if (current.kind === "for_statement") {
          visit_sequence(child.children, loop_names);
        } else if (current.kind === "case_arm") {
          visit_sequence(child.children, case_names);
        } else {
          visit_sequence(child.children, visible_names);
        }
        continue;
      }
      if (current.kind === "case_arm") {
        visit_nested(child, case_names);
      } else {
        visit_nested(child, visible_names);
      }
    }
  }

  visit_nested(node, outer_names);
  return assigned_names;
}

function binding_statement_names(
  node: BabaCstNode,
  source: string,
): string[] {
  if (node.kind !== "binding_statement") return [];
  const equals_node = node.children.find((child) => child.kind === '"="');
  if (equals_node === undefined) return [];
  const pattern_nodes = node.children.filter((child) =>
    child.end <= equals_node.start && is_pattern_node(child)
  );
  const pattern = checked_value(
    lower_pattern_alternatives(pattern_nodes, source),
  );
  if (pattern === undefined) return [];
  const names = pattern_bindings(pattern).map((binding) => binding.name);
  for (let index = 0; index < node.children.length; index += 1) {
    const marker = node.children[index];
    if (marker?.kind !== '"and"') continue;
    const member_name_node = node.children[index + 1];
    if (member_name_node?.kind !== "identifier") continue;
    names.push(source.slice(member_name_node.start, member_name_node.end));
  }
  return names;
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

function case_arm_pattern_binding_names(
  node: BabaCstNode,
  source: string,
): string[] {
  if (node.kind !== "case_arm") return [];
  const arrow_node = node.children.find((child) => child.kind === '"=>"');
  if (arrow_node === undefined) return [];
  const pattern_nodes = node.children.filter((child) =>
    child.end <= arrow_node.start && is_pattern_node(child)
  );
  if (pattern_nodes.length !== 1) return [];
  const pattern = checked_value(
    lower_pattern_alternatives(pattern_nodes, source),
  );
  if (pattern === undefined) return [];
  return pattern_bindings(pattern).map((binding) => binding.name);
}

type BabaForHeader =
  | {
    tag: "range";
    collection_index_pattern_nodes: BabaCstNode[];
    range_pattern_nodes: BabaCstNode[];
    start_node: BabaCstNode;
    end_node: BabaCstNode;
    step_node: BabaCstNode | undefined;
    range_operator: BabaCstNode;
    body_node: BabaCstNode;
  }
  | {
    tag: "collection";
    index_pattern_nodes: BabaCstNode[];
    item_pattern_nodes: BabaCstNode[];
    collection_node: BabaCstNode;
    body_node: BabaCstNode;
  };

function read_baba_for_header(
  node: BabaCstNode,
  source: string,
): BabaForHeader | undefined {
  if (node.kind !== "for_statement") return undefined;
  const body_node = node.children.find((child) => child.kind === "block");
  if (body_node === undefined) return undefined;
  const in_node = node.children.find((child) =>
    source.slice(child.start, child.end) === "in"
  );
  const comma_node = node.children.find((child) =>
    source.slice(child.start, child.end) === ","
  );
  const range_operator = node.children.find((child) => {
    const text = source.slice(child.start, child.end);
    return text === ".." || text === "..=";
  });
  let expression_start = node.start;
  if (in_node !== undefined) expression_start = in_node.end;
  const expression_nodes = node.children.filter((child) =>
    child !== body_node && child.start >= expression_start &&
    is_expression_node(child)
  );
  if (range_operator === undefined) {
    if (in_node === undefined || expression_nodes.length !== 1) {
      return undefined;
    }
    const collection_node = expression_nodes[0];
    expect(
      collection_node !== undefined,
      "Baba collection expression disappeared.",
    );
    let index_pattern_nodes: BabaCstNode[] = [];
    let item_pattern_nodes = node.children.filter((child) =>
      child.end <= in_node.start && is_pattern_node(child)
    );
    if (comma_node !== undefined) {
      index_pattern_nodes = item_pattern_nodes.filter((child) =>
        child.end <= comma_node.start
      );
      item_pattern_nodes = item_pattern_nodes.filter((child) =>
        child.start >= comma_node.end
      );
    }
    if (
      item_pattern_nodes.length === 0 ||
      index_pattern_nodes.length > 1 ||
      item_pattern_nodes.length > 1
    ) {
      return undefined;
    }
    return {
      tag: "collection",
      index_pattern_nodes,
      item_pattern_nodes,
      collection_node,
      body_node,
    };
  }
  if (
    expression_nodes.length < 2 || expression_nodes.length > 3
  ) {
    return undefined;
  }
  const start_node = expression_nodes[0];
  const end_node = expression_nodes[1];
  expect(start_node !== undefined, "Baba range start disappeared.");
  expect(end_node !== undefined, "Baba range end disappeared.");
  let collection_index_pattern_nodes: BabaCstNode[] = [];
  let range_pattern_nodes: BabaCstNode[] = [];
  if (in_node !== undefined) {
    range_pattern_nodes = node.children.filter((child) =>
      child.end <= in_node.start && is_pattern_node(child)
    );
    if (comma_node !== undefined) {
      collection_index_pattern_nodes = range_pattern_nodes.filter((child) =>
        child.end <= comma_node.start
      );
      range_pattern_nodes = range_pattern_nodes.filter((child) =>
        child.start >= comma_node.end
      );
    }
  }
  if (
    collection_index_pattern_nodes.length > 1 ||
    range_pattern_nodes.length > 1
  ) {
    return undefined;
  }
  return {
    tag: "range",
    collection_index_pattern_nodes,
    range_pattern_nodes,
    start_node,
    end_node,
    step_node: expression_nodes[2],
    range_operator,
    body_node,
  };
}

function for_pattern_binding_names(
  node: BabaCstNode,
  source: string,
): string[] {
  const header = read_baba_for_header(node, source);
  if (header === undefined) return [];
  let pattern_nodes: BabaCstNode[] = [];
  if (header.tag === "range") {
    pattern_nodes = [
      ...header.collection_index_pattern_nodes,
      ...header.range_pattern_nodes,
    ];
  } else {
    pattern_nodes = [
      ...header.index_pattern_nodes,
      ...header.item_pattern_nodes,
    ];
  }
  const names: string[] = [];
  for (const pattern_node of pattern_nodes) {
    const pattern = checked_value(
      lower_pattern_alternatives([pattern_node], source),
    );
    if (pattern === undefined) continue;
    for (const binding of pattern_bindings(pattern)) {
      names.push(binding.name);
    }
  }
  return names;
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
  const value = checked_value(lower_expression(value_node, source));
  if (value?.tag !== "app" || value.func.tag !== "field") return undefined;
  if (value.func.object.tag !== "var") return undefined;
  return value.func.object.name;
}

function effect_instance_constructor(
  node: BabaCstNode,
  source: string,
): { name: string; applied: boolean } | undefined {
  const expression = unwrap_transparent_expression(node);
  let applied = false;
  let function_node = expression;
  if (
    expression.kind === "application_expression" ||
    expression.kind === "call_expression"
  ) {
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
    let deferred_for_pattern:
      | { node: BabaCstNode; kind: "no_demand" | "internal" }
      | undefined;
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
    if (node.kind === "computational_open_statement") {
      no_demand_names.set(node, no_demand_name(next_no_demand));
      next_no_demand += 1;
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
    if (node.kind === "for_statement") {
      const header = read_baba_for_header(node, source);
      if (header?.tag === "range") {
        const index_wildcard = header.collection_index_pattern_nodes.find(
          (candidate) => candidate.kind === "wildcard",
        );
        if (index_wildcard !== undefined) {
          no_demand_names.set(
            index_wildcard,
            no_demand_name(next_no_demand),
          );
          next_no_demand += 1;
        }
        if (header.range_pattern_nodes.length === 0) {
          no_demand_names.set(node, no_demand_name(next_no_demand));
          next_no_demand += 1;
        } else {
          const wildcard = header.range_pattern_nodes.find((candidate) =>
            candidate.kind === "wildcard"
          );
          if (wildcard !== undefined) {
            no_demand_names.set(wildcard, no_demand_name(next_no_demand));
            next_no_demand += 1;
          }
        }
      }
      if (header?.tag === "collection") {
        const index_wildcard = header.index_pattern_nodes.find((candidate) =>
          candidate.kind === "wildcard"
        );
        if (index_wildcard !== undefined) {
          no_demand_names.set(
            index_wildcard,
            no_demand_name(next_no_demand),
          );
          next_no_demand += 1;
        }
        const item_pattern = header.item_pattern_nodes[0];
        if (item_pattern?.kind === "wildcard") {
          deferred_for_pattern = {
            node: item_pattern,
            kind: "no_demand",
          };
        } else if (item_pattern?.kind !== "identifier") {
          deferred_for_pattern = {
            node,
            kind: "internal",
          };
        }
      }
    }
    if (
      node.kind === "handler_operation_clause" ||
      node.kind === "handler_return_clause"
    ) {
      const arrow = node.children.find((child) =>
        child.kind === "arrow_function"
      );
      const parameter_container = arrow?.children.find((child) =>
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
          const wildcard = parameter.children.find((child) =>
            child.kind === "wildcard"
          );
          if (wildcard === undefined) continue;
          synthetic_parameter_names.set(
            parameter,
            no_demand_name(next_no_demand),
          );
          next_no_demand += 1;
        }
      }
    }
    if (
      node.kind === "arrow_function" || node.kind === "recursive_function"
    ) {
      const parameter_container = node.children.find((child) =>
        child.kind === "parameter" || child.kind === "parameter_list" ||
        child.kind === "bracket_parameter_list" ||
        (node.kind === "recursive_function" &&
          (child.kind === "identifier" || child.kind === "wildcard"))
      );
      if (parameter_container !== undefined) {
        let parameter_offset = parameter_container.start;
        if (node.kind === "recursive_function") {
          parameter_offset = node.start;
        }
        const source_offset = source_token_index(
          source,
          tokens,
          parameter_offset,
        );
        if (parameter_container.kind === "bracket_parameter_list") {
          synthetic_parameter_names.set(
            parameter_container,
            "_pattern#param" + source_offset.toString(),
          );
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
        } else if (
          parameter_container.kind === "parameter" ||
          parameter_container.kind === "wildcard"
        ) {
          let wildcard: BabaCstNode | undefined;
          if (parameter_container.kind === "wildcard") {
            wildcard = parameter_container;
          } else {
            wildcard = parameter_container.children.find((child) =>
              child.kind === "wildcard"
            );
          }
          if (wildcard !== undefined) {
            if (!synthetic_parameter_names.has(parameter_container)) {
              synthetic_parameter_names.set(
                parameter_container,
                "_pattern#param" + source_offset.toString(),
              );
            }
          }
        } else if (parameter_container.kind === "parameter_list") {
          const parameters = parameter_container.children.filter((child) =>
            child.kind === "parameter"
          );
          const is_value_pack = parameter_container.children.some((child) =>
            child.kind === '","'
          );
          if (parameters.length === 1 && !is_value_pack) {
            const parameter = parameters[0];
            expect(
              parameter !== undefined,
              "Baba single parameter disappeared.",
            );
            const wildcard = parameter.children.find((child) =>
              child.kind === "wildcard"
            );
            if (wildcard !== undefined) {
              if (!synthetic_parameter_names.has(parameter)) {
                synthetic_parameter_names.set(
                  parameter,
                  "_pattern#param" + source_offset.toString(),
                );
              }
            }
          }
          let ignored = 0;
          for (const parameter of parameters) {
            if (parameters.length === 1 && !is_value_pack) continue;
            const wildcard = parameter.children.find((child) =>
              child.kind === "wildcard"
            );
            if (wildcard === undefined) continue;
            if (!synthetic_parameter_names.has(parameter)) {
              synthetic_parameter_names.set(
                parameter,
                "_pattern#ignored" + source_offset.toString() + "#" +
                  ignored.toString(),
              );
            }
            ignored += 1;
          }
        }
      }
    }
    for (const child of node.children) visit(child);
    if (deferred_for_pattern?.kind === "no_demand") {
      no_demand_names.set(
        deferred_for_pattern.node,
        no_demand_name(next_no_demand),
      );
      next_no_demand += 1;
    }
    if (deferred_for_pattern?.kind === "internal") {
      no_demand_names.set(
        deferred_for_pattern.node,
        "@for_pattern_" + next_no_demand.toString(),
      );
      next_no_demand += 1;
    }
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
    } else if (node.kind === "duck_declaration_statement") {
      declaration = lower_duck_declaration(node, source);
    } else if (node.kind === "extension_declaration_statement") {
      declaration = lower_extension_declaration(node, source);
    } else if (node.kind === "fixity_declaration_statement") {
      declaration = lower_indexed_baba_fixity(node);
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
      const attribute_nodes = node.children.filter((child) =>
        child.kind === "attribute_group"
      );
      if (attribute_nodes.length > 0) {
        declaration = Applicative.lift(
          (
            attribute_groups: AttributeGroup[],
            lowered_declaration: Declaration,
          ) => {
            const attributed_declaration: Declaration = {
              ...lowered_declaration,
              attribute_groups,
            };
            mark_source_span(attributed_declaration, {
              start: node.start,
              end: node.end,
            });
            return attributed_declaration;
          },
          lower_attribute_groups(attribute_nodes, source),
          declaration,
        );
      }
      let name_node: BabaCstNode | undefined;
      if (node.kind !== "extension_declaration_statement") {
        name_node = node.children.find((child) =>
          child.kind === "identifier" || child.kind === "effect_identifier"
        );
      }
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
      (current: LoweredTopLevel, statements: Stmt[]) => {
        return {
          module: current.module,
          declarations: current.declarations,
          statements: [...current.statements, ...statements],
        };
      },
      contents,
      lower_statement_entries(node, source),
    );
  }
  const diagnostics = diagnostic_sequence(diagnostics_of(contents));
  if (diagnostics.length > 0) return fail(...diagnostics);
  return contents;
}

function lower_attribute_groups(
  attribute_nodes: readonly BabaCstNode[],
  source: string,
): Checked<AttributeGroup[]> {
  let lowered_groups: Checked<AttributeGroup[]> = ok([]);
  for (const attribute_node of attribute_nodes) {
    const expression_nodes = attribute_node.children.filter((child) =>
      is_expression_node(child)
    );
    let lowered_attributes: Checked<FrontExpr[]> = ok([]);
    if (expression_nodes.length === 0) {
      lowered_attributes = unsupported(attribute_node);
    } else {
      for (const expression_node of expression_nodes) {
        lowered_attributes = Applicative.lift(
          (
            attributes: FrontExpr[],
            attribute: FrontExpr,
          ) => [...attributes, attribute],
          lowered_attributes,
          lower_expression(expression_node, source),
        );
      }
    }
    const lowered_group = lowered_attributes.map((attributes) => {
      const group: AttributeGroup = { attributes };
      if (
        /[\r\n]/.test(
          source.slice(attribute_node.start, attribute_node.end),
        )
      ) {
        group.multiline = true;
      }
      mark_source_span(group, {
        start: attribute_node.start,
        end: attribute_node.end,
      });
      return group;
    });
    lowered_groups = Applicative.lift(
      (
        groups: AttributeGroup[],
        group: AttributeGroup,
      ) => [...groups, group],
      lowered_groups,
      lowered_group,
    );
  }
  return lowered_groups;
}

function lower_duck_declaration(
  node: BabaCstNode,
  source: string,
): Checked<Declaration> {
  const identifiers = node.children.filter((child) =>
    child.kind === "identifier"
  );
  const name_node = identifiers[0];
  const member_block = node.children.find((child) =>
    child.kind === "duck_member_block"
  );
  if (name_node === undefined || member_block === undefined) {
    return unsupported(node);
  }

  const name = source.slice(name_node.start, name_node.end);
  let declaration_check: Checked<null> = ok(null);
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) {
    declaration_check = fail(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        "Duck name must use PascalCase: " + name,
        { start: name_node.start, end: name_node.end },
      ),
    );
  }
  if (is_builtin_type_reference_name(name)) {
    declaration_check = Applicative.lift(
      (_name: null, _builtin: null) => null,
      declaration_check,
      fail(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Duck declaration conflicts with builtin type: " + name,
          { start: name_node.start, end: name_node.end },
        ),
      ),
    );
  }

  const roles: string[] = [];
  const role_names = new Map<string, BabaCstNode>();
  for (const role_node of identifiers.slice(1)) {
    const role = source.slice(role_node.start, role_node.end);
    roles.push(role);
    if (!/^[A-Z][A-Za-z0-9]*$/.test(role)) {
      declaration_check = Applicative.lift(
        (_roles: null, _role: null) => null,
        declaration_check,
        fail(
          compiler_diagnostic(
            diagnostic_codes.syntax_error,
            "Duck role must use PascalCase: " + role,
            { start: role_node.start, end: role_node.end },
          ),
        ),
      );
    }
    const previous = role_names.get(role);
    if (previous !== undefined) {
      declaration_check = Applicative.lift(
        (_roles: null, _duplicate: null) => null,
        declaration_check,
        fail(
          compiler_diagnostic(
            diagnostic_codes.syntax_error,
            "Duplicate duck role: " + role,
            { start: role_node.start, end: role_node.end },
            [{
              message: "First duck role is here.",
              span: { start: previous.start, end: previous.end },
            }],
          ),
        ),
      );
    } else {
      role_names.set(role, role_node);
    }
  }
  if (roles.length === 0) {
    declaration_check = Applicative.lift(
      (_declaration: null, _role: null) => null,
      declaration_check,
      fail(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Duck declaration requires at least one role",
          { start: name_node.start, end: name_node.end },
        ),
      ),
    );
  }

  const member_names = new Map<string, BabaCstNode>();
  let lowered_types: Checked<
    Extract<Declaration, { tag: "duck" }>["types"]
  > = ok([]);
  let lowered_members: Checked<
    Extract<Declaration, { tag: "duck" }>["members"]
  > = ok([]);
  const member_nodes = member_block.children.filter((child) =>
    child.kind === "duck_type_member" || child.kind === "duck_member"
  );
  for (const member_node of member_nodes) {
    const member_name_node = member_node.children.find((child) =>
      child.kind === "identifier" || child.kind === '"end"'
    );
    if (member_name_node === undefined) return unsupported(member_node);
    const member_name = source.slice(
      member_name_node.start,
      member_name_node.end,
    );
    let member_check: Checked<null> = ok(null);
    if (
      member_node.kind === "duck_type_member" &&
      !/^[A-Z][A-Za-z0-9]*$/.test(member_name)
    ) {
      member_check = fail(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Duck type member must use PascalCase: " + member_name,
          { start: member_name_node.start, end: member_name_node.end },
        ),
      );
    }
    if (
      member_node.kind === "duck_member" && member_name !== "end" &&
      !is_snake_case(member_name)
    ) {
      member_check = fail(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Duck member must use snake_case: " + member_name,
          { start: member_name_node.start, end: member_name_node.end },
        ),
      );
    }
    const previous = member_names.get(member_name);
    if (previous !== undefined) {
      member_check = Applicative.lift(
        (_member: null, _duplicate: null) => null,
        member_check,
        fail(
          compiler_diagnostic(
            diagnostic_codes.syntax_error,
            "Duplicate duck member: " + member_name,
            { start: member_name_node.start, end: member_name_node.end },
            [{
              message: "First duck member is here.",
              span: { start: previous.start, end: previous.end },
            }],
          ),
        ),
      );
    } else {
      member_names.set(member_name, member_name_node);
    }

    const type_node = member_node.children.find((child) =>
      child.kind === "type_reference"
    );
    if (member_node.kind === "duck_type_member") {
      let lowered_default: Checked<TypeExpr | undefined> = ok(undefined);
      if (type_node !== undefined) {
        lowered_default = lower_baba_type_reference(type_node, source);
      }
      const lowered_type = Applicative.lift(
        (_member: null, default_type: TypeExpr | undefined) => ({
          name: member_name,
          default_type,
        }),
        member_check,
        lowered_default,
      );
      lowered_types = Applicative.lift(
        (types, type) => [...types, type],
        lowered_types,
        lowered_type,
      );
      continue;
    }

    if (type_node === undefined) return unsupported(member_node);
    const lowered_member = Applicative.lift(
      (_member: null, type_expr: TypeExpr) => ({
        name: member_name,
        type_expr,
      }),
      member_check,
      lower_baba_type_reference(type_node, source),
    );
    lowered_members = Applicative.lift(
      (members, member) => [...members, member],
      lowered_members,
      lowered_member,
    );
  }
  if (
    !member_nodes.some((member_node) => member_node.kind === "duck_member")
  ) {
    declaration_check = Applicative.lift(
      (_declaration: null, _member: null) => null,
      declaration_check,
      fail(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Duck declaration requires a member",
          { start: member_block.start, end: member_block.end },
        ),
      ),
    );
  }

  return Applicative.lift(
    (
      _declaration: null,
      types: Extract<Declaration, { tag: "duck" }>["types"],
      members: Extract<Declaration, { tag: "duck" }>["members"],
    ) => {
      const declaration: Declaration = {
        tag: "duck",
        name,
        roles,
        types,
        members,
      };
      mark_source_span(declaration, { start: node.start, end: node.end });
      return declaration;
    },
    declaration_check,
    lowered_types,
    lowered_members,
  );
}

function lower_extension_declaration(
  node: BabaCstNode,
  source: string,
): Checked<Declaration> {
  const identifiers = node.children.filter((child) =>
    child.kind === "identifier"
  );
  const type_node = identifiers[0];
  const member_block = node.children.find((child) =>
    child.kind === "extension_member_block"
  );
  if (type_node === undefined || member_block === undefined) {
    return unsupported(node);
  }

  const type_name = source.slice(type_node.start, type_node.end);
  let declaration_check: Checked<null> = ok(null);
  if (!/^[A-Z][A-Za-z0-9]*$/.test(type_name)) {
    declaration_check = fail(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        "Extension type must use PascalCase: " + type_name,
        { start: type_node.start, end: type_node.end },
      ),
    );
  }
  const params: string[] = [];
  const parameter_names = new Map<string, BabaCstNode>();
  for (const parameter_node of identifiers.slice(1)) {
    const parameter = source.slice(parameter_node.start, parameter_node.end);
    params.push(parameter);
    if (!/^[A-Z][A-Za-z0-9]*$/.test(parameter)) {
      declaration_check = Applicative.lift(
        (_params: null, _parameter: null) => null,
        declaration_check,
        fail(
          compiler_diagnostic(
            diagnostic_codes.syntax_error,
            "Extension parameter must use PascalCase: " + parameter,
            { start: parameter_node.start, end: parameter_node.end },
          ),
        ),
      );
    }
    const previous = parameter_names.get(parameter);
    if (previous !== undefined) {
      declaration_check = Applicative.lift(
        (_params: null, _duplicate: null) => null,
        declaration_check,
        fail(
          compiler_diagnostic(
            diagnostic_codes.syntax_error,
            "Duplicate extension parameter: " + parameter,
            { start: parameter_node.start, end: parameter_node.end },
            [{
              message: "First extension parameter is here.",
              span: { start: previous.start, end: previous.end },
            }],
          ),
        ),
      );
    } else {
      parameter_names.set(parameter, parameter_node);
    }
  }

  const member_names = new Map<string, BabaCstNode>();
  let lowered_types: Checked<
    Extract<Declaration, { tag: "extend" }>["types"]
  > = ok([]);
  let lowered_fields: Checked<
    Extract<Declaration, { tag: "extend" }>["fields"]
  > = ok([]);
  for (
    const member_node of member_block.children.filter((child) =>
      child.kind === "extension_type_member" || child.kind === "shape_field"
    )
  ) {
    const member_name_node = member_node.children.find((child) =>
      child.kind === "identifier" || child.kind === '"end"'
    );
    if (member_name_node === undefined) return unsupported(member_node);
    const member_name = source.slice(
      member_name_node.start,
      member_name_node.end,
    );
    let member_check: Checked<null> = ok(null);
    if (
      member_node.kind === "extension_type_member" &&
      !/^[A-Z][A-Za-z0-9]*$/.test(member_name)
    ) {
      member_check = fail(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Extension type member must use PascalCase: " + member_name,
          { start: member_name_node.start, end: member_name_node.end },
        ),
      );
    }
    if (
      member_node.kind === "shape_field" && member_name !== "end" &&
      !is_snake_case(member_name)
    ) {
      member_check = fail(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Extension member must use snake_case: " + member_name,
          { start: member_name_node.start, end: member_name_node.end },
        ),
      );
    }
    const previous = member_names.get(member_name);
    if (previous !== undefined) {
      member_check = Applicative.lift(
        (_member: null, _duplicate: null) => null,
        member_check,
        fail(
          compiler_diagnostic(
            diagnostic_codes.syntax_error,
            "Duplicate extension member: " + member_name,
            { start: member_name_node.start, end: member_name_node.end },
            [{
              message: "First extension member is here.",
              span: { start: previous.start, end: previous.end },
            }],
          ),
        ),
      );
    } else {
      member_names.set(member_name, member_name_node);
    }

    if (member_node.kind === "extension_type_member") {
      const member_type_node = member_node.children.find((child) =>
        child.kind === "type_reference"
      );
      if (member_type_node === undefined) return unsupported(member_node);
      const lowered_type = Applicative.lift(
        (_member: null, type_expr: TypeExpr) => ({
          name: member_name,
          type_expr,
        }),
        member_check,
        lower_baba_type_reference(member_type_node, source),
      );
      lowered_types = Applicative.lift(
        (types, type) => [...types, type],
        lowered_types,
        lowered_type,
      );
      continue;
    }

    const value_node = member_node.children.find((child) =>
      child !== member_name_node && is_expression_node(child)
    );
    if (value_node === undefined) return unsupported(member_node);
    const lowered_field = Applicative.lift(
      (_member: null, value: FrontExpr) => ({
        name: member_name,
        value,
      }),
      member_check,
      lower_expression(value_node, source),
    );
    lowered_fields = Applicative.lift(
      (fields, field) => [...fields, field],
      lowered_fields,
      lowered_field,
    );
  }

  return Applicative.lift(
    (
      _declaration: null,
      types: Extract<Declaration, { tag: "extend" }>["types"],
      fields: Extract<Declaration, { tag: "extend" }>["fields"],
    ) => {
      const declaration: Declaration = {
        tag: "extend",
        type_name,
        params,
        types,
        fields,
      };
      mark_source_span(declaration, { start: node.start, end: node.end });
      return declaration;
    },
    declaration_check,
    lowered_types,
    lowered_fields,
  );
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

  if (node.kind === "prefix_unsafe_proof_statement") {
    const unsafe_node = node.children.find((child) =>
      child.kind === '"unsafe"'
    );
    const definition_node = node.children.find((child) =>
      child.kind === "binding_statement"
    );
    expect(
      unsafe_node !== undefined && definition_node !== undefined,
      "Unsafe proof declaration lost its binding.",
    );
    const proof_body = binding_direct_proof_body(definition_node);
    if (proof_body !== undefined) return ok(undefined);
    return fail(
      compiler_diagnostic(
        diagnostic_codes.unsafe_proof_use,
        "Unsafe declarations require a matching prefix signature with a Proof result.",
        { start: unsafe_node.start, end: unsafe_node.end },
      ),
    );
  }

  if (node.kind === "binding_statement") {
    const proof_body = binding_direct_proof_body(node);
    if (
      proof_body !== undefined &&
      !node.children.some((child) => child.kind === '"and"')
    ) {
      return ok(undefined);
    }
    if (proof_body !== undefined) semantic_proof_placeholders.add(proof_body);
    return lower_binding(node, source);
  }

  if (node.kind === "computational_open_statement") {
    const package_node = node.children.find((child) =>
      child.kind === "condition_expression"
    );
    const names = node.children.filter((child) => child.kind === "identifier");
    const witness_node = names[0];
    const payload_node = names[1];
    if (
      package_node === undefined || witness_node === undefined ||
      payload_node === undefined
    ) {
      return unsupported(node);
    }
    const name = no_demand_names.get(node);
    expect(name !== undefined, "Computational package open lost its identity.");
    const lowered_package = lower_expression(package_node, source);
    const package_value = checked_value(lowered_package);
    let component_mode: "default" | "linear" = "default";
    if (package_value?.tag === "linear") component_mode = "linear";
    return Applicative.lift(
      (package_value: FrontExpr, witness: Pattern, payload: Pattern) => {
        const pattern: Pattern = {
          tag: "product",
          entries: [{ pattern: witness }, { pattern: payload }],
        };
        mark_source_span(pattern, {
          start: witness_node.start,
          end: payload_node.end,
        });
        const statement: Stmt = {
          tag: "bind",
          kind: "let",
          pattern,
          name,
          is_linear: false,
          annotation: undefined,
          value: package_value,
        };
        mark_source_span(statement, { start: node.start, end: node.end });
        return statement;
      },
      lowered_package,
      lower_pattern(witness_node, source, component_mode),
      lower_pattern(payload_node, source, component_mode),
    );
  }

  if (node.kind === "type_pattern_statement") {
    const pattern_node = node.children.find((child) =>
      child.kind === "type_pattern"
    );
    const equals_node = node.children.find((child) =>
      source.slice(child.start, child.end) === "="
    );
    if (pattern_node === undefined || equals_node === undefined) {
      return unsupported(node);
    }
    const target_node = node.children.find((child) =>
      child.start >= equals_node.end && is_expression_node(child)
    );
    if (target_node === undefined) return unsupported(node);
    return Applicative.lift(
      (pattern: TypePattern, target: FrontExpr) => {
        const statement: Stmt = { tag: "type_check", pattern, target };
        mark_source_span(statement, { start: node.start, end: node.end });
        return statement;
      },
      lower_type_pattern(pattern_node, source),
      lower_expression(target_node, source),
    );
  }

  if (node.kind === "resume_dup_statement") {
    const names = node.children.filter((child) => child.kind === "identifier");
    const left_node = names[0];
    const right_node = names[1];
    const value_node = node.children.find((child) =>
      child.kind === "linear_reference"
    );
    if (
      left_node === undefined || right_node === undefined ||
      value_node === undefined
    ) {
      return unsupported(node);
    }
    const left = source.slice(left_node.start, left_node.end);
    const right = source.slice(right_node.start, right_node.end);
    let names_check: Checked<null> = ok(null);
    for (
      const [name, name_node] of [
        [left, left_node],
        [right, right_node],
      ] as const
    ) {
      if (is_snake_case(name)) continue;
      names_check = Applicative.lift(
        (_current: null, _next: null) => null,
        names_check,
        fail(
          compiler_diagnostic(
            diagnostic_codes.syntax_error,
            "Duplicated resumption must use snake_case: " + name,
            { start: name_node.start, end: name_node.end },
          ),
        ),
      );
    }
    return Applicative.lift(
      (_names: null, value: FrontExpr) => {
        const statement: Stmt = {
          tag: "resume_dup",
          left,
          right,
          value,
        };
        mark_source_span(statement, { start: node.start, end: node.end });
        return statement;
      },
      names_check,
      lower_expression(value_node, source),
    );
  }

  if (node.kind === "module_binding_statement") {
    return lower_module_binding(node, source);
  }

  if (node.kind === "assignment") {
    return lower_assignment(node, source);
  }

  if (node.kind === "index_assignment") {
    return lower_index_assignment(node, source);
  }

  if (node.kind === "effect_binding_statement") {
    return lower_effect_binding(node, source);
  }

  if (node.kind === "return_statement") {
    return lower_return(node, source);
  }

  if (
    node.kind === "module_return_statement" ||
    node.kind === "top_level_return_statement"
  ) {
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

  if (node.kind === "for_statement") {
    return lower_for_statement(node, source);
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

function binding_direct_proof_body(
  node: BabaCstNode,
): BabaCstNode | undefined {
  const equals_node = node.children.find((child) => child.kind === '"="');
  if (equals_node === undefined) return undefined;
  let value = node.children.find((child) =>
    child.start >= equals_node.end && is_expression_node(child)
  );
  if (value === undefined) return undefined;
  if (value.kind === "arrow_function") {
    const arrow = value.children.find((child) => child.kind === '"=>"');
    if (arrow === undefined) return undefined;
    value = value.children.find((child) =>
      child.start >= arrow.end && is_expression_node(child)
    );
    if (value === undefined) return undefined;
  }
  while (
    value.kind === "postfix_expression" ||
    value.kind === "parenthesized_expression" ||
    value.kind === "parenthesized_or_product"
  ) {
    value = semantic_child(value);
    if (value === undefined) return undefined;
  }
  if (value.kind === "prefix_by_proof_expression") return value;
  return undefined;
}

function lower_statement_entries(
  node: BabaCstNode,
  source: string,
): Checked<Stmt[]> {
  if (node.kind === "effect_binding_statement") {
    const binding_node = node.children.find((child) =>
      child.kind === "identifier" || child.kind === "wildcard" ||
      child.kind === "unit_pattern"
    );
    const value_node = node.children.find((child) =>
      child !== binding_node && is_expression_node(child)
    );
    const segments = newline_expression_segments(value_node, source);
    if (segments.length > 1) {
      const effect_node = segments[0];
      expect(effect_node !== undefined, "Baba effect segment disappeared.");
      const effect_statement = lower_effect_binding(
        node,
        source,
        effect_node,
        effect_node.end,
      );
      let trailing_statements: Checked<Stmt[]> = ok([]);
      for (const segment of segments.slice(1)) {
        const trailing_statement = lower_expression(segment, source).map(
          (expr) => {
            const statement: Stmt = { tag: "expr", expr };
            mark_source_span(statement, {
              start: segment.start,
              end: segment.end,
            });
            return statement;
          },
        );
        trailing_statements = Applicative.lift(
          (statements: Stmt[], statement: Stmt) => [
            ...statements,
            statement,
          ],
          trailing_statements,
          trailing_statement,
        );
      }
      return Applicative.lift(
        (effect: Stmt, trailing: Stmt[]) => [effect, ...trailing],
        effect_statement,
        trailing_statements,
      );
    }
  }
  if (node.kind === "expression_statement") {
    const expression_node = semantic_child(node);
    const segments = newline_expression_segments(expression_node, source);
    if (segments.length > 1) {
      let statements: Checked<Stmt[]> = ok([]);
      for (const segment of segments) {
        const statement = lower_expression(segment, source).map((expr) => {
          const entry: Stmt = { tag: "expr", expr };
          mark_source_span(entry, {
            start: segment.start,
            end: segment.end,
          });
          return entry;
        });
        statements = Applicative.lift(
          (entries: Stmt[], entry: Stmt) => [...entries, entry],
          statements,
          statement,
        );
      }
      return statements;
    }
    if (
      expression_node?.kind === "binary_expression" ||
      expression_node?.kind === "condition_binary_expression"
    ) {
      const parts: BinaryPart[] = [];
      if (collect_binary_parts(expression_node, parts, source)) {
        const segments: BinaryPart[][] = [];
        let current: BinaryPart[] = [];
        let previous_end = expression_node.start;
        for (const part of parts) {
          if (part.tag === "operator") {
            const prefix = baba_prefix_fixity(part.node);
            if (
              baba_infix_fixity(part.node) === undefined &&
              prefix !== undefined &&
              /[\r\n]/.test(source.slice(previous_end, part.node.start))
            ) {
              if (current.length === 0) return unsupported(part.node);
              segments.push(current);
              current = [];
              let precedence = prefix.precedence;
              if (prefix.builtin) precedence = 101;
              current.push({
                tag: "prefix",
                node: part.node,
                fixity: prefix,
                precedence,
                builtin: prefix.builtin,
                end: part.node.end,
              });
              previous_end = part.node.end;
              continue;
            }
          }
          current.push(part);
          previous_end = part.node.end;
          if (part.tag === "prefix") previous_end = part.end;
        }
        if (segments.length > 0) {
          if (current.length === 0) return unsupported(expression_node);
          segments.push(current);
          let lowered_statements: Checked<Stmt[]> = ok([]);
          for (const segment of segments) {
            const first = segment[0];
            const last = segment[segment.length - 1];
            expect(
              first !== undefined && last !== undefined,
              "Baba split expression segment is empty.",
            );
            let end = last.node.end;
            if (last.tag === "prefix") end = last.end;
            const span = { start: first.node.start, end };
            const lowered_statement = lower_binary_parts(
              segment,
              source,
              span,
            ).map((expr) => {
              const statement: Stmt = { tag: "expr", expr };
              mark_source_span(statement, span);
              return statement;
            });
            lowered_statements = Applicative.lift(
              (statements: Stmt[], statement: Stmt) => [
                ...statements,
                statement,
              ],
              lowered_statements,
              lowered_statement,
            );
          }
          return lowered_statements;
        }
      }
    }
  }
  return lower_statement(node, source).map((statement) => {
    if (statement === undefined) return [];
    return [statement];
  });
}

function newline_expression_segments(
  node: BabaCstNode | undefined,
  source: string,
): BabaCstNode[] {
  if (node === undefined) return [];
  const split = split_newline_expression(node, source);
  if (split === undefined) return [node];
  return [
    ...newline_expression_segments(split.before, source),
    ...newline_expression_segments(split.after, source),
  ];
}

function split_newline_expression(
  node: BabaCstNode,
  source: string,
): {
  before: BabaCstNode;
  after: BabaCstNode;
} | undefined {
  if (node.kind === "postfix_expression") {
    const child = semantic_child(node);
    if (child === undefined) return undefined;
    const split = split_newline_expression(child, source);
    if (split === undefined) return undefined;
    return {
      before: replace_expression_child(node, child, split.before),
      after: replace_expression_child(node, child, split.after),
    };
  }
  if (
    node.kind === "binary_expression" ||
    node.kind === "condition_binary_expression"
  ) {
    const expressions = node.children.filter((child) =>
      is_expression_node(child)
    );
    const left = expressions[0];
    const right = expressions[1];
    if (left === undefined || right === undefined) return undefined;
    const left_split = split_newline_expression(left, source);
    if (left_split !== undefined) {
      return {
        before: left_split.before,
        after: replace_expression_child(node, left, left_split.after),
      };
    }
    const right_split = split_newline_expression(right, source);
    if (right_split !== undefined) {
      return {
        before: replace_expression_child(node, right, right_split.before),
        after: right_split.after,
      };
    }
    return undefined;
  }
  if (
    node.kind === "unary_expression" ||
    node.kind === "condition_unary_expression"
  ) {
    const operand = semantic_child(node);
    if (operand === undefined) return undefined;
    const split = split_newline_expression(operand, source);
    if (split === undefined) return undefined;
    return {
      before: replace_expression_child(node, operand, split.before),
      after: split.after,
    };
  }
  if (
    node.kind === "field_expression" ||
    node.kind === "condition_field_expression" ||
    node.kind === "is_expression" ||
    node.kind === "condition_is_expression" ||
    node.kind === "as_expression"
  ) {
    const value = semantic_child(node);
    if (value === undefined) return undefined;
    const split = split_newline_expression(value, source);
    if (split === undefined) return undefined;
    return {
      before: split.before,
      after: replace_expression_child(node, value, split.after),
    };
  }
  if (
    node.kind === "index_expression" ||
    node.kind === "condition_index_expression"
  ) {
    const object = node.children.find((child) => is_expression_node(child));
    const open = node.children.find((child) =>
      source.slice(child.start, child.end) === "["
    );
    if (object === undefined || open === undefined) return undefined;
    if (/[\r\n]/.test(source.slice(object.end, open.start))) {
      let kind = "array_expression";
      if (
        node.children.some((child) =>
          source.slice(child.start, child.end) === ";"
        )
      ) {
        kind = "array_repeat_expression";
      }
      const after: BabaCstNode = {
        ...node,
        kind,
        start: open.start,
        children: node.children.filter((child) => child.start >= open.start),
      };
      return { before: object, after };
    }
    const split = split_newline_expression(object, source);
    if (split === undefined) return undefined;
    return {
      before: split.before,
      after: replace_expression_child(node, object, split.after),
    };
  }
  if (
    node.kind !== "application_expression" &&
    node.kind !== "call_expression"
  ) {
    return undefined;
  }
  const expression_nodes = node.children.filter((child) =>
    is_expression_node(child)
  );
  const function_node = expression_nodes[0];
  const argument_node = expression_nodes[1];
  if (function_node === undefined || argument_node === undefined) {
    return undefined;
  }
  if (/[\r\n]/.test(source.slice(function_node.end, argument_node.start))) {
    return { before: function_node, after: argument_node };
  }
  const function_split = split_newline_expression(function_node, source);
  if (function_split !== undefined) {
    return {
      before: function_split.before,
      after: replace_expression_child(
        node,
        function_node,
        function_split.after,
      ),
    };
  }
  const argument_split = split_newline_expression(argument_node, source);
  if (argument_split !== undefined) {
    return {
      before: replace_expression_child(
        node,
        argument_node,
        argument_split.before,
      ),
      after: argument_split.after,
    };
  }
  return undefined;
}

function replace_expression_child(
  node: BabaCstNode,
  child: BabaCstNode,
  replacement: BabaCstNode,
): BabaCstNode {
  const children = node.children.map((candidate) => {
    if (candidate === child) return replacement;
    return candidate;
  });
  let start = node.start;
  let end = node.end;
  if (child.start === node.start) start = replacement.start;
  if (child.end === node.end) end = replacement.end;
  const replaced = {
    ...node,
    start,
    end,
    children,
  };
  return replaced;
}

function lower_for_statement(
  node: BabaCstNode,
  source: string,
): Checked<Stmt> {
  const header = read_baba_for_header(node, source);
  if (header === undefined) return unsupported(node);
  if (header.tag === "range") {
    return lower_range_for_statement(node, header, source);
  }
  return lower_collection_for_statement(node, header, source);
}

function lower_range_for_statement(
  node: BabaCstNode,
  header: Extract<BabaForHeader, { tag: "range" }>,
  source: string,
): Checked<Stmt> {
  let range_index: Checked<string>;
  if (header.range_pattern_nodes.length === 0) {
    const generated_name = no_demand_names.get(node);
    expect(
      generated_name !== undefined,
      "Baba anonymous range has no no-demand identity.",
    );
    range_index = ok(generated_name);
  } else {
    range_index = lower_loop_binding_name(
      header.range_pattern_nodes,
      source,
      "Range loop index must be an unannotated binding",
    );
  }

  let collection_index_check: Checked<null> = ok(null);
  if (header.collection_index_pattern_nodes.length > 0) {
    const index_pattern = lower_pattern_alternatives(
      header.collection_index_pattern_nodes,
      source,
    );
    const comma_node = node.children.find((child) =>
      source.slice(child.start, child.end) === ","
    );
    expect(comma_node !== undefined, "Baba range index comma disappeared.");
    collection_index_check = Applicative.lift(
      (_pattern: Pattern, _invalid: never) => null,
      index_pattern,
      fail(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Range loops do not have item patterns",
          { start: comma_node.start, end: comma_node.end },
        ),
      ),
    );
  }

  let step: Checked<FrontExpr>;
  if (header.step_node === undefined) {
    const default_step: FrontExpr = {
      tag: "num",
      type: "i32",
      value: 1,
    };
    derive_source_span(default_step, {
      start: header.range_operator.end,
      end: header.range_operator.end,
    });
    step = ok(default_step);
  } else {
    step = lower_expression(header.step_node, source);
  }

  return Applicative.lift(
    (
      _collection_index: null,
      index: string,
      start: FrontExpr,
      end: FrontExpr,
      lowered_step: FrontExpr,
      body: FrontExpr,
    ) => {
      expect(body.tag === "block", "Baba range body did not lower to a block.");
      let end_bound: "exclusive" | "inclusive" = "exclusive";
      if (
        source.slice(
          header.range_operator.start,
          header.range_operator.end,
        ) === "..="
      ) {
        end_bound = "inclusive";
      }
      const statement: Stmt = {
        tag: "for_range",
        index,
        start,
        end,
        end_bound,
        step: lowered_step,
        body: body.statements,
      };
      mark_source_span(statement, { start: node.start, end: node.end });
      return statement;
    },
    collection_index_check,
    range_index,
    lower_expression(header.start_node, source),
    lower_expression(header.end_node, source),
    step,
    lower_block(header.body_node, source),
  );
}

function lower_collection_for_statement(
  node: BabaCstNode,
  header: Extract<BabaForHeader, { tag: "collection" }>,
  source: string,
): Checked<Stmt> {
  let index: Checked<string | undefined> = ok(undefined);
  if (header.index_pattern_nodes.length > 0) {
    index = lower_loop_binding_name(
      header.index_pattern_nodes,
      source,
      "Loop index must be an unannotated binding",
    );
  }
  const item_pattern = lower_pattern_alternatives(
    header.item_pattern_nodes,
    source,
  );
  return Applicative.lift(
    (
      lowered_index: string | undefined,
      pattern: Pattern,
      collection: FrontExpr,
      body: FrontExpr,
    ) => {
      expect(
        body.tag === "block",
        "Baba collection body did not lower to a block.",
      );
      let item: string;
      if (
        pattern.tag === "binding" && pattern.mode === "default" &&
        pattern.annotation === undefined &&
        pattern.type_annotation === undefined
      ) {
        item = pattern.name;
        const statement: Stmt = {
          tag: "for_collection",
          index: lowered_index,
          item,
          collection,
          body: body.statements,
        };
        mark_source_span(statement, { start: node.start, end: node.end });
        return statement;
      }
      if (pattern.tag === "wildcard" && pattern.mode === "default") {
        const pattern_node = header.item_pattern_nodes[0];
        expect(
          pattern_node !== undefined,
          "Baba collection wildcard disappeared.",
        );
        const generated_name = no_demand_names.get(pattern_node);
        expect(
          generated_name !== undefined,
          "Baba collection wildcard has no no-demand identity.",
        );
        const statement: Stmt = {
          tag: "for_collection",
          index: lowered_index,
          item: generated_name,
          collection,
          body: body.statements,
        };
        mark_source_span(statement, { start: node.start, end: node.end });
        return statement;
      }

      const generated_name = no_demand_names.get(node);
      expect(
        generated_name !== undefined,
        "Baba collection pattern has no internal identity.",
      );
      item = generated_name;
      const matching_body: FrontExpr = {
        tag: "block",
        statements: [
          ...body.statements,
          { tag: "expr", expr: { tag: "unit" } },
        ],
      };
      derive_source_span(matching_body, source_span(body));
      const item_reference: FrontExpr = { tag: "var", name: item };
      derive_source_span(item_reference, source_span(pattern));
      const matching_expression: FrontExpr = {
        tag: "match",
        target: item_reference,
        arms: [
          { pattern, guard: undefined, body: matching_body },
          {
            pattern: { tag: "wildcard", mode: "default" },
            guard: undefined,
            body: { tag: "unit" },
          },
        ],
      };
      derive_source_span(matching_expression, {
        start: source_span(pattern).start,
        end: source_span(body).end,
      });
      const filtered_statement: Stmt = {
        tag: "expr",
        expr: matching_expression,
      };
      derive_source_span(filtered_statement, source_span(matching_expression));
      const statement: Stmt = {
        tag: "for_collection",
        index: lowered_index,
        item,
        pattern,
        collection,
        body: [filtered_statement],
      };
      mark_source_span(statement, { start: node.start, end: node.end });
      return statement;
    },
    index,
    item_pattern,
    lower_expression(header.collection_node, source),
    lower_block(header.body_node, source),
  );
}

function lower_loop_binding_name(
  pattern_nodes: readonly BabaCstNode[],
  source: string,
  invalid_message: string,
): Checked<string> {
  const lowered_pattern = lower_pattern_alternatives(pattern_nodes, source);
  const pattern = checked_value(lowered_pattern);
  let name = "";
  let shape_check: Checked<null> = ok(null);
  if (
    pattern?.tag === "binding" && pattern.mode === "default" &&
    pattern.annotation === undefined &&
    pattern.type_annotation === undefined
  ) {
    name = pattern.name;
  } else if (pattern?.tag === "wildcard" && pattern.mode === "default") {
    const pattern_node = pattern_nodes[0];
    expect(pattern_node !== undefined, "Baba loop wildcard disappeared.");
    const generated_name = no_demand_names.get(pattern_node);
    expect(
      generated_name !== undefined,
      "Baba loop wildcard has no no-demand identity.",
    );
    name = generated_name;
  } else if (pattern !== undefined) {
    shape_check = fail(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        invalid_message,
        source_span(pattern),
      ),
    );
  }
  return Applicative.lift(
    (_shape: null, _pattern: Pattern) => name,
    shape_check,
    lowered_pattern,
  );
}

function lower_statement_sequence(
  nodes: readonly BabaCstNode[],
  source: string,
): Checked<Stmt[]> {
  let statements: Checked<Stmt[]> = ok([]);
  for (const node of nodes) {
    statements = Applicative.lift(
      (current: Stmt[], next: Stmt[]) => [...current, ...next],
      statements,
      lower_statement_entries(node, source),
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
  const recursive_node = node.children.find((child) => child.kind === '"rec"');
  const open_node = node.children.find((child) => child.kind === '"open"');
  const mutual_start_node = node.children.find((child) =>
    child.kind === '"and"'
  );
  const pattern_nodes = node.children.filter((child) =>
    child.end <= equals_node.start && is_pattern_node(child)
  );
  const type_node = node.children.find((child) =>
    child.kind === "type_reference" && child.end <= equals_node.start
  );
  const value_nodes = node.children.filter((child) =>
    child.start >= equals_node.end &&
    (mutual_start_node === undefined ||
      child.end <= mutual_start_node.start) &&
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
    if (
      child === type_node || child.kind === '":"' ||
      child.kind === "attribute_group"
    ) {
      continue;
    }
    if (
      child.kind === '"let"' ||
      child.kind === '"const"' ||
      child.kind === '"!"' ||
      child.kind === '"rec"' ||
      child.kind === '"open"' ||
      child.kind === '"|"' ||
      child.kind === '"="' ||
      child.kind === '"else"' ||
      child.kind === '";"'
    ) {
      continue;
    }
    if (
      mutual_start_node !== undefined &&
      child.start >= mutual_start_node.start &&
      (else_node === undefined || child.end <= else_node.start)
    ) {
      continue;
    }
    return unsupported(child);
  }

  let kind: "let" | "const" = "let";
  if (node.children.some((child) => child.kind === '"const"')) {
    kind = "const";
  }
  const is_recursive = recursive_node !== undefined;
  const opens_import = open_node !== undefined;
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
    if (is_recursive) {
      expect(
        else_node !== undefined,
        "Baba recursive else keyword disappeared.",
      );
      else_check = Applicative.lift(
        (_previous: null, _recursive: null) => null,
        else_check,
        fail(
          compiler_diagnostic(
            diagnostic_codes.syntax_error,
            "Recursive bindings do not support else branches",
            { start: else_node.start, end: else_node.end },
          ),
        ),
      );
    }
    if (opens_import) {
      expect(else_node !== undefined, "Baba open else keyword disappeared.");
      else_check = Applicative.lift(
        (_previous: null, _open: null) => null,
        else_check,
        fail(
          compiler_diagnostic(
            diagnostic_codes.syntax_error,
            "Open bindings do not support else branches",
            { start: else_node.start, end: else_node.end },
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
  const lowered_attributes = lower_attribute_groups(
    node.children.filter((child) => child.kind === "attribute_group"),
    source,
  );
  let binding_form_check: Checked<null> = ok(null);
  if (
    is_recursive && parsed_pattern !== undefined &&
    parsed_pattern.tag !== "binding"
  ) {
    binding_form_check = fail(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        "Recursive bindings require a single name",
        source_span(parsed_pattern),
      ),
    );
  }
  if (
    opens_import && parsed_pattern !== undefined &&
    (
      parsed_pattern.tag !== "product" ||
      parsed_pattern.entries.some((entry) => entry.label === undefined)
    )
  ) {
    binding_form_check = fail(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        "Open imports require a named product pattern",
        source_span(parsed_pattern),
      ),
    );
  }
  const parsed_value = checked_value(lowered_value);
  if (
    opens_import && parsed_value !== undefined &&
    (
      parsed_value.tag !== "app" ||
      parsed_value.func.tag !== "import"
    )
  ) {
    binding_form_check = Applicative.lift(
      (_pattern: null, _value: null) => null,
      binding_form_check,
      fail(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Open bindings require a direct module import invocation",
          source_span(parsed_value),
        ),
      ),
    );
  }
  if (mutual_start_node !== undefined && !is_recursive) {
    binding_form_check = Applicative.lift(
      (_previous: null, _mutual: null) => null,
      binding_form_check,
      fail(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Mutually recursive bindings require let rec",
          { start: mutual_start_node.start, end: mutual_start_node.end },
        ),
      ),
    );
  }
  let lowered_mutual: Checked<RecursiveBinding[]> = ok([]);
  const recursive_names = new Map<string, SourceSpan>();
  if (parsed_pattern?.tag === "binding") {
    recursive_names.set(
      parsed_pattern.name,
      source_span(parsed_pattern),
    );
  }
  const mutual_nodes = node.children.filter((child) => child.kind === '"and"');
  for (let index = 0; index < mutual_nodes.length; index += 1) {
    const mutual_node = mutual_nodes[index];
    expect(mutual_node !== undefined, "Baba mutual marker disappeared.");
    const next_mutual_node = mutual_nodes[index + 1];
    let segment_end = node.end;
    if (next_mutual_node !== undefined) {
      segment_end = next_mutual_node.start;
    } else if (else_node !== undefined) {
      segment_end = else_node.start;
    }
    const segment_nodes = node.children.filter((child) =>
      child.start >= mutual_node.end && child.end <= segment_end
    );
    const name_node = segment_nodes.find((child) =>
      child.kind === "identifier"
    );
    const member_type_node = segment_nodes.find((child) =>
      child.kind === "type_reference"
    );
    const member_equals_node = segment_nodes.find((child) =>
      source.slice(child.start, child.end) === "="
    );
    if (name_node === undefined || member_equals_node === undefined) {
      return unsupported(mutual_node);
    }
    const member_value_nodes = segment_nodes.filter((child) =>
      child.start >= member_equals_node.end && is_expression_node(child)
    );
    const member_value_node = member_value_nodes[0];
    if (member_value_nodes.length !== 1 || member_value_node === undefined) {
      return unsupported(mutual_node);
    }
    const name = source.slice(name_node.start, name_node.end);
    const member_diagnostics = [];
    if (!is_snake_case(name)) {
      member_diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Mutually recursive binding must use snake_case: " + name,
          { start: name_node.start, end: name_node.end },
        ),
      );
    }
    if (!is_runtime_binding_name(name)) {
      member_diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Mutually recursive binding name is reserved syntax: " + name,
          { start: name_node.start, end: name_node.end },
        ),
      );
    }
    const reserved_feature = unsupported_reserved_feature(name);
    if (reserved_feature !== undefined) {
      member_diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Mutually recursive binding is reserved for unsupported " +
            reserved_feature + ": " + name,
          { start: name_node.start, end: name_node.end },
        ),
      );
    }
    const previous = recursive_names.get(name);
    if (previous !== undefined) {
      member_diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Duplicate mutually recursive binding: " + name,
          { start: name_node.start, end: name_node.end },
          [{
            message: "First recursive binding is here.",
            span: previous,
          }],
        ),
      );
    } else {
      recursive_names.set(name, {
        start: name_node.start,
        end: name_node.end,
      });
    }
    let member_check: Checked<null> = ok(null);
    if (member_diagnostics.length > 0) {
      member_check = fail(...member_diagnostics);
    }
    let lowered_member_type: Checked<TypeExpr | undefined> = ok(undefined);
    if (member_type_node !== undefined) {
      lowered_member_type = lower_baba_type_reference(
        member_type_node,
        source,
      );
    }
    const lowered_member = Applicative.lift(
      (
        _member: null,
        parsed_type: TypeExpr | undefined,
        value: FrontExpr,
      ) => {
        let annotation: string | undefined;
        let type_annotation: TypeExpr | undefined;
        if (parsed_type !== undefined) {
          annotation = format_type_expr(parsed_type);
          if (parsed_type.tag !== "name") type_annotation = parsed_type;
        }
        const pattern: Pattern = {
          tag: "binding",
          name,
          mode: "default",
          annotation,
        };
        if (type_annotation !== undefined) {
          pattern.type_annotation = type_annotation;
        }
        let pattern_end = name_node.end;
        if (member_type_node !== undefined) {
          pattern_end = member_type_node.end;
        }
        mark_source_span(pattern, {
          start: name_node.start,
          end: pattern_end,
        });
        record_pattern_binding_span(pattern, {
          start: name_node.start,
          end: name_node.end,
        });
        const member: RecursiveBinding = {
          pattern,
          name,
          is_linear: false,
          annotation,
          value: apply_function_result_context(value, type_annotation),
        };
        if (type_annotation !== undefined) {
          member.type_annotation = type_annotation;
        }
        mark_source_span(member, {
          start: mutual_node.start,
          end: member_value_node.end,
        });
        return member;
      },
      member_check,
      lowered_member_type,
      lower_expression(member_value_node, source),
    );
    lowered_mutual = Applicative.lift(
      (members: RecursiveBinding[], member: RecursiveBinding) => [
        ...members,
        member,
      ],
      lowered_mutual,
      lowered_member,
    );
  }
  const lowered_binding = Applicative.lift(
    (
      attribute_groups: AttributeGroup[],
      _form: null,
      parsed_pattern: Pattern,
      parsed_type: TypeExpr | undefined,
      value: FrontExpr,
      else_branch: FrontExpr | undefined,
      mutual: RecursiveBinding[],
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
        is_recursive,
        is_linear: parsed_pattern.tag === "binding" &&
          parsed_pattern.mode === "linear",
        annotation,
        value: apply_function_result_context(value, type_annotation),
      };
      if (type_annotation !== undefined) {
        statement.type_annotation = type_annotation;
      }
      if (opens_import) statement.opens_import = true;
      if (mutual.length > 0) statement.mutual = mutual;
      if (else_branch !== undefined) statement.else_branch = else_branch;
      if (attribute_groups.length > 0) {
        statement.attribute_groups = attribute_groups;
      }
      mark_source_span(statement, { start: node.start, end: node.end });
      return statement;
    },
    lowered_attributes,
    binding_form_check,
    pattern_check,
    lowered_type,
    lowered_value,
    lowered_else,
    lowered_mutual,
  );
  const binding_diagnostics = diagnostics_of(lowered_binding).toSorted(
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
  if (binding_diagnostics.length > 0) {
    return fail(...binding_diagnostics);
  }
  return lowered_binding;
}

function lower_module_binding(
  node: BabaCstNode,
  source: string,
): Checked<Stmt> {
  const name_node = node.children.find((child) => child.kind === "identifier");
  const value_node = node.children.find((child) =>
    child !== name_node && is_expression_node(child)
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
        "Module must use snake_case: " + name,
        { start: name_node.start, end: name_node.end },
      ),
    );
  }
  if (!is_runtime_binding_name(name)) {
    name_check = Applicative.lift(
      (_name: null, _reserved: null) => null,
      name_check,
      fail(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Module name is reserved syntax: " + name,
          { start: name_node.start, end: name_node.end },
        ),
      ),
    );
  }
  const reserved_feature = unsupported_reserved_feature(name);
  if (reserved_feature !== undefined) {
    name_check = Applicative.lift(
      (_name: null, _reserved: null) => null,
      name_check,
      fail(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Module name is reserved for unsupported " + reserved_feature +
            ": " + name,
          { start: name_node.start, end: name_node.end },
        ),
      ),
    );
  }

  return Applicative.lift(
    (
      attribute_groups: AttributeGroup[],
      _name: null,
      value: FrontExpr,
    ) => {
      const statement: Stmt = {
        tag: "bind",
        kind: "const",
        name,
        is_linear: false,
        annotation: undefined,
        value: module_value(value),
      };
      if (attribute_groups.length > 0) {
        statement.attribute_groups = attribute_groups;
      }
      mark_source_span(statement, { start: node.start, end: node.end });
      return statement;
    },
    lower_attribute_groups(
      node.children.filter((child) => child.kind === "attribute_group"),
      source,
    ),
    name_check,
    lower_expression(value_node, source),
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

function lower_index_assignment(
  node: BabaCstNode,
  source: string,
): Checked<Stmt> {
  const name_node = node.children.find((child) => child.kind === "identifier");
  const expression_nodes = node.children.filter((child) =>
    child !== name_node && is_expression_node(child)
  );
  const index_node = expression_nodes[0];
  const value_node = expression_nodes[1];
  if (
    name_node === undefined || expression_nodes.length !== 2 ||
    index_node === undefined || value_node === undefined
  ) {
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
    (_name: null, index: FrontExpr, value: FrontExpr) => {
      const statement: Stmt = {
        tag: "index_assign",
        name,
        index,
        value,
      };
      mark_source_span(statement, { start: node.start, end: node.end });
      return statement;
    },
    name_check,
    lower_expression(index_node, source),
    lower_expression(value_node, source),
  );
}

function lower_effect_binding(
  node: BabaCstNode,
  source: string,
  value_override?: BabaCstNode,
  statement_end?: number,
): Checked<Stmt> {
  const binding_node = node.children.find((child) =>
    child.kind === "identifier" || child.kind === "wildcard" ||
    child.kind === "unit_pattern"
  );
  let value_node = value_override;
  if (value_node === undefined) {
    value_node = node.children.find((child) =>
      child !== binding_node && is_expression_node(child)
    );
  }
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
      let end = node.end;
      if (statement_end !== undefined) end = statement_end;
      mark_source_span(statement, { start: node.start, end });
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
  const line_check = check_return_line_boundary(node, source);
  let statement_end = node.end;
  const terminator = /^[ \t]*;/.exec(source.slice(node.end));
  if (terminator !== null) statement_end += terminator[0].length;
  const value_node = node.children.find((child) => is_expression_node(child));
  if (value_node === undefined) {
    return line_check.map((_line: null) => {
      const statement: Stmt = { tag: "return", value: { tag: "unit" } };
      mark_source_span(statement, { start: node.start, end: statement_end });
      return statement;
    });
  }

  return Applicative.lift(
    (_line: null, value: FrontExpr) => {
      const statement: Stmt = { tag: "return", value };
      mark_source_span(statement, { start: node.start, end: statement_end });
      return statement;
    },
    line_check,
    lower_expression(value_node, source),
  );
}

function lower_module_return(
  node: BabaCstNode,
  source: string,
): Checked<Stmt> {
  const value_node = node.children.find((child) => is_expression_node(child));
  if (value_node === undefined) return lower_return(node, source);
  const line_check = check_return_line_boundary(node, source);
  let statement_end = node.end;
  const terminator = /^[ \t]*;/.exec(source.slice(node.end));
  if (terminator !== null) statement_end += terminator[0].length;
  return Applicative.lift(
    (_line: null, value: FrontExpr) => {
      let return_value = value;
      if (value.tag === "shape") {
        const fields = value.entries.map((entry) => {
          expect(
            entry.label !== undefined,
            "Baba module export shape entry has no label.",
          );
          const entry_span = source_span(entry);
          if (!source.slice(entry_span.start, entry_span.end).includes("=")) {
            mark_source_span(entry.value, entry_span);
          }
          const field = { name: entry.label, value: entry.value };
          derive_source_span(field, {
            start: value_node.start,
            end: value_node.end,
          });
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
      mark_source_span(statement, { start: node.start, end: statement_end });
      return statement;
    },
    line_check,
    lower_expression(value_node, source),
  );
}

function check_return_line_boundary(
  node: BabaCstNode,
  source: string,
): Checked<null> {
  const return_node = node.children.find((child) =>
    source.slice(child.start, child.end) === "return"
  );
  expect(return_node !== undefined, "Baba return keyword disappeared.");
  const following_node = node.children.find((child) =>
    child.start >= return_node.end && child !== return_node &&
    child.kind !== "comment"
  );
  if (following_node === undefined) return ok(null);
  const boundaries = [{
    start: return_node.end,
    end: following_node.start,
  }];
  const value_node = node.children.find((child) => is_expression_node(child));
  const semicolon_node = node.children.find((child) =>
    source.slice(child.start, child.end) === ";"
  );
  if (value_node !== undefined && semicolon_node !== undefined) {
    boundaries.push({ start: value_node.end, end: semicolon_node.start });
  }
  for (const boundary of boundaries) {
    const gap = source.slice(boundary.start, boundary.end);
    let line_break = gap.indexOf("\n");
    if (line_break < 0) line_break = gap.indexOf("\r");
    if (line_break < 0) continue;
    const start = boundary.start + line_break;
    return fail(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        "Expected `;` after `return`",
        { start, end: start + 1 },
      ),
    );
  }
  return ok(null);
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
    simple_union:
      | { case_name: string; value_name: string | undefined }
      | undefined;
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
  const simple_union = simple_if_let_union(pattern_nodes, source);
  return Applicative.lift(
    (pattern: Pattern, target: FrontExpr) => ({
      tag: "pattern",
      pattern,
      target,
      span: { start: let_node.start, end: target_node.end },
      simple_union,
    }),
    lower_pattern_alternatives(pattern_nodes, source),
    lower_expression(target_node, source),
  );
}

function simple_if_let_union(
  pattern_nodes: readonly BabaCstNode[],
  source: string,
): { case_name: string; value_name: string | undefined } | undefined {
  if (pattern_nodes.length !== 1) return undefined;
  const pattern = pattern_nodes[0];
  expect(pattern !== undefined, "Baba if-let pattern disappeared.");
  if (pattern.kind !== "union_pattern") return undefined;
  const name = pattern.children.find((child) =>
    child.kind === "constructor_identifier"
  );
  if (name === undefined) return undefined;
  const payload = pattern.children.find((child) =>
    child !== name && is_pattern_node(child)
  );
  if (payload === undefined) {
    return {
      case_name: source.slice(name.start, name.end),
      value_name: undefined,
    };
  }
  if (payload.kind === "identifier") {
    const value_name = source.slice(payload.start, payload.end);
    if (!/^[_a-z]/.test(value_name)) return undefined;
    return {
      case_name: source.slice(name.start, name.end),
      value_name,
    };
  }
  if (payload.kind !== "wildcard") return undefined;
  const value_name = no_demand_names.get(payload);
  expect(
    value_name !== undefined,
    "Baba if-let wildcard has no no-demand identity.",
  );
  return {
    case_name: source.slice(name.start, name.end),
    value_name,
  };
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
  const simple_union = test.simple_union;
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

function lower_expression(
  node: BabaCstNode,
  source: string,
): Checked<FrontExpr> {
  if (node.kind === "prefix_by_proof_expression") {
    if (!semantic_proof_placeholders.has(node)) return unsupported(node);
    const expression: FrontExpr = { tag: "unit" };
    mark_source_span(expression, { start: node.start, end: node.end });
    return ok(expression);
  }
  if (node.kind === "computational_pack_expression") {
    const values = node.children.filter((child) => is_expression_node(child));
    const witness_node = values[0];
    const payload_node = values[1];
    if (witness_node === undefined || payload_node === undefined) {
      return unsupported(node);
    }
    return Applicative.lift(
      (witness: FrontExpr, payload: FrontExpr) => {
        const expression: FrontExpr = {
          tag: "product",
          entries: [{ value: witness }, { value: payload }],
        };
        mark_source_span(expression, { start: node.start, end: node.end });
        return expression;
      },
      lower_expression(witness_node, source),
      lower_expression(payload_node, source),
    );
  }
  const lifted_prefix = lifted_expression_prefixes.get(node);
  if (
    lifted_prefix !== undefined &&
    !suppressed_expression_prefixes.has(node)
  ) {
    suppressed_expression_prefixes.add(node);
    const lowered_value = lower_expression(node, source);
    suppressed_expression_prefixes.delete(node);
    const value = checked_value(lowered_value);
    if (value === undefined) return fail(...diagnostics_of(lowered_value));
    const span = { start: node.start, end: node.end };
    if (lifted_prefix.target === "@syntax.not") {
      return apply_builtin_prefix("!", value, span);
    }
    if (lifted_prefix.target === "@syntax.negate") {
      return apply_builtin_prefix("-", value, span);
    }
    if (!lifted_prefix.valid_target) {
      const expression: FrontExpr = {
        tag: "unsupported",
        feature: "operator " + lifted_prefix.operator,
        text: lifted_prefix.operator,
      };
      mark_source_span(expression, span);
      return ok(expression);
    }
    const expression: FrontExpr = {
      tag: "app",
      func: qualified_operator_target(lifted_prefix.target),
      arg: value,
      args: [value],
      operator_syntax: {
        kind: "prefix",
        operator: lifted_prefix.operator,
        precedence: lifted_prefix.precedence,
        target: lifted_prefix.target,
      },
    };
    mark_source_span(expression, span);
    return ok(expression);
  }

  if (
    node.kind === "postfix_expression" ||
    node.kind === "parenthesized_expression" ||
    node.kind === "parenthesized_or_product" ||
    node.kind === "condition_expression" ||
    node.kind === "condition_postfix_expression" ||
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

  if (node.kind === "template_literal") {
    return lower_template_literal(node, source);
  }

  if (node.kind === "wildcard") {
    const expression: FrontExpr = { tag: "var", name: hole_name };
    mark_source_span(expression, { start: node.start, end: node.end });
    return ok(expression);
  }

  if (node.kind === "include_expression") {
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
    const path_expression: FrontExpr = { tag: "text", value: path };
    const function_expression: FrontExpr = {
      tag: "var",
      name: "@include",
    };
    const expression: FrontExpr = {
      tag: "app",
      func: function_expression,
      arg: path_expression,
      args: [path_expression],
    };
    mark_source_span(expression, { start: node.start, end: node.end });
    return ok(expression);
  }

  if (node.kind === "scratch_expression") {
    const body_node = node.children.find((child) => child.kind === "block");
    if (body_node === undefined) return unsupported(node);
    return lower_expression(body_node, source).map((body) => {
      const expression: FrontExpr = { tag: "scratch", body };
      mark_source_span(expression, { start: node.start, end: node.end });
      return expression;
    });
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
    const operator_node = node.children.find((child) =>
      source.slice(child.start, child.end) === "!"
    );
    let declared_prefix: BabaPrefixFixity | undefined;
    if (operator_node !== undefined) {
      declared_prefix = baba_prefix_fixity(operator_node);
    }
    if (lifted_prefix_references.has(node)) {
      const name_node = node.children.find((child) =>
        child.kind === "identifier"
      );
      if (name_node === undefined) return unsupported(node);
      const expression: FrontExpr = {
        tag: "var",
        name: source.slice(name_node.start, name_node.end),
      };
      mark_source_span(expression, { start: node.start, end: node.end });
      return ok(expression);
    }
    if (
      declared_prefix?.source_defined === true &&
      declared_prefix.target !== "@syntax.not"
    ) {
      return lower_unary(node, source);
    }
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
    return lower_function_expression(node, source, "lam");
  }

  if (node.kind === "recursive_function") {
    return lower_function_expression(node, source, "rec");
  }

  if (node.kind === "recursive_call_expression") {
    return lower_recursive_call(node, source);
  }

  if (node.kind === "try_with_expression") {
    return lower_try_with_expression(node, source);
  }

  if (node.kind === "effect_handler_expression") {
    return lower_effect_handler_expression(node, source);
  }

  if (
    node.kind === "application_expression" ||
    node.kind === "call_expression" ||
    node.kind === "condition_call_expression" ||
    node.kind === "condition_application_expression"
  ) {
    return lower_application(node, source);
  }

  if (node.kind === "condition_call_arguments") {
    const values = node.children.filter((child) => is_expression_node(child));
    if (values.length === 0) {
      const expression: FrontExpr = { tag: "unit" };
      mark_source_span(expression, { start: node.start, end: node.end });
      return ok(expression);
    }
    const first = values[0];
    expect(first !== undefined, "Baba condition call argument disappeared.");
    const has_comma = node.children.some((child) =>
      source.slice(child.start, child.end) === ","
    );
    if (values.length === 1 && !has_comma) {
      return lower_expression(first, source);
    }
    let entries: Checked<Array<{ value: FrontExpr }>> = ok([]);
    for (const value of values) {
      entries = Applicative.lift(
        (
          current: Array<{ value: FrontExpr }>,
          lowered: FrontExpr,
        ) => [...current, { value: lowered }],
        entries,
        lower_expression(value, source),
      );
    }
    return entries.map((lowered_entries) => {
      const expression: FrontExpr = {
        tag: "product",
        entries: lowered_entries,
        value_pack: true,
      };
      mark_source_span(expression, { start: node.start, end: node.end });
      return expression;
    });
  }

  if (
    node.kind === "positional_product" ||
    node.kind === "condition_positional_product"
  ) {
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

  if (node.kind === "case_expression") {
    return lower_case_expression(node, source);
  }

  if (node.kind === "case_function_expression") {
    return lower_case_function_expression(node, source);
  }

  if (node.kind === "condition_unary_expression") {
    return lower_binary(node, source);
  }

  if (node.kind === "unary_expression") {
    return lower_binary(node, source);
  }

  if (node.kind === "array_expression") {
    return lower_array_expression(node, source);
  }

  if (node.kind === "array_repeat_expression") {
    const values = node.children.filter((child) => is_expression_node(child));
    const value_node = values[0];
    const length_node = values[1];
    if (
      value_node === undefined || length_node === undefined ||
      values.length !== 2
    ) {
      return unsupported(node);
    }
    return Applicative.lift(
      (value: FrontExpr, length: FrontExpr) => {
        const expression: FrontExpr = { tag: "array_repeat", value, length };
        mark_source_span(expression, { start: node.start, end: node.end });
        return expression;
      },
      lower_expression(value_node, source),
      lower_expression(length_node, source),
    );
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
    return lower_binary(node, source);
  }

  if (node.kind === "as_expression") {
    return lower_binary(node, source);
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
        } else if (
          object.tag === "var" && object.name.startsWith("@") &&
          object.name !== import_meta_binding_name
        ) {
          expression = { tag: "var", name: object.name + "." + name };
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
    return lower_union_case(node, source, "complete_expression");
  }
  if (node.kind === "shape_nullary_union_case") {
    return lower_union_case(node, source, "complete_expression");
  }

  if (node.kind === "loop_expression") {
    return lower_loop_expression(node, source);
  }

  return unsupported(node);
}

function lower_case_expression(
  node: BabaCstNode,
  source: string,
): Checked<FrontExpr> {
  const of_node = node.children.find((child) => child.kind === '"of"');
  if (of_node === undefined) return unsupported(node);
  const target_node = node.children.find((child) =>
    child.end <= of_node.start && is_expression_node(child)
  );
  if (target_node === undefined) return unsupported(node);
  return Applicative.lift(
    (target: FrontExpr, arms: MatchArm[]) => {
      const expression: FrontExpr = { tag: "match", target, arms };
      mark_source_span(expression, { start: node.start, end: node.end });
      return expression;
    },
    lower_expression(target_node, source),
    lower_case_arms(node, source),
  );
}

function lower_case_function_expression(
  node: BabaCstNode,
  source: string,
): Checked<FrontExpr> {
  const lowered_arms = lower_case_arms(node, source);
  let parameter_count = 1;
  let arity_check: Checked<null> = ok(null);
  const arm_nodes = node.children.filter((child) => child.kind === "case_arm");
  const packed_arm_node = arm_nodes.find((arm_node) =>
    arm_node.children.some((child) =>
      child.kind === "positional_product_pattern"
    )
  );
  if (packed_arm_node !== undefined) {
    const pattern_node = packed_arm_node.children.find((child) =>
      child.kind === "positional_product_pattern"
    );
    expect(
      pattern_node !== undefined,
      "Baba packed case function arm disappeared.",
    );
    parameter_count = pattern_node.children.filter((child) =>
      is_pattern_node(child)
    ).length;
  }
  for (const arm_node of arm_nodes) {
    const pattern_node = arm_node.children.find((child) =>
      is_pattern_node(child)
    );
    if (pattern_node === undefined) continue;
    if (pattern_node.kind === "wildcard") continue;
    if (
      pattern_node.kind === "identifier" &&
      !/^[A-Z][A-Za-z0-9]*$/.test(
        source.slice(pattern_node.start, pattern_node.end),
      )
    ) {
      continue;
    }
    let arm_parameter_count = 1;
    if (pattern_node.kind === "positional_product_pattern") {
      arm_parameter_count = pattern_node.children.filter((child) =>
        is_pattern_node(child)
      ).length;
    }
    if (arm_parameter_count === parameter_count) continue;
    arity_check = Applicative.lift(
      (_current: null, _next: null) => null,
      arity_check,
      fail(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "`case => of` arms must match the same argument count",
          { start: arm_node.start, end: arm_node.end },
        ),
      ),
    );
  }

  const result = Applicative.lift(
    (arms: MatchArm[], _arity: null) => {
      const params: Param[] = [];
      for (let index = 0; index < parameter_count; index += 1) {
        params.push({
          name: "_case#param" + index.toString(),
          is_const: false,
          is_linear: false,
          annotation: undefined,
        });
      }
      let pattern: Pattern;
      let target: FrontExpr;
      if (parameter_count === 1) {
        const param = params[0];
        expect(
          param !== undefined,
          "Baba case function parameter disappeared.",
        );
        pattern = {
          tag: "binding",
          name: param.name,
          mode: "default",
          annotation: undefined,
        };
        target = { tag: "var", name: param.name };
      } else {
        pattern = {
          tag: "product",
          entries: params.map((param) => ({
            pattern: {
              tag: "binding",
              name: param.name,
              mode: "default",
              annotation: undefined,
            },
          })),
          value_pack: true,
        };
        target = {
          tag: "product",
          entries: params.map((param) => ({
            value: { tag: "var", name: param.name },
          })),
          value_pack: true,
        };
      }
      const body: FrontExpr = { tag: "match", target, arms };
      derive_source_span(body, { start: node.start, end: node.end });
      const expression: FrontExpr = {
        tag: "lam",
        pattern,
        params,
        body,
        case_function: true,
      };
      mark_source_span(expression, { start: node.start, end: node.end });
      return expression;
    },
    lowered_arms,
    arity_check,
  );
  const diagnostics = diagnostics_of(result).toSorted((left, right) => {
    if (left.span.start !== right.span.start) {
      return left.span.start - right.span.start;
    }
    return left.span.end - right.span.end;
  });
  if (diagnostics.length > 0) return fail(...diagnostics);
  return result;
}

function lower_case_arms(
  node: BabaCstNode,
  source: string,
): Checked<MatchArm[]> {
  let lowered_arms: Checked<MatchArm[]> = ok([]);
  for (
    const arm_node of node.children.filter((child) => child.kind === "case_arm")
  ) {
    const arrow_node = arm_node.children.find((child) => child.kind === '"=>"');
    if (arrow_node === undefined) return unsupported(arm_node);
    const pattern_nodes = arm_node.children.filter((child) =>
      child.end <= arrow_node.start && is_pattern_node(child)
    );
    if (pattern_nodes.length !== 1) return unsupported(arm_node);
    const pattern_node = pattern_nodes[0];
    expect(pattern_node !== undefined, "Baba case arm pattern disappeared.");
    const if_node = arm_node.children.find((child) =>
      child.end <= arrow_node.start && child.kind === '"if"'
    );
    let lowered_guard: Checked<FrontExpr | undefined> = ok(undefined);
    if (if_node !== undefined) {
      const guard_node = arm_node.children.find((child) =>
        child.start >= if_node.end && child.end <= arrow_node.start &&
        is_expression_node(child)
      );
      if (guard_node === undefined) return unsupported(arm_node);
      lowered_guard = lower_expression(guard_node, source);
    }
    const body_node = arm_node.children.find((child) =>
      child.start >= arrow_node.end && is_expression_node(child)
    );
    if (body_node === undefined) return unsupported(arm_node);
    const lowered_arm = Applicative.lift(
      (
        pattern: Pattern,
        guard: FrontExpr | undefined,
        body: FrontExpr,
      ) => {
        const arm: MatchArm = { pattern, guard, body };
        mark_source_span(arm, { start: arm_node.start, end: arm_node.end });
        return arm;
      },
      lower_pattern_alternatives([pattern_node], source),
      lowered_guard,
      lower_expression(body_node, source),
    );
    lowered_arms = Applicative.lift(
      (arms: MatchArm[], arm: MatchArm) => [...arms, arm],
      lowered_arms,
      lowered_arm,
    );
  }
  return lowered_arms;
}

function lower_block(
  node: BabaCstNode,
  source: string,
): Checked<FrontExpr> {
  const statement_nodes = node.children.filter((child) =>
    child.kind !== '"do"' && child.kind !== '"end"'
  );
  const lowered_statements = lower_statement_sequence(statement_nodes, source);
  const statements = checked_value(lowered_statements);
  if (statements === undefined) {
    return fail(...diagnostics_of(lowered_statements));
  }

  const finalized_statements = finalize_block_statements(statements);
  const final_statement = finalized_statements[finalized_statements.length - 1];
  if (
    final_statement === undefined || final_statement.tag !== "expr" ||
    final_statement.expr.tag !== "handler"
  ) {
    const expression: FrontExpr = {
      tag: "block",
      statements: finalized_statements,
    };
    mark_source_span(expression, { start: node.start, end: node.end });
    return ok(expression);
  }

  const state: HandlerState[] = [];
  for (let index = 0; index < finalized_statements.length - 1; index += 1) {
    const statement = finalized_statements[index];
    expect(statement !== undefined, "Baba handler state disappeared.");
    if (
      statement.tag !== "bind" || statement.kind !== "let" ||
      statement.is_recursive || statement.is_linear || statement.effectful
    ) {
      return fail(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Handler state block may contain only leading ordinary `let` bindings",
          source_span(statement),
        ),
      );
    }
    const state_entry: HandlerState = {
      name: statement.name,
      annotation: statement.annotation,
      value: statement.value,
    };
    mark_source_span(state_entry, source_span(statement));
    state.push(state_entry);
  }

  const expression: FrontExpr = {
    ...final_statement.expr,
    state: [...state, ...final_statement.expr.state],
  };
  mark_source_span(expression, { start: node.start, end: node.end });
  return ok(expression);
}

function lower_effect_handler_expression(
  node: BabaCstNode,
  source: string,
): Checked<FrontExpr> {
  const effect_node = node.children.find((child) =>
    child.kind === "effect_identifier"
  );
  const clauses_node = node.children.find((child) =>
    child.kind === "handler_clause_block"
  );
  if (effect_node === undefined || clauses_node === undefined) {
    return unsupported(node);
  }

  let lowered_clauses: Checked<HandlerClause[]> = ok([]);
  for (
    const clause_node of clauses_node.children.filter((child) =>
      child.kind === "handler_operation_clause"
    )
  ) {
    const name_node = clause_node.children.find((child) =>
      child.kind === "identifier" || child.kind === '"end"'
    );
    const value_node = clause_node.children.find((child) =>
      child.kind === "arrow_function"
    );
    if (name_node === undefined || value_node === undefined) {
      return unsupported(clause_node);
    }
    const name = source.slice(name_node.start, name_node.end);
    let name_check: Checked<null> = ok(null);
    if (!is_snake_case(name)) {
      name_check = fail(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Handler clause must use snake_case: " + name,
          { start: name_node.start, end: name_node.end },
        ),
      );
    }
    const lowered_clause = Applicative.lift(
      (_name: null, value: FrontExpr) => {
        expect(value.tag === "lam", "Baba handler clause is not a lambda.");
        const clause: HandlerClause = {
          name,
          params: value.params,
          body: value.body,
        };
        mark_source_span(clause, {
          start: clause_node.start,
          end: clause_node.end,
        });
        return clause;
      },
      name_check,
      lower_function_expression(value_node, source, "lam"),
    );
    lowered_clauses = Applicative.lift(
      (clauses: HandlerClause[], clause: HandlerClause) => [
        ...clauses,
        clause,
      ],
      lowered_clauses,
      lowered_clause,
    );
  }

  const return_node = clauses_node.children.find((child) =>
    child.kind === "handler_return_clause"
  );
  if (return_node === undefined) return unsupported(clauses_node);
  const return_value_node = return_node.children.find((child) =>
    child.kind === "arrow_function"
  );
  if (return_value_node === undefined) return unsupported(return_node);
  const lowered_return_value = lower_function_expression(
    return_value_node,
    source,
    "lam",
  );
  const parsed_return_value = checked_value(lowered_return_value);
  let return_arity: Checked<null> = ok(null);
  if (
    parsed_return_value !== undefined &&
    (parsed_return_value.tag !== "lam" ||
      parsed_return_value.params.length !== 1)
  ) {
    return_arity = fail(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        "Handler return clause must accept exactly one parameter",
        { start: return_value_node.start, end: return_value_node.end },
      ),
    );
  }
  const lowered_return_clause = Applicative.lift(
    (value: FrontExpr, _arity: null) => {
      expect(value.tag === "lam", "Baba handler return is not a lambda.");
      const param = value.params[0];
      expect(param !== undefined, "Baba handler return parameter disappeared.");
      const return_clause: HandlerReturnClause = {
        param,
        body: value.body,
      };
      mark_source_span(return_clause, {
        start: return_node.start,
        end: return_node.end,
      });
      return return_clause;
    },
    lowered_return_value,
    return_arity,
  );

  return Applicative.lift(
    (clauses: HandlerClause[], return_clause: HandlerReturnClause) => {
      const expression: FrontExpr = {
        tag: "handler",
        effect: source.slice(effect_node.start, effect_node.end),
        state: [],
        clauses,
        return_clause,
      };
      mark_source_span(expression, { start: node.start, end: node.end });
      return expression;
    },
    lowered_clauses,
    lowered_return_clause,
  );
}

function lower_try_with_expression(
  node: BabaCstNode,
  source: string,
): Checked<FrontExpr> {
  const expression_nodes = node.children.filter((child) =>
    is_expression_node(child)
  );
  const body_node = expression_nodes[0];
  const handler_node = expression_nodes[1];
  if (body_node === undefined || expression_nodes.length > 2) {
    return unsupported(node);
  }
  if (handler_node === undefined) {
    return lower_expression(body_node, source).map((body) => {
      const handler: FrontExpr = { tag: "unit" };
      derive_source_span(handler, { start: node.start, end: node.end });
      const expression: FrontExpr = {
        tag: "try_with",
        body,
        handler,
        infer_default_handlers: true,
      };
      mark_source_span(expression, { start: node.start, end: node.end });
      return expression;
    });
  }
  return Applicative.lift(
    (body: FrontExpr, handler: FrontExpr) => {
      const expression: FrontExpr = { tag: "try_with", body, handler };
      mark_source_span(expression, { start: node.start, end: node.end });
      return expression;
    },
    lower_expression(body_node, source),
    lower_expression(handler_node, source),
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
  const simple_union = test.simple_union;
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
  return lower_prefix_expression(
    operator_node,
    value_node,
    { start: node.start, end: node.end },
    source,
  );
}

function lower_prefix_expression(
  operator_node: BabaCstNode,
  value_node: BabaCstNode,
  span: SourceSpan,
  source: string,
): Checked<FrontExpr> {
  const operator = source.slice(operator_node.start, operator_node.end);
  const declared_prefix = baba_prefix_fixity(operator_node);
  let lowered_operator = operator;
  if (declared_prefix?.builtin === true) {
    if (declared_prefix.target === "@syntax.not") {
      lowered_operator = "!";
    } else if (declared_prefix.target === "@syntax.negate") {
      lowered_operator = "-";
    }
  }
  if (
    declared_prefix !== undefined && !declared_prefix.builtin
  ) {
    return lower_expression(value_node, source).map((value) => {
      const expression: FrontExpr = {
        tag: "app",
        func: qualified_operator_target(declared_prefix.target),
        arg: value,
        args: [value],
        operator_syntax: {
          kind: "prefix",
          operator,
          precedence: declared_prefix.precedence,
          target: declared_prefix.target,
        },
      };
      mark_source_span(expression, span);
      return expression;
    });
  }
  if (
    lowered_operator !== "!" && lowered_operator !== "-" &&
    lowered_operator !== "&" &&
    lowered_operator !== "freeze" && lowered_operator !== "comptime" &&
    lowered_operator !== "perform"
  ) {
    return unsupported(operator_node);
  }
  if (lowered_operator === "-") {
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
          span,
        ),
      );
    }
  }
  const lowered_value = lower_expression(value_node, source);
  const value = checked_value(lowered_value);
  if (value === undefined) return fail(...diagnostics_of(lowered_value));
  return apply_builtin_prefix(lowered_operator, value, span);
}

function apply_builtin_prefix(
  operator: string,
  value: FrontExpr,
  span: SourceSpan,
): Checked<FrontExpr> {
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
                span,
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
  } else if (operator === "perform") {
    expression = {
      tag: "app",
      func: {
        tag: "field",
        object: { tag: "var", name: "Do" },
        name: "unwrap",
      },
      args: [value],
    };
  } else {
    throw new Error("Unknown Baba built-in prefix operator: " + operator);
  }
  mark_source_span(expression, span);
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

function lower_template_literal(
  node: BabaCstNode,
  source: string,
): Checked<FrontExpr> {
  const interpolation_nodes = node.children.filter((child) =>
    child.kind === "template_interpolation"
  );
  const text_spans: SourceSpan[] = [];
  let text_start = node.start + 1;
  for (const interpolation of interpolation_nodes) {
    text_spans.push({ start: text_start, end: interpolation.start });
    text_start = interpolation.end;
  }
  text_spans.push({ start: text_start, end: node.end - 1 });

  let strings: Checked<Array<{ value: FrontExpr }>> = ok([]);
  for (const span of text_spans) {
    strings = Applicative.lift(
      (
        current: Array<{ value: FrontExpr }>,
        value: FrontExpr,
      ) => [...current, { value }],
      strings,
      decode_template_text(source, span),
    );
  }
  let values: Checked<Array<{ value: FrontExpr }>> = ok([]);
  for (const interpolation of interpolation_nodes) {
    const value_node = interpolation.children.find((child) =>
      is_expression_node(child)
    );
    if (value_node === undefined) return unsupported(interpolation);
    values = Applicative.lift(
      (
        current: Array<{ value: FrontExpr }>,
        value: FrontExpr,
      ) => [...current, { value }],
      values,
      lower_expression(value_node, source),
    );
  }

  return Applicative.lift(
    (lowered_strings, lowered_values) => {
      const string_values: FrontExpr = {
        tag: "product",
        entries: lowered_strings,
      };
      const interpolation_values: FrontExpr = {
        tag: "product",
        entries: lowered_values,
      };
      mark_source_span(string_values, { start: node.start, end: node.end });
      mark_source_span(interpolation_values, {
        start: node.start,
        end: node.end,
      });
      const expression: FrontExpr = {
        tag: "product",
        entries: [
          { value: string_values },
          { value: interpolation_values },
        ],
        value_pack: true,
        template_literal: true,
      };
      mark_source_span(expression, { start: node.start, end: node.end });
      return expression;
    },
    strings,
    values,
  );
}

function decode_template_text(
  source: string,
  span: SourceSpan,
): Checked<FrontExpr> {
  const raw = source.slice(span.start, span.end);
  let value = "";
  let index = 0;
  while (index < raw.length) {
    const character = raw[index];
    if (character === "\\") {
      const escaped = raw[index + 1];
      if (escaped === undefined) {
        return fail(
          compiler_diagnostic(
            diagnostic_codes.syntax_error,
            "Baba template text contains an unsupported escape.",
            span,
          ),
        );
      }
      const decoded = decode_literal_escape(escaped, "`");
      if (decoded === undefined) {
        return fail(
          compiler_diagnostic(
            diagnostic_codes.syntax_error,
            "Baba template text contains an unsupported escape.",
            {
              start: span.start + index,
              end: span.start + index + 2,
            },
          ),
        );
      }
      value += decoded;
      index += 2;
      continue;
    }
    if (
      (character === "{" || character === "}") &&
      raw[index + 1] === character
    ) {
      value += character;
      index += 2;
      continue;
    }
    if (character === undefined) {
      return fail(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Baba template text contains an unsupported escape.",
          span,
        ),
      );
    }
    value += character;
    index += 1;
  }
  const expression: FrontExpr = { tag: "text", value };
  mark_source_span(expression, span);
  return ok(expression);
}

function lower_array_expression(
  node: BabaCstNode,
  source: string,
): Checked<FrontExpr> {
  const spread_node = node.children.find((child) =>
    child.kind === "array_spread"
  );
  const item_nodes = node.children.filter((child) => is_expression_node(child));
  let lowered_items: Checked<FrontExpr[]> = ok([]);
  for (const item_node of item_nodes) {
    lowered_items = Applicative.lift(
      (items: FrontExpr[], item: FrontExpr) => [...items, item],
      lowered_items,
      lower_expression(item_node, source),
    );
  }

  if (spread_node === undefined) {
    return lowered_items.map((items) => {
      const entries = items.map((value) => ({ value }));
      const expression: FrontExpr = { tag: "product", entries };
      mark_source_span(expression, { start: node.start, end: node.end });
      return expression;
    });
  }

  const spread_value_nodes = spread_node.children.filter(is_expression_node);
  const spread_value_node = spread_value_nodes[0];
  if (spread_value_nodes.length !== 1 || spread_value_node === undefined) {
    return unsupported(spread_node);
  }
  const first_item_node = item_nodes[0];
  const leading_rest = first_item_node !== undefined &&
    spread_node.start < first_item_node.start;
  let lowered_array: Checked<{ items: FrontExpr[]; rest: FrontExpr }>;
  if (leading_rest) {
    lowered_array = Applicative.lift(
      (rest: FrontExpr, items: FrontExpr[]) => ({ items, rest }),
      lower_expression(spread_value_node, source),
      lowered_items,
    );
  } else {
    lowered_array = Applicative.lift(
      (items: FrontExpr[], rest: FrontExpr) => ({ items, rest }),
      lowered_items,
      lower_expression(spread_value_node, source),
    );
  }
  return lowered_array.map(({ items, rest }) => {
    const expression: FrontExpr = {
      tag: "array",
      items,
      rest,
    };
    if (leading_rest) expression.leading_rest = true;
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
  if (
    object_node === undefined || index_node === undefined ||
    values.length !== 2 ||
    node.children.some((child) => {
      const text = source.slice(child.start, child.end);
      return text === "," || text === "..." || text === ";";
    })
  ) {
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
  context: "complete_expression" | "application_argument",
): Checked<FrontExpr> {
  const constructors: Array<{
    node: BabaCstNode;
    name_node: BabaCstNode;
  }> = [];
  let current = node;
  let trailing_value_node: BabaCstNode | undefined;
  while (true) {
    const name_node = current.children.find((child) =>
      child.kind === "constructor_identifier"
    );
    if (name_node === undefined) return unsupported(current);
    constructors.push({ node: current, name_node });
    const value_node = current.children.find((child) =>
      is_expression_node(child)
    );
    if (value_node === undefined) break;
    const direct_value_node = semantic_child(value_node);
    if (
      value_node.kind === "postfix_expression" &&
      direct_value_node?.kind === "union_case"
    ) {
      current = direct_value_node;
      continue;
    }
    trailing_value_node = value_node;
    break;
  }

  const first = constructors[0];
  expect(first !== undefined, "Baba union constructor chain is empty.");
  if (constructors.length === 1) {
    if (trailing_value_node !== undefined) {
      const lowered_value = lower_expression(trailing_value_node, source);
      let payload_check: Checked<null> = ok(null);
      if (checked_value(lowered_value)?.tag === "unit") {
        payload_check = fail(
          compiler_diagnostic(
            diagnostic_codes.syntax_error,
            "Nullary union constructor #" +
              source.slice(first.name_node.start, first.name_node.end) +
              " omits `()`",
            {
              start: trailing_value_node.start,
              end: trailing_value_node.end,
            },
          ),
        );
      }
      return Applicative.lift(
        (value: FrontExpr, _payload: null) => {
          const expression: FrontExpr = {
            tag: "union_case",
            name: source.slice(first.name_node.start, first.name_node.end),
            value,
            type_expr: undefined,
          };
          mark_source_span(expression, { start: node.start, end: node.end });
          return expression;
        },
        lowered_value,
        payload_check,
      );
    }
    let value: FrontExpr | undefined;
    if (context === "complete_expression") value = { tag: "unit" };
    const expression: FrontExpr = {
      tag: "union_case",
      name: source.slice(first.name_node.start, first.name_node.end),
      value,
      type_expr: undefined,
    };
    mark_source_span(expression, { start: node.start, end: node.end });
    return ok(expression);
  }

  const second = constructors[1];
  expect(second !== undefined, "Baba union constructor payload disappeared.");
  const second_value: FrontExpr = {
    tag: "union_case",
    name: source.slice(second.name_node.start, second.name_node.end),
    value: undefined,
    type_expr: undefined,
  };
  mark_source_span(second_value, {
    start: second.node.start,
    end: second.name_node.end,
  });
  const initial: FrontExpr = {
    tag: "union_case",
    name: source.slice(first.name_node.start, first.name_node.end),
    value: second_value,
    type_expr: undefined,
  };
  const has_application_tail = constructors.length > 2 ||
    trailing_value_node !== undefined;
  if (has_application_tail) {
    derive_source_span(initial, { start: node.start, end: node.end });
  } else {
    mark_source_span(initial, { start: node.start, end: node.end });
  }
  let lowered: Checked<FrontExpr> = ok(initial);
  for (let index = 2; index < constructors.length; index += 1) {
    const constructor = constructors[index];
    expect(constructor !== undefined, "Baba union application disappeared.");
    const argument: FrontExpr = {
      tag: "union_case",
      name: source.slice(
        constructor.name_node.start,
        constructor.name_node.end,
      ),
      value: undefined,
      type_expr: undefined,
    };
    mark_source_span(argument, {
      start: constructor.node.start,
      end: constructor.name_node.end,
    });
    lowered = lowered.map((func) => {
      const expression: FrontExpr = {
        tag: "app",
        func,
        arg: argument,
        args: [argument],
      };
      derive_source_span(expression, { start: node.start, end: node.end });
      return expression;
    });
  }
  if (trailing_value_node !== undefined) {
    lowered = Applicative.lift(
      (func: FrontExpr, argument: FrontExpr) => {
        let args = [argument];
        if (argument.tag === "unit") args = [];
        const expression: FrontExpr = {
          tag: "app",
          func,
          arg: argument,
          args,
        };
        derive_source_span(expression, { start: node.start, end: node.end });
        return expression;
      },
      lowered,
      lower_expression(trailing_value_node, source),
    );
  }
  return lowered.map((expression) => {
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
  if (
    node.kind === "is_expression" ||
    node.kind === "condition_is_expression" ||
    node.kind === "as_expression"
  ) {
    const type_node = node.children.find((child) =>
      child.kind === "type_reference"
    );
    if (type_node !== undefined) {
      const nested_operator = descendants_of_kind(type_node, "identifier")
        .find((identifier) => {
          const name = source.slice(identifier.start, identifier.end);
          return name === "is" || name === "as";
        });
      if (nested_operator !== undefined) {
        return fail(
          compiler_diagnostic(
            diagnostic_codes.syntax_error,
            "Chained type operators require parentheses.",
            { start: nested_operator.start, end: nested_operator.end },
          ),
        );
      }
    }
  }
  const parts: BinaryPart[] = [];
  if (!collect_binary_parts(node, parts, source)) return unsupported(node);
  return lower_binary_parts(
    parts,
    source,
    { start: node.start, end: node.end },
  );
}

function lower_binary_parts(
  parts: readonly BinaryPart[],
  source: string,
  span: SourceSpan,
): Checked<FrontExpr> {
  const values: Checked<FrontExpr>[] = [];
  const operators: ExpressionOperator[] = [];
  let expects_operand = true;
  for (const part of parts) {
    if (part.tag === "prefix") {
      if (!expects_operand) return unsupported(part.node);
      operators.push({
        kind: "prefix",
        operator: part.fixity.operator,
        precedence: part.precedence,
        target: part.fixity.target,
        builtin: part.builtin,
        valid_target: part.fixity.valid_target,
        node: part.node,
        end: part.end,
      });
      continue;
    }
    if (part.tag === "type_operator") {
      if (expects_operand) return unsupported(part.node);
      while (true) {
        const pending = operators[operators.length - 1];
        if (pending === undefined) break;
        if (pending.precedence > part.precedence) {
          reduce_expression_operator(values, operators);
          continue;
        }
        if (
          pending.precedence === part.precedence &&
          pending.kind === "infix" &&
          pending.associativity !== "right"
        ) {
          reduce_expression_operator(values, operators);
          continue;
        }
        break;
      }
      const lowered_value = values.pop();
      expect(
        lowered_value !== undefined,
        "Baba type operator has no value.",
      );
      values.push(
        Applicative.lift(
          (value: FrontExpr, type_expr: TypeExpr) => {
            let expression: FrontExpr;
            if (part.operator === "is") {
              expression = { tag: "is", value, type_expr };
            } else {
              expression = { tag: "as", value, type_expr };
            }
            mark_source_span(expression, {
              start: source_span(value).start,
              end: part.node.end,
            });
            return expression;
          },
          lowered_value,
          lower_baba_type_reference(part.type_node, source),
        ),
      );
      continue;
    }
    if (part.tag === "operand") {
      if (!expects_operand) return unsupported(part.node);
      if (part.suppress_expression_prefix) {
        suppressed_expression_prefixes.add(part.node);
      }
      values.push(lower_expression(part.node, source));
      if (part.suppress_expression_prefix) {
        suppressed_expression_prefixes.delete(part.node);
      }
      expects_operand = false;
      continue;
    }
    if (expects_operand) return unsupported(part.node);
    const operator = source.slice(
      part.node.start,
      part.node.end,
    );
    const fixity = binary_fixity(part.node);
    if (fixity === undefined) {
      return fail(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Undeclared infix operator: " + operator,
          {
            start: part.node.start,
            end: part.node.end,
          },
        ),
      );
    }
    while (true) {
      const pending = operators[operators.length - 1];
      if (
        pending === undefined || pending.precedence <= fixity.precedence
      ) {
        break;
      }
      reduce_expression_operator(values, operators);
    }
    const previous = operators[operators.length - 1];
    if (
      previous?.kind === "infix" &&
      previous.precedence === fixity.precedence &&
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
          { start: part.node.start, end: part.node.end },
        ),
      );
    }
    while (true) {
      const pending = operators[operators.length - 1];
      if (
        pending?.kind !== "infix" ||
        !should_reduce_binary_operator(pending, fixity)
      ) {
        break;
      }
      reduce_expression_operator(values, operators);
    }
    operators.push({
      kind: "infix",
      operator,
      precedence: fixity.precedence,
      associativity: fixity.associativity,
      target: fixity.target,
      builtin: fixity.builtin,
    });
    expects_operand = true;
  }
  if (expects_operand) {
    const final_part = parts[parts.length - 1];
    expect(final_part !== undefined, "Baba binary parts are empty.");
    return unsupported(final_part.node);
  }
  while (operators.length > 0) {
    reduce_expression_operator(values, operators);
  }
  const result = values[0];
  expect(
    result !== undefined && values.length === 1,
    "Baba binary reduction did not produce one expression.",
  );
  return result.map((expression) => {
    mark_source_span(expression, span);
    return expression;
  });
}

function should_reduce_binary_operator(
  previous: InfixOperator | undefined,
  current: Omit<BinaryOperator, "operator">,
): boolean {
  if (previous === undefined) return false;
  if (previous.precedence > current.precedence) return true;
  if (previous.precedence < current.precedence) return false;
  return current.associativity === "left";
}

type BinaryPart =
  | {
    tag: "operand";
    node: BabaCstNode;
    suppress_expression_prefix?: boolean;
  }
  | { tag: "operator"; node: BabaCstNode }
  | {
    tag: "type_operator";
    node: BabaCstNode;
    type_node: BabaCstNode;
    operator: "is" | "as";
    precedence: number;
  }
  | {
    tag: "prefix";
    node: BabaCstNode;
    fixity: BabaPrefixFixity;
    precedence: number;
    builtin: boolean;
    end: number;
  };

type InfixOperator = {
  kind: "infix";
  operator: string;
  precedence: number;
  associativity: "left" | "right" | "none";
  target: string;
  builtin: boolean;
};

type PrefixOperator = {
  kind: "prefix";
  operator: string;
  precedence: number;
  target: string;
  builtin: boolean;
  valid_target: boolean;
  node: BabaCstNode;
  end: number;
};

type ExpressionOperator = InfixOperator | PrefixOperator;
type BinaryOperator = Omit<InfixOperator, "kind">;

function collect_binary_parts(
  node: BabaCstNode,
  parts: BinaryPart[],
  source: string,
): boolean {
  const lifted_prefix = lifted_expression_prefixes.get(node);
  if (lifted_prefix !== undefined) {
    let precedence = lifted_prefix.precedence;
    if (lifted_prefix.builtin) precedence = 101;
    parts.push({
      tag: "prefix",
      node,
      fixity: lifted_prefix,
      precedence,
      builtin: lifted_prefix.builtin,
      end: node.end,
    });
    parts.push({
      tag: "operand",
      node,
      suppress_expression_prefix: true,
    });
    return true;
  }
  if (node.kind === "postfix_expression") {
    const child = semantic_child(node);
    if (child !== undefined) return collect_binary_parts(child, parts, source);
  }
  if (
    node.kind === "condition_expression" ||
    node.kind === "condition_postfix_expression"
  ) {
    const child = semantic_child(node);
    if (child !== undefined) return collect_binary_parts(child, parts, source);
  }
  if (
    node.kind === "is_expression" ||
    node.kind === "condition_is_expression" ||
    node.kind === "as_expression"
  ) {
    const value_node = node.children.find((child) => is_expression_node(child));
    const type_node = node.children.find((child) =>
      child.kind === "type_reference"
    );
    if (value_node === undefined || type_node === undefined) return false;
    if (!collect_binary_parts(value_node, parts, source)) return false;
    let operator: "is" | "as" = "as";
    let precedence = 80;
    if (
      node.kind === "is_expression" ||
      node.kind === "condition_is_expression"
    ) {
      operator = "is";
      precedence = 40;
    }
    parts.push({
      tag: "type_operator",
      node,
      type_node,
      operator,
      precedence,
    });
    return true;
  }
  if (node.kind === "linear_reference") {
    const operator_node = node.children.find((child) =>
      source.slice(child.start, child.end) === "!"
    );
    const value_node = node.children.find((child) =>
      child.kind === "identifier"
    );
    if (operator_node !== undefined && value_node !== undefined) {
      const fixity = baba_prefix_fixity(operator_node);
      if (
        fixity?.source_defined === true &&
        fixity.target !== "@syntax.not"
      ) {
        let precedence = fixity.precedence;
        if (fixity.builtin) precedence = 101;
        parts.push({
          tag: "prefix",
          node: operator_node,
          fixity,
          precedence,
          builtin: fixity.builtin,
          end: node.end,
        });
        return collect_binary_parts(value_node, parts, source);
      }
    }
  }
  if (
    node.kind === "unary_expression" ||
    node.kind === "condition_unary_expression"
  ) {
    const operator_node = node.children.find((child) =>
      !is_expression_node(child)
    );
    const value_node = node.children.find((child) => is_expression_node(child));
    if (operator_node !== undefined && value_node !== undefined) {
      const fixity = baba_prefix_fixity(operator_node);
      if (fixity !== undefined) {
        let precedence = fixity.precedence;
        if (fixity.builtin) precedence = 101;
        let end = operator_node.end;
        if (
          value_node.kind === "parenthesized_expression" ||
          value_node.kind === "parenthesized_or_product" ||
          value_node.kind === "condition_parenthesized_expression" ||
          (value_node.kind === "postfix_expression" &&
            value_node.children.some((child) =>
              child.kind === "parenthesized_expression" ||
              child.kind === "parenthesized_or_product"
            ))
        ) {
          end = value_node.end;
        }
        parts.push({
          tag: "prefix",
          node: operator_node,
          fixity,
          precedence,
          builtin: fixity.builtin,
          end,
        });
        return collect_binary_parts(value_node, parts, source);
      }
      const operator = source.slice(operator_node.start, operator_node.end);
      if (
        operator === "&" || operator === "freeze" ||
        operator === "comptime" || operator === "perform"
      ) {
        let precedence = 101;
        if (operator === "comptime" || operator === "perform") {
          precedence = 0;
        }
        let end = operator_node.end;
        if (
          value_node.kind === "parenthesized_expression" ||
          value_node.kind === "parenthesized_or_product" ||
          value_node.kind === "condition_parenthesized_expression" ||
          (value_node.kind === "postfix_expression" &&
            value_node.children.some((child) =>
              child.kind === "parenthesized_expression" ||
              child.kind === "parenthesized_or_product"
            ))
        ) {
          end = value_node.end;
        }
        const semantic_fixity: BabaPrefixFixity = {
          kind: "prefix",
          operator,
          precedence,
          target: operator,
          builtin: true,
          valid_target: true,
          source_defined: false,
        };
        parts.push({
          tag: "prefix",
          node: operator_node,
          fixity: semantic_fixity,
          precedence,
          builtin: true,
          end,
        });
        return collect_binary_parts(value_node, parts, source);
      }
      return false;
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
  if (!collect_binary_parts(left, parts, source)) return false;
  parts.push({ tag: "operator", node: operator });
  return collect_binary_parts(right, parts, source);
}

function reduce_expression_operator(
  values: Checked<FrontExpr>[],
  operators: ExpressionOperator[],
): void {
  const operator = operators.pop();
  expect(operator !== undefined, "Baba expression operator disappeared.");
  if (operator.kind === "prefix") {
    const value = values.pop();
    expect(value !== undefined, "Baba prefix reduction has no operand.");
    if (operator.builtin) {
      if (!operator.valid_target) {
        values.push(value.map((_lowered_value) => {
          const expression: FrontExpr = {
            tag: "unsupported",
            feature: "operator " + operator.operator,
            text: operator.operator,
          };
          mark_source_span(expression, {
            start: operator.node.start,
            end: operator.end,
          });
          return expression;
        }));
        return;
      }
      const lowered_value = checked_value(value);
      if (lowered_value === undefined) {
        values.push(fail(...diagnostics_of(value)));
        return;
      }
      let builtin_operator = operator.operator;
      if (operator.target === "@syntax.not") builtin_operator = "!";
      if (operator.target === "@syntax.negate") builtin_operator = "-";
      const prefix_end = Math.max(
        operator.end,
        source_span(lowered_value).end,
      );
      if (
        builtin_operator === "-" && lowered_value.tag === "num" &&
        lowered_value.integer?.signed === false
      ) {
        values.push(
          fail(
            compiler_diagnostic(
              diagnostic_codes.syntax_error,
              "Unsigned U" + lowered_value.integer.width.toString() +
                " literal cannot be negated.",
              { start: operator.node.start, end: prefix_end },
            ),
          ),
        );
        return;
      }
      values.push(
        apply_builtin_prefix(
          builtin_operator,
          lowered_value,
          {
            start: operator.node.start,
            end: prefix_end,
          },
        ),
      );
      return;
    }
    values.push(value.map((lowered_value) => {
      const expression: FrontExpr = {
        tag: "app",
        func: qualified_operator_target(operator.target),
        arg: lowered_value,
        args: [lowered_value],
        operator_syntax: {
          kind: "prefix",
          operator: operator.operator,
          precedence: operator.precedence,
          target: operator.target,
        },
      };
      mark_source_span(expression, {
        start: operator.node.start,
        end: Math.max(operator.end, source_span(lowered_value).end),
      });
      return expression;
    }));
    return;
  }
  const right = values.pop();
  const left = values.pop();
  expect(
    left !== undefined && right !== undefined,
    "Baba binary reduction stack is incomplete.",
  );
  values.push(
    Applicative.lift(
      (left_value: FrontExpr, right_value: FrontExpr) =>
        binary_expression(operator, left_value, right_value),
      left,
      right,
    ),
  );
}

function binary_expression(
  operator: BinaryOperator | "==",
  left: FrontExpr,
  right: FrontExpr,
): FrontExpr {
  let resolved_operator: BinaryOperator;
  if (operator === "==") {
    resolved_operator = {
      operator,
      precedence: 40,
      associativity: "none",
      target: "@syntax.eq",
      builtin: true,
    };
  } else {
    resolved_operator = operator;
  }
  const left_span = source_span(left);
  const right_span = source_span(right);
  const span = {
    start: Math.min(left_span.start, right_span.start),
    end: Math.max(left_span.end, right_span.end),
  };
  let expression: FrontExpr;
  if (
    resolved_operator.builtin &&
    resolved_operator.target === "@syntax.and"
  ) {
    expression = {
      tag: "if",
      cond: left,
      then_branch: truth_expression(right),
      else_branch: { tag: "bool", value: false },
    };
  } else if (
    resolved_operator.builtin &&
    resolved_operator.target === "@syntax.or"
  ) {
    expression = {
      tag: "if",
      cond: left,
      then_branch: { tag: "bool", value: true },
      else_branch: truth_expression(right),
    };
  } else if (resolved_operator.builtin) {
    const primitive_operator = syntax_binary_operator(
      resolved_operator.target,
    );
    if (primitive_operator === undefined) {
      expression = {
        tag: "unsupported",
        feature: "operator " + resolved_operator.operator,
        text: resolved_operator.operator,
      };
      mark_source_span(expression, span);
      return expression;
    }
    const prim = binary_prim(primitive_operator, left, right);
    if (prim !== undefined) {
      expression = { tag: "prim", prim, left, right };
    } else {
      expression = {
        tag: "unsupported",
        feature: "operator " + resolved_operator.operator,
        text: resolved_operator.operator,
      };
    }
  } else {
    const arg: FrontExpr = {
      tag: "product",
      entries: [{ value: left }, { value: right }],
    };
    expression = {
      tag: "app",
      func: qualified_operator_target(resolved_operator.target),
      arg,
      args: [left, right],
      operator_syntax: {
        kind: "infix",
        operator: resolved_operator.operator,
        precedence: resolved_operator.precedence,
        associativity: resolved_operator.associativity,
        target: resolved_operator.target,
      },
    };
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
  node: BabaCstNode,
): Omit<BinaryOperator, "operator"> | undefined {
  return baba_infix_fixity(node);
}

function syntax_binary_operator(target: string): string | undefined {
  if (target === "@syntax.eq") return "==";
  if (target === "@syntax.ne") return "!=";
  if (target === "@syntax.lt") return "<";
  if (target === "@syntax.le") return "<=";
  if (target === "@syntax.gt") return ">";
  if (target === "@syntax.ge") return ">=";
  if (target === "@syntax.add") return "+";
  if (target === "@syntax.sub") return "-";
  if (target === "@syntax.mul") return "*";
  if (target === "@syntax.div") return "/";
  if (target === "@syntax.rem") return "%";
  return undefined;
}

function qualified_operator_target(target: string): FrontExpr {
  if (target.startsWith("@")) return { tag: "var", name: target };
  const names = target.split(".");
  const first = names[0];
  expect(first !== undefined, "Baba operator target has no root name.");
  let expression: FrontExpr = { tag: "var", name: first };
  for (const name of names.slice(1)) {
    expect(name.length > 0, "Baba operator target has an empty member.");
    expression = { tag: "field", object: expression, name };
  }
  return expression;
}

function lower_function_expression(
  node: BabaCstNode,
  source: string,
  expression_kind: "lam" | "rec",
): Checked<FrontExpr> {
  const parameter_nodes: BabaCstNode[] = [];
  const parameter_container = node.children.find((child) =>
    child.kind === "parameter" || child.kind === "parameter_list" ||
    child.kind === "bracket_parameter_list" ||
    (expression_kind === "rec" &&
      (child.kind === "identifier" || child.kind === "wildcard"))
  );
  if (parameter_container === undefined) return unsupported(node);
  let parsed_parameter_nodes = [parameter_container];
  if (
    parameter_container.kind === "parameter_list" ||
    parameter_container.kind === "bracket_parameter_list"
  ) {
    parsed_parameter_nodes = parameter_container.children.filter((child) =>
      child.kind === "parameter"
    );
  }
  let lowered_parameters: Checked<Param[]> = ok([]);
  for (const parameter_node of parsed_parameter_nodes) {
    let name_node: BabaCstNode | undefined;
    if (
      parameter_node.kind === "identifier" ||
      parameter_node.kind === "wildcard"
    ) {
      name_node = parameter_node;
    } else {
      name_node = parameter_node.children.find((child) =>
        child.kind === "identifier" || child.kind === "wildcard"
      );
    }
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
    if (expression_kind === "rec" && is_variadic) {
      parameter_diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Recursive functions do not support variadic parameters",
          { start: parameter_node.start, end: parameter_node.end },
        ),
      );
    }
    if (name_node.kind === "wildcard" && type_node !== undefined) {
      parameter_diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Wildcard parameters cannot have type annotations",
          { start: type_node.start, end: type_node.end },
        ),
      );
    }
    let parameter_check: Checked<null> = ok(null);
    if (parameter_diagnostics.length > 0) {
      parameter_check = fail(...parameter_diagnostics);
    }
    let parameter_is_const = is_const;
    let scalar_parameter = parameter_container.kind === "parameter";
    if (
      parameter_container.kind === "parameter_list" &&
      parsed_parameter_nodes.length === 1 &&
      !parameter_container.children.some((child) => child.kind === '","')
    ) {
      scalar_parameter = true;
    }
    if (
      name_node.kind === "wildcard" &&
      scalar_parameter
    ) {
      parameter_is_const = false;
    }
    if (name_node !== parameter_node) {
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
      let expression_parameters = parameters;
      if (parameter_container.kind === "bracket_parameter_list") {
        const entries = parameters.map((parameter, index) => {
          const parameter_node = parameter_nodes[index];
          expect(
            parameter_node !== undefined,
            "Baba bracket lambda lost a parameter node.",
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
            if (parameter.type_annotation !== undefined) {
              binding.type_annotation = parameter.type_annotation;
            }
            if (parameter.is_variadic === true) binding.is_variadic = true;
            entry_pattern = binding;
          }
          mark_source_span(entry_pattern, {
            start: parameter_node.start,
            end: parameter_node.end,
          });
          const entry: ProductPatternEntry = { pattern: entry_pattern };
          mark_source_span(entry, {
            start: parameter_node.start,
            end: parameter_node.end,
          });
          return entry;
        });
        pattern = { tag: "product", entries };
        mark_source_span(pattern, {
          start: parameter_container.start,
          end: parameter_container.end,
        });
        const generated_name = synthetic_parameter_names.get(
          parameter_container,
        );
        expect(
          generated_name !== undefined,
          "Baba bracket lambda has no structural parameter identity.",
        );
        const structural_parameter: Param = {
          name: generated_name,
          is_const: false,
          is_linear: false,
          annotation: undefined,
        };
        mark_source_span(structural_parameter, {
          start: parameter_container.start,
          end: parameter_container.end,
        });
        expression_parameters = [structural_parameter];
      } else if (parameters.length === 0) {
        pattern = { tag: "unit" };
        mark_source_span(pattern, {
          start: parameter_container.start,
          end: parameter_container.end,
        });
      } else if (
        parameters.length === 1 &&
        (
          parameter_container.kind !== "parameter_list" ||
          !parameter_container.children.some((child) => child.kind === '","')
        )
      ) {
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
          parameter_node.kind === "wildcard" ||
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
      let expression: FrontExpr;
      if (expression_kind === "rec") {
        expression = {
          tag: "rec",
          pattern,
          params: expression_parameters,
          body,
        };
      } else {
        expression = {
          tag: "lam",
          pattern,
          params: expression_parameters,
          body,
        };
      }
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
  let lowered_function = lower_expression(function_node, source);
  const direct_function_node = semantic_child(function_node);
  if (
    function_node.kind === "postfix_expression" &&
    direct_function_node?.kind === "union_case"
  ) {
    lowered_function = lower_union_case(
      direct_function_node,
      source,
      "application_argument",
    );
  } else if (function_node.kind === "union_case") {
    lowered_function = lower_union_case(
      function_node,
      source,
      "application_argument",
    );
  }
  let lowered_argument = lower_expression(argument_node, source);
  const direct_argument_node = semantic_child(argument_node);
  if (
    argument_node.kind === "postfix_expression" &&
    direct_argument_node?.kind === "union_case"
  ) {
    lowered_argument = lower_union_case(
      direct_argument_node,
      source,
      "application_argument",
    );
  } else if (argument_node.kind === "union_case") {
    lowered_argument = lower_union_case(
      argument_node,
      source,
      "application_argument",
    );
  }
  let constructor_call_check: Checked<null> = ok(null);
  const parsed_function = checked_value(lowered_function);
  const parsed_argument = checked_value(lowered_argument);
  if (
    parsed_function?.tag === "var" &&
    parsed_function.name.startsWith("@wasm.") &&
    source.slice(argument_node.start, argument_node.start + 1) !== "(" &&
    parsed_argument !== undefined
  ) {
    const prim = wasm_intrinsic_prim(
      parsed_function.name.slice("@wasm.".length),
    );
    if (prim === undefined) {
      return fail(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Unknown Wasm intrinsic: " + parsed_function.name,
          source_span(parsed_function),
        ),
      );
    }
    let args = [parsed_argument];
    if (parsed_argument.tag === "unit") args = [];
    if (
      parsed_argument.tag === "product" &&
      parsed_argument.entries.every((entry) => entry.label === undefined)
    ) {
      args = parsed_argument.entries.map((entry) => entry.value);
    }
    if (args.length !== 2) {
      return fail(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Wasm intrinsic " + parsed_function.name +
            " expects a product of 2 values, got " +
            args.length.toString(),
          { start: argument_node.start, end: argument_node.end },
        ),
      );
    }
    const left = args[0];
    const right = args[1];
    expect(left !== undefined, "Baba Wasm intrinsic lost its left operand.");
    expect(right !== undefined, "Baba Wasm intrinsic lost its right operand.");
    const expression: FrontExpr = { tag: "prim", prim, left, right };
    mark_source_span(expression, { start: node.start, end: node.end });
    return ok(expression);
  }
  let called_constructor_node: BabaCstNode | undefined;
  if (
    argument_node.kind === "parenthesized_or_product" &&
    function_node.end === argument_node.start
  ) {
    const constructor_nodes: BabaCstNode[] = [];
    if (function_node.kind === "union_case") {
      constructor_nodes.push(function_node);
    }
    constructor_nodes.push(
      ...descendants_of_kind(function_node, "union_case"),
    );
    for (let index = constructor_nodes.length - 1; index >= 0; index -= 1) {
      const candidate = constructor_nodes[index];
      expect(candidate !== undefined, "Baba union call candidate disappeared.");
      if (
        candidate.end === function_node.end &&
        !candidate.children.some((child) => is_expression_node(child))
      ) {
        called_constructor_node = candidate;
        break;
      }
    }
  }
  if (called_constructor_node !== undefined) {
    const name_node = called_constructor_node.children.find((child) =>
      child.kind === "constructor_identifier"
    );
    expect(
      name_node !== undefined,
      "Baba called union constructor has no name.",
    );
    constructor_call_check = fail(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        "Union constructor application uses #" +
          source.slice(name_node.start, name_node.end) + " value",
        { start: argument_node.start, end: argument_node.end },
      ),
    );
  } else if (
    parsed_function?.tag === "union_case" &&
    parsed_function.value === undefined &&
    parsed_argument?.tag === "unit"
  ) {
    constructor_call_check = fail(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        "Union constructor application uses #" + parsed_function.name +
          " value",
        { start: argument_node.start, end: argument_node.end },
      ),
    );
  }
  const nested_hole_check = validate_nested_argument_holes(argument_node);
  const application = Applicative.lift(
    (
      func: FrontExpr,
      arg: FrontExpr,
      _constructor_call: null,
      _nested_holes: null,
    ) => {
      if (func.tag === "union_case" && func.value === undefined) {
        const expression: FrontExpr = { ...func, value: arg };
        mark_source_span(expression, { start: node.start, end: node.end });
        return expression;
      }
      let args = [arg];
      if (arg.tag === "unit") {
        args = [];
        if (
          argument_node.kind === "parenthesized_or_product" &&
          argument_node.children.some((child) =>
            child.kind === "unit_pattern"
          ) &&
          function_node.end === argument_node.start
        ) {
          derive_source_span(arg, { start: node.start, end: node.end });
        }
      }
      if (arg.tag === "product" && arg.value_pack === true) {
        args = arg.entries.map((entry) => entry.value);
      }
      const expression: FrontExpr = {
        tag: "app",
        func,
        arg,
        args,
      };
      return expression;
    },
    lowered_function,
    lowered_argument,
    constructor_call_check,
    nested_hole_check,
  );
  const parsed_application = checked_value(application);
  if (parsed_application === undefined) return application;
  if (parsed_application.tag !== "app") return application;
  const argument = parsed_application.arg;
  expect(argument !== undefined, "Baba application has no unary argument.");
  const params: Param[] = [];
  const replace_hole = (value: FrontExpr): FrontExpr => {
    if (value.tag !== "var" || value.name !== hole_name) return value;
    const name = "__hole_" + params.length.toString();
    params.push({
      name,
      is_const: false,
      is_linear: false,
      annotation: undefined,
    });
    return { tag: "var", name };
  };
  let replaced_argument = argument;
  if (argument.tag === "product") {
    const entries = argument.entries.map((entry) => {
      return {
        ...entry,
        value: replace_hole(entry.value),
      };
    });
    replaced_argument = {
      ...argument,
      entries,
    };
    if (hole_product_retains_span(argument_node)) {
      if (source_span_origin(argument) === "concrete") {
        mark_source_span(replaced_argument, source_span(argument));
      } else {
        derive_source_span(replaced_argument, source_span(argument));
      }
    }
  } else {
    replaced_argument = replace_hole(argument);
  }
  if (contains_hole_lambda(replaced_argument)) {
    return fail(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        "A hole cannot appear inside a nested call; write the lambda instead",
        { start: argument_node.start, end: argument_node.end },
      ),
    );
  }
  if (contains_hole(replaced_argument)) {
    return fail(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        "A hole cannot appear inside a nested call; write the lambda instead",
        { start: argument_node.start, end: argument_node.end },
      ),
    );
  }
  if (params.length === 0) {
    mark_source_span(parsed_application, {
      start: node.start,
      end: node.end,
    });
    return ok(parsed_application);
  }
  let body_arguments = [replaced_argument];
  if (
    replaced_argument.tag === "product" &&
    replaced_argument.value_pack === true
  ) {
    body_arguments = replaced_argument.entries.map((entry) => entry.value);
  }
  const body: FrontExpr = {
    ...parsed_application,
    arg: replaced_argument,
    args: body_arguments,
  };
  const expression = mark_hole_lambda({
    tag: "lam",
    params,
    body,
    hole_params: params.map((param) => param.name),
  });
  mark_source_span(expression, { start: node.start, end: node.end });
  return ok(expression);
}

function validate_nested_argument_holes(
  argument_node: BabaCstNode,
): Checked<null> {
  const direct_holes = direct_argument_holes(argument_node);
  const wildcards = expression_argument_holes(argument_node);
  const nested = wildcards.find((wildcard) => {
    if (direct_holes.has(wildcard)) return false;
    return !descendant_application_owns_hole(argument_node, wildcard);
  });
  if (nested === undefined) return ok(null);
  return fail(
    compiler_diagnostic(
      diagnostic_codes.syntax_error,
      "A hole cannot appear inside a nested call; write the lambda instead",
      { start: nested.start, end: nested.end },
    ),
  );
}

function descendant_application_owns_hole(
  argument_node: BabaCstNode,
  wildcard: BabaCstNode,
): boolean {
  const pending = [...argument_node.children];
  while (pending.length > 0) {
    const candidate = pending.pop();
    expect(candidate !== undefined, "Baba application traversal lost a node.");
    if (
      candidate.kind === "application_expression" ||
      candidate.kind === "call_expression" ||
      candidate.kind === "condition_call_expression" ||
      candidate.kind === "condition_application_expression"
    ) {
      const expressions = candidate.children.filter((child) =>
        is_expression_node(child)
      );
      const nested_argument = expressions[1];
      if (
        nested_argument !== undefined &&
        cst_contains(nested_argument, wildcard) &&
        !direct_argument_holes(nested_argument).has(wildcard)
      ) {
        return true;
      }
    }
    pending.push(...candidate.children);
  }
  return false;
}

function cst_contains(node: BabaCstNode, target: BabaCstNode): boolean {
  const pending = [node];
  while (pending.length > 0) {
    const current = pending.pop();
    expect(current !== undefined, "Baba containment traversal lost a node.");
    if (current === target) return true;
    pending.push(...current.children);
  }
  return false;
}

function expression_argument_holes(node: BabaCstNode): BabaCstNode[] {
  const holes: BabaCstNode[] = [];
  const pending = [{ node, parent_kind: undefined as string | undefined }];
  while (pending.length > 0) {
    const current = pending.pop();
    expect(current !== undefined, "Baba hole traversal lost its node.");
    if (
      current.node.kind === "wildcard" &&
      (
        current.parent_kind === undefined ||
        current.parent_kind === "postfix_expression"
      )
    ) {
      holes.push(current.node);
      continue;
    }
    for (
      let index = current.node.children.length - 1;
      index >= 0;
      index -= 1
    ) {
      const child = current.node.children[index];
      expect(child !== undefined, "Baba hole child disappeared.");
      pending.push({ node: child, parent_kind: current.node.kind });
    }
  }
  return holes;
}

function direct_argument_holes(
  argument_node: BabaCstNode,
): Set<BabaCstNode> {
  const direct_holes = new Set<BabaCstNode>();
  const argument = unwrap_hole_expression(argument_node);
  if (argument.kind === "wildcard") {
    direct_holes.add(argument);
    return direct_holes;
  }
  let entries: BabaCstNode[] = [];
  if (
    argument.kind === "positional_product" ||
    argument.kind === "condition_positional_product" ||
    argument.kind === "array_expression"
  ) {
    entries = argument.children.filter((child) => is_expression_node(child));
  } else if (argument.kind === "named_product") {
    for (
      const field of argument.children.filter((child) =>
        child.kind === "product_field"
      )
    ) {
      const name = field.children.find((child) =>
        child.kind === "identifier" || child.kind === '"end"'
      );
      const value = field.children.find((child) =>
        child !== name && is_expression_node(child)
      );
      if (value !== undefined) entries.push(value);
    }
  }
  for (const entry of entries) {
    const direct = unwrap_hole_expression(entry);
    if (direct.kind === "wildcard") direct_holes.add(direct);
  }
  return direct_holes;
}

function hole_product_retains_span(argument_node: BabaCstNode): boolean {
  const argument = unwrap_hole_expression(argument_node);
  if (
    argument.kind !== "positional_product" &&
    argument.kind !== "condition_positional_product"
  ) {
    return true;
  }
  return argument.start > argument_node.start ||
    argument.end < argument_node.end;
}

function unwrap_hole_expression(node: BabaCstNode): BabaCstNode {
  let expression = node;
  while (
    expression.kind === "postfix_expression" ||
    expression.kind === "parenthesized_expression" ||
    expression.kind === "parenthesized_or_product" ||
    expression.kind === "condition_expression" ||
    expression.kind === "condition_postfix_expression" ||
    expression.kind === "condition_parenthesized_expression"
  ) {
    const child = semantic_child(expression);
    if (child === undefined) return expression;
    expression = child;
  }
  return expression;
}

function lower_recursive_call(
  node: BabaCstNode,
  source: string,
): Checked<FrontExpr> {
  const argument_node = node.children.find((child) =>
    child.kind === "parenthesized_or_product"
  );
  if (argument_node === undefined) return unsupported(node);
  const recursive_name_node = node.children.find((child) =>
    source.slice(child.start, child.end) === "rec"
  );
  if (recursive_name_node === undefined) return unsupported(node);
  const direct_argument = semantic_child(argument_node);
  if (direct_argument === undefined) return unsupported(argument_node);
  return lower_expression(argument_node, source).map((arg) => {
    const func: FrontExpr = { tag: "var", name: "rec" };
    mark_source_span(func, {
      start: recursive_name_node.start,
      end: recursive_name_node.end,
    });
    let args = [arg];
    if (arg.tag === "unit") args = [];
    if (
      direct_argument.kind === "positional_product" &&
      arg.tag === "product" && arg.value_pack === true
    ) {
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
  });
}

function semantic_child(node: BabaCstNode): BabaCstNode | undefined {
  return node.children.find((child) => is_expression_node(child));
}

function is_expression_node(node: BabaCstNode): boolean {
  return node.kind === "prefix_by_proof_expression" ||
    node.kind === "computational_pack_expression" ||
    node.kind === "postfix_expression" ||
    node.kind === "parenthesized_expression" ||
    node.kind === "parenthesized_or_product" ||
    node.kind === "condition_expression" ||
    node.kind === "condition_postfix_expression" ||
    node.kind === "condition_parenthesized_expression" ||
    node.kind === "condition_call_arguments" ||
    node.kind === "identifier" ||
    node.kind === "intrinsic_identifier" ||
    node.kind === "number" ||
    node.kind === "boolean" ||
    node.kind === "string" ||
    node.kind === "template_literal" ||
    node.kind === "character" ||
    node.kind === "wildcard" ||
    node.kind === "include_expression" ||
    node.kind === "scratch_expression" ||
    node.kind === "atom_expression" ||
    node.kind === "linear_reference" ||
    node.kind === "unit_pattern" ||
    node.kind === "binary_expression" ||
    node.kind === "condition_binary_expression" ||
    node.kind === "arrow_function" ||
    node.kind === "recursive_function" ||
    node.kind === "recursive_call_expression" ||
    node.kind === "try_with_expression" ||
    node.kind === "effect_handler_expression" ||
    node.kind === "application_expression" ||
    node.kind === "call_expression" ||
    node.kind === "condition_call_expression" ||
    node.kind === "condition_application_expression" ||
    node.kind === "positional_product" ||
    node.kind === "condition_positional_product" ||
    node.kind === "block" ||
    node.kind === "if_expression" ||
    node.kind === "case_expression" ||
    node.kind === "case_function_expression" ||
    node.kind === "condition_unary_expression" ||
    node.kind === "unary_expression" ||
    node.kind === "array_expression" ||
    node.kind === "array_repeat_expression" ||
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
    node.kind === "shape_nullary_union_case" ||
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
