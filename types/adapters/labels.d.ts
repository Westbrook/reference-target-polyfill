import type { ReferenceTargetAdapter } from "../core.js";

export interface LabelsOptions {
  activation: "focus" | "focus-and-click";
  naming?: boolean;
}

export function labels(options: LabelsOptions): ReferenceTargetAdapter;
