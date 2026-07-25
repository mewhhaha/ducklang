// Manifest for the standalone `*_fixture.duck` programs in this directory.
//
// A fixture is a module that runs a series of independent checks and returns
// `{ .score = score }`. Every check owns one decimal digit and adds a distinct
// power of ten when it holds:
//
//   if first_check { score = score + 1 }
//   if second_check { score = score + 10 }
//   if third_check { score = score + 100 }
//
// A fully passing fixture therefore returns the repunit for its check count:
// three checks pass with 111, five with 11111. The digit tells you which check
// regressed, so `expected` below is always the repunit and never whatever the
// fixture happens to produce today.
//
// Adapter fixtures need a host interface and a hand-written init record, so
// they keep their dedicated test files and are only listed here for accounting.

export type FixtureCase = {
  name: string;
  expected: number;
};

export type BlockedFixture = {
  name: string;
  message: string;
};

export const fixture_cases: FixtureCase[] = [
  { name: "agent_job_csv_header_output_fixture.duck", expected: 1 },
  { name: "agent_job_csv_row_output_fixture.duck", expected: 11 },
  { name: "agent_job_registration_fixture.duck", expected: 1111 },
  { name: "agent_job_runner_action_fixture.duck", expected: 111 },
  { name: "agent_job_runner_transition_fixture.duck", expected: 1111 },
  { name: "agent_job_spawn_environment_policy_fixture.duck", expected: 11 },
  { name: "agent_job_spawn_limits_policy_fixture.duck", expected: 11 },
  { name: "agent_job_spawn_policy_fixture.duck", expected: 11111 },
  { name: "agent_job_worker_source_fixture.duck", expected: 11 },
];

// These fixtures are written against language features the toolchain cannot
// compile yet. They are listed with the failure they currently hit so the
// runner reports a fixture that silently stops failing: once a compiler gap
// closes, move the entry into `fixture_cases` with its repunit.
export const blocked_fixtures: BlockedFixture[] = [
  {
    name: "agent_job_csv_fixture.duck",
    message: "type mismatch: expected $FunctionalText, received Int",
  },
  {
    name: "agent_job_csv_output_fixture.duck",
    message: "cannot find type Text",
  },
  {
    name: "agent_job_prepare_fixture.duck",
    message: "expected duck::Json, received $FunctionalText",
  },
  {
    name: "agent_job_report_fixture.duck",
    message: "expected duck::JsonArray, received duck::JsonObject",
  },
  {
    name: "agent_job_result_fixture.duck",
    message: "expected duck::JsonArray, received duck::JsonObject",
  },
  {
    name: "agent_job_runner_fixture.duck",
    message: "functional surface expression exceeds 65536 nodes",
  },
  {
    name: "agent_job_spawn_fixture.duck",
    message: "exceeds 65536 expression nodes",
  },
  {
    name: "agent_job_spawn_json_fixture.duck",
    message: "functional surface module exceeds 65536 expression nodes",
  },
  {
    name: "agent_job_spawn_json_numeric_fixture.duck",
    message: "expected duck::JsonArray, received duck::JsonObject",
  },
  {
    name: "agent_job_spawn_json_required_fixture.duck",
    message: "expected duck::JsonArray, received duck::JsonObject",
  },
  {
    name: "agent_job_spawn_json_schema_fixture.duck",
    message: "expected duck::JsonArray, received duck::JsonObject",
  },
  {
    name: "agent_job_spawn_json_text_fixture.duck",
    message: "expected duck::JsonArray, received duck::JsonObject",
  },
];

// Covered by agent_job_export.test.ts, agent_job_report.test.ts and
// agent_job_spawn.test.ts, which supply the host each one calls into.
export const adapter_fixtures: string[] = [
  "agent_job_export_adapter_fixture.duck",
  "agent_job_report_adapter_fixture.duck",
  "agent_job_spawn_adapter_fixture.duck",
];
