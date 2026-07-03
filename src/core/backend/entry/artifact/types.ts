import type { DataSegment, Func, Mod } from "../../../../mod.ts";
import type { ValType } from "../../../../op.ts";
import type { Wat } from "../../../../wat.ts";
import type { Core as CoreNode, CoreStmt } from "../../../ast.ts";
import type {
  CoreArtifactEmitCtx,
  CoreArtifactEmitHooks,
  CoreEmitArtifact,
} from "../../../artifact_emit.ts";
import type { ClosureEmitCtx } from "../../../closure_emit.ts";
import type { CoreCtx } from "../../../local_collect.ts";
import type { RuntimeTextHeap } from "../../../runtime_text.ts";
import type { CoreScratchHeap } from "../../../scratch.ts";
import type { TextLayout } from "../../../text_layout.ts";

export type CoreBackendArtifactApi<ctx extends CoreArtifactEmitCtx> = {
  build_text_layout: (core: CoreNode, core_ctx: CoreCtx) => TextLayout;
  collect_core_ctx: (core: CoreNode) => CoreCtx;
  create_emit_ctx: CoreArtifactEmitHooks<ctx>["create_emit_ctx"];
  emit_lifted_closure_funcs: (
    text_layout: TextLayout,
    closures: ClosureEmitCtx,
    heap: RuntimeTextHeap,
    scratch: CoreScratchHeap,
  ) => Func[];
  emit_stmt: (stmt: CoreStmt, ctx: ctx, is_final: boolean) => Wat;
  stmt_result_type: (stmt: CoreStmt, ctx: CoreCtx) => ValType;
};

export type CoreBackendArtifact = {
  emit_core_artifact: (core: CoreNode) => CoreEmitArtifact;
  core_data_segments: (core: CoreNode) => DataSegment[];
  core_mod: (core: CoreNode, name?: string) => Mod;
};
