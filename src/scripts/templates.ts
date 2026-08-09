import * as _WorkItemRestClient from "TFS/WorkItemTracking/RestClient";
import * as WorkItemContracts from "TFS/WorkItemTracking/Contracts";
import * as Q from "q";
import { WitClient } from "./types";
import * as ctxState from "./context";
import { buildTemplateCacheKey, getFreshCacheEntry, writeCacheEntry } from "./templateCache";

export function getTemplate(id: string) {
    var cacheKey = buildTemplateCacheKey([id]);
    var cached = getFreshCacheEntry<WorkItemContracts.WorkItemTemplate>(cacheKey);
    if (cached != null) {
        return Q.when(cached);
    }

    var witClient: WitClient = _WorkItemRestClient.getClient();
    return Q(witClient.getTemplate(ctxState.ctx.project.id, ctxState.ctx.team.id, id))
        .then(function (template: WorkItemContracts.WorkItemTemplate) {
            writeCacheEntry(cacheKey, template);
            return template;
        });
}


export function SortTemplates(a: WorkItemContracts.WorkItemTemplateReference, b: WorkItemContracts.WorkItemTemplateReference): number {
    var nameA = a.name.toLowerCase(), nameB = b.name.toLowerCase();
    if (nameA < nameB) //sort string ascending
        return -1;
    if (nameA > nameB)
        return 1;
    return 0; //default return value (no sorting)
}

export function getTemplates(workItemTypes: string[]) {

    var cacheKey = buildTemplateCacheKey(workItemTypes);
    var cached = getFreshCacheEntry<WorkItemContracts.WorkItemTemplateReference[]>(cacheKey);
    if (cached != null) {
        return Q.when(cached);
    }

    // Heterogeneous accumulator of in-flight REST promises (SDK `IPromise`, fed to
    // Q.all) — kept as `any[]` rather than forcing IPromise/Q.Promise generic
    // alignment across the two promise libraries in play here.
    var requests: any[] = []
    var witClient: WitClient = _WorkItemRestClient.getClient();

    workItemTypes.forEach(function (workItemType) {

        var request = witClient.getTemplates(ctxState.ctx.project.id, ctxState.ctx.team.id, workItemType);
        requests.push(request);
    });

    return Q.all(requests)
        .then(function (templateTypes: WorkItemContracts.WorkItemTemplateReference[][]) {

            var templates: WorkItemContracts.WorkItemTemplateReference[] = [];
            templateTypes.forEach(function (templateType) {
                if (templateType.length > 0) {

                    templateType.forEach(function (element) {
                        templates.push(element)
                    });
                }
            });
            writeCacheEntry(cacheKey, templates);
            return templates;
        });
}
