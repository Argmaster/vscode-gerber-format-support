import * as vscode from "vscode";
import { Python } from "./python";
import { PythonTreeView } from "./python_view";

export async function activate(context: vscode.ExtensionContext) {
    const rootPath =
        vscode.workspace.workspaceFolders &&
        vscode.workspace.workspaceFolders.length > 0
            ? vscode.workspace.workspaceFolders[0].uri.fsPath
            : undefined;

    const pythonManager = await Python.new(context);
    const pythonTreeView = new PythonTreeView(pythonManager);
    pythonManager.bindTreeView(pythonTreeView);

    vscode.window.registerTreeDataProvider(
        "gerber-x3-x2-format-support-environments",
        pythonTreeView
    );
}
