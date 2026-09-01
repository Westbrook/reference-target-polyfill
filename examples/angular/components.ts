import {
  type AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  enableProdMode,
  inject,
  input,
  numberAttribute,
  ViewEncapsulation,
} from "@angular/core";
import { createCustomElement } from "@angular/elements";
import { createApplication } from "@angular/platform-browser";
import { withRendererTimeout } from "../../examples/shared/renderer-readiness.js";

function setReferenceTarget(host: HTMLElement, target: string) {
  const root = host.shadowRoot as ShadowRoot & { referenceTarget: string };
  root.referenceTarget = target;
}

@Component({
  selector: "angular-checkbox-view",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.ShadowDom,
  styleUrl: "../shared/components.css",
  template: `
    <div class="component-preview">
      @for (current of [revision()]; track current) {
        <input id="control" type="checkbox" [attr.data-revision]="current">
      }
      <span aria-hidden="true">Native checkbox</span>
    </div>
    <p class="hint">Render revision {{ revision() }}</p>
  `,
})
class AngularCheckbox implements AfterViewInit {
  readonly revision = input(0, { transform: (value: unknown) => numberAttribute(value, 0) });
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  ngAfterViewInit() {
    setReferenceTarget(this.host.nativeElement, "control");
  }
}

@Component({
  selector: "angular-popover-view",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.ShadowDom,
  styleUrl: "../shared/components.css",
  template: `
    <div id="panel" popover="auto" role="dialog" aria-labelledby="panel-title">
      <p class="eyebrow">Angular Elements · shadow DOM</p>
      <h2 id="panel-title">Rendered with Angular</h2>
      <p>This native popover lives inside an Angular component shadow root.</p>
      <button type="button" popovertarget="panel" popovertargetaction="hide" autofocus>Close popover</button>
    </div>
  `,
})
class AngularPopover implements AfterViewInit {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  ngAfterViewInit() {
    setReferenceTarget(this.host.nativeElement, "panel");
  }
}

enableProdMode();
// Angular 22 is zoneless. Both component templates and their styles are compiled
// during the build, so this page needs neither Zone.js nor a runtime compiler.
const application = createApplication().then(app => {
  // Keep Angular Elements' standard lifecycle. Its documented limitation on
  // reconnecting a destroyed element also applies here; create a new instance
  // after removal instead of reusing the old host after Angular tears it down.
  customElements.define("rt-angular-checkbox", createCustomElement(AngularCheckbox, { injector: app.injector }));
  customElements.define("rt-angular-popover", createCustomElement(AngularPopover, { injector: app.injector }));
  return app;
});

export async function whenReady() {
  await withRendererTimeout((async () => {
    const app = await application;
    await app.whenStable();
    for (const [id, target] of [["renderer-checkbox", "control"], ["renderer-popover", "panel"]]) {
      if (!document.getElementById(id)?.shadowRoot?.getElementById(target)) {
        throw new Error(`Angular did not finish rendering ${id}`);
      }
    }
  })(), "Angular");
}
