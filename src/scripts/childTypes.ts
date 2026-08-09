/// <reference path="../node_modules/vss-web-extension-sdk/typings/vss.d.ts" />
import * as WorkItemContracts from "TFS/WorkItemTracking/Contracts";
import * as WorkContracts from "TFS/Work/Contracts";
import * as Q from "q";
import { WitClient } from "./types";
import { buildProjectCacheKey, getFreshCacheEntry, writeCacheEntry } from "./templateCache";

function findWorkTypeCategory(categories: WorkItemContracts.WorkItemTypeCategory[], workItemType: string): WorkItemContracts.WorkItemTypeCategory | undefined {
    for (const category of categories) {
        var found = category.workItemTypes.find(function (w) { return w.name == workItemType; });
        if (found != null) {
            return category;
        }
    }
}

// Cache-check-first wrapper around `witClient.getWorkItemTypeCategories`, scoped by
// project only (this data doesn't vary per team). Wrapped in `Q(...)` on the
// cache-hit path so callers get the same `Q.Promise` shape regardless of hit/miss.
function getCachedWorkItemTypeCategories(witClient: WitClient, projectName: string): Q.Promise<WorkItemContracts.WorkItemTypeCategory[]> {
    var cacheKey = buildProjectCacheKey(["workItemTypeCategories"]);
    var cached = getFreshCacheEntry<WorkItemContracts.WorkItemTypeCategory[]>(cacheKey);
    if (cached != null) {
        return Q(cached);
    }
    return Q(witClient.getWorkItemTypeCategories(projectName))
        .then(function (response: WorkItemContracts.WorkItemTypeCategory[]) {
            writeCacheEntry(cacheKey, response);
            return response;
        });
}

// Cache-check-first wrapper around `witClient.getWorkItemTypeCategory`, scoped by
// project + category ref name. Same `Q(...)` shape-matching rationale as
// `getCachedWorkItemTypeCategories`.
function getCachedWorkItemTypeCategory(witClient: WitClient, projectName: string, categoryRefName: string): Q.Promise<WorkItemContracts.WorkItemTypeCategory> {
    var cacheKey = buildProjectCacheKey(["workItemTypeCategory", categoryRefName]);
    var cached = getFreshCacheEntry<WorkItemContracts.WorkItemTypeCategory>(cacheKey);
    if (cached != null) {
        return Q(cached);
    }
    return Q(witClient.getWorkItemTypeCategory(projectName, categoryRefName))
        .then(function (response: WorkItemContracts.WorkItemTypeCategory) {
            writeCacheEntry(cacheKey, response);
            return response;
        });
}

export function GetChildTypes(witClient: WitClient, workItemType: string, teamSettings: WorkContracts.TeamSetting) {

    return getCachedWorkItemTypeCategories(witClient, VSS.getWebContext().project.name)
        .then(function (response: WorkItemContracts.WorkItemTypeCategory[]) {
            var categories = response;
            var category = findWorkTypeCategory(categories, workItemType);

            if (category != null) {
                // Heterogeneous accumulator of in-flight REST promises; see note on
                // `getTemplates`'s `requests` above.
                var requests: any[] = [];

                // Numeric enum compared against string literals below — pre-existing
                // behavior preserved as-is (not a logic change in scope for this
                // migration); cast to `any` so the comparisons keep compiling exactly
                // as they ran before.
                var bugsBehavior: any = teamSettings.bugsBehavior; //Off, AsTasks, AsRequirements

                if (category.referenceName === 'Microsoft.EpicCategory') {
                    return getCachedWorkItemTypeCategory(witClient, VSS.getWebContext().project.name, 'Microsoft.FeatureCategory')
                        .then(function (response: WorkItemContracts.WorkItemTypeCategory) {
                            var category = response;

                            return category.workItemTypes.map(function (item) { return item.name; });
                        });
                } else if (category.referenceName === 'Microsoft.FeatureCategory') {
                    requests.push(getCachedWorkItemTypeCategory(witClient, VSS.getWebContext().project.name, 'Microsoft.RequirementCategory'));
                    if (bugsBehavior === 'AsRequirements') {
                        requests.push(getCachedWorkItemTypeCategory(witClient, VSS.getWebContext().project.name, 'Microsoft.BugCategory'));
                    }
                } else if (category.referenceName === 'Microsoft.RequirementCategory') {
                    requests.push(getCachedWorkItemTypeCategory(witClient, VSS.getWebContext().project.name, 'Microsoft.TaskCategory'));
                    requests.push(getCachedWorkItemTypeCategory(witClient, VSS.getWebContext().project.name, 'Microsoft.TestCaseCategory'));
                    if (bugsBehavior === 'AsTasks') {
                        requests.push(getCachedWorkItemTypeCategory(witClient, VSS.getWebContext().project.name, 'Microsoft.BugCategory'));
                    }
                } else if (category.referenceName === 'Microsoft.BugCategory' && bugsBehavior === 'AsRequirements') {
                    requests.push(getCachedWorkItemTypeCategory(witClient, VSS.getWebContext().project.name, 'Microsoft.TaskCategory'));
                } else if (category.referenceName === 'Microsoft.TaskCategory') {
                    requests.push(getCachedWorkItemTypeCategory(witClient, VSS.getWebContext().project.name, 'Microsoft.TaskCategory'));
                } else if (category.referenceName == 'Microsoft.BugCategory') {
                    requests.push(getCachedWorkItemTypeCategory(witClient, VSS.getWebContext().project.name, 'Microsoft.TaskCategory'));
                }

                return Q.all(requests)
                    .then(function (response: WorkItemContracts.WorkItemTypeCategory[]) {
                        var categories = response;

                        var result: string[] = [];
                        categories.forEach(function (category) {
                            category.workItemTypes.forEach(function (workItemType) {
                                result.push(workItemType.name);
                            });
                        });
                        return result;
                    });


            }
        });
}
