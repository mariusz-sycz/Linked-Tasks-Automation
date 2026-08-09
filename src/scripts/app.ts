/// <reference path="../node_modules/vss-web-extension-sdk/typings/vss.d.ts" />
/// <reference path="../node_modules/vss-web-extension-sdk/typings/tfs.d.ts" />
import { logInfo } from "./logging";
import * as ctxState from "./context";
import { AddTasks } from "./orchestrator";
import { getFreshCacheEntry, writeCacheEntry } from "./templateCache";
import { showStartDialog, showCompletionDialog, TemplateOutcome } from "./progressDialogController";

// Static, globally-scoped (no project/team) key gating the start dialog. Deliberately
// decoupled from the real template cache's project/team-scoped entries: it only
// tracks "was the start notice shown recently," not whether cached template data is
// warm, so the check can run synchronously before `ctx` is even set. Same 4h TTL as
// the rest of the cache (see `templateCache.ts`), so switching projects/teams within
// that window still suppresses the notice - a deliberate simplification.
const DIALOG_GATE_CACHE_KEY = "linkedTasksAutomation.templateCache.dialogGate.DialogShowedBeforeCacheLoaded";

export function create(context: any): void {
    logInfo('init v0.0.1');
    console.log(context);

    var workItemIds: number[] = [];
    if (context.workItemIds && context.workItemIds.length > 0) {
        context.workItemIds.forEach(function (workItemId: number) {
            workItemIds.push(workItemId);
        });
    }
    else if (context.id) {
        workItemIds.push(context.id);
    }
    else if (context.workItemId) {
        workItemIds.push(context.workItemId);
    }

    if (workItemIds.length == 0) {
        return;
    }

    // Only show (and refresh) the start notice when it hasn't fired recently, so the
    // 4h suppression window starts from the last time it was actually shown rather
    // than being extended by every silent run.
    if (!getFreshCacheEntry<boolean>(DIALOG_GATE_CACHE_KEY)) {
        showStartDialog(workItemIds);
        writeCacheEntry(DIALOG_GATE_CACHE_KEY, true);
    }

    ctxState.setCtx(VSS.getWebContext());

    Promise.all(workItemIds.map(function (workItemId: number) {
        console.log('AddTasks for: ' + workItemId);
        return AddTasks(workItemId).then(function (outcomes: TemplateOutcome[]) {
            return { workItemId: workItemId, outcomes: outcomes };
        });
    }))
        .then(function (perWorkItemResults) {
            showCompletionDialog(perWorkItemResults);
        });
}
