export {};

declare global {
  interface ShadowRootInit {
    referenceTarget?: string | null;
  }

  interface ShadowRoot {
    referenceTarget: string | null;
  }
}
