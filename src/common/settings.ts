import { ConfigurationChangeEvent, WorkspaceFolder } from "vscode";
import * as vscodeapi from "./vscodeapi";
import { integer } from "vscode-languageclient";
import * as fs from "fs-extra";
import * as path from "path";
import { EXTENSION_ROOT_DIR } from "./constants";

export interface ExtensionUserSettings {
    args: string[];
    interpreter: string[];
    enable: boolean;
    renderDpi: integer;
    imageFormat: string;
    layerStyle: string;
}

export interface ExtensionStaticSettings {
    languageServerName: string;
    settingsNamespace: string;
}

export function loadExtensionStaticSettings(): ExtensionStaticSettings {
    const packageJson = path.join(EXTENSION_ROOT_DIR, "package.json");
    const content = fs.readFileSync(packageJson).toString();
    const config = JSON.parse(content);
    return config.extensionStaticSettings as ExtensionStaticSettings;
}

export function getExtensionUserSettings(
    namespace: string,
    workspace: WorkspaceFolder
): ExtensionUserSettings {
    const settings = vscodeapi.getConfiguration(namespace);

    const args = settings.get<string[]>("args") ?? [];

    let interpreter = settings.get<string[]>("interpreter") ?? [];
    interpreter = interpreter.map((e) => resolveVariables(e, workspace));

    const enable = settings.get<boolean>("enable") ?? true;
    const renderDpi = settings.get<integer>("renderDpi") ?? 1000;
    const imageFormat = settings.get<string>("imageFormat") ?? ".png";
    const layerStyle = settings.get<string>("layerStyle") ?? "copper_alpha";

    return { args, interpreter, enable, renderDpi, imageFormat, layerStyle };
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
