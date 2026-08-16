import { expect } from "../expect.ts";
import type { KernelType, Universe } from "./kernel_terms.ts";

export type KernelPattern =
  | { tag: "sort"; universe: Universe }
  | { tag: "var"; index: number }
  | { tag: "constant"; name: string }
  | { tag: "pi"; domain: KernelPattern; codomain: KernelPattern }
  | { tag: "lam"; domain: KernelPattern; body: KernelPattern }
  | {
    tag: "app";
    function: KernelPattern;
    argument: KernelPattern;
  }
  | { tag: "meta"; id: number; scope: number };

export type KernelUnificationOptions = {
  scope: number;
};

const MAX_PATTERN_DEPTH = 256;
const MAX_PATTERN_NODES = 20_000;
const MAX_UNIFICATION_STEPS = 10_000;
const KERNEL_PATTERN_SOLUTION_TOKEN = Symbol(
  "ducklang.KernelPatternSolution",
);

type UnificationBudget = {
  steps: number;
  nodes: number;
};

type PatternSnapshotBudget = {
  nodes: number;
};

type KernelSubstitution = {
  scope: number;
  pattern: KernelPattern;
};

export class KernelPatternSolution {
  readonly #substitutions: ReadonlyMap<number, KernelSubstitution>;
  readonly #metavariable_scopes: ReadonlyMap<number, number>;
  readonly #scope: number;

  constructor(
    token: symbol,
    substitutions: ReadonlyMap<number, KernelSubstitution>,
    metavariable_scopes: ReadonlyMap<number, number>,
    scope: number,
  ) {
    expect(
      token === KERNEL_PATTERN_SOLUTION_TOKEN,
      "Kernel pattern solutions can only be created by the unifier.",
    );
    const snapshot = new Map<number, KernelSubstitution>();
    const stable_scopes = new Map(metavariable_scopes);
    const snapshot_budget: PatternSnapshotBudget = { nodes: 0 };
    for (const [id, substitution] of substitutions) {
      snapshot.set(
        id,
        Object.freeze({
          scope: substitution.scope,
          pattern: snapshot_kernel_pattern(
            substitution.pattern,
            substitution.scope,
            0,
            new WeakSet<object>(),
            snapshot_budget,
            stable_scopes,
          ),
        }),
      );
    }
    this.#substitutions = snapshot;
    this.#metavariable_scopes = stable_scopes;
    this.#scope = scope;
  }

  substitution(id: number): KernelPattern | undefined {
    expect(
      Number.isSafeInteger(id) && id >= 0,
      `Invalid kernel metavariable ${String(id)}.`,
    );
    return this.#substitutions.get(id)?.pattern;
  }

  apply(pattern: KernelPattern): KernelPattern {
    const stable = snapshot_kernel_pattern(
      pattern,
      this.#scope,
      0,
      new WeakSet<object>(),
      { nodes: 0 },
      new Map(this.#metavariable_scopes),
    );
    return apply_substitutions(stable, this.#substitutions, this.#scope);
  }

  resolved_type(pattern: KernelPattern): KernelType {
    return pattern_to_type(this.apply(pattern));
  }
}

export function unify_kernel_patterns(
  left: KernelPattern,
  right: KernelPattern,
  options: KernelUnificationOptions = { scope: 0 },
): KernelPatternSolution {
  const option_properties = own_data_properties(
    options,
    "Kernel unification options",
  );
  const scope = required_property<number>(
    option_properties,
    "scope",
    "Kernel unification options",
  );
  expect(
    Number.isSafeInteger(scope) && scope >= 0 &&
      scope < Number.MAX_SAFE_INTEGER - MAX_PATTERN_DEPTH,
    `Invalid kernel unification scope ${String(scope)}.`,
  );
  const metavariable_scopes = new Map<number, number>();
  const stable_left = snapshot_kernel_pattern(
    left,
    scope,
    0,
    new WeakSet<object>(),
    { nodes: 0 },
    metavariable_scopes,
  );
  const stable_right = snapshot_kernel_pattern(
    right,
    scope,
    0,
    new WeakSet<object>(),
    { nodes: 0 },
    metavariable_scopes,
  );
  const substitutions = new Map<number, KernelSubstitution>();
  unify_at(
    stable_left,
    stable_right,
    scope,
    substitutions,
    { steps: 0, nodes: 0 },
  );
  const normalized = new Map<number, KernelSubstitution>();
  const normalization_budget: PatternSnapshotBudget = { nodes: 0 };
  const ids = [...substitutions.keys()].sort((left_id, right_id) =>
    left_id - right_id
  );
  for (const id of ids) {
    const substitution = substitutions.get(id);
    expect(
      substitution !== undefined,
      `Kernel metavariable ${id} lost its substitution.`,
    );
    normalized.set(
      id,
      Object.freeze({
        scope: substitution.scope,
        pattern: apply_substitutions(
          substitution.pattern,
          substitutions,
          substitution.scope,
          0,
          normalization_budget,
        ),
      }),
    );
  }
  return new KernelPatternSolution(
    KERNEL_PATTERN_SOLUTION_TOKEN,
    normalized,
    metavariable_scopes,
    scope,
  );
}

function unify_at(
  raw_left: KernelPattern,
  raw_right: KernelPattern,
  scope: number,
  substitutions: Map<number, KernelSubstitution>,
  budget: UnificationBudget,
): void {
  budget.steps += 1;
  expect(
    budget.steps <= MAX_UNIFICATION_STEPS,
    `Kernel pattern unification exceeded ${MAX_UNIFICATION_STEPS} steps.`,
  );
  const left = resolve_head(raw_left, substitutions, scope, budget);
  const right = resolve_head(raw_right, substitutions, scope, budget);
  if (left.tag === "meta") {
    bind_metavariable(left, right, scope, substitutions, budget);
    return;
  }
  if (right.tag === "meta") {
    bind_metavariable(right, left, scope, substitutions, budget);
    return;
  }
  expect(
    left.tag === right.tag,
    `Cannot unify kernel pattern ${left.tag} with ${right.tag}.`,
  );
  switch (left.tag) {
    case "sort": {
      const candidate = right as Extract<KernelPattern, { tag: "sort" }>;
      expect(
        same_universe(left.universe, candidate.universe),
        "Cannot unify different kernel universes.",
      );
      return;
    }
    case "var": {
      const candidate = right as Extract<KernelPattern, { tag: "var" }>;
      expect(
        left.index === candidate.index,
        `Cannot unify kernel variables ${left.index} and ${candidate.index}.`,
      );
      return;
    }
    case "constant": {
      const candidate = right as Extract<
        KernelPattern,
        { tag: "constant" }
      >;
      expect(
        left.name === candidate.name,
        `Cannot unify kernel constants ${left.name} and ${candidate.name}.`,
      );
      return;
    }
    case "pi": {
      const candidate = right as Extract<KernelPattern, { tag: "pi" }>;
      unify_at(left.domain, candidate.domain, scope, substitutions, budget);
      unify_at(
        left.codomain,
        candidate.codomain,
        scope + 1,
        substitutions,
        budget,
      );
      return;
    }
    case "lam": {
      const candidate = right as Extract<KernelPattern, { tag: "lam" }>;
      unify_at(left.domain, candidate.domain, scope, substitutions, budget);
      unify_at(
        left.body,
        candidate.body,
        scope + 1,
        substitutions,
        budget,
      );
      return;
    }
    case "app": {
      const candidate = right as Extract<KernelPattern, { tag: "app" }>;
      unify_at(
        left.function,
        candidate.function,
        scope,
        substitutions,
        budget,
      );
      unify_at(
        left.argument,
        candidate.argument,
        scope,
        substitutions,
        budget,
      );
      return;
    }
  }
}

function bind_metavariable(
  metavariable: Extract<KernelPattern, { tag: "meta" }>,
  raw_pattern: KernelPattern,
  scope: number,
  substitutions: Map<number, KernelSubstitution>,
  budget: UnificationBudget,
): void {
  expect(
    metavariable.scope <= scope,
    `Kernel metavariable ?${metavariable.id} from scope ${metavariable.scope} cannot appear in scope ${scope}.`,
  );
  const pattern = resolve_head(raw_pattern, substitutions, scope, budget);
  if (pattern.tag === "meta") {
    expect(
      pattern.scope <= scope,
      `Kernel metavariable ?${pattern.id} from scope ${pattern.scope} cannot appear in scope ${scope}.`,
    );
    if (pattern.id === metavariable.id) return;
    if (
      pattern.scope < metavariable.scope ||
      (pattern.scope === metavariable.scope &&
        pattern.id < metavariable.id)
    ) {
      substitutions.set(metavariable.id, {
        scope: metavariable.scope,
        pattern: lower_pattern(
          pattern,
          scope - metavariable.scope,
          metavariable.scope,
          substitutions,
          0,
          0,
          budget,
        ),
      });
      return;
    }
    substitutions.set(pattern.id, {
      scope: pattern.scope,
      pattern: lower_pattern(
        metavariable,
        scope - pattern.scope,
        pattern.scope,
        substitutions,
        0,
        0,
        budget,
      ),
    });
    return;
  }
  const canonical = lower_pattern(
    pattern,
    scope - metavariable.scope,
    metavariable.scope,
    substitutions,
    0,
    0,
    budget,
  );
  expect(
    !pattern_contains_metavariable(
      canonical,
      metavariable.id,
      substitutions,
      metavariable.scope,
      0,
      budget,
    ),
    `Kernel pattern occurs check failed for ?${metavariable.id}.`,
  );
  substitutions.set(
    metavariable.id,
    {
      scope: metavariable.scope,
      pattern: canonical,
    },
  );
}

function resolve_head(
  pattern: KernelPattern,
  substitutions: ReadonlyMap<number, KernelSubstitution>,
  scope: number,
  budget: PatternSnapshotBudget,
): KernelPattern {
  let current = pattern;
  const visited = new Set<number>();
  while (current.tag === "meta") {
    expect(
      !visited.has(current.id),
      `Cyclic kernel substitution for ?${current.id}.`,
    );
    visited.add(current.id);
    const substitution = substitutions.get(current.id);
    if (substitution === undefined) return current;
    expect(
      substitution.scope <= scope,
      `Kernel substitution for ?${current.id} escapes scope ${scope}.`,
    );
    const amount = scope - substitution.scope;
    if (amount === 0) {
      current = substitution.pattern;
      continue;
    }
    const normalized = apply_substitutions(
      substitution.pattern,
      substitutions,
      substitution.scope,
      0,
      budget,
    );
    current = weaken_pattern(
      normalized,
      amount,
      substitution.scope,
      0,
      0,
      budget,
    );
  }
  return current;
}

function pattern_contains_metavariable(
  pattern: KernelPattern,
  id: number,
  substitutions: ReadonlyMap<number, KernelSubstitution>,
  scope: number,
  depth = 0,
  budget: PatternSnapshotBudget = { nodes: 0 },
): boolean {
  expect(depth <= MAX_PATTERN_DEPTH, "Kernel occurs check is too deep.");
  budget.nodes += 1;
  expect(
    budget.nodes <= MAX_PATTERN_NODES,
    `Kernel occurs check exceeded ${MAX_PATTERN_NODES} nodes.`,
  );
  const resolved = resolve_head(pattern, substitutions, scope, budget);
  switch (resolved.tag) {
    case "sort":
    case "var":
    case "constant":
      return false;
    case "meta":
      return resolved.id === id;
    case "pi":
      return pattern_contains_metavariable(
        resolved.domain,
        id,
        substitutions,
        scope,
        depth + 1,
        budget,
      ) ||
        pattern_contains_metavariable(
          resolved.codomain,
          id,
          substitutions,
          scope + 1,
          depth + 1,
          budget,
        );
    case "lam":
      return pattern_contains_metavariable(
        resolved.domain,
        id,
        substitutions,
        scope,
        depth + 1,
        budget,
      ) ||
        pattern_contains_metavariable(
          resolved.body,
          id,
          substitutions,
          scope + 1,
          depth + 1,
          budget,
        );
    case "app":
      return pattern_contains_metavariable(
        resolved.function,
        id,
        substitutions,
        scope,
        depth + 1,
        budget,
      ) ||
        pattern_contains_metavariable(
          resolved.argument,
          id,
          substitutions,
          scope,
          depth + 1,
          budget,
        );
  }
}

function apply_substitutions(
  pattern: KernelPattern,
  substitutions: ReadonlyMap<number, KernelSubstitution>,
  scope: number,
  depth = 0,
  budget: PatternSnapshotBudget = { nodes: 0 },
): KernelPattern {
  expect(depth <= MAX_PATTERN_DEPTH, "Kernel substitution is too deep.");
  budget.nodes += 1;
  expect(
    budget.nodes <= MAX_PATTERN_NODES,
    `Kernel substitution exceeded ${MAX_PATTERN_NODES} nodes.`,
  );
  const resolved = resolve_head(pattern, substitutions, scope, budget);
  switch (resolved.tag) {
    case "sort":
      return Object.freeze({
        tag: "sort",
        universe: snapshot_universe(resolved.universe),
      });
    case "var":
      return Object.freeze({ tag: "var", index: resolved.index });
    case "constant":
      return Object.freeze({ tag: "constant", name: resolved.name });
    case "meta":
      return Object.freeze({
        tag: "meta",
        id: resolved.id,
        scope: resolved.scope,
      });
    case "pi":
      return Object.freeze({
        tag: "pi",
        domain: apply_substitutions(
          resolved.domain,
          substitutions,
          scope,
          depth + 1,
          budget,
        ),
        codomain: apply_substitutions(
          resolved.codomain,
          substitutions,
          scope + 1,
          depth + 1,
          budget,
        ),
      });
    case "lam":
      return Object.freeze({
        tag: "lam",
        domain: apply_substitutions(
          resolved.domain,
          substitutions,
          scope,
          depth + 1,
          budget,
        ),
        body: apply_substitutions(
          resolved.body,
          substitutions,
          scope + 1,
          depth + 1,
          budget,
        ),
      });
    case "app":
      return Object.freeze({
        tag: "app",
        function: apply_substitutions(
          resolved.function,
          substitutions,
          scope,
          depth + 1,
          budget,
        ),
        argument: apply_substitutions(
          resolved.argument,
          substitutions,
          scope,
          depth + 1,
          budget,
        ),
      });
  }
}

function weaken_pattern(
  pattern: KernelPattern,
  amount: number,
  source_scope: number,
  binder_depth = 0,
  depth = 0,
  budget: PatternSnapshotBudget = { nodes: 0 },
): KernelPattern {
  expect(depth <= MAX_PATTERN_DEPTH, "Kernel pattern weakening is too deep.");
  budget.nodes += 1;
  expect(
    budget.nodes <= MAX_PATTERN_NODES,
    `Kernel pattern weakening exceeded ${MAX_PATTERN_NODES} nodes.`,
  );
  if (amount === 0) return pattern;
  switch (pattern.tag) {
    case "sort":
    case "constant":
      return pattern;
    case "meta":
      expect(
        pattern.scope <= source_scope,
        `Kernel metavariable ?${pattern.id} cannot be weakened across reordered binders.`,
      );
      return pattern;
    case "var":
      if (pattern.index < binder_depth) return pattern;
      return Object.freeze({
        tag: "var",
        index: pattern.index + amount,
      });
    case "pi":
      return Object.freeze({
        tag: "pi",
        domain: weaken_pattern(
          pattern.domain,
          amount,
          source_scope,
          binder_depth,
          depth + 1,
          budget,
        ),
        codomain: weaken_pattern(
          pattern.codomain,
          amount,
          source_scope,
          binder_depth + 1,
          depth + 1,
          budget,
        ),
      });
    case "lam":
      return Object.freeze({
        tag: "lam",
        domain: weaken_pattern(
          pattern.domain,
          amount,
          source_scope,
          binder_depth,
          depth + 1,
          budget,
        ),
        body: weaken_pattern(
          pattern.body,
          amount,
          source_scope,
          binder_depth + 1,
          depth + 1,
          budget,
        ),
      });
    case "app":
      return Object.freeze({
        tag: "app",
        function: weaken_pattern(
          pattern.function,
          amount,
          source_scope,
          binder_depth,
          depth + 1,
          budget,
        ),
        argument: weaken_pattern(
          pattern.argument,
          amount,
          source_scope,
          binder_depth,
          depth + 1,
          budget,
        ),
      });
  }
}

function lower_pattern(
  pattern: KernelPattern,
  amount: number,
  target_scope: number,
  substitutions: ReadonlyMap<number, KernelSubstitution>,
  binder_depth = 0,
  depth = 0,
  budget: PatternSnapshotBudget = { nodes: 0 },
): KernelPattern {
  expect(depth <= MAX_PATTERN_DEPTH, "Kernel pattern lowering is too deep.");
  budget.nodes += 1;
  expect(
    budget.nodes <= MAX_PATTERN_NODES,
    `Kernel pattern lowering exceeded ${MAX_PATTERN_NODES} nodes.`,
  );
  expect(amount >= 0, `Invalid kernel pattern lowering ${amount}.`);
  if (amount === 0) return pattern;
  switch (pattern.tag) {
    case "sort":
    case "constant":
      return pattern;
    case "meta": {
      const occurrence_scope = target_scope + amount + binder_depth;
      const resolved = resolve_head(
        pattern,
        substitutions,
        occurrence_scope,
        budget,
      );
      if (resolved.tag !== "meta") {
        return lower_pattern(
          resolved,
          amount,
          target_scope,
          substitutions,
          binder_depth,
          depth + 1,
          budget,
        );
      }
      expect(
        resolved.scope <= target_scope,
        `Kernel metavariable ?${resolved.id} escapes scope ${target_scope}.`,
      );
      return resolved;
    }
    case "var": {
      if (pattern.index < binder_depth) return pattern;
      const outer_index = pattern.index - binder_depth;
      expect(
        outer_index >= amount,
        `Kernel pattern variable ${pattern.index} escapes scope ${target_scope}.`,
      );
      return Object.freeze({
        tag: "var",
        index: pattern.index - amount,
      });
    }
    case "pi":
      return Object.freeze({
        tag: "pi",
        domain: lower_pattern(
          pattern.domain,
          amount,
          target_scope,
          substitutions,
          binder_depth,
          depth + 1,
          budget,
        ),
        codomain: lower_pattern(
          pattern.codomain,
          amount,
          target_scope,
          substitutions,
          binder_depth + 1,
          depth + 1,
          budget,
        ),
      });
    case "lam":
      return Object.freeze({
        tag: "lam",
        domain: lower_pattern(
          pattern.domain,
          amount,
          target_scope,
          substitutions,
          binder_depth,
          depth + 1,
          budget,
        ),
        body: lower_pattern(
          pattern.body,
          amount,
          target_scope,
          substitutions,
          binder_depth + 1,
          depth + 1,
          budget,
        ),
      });
    case "app":
      return Object.freeze({
        tag: "app",
        function: lower_pattern(
          pattern.function,
          amount,
          target_scope,
          substitutions,
          binder_depth,
          depth + 1,
          budget,
        ),
        argument: lower_pattern(
          pattern.argument,
          amount,
          target_scope,
          substitutions,
          binder_depth,
          depth + 1,
          budget,
        ),
      });
  }
}

function pattern_to_type(pattern: KernelPattern): KernelType {
  switch (pattern.tag) {
    case "sort":
      return Object.freeze({
        tag: "sort",
        universe: snapshot_universe(pattern.universe),
      });
    case "var":
      return Object.freeze({ tag: "var", index: pattern.index });
    case "constant":
      return Object.freeze({ tag: "constant", name: pattern.name });
    case "pi":
      return Object.freeze({
        tag: "pi",
        domain: pattern_to_type(pattern.domain),
        codomain: pattern_to_type(pattern.codomain),
      });
    case "lam":
      return Object.freeze({
        tag: "lam",
        domain: pattern_to_type(pattern.domain),
        body: pattern_to_type(pattern.body),
      });
    case "app":
      return Object.freeze({
        tag: "app",
        function: pattern_to_type(pattern.function),
        argument: pattern_to_type(pattern.argument),
      });
    case "meta":
      throw new Error(
        `Kernel metavariable ?${pattern.id} remains unresolved.`,
      );
  }
}

function snapshot_kernel_pattern(
  pattern: KernelPattern,
  scope: number,
  depth = 0,
  active = new WeakSet<object>(),
  budget: PatternSnapshotBudget = { nodes: 0 },
  metavariable_scopes = new Map<number, number>(),
): KernelPattern {
  expect(depth <= MAX_PATTERN_DEPTH, "Kernel pattern is too deep.");
  budget.nodes += 1;
  expect(
    budget.nodes <= MAX_PATTERN_NODES,
    `Kernel pattern snapshot exceeded ${MAX_PATTERN_NODES} nodes.`,
  );
  expect(
    pattern !== null && typeof pattern === "object",
    "Invalid kernel pattern.",
  );
  if (active.has(pattern)) {
    throw new Error("Kernel pattern graph must be acyclic.");
  }
  active.add(pattern);
  const properties = own_data_properties(pattern, "Kernel pattern");
  const tag = required_property<string>(properties, "tag", "Kernel pattern");
  let snapshot: KernelPattern;
  switch (tag) {
    case "sort":
      snapshot = Object.freeze({
        tag: "sort",
        universe: snapshot_universe(
          required_property(properties, "universe", "Kernel sort pattern"),
        ),
      });
      break;
    case "var": {
      const index = required_property<number>(
        properties,
        "index",
        "Kernel variable pattern",
      );
      expect(
        Number.isSafeInteger(index) && index >= 0 && index < scope,
        `Kernel pattern variable ${String(index)} is outside scope ${scope}.`,
      );
      snapshot = Object.freeze({ tag: "var", index });
      break;
    }
    case "constant": {
      const name = required_property<string>(
        properties,
        "name",
        "Kernel constant pattern",
      );
      expect(
        typeof name === "string" && name.length > 0,
        "Kernel pattern constant name must not be empty.",
      );
      snapshot = Object.freeze({ tag: "constant", name });
      break;
    }
    case "meta": {
      const id = required_property<number>(
        properties,
        "id",
        "Kernel metavariable",
      );
      const declared_scope = required_property<number>(
        properties,
        "scope",
        "Kernel metavariable",
      );
      expect(
        Number.isSafeInteger(id) && id >= 0,
        `Invalid kernel metavariable ${String(id)}.`,
      );
      expect(
        Number.isSafeInteger(declared_scope) && declared_scope >= 0,
        `Invalid scope ${
          String(declared_scope)
        } for kernel metavariable ?${id}.`,
      );
      expect(
        declared_scope <= scope,
        `Kernel metavariable ?${id} from scope ${declared_scope} cannot appear in scope ${scope}.`,
      );
      const prior_scope = metavariable_scopes.get(id);
      if (prior_scope === undefined) {
        metavariable_scopes.set(id, declared_scope);
      } else {
        expect(
          prior_scope === declared_scope,
          `Kernel metavariable ?${id} has conflicting scopes ${prior_scope} and ${declared_scope}.`,
        );
      }
      snapshot = Object.freeze({ tag: "meta", id, scope: declared_scope });
      break;
    }
    case "pi":
      snapshot = Object.freeze({
        tag: "pi",
        domain: snapshot_kernel_pattern(
          required_property(properties, "domain", "Kernel pi pattern"),
          scope,
          depth + 1,
          active,
          budget,
          metavariable_scopes,
        ),
        codomain: snapshot_kernel_pattern(
          required_property(properties, "codomain", "Kernel pi pattern"),
          scope + 1,
          depth + 1,
          active,
          budget,
          metavariable_scopes,
        ),
      });
      break;
    case "lam":
      snapshot = Object.freeze({
        tag: "lam",
        domain: snapshot_kernel_pattern(
          required_property(properties, "domain", "Kernel lambda pattern"),
          scope,
          depth + 1,
          active,
          budget,
          metavariable_scopes,
        ),
        body: snapshot_kernel_pattern(
          required_property(properties, "body", "Kernel lambda pattern"),
          scope + 1,
          depth + 1,
          active,
          budget,
          metavariable_scopes,
        ),
      });
      break;
    case "app":
      snapshot = Object.freeze({
        tag: "app",
        function: snapshot_kernel_pattern(
          required_property(
            properties,
            "function",
            "Kernel application pattern",
          ),
          scope,
          depth + 1,
          active,
          budget,
          metavariable_scopes,
        ),
        argument: snapshot_kernel_pattern(
          required_property(
            properties,
            "argument",
            "Kernel application pattern",
          ),
          scope,
          depth + 1,
          active,
          budget,
          metavariable_scopes,
        ),
      });
      break;
    default:
      throw new Error(`Invalid kernel pattern tag ${String(tag)}.`);
  }
  active.delete(pattern);
  return snapshot;
}

function snapshot_universe(universe: Universe): Universe {
  expect(
    universe !== null && typeof universe === "object",
    "Invalid kernel pattern universe.",
  );
  const properties = own_data_properties(
    universe,
    "Kernel pattern universe",
  );
  const tag = required_property<string>(
    properties,
    "tag",
    "Kernel pattern universe",
  );
  if (tag === "prop") return Object.freeze({ tag: "prop" });
  expect(tag === "type", `Invalid kernel pattern universe tag ${String(tag)}.`);
  const level = required_property<number>(
    properties,
    "level",
    "Kernel pattern universe",
  );
  expect(
    Number.isSafeInteger(level) && level >= 0 &&
      level < Number.MAX_SAFE_INTEGER,
    `Invalid kernel pattern universe level ${String(level)}.`,
  );
  return Object.freeze({ tag: "type", level });
}

function same_universe(left: Universe, right: Universe): boolean {
  if (left.tag !== right.tag) return false;
  if (left.tag === "prop") return true;
  return left.level ===
    (right as Extract<Universe, { tag: "type" }>).level;
}

function own_data_properties(
  value: object,
  label: string,
): ReadonlyMap<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  expect(
    prototype === Object.prototype || prototype === null,
    `${label} must be a plain record.`,
  );
  const properties = new Map<string, unknown>();
  for (const key of Reflect.ownKeys(value)) {
    expect(typeof key === "string", `${label} cannot contain symbols.`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    expect(
      descriptor !== undefined &&
        descriptor.get === undefined &&
        descriptor.set === undefined,
      `${label} properties must be own data properties.`,
    );
    properties.set(key, descriptor.value);
  }
  return properties;
}

function required_property<Value>(
  properties: ReadonlyMap<string, unknown>,
  key: string,
  label: string,
): Value {
  expect(properties.has(key), `${label} is missing ${key}.`);
  return properties.get(key) as Value;
}
