import { assert_equals } from "../../src/assert.ts";
import {
  type FunctionalWasmAsyncInit,
  type FunctionalWasmHostValue,
} from "../../../gpufuck/functional.ts";
import { DuckCompiler, type DuckProgram } from "../../src/compiler.ts";

const json_parse_source_url = new URL(
  "./json_parse_stage.duck",
  import.meta.url,
);
const json_parse_host_interface_url = new URL(
  "./json_parse_stage_host.duck",
  import.meta.url,
);
const update_plan_decode_source_url = new URL(
  "./update_plan_decode_stage.duck",
  import.meta.url,
);
const update_plan_decode_host_interface_url = new URL(
  "./update_plan_decode_stage_host.duck",
  import.meta.url,
);
const composition_source_url = new URL(
  "./update_plan_stage_composition_fixture.duck",
  import.meta.url,
);
const composition_host_interface_url = new URL(
  "./update_plan_stage_composition_host.duck",
  import.meta.url,
);

Deno.test("Codex composes bounded JSON and update-plan stages under Duck policy", async () => {
  const compiler = await DuckCompiler.create();
  const prepared_programs: DuckProgram[] = [];
  const stage_calls: string[] = [];

  try {
    const json_parse_program = await compiler.prepare_file(
      json_parse_source_url.href,
      { host_interface: json_parse_host_interface_url.href },
    );
    prepared_programs.push(json_parse_program);

    const update_plan_decode_program = await compiler.prepare_file(
      update_plan_decode_source_url.href,
      { host_interface: update_plan_decode_host_interface_url.href },
    );
    prepared_programs.push(update_plan_decode_program);

    const composition_program = await compiler.prepare_file(
      composition_source_url.href,
      { host_interface: composition_host_interface_url.href },
    );
    prepared_programs.push(composition_program);

    const init: FunctionalWasmAsyncInit = {
      CodexStages: {
        $resource: { kind: "resource", id: 1 },
        parse_json: async (argument) => {
          stage_calls.push("parse_json");
          const execution = await json_parse_program.run({
            maximumResultNodes: 4_096,
            init: {
              StageInput: {
                $resource: { kind: "resource", id: 2 },
                document: () => argument,
              },
            },
          });
          return read_stage_result("JSON parse", execution.value);
        },
        decode_update_plan: async (argument) => {
          stage_calls.push("decode_update_plan");
          const execution = await update_plan_decode_program.run({
            maximumResultNodes: 4_096,
            init: {
              StageInput: {
                $resource: { kind: "resource", id: 3 },
                value: () => argument,
              },
            },
          });
          return read_stage_result("update-plan decode", execution.value);
        },
      },
    };

    const execution = await composition_program.run_async({
      init,
      maximumResultNodes: 4_096,
    });
    assert_equals(execution.value, {
      kind: "constructor",
      name: "duck::$DuckStruct:duck_entry_result_type",
      fields: [{ kind: "integer", value: 11 }],
    });
    assert_equals(stage_calls, [
      "parse_json",
      "decode_update_plan",
      "parse_json",
    ]);
  } finally {
    for (const program of prepared_programs) {
      program.destroy();
    }
    compiler.destroy();
  }
});

function read_stage_result(
  stage: string,
  value: FunctionalWasmHostValue,
): FunctionalWasmHostValue {
  if (value.kind !== "constructor") {
    throw new Error(stage + " returned " + value.kind + " instead of a struct");
  }

  const expected_name = "duck::$DuckStruct:duck_entry_result_type";
  if (value.name !== expected_name) {
    throw new Error(
      stage + " returned " + value.name + " instead of " + expected_name,
    );
  }

  if (value.fields.length !== 1) {
    throw new Error(
      stage + " returned " + value.fields.length.toString() +
        " entry fields instead of one",
    );
  }

  const result = value.fields[0];
  if (result === undefined) {
    throw new Error(stage + " omitted its entry result");
  }
  return result;
}
