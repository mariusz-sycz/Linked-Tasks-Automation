import { formatCompletionMessage, TemplateOutcome } from "../scripts/progressDialogController";

const HEADER = "Task creation finished:\n\n";

function created(templateName: string, skippedFields?: string[]): TemplateOutcome {
    return skippedFields === undefined
        ? { templateName, status: "created" }
        : { templateName, status: "created", skippedFields };
}

function failed(templateName: string): TemplateOutcome {
    return { templateName, status: "failed" };
}

describe("formatCompletionMessage", () => {
    it("keeps the plain count line unchanged when nothing failed or was skipped", () => {
        const message = formatCompletionMessage([
            { workItemId: 123, outcomes: [created("Task A"), created("Task B"), created("Task C")] }
        ]);

        expect(message).toBe(HEADER + "Work item #123: 3 tasks of 3 templates created");
    });

    it("appends a singular warning for one created outcome with one skipped field", () => {
        const message = formatCompletionMessage([
            { workItemId: 123, outcomes: [created("Task A", ["F"])] }
        ]);

        expect(message).toBe(HEADER + "Work item #123: 1 tasks of 1 templates created. Warnings: Task A (1 field skipped)");
    });

    it("lists warnings in outcome order with plural wording for multiple skipped fields", () => {
        const message = formatCompletionMessage([
            { workItemId: 123, outcomes: [created("Task A", ["F"]), created("Task B", ["G", "H"]), created("Task C")] }
        ]);

        expect(message).toBe(HEADER + "Work item #123: 3 tasks of 3 templates created. Warnings: Task A (1 field skipped), Task B (2 fields skipped)");
    });

    it("places the failed suffix before the warnings suffix", () => {
        const message = formatCompletionMessage([
            { workItemId: 123, outcomes: [created("Task A", ["F"]), created("Task B"), failed("Task C")] }
        ]);

        expect(message).toBe(HEADER + "Work item #123: 2 tasks of 3 templates created. Failed: Task C. Warnings: Task A (1 field skipped)");
    });

    it("emits one line per work item under a single header", () => {
        const message = formatCompletionMessage([
            { workItemId: 1, outcomes: [created("Task A")] },
            { workItemId: 2, outcomes: [created("Task A", ["F"]), failed("Task B")] }
        ]);

        expect(message).toBe(
            HEADER
            + "Work item #1: 1 tasks of 1 templates created\n"
            + "Work item #2: 1 tasks of 2 templates created. Failed: Task B. Warnings: Task A (1 field skipped)"
        );
        expect(message.split(HEADER).length).toBe(2);
    });
});

describe("formatCompletionMessage with not-applicable templates", () => {
    it("counts a skipped template in the total but never lists it under Warnings", () => {
        const skipped: TemplateOutcome = { templateName: "Task B", status: "skipped" };
        const message = formatCompletionMessage([
            { workItemId: 123, outcomes: [created("Task A", ["F"]), skipped] }
        ]);

        expect(message).toBe(HEADER + "Work item #123: 1 tasks of 2 templates created. Warnings: Task A (1 field skipped)");
        expect(message).not.toContain("Task B");
    });
});
