import { replaceReferenceToParentField } from "../scripts/templateFilters";

describe("replaceReferenceToParentField", () => {
    it("substitutes a single parent field reference with the parent value", () => {
        const result = replaceReferenceToParentField("Fix for {System.Title}", { "System.Title": "Bug" });

        expect(result).toBe("Fix for Bug");
    });

    it("substitutes every occurrence of a repeated parent field reference", () => {
        const result = replaceReferenceToParentField("{A}+{A}", { A: 5 });

        expect(result).toBe("5+5");
    });

    it("substitutes a numeric parent field value as its string form", () => {
        const result = replaceReferenceToParentField(
            "SP: {Microsoft.VSTS.Scheduling.StoryPoints}",
            { "Microsoft.VSTS.Scheduling.StoryPoints": 5 }
        );

        expect(result).toBe("SP: 5");
    });
});

describe("replaceReferenceToParentField logging", () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it("substitutes the literal text undefined and logs once when the parent field is missing", () => {
        const result = replaceReferenceToParentField("SP: {X}", {});

        expect(result).toBe("SP: undefined");
        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        expect(consoleErrorSpy.mock.calls[0][0]).toContain("'X'");
        expect(consoleErrorSpy.mock.calls[0][0]).toContain("missing");
    });

    it("logs once per occurrence of a repeated missing parent field", () => {
        const result = replaceReferenceToParentField("{A}+{A}", {});

        expect(result).toBe("undefined+undefined");
        expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
    });

    it("substitutes the literal text null and logs when the parent field is null", () => {
        const result = replaceReferenceToParentField("{X}", { X: null });

        expect(result).toBe("null");
        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        expect(consoleErrorSpy.mock.calls[0][0]).toContain("null");
    });

    it("returns a value with a stray closing brace unchanged without logging", () => {
        const result = replaceReferenceToParentField("abc}", {});

        expect(result).toBe("abc}");
        expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it("returns a value without placeholders unchanged without logging", () => {
        const result = replaceReferenceToParentField("plain text", {});

        expect(result).toBe("plain text");
        expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
});
