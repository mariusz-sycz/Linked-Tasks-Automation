// toolbar.html only ever loads a single AMD module, `VSS.require(["scripts/app"], ...)`.
// tsc compiles src/scripts/*.ts to one AMD module per file under build/scripts/, so
// app.js's own `require`s of its sibling modules (context.js, orchestrator.js, etc.)
// only resolve if every one of those files is also servable from the Marketplace CDN.
// Bundling them into a single app.js (via the RequireJS optimizer, already a project
// dependency) restores the single-file-fetch behavior toolbar.html and the manifest's
// `files` entry (scripts/app.js only) both assume.
const path = require("path");
const fs = require("fs");
const requirejs = require("requirejs");

const buildDir = path.join(__dirname, "..", "build");
const scriptsDir = path.join(buildDir, "scripts");
const bundlePath = path.join(scriptsDir, "app.bundle.js");
const appPath = path.join(scriptsDir, "app.js");

const config = {
    // baseUrl is the extension root (not scripts/ itself), so the entry module's
    // computed id is "scripts/app" - matching exactly what toolbar.html requests
    // via VSS.require(["scripts/app"], ...). Bundling with baseUrl: scripts/ instead
    // named the entry module just "app", which the host's AMD loader never matched
    // to the "scripts/app" it fetched the file for, so the require callback's `app`
    // argument came back undefined (TypeError: Cannot read properties of undefined
    // (reading 'create')) even though the file itself loaded and parsed fine.
    baseUrl: buildDir,
    name: "scripts/app",
    out: bundlePath,
    optimize: "none",
    // These are AMD modules the VSS SDK's own loader provides at runtime (TFS REST
    // clients/contracts) or that ship as their own addressable file (q) - none of
    // them live under build/scripts/, so tell the optimizer not to try to inline them.
    paths: {
        "TFS/WorkItemTracking/RestClient": "empty:",
        "TFS/WorkItemTracking/Contracts": "empty:",
        "TFS/Work/RestClient": "empty:",
        "TFS/Work/Contracts": "empty:",
        "TFS/Core/Contracts": "empty:",
        "q": "empty:"
    }
};

requirejs.optimize(config, function () {
    // Everything the bundle needed is now inlined into app.bundle.js - the
    // per-module files tsc produced are redundant, and shipping them alongside
    // the bundle would silently reintroduce the "many separate files" problem
    // this script exists to avoid. Remove them, then promote the bundle to the
    // one filename toolbar.html and vss-extension.json actually reference.
    for (const file of fs.readdirSync(scriptsDir)) {
        if (file !== "app.bundle.js") {
            fs.unlinkSync(path.join(scriptsDir, file));
        }
    }
    fs.renameSync(bundlePath, appPath);
    console.log("bundle-scripts: build/scripts/*.js -> single build/scripts/app.js");
}, function (err) {
    console.error("bundle-scripts: RequireJS optimizer failed:");
    console.error(err);
    process.exit(1);
});
