import * as fsapi from "fs-extra";
import { Disposable, env, LogOutputChannel } from "vscode";
import { State } from "vscode-languageclient";
import {
    LanguageClient,
    LanguageClientOptions,
    RevealOutputChannelOn,
    ServerOptions,
    TransportKind,
} from "vscode-languageclient/node";
import { traceError, traceInfo, traceVerbose } from "./log/logging";
import {
    getExtensionSettings,
    getGlobalSettings,
    getWorkspaceSettings,
    ISettings,
} from "./settings";
import { getLSClientTraceLevel, getProjectRoot } from "./utilities";
import { isVirtualWorkspace } from "./vscodeapi";

export type IInitOptions = { settings: ISettings[]; globalSettings: ISettings };

async function createServer(
    settings: ISettings,
    serverId: string,
    serverName: string,
    outputChannel: LogOutputChannel,
    initializationOptions: IInitOptions
): Promise<LanguageClient> {
    const command = settings.interpreter[0];
    const cwd = settings.cwd;

    // Set debugger path needed for debugging python code.
    const newEnv = { ...process.env };

    const args = settings.interpreter
        .slice(1)
        .concat(["-m", "pygerber.gerberx3.language_server"]);
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
        documentSelector: isVirtualWorkspace()
            ? [{ language: "gerber" }]
            : [
                  { scheme: "file", language: "gerber" },
                  { scheme: "untitled", language: "gerber" },
              ],
        outputChannel: outputChannel,
        traceOutputChannel: outputChannel,
        revealOutputChannelOn: RevealOutputChannelOn.Never,
        initializationOptions,
    };

    return new LanguageClient(serverId, serverName, serverOptions, clientOptions);
}

let _disposables: Disposable[] = [];
export async function restartServer(
    serverId: string,
    serverName: string,
    outputChannel: LogOutputChannel,
    lsClient?: LanguageClient
): Promise<LanguageClient | undefined> {
    if (lsClient) {
        traceInfo(`Server: Stop requested`);
        await lsClient.stop();
        _disposables.forEach((d) => d.dispose());
        _disposables = [];
    }
    const projectRoot = await getProjectRoot();
    const workspaceSetting = await getWorkspaceSettings(serverId, projectRoot);

    const newLSClient = await createServer(
        workspaceSetting,
        serverId,
        serverName,
        outputChannel,
        {
            settings: await getExtensionSettings(serverId),
            globalSettings: await getGlobalSettings(serverId),
        }
    );
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

    const level = getLSClientTraceLevel(outputChannel.logLevel, env.logLevel);
    await newLSClient.setTrace(level);
    return newLSClient;
}
