import * as vscode from "vscode";
import { LanguageClient, State } from "vscode-languageclient/node";
import {
    registerLogger,
    traceError,
    traceLog,
    traceVerbose,
} from "./common/log/logging";
import {
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
import {
    getLSClientTraceLevel,
    getWorkspaceFolder,
    renderGerberFile,
    sleep,
} from "./common/utilities";
import {
    createOutputChannel,
    getConfiguration,
    onDidChangeConfiguration,
    registerCommand,
} from "./common/vscodeapi";
import { getInterpreterPath } from "./common/utilities";

const issueTracker = "https://github.com/argmaster/pygerber/issues";

enum StartupState {
    preStartup,
    primary,
    primaryInProgress,
    primaryFailed,
    restartInProgress,
    secondary,
}

let lsClient: LanguageClient | undefined;
let restartQueued = false;
let startupState = StartupState.preStartup;

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

    const runServer = async () => {
        switch (startupState) {
            case StartupState.preStartup:
                traceLog(`Language server ${languageServerName} not prepared.`);
                return;

            case StartupState.primaryInProgress:
                traceLog(
                    `Primary startup of ${languageServerName} already in progress.`
                );
                return;

            case StartupState.primary:
                traceLog(`Primary startup of ${languageServerName}.`);
                startupState = StartupState.primaryInProgress;
                break;

            case StartupState.primaryFailed:
                traceLog(`Primary startup of ${languageServerName} failed, aborting.`);
                return;

            case StartupState.restartInProgress:
                if (!restartQueued) {
                    // Schedule a new restart after the current restart.
                    traceLog(
                        `Triggered ${languageServerName} restart while restart is in progress; queuing a restart.`
                    );
                    restartQueued = true;
                }
                return;

            case StartupState.secondary:
                traceLog(`Secondary startup of ${languageServerName}.`);
                break;

            default:
                return;
        }

        const workspace = await getWorkspaceFolder();
        const userSettings = await getExtensionUserSettings(
            extensionStaticSettings.settingsNamespace,
            workspace
        );
        let interpreterPath = await getInterpreterPath(
            userSettings,
            extensionStaticSettings
        );

        if (!interpreterPath) {
            const message =
                "Python interpreter missing:\r\n" +
                "Select python interpreter using the ms-python.python.\r\n" +
                "Please use Python 3.8 or greater.";

            traceError(message);
            vscode.window.showErrorMessage(message);
            return;
        }
        const languageServerOptions: LanguageServerOptions = {
            interpreter: interpreterPath,
            cwd: workspace.uri.fsPath,
            outputChannel: outputChannel,
            staticSettings: extensionStaticSettings,
            userSettings: userSettings,
        };
        if (await isPyGerberLanguageServerAvailable(languageServerOptions)) {
            lsClient = await restartServer(languageServerOptions, lsClient);

            if (lsClient === undefined || lsClient.state === State.Stopped) {
                startupState = StartupState.primaryFailed;
                traceLog(`${languageServerName} startup failed.`);
            } else {
                startupState = StartupState.secondary;
            }

            if (restartQueued) {
                restartQueued = false;
                await runServer();
            }

            return;
        }
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
            if (startupState === StartupState.primaryFailed) {
                startupState = StartupState.primary;
            }
            await runServer();
        }),
        registerCommand(`${settingsNamespace}.render`, async () => {
            await renderGerberFile();
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
        startupState = StartupState.primary;
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
