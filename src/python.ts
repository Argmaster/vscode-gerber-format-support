import * as vscode from "vscode";
import * as python_extension from "@vscode/python-extension";
import { PythonTreeView } from "./python_view";
import { getGenericLogger } from "./logging";
import { runCommand } from "./child";
import * as semver from "semver";
import { get } from "node:http";

export class Python {
    private knownEnvironments: PythonEnvironment[] = [];
    private activeEnvironment: PythonEnvironment | undefined;
    private pythonTreeView: PythonTreeView | undefined;

    constructor(private readonly pythonApi: python_extension.PythonExtension) {
        getGenericLogger()?.traceInfo("Python manager initialized");
    }

    public static async new(context: vscode.ExtensionContext): Promise<Python> {
        const pythonApi = await python_extension.PythonExtension.api();
        const manager = new Python(pythonApi);
        await manager.refresh();

        context.subscriptions.push(
            pythonApi.environments.onDidChangeEnvironments(
                async (e: python_extension.EnvironmentsChangeEvent) => {
                    await manager.refresh();
                    if (manager.pythonTreeView) {
                        manager.pythonTreeView.refresh();
                    }
                }
            )
        );
        context.subscriptions.push(
            pythonApi.environments.onDidChangeActiveEnvironmentPath(
                async (e: python_extension.ActiveEnvironmentPathChangeEvent) => {
                    await manager.refresh();
                    if (manager.pythonTreeView) {
                        manager.pythonTreeView.refresh();
                    }
                }
            )
        );

        return manager;
    }

    bindTreeView(treeView: PythonTreeView) {
        this.pythonTreeView = treeView;
    }

    async refresh() {
        const activeEnvironment = await this.pythonApi.environments.resolveEnvironment(
            await this.pythonApi.environments.getActiveEnvironmentPath()
        );
        const envs = await Promise.all(
            this.pythonApi.environments.known.map(async (env) => {
                const resolved = await this.pythonApi.environments.resolveEnvironment(
                    env
                );
                if (resolved?.executable.uri === undefined) {
                    return undefined;
                }

                const result = await runCommand(resolved.executable.uri.fsPath, [
                    "-Sc",
                    "import platform;print(platform.python_version())",
                ]);
                if (!result.isSuccess()) {
                    return undefined;
                }

                const resultPipList = await runCommand(resolved.executable.uri.fsPath, [
                    "-m",
                    "pip",
                    "list",
                    "--format=json",
                ]);
                if (!result.isSuccess()) {
                    return undefined;
                }
                try {
                    const packages = JSON.parse(resultPipList.stdout);
                    getGenericLogger()?.traceInfo("Known environment: " + resolved.id);

                    return new PythonEnvironment(
                        resolved.id,
                        resolved.environment?.folderUri.fsPath ?? resolved.path,
                        resolved.executable.uri,
                        new semver.SemVer(result.stdout.trim()),
                        packages as PackageInfo[],
                        resolved.id === activeEnvironment?.id
                    );
                } catch (e) {
                    getGenericLogger().traceError(e);
                    return undefined;
                }
            })
        );
        this.knownEnvironments = envs.filter((env) => env !== undefined);
        this.activeEnvironment = this.knownEnvironments.find((env) => env.isActive);
    }

    async getEnvironments() {
        return this.knownEnvironments;
    }

    async getActiveEnvironment() {
        return this.activeEnvironment;
    }
}

export class PythonEnvironment {
    private hasLanguageServerFlag: boolean | undefined = undefined;

    constructor(
        public readonly label: string,
        public readonly path: string,
        public readonly executableUri: vscode.Uri,
        public readonly version: semver.SemVer,
        public readonly packages: PackageInfo[],
        public readonly isActive: boolean
    ) {}

    getPyGerber() {
        return this.packages.find((pkg) => pkg.name === "pygerber");
    }
    async hasLanguageServer() {
        if (this.hasLanguageServerFlag !== undefined) {
            return this.hasLanguageServerFlag;
        }
        if (this.getPyGerber() === undefined) {
            this.hasLanguageServerFlag = false;
            return this.hasLanguageServerFlag;
        }
        const result = await runCommand(this.executableUri.fsPath, [
            "-m",
            "pygerber",
            "is-language-server-available",
        ]);
        if (!result.isSuccess()) {
            this.hasLanguageServerFlag = false;
            return this.hasLanguageServerFlag;
        }
        if (result.stdout.includes("Language server is available.")) {
            this.hasLanguageServerFlag = true;
            return this.hasLanguageServerFlag;
        }
        this.hasLanguageServerFlag = false;
        return this.hasLanguageServerFlag;
    }

    async installPyGerber(version: string) {
        const result = await runCommand(this.executableUri.fsPath, [
            "-m",
            "pip",
            "install",
            "--no-cache-dir",
            "--force-reinstall",
            "--compile",
            "--no-warn-script-location",
            "--disable-pip-version-check",
            "--trusted-host",
            "pypi.org",
            "--trusted-host",
            "pypi.python.org",
            "--trusted-host",
            "files.pythonhosted.org",
            "-vvv",
            `pygerber[language-server]==${version}`,
        ]);
        return result;
    }

    async queryPyGerberVersions(): Promise<string[]> {
        const result = await runCommand(this.executableUri.fsPath, [
            "-m",
            "pip",
            "index",
            "--pre",
            "versions",
            `pygerber`,
        ]);
        if (!result.isSuccess()) {
            return [];
        }
        const availableVersionsLine = result.stdout
            .split("\n")
            .find((l) => l.startsWith("Available versions"));

        return (
            availableVersionsLine
                ?.replace("Available versions: ", "")
                .split(", ")
                .map((v) => toSemVer(v))
                .filter((v) => v !== null && semver.gt(v, new semver.SemVer("2.2.1")))
                .map((v) => fromSemVer(v)) || []
        );
    }
}

export function toSemVer(version: string): semver.SemVer {
    return new semver.SemVer(
        version.replace("a", "-alpha").replace("b", "-beta").replace("rc", "-rc")
    );
}

export function fromSemVer(version: semver.SemVer): string {
    return version.raw
        .replace("-alpha", "a")
        .replace("-beta", "b")
        .replace("-rc", "rc");
}

export class PackageInfo {
    constructor(public readonly name: string, public readonly version: string) {}
}
