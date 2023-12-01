import * as vscode from "vscode";
import { State } from "vscode-languageclient";
import {
    LanguageClient,
    LanguageClientOptions,
    RevealOutputChannelOn,
    ServerOptions,
    TransportKind,
} from "vscode-languageclient/node";
import { traceError, traceInfo, traceLog, traceVerbose } from "./log/logging";
import { ExtensionUserSettings } from "./settings";
import { executeCommand, getLSClientTraceLevel } from "./utilities";
import * as vscodeapi from "./vscodeapi";
import { ExtensionStaticSettings } from "./settings";
import { INSTALLATION_GUIDE_URL } from "./constants";

export type LanguageServerOptions = {
    interpreter: string;
    cwd: string;
    staticSettings: ExtensionStaticSettings;
    userSettings: ExtensionUserSettings;
    outputChannel: vscode.LogOutputChannel;
    extensionDirectory: string;
};

async function createServerProcess(
    options: LanguageServerOptions
): Promise<LanguageClient> {
    const venvPythonPath = await getVirtualEnvPythonPathValue(
        options.extensionDirectory,
        options.interpreter
    );

    const command = options.interpreter;
    const cwd = options.cwd;

    const newEnv = {
        ...process.env,
        PYTHONPATH: venvPythonPath, // eslint-disable-line @typescript-eslint/naming-convention
    };

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
        connectionOptions: {
            maxRestartCount: 0,
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
    if (lsClient && lsClient.state !== State.Stopped) {
        traceInfo(`Gerber Language Server: Stop requested`);
        await lsClient.stop();
        _disposables.forEach((d) => d.dispose());
        _disposables = [];
    }

    const newLSClient = await createServerProcess(options);
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

        const level = getLSClientTraceLevel(
            options.outputChannel.logLevel,
            vscode.env.logLevel
        );
        await newLSClient.setTrace(level);

        return newLSClient;
    } catch (ex) {
        traceError(`Server: Start failed: ${ex}`);
        return undefined;
    }
}

export enum PyGerberLanguageServerStatus {
    interpreterNotFound,
    languageServerNotFound,
    pyGerberNotInstalled,
    good,
    unexpectedError,
}

export async function isPyGerberLanguageServerAvailable(
    options: LanguageServerOptions
): Promise<PyGerberLanguageServerStatus> {
    try {
        return await _isPyGerberLanguageServerAvailable(options);
    } catch (Error) {
        return PyGerberLanguageServerStatus.interpreterNotFound;
    }
}

async function _isPyGerberLanguageServerAvailable(
    options: LanguageServerOptions
): Promise<PyGerberLanguageServerStatus> {
    const cmd = ["-m", "pygerber", "is-language-server-available"].join(" ");

    const { code, stdout, stderr } = await executePythonCommand(
        options.interpreter,
        cmd,
        options.extensionDirectory
    );

    if (code === 127) {
        return PyGerberLanguageServerStatus.interpreterNotFound;
    } else {
        const fullOutput = `${stdout} ${stderr}`;

        if (fullOutput.includes("Language server is available.")) {
            traceInfo("PyGerber language server found.");
            return PyGerberLanguageServerStatus.good;
        } else if (fullOutput.includes("Language server is not available.")) {
            traceInfo("PyGerber language server not installed.");
            return PyGerberLanguageServerStatus.languageServerNotFound;
        } else if (fullOutput.includes("No module named pygerber")) {
            traceInfo("PyGerber not installed.");
            return PyGerberLanguageServerStatus.pyGerberNotInstalled;
        } else {
            traceInfo("Unexpected error, see full stdout/stderr above.");
            return PyGerberLanguageServerStatus.unexpectedError;
        }
    }
}

export async function executePythonCommand(
    interpreter: string,
    cmd: string,
    extensionDirectory: string
) {
    const venvPythonPath = await getVirtualEnvPythonPathValue(
        extensionDirectory,
        interpreter
    );
    return await executeCommand([interpreter, cmd].join(" "), {
        env: {
            PYTHONPATH: venvPythonPath, // eslint-disable-line @typescript-eslint/naming-convention
        },
    });
}

class Version {
    private major: number;
    private minor: number;
    private patch: number;

    constructor(major: number, minor: number, patch: number) {
        this.major = major;
        this.minor = minor;
        this.patch = patch;
    }
    public static fromString(versionString: string): Version {
        const regex = /^(\d+)\.(\d+)\.(\d+)$/;
        const match = versionString.match(regex);

        if (!match) {
            throw new Error("Invalid version string");
        }

        const [, major, minor, patch] = match.map(Number);
        return new Version(major, minor, patch);
    }
    public toString(sep: string = "."): string {
        return `${this.major}${sep}${this.minor}${sep}${this.patch}`;
    }
}

export async function checkPythonInterpreterVersion(
    interpreter: String
): Promise<Version> {
    const cmd = [interpreter, "--version"].join(" ");
    const { code, stdout, stderr } = await executeCommand(cmd, {});

    if (code === 127) {
        throw Error("Interpreter not found.");
    }

    const regex = /Python (\d+\.\d+\.\d+)/;
    let match = stdout.match(regex);

    if (!match) {
        throw new Error("Invalid version string");
    }
    return Version.fromString(match[1]);
}

export async function getVirtualEnvPythonPathValue(
    extensionDirectory: String,
    interpreter: String
): Promise<string> {
    let venvVersionSuffix = await getVirtualEnvSuffix(interpreter);
    let venvPythonPath = `${extensionDirectory}/.pygerber-${venvVersionSuffix}`;
    traceLog(`Virtual environment path: ${venvPythonPath}`);
    return venvPythonPath;
}

export async function getVirtualEnvSuffix(interpreter: String): Promise<String> {
    return (await checkPythonInterpreterVersion(interpreter)).toString("-");
}

export async function handleNegativePyGerberLanguageServerStatus(
    status: PyGerberLanguageServerStatus,
    options: LanguageServerOptions
): Promise<Boolean> {
    switch (status) {
        case PyGerberLanguageServerStatus.interpreterNotFound: {
            await vscode.window
                .showErrorMessage(
                    "Python interpreter not found. Select valid Python interpreter.",
                    "Select Interpreter",
                    "Open installation guide",
                    "Ignore"
                )
                .then(async (result) => {
                    switch (result) {
                        case "Select Interpreter":
                            await vscode.commands.executeCommand(
                                "python.setInterpreter"
                            );
                            traceLog("Selected new interpreter with Python extension.");
                            break;

                        case "Open installation guide":
                            vscodeapi.openUrlInWebBrowser(INSTALLATION_GUIDE_URL);
                            traceLog("Opened installation guide in browser window.");
                            break;

                        default:
                            break;
                    }
                });
            traceLog(
                "Finished responding to PyGerberLanguageServerStatus.interpreterNotFound."
            );
            break;
        }

        case PyGerberLanguageServerStatus.languageServerNotFound: {
            await vscode.window
                .showErrorMessage(
                    "PyGerber Language Server extension is not installed.",
                    "Open installation guide",
                    "Install automatically",
                    "Ignore"
                )
                .then(async (result) => {
                    switch (result) {
                        case "Open installation guide":
                            vscodeapi.openUrlInWebBrowser(INSTALLATION_GUIDE_URL);
                            traceLog("Opened installation guide in browser window.");
                            break;

                        case "Install automatically":
                            await installPyGerberAutomatically(options);
                            break;

                        default:
                            break;
                    }
                });
            traceLog(
                "Finished responding to PyGerberLanguageServerStatus.languageServerNotFound."
            );
            break;
        }

        case PyGerberLanguageServerStatus.pyGerberNotInstalled: {
            return await vscode.window
                .showErrorMessage(
                    "PyGerber library is not available.",
                    "Open installation guide",
                    "Install automatically",
                    "Ignore"
                )
                .then(async (result) => {
                    switch (result) {
                        case "Open installation guide":
                            vscodeapi.openUrlInWebBrowser(INSTALLATION_GUIDE_URL);
                            break;

                        case "Install automatically":
                            await installPyGerberAutomatically(options);
                            return true;

                        default:
                            break;
                    }
                    return false;
                });
        }

        case PyGerberLanguageServerStatus.unexpectedError: {
            vscode.window.showErrorMessage("Unexpected error!");
        }

        default:
            break;
    }
    return false;
}

async function installPyGerberAutomatically(options: LanguageServerOptions) {
    await vscode.window.withProgress(
        {
            title: "Installing PyGerber with Language Server.",
            location: vscode.ProgressLocation.Notification,
        },

        async () => {
            const venvPythonPath: string = await getVirtualEnvPythonPathValue(
                options.extensionDirectory,
                options.interpreter
            );
            const cmd = [
                options.interpreter,
                "-m",
                "pip",
                "install",
                "'pygerber[language-server]>=2.1.0'",
                "--no-cache",
                "--upgrade",
                "-t",
                venvPythonPath,
            ].join(" ");

            const { code, stdout, stderr } = await executeCommand(cmd, {
                timeout: 5 * 60 * 1000 /* Max 5 minutes then fail. */,
            });

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
    traceLog("Installed PyGerber automatically.");
}
