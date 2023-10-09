import * as fs from "fs-extra";
import * as path from "path";
import { LogLevel, Uri, WorkspaceFolder } from "vscode";
import { Trace } from "vscode-jsonrpc/node";
import * as vscodeapi from "./vscodeapi";
import { ExecOptions, exec } from "child_process";
import { integer } from "vscode-languageclient";
import { traceLog, traceVerbose } from "./log/logging";
import * as vscode from "vscode";
import { LanguageServerOptions } from "./server";
import { ExtensionUserSettings, getExtensionUserSettings } from "./settings";
import { isInterpreterGood, getInterpreterDetails } from "./python";
import { ExtensionStaticSettings, loadExtensionStaticSettings } from "./setup";

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

            traceLog(`   cmd:   ${command}`);
            traceLog(`  code:   ${code}`);
            traceLog(`stdout:   ${stdout}`);
            traceLog(`stderr:   ${stderr}`);

            resolve({ code, stdout, stderr });
        });
    });
}

export async function installPyGerberAutomatically(options: LanguageServerOptions) {
    vscode.window.withProgress(
        {
            title: "Installing PyGerber with Language Server.",
            location: vscode.ProgressLocation.Notification,
        },
        async () => {
            const cmd = [
                options.interpreter,
                "-m",
                "pip",
                "install",
                "'pygerber[language_server]==2.1.0'",
                "--no-cache",
                "--upgrade",
                "-t",
                `${options.extensionDirectory}/.pygerber`,
            ].join(" ");

            const { code, stdout, stderr } = await executeCommand(cmd);

            if (code === 0) {
                vscode.window.showInformationMessage(`Successfully installed PyGerber`);
            } else {
                vscode.window.showErrorMessage(
                    `PyGerber installation failed. (${code})`
                );
            }
            return { message: "", increment: 100 };
        }
    );
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function renderGerberFile(extensionDirectory: string) {
    const extensionStaticSettings = loadExtensionStaticSettings();
    const workspace = await getWorkspaceFolder();
    const userSettings = await getExtensionUserSettings(
        extensionStaticSettings.settingsNamespace,
        workspace
    );
    let interpreterPath = await getInterpreterPath(
        userSettings,
        extensionStaticSettings
    );
    const editor = vscode.window.activeTextEditor;
    const filePath = editor?.document.uri.fsPath;

    if (filePath === undefined) {
        vscode.window.showErrorMessage("No file selected.");
        return;
    }

    let outputFilePath =
        filePath.split(".").slice(0, -1).join(".") + userSettings.imageFormat;

    vscode.window.withProgress(
        {
            title: `Rendering Gerber file "${filePath}".`,
            location: vscode.ProgressLocation.Notification,
        },
        async () => {
            const cmd = [
                interpreterPath,
                "-m",
                "pygerber",
                "raster-2d",
                filePath,
                "--style",
                userSettings.layerStyle,
                "--output",
                outputFilePath,
                "--dpi",
                userSettings.renderDpi,
            ].join(" ");

            const { code, stdout, stderr } = await executeCommand(cmd, {
                env: {
                    PYTHONPATH: `${extensionDirectory}/.pygerber`, // eslint-disable-line @typescript-eslint/naming-convention
                },
            });

            if (code === 0) {
                vscode.window.showInformationMessage(
                    `Successfully rendered file "${filePath}", see result in "${outputFilePath}".`
                );
            } else {
                vscode.window.showErrorMessage(`Failed to render file "${filePath}".`);
            }
            return { message: "", increment: 100 };
        }
    );
}

export async function getInterpreterPath(
    userSettings: ExtensionUserSettings,
    extensionStaticSettings: ExtensionStaticSettings
) {
    let interpreterPath: string = "";

    const interpreterStats = await isInterpreterGood(userSettings.interpreter);
    if (interpreterStats.isGood) {
        traceVerbose(
            `Using interpreter from ${
                extensionStaticSettings.settingsNamespace
            }.interpreter: ${(await interpreterStats).path}`
        );
        interpreterPath = interpreterStats.path;
    }

    const interpreterDetails = await getInterpreterDetails();
    if (interpreterDetails.path) {
        traceVerbose(
            `Using interpreter from Python extension: ${interpreterDetails.path.join(
                " "
            )}`
        );
        interpreterPath = interpreterDetails.path[0];
    }
    return interpreterPath;
}
