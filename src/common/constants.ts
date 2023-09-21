import * as path from "path";

const folderName = path.basename(__dirname);

export const EXTENSION_ROOT_DIR =
    folderName === "common"
        ? path.dirname(path.dirname(__dirname))
        : path.dirname(__dirname);

export const BUNDLED_PYTHON_SCRIPTS_DIR = path.join(EXTENSION_ROOT_DIR, "bundled");
