import type { ReferenceTargetAdapter } from "../core.js";

export type TextNameKind = "label" | "description";

export interface TextNamesOptions {
  getText(host: Element, kind: TextNameKind): string | null;
}

export function textNames(options: TextNamesOptions): ReferenceTargetAdapter;
