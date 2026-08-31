import { WorkItemFields } from "./types";

export type EvaluationResult = { ok: true; value: number } | { ok: false; reason: string };

type TokenKind = "NUMBER" | "FIELD" | "IDENT" | "OP" | "LPAREN" | "RPAREN" | "COMMA" | "END";

type Token = { kind: TokenKind; text: string; index: number };

type SupportedFunction = (args: number[]) => number;

const SHOWN_VALUE_LIMIT = 40;

class ExpressionError extends Error {
    constructor(reason: string) {
        super(reason);
        // Restores the subclass prototype lost when `Error` is extended under an ES2015 target,
        // so the boundary can rely on `instanceof`.
        Object.setPrototypeOf(this, ExpressionError.prototype);
    }
}

function isDigit(character: string | undefined): boolean {
    return character !== undefined && /[0-9]/.test(character);
}

function isIdentifierStart(character: string): boolean {
    return /[A-Za-z_]/.test(character);
}

function isIdentifierPart(character: string | undefined): boolean {
    return character !== undefined && /[A-Za-z0-9_.]/.test(character);
}

function isWhitespace(character: string): boolean {
    return character === " " || character === "\t" || character === "\r" || character === "\n";
}

function isOperator(character: string): boolean {
    return "+-*/%".indexOf(character) !== -1;
}

function readNumber(body: string, start: number, tokens: Token[]): number {
    let end = start;
    while (isDigit(body[end])) {
        end++;
    }
    if (body[end] === "." && isDigit(body[end + 1])) {
        end++;
        while (isDigit(body[end])) {
            end++;
        }
    }
    tokens.push({ kind: "NUMBER", text: body.substring(start, end), index: start });
    return end;
}

function readField(body: string, start: number, tokens: Token[]): number {
    let end = start + 1;
    while (end < body.length && body[end] !== "}" && body[end] !== "{") {
        end++;
    }
    if (end >= body.length) {
        throw new ExpressionError(`unterminated field reference at index ${start}`);
    }
    if (body[end] === "{") {
        throw new ExpressionError(`unexpected character '{' at index ${end}`);
    }
    if (end === start + 1) {
        throw new ExpressionError(`empty field reference at index ${start}`);
    }
    tokens.push({ kind: "FIELD", text: body.substring(start + 1, end), index: start });
    return end + 1;
}

function readIdentifier(body: string, start: number, tokens: Token[]): number {
    let end = start + 1;
    while (isIdentifierPart(body[end])) {
        end++;
    }
    tokens.push({ kind: "IDENT", text: body.substring(start, end), index: start });
    return end;
}

function readSingleCharacter(character: string, index: number, tokens: Token[]): number {
    let kind: TokenKind;
    if (isOperator(character)) {
        kind = "OP";
    } else if (character === "(") {
        kind = "LPAREN";
    } else if (character === ")") {
        kind = "RPAREN";
    } else if (character === ",") {
        kind = "COMMA";
    } else {
        throw new ExpressionError(`unexpected character '${character}' at index ${index}`);
    }
    tokens.push({ kind, text: character, index });
    return index + 1;
}

function tokenize(body: string): Token[] {
    const tokens: Token[] = [];
    let index = 0;
    while (index < body.length) {
        const character = body[index];
        if (isWhitespace(character)) {
            index++;
            continue;
        }
        if (isDigit(character) || (character === "." && isDigit(body[index + 1]))) {
            index = readNumber(body, index, tokens);
        } else if (character === "{") {
            index = readField(body, index, tokens);
        } else if (isIdentifierStart(character)) {
            index = readIdentifier(body, index, tokens);
        } else {
            index = readSingleCharacter(character, index, tokens);
        }
    }
    tokens.push({ kind: "END", text: "", index: body.length });
    return tokens;
}

function requireArity(name: string, args: number[], expected: number): void {
    if (args.length !== expected) {
        const noun = expected === 1 ? "argument" : "arguments";
        throw new ExpressionError(`${name} expects ${expected} ${noun}, got ${args.length}`);
    }
}

function requireAtLeastOne(name: string, args: number[]): void {
    if (args.length === 0) {
        throw new ExpressionError(`${name} expects at least 1 argument, got 0`);
    }
}

const SUPPORTED_FUNCTIONS: { [name: string]: SupportedFunction } = {
    "Math.ceil": args => { requireArity("Math.ceil", args, 1); return Math.ceil(args[0]); },
    "Math.floor": args => { requireArity("Math.floor", args, 1); return Math.floor(args[0]); },
    "Math.round": args => { requireArity("Math.round", args, 1); return Math.round(args[0]); },
    "Math.abs": args => { requireArity("Math.abs", args, 1); return Math.abs(args[0]); },
    "Math.pow": args => { requireArity("Math.pow", args, 2); return Math.pow(args[0], args[1]); },
    "Math.min": args => { requireAtLeastOne("Math.min", args); return Math.min(...args); },
    "Math.max": args => { requireAtLeastOne("Math.max", args); return Math.max(...args); }
};

function lookupFunction(name: string): SupportedFunction {
    // Own-property check keeps inherited members such as `constructor` off the allowlist.
    if (!Object.prototype.hasOwnProperty.call(SUPPORTED_FUNCTIONS, name)) {
        throw new ExpressionError(`unsupported function '${name}'`);
    }
    return SUPPORTED_FUNCTIONS[name];
}

function shownValue(value: any): string {
    const text = String(value);
    return text.length > SHOWN_VALUE_LIMIT ? text.substring(0, SHOWN_VALUE_LIMIT) + "…" : text;
}

function resolveField(name: string, currentWorkItem: WorkItemFields): number {
    const value = currentWorkItem[name];
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
        return Number(value);
    }
    if (value === undefined) {
        throw new ExpressionError(`parent field '${name}' is missing`);
    }
    if (value === null || (typeof value === "string" && value.trim() === "")) {
        throw new ExpressionError(`parent field '${name}' is empty`);
    }
    throw new ExpressionError(`parent field '${name}' value '${shownValue(value)}' is not numeric`);
}

class Parser {
    private position = 0;

    constructor(private readonly tokens: Token[], private readonly currentWorkItem: WorkItemFields) {}

    parseExpression(): number {
        const value = this.parseAdditive();
        const trailing = this.peek();
        if (trailing.kind !== "END") {
            throw new ExpressionError(`unexpected token '${trailing.text}' at index ${trailing.index}`);
        }
        return value;
    }

    private peek(): Token {
        return this.tokens[this.position];
    }

    private next(): Token {
        const token = this.tokens[this.position];
        if (token.kind !== "END") {
            this.position++;
        }
        return token;
    }

    private peekOperator(operators: string): boolean {
        const token = this.peek();
        return token.kind === "OP" && operators.indexOf(token.text) !== -1;
    }

    private expect(kind: TokenKind): void {
        const token = this.next();
        if (token.kind === "END") {
            throw new ExpressionError("unexpected end of expression");
        }
        if (token.kind !== kind) {
            throw new ExpressionError(`unexpected token '${token.text}' at index ${token.index}`);
        }
    }

    private parseAdditive(): number {
        let left = this.parseMultiplicative();
        while (this.peekOperator("+-")) {
            const operator = this.next().text;
            const right = this.parseMultiplicative();
            left = operator === "+" ? left + right : left - right;
        }
        return left;
    }

    private parseMultiplicative(): number {
        let left = this.parseUnary();
        while (this.peekOperator("*/%")) {
            const operator = this.next().text;
            const right = this.parseUnary();
            if (operator === "*") {
                left = left * right;
            } else if (operator === "/") {
                left = left / right;
            } else {
                left = left % right;
            }
        }
        return left;
    }

    private parseUnary(): number {
        if (this.peekOperator("-")) {
            this.next();
            return -this.parseUnary();
        }
        return this.parsePrimary();
    }

    private parsePrimary(): number {
        const token = this.next();
        switch (token.kind) {
            case "END":
                throw new ExpressionError("unexpected end of expression");
            case "NUMBER":
                return Number(token.text);
            case "FIELD":
                return resolveField(token.text, this.currentWorkItem);
            case "IDENT":
                if (this.peek().kind !== "LPAREN") {
                    throw new ExpressionError(`unknown identifier '${token.text}'`);
                }
                return this.parseCall(token.text);
            case "LPAREN": {
                const value = this.parseAdditive();
                this.expect("RPAREN");
                return value;
            }
            default:
                throw new ExpressionError(`unexpected token '${token.text}' at index ${token.index}`);
        }
    }

    private parseCall(name: string): number {
        const apply = lookupFunction(name);
        this.expect("LPAREN");
        const args: number[] = [];
        if (this.peek().kind !== "RPAREN") {
            args.push(this.parseAdditive());
            while (this.peek().kind === "COMMA") {
                this.next();
                args.push(this.parseAdditive());
            }
        }
        this.expect("RPAREN");
        return apply(args);
    }
}

/**
 * A leading `=` (after trimming) is the only expression marker, so template authors can
 * opt into arithmetic per field without any escape syntax for ordinary text values.
 */
export function isExpression(fieldValue: string): boolean {
    return fieldValue.trim().charAt(0) === "=";
}

/**
 * Evaluates a template field expression against the parent work item's fields without
 * `eval`: only numbers, `{Field}` placeholders, `+ - * / %`, parentheses and an
 * allowlisted set of `Math` functions are accepted. Never throws and never logs so the
 * caller can report the reason together with the template and field names it knows.
 */
export function evaluateExpression(fieldValue: string, currentWorkItem: WorkItemFields): EvaluationResult {
    if (!isExpression(fieldValue)) {
        return { ok: false, reason: "value is not an expression" };
    }
    const body = fieldValue.trim().substring(1).trim();
    if (body === "") {
        return { ok: false, reason: "expression is empty" };
    }
    try {
        const value = new Parser(tokenize(body), currentWorkItem).parseExpression();
        return Number.isFinite(value)
            ? { ok: true, value }
            : { ok: false, reason: "result is not a finite number" };
    } catch (error) {
        if (error instanceof ExpressionError) {
            return { ok: false, reason: error.message };
        }
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, reason: `unexpected error: ${message}` };
    }
}
