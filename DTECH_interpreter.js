#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const http = require("http");
const { spawn } = require("child_process");

// ============================================================
// D-TECH RUNTIME
// ============================================================

if (globalThis.__DTECH_RUNNING__) {
    console.error("DTECH: another instance is already running.");
    process.exit(1);
}

globalThis.__DTECH_RUNNING__ = true;

// ============================================================
// FILE
// ============================================================

const file = process.argv[2];

if (!file) {
    console.log("D-TECH Runtime");
    console.log("");
    console.log("Usage:");
    console.log("  node DTECH_interpreter.js file.dtech");
    process.exit(1);
}

if (!fs.existsSync(file)) {
    console.error("DTECH ERROR: file not found.");
    process.exit(1);
}

const extension = path.extname(file).toLowerCase();

if (extension !== ".dtech" && extension !== ".dteche") {
    console.error("DTECH ERROR: invalid extension.");
    console.error("Expected .dtech or .dteche.");
    process.exit(1);
}

// ============================================================
// INPUT
// ============================================================

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// ============================================================
// STATE
// ============================================================

const state = {
    variables: {},
    tipos: {},
    arrays: {},
    afiliaciones: {},
    funciones: {},
    eventos: {},
    imports: [],

    console: {
        info: false,
        debug: false,
        warning: false,
        error: false,
        all: false
    },

    log: {
        enabled: false,
        file: "dtech.log"
    },

    server: {
        running: false,
        port: 1,
        maxJoins: 10,
        connections: 0,
        server: null,
        consoleActive: false,
        clients: [],
        pendingRequests: new Map(),
        nextRequestId: 1
    },

    running: true,
    returnValue: undefined
};

// ============================================================
// CONSOLE LOGGING
// ============================================================

function dtechError(message, line = null) {
    if (line !== null) {
        console.error(
            `DTECH ERROR [line ${line}]: ${message}`
        );
    } else {
        console.error(
            `DTECH ERROR: ${message}`
        );
    }
}

function dtechInfo(message) {
    if (
        state.console.all ||
        state.console.info
    ) {
        const output =
            `[DTECH INFO] ${message}`;

        console.log(output);
        writeLog(output);
    }
}

function dtechDebug(message) {
    if (
        state.console.all ||
        state.console.debug
    ) {
        const output =
            `[DTECH DEBUG] ${message}`;

        console.log(output);
        writeLog(output);
    }
}

function dtechWarning(message) {
    if (
        state.console.all ||
        state.console.warning
    ) {
        const output =
            `[DTECH WARNING] ${message}`;

        console.warn(output);
        writeLog(output);
    }
}

function dtechOptionalError(message) {
    if (
        state.console.all ||
        state.console.error
    ) {
        const output =
            `[DTECH ERROR] ${message}`;

        console.error(output);
        writeLog(output);
    }
}

function writeLog(message) {
    if (!state.log.enabled) {
        return;
    }

    try {
        const timestamp =
            new Date().toISOString();

        fs.appendFileSync(
            state.log.file,
            `[${timestamp}] ${message}\n`,
            "utf8"
        );
    } catch (error) {
        console.error(
            `DTECH ERROR: could not write log file: ${error.message}`
        );
    }
}

// ============================================================
// VARIABLES
// ============================================================

function hasVariable(name) {
    return Object.prototype.hasOwnProperty.call(
        state.variables,
        name
    );
}

function getVariable(name) {
    if (!hasVariable(name)) {
        dtechWarning(
            `Variable ${name} does not exist.`
        );

        return undefined;
    }

    return state.variables[name];
}

function setVariable(name, value) {
    if (state.tipos[name]) {
        const tipo =
            state.tipos[name];

        if (!validateType(value, tipo)) {
            dtechError(
                `Value of ${name} does not match type ${tipo}.`
            );

            return;
        }
    }

    state.variables[name] =
        value;
}

function validateType(value, type) {
    switch (type) {
        case "int":
            return Number.isInteger(value);

        case "float":
            return typeof value === "number";

        case "string":
            return typeof value === "string";

        case "bool":
            return typeof value === "boolean";

        default:
            return true;
    }
}

// ============================================================
// TEXT VARIABLES
// ============================================================

function replaceVariables(text) {
    text = String(text);

    for (const name of Object.keys(state.variables)) {
        const value =
            state.variables[name];

        if (
            value === undefined ||
            value === null
        ) {
            continue;
        }

        const escaped =
            name.replace(
                /[.*+?^${}()|[\]\\]/g,
                "\\$&"
            );

        text =
            text.replace(
                new RegExp(escaped, "g"),
                String(value)
            );
    }

    for (
        const symbol of Object.keys(
            state.afiliaciones
        )
    ) {
        const variable =
            state.afiliaciones[symbol];

        const value =
            state.variables[variable];

        if (value !== undefined) {
            text =
                text.replace(
                    /\$/g,
                    String(value)
                );
        }
    }

    return text;
}

// ============================================================
// EVALUATOR
// ============================================================

function evaluate(value) {
    if (
        value === undefined ||
        value === null
    ) {
        return undefined;
    }

    value =
        String(value).trim();

    if (
        value.startsWith('"') &&
        value.endsWith('"')
    ) {
        return replaceVariables(
            value.slice(1, -1)
        );
    }

    if (value === "true") {
        return true;
    }

    if (value === "false") {
        return false;
    }

    if (
        value.startsWith("#") &&
        hasVariable(value)
    ) {
        return getVariable(value);
    }

    if (
        value.startsWith("#") &&
        state.arrays[value]
    ) {
        return state.arrays[value];
    }

    return evaluateExpression(value);
}

// ============================================================
// EXPRESSIONS
// ============================================================

function evaluateExpression(expression) {
    expression =
        String(expression).trim();

    if (
        expression.startsWith('"') &&
        expression.endsWith('"')
    ) {
        return evaluate(expression);
    }

    if (expression.includes("==")) {
        const parts =
            expression.split("==");

        return (
            evaluateExpression(parts[0]) ===
            evaluateExpression(
                parts.slice(1).join("==")
            )
        );
    }

    if (expression.includes(">")) {
        const parts =
            expression.split(">");

        return (
            Number(
                evaluateExpression(parts[0])
            ) >
            Number(
                evaluateExpression(
                    parts.slice(1).join(">")
                )
            )
        );
    }

    if (expression.includes("<")) {
        const parts =
            expression.split("<");

        return (
            Number(
                evaluateExpression(parts[0])
            ) <
            Number(
                evaluateExpression(
                    parts.slice(1).join("<")
                )
            )
        );
    }

    const plus =
        splitMath(expression, "+");

    if (plus.length > 1) {
        return plus.reduce(
            (a, b) =>
                Number(a) +
                Number(
                    evaluateExpression(b)
                ),
            0
        );
    }

    const minus =
        splitMath(expression, "-");

    if (minus.length > 1) {
        let result =
            Number(
                evaluateExpression(
                    minus[0]
                )
            );

        for (
            let i = 1;
            i < minus.length;
            i++
        ) {
            result -= Number(
                evaluateExpression(
                    minus[i]
                )
            );
        }

        return result;
    }

    const multiply =
        splitMath(expression, "*");

    if (multiply.length > 1) {
        return multiply.reduce(
            (a, b) =>
                Number(a) *
                Number(
                    evaluateExpression(b)
                ),
            1
        );
    }

    const divide =
        splitMath(expression, "/");

    if (divide.length > 1) {
        let result =
            Number(
                evaluateExpression(
                    divide[0]
                )
            );

        for (
            let i = 1;
            i < divide.length;
            i++
        ) {
            result /=
                Number(
                    evaluateExpression(
                        divide[i]
                    )
                );
        }

        return result;
    }

    if (
        expression !== "" &&
        !Number.isNaN(
            Number(expression)
        )
    ) {
        return Number(expression);
    }

    if (hasVariable(expression)) {
        return getVariable(expression);
    }

    return expression;
}

function splitMath(expression, operator) {
    return expression
        .split(operator)
        .map(x => x.trim())
        .filter(x => x !== "");
}

// ============================================================
// PARSER
// ============================================================

function parseSource(content) {
    const lines =
        content.split(/\r?\n/);

    const root = [];
    const stack = [root];

    let headerFound = false;
    let headerType = null;

    for (
        let i = 0;
        i < lines.length;
        i++
    ) {
        const lineNumber =
            i + 1;

        let line =
            lines[i]
                .replace(/^\uFEFF/, "")
                .replace(/^\u200B/, "")
                .trim();

        if (!line) {
            continue;
        }

        if (line.startsWith("//")) {
            continue;
        }

        if (
            /^<type:dtech:(executable|code)>$/.test(line)
        ) {
            if (headerFound) {
                dtechError(
                    "Duplicate D-TECH header.",
                    lineNumber
                );

                continue;
            }

            headerFound = true;

            headerType =
                line === "<type:dtech:executable>"
                    ? "executable"
                    : "code";

            continue;
        }

        if (
            line === "end" ||
            line === "}"
        ) {
            if (stack.length <= 1) {
                dtechError(
                    "END without an open nested block.",
                    lineNumber
                );

                continue;
            }

            stack.pop();
            continue;
        }

        const node =
            transformLine(
                line,
                lineNumber
            );

        if (node.type === "block") {
            stack[
                stack.length - 1
            ].push(node);

            stack.push(node.body);

            continue;
        }

        if (node.type === "elseIf") {
            if (stack.length <= 1) {
                dtechError(
                    "ELSEIF without a previous block.",
                    lineNumber
                );

                continue;
            }

            stack.pop();

            const parent =
                stack[
                    stack.length - 1
                ];

            parent.push(node);

            stack.push(node.body);

            continue;
        }

        stack[
            stack.length - 1
        ].push(node);
    }

    if (!headerFound) {
        throw new Error(
            "Missing <type:dtech:executable> or <type:dtech:code>."
        );
    }

    if (stack.length > 1) {
        dtechError(
            "One or more nested D-TECH blocks were not closed."
        );
    }

    return {
        header: headerType,
        body: root
    };
}

// ============================================================
// TRANSFORMER
// ============================================================

function transformLine(line, lineNumber) {

    // --------------------------------------------------------
    // PRINT
    // --------------------------------------------------------

    if (line.startsWith("print(")) {
        const match =
            line.match(
                /^print\s*\("([\s\S]*)"\)$/
            );

        if (match) {
            return {
                type: "print",
                text: match[1],
                line: lineNumber
            };
        }
    }

    // --------------------------------------------------------
    // SEND
    // --------------------------------------------------------

    if (line.startsWith("send(")) {
        const match =
            line.match(
                /^send\("([\s\S]*)"\)$/
            );

        if (match) {
            return {
                type: "send",
                text: match[1],
                line: lineNumber
            };
        }
    }

    // --------------------------------------------------------
    // PRINT.LINE
    // --------------------------------------------------------

    if (line.startsWith("print.line.")) {
        const match =
            line.match(
                /^print\.line\.(\d+(?:\.\d+)?)\.\("([\s\S]*)"\)$/
            );

        if (match) {
            return {
                type: "printLine",
                delay: match[1],
                text: match[2],
                line: lineNumber
            };
        }
    }

    const parts =
        line.split(".");
    // ========================================================
    // NETWORK
    // ========================================================

    if (
        parts[0] === "network" &&
        parts[1] === "connect"
    ) {
        return {
            type: "networkConnect",
            line: lineNumber
        };
    }

    // ========================================================
    // @COMMAND
    // ========================================================

    if (parts[0] === "@command") {

        // ----------------------------------------------------
        // SERVER
        // ----------------------------------------------------

        if (
            parts[1] === "start" &&
            parts[2] === "server"
        ) {
            let port = 1;
            let maxJoins = 10;

            for (
                let i = 3;
                i < parts.length;
                i++
            ) {
                if (
                    parts[i] === "port" &&
                    i + 1 < parts.length
                ) {
                    port =
                        Number(
                            parts[i + 1]
                                .replace(/"/g, "")
                                .replace(/^==/, "")
                        );
                }

                if (
                    parts[i] === "max" &&
                    parts[i + 1] === "joins" &&
                    i + 2 < parts.length
                ) {
                    const raw =
                        parts[i + 2];

                    const val =
                        raw.includes("==")
                            ? raw.split("==")[1]
                            : raw;

                    maxJoins =
                        Number(
                            String(val)
                                .replace(/"/g, "")
                        );
                }
            }

            return {
                type: "startServer",
                port,
                maxJoins,
                line: lineNumber
            };
        }

        // ----------------------------------------------------
        // CREATE
        // ----------------------------------------------------

        if (
            parts[1] === "get" &&
            parts[2] === "create"
        ) {
            if (parts[3] === "variable") {
                return {
                    type: "createVariable",
                    dataType:
                        parts[4] || null,
                    name:
                        parts[5],
                    line:
                        lineNumber
                };
            }

            if (parts[3] === "array") {
                return {
                    type: "arrayCreate",
                    dataType:
                        parts[4],
                    name:
                        parts[5],
                    line:
                        lineNumber
                };
            }

            if (parts[3] === "object") {
                return {
                    type: "createObject",
                    shape:
                        parts[4],
                    name:
                        parts[5],
                    line:
                        lineNumber
                };
            }
        }

        // ----------------------------------------------------
        // INPUT
        // ----------------------------------------------------

        if (
            parts[1] === "get" &&
            parts[2] === "input"
        ) {
            if (parts[3] === "mouse") {
                return {
                    type: "mouseInput",
                    line:
                        lineNumber
                };
            }

            return {
                type: "input",
                line:
                    lineNumber
            };
        }

        // ----------------------------------------------------
        // AFFILIATE
        // ----------------------------------------------------

        if (parts[1] === "affiliate") {
            return {
                type: "affiliate",
                symbol:
                    parts[2],
                variable:
                    parts[4],
                line:
                    lineNumber
            };
        }

        // ----------------------------------------------------
        // CONSOLE
        // ----------------------------------------------------

        if (parts[1] === "console") {

            // ONLY INFO supports message syntax:
            // @command.console.info("message")
            const infoMessageMatch =
                line.match(
                    /^@command\.console\.info\("([\s\S]*)"\)$/
                );

            if (infoMessageMatch) {
                return {
                    type: "consoleInfoMessage",
                    message:
                        infoMessageMatch[1],
                    line:
                        lineNumber
                };
            }

            // @command.console.log.file=="server".log
            const logFileMatch =
                line.match(
                    /^@command\.console\.log\.file=="([^"]+)"\.log$/
                );

            if (logFileMatch) {
                return {
                    type: "logFile",
                    file:
                        logFileMatch[1],
                    line:
                        lineNumber
                };
            }

            const consoleType =
                parts[2];

            const validConsoleTypes = [
                "info",
                "debug",
                "warning",
                "error",
                "all"
            ];

            if (
                validConsoleTypes.includes(
                    consoleType
                )
            ) {
                let value = true;

                if (parts[3]) {
                    const raw =
                        parts[3]
                            .replace(
                                /^==/,
                                ""
                            )
                            .toLowerCase();

                    if (
                        raw === "true" ||
                        raw === "false"
                    ) {
                        value =
                            raw === "true";
                    }
                }

                return {
                    type: "console",
                    mode:
                        consoleType,
                    value,
                    line:
                        lineNumber
                };
            }

            return {
                type: "unknown",
                source:
                    line,
                line:
                    lineNumber
            };
        }

        // ----------------------------------------------------
        // LET
        // ----------------------------------------------------

        if (parts[1] === "let") {
            return {
                type: "let",
                destination:
                    parts[2],
                source:
                    parts[3],
                line:
                    lineNumber
            };
        }
    }

    // ========================================================
    // SET
    // ========================================================

    if (parts[0] === "set") {
        const varName =
            parts[1];

        if (
            varName &&
            varName.includes(":")
        ) {
            const index =
                varName.indexOf(":");

            return {
                type: "set",
                name:
                    varName.slice(
                        0,
                        index
                    ),
                value:
                    varName.slice(
                        index + 1
                    ),
                line:
                    lineNumber
            };
        }

        if (parts[2] === "to") {
            return {
                type: "set",
                name:
                    varName,
                value:
                    parts
                        .slice(3)
                        .join("."),
                line:
                    lineNumber
            };
        }

        return {
            type: "unknown",
            source:
                line,
            line:
                lineNumber
        };
    }

    // ========================================================
    // ARRAYS
    // ========================================================

    if (
        parts[0] === "array" &&
        [
            "int",
            "string",
            "bool",
            "float"
        ].includes(parts[1])
    ) {
        return {
            type: "arrayCreate",
            dataType:
                parts[1],
            name:
                parts[2],
            line:
                lineNumber
        };
    }

    if (
        parts[0] === "array" &&
        parts[1] === "add"
    ) {
        return {
            type: "arrayAdd",
            name:
                parts[2],
            value:
                parts
                    .slice(3)
                    .join("."),
            line:
                lineNumber
        };
    }

    if (
        parts[0] === "array" &&
        parts[1] === "remove"
    ) {
        return {
            type: "arrayRemove",
            name:
                parts[2],
            line:
                lineNumber
        };
    }

    if (
        parts[0] === "array" &&
        parts[1] === "get" &&
        parts[3] === "print"
    ) {
        return {
            type: "arrayPrint",
            name:
                parts[2],
            line:
                lineNumber
        };
    }

    if (
        parts[0] === "array" &&
        parts[1] === "rename"
    ) {
        return {
            type: "arrayRename",
            oldName:
                parts[2],
            newName:
                parts[3],
            line:
                lineNumber
        };
    }

    // ========================================================
    // FILES
    // ========================================================

    if (
        parts[0] === "file" &&
        parts[
            parts.length - 1
        ] === "read"
    ) {
        return {
            type: "fileRead",
            file:
                parts
                    .slice(
                        1,
                        -1
                    )
                    .join("."),
            line:
                lineNumber
        };
    }

    if (
        parts[0] === "file" &&
        parts[
            parts.length - 2
        ] === "write"
    ) {
        return {
            type: "fileWrite",
            file:
                parts
                    .slice(
                        1,
                        -2
                    )
                    .join("."),
            value:
                parts[
                    parts.length - 1
                ],
            line:
                lineNumber
        };
    }

    // ========================================================
    // CONTROL
    // ========================================================

    if (parts[0] === "for") {
        return {
            type: "block",
            blockType:
                "for",
            value:
                parts
                    .slice(1)
                    .join("."),
            body: [],
            line:
                lineNumber
        };
    }

    if (line === "forever") {
        return {
            type: "block",
            blockType:
                "forever",
            body: [],
            line:
                lineNumber
        };
    }

    if (parts[0] === "if") {
        return {
            type: "block",
            blockType:
                "if",
            condition:
                parts
                    .slice(1)
                    .join("."),
            body: [],
            line:
                lineNumber
        };
    }

    if (parts[0] === "while") {
        return {
            type: "block",
            blockType:
                "while",
            condition:
                parts
                    .slice(1)
                    .join("."),
            body: [],
            line:
                lineNumber
        };
    }

    if (parts[0] === "function") {
        return {
            type: "block",
            blockType:
                "function",
            name:
                parts[1],
            body: [],
            line:
                lineNumber
        };
    }

    if (parts[0] === "else") {
        return {
            type: "else",
            command:
                parts
                    .slice(1)
                    .join("."),
            line:
                lineNumber
        };
    }

    if (parts[0] === "elseif") {
        return {
            type: "elseIf",
            condition:
                parts
                    .slice(1)
                    .join("."),
            body: [],
            line:
                lineNumber
        };
    }

    // ========================================================
    // OTHER
    // ========================================================

    if (parts[0] === "return") {
        return {
            type: "return",
            value:
                parts
                    .slice(1)
                    .join("."),
            line:
                lineNumber
        };
    }

    if (parts[0] === "import") {
        return {
            type: "import",
            name:
                parts
                    .slice(1)
                    .join("."),
            line:
                lineNumber
        };
    }

    if (parts[0] === "instruccion") {
        return {
            type: "instruction",
            priority:
                Number(parts[1]),
            command:
                parts
                    .slice(2)
                    .join("."),
            line:
                lineNumber
        };
    }

    if (parts[0] === "draw") {
        const drawMatch =
            line.match(
                /^draw\.(.+?)\.(square|triangle|circle)$/
            );

        if (!drawMatch) {
            return {
                type: "draw",
                data:
                    parts.slice(1),
                line:
                    lineNumber
            };
        }

        return {
            type: "draw",
            data:
                drawMatch.slice(1),
            line:
                lineNumber
        };
    }

    if (parts[0] === "when") {
        return {
            type: "when",
            event:
                parts[1],
            command:
                parts
                    .slice(2)
                    .join("."),
            line:
                lineNumber
        };
    }

    if (parts[0] === "wait") {
        return {
            type: "wait",
            seconds:
                parts
                    .slice(1)
                    .join("."),
            line:
                lineNumber
        };
    }

    // ========================================================
    // END.WAIT
    // ========================================================

    if (
        parts[0] === "end" &&
        parts[1] === "wait"
    ) {
        return {
            type: "endWait",
            seconds:
                parts
                    .slice(2)
                    .join("."),
            line:
                lineNumber
        };
    }

    // ========================================================
    // END.REPEAT
    // ========================================================

    if (
        parts[0] === "end" &&
        parts[1] === "repeat"
    ) {
        return {
            type: "endRepeat",
            times:
                parts
                    .slice(2)
                    .join("."),
            line:
                lineNumber
        };
    }

    // ========================================================
    // USE
    // ========================================================

    if (parts[0] === "use") {
        return {
            type: "use",
            destination:
                parts[1],
            source:
                parts[2],
            line:
                lineNumber
        };
    }

    // ========================================================
    // PERCENTAGE
    // ========================================================

    if (line.endsWith("%")) {
        return {
            type: "percentage",
            value:
                line.slice(
                    0,
                    -1
                ),
            line:
                lineNumber
        };
    }

    // ========================================================
    // FUNCTION CALL
    // ========================================================
    // D-TECH functions are executed with:
    //
    // functionName()
    //
    // "call()" is NOT a D-TECH command.
    // ========================================================

    const callMatch =
        line.match(
            /^(\w+)\(\)$/
        );

    if (callMatch) {
        return {
            type: "call",
            name:
                callMatch[1],
            line:
                lineNumber
        };
    }

    // ========================================================
    // UNKNOWN
    // ========================================================

    return {
        type: "unknown",
        source:
            line,
        line:
            lineNumber
    };
}

// ============================================================
// EXECUTOR
// ============================================================

async function executeNodes(nodes) {
    for (const node of nodes) {

        if (!state.running) {
            break;
        }

        const result =
            await executeNode(node);

        if (
            result &&
            (
                result.type === "return" ||
                result.type === "end"
            )
        ) {
            return result;
        }
    }

    return null;
}

// ============================================================
// SERVER
// ============================================================
function startNetworkClient() {
    return new Promise((resolve) => {
        const python = spawn(
            "python",
            [
                path.join(
                    __dirname,
                    "network.py"
                )
            ],
            {
                stdio: "inherit"
            }
        );

        python.on("error", error => {
            dtechError(
                `Could not start network.py: ${error.message}`
            );

            resolve(1);
        });

        python.on("close", code => {
            resolve(
                code ?? 0
            );
        });
    });
}

function showServerPrompt() {
    if (
        state.server.running &&
        state.server.consoleActive
    ) {
        process.stdout.write(
            "SUDO@SERVER-:=> "
        );
    }
}

function showServerHelp() {
    console.log("");
    console.log("D-TECH SERVER COMMANDS");
    console.log("");
    console.log(
        "  help              Show this help"
    );
    console.log(
        "  status            Show server status"
    );
    console.log(
        "  list              List connected clients"
    );
    console.log(
        "  requests          List pending requests"
    );
    console.log(
        "  accept <id>       Accept a pending request"
    );
    console.log(
        "  reject <id>       Reject a pending request"
    );
    console.log(
        "  clear             Clear the terminal"
    );
    console.log(
        "  shutdown          Shutdown the server"
    );
    console.log("");
}

function showServerStatus() {
    console.log("");
    console.log("SERVER STATUS");
    console.log("");
    console.log(
        `  Status: ${
            state.server.running
                ? "RUNNING"
                : "STOPPED"
        }`
    );
    console.log(
        `  Port: ${state.server.port}`
    );
    console.log(
        `  Max connections: ${state.server.maxJoins}`
    );
    console.log(
        `  Active connections: ${state.server.connections}`
    );
    console.log(
        `  Connected clients: ${state.server.clients.length}`
    );
    console.log(
        `  Pending requests: ${state.server.pendingRequests.size}`
    );
    console.log("");
}

function showServerList() {
    console.log("");

    if (
        state.server.clients.length === 0
    ) {
        console.log(
            "Connected clients: none."
        );
        console.log("");
        return;
    }

    console.log("CONNECTED CLIENTS");

    for (
        const client of state.server.clients
    ) {
        console.log(
            `  ${client.id} | ${client.ip} | ${client.method} ${client.url}`
        );
    }

    console.log("");
}

function showPendingRequests() {
    console.log("");

    if (
        state.server.pendingRequests.size === 0
    ) {
        console.log(
            "Pending requests: none."
        );
        console.log("");
        return;
    }

    console.log("PENDING REQUESTS");

    for (
        const [id, request]
        of state.server.pendingRequests
    ) {
        console.log(
            `  ${id} | ${request.ip} | ${request.method} ${request.url}`
        );
    }

    console.log("");
}

function findPendingRequest(id) {
    const numericId =
        Number(id);

    if (
        !Number.isInteger(
            numericId
        ) ||
        !state.server.pendingRequests.has(
            numericId
        )
    ) {
        return null;
    }

    return state.server.pendingRequests.get(
        numericId
    );
}

function acceptRequest(id) {
    const request =
        findPendingRequest(id);

    if (!request) {
        console.log(
            `Request ${id} was not found.`
        );

        return;
    }

    state.server.pendingRequests.delete(
        Number(id)
    );

    const client = {
        id:
            request.id,
        ip:
            request.ip,
        method:
            request.method,
        url:
            request.url
    };

    state.server.clients.push(
        client
    );

    console.log(
        `[SERVER] Request ${id} ACCEPTED`
    );

    try {
        request.res.writeHead(200);
        request.res.end("OK");
    } catch (_) {}

    state.server.connections =
        Math.max(
            0,
            state.server.connections - 1
        );
}

function rejectRequest(id) {
    const request =
        findPendingRequest(id);

    if (!request) {
        console.log(
            `Request ${id} was not found.`
        );

        return;
    }

    state.server.pendingRequests.delete(
        Number(id)
    );

    console.log(
        `[SERVER] Request ${id} REJECTED`
    );

    try {
        request.res.writeHead(403);
        request.res.end("Forbidden");
    } catch (_) {}

    state.server.connections =
        Math.max(
            0,
            state.server.connections - 1
        );
}

async function shutdownServer() {
    if (!state.server.server) {
        console.log(
            "Server is not running."
        );

        return;
    }

    console.log(
        "Shutting down D-TECH server..."
    );

    for (
        const [id, request]
        of state.server.pendingRequests
    ) {
        try {
            request.res.writeHead(503);
            request.res.end(
                "Server shutting down"
            );
        } catch (_) {}

        state.server.pendingRequests.delete(
            id
        );
    }

    await new Promise(resolve => {
        state.server.server.close(
            () => {
                resolve();
            }
        );
    });

    state.server.running = false;
    state.server.consoleActive = false;
    state.server.server = null;
    state.server.connections = 0;
    state.server.pendingRequests.clear();

    state.running = false;

    console.log(
        "Server stopped."
    );
}

async function handleServerCommand(input) {
    const command =
        String(input).trim();

    if (!command) {
        showServerPrompt();
        return;
    }

    const args =
        command.split(/\s+/);

    const cmd =
        args[0].toLowerCase();

    switch (cmd) {

        case "help":
            showServerHelp();
            break;

        case "status":
            showServerStatus();
            break;

        case "list":
            showServerList();
            break;

        case "requests":
            showPendingRequests();
            break;

        case "accept":

            if (!args[1]) {
                console.log(
                    "Usage: accept <id>"
                );
            } else {
                acceptRequest(
                    args[1]
                );
            }

            break;

        case "reject":

            if (!args[1]) {
                console.log(
                    "Usage: reject <id>"
                );
            } else {
                rejectRequest(
                    args[1]
                );
            }

            break;

        case "clear":
            console.clear();
            break;

        case "shutdown":
            await shutdownServer();
            return;

        default:
            console.log(
                `Unknown server command: ${cmd}`
            );

            console.log(
                "Use 'help' to see available commands."
            );

            break;
    }

    if (state.server.running) {
        showServerPrompt();
    }
}

// ============================================================
// SERVER INPUT
// ============================================================

rl.on("line", async input => {
    if (
        state.server.running &&
        state.server.consoleActive
    ) {
        await handleServerCommand(
            input
        );
    }
});

// ============================================================
// EXECUTE NODE
// ============================================================

async function executeNode(node) {

    switch (node.type) {
case "networkConnect":

    await startNetworkClient();

    return null;
        // ====================================================
        // SERVER
        // ====================================================

        case "startServer": {

            state.server.port =
                node.port;

            state.server.maxJoins =
                node.maxJoins;

            const server =
                http.createServer(
                    (req, res) => {

                        if (
                            state.server.connections >=
                            state.server.maxJoins
                        ) {
                            const logMsg =
                                `[SERVER] REJECTED: Max connections (${state.server.maxJoins}) reached. IP: ${req.socket.remoteAddress}`;

                            dtechInfo(
                                logMsg
                            );

                            res.writeHead(
                                503
                            );

                            res.end(
                                "Server at max capacity"
                            );

                            return;
                        }

                        state.server.connections++;

                        const requestId =
                            state.server.nextRequestId++;

                        const request = {
                            id:
                                requestId,
                            ip:
                                req.socket.remoteAddress,
                            method:
                                req.method,
                            url:
                                req.url,
                            res
                        };

                        state.server.pendingRequests.set(
                            requestId,
                            request
                        );

                        dtechInfo(
                            `[SERVER] Incoming request #${requestId} from IP: ${req.socket.remoteAddress} | Method: ${req.method} | URL: ${req.url}`
                        );

                        console.log("");
                        console.log(
                            `Incoming request #${requestId}`
                        );
                        console.log(
                            `   IP: ${req.socket.remoteAddress}`
                        );
                        console.log(
                            `   Method: ${req.method}`
                        );
                        console.log(
                            `   URL: ${req.url}`
                        );

                        showServerPrompt();
                    }
                );

            state.server.server =
                server;

            await new Promise(
                (resolve, reject) => {

                    const onError =
                        error => {
                            server.off(
                                "listening",
                                onListening
                            );

                            reject(error);
                        };

                    const onListening =
                        () => {
                            server.off(
                                "error",
                                onError
                            );

                            state.server.running =
                                true;

                            state.server.consoleActive =
                                true;

                            resolve();
                        };

                    server.once(
                        "error",
                        onError
                    );

                    server.once(
                        "listening",
                        onListening
                    );

                    server.listen(
                        state.server.port
                    );
                }
            );

            console.log(
                "D-TECH Server initialized"
            );

            console.log(
                `Listening on port ${state.server.port}`
            );

            console.log(
                `Max connections: ${state.server.maxJoins}`
            );

            console.log(
                "Interactive server console active."
            );

            return null;
        }

        // ====================================================
        // VARIABLE
        // ====================================================

        case "createVariable":

            state.tipos[node.name] =
                node.dataType;

            state.variables[node.name] =
                defaultValue(
                    node.dataType
                );

            dtechInfo(
                `Variable created: ${node.name}`
            );

            return null;

        // ====================================================
        // OBJECT
        // ====================================================

        case "createObject":

            state.variables[node.name] = {
                type:
                    node.shape
            };

            dtechInfo(
                `Object ${node.shape} created: ${node.name}`
            );

            return null;

        // ====================================================
        // INPUT
        // ====================================================

        case "input":

            await new Promise(
                resolve => {
                    rl.question(
                        "INPUT > ",
                        answer => {

                            state.variables[
                                "#input"
                            ] = answer;

                            resolve();
                        }
                    );
                }
            );

            return null;

        // ====================================================
        // MOUSE
        // ====================================================

        case "mouseInput":

            dtechWarning(
                "input.mouse requires a graphical environment."
            );

            return null;

        // ====================================================
        // AFFILIATE
        // ====================================================

        case "affiliate":

            state.afiliaciones[
                node.symbol
            ] =
                node.variable;

            dtechInfo(
                `${node.symbol} affiliated with ${node.variable}`
            );

            return null;

        // ====================================================
        // CONSOLE
        // ====================================================

        case "console": {

            const mode =
                node.mode;

            const value =
                node.value;

            if (mode === "all") {

                state.console.all =
                    value;

                state.console.info =
                    value;

                state.console.debug =
                    value;

                state.console.warning =
                    value;

                state.console.error =
                    value;

                return null;
            }

            if (
                [
                    "info",
                    "debug",
                    "warning",
                    "error"
                ].includes(mode)
            ) {
                state.console[mode] =
                    value;

                return null;
            }

            return null;
        }

        // ====================================================
        // INFO MESSAGE
        // ====================================================

        case "consoleInfoMessage": {

            const message =
                replaceVariables(
                    node.message
                );

            if (
                state.console.all ||
                state.console.info
            ) {
                console.log(message);
                writeLog(message);
            }

            return null;
        }

        // ====================================================
        // LOG FILE
        // ====================================================

        case "logFile":

            state.log.file =
                node.file;

            state.log.enabled =
                true;

            return null;

        // ====================================================
        // LET
        // ====================================================

        case "let":

            if (node.source) {
                state.variables[
                    node.destination
                ] =
                    state.variables[
                        node.source
                    ];
            }

            return null;

        // ====================================================
        // SET
        // ====================================================

        case "set": {

            const value =
                evaluate(
                    node.value
                );

            setVariable(
                node.name,
                value
            );

            dtechDebug(
                `SET ${node.name} = ${value}`
            );

            return null;
        }

        // ====================================================
        // ARRAY CREATE
        // ====================================================

        case "arrayCreate":

            state.arrays[
                node.name
            ] = [];

            state.tipos[
                node.name
            ] =
                node.dataType;

            dtechDebug(
                `Array created: ${node.name} (${node.dataType})`
            );

            return null;

        // ====================================================
        // ARRAY ADD
        // ====================================================

        case "arrayAdd":

            if (
                !state.arrays[node.name]
            ) {
                state.arrays[node.name] =
                    [];
            }

            state.arrays[
                node.name
            ].push(
                evaluate(
                    node.value
                )
            );

            return null;

        // ====================================================
        // ARRAY REMOVE
        // ====================================================

        case "arrayRemove":

            if (
                state.arrays[node.name]
            ) {
                state.arrays[
                    node.name
                ].pop();
            }

            return null;

        // ====================================================
        // ARRAY PRINT
        // ====================================================

        case "arrayPrint":

            console.log(
                state.arrays[
                    node.name
                ] || []
            );

            return null;

        // ====================================================
        // ARRAY RENAME
        // ====================================================

        case "arrayRename":

            if (
                state.arrays[
                    node.oldName
                ]
            ) {
                state.arrays[
                    node.newName
                ] =
                    state.arrays[
                        node.oldName
                    ];

                delete state.arrays[
                    node.oldName
                ];
            }

            return null;

        // ====================================================
        // FILE READ
        // ====================================================

        case "fileRead": {

            const target =
                cleanPath(
                    node.file
                );

            if (
                !fs.existsSync(target)
            ) {
                dtechError(
                    `File not found: ${target}`
                );

                return null;
            }

            state.variables[
                "#file"
            ] =
                fs.readFileSync(
                    target,
                    "utf8"
                );

            return null;
        }

        // ====================================================
        // FILE WRITE
        // ====================================================

        case "fileWrite": {

            const target =
                cleanPath(
                    node.file
                );

            const content =
                evaluate(
                    node.value
                );

            try {
                fs.writeFileSync(
                    target,
                    String(content),
                    "utf8"
                );
            } catch (error) {
                dtechError(
                    `Could not write file: ${error.message}`
                );
            }

            return null;
        }

        // ====================================================
        // BLOCKS
        // ====================================================

        case "block":

            if (
                node.blockType === "for"
            ) {
                const times =
                    Number(
                        evaluate(
                            node.value
                        )
                    );

                for (
                    let i = 0;
                    i < times;
                    i++
                ) {
                    const result =
                        await executeNodes(
                            node.body
                        );

                    if (result) {
                        return result;
                    }
                }

                return null;
            }

            if (
                node.blockType === "forever"
            ) {
                while (
                    state.running
                ) {
                    const result =
                        await executeNodes(
                            node.body
                        );

                    if (
                        result &&
                        result.type === "return"
                    ) {
                        return result;
                    }

                    await sleep(0);
                }

                return null;
            }

            if (
                node.blockType === "if"
            ) {
                if (
                    evaluateCondition(
                        node.condition
                    )
                ) {
                    return await executeNodes(
                        node.body
                    );
                }

                return null;
            }

            if (
                node.blockType === "while"
            ) {
                let safety = 0;

                while (
                    evaluateCondition(
                        node.condition
                    )
                ) {
                    const result =
                        await executeNodes(
                            node.body
                        );

                    if (result) {
                        return result;
                    }

                    safety++;

                    if (
                        safety > 100000
                    ) {
                        dtechError(
                            "While loop stopped for safety."
                        );

                        break;
                    }
                }

                return null;
            }

            if (
                node.blockType === "function"
            ) {
                state.funciones[
                    node.name
                ] =
                    node.body;

                dtechDebug(
                    `Function registered: ${node.name}`
                );

                return null;
            }

            return null;

        // ====================================================
        // ELSE
        // ====================================================

        case "else":

            return await executeCommandString(
                node.command
            );

        // ====================================================
        // ELSEIF
        // ====================================================

        case "elseIf":

            if (
                evaluateCondition(
                    node.condition
                )
            ) {
                return await executeNodes(
                    node.body
                );
            }

            return null;

        // ====================================================
        // RETURN
        // ====================================================

        case "return":

            state.returnValue =
                evaluate(
                    node.value
                );

            return {
                type: "return",
                value:
                    state.returnValue
            };

        // ====================================================
        // IMPORT
        // ====================================================

        case "import":

            state.imports.push(
                node.name
            );

            dtechInfo(
                `Import registered: ${node.name}`
            );

            return null;

        // ====================================================
        // INSTRUCTION
        // ====================================================

        case "instruction":

            dtechDebug(
                `Instruction priority ${node.priority}: ${node.command}`
            );

            return await executeCommandString(
                node.command
            );

        // ====================================================
        // PRINT.LINE
        // ====================================================

        case "printLine": {

            const delay =
                Number(
                    evaluate(
                        node.delay
                    )
                );

            const text =
                replaceVariables(
                    node.text
                );

            for (
                const char of text
            ) {
                process.stdout.write(
                    char
                );

                await sleep(
                    Math.max(
                        0,
                        delay * 1000
                    )
                );
            }

            process.stdout.write(
                "\n"
            );

            return null;
        }

        // ====================================================
        // PRINT
        // ====================================================

        case "print":

            console.log(
                replaceVariables(
                    node.text
                )
            );

            return null;

        // ====================================================
        // DRAW
        // ====================================================

        case "draw":

            executeDraw(
                node.data
            );

            return null;

        // ====================================================
        // SEND
        // ====================================================

        case "send":

            dtechInfo(
                `[SEND] ${replaceVariables(node.text)}`
            );

            return null;

        // ====================================================
        // WHEN
        // ====================================================

        case "when":

            if (
                !state.eventos[
                    node.event
                ]
            ) {
                state.eventos[
                    node.event
                ] = [];
            }

            state.eventos[
                node.event
            ].push(
                node.command
            );

            return null;

        // ====================================================
        // WAIT
        // ====================================================

        case "wait":

            await sleep(
                Number(
                    evaluate(
                        node.seconds
                    )
                ) * 1000
            );

            return null;

        // ====================================================
        // END.WAIT
        // ====================================================

        case "endWait":

            await sleep(
                Number(
                    evaluate(
                        node.seconds
                    )
                ) * 1000
            );

            state.running =
                false;

            return {
                type: "end"
            };

        // ====================================================
        // END.REPEAT
        // ====================================================

        case "endRepeat": {

            const times =
                Number(
                    evaluate(
                        node.times
                    )
                );

            for (
                let i = 0;
                i < times;
                i++
            ) {
                // Repeat marker.
            }

            return null;
        }

        // ====================================================
        // END
        // ====================================================

        case "end":

            state.running =
                false;

            return {
                type: "end"
            };

        // ====================================================
        // FUNCTION CALL
        // ====================================================
        // D-TECH:
        //
        // function test
        //     ...
        // end
        //
        // test()
        //
        // ====================================================

        case "call":

            if (
                !state.funciones[
                    node.name
                ]
            ) {
                dtechError(
                    `Function ${node.name} does not exist.`
                );

                return null;
            }

            return await executeNodes(
                state.funciones[
                    node.name
                ]
            );

        // ====================================================
        // USE
        // ====================================================

        case "use":

            state.variables[
                node.destination
            ] =
                state.variables[
                    node.source
                ];

            return null;

        // ====================================================
        // PERCENTAGE
        // ====================================================

        case "percentage":

            console.log(
                `${replaceVariables(node.value)}%`
            );

            return null;

        // ====================================================
        // UNKNOWN
        // ====================================================

        case "unknown":

            dtechError(
                `Unknown D-TECH command: ${node.source}`,
                node.line
            );

            return null;

        default:

            dtechError(
                `Unknown node type: ${node.type}`
            );

            return null;
    }
}

// ============================================================
// CONDITIONS
// ============================================================

function evaluateCondition(condition) {

    condition =
        condition.trim();

    if (
        condition.includes(".using.")
    ) {
        const parts =
            condition.split(
                ".using."
            );

        const left =
            evaluate(parts[0]);

        const right =
            evaluate(parts[1]);

        return left === right;
    }

    return Boolean(
        evaluateExpression(
            condition
        )
    );
}

// ============================================================
// INDIVIDUAL COMMAND
// ============================================================

async function executeCommandString(
    command
) {
    const node =
        transformLine(
            command,
            0
        );

    return await executeNode(
        node
    );
}

// ============================================================
// DRAW
// ============================================================

function executeDraw(data) {

    if (
        !data ||
        data.length < 2
    ) {
        dtechError(
            "Invalid DRAW command."
        );

        return;
    }

    let radio;
    let figura;

    if (
        [
            "square",
            "triangle",
            "circle"
        ].includes(data[0])
    ) {
        figura =
            data[0];

        radio =
            data[1];
    } else {
        radio =
            data[0];

        figura =
            data[1];
    }

    radio =
        Number(
            evaluate(radio)
        );

    switch (figura) {

        case "square":
            console.log(
                "┌──────┐"
            );
            console.log(
                "│      │"
            );
            console.log(
                "│      │"
            );
            console.log(
                "└──────┘"
            );
            break;

        case "triangle":
            console.log(
                "   △"
            );
            break;

        case "circle":
            console.log(
                "  ◯"
            );
            break;

        default:
            dtechError(
                `Unknown figure: ${figura}`
            );
    }
}

// ============================================================
// DEFAULT VALUES
// ============================================================

function defaultValue(type) {
    switch (type) {

        case "int":
            return 0;

        case "float":
            return 0.0;

        case "string":
            return "";

        case "bool":
            return false;

        default:
            return null;
    }
}

// ============================================================
// PATH
// ============================================================

function cleanPath(filePath) {

    filePath =
        replaceVariables(
            filePath
        );

    filePath =
        filePath.replace(
            /^["']|["']$/g,
            ""
        );

    return path.resolve(
        path.dirname(file),
        filePath
    );
}

// ============================================================
// SLEEP
// ============================================================

function sleep(ms) {
    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                ms
            )
    );
}

// ============================================================
// MAIN
// ============================================================

async function run() {

    try {

        console.log(
            "================================"
        );

        console.log(
            "       D-TECH RUNTIME"
        );

        console.log(
            "================================"
        );

        const source =
            fs.readFileSync(
                file,
                "utf8"
            ).replace(
                /^\uFEFF/,
                ""
            );

        const program =
            parseSource(
                source
            );

        dtechInfo(
            `File: ${path.basename(file)}`
        );

        dtechInfo(
            `Type: ${program.header}`
        );

        dtechInfo(
            "Transformation completed."
        );

        await executeNodes(
            program.body
        );

        if (
            state.server.running
        ) {
            console.log("");

            console.log(
                "Server console active. Waiting for requests..."
            );

            showServerPrompt();

            return;
        }

        console.log("");

        console.log(
            "===== D-TECH FINISHED ====="
        );

        dtechDebug(
            `Variables: ${JSON.stringify(
                state.variables,
                null,
                2
            )}`
        );

    } catch (error) {

        console.error("");

        console.error(
            "================================"
        );

        console.error(
            "       D-TECH FATAL ERROR"
        );

        console.error(
            "================================"
        );

        console.error(
            error.message
        );

        process.exitCode =
            1;

    } finally {

        if (
            !state.server.running
        ) {
            rl.close();

            globalThis.__DTECH_RUNNING__ =
                false;
        }
    }
}

// ============================================================
// START
// ============================================================

run();
