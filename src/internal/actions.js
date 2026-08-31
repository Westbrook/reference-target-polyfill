const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const INPUT_BUTTON_TYPES = new Set(["button", "submit", "reset", "image"]);

export function isHTMLElement(element) {
  return element?.nodeType === 1 && element.namespaceURI === HTML_NAMESPACE;
}

export function asciiLowerCase(value) {
  return value.replace(/[A-Z]/g, (character) => character.toLowerCase());
}

/** Find the activation control before looking for its reference attributes. */
export function actionInvoker(event, path, commandsOnly = false, context) {
  if (event.defaultPrevented || !event.cancelable) return null;
  if (typeof event.button === "number" && event.button !== 0) return null;

  for (const element of path) {
    if (!isHTMLElement(element)) continue;

    // Do not let an outer button steal activation from a nested control. This
    // also handles synthetic events in invalid nested-interactive markup.
    if (
      (element.localName === "a" || element.localName === "area") &&
      element.hasAttribute("href")
    ) return null;
    if (element.localName !== "button" && element.localName !== "input") continue;

    if (element.localName === "input") {
      if (commandsOnly || !INPUT_BUTTON_TYPES.has(element.type)) return null;
    }

    if (element.matches(":disabled") || isInert(element)) return null;

    // Both button activation and input activation handle their form owner
    // before references. Require explicit type=button inside a form; reading
    // button.type is insufficient in engines with the newer Auto state.
    if (
      element.form &&
      asciiLowerCase(element.getAttribute("type") ?? "") !== "button"
    ) return null;

    // A forwarded form owner still takes precedence when the optional form
    // action adapter was not imported. Without this guard, the old engine's
    // null .form would accidentally enable a command or popover operation.
    if (
      context && element.hasAttribute("form") &&
      asciiLowerCase(element.getAttribute("type") ?? "") !== "button"
    ) {
      const reference = context.resolveReference(element, "form");
      if (
        reference.forwarded && context.window.HTMLFormElement &&
        reference.target instanceof context.window.HTMLFormElement
      ) {
        // The browser's own command/popover activation also sees .form===null.
        // Cancel that default even if there is no selected form adapter to
        // implement submission/reset; merely skipping our adapter is not enough.
        claimActivation(event);
        return null;
      }
    }

    return element;
  }
  return null;
}

function isInert(element) {
  for (let current = element; current; ) {
    if (current.nodeType === 1) {
      if (current.hasAttribute("inert")) return true;
      if (
        current.localName === "button" &&
        current.parentElement?.localName === "select" &&
        current.parentElement.firstElementChild === current
      ) return true;
    }
    current = current.assignedSlot ?? current.parentNode ?? (current.nodeType === 11 ? current.host : null) ?? null;
  }
  return false;
}

export function shadowIncludingContains(ancestor, node) {
  for (let current = node; current; current = current.parentNode ?? (current.nodeType === 11 ? current.host : null) ?? null) {
    if (current === ancestor) return true;
  }
  return false;
}

export function hasPopoverPrimitives(window) {
  return (
    typeof window.HTMLElement?.prototype.showPopover === "function" &&
    typeof window.HTMLElement?.prototype.hidePopover === "function"
  );
}

/**
 * Claim synchronously to stop the browser from acting on the unforwarded host.
 * These adapters run during bubbling, so cancellation in an earlier listener
 * is honored. A later listener cannot undo an action already performed here.
 */
export function claimActivation(event) {
  event.preventDefault();
  return event.defaultPrevented;
}

export function runPopoverAction(context, target, invoker, action) {
  if (!target.isConnected || !target.hasAttribute("popover")) return;

  const showing = target.matches(":popover-open");
  if ((action === "show" && showing) || (action === "hide" && !showing)) return;

  const method = showing ? "hidePopover" : "showPopover";
  if (typeof target[method] !== "function") {
    context.report("missing-primitive", { method, source: invoker });
    return;
  }

  // showPopover's former zero-argument signature safely ignores options.
  // togglePopover's former boolean signature does not, so select show/hide
  // explicitly. hidePopover has no source argument: hiding event source is
  // therefore one of this fallback's documented differences from native RT.
  const argumentsList = showing ? [] : [{ source: invoker }];
  invokeNativeAction(context, target, method, argumentsList, invoker);
}

export function invokeNativeAction(context, target, method, argumentsList, invoker) {
  try {
    target[method](...argumentsList);
  } catch (error) {
    const DOMException = target.ownerDocument.defaultView?.DOMException;
    // Native command activation ignores invalid dialog/popover state. The
    // corresponding public methods throw instead. Suppress only these native
    // state errors; application exceptions and missing primitives must surface.
    if (
      DOMException && error instanceof DOMException &&
      (error.name === "InvalidStateError" || error.name === "NotSupportedError")
    ) {
      context.report("invalid-action-state", { method, source: invoker, error });
      return;
    }
    throw error;
  }
}

function dispatchCommand(window, target, invoker, command) {
  let event;
  if (typeof window.CommandEvent === "function") {
    event = new window.CommandEvent("command", {
      command,
      source: invoker,
      cancelable: true,
    });
  } else {
    // Preserve useful cancellation in engines without CommandEvent. This is
    // a synthetic Event, not a complete CommandEvent or event-path polyfill.
    event = new window.Event("command", { cancelable: true });
    Object.defineProperties(event, {
      command: { value: command, enumerable: true },
      source: { value: invoker, enumerable: true },
    });
  }
  return target.dispatchEvent(event);
}

/** Shared command activation; adapters supply only their recognized commands. */
export function commandRuntime(context, { commands, accepts, act }) {
  return {
    click(event, path) {
      const invoker = actionInvoker(event, path, true, context);
      if (!invoker) return false;
      const command = asciiLowerCase(invoker.getAttribute("command") ?? "");
      if (!commands.has(command)) return false;

      const reference = context.resolveReference(invoker, "commandfor", "commandForElement");
      if (!reference.forwarded) return false;
      if (!claimActivation(event)) return false;

      if (!reference.target) {
        context.report("unresolved-target", { attribute: "commandfor", source: invoker, host: reference.host });
        return true;
      }
      if (!accepts(reference.target)) {
        context.report("unsupported-target", { attribute: "commandfor", command, source: invoker, host: reference.host });
        return true;
      }

      if (dispatchCommand(context.window, reference.target, invoker, command) && reference.target.isConnected) {
        act(reference.target, invoker, command);
      }
      return true;
    },
  };
}
