import * as _WorkItemRestClient from "TFS/WorkItemTracking/RestClient";
import * as workRestClient from "TFS/Work/RestClient";

export type WitClient = ReturnType<typeof _WorkItemRestClient.getClient>;
export type WorkClient = ReturnType<typeof workRestClient.getClient>;

/**
 * Loosely-typed field dictionary: either a work item's `.fields` (SDK types this as
 * `{ [key: string]: any }`) or a JSON-Patch document/operation being built up for the
 * REST client (the SDK types `JsonPatchDocument` as an empty interface, so a plain
 * array of `{ op, path, value }` objects satisfies it structurally). Kept as `any`
 * per the migration spec's allowance for this genuinely dynamic dictionary shape.
 */
export type WorkItemFields = { [key: string]: any };
