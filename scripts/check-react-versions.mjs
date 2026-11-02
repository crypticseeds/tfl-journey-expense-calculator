import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const readVersion = (rootDir, name) =>
  JSON.parse(
    readFileSync(
      path.join(rootDir, "node_modules", name, "package.json"),
      "utf8"
    )
  ).version;

export function checkReactVersions(rootDir) {
  const react = readVersion(rootDir, "react");
  const reactDom = readVersion(rootDir, "react-dom");
  return { ok: react === reactDom, react, reactDom };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    ".."
  );
  const { ok, react, reactDom } = checkReactVersions(rootDir);
  console.log(`react ${react}\nreact-dom ${reactDom}`);
  if (!ok) {
    console.error("react and react-dom versions must match");
    process.exit(1);
  }
}
