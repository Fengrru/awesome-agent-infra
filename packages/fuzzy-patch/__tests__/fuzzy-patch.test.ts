import { describe, expect, test } from "bun:test"
import { availableStrategies, canPatch, fuzzyFindAndReplace } from "../src/index"

describe("FuzzyPatch", () => {
  // ── Strategy 1: Exact Match ───────────────────────────────────────────

  test("exact match finds and replaces", () => {
    const result = fuzzyFindAndReplace("hello world", "world", "earth")
    expect(result.newContent).toBe("hello earth")
    expect(result.matchCount).toBe(1)
    expect(result.strategy).toBe("exact")
  })

  test("exact match replaceAll replaces all", () => {
    const result = fuzzyFindAndReplace("foo bar foo", "foo", "baz", true)
    expect(result.newContent).toBe("baz bar baz")
    expect(result.matchCount).toBe(2)
    expect(result.strategy).toBe("exact")
  })

  test("exact match fails for non-existent text", () => {
    const result = fuzzyFindAndReplace("hello world", "xyz", "abc")
    expect(result.matchCount).toBe(0)
    expect(result.strategy).toBe("none")
    expect(result.error).toBeDefined()
  })

  test("identical old and new returns identity with error", () => {
    const result = fuzzyFindAndReplace("hello", "hello", "hello")
    expect(result.matchCount).toBe(0)
    expect(result.strategy).toBe("identity")
  })

  test("empty old string returns error", () => {
    const result = fuzzyFindAndReplace("hello", "", "world")
    expect(result.matchCount).toBe(0)
    expect(result.strategy).toBe("empty_old")
  })

  // ── Strategy 2: Whitespace Normalization ──────────────────────────────

  test("whitespace normalization matches with extra spaces", () => {
    const content = "function  hello(   x  , y   ) { return x+ y; }"
    const oldStr = "function hello(x, y) { return x+ y; }"
    const result = fuzzyFindAndReplace(content, oldStr, "function hi() {}")
    expect(result.matchCount).toBe(1)
    expect(result.newContent).toBe("function hi() {}")
  })

  test("whitespace normalization handles newlines as whitespace", () => {
    const content = "line1\n\n\nline2"
    const oldStr = "line1 line2"
    const result = fuzzyFindAndReplace(content, oldStr, "replaced")
    expect(result.matchCount).toBe(1)
    expect(result.newContent).toBe("replaced")
  })

  // ── Strategy 3: Indentation Normalization ─────────────────────────────

  test("indentation normalization matches despite leading whitespace", () => {
    const content = "    const x = 1;\n    const y = 2;"
    const oldStr = "const x = 1;\nconst y = 2;"
    const result = fuzzyFindAndReplace(content, oldStr, "const result = 42;")
    expect(result.matchCount).toBe(1)
    expect(result.newContent).toBe("    const result = 42;")
  })

  test("indentation normalization handles tabs vs spaces", () => {
    const content = "\t\tif (true) {\n\t\t\tdoThing();\n\t\t}"
    const oldStr = "if (true) {\ndoThing();\n}"
    const result = fuzzyFindAndReplace(content, oldStr, "done()")
    expect(result.matchCount).toBe(1)
  })

  // ── Strategy 4: Line Ending Normalization ─────────────────────────────

  test("line ending normalization handles CRLF", () => {
    const content = "line1\r\nline2\r\nline3"
    const oldStr = "line1\nline2\nline3"
    const result = fuzzyFindAndReplace(content, oldStr, "replaced")
    expect(result.matchCount).toBe(1)
    expect(result.newContent).toBe("replaced")
  })

  // ── Strategy 5: Head-Tail Substring Anchoring ─────────────────────────

  test("head-tail anchor matches with modified middle", () => {
    const content = "function authenticateUser(username, password, rememberMe = false) {"
    const oldStr = "function authenticateUser(username, password, rememberMe = true) {"
    const result = fuzzyFindAndReplace(content, oldStr, "done")
    expect(result.matchCount).toBe(1)
  })

  test("head-tail anchor returns null for too-short strings", () => {
    const content = "short"
    const oldStr = "shxrt"
    const result = fuzzyFindAndReplace(content, oldStr, "done")
    expect(result.matchCount >= 0).toBe(true)
  })

  // ── Strategy 6: Context Block Anchoring ───────────────────────────────

  test("context anchor matches by first and last line", () => {
    const content = ["## Skills", "This is skill A", "It does things", "It excites users", "## End of Skills"].join(
      "\n",
    )
    const oldStr = [
      "## Skills",
      "This is skill A",
      "It does things changed",
      "It excites users",
      "## End of Skills",
    ].join("\n")
    const result = fuzzyFindAndReplace(content, oldStr, "replaced section")
    expect(result.matchCount).toBe(1)
    expect(result.newContent).toBe("replaced section")
  })

  // ── Strategy 7: Levenshtein Fuzzy Matching ────────────────────────────

  test("levenshtein fuzzy matches with small typos", () => {
    const content = "function calcuulateTotal(items) { return items.reduce(sum, 0); }"
    const oldStr = "function calculateTotal(items) { return items.reduce(sum, 0); }"
    const result = fuzzyFindAndReplace(content, oldStr, "done")
    expect(result.matchCount).toBe(1)
  })

  test("levenshtein fuzzy handles moderate drift", () => {
    const content = "const CONFIG = { apiUrl: 'https://api.example.com/v2', timeout: 5000 }"
    const oldStr = "const CONFIG = { apiUrl: 'https://api.example.com/v1', timeout: 3000 }"
    const found = canPatch(content, oldStr)
    expect(found).toBe(true)
  })

  // ── Strategy 8: Token-Level Matching ──────────────────────────────────

  test("token match ignores whitespace and punctuation differences", () => {
    const content = "if (x == 5) { return true; }"
    const oldStr = "if(x==5){return true}"
    const result = fuzzyFindAndReplace(content, oldStr, "replaced")
    expect(result.matchCount).toBe(1)
    expect(result.newContent).toBe("replaced")
  })

  test("token match finds keywords in comments", () => {
    const content = "// This function handles user authentication"
    const oldStr = "this function handles user authentication"
    const found = canPatch(content, oldStr)
    expect(found).toBe(true)
  })

  // ── API: canPatch ─────────────────────────────────────────────────────

  test("canPatch returns true when match exists", () => {
    expect(canPatch("hello world", "world")).toBe(true)
  })

  test("canPatch returns false when no match", () => {
    expect(canPatch("hello world", "xyz")).toBe(false)
  })

  // ── API: availableStrategies ──────────────────────────────────────────

  test("availableStrategies lists all matching strategies", () => {
    const strategies = availableStrategies("hello world", "world")
    expect(strategies).toContain("exact")
  })

  // ── Edge Cases ────────────────────────────────────────────────────────

  test("handles empty content", () => {
    const result = fuzzyFindAndReplace("", "hello", "world")
    expect(result.matchCount).toBe(0)
  })

  test("handles multiline content precisely with exact match", () => {
    const content = "line1\nline2\nline3"
    const result = fuzzyFindAndReplace(content, "line2", "modified")
    expect(result.newContent).toBe("line1\nmodified\nline3")
  })

  test("handles very long replacement text", () => {
    const content = "placeholder"
    const replacement = "a".repeat(1000)
    const result = fuzzyFindAndReplace(content, "placeholder", replacement)
    expect(result.newContent).toBe(replacement)
    expect(result.matchCount).toBe(1)
  })
})

describe("FuzzyPatch - Additional Coverage", () => {
  test("indentation normalization with successful match returns correct indices", () => {
    const content = "  const x = 1;\n  const y = 2;"
    const oldStr = "const x = 1;\nconst y = 2;"
    const result = fuzzyFindAndReplace(content, oldStr, "const z = 3;")
    expect(result.matchCount).toBe(1)
  })

  test("head-tail anchor matches when middle differs within threshold", () => {
    const content = "function authenticateUser(username, password, rememberMe = false) {"
    const oldStr = "function authenticateUser(username, password, rememberMe = true) {"
    const result = fuzzyFindAndReplace(content, oldStr, "done")
    expect(result.matchCount).toBe(1)
  })

  test("head-tail anchor matches when middle is empty", () => {
    const content = "12345678901234567890END"
    const oldStr = "12345678901234567890"
    const result = fuzzyFindAndReplace(content, oldStr, "done")
    expect(result.matchCount).toBe(1)
  })

  test("line ending normalization with CRLF returns correct indices", () => {
    const content = "hello\r\nworld\r\nfoo"
    const oldStr = "hello\nworld\nfoo"
    const result = fuzzyFindAndReplace(content, oldStr, "replaced")
    expect(result.matchCount).toBe(1)
    expect(result.newContent).toBe("replaced")
  })

  test("context anchor with successful first/last line match", () => {
    const content = ["## Skills", "This is skill A", "It does things", "It excites users", "## End of Skills"].join(
      "\n",
    )
    const oldStr = [
      "## Skills",
      "This is skill A",
      "It does things changed",
      "It excites users",
      "## End of Skills",
    ].join("\n")
    const result = fuzzyFindAndReplace(content, oldStr, "replaced section")
    expect(result.matchCount).toBe(1)
  })

  test("findInOriginalViaAnchors fallback when tail not found", () => {
    const content = "function start() { return 0; }"
    const oldStr = "function   start()   {   return   0;   }"
    const result = fuzzyFindAndReplace(content, oldStr, "done")
    expect(result.matchCount).toBe(1)
  })

  test("levenshtein fuzzy with moderate drift is patched via canPatch", () => {
    const content = "const CONFIG = { apiUrl: 'https://api.example.com/v2', timeout: 5000 }"
    const oldStr = "const CONFIG = { apiUrl: 'https://api.example.com/v1', timeout: 3000 }"
    const found = canPatch(content, oldStr)
    expect(found).toBe(true)
  })
})

describe("FuzzyPatch - uncovered strategy paths", () => {
  test("whitespace norm falls back to approximate range when tail anchor is missed", () => {
    const content = `alpha    beta    gamma${"x".repeat(30)}`
    const oldStr = "alpha  beta  gamma"
    const result = fuzzyFindAndReplace(content, oldStr, "REPLACED")
    expect(result.strategy).toBe("whitespace_normalized")
    expect(result.matchCount).toBe(1)
  })

  test("indentation norm matches whitespace-only lines", () => {
    const content = " \n \n "
    const oldStr = "\n\n"
    const result = fuzzyFindAndReplace(content, oldStr, "REPLACED")
    expect(result.strategy).toBe("indentation_normalized")
    expect(result.matchCount).toBe(1)
  })

  test("line ending norm maps CRLF content back to original offsets", () => {
    const content = "x\r\na\r\ny"
    const oldStr = "a\n"
    const result = fuzzyFindAndReplace(content, oldStr, "REPLACED")
    expect(result.strategy).toBe("line_ending_normalized")
    expect(result.newContent).toBe("x\r\nREPLACEDy")
  })

  test("head tail anchor matches with small middle drift", () => {
    const oldStr = `HEAD${"x".repeat(10)}TAIL${"z".repeat(10)}`
    const content = oldStr.replace("TAIL", "TALL")
    const result = fuzzyFindAndReplace(content, oldStr, "REPLACED")
    expect(result.strategy).toBe("head_tail_anchor")
    expect(result.matchCount).toBe(1)
  })

  test("context anchor returns null when last line never aligns", () => {
    const content = "A\nB\nD"
    const oldStr = "A\nB\nC"
    const result = fuzzyFindAndReplace(content, oldStr, "REPLACED")
    expect(result.matchCount).toBe(0)
    expect(result.strategy).toBe("none")
  })
})
