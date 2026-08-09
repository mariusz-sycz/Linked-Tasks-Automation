import * as WorkItemContracts from "TFS/WorkItemTracking/Contracts";
import { extractJSON, IsJsonString } from "./templateFilters";

// Rule names that make a template's link target depend on tasks created earlier
// in the chain (see workItemCreation.ts's createWorkItem for the branches that
// consume these). Any other linkTo entry, or no linkTo at all, has no such
// dependency and can be created independently/in parallel.
const ORDERED_LINK_TO_RULES = [
    "ToAllJustCreatedTasks",
    "PreviouslyCreatedTask",
    "PreviouslyJustCreatedTask",
    "SecondPreviouslyJustCreatedTask",
    "FirstJustCreatedTask",
    "SecondJustCreatedTask"
].map(function (name) { return name.toUpperCase(); });

export interface TemplateClassification {
    independent: WorkItemContracts.WorkItemTemplateReference[];
    ordered: WorkItemContracts.WorkItemTemplateReference[];
}

function isOrdered(taskTemplate: WorkItemContracts.WorkItemTemplateReference): boolean {
    var jsonFilters = extractJSON(taskTemplate.description)[0];
    if (!IsJsonString(JSON.stringify(jsonFilters))) {
        return false;
    }
    if (jsonFilters.linkTo === undefined || jsonFilters.linkTo.length === 0) {
        return false;
    }
    return jsonFilters.linkTo.some(function (linkTo: string) {
        return ORDERED_LINK_TO_RULES.indexOf(linkTo.toUpperCase()) >= 0;
    });
}

export function classifyTemplates(templates: WorkItemContracts.WorkItemTemplateReference[]): TemplateClassification {
    var result: TemplateClassification = { independent: [], ordered: [] };
    templates.forEach(function (template) {
        if (isOrdered(template)) {
            result.ordered.push(template);
        } else {
            result.independent.push(template);
        }
    });
    return result;
}
