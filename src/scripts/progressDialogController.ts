/// <reference path="../node_modules/vss-web-extension-sdk/typings/vss.d.ts" />
import { logInfo, logError } from "./logging";

/**
 * Outcome of a single template for one work item: `created` (matched the filter and
 * the work item was created), `failed` (matched the filter but create/link errored),
 * or `skipped` (didn't match the WIT/title filter - nothing was attempted). Every
 * candidate template gets exactly one outcome, so `outcomes.length` is always the
 * true total template count and `showCompletionDialog` needs no separate counter
 * threaded alongside it. `skippedFields` holds the field reference names whose `=`
 * expression failed to evaluate; it is present only on `created` outcomes and only
 * when non-empty.
 */
export type TemplateOutcomeStatus = "created" | "failed" | "skipped";

export interface TemplateOutcome {
    templateName: string;
    status: TemplateOutcomeStatus;
    skippedFields?: string[];
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
 * Builds the completion dialog text. Kept separate from `showCompletionDialog` so the
 * wording is a pure function that can be unit-tested without the `VSS` global. Skipped
 * fields surface as a per-template count only - the field names and expressions are
 * already in the console log, and the dialog stays free of internals.
 */
export function formatCompletionMessage(perWorkItemOutcomes: { workItemId: number, outcomes: TemplateOutcome[] }[]): string {
    var lines = perWorkItemOutcomes.map(function (perWorkItem) {
        var total = perWorkItem.outcomes.length;
        var succeededCount = perWorkItem.outcomes.filter(function (outcome) { return outcome.status === "created"; }).length;
        var failedTemplateNames = perWorkItem.outcomes
            .filter(function (outcome) { return outcome.status === "failed"; })
            .map(function (outcome) { return outcome.templateName; });
        var warnings = perWorkItem.outcomes
            .filter(function (outcome) { return outcome.status === "created" && outcome.skippedFields !== undefined && outcome.skippedFields.length > 0; })
            .map(function (outcome) { return outcome.templateName + ' (' + formatSkippedFieldCount(outcome.skippedFields!.length) + ')'; });

        var line = 'Work item #' + perWorkItem.workItemId + ': ' + succeededCount + ' tasks of ' + total + ' templates created';
        if (failedTemplateNames.length > 0) {
            line += '. Failed: ' + failedTemplateNames.join(', ');
        }
        if (warnings.length > 0) {
            line += '. Warnings: ' + warnings.join(', ');
        }
        return line;
    });

    return 'Task creation finished:\n\n' + lines.join('\n');
}

function formatSkippedFieldCount(count: number): string {
    return count === 1 ? '1 field skipped' : count + ' fields skipped';
}

/**
 * Opens the completion dialog once every work item in the batch has settled, listing
 * a one-line "X tasks of N templates created" breakdown per work item (plus failed
 * template names when there are any failures, and warnings naming templates whose
 * fields were skipped over an expression that could not be evaluated). `N` is
 * `outcomes.length` - every candidate template found for the work item's type gets
 * exactly one outcome (`created`/`failed`/`skipped`), so the total naturally includes
 * templates that were skipped as not-applicable, not just the ones actually
 * attempted. Fire-and-forget, same rationale as `showStartDialog`.
 */
export function showCompletionDialog(perWorkItemOutcomes: { workItemId: number, outcomes: TemplateOutcome[] }[]): void {
    var message = formatCompletionMessage(perWorkItemOutcomes);
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
