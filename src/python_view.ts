import * as vscode from "vscode";
import { Python, PythonEnvironment } from "./python";
import { COMMAND_LOGGER_NAME, getGenericLogger } from "./logging";
import { ExtensionState } from "./extension";

interface HasPythonEnvironment {
    environment: PythonEnvironment;
}

export class PythonTreeView implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<
        vscode.TreeItem | undefined | void
    > = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();

    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | void> =
        this._onDidChangeTreeData.event;

    constructor(private readonly python: Python) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
        getGenericLogger()?.traceInfo("PythonTreeView refreshed");
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        if (element === undefined) {
            let items: PythonEnvironmentItem[] = [];

            for (const env of await this.python.getEnvironments()) {
                items.push(new PythonEnvironmentItem(this.python, env));
            }

            return items;
        }
        return (element as GetChildrenItem).getChildren();
    }
}

interface GetChildrenItem {
    getChildren(): Promise<vscode.TreeItem[]>;
}

export class PythonEnvironmentItem extends vscode.TreeItem implements GetChildrenItem {
    contextValue = "PythonEnvironmentItem";
    iconPath = new vscode.ThemeIcon("symbol-constructor");

    constructor(
        public readonly python: Python,
        public readonly environment: PythonEnvironment
    ) {
        super(
            `Python ${environment.version.raw}`,
            vscode.TreeItemCollapsibleState.Expanded
        );
        this.description = environment.isActive ? "(Active)" : "";
    }

    async getChildren(): Promise<vscode.TreeItem[]> {
        const hasLS = await this.environment.hasLanguageServer();
        const pygerber = this.environment.getPyGerber();
        return [
            new PythonEnvironmentPropertyItem(
                this.environment,
                "Environment",
                this.environment.path,
                new vscode.ThemeIcon("symbol-folder")
            ),
            new PythonEnvironmentPropertyItem(
                this.environment,
                "Executable",
                this.environment.executableUri.fsPath,
                new vscode.ThemeIcon("snake")
            ),
            new PythonEnvironmentPropertyItem(
                this.environment,
                "Version",
                this.environment.version.raw,
                new vscode.ThemeIcon("versions")
            ),
            new PythonEnvironmentPropertyItem(
                this.environment,
                "PyGerber",

                pygerber !== undefined
                    ? `Installed ${pygerber.version}`
                    : "Not installed",

                this.environment.getPyGerber() !== undefined
                    ? new vscode.ThemeIcon("pass")
                    : new vscode.ThemeIcon("stop")
            ),
            new PythonEnvironmentPropertyItem(
                this.environment,
                "Language Server",
                hasLS && pygerber ? `Installed ${pygerber.version}` : "Not installed",
                hasLS && pygerber
                    ? new vscode.ThemeIcon("pass")
                    : new vscode.ThemeIcon("stop")
            ),
        ];
    }
}
export class PythonEnvironmentPropertyItem extends vscode.TreeItem {
    contextValue = "PythonEnvironmentPropertyItem";

    constructor(
        public readonly environment: PythonEnvironment,
        public readonly label: string,
        public readonly description: string,
        public readonly iconPath: vscode.ThemeIcon
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
    }
}

export async function registerPythonViewCommands(context: ExtensionState) {
    vscode.commands.registerCommand(
        "gerber_x3_x2_format_support.installPyGerber",
        async (node: HasPythonEnvironment) => {
            const activeEnvironment = node.environment;
            const versions = await activeEnvironment.queryPyGerberVersions();

            const version = await vscode.window.showQuickPick(versions, {
                canPickMany: false,
            });
            if (version === undefined) {
                return;
            }

            await vscode.window.withProgress(
                {
                    cancellable: false,
                    location: vscode.ProgressLocation.Notification,
                    title: `Installing PyGerber ${version}`,
                },
                async () => {
                    const result = await activeEnvironment.installPyGerber(version);
                    if (!result.isSuccess()) {
                        vscode.window.showErrorMessage(
                            `Failed to install PyGerber (exit code: ${result.exitCode}). See "${COMMAND_LOGGER_NAME}" output for details.`
                        );
                        return;
                    } else {
                        await context.pythonManager.refresh();
                        await context.pythonTreeView.refresh();
                    }
                }
            );
        }
    );
    vscode.commands.registerCommand(
        "gerber_x3_x2_format_support.refreshPythonEnvironments",
        async () => {
            await context.pythonManager.refresh();
            await context.pythonTreeView.refresh();
        }
    );
}
