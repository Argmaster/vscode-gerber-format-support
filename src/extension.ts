import * as vscode from "vscode";
import { LanguageClient, State } from "vscode-languageclient/node";
import {
    registerLogger,
    traceError,
    traceInfo,
    traceLog,
    traceVerbose,
} from "./common/log/logging";
import {
    getInterpreterDetails,
    initializePython,
    isInterpreterGood,
    onDidChangePythonInterpreter,
} from "./common/python";
import {
    LanguageServerOptions,
    PyGerberLanguageServerStatus,
    executePythonCommand,
    handleNegativePyGerberLanguageServerStatus as handleNegativePyGerberLanguageServerStatus,
    isPyGerberLanguageServerAvailable,
    restartServer,
} from "./common/server";
import {
    checkIfConfigurationChanged,
    ExtensionUserSettings,
    getExtensionUserSettings,
} from "./common/settings";
import {
    ExtensionStaticSettings,
    loadExtensionStaticSettings,
} from "./common/settings";
import { getLSClientTraceLevel, getWorkspaceFolder } from "./common/utilities";
import {
    createOutputChannel,
    onDidChangeConfiguration,
    registerCommand,
} from "./common/vscodeapi";

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const issueTracker = "https://github.com/argmaster/pygerber/issues";

enum LanguageStartupStateEnum {
    notRunning,
    starting,
    running,
    crashed,
}

let lsClient: LanguageClient | undefined;
let restartQueued = false;
let startupState = LanguageStartupStateEnum.notRunning;
let extension: ExtensionObject | undefined;

class ExtensionObject {
    context: vscode.ExtensionContext;
    workspace: vscode.WorkspaceFolder;
    extensionStaticSettings: ExtensionStaticSettings;
    outputChannel: vscode.LogOutputChannel;
    userSettings: ExtensionUserSettings;
    temporaryDirectory: string;
    languageServerOptions: LanguageServerOptions | undefined;

    constructor(
        context: vscode.ExtensionContext,
        workspace: vscode.WorkspaceFolder,
        userSettings: ExtensionUserSettings
    ) {
        this.context = context;
        this.workspace = workspace;
        this.extensionStaticSettings = loadExtensionStaticSettings();
        this.outputChannel = this.configureOutputChannel();
        this.userSettings = userSettings;
        this.temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "my-app-"));
        this.languageServerOptions = undefined;
    }

    static async create(context: vscode.ExtensionContext): Promise<ExtensionObject> {
        if (extension !== undefined) {
            throw Error("ExtensionObject is expected to be a singleton.");
        }
        const { languageServerName, settingsNamespace } = loadExtensionStaticSettings();
        const workspace = await getWorkspaceFolder();
        const userSettings = await getExtensionUserSettings(
            settingsNamespace,
            workspace
        );

        const interpreterStats = isInterpreterGood(userSettings.interpreter);

        if (!(await interpreterStats).isGood) {
            traceLog(`Python extension loading`);
            await initializePython(context.subscriptions);
            traceLog(`Python extension loaded`);
        }

        extension = new ExtensionObject(context, workspace, userSettings);
        await extension.updateVscodeEventSubscriptions();

        return extension;
    }

    configureOutputChannel(): vscode.LogOutputChannel {
        const { languageServerName, settingsNamespace } = this.extensionStaticSettings;

        const outputChannel = createOutputChannel(languageServerName);
        this.context.subscriptions.push(outputChannel, registerLogger(outputChannel));

        const changeLogLevel = async (c: vscode.LogLevel, g: vscode.LogLevel) => {
            const level = getLSClientTraceLevel(c, g);
            await lsClient?.setTrace(level);
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
        traceLog(`Name: ${languageServerName}`);
        traceLog(`Module: ${settingsNamespace}`);
        return outputChannel;
    }

    getExtensionDirectory(): string {
        return this.context.extensionPath;
    }

    getLanguageServerName(): string {
        return this.extensionStaticSettings.languageServerName;
    }

    getSettingsNamespace(): string {
        return this.extensionStaticSettings.settingsNamespace;
    }

    getIsExtensionEnabled(): Boolean {
        const { enable } = this.userSettings;
        return enable;
    }

    async getInterpreterPath(): Promise<string> {
        let interpreterPath: string = "";

        const interpreterStats = await isInterpreterGood(this.userSettings.interpreter);
        if (interpreterStats.isGood) {
            traceVerbose(
                `Using interpreter from ${this.getSettingsNamespace()}.interpreter: ${
                    (await interpreterStats).path
                }`
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

    async updateVscodeEventSubscriptions() {
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
                await this.runServer();
            }),
            onDidChangeConfiguration(async (e: vscode.ConfigurationChangeEvent) => {
                if (checkIfConfigurationChanged(e, this.getSettingsNamespace())) {
                    await this.runServer();
                }
            }),
            registerCommand(`${this.getSettingsNamespace()}.restart`, async () => {
                if (startupState === LanguageStartupStateEnum.crashed) {
                    startupState = LanguageStartupStateEnum.running;
                }
                await this.runServer();
            }),
            registerCommand(`${this.getSettingsNamespace()}.render`, async () => {
                await this.renderGerberFile();
            })
        );
    }

    async getLanguageServerOptions(): Promise<LanguageServerOptions> {
        if (this.languageServerOptions === undefined) {
            const interpreterPath = await this.getInterpreterPath();

            if (!interpreterPath) {
                const message =
                    "Python interpreter missing:\r\n" +
                    "Select python interpreter using the ms-python.python.\r\n" +
                    "Please use Python 3.8 or greater.";

                traceError(message);
                vscode.window.showErrorMessage(message);
                throw Error("Python interpreter missing.");
            }
            this.languageServerOptions = {
                interpreter: interpreterPath,
                cwd: this.workspace.uri.fsPath,
                outputChannel: this.outputChannel,
                staticSettings: this.extensionStaticSettings,
                userSettings: this.userSettings,
                extensionDirectory: this.getExtensionDirectory(),
            };
        }
        return this.languageServerOptions;
    }

    async runServer() {
        switch (startupState) {
            case LanguageStartupStateEnum.notRunning:
                traceLog(
                    `Language server ${this.getLanguageServerName()} is not running, let's start it.`
                );
                startupState = LanguageStartupStateEnum.starting;
                break;

            case LanguageStartupStateEnum.starting:
                traceLog(
                    `Server is currently starting ${this.getLanguageServerName()}, wait or reset Visual Studio Code.`
                );
                return;

            case LanguageStartupStateEnum.running:
                traceLog(
                    `Language Server is currently running, let's stop it and run again.`
                );

                startupState = LanguageStartupStateEnum.starting;
                break;

            case LanguageStartupStateEnum.crashed:
                traceLog(
                    `Primary startup of ${this.getLanguageServerName()} failed, aborting.`
                );
                return;

            default:
                return;
        }

        const languageServerOptions = await this.getLanguageServerOptions();
        const languageServerStatus = await isPyGerberLanguageServerAvailable(
            languageServerOptions
        );

        switch (languageServerStatus) {
            case PyGerberLanguageServerStatus.good: {
                await this.startServerWithStateUpdate();
                break;
            }

            default: {
                traceInfo(
                    `Language server is not available, require user interaction.`
                );
                let shouldRetryServerStartup =
                    await handleNegativePyGerberLanguageServerStatus(
                        languageServerStatus,
                        languageServerOptions
                    );
                if (shouldRetryServerStartup) {
                    await this.startServerWithStateUpdate();
                }
                break;
            }
        }
        return;
    }

    async startServerWithStateUpdate() {
        const languageServerOptions = await this.getLanguageServerOptions();

        traceLog("Starting language server daemon.");
        lsClient = await restartServer(languageServerOptions, lsClient);

        if (lsClient === undefined || lsClient.state === State.Stopped) {
            startupState = LanguageStartupStateEnum.crashed;
            traceLog(`${this.getLanguageServerName()} startup failed.`);
        }

        traceLog(`${this.getLanguageServerName()} startup succeeded.`);
        startupState = LanguageStartupStateEnum.running;

        if (restartQueued) {
            restartQueued = false;
            await this.runServer();
        }
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
                const cmd = [
                    "-m",
                    "pygerber",
                    "raster-2d",
                    filePath,
                    "--style",
                    this.userSettings.layerStyle,
                    "--output",
                    outputFilePath,
                    "--dpi",
                    this.userSettings.renderDpi,
                ].join(" ");

                const { code, stdout, stderr } = await executePythonCommand(
                    await this.getInterpreterPath(),
                    cmd,
                    this.getExtensionDirectory()
                );

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
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Image Display</title>
        <style>
            body {
                margin: 1rem;
            }
            #container {
                width: 100vw;
                height: 100vh;
            }
            #image {
                heigh: auto;
                width: auto;
                border: 1px solid black;
            }
        </style>
    </head>
    <body>
        <div id="container">
            <img id="image" src="data:image/png;base64,${base64Image}" />
        </div>
        <script>

            (function() {
                let scale = 1;
                let ctrlPressed = false;

                function keyDown(e) {
                    if (e.ctrlKey) {
                        ctrlPressed = true;
                    }
                }
                window.addEventListener('keydown', keyDown, false);

                function keyUp(e) {
                    if (!e.ctrlKey) {
                        ctrlPressed = false;
                    }
                }
                window.addEventListener('keyup', keyUp, false);

                window.addEventListener('wheel', function(event) {
                    if (!ctrlPressed) {
                        return;
                    }
                    event.preventDefault();

                    let img = document.getElementById('image');
                    scale -= (event.deltaY * 0.001);
                    scale = Math.min(Math.max(0.1, scale), 10);

                    img.style.transform = "scale(" + scale + ")"
                }, false);
            })()
        </script>
    </body>
    </html>`;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    extension = await ExtensionObject.create(context);
    await extension.runServer();
}

export async function deactivate(): Promise<void> {
    if (lsClient) {
        await lsClient.stop();
    }
}
