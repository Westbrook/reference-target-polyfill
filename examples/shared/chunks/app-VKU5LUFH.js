var u=document.getElementById("dialog-commands"),s=document.getElementById("dc-host");if(!s)throw new Error("The dialog-commands example needs its dialog host.");var t=s.attachShadow({mode:"closed",referenceTarget:"dc-dialog"});t.innerHTML=`
  <div class="component-preview">
    <button id="dc-preview" type="button" disabled>Open the component\u2019s non-modal preview</button>
  </div>
  <dialog id="dc-dialog" aria-labelledby="dc-dialog-title" aria-describedby="dc-dialog-description" hidden>
    <p class="eyebrow">Inside a closed shadow root</p>
    <h2 id="dc-dialog-title">A moment of focus</h2>
    <p id="dc-dialog-description">The outside Show modal button reaches this dialog through the host\u2019s Reference Target.</p>
    <p>In a modal, the rest of the page is inert. Close this dialog, then use the component\u2019s non-modal preview to try the two outside close commands.</p>
    <div class="button-row">
      <button id="dc-internal-close" type="button" disabled autofocus>Close dialog</button>
      <button id="dc-internal-request" type="button" disabled>Request close</button>
    </div>
  </dialog>
`;var l=document.createElement("link");l.rel="stylesheet";l.href=new URL(s.getAttribute("data-components-styles"),document.baseURI).href;t.prepend(l);var e=t.getElementById("dc-dialog"),i=document.getElementById("dc-observation"),r=document.getElementById("dc-cancel"),d=typeof e.showModal=="function"&&typeof e.close=="function",c=typeof e.requestClose=="function",g=globalThis.CSS?.supports("selector(:modal)")??!1,m=0,p=0;function o(){let a=`dialog: ${d?e.open?g?e.matches(":modal")?"modal":"non-modal":"open":"closed":"Dialog API unavailable"} \xB7 commands: ${m} \xB7 canceled close requests: ${p} \xB7 return value: ${e.returnValue||"(empty)"} \xB7 root: closed${c?"":" \xB7 requestClose unavailable"}`;i.textContent!==a&&(i.textContent=a)}e.addEventListener("command",()=>{m+=1,queueMicrotask(o)});e.addEventListener("cancel",n=>{r.checked&&(n.preventDefault(),r.checked=!1,p+=1),queueMicrotask(o)});e.addEventListener("close",o);e.addEventListener("toggle",o);t.getElementById("dc-preview").addEventListener("click",()=>{e.open||e.show(),o()});t.getElementById("dc-internal-close").addEventListener("click",()=>e.close("closed-inside"));t.getElementById("dc-internal-request").addEventListener("click",()=>e.requestClose("requested-inside"));u.addEventListener("click",()=>queueMicrotask(o));t.addEventListener("click",()=>queueMicrotask(o));e.hidden=!d;for(let n of u.querySelectorAll("button, input"))n.disabled=!d;for(let n of t.querySelectorAll("button"))n.disabled=!d;document.getElementById("dc-request").disabled=!(d&&c);t.getElementById("dc-internal-request").disabled=!(d&&c);o();
