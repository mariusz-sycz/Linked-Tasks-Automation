import * as WorkItemContracts from "TFS/WorkItemTracking/Contracts";
import { WorkItemFields } from "./types";
import * as ctxState from "./context";
import { getAccessToken } from "./authTokenProvider";
import { logInfo, logError } from "./logging";

// Azure DevOps Work Item Tracking REST API version targeted by the requests below.
const API_VERSION = "7.1";

/**
 * Endpoint shape used here — `PATCH {collection}{project}/_apis/wit/workitems/${type}?api-version=7.1`
 * to create a work item, `PATCH {collection}{project}/_apis/wit/workitems/{id}?api-version=7.1`
 * to update/link one — is taken from Microsoft's publicly documented Work Item Tracking
 * REST API conventions. It was NOT captured from a live network trace: live devtools
 * access to a real Azure DevOps org session was unavailable in this environment (spec
 * Core Requirement 9), and the operator explicitly chose to proceed on public-docs
 * conventions instead of blocking on that dependency. This MUST be confirmed against a
 * real network capture before production use.
 *
 * `ctxState.ctx.project.name` is percent-encoded here since project names commonly
 * contain spaces. `idOrType` is expected to already be encoded by the caller (see
 * `createWorkItem`/`updateWorkItem` below) - it isn't re-encoded here to avoid
 * double-encoding.
 */
function buildWorkItemsUrl(idOrType: string): string {
    return ctxState.ctx.collection.uri + encodeURIComponent(ctxState.ctx.project.name) + "/_apis/wit/workitems/" + idOrType + "?api-version=" + API_VERSION;
}

async function sendPatch(url: string, patchDocument: WorkItemFields[]): Promise<WorkItemContracts.WorkItem> {
    const token = await getAccessToken();

    logInfo('Sending keepalive PATCH to: ' + url);

    let response: Response;
    try {
        response = await fetch(url, {
            method: "PATCH",
            headers: {
                "Authorization": "Bearer " + token,
                "Content-Type": "application/json-patch+json"
            },
            body: JSON.stringify(patchDocument),
            keepalive: true
        });
    } catch (networkError) {
        logError('Network error sending PATCH to ' + url + ': ' + networkError);
        throw networkError;
    }

    if (!response.ok) {
        const errorBody = await response.text();
        logError('Request to ' + url + ' failed with status ' + response.status + ': ' + errorBody);
        throw new Error('Work item request to ' + url + ' failed with status ' + response.status);
    }

    return response.json();
}

export function createWorkItem(patchDocument: WorkItemFields[], workItemTypeName: string): Promise<WorkItemContracts.WorkItem> {
    // The leading '$' is a literal path-routing character required by the WIT REST
    // API (e.g. `/_apis/wit/workitems/$Bug`) and must stay unencoded - only the type
    // name itself is encoded, since default type names like "User Story" contain spaces.
    return sendPatch(buildWorkItemsUrl('$' + encodeURIComponent(workItemTypeName)), patchDocument);
}

export function updateWorkItem(patchDocument: WorkItemFields[], workItemId: number): Promise<WorkItemContracts.WorkItem> {
    return sendPatch(buildWorkItemsUrl(String(workItemId)), patchDocument);
}
