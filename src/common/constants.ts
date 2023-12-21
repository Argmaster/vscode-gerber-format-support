import * as path from "path";

const folderName = path.basename(__dirname);

export const EXTENSION_ROOT_DIR =
    folderName === "common"
        ? path.dirname(path.dirname(__dirname))
        : path.dirname(__dirname);

export const BUNDLED_PYTHON_SCRIPTS_DIR = path.join(EXTENSION_ROOT_DIR, "bundled");

export const INSTALLATION_GUIDE_URL =
    "https://github.com/Argmaster/vscode-gerber-format-support/blob/main/INSTALLATION_GUIDE.md";

export const EXTENSION_NAME = "Gerber X3/X2 Format Support";
export const LANGUAGE_SERVER_NAME = "Gerber Language Server";
export const SETTINGS_NAMESPACE = "gerber_x3_x2_format_support";
export const EXTENSION_SETTING_IGNORED_WARNINGS = `${SETTINGS_NAMESPACE}.ignoredWarnings`;
