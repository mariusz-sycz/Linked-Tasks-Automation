import * as _WorkItemRestClient from "TFS/WorkItemTracking/RestClient";
import * as WorkItemContracts from "TFS/WorkItemTracking/Contracts";
import * as workRestClient from "TFS/Work/RestClient";
import * as WorkContracts from "TFS/Work/Contracts";
import * as CoreContracts from "TFS/Core/Contracts";
import { WitClient, WorkClient, WorkItemFields } from "./types";
import * as ctxState from "./context";
import { GetChildTypes } from "./childTypes";
import { getTemplates, SortTemplates } from "./templates";
import { createChildFromTemplate } from "./workItemCreation";
import { classifyTemplates } from "./templateClassifier";
import { TemplateOutcome } from "./progressDialogController";
import { buildTemplateCacheKey, getFreshCacheEntry, writeCacheEntry } from "./templateCache";
import { logError } from "./logging";

// Cache-check-first wrapper around `workClient.getTeamSettings`, scoped by project +
// team (unlike work item type categories, team settings can differ per team).
// Wrapped in `Promise.resolve(...)` on both paths so it fits the existing
// `Promise.all([...])` dispatch alongside `getWorkItem` below.
function getCachedTeamSettings(workClient: WorkClient, team: CoreContracts.TeamContext): Promise<WorkContracts.TeamSetting> {
    var cacheKey = buildTemplateCacheKey(["teamSettings"]);
    var cached = getFreshCacheEntry<WorkContracts.TeamSetting>(cacheKey);
    if (cached != null) {
        return Promise.resolve(cached);
    }
    return Promise.resolve(workClient.getTeamSettings(team))
        .then(function (response: WorkContracts.TeamSetting) {
            writeCacheEntry(cacheKey, response);
            return response;
        });
}

// Dispatches the ordered-group templates one at a time, in `templates` order: each
// template's create+parent-link outcome (see `createChildFromTemplate`) must fully
// resolve - including the synchronous `justCreatedTasks.push()` inside
// `createWorkItem`'s success branch - before the next one is dispatched, since later
// ordered templates may link to tasks created by earlier ones (see
// `templateClassifier.ts`). The `justCreatedTasks` array passed in here MUST be
// dedicated to this ordered chain only (see `orderedJustCreatedTasks` in `AddTasks`)
// - if the independent group's concurrent creates also pushed into it, their pushes
// could interleave with this chain's, corrupting the positional `linkTo` reads
// below (`PreviouslyCreatedTask`, `FirstJustCreatedTask`, etc. all assume a
// deterministic push order that only holds when nothing else writes concurrently).
async function createOrderedChildrenSequentially(
    workItemId: number,
    currentWorkItem: WorkItemFields,
    orderedTemplates: WorkItemContracts.WorkItemTemplateReference[],
    teamSettings: WorkContracts.TeamSetting,
    justCreatedTasks: WorkItemContracts.WorkItem[]
): Promise<TemplateOutcome[]> {
    var outcomes: TemplateOutcome[] = [];
    for (const template of orderedTemplates) {
        var outcome = await createChildFromTemplate(workItemId, currentWorkItem, template, teamSettings, justCreatedTasks);
        outcomes.push(outcome);
    }
    return outcomes;
}

export function AddTasks(workItemId: number): Promise<TemplateOutcome[]> {
    var witClient: WitClient = _WorkItemRestClient.getClient();
    var workClient: WorkClient = workRestClient.getClient();

    // Only projectId/teamId are populated (matches existing runtime behavior); the
    // REST client only reads those two members despite TeamContext also declaring
    // `project`/`team` as required.
    var team = {
        projectId: ctxState.ctx.project.id,
        teamId: ctxState.ctx.team.id
    } as CoreContracts.TeamContext;

    // Two separate arrays, not one: the independent group runs concurrently
    // (`Promise.all` below) while the ordered group runs sequentially
    // (`createOrderedChildrenSequentially`). If both dispatch groups pushed into the
    // same array, the independent group's concurrent pushes could interleave with
    // the ordered group's, corrupting the ordered group's positional `linkTo` reads
    // in `createWorkItem` (see verification report: shared-array race condition).
    // `justCreatedTasks` remains an inert write for the independent group - no
    // independent template ever has a `justCreatedTasks`-derived `linkTo` rule (see
    // `templateClassifier.ts`) - while `orderedJustCreatedTasks` is the ordered
    // chain's own array that nothing else writes into.
    var justCreatedTasks: WorkItemContracts.WorkItem[] = [];
    var orderedJustCreatedTasks: WorkItemContracts.WorkItem[] = [];

    // Team settings and the current work item don't depend on each other, so fetch
    // them concurrently rather than nesting one inside the other's `.then()`.
    return Promise.all([
        getCachedTeamSettings(workClient, team),
        Promise.resolve(witClient.getWorkItem(workItemId))
    ])
        .then(function (results) {
            var teamSettings: WorkContracts.TeamSetting = results[0];
            var currentWorkItemResponse: WorkItemContracts.WorkItem = results[1];
            var currentWorkItem: WorkItemFields = currentWorkItemResponse.fields;

            currentWorkItem['System.Id'] = workItemId;

            var workItemType = currentWorkItem["System.WorkItemType"];
            return Promise.resolve(GetChildTypes(witClient, workItemType, teamSettings))
                .then(function (childTypes: string[] | undefined) {
                    if (childTypes == null)
                        return [];
                    // get Templates
                    return Promise.resolve(getTemplates(childTypes))
                        .then(function (response: WorkItemContracts.WorkItemTemplateReference[]) {
                            if (response.length == 0) {
                                console.log('No ' + childTypes + ' templates found. Please add ' + childTypes + ' templates for the project team.');
                                return [];
                            }
                            // Create children alphabetically.
                            var templates = response.sort(SortTemplates);

                            var classification = classifyTemplates(templates);

                            // Independent templates don't depend on any other template's
                            // outcome, so they're dispatched together; ordered templates are
                            // dispatched one at a time (see `createOrderedChildrenSequentially`).
                            var independentOutcomes = Promise.all(classification.independent.map(function (template) {
                                return createChildFromTemplate(workItemId, currentWorkItem, template, teamSettings, justCreatedTasks);
                            }));
                            var orderedOutcomes = createOrderedChildrenSequentially(workItemId, currentWorkItem, classification.ordered, teamSettings, orderedJustCreatedTasks);

                            return Promise.all([independentOutcomes, orderedOutcomes])
                                .then(function (outcomeGroups) {
                                    var outcomes: TemplateOutcome[] = outcomeGroups[0].concat(outcomeGroups[1]);
                                    return outcomes;
                                });
                        });
                });
        })
        .catch(function (error: any) {
            logError('AddTasks failed for work item ' + workItemId + ': ' + error);
            return [{ templateName: '(failed before any template was processed)', status: "failed" }];
        });
}
