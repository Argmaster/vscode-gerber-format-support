import {
    Disposable,
    Event,
    EventEmitter,
    extensions,
    Uri,
    WorkspaceFolder,
} from "vscode";
import { executeCommand } from "./utilities";
import { traceError, traceInfo, traceLog } from "./log/logging";
import { ExecOptions } from "child_process";

type Environment = EnvironmentPath & {
    /**
     * Carries details about python executable.
     */
    readonly executable: {
        /**
         * Uri of the python interpreter/executable. Carries `undefined` in case an executable does not belong to
         * the environment.
         */
        readonly uri: Uri | undefined;
        /**
         * Bitness if known at this moment.
         */
        readonly bitness: Bitness | undefined;
        /**
         * Value of `sys.prefix` in sys module if known at this moment.
         */
        readonly sysPrefix: string | undefined;
    };
    /**
     * Carries details if it is an environment, otherwise `undefined` in case of global interpreters and others.
     */
    readonly environment:
        | {
              /**
               * Type of the environment.
               */
              readonly type: EnvironmentType;
              /**
               * Name to the environment if any.
               */
              readonly name: string | undefined;
              /**
               * Uri of the environment folder.
               */
              readonly folderUri: Uri;
              /**
               * Any specific workspace folder this environment is created for.
               */
              readonly workspaceFolder: Uri | undefined;
          }
        | undefined;
    /**
     * Carries Python version information known at this moment.
     */
    readonly version: VersionInfo & {
        /**
         * Value of `sys.version` in sys module if known at this moment.
         */
        readonly sysVersion: string | undefined;
    };
    /**
     * Tools/plugins which created the environment or where it came from. First value in array corresponds
     * to the primary tool which manages the environment, which never changes over time.
     *
     * Array is empty if no tool is responsible for creating/managing the environment. Usually the case for
     * global interpreters.
     */
    readonly tools: readonly EnvironmentTools[];
};

/**
 * Derived form of {@link Environment} where certain properties can no longer be `undefined`. Meant to represent an
 * {@link Environment} with complete information.
 */
export type ResolvedEnvironment = Environment & {
    /**
     * Carries complete details about python executable.
     */
    readonly executable: {
        /**
         * Uri of the python interpreter/executable. Carries `undefined` in case an executable does not belong to
         * the environment.
         */
        readonly uri: Uri | undefined;
        /**
         * Bitness of the environment.
         */
        readonly bitness: Bitness;
        /**
         * Value of `sys.prefix` in sys module.
         */
        readonly sysPrefix: string;
    };
    /**
     * Carries complete Python version information.
     */
    readonly version: ResolvedVersionInfo & {
        /**
         * Value of `sys.version` in sys module if known at this moment.
         */
        readonly sysVersion: string;
    };
};

type EnvironmentsChangeEvent = {
    readonly env: Environment;
    /**
     * * "add": New environment is added.
     * * "remove": Existing environment in the list is removed.
     * * "update": New information found about existing environment.
     */
    readonly type: "add" | "remove" | "update";
};

type ActiveEnvironmentPathChangeEvent = EnvironmentPath & {
    /**
     * Workspace folder the environment changed for.
     */
    readonly resource: WorkspaceFolder | undefined;
};

/**
 * Uri of a file inside a workspace or workspace folder itself.
 */
type Resource = Uri | WorkspaceFolder;

type EnvironmentPath = {
    /**
     * The ID of the environment.
     */
    readonly id: string;
    /**
     * Path to environment folder or path to python executable that uniquely identifies an environment. Environments
     * lacking a python executable are identified by environment folder paths, whereas other envs can be identified
     * using python executable path.
     */
    readonly path: string;
};

/**
 * Tool/plugin where the environment came from. It can be {@link KnownEnvironmentTools} or custom string which
 * was contributed.
 */
type EnvironmentTools = KnownEnvironmentTools | string;
/**
 * Tools or plugins the Python extension currently has built-in support for. Note this list is expected to shrink
 * once tools have their own separate extensions.
 */
type KnownEnvironmentTools =
    | "Conda"
    | "Pipenv"
    | "Poetry"
    | "VirtualEnv"
    | "Venv"
    | "VirtualEnvWrapper"
    | "Pyenv"
    | "Unknown";

/**
 * Type of the environment. It can be {@link KnownEnvironmentTypes} or custom string which was contributed.
 */
type EnvironmentType = KnownEnvironmentTypes | string;
/**
 * Environment types the Python extension is aware of. Note this list is expected to shrink once tools have their
 * own separate extensions, in which case they're expected to provide the type themselves.
 */
type KnownEnvironmentTypes = "VirtualEnvironment" | "Conda" | "Unknown";

/**
 * Carries bitness for an environment.
 */
type Bitness = "64-bit" | "32-bit" | "Unknown";

/**
 * The possible Python release levels.
 */
type PythonReleaseLevel = "alpha" | "beta" | "candidate" | "final";

/**
 * Release information for a Python version.
 */
type PythonVersionRelease = {
    readonly level: PythonReleaseLevel;
    readonly serial: number;
};

type VersionInfo = {
    readonly major: number | undefined;
    readonly minor: number | undefined;
    readonly micro: number | undefined;
    readonly release: PythonVersionRelease | undefined;
};

type ResolvedVersionInfo = {
    readonly major: number;
    readonly minor: number;
    readonly micro: number;
    readonly release: PythonVersionRelease;
};

interface IKnown {
    internal: ResolvedEnvironment;
}

export interface IExtensionApi {
    ready: Promise<void>;
    debug: {
        getRemoteLauncherCommand(
            host: string,
            port: number,
            waitUntilDebuggerAttaches: boolean
        ): Promise<string[]>;
        getDebuggerPackagePath(): Promise<string | undefined>;
    };
    environments: {
        getActiveEnvironmentPath(resource?: Resource): EnvironmentPath;
        resolveEnvironment(
            environment: Environment | EnvironmentPath | string
        ): Promise<ResolvedEnvironment | undefined>;
        readonly onDidChangeActiveEnvironmentPath: Event<ActiveEnvironmentPathChangeEvent>;
        readonly known: IKnown[];
    };
}

export interface IInterpreterDetails {
    path?: string[];
    resource?: Uri;
}

const onDidChangePythonInterpreterEvent = new EventEmitter<IInterpreterDetails>();
export const onDidChangePythonInterpreter: Event<IInterpreterDetails> =
    onDidChangePythonInterpreterEvent.event;

async function activateExtension(name: string) {
    const extension = extensions.getExtension(name);
    if (extension) {
        if (!extension.isActive) {
            await extension.activate();
        }
    }
    return extension;
}

export async function getPythonExtensionAPI(): Promise<IExtensionApi | undefined> {
    const extension = await activateExtension("ms-python.python");
    return extension?.exports as IExtensionApi;
}

export async function initializePython(disposables: Disposable[]): Promise<void> {
    try {
        const api = await getPythonExtensionAPI();

        if (api) {
            disposables.push(
                api.environments.onDidChangeActiveEnvironmentPath((e) => {
                    onDidChangePythonInterpreterEvent.fire({
                        path: [e.path],
                        resource: e.resource?.uri,
                    });
                })
            );

            traceLog("Waiting for interpreter from python extension.");
            onDidChangePythonInterpreterEvent.fire(await getInterpreterDetails());
        }
    } catch (error) {
        traceError("Error initializing python: ", error);
    }
}

export async function resolveInterpreter(
    interpreter: string
): Promise<ResolvedEnvironment | undefined> {
    const api = await getPythonExtensionAPI();
    return api?.environments.resolveEnvironment(interpreter);
}

export async function getInterpreterDetails(
    resource?: Uri
): Promise<IInterpreterDetails> {
    const api = await getPythonExtensionAPI();
    const environment = await api?.environments.resolveEnvironment(
        api?.environments.getActiveEnvironmentPath(resource)
    );
    if (environment?.executable.uri && checkVersion(environment)) {
        return { path: [environment?.executable.uri.fsPath], resource };
    }
    return { path: undefined, resource };
}

export function checkVersion(resolved: ResolvedEnvironment | undefined): boolean {
    const version = resolved?.version;
    if (version?.major === 3 && version?.minor >= 8) {
        return true;
    }
    traceError(`Python version ${version?.major}.${version?.minor} is not supported.`);
    traceError(`Selected python path: ${resolved?.executable.uri?.fsPath}`);
    traceError("Supported versions are 3.8 and above.");
    return false;
}

class Version {
    private major: number;
    private minor: number;
    private patch: number;

    constructor(major: number, minor: number, patch: number) {
        this.major = major;
        this.minor = minor;
        this.patch = patch;
    }
    public static fromString(versionString: string): Version {
        const regex = /.*?(\d+)\.(\d+)\.(\d+)/;
        const match = versionString.match(regex);

        if (!match) {
            throw new Error("Invalid version string");
        }

        const [, major, minor, patch] = match.map(Number);
        return new Version(major, minor, patch);
    }
    public toString(sep: string = "."): string {
        return `${this.major}${sep}${this.minor}${sep}${this.patch}`;
    }
}

export class PythonEnvironment {
    private pythonID: string;
    private executablePath: string;
    private pythonVersion: Version;
    private isActive: boolean;
    private isCustom: boolean;
    private customPythonPath: string | undefined;
    private hasPyGerberLanguageServer: boolean;
    private pyGerberVersion: Version | undefined;

    constructor(
        pythonID: string,
        interpreterPath: string,
        pythonVersion: Version,
        isActive: boolean,
        isCustom: boolean,
        hasPyGerberLanguageServer: boolean,
        pyGerberVersion: Version | undefined,
        customPythonPath: string | undefined = undefined
    ) {
        this.pythonID = pythonID;
        this.executablePath = interpreterPath;
        this.pythonVersion = pythonVersion;
        this.isActive = isActive;
        this.isCustom = isCustom;
        this.customPythonPath = undefined;
        this.hasPyGerberLanguageServer = hasPyGerberLanguageServer;
        this.pyGerberVersion = pyGerberVersion;
        this.customPythonPath = customPythonPath;
    }

    static async fromResolvedEnvironment(
        resolvedEnvironment: ResolvedEnvironment,
        isActive: boolean = false,
        isCustom: boolean = false
    ): Promise<PythonEnvironment> {
        const isPyGerberLanguageServerAvailable =
            await PythonEnvironment.resolvePyGerberLanguageServerAvailable(
                resolvedEnvironment.path
            );
        const pyGerberVersion = isPyGerberLanguageServerAvailable
            ? await PythonEnvironment.resolvePyGerberVersion(resolvedEnvironment.path)
            : undefined;

        return new PythonEnvironment(
            resolvedEnvironment.id,
            resolvedEnvironment.path,
            new Version(
                resolvedEnvironment.version.major ?? 0,
                resolvedEnvironment.version.minor ?? 0,
                resolvedEnvironment.version.micro ?? 0
            ),
            isActive,
            isCustom,
            isPyGerberLanguageServerAvailable,
            pyGerberVersion
        );
    }

    static async fromPythonEnvironment(
        environment: PythonEnvironment,
        extensionPyGerberStoragePath: string
    ): Promise<PythonEnvironment> {
        const customEnvironment = {
            ...process.env,
            PYTHONPATH: extensionPyGerberStoragePath, // eslint-disable-line @typescript-eslint/naming-convention
        };
        const isPyGerberLanguageServerAvailable =
            await PythonEnvironment.resolvePyGerberLanguageServerAvailable(
                environment.executablePath,
                {
                    env: customEnvironment,
                }
            );
        const pyGerberVersion = isPyGerberLanguageServerAvailable
            ? await PythonEnvironment.resolvePyGerberVersion(
                  environment.executablePath,
                  {
                      env: customEnvironment,
                  }
              )
            : undefined;

        return new PythonEnvironment(
            environment.pythonID,
            environment.executablePath,
            environment.pythonVersion,
            environment.isActive,
            environment.isCustom,
            isPyGerberLanguageServerAvailable,
            pyGerberVersion,
            extensionPyGerberStoragePath
        );
    }

    static async resolvePyGerberLanguageServerAvailable(
        executablePath: string,
        options: ExecOptions = {}
    ): Promise<boolean> {
        try {
            {
                const { code, stdout, stderr } = await executeCommand(
                    [
                        executablePath,
                        "-m",
                        "pygerber",
                        "is-language-server-available",
                    ].join(" "),
                    options
                );
                const fullOutput = `${stdout} ${stderr}`;
                const languageServerAvailable =
                    code === 0 && fullOutput.includes("Language server is available.");
                if (!languageServerAvailable) {
                    return false;
                }
            }
            {
                const { code, stdout, stderr } = await executeCommand(
                    [executablePath, "-m", "pip", "show", "pygls"].join(" "),
                    options
                );
                const fullOutput = `${stdout} ${stderr}`;

                if (code !== 0 || fullOutput.includes("Package(s) not found: pygls")) {
                    return false;
                }
            }
            return true;
        } catch {
            return false;
        }
    }

    private static async resolvePyGerberVersion(
        executablePath: string,
        options: ExecOptions = {}
    ): Promise<Version | undefined> {
        const { code, stdout, stderr } = await executeCommand(
            [executablePath, "-m", "pygerber", "--version"].join(" "),
            options
        );
        if (code === 0) {
            return Version.fromString(stdout);
        }
    }

    getPythonID(): string {
        return this.pythonID;
    }

    getExecutablePath(): string {
        return this.executablePath;
    }

    getPythonVersion(): Version {
        return this.pythonVersion;
    }

    getIsActive(): boolean {
        return this.isActive;
    }

    getIsCustom(): boolean {
        return this.isCustom;
    }

    getPyGerberVersion(): Version | undefined {
        return this.pyGerberVersion;
    }

    isPyGerberLanguageServerAvailable(): boolean {
        return this.hasPyGerberLanguageServer;
    }

    getCustomPythonPath() {
        return this.customPythonPath;
    }

    getPythonEnvironment() {
        const customPythonPath = this.getCustomPythonPath();
        let customEnvironment = {
            ...process.env,
        };
        if (customPythonPath !== undefined) {
            customEnvironment.PYTHONPATH = this.getCustomPythonPath();
        }
        return customEnvironment;
    }

    async executePythonCommand(cmd: string) {
        return await executeCommand([this.getExecutablePath(), cmd].join(" "), {
            env: this.getPythonEnvironment(),
        });
    }
}
