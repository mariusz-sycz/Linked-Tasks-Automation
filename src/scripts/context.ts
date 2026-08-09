/// <reference path="../node_modules/vss-web-extension-sdk/typings/vss.d.ts" />

export let ctx: WebContext;

// ES/AMD module bindings are read-only from importing modules, even for `let`
// exports (TS2540) — this setter is the wiring an importer needs to update ctx.
export function setCtx(newCtx: WebContext): void {
    ctx = newCtx;
}
