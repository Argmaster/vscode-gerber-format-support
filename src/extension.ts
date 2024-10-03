import * as vscode from "vscode";
import { Python } from "./python";
import { PythonTreeView, registerPythonViewCommands } from "./python_view";
import {
    cleanUpLoggers as disposeLoggers,
    getGenericLogger,
    initLoggers,
} from "./logging";
import { LanguageServerClient } from "./language_server";
import { reportServerRefreshResult } from "./popups";

export const EXTENSION_NAME = "Gerber X3/X2 Format Support";

export class ExtensionState implements vscode.Disposable {
    public disposables: vscode.Disposable[] = [];

    constructor(
        public readonly context: vscode.ExtensionContext,
        public readonly pythonManager: Python,
        public readonly pythonTreeView: PythonTreeView,
        public readonly languageServerClient: LanguageServerClient
    ) {
        this.disposables.push(pythonManager);
        this.disposables.push(pythonTreeView);
        this.disposables.push(languageServerClient);
    }

    static async new(context: vscode.ExtensionContext): Promise<ExtensionState> {
        await initLoggers();

        const pythonManager = await Python.new(context);
        const pythonTreeView = new PythonTreeView(pythonManager);
        const languageServerClient = new LanguageServerClient(pythonManager);

        pythonManager.environmentUpdatesSubscription.push(pythonTreeView);
        pythonManager.environmentUpdatesSubscription.push(languageServerClient);

        await languageServerClient.refresh();

        const extensionState = new ExtensionState(
            context,
            pythonManager,
            pythonTreeView,
            languageServerClient
        );
        await extensionState.register();
        context.subscriptions.push(extensionState);

        return extensionState;
    }

    register() {
        this.disposables.push(
            vscode.window.registerTreeDataProvider(
                "gerber-x3-x2-format-support-environments",
                this.pythonTreeView
            ),
            vscode.commands.registerCommand(
                `gerber_x3_x2_format_support.restartLanguageServer`,
                async () => {
                    getGenericLogger().traceInfo(`Restarting language server.`);
                    this.languageServerClient.refresh().then(reportServerRefreshResult);
                }
            )
        );
        registerPythonViewCommands(this);
    }

    dispose() {
        this.disposables.forEach((d) => d.dispose());
        disposeLoggers();
    }
}

export async function activate(context: vscode.ExtensionContext) {
    return await ExtensionState.new(context);
}
