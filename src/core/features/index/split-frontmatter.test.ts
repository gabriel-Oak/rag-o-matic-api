import { describe, expect, it } from "vitest";
import { splitFrontmatter } from "./split-frontmatter.js";

describe("splitFrontmatter", () => {
  it("returns body intact without frontmatter key when doc has no frontmatter", () => {
    const markdown = "# Title\n\nJust a plain document.\n";
    const result = splitFrontmatter(markdown);
    expect(result).not.toHaveProperty("frontmatter");
    expect(result.body).toBe(markdown);
  });

  it("returns trimmed frontmatter (no delimiters) and correct body when doc has frontmatter", () => {
    const markdown =
      "---\ntitle: My Note\ntags: [rag, api]\n---\n# Heading\n\nBody text.";
    const result = splitFrontmatter(markdown);
    expect(result.frontmatter).toBe("title: My Note\ntags: [rag, api]");
    expect(result.body).toBe("# Heading\n\nBody text.");
  });

  it("keeps body content after the closing delimiter line as-is", () => {
    const markdown = "---\ntitle: x\n---\n\n# Heading";
    const result = splitFrontmatter(markdown);
    expect(result.frontmatter).toBe("title: x");
    expect(result.body).toBe("\n# Heading");
  });

  it("omits frontmatter key and returns content after closing --- when frontmatter is empty", () => {
    const markdown = "---\n---\nrest of the doc";
    const result = splitFrontmatter(markdown);
    expect(result).not.toHaveProperty("frontmatter");
    expect(result.body).toBe("rest of the doc");
  });

  it("omits frontmatter key and returns empty body when doc is only opening and closing delimiters", () => {
    const result = splitFrontmatter("---\n---");
    expect(result).not.toHaveProperty("frontmatter");
    expect(result.body).toBe("");
  });

  it("returns body intact when opening --- has no closing ---", () => {
    const markdown = "---\ntitle: x\nno closing delimiter here";
    const result = splitFrontmatter(markdown);
    expect(result).not.toHaveProperty("frontmatter");
    expect(result.body).toBe(markdown);
  });

  it("returns body intact when doc is only an opening --- without newline", () => {
    const markdown = "---";
    const result = splitFrontmatter(markdown);
    expect(result).not.toHaveProperty("frontmatter");
    expect(result.body).toBe(markdown);
  });

  it("returns body intact when a horizontal rule --- appears mid-doc (doc does not start with ---)", () => {
    const markdown =
      "# Title\n\nSome text.\n\n---\n\nMore text after a rule.";
    const result = splitFrontmatter(markdown);
    expect(result).not.toHaveProperty("frontmatter");
    expect(result.body).toBe(markdown);
  });

  it("treats a line like ---x or ---- as frontmatter content, not as closing delimiter", () => {
    const markdown = "---\ntitle: x\n----\n---\nbody";
    const result = splitFrontmatter(markdown);
    expect(result.frontmatter).toBe("title: x\n----");
    expect(result.body).toBe("body");
  });

  it("detects frontmatter and splits correctly with CRLF line endings", () => {
    const markdown =
      "---\r\ntitle: CRLF Note\r\ntags: [a, b]\r\n---\r\n# Heading\r\n\r\nBody.";
    const result = splitFrontmatter(markdown);
    expect(result.frontmatter).toBe("title: CRLF Note\r\ntags: [a, b]");
    expect(result.body).toBe("# Heading\r\n\r\nBody.");
  });

  it("detects frontmatter and splits correctly with BOM at start of doc", () => {
    const markdown = "\uFEFF---\ntitle: BOM Note\n---\n# Heading\n\nBody.";
    const result = splitFrontmatter(markdown);
    expect(result.frontmatter).toBe("title: BOM Note");
    expect(result.body).toBe("# Heading\n\nBody.");
  });

  it("detects frontmatter with BOM and CRLF combined", () => {
    const markdown = "\uFEFF---\r\ntitle: Both\r\n---\r\nBody.";
    const result = splitFrontmatter(markdown);
    expect(result.frontmatter).toBe("title: Both");
    expect(result.body).toBe("Body.");
  });

  it("keeps BOM in body when doc has BOM but no frontmatter", () => {
    const markdown = "\uFEFF# Plain doc";
    const result = splitFrontmatter(markdown);
    expect(result).not.toHaveProperty("frontmatter");
    expect(result.body).toBe(markdown);
  });
});
