import * as vscode from "vscode";
import { LanguageClient, State } from "vscode-languageclient/node";
import { registerLogger, traceError, traceLog } from "./common/log/logging";
import {
    PythonEnvironment,
    ResolvedEnvironment,
    getPythonExtensionAPI,
    initializePython as initializeVscodePythonExtension,
    onDidChangePythonInterpreter,
    resolveInterpreter,
} from "./common/python";
import { LanguageServerOptions, restartServer } from "./common/server";
import {
    checkIfConfigurationChanged,
    ExtensionUserSettings,
    getExtensionUserSettings,
    ignoreWarning,
    shouldShowWarning,
} from "./common/settings";
import {
    executeCommand,
    getLSClientTraceLevel,
    getWorkspaceFolder,
} from "./common/utilities";
import {
    createOutputChannel,
    onDidChangeConfiguration,
    registerCommand,
} from "./common/vscodeapi";

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { LANGUAGE_SERVER_NAME, SETTINGS_NAMESPACE } from "./common/constants";

let extension: ExtensionObject | undefined;

class ExtensionObject {
    context: vscode.ExtensionContext;
    workspace: vscode.WorkspaceFolder;
    outputChannel: vscode.LogOutputChannel;
    userSettings: ExtensionUserSettings;
    temporaryDirectory: string;
    languageServerOptions: LanguageServerOptions | undefined;
    pythonEnvironments: PythonEnvironment[];
    currentEnvironment: PythonEnvironment | undefined;
    languageServerIsRunning: boolean;
    languageServerIsCrashed: boolean;
    lsClient: LanguageClient | undefined;

    constructor(
        context: vscode.ExtensionContext,
        workspace: vscode.WorkspaceFolder,
        userSettings: ExtensionUserSettings
    ) {
        this.context = context;
        this.workspace = workspace;
        this.outputChannel = this.configureOutputChannel();
        this.userSettings = userSettings;
        this.temporaryDirectory = fs.mkdtempSync(
            path.join(os.tmpdir(), SETTINGS_NAMESPACE)
        );
        this.languageServerOptions = undefined;
        this.pythonEnvironments = [];
        this.currentEnvironment = undefined;
        this.languageServerIsRunning = false;
        this.languageServerIsCrashed = false;
        this.lsClient = undefined;
        this.updateVscodeEventSubscriptions();
    }

    private configureOutputChannel(): vscode.LogOutputChannel {
        const outputChannel = createOutputChannel(LANGUAGE_SERVER_NAME);
        this.context.subscriptions.push(outputChannel, registerLogger(outputChannel));

        const changeLogLevel = async (c: vscode.LogLevel, g: vscode.LogLevel) => {
            const level = getLSClientTraceLevel(c, g);
            await this.lsClient?.setTrace(level);
        };

        this.context.subscriptions.push(
            outputChannel.onDidChangeLogLevel(async (e) => {
                await changeLogLevel(e, vscode.env.logLevel);
            }),
            vscode.env.onDidChangeLogLevel(async (e) => {
                await changeLogLevel(outputChannel.logLevel, e);
            })
        );

        // Log Server information
        traceLog(`Name: ${LANGUAGE_SERVER_NAME}`);
        traceLog(`Module: ${SETTINGS_NAMESPACE}`);
        return outputChannel;
    }

    static async create(context: vscode.ExtensionContext): Promise<ExtensionObject> {
        if (extension !== undefined) {
            throw Error("ExtensionObject is expected to be a singleton.");
        }
        const workspace = await getWorkspaceFolder();
        const userSettings = getExtensionUserSettings(SETTINGS_NAMESPACE, workspace);

        extension = new ExtensionObject(context, workspace, userSettings);
        await extension.main();

        return extension;
    }

    async main() {
        if (this.getIsExtensionEnabled()) {
            await this.detectPythonEnvironments();
            await this.resolvePythonEnvironment();
            await this.createLanguageServerOptions();
            await this.startLanguageServer();
        }
    }

    updateVscodeEventSubscriptions() {
        if (!this.getIsExtensionEnabled()) {
            traceLog(
                "Extension is disabled. To enable, change `gerber_x3_x2_format_support.enable` to `true` and restart VS Code."
            );
            this.context.subscriptions.push(
                onDidChangeConfiguration((event) => {
                    if (
                        event.affectsConfiguration("gerber_x3_x2_format_support.enable")
                    ) {
                        traceLog(
                            "To enable or disable Gerber after changing the `enable` setting, you must restart VS Code."
                        );
                    }
                })
            );
            return;
        }

        this.context.subscriptions.push(
            onDidChangePythonInterpreter(async () => {
                await this.main();
            }),
            onDidChangeConfiguration(async (e: vscode.ConfigurationChangeEvent) => {
                if (checkIfConfigurationChanged(e)) {
                    await this.main();
                }
            }),
            registerCommand(`${SETTINGS_NAMESPACE}.restart`, async () => {
                await extension?.startLanguageServer();
            }),
            registerCommand(`${SETTINGS_NAMESPACE}.render`, async () => {
                await this.renderGerberFile();
            })
        );
    }

    private async detectPythonEnvironments() {
        traceLog("Detecting Python Environments.");

        let resolvedEnvironments: ResolvedEnvironment[] = [];

        const api = await getPythonExtensionAPI();
        if (api === undefined) {
            traceLog("Microsoft Python extension (ms-python.python) not found.");
            await this.warnMsPythonNotFound();
            return;
        }

        const activeEnvironmentID =
            api.environments.getActiveEnvironmentPath(undefined).id;

        api.environments.known.forEach((known) => {
            resolvedEnvironments.push(known.internal);
        });

        for (const environment of resolvedEnvironments) {
            const isActive = environment.id === activeEnvironmentID;

            const pythonEnvironment = await PythonEnvironment.fromResolvedEnvironment(
                environment,
                isActive,
                /* isCustom */ false
            );
            if (isActive) {
                this.pythonEnvironments.unshift(pythonEnvironment);
            } else {
                this.pythonEnvironments.push(pythonEnvironment);
            }
        }

        if (this.userSettings.customInterpreterPath.length) {
            const environment = await resolveInterpreter(
                this.userSettings.customInterpreterPath
            );
            if (environment) {
                const pythonEnvironment =
                    await PythonEnvironment.fromResolvedEnvironment(
                        environment,
                        /* isActive */ false,
                        /* isCustom */ true
                    );
                this.pythonEnvironments.unshift(pythonEnvironment);
            }
        }
        if (this.userSettings.pygerberSearchMode === "extension") {
            const extensionPythonPathEnvironments: PythonEnvironment[] = [];
            const extensionDirectory = this.getExtensionDirectory();

            for (const environment of this.pythonEnvironments) {
                const extensionPyGerberStoragePath = `${extensionDirectory}/pygerber/python/${environment
                    .getPythonVersion()
                    .toString()}`;

                extensionPythonPathEnvironments.push(
                    await PythonEnvironment.fromPythonEnvironment(
                        environment,
                        extensionPyGerberStoragePath
                    )
                );
            }
            this.pythonEnvironments = extensionPythonPathEnvironments;
        }

        if (this.pythonEnvironments.length) {
            this.logPythonInterpretersInfoList();
        } else {
            traceLog(
                "No Python interpreter detected. Language Server features won't be available."
            );
            await this.warnNoInterpreterFound();
        }
    }

    private logPythonInterpretersInfoList() {
        for (const environment of this.pythonEnvironments) {
            const isPyGerberLSAvailable =
                environment.isPyGerberLanguageServerAvailable();
            const pyGerberVersion = environment.getPyGerberVersion()?.toString();

            traceLog("---------------------------------------------------------------");
            traceLog(`  Python ID           - ${environment.getPythonID()}`);
            traceLog(`  Python path         - ${environment.getExecutablePath()}`);
            traceLog(`  Python Version      - ${environment.getPythonVersion()}`);
            traceLog(`  Is Active           - ${environment.getIsActive()}`);
            traceLog(`  Is Custom           - ${environment.getIsCustom()}`);
            traceLog(`  PyGerber available  - ${isPyGerberLSAvailable}`);
            traceLog(`  PyGerber version    - ${pyGerberVersion}`);
            traceLog(`  Custom Python Path  - ${environment.getCustomPythonPath()}`);
        }
        traceLog("---------------------------------------------------------------");
    }

    private async warnNoInterpreterFound() {
        const OK_OPTION = "Ok";
        const DON_T_SHOW_AGAIN_OPTION = "Don't show again";
        const WARNING_NAME = "warn-no-interpreter-found";

        if (shouldShowWarning(WARNING_NAME)) {
            await vscode.window
                .showErrorMessage(
                    `No Python interpreter found. Please install Python ` +
                        `interpreter version 3.8 or later to use language server features.`,
                    OK_OPTION,
                    DON_T_SHOW_AGAIN_OPTION
                )
                .then(async (result) => {
                    switch (result) {
                        case OK_OPTION:
                            break;

                        case DON_T_SHOW_AGAIN_OPTION:
                            ignoreWarning(WARNING_NAME);
                            traceLog(`Ignored warning '${WARNING_NAME}' message.`);
                            break;

                        default:
                            break;
                    }
                });
        }
    }

    private async warnMsPythonNotFound() {
        const OK_OPTION = "Ok";
        const DON_T_SHOW_AGAIN_OPTION = "Don't show again";
        const WARNING_NAME = "warn-no-ms-python-found";

        if (shouldShowWarning(WARNING_NAME)) {
            await vscode.window
                .showErrorMessage(
                    `Visual Studio Code Python extension from Microsoft not found (ms-python.python).` +
                        `It is necessary for language server features to work.`,
                    OK_OPTION,
                    DON_T_SHOW_AGAIN_OPTION
                )
                .then(async (result) => {
                    switch (result) {
                        case OK_OPTION:
                            break;

                        case DON_T_SHOW_AGAIN_OPTION:
                            ignoreWarning(WARNING_NAME);
                            traceLog(`Ignored warning '${WARNING_NAME}' message.`);
                            break;

                        default:
                            break;
                    }
                });
        }
    }

    private async resolvePythonEnvironment() {
        if (this.pythonEnvironments.length === 0) {
            return;
        }
        for (const environment of this.pythonEnvironments) {
            if (environment.isPyGerberLanguageServerAvailable()) {
                this.currentEnvironment = environment;
                traceLog(
                    `Found Python interpreter with PyGerber on board: ${environment.getPythonID()}`
                );
                return;
            } else {
                traceLog(
                    `Python ${environment.getPythonID()} doesn't have PyGerber, falling back.`
                );
            }
            if (!this.userSettings.allowAutomaticFallback) {
                traceLog(`Fallback behavior disabled, aborting.`);
                await this.warnPyGerberNotAvailableAndFallbackDisabled(environment);
                return;
            }
        }
        const environment = this.pythonEnvironments[0];
        this.warnNoPythonEnvironmentHasPyGerber(environment);
    }

    private async warnPyGerberNotAvailableAndFallbackDisabled(
        environment: PythonEnvironment
    ) {
        const OK_OPTION = "Ok";
        const AUTO_INSTALL_OPTION = "Automatically install PyGerber";
        const DON_T_SHOW_AGAIN_OPTION = "Don't show again";
        const WARNING_NAME = "warn-pygerber-missing-no-fallback";

        if (shouldShowWarning(WARNING_NAME)) {
            await vscode.window
                .showErrorMessage(
                    `PyGerber is not installed in active/custom environment and automatic fallback is disabled.`,
                    OK_OPTION,
                    AUTO_INSTALL_OPTION,
                    DON_T_SHOW_AGAIN_OPTION
                )
                .then(async (result) => {
                    switch (result) {
                        case OK_OPTION:
                            break;

                        case AUTO_INSTALL_OPTION:
                            await this.autoInstallPyGerber(environment);
                            break;

                        case DON_T_SHOW_AGAIN_OPTION:
                            ignoreWarning(WARNING_NAME);
                            traceLog(`Ignored warning '${WARNING_NAME}' message.`);
                            break;

                        default:
                            break;
                    }
                });
        }
    }

    private async warnNoPythonEnvironmentHasPyGerber(environment: PythonEnvironment) {
        const OK_OPTION = "Ok";
        const AUTO_INSTALL_OPTION = "Automatically install PyGerber";
        const DON_T_SHOW_AGAIN_OPTION = "Don't show again";
        const WARNING_NAME = "warn-pygerber-not-found-anywhere";

        if (shouldShowWarning(WARNING_NAME)) {
            await vscode.window
                .showErrorMessage(
                    `PyGerber was not found in any of known Python environments.`,
                    OK_OPTION,
                    AUTO_INSTALL_OPTION,
                    DON_T_SHOW_AGAIN_OPTION
                )
                .then(async (result) => {
                    switch (result) {
                        case OK_OPTION:
                            break;

                        case AUTO_INSTALL_OPTION:
                            await this.autoInstallPyGerber(environment);
                            break;

                        case DON_T_SHOW_AGAIN_OPTION:
                            ignoreWarning(WARNING_NAME);
                            traceLog(`Ignored warning '${WARNING_NAME}' message.`);
                            break;

                        default:
                            break;
                    }
                });
        }
    }

    private async autoInstallPyGerber(environment: PythonEnvironment) {
        await vscode.window.withProgress(
            {
                title: "Installing PyGerber with Language Server.",
                location: vscode.ProgressLocation.Notification,
            },
            async () => {
                traceLog("User requested automatic PyGerber installation.");
                let args = [
                    environment.getExecutablePath(),
                    "-m",
                    "pip",
                    "install",
                    "pygerber[language-server]>=2.1.0",
                    "--no-cache",
                    "--upgrade",
                ];
                const customPythonPath = environment.getCustomPythonPath();
                if (customPythonPath !== undefined) {
                    args.push("-t");
                    args.push(customPythonPath);
                    traceLog(
                        `Using custom path for automatic installation '${customPythonPath}'`
                    );
                }

                const { code, stdout, stderr } = await executeCommand(args.join(" "), {
                    timeout: 5 * 60 * 1000 /* Max 5 minutes then fail. */,
                });

                if (code === 0) {
                    traceLog("Automatic PyGerber installation succeeded.");
                    vscode.window
                        .showInformationMessage(`Successfully installed PyGerber`)
                        .then(() => {});
                } else {
                    traceLog(
                        `Automatic PyGerber installation failed with exit code ${code}.`
                    );
                    vscode.window
                        .showErrorMessage(`PyGerber installation failed. (${code})`)
                        .then(() => {});
                }
                return { message: "", increment: 100 };
            }
        );
    }

    hasPythonEnvironment(): boolean {
        return this.currentEnvironment !== undefined;
    }

    private getPythonEnvironment(): PythonEnvironment {
        if (this.currentEnvironment === undefined) {
            throw Error("this.pythonEnvironments is undefined");
        }
        return this.currentEnvironment;
    }

    private async createLanguageServerOptions() {
        this.languageServerOptions = {
            environment: this.getPythonEnvironment(),
            cwd: this.workspace.uri.fsPath,
            outputChannel: this.outputChannel,
            userSettings: this.userSettings,
            extensionDirectory: this.getExtensionDirectory(),
        };
    }

    getExtensionDirectory(): string {
        return this.context.extensionPath;
    }

    getIsExtensionEnabled(): Boolean {
        const { enable } = this.userSettings;
        return enable;
    }

    async startLanguageServer() {
        if (!this.hasPythonEnvironment()) {
            traceError(
                "Python environment was not detected. Language server will not be started."
            );
            return;
        }

        const languageServerOptions = this.getLanguageServerOptions();

        traceLog("Starting language server daemon.");
        try {
            this.lsClient = await restartServer(languageServerOptions, this.lsClient);
        } catch {}

        if (this.lsClient === undefined || this.lsClient.state === State.Stopped) {
            this.languageServerIsRunning = false;
            this.languageServerIsCrashed = true;
            traceLog(`${LANGUAGE_SERVER_NAME} startup failed.`);
        } else {
            this.languageServerIsRunning = true;
            this.languageServerIsCrashed = false;
            traceLog(`${LANGUAGE_SERVER_NAME} startup succeeded.`);
        }
    }

    getLanguageServerOptions(): LanguageServerOptions {
        if (this.languageServerOptions === undefined) {
            throw Error("Missing language server options.");
        }
        return this.languageServerOptions;
    }

    async stopLanguageServer() {
        await this.lsClient?.stop();
    }

    async renderGerberFile() {
        const editor = vscode.window.activeTextEditor;
        const filePath = editor?.document.uri.fsPath;

        if (filePath === undefined) {
            vscode.window.showErrorMessage("No file selected.");
            return;
        }
        let timestamp = new Date().getTime();
        let outputFilePath = `${this.temporaryDirectory}/render-${timestamp}.png`;

        vscode.window.withProgress(
            {
                title: `Rendering Gerber file "${filePath}".`,
                location: vscode.ProgressLocation.Notification,
            },
            async () => {
                const command = [
                    "-m",
                    "pygerber",
                    "raster-2d",
                    `"${filePath}"`,
                    "--style",
                    this.userSettings.layerStyle,
                    "--output",
                    `"${outputFilePath}"`,
                    "--dpi",
                    this.userSettings.renderDpi,
                ].join(" ");

                traceLog("Requested render of current file");
                traceLog(command);

                const { code, stdout, stderr } =
                    await this.getPythonEnvironment().executePythonCommand(command);

                if (code === 0) {
                    vscode.window.showInformationMessage(
                        `Successfully rendered file "${filePath}", see result in "${outputFilePath}".`
                    );
                    const panel = vscode.window.createWebviewPanel(
                        "htmlPreview",
                        outputFilePath,
                        vscode.ViewColumn.One,
                        { enableScripts: true }
                    );
                    const image = fs.readFileSync(outputFilePath);
                    const base64Image = new Buffer(image).toString("base64");

                    panel.webview.html = getWebviewContent(base64Image);
                } else {
                    vscode.window.showErrorMessage(
                        `Failed to render file "${filePath}".`
                    );
                }
                return { message: "", increment: 100 };
            }
        );
    }
}

function getWebviewContent(base64Image: string): string {
    const javascriptCode = `

    let ctrlKey = false;
    let shiftKey = false;
    let mouseHold = false;
    let imageScale = 2;

    document.addEventListener('keydown', function(event) {
        if (event.ctrlKey) {
            console.log("CTRL DOWN");
            ctrlKey = true;
        }
    });

    document.addEventListener('keyup', function(event) {
        if (!event.ctrlKey) {
            console.log("CTRL UP");
            ctrlKey = false;
        }
    });

    document.addEventListener('keydown', function(event) {
        if (event.shiftKey) {
            console.log("SHIFT DOWN");
            shiftKey = true;
        }
    });

    document.addEventListener('keyup', function(event) {
        if (!event.shiftKey) {
            console.log("SHIFT UP");
            shiftKey = false;
        }
    });

    document.addEventListener('mousedown', function(event) {
        console.log("MOUSE DOWN");
        mouseHold = true;
    });

    document.addEventListener('mouseup', function(event) {
        console.log("MOUSE UP");
        mouseHold = false;
    });

    document.addEventListener('mousemove', function(event) {
        if (mouseHold) {
            window.scrollBy(-event.movementX, -event.movementY);
        }
    });

    document.addEventListener('wheel', function(event) {
        console.log("WHEEL " + ctrlKey  + " " + shiftKey + " " + imageScale);
        if (ctrlKey) {
        	if (event.deltaY < 0)	{
                imageScale *= 1.05;
            } else {
                imageScale *= 0.95;
            }
            const imageView = document.getElementById("image-view");
            imageView.style.setProperty("--image-scale", imageScale.toString());
            event.preventDefault();
            return false;
        }
    })

    window.scrollTo(window.innerWidth / 2, window.innerHeight / 2);

    `;

    const cssCode = `
        html {
            height: 200vh;
            width: 200vw;
            overflow: scroll;
            user-select: none;

            --image-width: 400px;
            --image-scale: 2;
        }

        body { }

        .box {
            position: absolute;
            left: calc(100vw - calc(var(--image-width) / 2));
            top: calc(100vh - calc(var(--image-width) / 2));
        }

        .image-wrapper {
            user-select: none;
        }

        .image-wrapper img {
            display: block;
            width: var(--image-width);
            height: auto;
            transform: scale(var(--image-scale));
            border-style: dashed;
            border-color: white;
            border-width: 1px;
            image-rendering: pixelated;
        }
    `;

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Gerber render display</title>
        <style>
            ${cssCode}
        </style>
    </head>
    <body>
        <div class="box">
            <div class="image-wrapper">
                <img draggable="false" id="image-view" src="data:image/png;base64,${base64Image}" />
            </div>
        </div>
        <script>
            (function() {
                ${javascriptCode}
            })()
        </script>
    </body>
    </html>`;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    traceLog(`Python extension loading`);
    await initializeVscodePythonExtension(context.subscriptions);
    traceLog(`Python extension loaded`);

    traceLog(`Gerber X3/X2 Format Support extension loading`);
    extension = await ExtensionObject.create(context);
    traceLog(`Gerber X3/X2 Format Support extension loaded`);
}

export async function deactivate(): Promise<void> {
    await extension?.stopLanguageServer();
}
