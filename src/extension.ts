import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/node";
import {
    registerLogger,
    traceError,
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
    isPyGerberLanguageServerAvailable,
    restartServer,
} from "./common/server";
import {
    checkIfConfigurationChanged,
    ExtensionUserSettings,
    getExtensionUserSettings,
} from "./common/settings";
import { ExtensionStaticSettings, loadExtensionStaticSettings } from "./common/setup";
import { getLSClientTraceLevel, getWorkspaceFolder } from "./common/utilities";
import {
    createOutputChannel,
    getConfiguration,
    onDidChangeConfiguration,
    registerCommand,
} from "./common/vscodeapi";

const issueTracker = "https://github.com/argmaster/pygerber/issues";

let lsClient: LanguageClient | undefined;
let restartInProgress = false;
let restartQueued = false;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const extensionStaticSettings = loadExtensionStaticSettings();
    const languageServerName = extensionStaticSettings.languageServerName;
    const settingsNamespace = extensionStaticSettings.settingsNamespace;

    // Setup logging
    const outputChannel = configureOutputChannel(
        context,
        languageServerName,
        settingsNamespace,
        extensionStaticSettings
    );

    const { enable } = getConfiguration(
        settingsNamespace
    ) as unknown as ExtensionUserSettings;
    traceError(enable);
    if (!enable) {
        traceLog(
            "Extension is disabled. To enable, change `gerber_x3_x2_format_support.enable` to `true` and restart VS Code."
        );
        context.subscriptions.push(
            onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration("gerber_x3_x2_format_support.enable")) {
                    traceLog(
                        "To enable or disable Ruff after changing the `enable` setting, you must restart VS Code."
                    );
                }
            })
        );
        return;
    }

    if (restartInProgress) {
        if (!restartQueued) {
            // Schedule a new restart after the current restart.
            traceLog(
                `Triggered ${languageServerName} restart while restart is in progress; queuing a restart.`
            );
            restartQueued = true;
        }
        return;
    }

    const runServer = async () => {
        if (restartInProgress) {
            if (!restartQueued) {
                // Schedule a new restart after the current restart.
                traceLog(
                    `Triggered ${languageServerName} restart while restart is in progress; queuing a restart.`
                );
                restartQueued = true;
            }
            return;
        }

        restartInProgress = true;

        const onLanguageServerFailed = async () => {
            const result = await vscode.window.showErrorMessage(
                "Failed to start Gerber language server.",
                "Retry",
                "Disable language server",
                "Select interpreter"
            );
            switch (result) {
                case "Retry":
                    await runServer();
                    break;

                case "Disable language server":
                    vscode.commands.executeCommand(
                        "workbench.action.openSettings",
                        "gerber_x3_x2_format_support.enable"
                    );

                case "Select interpreter":
                    vscode.commands.executeCommand("python.setInterpreter");
                    break;

                default:
                    break;
            }
        };

        const workspace = await getWorkspaceFolder();
        const userSettings = await getExtensionUserSettings(
            extensionStaticSettings.settingsNamespace,
            workspace
        );

        let interpreterPath = "";
        let extraArgs = [];

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
            extraArgs = interpreterDetails.path.slice(1);
        }

        if (interpreterPath) {
            const languageServerOptions: LanguageServerOptions = {
                interpreter: interpreterPath,
                cwd: workspace.uri.fsPath,
                outputChannel: outputChannel,
                staticSettings: extensionStaticSettings,
                userSettings: userSettings,
            };
            if (await isPyGerberLanguageServerAvailable(languageServerOptions)) {
                lsClient = await restartServer(languageServerOptions, lsClient);

                restartInProgress = false;
                if (restartQueued) {
                    restartQueued = false;
                    await runServer();
                }

                return;
            }
        } else {
            const message =
                "Python interpreter missing:\r\n" +
                "Select python interpreter using the ms-python.python.\r\n" +
                "Please use Python 3.8 or greater.";

            traceError(message);
            vscode.window.showErrorMessage(message);
        }
        restartInProgress = false;
    };

    context.subscriptions.push(
        onDidChangePythonInterpreter(async () => {
            await runServer();
        }),
        onDidChangeConfiguration(async (e: vscode.ConfigurationChangeEvent) => {
            if (checkIfConfigurationChanged(e, settingsNamespace)) {
                await runServer();
            }
        }),
        registerCommand(`${settingsNamespace}.restart`, async () => {
            await runServer();
        })
    );

    setImmediate(async () => {
        const workspace = await getWorkspaceFolder();
        const userSettings = await getExtensionUserSettings(
            extensionStaticSettings.settingsNamespace,
            workspace
        );

        const interpreterStats = isInterpreterGood(userSettings.interpreter);

        if (!(await interpreterStats).isGood) {
            traceLog(`Python extension loading`);
            await initializePython(context.subscriptions);
            traceLog(`Python extension loaded`);
        }

        await runServer();
    });
}

function configureOutputChannel(
    context: vscode.ExtensionContext,
    languageServerName: string,
    settingsNamespace: string,
    extensionStaticSettings: ExtensionStaticSettings
) {
    const outputChannel = createOutputChannel(languageServerName);
    context.subscriptions.push(outputChannel, registerLogger(outputChannel));

    const changeLogLevel = async (c: vscode.LogLevel, g: vscode.LogLevel) => {
        const level = getLSClientTraceLevel(c, g);
        await lsClient?.setTrace(level);
    };

    context.subscriptions.push(
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
    traceVerbose(`Full Server Info: ${JSON.stringify(extensionStaticSettings)}`);
    return outputChannel;
}

export async function deactivate(): Promise<void> {
    if (lsClient) {
        await lsClient.stop();
    }
}
