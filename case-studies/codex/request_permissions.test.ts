import { assert_equals } from "../../src/assert.ts";
import {
  type FunctionalWasmAsyncInit,
  type FunctionalWasmHostValue,
} from "../../../gpufuck/functional.ts";
import { DuckCompiler } from "../../src/compiler.ts";

const source_url = new URL(
  "./request_permissions_adapter_fixture.duck",
  import.meta.url,
);
const host_interface_url = new URL(
  "./request_permissions_host.duck",
  import.meta.url,
);

Deno.test("Codex keeps permission grants within the source-owned request", async () => {
  const observed: {
    call_id: string;
    turn_id: string;
    environment_id: string;
    started_at_ms: bigint;
    reason: string;
    cwd: string;
    read_path: string;
    write_path: string;
    network_enabled: boolean;
  }[] = [];
  const init: FunctionalWasmAsyncInit = {
    RequestPermissionsHost: {
      $resource: { kind: "resource", id: 1 },
      request: (argument) => {
        const request = constructor_fields(
          argument,
          "duck::$DuckStruct:RequestPermissionsHostRequest",
          7,
          "request_permissions host request",
        );
        const profile = permission_profile(
          request[5],
          "request_permissions requested profile",
        );
        const paths = permission_paths(profile.file_system_entries);
        observed.push({
          call_id: text_argument(request[0], "request_permissions call id"),
          turn_id: text_argument(request[1], "request_permissions turn id"),
          environment_id: text_argument(
            request[2],
            "request_permissions environment id",
          ),
          started_at_ms: signed_integer_64_argument(
            request[3],
            "request_permissions start time",
          ),
          reason: text_argument(
            union_payload(
              request[4],
              "RequestPermissionsTextOption",
              "Some",
              "request_permissions reason",
            ),
            "request_permissions reason text",
          ),
          cwd: text_argument(request[6], "request_permissions cwd"),
          read_path: paths[0].path,
          write_path: paths[1].path,
          network_enabled: profile.network_enabled,
        });
        return answered_response();
      },
    },
  };

  const compiler = await DuckCompiler.create();
  try {
    const execution = await compiler.run_async_file(source_url.href, {
      host_interface: host_interface_url.href,
      init,
    });
    assert_equals(execution.value, {
      kind: "constructor",
      name: "duck::$DuckStruct:duck_entry_result_type",
      fields: [{ kind: "integer", value: 1 }],
    });
    assert_equals(execution.stats.thunkEvaluations, 1);
  } finally {
    compiler.destroy();
  }

  assert_equals(observed, [{
    call_id: "call-1",
    turn_id: "turn-1",
    environment_id: "primary",
    started_at_ms: 1_784_563_200_000n,
    reason: "compile generated output",
    cwd: "/workspace",
    read_path: "/workspace",
    write_path: "/workspace/out",
    network_enabled: true,
  }]);
});

const unit_value: FunctionalWasmHostValue = { kind: "unit" };

function text_value(text: string): FunctionalWasmHostValue {
  return { kind: "text", value: text };
}

function integer_value(integer: number): FunctionalWasmHostValue {
  return { kind: "integer", value: integer };
}

function union(
  type_name: string,
  case_name: string,
  payload: FunctionalWasmHostValue,
): FunctionalWasmHostValue {
  return {
    kind: "constructor",
    name: "duck::$DuckUnion:" + type_name + ":" + case_name,
    fields: [payload],
  };
}

function path_entry(
  path: string,
  access: "Read" | "Write",
): FunctionalWasmHostValue {
  return {
    kind: "constructor",
    name: "duck::$DuckStruct:RequestPermissionPath",
    fields: [
      text_value(path),
      union("RequestPermissionAccess", access, unit_value),
    ],
  };
}

function path_list(
  entries: readonly FunctionalWasmHostValue[],
): FunctionalWasmHostValue {
  let result = union("RequestPermissionPaths", "Nil", unit_value);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const node: FunctionalWasmHostValue = {
      kind: "constructor",
      name: "duck::$DuckStruct:RequestPermissionPathNode",
      fields: [entries[index], result],
    };
    result = union("RequestPermissionPaths", "Cons", node);
  }
  return result;
}

function answered_response(): FunctionalWasmHostValue {
  const network: FunctionalWasmHostValue = {
    kind: "constructor",
    name: "duck::$DuckStruct:RequestPermissionNetwork",
    fields: [
      union("RequestPermissionsBooleanOption", "Some", integer_value(1)),
    ],
  };
  const file_system: FunctionalWasmHostValue = {
    kind: "constructor",
    name: "duck::$DuckStruct:RequestPermissionFileSystem",
    fields: [path_list([
      path_entry("/workspace/docs", "Read"),
      path_entry("/workspace/out/build", "Write"),
      path_entry("/workspace/private", "Write"),
    ])],
  };
  const profile: FunctionalWasmHostValue = {
    kind: "constructor",
    name: "duck::$DuckStruct:RequestPermissionProfile",
    fields: [
      union("RequestPermissionNetworkField", "NetworkPresent", network),
      union(
        "RequestPermissionFileSystemField",
        "FileSystemPresent",
        file_system,
      ),
    ],
  };
  const response: FunctionalWasmHostValue = {
    kind: "constructor",
    name: "duck::$DuckStruct:RequestPermissionsResponse",
    fields: [
      profile,
      union("PermissionGrantScope", "Turn", unit_value),
      integer_value(1),
    ],
  };
  return union("RequestPermissionsHostResponse", "Answered", response);
}

function permission_profile(
  value: FunctionalWasmHostValue,
  operation: string,
): {
  network_enabled: boolean;
  file_system_entries: FunctionalWasmHostValue;
} {
  const fields = constructor_fields(
    value,
    "duck::$DuckStruct:RequestPermissionProfile",
    2,
    operation,
  );
  const network = constructor_fields(
    union_payload(
      fields[0],
      "RequestPermissionNetworkField",
      "NetworkPresent",
      operation + " network",
    ),
    "duck::$DuckStruct:RequestPermissionNetwork",
    1,
    operation + " network",
  );
  const enabled = union_payload(
    network[0],
    "RequestPermissionsBooleanOption",
    "Some",
    operation + " network enabled",
  );
  const file_system = constructor_fields(
    union_payload(
      fields[1],
      "RequestPermissionFileSystemField",
      "FileSystemPresent",
      operation + " file system",
    ),
    "duck::$DuckStruct:RequestPermissionFileSystem",
    1,
    operation + " file system",
  );
  return {
    network_enabled: bool_argument(enabled, operation + " network enabled"),
    file_system_entries: file_system[0],
  };
}

function permission_paths(
  value: FunctionalWasmHostValue,
): readonly { path: string; access: "Read" | "Write" }[] {
  const paths: { path: string; access: "Read" | "Write" }[] = [];
  let current = value;
  while (
    constructor_name(current) !== "duck::$DuckUnion:RequestPermissionPaths:Nil"
  ) {
    const node = constructor_fields(
      union_payload(
        current,
        "RequestPermissionPaths",
        "Cons",
        "request_permissions path list",
      ),
      "duck::$DuckStruct:RequestPermissionPathNode",
      2,
      "request_permissions path node",
    );
    const entry = constructor_fields(
      node[0],
      "duck::$DuckStruct:RequestPermissionPath",
      2,
      "request_permissions path",
    );
    const access_name = constructor_name(entry[1]);
    let access: "Read" | "Write";
    if (access_name === "duck::$DuckUnion:RequestPermissionAccess:Read") {
      access = "Read";
    } else if (
      access_name === "duck::$DuckUnion:RequestPermissionAccess:Write"
    ) {
      access = "Write";
    } else {
      throw new Error(
        "request_permissions path has unsupported access " + access_name,
      );
    }
    paths.push({
      path: text_argument(entry[0], "request_permissions path text"),
      access,
    });
    current = node[1];
  }
  return paths;
}

function union_payload(
  value: FunctionalWasmHostValue,
  type_name: string,
  case_name: string,
  operation: string,
): FunctionalWasmHostValue {
  const expected_name = "duck::$DuckUnion:" + type_name + ":" + case_name;
  const fields = constructor_fields(value, expected_name, 1, operation);
  return fields[0];
}

function constructor_name(value: FunctionalWasmHostValue): string {
  if (value.kind !== "constructor") {
    throw new Error("expected constructor; received " + value.kind);
  }
  return value.name;
}

function constructor_fields(
  value: FunctionalWasmHostValue,
  expected_name: string,
  expected_count: number,
  operation: string,
): readonly FunctionalWasmHostValue[] {
  if (value.kind !== "constructor") {
    throw new Error(
      operation + " must be a constructor; received " + value.kind,
    );
  }
  if (value.name !== expected_name) {
    throw new Error(
      operation + " must be " + expected_name + "; received " + value.name,
    );
  }
  if (value.fields.length !== expected_count) {
    throw new Error(
      operation + " must contain " + expected_count.toString() +
        " fields; received " + value.fields.length.toString(),
    );
  }
  return value.fields;
}

function text_argument(
  value: FunctionalWasmHostValue,
  operation: string,
): string {
  if (value.kind !== "text") {
    throw new Error(operation + " must be Text; received " + value.kind);
  }
  return value.value;
}

function bool_argument(
  value: FunctionalWasmHostValue,
  operation: string,
): boolean {
  if (value.kind !== "integer") {
    throw new Error(operation + " must be Bool; received " + value.kind);
  }
  if (value.value !== 0 && value.value !== 1) {
    throw new Error(
      operation + " must be Bool; received " + value.value.toString(),
    );
  }
  return value.value === 1;
}

function signed_integer_64_argument(
  value: FunctionalWasmHostValue,
  operation: string,
): bigint {
  if (value.kind !== "signed-integer-64") {
    throw new Error(operation + " must be I64; received " + value.kind);
  }
  return value.value;
}
