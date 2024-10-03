import * as vscode from "vscode";
import { Python } from "./python";
import { PythonTreeView, registerPythonViewCommands } from "./python_view";

export class ExtensionState {
    constructor(
        public readonly context: vscode.ExtensionContext,
        public readonly pythonManager: Python,
        public readonly pythonTreeView: PythonTreeView
    ) {}

    static async new(context: vscode.ExtensionContext): Promise<ExtensionState> {
        const pythonManager = await Python.new(context);
        const pythonTreeView = new PythonTreeView(pythonManager);
        pythonManager.bindTreeView(pythonTreeView);

        const extensionState = new ExtensionState(context, pythonManager, pythonTreeView);
        await extensionState.register();

        return extensionState;
    }

    register() {
        vscode.window.registerTreeDataProvider(
            "gerber-x3-x2-format-support-environments",
            this.pythonTreeView
        );
        registerPythonViewCommands(this);
    }
    dispose() {}
}

export async function activate(context: vscode.ExtensionContext) {
    return await ExtensionState.new(context);
}
