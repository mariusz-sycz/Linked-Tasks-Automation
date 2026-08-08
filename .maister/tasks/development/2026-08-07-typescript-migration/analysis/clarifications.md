## TL;DR
Three scope decisions resolved before specification: fix the broken promise-chain bug in AddTasks/createChildFromTemplate/createWorkItem, delete the 3 dead AMD imports + 1 dead function during the port, and fix both remaining pre-existing bugs (app.js:459 implicit global, app.js:526 promise/bugsBehavior misread).

# Phase 1 Clarifications

## Q1: Broken promise chain bug (createChildFromTemplate/createWorkItem never return their promises)
**Decision**: Fix it as part of the migration.
**Rationale**: TypeScript's async typing will force the missing return statements into the open anyway — fixing now avoids a suppressed type error and restores the intended "one template at a time" sequential ordering that `justCreatedTasks`-dependent linkTo directives rely on.

## Q2: Dead code (Controls, StatusIndicator, Dialogs AMD imports; getWorkItemFormService function)
**Decision**: Delete them during the port.
**Rationale**: All four are confirmed unused (zero references via grep). Reduces the typing surface and matches the project roadmap's stated cleanup goals. No UI feedback (spinner/dialog) is being added — that would expand scope beyond a pure type-safety port and belongs in Phase 2 (new feature development) per the project roadmap.

## Q3: Implicit-global bugs (app.js:459 loop variable, app.js:526 .bugsBehavior read off a pending Promise)
**Decision**: Fix both.
**Rationale**: app.js:459 needs a `let`/`const` declaration for TS to accept it regardless. app.js:526 gets an explicit await/resolve fix, restoring the intended Bug-category branching logic (`AsTasks`/`AsRequirements`) that has been silently dead code until now.
