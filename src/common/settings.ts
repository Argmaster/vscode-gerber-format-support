import {
    ConfigurationChangeEvent, WorkspaceFolder
} from "vscode";
import * as vscodeapi from "./vscodeapi";

export interface ExtensionUserSettings {
    args: string[];
    interpreter: string[];
    enable: boolean;
}

export async function getExtensionUserSettings(
    namespace: string,
    workspace: WorkspaceFolder
): Promise<ExtensionUserSettings> {
    const settings = vscodeapi.getConfiguration(namespace);

    const args = settings.get<string[]>("args") ?? [];

    let interpreter = settings.get<string[]>("interpreter") ?? [];
    interpreter = interpreter.map((e) => resolveVariables(e, workspace));

    const enable = settings.get<boolean>("enable") ?? true;

    return { args, interpreter, enable };
}

function resolveVariables(value: string, workspace?: WorkspaceFolder): string {
    const substitutions = new Map<string, string>();
    const home = process.env.HOME || process.env.USERPROFILE;
    if (home) {
        substitutions.set("${userHome}", home);
    }
    if (workspace) {
        substitutions.set("${workspaceFolder}", workspace.uri.fsPath);
    }
    substitutions.set("${cwd}", process.cwd());
    vscodeapi.getWorkspaceFolders().forEach((w) => {
        substitutions.set("${workspaceFolder:" + w.name + "}", w.uri.fsPath);
    });

    let temporaryString = value;

    for (const [key, value] of substitutions) {
        temporaryString = temporaryString.replace(key, value);
    }
    return temporaryString;
}

export function checkIfConfigurationChanged(
    e: ConfigurationChangeEvent,
    namespace: string
): boolean {
    const settings = [
        `${namespace}.args`,
        `${namespace}.interpreter`,
        `${namespace}.enable`,
    ];
    return settings.some((s) => e.affectsConfiguration(s));
}
