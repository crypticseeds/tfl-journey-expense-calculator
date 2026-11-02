import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkReactVersions } from "./check-react-versions.mjs";

const makeRoot = (react, reactDom) => {
  const root = mkdtempSync(path.join(tmpdir(), "react-versions-"));
  for (const [name, version] of [
    ["react", react],
    ["react-dom", reactDom],
  ]) {
    const dir = path.join(root, "node_modules", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name, version })
    );
  }
  return root;
};

describe("checkReactVersions", () => {
  it("passes when react and react-dom match", () => {
    expect(checkReactVersions(makeRoot("19.3.1", "19.3.1"))).toEqual({
      ok: true,
      react: "19.3.1",
      reactDom: "19.3.1",
    });
  });

  it("fails when react and react-dom differ", () => {
    expect(checkReactVersions(makeRoot("19.3.1", "19.2.3"))).toEqual({
      ok: false,
      react: "19.3.1",
      reactDom: "19.2.3",
    });
  });
});
