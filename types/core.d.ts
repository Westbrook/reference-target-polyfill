import type { ReferenceTargetRealm } from "./shared.js";

declare const referenceTargetAdapterBrand: unique symbol;

/** An opaque descriptor produced by one of the package's adapter factories. */
export interface ReferenceTargetAdapter {
  readonly id: string;
  readonly [referenceTargetAdapterBrand]: true;
}

export type ReferenceTargetMode =
  | "fallback"
  | "native-unverified"
  | "unsupported"
  | "inactive"
  | "disposed";
export type ReferenceTargetAdapterStatus = ReferenceTargetMode;

export interface ReferenceTargetDiagnostic {
  readonly code: string;
  readonly detail: unknown;
}

export interface ReferenceTargetRegistration {
  dispose(): void;
}

export interface RegisterReferenceTargetOptions {
  referenceTarget?: string | null;
}

export interface ReferenceTargetHandle {
  readonly mode: ReferenceTargetMode;
  readonly reason?: string;
  readonly statuses: Readonly<Record<string, ReferenceTargetAdapterStatus>>;
  readonly activeAdapters: readonly string[];
  register(
    root: ShadowRoot,
    options?: RegisterReferenceTargetOptions,
  ): ReferenceTargetRegistration;
  hydrate(container?: ParentNode): void;
  refresh(): void;
  dispose(): void;
}

export interface InstallReferenceTargetOptions {
  adapters?: readonly ReferenceTargetAdapter[];
  realm?: ReferenceTargetRealm;
  force?: boolean;
  onDiagnostic?: (diagnostic: ReferenceTargetDiagnostic) => void;
}

export type { ReferenceTargetRealm } from "./shared.js";

/** Install the selected fallback adapters synchronously in one browser realm. */
export function installReferenceTarget(
  options?: InstallReferenceTargetOptions,
): ReferenceTargetHandle;
