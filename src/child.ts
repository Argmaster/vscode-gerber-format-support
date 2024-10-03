import { spawn } from "child_process";
import { getCommandLogger } from "./logging";

export async function runCommand(
    command: string,
    args: string[] = [],
    options: any = {}
): Promise<Result> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, options);

        let stdout = "";
        let stderr = "";

        // Collect stdout data
        child.stdout.on("data", (data) => {
            stdout += data.toString();
        });

        // Collect stderr data
        child.stderr.on("data", (data) => {
            stderr += data.toString();
        });

        // Handle process exit
        child.on("close", (code) => {
            getCommandLogger().traceInfo(
                `${command} ${args.join(" ")}\n` +
                    `\nexit code: ${code} (${child.exitCode})\n` +
                    `\nstdout: ${stdout}\n` +
                    `\nstderr: ${stderr}`
            );
            resolve(new Result(stdout, stderr, child.exitCode, child.signalCode));
        });

        // Handle errors in spawning
        child.on("error", (err) => {
            reject(err);
        });
    });
}

export class Result {
    constructor(
        public readonly stdout: string,
        public readonly stderr: string,
        public exitCode: number | null,
        public signal: NodeJS.Signals | null
    ) {}

    isSuccess(): boolean {
        return this.exitCode === 0 && this.signal === null;
    }
}
