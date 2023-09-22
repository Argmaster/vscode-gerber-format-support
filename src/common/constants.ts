import * as path from "path";

const folderName = path.basename(__dirname);

export const EXTENSION_ROOT_DIR =
    folderName === "common"
        ? path.dirname(path.dirname(__dirname))
        : path.dirname(__dirname);

export const BUNDLED_PYTHON_SCRIPTS_DIR = path.join(EXTENSION_ROOT_DIR, "bundled");

export const INSTALLATION_GUIDE_URL =
    "https://github.com/Argmaster/vscode-gerber-format-support/blob/main/INSTALLATION_GUIDE.md";
