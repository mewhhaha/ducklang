import type { CoreBackendText } from "../../text/types.ts";
import type { CoreBackendStaticCall } from "../../values/static_call/types.ts";
import type { CoreBackendStaticValue } from "../../values/static_value/types.ts";
import type { CoreBackendStruct } from "../../values/struct/types.ts";

export type CoreBackendValuesGraph = {
  static_call: CoreBackendStaticCall;
  static_value: CoreBackendStaticValue;
  struct: CoreBackendStruct;
  text: CoreBackendText;
};
