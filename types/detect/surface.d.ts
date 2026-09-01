import type { ReferenceTargetRealm } from "../shared.js";

export type { ReferenceTargetRealm } from "../shared.js";

/** Check only whether ShadowRoot.prototype exposes referenceTarget. */
export function hasNativeReferenceTarget(realm?: ReferenceTargetRealm): boolean;
