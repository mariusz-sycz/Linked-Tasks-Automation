import { createWorkItemFromTemplate } from "../scripts/templateBuilder";
import { setCtx } from "../scripts/context";
import * as expressionEvaluator from "../scripts/expressionEvaluator";
import { WorkItemFields } from "../scripts/types";

const STORY_POINTS = "Microsoft.VSTS.Scheduling.StoryPoints";

function template(fields: { [key: string]: string }): any {
    return { name: "Task A", fields, description: "" };
}

function entryFor(patchDocument: WorkItemFields[], fieldName: string): WorkItemFields | undefined {
    return patchDocument.find(entry => entry.path === "/fields/" + fieldName);
}

describe("createWorkItemFromTemplate", () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it("evaluates expression fields to numbers and substitutes plain fields side by side", () => {
        const built = createWorkItemFromTemplate(
            { [STORY_POINTS]: 2.5, "System.Title": "Bug" },
            template({ [STORY_POINTS]: "=Math.ceil({" + STORY_POINTS + "}*2)", "System.Title": "Fix for {System.Title}" }),
            {} as any
        );

        expect(entryFor(built.patchDocument, STORY_POINTS)).toEqual({ op: "add", path: "/fields/" + STORY_POINTS, value: 5 });
        expect(typeof entryFor(built.patchDocument, STORY_POINTS)!.value).toBe("number");
        expect(entryFor(built.patchDocument, "System.Title")).toEqual({ op: "add", path: "/fields/System.Title", value: "Fix for Bug" });
        expect(built.skippedFields).toEqual([]);
        expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it("skips a failing expression field, reports it and logs template, field, raw value and reason", () => {
        const built = createWorkItemFromTemplate(
            { "System.Title": "Bug" },
            template({ [STORY_POINTS]: "=Math.ciel(1)" }),
            {} as any
        );

        expect(entryFor(built.patchDocument, STORY_POINTS)).toBeUndefined();
        expect(built.skippedFields).toEqual([STORY_POINTS]);
        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        const message: string = consoleErrorSpy.mock.calls[0][0];
        expect(message).toContain("Template 'Task A'");
        expect(message).toContain("field '" + STORY_POINTS + "'");
        expect(message).toContain("expression '=Math.ciel(1)'");
        expect(message).toContain("skipped - unsupported function 'Math.ciel'");
    });

    it("lists every failing expression field in template iteration order", () => {
        const built = createWorkItemFromTemplate(
            { "System.Title": "Bug" },
            template({ "Custom.First": "=Math.ciel(1)", "System.Title": "Plain", "Custom.Second": "={Missing}" }),
            {} as any
        );

        expect(built.skippedFields).toEqual(["Custom.First", "Custom.Second"]);
        expect(entryFor(built.patchDocument, "System.Title")!.value).toBe("Plain");
        expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
    });

    it("evaluates an expression on any field including System.Title", () => {
        const built = createWorkItemFromTemplate(
            { "System.Title": "Bug" },
            template({ "System.Title": "=1+1" }),
            {} as any
        );

        expect(entryFor(built.patchDocument, "System.Title")).toEqual({ op: "add", path: "/fields/System.Title", value: 2 });
        expect(typeof entryFor(built.patchDocument, "System.Title")!.value).toBe("number");
        expect(built.skippedFields).toEqual([]);
    });

    it("does not backfill the parent title when the System.Title expression fails", () => {
        const built = createWorkItemFromTemplate(
            { "System.Title": "Bug" },
            template({ "System.Title": "={Missing}" }),
            {} as any
        );

        expect(entryFor(built.patchDocument, "System.Title")).toBeUndefined();
        expect(built.skippedFields).toEqual(["System.Title"]);
    });

    it("keeps plain values, empty-value inheritance and parent defaults unchanged", () => {
        const built = createWorkItemFromTemplate(
            { "Custom.Field": 7, "System.AreaPath": "P\A", "System.IterationPath": "P\I" },
            template({ "System.Title": "Plain", "Custom.Field": "" }),
            {} as any
        );

        expect(built.patchDocument).toEqual([
            { op: "add", path: "/fields/System.Title", value: "Plain" },
            { op: "add", path: "/fields/Custom.Field", value: 7 },
            { op: "add", path: "/fields/System.AreaPath", value: "P\A" },
            { op: "add", path: "/fields/System.IterationPath", value: "P\I" }
        ]);
        expect(built.skippedFields).toEqual([]);
        expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it("resolves @me and @currentiteration without attempting expression evaluation", () => {
        setCtx({ user: { uniqueName: "me@x" } } as any);
        const evaluateSpy = jest.spyOn(expressionEvaluator, "evaluateExpression");

        try {
            const built = createWorkItemFromTemplate(
                { "System.Title": "Bug" },
                template({ "System.AssignedTo": "@me", "System.IterationPath": "@currentiteration" }),
                { backlogIteration: { name: "Team" }, defaultIteration: { path: "\Sprint 1" } } as any
            );

            expect(entryFor(built.patchDocument, "System.AssignedTo")!.value).toBe("me@x");
            expect(entryFor(built.patchDocument, "System.IterationPath")!.value).toBe("Team\Sprint 1");
            expect(built.skippedFields).toEqual([]);
            expect(evaluateSpy).not.toHaveBeenCalled();
        } finally {
            evaluateSpy.mockRestore();
        }
    });
});
