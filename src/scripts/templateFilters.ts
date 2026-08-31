import * as WorkItemContracts from "TFS/WorkItemTracking/Contracts";
import { logInfo, logError } from "./logging";
import { WorkItemFields } from "./types";

function checkRules(rules: WorkItemFields | WorkItemFields[], currentWorkItem: WorkItemFields): boolean {
    if (!Array.isArray(rules))
        rules = new Array(rules);

    var matchRule = rules.some((filters: WorkItemFields) => {

        var matchFilter = Object.keys(filters).every(function (prop) {

            var matchfield = matchField(prop, currentWorkItem, filters);
            logInfo(" - filter['" + prop + "'] : '" + filters[prop] + "' - wit['" + prop + "'] : '" + currentWorkItem[prop] + "' equal ? " + matchfield);
            return matchfield
        });

        return matchFilter;
    });
    return matchRule;
}

export function IsValidTemplateWIT(currentWorkItem: WorkItemFields, taskTemplate: WorkItemContracts.WorkItemTemplate): boolean {

    logInfo("template: '" + taskTemplate.name + "'");

    // If not empty, does the description have the old square bracket approach or new JSON?
    var jsonFilters = extractJSON(taskTemplate.description)[0];
    if (IsJsonString(JSON.stringify(jsonFilters))) {
        // example JSON:
        //
        //   {
        //      "applywhen": [
        //        {
        //          "System.State": "Approved",
        //          "System.Tags" : ["Blah", "ClickMe"],
        //          "System.WorkItemType": "Product Backlog Item"
        //        },
        //        {
        //          "System.State": "Approved",
        //          "System.Tags" : ["Blah", "ClickMe"],
        //          "System.WorkItemType": "Product Backlog Item"
        //        }
        //         ],
        //      "notapplywhen": []
        //    }

        logInfo("filter: '" + JSON.stringify(jsonFilters) + "'");

        var applyWhenResult = !jsonFilters.applywhen ? true : checkRules(jsonFilters.applywhen, currentWorkItem);
        var notApplyWhenResult = !jsonFilters.notapplywhen ? false : checkRules(jsonFilters.notapplywhen, currentWorkItem);

        return applyWhenResult && !notApplyWhenResult;


    } else {
        var filters = taskTemplate.description.match(/[^[\]]+(?=])/g);

        if (filters) {
            var isValid = false;
            for (var i = 0; i < filters.length; i++) {
                var found = filters[i].split(',').find(function (f) { return f.trim().toLowerCase() == currentWorkItem["System.WorkItemType"].toLowerCase() });
                if (found) {
                    isValid = true;
                    break;
                }
            }
            return isValid;
        } else {
            return false; //Change to false to do not create templates without filter in description
        }
    }
}

function matchField(fieldName: string, currentWorkItem: WorkItemFields, filterObject: WorkItemFields): boolean {
    try {
        if (currentWorkItem[fieldName] == null)
            return false;

        if (typeof (filterObject[fieldName]) === "undefined")
            return false;

        // convert it to array for easy compare
        var filterValue = filterObject[fieldName];
        if (!Array.isArray(filterValue))
            filterValue = new Array(String(filterValue));

        var currentWorkItemValue = currentWorkItem[fieldName];
        if (fieldName == "System.Tags") {
            currentWorkItemValue = currentWorkItem[fieldName].split("; ");
        }
        else {
            if (!Array.isArray(currentWorkItemValue))
                currentWorkItemValue = new Array(String(currentWorkItemValue));
        }


        var match = filterValue.some((i: string) => {
            return currentWorkItemValue.findIndex((c: string) => i.toLowerCase() === c.toLowerCase()) >= 0;
        })

        return match;
    }
    catch (e) {
        logError('matchField ' + e);
        return false;
    }

}

export function IsValidTemplateTitle(currentWorkItem: WorkItemFields, taskTemplate: WorkItemContracts.WorkItemTemplate): boolean {
    var jsonFilters = extractJSON(taskTemplate.description)[0];
    var isJSON = IsJsonString(JSON.stringify(jsonFilters));
    if (isJSON) {
        return true;
    }
    var filters = taskTemplate.description.match(/[^{\}]+(?=})/g);
    var curTitle = String(currentWorkItem["System.Title"]).match(/[^{\}]+(?=})/g);
    if (filters) {
        var isValid = false;
        if (curTitle) {
            for (var i = 0; i < filters.length; i++) {
                if (curTitle.indexOf(filters[i]) > -1) {
                    isValid = true;
                    break;
                }
            }

        }
        return isValid;
    } else {
        return true;
    }

}

export function extractJSON(str: string): any {
    // `firstOpen` is intentionally read before assignment (mirrors pre-migration
    // behavior: `undefined + 1` -> `NaN`, which `String.indexOf` treats as `0`).
    let firstOpen: any, firstClose: any, candidate: any;
    firstOpen = str.indexOf('{', firstOpen + 1);

    if (firstOpen != -1) {
        do {
            firstClose = str.lastIndexOf('}');

            if (firstClose <= firstOpen) {
                return null;
            }
            do {
                candidate = str.substring(firstOpen, firstClose + 1);

                try {
                    var res = JSON.parse(candidate);

                    return [res, firstOpen, firstClose + 1];
                }
                catch (e) {
                    logError('extractJSON ...failed ' + e);
                }
                firstClose = str.substr(0, firstClose).lastIndexOf('}');
            } while (firstClose > firstOpen);
            firstOpen = str.indexOf('{', firstOpen + 1);
        } while (firstOpen != -1);
    } else { return ''; }
}

export function IsJsonString(str: string): boolean {
    try {
        JSON.parse(str);
    } catch (e) {
        return false;
    }
    return true;
}

export function IsPropertyValid(taskTemplate: WorkItemContracts.WorkItemTemplate, key: string): boolean {
    if (taskTemplate.fields.hasOwnProperty(key) == false) {
        return false;
    }
    if (key.indexOf('System.Tags') >= 0) { //not supporting tags for now
        return false;
    }
    if (taskTemplate.fields[key].toLowerCase() == '@me') { //current identity is handled later
        return false;
    }
    if (taskTemplate.fields[key].toLowerCase() == '@currentiteration') { //current iteration is handled later
        return false;
    }

    return true;
}

export function replaceReferenceToParentField(fieldValue: string, currentWorkItem: WorkItemFields): string {
    var originalValue = fieldValue;
    var filters = fieldValue.match(/[^{\}]+(?=})/g);
    if (filters) {
        for (var i = 0; i < filters.length; i++) {
            var parentField = filters[i];
            var parentValue = currentWorkItem[parentField];

            // The regex also matches text before a stray '}' (e.g. "abc}" -> "abc"); only log real placeholders.
            if ((parentValue === undefined || parentValue === null) && fieldValue.indexOf('{' + parentField + '}') >= 0) {
                logError("Parent field '" + parentField + "' referenced in template value '" + originalValue + "' is " + (parentValue === undefined ? "missing" : "null") + "; substituting the literal text '" + String(parentValue) + "'");
            }

            fieldValue = fieldValue.replace('{' + parentField + '}', parentValue)
        }
    }
    return fieldValue;
}
