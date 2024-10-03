import * as vscode from "vscode";
import * as util from "util";

let generic: Logger | undefined;
let commandLogger: Logger | undefined;
let languageServer: Logger | undefined;

export const GENERIC_LOGGER_NAME = "Gerber X3/X2 Format: Generic Log ";
export const COMMAND_LOGGER_NAME = "Gerber X3/X2 Format: Command Log ";
export const LANGUAGE_SERVER_LOGGER_NAME = "Gerber X3/X2 Format: Language Server ";

type Arguments = unknown[];

export function initLoggers() {
    if (generic === undefined) {
        generic = new Logger(
            vscode.window.createOutputChannel(GENERIC_LOGGER_NAME, { log: true })
        );
    }
    if (commandLogger === undefined) {
        commandLogger = new Logger(
            vscode.window.createOutputChannel(COMMAND_LOGGER_NAME, {
                log: true,
            })
        );
    }
    if (languageServer === undefined) {
        languageServer = new Logger(
            vscode.window.createOutputChannel(LANGUAGE_SERVER_LOGGER_NAME, {
                log: true,
            })
        );
    }
}

export function cleanUpLoggers() {
    if (generic !== undefined) {
        generic.getChannel().dispose();
        generic = undefined;
    }
    if (commandLogger !== undefined) {
        commandLogger.getChannel().dispose();
        commandLogger = undefined;
    }
    if (languageServer !== undefined) {
        languageServer.getChannel().dispose();
        languageServer = undefined;
    }
}

export function getGenericLogger(): Logger {
    if (generic === undefined) {
        initLoggers();
        if (generic === undefined) {
            throw new Error("Failed to initialize generic logger.");
        }
        return generic;
    }
    return generic;
}

export function getLanguageServerLogger(): Logger {
    if (languageServer === undefined) {
        initLoggers();
        if (languageServer === undefined) {
            throw new Error("Failed to initialize language server logger.");
        }
        return languageServer;
    }
    return languageServer;
}

export function getCommandLogger(): Logger {
    if (commandLogger === undefined) {
        initLoggers();
        if (commandLogger === undefined) {
            throw new Error("Failed to initialize command logger.");
        }
        return commandLogger;
    }
    return commandLogger;
}

export class Logger {
    constructor(private channel: vscode.LogOutputChannel) {}

    public traceLog(...data: Arguments): void {
        this.channel.appendLine(util.format(...data));
    }

    public traceError(...data: Arguments): void {
        this.channel.error(util.format(...data));
    }

    public traceWarn(...data: Arguments): void {
        this.channel.warn(util.format(...data));
    }

    public traceInfo(...data: Arguments): void {
        this.channel.info(util.format(...data));
    }

    public traceVerbose(...data: Arguments): void {
        this.channel.debug(util.format(...data));
    }

    public getChannel(): vscode.LogOutputChannel {
        return this.channel;
    }
}
