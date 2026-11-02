import { fileURLToPath } from "node:url";

const TITLE_PATTERN =
  /^\[Snyk\] Upgrade (\S+) from (\d+)\.(\d+)\.(\d+) to (\d+)\.(\d+)\.(\d+)$/;

export function bumpType(title) {
  const match = TITLE_PATTERN.exec(title.trim());
  if (!match) return null;
  const from = match.slice(2, 5).map(Number);
  const to = match.slice(5, 8).map(Number);

  const idx = from.findIndex((n, i) => n !== to[i]);
  if (idx === -1 || to[idx] < from[idx]) return null;

  // Below 1.0, a minor bump is breaking under semver caret rules.
  if (idx === 1 && from[0] === 0) return "major";
  return ["major", "minor", "patch"][idx];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(bumpType(process.argv[2] ?? "") ?? "unknown");
}
