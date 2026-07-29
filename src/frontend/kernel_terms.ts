import { expect } from "../expect.ts";

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

const MAX_KERNEL_DEPTH = 256;
const MAX_NORMALIZATION_STEPS = 10_000;

type NormalizationBudget = {
  steps: number;
};

export class KernelEnvironment {
  readonly #declarations: ReadonlyMap<string, KernelType>;
  private constructor(declarations: ReadonlyMap<string, KernelType>) {
    this.#declarations = declarations;
  }
  static empty(): KernelEnvironment {
    return new KernelEnvironment(new Map());
  }
  static from(
    declarations: ReadonlyMap<string, KernelType>,
  ): KernelEnvironment {
    expect(
      declarations instanceof Map &&
        Object.getPrototypeOf(declarations) === Map.prototype,
      "Kernel declarations must be an ordinary Map.",
    );
    const entries = [...Map.prototype.entries.call(declarations)] as [
      string,
      KernelType,
    ][];
    const snapshot = new Map<string, KernelType>();
    for (const [name, declaration] of entries) {
      expect(
        typeof name === "string" && name.length > 0,
        "Kernel declaration name must not be empty.",
      );
      const stable_declaration = snapshot_type(declaration);
      const environment = new KernelEnvironment(snapshot);
      check_type_at(stable_declaration, [], environment);
      snapshot.set(name, stable_declaration);
    }
    return new KernelEnvironment(snapshot);
  }
  declaration(name: string): KernelType | undefined {
    return this.#declarations.get(name);
  }
}

export const prop_sort: KernelType = Object.freeze({
  tag: "sort",
  universe: Object.freeze({ tag: "prop" }),
});

export function type_sort(level: number): KernelType {
  expect(
    Number.isSafeInteger(level) && level >= 0 &&
      level < Number.MAX_SAFE_INTEGER,
    `Invalid universe level ${level}.`,
  );
  return Object.freeze({
    tag: "sort",
    universe: Object.freeze({ tag: "type", level }),
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
  const stable_context = snapshot_context(context);
  validate_context_at(stable_context, environment);
  return check_type_at(snapshot_type(type), stable_context, environment);
}

function check_type_at(
  type: KernelType,
  context: KernelContext,
  environment: KernelEnvironment,
): Universe {
  const inferred = infer_type_expression(type, context, environment);
  const normalized = whnf_type(inferred);
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
      return shift_type(bound, type.index + 1);
    }
    case "constant": {
      const declaration = environment.declaration(type.name);
      expect(
        declaration !== undefined,
        `Kernel type constant ${type.name} requires a trusted environment.`,
      );
      return snapshot_type(declaration);
    }
    case "lam":
      check_type_at(type.domain, context, environment);
      return snapshot_type({
        tag: "pi",
        domain: type.domain,
        codomain: infer_type_expression(
          type.body,
          [type.domain, ...context],
          environment,
        ),
      });
    case "app": {
      const function_type = whnf_type(
        infer_type_expression(type.function, context, environment),
      );
      expect(
        function_type.tag === "pi",
        "Kernel type application target is not a function.",
      );
      const argument_type = infer_type_expression(
        type.argument,
        context,
        environment,
      );
      expect(
        type_assignable_at(
          argument_type,
          function_type.domain,
          context,
          environment,
        ),
        "Kernel type application argument has an invalid type.",
      );
      return substitute_bound_variable(
        function_type.codomain,
        type.argument,
      );
    }
    case "pi": {
      const domain_universe = check_type_at(type.domain, context, environment);
      const codomain_universe = check_type_at(type.codomain, [
        type.domain,
        ...context,
      ], environment);
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
  return infer_term_at(
    snapshot_term(term),
    snapshot_context(context),
    environment,
  );
}

function infer_term_at(
  term: KernelTerm,
  context: KernelContext,
  environment: KernelEnvironment,
): KernelType {
  validate_context_at(context, environment);
  switch (term.tag) {
    case "var": {
      validate_index(term.index, "term");
      const type = context[term.index];
      expect(
        type !== undefined,
        `Kernel variable ${term.index} is out of scope.`,
      );
      return snapshot_type(shift_type(type, term.index + 1));
    }
    case "constant": {
      const declared = environment.declaration(term.name);
      expect(
        declared !== undefined,
        `Kernel constant ${term.name} requires a trusted environment.`,
      );
      check_type_at(term.type, context, environment);
      expect(
        type_equal_at(term.type, declared),
        `Kernel constant ${term.name} has an invalid declared type.`,
      );
      return snapshot_type(declared);
    }
    case "lam":
      check_type_at(term.domain, context, environment);
      return snapshot_type({
        tag: "pi",
        domain: term.domain,
        codomain: infer_term_at(
          term.body,
          [term.domain, ...context],
          environment,
        ),
      });
    case "app": {
      const function_type = whnf_type(
        infer_term_at(term.function, context, environment),
      );
      expect(
        function_type.tag === "pi",
        "Kernel application target is not a function.",
      );
      const argument_type = infer_term_at(
        term.argument,
        context,
        environment,
      );
      expect(
        type_assignable_at(
          argument_type,
          function_type.domain,
          context,
          environment,
        ),
        "Kernel application argument has an invalid type.",
      );
      return snapshot_type(
        substitute_bound_variable(
          function_type.codomain,
          term_as_type_expression(term.argument),
        ),
      );
    }
    default:
      throw new Error("Invalid kernel term tag.");
  }
}

export function check_term(
  term: KernelTerm,
  expected: KernelType,
  context: KernelContext = [],
  environment: KernelEnvironment = KernelEnvironment.empty(),
): void {
  const stable_context = snapshot_context(context);
  const stable_expected = snapshot_type(expected);
  validate_context_at(stable_context, environment);
  check_type_at(stable_expected, stable_context, environment);
  const actual = infer_term_at(
    snapshot_term(term),
    stable_context,
    environment,
  );
  expect(
    type_assignable_at(
      actual,
      stable_expected,
      stable_context,
      environment,
    ),
    "Kernel term does not have the expected type.",
  );
}

export function type_equal(left: KernelType, right: KernelType): boolean {
  return type_equal_at(snapshot_type(left), snapshot_type(right));
}

function type_equal_at(left: KernelType, right: KernelType): boolean {
  return type_equal_with_budget(left, right, { steps: 0 });
}

function type_equal_with_budget(
  left: KernelType,
  right: KernelType,
  budget: NormalizationBudget,
): boolean {
  const normalized_left = whnf_type(left, budget);
  const normalized_right = whnf_type(right, budget);
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
        budget,
      ) &&
        type_equal_with_budget(
          normalized_left.codomain,
          other.codomain,
          budget,
        );
    }
    case "lam": {
      const other = normalized_right as Extract<KernelType, { tag: "lam" }>;
      return type_equal_with_budget(
        normalized_left.domain,
        other.domain,
        budget,
      ) &&
        type_equal_with_budget(normalized_left.body, other.body, budget);
    }
    case "app": {
      const other = normalized_right as Extract<KernelType, { tag: "app" }>;
      return type_equal_with_budget(
        normalized_left.function,
        other.function,
        budget,
      ) &&
        type_equal_with_budget(
          normalized_left.argument,
          other.argument,
          budget,
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
  const stable_context = snapshot_context(context);
  validate_context_at(stable_context, environment);
  return type_assignable_at(
    snapshot_type(actual),
    snapshot_type(expected),
    stable_context,
    environment,
  );
}

function type_assignable_at(
  actual: KernelType,
  expected: KernelType,
  context: KernelContext,
  environment: KernelEnvironment,
): boolean {
  check_type_at(actual, context, environment);
  check_type_at(expected, context, environment);
  if (type_equal_at(actual, expected)) return true;
  const normalized_actual = whnf_type(actual);
  const normalized_expected = whnf_type(expected);
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
    `Invalid universe tag ${String((universe as { tag?: unknown }).tag)}.`,
  );
  expect(
    Number.isSafeInteger(universe.level) && universe.level >= 0 &&
      universe.level < Number.MAX_SAFE_INTEGER,
    `Invalid universe level ${universe.level}.`,
  );
}

function validate_index(index: number, kind: string): void {
  expect(
    Number.isInteger(index) && index >= 0,
    `Invalid ${kind} de Bruijn index ${String(index)}.`,
  );
}

function validate_context_at(
  context: KernelContext,
  environment: KernelEnvironment,
): void {
  for (let index = 0; index < context.length; index += 1) {
    const type = context[index];
    expect(type !== undefined, `Kernel context entry ${index} is missing.`);
    check_type_at(type, context.slice(index + 1), environment);
  }
}

function whnf_type(
  type: KernelType,
  budget: NormalizationBudget = { steps: 0 },
  depth = 0,
): KernelType {
  expect(depth <= MAX_KERNEL_DEPTH, "Kernel normalization is too deep.");
  let current = type;
  while (current.tag === "app") {
    const function_type = whnf_type(
      current.function,
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
  return { tag: "type", level: Math.max(left.level, right.level) };
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
  active = new WeakSet<object>(),
): KernelType {
  expect(depth <= MAX_KERNEL_DEPTH, "Kernel type is too deep.");
  expect(
    type !== null && typeof type === "object",
    "Invalid kernel type.",
  );
  if (active.has(type)) throw new Error("Kernel type graph must be acyclic.");
  active.add(type);
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
      snapshot = Object.freeze({ tag: "var", index });
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
      snapshot = Object.freeze({ tag: "constant", name });
      break;
    }
    case "pi":
      snapshot = Object.freeze({
        tag: "pi",
        domain: snapshot_type(
          required_property(properties, "domain", "Kernel pi"),
          depth + 1,
          active,
        ),
        codomain: snapshot_type(
          required_property(properties, "codomain", "Kernel pi"),
          depth + 1,
          active,
        ),
      });
      break;
    case "lam":
      snapshot = Object.freeze({
        tag: "lam",
        domain: snapshot_type(
          required_property(properties, "domain", "Kernel lambda"),
          depth + 1,
          active,
        ),
        body: snapshot_type(
          required_property(properties, "body", "Kernel lambda"),
          depth + 1,
          active,
        ),
      });
      break;
    case "app":
      snapshot = Object.freeze({
        tag: "app",
        function: snapshot_type(
          required_property(properties, "function", "Kernel application"),
          depth + 1,
          active,
        ),
        argument: snapshot_type(
          required_property(properties, "argument", "Kernel application"),
          depth + 1,
          active,
        ),
      });
      break;
    default:
      throw new Error(`Invalid kernel type tag ${String(tag)}.`);
  }
  active.delete(type);
  return snapshot;
}

function snapshot_term(
  term: KernelTerm,
  depth = 0,
  active = new WeakSet<object>(),
): KernelTerm {
  expect(depth <= MAX_KERNEL_DEPTH, "Kernel term is too deep.");
  expect(
    term !== null && typeof term === "object",
    "Invalid kernel term.",
  );
  if (active.has(term)) throw new Error("Kernel term graph must be acyclic.");
  active.add(term);
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
      snapshot = Object.freeze({ tag: "var", index });
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
      snapshot = Object.freeze({
        tag: "constant",
        name,
        type: snapshot_type(
          required_property(properties, "type", "Kernel term constant"),
          depth + 1,
        ),
      });
      break;
    }
    case "lam":
      snapshot = Object.freeze({
        tag: "lam",
        domain: snapshot_type(
          required_property(properties, "domain", "Kernel term lambda"),
          depth + 1,
        ),
        body: snapshot_term(
          required_property(properties, "body", "Kernel term lambda"),
          depth + 1,
          active,
        ),
      });
      break;
    case "app":
      snapshot = Object.freeze({
        tag: "app",
        function: snapshot_term(
          required_property(properties, "function", "Kernel term application"),
          depth + 1,
          active,
        ),
        argument: snapshot_term(
          required_property(properties, "argument", "Kernel term application"),
          depth + 1,
          active,
        ),
      });
      break;
    default:
      throw new Error(`Invalid kernel term tag ${String(tag)}.`);
  }
  active.delete(term);
  return snapshot;
}

function snapshot_context(context: KernelContext): KernelContext {
  expect(Array.isArray(context), "Kernel context must be an array.");
  expect(
    Object.getPrototypeOf(context) === Array.prototype,
    "Kernel context must be an ordinary array.",
  );
  const properties = own_data_properties(context, "Kernel context", "array");
  const length = required_property<number>(
    properties,
    "length",
    "Kernel context",
  );
  expect(
    Number.isSafeInteger(length) && length >= 0,
    "Kernel context length is invalid.",
  );
  const snapshot: KernelType[] = [];
  for (let index = 0; index < length; index += 1) {
    snapshot.push(
      snapshot_type(
        required_property(properties, String(index), "Kernel context"),
      ),
    );
  }
  for (const key of properties.keys()) {
    if (key === "length") continue;
    const index = Number(key);
    expect(
      Number.isSafeInteger(index) && index >= 0 &&
        index < length && String(index) === key,
      `Kernel context contains invalid property ${key}.`,
    );
  }
  return Object.freeze(snapshot);
}

function snapshot_universe_input(value: unknown): Universe {
  expect(
    value !== null && typeof value === "object",
    "Invalid kernel universe.",
  );
  const properties = own_data_properties(value, "Kernel universe", "record");
  const tag = required_property<string>(properties, "tag", "Kernel universe");
  if (tag === "prop") return Object.freeze({ tag: "prop" });
  expect(tag === "type", `Invalid universe tag ${String(tag)}.`);
  const level = required_property<number>(
    properties,
    "level",
    "Kernel universe",
  );
  expect(
    Number.isSafeInteger(level) && level >= 0 &&
      level < Number.MAX_SAFE_INTEGER,
    `Invalid universe level ${String(level)}.`,
  );
  return Object.freeze({ tag: "type", level });
}

function own_data_properties(
  value: object,
  label: string,
  kind: "record" | "array",
): ReadonlyMap<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  if (kind === "array") {
    expect(
      prototype === Array.prototype,
      `${label} must be an ordinary array.`,
    );
  } else {
    expect(
      prototype === Object.prototype || prototype === null,
      `${label} must be a plain record.`,
    );
  }
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

function term_as_type_expression(term: KernelTerm): KernelType {
  switch (term.tag) {
    case "var":
      return { tag: "var", index: term.index };
    case "constant":
      return { tag: "constant", name: term.name };
    case "lam":
      return {
        tag: "lam",
        domain: term.domain,
        body: term_as_type_expression(term.body),
      };
    case "app":
      return {
        tag: "app",
        function: term_as_type_expression(term.function),
        argument: term_as_type_expression(term.argument),
      };
    default:
      throw new Error("Invalid kernel term tag.");
  }
}

function shift_type(
  type: KernelType,
  amount: number,
  cutoff = 0,
): KernelType {
  switch (type.tag) {
    case "sort":
    case "constant":
      return type;
    case "var": {
      if (type.index < cutoff) return type;
      const index = type.index + amount;
      expect(index >= 0, "Kernel type shift produced an invalid index.");
      return { tag: "var", index };
    }
    case "pi":
      return {
        tag: "pi",
        domain: shift_type(type.domain, amount, cutoff),
        codomain: shift_type(type.codomain, amount, cutoff + 1),
      };
    case "lam":
      return {
        tag: "lam",
        domain: shift_type(type.domain, amount, cutoff),
        body: shift_type(type.body, amount, cutoff + 1),
      };
    case "app":
      return {
        tag: "app",
        function: shift_type(type.function, amount, cutoff),
        argument: shift_type(type.argument, amount, cutoff),
      };
    default:
      throw new Error("Invalid kernel type tag.");
  }
}

function substitute_bound_variable(
  type: KernelType,
  replacement: KernelType,
  depth = 0,
): KernelType {
  switch (type.tag) {
    case "sort":
    case "constant":
      return type;
    case "var": {
      if (type.index === depth) {
        return shift_type(replacement, depth);
      }
      if (type.index < depth) return type;
      return { tag: "var", index: type.index - 1 };
    }
    case "pi":
      return {
        tag: "pi",
        domain: substitute_bound_variable(type.domain, replacement, depth),
        codomain: substitute_bound_variable(
          type.codomain,
          replacement,
          depth + 1,
        ),
      };
    case "lam":
      return {
        tag: "lam",
        domain: substitute_bound_variable(type.domain, replacement, depth),
        body: substitute_bound_variable(
          type.body,
          replacement,
          depth + 1,
        ),
      };
    case "app":
      return {
        tag: "app",
        function: substitute_bound_variable(
          type.function,
          replacement,
          depth,
        ),
        argument: substitute_bound_variable(
          type.argument,
          replacement,
          depth,
        ),
      };
    default:
      throw new Error("Invalid kernel type tag.");
  }
}
