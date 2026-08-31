/// <reference path="../node_modules/vss-web-extension-sdk/typings/vss.d.ts" />
import * as _WorkItemRestClient from "TFS/WorkItemTracking/RestClient";
import * as WorkItemContracts from "TFS/WorkItemTracking/Contracts";
import * as WorkContracts from "TFS/Work/Contracts";
import { WitClient, WorkItemFields } from "./types";
import { createWorkItemFromTemplate } from "./templateBuilder";
import { IsValidTemplateWIT, IsValidTemplateTitle, extractJSON, IsJsonString } from "./templateFilters";
import { getTemplate } from "./templates";
import * as keepaliveFetch from "./keepaliveFetchClient";
import { TemplateOutcome } from "./progressDialogController";
import { logError } from "./logging";

// Resolves once this template's create+parent-link attempt has settled - never
// rejects, so callers can track every template via a plain `Promise.all` (see
// `orchestrator.ts`) without needing `Promise.allSettled`, which the project's
// ES2015 compilation target doesn't support. A template skipped by the WIT/title
// filters (i.e. it doesn't apply to this work item) resolves with status "skipped" -
// nothing was attempted for it, but it still counts toward the completion dialog's
// "N templates" total (see `TemplateOutcome` in `progressDialogController.ts`).
export function createChildFromTemplate(workItemId: number, currentWorkItem: WorkItemFields, template: WorkItemContracts.WorkItemTemplateReference, teamSettings: WorkContracts.TeamSetting, justCreatedTasks: WorkItemContracts.WorkItem[]): Promise<TemplateOutcome> {
    return Promise.resolve(getTemplate(template.id)).then(function (taskTemplate: WorkItemContracts.WorkItemTemplate): Promise<TemplateOutcome> | TemplateOutcome {
        // Create child
        if (IsValidTemplateWIT(currentWorkItem, taskTemplate)) {
            if (IsValidTemplateTitle(currentWorkItem, taskTemplate)) {
                return createWorkItem(workItemId, currentWorkItem, taskTemplate, teamSettings, justCreatedTasks);
            }
        }
        return { templateName: taskTemplate.name, status: "skipped" };
    }, function (error: any): TemplateOutcome {
        logError('Failed to fetch template ' + template.name + ' for work item ' + workItemId + ': ' + error);
        return { templateName: template.name, status: "failed" };
    });
}

function getRelatedWorkItems(witClient: WitClient, workItemId: number, relationTypeToFilter: string, itemToLinkTo: WorkItemContracts.WorkItem, relationTypeToLinkAs: string): void {
    console.log("Getting all '" + relationTypeToFilter + "' related tasks for: " + workItemId);
    let workItemExpand: WorkItemContracts.WorkItemExpand = WorkItemContracts.WorkItemExpand.Relations; // 1- Relations
    witClient.getWorkItem(workItemId, undefined, undefined, workItemExpand).then(function (result: WorkItemContracts.WorkItem) {
        if (result != null && result.relations != null) {
            const relatedItems = result.relations.filter((el) => el.rel === relationTypeToFilter);
            console.log("Found " + relatedItems.length + " off all " + result.relations.length + " relations:");
            console.log(relatedItems);
            console.log(result.relations);
            relatedItems.forEach(function (item) {
                console.log('Linking to:' + item.url);
                if (itemToLinkTo.url !== item.url) {
                    linkItems(itemToLinkTo.id, relationTypeToLinkAs, item.url)
                }
            });
        }
    });
}

function createWorkItem(workItemId: number, currentWorkItem: WorkItemFields, taskTemplate: WorkItemContracts.WorkItemTemplate, teamSettings: WorkContracts.TeamSetting, justCreatedTasks: WorkItemContracts.WorkItem[]): Promise<TemplateOutcome> {

    var witClient: WitClient = _WorkItemRestClient.getClient();

    var built = createWorkItemFromTemplate(currentWorkItem, taskTemplate, teamSettings);

    return keepaliveFetch.createWorkItem(built.patchDocument, taskTemplate.workItemTypeName)
        .then(function (response: WorkItemContracts.WorkItem): Promise<TemplateOutcome> {
            console.log('Request to create work item request:');
            console.log(built.patchDocument);
            console.log('Respond with result:');
            console.log(response);
            justCreatedTasks.push(response);

            console.log('Proceed with created task: ' + response.id);
            console.log('Linking to Parent:');
            // Top-level outcome for this template: create + link-to-parent. The
            // linkTo-rule calls below (ToAllOtherChilds, ToAllJustCreatedTasks, etc.)
            // stay fire-and-forget exactly as before - their return values are not
            // chained into this outcome.
            var parentLinkPromise = linkItems(workItemId, "System.LinkTypes.Hierarchy-Forward", response.url);

            var jsonFilters = extractJSON(taskTemplate.description)[0];
            if (IsJsonString(JSON.stringify(jsonFilters))) {
                if (jsonFilters.linkTo !== undefined && jsonFilters.linkTo.length > 0) {
                    console.log('Task should be linked to:');
                    console.log(jsonFilters.linkTo);
                    jsonFilters.linkTo.forEach(function (linkTo: string) {
                        console.log('Start linking for: ' + linkTo);
                        let linkToItem = linkTo.toUpperCase();
                        if (linkToItem == 'ToAllOtherChilds'.toUpperCase()) {
                            console.log('Linking to ToAllOtherChilds');
                            getRelatedWorkItems(witClient, workItemId, 'System.LinkTypes.Hierarchy-Forward', response, 'System.LinkTypes.Related');
                        }
                        else if (linkToItem == 'ToAllJustCreatedTasks'.toUpperCase()) {
                            console.log('Linking to ToAllJustCreatedTasks:');
                            console.log(justCreatedTasks);
                            justCreatedTasks.forEach(function (item) {
                                console.log('Linking to:' + item.url);
                                if (response.url !== item.url) {
                                    linkItems(response.id, "System.LinkTypes.Related", item.url)
                                }
                            });
                        }
                        else if (linkToItem == 'PreviouslyCreatedTask'.toUpperCase()) {
                            // Currently equivalent to PreviouslyJustCreatedTask.
                            console.log('Linking to PreviouslyCreatedTask');
                            if (justCreatedTasks.length > 1) {
                                var previouslyCreatedTask = justCreatedTasks[justCreatedTasks.length - 2];
                                console.log('Linking to:' + previouslyCreatedTask.url);
                                linkItems(response.id, "System.LinkTypes.Related", previouslyCreatedTask.url)
                            }
                        }
                        else if (linkToItem == 'PreviouslyJustCreatedTask'.toUpperCase()) {
                            // Currently equivalent to PreviouslyCreatedTask.
                            console.log('Linking to PreviouslyJustCreatedTask');
                            if (justCreatedTasks.length > 1) {
                                var previouslyCreatedTask = justCreatedTasks[justCreatedTasks.length - 2];
                                console.log('Linking to:' + previouslyCreatedTask.url);
                                linkItems(response.id, "System.LinkTypes.Related", previouslyCreatedTask.url)
                            }
                        }
                        else if (linkToItem == 'SecondPreviouslyJustCreatedTask'.toUpperCase()) {
                            console.log('Linking to SecondPreviouslyJustCreatedTask');
                            if (justCreatedTasks.length > 2) {
                                var previouslyCreatedTask = justCreatedTasks[justCreatedTasks.length - 3];
                                console.log('Linking to:' + previouslyCreatedTask.url);
                                linkItems(response.id, "System.LinkTypes.Related", previouslyCreatedTask.url)
                            }
                        }
                        else if (linkToItem == 'FirstJustCreatedTask'.toUpperCase()) {
                            console.log('Linking to FirstJustCreatedTask');
                            if (justCreatedTasks.length > 1) {
                                var previouslyCreatedTask = justCreatedTasks[0];
                                console.log('Linking to:' + previouslyCreatedTask.url);
                                linkItems(response.id, "System.LinkTypes.Related", previouslyCreatedTask.url)
                            }
                        }
                        else if (linkToItem == 'SecondJustCreatedTask'.toUpperCase()) {
                            console.log('Linking to SecondJustCreatedTask');
                            if (justCreatedTasks.length > 2) {
                                var previouslyCreatedTask = justCreatedTasks[1];
                                console.log('Linking to:' + previouslyCreatedTask.url);
                                linkItems(response.id, "System.LinkTypes.Related", previouslyCreatedTask.url)
                            }
                        }
                    });
                }
            }

            return parentLinkPromise.then(function (parentLinkSucceeded: boolean): TemplateOutcome {
                if (!parentLinkSucceeded) {
                    logError('Failed to link created task ' + response.id + ' to parent ' + workItemId + '.');
                    return { templateName: taskTemplate.name, status: "failed" };
                }
                if (built.skippedFields.length > 0) {
                    return { templateName: taskTemplate.name, status: "created", skippedFields: built.skippedFields };
                }
                return { templateName: taskTemplate.name, status: "created" };
            });
        }, function (error: any): TemplateOutcome {
            console.log('Request to create work item request:');
            console.log(built.patchDocument);
            console.log('Respond with ERROR result:');
            console.log(error);
            if (IsJsonString(error)) {
                var errorObj = extractJSON(error);
                console.log(errorObj);
            }
            logError('Failed to create work item from template ' + taskTemplate.name + ' for work item ' + workItemId + ': ' + error);
            return { templateName: taskTemplate.name, status: "failed" };
        });
}

// Returns whether the link succeeded, resolving in both the success and failure
// case (never rejects) so existing fire-and-forget callers - which ignore the
// returned promise entirely - keep behaving exactly as before, while callers that
// need the outcome (the parent-link call in `createWorkItem`) can observe it.
function linkItems(newWorkItemId: number, relType: string, existedItemUrl: string): Promise<boolean> {
    // JSON-Patch operation array: the SDK types `JsonPatchDocument` as an empty
    // interface, so this loosely-typed array satisfies it structurally (Core
    // Requirement 6 / spec Open Questions allowance).
    var document: WorkItemFields[] = [{
        op: "add",
        path: '/relations/-',
        value: {
            rel: relType,
            url: existedItemUrl,
            attributes: {
                isLocked: false,
            }
        }
    }];
    console.log('Send doc:');
    return keepaliveFetch.updateWorkItem(document, newWorkItemId)
        .then(function (response: WorkItemContracts.WorkItem) {
            console.log('Request to update taskId:' + newWorkItemId + ' with document: ');
            console.log(document);
            console.log('Respond with result:');
            console.log(response);
            return true;
        }, function (error: any) {
            console.log('Request to update taskId:' + newWorkItemId + ' with document: ');
            console.log(document);
            console.log('Respond with ERROR result:');
            console.log(error);
            return false;
        });
}
