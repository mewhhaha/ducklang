import { assert_equals } from "../../src/assert.ts";
import {
  type FunctionalWasmAsyncInit,
  type FunctionalWasmHostValue,
} from "../../../gpufuck/functional.ts";
import { DuckCompiler } from "../../src/compiler.ts";

const source_url = new URL(
  "./request_user_input_adapter_fixture.duck",
  import.meta.url,
);
const host_interface_url = new URL(
  "./request_user_input_host.duck",
  import.meta.url,
);

Deno.test("Codex keeps interactive prompting behind normalized source policy", async () => {
  const requests: {
    call_id: string;
    turn_id: string;
    question_id: string;
    is_other: boolean;
    is_secret: boolean;
    auto_resolution_ms: bigint;
  }[] = [];
  const init: FunctionalWasmAsyncInit = {
    RequestUserInputHost: {
      $resource: { kind: "resource", id: 1 },
      request: (argument) => {
        const request = constructor_fields(
          argument,
          "duck::$DuckStruct:RequestUserInputHostRequest",
          3,
          "request_user_input host request",
        );
        const args = constructor_fields(
          request[2],
          "duck::$DuckStruct:RequestUserInputArgs",
          2,
          "request_user_input arguments",
        );
        const question_node = union_payload(
          args[0],
          "RequestUserInputQuestions",
          "Cons",
          "request_user_input questions",
        );
        const question_pair = constructor_fields(
          question_node,
          "duck::$DuckStruct:RequestUserInputQuestionNode",
          2,
          "request_user_input question node",
        );
        const question = constructor_fields(
          question_pair[0],
          "duck::$DuckStruct:RequestUserInputQuestion",
          6,
          "request_user_input question",
        );
        const auto_resolution = union_payload(
          args[1],
          "RequestUserInputAutoResolution",
          "AutoResolutionMs",
          "request_user_input auto resolution",
        );
        requests.push({
          call_id: text_argument(request[0], "request_user_input call id"),
          turn_id: text_argument(request[1], "request_user_input turn id"),
          question_id: text_argument(
            question[0],
            "request_user_input question id",
          ),
          is_other: bool_argument(question[3], "request_user_input Other flag"),
          is_secret: bool_argument(
            question[4],
            "request_user_input secret flag",
          ),
          auto_resolution_ms: signed_integer_64_argument(
            auto_resolution,
            "request_user_input auto resolution",
          ),
        });
        assert_single_option(question[5]);
        assert_nil_union(
          question_pair[1],
          "RequestUserInputQuestions",
          "request_user_input question tail",
        );
        return answered_response("pick_one", "A");
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

  assert_equals(requests, [{
    call_id: "call-1",
    turn_id: "turn-1",
    question_id: "pick_one",
    is_other: true,
    is_secret: true,
    auto_resolution_ms: 60_000n,
  }]);
});

const unit_value: FunctionalWasmHostValue = { kind: "unit" };

function text_value(value: string): FunctionalWasmHostValue {
  return { kind: "text", value };
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

function answered_response(
  question_id: string,
  answer_text: string,
): FunctionalWasmHostValue {
  const answer_text_node: FunctionalWasmHostValue = {
    kind: "constructor",
    name: "duck::$DuckStruct:RequestUserInputAnswerTextNode",
    fields: [
      text_value(answer_text),
      union("RequestUserInputAnswerTexts", "Nil", unit_value),
    ],
  };
  const answer: FunctionalWasmHostValue = {
    kind: "constructor",
    name: "duck::$DuckStruct:RequestUserInputAnswer",
    fields: [
      text_value(question_id),
      union("RequestUserInputAnswerTexts", "Cons", answer_text_node),
    ],
  };
  const answer_node: FunctionalWasmHostValue = {
    kind: "constructor",
    name: "duck::$DuckStruct:RequestUserInputAnswerNode",
    fields: [
      answer,
      union("RequestUserInputAnswers", "Nil", unit_value),
    ],
  };
  const response: FunctionalWasmHostValue = {
    kind: "constructor",
    name: "duck::$DuckStruct:RequestUserInputResponse",
    fields: [union("RequestUserInputAnswers", "Cons", answer_node)],
  };
  return union("RequestUserInputHostResponse", "Answered", response);
}

function assert_single_option(value: FunctionalWasmHostValue): void {
  const options = union_payload(
    value,
    "RequestUserInputQuestionOptionsField",
    "Present",
    "request_user_input options field",
  );
  const option_node = union_payload(
    options,
    "RequestUserInputQuestionOptions",
    "Cons",
    "request_user_input options",
  );
  const option_pair = constructor_fields(
    option_node,
    "duck::$DuckStruct:RequestUserInputQuestionOptionNode",
    2,
    "request_user_input option node",
  );
  const option = constructor_fields(
    option_pair[0],
    "duck::$DuckStruct:RequestUserInputQuestionOption",
    2,
    "request_user_input option",
  );
  assert_equals(
    text_argument(option[0], "request_user_input option label"),
    "A (Recommended)",
  );
  assert_equals(
    text_argument(option[1], "request_user_input option description"),
    "Use the first path.",
  );
  assert_nil_union(
    option_pair[1],
    "RequestUserInputQuestionOptions",
    "request_user_input option tail",
  );
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

function assert_nil_union(
  value: FunctionalWasmHostValue,
  type_name: string,
  operation: string,
): void {
  const payload = union_payload(value, type_name, "Nil", operation);
  if (payload.kind !== "unit") {
    throw new Error(operation + " must end in Unit; received " + payload.kind);
  }
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
