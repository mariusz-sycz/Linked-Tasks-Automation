import * as ctxState from "./context";
import { logError } from "./logging";

// Cache entries older than this are treated as a miss and re-fetched from the REST API.
const CACHE_TTL_MS = 4 * 60 * 60 * 1000;
const CACHE_KEY_PREFIX = "linkedTasksAutomation.templateCache.";

interface CacheEntry<T> {
    timestamp: number;
    data: T;
}

// Deterministic key for a (project, team, keyParts) tuple — keyParts is sorted so
// callers can pass an unordered set (e.g. child work item type names) and still hit
// the same entry regardless of iteration order.
export function buildTemplateCacheKey(keyParts: string[]): string {
    var sortedParts = keyParts.slice().sort().join(",");
    return CACHE_KEY_PREFIX + ctxState.ctx.project.id + "|" + ctxState.ctx.team.id + "|" + sortedParts;
}

// Same as `buildTemplateCacheKey` but scoped by project only (no team.id) — used for
// data that doesn't vary per team, e.g. work item type categories.
export function buildProjectCacheKey(keyParts: string[]): string {
    var sortedParts = keyParts.slice().sort().join(",");
    return CACHE_KEY_PREFIX + ctxState.ctx.project.id + "|" + sortedParts;
}

export function getFreshCacheEntry<T>(key: string): T | undefined {
    var raw: string | null;
    try {
        raw = localStorage.getItem(key);
    } catch (e) {
        // A restricted-storage-context exception degrades to a cache miss, same as
        // "not found"/"malformed JSON" below - a failed cache read must never block
        // task creation.
        return undefined;
    }
    if (raw == null) {
        return undefined;
    }

    var entry: CacheEntry<T>;
    try {
        entry = JSON.parse(raw);
    } catch (e) {
        return undefined;
    }

    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
        return undefined;
    }

    return entry.data;
}

export function writeCacheEntry<T>(key: string, data: T): void {
    var entry: CacheEntry<T> = {
        timestamp: Date.now(),
        data: data
    };
    try {
        localStorage.setItem(key, JSON.stringify(entry));
    } catch (e) {
        // A quota/storage exception here must never block task creation - log and
        // no-op, matching this project's non-blocking philosophy for auxiliary
        // caching features.
        logError('Failed to write template cache entry for key ' + key + ': ' + e);
    }
}
