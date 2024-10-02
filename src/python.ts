import * as vscode from "vscode";
import * as python_extension from "@vscode/python-extension";
import { PythonTreeView } from "./python_view";
import { getGenericLogger } from "./logging";
import { runCommand } from "./child";
import { SemVer } from "semver";

export class Python {
    activeEnvironment: python_extension.Environment | undefined;
    pythonTreeView: PythonTreeView | undefined;

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
        this.activeEnvironment = await this.pythonApi.environments.resolveEnvironment(
            await this.pythonApi.environments.getActiveEnvironmentPath()
        );
        getGenericLogger()?.traceInfo("Python manager refreshed");
        getGenericLogger()?.traceInfo(
            `Current Python environment: ${this.activeEnvironment?.path}`
        );
    }

    async getEnvironments() {
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
                    return new PythonEnvironment(
                        resolved.id,
                        resolved.environment?.folderUri.fsPath ?? resolved.path,
                        resolved.executable.uri,
                        new SemVer(result.stdout.trim()),
                        packages as PackageInfo[]
                    );
                } catch {
                    return undefined;
                }
            })
        );
        return envs.filter((env) => env !== undefined);
    }
}

export class PythonEnvironment {
    private hasLanguageServerFlag: boolean | undefined = undefined;

    constructor(
        public readonly label: string,
        public readonly path: string,
        public readonly executableUri: vscode.Uri,
        public readonly version: SemVer,
        public readonly packages: PackageInfo[]
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
}

export class PackageInfo {
    constructor(public readonly name: string, public readonly version: string) {}
}
