import { evaluateExpression, isExpression, EvaluationResult } from "../scripts/expressionEvaluator";

const noFields = {};

describe("isExpression", () => {
    test.each([
        ["=1", true],
        [" =1", true],
        ["= 1", true],
        ["=", true],
        ["x=1", false],
        ["Fix: 2+2", false],
        ["", false],
        ["{A}", false]
    ])("detects %j as expression: %s", (fieldValue, expected) => {
        expect(isExpression(fieldValue)).toBe(expected);
    });
});

describe("evaluateExpression literals and precedence", () => {
    test.each([
        ["=2", 2],
        ["=0.5", 0.5],
        ["=.5", 0.5],
        ["=1+2*3", 7],
        ["=(1+2)*3", 9],
        ["=10-4-3", 3],
        ["=7%3", 1],
        ["=8/2/2", 2],
        ["= 2 * 3 ", 6]
    ])("evaluates %j to %s", (fieldValue, expected) => {
        expect(evaluateExpression(fieldValue, noFields)).toEqual({ ok: true, value: expected });
    });
});

describe("evaluateExpression unary minus", () => {
    test.each<[string, EvaluationResult]>([
        ["=-2", { ok: true, value: -2 }],
        ["=2*-3", { ok: true, value: -6 }],
        ["=--3", { ok: true, value: 3 }],
        ["=2 - -3", { ok: true, value: 5 }],
        ["=-(1+2)", { ok: true, value: -3 }],
        ["=+2", { ok: false, reason: "unexpected token '+' at index 0" }]
    ])("evaluates %j to %j", (fieldValue, expected) => {
        expect(evaluateExpression(fieldValue, noFields)).toEqual(expected);
    });
});

describe("evaluateExpression Math functions", () => {
    test.each([
        ["=Math.ceil(1.2)", 2],
        ["=Math.floor(1.8)", 1],
        ["=Math.round(2.5)", 3],
        ["=Math.abs(-4)", 4],
        ["=Math.min(3,1,2)", 1],
        ["=Math.max(3,1,2)", 3],
        ["=Math.pow(2,10)", 1024],
        ["=Math.max(Math.ceil(1.1), 1)", 2]
    ])("evaluates %j to %s", (fieldValue, expected) => {
        expect(evaluateExpression(fieldValue, noFields)).toEqual({ ok: true, value: expected });
    });
});

describe("evaluateExpression allowlist, arity and syntax errors", () => {
    test.each<[string, string | RegExp]>([
        ["=Math.sqrt(4)", "unsupported function 'Math.sqrt'"],
        ["=Math.random()", "unsupported function 'Math.random'"],
        ["=math.ceil(1)", "unsupported function 'math.ceil'"],
        ["=abc", "unknown identifier 'abc'"],
        ["=Math.ceil", "unknown identifier 'Math.ceil'"],
        ["=abc(1)", "unsupported function 'abc'"],
        ["=Math.pow(2)", "Math.pow expects 2 arguments, got 1"],
        ["=Math.ceil(1,2)", "Math.ceil expects 1 argument, got 2"],
        ["=Math.min()", "Math.min expects at least 1 argument, got 0"],
        ["=2**3", /^unexpected token/],
        ["=1 2", /^unexpected token/],
        ["=(1", "unexpected end of expression"],
        ["=1+", "unexpected end of expression"],
        ["=", "expression is empty"],
        ["=1 ^ 2", "unexpected character '^' at index 2"]
    ])("rejects %j with reason %s", (fieldValue, expectedReason) => {
        const result = evaluateExpression(fieldValue, noFields);

        if (expectedReason instanceof RegExp) {
            expect(result.ok).toBe(false);
            expect(result.ok === false && result.reason).toMatch(expectedReason);
        } else {
            expect(result).toEqual({ ok: false, reason: expectedReason });
        }
    });
});

describe("evaluateExpression placeholder resolution", () => {
    const sixtyCharacters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ01234567";

    test.each<[string, string, { [key: string]: any }, EvaluationResult]>([
        ["numeric field inside a call", "=Math.ceil({SP}*2)", { SP: 5 }, { ok: true, value: 10 }],
        ["same field referenced twice", "={SP}+{SP}", { SP: 5 }, { ok: true, value: 10 }],
        ["numeric string", "={X}", { X: "3" }, { ok: true, value: 3 }],
        ["padded numeric string", "={X}", { X: " 2.5 " }, { ok: true, value: 2.5 }],
        ["absent field", "={X}", {}, { ok: false, reason: "parent field 'X' is missing" }],
        ["null field", "={X}", { X: null }, { ok: false, reason: "parent field 'X' is empty" }],
        ["empty string field", "={X}", { X: "" }, { ok: false, reason: "parent field 'X' is empty" }],
        ["non-numeric string", "={X}", { X: "abc" }, { ok: false, reason: "parent field 'X' value 'abc' is not numeric" }],
        ["boolean field", "={X}", { X: true }, { ok: false, reason: "parent field 'X' value 'true' is not numeric" }],
        ["empty field reference", "={}", {}, { ok: false, reason: "empty field reference at index 0" }],
        ["unterminated field reference", "={SP", { SP: 5 }, { ok: false, reason: "unterminated field reference at index 0" }],
        ["nested opening brace", "={A{B}", { A: 1, B: 2 }, { ok: false, reason: "unexpected character '{' at index 2" }],
        ["field name with dots and spaces", "={Custom.My Field}", { "Custom.My Field": 4 }, { ok: true, value: 4 }]
    ])("%s", (_name, fieldValue, currentWorkItem, expected) => {
        expect(evaluateExpression(fieldValue, currentWorkItem)).toEqual(expected);
    });

    test("truncates a long non-numeric value to 40 characters followed by an ellipsis", () => {
        const result = evaluateExpression("={X}", { X: sixtyCharacters });

        expect(result.ok).toBe(false);
        const reason = result.ok === false ? result.reason : "";
        expect(reason).toContain(sixtyCharacters.substring(0, 40) + "…");
        expect(reason).not.toContain(sixtyCharacters);
    });

    test("evaluates the story points doubling example from the specification", () => {
        const result = evaluateExpression(
            "=Math.ceil({Microsoft.VSTS.Scheduling.StoryPoints}*2)",
            { "Microsoft.VSTS.Scheduling.StoryPoints": 2.5 }
        );

        expect(result).toEqual({ ok: true, value: 5 });
    });
});

describe("evaluateExpression non-finite results", () => {
    test.each<[string, EvaluationResult]>([
        ["=1/0", { ok: false, reason: "result is not a finite number" }],
        ["=0/0", { ok: false, reason: "result is not a finite number" }],
        ["=5%0", { ok: false, reason: "result is not a finite number" }],
        ["=Math.pow(10,400)", { ok: false, reason: "result is not a finite number" }],
        ["=Math.min(1/0, 1)", { ok: true, value: 1 }]
    ])("evaluates %j to %j", (fieldValue, expected) => {
        expect(evaluateExpression(fieldValue, noFields)).toEqual(expected);
    });
});

describe("evaluateExpression marker, whitespace and number syntax edge cases", () => {
    test.each<[string, EvaluationResult]>([
        ["x=1", { ok: false, reason: "value is not an expression" }],
        ["=  ", { ok: false, reason: "expression is empty" }],
        ["=1.", { ok: false, reason: "unexpected character '.' at index 1" }],
        ["=1e3", { ok: false, reason: "unexpected token 'e3' at index 1" }],
        ["=\t1 +\n2", { ok: true, value: 3 }],
        ["=Math.min(3)", { ok: true, value: 3 }],
        ["=Math.pow(2,3,4)", { ok: false, reason: "Math.pow expects 2 arguments, got 3" }]
    ])("evaluates %j to %j", (fieldValue, expected) => {
        expect(evaluateExpression(fieldValue, noFields)).toEqual(expected);
    });

    test("accepts a hexadecimal numeric string through Number() semantics (known limitation)", () => {
        expect(evaluateExpression("={SP}", { SP: "0x10" })).toEqual({ ok: true, value: 16 });
    });
});
