import * as vscode from "vscode";
import * as vscodeapi from "./vscodeapi";
import { integer } from "vscode-languageclient";
import { EXTENSION_SETTING_IGNORED_WARNINGS, SETTINGS_NAMESPACE } from "./constants";

export interface ExtensionUserSettings {
    args: string[];
    customInterpreterPath: string;
    allowAutomaticFallback: boolean;
    pygerberSearchMode: "environment" | "extension";
    extensionPygerberInstallDirectory: string | undefined;
    enable: boolean;
    renderDpi: integer;
    imageFormat: string;
    layerStyle: string;
    ignoredWarnings: string[];
}

export function getExtensionUserSettings(
    namespace: string,
    workspace: vscode.WorkspaceFolder
): ExtensionUserSettings {
    const settings = vscodeapi.getConfiguration(namespace);

    const enable = settings.get<boolean>("enable") ?? true;

    const args = settings.get<string[]>("args") ?? [];
    let customInterpreterPath = resolveVariables(
        settings.get<string>("customInterpreterPath") ?? "",
        workspace
    );
    const allowAutomaticFallback =
        settings.get<"on" | "off">("allowAutomaticFallback") === "on";
    const pygerberSearchMode =
        settings.get<"environment" | "extension">("pygerberSearchMode") ?? "extension";
    const extensionPygerberInstallDirectory = settings.get<string>(
        "extensionPygerberInstallDirectory"
    );

    const renderDpi = settings.get<integer>("renderDpi") ?? 1000;
    const imageFormat = settings.get<string>("imageFormat") ?? ".png";
    const layerStyle = settings.get<string>("layerStyle") ?? "copper_alpha";

    const ignoredWarnings = settings.get<string[]>("ignoredWarnings") ?? [];

    return {
        args,
        customInterpreterPath,
        allowAutomaticFallback,
        pygerberSearchMode,
        extensionPygerberInstallDirectory,
        enable,
        renderDpi,
        imageFormat,
        layerStyle,
        ignoredWarnings,
    };
}

function resolveVariables(value: string, workspace?: vscode.WorkspaceFolder): string {
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
    e: vscode.ConfigurationChangeEvent
): boolean {
    const settings = [
        `${SETTINGS_NAMESPACE}.args`,
        `${SETTINGS_NAMESPACE}.customInterpreterPath`,
        `${SETTINGS_NAMESPACE}.allowAutomaticFallback`,
        `${SETTINGS_NAMESPACE}.pygerberSearchMode`,
        `${SETTINGS_NAMESPACE}.extensionPygerberInstallDirectory`,
        `${SETTINGS_NAMESPACE}.renderDpi`,
        `${SETTINGS_NAMESPACE}.imageFormat`,
        `${SETTINGS_NAMESPACE}.layerStyle`,
        `${SETTINGS_NAMESPACE}.ignoredWarnings`,
    ];
    return settings.some((s) => e.affectsConfiguration(s));
}

export function ignoreWarning(warningId: string) {
    const configuration = vscode.workspace.getConfiguration();
    let ignoredWarnings = configuration.get<string[]>(
        EXTENSION_SETTING_IGNORED_WARNINGS,
        []
    );

    if (!ignoredWarnings.includes(warningId)) {
        ignoredWarnings.push(warningId);
        configuration.update(
            EXTENSION_SETTING_IGNORED_WARNINGS,
            ignoredWarnings,
            vscode.ConfigurationTarget.Global
        );
    }
}

export function shouldShowWarning(warningId: string): boolean {
    const ignoredWarnings = vscode.workspace
        .getConfiguration()
        .get<string[]>(EXTENSION_SETTING_IGNORED_WARNINGS, []);
    return !ignoredWarnings.includes(warningId);
}
