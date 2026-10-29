import { spawnSync } from "node:child_process";

// CLI parser failures happen before an action runs. Surface that command's
// local parameter contract with the original error; never retry the action.
export function parameterHelpArgs(argv, error) {
  if (!/^(?:Error executing command:\s*)?(?:(?:Unknown|Unsupported|Unrecognized|Unexpected) (?:parameter|option|flag)|Missing required parameter|Error to enter the value of)\b/im.test(String(error || ""))) return null;
  const words = [...argv];
  while (words[0] === "aux4") words.shift();
  if (words.includes("--help") || words.includes("-h")) return null;
  const firstFlag = words.findIndex(word => word.startsWith("-"));
  const command = firstFlag < 0 ? words : words.slice(0, firstFlag);
  return command.length ? [...command, "--help"] : null;
}

export function parameterErrorHelp(argv, error, cwd, run = spawnSync) {
  const args = parameterHelpArgs(argv, error);
  if (!args) return "";
  try {
    const result = run("aux4", args, { encoding: "utf8", timeout: 3000, maxBuffer: 256 * 1024, ...(cwd ? { cwd } : {}) });
    if (result.status !== 0 || !result.stdout?.trim()) return "";
    const help = result.stdout.replace(/\x1b\[[0-9;]*m/g, "").trim().slice(0, 2800);
    return `\n\nLocal command parameter reference (--help; no action retried):\n${help}`;
  } catch { return ""; }
}
