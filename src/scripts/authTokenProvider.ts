/// <reference path="../node_modules/vss-web-extension-sdk/typings/vss.d.ts" />

// Wraps the SDK's `IPromise`-returning `VSS.getAccessToken()` in a native
// `Promise<string>` so the fetch-based transport (keepaliveFetchClient) can
// use plain async/await instead of the SDK's own promise flavor.
export function getAccessToken(): Promise<string> {
    return new Promise(function (resolve, reject) {
        VSS.getAccessToken().then(function (sessionToken: ISessionToken) {
            resolve(sessionToken.token);
        }, function (error: any) {
            reject(error);
        });
    });
}
