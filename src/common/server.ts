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
import { getLSClientTraceLevel } from "./utilities";
import * as vscodeapi from "./vscodeapi";
import {
    INSTALLATION_GUIDE_URL,
    LANGUAGE_SERVER_NAME,
    SETTINGS_NAMESPACE,
} from "./constants";
import { PythonEnvironment } from "./python";

export type LanguageServerOptions = {
    environment: PythonEnvironment;
    cwd: string;
    userSettings: ExtensionUserSettings;
    outputChannel: vscode.LogOutputChannel;
    extensionDirectory: string;
};

async function createServerProcess(
    options: LanguageServerOptions
): Promise<LanguageClient> {
    const command = options.environment.getExecutablePath();
    const cwd = options.cwd;
    const newEnv = options.environment.getPythonEnvironment();

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
        SETTINGS_NAMESPACE,
        LANGUAGE_SERVER_NAME,
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
