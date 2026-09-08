#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const readline = require("readline");

// ============================================================
// D-TECH RUNTIME
// ============================================================
//
// .dtech  = código
// .dteche = ejecutable
//
// Flujo:
//
// D-TECH SOURCE
//      ↓
// LEXER / PARSER
//      ↓
// D-TECH AST
//      ↓
// EXECUTOR
//
// ============================================================


// ============================================================
// ANTI LOOP
// ============================================================

if (globalThis.__DTECH_RUNNING__) {
    console.error("DTECH: ya hay una instancia ejecutándose.");
    process.exit(1);
}

globalThis.__DTECH_RUNNING__ = true;


// ============================================================
// ARCHIVO
// ============================================================

const file = process.argv[2];

if (!file) {
    console.log("D-TECH Runtime");
    console.log("");
    console.log("Uso:");
    console.log("  node DTECH_interpreter.js archivo.dtech");
    process.exit(1);
}

if (!fs.existsSync(file)) {
    console.error("DTECH ERROR: archivo no encontrado.");
    process.exit(1);
}

const extension = path.extname(file).toLowerCase();

if (extension !== ".dtech" && extension !== ".dteche") {
    console.error("DTECH ERROR: extensión inválida.");
    console.error("Se esperaba .dtech o .dteche.");
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
// ESTADO DEL RUNTIME
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
        info: true,
        debug: true,
        warning: true,
        error: true
    },

    log: {
        enabled: false,
        file: "dtech.log"
    },

    running: true,

    returnValue: undefined
};


// ============================================================
// UTILIDADES
// ============================================================

function dtechError(message, line = null) {

    if (!state.console.error) {
        return;
    }

    if (line !== null) {
        console.error(`DTECH ERROR [línea ${line}]: ${message}`);
    } else {
        console.error(`DTECH ERROR: ${message}`);
    }
}


function dtechInfo(message) {

    if (state.console.info) {
        console.log(`[DTECH INFO] ${message}`);
    }
}


function dtechDebug(message) {

    if (state.console.debug) {
        console.log(`[DTECH DEBUG] ${message}`);
    }
}


function dtechWarning(message) {

    if (state.console.warning) {
        console.warn(`[DTECH WARNING] ${message}`);
    }
}


function writeLog(message) {

    if (!state.log.enabled) {
        return;
    }

    const timestamp = new Date().toISOString();

    fs.appendFileSync(
        state.log.file,
        `[${timestamp}] ${message}\n`
    );
}


function runtimeLog(message) {

    writeLog(message);
    console.log(message);
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
        dtechWarning(`La variable ${name} no existe.`);
        return undefined;
    }

    return state.variables[name];
}


function setVariable(name, value) {

    state.variables[name] = value;

    if (state.tipos[name]) {

        const tipo = state.tipos[name];

        if (!validateType(value, tipo)) {

            dtechError(
                `El valor de ${name} no coincide con el tipo ${tipo}.`
            );

            return;
        }
    }
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
// REEMPLAZAR VARIABLES
// ============================================================

function replaceVariables(text) {

    text = String(text);

    for (const name of Object.keys(state.variables)) {

        const value = state.variables[name];

        if (value === undefined || value === null) {
            continue;
        }

        const escaped = name.replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
        );

        text = text.replace(
            new RegExp(escaped, "g"),
            String(value)
        );
    }

    // símbolo $

    for (const symbol of Object.keys(state.afiliaciones)) {

        const variable =
            state.afiliaciones[symbol];

        const value =
            state.variables[variable];

        if (value !== undefined) {

            text = text.replace(
                /\$/g,
                String(value)
            );
        }
    }

    return text;
}


// ============================================================
// EVALUADOR
// ============================================================

function evaluate(value) {

    if (value === undefined || value === null) {
        return undefined;
    }

    value = String(value).trim();

    // STRING

    if (
        value.startsWith('"') &&
        value.endsWith('"')
    ) {

        return replaceVariables(
            value.slice(1, -1)
        );
    }


    // TRUE

    if (value === "true") {
        return true;
    }


    // FALSE

    if (value === "false") {
        return false;
    }


    // VARIABLE

    if (
        value.startsWith("#") &&
        hasVariable(value)
    ) {

        return getVariable(value);
    }


    // ARRAY

    if (
        value.startsWith("#") &&
        state.arrays[value]
    ) {

        return state.arrays[value];
    }


    // OPERACIÓN

    return evaluateExpression(value);
}


// ============================================================
// EXPRESIONES
// ============================================================

function evaluateExpression(expression) {

    expression = replaceVariables(
        String(expression).trim()
    );

    // igualdad

    if (expression.includes("==")) {

        const parts =
            expression.split("==");

        return evaluateExpression(parts[0]) ===
               evaluateExpression(parts.slice(1).join("=="));
    }


    // mayor

    if (expression.includes(">")) {

        const parts =
            expression.split(">");

        return Number(
            evaluateExpression(parts[0])
        ) >
        Number(
            evaluateExpression(parts.slice(1).join(">"))
        );
    }


    // menor

    if (expression.includes("<")) {

        const parts =
            expression.split("<");

        return Number(
            evaluateExpression(parts[0])
        ) <
        Number(
            evaluateExpression(parts.slice(1).join("<"))
        );
    }


    // suma

    const plus = splitMath(expression, "+");

    if (plus.length > 1) {

        return plus.reduce(
            (a, b) =>
                Number(a) +
                Number(evaluateExpression(b)),
            0
        );
    }


    // resta

    const minus =
        splitMath(expression, "-");

    if (minus.length > 1) {

        let result =
            Number(evaluateExpression(minus[0]));

        for (let i = 1; i < minus.length; i++) {

            result -= Number(
                evaluateExpression(minus[i])
            );
        }

        return result;
    }


    // multiplicación

    const multiply =
        splitMath(expression, "*");

    if (multiply.length > 1) {

        return multiply.reduce(
            (a, b) =>
                Number(a) *
                Number(evaluateExpression(b)),
            1
        );
    }


    // división

    const divide =
        splitMath(expression, "/");

    if (divide.length > 1) {

        let result =
            Number(evaluateExpression(divide[0]));

        for (let i = 1; i < divide.length; i++) {

            result /=
                Number(
                    evaluateExpression(divide[i])
                );
        }

        return result;
    }


    // número

    if (
        expression !== "" &&
        !Number.isNaN(Number(expression))
    ) {

        return Number(expression);
    }


    // variable

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
// LECTOR DE BLOQUES
// ============================================================
function parseSource(content) {

    const lines = content.split(/\r?\n/);

    const root = [];
    const stack = [root];

    let headerFound = false;
    let headerType = null;

    for (let i = 0; i < lines.length; i++) {

        const lineNumber = i + 1;

        let line = lines[i]
            .replace(/^\uFEFF/, "")
            .replace(/^\u200B/, "")
            .trim();

        if (!line) {
            continue;
        }

        // COMENTARIOS

        if (line.startsWith("//")) {
            continue;
        }

        // HEADER

        const normalizedHeader = line
            .replace(/^\uFEFF/, "")
            .replace(/^\u200B/, "")
            .trim();

        if (
            /^<type:dtech:(executable|code)>$/.test(
                normalizedHeader
            )
        ) {

            headerFound = true;

            if (
                normalizedHeader ===
                "<type:dtech:executable>"
            ) {
                headerType = "executable";
            }

            if (
                normalizedHeader ===
                "<type:dtech:code>"
            ) {
                headerType = "code";
            }

            continue;
        }

        // IGNORAR COMENTARIOS #

        if (
            line.startsWith("#") &&
            !line.match(/^#\w+/)
        ) {
            continue;
        }

        // END DE BLOQUE (supports both "end" and "}")

        if (line === "end" || line === "}") {

            if (stack.length <= 1) {

                dtechError(
                    "END sin bloque abierto.",
                    lineNumber
                );

                continue;
            }

            stack.pop();

            continue;
        }

        // TRANSFORMAR

        const node =
            transformLine(
                line,
                lineNumber
            );

        // BLOQUE

        if (node.type === "block") {

            stack[stack.length - 1].push(node);

            stack.push(node.body);

            continue;
        }

        // ELSEIF

        if (node.type === "elseIf") {

            if (stack.length <= 1) {

                dtechError(
                    "ELSEIF sin bloque.",
                    lineNumber
                );

                continue;
            }

            stack.pop();

            const parent =
                stack[stack.length - 1];

            parent.push(node);

            stack.push(node.body);

            continue;
        }

        // COMANDO NORMAL

        stack[stack.length - 1].push(node);
    }

    // BLOQUES SIN CERRAR

    if (stack.length > 1) {

        dtechError(
            "Hay bloques sin cerrar."
        );
    }

    // HEADER FALTANTE

    if (!headerFound) {

        throw new Error(
            "Falta <type:dtech:executable> o <type:dtech:code> en la línea 1"
        );
    }

    return {
        header: headerType,
        body: root
    };
}

// ============================================================
// TRANSFORMADOR - DYNAMIC COMMAND PARSER
// ============================================================

function transformLine(line, lineNumber) {

    // SPLIT BY DOTS FOR DYNAMIC PARSING
    const parts = line.split(".");

    // ========== @command PARSER ==========

    if (parts[0] === "@command") {

        // @command.get.create.variable.type.#name
        if (parts[1] === "get" && parts[2] === "create") {

            if (parts[3] === "variable") {

                const dataType = parts[4] || null;
                const varName = parts[5];

                return {
                    type: "createVariable",
                    dataType: dataType,
                    name: varName,
                    line: lineNumber
                };
            }

            // @command.get.create.array.type.#name
            if (parts[3] === "array") {

                const arrayType = parts[4];
                const arrayName = parts[5];

                return {
                    type: "arrayCreate",
                    dataType: arrayType,
                    name: arrayName,
                    line: lineNumber
                };
            }

            // @command.get.create.object.shape.#name
            if (parts[3] === "object") {

                const shape = parts[4];
                const objName = parts[5];

                return {
                    type: "createObject",
                    shape: shape,
                    name: objName,
                    line: lineNumber
                };
            }
        }

        // @command.get.input or @command.get.input.mouse
        if (parts[1] === "get" && parts[2] === "input") {

            if (parts[3] === "mouse") {

                return {
                    type: "mouseInput",
                    line: lineNumber
                };
            }

            return {
                type: "input",
                line: lineNumber
            };
        }

        // @command.affiliate.symbol.to.#variable
        if (parts[1] === "affiliate") {

            const symbol = parts[2];
            // parts[3] is "to"
            const variable = parts[4];

            return {
                type: "affiliate",
                symbol: symbol,
                variable: variable,
                line: lineNumber
            };
        }

        // @command.console.type or @command.console.type==value
        if (parts[1] === "console") {

            const consoleType = parts[2];

            // Check for ==value pattern
            let value = true;

            if (consoleType.includes("==")) {

                const [type, val] =
                    consoleType.split("==");

                const mode = type;
                value = val === "true" ? true : false;

                // @command.console.log.file=="filename"
                if (mode === "log" && parts[3] === "file") {

                    const filename =
                        parts.slice(4).join(".")
                            .replace(/^=="/, "")
                            .replace(/"$/, "");

                    return {
                        type: "logFile",
                        file: filename,
                        line: lineNumber
                    };
                }

                return {
                    type: "console",
                    mode: mode,
                    value: value,
                    line: lineNumber
                };
            }

            // Simple @command.console.type
            return {
                type: "console",
                mode: consoleType,
                value: true,
                line: lineNumber
            };
        }

        // @command.let.#dest.#source
        if (parts[1] === "let") {

            const destination = parts[2];
            const source = parts[3];

            return {
                type: "let",
                destination: destination,
                source: source,
                line: lineNumber
            };
        }
    }

    // ========== SET PARSER - DYNAMIC ==========
    // set.#variable.to.value
    // set.#variable:value (alternative syntax)

    if (parts[0] === "set") {

        const varName = parts[1];

        // Handle set.#var:value syntax
        if (varName.includes(":")) {

            const [name, value] =
                varName.split(":");

            return {
                type: "set",
                name: name,
                value: value,
                line: lineNumber
            };
        }

        // Handle set.#var.to.value syntax
        if (parts[2] === "to") {

            const value = parts.slice(3).join(".");

            return {
                type: "set",
                name: varName,
                value: value,
                line: lineNumber
            };
        }

        // Fallback
        return {
            type: "unknown",
            source: line,
            line: lineNumber
        };
    }

    // ========== ARRAY COMMANDS ==========

    // array.type.#name
    if (parts[0] === "array" && 
        ["int", "string", "bool", "float"].includes(parts[1])) {

        const dataType = parts[1];
        const arrayName = parts[2];

        return {
            type: "arrayCreate",
            dataType: dataType,
            name: arrayName,
            line: lineNumber
        };
    }

    // array.add.#name.value
    if (parts[0] === "array" && parts[1] === "add") {

        const arrayName = parts[2];
        const value = parts.slice(3).join(".");

        return {
            type: "arrayAdd",
            name: arrayName,
            value: value,
            line: lineNumber
        };
    }

    // array.remove.#name
    if (parts[0] === "array" && parts[1] === "remove") {

        return {
            type: "arrayRemove",
            name: parts[2],
            line: lineNumber
        };
    }

    // array.get.#name.print
    if (parts[0] === "array" && 
        parts[1] === "get" && 
        parts[3] === "print") {

        return {
            type: "arrayPrint",
            name: parts[2],
            line: lineNumber
        };
    }

    // array.rename.#oldName.#newName
    if (parts[0] === "array" && parts[1] === "rename") {

        return {
            type: "arrayRename",
            oldName: parts[2],
            newName: parts[3],
            line: lineNumber
        };
    }

    // ========== FILE OPERATIONS ==========

    // file.path.read
    if (parts[0] === "file" && parts[parts.length - 1] === "read") {

        const filepath =
            parts.slice(1, -1).join(".");

        return {
            type: "fileRead",
            file: filepath,
            line: lineNumber
        };
    }

    // file.path.write.value
    if (parts[0] === "file" && parts[parts.length - 2] === "write") {

        const filepath =
            parts.slice(1, -2).join(".");

        const value = parts[parts.length - 1];

        return {
            type: "fileWrite",
            file: filepath,
            value: value,
            line: lineNumber
        };
    }

    // ========== CONTROL FLOW ==========

    // for.value
    if (parts[0] === "for") {

        const value = parts.slice(1).join(".");

        return {
            type: "block",
            blockType: "for",
            value: value,
            body: [],
            line: lineNumber
        };
    }

    // forever
    if (line === "forever") {

        return {
            type: "block",
            blockType: "forever",
            body: [],
            line: lineNumber
        };
    }

    // if.condition
    if (parts[0] === "if") {

        const condition = parts.slice(1).join(".");

        return {
            type: "block",
            blockType: "if",
            condition: condition,
            body: [],
            line: lineNumber
        };
    }

    // while.condition
    if (parts[0] === "while") {

        const condition = parts.slice(1).join(".");

        return {
            type: "block",
            blockType: "while",
            condition: condition,
            body: [],
            line: lineNumber
        };
    }

    // function.name
    if (parts[0] === "function") {

        const funcName = parts[1];

        return {
            type: "block",
            blockType: "function",
            name: funcName,
            body: [],
            line: lineNumber
        };
    }

    // else.command
    if (parts[0] === "else") {

        const command = parts.slice(1).join(".");

        return {
            type: "else",
            command: command,
            line: lineNumber
        };
    }

    // elseif.condition
    if (parts[0] === "elseif") {

        const condition = parts.slice(1).join(".");

        return {
            type: "elseIf",
            condition: condition,
            body: [],
            line: lineNumber
        };
    }

    // ========== OTHER COMMANDS ==========

    // return.value
    if (parts[0] === "return") {

        const value = parts.slice(1).join(".");

        return {
            type: "return",
            value: value,
            line: lineNumber
        };
    }

    // import statement
    if (parts[0] === "import") {

        const name = parts.slice(1).join(".");

        return {
            type: "import",
            name: name,
            line: lineNumber
        };
    }

    // instruccion.priority.command
    if (parts[0] === "instruccion") {

        const priority = Number(parts[1]);
        const command = parts.slice(2).join(".");

        return {
            type: "instruction",
            priority: priority,
            command: command,
            line: lineNumber
        };
    }

    // print.line.delay.("text")
    if (parts[0] === "print" && parts[1] === "line") {

        const delayMatch = line.match(/print\.line\.(\d+(?:\.\d+)?)\.\("([\s\S]*)"\)/);

        if (delayMatch) {

            return {
                type: "printLine",
                delay: delayMatch[1],
                text: delayMatch[2],
                line: lineNumber
            };
        }
    }

    // print("text")
    if (parts[0] === "print") {

        const printMatch = line.match(/print\s*\("([\s\S]*)"\)/);

        if (printMatch) {

            return {
                type: "print",
                text: printMatch[1],
                line: lineNumber
            };
        }
    }

    // draw
    if (parts[0] === "draw") {

        const drawMatch = line.match(/draw\.(.+?)\.(square|triangle|circle)$/);

        if (!drawMatch) {
            return {
                type: "draw",
                data: parts.slice(1),
                line: lineNumber
            };
        }

        return {
            type: "draw",
            data: drawMatch.slice(1),
            line: lineNumber
        };
    }

    // send("message")
    if (parts[0] === "send") {

        const sendMatch = line.match(/send\("([\s\S]*)"\)/);

        if (sendMatch) {

            return {
                type: "send",
                text: sendMatch[1],
                line: lineNumber
            };
        }
    }

    // when.event.command
    if (parts[0] === "when") {

        const event = parts[1];
        const command = parts.slice(2).join(".");

        return {
            type: "when",
            event: event,
            command: command,
            line: lineNumber
        };
    }

    // wait.seconds
    if (parts[0] === "wait") {

        const seconds = parts.slice(1).join(".");

        return {
            type: "wait",
            seconds: seconds,
            line: lineNumber
        };
    }

    // end.wait.seconds
    if (parts[0] === "end" && parts[1] === "wait") {

        const seconds = parts.slice(2).join(".");

        return {
            type: "endWait",
            seconds: seconds,
            line: lineNumber
        };
    }

    // end.repeat.times
    if (parts[0] === "end" && parts[1] === "repeat") {

        const times = parts.slice(2).join(".");

        return {
            type: "endRepeat",
            times: times,
            line: lineNumber
        };
    }

    // use.#destination.#source
    if (parts[0] === "use") {

        const destination = parts[1];
        const source = parts[2];

        return {
            type: "use",
            destination: destination,
            source: source,
            line: lineNumber
        };
    }

    // percentage (value%)
    if (line.endsWith("%")) {

        const value = line.slice(0, -1);

        return {
            type: "percentage",
            value: value,
            line: lineNumber
        };
    }

    // function call: name()
    const callMatch = line.match(/^(\w+)\(\)$/);

    if (callMatch) {

        return {
            type: "call",
            name: callMatch[1],
            line: lineNumber
        };
    }

    // ========== UNKNOWN ==========

    return {
        type: "unknown",
        source: line,
        line: lineNumber
    };
}


// ============================================================
// EJECUTOR
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
            result.type === "return"
        ) {
            return result;
        }

        if (
            result &&
            result.type === "end"
        ) {
            return result;
        }
    }

    return null;
}


// ============================================================
// EJECUTAR NODO
// ============================================================

async function executeNode(node) {

    switch (node.type) {

        // ----------------------------------------------------
        // VARIABLE
        // ----------------------------------------------------

        case "createVariable":

            state.tipos[node.name] =
                node.dataType;

            state.variables[node.name] =
                defaultValue(node.dataType);

            dtechInfo(
                `Variable creada: ${node.name}`
            );

            return null;


        // ----------------------------------------------------
        // OBJETO
        // ----------------------------------------------------

        case "createObject":

            state.variables[node.name] = {
                type: node.shape
            };

            dtechInfo(
                `Objeto ${node.shape} creado: ${node.name}`
            );

            return null;


        // ----------------------------------------------------
        // INPUT
        // ----------------------------------------------------

        case "input":

            await new Promise(resolve => {

                rl.question(
                    "INPUT > ",
                    answer => {

                        state.variables["#input"] =
                            answer;

                        resolve();
                    }
                );

            });

            return null;


        // ----------------------------------------------------
        // MOUSE
        // ----------------------------------------------------

        case "mouseInput":

            dtechWarning(
                "input.mouse requiere un entorno gráfico."
            );

            return null;


        // ----------------------------------------------------
        // AFFILIATE
        // ----------------------------------------------------

        case "affiliate":

            state.afiliaciones[node.symbol] =
                node.variable;

            dtechInfo(
                `${node.symbol} afiliado a ${node.variable}`
            );

            return null;


        // ----------------------------------------------------
        // CONSOLE
        // ----------------------------------------------------

        case "console":

            if (node.mode === "all") {

                state.console.info =
                    node.value;

                state.console.debug =
                    node.value;

                state.console.warning =
                    node.value;

                state.console.error =
                    node.value;

                return null;
            }

            if (node.mode === "log") {

                state.log.enabled =
                    node.value;

                return null;
            }

            state.console[node.mode] =
                node.value;

            return null;


        // ----------------------------------------------------
        // LOG FILE
        // ----------------------------------------------------

        case "logFile":

            state.log.file =
                node.file;

            state.log.enabled = true;

            return null;


        // ----------------------------------------------------
        // LET
        // ----------------------------------------------------

        case "let":

            if (node.source) {

                state.variables[node.destination] =
                    state.variables[node.source];

            }

            return null;


        // --------------------------------------------------------
        // SET
        // --------------------------------------------------------

        case "set": {

            const value =
                evaluate(node.value);

            setVariable(
                node.name,
                value
            );

            dtechDebug(
                `SET ${node.name} = ${value}`
            );

            return null;
        }


        // ----------------------------------------------------
        // ARRAY CREATE
        // ----------------------------------------------------

        case "arrayCreate":

            state.arrays[node.name] = [];

            state.tipos[node.name] =
                node.dataType;

            dtechDebug(
                `Array creado: ${node.name} (${node.dataType})`
            );

            return null;


        // ----------------------------------------------------
        // ARRAY ADD
        // ----------------------------------------------------

        case "arrayAdd":

            if (!state.arrays[node.name]) {
                state.arrays[node.name] = [];
            }

            state.arrays[node.name].push(
                evaluate(node.value)
            );

            return null;


        // ----------------------------------------------------
        // ARRAY REMOVE
        // ----------------------------------------------------

        case "arrayRemove":

            if (
                state.arrays[node.name]
            ) {

                state.arrays[node.name].pop();
            }

            return null;


        // ----------------------------------------------------
        // ARRAY PRINT
        // ----------------------------------------------------

        case "arrayPrint":

            console.log(
                state.arrays[node.name] || []
            );

            return null;


        // ----------------------------------------------------
        // ARRAY RENAME
        // ----------------------------------------------------

        case "arrayRename":

            if (
                state.arrays[node.oldName]
            ) {

                state.arrays[node.newName] =
                    state.arrays[node.oldName];

                delete state.arrays[node.oldName];
            }

            return null;


        // ----------------------------------------------------
        // FILE READ
        // ----------------------------------------------------

        case "fileRead": {

            const target =
                cleanPath(node.file);

            if (!fs.existsSync(target)) {

                dtechError(
                    `Archivo no encontrado: ${target}`
                );

                return null;
            }

            const content =
                fs.readFileSync(
                    target,
                    "utf8"
                );

            state.variables["#file"] =
                content;

            return null;
        }


        // ----------------------------------------------------
        // FILE WRITE
        // ----------------------------------------------------

        case "fileWrite": {

            const target =
                cleanPath(node.file);

            const content =
                evaluate(node.value);

            fs.writeFileSync(
                target,
                String(content)
            );

            return null;
        }


        // ----------------------------------------------------
        // FOR
        // ----------------------------------------------------

        case "block":

            if (node.blockType === "for") {

                const times =
                    Number(
                        evaluate(node.value)
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


            // FOREVER

            if (
                node.blockType === "forever"
            ) {

                while (state.running) {

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


            // IF

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


            // WHILE

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

                    if (safety > 100000) {

                        dtechError(
                            "While detenido por seguridad."
                        );

                        break;
                    }
                }

                return null;
            }


            // FUNCTION

            if (
                node.blockType === "function"
            ) {

                state.funciones[node.name] =
                    node.body;

                dtechDebug(
                    `Función registrada: ${node.name}`
                );

                return null;
            }

            return null;


        // ----------------------------------------------------
        // ELSE
        // ----------------------------------------------------

        case "else":

            return await executeCommandString(
                node.command
            );


        // ----------------------------------------------------
        // ELSEIF
        // ----------------------------------------------------

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


        // ----------------------------------------------------
        // RETURN
        // ----------------------------------------------------

        case "return":

            state.returnValue =
                evaluate(node.value);

            return {
                type: "return",
                value: state.returnValue
            };


        // ----------------------------------------------------
        // IMPORT
        // ----------------------------------------------------

        case "import":

            state.imports.push(
                node.name
            );

            dtechInfo(
                `Import registrado: ${node.name}`
            );

            return null;


        // ----------------------------------------------------
        // INSTRUCCION
        // ----------------------------------------------------

        case "instruction":

            dtechDebug(
                `Instrucción prioridad ${node.priority}: ${node.command}`
            );

            return await executeCommandString(
                node.command
            );


        // ----------------------------------------------------
        // PRINT.LINE
        // ----------------------------------------------------

        case "printLine": {

            const delay =
                Number(
                    evaluate(node.delay)
                );

            const text =
                replaceVariables(node.text);

            for (const char of text) {

                process.stdout.write(char);

                await sleep(
                    Math.max(
                        0,
                        delay * 1000
                    )
                );
            }

            process.stdout.write("\n");

            return null;
        }


        // ----------------------------------------------------
        // PRINT
        // ----------------------------------------------------

        case "print":

            runtimeLog(
                replaceVariables(
                    node.text
                )
            );

            return null;


        // ----------------------------------------------------
        // DRAW
        // ----------------------------------------------------

        case "draw":

            executeDraw(node.data);

            return null;


        // ----------------------------------------------------
        // SEND
        // ----------------------------------------------------

        case "send":

            runtimeLog(
                `[SEND] ${replaceVariables(node.text)}`
            );

            return null;


        // ----------------------------------------------------
        // WHEN
        // ----------------------------------------------------

        case "when":

            if (!state.eventos[node.event]) {
                state.eventos[node.event] = [];
            }

            state.eventos[node.event].push(
                node.command
            );

            return null;


        // ----------------------------------------------------
        // WAIT
        // ----------------------------------------------------

        case "wait":

            await sleep(
                Number(
                    evaluate(node.seconds)
                ) * 1000
            );

            return null;


        // ----------------------------------------------------
        // END WAIT
        // ----------------------------------------------------

        case "endWait":

            await sleep(
                Number(
                    evaluate(node.seconds)
                ) * 1000
            );

            state.running = false;

            return {
                type: "end"
            };


        // ----------------------------------------------------
        // END REPEAT
        // ----------------------------------------------------

        case "endRepeat": {

            const times =
                Number(
                    evaluate(node.times)
                );

            for (
                let i = 0;
                i < times;
                i++
            ) {
                // Este comando es manejado
                // como marcador de repetición.
            }

            return null;
        }


        // ----------------------------------------------------
        // END
        // ----------------------------------------------------

        case "end":

            state.running = false;

            return {
                type: "end"
            };


        // ----------------------------------------------------
        // CALL
        // ----------------------------------------------------

        case "call":

            if (
                !state.funciones[node.name]
            ) {

                dtechError(
                    `La función ${node.name} no existe.`
                );

                return null;
            }

            return await executeNodes(
                state.funciones[node.name]
            );


        // ----------------------------------------------------
        // USE
        // ----------------------------------------------------

        case "use":

            state.variables[node.destination] =
                state.variables[node.source];

            return null;


        // ----------------------------------------------------
        // PORCENTAJE
        // ----------------------------------------------------

        case "percentage":

            console.log(
                `${replaceVariables(node.value)}%`
            );

            return null;


        // ----------------------------------------------------
        // UNKNOWN
        // ----------------------------------------------------

        case "unknown":

            dtechError(
                `Comando D-TECH desconocido: ${node.source}`,
                node.line
            );

            return null;


        default:

            dtechError(
                `Nodo desconocido: ${node.type}`
            );

            return null;
    }
}


// ============================================================
// CONDICIONES
// ============================================================

function evaluateCondition(condition) {

    condition =
        condition.trim();


    // formato:
    //
    // #life.using.#health
    //
    // o:
    //
    // #life == #health

    if (
        condition.includes(".using.")
    ) {

        const parts =
            condition.split(".using.");

        const left =
            evaluate(parts[0]);

        const right =
            evaluate(parts[1]);

        return left === right;
    }


    return Boolean(
        evaluateExpression(condition)
    );
}


// ============================================================
// EJECUTAR COMANDO INDIVIDUAL
// ============================================================

async function executeCommandString(command) {

    const node =
        transformLine(
            command,
            0
        );

    return await executeNode(node);
}


// ============================================================
// DRAW
// ============================================================

function executeDraw(data) {

    if (!data || data.length < 2) {
        dtechError("DRAW inválido.");
        return;
    }

    let radio;
    let figura;

    if (
        ["square", "triangle", "circle"]
            .includes(data[0])
    ) {

        figura = data[0];
        radio = data[1];

    } else {

        radio = data[0];
        figura = data[1];
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
                `Figura desconocida: ${figura}`
            );
    }
}


// ============================================================
// DEFAULT VALUE
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
        filePath
            .replace(/^["']|["']$/g, "");

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
            setTimeout(resolve, ms)
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


        // ----------------------------------------------------
        // LEER
        // ----------------------------------------------------

        const source =
            fs.readFileSync(
                file,
                "utf8"
            ).replace(/^\uFEFF/, "");


        // ----------------------------------------------------
        // TRANSFORMAR
        // ----------------------------------------------------

        const program =
            parseSource(source);


        dtechInfo(
            `Archivo: ${path.basename(file)}`
        );

        dtechInfo(
            `Tipo: ${program.header}`
        );

        dtechInfo(
            `Transformación completada.`
        );


        // ----------------------------------------------------
        // EJECUTAR
        // ----------------------------------------------------

        await executeNodes(
            program.body
        );


        // ----------------------------------------------------
        // FINAL
        // ----------------------------------------------------

        console.log("");
        console.log(
            "===== D-TECH FINALIZADO ====="
        );


        dtechDebug(
            `Variables: ${JSON.stringify(
                state.variables,
                null,
                2
            )}`
        );


    }
    catch (error) {

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

        process.exitCode = 1;

    }
    finally {

        rl.close();

        globalThis.__DTECH_RUNNING__ =
            false;
    }
}


// ============================================================
// START
// ============================================================

run();
