import * as fs from "fs-extra";
import * as path from "path";
import { LogLevel, Uri, WorkspaceFolder } from "vscode";
import { Trace } from "vscode-jsonrpc/node";
import * as vscodeapi from "./vscodeapi";
import { ExecOptions, exec } from "child_process";
import { integer } from "vscode-languageclient";
import { traceVerbose } from "./log/logging";

function logLevelToTrace(logLevel: LogLevel): Trace {
    switch (logLevel) {
        case LogLevel.Error:
        case LogLevel.Warning:
        case LogLevel.Info:
            return Trace.Messages;

        case LogLevel.Debug:
        case LogLevel.Trace:
            return Trace.Verbose;

        case LogLevel.Off:
        default:
            return Trace.Off;
    }
}

export function getLSClientTraceLevel(
    channelLogLevel: LogLevel,
    globalLogLevel: LogLevel
): Trace {
    if (channelLogLevel === LogLevel.Off) {
        return logLevelToTrace(globalLogLevel);
    }
    if (globalLogLevel === LogLevel.Off) {
        return logLevelToTrace(channelLogLevel);
    }
    const level = logLevelToTrace(
        channelLogLevel <= globalLogLevel ? channelLogLevel : globalLogLevel
    );
    return level;
}

export async function getWorkspaceFolder(): Promise<WorkspaceFolder> {
    const workspaces: readonly WorkspaceFolder[] = vscodeapi.getWorkspaceFolders();
    if (workspaces.length === 0) {
        return {
            uri: Uri.file(process.cwd()),
            name: path.basename(process.cwd()),
            index: 0,
        };
    } else if (workspaces.length === 1) {
        return workspaces[0];
    } else {
        let rootWorkspace = workspaces[0];
        let root = undefined;
        for (const w of workspaces) {
            if (await fs.pathExists(w.uri.fsPath)) {
                root = w.uri.fsPath;
                rootWorkspace = w;
                break;
            }
        }

        for (const w of workspaces) {
            if (
                root &&
                root.length > w.uri.fsPath.length &&
                (await fs.pathExists(w.uri.fsPath))
            ) {
                root = w.uri.fsPath;
                rootWorkspace = w;
            }
        }
        return rootWorkspace;
    }
}

export type CommandResult = {
    code: integer;
    stdout: string;
    stderr: string;
};

export async function executeCommand(
    command: string,
    options: ExecOptions = {}
): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
        exec(command, options, (error, stdout, stderr) => {
            const code = error?.code ?? 0;

            traceVerbose(
                "---------------------------------------------------------------"
            );
            traceVerbose(`   cmd:   ${command}`);
            traceVerbose(`  code:   ${code}`);
            traceVerbose(`stdout:   \n${stdout}`);
            traceVerbose(`stderr:   \n${stderr}`);
            traceVerbose(
                "---------------------------------------------------------------"
            );

            resolve({ code, stdout, stderr });
        });
    });
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
