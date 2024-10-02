import * as vscode from "vscode";
import { Python, PythonEnvironment } from "./python";
import { getGenericLogger } from "./logging";

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
                items.push(new PythonEnvironmentItem(env));
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
    constructor(public readonly environment: PythonEnvironment) {
        super(
            `Python ${environment.version.raw}`,
            vscode.TreeItemCollapsibleState.Expanded
        );
    }
    iconPath = new vscode.ThemeIcon("symbol-constructor");

    async getChildren(): Promise<vscode.TreeItem[]> {
        const hasLS = await this.environment.hasLanguageServer();
        const pygerber = this.environment.getPyGerber();
        return [
            {
                label: "Environment",
                description: this.environment.path,
                iconPath: new vscode.ThemeIcon("symbol-folder"),
            },
            {
                label: "Executable",
                description: this.environment.executableUri.fsPath,
                iconPath: new vscode.ThemeIcon("snake"),
            },
            {
                label: "Version",
                description: this.environment.version.raw,
                iconPath: new vscode.ThemeIcon("versions"),
            },
            {
                label: "PyGerber",
                description:
                    pygerber !== undefined
                        ? `Installed ${pygerber.version}`
                        : "Not installed",
                iconPath:
                    this.environment.getPyGerber() !== undefined
                        ? new vscode.ThemeIcon("pass")
                        : new vscode.ThemeIcon("stop"),
            },
            {
                label: "Language Server",
                description: hasLS ? "Installed" : "Not installed",
                iconPath: hasLS
                    ? new vscode.ThemeIcon("pass")
                    : new vscode.ThemeIcon("stop"),
            },
        ];
    }
}
