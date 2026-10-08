import { describe, expect, it } from "vitest";
import {
  buildSparseVector,
  fnv1a,
  tokenize,
} from "./sparse-tf.js";

describe("tokenize", () => {
  it("keeps a date intact (not split into 1998/01/20)", () => {
    const tokens = tokenize("Aniversário: 1998-01-20");
    expect(tokens).toContain("1998-01-20");
    expect(tokens).not.toContain("1998");
    expect(tokens).not.toContain("01");
    expect(tokens).not.toContain("20");
    expect(tokens).toEqual(["aniversario", "1998-01-20"]);
  });

  it("keeps a phone intact and strips separators from it", () => {
    const tokens = tokenize("Telefone: +55 11 96646-8234");
    expect(tokens).toContain("+5511966468234");
    expect(tokens).toEqual(["telefone", "+5511966468234"]);
  });

  it("splits an id like ZX-4471 into the word and the number", () => {
    const tokens = tokenize("Código: ZX-4471");
    expect(tokens).toContain("zx");
    expect(tokens).toContain("4471");
    expect(tokens).toEqual(["codigo", "zx", "4471"]);
  });

  it("strips accents and lowercases", () => {
    expect(tokenize("café")).toEqual(["cafe"]);
    expect(tokenize("AÇÃO")).toEqual(["acao"]);
  });

  it("keeps dotted/dashed numbers intact", () => {
    expect(tokenize("versão 1.2.3 e 3.14")).toEqual([
      "versao",
      "1.2.3",
      "e",
      "3.14",
    ]);
  });

  it("treats non-matching characters as separators", () => {
    expect(tokenize("a-b/c:d_e")).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("returns [] for empty or whitespace-only text", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize(" \n\t ")).toEqual([]);
  });
});

describe("fnv1a", () => {
  it("matches the known FNV-1a 32-bit reference vectors", () => {
    expect(fnv1a("")).toBe(0x811c9dc5 >>> 0);
    expect(fnv1a("a")).toBe(0xe40c292c);
    expect(fnv1a("foobar")).toBe(0xbf9cf968);
  });

  it("is deterministic and returns unsigned 32-bit values", () => {
    expect(fnv1a("1998-01-20")).toBe(fnv1a("1998-01-20"));
    expect(fnv1a("+5511966468234")).toBe(fnv1a("+5511966468234"));
    for (const value of [fnv1a("x"), fnv1a("1998-01-20"), fnv1a("cafe")]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe("buildSparseVector", () => {
  it("is deterministic: same text yields identical vectors", () => {
    const text = "Aniversário: 1998-01-20\nTelefone: +55 11 96646-8234";
    expect(buildSparseVector(text)).toEqual(buildSparseVector(text));
  });

  it("returns [] for empty or whitespace-only text", () => {
    expect(buildSparseVector("")).toEqual([]);
    expect(buildSparseVector("   \n  ")).toEqual([]);
  });

  it("weights a term by 1 + log(count) and includes bigrams for consecutive pairs", () => {
    const tokens = tokenize("Código: ZX-4471");
    expect(tokens).toEqual(["codigo", "zx", "4471"]);

    const vector = buildSparseVector("Código: ZX-4471");
    const byIndex = new Map(vector.map((entry) => [entry.index, entry.value]));

    // Unigrams appear once: weight 1 + log(1) = 1.
    expect(byIndex.get(fnv1a("zx"))).toBeCloseTo(1, 10);
    expect(byIndex.get(fnv1a("4471"))).toBeCloseTo(1, 10);
    expect(byIndex.get(fnv1a("codigo"))).toBeCloseTo(1, 10);

    // Bigrams of consecutive pairs are present.
    expect(byIndex.get(fnv1a("codigo zx"))).toBeCloseTo(1, 10);
    expect(byIndex.get(fnv1a("zx 4471"))).toBeCloseTo(1, 10);
    // Non-consecutive pairs are NOT bigrams.
    expect(byIndex.get(fnv1a("codigo 4471"))).toBeUndefined();
  });

  it("weights a repeated term by 1 + log(n)", () => {
    const vector = buildSparseVector("foo foo foo");
    const byIndex = new Map(vector.map((entry) => [entry.index, entry.value]));

    // "foo" 3x → 1 + log(3); bigram "foo foo" 2x → 1 + log(2).
    expect(byIndex.get(fnv1a("foo"))).toBeCloseTo(1 + Math.log(3), 10);
    expect(byIndex.get(fnv1a("foo foo"))).toBeCloseTo(1 + Math.log(2), 10);
  });

  it("is sorted by index and has only positive values", () => {
    const vector = buildSparseVector(
      "Código: ZX-4471\nAniversário: 1998-01-20\nTelefone: +55 11 96646-8234",
    );
    expect(vector.length).toBeGreaterThan(0);
    for (let i = 1; i < vector.length; i += 1) {
      expect(vector[i].index).toBeGreaterThan(vector[i - 1].index);
    }
    for (const entry of vector) {
      expect(entry.value).toBeGreaterThan(0);
    }
  });

  it("includes the report cases end-to-end", () => {
    const byIndex = (text: string): Map<number, number> =>
      new Map(buildSparseVector(text).map((e) => [e.index, e.value]));

    expect(byIndex("Aniversário: 1998-01-20").get(fnv1a("1998-01-20"))).toBe(
      1,
    );
    expect(
      byIndex("Telefone: +55 11 96646-8234").get(fnv1a("+5511966468234")),
    ).toBe(1);
    expect(byIndex("café").get(fnv1a("cafe"))).toBe(1);
  });
});
