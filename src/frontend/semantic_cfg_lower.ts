import { expect } from "../expect.ts";
import type { FrontExpr, Pattern, Source, Stmt } from "./ast.ts";
import type { BabaCstNode, BabaSourceNodeId } from "./baba_parser.ts";
import type { BindingEntity, BindingIndex, EntityId } from "./binding_index.ts";
import {
  type SemanticBlockId,
  type SemanticCallableControlFlow,
  type SemanticCfg,
  SemanticCfgBuilder,
  type SemanticExplicitOutput,
  type SemanticOperation,
} from "./semantic_cfg.ts";
import {
  SemanticIdentityAllocator,
  type SemanticOrigin,
  type ValueId,
} from "./semantic_identity.ts";
import {
  type RepresentationType,
  same_representation_type,
  snapshot_representation_type,
} from "./representation_type.ts";
import { has_source_span, source_span, type SourceSpan } from "./syntax.ts";

type SemanticLocation = {
  origin: BabaSourceNodeId;
  span: SourceSpan;
};

type ExpressionFlow =
  | {
    tag: "value";
    block: SemanticBlockId;
    value: ValueId;
    type: RepresentationType;
  }
  | { tag: "terminated"; block: SemanticBlockId };

type StatementFlow = {
  block: SemanticBlockId;
  value: ExpressionFlow | undefined;
  terminated: boolean;
};

type LoopBoundary = {
  break_target: SemanticBlockId;
  continue_target: SemanticBlockId;
  breaks: {
    block: SemanticBlockId;
    value: ExpressionFlow | undefined;
    overrides: Map<EntityId, ValueId>;
  }[];
  continues: {
    block: SemanticBlockId;
    overrides: Map<EntityId, ValueId>;
  }[];
  result_type: RepresentationType | undefined;
};

type OverridePredecessor = {
  block: SemanticBlockId;
  overrides: ReadonlyMap<EntityId, ValueId>;
};

type CallableBinding = {
  entity: BindingEntity;
  recursive: boolean;
  recursive_group: readonly ValueId[];
};

type CapturedSemanticValue = {
  value: ValueId;
  root: EntityId;
  type: RepresentationType;
  origin: SemanticOrigin;
};

type LoweringContext = {
  builder: SemanticCfgBuilder;
  binding_index: BindingIndex;
  binding_values: ReadonlyMap<EntityId, ValueId>;
  binding_origins: ReadonlyMap<ValueId, SemanticOrigin>;
  entity_by_value: ReadonlyMap<ValueId, EntityId>;
  entities_by_subject: WeakMap<object, BindingEntity[]>;
  root: BabaCstNode | undefined;
  loops: LoopBoundary[];
  overrides: Map<EntityId, ValueId>;
  capture_overrides: ReadonlyMap<EntityId, ValueId>;
  value_types: Map<ValueId, RepresentationType>;
  value_origins: Map<ValueId, SemanticOrigin>;
  defined_values: Set<ValueId>;
  captured_values: CapturedSemanticValue[];
  recursive_values: ReadonlySet<ValueId>;
  callable_bindings: WeakMap<FrontExpr, CallableBinding>;
  callable_control_flow: Map<ValueId, SemanticCallableControlFlow>;
  callable_identity: SemanticIdentityAllocator;
  callable_ordinals: Map<BabaSourceNodeId, number>;
  allow_captures: boolean;
};

export type SemanticCfgCollection = {
  root: SemanticCfg | undefined;
  callables: ReadonlyMap<ValueId, SemanticCallableControlFlow>;
};

export function semantic_cfgs_from_source(
  source: Source,
  root: BabaCstNode | undefined,
  binding_index: BindingIndex,
  binding_values: ReadonlyMap<EntityId, ValueId>,
  binding_origins: ReadonlyMap<ValueId, SemanticOrigin>,
): SemanticCfgCollection {
  const callables = new Map<ValueId, SemanticCallableControlFlow>();
  try {
    const control_flow = build_semantic_cfg_from_source(
      source,
      root,
      binding_index,
      binding_values,
      binding_origins,
      callables,
    );
    return { root: control_flow, callables };
  } catch (error) {
    if (error instanceof SemanticCfgUnavailable) {
      return { root: undefined, callables: new Map() };
    }
    throw error;
  }
}

class SemanticCfgUnavailable extends Error {
  readonly invalidates_parent: boolean;

  constructor(message: string, invalidates_parent = false) {
    super(message);
    this.invalidates_parent = invalidates_parent;
  }
}

function build_semantic_cfg_from_source(
  source: Source,
  root: BabaCstNode | undefined,
  binding_index: BindingIndex,
  binding_values: ReadonlyMap<EntityId, ValueId>,
  binding_origins: ReadonlyMap<ValueId, SemanticOrigin>,
  callable_control_flow: Map<ValueId, SemanticCallableControlFlow>,
): SemanticCfg {
  const builder = new SemanticCfgBuilder("duck-program");
  const entry = builder.add_block(root?.id);
  const entities_by_subject = new WeakMap<object, BindingEntity[]>();
  const entity_by_value = new Map<ValueId, EntityId>();
  for (const entity of binding_index.entities.values()) {
    let entities = entities_by_subject.get(entity.definition_subject);
    if (entities === undefined) {
      entities = [];
      entities_by_subject.set(entity.definition_subject, entities);
    }
    entities.push(entity);
    const value = binding_values.get(entity.id);
    if (value !== undefined) entity_by_value.set(value, entity.id);
  }
  const overrides = new Map<EntityId, ValueId>();
  const value_types = new Map<ValueId, RepresentationType>();
  const value_origins = new Map<ValueId, SemanticOrigin>();
  const defined_values = new Set<ValueId>();
  for (const entity of binding_index.entities.values()) {
    if (
      entity.kind !== "module_parameter" || entity.owner !== undefined
    ) {
      continue;
    }
    const value = binding_values.get(entity.id);
    if (value === undefined) continue;
    const type = binding_index.facts.get(entity.id)?.representation;
    if (type === undefined) {
      throw new SemanticCfgUnavailable(
        `Module parameter ${entity.name} has no representation type.`,
      );
    }
    let origin = binding_origins.get(value);
    if (origin === undefined) {
      const location = semantic_location(entity.definition_subject, root);
      origin = Object.freeze({
        source_node: location.origin,
        start: location.span.start,
        end: location.span.end,
      });
    }
    builder.add_parameter(value, type, origin);
    defined_values.add(value);
    value_origins.set(value, origin);
    const root_entity = binding_root(entity.id, binding_index);
    overrides.set(root_entity, value);
    value_types.set(value, snapshot_representation_type(type));
  }
  const context: LoweringContext = {
    builder,
    binding_index,
    binding_values,
    binding_origins,
    entity_by_value,
    entities_by_subject,
    root,
    loops: [],
    overrides,
    capture_overrides: new Map(),
    value_types,
    value_origins,
    defined_values,
    captured_values: [],
    recursive_values: new Set(),
    callable_bindings: new WeakMap(),
    callable_control_flow,
    callable_identity: new SemanticIdentityAllocator("duck-program"),
    callable_ordinals: new Map(),
    allow_captures: false,
  };
  const lowered = lower_statements(source.statements, entry, context);
  if (!lowered.terminated) {
    let result: ValueId | undefined;
    if (lowered.value?.tag === "value") result = lowered.value.value;
    builder.terminate(lowered.block, { tag: "return", value: result });
  }
  return builder.finish();
}

function lower_statements(
  statements: readonly Stmt[],
  initial_block: SemanticBlockId,
  context: LoweringContext,
): StatementFlow {
  let block = initial_block;
  let value: ExpressionFlow | undefined;
  for (const statement of statements) {
    const lowered = lower_statement(statement, block, context);
    block = lowered.block;
    value = lowered.value;
    if (lowered.terminated) return lowered;
  }
  return { block, value, terminated: false };
}

function lower_statement(
  statement: Stmt,
  block: SemanticBlockId,
  context: LoweringContext,
): StatementFlow {
  if (statement.tag === "import") {
    const type = binding_type(statement, "name", context);
    const value = emit_operation(
      block,
      statement,
      { tag: "constant", value: "import:" + statement.path },
      [],
      type,
      binding_output(statement, "name", context),
      context,
    );
    return statement_value(block, value, type);
  }
  if (statement.tag === "host_import") {
    const type = binding_type(statement.value, "name", context);
    const value = emit_operation(
      block,
      statement.value,
      {
        tag: "constant",
        value: "host:" + statement.value.module + ":" +
          statement.value.field,
      },
      [],
      type,
      binding_output(statement.value, "name", context),
      context,
    );
    return statement_value(block, value, type);
  }
  if (statement.tag === "bind") {
    associate_callable_group(statement, context);
    const initializer = lower_expression(statement.value, block, context);
    if (initializer.tag === "terminated") {
      return { block: initializer.block, value: initializer, terminated: true };
    }
    if (
      statement.else_branch !== undefined && statement.pattern !== undefined
    ) {
      return lower_let_else(statement, initializer, context);
    }
    let value = bind_statement_values(statement, initializer, context);
    if (statement.mutual !== undefined) {
      for (const member of statement.mutual) {
        const member_value = lower_expression(
          member.value,
          value.block,
          context,
        );
        if (member_value.tag === "terminated") {
          return {
            block: member_value.block,
            value: member_value,
            terminated: true,
          };
        }
        value = bind_values(
          member,
          member.pattern,
          member_value,
          context,
        );
      }
    }
    return {
      block: initializer.block,
      value,
      terminated: false,
    };
  }
  if (statement.tag === "state_bind") {
    const effect = lower_expression(statement.value, block, context);
    if (effect.tag === "terminated") {
      return { block: effect.block, value: effect, terminated: true };
    }
    if (statement.value_name === undefined) {
      return { block: effect.block, value: effect, terminated: false };
    }
    const type = binding_type(statement, "value_name", context);
    const value = emit_operation(
      effect.block,
      statement,
      { tag: "primitive", name: "effect-result" },
      [effect.value],
      type,
      binding_output(statement, "value_name", context),
      context,
    );
    return statement_value(effect.block, value, type);
  }
  if (statement.tag === "bind_pattern") {
    const initializer = lower_expression(statement.value, block, context);
    if (initializer.tag === "terminated") {
      return {
        block: initializer.block,
        value: initializer,
        terminated: true,
      };
    }
    let result: ExpressionFlow = initializer;
    for (const binding of statement.items) {
      const type = binding_type(binding, "name", context);
      const value = emit_operation(
        initializer.block,
        binding,
        { tag: "project", field: binding.name },
        [initializer.value],
        type,
        binding_output(binding, "name", context),
        context,
      );
      result = {
        tag: "value",
        block: initializer.block,
        value,
        type,
      };
    }
    return { block: initializer.block, value: result, terminated: false };
  }
  if (statement.tag === "resume_dup") {
    const resumed = lower_expression(statement.value, block, context);
    if (resumed.tag === "terminated") {
      return { block: resumed.block, value: resumed, terminated: true };
    }
    let result: ExpressionFlow = resumed;
    for (const slot of ["left", "right"]) {
      const type = binding_type(statement, slot, context);
      const value = emit_operation(
        resumed.block,
        statement,
        { tag: "ownership_transition", transition: "resume-duplicate" },
        [resumed.value],
        type,
        binding_output(statement, slot, context),
        context,
      );
      result = { tag: "value", block: resumed.block, value, type };
    }
    return { block: resumed.block, value: result, terminated: false };
  }
  if (statement.tag === "assign") {
    const replacement = lower_expression(statement.value, block, context);
    if (replacement.tag === "terminated") {
      return {
        block: replacement.block,
        value: replacement,
        terminated: true,
      };
    }
    const entity = find_binding_entity(statement, "name", context);
    if (entity === undefined) {
      const value = emit_operation(
        replacement.block,
        statement,
        { tag: "primitive", name: "unresolved-assign:" + statement.name },
        [replacement.value],
        replacement.type,
        undefined,
        context,
      );
      return statement_value(replacement.block, value, replacement.type);
    }
    const previous = replaced_value(entity, context);
    const type = binding_entity_type(entity, context);
    const value = emit_operation(
      replacement.block,
      statement,
      { tag: "primitive", name: "assign:" + statement.mode },
      [previous, replacement.value],
      type,
      semantic_output(entity, context),
      context,
    );
    return statement_value(replacement.block, value, type);
  }
  if (statement.tag === "index_assign") {
    const index = lower_expression(statement.index, block, context);
    if (index.tag === "terminated") {
      return { block: index.block, value: index, terminated: true };
    }
    const replacement = lower_expression(
      statement.value,
      index.block,
      context,
    );
    if (replacement.tag === "terminated") {
      return {
        block: replacement.block,
        value: replacement,
        terminated: true,
      };
    }
    const entity = find_binding_entity(statement, "object", context);
    if (entity === undefined) {
      const value = emit_operation(
        replacement.block,
        statement,
        {
          tag: "primitive",
          name: "unresolved-index-assign:" + statement.name,
        },
        [index.value, replacement.value],
        replacement.type,
        undefined,
        context,
      );
      return statement_value(replacement.block, value, replacement.type);
    }
    const type = binding_entity_type(entity, context);
    const value = emit_operation(
      replacement.block,
      statement,
      { tag: "primitive", name: "index-set" },
      [replaced_value(entity, context), index.value, replacement.value],
      type,
      semantic_output(entity, context),
      context,
    );
    return statement_value(replacement.block, value, type);
  }
  if (statement.tag === "expr") {
    const expression = lower_expression(statement.expr, block, context);
    return {
      block: expression.block,
      value: expression,
      terminated: expression.tag === "terminated",
    };
  }
  if (statement.tag === "return") {
    const expression = lower_expression(statement.value, block, context);
    if (expression.tag === "terminated") {
      return { block: expression.block, value: expression, terminated: true };
    }
    context.builder.terminate(expression.block, {
      tag: "return",
      value: expression.value,
    });
    return { block: expression.block, value: expression, terminated: true };
  }
  if (statement.tag === "if_stmt") {
    return lower_if_statement(statement, block, context);
  }
  if (statement.tag === "if_let_stmt") {
    return lower_if_let_statement(statement, block, context);
  }
  if (statement.tag === "for_range") {
    return lower_range_loop(statement, block, context);
  }
  if (statement.tag === "for_collection") {
    return lower_collection_loop(statement, block, context);
  }
  if (statement.tag === "type_check") {
    const target = lower_expression(statement.target, block, context);
    if (target.tag === "terminated") {
      return { block: target.block, value: target, terminated: true };
    }
    const type = representation_of(statement, context);
    const value = emit_operation(
      target.block,
      statement,
      { tag: "primitive", name: "type-check" },
      [target.value],
      type,
      undefined,
      context,
    );
    return statement_value(target.block, value, type);
  }
  if (statement.tag === "break") {
    const loop = context.loops[context.loops.length - 1];
    expect(loop !== undefined, "Break escaped its semantic loop.");
    let value: ExpressionFlow | undefined;
    let current = block;
    if (statement.value !== undefined) {
      value = lower_expression(statement.value, current, context);
      current = value.block;
      if (value.tag === "terminated") {
        return { block: current, value, terminated: true };
      }
      if (
        loop.result_type !== undefined &&
        !same_representation_type(value.type, loop.result_type)
      ) {
        const coerced = emit_operation(
          current,
          statement,
          { tag: "construct", constructor: "join-coercion" },
          [value.value],
          loop.result_type,
          undefined,
          context,
        );
        value = {
          tag: "value",
          block: current,
          value: coerced,
          type: loop.result_type,
        };
      }
    }
    context.builder.connect(current, loop.break_target);
    context.builder.terminate(current, {
      tag: "jump",
      target: loop.break_target,
    });
    loop.breaks.push({
      block: current,
      value,
      overrides: new Map(context.overrides),
    });
    return { block: current, value, terminated: true };
  }
  if (statement.tag === "continue") {
    const loop = context.loops[context.loops.length - 1];
    expect(loop !== undefined, "Continue escaped its semantic loop.");
    context.builder.connect(block, loop.continue_target);
    context.builder.terminate(block, {
      tag: "jump",
      target: loop.continue_target,
    });
    loop.continues.push({
      block,
      overrides: new Map(context.overrides),
    });
    return { block, value: undefined, terminated: true };
  }
  if (statement.tag === "unsupported") {
    context.builder.terminate(block, {
      tag: "trap",
      reason: "unsupported:" + statement.feature,
    });
    return { block, value: undefined, terminated: true };
  }
  statement satisfies never;
  throw new Error("Unknown semantic statement.");
}

function statement_value(
  block: SemanticBlockId,
  value: ValueId,
  type: RepresentationType,
): StatementFlow {
  return {
    block,
    value: { tag: "value", block, value, type },
    terminated: false,
  };
}

function associate_callable_group(
  statement: Extract<Stmt, { tag: "bind" }>,
  context: LoweringContext,
): void {
  const candidates: { expression: FrontExpr; subject: object }[] = [{
    expression: statement.value,
    subject: statement,
  }];
  if (statement.mutual !== undefined) {
    for (const member of statement.mutual) {
      candidates.push({ expression: member.value, subject: member });
    }
  }
  const bindings: {
    expression: Extract<FrontExpr, { tag: "lam" | "rec" }>;
    entity: BindingEntity;
  }[] = [];
  for (const candidate of candidates) {
    if (
      candidate.expression.tag !== "lam" &&
      candidate.expression.tag !== "rec"
    ) {
      continue;
    }
    const entity = find_binding_entity(candidate.subject, "name", context);
    if (entity === undefined) continue;
    bindings.push({ expression: candidate.expression, entity });
  }
  let recursive = statement.is_recursive === true ||
    statement.mutual !== undefined;
  if (bindings.some((binding) => binding.expression.tag === "rec")) {
    recursive = true;
  }
  const recursive_group: ValueId[] = [];
  if (recursive) {
    for (const binding of bindings) {
      const value = context.binding_values.get(binding.entity.id);
      expect(
        value !== undefined,
        `Recursive callable ${binding.entity.name} has no ValueId.`,
      );
      recursive_group.push(value);
    }
  }
  const stable_group = Object.freeze(recursive_group);
  for (const binding of bindings) {
    context.callable_bindings.set(binding.expression, {
      entity: binding.entity,
      recursive,
      recursive_group: stable_group,
    });
  }
}

function bind_statement_values(
  statement: Extract<Stmt, { tag: "bind" }>,
  initializer: Extract<ExpressionFlow, { tag: "value" }>,
  context: LoweringContext,
): ExpressionFlow {
  return bind_values(
    statement,
    statement.pattern,
    initializer,
    context,
  );
}

function bind_values(
  subject: object,
  pattern: Pattern | undefined,
  initializer: Extract<ExpressionFlow, { tag: "value" }>,
  context: LoweringContext,
): ExpressionFlow {
  const entities = binding_entities(subject, context);
  if (pattern !== undefined) {
    collect_pattern_entities(pattern, context, entities);
  }
  let result = initializer;
  const emitted = new Set<ValueId>();
  for (const entity of entities) {
    const output = semantic_output(entity, context);
    if (emitted.has(output.value)) continue;
    emitted.add(output.value);
    const type = binding_entity_type(entity, context);
    if (initializer.value === output.value) {
      expect(
        same_representation_type(initializer.type, type),
        `Callable binding ${entity.name} changed representation.`,
      );
      result = {
        tag: "value",
        block: initializer.block,
        value: output.value,
        type,
      };
      continue;
    }
    const value = emit_operation(
      initializer.block,
      entity.definition_subject,
      { tag: "primitive", name: "bind:" + entity.name },
      [initializer.value],
      type,
      output,
      context,
    );
    result = { tag: "value", block: initializer.block, value, type };
  }
  return result;
}

function lower_let_else(
  statement: Extract<Stmt, { tag: "bind" }>,
  initializer: Extract<ExpressionFlow, { tag: "value" }>,
  context: LoweringContext,
): StatementFlow {
  expect(statement.pattern !== undefined, "Let-else pattern disappeared.");
  expect(statement.else_branch !== undefined, "Let-else branch disappeared.");
  const condition = emit_pattern_test(
    initializer.block,
    statement.pattern,
    initializer.value,
    context,
  );
  const location = semantic_location(statement, context.root);
  const success = context.builder.add_block(location.origin);
  const failure = context.builder.add_block(location.origin);
  context.builder.connect(initializer.block, success);
  context.builder.connect(initializer.block, failure);
  context.builder.terminate(initializer.block, {
    tag: "branch",
    condition,
    when_true: success,
    when_false: failure,
  });
  const before = new Map(context.overrides);
  context.overrides = new Map(before);
  const failed = lower_expression(statement.else_branch, failure, context);
  if (failed.tag === "value") {
    context.builder.terminate(failed.block, {
      tag: "trap",
      reason: "let-else branch returned",
    });
  }
  context.overrides = new Map(before);
  const bound = bind_statement_values(statement, {
    ...initializer,
    block: success,
  }, context);
  return { block: success, value: bound, terminated: false };
}

function lower_if_statement(
  statement: Extract<Stmt, { tag: "if_stmt" }>,
  block: SemanticBlockId,
  context: LoweringContext,
): StatementFlow {
  const condition = lower_expression(statement.cond, block, context);
  if (condition.tag === "terminated") {
    return { block: condition.block, value: condition, terminated: true };
  }
  const condition_value = normalize_condition(condition, statement, context);
  const location = semantic_location(statement, context.root);
  const when_true = context.builder.add_block(location.origin);
  const joined = context.builder.add_block(location.origin);
  context.builder.connect(condition.block, when_true);
  context.builder.connect(condition.block, joined);
  context.builder.terminate(condition.block, {
    tag: "branch",
    condition: condition_value,
    when_true,
    when_false: joined,
  });
  const before = new Map(context.overrides);
  context.overrides = new Map(before);
  const true_result = lower_statements(statement.body, when_true, context);
  const true_overrides = new Map(context.overrides);
  if (!true_result.terminated) {
    context.builder.connect(true_result.block, joined);
    context.builder.terminate(true_result.block, {
      tag: "jump",
      target: joined,
    });
  }
  const predecessors: OverridePredecessor[] = [{
    block: condition.block,
    overrides: before,
  }];
  if (!true_result.terminated) {
    predecessors.push({
      block: true_result.block,
      overrides: true_overrides,
    });
  }
  merge_overrides(joined, predecessors, before, statement, context);
  return { block: joined, value: undefined, terminated: false };
}

function lower_if_let_statement(
  statement: Extract<Stmt, { tag: "if_let_stmt" }>,
  block: SemanticBlockId,
  context: LoweringContext,
): StatementFlow {
  const target = lower_expression(statement.target, block, context);
  if (target.tag === "terminated") {
    return { block: target.block, value: target, terminated: true };
  }
  const condition = emit_operation(
    target.block,
    statement,
    { tag: "primitive", name: "is-case:" + statement.case_name },
    [target.value],
    { tag: "scalar", name: "Bool" },
    undefined,
    context,
  );
  const location = semantic_location(statement, context.root);
  const when_true = context.builder.add_block(location.origin);
  const joined = context.builder.add_block(location.origin);
  context.builder.connect(target.block, when_true);
  context.builder.connect(target.block, joined);
  context.builder.terminate(target.block, {
    tag: "branch",
    condition,
    when_true,
    when_false: joined,
  });
  const before = new Map(context.overrides);
  context.overrides = new Map(before);
  if (statement.value_name !== undefined) {
    const type = binding_type(statement, "value_name", context);
    emit_operation(
      when_true,
      statement,
      { tag: "project", field: statement.value_name },
      [target.value],
      type,
      binding_output(statement, "value_name", context),
      context,
    );
  }
  const true_result = lower_statements(statement.body, when_true, context);
  const true_overrides = new Map(context.overrides);
  if (!true_result.terminated) {
    context.builder.connect(true_result.block, joined);
    context.builder.terminate(true_result.block, {
      tag: "jump",
      target: joined,
    });
  }
  const predecessors: OverridePredecessor[] = [{
    block: target.block,
    overrides: before,
  }];
  if (!true_result.terminated) {
    predecessors.push({
      block: true_result.block,
      overrides: true_overrides,
    });
  }
  merge_overrides(joined, predecessors, before, statement, context);
  return { block: joined, value: undefined, terminated: false };
}

function lower_range_loop(
  statement: Extract<Stmt, { tag: "for_range" }>,
  block: SemanticBlockId,
  context: LoweringContext,
): StatementFlow {
  const start = lower_expression(statement.start, block, context);
  if (start.tag === "terminated") {
    return { block: start.block, value: start, terminated: true };
  }
  const end = lower_expression(statement.end, start.block, context);
  if (end.tag === "terminated") {
    return { block: end.block, value: end, terminated: true };
  }
  const step = lower_expression(statement.step, end.block, context);
  if (step.tag === "terminated") {
    return { block: step.block, value: step, terminated: true };
  }
  const location = semantic_location(statement, context.root);
  const header = context.builder.add_block(location.origin);
  const body = context.builder.add_block(location.origin);
  const latch = context.builder.add_block(location.origin);
  const exited = context.builder.add_block(location.origin);
  const entry_overrides = new Map(context.overrides);
  context.builder.connect(step.block, header);
  context.builder.terminate(step.block, { tag: "jump", target: header });
  const carried = begin_loop_overrides(
    header,
    step.block,
    entry_overrides,
    statement,
    context,
  );
  const index_type = binding_type(statement, "index", context);
  const index_location = semantic_location(statement, context.root);
  const index = context.builder.add_phi(
    header,
    index_location.origin,
    index_location.span,
    new Map([[step.block, start.value]]),
    index_type,
    binding_output(statement, "index", context),
  );
  record_semantic_value(index, index_type, {
    source_node: index_location.origin,
    start: index_location.span.start,
    end: index_location.span.end,
  }, context);
  const header_overrides = new Map(context.overrides);
  const condition = emit_operation(
    header,
    statement,
    {
      tag: "primitive",
      name: "range-has-next:" + statement.end_bound,
    },
    [index, end.value, step.value],
    { tag: "scalar", name: "Bool" },
    undefined,
    context,
  );
  context.builder.connect(header, body);
  context.builder.connect(header, exited);
  context.builder.terminate(header, {
    tag: "branch",
    condition,
    when_true: body,
    when_false: exited,
  });
  const loop: LoopBoundary = {
    break_target: exited,
    continue_target: latch,
    breaks: [],
    continues: [],
    result_type: undefined,
  };
  context.loops.push(loop);
  const body_result = lower_statements(statement.body, body, context);
  const body_overrides = new Map(context.overrides);
  const removed = context.loops.pop();
  expect(removed === loop, "Range loop boundary stack changed.");
  if (!body_result.terminated) {
    context.builder.connect(body_result.block, latch);
    context.builder.terminate(body_result.block, {
      tag: "jump",
      target: latch,
    });
  }
  if (has_loop_latch_predecessor(body_result, loop)) {
    const latch_predecessors: OverridePredecessor[] = [];
    if (!body_result.terminated) {
      latch_predecessors.push({
        block: body_result.block,
        overrides: body_overrides,
      });
    }
    for (const current of loop.continues) {
      latch_predecessors.push(current);
    }
    merge_overrides(
      latch,
      latch_predecessors,
      header_overrides,
      statement,
      context,
    );
    const next = emit_operation(
      latch,
      statement,
      { tag: "primitive", name: "range-next" },
      [index, step.value],
      index_type,
      undefined,
      context,
    );
    context.builder.connect(latch, header);
    context.builder.add_phi_input(index, latch, next);
    add_loop_override_inputs(carried, latch, context.overrides, context);
    context.builder.terminate(latch, { tag: "jump", target: header });
  } else {
    context.builder.terminate(latch, {
      tag: "trap",
      reason: "unreachable loop latch",
    });
  }
  const exit_predecessors: OverridePredecessor[] = [{
    block: header,
    overrides: header_overrides,
  }];
  for (const current of loop.breaks) {
    exit_predecessors.push(current);
  }
  merge_overrides(
    exited,
    exit_predecessors,
    entry_overrides,
    statement,
    context,
  );
  return { block: exited, value: undefined, terminated: false };
}

function lower_collection_loop(
  statement: Extract<Stmt, { tag: "for_collection" }>,
  block: SemanticBlockId,
  context: LoweringContext,
): StatementFlow {
  const collection = lower_expression(statement.collection, block, context);
  if (collection.tag === "terminated") {
    return {
      block: collection.block,
      value: collection,
      terminated: true,
    };
  }
  const location = semantic_location(statement, context.root);
  const header = context.builder.add_block(location.origin);
  const body = context.builder.add_block(location.origin);
  const latch = context.builder.add_block(location.origin);
  const exited = context.builder.add_block(location.origin);
  const cursor_type = { tag: "scalar", name: "U32" } as const;
  const initial_cursor = emit_operation(
    collection.block,
    statement,
    { tag: "constant", value: 0 },
    [],
    cursor_type,
    undefined,
    context,
  );
  const entry_overrides = new Map(context.overrides);
  context.builder.connect(collection.block, header);
  context.builder.terminate(collection.block, {
    tag: "jump",
    target: header,
  });
  const carried = begin_loop_overrides(
    header,
    collection.block,
    entry_overrides,
    statement,
    context,
  );
  const cursor = context.builder.add_phi(
    header,
    location.origin,
    location.span,
    new Map([[collection.block, initial_cursor]]),
    cursor_type,
  );
  record_semantic_value(cursor, cursor_type, {
    source_node: location.origin,
    start: location.span.start,
    end: location.span.end,
  }, context);
  const condition = emit_operation(
    header,
    statement,
    { tag: "primitive", name: "collection-has-next" },
    [collection.value, cursor],
    { tag: "scalar", name: "Bool" },
    undefined,
    context,
  );
  context.builder.connect(header, body);
  context.builder.connect(header, exited);
  context.builder.terminate(header, {
    tag: "branch",
    condition,
    when_true: body,
    when_false: exited,
  });
  if (statement.index !== undefined) {
    const index_type = binding_type(statement, "index", context);
    emit_operation(
      body,
      statement,
      { tag: "primitive", name: "bind:" + statement.index },
      [cursor],
      index_type,
      binding_output(statement, "index", context),
      context,
    );
  }
  const element_type = binding_type(statement, "item", context);
  emit_operation(
    body,
    statement,
    { tag: "project", field: "collection-element" },
    [collection.value, cursor],
    element_type,
    binding_output(statement, "item", context),
    context,
  );
  const header_overrides = new Map(context.overrides);
  const loop: LoopBoundary = {
    break_target: exited,
    continue_target: latch,
    breaks: [],
    continues: [],
    result_type: undefined,
  };
  context.loops.push(loop);
  const body_result = lower_statements(statement.body, body, context);
  const body_overrides = new Map(context.overrides);
  const removed = context.loops.pop();
  expect(removed === loop, "Collection loop boundary stack changed.");
  if (!body_result.terminated) {
    context.builder.connect(body_result.block, latch);
    context.builder.terminate(body_result.block, {
      tag: "jump",
      target: latch,
    });
  }
  if (has_loop_latch_predecessor(body_result, loop)) {
    const latch_predecessors: OverridePredecessor[] = [];
    if (!body_result.terminated) {
      latch_predecessors.push({
        block: body_result.block,
        overrides: body_overrides,
      });
    }
    for (const current of loop.continues) {
      latch_predecessors.push(current);
    }
    merge_overrides(
      latch,
      latch_predecessors,
      header_overrides,
      statement,
      context,
    );
    const next = emit_operation(
      latch,
      statement,
      { tag: "primitive", name: "collection-next" },
      [cursor],
      cursor_type,
      undefined,
      context,
    );
    context.builder.connect(latch, header);
    context.builder.add_phi_input(cursor, latch, next);
    add_loop_override_inputs(carried, latch, context.overrides, context);
    context.builder.terminate(latch, { tag: "jump", target: header });
  } else {
    context.builder.terminate(latch, {
      tag: "trap",
      reason: "unreachable loop latch",
    });
  }
  const exit_predecessors: OverridePredecessor[] = [{
    block: header,
    overrides: header_overrides,
  }];
  for (const current of loop.breaks) {
    exit_predecessors.push(current);
  }
  merge_overrides(
    exited,
    exit_predecessors,
    entry_overrides,
    statement,
    context,
  );
  return { block: exited, value: undefined, terminated: false };
}

function has_loop_latch_predecessor(
  body: StatementFlow,
  loop: LoopBoundary,
): boolean {
  if (!body.terminated) return true;
  return loop.continues.length > 0;
}

function lower_expression(
  expression: FrontExpr,
  block: SemanticBlockId,
  context: LoweringContext,
): ExpressionFlow {
  const type = representation_of(expression, context);
  if (expression.tag === "var" || expression.tag === "linear") {
    const occurrence = context.binding_index.occurrence_of(expression, "name");
    if (occurrence?.entity !== undefined) {
      const entity = context.binding_index.entities.get(occurrence.entity);
      expect(
        entity !== undefined,
        `Reference ${expression.name} lost its binding entity.`,
      );
      const root_entity = binding_root(
        occurrence.entity,
        context.binding_index,
      );
      let value = context.overrides.get(root_entity);
      if (value === undefined) {
        value = context.capture_overrides.get(root_entity);
      }
      if (value === undefined) {
        value = context.binding_values.get(occurrence.entity);
      }
      if (value === undefined && !runtime_binding(entity)) {
        const symbol = emit_operation(
          block,
          expression,
          { tag: "constant", value: entity.kind + ":" + entity.name },
          [],
          type,
          undefined,
          context,
        );
        return { tag: "value", block, value: symbol, type };
      }
      expect(
        value !== undefined,
        `Reference ${expression.name} lost its semantic ValueId.`,
      );
      let binding_type = context.value_types.get(value);
      if (binding_type === undefined) {
        binding_type = binding_entity_type(entity, context);
      }
      ensure_semantic_value_is_available(
        value,
        binding_type,
        root_entity,
        context,
      );
      if (expression.tag === "var") {
        return { tag: "value", block, value, type: binding_type };
      }
      const consumed = emit_operation(
        block,
        expression,
        { tag: "ownership_transition", transition: "consume" },
        [value],
        type,
        undefined,
        context,
      );
      return { tag: "value", block, value: consumed, type };
    }
    const value = emit_operation(
      block,
      expression,
      { tag: "constant", value: "builtin:" + expression.name },
      [],
      type,
      undefined,
      context,
    );
    return { tag: "value", block, value, type };
  }
  if (expression.tag === "bool") {
    return emit_constant(expression, expression.value, block, type, context);
  }
  if (expression.tag === "num") {
    return emit_constant(expression, expression.value, block, type, context);
  }
  if (expression.tag === "text") {
    return emit_constant(expression, expression.value, block, type, context);
  }
  if (expression.tag === "atom") {
    return emit_constant(
      expression,
      "#" + expression.name,
      block,
      type,
      context,
    );
  }
  if (expression.tag === "unit") {
    return emit_constant(expression, "()", block, type, context);
  }
  if (expression.tag === "type_name") {
    return emit_constant(
      expression,
      "type:" + expression.name,
      block,
      type,
      context,
    );
  }
  if (expression.tag === "prim") {
    const operands = lower_expressions(
      [expression.left, expression.right],
      block,
      context,
    );
    if (operands.tag === "terminated") return operands;
    const value = emit_operation(
      operands.block,
      expression,
      { tag: "primitive", name: expression.prim },
      operands.values,
      type,
      undefined,
      context,
    );
    return { tag: "value", block: operands.block, value, type };
  }
  if (expression.tag === "app") {
    const expressions = [expression.func];
    if (expression.arg !== undefined) {
      expressions.push(expression.arg);
    } else {
      expressions.push(...expression.args);
    }
    const operands = lower_expressions(expressions, block, context);
    if (operands.tag === "terminated") return operands;
    let function_name = "value";
    if (
      expression.func.tag === "var" || expression.func.tag === "type_name"
    ) {
      function_name = expression.func.name;
    }
    let operation: SemanticOperation = { tag: "call", function_name };
    const callable_type = context.binding_index.representation_of(
      expression.func,
    );
    if (
      callable_type?.tag === "function" && callable_type.effects.length > 0
    ) {
      operation = {
        tag: "primitive",
        name: "effect-call:" + callable_type.effects.map((effect) => {
          let name = effect.effect;
          if (effect.operation !== undefined) {
            name += "." + effect.operation;
          }
          return name;
        }).join(","),
      };
    }
    const value = emit_operation(
      operands.block,
      expression,
      operation,
      operands.values,
      type,
      undefined,
      context,
    );
    return { tag: "value", block: operands.block, value, type };
  }
  if (
    expression.tag === "product" || expression.tag === "shape" ||
    expression.tag === "array"
  ) {
    const elements: FrontExpr[] = [];
    if (expression.tag === "array") {
      elements.push(...expression.items);
      if (expression.rest !== undefined) elements.push(expression.rest);
    } else {
      for (const entry of expression.entries) elements.push(entry.value);
    }
    const operands = lower_expressions(elements, block, context);
    if (operands.tag === "terminated") return operands;
    const value = emit_operation(
      operands.block,
      expression,
      { tag: "construct", constructor: expression.tag },
      operands.values,
      type,
      undefined,
      context,
    );
    return { tag: "value", block: operands.block, value, type };
  }
  if (expression.tag === "array_repeat") {
    const operands = lower_expressions(
      [expression.value, expression.length],
      block,
      context,
    );
    if (operands.tag === "terminated") return operands;
    const value = emit_operation(
      operands.block,
      expression,
      { tag: "construct", constructor: "array-repeat" },
      operands.values,
      type,
      undefined,
      context,
    );
    return { tag: "value", block: operands.block, value, type };
  }
  if (expression.tag === "import") {
    return emit_constant(
      expression,
      "import:" + expression.path,
      block,
      type,
      context,
    );
  }
  if (expression.tag === "field") {
    const object = lower_expression(expression.object, block, context);
    if (object.tag === "terminated") return object;
    let transition = "project";
    if (expression.move === true) transition = "move-project";
    const value = emit_operation(
      object.block,
      expression,
      { tag: "project", field: transition + ":" + expression.name },
      [object.value],
      type,
      undefined,
      context,
    );
    return { tag: "value", block: object.block, value, type };
  }
  if (expression.tag === "index") {
    const operands = lower_expressions(
      [expression.object, expression.index],
      block,
      context,
    );
    if (operands.tag === "terminated") return operands;
    let field = "index";
    if (expression.move === true) field = "move-index";
    const value = emit_operation(
      operands.block,
      expression,
      { tag: "project", field },
      operands.values,
      type,
      undefined,
      context,
    );
    return { tag: "value", block: operands.block, value, type };
  }
  if (expression.tag === "borrow" || expression.tag === "freeze") {
    const operand = lower_expression(expression.value, block, context);
    if (operand.tag === "terminated") return operand;
    const value = emit_operation(
      operand.block,
      expression,
      { tag: "ownership_transition", transition: expression.tag },
      [operand.value],
      type,
      undefined,
      context,
    );
    return { tag: "value", block: operand.block, value, type };
  }
  if (expression.tag === "as" || expression.tag === "is") {
    const operand = lower_expression(expression.value, block, context);
    if (operand.tag === "terminated") return operand;
    const value = emit_operation(
      operand.block,
      expression,
      { tag: "primitive", name: expression.tag },
      [operand.value],
      type,
      undefined,
      context,
    );
    return { tag: "value", block: operand.block, value, type };
  }
  if (expression.tag === "if") {
    return lower_if_expression(expression, block, type, context);
  }
  if (expression.tag === "if_let") {
    return lower_if_let_expression(expression, block, type, context);
  }
  if (expression.tag === "match") {
    return lower_match_expression(expression, block, type, context);
  }
  if (expression.tag === "block") {
    const lowered = lower_statements(expression.statements, block, context);
    if (lowered.terminated) {
      return { tag: "terminated", block: lowered.block };
    }
    if (lowered.value?.tag === "value") return lowered.value;
    return emit_constant(expression, "()", lowered.block, type, context);
  }
  if (expression.tag === "loop") {
    return lower_loop_expression(expression, block, type, context);
  }
  if (
    expression.tag === "comptime" || expression.tag === "captured" ||
    expression.tag === "scratch"
  ) {
    let inner: FrontExpr;
    if (expression.tag === "scratch") {
      inner = expression.body;
    } else {
      inner = expression.expr;
    }
    const operand = lower_expression(inner, block, context);
    if (operand.tag === "terminated") return operand;
    const value = emit_operation(
      operand.block,
      expression,
      {
        tag: "ownership_transition",
        transition: expression.tag,
      },
      [operand.value],
      type,
      undefined,
      context,
    );
    return { tag: "value", block: operand.block, value, type };
  }
  if (expression.tag === "lam" || expression.tag === "rec") {
    const callable_identity = callable_output(expression, type, context);
    const output = callable_identity.output;
    let callable: LoweredCallableControlFlow | undefined;
    if (callable_identity.body_available) {
      callable = lower_callable_control_flow(
        expression,
        output.value,
        type,
        context,
      );
    }
    const captures: ValueId[] = [];
    if (callable !== undefined) {
      let captures_available = true;
      for (const parameter of callable.control_flow.parameters) {
        if (callable.declared_parameters.has(parameter)) continue;
        if (callable.recursive_values.has(parameter)) continue;
        if (
          !context.defined_values.has(parameter) && !context.allow_captures
        ) {
          captures_available = false;
          break;
        }
      }
      if (captures_available) {
        for (const parameter of callable.control_flow.parameters) {
          if (callable.declared_parameters.has(parameter)) continue;
          if (callable.recursive_values.has(parameter)) continue;
          if (!context.defined_values.has(parameter)) {
            let capture_root: EntityId | undefined;
            for (const [root, value] of context.overrides) {
              if (value === parameter) {
                capture_root = root;
                break;
              }
            }
            if (capture_root === undefined) {
              for (const [root, value] of context.capture_overrides) {
                if (value === parameter) {
                  capture_root = root;
                  break;
                }
              }
            }
            expect(
              capture_root !== undefined,
              `Callable capture ${String(parameter)} has no live binding.`,
            );
            const capture = callable.control_flow.values.find((candidate) =>
              candidate.value === parameter
            );
            expect(
              capture !== undefined,
              `Callable capture ${String(parameter)} has no representation.`,
            );
            ensure_semantic_value_is_available(
              parameter,
              capture.type,
              capture_root,
              context,
            );
          }
          captures.push(parameter);
        }
        for (const [value, nested] of callable.nested_callables) {
          context.callable_control_flow.set(value, nested);
        }
        let recursive_self: ValueId | undefined;
        if (
          expression.tag === "rec" ||
          (callable_identity.binding !== undefined &&
            callable_identity.binding.recursive)
        ) {
          recursive_self = output.value;
        }
        context.callable_control_flow.set(
          output.value,
          Object.freeze({
            callable: output.value,
            parameters: Object.freeze([...callable.declared_parameters]),
            captures: Object.freeze([...captures]),
            recursive_self,
            recursive_group: Object.freeze([...callable.recursive_values]),
            control_flow: callable.control_flow,
          }),
        );
      }
    }
    const value = emit_operation(
      block,
      expression,
      { tag: "construct", constructor: expression.tag },
      captures,
      type,
      output,
      context,
    );
    return { tag: "value", block, value, type };
  }
  if (expression.tag === "handler") {
    const state_values = expression.state.map((state) => state.value);
    const operands = lower_expressions(state_values, block, context);
    if (operands.tag === "terminated") return operands;
    const value = emit_operation(
      operands.block,
      expression,
      { tag: "construct", constructor: "effect-handler:" + expression.effect },
      operands.values,
      type,
      undefined,
      context,
    );
    return { tag: "value", block: operands.block, value, type };
  }
  if (expression.tag === "try_with") {
    const operands = lower_expressions(
      [expression.handler, expression.body],
      block,
      context,
    );
    if (operands.tag === "terminated") return operands;
    const value = emit_operation(
      operands.block,
      expression,
      { tag: "primitive", name: "handle-effect" },
      operands.values,
      type,
      undefined,
      context,
    );
    return { tag: "value", block: operands.block, value, type };
  }
  if (expression.tag === "with" || expression.tag === "struct_update") {
    const elements = [expression.base];
    for (const field of expression.fields) elements.push(field.value);
    return lower_constructed_expression(
      expression,
      elements,
      expression.tag,
      block,
      type,
      context,
    );
  }
  if (expression.tag === "type_with") {
    const elements = [expression.base];
    for (const member of expression.members) {
      elements.push(member.name);
      elements.push(member.value);
    }
    return lower_constructed_expression(
      expression,
      elements,
      "type-with",
      block,
      type,
      context,
    );
  }
  if (expression.tag === "struct_value") {
    const elements = [expression.type_expr];
    for (const field of expression.fields) elements.push(field.value);
    return lower_constructed_expression(
      expression,
      elements,
      "struct",
      block,
      type,
      context,
    );
  }
  if (
    expression.tag === "set_type" || expression.tag === "struct_type" ||
    expression.tag === "union_type"
  ) {
    const value = emit_operation(
      block,
      expression,
      { tag: "construct", constructor: expression.tag },
      [],
      type,
      undefined,
      context,
    );
    return { tag: "value", block, value, type };
  }
  if (expression.tag === "union_case") {
    const elements: FrontExpr[] = [];
    if (expression.type_expr !== undefined) {
      elements.push(expression.type_expr);
    }
    if (expression.value !== undefined) elements.push(expression.value);
    return lower_constructed_expression(
      expression,
      elements,
      "case:" + expression.name,
      block,
      type,
      context,
    );
  }
  if (expression.tag === "unsupported") {
    context.builder.terminate(block, {
      tag: "trap",
      reason: "unsupported:" + expression.feature,
    });
    return { tag: "terminated", block };
  }
  expression satisfies never;
  throw new Error("Unknown semantic expression.");
}

type LoweredCallableControlFlow = {
  control_flow: SemanticCfg;
  declared_parameters: ReadonlySet<ValueId>;
  recursive_values: ReadonlySet<ValueId>;
  nested_callables: ReadonlyMap<ValueId, SemanticCallableControlFlow>;
  captured_values: readonly CapturedSemanticValue[];
};

type CallableOutput = {
  output: SemanticExplicitOutput;
  binding: CallableBinding | undefined;
  body_available: boolean;
};

function callable_output(
  expression: Extract<FrontExpr, { tag: "lam" | "rec" }>,
  type: RepresentationType,
  context: LoweringContext,
): CallableOutput {
  const binding = context.callable_bindings.get(expression);
  if (binding !== undefined) {
    const binding_type = binding_entity_type(binding.entity, context);
    if (same_representation_type(binding_type, type)) {
      return {
        output: semantic_output(binding.entity, context),
        binding,
        body_available: true,
      };
    }
    return {
      output: anonymous_callable_output(expression, context),
      binding,
      body_available: false,
    };
  }
  return {
    output: anonymous_callable_output(expression, context),
    binding: undefined,
    body_available: true,
  };
}

function anonymous_callable_output(
  expression: Extract<FrontExpr, { tag: "lam" | "rec" }>,
  context: LoweringContext,
): SemanticExplicitOutput {
  const location = semantic_location(expression, context.root);
  let ordinal = 0;
  const previous = context.callable_ordinals.get(location.origin);
  if (previous !== undefined) ordinal = previous;
  context.callable_ordinals.set(location.origin, ordinal + 1);
  const value = context.callable_identity.value_for(
    location.origin,
    "callable:" + ordinal.toString(),
  );
  return Object.freeze({
    value,
    origin: Object.freeze({
      source_node: location.origin,
      start: location.span.start,
      end: location.span.end,
    }),
  });
}

function lower_callable_control_flow(
  expression: Extract<FrontExpr, { tag: "lam" | "rec" }>,
  callable: ValueId,
  callable_type: RepresentationType,
  parent: LoweringContext,
): LoweredCallableControlFlow | undefined {
  try {
    return build_callable_control_flow(
      expression,
      callable,
      callable_type,
      parent,
    );
  } catch (error) {
    if (error instanceof SemanticCfgUnavailable) {
      if (error.invalidates_parent) throw error;
      return undefined;
    }
    throw error;
  }
}

function build_callable_control_flow(
  expression: Extract<FrontExpr, { tag: "lam" | "rec" }>,
  callable: ValueId,
  callable_type: RepresentationType,
  parent: LoweringContext,
): LoweredCallableControlFlow {
  const body_span = source_span(expression.body);
  const live_values = new Map(parent.capture_overrides);
  for (const [root, value] of parent.overrides) {
    live_values.set(root, value);
  }
  const binding = parent.callable_bindings.get(expression);
  const recursive_values = new Set<ValueId>();
  if (binding !== undefined) {
    for (const value of binding.recursive_group) {
      recursive_values.add(value);
    }
  }
  const entry_captures: CapturedSemanticValue[] = [];
  const captured_roots = new Set<EntityId>();
  const occurrences = [...parent.binding_index.occurrences.values()].sort(
    (left, right) => left.span.start - right.span.start,
  );
  for (const occurrence of occurrences) {
    if (
      occurrence.span.start < body_span.start ||
      occurrence.span.end > body_span.end
    ) {
      continue;
    }
    if (
      occurrence.role !== "reference" &&
      occurrence.role !== "consume" &&
      occurrence.role !== "shadow"
    ) {
      continue;
    }
    if (occurrence.entity === undefined) continue;
    const entity = parent.binding_index.entities.get(occurrence.entity);
    expect(
      entity !== undefined,
      `Callable occurrence ${occurrence.id} lost its binding entity.`,
    );
    if (!runtime_binding(entity)) continue;
    const root = binding_root(entity.id, parent.binding_index);
    if (captured_roots.has(root)) continue;
    const value = live_values.get(root);
    if (value === undefined || recursive_values.has(value)) continue;
    let type = parent.value_types.get(value);
    if (type === undefined) {
      type = binding_entity_type(entity, parent);
    }
    const origin = parent.value_origins.get(value);
    expect(
      origin !== undefined,
      `Lexical capture ${String(value)} has no semantic origin.`,
    );
    captured_roots.add(root);
    entry_captures.push(Object.freeze({
      value,
      root,
      type: snapshot_representation_type(type),
      origin,
    }));
  }
  return build_callable_control_flow_pass(
    expression,
    callable,
    callable_type,
    parent,
    entry_captures,
    parent.callable_ordinals,
  );
}

function build_callable_control_flow_pass(
  expression: Extract<FrontExpr, { tag: "lam" | "rec" }>,
  callable: ValueId,
  callable_type: RepresentationType,
  parent: LoweringContext,
  entry_captures: readonly CapturedSemanticValue[],
  callable_ordinals: Map<BabaSourceNodeId, number>,
): LoweredCallableControlFlow {
  let function_type = callable_type;
  while (function_type.tag === "forall") {
    function_type = function_type.body;
  }
  expect(
    function_type.tag === "function",
    `Callable ${String(callable)} has a non-function representation.`,
  );
  const builder = new SemanticCfgBuilder("duck-callable:" + String(callable));
  const entry = builder.add_block(
    semantic_location(expression.body, parent.root).origin,
  );
  const overrides = new Map<EntityId, ValueId>();
  const capture_overrides = new Map(parent.capture_overrides);
  for (const [root, value] of parent.overrides) {
    capture_overrides.set(root, value);
  }
  const value_types = new Map(parent.value_types);
  const value_origins = new Map(parent.value_origins);
  const defined_values = new Set<ValueId>();
  const declared_parameters = new Set<ValueId>();
  const binding = parent.callable_bindings.get(expression);
  const recursive_values = new Set<ValueId>();
  if (binding !== undefined) {
    for (const value of binding.recursive_group) {
      recursive_values.add(value);
      const entity_id = parent.entity_by_value.get(value);
      expect(
        entity_id !== undefined,
        `Recursive callable ${String(value)} has no binding entity.`,
      );
      const entity = parent.binding_index.entities.get(entity_id);
      expect(
        entity !== undefined,
        `Recursive callable ${String(value)} lost its binding entity.`,
      );
      const type = binding_entity_type(entity, parent);
      const output = semantic_output(entity, parent);
      value_types.set(value, type);
      value_origins.set(value, output.origin);
      const root = binding_root(entity.id, parent.binding_index);
      capture_overrides.set(root, value);
    }
  }
  for (const parameter of expression.params) {
    const entity = binding_entity(parameter, "name", parent);
    const output = semantic_output(entity, parent);
    const type = binding_entity_type(entity, parent);
    builder.add_parameter(output.value, type, output.origin);
    declared_parameters.add(output.value);
    defined_values.add(output.value);
    value_types.set(output.value, snapshot_representation_type(type));
    value_origins.set(output.value, output.origin);
    const root = binding_root(entity.id, parent.binding_index);
    overrides.set(root, output.value);
  }
  for (const capture of entry_captures) {
    builder.add_parameter(capture.value, capture.type, capture.origin);
    defined_values.add(capture.value);
    value_types.set(
      capture.value,
      snapshot_representation_type(capture.type),
    );
    value_origins.set(capture.value, capture.origin);
    overrides.set(capture.root, capture.value);
  }
  const nested_callables = new Map<ValueId, SemanticCallableControlFlow>();
  const context: LoweringContext = {
    builder,
    binding_index: parent.binding_index,
    binding_values: parent.binding_values,
    binding_origins: parent.binding_origins,
    entity_by_value: parent.entity_by_value,
    entities_by_subject: parent.entities_by_subject,
    root: parent.root,
    loops: [],
    overrides,
    capture_overrides,
    value_types,
    value_origins,
    defined_values,
    captured_values: [...entry_captures],
    recursive_values,
    callable_bindings: parent.callable_bindings,
    callable_control_flow: nested_callables,
    callable_identity: parent.callable_identity,
    callable_ordinals,
    allow_captures: true,
  };
  try {
    const lowered = lower_expression(expression.body, entry, context);
    if (lowered.tag === "value") {
      if (!same_representation_type(lowered.type, function_type.result)) {
        throw new SemanticCfgUnavailable(
          `Callable ${String(callable)} has incompatible return evidence.`,
        );
      }
      builder.terminate(lowered.block, {
        tag: "return",
        value: lowered.value,
      });
    }
  } catch (error) {
    if (
      error instanceof SemanticCfgUnavailable &&
      !error.invalidates_parent &&
      (context.captured_values.length > 0 || nested_callables.size > 0)
    ) {
      throw new SemanticCfgUnavailable(error.message, true);
    }
    throw error;
  }
  return {
    control_flow: builder.finish(),
    declared_parameters,
    recursive_values,
    nested_callables,
    captured_values: Object.freeze([...context.captured_values]),
  };
}

function emit_constant(
  subject: object,
  constant: string | number | bigint | boolean,
  block: SemanticBlockId,
  type: RepresentationType,
  context: LoweringContext,
): ExpressionFlow {
  const value = emit_operation(
    block,
    subject,
    { tag: "constant", value: constant },
    [],
    type,
    undefined,
    context,
  );
  return { tag: "value", block, value, type };
}

function normalize_condition(
  condition: Extract<ExpressionFlow, { tag: "value" }>,
  subject: object,
  context: LoweringContext,
): ValueId {
  const bool_type = { tag: "scalar", name: "Bool" } as const;
  if (!same_representation_type(condition.type, bool_type)) {
    const location = semantic_location(subject, context.root);
    if (context.allow_captures) {
      throw new SemanticCfgUnavailable(
        `Callable condition at ${location.span.start} has no Bool representation evidence.`,
      );
    }
    expect(
      false,
      `Validated condition at ${location.span.start} does not have representation Bool.`,
    );
  }
  return condition.value;
}

type LoweredOperands =
  | { tag: "values"; block: SemanticBlockId; values: ValueId[] }
  | { tag: "terminated"; block: SemanticBlockId };

function lower_expressions(
  expressions: readonly FrontExpr[],
  initial_block: SemanticBlockId,
  context: LoweringContext,
): LoweredOperands {
  let block = initial_block;
  const values: ValueId[] = [];
  for (const expression of expressions) {
    const lowered = lower_expression(expression, block, context);
    block = lowered.block;
    if (lowered.tag === "terminated") {
      return { tag: "terminated", block };
    }
    values.push(lowered.value);
  }
  return { tag: "values", block, values };
}

function lower_constructed_expression(
  subject: FrontExpr,
  elements: readonly FrontExpr[],
  constructor: string,
  block: SemanticBlockId,
  type: RepresentationType,
  context: LoweringContext,
): ExpressionFlow {
  const operands = lower_expressions(elements, block, context);
  if (operands.tag === "terminated") return operands;
  const value = emit_operation(
    operands.block,
    subject,
    { tag: "construct", constructor },
    operands.values,
    type,
    undefined,
    context,
  );
  return { tag: "value", block: operands.block, value, type };
}

function lower_if_expression(
  expression: Extract<FrontExpr, { tag: "if" }>,
  block: SemanticBlockId,
  type: RepresentationType,
  context: LoweringContext,
): ExpressionFlow {
  const condition = lower_expression(expression.cond, block, context);
  if (condition.tag === "terminated") return condition;
  const condition_value = normalize_condition(condition, expression, context);
  const location = semantic_location(expression, context.root);
  const when_true = context.builder.add_block(
    semantic_location(expression.then_branch, context.root).origin,
  );
  const when_false = context.builder.add_block(
    semantic_location(expression.else_branch, context.root).origin,
  );
  const joined = context.builder.add_block(location.origin);
  context.builder.connect(condition.block, when_true);
  context.builder.connect(condition.block, when_false);
  context.builder.terminate(condition.block, {
    tag: "branch",
    condition: condition_value,
    when_true,
    when_false,
  });
  const before = new Map(context.overrides);
  context.overrides = new Map(before);
  const true_result = lower_expression(
    expression.then_branch,
    when_true,
    context,
  );
  const true_overrides = new Map(context.overrides);
  context.overrides = new Map(before);
  const false_result = lower_expression(
    expression.else_branch,
    when_false,
    context,
  );
  const false_overrides = new Map(context.overrides);
  const result = join_expression_flows(
    joined,
    expression,
    location,
    [true_result, false_result],
    type,
    context,
  );
  if (result.tag === "terminated") return result;
  const predecessors: OverridePredecessor[] = [];
  if (true_result.tag === "value") {
    predecessors.push({
      block: true_result.block,
      overrides: true_overrides,
    });
  }
  if (false_result.tag === "value") {
    predecessors.push({
      block: false_result.block,
      overrides: false_overrides,
    });
  }
  merge_overrides(joined, predecessors, before, expression, context);
  return result;
}

function lower_if_let_expression(
  expression: Extract<FrontExpr, { tag: "if_let" }>,
  block: SemanticBlockId,
  type: RepresentationType,
  context: LoweringContext,
): ExpressionFlow {
  const target = lower_expression(expression.target, block, context);
  if (target.tag === "terminated") return target;
  const condition = emit_operation(
    target.block,
    expression,
    { tag: "primitive", name: "is-case:" + expression.case_name },
    [target.value],
    { tag: "scalar", name: "Bool" },
    undefined,
    context,
  );
  const location = semantic_location(expression, context.root);
  const when_true = context.builder.add_block(location.origin);
  const when_false = context.builder.add_block(location.origin);
  const joined = context.builder.add_block(location.origin);
  context.builder.connect(target.block, when_true);
  context.builder.connect(target.block, when_false);
  context.builder.terminate(target.block, {
    tag: "branch",
    condition,
    when_true,
    when_false,
  });
  const before = new Map(context.overrides);
  context.overrides = new Map(before);
  if (expression.value_name !== undefined) {
    const payload_type = binding_type(expression, "value_name", context);
    emit_operation(
      when_true,
      expression,
      { tag: "project", field: expression.value_name },
      [target.value],
      payload_type,
      binding_output(expression, "value_name", context),
      context,
    );
  }
  const true_result = lower_expression(
    expression.then_branch,
    when_true,
    context,
  );
  const true_overrides = new Map(context.overrides);
  context.overrides = new Map(before);
  const false_result = lower_expression(
    expression.else_branch,
    when_false,
    context,
  );
  const false_overrides = new Map(context.overrides);
  const result = join_expression_flows(
    joined,
    expression,
    location,
    [true_result, false_result],
    type,
    context,
  );
  if (result.tag === "terminated") return result;
  const predecessors: OverridePredecessor[] = [];
  if (true_result.tag === "value") {
    predecessors.push({
      block: true_result.block,
      overrides: true_overrides,
    });
  }
  if (false_result.tag === "value") {
    predecessors.push({
      block: false_result.block,
      overrides: false_overrides,
    });
  }
  merge_overrides(joined, predecessors, before, expression, context);
  return result;
}

function lower_match_expression(
  expression: Extract<FrontExpr, { tag: "match" }>,
  block: SemanticBlockId,
  type: RepresentationType,
  context: LoweringContext,
): ExpressionFlow {
  const target = lower_expression(expression.target, block, context);
  if (target.tag === "terminated") return target;
  const location = semantic_location(expression, context.root);
  const joined = context.builder.add_block(location.origin);
  const results: ExpressionFlow[] = [];
  const result_overrides: Map<EntityId, ValueId>[] = [];
  const before = new Map(context.overrides);
  let next_overrides = new Map(before);
  let test_block = target.block;
  for (let index = 0; index < expression.arms.length; index += 1) {
    const arm = expression.arms[index];
    expect(arm !== undefined, "Match arm disappeared.");
    const matched = context.builder.add_block(
      semantic_location(arm.body, context.root).origin,
    );
    const next = context.builder.add_block(location.origin);
    context.overrides = new Map(next_overrides);
    const before_arm = new Map(context.overrides);
    const condition = emit_pattern_test(
      test_block,
      arm.pattern,
      target.value,
      context,
    );
    context.builder.connect(test_block, matched);
    context.builder.connect(test_block, next);
    context.builder.terminate(test_block, {
      tag: "branch",
      condition,
      when_true: matched,
      when_false: next,
    });
    bind_pattern_values(arm.pattern, {
      tag: "value",
      block: matched,
      value: target.value,
      type: target.type,
    }, context);
    let body_entry = matched;
    if (arm.guard !== undefined) {
      const guard = lower_expression(arm.guard, body_entry, context);
      if (guard.tag === "terminated") {
        next_overrides = before_arm;
        context.overrides = new Map(before_arm);
        test_block = next;
        continue;
      }
      const guard_overrides = new Map(context.overrides);
      const guarded = context.builder.add_block(
        semantic_location(arm.body, context.root).origin,
      );
      const guard_condition = normalize_condition(guard, arm.guard, context);
      context.builder.connect(guard.block, guarded);
      context.builder.connect(guard.block, next);
      context.builder.terminate(guard.block, {
        tag: "branch",
        condition: guard_condition,
        when_true: guarded,
        when_false: next,
      });
      body_entry = guarded;
      merge_overrides(
        next,
        [
          { block: test_block, overrides: before_arm },
          { block: guard.block, overrides: guard_overrides },
        ],
        before_arm,
        arm.guard,
        context,
      );
      next_overrides = new Map(context.overrides);
      context.overrides = guard_overrides;
    }
    const result = lower_expression(arm.body, body_entry, context);
    results.push(result);
    result_overrides.push(new Map(context.overrides));
    if (arm.guard === undefined) next_overrides = before_arm;
    context.overrides = new Map(next_overrides);
    test_block = next;
  }
  context.builder.terminate(test_block, {
    tag: "trap",
    reason: "non-exhaustive match",
  });
  const result = join_expression_flows(
    joined,
    expression,
    location,
    results,
    type,
    context,
  );
  if (result.tag === "terminated") return result;
  const predecessors: OverridePredecessor[] = [];
  for (let index = 0; index < results.length; index += 1) {
    const flow = results[index];
    const overrides = result_overrides[index];
    expect(flow !== undefined, "Match result disappeared.");
    expect(overrides !== undefined, "Match result environment disappeared.");
    if (flow.tag === "terminated") continue;
    predecessors.push({ block: flow.block, overrides });
  }
  merge_overrides(joined, predecessors, before, expression, context);
  return result;
}

function lower_loop_expression(
  expression: Extract<FrontExpr, { tag: "loop" }>,
  block: SemanticBlockId,
  type: RepresentationType,
  context: LoweringContext,
): ExpressionFlow {
  const location = semantic_location(expression, context.root);
  const header = context.builder.add_block(location.origin);
  const exited = context.builder.add_block(location.origin);
  const entry_overrides = new Map(context.overrides);
  context.builder.connect(block, header);
  context.builder.terminate(block, { tag: "jump", target: header });
  const carried = begin_loop_overrides(
    header,
    block,
    entry_overrides,
    expression,
    context,
  );
  const loop: LoopBoundary = {
    break_target: exited,
    continue_target: header,
    breaks: [],
    continues: [],
    result_type: type,
  };
  context.loops.push(loop);
  const body = lower_statements(expression.body, header, context);
  const body_overrides = new Map(context.overrides);
  const removed = context.loops.pop();
  expect(removed === loop, "Loop expression boundary stack changed.");
  if (!body.terminated) {
    context.builder.connect(body.block, header);
    context.builder.terminate(body.block, {
      tag: "jump",
      target: header,
    });
  }
  if (!body.terminated) {
    add_loop_override_inputs(carried, body.block, body_overrides, context);
  }
  for (const current of loop.continues) {
    add_loop_override_inputs(
      carried,
      current.block,
      current.overrides,
      context,
    );
  }
  const values: ExpressionFlow[] = [];
  for (const current of loop.breaks) {
    if (current.value?.tag === "value") values.push(current.value);
  }
  if (loop.breaks.length === 0) {
    context.builder.terminate(exited, {
      tag: "trap",
      reason: "unreachable loop exit",
    });
    return { tag: "terminated", block: exited };
  }
  const exit_predecessors: OverridePredecessor[] = [];
  for (const current of loop.breaks) {
    exit_predecessors.push(current);
  }
  merge_overrides(
    exited,
    exit_predecessors,
    entry_overrides,
    expression,
    context,
  );
  if (values.length === 0) {
    return emit_constant(expression, "()", exited, type, context);
  }
  return join_expression_values(exited, location, values, type, context);
}

function join_expression_flows(
  joined: SemanticBlockId,
  subject: object,
  location: SemanticLocation,
  flows: readonly ExpressionFlow[],
  type: RepresentationType,
  context: LoweringContext,
): ExpressionFlow {
  const values: ExpressionFlow[] = [];
  for (const flow of flows) {
    if (flow.tag === "terminated") continue;
    let joined_flow = flow;
    if (!same_representation_type(flow.type, type)) {
      const value = emit_operation(
        flow.block,
        subject,
        { tag: "construct", constructor: "join-coercion" },
        [flow.value],
        type,
        undefined,
        context,
      );
      joined_flow = {
        tag: "value",
        block: flow.block,
        value,
        type,
      };
    }
    context.builder.connect(joined_flow.block, joined);
    context.builder.terminate(joined_flow.block, {
      tag: "jump",
      target: joined,
    });
    values.push(joined_flow);
  }
  if (values.length === 0) {
    context.builder.terminate(joined, {
      tag: "trap",
      reason: "unreachable expression join",
    });
    return { tag: "terminated", block: joined };
  }
  return join_expression_values(joined, location, values, type, context);
}

function join_expression_values(
  joined: SemanticBlockId,
  location: SemanticLocation,
  values: readonly ExpressionFlow[],
  type: RepresentationType,
  context: LoweringContext,
): ExpressionFlow {
  const incoming = new Map<SemanticBlockId, ValueId>();
  for (const flow of values) {
    expect(flow.tag === "value", "Expression join lost a live value.");
    expect(
      same_representation_type(flow.type, type),
      "Expression join retained an incompatible representation.",
    );
    incoming.set(flow.block, flow.value);
  }
  if (incoming.size === 1) {
    const value = [...incoming.values()][0];
    expect(value !== undefined, "Single expression join lost its value.");
    return { tag: "value", block: joined, value, type };
  }
  const value = context.builder.add_phi(
    joined,
    location.origin,
    location.span,
    incoming,
    type,
  );
  record_semantic_value(value, type, {
    source_node: location.origin,
    start: location.span.start,
    end: location.span.end,
  }, context);
  return { tag: "value", block: joined, value, type };
}

function begin_loop_overrides(
  header: SemanticBlockId,
  predecessor: SemanticBlockId,
  entry: ReadonlyMap<EntityId, ValueId>,
  subject: object,
  context: LoweringContext,
): Map<EntityId, ValueId> {
  const carried = new Map<EntityId, ValueId>();
  const location = semantic_location(subject, context.root);
  for (const [entity, value] of entry) {
    const type = context.value_types.get(value);
    expect(
      type !== undefined,
      `Loop entry ValueId ${String(value)} has no representation type.`,
    );
    const phi = context.builder.add_phi(
      header,
      location.origin,
      location.span,
      new Map([[predecessor, value]]),
      type,
    );
    record_semantic_value(phi, type, {
      source_node: location.origin,
      start: location.span.start,
      end: location.span.end,
    }, context);
    carried.set(entity, phi);
  }
  context.overrides = new Map(carried);
  return carried;
}

function add_loop_override_inputs(
  carried: ReadonlyMap<EntityId, ValueId>,
  predecessor: SemanticBlockId,
  overrides: ReadonlyMap<EntityId, ValueId>,
  context: LoweringContext,
): void {
  for (const [entity, phi] of carried) {
    let value = overrides.get(entity);
    if (value === undefined) value = phi;
    context.builder.add_phi_input(phi, predecessor, value);
  }
}

function merge_overrides(
  joined: SemanticBlockId,
  predecessors: readonly OverridePredecessor[],
  base: ReadonlyMap<EntityId, ValueId>,
  subject: object,
  context: LoweringContext,
): void {
  expect(predecessors.length > 0, "Override join needs a live predecessor.");
  const merged = new Map<EntityId, ValueId>();
  const location = semantic_location(subject, context.root);
  for (const [entity, base_value] of base) {
    const incoming = new Map<SemanticBlockId, ValueId>();
    for (const predecessor of predecessors) {
      let value = predecessor.overrides.get(entity);
      if (value === undefined) value = base_value;
      incoming.set(predecessor.block, value);
    }
    const values = [...incoming.values()];
    const first = values[0];
    expect(first !== undefined, "Override join lost its first value.");
    if (values.every((value) => value === first)) {
      merged.set(entity, first);
      continue;
    }
    const type = context.value_types.get(first);
    expect(
      type !== undefined,
      `Override ValueId ${String(first)} has no representation type.`,
    );
    for (const value of values) {
      const current_type = context.value_types.get(value);
      expect(
        current_type !== undefined &&
          same_representation_type(current_type, type),
        `Override ValueId ${String(value)} has an incompatible type.`,
      );
    }
    const phi = context.builder.add_phi(
      joined,
      location.origin,
      location.span,
      incoming,
      type,
    );
    record_semantic_value(phi, type, {
      source_node: location.origin,
      start: location.span.start,
      end: location.span.end,
    }, context);
    merged.set(entity, phi);
  }
  context.overrides = merged;
}

function emit_pattern_test(
  block: SemanticBlockId,
  pattern: Pattern,
  target: ValueId,
  context: LoweringContext,
): ValueId {
  return emit_operation(
    block,
    pattern,
    { tag: "primitive", name: "pattern:" + pattern_test_name(pattern) },
    [target],
    { tag: "scalar", name: "Bool" },
    undefined,
    context,
  );
}

function pattern_test_name(pattern: Pattern): string {
  if (pattern.tag === "binding" || pattern.tag === "wildcard") return "always";
  if (pattern.tag === "unit") return "unit";
  if (pattern.tag === "literal") {
    if (pattern.value.tag === "atom") return "atom:" + pattern.value.name;
    if (pattern.value.tag === "bool") {
      if (pattern.value.value) return "bool:true";
      return "bool:false";
    }
    if (pattern.value.tag === "text") return "text:" + pattern.value.value;
    return "number:" + String(pattern.value.value);
  }
  if (pattern.tag === "text_capture") {
    return "text:" + pattern.prefix + "*" + pattern.suffix;
  }
  if (pattern.tag === "const_value") return "const";
  if (pattern.tag === "value") return "value:" + pattern.name;
  if (pattern.tag === "type") return "type:" + pattern.pattern.kind;
  if (pattern.tag === "or") {
    return "or(" + pattern.alternatives.map(pattern_test_name).join("|") + ")";
  }
  if (pattern.tag === "union_case") return "case:" + pattern.name;
  if (pattern.tag === "product") return "product";
  if (pattern.tag === "record") return "record";
  if (pattern.tag === "array") return "array";
  pattern satisfies never;
  throw new Error("Unknown semantic pattern.");
}

function bind_pattern_values(
  pattern: Pattern,
  target: Extract<ExpressionFlow, { tag: "value" }>,
  context: LoweringContext,
): void {
  const entities: BindingEntity[] = [];
  collect_pattern_entities(pattern, context, entities);
  const emitted = new Set<ValueId>();
  for (const entity of entities) {
    const output = semantic_output(entity, context);
    if (emitted.has(output.value)) continue;
    emitted.add(output.value);
    const type = binding_entity_type(entity, context);
    emit_operation(
      target.block,
      entity.definition_subject,
      { tag: "project", field: "pattern:" + entity.name },
      [target.value],
      type,
      output,
      context,
    );
  }
}

function emit_operation(
  block: SemanticBlockId,
  subject: object,
  operation: SemanticOperation,
  inputs: readonly ValueId[],
  type: RepresentationType,
  output: SemanticExplicitOutput | undefined,
  context: LoweringContext,
): ValueId {
  const location = semantic_location(subject, context.root);
  let outputs: readonly SemanticExplicitOutput[] = [];
  if (output !== undefined) outputs = [output];
  const values = context.builder.add_node(
    block,
    location.origin,
    location.span,
    operation,
    inputs,
    [type],
    outputs,
  );
  const value = values[0];
  expect(value !== undefined, "Semantic operation produced no value.");
  let value_origin: SemanticOrigin = {
    source_node: location.origin,
    start: location.span.start,
    end: location.span.end,
  };
  if (output !== undefined) value_origin = output.origin;
  record_semantic_value(value, type, value_origin, context);
  return value;
}

function record_semantic_value(
  value: ValueId,
  type: RepresentationType,
  origin: SemanticOrigin,
  context: LoweringContext,
): void {
  context.defined_values.add(value);
  context.value_types.set(value, snapshot_representation_type(type));
  context.value_origins.set(
    value,
    Object.freeze({
      source_node: origin.source_node,
      start: origin.start,
      end: origin.end,
    }),
  );
  const entity = context.entity_by_value.get(value);
  if (entity === undefined) return;
  const root = binding_root(entity, context.binding_index);
  context.overrides.set(root, value);
}

function ensure_semantic_value_is_available(
  value: ValueId,
  type: RepresentationType,
  root: EntityId,
  context: LoweringContext,
): void {
  if (context.defined_values.has(value)) return;
  if (!context.allow_captures) {
    throw new SemanticCfgUnavailable(
      `Semantic value ${String(value)} is unavailable at this program point.`,
    );
  }
  const origin = context.value_origins.get(value);
  expect(
    origin !== undefined,
    `Captured semantic value ${String(value)} has no origin.`,
  );
  context.builder.add_parameter(value, type, origin);
  context.defined_values.add(value);
  context.value_types.set(value, snapshot_representation_type(type));
  context.overrides.set(root, value);
  if (!context.recursive_values.has(value)) {
    context.captured_values.push(Object.freeze({
      value,
      root,
      type: snapshot_representation_type(type),
      origin,
    }));
  }
}

function representation_of(
  subject: object,
  context: LoweringContext,
): RepresentationType {
  const type = context.binding_index.representation_of(subject);
  if (type === undefined) {
    const record = subject as { tag?: unknown };
    if (record.tag === "type_name") {
      return Object.freeze({ tag: "scalar", name: "Type" });
    }
    const occurrence = context.binding_index.occurrence_of(subject, "name");
    if (occurrence?.entity !== undefined) {
      const entity = context.binding_index.entities.get(occurrence.entity);
      expect(
        entity !== undefined,
        `Semantic reference ${occurrence.name} lost its entity.`,
      );
      if (!runtime_binding(entity)) {
        return Object.freeze({ tag: "scalar", name: "Type" });
      }
    }
    const location = semantic_location(subject, context.root);
    throw new SemanticCfgUnavailable(
      `Semantic expression at ${location.span.start}:${location.span.end} has no representation type.`,
    );
  }
  return snapshot_representation_type(type);
}

function binding_entity(
  subject: object,
  slot: string,
  context: LoweringContext,
): BindingEntity {
  const entity = find_binding_entity(subject, slot, context);
  expect(
    entity !== undefined,
    `Semantic binding slot ${slot} has no entity.`,
  );
  return entity;
}

function find_binding_entity(
  subject: object,
  slot: string,
  context: LoweringContext,
): BindingEntity | undefined {
  const entities = context.entities_by_subject.get(subject);
  return entities?.find((candidate) =>
    candidate.definition_slot === slot && candidate.owner === undefined
  );
}

function binding_entities(
  subject: object,
  context: LoweringContext,
): BindingEntity[] {
  const entities = context.entities_by_subject.get(subject);
  if (entities === undefined) return [];
  return entities.filter((entity) => entity.owner === undefined);
}

function collect_pattern_entities(
  pattern: Pattern,
  context: LoweringContext,
  entities: BindingEntity[],
): void {
  const direct = context.entities_by_subject.get(pattern);
  if (direct !== undefined) {
    for (const entity of direct) {
      if (entity.owner === undefined && !entities.includes(entity)) {
        entities.push(entity);
      }
    }
  }
  if (pattern.tag === "or") {
    for (const alternative of pattern.alternatives) {
      collect_pattern_entities(alternative, context, entities);
    }
    return;
  }
  if (pattern.tag === "union_case") {
    if (pattern.value !== undefined) {
      collect_pattern_entities(pattern.value, context, entities);
    }
    return;
  }
  if (pattern.tag === "product") {
    for (const entry of pattern.entries) {
      collect_pattern_entities(entry.pattern, context, entities);
    }
    if (pattern.rest !== undefined) {
      collect_pattern_entities(pattern.rest, context, entities);
    }
    return;
  }
  if (pattern.tag === "record") {
    for (const field of pattern.fields) {
      collect_pattern_entities(field.pattern, context, entities);
    }
    if (pattern.rest !== undefined) {
      collect_pattern_entities(pattern.rest, context, entities);
    }
    return;
  }
  if (pattern.tag === "array") {
    for (const element of pattern.items) {
      collect_pattern_entities(element, context, entities);
    }
    if (pattern.rest !== undefined) {
      collect_pattern_entities(pattern.rest, context, entities);
    }
  }
}

function binding_type(
  subject: object,
  slot: string,
  context: LoweringContext,
): RepresentationType {
  return binding_entity_type(binding_entity(subject, slot, context), context);
}

function binding_entity_type(
  entity: BindingEntity,
  context: LoweringContext,
): RepresentationType {
  const type = context.binding_index.facts.get(entity.id)?.representation;
  if (type === undefined) {
    throw new SemanticCfgUnavailable(
      `Semantic binding ${entity.name} has no representation type.`,
    );
  }
  return snapshot_representation_type(type);
}

function binding_output(
  subject: object,
  slot: string,
  context: LoweringContext,
): SemanticExplicitOutput {
  return semantic_output(binding_entity(subject, slot, context), context);
}

function semantic_output(
  entity: BindingEntity,
  context: LoweringContext,
): SemanticExplicitOutput {
  const value = context.binding_values.get(entity.id);
  expect(
    value !== undefined,
    `Semantic binding ${entity.name} has no ValueId.`,
  );
  let origin = context.binding_origins.get(value);
  if (origin === undefined) {
    const location = semantic_location(entity.definition_subject, context.root);
    origin = Object.freeze({
      source_node: location.origin,
      start: location.span.start,
      end: location.span.end,
    });
  }
  return { value, origin };
}

function replaced_value(
  entity: BindingEntity,
  context: LoweringContext,
): ValueId {
  expect(
    entity.replaces !== undefined,
    `Semantic replacement ${entity.name} has no predecessor.`,
  );
  const root = binding_root(entity.replaces, context.binding_index);
  let previous = context.overrides.get(root);
  if (previous === undefined) {
    previous = context.capture_overrides.get(root);
  }
  if (previous === undefined) {
    previous = context.binding_values.get(entity.replaces);
  }
  expect(
    previous !== undefined,
    `Semantic replacement ${entity.name} lost its predecessor ValueId.`,
  );
  let type = context.value_types.get(previous);
  if (type === undefined) {
    const predecessor = context.binding_index.entities.get(entity.replaces);
    expect(
      predecessor !== undefined,
      `Semantic replacement ${entity.name} lost its predecessor entity.`,
    );
    type = binding_entity_type(predecessor, context);
  }
  ensure_semantic_value_is_available(previous, type, root, context);
  return previous;
}

function runtime_binding(entity: BindingEntity): boolean {
  return entity.kind === "value" || entity.kind === "const" ||
    entity.kind === "parameter" || entity.kind === "module_parameter";
}

function binding_root(
  entity_id: EntityId,
  binding_index: BindingIndex,
): EntityId {
  let root = entity_id;
  const visited = new Set<EntityId>();
  while (true) {
    expect(!visited.has(root), `Cyclic binding replacement chain ${root}.`);
    visited.add(root);
    const entity = binding_index.entities.get(root);
    expect(entity !== undefined, `Binding replacement ${root} disappeared.`);
    if (entity.replaces === undefined) return root;
    root = entity.replaces;
  }
}

function semantic_location(
  subject: object,
  root: BabaCstNode | undefined,
): SemanticLocation {
  expect(has_source_span(subject), "Semantic subject has no source span.");
  const span = source_span(subject);
  const node = find_covering_node(root, span);
  expect(
    node !== undefined,
    `Semantic subject at ${span.start}:${span.end} has no Baba source node.`,
  );
  return { origin: node.id, span };
}

function find_covering_node(
  node: BabaCstNode | undefined,
  span: SourceSpan,
): BabaCstNode | undefined {
  if (
    node === undefined || node.start > span.start || node.end < span.end
  ) {
    return undefined;
  }
  let best = node;
  for (const child of node.children) {
    const candidate = find_covering_node(child, span);
    if (
      candidate !== undefined &&
      candidate.end - candidate.start < best.end - best.start
    ) {
      best = candidate;
    }
  }
  return best;
}
