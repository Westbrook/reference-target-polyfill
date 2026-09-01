const DEFAULT_TIMEOUT = 10_000;

/** Reject renderer startup instead of leaving the page permanently "loading". */
export function withRendererTimeout(value, name, timeout = DEFAULT_TIMEOUT) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name} did not render within ${timeout} ms`)), timeout);
    Promise.resolve(value).then(
      result => {
        clearTimeout(timer);
        resolve(result);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Wait for compiler-driven custom elements while retaining timeout cleanup. */
export function whenRendererEvent(host, name, timeout = DEFAULT_TIMEOUT) {
  if (!host) return Promise.reject(new Error(`Missing ${name} demo host`));
  if (host.hasAttribute("data-renderer-ready")) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      host.removeEventListener("renderer-ready", done);
      reject(new Error(`${name} did not render within ${timeout} ms`));
    }, timeout);
    host.addEventListener("renderer-ready", done, { once: true });
  });
}
