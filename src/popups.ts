import * as vscode from "vscode";
import { RestartResult } from "./language_server";
import { EXTENSION_NAME } from "./extension";

export async function reportServerRefreshResult(status: RestartResult) {
    switch (status) {
        case RestartResult.failed:
            await vscode.window.showErrorMessage(
                `${EXTENSION_NAME}: Failed to start the language server.`
            );
            break;
        case RestartResult.aborted:
            await vscode.window.showWarningMessage(
                `${EXTENSION_NAME}: Restart of the language server already in progress.`
            );
            break;
        case RestartResult.abortedNoLanguageServer:
            await vscode.window.showWarningMessage(
                `${EXTENSION_NAME}: PyGerber Language Server is not available in selected Python environment.`
            );
            break;
        case RestartResult.abortedNoPyGerber:
            await vscode.window.showWarningMessage(
                `${EXTENSION_NAME}: PyGerber is not installed in selected Python environment.`
            );
            break;
        case RestartResult.abortedNoPythonEnvironment:
            await vscode.window.showWarningMessage(
                `${EXTENSION_NAME}: No Python environment active. Please make sure you have Python interpreter installed.`
            );
            break;
        case RestartResult.silentAborted:
            break;
        case RestartResult.success:
            break;
    }
}
