export function withRendererTimeout<T>(value: PromiseLike<T> | T, name: string, timeout?: number): Promise<T>;
export function whenRendererEvent(host: Element | null, name: string, timeout?: number): Promise<void>;
