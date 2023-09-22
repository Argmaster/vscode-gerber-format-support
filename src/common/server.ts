import * as vscode from "vscode";
import { State } from "vscode-languageclient";
import {
    LanguageClient,
    LanguageClientOptions,
    RevealOutputChannelOn,
    ServerOptions,
    TransportKind,
} from "vscode-languageclient/node";
import { traceError, traceInfo, traceVerbose } from "./log/logging";
import { ExtensionUserSettings } from "./settings";
import {
    executeCommand,
    getLSClientTraceLevel,
    installPyGerberAutomatically,
} from "./utilities";
import * as vscodeapi from "./vscodeapi";
import { ExtensionStaticSettings } from "./setup";
import { INSTALLATION_GUIDE_URL } from "./constants";

export type LanguageServerOptions = {
    interpreter: string;
    cwd: string;
    staticSettings: ExtensionStaticSettings;
    userSettings: ExtensionUserSettings;
    outputChannel: vscode.LogOutputChannel;
};

async function createServer(options: LanguageServerOptions): Promise<LanguageClient> {
    const command = options.interpreter;
    const cwd = options.cwd;
    const newEnv = { ...process.env };

    const args = [
        "-m",
        "pygerber.gerberx3.language_server",
        ...options.userSettings.args,
    ];
    traceInfo(`Server run command: ${[command, ...args].join(" ")}`);

    const serverOptions: ServerOptions = {
        command,
        args,
        options: { cwd, env: newEnv },
        transport: TransportKind.stdio,
    };

    // Options to control the language client
    const clientOptions: LanguageClientOptions = {
        // Register the server for python documents
        documentSelector: vscodeapi.isVirtualWorkspace()
            ? [{ language: "gerber" }]
            : [
                  { scheme: "file", language: "gerber" },
                  { scheme: "untitled", language: "gerber" },
              ],
        outputChannel: options.outputChannel,
        traceOutputChannel: options.outputChannel,
        revealOutputChannelOn: RevealOutputChannelOn.Never,
        markdown: {
            isTrusted: true,
            supportHtml: true,
        },
    };

    return new LanguageClient(
        options.staticSettings.settingsNamespace,
        options.staticSettings.languageServerName,
        serverOptions,
        clientOptions
    );
}

let _disposables: vscode.Disposable[] = [];

export async function restartServer(
    options: LanguageServerOptions,
    lsClient?: LanguageClient
): Promise<LanguageClient | undefined> {
    if (lsClient) {
        traceInfo(`Server: Stop requested`);
        await lsClient.stop();
        _disposables.forEach((d) => d.dispose());
        _disposables = [];
    }

    const newLSClient = await createServer(options);
    traceInfo(`Server: Start requested.`);

    _disposables.push(
        newLSClient.onDidChangeState((e) => {
            switch (e.newState) {
                case State.Stopped:
                    traceVerbose(`Server State: Stopped`);
                    break;
                case State.Starting:
                    traceVerbose(`Server State: Starting`);
                    break;
                case State.Running:
                    traceVerbose(`Server State: Running`);
                    break;
            }
        })
    );

    try {
        await newLSClient.start();
    } catch (ex) {
        traceError(`Server: Start failed: ${ex}`);
        return undefined;
    }

    const level = getLSClientTraceLevel(
        options.outputChannel.logLevel,
        vscode.env.logLevel
    );
    await newLSClient.setTrace(level);
    return newLSClient;
}

export async function isPyGerberLanguageServerAvailable(
    options: LanguageServerOptions
): Promise<boolean> {
    const cmd = [
        options.interpreter,
        "-m",
        "pygerber",
        "is-language-server-available",
    ].join(" ");

    const { code, stdout, stderr } = await executeCommand(cmd);

    if (code === 127) {
        vscode.window
            .showErrorMessage(
                "Python interpreter not found. Select valid Python interpreter.",
                "Select Interpreter",
                "Open installation guide",
                "Ignore"
            )
            .then((result) => {
                switch (result) {
                    case "Select Interpreter":
                        vscode.commands.executeCommand("python.setInterpreter");
                        break;

                    case "Open installation guide":
                        vscodeapi.openUrlInWebBrowser(INSTALLATION_GUIDE_URL);
                        break;

                    default:
                        break;
                }
            });
    } else {
        const fullOutput = `${stdout} ${stderr}`;

        if (fullOutput.includes("Language server is available.")) {
            return true;
        } else if (fullOutput.includes("Language server is not available.")) {
            vscode.window
                .showErrorMessage(
                    "PyGerber Language Server extension is not installed.",
                    "Open installation guide",
                    "Install automatically",
                    "Ignore"
                )
                .then((result) => {
                    switch (result) {
                        case "Open installation guide":
                            vscodeapi.openUrlInWebBrowser(INSTALLATION_GUIDE_URL);
                            break;

                        case "Install automatically":
                            installPyGerberAutomatically(options);
                            break;

                        default:
                            break;
                    }
                });
        } else if (fullOutput.includes("No module named pygerber")) {
            vscode.window
                .showErrorMessage(
                    "PyGerber library is not available.",
                    "Open installation guide",
                    "Install automatically",
                    "Ignore"
                )
                .then((result) => {
                    switch (result) {
                        case "Open installation guide":
                            vscodeapi.openUrlInWebBrowser(INSTALLATION_GUIDE_URL);
                            break;

                        case "Install automatically":
                            installPyGerberAutomatically(options);
                            break;

                        default:
                            break;
                    }
                });
        } else {
            vscode.window.showErrorMessage("Unexpected error!");
        }
    }

    return false;
}
