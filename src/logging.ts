import * as vscode from "vscode";
import * as util from "util";

let generic: Logger | undefined;
let languageServer: Logger | undefined;

export const GENERIC_LOGGER_NAME = "Gerber X3/X2 Format: Generic Log ";
export const LANGUAGE_SERVER_LOGGER_NAME = "Gerber X3/X2 Format: Language Server ";

type Arguments = unknown[];

export function initLoggers() {
    generic = new Logger(
        vscode.window.createOutputChannel(GENERIC_LOGGER_NAME, { log: true })
    );
    languageServer = new Logger(
        vscode.window.createOutputChannel(LANGUAGE_SERVER_LOGGER_NAME, {
            log: true,
        })
    );
}

export function getGenericLogger() {
    if (!generic) {
        initLoggers();
    }
    return generic;
}

export function getLanguageServerLogger() {
    if (!languageServer) {
        initLoggers();
    }
    return languageServer;
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
}
