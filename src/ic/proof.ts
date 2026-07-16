import type { Ic } from "./ast.ts";

export type IcStorageClass = "scalar_local" | "static_data";

export type IcStorageProof = {
  path: string;
  storage_class: IcStorageClass;
  lifetime: "call" | "module";
  escape: "local" | "module_result";
};

export type IcLifetimeProof = {
  id: "module#0" | "call#0";
  parent: "module#0" | undefined;
};

export type IcCleanupProof = {
  path: string;
  decision: "not_required";
  reason: "scalar_local" | "frozen_static_data";
};

export type IcHostBoundaryProof = {
  path: string;
  name: string;
  direction: "parameter";
  ownership: "scalar";
};

export type IcProofIssue = {
  code: "unproved_static_memory_address" | "unproved_result_storage";
  missing_edge: "unproved_static_memory_address" | "missing_storage_fact";
  path: string;
  message: string;
};

export type IcFinalResultProof = {
  storage_class: IcStorageClass | "unknown";
  escape: "module_result";
  decision: "allowed" | "rejected";
};

export type IcNotApplicableProofRow = {
  path: string;
  reason: string;
};

export type IcNoGcProof = {
  target: "core-3-nonweb";
  target_profile: "core-3-nonweb";
  managed_storage: "disabled";
  ok: boolean;
  storage_rows: IcStorageProof[];
  lifetime_rows: IcLifetimeProof[];
  borrow_view_rows: IcNotApplicableProofRow[];
  scratch_result_rows: IcNotApplicableProofRow[];
  freeze_promotion_rows: IcNotApplicableProofRow[];
  cleanup_rows: IcCleanupProof[];
  host_boundary_rows: IcHostBoundaryProof[];
  capability_method_rows: IcNotApplicableProofRow[];
  runtime_slice_rows: IcNotApplicableProofRow[];
  final_result: IcFinalResultProof;
  issues: IcProofIssue[];
};

type StaticAddress = {
  path: string;
  byte_length: number;
  offset: bigint;
};

type ValueStorage =
  | { tag: "constant_scalar"; value: bigint }
  | { tag: "runtime_scalar" }
  | { tag: "static_address"; addresses: StaticAddress[] }
  | { tag: "callable_scalar" }
  | { tag: "unknown" };

type ProofContext = {
  storage_rows: IcStorageProof[];
  cleanup_rows: IcCleanupProof[];
  host_boundary_rows: IcHostBoundaryProof[];
  issues: IcProofIssue[];
};

export function ic_no_gc_proof(ic: Ic): IcNoGcProof {
  const context: ProofContext = {
    storage_rows: [],
    cleanup_rows: [],
    host_boundary_rows: [],
    issues: [],
  };
  const result = classify(ic, new Map(), "root", context);
  const final_result = final_result_proof(result);

  if (final_result.decision === "rejected") {
    context.issues.push({
      code: "unproved_result_storage",
      missing_edge: "missing_storage_fact",
      path: "root",
      message: "Pure Ic no-GC proof is missing the final result storage fact",
    });
  }

  return {
    target: "core-3-nonweb",
    target_profile: "core-3-nonweb",
    managed_storage: "disabled",
    ok: context.issues.length === 0,
    storage_rows: context.storage_rows,
    lifetime_rows: [
      { id: "module#0", parent: undefined },
      { id: "call#0", parent: "module#0" },
    ],
    borrow_view_rows: [],
    scratch_result_rows: [],
    freeze_promotion_rows: [],
    cleanup_rows: context.cleanup_rows,
    host_boundary_rows: context.host_boundary_rows,
    capability_method_rows: [],
    runtime_slice_rows: [],
    final_result,
    issues: context.issues,
  };
}

export function check_ic_no_gc_proof(ic: Ic): void {
  const proof = ic_no_gc_proof(ic);
  const issue = proof.issues[0];

  if (issue !== undefined) {
    throw new Error(issue.message);
  }
}

function classify(
  ic: Ic,
  env: Map<string, ValueStorage>,
  path: string,
  context: ProofContext,
): ValueStorage {
  switch (ic.tag) {
    case "num": {
      record_storage(context, path, "scalar_local");
      let value: bigint;

      if (typeof ic.value === "bigint") {
        value = ic.value;
      } else {
        value = BigInt(ic.value);
      }

      return { tag: "constant_scalar", value };
    }

    case "text": {
      record_storage(context, path, "static_data");
      const byte_length = new TextEncoder().encode(ic.value).length + 4;
      return {
        tag: "static_address",
        addresses: [{ path, byte_length, offset: 0n }],
      };
    }

    case "var": {
      const storage = env.get(ic.name);

      if (storage !== undefined) {
        return storage;
      }

      record_storage(context, path, "scalar_local");
      context.host_boundary_rows.push({
        path,
        name: ic.name,
        direction: "parameter",
        ownership: "scalar",
      });
      return { tag: "runtime_scalar" };
    }

    case "prim":
      return classify_prim(ic, env, path, context);

    case "lam": {
      const local_env = new Map(env);
      local_env.set(ic.name, { tag: "runtime_scalar" });
      const result = classify(ic.body, local_env, path + ".body", context);

      if (
        result.tag === "constant_scalar" || result.tag === "runtime_scalar"
      ) {
        return { tag: "callable_scalar" };
      }

      return { tag: "unknown" };
    }

    case "app": {
      const func = classify(ic.func, env, path + ".func", context);
      const arg = classify(ic.arg, env, path + ".arg", context);

      if (
        func.tag === "callable_scalar" &&
        (arg.tag === "constant_scalar" || arg.tag === "runtime_scalar")
      ) {
        record_storage(context, path, "scalar_local");
        return { tag: "runtime_scalar" };
      }

      return { tag: "unknown" };
    }

    case "sup": {
      const left = classify(ic.left, env, path + ".left", context);
      const right = classify(ic.right, env, path + ".right", context);
      return merge_selected_storage(left, right);
    }

    case "dup": {
      const value = classify(ic.expr, env, path + ".expr", context);
      const local_env = new Map(env);
      local_env.set(ic.name + "0", value);
      local_env.set(ic.name + "1", value);
      return classify(ic.body, local_env, path + ".body", context);
    }

    case "era":
      classify(ic.expr, env, path + ".expr", context);
      return classify(ic.body, env, path + ".body", context);

    case "fix": {
      const local_env = new Map(env);
      local_env.set(ic.name, { tag: "callable_scalar" });
      const func = classify(ic.expr, local_env, path + ".expr", context);

      if (func.tag !== "callable_scalar") {
        context.issues.push({
          code: "unproved_result_storage",
          missing_edge: "missing_storage_fact",
          path: path + ".expr",
          message:
            "Pure Ic no-GC proof requires a scalar recursive function result " +
            "at " + path + ".expr",
        });
      }

      return classify(ic.body, local_env, path + ".body", context);
    }
  }
}

function classify_prim(
  ic: Extract<Ic, { tag: "prim" }>,
  env: Map<string, ValueStorage>,
  path: string,
  context: ProofContext,
): ValueStorage {
  const args: ValueStorage[] = [];

  for (let index = 0; index < ic.args.length; index += 1) {
    const arg = ic.args[index];

    if (arg === undefined) {
      throw new Error(
        "Missing Ic primitive argument at " + path + ".args[" +
          index.toString() + "]",
      );
    }

    args.push(classify(
      arg,
      env,
      path + ".args[" + index.toString() + "]",
      context,
    ));
  }

  if (
    ic.prim === "i32.load" || ic.prim === "i64.load" ||
    ic.prim === "f32.load" ||
    ic.prim === "i32.load8_u" || ic.prim === "i64.load8_u"
  ) {
    check_load_address(ic.prim, args[0], path + ".args[0]", context);
    record_storage(context, path, "scalar_local");
    return { tag: "runtime_scalar" };
  }

  if (
    ic.prim === "i32.add" || ic.prim === "i64.add" ||
    ic.prim === "i32.sub" || ic.prim === "i64.sub"
  ) {
    const address = static_address_arithmetic(ic.prim, args[0], args[1]);

    if (address !== undefined) {
      record_storage(context, path, "static_data");
      return address;
    }
  }

  if (ic.prim.endsWith(".select")) {
    const selected = merge_selected_storage(args[0], args[1]);

    if (selected.tag === "static_address") {
      record_storage(context, path, "static_data");
      return selected;
    }
  }

  for (const arg of args) {
    if (arg.tag === "static_address") {
      context.issues.push({
        code: "unproved_static_memory_address",
        missing_edge: "unproved_static_memory_address",
        path,
        message:
          "Pure Ic no-GC proof cannot preserve static address provenance at " +
          path,
      });
      return { tag: "unknown" };
    }
  }

  record_storage(context, path, "scalar_local");

  if (args.length > 0 && args.every(is_constant_scalar)) {
    return constant_prim_result(ic.prim, args);
  }

  return { tag: "runtime_scalar" };
}

function static_address_arithmetic(
  prim: "i32.add" | "i64.add" | "i32.sub" | "i64.sub",
  left: ValueStorage | undefined,
  right: ValueStorage | undefined,
): Extract<ValueStorage, { tag: "static_address" }> | undefined {
  if (left === undefined || right === undefined) {
    return undefined;
  }

  if (left.tag === "static_address" && right.tag === "constant_scalar") {
    let delta = right.value;

    if (prim === "i32.sub" || prim === "i64.sub") {
      delta = -delta;
    }

    return shift_static_addresses(left, delta);
  }

  if (
    (prim === "i32.add" || prim === "i64.add") &&
    left.tag === "constant_scalar" && right.tag === "static_address"
  ) {
    return shift_static_addresses(right, left.value);
  }

  return undefined;
}

function shift_static_addresses(
  storage: Extract<ValueStorage, { tag: "static_address" }>,
  delta: bigint,
): Extract<ValueStorage, { tag: "static_address" }> {
  return {
    tag: "static_address",
    addresses: storage.addresses.map((address) => ({
      ...address,
      offset: address.offset + delta,
    })),
  };
}

function merge_selected_storage(
  left: ValueStorage | undefined,
  right: ValueStorage | undefined,
): ValueStorage {
  if (left === undefined || right === undefined) {
    return { tag: "unknown" };
  }

  if (left.tag === "static_address" && right.tag === "static_address") {
    return {
      tag: "static_address",
      addresses: [...left.addresses, ...right.addresses],
    };
  }

  if (
    left.tag === "constant_scalar" && right.tag === "constant_scalar" &&
    left.value === right.value
  ) {
    return left;
  }

  if (
    (left.tag === "constant_scalar" || left.tag === "runtime_scalar") &&
    (right.tag === "constant_scalar" || right.tag === "runtime_scalar")
  ) {
    return { tag: "runtime_scalar" };
  }

  return { tag: "unknown" };
}

function check_load_address(
  prim:
    | "i32.load"
    | "i64.load"
    | "f32.load"
    | "i32.load8_u"
    | "i64.load8_u",
  storage: ValueStorage | undefined,
  path: string,
  context: ProofContext,
): void {
  let width = 1n;

  if (prim === "i32.load" || prim === "f32.load") {
    width = 4n;
  } else if (prim === "i64.load") {
    width = 8n;
  }

  let allowed = storage !== undefined && storage.tag === "static_address";

  if (allowed && storage !== undefined && storage.tag === "static_address") {
    for (const address of storage.addresses) {
      if (
        address.offset < 0n ||
        address.offset + width > BigInt(address.byte_length)
      ) {
        allowed = false;
        break;
      }
    }
  }

  if (allowed) {
    return;
  }

  context.issues.push({
    code: "unproved_static_memory_address",
    missing_edge: "unproved_static_memory_address",
    path,
    message:
      "Pure Ic no-GC proof requires an in-bounds static-data memory address at " +
      path,
  });
}

function constant_prim_result(
  prim: Extract<Ic, { tag: "prim" }>["prim"],
  args: Array<Extract<ValueStorage, { tag: "constant_scalar" }>>,
): ValueStorage {
  const left = args[0];
  const right = args[1];

  if (left !== undefined && right !== undefined) {
    if (prim === "i32.add") {
      return {
        tag: "constant_scalar",
        value: BigInt.asIntN(32, left.value + right.value),
      };
    }

    if (prim === "i64.add") {
      return {
        tag: "constant_scalar",
        value: BigInt.asIntN(64, left.value + right.value),
      };
    }

    if (prim === "i32.sub") {
      return {
        tag: "constant_scalar",
        value: BigInt.asIntN(32, left.value - right.value),
      };
    }

    if (prim === "i64.sub") {
      return {
        tag: "constant_scalar",
        value: BigInt.asIntN(64, left.value - right.value),
      };
    }
  }

  return { tag: "runtime_scalar" };
}

function is_constant_scalar(
  value: ValueStorage,
): value is Extract<ValueStorage, { tag: "constant_scalar" }> {
  return value.tag === "constant_scalar";
}

function final_result_proof(result: ValueStorage): IcFinalResultProof {
  if (result.tag === "static_address") {
    for (const address of result.addresses) {
      if (address.offset !== 0n) {
        return {
          storage_class: "unknown",
          escape: "module_result",
          decision: "rejected",
        };
      }
    }

    return {
      storage_class: "static_data",
      escape: "module_result",
      decision: "allowed",
    };
  }

  if (result.tag === "constant_scalar" || result.tag === "runtime_scalar") {
    return {
      storage_class: "scalar_local",
      escape: "module_result",
      decision: "allowed",
    };
  }

  return {
    storage_class: "unknown",
    escape: "module_result",
    decision: "rejected",
  };
}

function record_storage(
  context: ProofContext,
  path: string,
  storage_class: IcStorageClass,
): void {
  let lifetime: IcStorageProof["lifetime"] = "call";
  let reason: IcCleanupProof["reason"] = "scalar_local";

  if (storage_class === "static_data") {
    lifetime = "module";
    reason = "frozen_static_data";
  }

  context.storage_rows.push({
    path,
    storage_class,
    lifetime,
    escape: "local",
  });
  context.cleanup_rows.push({ path, decision: "not_required", reason });
}
