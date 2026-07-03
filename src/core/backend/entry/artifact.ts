import type { DataSegment, Mod } from "../../../mod.ts";
import type { Core as CoreNode } from "../../ast.ts";
import {
  core_data_segments as core_data_segments_with_hooks,
  core_mod_from_artifact,
  type CoreArtifactEmitCtx,
  type CoreArtifactEmitHooks,
  type CoreEmitArtifact,
  emit_core_artifact as emit_core_artifact_with_hooks,
} from "../../artifact_emit.ts";
import type {
  CoreBackendArtifact,
  CoreBackendArtifactApi,
} from "./artifact/types.ts";

export type { CoreBackendArtifact, CoreBackendArtifactApi };

export function create_core_backend_artifact<
  ctx extends CoreArtifactEmitCtx,
>(
  api: CoreBackendArtifactApi<ctx>,
): CoreBackendArtifact {
  const core_artifact_emit_hooks = {
    build_text_layout: api.build_text_layout,
    collect_core_ctx: api.collect_core_ctx,
    create_emit_ctx: api.create_emit_ctx,
    emit_lifted_closure_funcs: api.emit_lifted_closure_funcs,
    emit_stmt: api.emit_stmt,
    stmt_result_type: api.stmt_result_type,
  } satisfies CoreArtifactEmitHooks<ctx>;

  function emit_core_artifact(core: CoreNode): CoreEmitArtifact {
    return emit_core_artifact_with_hooks(core, core_artifact_emit_hooks);
  }

  function core_data_segments(core: CoreNode): DataSegment[] {
    return core_data_segments_with_hooks(core, core_artifact_emit_hooks);
  }

  function core_mod(core: CoreNode, name = "main"): Mod {
    return core_mod_from_artifact(emit_core_artifact(core), name);
  }

  return {
    core_data_segments,
    core_mod,
    emit_core_artifact,
  };
}
