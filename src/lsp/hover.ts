import type {
  BindingEntity,
  BindingIndex,
  EntityId,
} from "../frontend/binding_index.ts";
import type {
  FrontEffectAnalysis,
  FrontExpr,
  Param,
  Source,
  Stmt,
} from "../frontend.ts";
import { analyze_front_effects } from "../frontend/effect_analysis.ts";
import { format_expr, format_source } from "../frontend/format.ts";
import { name_sites } from "../frontend/name_site.ts";
import type { SourceSyntax } from "../frontend/syntax.ts";
import { source_tokens } from "../frontend/tokenize.ts";
import { front_type_name } from "../frontend/types.ts";
import { attached_documentation } from "./documentation.ts";
import {
  type LspRange,
  type PositionEncoding,
  PositionIndex,
} from "./position.ts";
import { entity_type_declaration, type_entity_layout } from "./type_layout.ts";

export type LspHover = {
  contents: { kind: "markdown"; value: string };
  range: LspRange;
};

export type LspSignatureHelp = {
  signatures: LspSignatureInformation[];
  activeSignature: number;
  activeParameter: number;
};

export type LspSignatureInformation = {
  label: string;
  documentation?: { kind: "markdown"; value: string };
  parameters: { label: string }[];
  activeParameter: number;
};

export type EditorValue = {
  expr: FrontExpr;
  captures: Map<string, EditorValue> | undefined;
};

export type BindingFact = {
  statement: Extract<Stmt, { tag: "bind" | "assign" }>;
  value: EditorValue;
};

type CallFrame = {
  token_index: number;
  commas: number;
};

export function hover(
  source: Source,
  syntax: SourceSyntax,
  index: BindingIndex,
  offset: number,
  encoding: PositionEncoding,
): LspHover | undefined {
  const occurrence = index.occurrence_at(offset);

  if (occurrence === undefined || occurrence.entity === undefined) {
    return undefined;
  }

  const entity = index.entities.get(occurrence.entity);

  if (entity === undefined) {
    throw new Error("Missing hover entity: " + occurrence.entity);
  }

  const sections: string[] = [];
  const definition = entity_definition(index, entity);

  if (definition !== undefined) {
    const documentation = attached_documentation(
      syntax.text,
      definition.span.start,
    );

    if (documentation !== undefined) {
      sections.push(documentation);
    }
  }

  const type_declaration = entity_type_declaration(source, entity);

  if (type_declaration !== undefined) {
    sections.unshift("**type** `" + entity.name + "`");
    sections.push(
      "```ix\n" + format_source({
        tag: "program",
        declarations: [type_declaration],
        statements: [],
      }) + "\n```",
    );
    const layout = type_entity_layout(source, entity);

    if (layout !== undefined) {
      sections.push(format_layout(layout));
    }
  } else {
    const effect = effect_declaration(source, entity);

    if (effect !== undefined) {
      sections.unshift("**effect** `" + entity.name + "`");
      sections.push(
        "```ix\n" + format_source({
          tag: "program",
          declarations: [effect],
          statements: [],
        }) + "\n```",
      );
    } else {
      append_binding_hover(source, syntax, index, entity, sections, encoding);
    }
  }

  const positions = new PositionIndex(syntax.text, encoding);
  return {
    contents: { kind: "markdown", value: sections.join("\n\n") },
    range: {
      start: positions.position_from_offset(occurrence.span.start),
      end: positions.position_from_offset(occurrence.span.end),
    },
  };
}

export function signature_help(
  source: Source,
  syntax: SourceSyntax,
  index: BindingIndex,
  offset: number,
): LspSignatureHelp | undefined {
  const tokens = source_tokens(syntax);
  const frames = open_call_frames(tokens, offset);
  const values = editor_binding_facts(source, index);
  const effects = editor_effect_analysis(source);

  for (let cursor = frames.length - 1; cursor >= 0; cursor -= 1) {
    const frame = frames[cursor];

    if (frame === undefined) {
      throw new Error("Missing signature frame");
    }

    const target = call_target(tokens, frame.token_index);

    if (target === undefined) {
      continue;
    }

    if (target.receiver !== undefined) {
      const operation = effect_operation(
        source,
        target.receiver,
        target.name,
      );

      if (operation !== undefined) {
        const labels = operation.params.map((param) => param.type_name);
        const signature: LspSignatureInformation = {
          label: target.receiver + "." + target.name + "(" +
            labels.join(", ") + ") => " + operation.result.type_name,
          parameters: labels.map((label) => ({ label })),
          activeParameter: frame.commas,
        };
        attach_signature_documentation(
          signature,
          syntax,
          index,
          target.name,
          "operation",
        );
        return signature_result(signature, frame.commas);
      }
    }

    const entity = index.visible_at(offset).find((candidate) =>
      candidate.name === target.name
    );

    if (entity === undefined) {
      continue;
    }

    const value = values.get(entity.id);
    let closure: Extract<FrontExpr, { tag: "lam" | "rec" }> | undefined;

    if (
      value !== undefined &&
      (value.value.expr.tag === "lam" || value.value.expr.tag === "rec")
    ) {
      closure = value.value.expr;
    } else {
      const statement = binding_statement(source, index, entity);

      if (
        statement !== undefined && statement.tag === "bind" &&
        (statement.value.tag === "lam" || statement.value.tag === "rec")
      ) {
        closure = statement.value;
      }
    }

    if (closure === undefined) {
      continue;
    }

    const labels = closure.params.map(format_param);
    let effect_row = "<pure>";
    const function_effects = effects.functions[entity.name];

    if (function_effects !== undefined && function_effects.effects.length > 0) {
      effect_row = format_effects(function_effects.effects);
    }

    const signature: LspSignatureInformation = {
      label: entity.name + "(" + labels.join(", ") + ") " + effect_row,
      parameters: labels.map((label) => ({ label })),
      activeParameter: frame.commas,
    };
    attach_signature_documentation(
      signature,
      syntax,
      index,
      entity.name,
      entity.kind,
    );
    return signature_result(signature, frame.commas);
  }

  return undefined;
}

function append_binding_hover(
  source: Source,
  syntax: SourceSyntax,
  index: BindingIndex,
  entity: BindingEntity,
  sections: string[],
  encoding: PositionEncoding,
): void {
  const facts = index.facts.get(entity.id);
  const values = editor_binding_facts(source, index);
  const binding = values.get(entity.id);
  let kind: string = entity.kind;

  if (entity.linear) {
    kind = "linear capability";
  } else if (
    binding !== undefined &&
    (binding.value.expr.tag === "lam" || binding.value.expr.tag === "rec")
  ) {
    if (entity.kind === "const") {
      kind = "const closure";
    } else {
      kind = "runtime closure";
    }
  } else if (entity.kind === "const") {
    kind = "const value";
  } else if (entity.kind === "value") {
    kind = "runtime binding";
  }

  sections.unshift("**" + kind + "** `" + entity.name + "`");

  if (facts !== undefined) {
    if (facts.nominal !== undefined) {
      const nominal = index.entities.get(facts.nominal);

      if (nominal !== undefined) {
        sections.push("type: `" + nominal.name + "`");
      }
    } else if (facts.type !== undefined) {
      sections.push("type: `" + front_type_name(facts.type) + "`");
    }
  }

  const statement = binding_statement(source, index, entity);

  if (
    statement !== undefined && statement.tag === "bind" &&
    statement.annotation !== undefined
  ) {
    sections.push("declared type: `" + statement.annotation + "`");
  }

  if (binding !== undefined) {
    const value = binding.value;

    if (value.expr.tag === "lam" || value.expr.tag === "rec") {
      sections.push("```ix\n" + capped_format_expr(value.expr) + "\n```");
      append_captures(value, sections);
      const effects = editor_effect_analysis(source);
      const function_effects = effects.functions[entity.name];
      let row = "<pure>";

      if (
        function_effects !== undefined && function_effects.effects.length > 0
      ) {
        row = format_effects(function_effects.effects);
      }

      sections.push("latent effects: `" + row + "`");
    } else if (entity.kind === "const") {
      sections.push(
        "value:\n```ix\n" + capped_format_expr(value.expr) +
          "\n```",
      );
    }

    sections.push("ownership: `" + ownership_class(entity, binding) + "`");
  }

  if (entity.linear) {
    append_consume_points(index, entity, syntax.text, encoding, sections);
  }

  const declared = declared_member_hover(source, index, entity);

  if (declared !== undefined) {
    sections.push(declared);
  }
}

export function editor_binding_facts(
  source: Source,
  index: BindingIndex,
): Map<EntityId, BindingFact> {
  const facts = new Map<EntityId, BindingFact>();
  const env = new Map<string, EditorValue>();

  for (const statement of source.statements) {
    if (statement.tag === "bind") {
      const entity = entity_for_owner(index, statement, "name", statement.name);
      const value = eval_editor_value(statement.value, env, 0);

      if (entity !== undefined) {
        facts.set(entity, { statement, value });
      }

      env.set(statement.name, value);
      continue;
    }

    if (statement.tag === "assign") {
      const value = eval_editor_value(statement.value, env, 0);
      const entity = entity_for_owner(index, statement, "name", statement.name);

      if (entity !== undefined) {
        facts.set(entity, { statement, value });
      }

      env.set(statement.name, value);
    }
  }

  return facts;
}

export function eval_editor_value(
  expr: FrontExpr,
  env: Map<string, EditorValue>,
  depth: number,
): EditorValue {
  if (depth >= 12) {
    return { expr, captures: undefined };
  }

  if (expr.tag === "var" || expr.tag === "linear") {
    const value = env.get(expr.name);

    if (value !== undefined) {
      return value;
    }

    return { expr, captures: undefined };
  }

  if (expr.tag === "comptime" || expr.tag === "captured") {
    return eval_editor_value(expr.expr, env, depth + 1);
  }

  if (expr.tag === "lam" || expr.tag === "rec") {
    const bound = new Set(expr.params.map((param) => param.name));
    const free = free_expr_names(expr.body, bound);
    const captures = new Map<string, EditorValue>();

    for (const name of free) {
      const value = env.get(name);

      if (value !== undefined) {
        captures.set(name, value);
      }
    }

    return { expr, captures };
  }

  if (expr.tag === "app") {
    const func = eval_editor_value(expr.func, env, depth + 1);

    if (
      func.captures !== undefined &&
      (func.expr.tag === "lam" || func.expr.tag === "rec") &&
      func.expr.params.length === expr.args.length
    ) {
      const call_env = new Map(func.captures);

      for (let index = 0; index < func.expr.params.length; index += 1) {
        const param = func.expr.params[index];
        const arg = expr.args[index];

        if (param === undefined || arg === undefined) {
          throw new Error("Missing editor call argument");
        }

        call_env.set(param.name, eval_editor_value(arg, env, depth + 1));
      }

      return eval_editor_value(func.expr.body, call_env, depth + 1);
    }

    return { expr, captures: undefined };
  }

  if (expr.tag === "prim") {
    const left = eval_editor_value(expr.left, env, depth + 1);
    const right = eval_editor_value(expr.right, env, depth + 1);
    const folded = fold_editor_prim(expr.prim, left.expr, right.expr);

    if (folded !== undefined) {
      return { expr: folded, captures: undefined };
    }

    return {
      expr: { ...expr, left: left.expr, right: right.expr },
      captures: undefined,
    };
  }

  if (expr.tag === "block") {
    return eval_editor_block(expr.statements, env, depth + 1);
  }

  if (expr.tag === "if") {
    const condition = eval_editor_value(expr.cond, env, depth + 1);

    if (condition.expr.tag === "num") {
      let truthy = false;

      if (typeof condition.expr.value === "bigint") {
        truthy = condition.expr.value !== 0n;
      } else {
        truthy = condition.expr.value !== 0;
      }

      if (truthy) {
        return eval_editor_value(expr.then_branch, env, depth + 1);
      }

      return eval_editor_value(expr.else_branch, env, depth + 1);
    }
  }

  if (expr.tag === "struct_value") {
    return {
      expr: {
        ...expr,
        fields: expr.fields.map((field) => ({
          ...field,
          value: eval_editor_value(field.value, env, depth + 1).expr,
        })),
      },
      captures: undefined,
    };
  }

  if (expr.tag === "union_case" && expr.value !== undefined) {
    return {
      expr: {
        ...expr,
        value: eval_editor_value(expr.value, env, depth + 1).expr,
      },
      captures: undefined,
    };
  }

  return { expr, captures: undefined };
}

function fold_editor_prim(
  prim: string,
  left: FrontExpr,
  right: FrontExpr,
): FrontExpr | undefined {
  if (left.tag !== "num" || right.tag !== "num") {
    return undefined;
  }

  const left_value = BigInt(left.value);
  const right_value = BigInt(right.value);
  const operation = prim.slice(prim.indexOf(".") + 1);
  let result: bigint;
  let comparison = false;

  if (operation === "add") {
    result = left_value + right_value;
  } else if (operation === "sub") {
    result = left_value - right_value;
  } else if (operation === "mul") {
    result = left_value * right_value;
  } else if (operation === "div_s") {
    if (right_value === 0n) {
      return undefined;
    }

    result = left_value / right_value;
  } else if (operation === "rem_s") {
    if (right_value === 0n) {
      return undefined;
    }

    result = left_value % right_value;
  } else if (operation === "eq") {
    comparison = true;
    result = 0n;

    if (left_value === right_value) {
      result = 1n;
    }
  } else if (operation === "ne") {
    comparison = true;
    result = 0n;

    if (left_value !== right_value) {
      result = 1n;
    }
  } else if (operation === "lt_s") {
    comparison = true;
    result = 0n;

    if (left_value < right_value) {
      result = 1n;
    }
  } else if (operation === "le_s") {
    comparison = true;
    result = 0n;

    if (left_value <= right_value) {
      result = 1n;
    }
  } else if (operation === "gt_s") {
    comparison = true;
    result = 0n;

    if (left_value > right_value) {
      result = 1n;
    }
  } else if (operation === "ge_s") {
    comparison = true;
    result = 0n;

    if (left_value >= right_value) {
      result = 1n;
    }
  } else {
    return undefined;
  }

  if (comparison) {
    return { tag: "num", type: "i32", value: Number(result) };
  }

  if (prim.startsWith("i64.")) {
    return { tag: "num", type: "i64", value: BigInt.asIntN(64, result) };
  }

  return { tag: "num", type: "i32", value: Number(BigInt.asIntN(32, result)) };
}

function eval_editor_block(
  statements: Stmt[],
  outer: Map<string, EditorValue>,
  depth: number,
): EditorValue {
  const env = new Map(outer);
  let result: EditorValue = {
    expr: { tag: "unit" },
    captures: undefined,
  };

  for (const statement of statements) {
    if (statement.tag === "bind") {
      const value = eval_editor_value(statement.value, env, depth + 1);
      env.set(statement.name, value);
      result = value;
      continue;
    }

    if (statement.tag === "assign") {
      const value = eval_editor_value(statement.value, env, depth + 1);
      env.set(statement.name, value);
      result = value;
      continue;
    }

    if (statement.tag === "expr") {
      result = eval_editor_value(statement.expr, env, depth + 1);
      continue;
    }

    if (statement.tag === "return") {
      return eval_editor_value(statement.value, env, depth + 1);
    }
  }

  return result;
}

function free_expr_names(expr: FrontExpr, bound: Set<string>): Set<string> {
  const names = new Set<string>();

  if (expr.tag === "var" || expr.tag === "linear") {
    if (!bound.has(expr.name)) {
      names.add(expr.name);
    }

    return names;
  }

  if (expr.tag === "lam" || expr.tag === "rec") {
    const nested = new Set(bound);

    for (const param of expr.params) {
      nested.add(param.name);
    }

    return free_expr_names(expr.body, nested);
  }

  if (expr.tag === "block") {
    return free_statement_names(expr.statements, bound);
  }

  if (expr.tag === "loop") {
    return free_statement_names(expr.body, bound);
  }

  if (expr.tag === "if_let") {
    const names = free_expr_names(expr.target, bound);
    const then_bound = new Set(bound);

    if (expr.value_name !== undefined) {
      then_bound.add(expr.value_name);
    }

    add_names(names, free_expr_names(expr.then_branch, then_bound));
    add_names(names, free_expr_names(expr.else_branch, bound));
    return names;
  }

  if (expr.tag === "handler") {
    const names = new Set<string>();
    const handler_bound = new Set(bound);

    for (const state of expr.state) {
      add_names(names, free_expr_names(state.value, handler_bound));
      handler_bound.add(state.name);
    }

    for (const clause of expr.clauses) {
      const clause_bound = new Set(handler_bound);

      for (const param of clause.params) {
        clause_bound.add(param.name);
      }

      add_names(names, free_expr_names(clause.body, clause_bound));
    }

    const return_bound = new Set(handler_bound);
    return_bound.add(expr.return_clause.param.name);
    add_names(
      names,
      free_expr_names(expr.return_clause.body, return_bound),
    );
    return names;
  }

  for (const child of expression_children(expr)) {
    for (const name of free_expr_names(child, bound)) {
      names.add(name);
    }
  }

  return names;
}

function free_statement_names(
  statements: Stmt[],
  outer: Set<string>,
): Set<string> {
  const bound = new Set(outer);
  const names = new Set<string>();

  for (const statement of statements) {
    if (statement.tag === "bind" || statement.tag === "assign") {
      add_names(names, free_expr_names(statement.value, bound));
      bound.add(statement.name);
      continue;
    }

    if (
      statement.tag === "state_bind" || statement.tag === "bind_pattern" ||
      statement.tag === "resume_dup"
    ) {
      add_names(names, free_expr_names(statement.value, bound));

      if (statement.tag === "state_bind") {
        if (statement.value_name !== undefined) {
          bound.add(statement.value_name);
        }
      } else if (statement.tag === "bind_pattern") {
        for (const item of statement.items) {
          bound.add(item.name);
        }
      } else {
        bound.add(statement.left);
        bound.add(statement.right);
      }

      continue;
    }

    if (statement.tag === "index_assign") {
      if (!bound.has(statement.name)) {
        names.add(statement.name);
      }

      add_names(names, free_expr_names(statement.index, bound));
      add_names(names, free_expr_names(statement.value, bound));
      continue;
    }

    if (statement.tag === "expr") {
      add_names(names, free_expr_names(statement.expr, bound));
      continue;
    }

    if (statement.tag === "return") {
      add_names(names, free_expr_names(statement.value, bound));
      continue;
    }

    if (statement.tag === "if_stmt") {
      add_names(names, free_expr_names(statement.cond, bound));
      add_names(names, free_statement_names(statement.body, bound));
      continue;
    }

    if (statement.tag === "if_let_stmt") {
      add_names(names, free_expr_names(statement.target, bound));
      const body_bound = new Set(bound);

      if (statement.value_name !== undefined) {
        body_bound.add(statement.value_name);
      }

      add_names(names, free_statement_names(statement.body, body_bound));
      continue;
    }

    if (statement.tag === "for_range") {
      add_names(names, free_expr_names(statement.start, bound));
      add_names(names, free_expr_names(statement.end, bound));
      add_names(names, free_expr_names(statement.step, bound));
      const body_bound = new Set(bound);
      body_bound.add(statement.index);
      add_names(names, free_statement_names(statement.body, body_bound));
      continue;
    }

    if (statement.tag === "for_collection") {
      add_names(names, free_expr_names(statement.collection, bound));
      const body_bound = new Set(bound);

      if (statement.index !== undefined) {
        body_bound.add(statement.index);
      }

      body_bound.add(statement.item);
      add_names(names, free_statement_names(statement.body, body_bound));
      continue;
    }

    if (statement.tag === "type_check") {
      add_names(names, free_expr_names(statement.target, bound));
      continue;
    }

    if (statement.tag === "break" && statement.value !== undefined) {
      add_names(names, free_expr_names(statement.value, bound));
    }
  }

  return names;
}

function expression_children(expr: FrontExpr): FrontExpr[] {
  if (expr.tag === "prim") {
    return [expr.left, expr.right];
  }

  if (expr.tag === "app") {
    return [expr.func, ...expr.args];
  }

  if (expr.tag === "comptime" || expr.tag === "captured") {
    return [expr.expr];
  }

  if (expr.tag === "borrow" || expr.tag === "freeze") {
    return [expr.value];
  }

  if (expr.tag === "scratch") {
    return [expr.body];
  }

  if (expr.tag === "field") {
    return [expr.object];
  }

  if (expr.tag === "index") {
    return [expr.object, expr.index];
  }

  if (expr.tag === "try_with") {
    return [expr.body, expr.handler];
  }

  if (expr.tag === "if") {
    return [expr.cond, expr.then_branch, expr.else_branch];
  }
  if (expr.tag === "with" || expr.tag === "struct_update") {
    return [expr.base, ...expr.fields.map((field) => field.value)];
  }
  if (expr.tag === "struct_value") {
    return [expr.type_expr, ...expr.fields.map((field) => field.value)];
  }
  if (expr.tag === "union_case") {
    const children: FrontExpr[] = [];

    if (expr.type_expr !== undefined) {
      children.push(expr.type_expr);
    }

    if (expr.value !== undefined) {
      children.push(expr.value);
    }

    return children;
  }

  if (expr.tag === "is") {
    return [expr.value];
  }

  return [];
}

function add_names(target: Set<string>, source: Set<string>): void {
  for (const name of source) {
    target.add(name);
  }
}

function entity_for_owner(
  index: BindingIndex,
  owner: object,
  slot: string,
  name: string,
): EntityId | undefined {
  const site = name_sites(owner).find((candidate) =>
    candidate.slot === slot && candidate.name === name
  );

  if (site === undefined) {
    return undefined;
  }

  const occurrence = index.occurrence_at(site.span.start);
  return occurrence?.entity;
}

function binding_statement(
  source: Source,
  index: BindingIndex,
  entity: BindingEntity,
): Extract<Stmt, { tag: "bind" | "assign" }> | undefined {
  for (const statement of source.statements) {
    if (statement.tag !== "bind" && statement.tag !== "assign") {
      continue;
    }

    if (
      entity_for_owner(index, statement, "name", statement.name) === entity.id
    ) {
      return statement;
    }
  }

  return undefined;
}

function entity_definition(
  index: BindingIndex,
  entity: BindingEntity,
) {
  if (entity.definition === undefined) {
    return undefined;
  }

  return index.occurrences.get(entity.definition);
}

export function editor_effect_analysis(source: Source): FrontEffectAnalysis {
  try {
    return analyze_front_effects(source);
  } catch (error) {
    if (error instanceof Error) {
      return { module_effects: [], functions: {} };
    }

    throw error;
  }
}

function effect_declaration(source: Source, entity: BindingEntity) {
  if (entity.kind !== "effect" || source.declarations === undefined) {
    return undefined;
  }

  return source.declarations.find((declaration) =>
    declaration.tag === "effect" && declaration.name === entity.name
  );
}

function effect_operation(source: Source, effect: string, operation: string) {
  if (source.declarations === undefined) {
    return undefined;
  }

  for (const declaration of source.declarations) {
    if (declaration.tag === "effect" && declaration.name === effect) {
      return declaration.operations.find((candidate) =>
        candidate.name === operation
      );
    }
  }

  return undefined;
}

function declared_member_hover(
  source: Source,
  index: BindingIndex,
  entity: BindingEntity,
): string | undefined {
  if (entity.owner === undefined || source.declarations === undefined) {
    return undefined;
  }

  const owner = index.entities.get(entity.owner);

  if (owner === undefined) {
    return undefined;
  }

  for (const declaration of source.declarations) {
    if (declaration.name !== owner.name) {
      continue;
    }
    if (declaration.tag === "effect") {
      const operation = declaration.operations.find((candidate) =>
        candidate.name === entity.name
      );

      if (operation !== undefined) {
        return "signature: `" + owner.name + "." + operation.name + "(" +
          operation.params.map((param) => param.type_name).join(", ") +
          ") => " + operation.result.type_name + "`";
      }
    }
    let fields: { name: string; type_name: string }[] = [];

    if (declaration.tag === "record") {
      fields = declaration.fields;
    } else if (declaration.tag === "type") {
      if (declaration.body.tag === "product") {
        fields = declaration.body.fields;
      } else if (declaration.body.tag === "sum") {
        fields = declaration.body.cases;
      }
    }

    const field = fields.find((candidate) => candidate.name === entity.name);

    if (field !== undefined) {
      return entity.kind + " type: `" + field.type_name + "`";
    }
  }
  return undefined;
}

function format_layout(
  layout: NonNullable<ReturnType<typeof type_entity_layout>>,
): string {
  const parts = [
    "size: `" + layout.size.toString() + "`",
    "align: `" + layout.align.toString() + "`",
  ];

  if (layout.fields.length > 0) {
    const fields = layout.fields.map((field) => {
      let offset = "?";

      if (field.value.tag === "num") {
        offset = field.value.value.toString();
      }

      return "`" + field.name + " @ " + offset + "`";
    });
    parts.push("field offsets: " + fields.join(", "));
  }

  if (layout.tag_offset !== undefined) {
    parts.push("tag offset: `" + layout.tag_offset.toString() + "`");
  }

  if (layout.payload_offset !== undefined) {
    parts.push("payload offset: `" + layout.payload_offset.toString() + "`");
  }

  return "layout — " + parts.join(", ");
}

function append_captures(value: EditorValue, sections: string[]): void {
  const captures = value.captures;

  if (captures === undefined || captures.size === 0) {
    sections.push("captures: none");
    return;
  }

  const lines: string[] = [];
  let count = 0;

  for (const [name, captured] of captures) {
    if (count >= 8) {
      lines.push("- …");
      break;
    }

    lines.push("- `" + name + " = " + capped_format_expr(captured.expr) + "`");
    count += 1;
  }

  sections.push("captures:\n" + lines.join("\n"));
}

function append_consume_points(
  index: BindingIndex,
  entity: BindingEntity,
  text: string,
  encoding: PositionEncoding,
  sections: string[],
): void {
  const references = index.references.get(entity.id);
  const positions = new PositionIndex(text, encoding);
  const points: string[] = [];

  if (references !== undefined) {
    for (const reference of references) {
      const occurrence = index.occurrences.get(reference);

      if (occurrence !== undefined && occurrence.role === "consume") {
        const position = positions.position_from_offset(occurrence.span.start);
        points.push(
          "line " + (position.line + 1).toString() + ", column " +
            (position.character + 1).toString(),
        );
      }
    }
  }

  if (points.length === 0) {
    sections.push("consume status: not yet consumed");
  } else {
    sections.push("consume point: " + points.join("; "));
  }
}

function ownership_class(entity: BindingEntity, fact: BindingFact): string {
  if (entity.linear) {
    return "linear_capability";
  }

  if (fact.statement.tag === "bind") {
    if (fact.statement.value.tag === "freeze") {
      return "frozen_shareable";
    }

    if (fact.statement.value.tag === "scratch") {
      return "scratch_backed";
    }

    if (fact.statement.value.tag === "borrow") {
      return "borrow_view";
    }
  }

  if (
    fact.value.expr.tag === "num" || fact.value.expr.tag === "unit" ||
    fact.value.expr.tag === "atom"
  ) {
    return "scalar_local";
  }

  if (entity.kind === "const") {
    return "compile_time_static";
  }

  return "unique_heap";
}

export function capped_format_expr(expr: FrontExpr): string {
  let text = format_expr(expr);
  const depth = expression_depth(expr, 0);

  if (text.length > 480) {
    text = text.slice(0, 480) + "…";
  }

  if (depth > 8) {
    text += "\n… depth truncated at 8";
  }

  return text;
}

function expression_depth(expr: FrontExpr, depth: number): number {
  let maximum = depth;

  for (const child of expression_children(expr)) {
    maximum = Math.max(maximum, expression_depth(child, depth + 1));
  }

  return maximum;
}

function format_param(param: Param): string {
  let text = param.name;

  if (param.is_linear) {
    text = "!" + text;
  }

  if (param.is_const) {
    text = "const " + text;
  }

  if (param.annotation !== undefined) {
    text += ": " + param.annotation;
  }

  return text;
}

export function format_effects(
  effects: { effect: string; operation: string }[],
): string {
  return "<" +
    effects.map((effect) => effect.effect + "." + effect.operation).join(", ") +
    ">";
}

function open_call_frames(
  tokens: ReturnType<typeof source_tokens>,
  offset: number,
): CallFrame[] {
  const stack: { symbol: "(" | "[" | "{"; frame?: CallFrame }[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token === undefined || token.span.start >= offset) {
      break;
    }

    if (token.kind !== "symbol") {
      continue;
    }

    if (token.text === "(") {
      stack.push({ symbol: "(", frame: { token_index: index, commas: 0 } });
    } else if (token.text === "[") {
      stack.push({ symbol: "[" });
    } else if (token.text === "{") {
      stack.push({ symbol: "{" });
    } else if (token.text === ",") {
      const top = stack[stack.length - 1];

      if (top !== undefined && top.frame !== undefined) {
        top.frame.commas += 1;
      }
    } else if (token.text === ")") {
      pop_delimiter(stack, "(");
    } else if (token.text === "]") {
      pop_delimiter(stack, "[");
    } else if (token.text === "}") {
      pop_delimiter(stack, "{");
    }
  }

  const frames: CallFrame[] = [];

  for (const item of stack) {
    if (item.frame !== undefined) {
      frames.push(item.frame);
    }
  }

  return frames;
}

function pop_delimiter(
  stack: { symbol: "(" | "[" | "{"; frame?: CallFrame }[],
  symbol: "(" | "[" | "{",
): void {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const item = stack[index];

    if (item !== undefined && item.symbol === symbol) {
      stack.splice(index);
      return;
    }
  }
}

function call_target(
  tokens: ReturnType<typeof source_tokens>,
  open_index: number,
): { receiver?: string; name: string } | undefined {
  let cursor = open_index - 1;

  while (cursor >= 0 && tokens[cursor]?.kind === "newline") {
    cursor -= 1;
  }

  const name = tokens[cursor];

  if (name === undefined || name.kind !== "name") {
    return undefined;
  }

  const dot = tokens[cursor - 1];
  const receiver = tokens[cursor - 2];

  if (
    dot !== undefined && dot.kind === "symbol" && dot.text === "." &&
    receiver !== undefined && receiver.kind === "name"
  ) {
    return { receiver: receiver.text, name: name.text };
  }

  return { name: name.text };
}

function attach_signature_documentation(
  signature: LspSignatureInformation,
  syntax: SourceSyntax,
  index: BindingIndex,
  name: string,
  kind: string,
): void {
  const entity = [...index.entities.values()].find((candidate) =>
    candidate.name === name && candidate.kind === kind
  );

  if (entity === undefined) {
    return;
  }

  const definition = entity_definition(index, entity);

  if (definition === undefined) {
    return;
  }

  const documentation = attached_documentation(
    syntax.text,
    definition.span.start,
  );

  if (documentation !== undefined) {
    signature.documentation = { kind: "markdown", value: documentation };
  }
}

function signature_result(
  signature: LspSignatureInformation,
  active_parameter: number,
): LspSignatureHelp {
  return {
    signatures: [signature],
    activeSignature: 0,
    activeParameter: active_parameter,
  };
}
