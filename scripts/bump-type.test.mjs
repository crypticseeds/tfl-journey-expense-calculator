import { describe, expect, it } from "vitest";
import { bumpType } from "./bump-type.mjs";

const title = (pkg, from, to) => `[Snyk] Upgrade ${pkg} from ${from} to ${to}`;

describe("bumpType", () => {
  it("classifies a minor bump", () => {
    expect(bumpType(title("express", "4.21.2", "4.22.1"))).toBe("minor");
  });

  it("classifies a patch bump", () => {
    expect(bumpType(title("react", "19.2.0", "19.2.1"))).toBe("patch");
  });

  it("classifies a major bump on a scoped package", () => {
    expect(bumpType(title("@langfuse/otel", "4.4.2", "5.0.0"))).toBe("major");
  });

  it("unparseable title is not auto-merged", () => {
    expect(bumpType("[Snyk] Security upgrade multiple packages")).toBeNull();
  });

  it("returns null for a prerelease target", () => {
    expect(bumpType(title("foo", "1.0.0", "1.1.0-beta.1"))).toBeNull();
  });

  it("returns null for a downgrade", () => {
    expect(bumpType(title("foo", "2.0.0", "1.9.9"))).toBeNull();
  });

  it("returns null for equal versions", () => {
    expect(bumpType(title("foo", "1.2.3", "1.2.3"))).toBeNull();
  });

  it("treats a minor bump below 1.0 as major", () => {
    expect(bumpType(title("foo", "0.208.0", "0.300.0"))).toBe("major");
  });

  it("treats a patch bump below 1.0 as patch", () => {
    expect(bumpType(title("foo", "0.208.0", "0.208.1"))).toBe("patch");
  });
});
