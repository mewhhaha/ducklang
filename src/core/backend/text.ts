import type { CoreBackendText, CoreBackendTextApi } from "./text/types.ts";
import { create_core_backend_text_facts } from "./text/facts.ts";
import { create_core_backend_text_layout } from "./text/layout.ts";
import { create_core_backend_text_runtime } from "./text/runtime.ts";
import { create_core_backend_text_static } from "./text/static.ts";

export type { CoreBackendText, CoreBackendTextApi };

export function create_core_backend_text(
  api: CoreBackendTextApi,
): CoreBackendText {
  const static_text = create_core_backend_text_static(api);
  const text_facts = create_core_backend_text_facts(api, static_text);
  const text_layout = create_core_backend_text_layout(api, text_facts);
  const runtime_text = create_core_backend_text_runtime(api, text_facts);

  return {
    ...static_text,
    ...text_facts,
    ...text_layout,
    ...runtime_text,
  };
}
