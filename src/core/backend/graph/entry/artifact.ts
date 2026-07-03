import { create_core_artifact_emit_ctx } from "../../../emit_ctx.ts";
import type { CoreBackendArtifact } from "../../entry/artifact/types.ts";
import { create_core_backend_artifact } from "../../entry/artifact.ts";
import type { CoreBackendLocalCollect } from "../../entry/local_collect/types.ts";
import type { CoreBackendGraphDeps } from "../../graph_deps.ts";

export function create_core_backend_graph_artifact(
  deps: CoreBackendGraphDeps,
  local_collect: CoreBackendLocalCollect,
): CoreBackendArtifact {
  return create_core_backend_artifact({
    build_text_layout: deps.text().build_text_layout,
    collect_core_ctx: local_collect.collect_core_ctx,
    create_emit_ctx: create_core_artifact_emit_ctx,
    emit_lifted_closure_funcs: deps.closure().emit_lifted_closure_funcs,
    emit_stmt: deps.stmt_emit().emit_stmt,
    stmt_result_type: deps.expr_type().stmt_result_type,
  });
}
