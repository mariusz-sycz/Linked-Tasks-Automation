import * as WorkItemContracts from "TFS/WorkItemTracking/Contracts";
import * as WorkContracts from "TFS/Work/Contracts";
import { WorkItemFields } from "./types";
import * as ctxState from "./context";
import { IsPropertyValid, replaceReferenceToParentField } from "./templateFilters";
import { isExpression, evaluateExpression } from "./expressionEvaluator";
import { logError } from "./logging";

export interface BuiltWorkItem {
    patchDocument: WorkItemFields[];
    // Field reference names whose `=` expression failed to evaluate, in template order.
    skippedFields: string[];
}

export function createWorkItemFromTemplate(currentWorkItem: WorkItemFields, taskTemplate: WorkItemContracts.WorkItemTemplate, teamSettings: WorkContracts.TeamSetting): BuiltWorkItem {
    // JSON-Patch operation array; see note on `linkItems`'s `document` above.
    var workItem: WorkItemFields[] = [];
    var skippedFields: string[] = [];

    for (var key in taskTemplate.fields) {
        if (IsPropertyValid(taskTemplate, key)) {
            //if field value is empty copies value from parent
            if (taskTemplate.fields[key] == '') {
                if (currentWorkItem[key] != null) {
                    workItem.push({ "op": "add", "path": "/fields/" + key, "value": currentWorkItem[key] })
                }
            }
            else {
                var fieldValue = taskTemplate.fields[key];
                if (isExpression(fieldValue)) {
                    var result = evaluateExpression(fieldValue, currentWorkItem);
                    if (result.ok) {
                        workItem.push({ "op": "add", "path": "/fields/" + key, "value": result.value })
                    }
                    else {
                        logError("Template '" + taskTemplate.name + "' field '" + key + "': expression '" + fieldValue + "' skipped - " + result.reason);
                        skippedFields.push(key);
                    }
                }
                else {
                    //check for references to parent fields - {fieldName}
                    fieldValue = replaceReferenceToParentField(fieldValue, currentWorkItem);

                    workItem.push({ "op": "add", "path": "/fields/" + key, "value": fieldValue })
                }
            }
        }
    }

    // if template has no title field copies value from parent
    if (taskTemplate.fields['System.Title'] == null)
        workItem.push({ "op": "add", "path": "/fields/System.Title", "value": currentWorkItem['System.Title'] })

    // if template has no AreaPath field copies value from parent
    if (taskTemplate.fields['System.AreaPath'] == null)
        workItem.push({ "op": "add", "path": "/fields/System.AreaPath", "value": currentWorkItem['System.AreaPath'] })

    // if template has no IterationPath field copies value from parent
    // check if IterationPath field value is @currentiteration
    if (taskTemplate.fields['System.IterationPath'] == null)
        workItem.push({ "op": "add", "path": "/fields/System.IterationPath", "value": currentWorkItem['System.IterationPath'] })
    else if (taskTemplate.fields['System.IterationPath'].toLowerCase() == '@currentiteration')
        workItem.push({ "op": "add", "path": "/fields/System.IterationPath", "value": teamSettings.backlogIteration.name + teamSettings.defaultIteration.path })

    // check if AssignedTo field value is @me
    if (taskTemplate.fields['System.AssignedTo'] != null) {
        if (taskTemplate.fields['System.AssignedTo'].toLowerCase() == '@me') {
            workItem.push({ "op": "add", "path": "/fields/System.AssignedTo", "value": ctxState.ctx.user.uniqueName })
        }

        // if (taskTemplate.fields['System.AssignedTo'].toLowerCase() == '') {
        //     if (WIT['System.AssignedTo'] != null) {
        //         workItem.push({ "op": "add", "path": "/fields/System.AssignedTo", "value": currentWorkItem['System.AssignedTo'] })
        //     }
        // }
    }

    return { patchDocument: workItem, skippedFields: skippedFields };
}
