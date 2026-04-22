import fs from "node:fs";
import path from "node:path";

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

export function loadSkillsCatalog(skillsDir) {
  const skills = listSkills(skillsDir);
  if (skills.length === 0) return null;

  const rows = skills
    .map(s => `| ${s.name} | ${s.description} |`)
    .join("\n");

  return `# Available Skills

The following skills are available. Use the \`readSkill\` tool to read a skill's full instructions when you need to apply it.

| Skill | Description |
|-------|-------------|
${rows}`;
}
