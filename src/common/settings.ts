import {
    ConfigurationChangeEvent,
    ConfigurationScope,
    Uri,
    WorkspaceConfiguration,
    WorkspaceFolder,
} from "vscode";
import { getInterpreterDetails } from "./python";
import { getConfiguration, getWorkspaceFolders } from "./vscodeapi";

export interface ISettings {
    cwd: string;
    workspace: string;
    args: string[];
    interpreter: string[];
    enable: boolean;
}

export function getExtensionSettings(namespace: string): Promise<ISettings[]> {
    return Promise.all(
        getWorkspaceFolders().map((workspaceFolder) =>
            getWorkspaceSettings(namespace, workspaceFolder)
        )
    );
}

function resolveVariables(value: string[], workspace?: WorkspaceFolder): string[] {
    const substitutions = new Map<string, string>();
    const home = process.env.HOME || process.env.USERPROFILE;
    if (home) {
        substitutions.set("${userHome}", home);
    }
    if (workspace) {
        substitutions.set("${workspaceFolder}", workspace.uri.fsPath);
    }
    substitutions.set("${cwd}", process.cwd());
    getWorkspaceFolders().forEach((w) => {
        substitutions.set("${workspaceFolder:" + w.name + "}", w.uri.fsPath);
    });

    return value.map((s) => {
        for (const [key, value] of substitutions) {
            s = s.replace(key, value);
        }
        return s;
    });
}

export function getInterpreterFromSetting(
    namespace: string,
    scope?: ConfigurationScope
) {
    const config = getConfiguration(namespace, scope);
    return config.get<string[]>("interpreter");
}

export async function getWorkspaceSettings(
    namespace: string,
    workspace: WorkspaceFolder
): Promise<ISettings> {
    const config = getConfiguration(namespace, workspace.uri);

    let interpreter: string[] = getInterpreterFromSetting(namespace, workspace) ?? [];
    if (interpreter.length === 0) {
        interpreter = (await getInterpreterDetails(workspace.uri)).path ?? [];
    }

    return {
        cwd: workspace.uri.fsPath,
        workspace: workspace.uri.toString(),
        args: resolveVariables(config.get<string[]>("args") ?? [], workspace),
        interpreter: resolveVariables(interpreter, workspace),
        enable: config.get<boolean>("enable") ?? true,
    };
}

function getGlobalValue<T>(
    config: WorkspaceConfiguration,
    key: string,
    defaultValue: T
): T {
    const inspect = config.inspect<T>(key);
    return inspect?.globalValue ?? inspect?.defaultValue ?? defaultValue;
}

export async function getGlobalSettings(namespace: string): Promise<ISettings> {
    const config = getConfiguration(namespace);
    return {
        cwd: process.cwd(),
        workspace: process.cwd(),
        args: getGlobalValue<string[]>(config, "args", []),
        interpreter: [],
        enable: getGlobalValue<boolean>(config, "enable", true),
    };
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
