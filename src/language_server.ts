import * as vscode from "vscode";
import * as lsc from "vscode-languageclient/node";
import { Python, PythonEnvironment } from "./python";
import * as semver from "semver";
import { getGenericLogger, getLanguageServerLogger } from "./logging";
import { randomInt } from "node:crypto";

export const LANGUAGE_SERVER_NAME = "Gerber Language Server";

export function isVirtualWorkspace(): boolean {
    const isVirtual =
        vscode.workspace.workspaceFolders &&
        vscode.workspace.workspaceFolders.every((f) => f.uri.scheme !== "file");
    return !!isVirtual;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export enum RestartResult {
    success,
    failed,
    aborted,
    silentAborted,
    abortedNoPyGerber,
    abortedNoLanguageServer,
    abortedNoPythonEnvironment,
}

export class LanguageServerClient {
    private client: lsc.LanguageClient | undefined;
    private env: PythonEnvironment | undefined;
    private lock: number = 0;
    private disposables: vscode.Disposable[] = [];

    constructor(private pythonManager: Python) {}

    async refresh(): Promise<RestartResult> {
        getGenericLogger().traceInfo(`LanguageServerClient.refresh`);

        const activeEnvironment = await this.pythonManager.getActiveEnvironment();
        if (activeEnvironment === undefined) {
            return RestartResult.abortedNoPythonEnvironment;
        }
        return this.restart(activeEnvironment);
    }

    async restart(env: PythonEnvironment): Promise<RestartResult> {
        if (this.lock !== 0) {
            return RestartResult.aborted;
        }
        const magicValue = Date.now();
        this.lock = magicValue;
        wait(randomInt(100, 1000));
        // If our value is visible we likely acquired the lock.
        if (this.lock !== magicValue) {
            return RestartResult.aborted;
        }

        let result: RestartResult;

        try {
            result = await this._restart(env);
        } finally {
            this.lock = 0;
        }
        return result;
    }

    async _restart(env: PythonEnvironment): Promise<RestartResult> {
        this.env = env;

        if (this.disposables.length > 0) {
            this.disposables.forEach((d) => d.dispose());
            this.disposables = [];
        }
        if (this.client?.state !== lsc.State.Stopped) {
            await this.client?.stop();
        }

        if (env.getPyGerber() === undefined) {
            return RestartResult.abortedNoPyGerber;
        }
        if ((await env.hasLanguageServer()) === false) {
            return RestartResult.abortedNoLanguageServer;
        }

        const languageServerArgs = semver.gt(
            this.env.version,
            new semver.SemVer("3.0.0-alpha0")
        )
            ? ["-m", "pygerber.gerber.language_server"]
            : ["-m", "pygerber.gerberx3.language_server"];

        this.client = new lsc.LanguageClient(
            LANGUAGE_SERVER_NAME,
            {
                command: this.env.executableUri.fsPath,
                args: languageServerArgs,
                options: {
                    cwd: vscode.workspace.workspaceFolders?.[0].uri.fsPath,
                },
                transport: lsc.TransportKind.stdio,
            },
            {
                // Register the server for python documents
                documentSelector: isVirtualWorkspace()
                    ? [{ language: "gerber" }]
                    : [
                          { scheme: "file", language: "gerber" },
                          { scheme: "untitled", language: "gerber" },
                      ],
                outputChannel: getLanguageServerLogger().getChannel(),
                traceOutputChannel: getLanguageServerLogger().getChannel(),
                revealOutputChannelOn: lsc.RevealOutputChannelOn.Never,
                markdown: {
                    isTrusted: true,
                    supportHtml: true,
                },
                connectionOptions: {
                    maxRestartCount: 0,
                },
            }
        );
        this.disposables.push(
            this.client.onDidChangeState((event) => {
                switch (event.newState) {
                    case lsc.State.Stopped:
                        getLanguageServerLogger().traceVerbose(
                            `Language Server State: Stopped`
                        );
                        break;
                    case lsc.State.Starting:
                        getLanguageServerLogger().traceVerbose(
                            `Language Server State: Starting`
                        );
                        break;
                    case lsc.State.Running:
                        getLanguageServerLogger().traceVerbose(
                            `Language Server State: Running`
                        );
                        break;
                }
            })
        );
        try {
            await this.client.start();
            let totalWait = 0;

            while (this.client.state === lsc.State.Starting && totalWait < 10000) {
                totalWait += 100;
                await wait(100);
            }

            if (this.client.state === lsc.State.Stopped || totalWait >= 10000) {
                if (this.client?.state !== lsc.State.Stopped) {
                    this.client?.stop();
                }
                this.disposables.forEach((d) => d.dispose());
                this.disposables = [];
                this.client = undefined;
                return RestartResult.failed;
            }
            return RestartResult.success;
        } catch (e) {
            getLanguageServerLogger().traceError(e);
            return RestartResult.failed;
        }
    }

    dispose() {
        if (this.client?.state !== lsc.State.Stopped) {
            this.client?.stop();
        }
        this.disposables.forEach((d) => d.dispose());
    }
}
