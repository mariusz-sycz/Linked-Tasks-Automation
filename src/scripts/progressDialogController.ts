/// <reference path="../node_modules/vss-web-extension-sdk/typings/vss.d.ts" />
import { logInfo, logError } from "./logging";

/**
 * Outcome of a single template's create/link attempt for one work item. The
 * orchestrator (Group 9) derives these from its `Promise.allSettled` results and
 * passes them to `showCompletionDialog` to build the partial-failure summary.
 */
export interface TemplateOutcome {
    templateName: string;
    succeeded: boolean;
}

function getDialogService(): IPromise<IHostDialogService> {
    return VSS.getService<IHostDialogService>(VSS.ServiceIds.Dialog);
}

/**
 * Opens the "Starting task creation..." dialog as soon as the target work item id(s)
 * are known, listing every id in the batch in a single message. Fire-and-forget:
 * `openMessageDialog`'s returned promise only resolves once the user dismisses the
 * dialog, so callers must not await this function before proceeding with task
 * creation. Failure to resolve the dialog service or open the dialog is logged
 * rather than thrown, since a missing progress dialog must never block task creation
 * itself.
 */
export function showStartDialog(workItemIds: number[]): void {
    var message = 'Starting task creation for work item(s) '
        + workItemIds.map(function (id) { return '#' + id; }).join(', ')
        + ' in the background. This may take a little longer than usual — cached data refreshes every 4 hours, and processing more items takes more time.';

    getDialogService()
        .then(function (dialogService: IHostDialogService) {
            return dialogService.openMessageDialog(message, {
                title: 'Linked Tasks Automation',
                buttons: [dialogService.buttons.ok]
            });
        })
        .then(function () { /* dismissed by user, nothing further to do */ }, function (error: any) {
            logError('showStartDialog failed: ' + error);
        });
}

/**
 * Opens the completion dialog once every work item in the batch has settled, listing
 * a one-line "X of Y tasks created" breakdown per work item (plus failed template
 * names when there are any failures). Fire-and-forget, same rationale as
 * `showStartDialog`.
 */
export function showCompletionDialog(perWorkItemOutcomes: { workItemId: number, outcomes: TemplateOutcome[] }[]): void {
    var lines = perWorkItemOutcomes.map(function (perWorkItem) {
        var total = perWorkItem.outcomes.length;
        var succeededCount = perWorkItem.outcomes.filter(function (outcome) { return outcome.succeeded; }).length;
        var failedTemplateNames = perWorkItem.outcomes
            .filter(function (outcome) { return !outcome.succeeded; })
            .map(function (outcome) { return outcome.templateName; });

        var line = 'Work item #' + perWorkItem.workItemId + ': ' + succeededCount + ' of ' + total + ' tasks created';
        if (failedTemplateNames.length > 0) {
            line += '. Failed: ' + failedTemplateNames.join(', ');
        }
        return line;
    });

    var message = 'Task creation finished:\n\n' + lines.join('\n');
    logInfo(message);

    getDialogService()
        .then(function (dialogService: IHostDialogService) {
            return dialogService.openMessageDialog(message, {
                title: 'Linked Tasks Automation',
                buttons: [dialogService.buttons.ok]
            });
        })
        .then(function () { /* dismissed by user, nothing further to do */ }, function (error: any) {
            logError('showCompletionDialog failed: ' + error);
        });
}
