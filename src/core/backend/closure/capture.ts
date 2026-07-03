import type { CoreExpr } from "../../ast.ts";
import type { CoreBackendClosure, CoreBackendClosureApi } from "./types.ts";
import {
  core_lam_capture_info as core_lam_capture_info_with_hooks,
  core_lam_capture_names as core_lam_capture_names_with_hooks,
  type CoreCaptureHooks,
  type CoreCaptureInfo,
  type CoreLamCapturePlan,
  plan_core_lam_capture as plan_core_lam_capture_with_hooks,
} from "../../closure_capture.ts";
import type { StaticCtx, TempCtx } from "../../local_collect.ts";

export type CoreBackendClosureCapture = Pick<
  CoreBackendClosure,
  "core_lam_capture_info" | "core_lam_capture_names" | "plan_core_lam_capture"
>;

export function create_core_backend_closure_capture(
  api: CoreBackendClosureApi,
): CoreBackendClosureCapture {
  const capture_hooks = {
    static_struct_binding: api.static_struct_binding,
  } satisfies CoreCaptureHooks<StaticCtx>;

  function core_lam_capture_info(
    expr: Extract<CoreExpr, { tag: "lam" }>,
    ctx: StaticCtx,
  ): CoreCaptureInfo {
    return core_lam_capture_info_with_hooks(expr, ctx, capture_hooks);
  }

  function core_lam_capture_names(
    expr: Extract<CoreExpr, { tag: "lam" }>,
    ctx: StaticCtx,
  ): string[] | undefined {
    return core_lam_capture_names_with_hooks(expr, ctx, capture_hooks);
  }

  function plan_core_lam_capture(
    expr: Extract<CoreExpr, { tag: "lam" }>,
    ctx: TempCtx,
    emit_setup: boolean,
  ): CoreLamCapturePlan | undefined {
    return plan_core_lam_capture_with_hooks(
      expr,
      ctx,
      emit_setup,
      capture_hooks,
    );
  }

  return {
    core_lam_capture_info,
    core_lam_capture_names,
    plan_core_lam_capture,
  };
}
