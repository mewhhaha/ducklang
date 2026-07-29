import { expect } from "../expect.ts";

const OBJECT_FREEZE = Object.freeze;
const OBJECT_DEFINE_PROPERTY = Object.defineProperty;
const OBJECT_GET_OWN_PROPERTY_DESCRIPTOR = Object.getOwnPropertyDescriptor;
const OBJECT_GET_PROTOTYPE_OF = Object.getPrototypeOf;
const OBJECT_PROTOTYPE = Object.prototype;
const ARRAY_IS_ARRAY = Array.isArray;
const ARRAY_PROTOTYPE = Array.prototype;
const MAP_CONSTRUCTOR = Map;
const MAP_PROTOTYPE = Map.prototype;
const NUMBER_CONSTRUCTOR = Number;
const NUMBER_IS_SAFE_INTEGER = Number.isSafeInteger;
const NUMBER_MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const REFLECT_OWN_KEYS = Reflect.ownKeys;
const STRING_CONSTRUCTOR = String;
const WEAK_SET_CONSTRUCTOR = WeakSet;

export type Universe =
  | { tag: "prop" }
  | { tag: "type"; level: number };

export type KernelType =
  | { tag: "sort"; universe: Universe }
  | { tag: "var"; index: number }
  | { tag: "constant"; name: string }
  | { tag: "pi"; domain: KernelType; codomain: KernelType }
  | { tag: "lam"; domain: KernelType; body: KernelType }
  | { tag: "app"; function: KernelType; argument: KernelType };

export type KernelTerm =
  | { tag: "var"; index: number }
  | { tag: "constant"; name: string; type: KernelType }
  | { tag: "lam"; domain: KernelType; body: KernelTerm }
  | { tag: "app"; function: KernelTerm; argument: KernelTerm };

export type KernelContext = readonly KernelType[];

export type KernelDefinition =
  | { tag: "declaration"; name: string; type: KernelType }
  | {
    tag: "transparent";
    name: string;
    module: string;
    type: KernelType;
    value: KernelType;
    total: boolean;
  }
  | {
    tag: "opaque";
    name: string;
    module: string;
    type: KernelType;
    value: KernelType;
    total: boolean;
  };

const MAX_KERNEL_DEPTH = 256;
const MAX_KERNEL_NODES = 20_000;
const MAX_NORMALIZATION_NODES = 100_000;
const MAX_NORMALIZATION_STEPS = 10_000;
const KERNEL_ENVIRONMENT_TOKEN = Symbol("ducklang.KernelEnvironment");
const trusted_kernel_environments = new WEAK_SET_CONSTRUCTOR<object>();
const MAP_FOR_EACH = MAP_CONSTRUCTOR.prototype.forEach;
const MAP_GET = MAP_CONSTRUCTOR.prototype.get;
const MAP_HAS = MAP_CONSTRUCTOR.prototype.has;
const MAP_SET = MAP_CONSTRUCTOR.prototype.set;
const REFLECT_APPLY = Reflect.apply;
const WEAK_SET_ADD = WEAK_SET_CONSTRUCTOR.prototype.add;
const WEAK_SET_DELETE = WEAK_SET_CONSTRUCTOR.prototype.delete;
const WEAK_SET_HAS = WEAK_SET_CONSTRUCTOR.prototype.has;

type NormalizationBudget = {
  nodes: number;
  steps: number;
};

type KernelSnapshotBudget = {
  nodes: number;
};

type StableKernelDefinition =
  | { tag: "declaration"; type: KernelType }
  | {
    tag: "transparent" | "opaque";
    module: string;
    type: KernelType;
    value: KernelType;
  };

let empty_kernel_environment: KernelEnvironment | undefined;

export class KernelEnvironment {
  readonly #definitions: ReadonlyMap<string, StableKernelDefinition>;
  readonly #module: string | undefined;
  private constructor(
    token: symbol,
    definitions: ReadonlyMap<string, StableKernelDefinition>,
    module: string | undefined,
  ) {
    expect(
      token === KERNEL_ENVIRONMENT_TOKEN,
      "Kernel environments can only be created by checked factories.",
    );
    this.#definitions = definitions;
    this.#module = module;
    REFLECT_APPLY(WEAK_SET_ADD, trusted_kernel_environments, [this]);
    OBJECT_FREEZE(this);
  }
  static empty(): KernelEnvironment {
    if (empty_kernel_environment === undefined) {
      empty_kernel_environment = new KernelEnvironment(
        KERNEL_ENVIRONMENT_TOKEN,
        new MAP_CONSTRUCTOR(),
        undefined,
      );
    }
    return empty_kernel_environment;
  }
  static from(
    declarations: ReadonlyMap<string, KernelType>,
  ): KernelEnvironment {
    expect(
      OBJECT_GET_PROTOTYPE_OF(declarations) === MAP_PROTOTYPE,
      "Kernel declarations must be an ordinary Map.",
    );
    const snapshot = new MAP_CONSTRUCTOR<string, StableKernelDefinition>();
    const budget: KernelSnapshotBudget = { nodes: 0 };
    const computation: NormalizationBudget = { nodes: 0, steps: 0 };
    REFLECT_APPLY(MAP_FOR_EACH, declarations, [(
      declaration: KernelType,
      name: string,
    ) => {
      expect(
        typeof name === "string" && name.length > 0,
        "Kernel declaration name must not be empty.",
      );
      const stable_declaration = snapshot_type(
        declaration,
        0,
        new WEAK_SET_CONSTRUCTOR<object>(),
        budget,
      );
      const environment = new KernelEnvironment(
        KERNEL_ENVIRONMENT_TOKEN,
        snapshot,
        undefined,
      );
      check_type_at(stable_declaration, [], environment, computation);
      REFLECT_APPLY(MAP_SET, snapshot, [
        name,
        {
          tag: "declaration",
          type: stable_declaration,
        },
      ]);
    }]);
    return new KernelEnvironment(
      KERNEL_ENVIRONMENT_TOKEN,
      snapshot,
      undefined,
    );
  }
  static from_definitions(
    definitions: readonly KernelDefinition[],
  ): KernelEnvironment {
    const stable_definitions = snapshot_definitions(definitions);
    const installed = new MAP_CONSTRUCTOR<string, StableKernelDefinition>();
    const computation: NormalizationBudget = { nodes: 0, steps: 0 };
    for (let index = 0; index < stable_definitions.length; index += 1) {
      const definition = stable_definitions[index];
      expect(
        definition !== undefined,
        `Kernel definition ${index} is missing.`,
      );
      expect(
        !REFLECT_APPLY(MAP_HAS, installed, [definition.name]),
        `Duplicate kernel definition ${definition.name}.`,
      );
      let module: string | undefined;
      if (definition.tag !== "declaration") {
        module = definition.module;
      }
      const public_environment = new KernelEnvironment(
        KERNEL_ENVIRONMENT_TOKEN,
        installed,
        undefined,
      );
      check_type_at(
        definition.type,
        [],
        public_environment,
        computation,
      );
      if (definition.tag === "declaration") {
        REFLECT_APPLY(MAP_SET, installed, [
          definition.name,
          {
            tag: "declaration",
            type: definition.type,
          },
        ]);
        continue;
      }
      expect(
        definition.total === true,
        `Kernel definition ${definition.name} is not total.`,
      );
      const body_environment = new KernelEnvironment(
        KERNEL_ENVIRONMENT_TOKEN,
        installed,
        module,
      );
      const value_type = infer_type_expression(
        definition.value,
        [],
        body_environment,
        computation,
      );
      expect(
        type_assignable_at(
          value_type,
          definition.type,
          [],
          body_environment,
          computation,
        ),
        `Kernel definition ${definition.name} has an invalid value type.`,
      );
      REFLECT_APPLY(MAP_SET, installed, [
        definition.name,
        {
          tag: definition.tag,
          module: definition.module,
          type: definition.type,
          value: definition.value,
        },
      ]);
    }
    return new KernelEnvironment(
      KERNEL_ENVIRONMENT_TOKEN,
      installed,
      undefined,
    );
  }
  declaration(name: string): KernelType | undefined {
    return REFLECT_APPLY(MAP_GET, this.#definitions, [name])?.type;
  }
  definition(name: string): KernelType | undefined {
    const definition = REFLECT_APPLY(MAP_GET, this.#definitions, [name]);
    if (definition === undefined || definition.tag === "declaration") {
      return undefined;
    }
    if (
      definition.tag === "transparent" ||
      definition.module === this.#module
    ) {
      return definition.value;
    }
    return undefined;
  }
}

OBJECT_FREEZE(KernelEnvironment.prototype);

export const prop_sort: KernelType = OBJECT_FREEZE({
  tag: "sort",
  universe: OBJECT_FREEZE({ tag: "prop" }),
});

export function type_sort(level: number): KernelType {
  expect(
    NUMBER_IS_SAFE_INTEGER(level) && level >= 0 &&
      level < NUMBER_MAX_SAFE_INTEGER,
    `Invalid universe level ${level}.`,
  );
  return OBJECT_FREEZE({
    tag: "sort",
    universe: OBJECT_FREEZE({ tag: "type", level }),
  });
}

export function universe_of_sort(universe: Universe): Universe {
  const stable_universe = snapshot_universe_input(universe);
  if (stable_universe.tag === "prop") {
    return { tag: "type", level: 0 };
  }
  return { tag: "type", level: stable_universe.level + 1 };
}

export function check_type(
  type: KernelType,
  context: KernelContext = [],
  environment: KernelEnvironment = KernelEnvironment.empty(),
): Universe {
  expect(
    REFLECT_APPLY(WEAK_SET_HAS, trusted_kernel_environments, [environment]),
    "Kernel environment is not sealed by the kernel.",
  );
  const budget: KernelSnapshotBudget = { nodes: 0 };
  const computation: NormalizationBudget = { nodes: 0, steps: 0 };
  const stable_context = snapshot_context(context, budget);
  validate_context_at(stable_context, environment, computation);
  return check_type_at(
    snapshot_type(type, 0, new WEAK_SET_CONSTRUCTOR<object>(), budget),
    stable_context,
    environment,
    computation,
  );
}

function check_type_at(
  type: KernelType,
  context: KernelContext,
  environment: KernelEnvironment,
  budget: NormalizationBudget,
): Universe {
  const inferred = infer_type_expression(type, context, environment, budget);
  const normalized = whnf_type(inferred, environment, budget);
  expect(
    normalized.tag === "sort",
    "Kernel expression does not denote a type.",
  );
  return snapshot_universe(normalized.universe);
}

function infer_type_expression(
  type: KernelType,
  context: KernelContext,
  environment: KernelEnvironment,
  budget: NormalizationBudget,
): KernelType {
  switch (type.tag) {
    case "sort":
      validate_universe(type.universe);
      return sort_for_universe(universe_of_sort(type.universe));
    case "var": {
      validate_index(type.index, "type");
      const bound = context[type.index];
      expect(
        bound !== undefined,
        `Kernel type variable ${type.index} is out of scope.`,
      );
      return shift_type(bound, type.index + 1, 0, budget);
    }
    case "constant": {
      const declaration = environment.declaration(type.name);
      expect(
        declaration !== undefined,
        `Kernel type constant ${type.name} requires a trusted environment.`,
      );
      return declaration;
    }
    case "lam":
      check_type_at(type.domain, context, environment, budget);
      return OBJECT_FREEZE({
        tag: "pi",
        domain: type.domain,
        codomain: infer_type_expression(
          type.body,
          extend_context(type.domain, context),
          environment,
          budget,
        ),
      });
    case "app": {
      const function_type = whnf_type(
        infer_type_expression(type.function, context, environment, budget),
        environment,
        budget,
      );
      expect(
        function_type.tag === "pi",
        "Kernel type application target is not a function.",
      );
      const argument_type = infer_type_expression(
        type.argument,
        context,
        environment,
        budget,
      );
      expect(
        type_assignable_at(
          argument_type,
          function_type.domain,
          context,
          environment,
          budget,
        ),
        "Kernel type application argument has an invalid type.",
      );
      return substitute_bound_variable(
        function_type.codomain,
        type.argument,
        0,
        budget,
      );
    }
    case "pi": {
      const domain_universe = check_type_at(
        type.domain,
        context,
        environment,
        budget,
      );
      const codomain_universe = check_type_at(
        type.codomain,
        extend_context(type.domain, context),
        environment,
        budget,
      );
      return sort_for_universe(
        max_universe(domain_universe, codomain_universe),
      );
    }
    default:
      throw new Error("Invalid kernel type tag.");
  }
}

export function infer_term(
  term: KernelTerm,
  context: KernelContext = [],
  environment: KernelEnvironment = KernelEnvironment.empty(),
): KernelType {
  expect(
    REFLECT_APPLY(WEAK_SET_HAS, trusted_kernel_environments, [environment]),
    "Kernel environment is not sealed by the kernel.",
  );
  const budget: KernelSnapshotBudget = { nodes: 0 };
  const computation: NormalizationBudget = { nodes: 0, steps: 0 };
  const stable_term = snapshot_term(
    term,
    0,
    new WEAK_SET_CONSTRUCTOR<object>(),
    budget,
  );
  const stable_context = snapshot_context(context, budget);
  validate_context_at(stable_context, environment, computation);
  return infer_term_at(
    stable_term,
    stable_context,
    environment,
    computation,
  );
}

function infer_term_at(
  term: KernelTerm,
  context: KernelContext,
  environment: KernelEnvironment,
  budget: NormalizationBudget,
): KernelType {
  switch (term.tag) {
    case "var": {
      validate_index(term.index, "term");
      const type = context[term.index];
      expect(
        type !== undefined,
        `Kernel variable ${term.index} is out of scope.`,
      );
      return shift_type(type, term.index + 1, 0, budget);
    }
    case "constant": {
      const declared = environment.declaration(term.name);
      expect(
        declared !== undefined,
        `Kernel constant ${term.name} requires a trusted environment.`,
      );
      check_type_at(term.type, context, environment, budget);
      expect(
        type_equal_at(term.type, declared, environment, budget),
        `Kernel constant ${term.name} has an invalid declared type.`,
      );
      return declared;
    }
    case "lam":
      check_type_at(term.domain, context, environment, budget);
      return OBJECT_FREEZE({
        tag: "pi",
        domain: term.domain,
        codomain: infer_term_at(
          term.body,
          extend_context(term.domain, context),
          environment,
          budget,
        ),
      });
    case "app": {
      const function_type = whnf_type(
        infer_term_at(term.function, context, environment, budget),
        environment,
        budget,
      );
      expect(
        function_type.tag === "pi",
        "Kernel application target is not a function.",
      );
      const argument_type = infer_term_at(
        term.argument,
        context,
        environment,
        budget,
      );
      expect(
        type_assignable_at(
          argument_type,
          function_type.domain,
          context,
          environment,
          budget,
        ),
        "Kernel application argument has an invalid type.",
      );
      return substitute_bound_variable(
        function_type.codomain,
        term_as_type_expression(term.argument, budget),
        0,
        budget,
      );
    }
    default:
      throw new Error("Invalid kernel term tag.");
  }
}

export function snapshot_kernel_type(type: KernelType): KernelType {
  return snapshot_type(
    type,
    0,
    new WEAK_SET_CONSTRUCTOR<object>(),
    { nodes: 0 },
  );
}

export function snapshot_kernel_term(term: KernelTerm): KernelTerm {
  return snapshot_term(
    term,
    0,
    new WEAK_SET_CONSTRUCTOR<object>(),
    { nodes: 0 },
  );
}

export function snapshot_kernel_context(
  context: KernelContext,
): KernelContext {
  return snapshot_context(context);
}

export function check_term(
  term: KernelTerm,
  expected: KernelType,
  context: KernelContext = [],
  environment: KernelEnvironment = KernelEnvironment.empty(),
): void {
  expect(
    REFLECT_APPLY(WEAK_SET_HAS, trusted_kernel_environments, [environment]),
    "Kernel environment is not sealed by the kernel.",
  );
  const budget: KernelSnapshotBudget = { nodes: 0 };
  const computation: NormalizationBudget = { nodes: 0, steps: 0 };
  const stable_context = snapshot_context(context, budget);
  const stable_expected = snapshot_type(
    expected,
    0,
    new WEAK_SET_CONSTRUCTOR<object>(),
    budget,
  );
  validate_context_at(stable_context, environment, computation);
  check_type_at(
    stable_expected,
    stable_context,
    environment,
    computation,
  );
  const actual = infer_term_at(
    snapshot_term(term, 0, new WEAK_SET_CONSTRUCTOR<object>(), budget),
    stable_context,
    environment,
    computation,
  );
  expect(
    type_assignable_at(
      actual,
      stable_expected,
      stable_context,
      environment,
      computation,
    ),
    "Kernel term does not have the expected type.",
  );
}

export function term_equal(
  left: KernelTerm,
  right: KernelTerm,
  context: KernelContext = [],
  environment: KernelEnvironment = KernelEnvironment.empty(),
): boolean {
  expect(
    REFLECT_APPLY(WEAK_SET_HAS, trusted_kernel_environments, [environment]),
    "Kernel environment is not sealed by the kernel.",
  );
  const snapshot_budget: KernelSnapshotBudget = { nodes: 0 };
  const computation: NormalizationBudget = { nodes: 0, steps: 0 };
  const stable_context = snapshot_context(context, snapshot_budget);
  const stable_left = snapshot_term(
    left,
    0,
    new WEAK_SET_CONSTRUCTOR<object>(),
    snapshot_budget,
  );
  const stable_right = snapshot_term(
    right,
    0,
    new WEAK_SET_CONSTRUCTOR<object>(),
    snapshot_budget,
  );
  validate_context_at(stable_context, environment, computation);
  const left_type = infer_term_at(
    stable_left,
    stable_context,
    environment,
    computation,
  );
  const right_type = infer_term_at(
    stable_right,
    stable_context,
    environment,
    computation,
  );
  if (!type_equal_at(left_type, right_type, environment, computation)) {
    return false;
  }
  return type_equal_at(
    term_as_type_expression(stable_left, computation),
    term_as_type_expression(stable_right, computation),
    environment,
    computation,
  );
}

export function kernel_context_equal(
  left: KernelContext,
  right: KernelContext,
  environment: KernelEnvironment = KernelEnvironment.empty(),
): boolean {
  expect(
    REFLECT_APPLY(WEAK_SET_HAS, trusted_kernel_environments, [environment]),
    "Kernel environment is not sealed by the kernel.",
  );
  const snapshot_budget: KernelSnapshotBudget = { nodes: 0 };
  const computation: NormalizationBudget = { nodes: 0, steps: 0 };
  const stable_left = snapshot_context(left, snapshot_budget);
  const stable_right = snapshot_context(right, snapshot_budget);
  validate_context_at(stable_left, environment, computation);
  validate_context_at(stable_right, environment, computation);
  if (stable_left.length !== stable_right.length) return false;
  for (let index = 0; index < stable_left.length; index += 1) {
    const left_type = stable_left[index];
    const right_type = stable_right[index];
    expect(
      left_type !== undefined && right_type !== undefined,
      `Kernel context entry ${index} is missing.`,
    );
    if (!type_equal_at(left_type, right_type, environment, computation)) {
      return false;
    }
  }
  return true;
}

export function type_equal(
  left: KernelType,
  right: KernelType,
  environment: KernelEnvironment = KernelEnvironment.empty(),
): boolean {
  expect(
    REFLECT_APPLY(WEAK_SET_HAS, trusted_kernel_environments, [environment]),
    "Kernel environment is not sealed by the kernel.",
  );
  const budget: KernelSnapshotBudget = { nodes: 0 };
  return type_equal_at(
    snapshot_type(left, 0, new WEAK_SET_CONSTRUCTOR<object>(), budget),
    snapshot_type(right, 0, new WEAK_SET_CONSTRUCTOR<object>(), budget),
    environment,
  );
}

function type_equal_at(
  left: KernelType,
  right: KernelType,
  environment: KernelEnvironment,
  budget: NormalizationBudget = { nodes: 0, steps: 0 },
): boolean {
  return type_equal_with_budget(left, right, environment, budget);
}

function type_equal_with_budget(
  left: KernelType,
  right: KernelType,
  environment: KernelEnvironment,
  budget: NormalizationBudget,
  depth = 0,
): boolean {
  expect(depth <= MAX_KERNEL_DEPTH, "Kernel conversion is too deep.");
  budget.nodes += 1;
  expect(
    budget.nodes <= MAX_NORMALIZATION_NODES,
    `Kernel normalization exceeded ${MAX_NORMALIZATION_NODES} nodes.`,
  );
  const normalized_left = whnf_type(left, environment, budget);
  const normalized_right = whnf_type(right, environment, budget);
  if (normalized_left.tag !== normalized_right.tag) return false;
  switch (normalized_left.tag) {
    case "sort":
      return universe_equal(
        normalized_left.universe,
        (normalized_right as Extract<KernelType, { tag: "sort" }>).universe,
      );
    case "var":
      return normalized_left.index ===
        (normalized_right as Extract<KernelType, { tag: "var" }>).index;
    case "constant":
      return normalized_left.name ===
        (normalized_right as Extract<KernelType, { tag: "constant" }>).name;
    case "pi": {
      const other = normalized_right as Extract<KernelType, { tag: "pi" }>;
      return type_equal_with_budget(
        normalized_left.domain,
        other.domain,
        environment,
        budget,
        depth + 1,
      ) &&
        type_equal_with_budget(
          normalized_left.codomain,
          other.codomain,
          environment,
          budget,
          depth + 1,
        );
    }
    case "lam": {
      const other = normalized_right as Extract<KernelType, { tag: "lam" }>;
      return type_equal_with_budget(
        normalized_left.domain,
        other.domain,
        environment,
        budget,
        depth + 1,
      ) &&
        type_equal_with_budget(
          normalized_left.body,
          other.body,
          environment,
          budget,
          depth + 1,
        );
    }
    case "app": {
      const other = normalized_right as Extract<KernelType, { tag: "app" }>;
      return type_equal_with_budget(
        normalized_left.function,
        other.function,
        environment,
        budget,
        depth + 1,
      ) &&
        type_equal_with_budget(
          normalized_left.argument,
          other.argument,
          environment,
          budget,
          depth + 1,
        );
    }
  }
}

export function type_assignable(
  actual: KernelType,
  expected: KernelType,
  context: KernelContext = [],
  environment: KernelEnvironment = KernelEnvironment.empty(),
): boolean {
  expect(
    REFLECT_APPLY(WEAK_SET_HAS, trusted_kernel_environments, [environment]),
    "Kernel environment is not sealed by the kernel.",
  );
  const budget: KernelSnapshotBudget = { nodes: 0 };
  const computation: NormalizationBudget = { nodes: 0, steps: 0 };
  const stable_context = snapshot_context(context, budget);
  validate_context_at(stable_context, environment, computation);
  return type_assignable_at(
    snapshot_type(actual, 0, new WEAK_SET_CONSTRUCTOR<object>(), budget),
    snapshot_type(expected, 0, new WEAK_SET_CONSTRUCTOR<object>(), budget),
    stable_context,
    environment,
    computation,
  );
}

function type_assignable_at(
  actual: KernelType,
  expected: KernelType,
  context: KernelContext,
  environment: KernelEnvironment,
  budget: NormalizationBudget,
): boolean {
  check_type_at(actual, context, environment, budget);
  check_type_at(expected, context, environment, budget);
  if (type_equal_at(actual, expected, environment, budget)) return true;
  const normalized_actual = whnf_type(actual, environment, budget);
  const normalized_expected = whnf_type(expected, environment, budget);
  if (
    normalized_actual.tag !== "sort" || normalized_expected.tag !== "sort"
  ) {
    return false;
  }
  if (
    normalized_actual.universe.tag !== "type" ||
    normalized_expected.universe.tag !== "type"
  ) {
    return false;
  }
  return normalized_actual.universe.level <=
    normalized_expected.universe.level;
}

function validate_universe(universe: Universe): void {
  if (universe.tag === "prop") return;
  expect(
    universe.tag === "type",
    `Invalid universe tag ${
      STRING_CONSTRUCTOR((universe as { tag?: unknown }).tag)
    }.`,
  );
  expect(
    NUMBER_IS_SAFE_INTEGER(universe.level) && universe.level >= 0 &&
      universe.level < NUMBER_MAX_SAFE_INTEGER,
    `Invalid universe level ${universe.level}.`,
  );
}

function validate_index(index: number, kind: string): void {
  expect(
    NUMBER_IS_SAFE_INTEGER(index) && index >= 0,
    `Invalid ${kind} de Bruijn index ${STRING_CONSTRUCTOR(index)}.`,
  );
}

function validate_context_at(
  context: KernelContext,
  environment: KernelEnvironment,
  budget: NormalizationBudget,
): void {
  for (let index = 0; index < context.length; index += 1) {
    const type = context[index];
    expect(type !== undefined, `Kernel context entry ${index} is missing.`);
    const suffix_length = context.length - index - 1;
    budget.nodes += suffix_length;
    expect(
      budget.nodes <= MAX_NORMALIZATION_NODES,
      `Kernel normalization exceeded ${MAX_NORMALIZATION_NODES} nodes.`,
    );
    const suffix: KernelType[] = [];
    for (
      let suffix_index = index + 1;
      suffix_index < context.length;
      suffix_index += 1
    ) {
      const suffix_type = context[suffix_index];
      expect(
        suffix_type !== undefined,
        `Kernel context entry ${suffix_index} is missing.`,
      );
      OBJECT_DEFINE_PROPERTY(
        suffix,
        suffix_index - index - 1,
        {
          value: suffix_type,
          writable: true,
          enumerable: true,
          configurable: true,
        },
      );
    }
    check_type_at(
      type,
      OBJECT_FREEZE(suffix),
      environment,
      budget,
    );
  }
}

function extend_context(
  type: KernelType,
  context: KernelContext,
): KernelContext {
  const extended: KernelType[] = [type];
  for (let index = 0; index < context.length; index += 1) {
    const entry = context[index];
    expect(entry !== undefined, `Kernel context entry ${index} is missing.`);
    OBJECT_DEFINE_PROPERTY(extended, index + 1, {
      value: entry,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  return OBJECT_FREEZE(extended);
}

function whnf_type(
  type: KernelType,
  environment: KernelEnvironment,
  budget: NormalizationBudget = { nodes: 0, steps: 0 },
  depth = 0,
): KernelType {
  expect(depth <= MAX_KERNEL_DEPTH, "Kernel normalization is too deep.");
  let current = type;
  while (current.tag === "constant" || current.tag === "app") {
    if (current.tag === "constant") {
      const definition = environment.definition(current.name);
      if (definition === undefined) return current;
      budget.steps += 1;
      expect(
        budget.steps <= MAX_NORMALIZATION_STEPS,
        `Kernel normalization exceeded ${MAX_NORMALIZATION_STEPS} steps.`,
      );
      current = definition;
      continue;
    }
    const function_type = whnf_type(
      current.function,
      environment,
      budget,
      depth + 1,
    );
    if (function_type.tag !== "lam") {
      if (function_type === current.function) return current;
      return {
        tag: "app",
        function: function_type,
        argument: current.argument,
      };
    }
    budget.steps += 1;
    expect(
      budget.steps <= MAX_NORMALIZATION_STEPS,
      `Kernel normalization exceeded ${MAX_NORMALIZATION_STEPS} steps.`,
    );
    current = substitute_bound_variable(
      function_type.body,
      current.argument,
      0,
      budget,
    );
  }
  return current;
}

function universe_equal(left: Universe, right: Universe): boolean {
  if (left.tag !== right.tag) return false;
  if (left.tag === "prop") return true;
  return left.level === (right as Extract<Universe, { tag: "type" }>).level;
}

function max_universe(left: Universe, right: Universe): Universe {
  if (left.tag === "prop") return right;
  if (right.tag === "prop") return left;
  if (left.level >= right.level) return left;
  return right;
}

function sort_for_universe(universe: Universe): KernelType {
  if (universe.tag === "prop") return prop_sort;
  return type_sort(universe.level);
}

function snapshot_universe(universe: Universe): Universe {
  if (universe.tag === "prop") return { tag: "prop" };
  return { tag: "type", level: universe.level };
}

function snapshot_type(
  type: KernelType,
  depth = 0,
  active = new WEAK_SET_CONSTRUCTOR<object>(),
  budget: KernelSnapshotBudget = { nodes: 0 },
): KernelType {
  expect(depth <= MAX_KERNEL_DEPTH, "Kernel type is too deep.");
  budget.nodes += 1;
  expect(
    budget.nodes <= MAX_KERNEL_NODES,
    `Kernel snapshot exceeded ${MAX_KERNEL_NODES} nodes.`,
  );
  expect(
    type !== null && typeof type === "object",
    "Invalid kernel type.",
  );
  if (REFLECT_APPLY(WEAK_SET_HAS, active, [type])) {
    throw new Error("Kernel type graph must be acyclic.");
  }
  REFLECT_APPLY(WEAK_SET_ADD, active, [type]);
  const properties = own_data_properties(type, "Kernel type", "record");
  const tag = required_property<string>(properties, "tag", "Kernel type");
  let snapshot: KernelType;
  switch (tag) {
    case "sort": {
      const universe = snapshot_universe_input(
        required_property(properties, "universe", "Kernel sort"),
      );
      if (universe.tag === "prop") {
        snapshot = prop_sort;
      } else {
        snapshot = type_sort(universe.level);
      }
      break;
    }
    case "var": {
      const index = required_property<number>(
        properties,
        "index",
        "Kernel variable",
      );
      validate_index(index, "type");
      snapshot = OBJECT_FREEZE({ tag: "var", index });
      break;
    }
    case "constant": {
      const name = required_property<string>(
        properties,
        "name",
        "Kernel constant",
      );
      expect(
        typeof name === "string" && name.length > 0,
        "Kernel constant name must not be empty.",
      );
      snapshot = OBJECT_FREEZE({ tag: "constant", name });
      break;
    }
    case "pi":
      snapshot = OBJECT_FREEZE({
        tag: "pi",
        domain: snapshot_type(
          required_property(properties, "domain", "Kernel pi"),
          depth + 1,
          active,
          budget,
        ),
        codomain: snapshot_type(
          required_property(properties, "codomain", "Kernel pi"),
          depth + 1,
          active,
          budget,
        ),
      });
      break;
    case "lam":
      snapshot = OBJECT_FREEZE({
        tag: "lam",
        domain: snapshot_type(
          required_property(properties, "domain", "Kernel lambda"),
          depth + 1,
          active,
          budget,
        ),
        body: snapshot_type(
          required_property(properties, "body", "Kernel lambda"),
          depth + 1,
          active,
          budget,
        ),
      });
      break;
    case "app":
      snapshot = OBJECT_FREEZE({
        tag: "app",
        function: snapshot_type(
          required_property(properties, "function", "Kernel application"),
          depth + 1,
          active,
          budget,
        ),
        argument: snapshot_type(
          required_property(properties, "argument", "Kernel application"),
          depth + 1,
          active,
          budget,
        ),
      });
      break;
    default:
      throw new Error(`Invalid kernel type tag ${STRING_CONSTRUCTOR(tag)}.`);
  }
  REFLECT_APPLY(WEAK_SET_DELETE, active, [type]);
  return snapshot;
}

function snapshot_term(
  term: KernelTerm,
  depth = 0,
  active = new WEAK_SET_CONSTRUCTOR<object>(),
  budget: KernelSnapshotBudget = { nodes: 0 },
): KernelTerm {
  expect(depth <= MAX_KERNEL_DEPTH, "Kernel term is too deep.");
  budget.nodes += 1;
  expect(
    budget.nodes <= MAX_KERNEL_NODES,
    `Kernel snapshot exceeded ${MAX_KERNEL_NODES} nodes.`,
  );
  expect(
    term !== null && typeof term === "object",
    "Invalid kernel term.",
  );
  if (REFLECT_APPLY(WEAK_SET_HAS, active, [term])) {
    throw new Error("Kernel term graph must be acyclic.");
  }
  REFLECT_APPLY(WEAK_SET_ADD, active, [term]);
  const properties = own_data_properties(term, "Kernel term", "record");
  const tag = required_property<string>(properties, "tag", "Kernel term");
  let snapshot: KernelTerm;
  switch (tag) {
    case "var": {
      const index = required_property<number>(
        properties,
        "index",
        "Kernel term variable",
      );
      validate_index(index, "term");
      snapshot = OBJECT_FREEZE({ tag: "var", index });
      break;
    }
    case "constant": {
      const name = required_property<string>(
        properties,
        "name",
        "Kernel term constant",
      );
      expect(
        typeof name === "string" && name.length > 0,
        "Kernel term constant name must not be empty.",
      );
      snapshot = OBJECT_FREEZE({
        tag: "constant",
        name,
        type: snapshot_type(
          required_property(properties, "type", "Kernel term constant"),
          depth + 1,
          new WEAK_SET_CONSTRUCTOR<object>(),
          budget,
        ),
      });
      break;
    }
    case "lam":
      snapshot = OBJECT_FREEZE({
        tag: "lam",
        domain: snapshot_type(
          required_property(properties, "domain", "Kernel term lambda"),
          depth + 1,
          new WEAK_SET_CONSTRUCTOR<object>(),
          budget,
        ),
        body: snapshot_term(
          required_property(properties, "body", "Kernel term lambda"),
          depth + 1,
          active,
          budget,
        ),
      });
      break;
    case "app":
      snapshot = OBJECT_FREEZE({
        tag: "app",
        function: snapshot_term(
          required_property(properties, "function", "Kernel term application"),
          depth + 1,
          active,
          budget,
        ),
        argument: snapshot_term(
          required_property(properties, "argument", "Kernel term application"),
          depth + 1,
          active,
          budget,
        ),
      });
      break;
    default:
      throw new Error(`Invalid kernel term tag ${STRING_CONSTRUCTOR(tag)}.`);
  }
  REFLECT_APPLY(WEAK_SET_DELETE, active, [term]);
  return snapshot;
}

function snapshot_definitions(
  definitions: readonly KernelDefinition[],
): readonly KernelDefinition[] {
  expect(ARRAY_IS_ARRAY(definitions), "Kernel definitions must be an array.");
  expect(
    OBJECT_GET_PROTOTYPE_OF(definitions) === ARRAY_PROTOTYPE,
    "Kernel definitions must be an ordinary array.",
  );
  const properties = own_data_properties(
    definitions,
    "Kernel definitions",
    "array",
  );
  const length = required_property<number>(
    properties,
    "length",
    "Kernel definitions",
  );
  expect(
    NUMBER_IS_SAFE_INTEGER(length) && length >= 0,
    "Kernel definitions length is invalid.",
  );
  const snapshot: KernelDefinition[] = [];
  const budget: KernelSnapshotBudget = { nodes: 0 };
  for (let index = 0; index < length; index += 1) {
    OBJECT_DEFINE_PROPERTY(
      snapshot,
      index,
      {
        value: snapshot_definition(
          required_property(
            properties,
            STRING_CONSTRUCTOR(index),
            "Kernel definitions",
          ),
          budget,
        ),
        writable: true,
        enumerable: true,
        configurable: true,
      },
    );
  }
  REFLECT_APPLY(MAP_FOR_EACH, properties, [(_value: unknown, key: string) => {
    if (key === "length") return;
    const index = NUMBER_CONSTRUCTOR(key);
    expect(
      NUMBER_IS_SAFE_INTEGER(index) && index >= 0 &&
        index < length && STRING_CONSTRUCTOR(index) === key,
      `Kernel definitions contains invalid property ${key}.`,
    );
  }]);
  return OBJECT_FREEZE(snapshot);
}

function snapshot_definition(
  definition: KernelDefinition,
  budget: KernelSnapshotBudget,
): KernelDefinition {
  expect(
    definition !== null && typeof definition === "object",
    "Invalid kernel definition.",
  );
  const properties = own_data_properties(
    definition,
    "Kernel definition",
    "record",
  );
  const tag = required_property<string>(
    properties,
    "tag",
    "Kernel definition",
  );
  const name = required_property<string>(
    properties,
    "name",
    "Kernel definition",
  );
  expect(
    typeof name === "string" && name.length > 0,
    "Kernel definition name must not be empty.",
  );
  const type = snapshot_type(
    required_property(properties, "type", "Kernel definition"),
    0,
    new WEAK_SET_CONSTRUCTOR<object>(),
    budget,
  );
  if (tag === "declaration") {
    return OBJECT_FREEZE({ tag: "declaration", name, type });
  }
  expect(
    tag === "transparent" || tag === "opaque",
    `Invalid kernel definition tag ${STRING_CONSTRUCTOR(tag)}.`,
  );
  const module = required_property<string>(
    properties,
    "module",
    "Kernel definition",
  );
  expect(
    typeof module === "string" && module.length > 0,
    `Kernel definition ${name} module must not be empty.`,
  );
  const total = required_property<boolean>(
    properties,
    "total",
    "Kernel definition",
  );
  expect(
    typeof total === "boolean",
    `Kernel definition ${name} totality must be boolean.`,
  );
  return OBJECT_FREEZE({
    tag,
    name,
    module,
    type,
    value: snapshot_type(
      required_property(properties, "value", "Kernel definition"),
      0,
      new WEAK_SET_CONSTRUCTOR<object>(),
      budget,
    ),
    total,
  });
}

function snapshot_context(
  context: KernelContext,
  budget: KernelSnapshotBudget = { nodes: 0 },
): KernelContext {
  expect(ARRAY_IS_ARRAY(context), "Kernel context must be an array.");
  expect(
    OBJECT_GET_PROTOTYPE_OF(context) === ARRAY_PROTOTYPE,
    "Kernel context must be an ordinary array.",
  );
  const properties = own_data_properties(context, "Kernel context", "array");
  const length = required_property<number>(
    properties,
    "length",
    "Kernel context",
  );
  expect(
    NUMBER_IS_SAFE_INTEGER(length) && length >= 0,
    "Kernel context length is invalid.",
  );
  const snapshot: KernelType[] = [];
  for (let index = 0; index < length; index += 1) {
    OBJECT_DEFINE_PROPERTY(
      snapshot,
      index,
      {
        value: snapshot_type(
          required_property(
            properties,
            STRING_CONSTRUCTOR(index),
            "Kernel context",
          ),
          0,
          new WEAK_SET_CONSTRUCTOR<object>(),
          budget,
        ),
        writable: true,
        enumerable: true,
        configurable: true,
      },
    );
  }
  REFLECT_APPLY(MAP_FOR_EACH, properties, [(_value: unknown, key: string) => {
    if (key === "length") return;
    const index = NUMBER_CONSTRUCTOR(key);
    expect(
      NUMBER_IS_SAFE_INTEGER(index) && index >= 0 &&
        index < length && STRING_CONSTRUCTOR(index) === key,
      `Kernel context contains invalid property ${key}.`,
    );
  }]);
  return OBJECT_FREEZE(snapshot);
}

function snapshot_universe_input(value: unknown): Universe {
  expect(
    value !== null && typeof value === "object",
    "Invalid kernel universe.",
  );
  const properties = own_data_properties(value, "Kernel universe", "record");
  const tag = required_property<string>(properties, "tag", "Kernel universe");
  if (tag === "prop") return OBJECT_FREEZE({ tag: "prop" });
  expect(
    tag === "type",
    `Invalid universe tag ${STRING_CONSTRUCTOR(tag)}.`,
  );
  const level = required_property<number>(
    properties,
    "level",
    "Kernel universe",
  );
  expect(
    NUMBER_IS_SAFE_INTEGER(level) && level >= 0 &&
      level < NUMBER_MAX_SAFE_INTEGER,
    `Invalid universe level ${STRING_CONSTRUCTOR(level)}.`,
  );
  return OBJECT_FREEZE({ tag: "type", level });
}

function own_data_properties(
  value: object,
  label: string,
  kind: "record" | "array",
): ReadonlyMap<string, unknown> {
  const prototype = OBJECT_GET_PROTOTYPE_OF(value);
  if (kind === "array") {
    expect(
      prototype === ARRAY_PROTOTYPE,
      `${label} must be an ordinary array.`,
    );
  } else {
    expect(
      prototype === OBJECT_PROTOTYPE || prototype === null,
      `${label} must be a plain record.`,
    );
  }
  const properties = new MAP_CONSTRUCTOR<string, unknown>();
  const keys = REFLECT_OWN_KEYS(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    expect(key !== undefined, `${label} property ${index} is missing.`);
    expect(typeof key === "string", `${label} cannot contain symbols.`);
    const descriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(value, key);
    expect(
      descriptor !== undefined &&
        descriptor.get === undefined &&
        descriptor.set === undefined,
      `${label} properties must be own data properties.`,
    );
    REFLECT_APPLY(MAP_SET, properties, [key, descriptor.value]);
  }
  return properties;
}

function required_property<Value>(
  properties: ReadonlyMap<string, unknown>,
  key: string,
  label: string,
): Value {
  expect(
    REFLECT_APPLY(MAP_HAS, properties, [key]),
    `${label} is missing ${key}.`,
  );
  return REFLECT_APPLY(MAP_GET, properties, [key]) as Value;
}

function term_as_type_expression(
  term: KernelTerm,
  budget: NormalizationBudget,
): KernelType {
  budget.nodes += 1;
  expect(
    budget.nodes <= MAX_NORMALIZATION_NODES,
    `Kernel normalization exceeded ${MAX_NORMALIZATION_NODES} nodes.`,
  );
  switch (term.tag) {
    case "var":
      return OBJECT_FREEZE({ tag: "var", index: term.index });
    case "constant":
      return OBJECT_FREEZE({ tag: "constant", name: term.name });
    case "lam":
      return OBJECT_FREEZE({
        tag: "lam",
        domain: term.domain,
        body: term_as_type_expression(term.body, budget),
      });
    case "app":
      return OBJECT_FREEZE({
        tag: "app",
        function: term_as_type_expression(term.function, budget),
        argument: term_as_type_expression(term.argument, budget),
      });
    default:
      throw new Error("Invalid kernel term tag.");
  }
}

function shift_type(
  type: KernelType,
  amount: number,
  cutoff = 0,
  budget: NormalizationBudget = { nodes: 0, steps: 0 },
): KernelType {
  if (amount === 0) return type;
  budget.nodes += 1;
  expect(
    budget.nodes <= MAX_NORMALIZATION_NODES,
    `Kernel normalization exceeded ${MAX_NORMALIZATION_NODES} nodes.`,
  );
  switch (type.tag) {
    case "sort":
    case "constant":
      return type;
    case "var": {
      if (type.index < cutoff) return type;
      const index = type.index + amount;
      expect(
        NUMBER_IS_SAFE_INTEGER(index) && index >= 0,
        "Kernel type shift produced an invalid index.",
      );
      return OBJECT_FREEZE({ tag: "var", index });
    }
    case "pi":
      return OBJECT_FREEZE({
        tag: "pi",
        domain: shift_type(type.domain, amount, cutoff, budget),
        codomain: shift_type(type.codomain, amount, cutoff + 1, budget),
      });
    case "lam":
      return OBJECT_FREEZE({
        tag: "lam",
        domain: shift_type(type.domain, amount, cutoff, budget),
        body: shift_type(type.body, amount, cutoff + 1, budget),
      });
    case "app":
      return OBJECT_FREEZE({
        tag: "app",
        function: shift_type(type.function, amount, cutoff, budget),
        argument: shift_type(type.argument, amount, cutoff, budget),
      });
    default:
      throw new Error("Invalid kernel type tag.");
  }
}

function substitute_bound_variable(
  type: KernelType,
  replacement: KernelType,
  depth = 0,
  budget: NormalizationBudget = { nodes: 0, steps: 0 },
): KernelType {
  budget.nodes += 1;
  expect(
    budget.nodes <= MAX_NORMALIZATION_NODES,
    `Kernel normalization exceeded ${MAX_NORMALIZATION_NODES} nodes.`,
  );
  switch (type.tag) {
    case "sort":
    case "constant":
      return type;
    case "var": {
      if (type.index === depth) {
        return shift_type(replacement, depth, 0, budget);
      }
      if (type.index < depth) return type;
      return OBJECT_FREEZE({ tag: "var", index: type.index - 1 });
    }
    case "pi":
      return OBJECT_FREEZE({
        tag: "pi",
        domain: substitute_bound_variable(
          type.domain,
          replacement,
          depth,
          budget,
        ),
        codomain: substitute_bound_variable(
          type.codomain,
          replacement,
          depth + 1,
          budget,
        ),
      });
    case "lam":
      return OBJECT_FREEZE({
        tag: "lam",
        domain: substitute_bound_variable(
          type.domain,
          replacement,
          depth,
          budget,
        ),
        body: substitute_bound_variable(
          type.body,
          replacement,
          depth + 1,
          budget,
        ),
      });
    case "app":
      return OBJECT_FREEZE({
        tag: "app",
        function: substitute_bound_variable(
          type.function,
          replacement,
          depth,
          budget,
        ),
        argument: substitute_bound_variable(
          type.argument,
          replacement,
          depth,
          budget,
        ),
      });
    default:
      throw new Error("Invalid kernel type tag.");
  }
}
