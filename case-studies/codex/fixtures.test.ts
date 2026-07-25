import { assert_equals, assert_includes } from "../../src/assert.ts";
import { DuckCompiler, type DuckHostValue } from "../../src/compiler.ts";
import {
  adapter_fixtures,
  blocked_fixtures,
  fixture_cases,
} from "./fixtures.ts";

const fixture_prefix = "agent_job_";

Deno.test("codex agent-job fixtures score every check", async (test) => {
  const compiler = await DuckCompiler.create();

  try {
    for (const fixture of fixture_cases) {
      await test.step("scores: " + fixture.name, async () => {
        const path = new URL("./" + fixture.name, import.meta.url).href;
        const execution = await compiler.run_file(path);

        assert_equals(
          fixture_score(execution.value, fixture.name),
          fixture.expected,
        );
      });
    }

    for (const fixture of blocked_fixtures) {
      await test.step("still blocked: " + fixture.name, async () => {
        const path = new URL("./" + fixture.name, import.meta.url).href;
        let message = "";

        try {
          await compiler.run_file(path);
        } catch (error) {
          if (!(error instanceof Error)) {
            throw new Error(
              "Fixture threw a non-Error value: " + fixture.name,
            );
          }

          message = error.message;
        }

        if (message.length === 0) {
          throw new Error(
            "Fixture now compiles and runs: " + fixture.name +
              "\nMove it into fixture_cases with its expected score.",
          );
        }

        assert_includes(message, fixture.message);
      });
    }
  } finally {
    compiler.destroy();
  }
});

Deno.test("fixture manifest accounts for every agent-job fixture", () => {
  const expected = new Set<string>();

  for (const fixture of fixture_cases) {
    expected.add(fixture.name);
  }

  for (const fixture of blocked_fixtures) {
    expected.add(fixture.name);
  }

  for (const name of adapter_fixtures) {
    expected.add(name);
  }

  const actual = new Set<string>();

  for (const entry of Deno.readDirSync(new URL("./", import.meta.url))) {
    if (!entry.isFile) {
      continue;
    }

    if (!entry.name.startsWith(fixture_prefix)) {
      continue;
    }

    if (!entry.name.endsWith("_fixture.duck")) {
      continue;
    }

    actual.add(entry.name);
  }

  assert_equals([...actual].sort(), [...expected].sort());
  assert_equals(fixture_cases.length, 9);
  assert_equals(blocked_fixtures.length, 12);
  assert_equals(adapter_fixtures.length, 3);
});

Deno.test("adapter fixtures keep a dedicated host-driven test", () => {
  const sources: string[] = [];

  for (const entry of Deno.readDirSync(new URL("./", import.meta.url))) {
    if (!entry.isFile || !entry.name.endsWith(".test.ts")) {
      continue;
    }

    if (entry.name === "fixtures.test.ts") {
      continue;
    }

    sources.push(
      Deno.readTextFileSync(new URL("./" + entry.name, import.meta.url)),
    );
  }

  for (const name of adapter_fixtures) {
    const covered = sources.some((source) => source.includes(name));

    if (!covered) {
      throw new Error("Adapter fixture has no host-driven test: " + name);
    }
  }
});

function fixture_score(value: DuckHostValue, name: string): number {
  if (value.kind !== "constructor") {
    throw new Error(
      "Fixture returned " + value.kind + " instead of a record: " + name,
    );
  }

  if (!value.name.endsWith("duck_entry_result_type")) {
    throw new Error("Fixture returned " + value.name + ": " + name);
  }

  if (value.fields.length !== 1) {
    throw new Error(
      "Fixture result must hold one field: " + name +
        "; received " + value.fields.length.toString(),
    );
  }

  const score = value.fields[0];

  if (score === undefined) {
    throw new Error("Fixture result has no score field: " + name);
  }

  if (score.kind !== "integer") {
    throw new Error(
      "Fixture score is " + score.kind + " instead of an integer: " + name,
    );
  }

  return score.value;
}
