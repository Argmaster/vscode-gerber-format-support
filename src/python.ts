import * as vscode from "vscode";
import * as python_extension from "@vscode/python-extension";
import { getGenericLogger } from "./logging";
import { runCommand } from "./child";
import * as semver from "semver";

export class Python {
    private knownEnvironments: PythonEnvironment[] = [];
    private activeEnvironment: PythonEnvironment | undefined;
    private disposables: vscode.Disposable[] = [];
    public environmentUpdatesSubscription: { refresh: () => void }[] = [];

    constructor(
        private readonly pythonApi: python_extension.PythonExtension,
        disposables: vscode.Disposable[] = []
    ) {
        getGenericLogger().traceInfo(`Python.constructor`);
    }

    public static async new(context: vscode.ExtensionContext): Promise<Python> {
        const pythonApi = await python_extension.PythonExtension.api();
        let disposables: vscode.Disposable[] = [];
        const manager = new Python(pythonApi, disposables);

        const activeEnvironment = await pythonApi.environments.resolveEnvironment(
            await pythonApi.environments.getActiveEnvironmentPath()
        );
        if (activeEnvironment === undefined) {
            await manager.activateBestEnvironment();
        }

        await manager.refresh();

        disposables.push(
            pythonApi.environments.onDidChangeEnvironments(
                async (e: python_extension.EnvironmentsChangeEvent) => {
                    await manager.refresh();
                    manager.environmentUpdatesSubscription.forEach((s) => s.refresh());
                }
            )
        );
        disposables.push(
            pythonApi.environments.onDidChangeActiveEnvironmentPath(
                async (e: python_extension.ActiveEnvironmentPathChangeEvent) => {
                    await manager.refresh();
                    manager.environmentUpdatesSubscription.forEach((s) => s.refresh());
                }
            )
        );

        return manager;
    }

    async activateEnvironment(env: PythonEnvironment) {
        getGenericLogger().traceInfo(`Python.activateEnvironment: ${env.label}`);
        this.pythonApi.environments.updateActiveEnvironmentPath(env.path);
    }

    dispose() {
        getGenericLogger().traceInfo(`Python.dispose`);

        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];
        this.knownEnvironments = [];
        this.activeEnvironment = undefined;
    }

    async refresh() {
        getGenericLogger().traceInfo(`Python.refresh`);

        const activeEnvironment = await this.pythonApi.environments.resolveEnvironment(
            await this.pythonApi.environments.getActiveEnvironmentPath()
        );
        getGenericLogger().traceInfo(
            `Python.refresh: activeEnvironment: ${activeEnvironment?.id}`
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
                        toSemVer(result.stdout.trim()),
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

    async activateBestEnvironment() {
        getGenericLogger().traceInfo(`Python.activateBestEnvironment`);

        const best = this.knownEnvironments.reduceRight((best, env) => {
            if (best === undefined) {
                return env;
            }

            const pyGerber = env.getPyGerber();
            if (pyGerber === undefined) {
                return best;
            }

            const bestPyGerber = best.getPyGerber();
            if (bestPyGerber === undefined) {
                return env;
            }

            if (semver.gte(pyGerber.version, bestPyGerber.version)) {
                return env;
            }
            return best;
        });
        if (this.activeEnvironment !== best) {
            await this.activateEnvironment(best);
        }
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
    ) {
        getGenericLogger().traceInfo(`PythonEnvironment.constructor: ${label}`);
    }

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
        getGenericLogger().traceInfo(`Python.installPyGerber`);

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
        getGenericLogger().traceInfo(`Python.queryPyGerberVersions`);

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
