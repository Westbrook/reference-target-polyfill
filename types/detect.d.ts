import type { ReferenceTargetRealm } from "./shared.js";

export { hasNativeReferenceTarget } from "./detect/surface.js";

export interface ReferenceTargetProbeResult {
  readonly surface: boolean;
  readonly nullable: boolean;
  readonly labels: boolean;
}

export type { ReferenceTargetRealm } from "./shared.js";

/** Run small, nonthrowing DOM probes for nullable assignment and label forwarding. */
export function probeReferenceTarget(realm?: ReferenceTargetRealm): ReferenceTargetProbeResult;
