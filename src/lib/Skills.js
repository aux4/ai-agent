import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---/;

export function parseFrontmatter(content) {
  const match = content.match(FRONTMATTER_REGEX);
  if (!match) return {};

  const meta = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    meta[key] = value;
  }
  return meta;
}

export function listSkills(skillsDir) {
  if (!skillsDir) return [];

  const resolved = path.resolve(skillsDir);
  if (!fs.existsSync(resolved)) return [];

  const skills = [];
  for (const entry of fs.readdirSync(resolved, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const skillFile = path.join(resolved, entry.name, "SKILL.md");
    if (!fs.existsSync(skillFile)) continue;

    const content = fs.readFileSync(skillFile, { encoding: "utf-8" });
    const meta = parseFrontmatter(content);

    skills.push({
      name: meta.name || entry.name,
      description: meta.description || "",
      dir: entry.name
    });
  }

  return skills;
}

// Skills installed as aux4 packages are commands, not files, so they never appear in the
// skills directory. Without them the catalog is silently partial: the agent is told about the
// skills on disk and left to discover the installed ones by accident, which it does not do --
// a model that had a browser skill available still invented flags until the skill was pasted
// into its prompt by hand.
//
// `aux4 ai skill list` prints one skill per line as "<name>  -  <description>". It is absent
// when aux4/ai-skill is not installed, which is not an error: there are simply none.
export function listInstalledSkills() {
  let output;
  try {
    output = execFileSync("aux4", ["ai", "skill", "list"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10000
    });
  } catch {
    return [];
  }

  const skills = [];
  for (const line of output.split("\n")) {
    const match = line.replace(/\x1b\[[0-9;]*m/g, "").match(/^(\S+)\s+-\s+(.+)$/);
    if (match) {
      skills.push({ name: match[1], description: match[2].trim() });
    }
  }
  return skills;
}

// Installed aux4 skills are NOT advertised here. Injecting them told every agent to check for a
// skill "before running anything else", which derailed single-command tasks -- a browser task
// went looking for the web skill instead of the command. Discovery belongs to the `aux4Skill`
// tool, which only the agents that want it bind.
export function loadSkillsCatalog(skillsDir) {
  const skills = listSkills(skillsDir);
  const installed = [];
  if (skills.length === 0 && installed.length === 0) return null;

  const sections = [];

  if (skills.length > 0) {
    sections.push(`The following skills are available. Use the \`readSkill\` tool to read a skill's full instructions when you need to apply it.

| Skill | Description |
|-------|-------------|
${skills.map(s => `| ${s.name} | ${s.description} |`).join("\n")}`);
  }

  if (installed.length > 0) {
    sections.push(`These skills are installed as aux4 commands.

**If one of them covers the task you were given, read it before running anything else:** \`executeAux4("aux4 ai skill <name> prompt")\`. A skill is a tested method for that kind of work — which commands to use, in what order, and what state to carry between them. Reading the command help instead tells you what the flags are but not how the steps fit together, which is how a sequence ends up invented rather than followed.

| Skill | Description |
|-------|-------------|
${installed.map(s => `| ${s.name} | ${s.description} |`).join("\n")}`);
  }

  return `# Available Skills\n\n${sections.join("\n\n")}`;
}
