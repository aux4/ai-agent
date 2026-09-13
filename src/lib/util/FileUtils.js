import fs, { promises as fsPromises } from "fs";
import path from "path";

export function ensureParentDirectorySync(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

export async function readFile(file) {
  if (!file) {
    return undefined;
  }

  const exists = await fsPromises.access(file).then(() => true).catch(() => false);
  if (!exists) {
    return undefined;
  }

  return await fsPromises.readFile(file, { encoding: "utf8" });
}

export function asJson() {
  return content => {
    if (!content) {
      return undefined;
    }

    try {
      return JSON.parse(content);
    } catch {
      return undefined;
    }
  };
}
