import { beforeAll, describe, expect, mock, test } from "bun:test"
import { extractFromFile, setExtractorDependencies } from "../src/extractor.js"

// ─── mock tree-sitter infrastructure ────────────────────────────────────────
// extractor.ts lazily imports real WASM builds of web-tree-sitter. The real
// packages are not installed (zero-dependency monorepo), so we mock the
// modules and inject fake Parser/Language implementations to exercise the
// full tree-sitter extraction path.

mock.module("web-tree-sitter/tree-sitter.wasm", () => ({ default: new ArrayBuffer(8) }))
mock.module("tree-sitter-typescript/typescript.wasm", () => ({ default: new ArrayBuffer(8) }))
mock.module("tree-sitter-javascript/tree-sitter-javascript.wasm", () => ({ default: new ArrayBuffer(8) }))

interface Def {
  type: string
  text: string
  fields?: Record<string, Def>
  children?: Def[]
}

function countRows(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length - 1
}

class MockNode {
  readonly type: string
  readonly startIndex: number
  readonly endIndex: number
  readonly startPosition: { row: number; column: number }
  readonly endPosition: { row: number; column: number }
  parent: MockNode | null = null
  previousSibling: MockNode | null = null
  private _children: MockNode[] = []
  private _fields = new Map<string, MockNode>()

  constructor(type: string, startIndex: number, endIndex: number, source: string) {
    this.type = type
    this.startIndex = startIndex
    this.endIndex = endIndex
    this.startPosition = { row: countRows(source, startIndex), column: 0 }
    this.endPosition = { row: countRows(source, endIndex), column: 0 }
  }

  get childCount(): number {
    return this._children.length
  }

  get namedChildCount(): number {
    return this._children.length
  }

  child(index: number): MockNode | null {
    return this._children[index] ?? null
  }

  namedChild(index: number): MockNode | null {
    return this._children[index] ?? null
  }

  childForFieldName(name: string): MockNode | null {
    return this._fields.get(name) ?? null
  }

  setChildren(children: MockNode[]): void {
    this._children = children
    for (const c of children) c.parent = this
    for (let i = 1; i < children.length; i++) children[i]!.previousSibling = children[i - 1]!
  }

  setField(name: string, node: MockNode): void {
    this._fields.set(name, node)
  }
}

function build(source: string, def: Def, scopeStart: number, scopeEnd: number): MockNode {
  const rel = source.slice(scopeStart, scopeEnd).indexOf(def.text)
  if (rel === -1) throw new Error(`mock tree: cannot find "${def.text.slice(0, 40)}" in scope`)
  const start = scopeStart + rel
  const end = start + def.text.length
  const node = new MockNode(def.type, start, end, source)
  const children: MockNode[] = []
  for (const [name, fieldDef] of Object.entries(def.fields ?? {})) {
    const child = build(source, fieldDef, start, end)
    node.setField(name, child)
    children.push(child)
  }
  for (const childDef of def.children ?? []) children.push(build(source, childDef, start, end))
  node.setChildren(children)
  return node
}

let currentRoot: MockNode | null = null

class MockParser {
  static init(): void {
    // no-op: the real implementation boots the WASM runtime
  }

  setLanguage(_lang: unknown): void {}

  parse(_source: string): { rootNode: MockNode } {
    if (!currentRoot) throw new Error("no mock tree registered")
    return { rootNode: currentRoot }
  }
}

class MockLanguage {
  static async load(_path: string): Promise<unknown> {
    return {}
  }
}

function registerTree(source: string, root: Def): void {
  currentRoot = build(source, root, 0, source.length)
}

// ─── shared fixture ──────────────────────────────────────────────────────────

const SRC = [
  `import { x } from "./mod"`,
  `import * as ns from "pkg"`,
  `import def from "other"`,
  `/** Doc for greet */`,
  `function greet(name: string): string {`,
  `  format("hi", name)`,
  `  const msg = "hi"`,
  `  return msg`,
  `}`,
  ``,
  `class Greeter {`,
  `  count = 0`,
  `  run() {`,
  `    return this.format("hi", ...args, count = 1)`,
  `  }`,
  `}`,
  ``,
  `interface Shape {`,
  `  area(): number`,
  `}`,
  ``,
  `type Pair<A, B> = [A, B]`,
  ``,
  `enum Color {`,
  `  Red`,
  `}`,
  ``,
  `namespace Util {`,
  `  const MAX = 1`,
  `}`,
  ``,
  `const VERSION = 1`,
  `const { a } = obj`,
  ``,
  `export { greet }`,
  `export default greet`,
  `export * from "./other"`,
].join("\n")

const TREE: Def = {
  type: "program",
  text: SRC,
  children: [
    {
      type: "import_statement",
      text: `import { x } from "./mod"`,
      children: [
        {
          type: "import_clause",
          text: `{ x }`,
          children: [
            {
              type: "named_imports",
              text: `{ x }`,
              children: [{ type: "import_specifier", text: "x" }],
            },
          ],
        },
        { type: "string", text: `"./mod"` },
      ],
    },
    {
      type: "import_statement",
      text: `import * as ns from "pkg"`,
      children: [
        {
          type: "import_clause",
          text: `* as ns`,
          children: [{ type: "namespace_import", text: `* as ns` }],
        },
        { type: "string", text: `"pkg"` },
      ],
    },
    {
      type: "import_statement",
      text: `import def from "other"`,
      children: [
        {
          type: "import_clause",
          text: `def`,
          children: [{ type: "import_default_specifier", text: "def" }],
        },
        { type: "string", text: `"other"` },
      ],
    },
    { type: "comment", text: `/** Doc for greet */` },
    {
      type: "function_declaration",
      text: `function greet(name: string): string {\n  format("hi", name)\n  const msg = "hi"\n  return msg\n}`,
      fields: {
        name: { type: "identifier", text: "greet" },
        parameters: {
          type: "formal_parameters",
          text: `(name: string)`,
          children: [
            {
              type: "required_parameter",
              text: `name: string`,
              fields: {
                name: { type: "identifier", text: "name" },
                type: { type: "type_identifier", text: "string" },
              },
            },
          ],
        },
        return_type: { type: "type_identifier", text: "string" },
        body: {
          type: "statement_block",
          text: `{\n  format("hi", name)\n  const msg = "hi"\n  return msg\n}`,
          children: [
            {
              type: "expression_statement",
              text: `format("hi", name)`,
              children: [
                {
                  type: "call_expression",
                  text: `format("hi", name)`,
                  fields: {
                    function: { type: "identifier", text: "format" },
                    arguments: {
                      type: "arguments",
                      text: `("hi", name)`,
                      children: [
                        { type: "string", text: `"hi"` },
                        { type: "identifier", text: "name" },
                      ],
                    },
                  },
                },
              ],
            },
            {
              type: "lexical_declaration",
              text: `const msg = "hi"`,
              children: [
                {
                  type: "variable_declarator",
                  text: `msg = "hi"`,
                  fields: { name: { type: "identifier", text: "msg" } },
                },
              ],
            },
            {
              type: "return_statement",
              text: `return msg`,
              children: [{ type: "identifier", text: "msg" }],
            },
          ],
        },
      },
    },
    {
      type: "class_declaration",
      text: `class Greeter {\n  count = 0\n  run() {\n    return this.format("hi", ...args, count = 1)\n  }\n}`,
      fields: {
        name: { type: "identifier", text: "Greeter" },
        body: {
          type: "class_body",
          text: `{\n  count = 0\n  run() {\n    return this.format("hi", ...args, count = 1)\n  }\n}`,
          children: [
            {
              type: "public_field_definition",
              text: `count = 0`,
              fields: { name: { type: "property_identifier", text: "count" } },
            },
            {
              type: "method_definition",
              text: `run() {\n    return this.format("hi", ...args, count = 1)\n  }`,
              fields: {
                name: { type: "property_identifier", text: "run" },
                parameters: { type: "formal_parameters", text: `()`, children: [] },
                body: {
                  type: "statement_block",
                  text: `{\n    return this.format("hi", ...args, count = 1)\n  }`,
                  children: [
                    {
                      type: "return_statement",
                      text: `return this.format("hi", ...args, count = 1)`,
                      children: [
                        {
                          type: "call_expression",
                          text: `this.format("hi", ...args, count = 1)`,
                          fields: {
                            function: {
                              type: "member_expression",
                              text: `this.format`,
                              fields: { property: { type: "property_identifier", text: "format" } },
                            },
                            arguments: {
                              type: "arguments",
                              text: `("hi", ...args, count = 1)`,
                              children: [
                                { type: "string", text: `"hi"` },
                                { type: "spread_element", text: `...args` },
                                {
                                  type: "assignment_expression",
                                  text: `count = 1`,
                                  fields: { left: { type: "identifier", text: "count" } },
                                },
                              ],
                            },
                          },
                        },
                      ],
                    },
                  ],
                },
              },
            },
          ],
        },
      },
    },
    {
      type: "interface_declaration",
      text: `interface Shape {\n  area(): number\n}`,
      fields: {
        name: { type: "type_identifier", text: "Shape" },
        body: {
          type: "interface_body",
          text: `{\n  area(): number\n}`,
          children: [
            {
              type: "method_signature",
              text: `area(): number`,
              fields: {
                name: { type: "property_identifier", text: "area" },
                parameters: { type: "formal_parameters", text: `()`, children: [] },
                return_type: { type: "type_identifier", text: "number" },
              },
            },
          ],
        },
      },
    },
    {
      type: "type_alias_declaration",
      text: `type Pair<A, B> = [A, B]`,
      fields: {
        name: { type: "type_identifier", text: "Pair" },
        type_parameters: {
          type: "type_parameters",
          text: `<A, B>`,
          children: [
            {
              type: "type_parameter",
              text: "A",
              fields: { name: { type: "type_identifier", text: "A" } },
            },
            {
              type: "type_parameter",
              text: "B",
              fields: { name: { type: "type_identifier", text: "B" } },
            },
          ],
        },
      },
    },
    {
      type: "enum_declaration",
      text: `enum Color {\n  Red\n}`,
      fields: { name: { type: "identifier", text: "Color" } },
    },
    {
      type: "module_declaration",
      text: `namespace Util {\n  const MAX = 1\n}`,
      fields: { name: { type: "identifier", text: "Util" } },
    },
    {
      type: "lexical_declaration",
      text: `const VERSION = 1`,
      children: [
        {
          type: "variable_declarator",
          text: `VERSION = 1`,
          fields: { name: { type: "identifier", text: "VERSION" } },
        },
      ],
    },
    {
      type: "lexical_declaration",
      text: `const { a } = obj`,
      children: [
        {
          type: "variable_declarator",
          text: `{ a } = obj`,
          fields: { name: { type: "object_destructuring_pattern", text: `{ a }` } },
        },
      ],
    },
    {
      type: "export_statement",
      text: `export { greet }`,
      children: [
        {
          type: "export_clause",
          text: `{ greet }`,
          children: [{ type: "export_specifier", text: "greet" }],
        },
      ],
    },
    {
      type: "export_statement",
      text: `export default greet`,
      children: [{ type: "default", text: "default" }],
    },
    {
      type: "export_statement",
      text: `export * from "./other"`,
      children: [{ type: "wildcard_import", text: `*` }],
    },
  ],
}

const MOCK_TIME = 1_700_000_000_000

// ─── tests ──────────────────────────────────────────────────────────────────

describe("extractFromFile (tree-sitter path)", () => {
  beforeAll(() => {
    setExtractorDependencies({ Parser: MockParser, Language: MockLanguage })
  })

  test("extracts full symbol inventory from a .ts source", async () => {
    registerTree(SRC, TREE)
    const result = await extractFromFile("src/app.ts", SRC, MOCK_TIME, undefined, "cl100k")

    const names = result.symbols.map((s) => `${s.symbolType}:${s.name}`)
    expect(names).toContain("function:greet")
    expect(names).toContain("class:Greeter")
    expect(names).toContain("interface:Shape")
    expect(names).toContain("type:Pair")
    expect(names).toContain("enum:Color")
    expect(names).toContain("namespace:Util")
    expect(names).toContain("variable:VERSION")
    expect(names).toContain("variable:msg")
    expect(names).toContain("variable:count")
    expect(names).toContain("method:run")
    expect(names).toContain("method:area")

    // class children are flattened with parent-qualified ids
    const ids = result.symbols.map((s) => s.id)
    expect(ids).toContain("symbol:class:Greeter.run")
    expect(ids).toContain("symbol:class:Greeter.count")
    expect(ids).toContain("symbol:interface:Shape.area")

    const greet = result.symbols.find((s) => s.name === "greet")!
    expect(greet.filePath).toBe("src/app.ts")
    expect(greet.mtime).toBe(MOCK_TIME)
    expect(greet.tokenizerName).toBe("cl100k")
    expect(greet.metadata).toHaveProperty("docComment", "Doc for greet")
    expect(greet.metadata).toHaveProperty("returnType", "string")
    expect(greet.metadata).toHaveProperty("isAsync", false)
    expect(greet.metadata).toHaveProperty("isExported", false)
    expect(greet.metadata).toHaveProperty("parameters", [{ name: "name", type: "string", optional: false }])
    expect(greet.startLine).toBe(5)

    const pair = result.symbols.find((s) => s.name === "Pair")!
    expect(pair.metadata).toHaveProperty("typeParams", ["A", "B"])

    const area = result.symbols.find((s) => s.name === "area")!
    expect(area.metadata).toHaveProperty("parentId", "symbol:interface:Shape")
    expect(area.metadata).toHaveProperty("returnType", "number")

    expect(result.imports).toEqual([
      { source: "./mod", names: ["x"] },
      { source: "pkg", names: ["*"] },
      { source: "other", names: ["def"] },
    ])
    expect(result.exports).toEqual(["greet", "default", "*"])
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  test("extracts call sites with caller name and argument detail", async () => {
    registerTree(SRC, TREE)
    const result = await extractFromFile("src/app.ts", SRC, MOCK_TIME)

    const greetCall = result.calls.find((c) => c.callerName === "greet")
    expect(greetCall).toBeDefined()
    expect(greetCall!.calleeName).toBe("format")
    expect(greetCall!.argCount).toBe(2)
    expect(greetCall!.hasSpread).toBe(false)
    expect(greetCall!.keywordArgNames).toEqual([])
    expect(greetCall!.startLine).toBeGreaterThan(0)
    expect(greetCall!.endByte).toBeGreaterThan(greetCall!.startByte)

    const runCall = result.calls.find((c) => c.callerName === "run")
    expect(runCall).toBeDefined()
    expect(runCall!.calleeName).toBe("format") // member expression property
    expect(runCall!.argCount).toBe(3)
    expect(runCall!.hasSpread).toBe(true)
    expect(runCall!.keywordArgNames).toEqual(["count"])
  })

  test("destructuring patterns are skipped", async () => {
    registerTree(SRC, TREE)
    const result = await extractFromFile("src/app.ts", SRC, MOCK_TIME)
    expect(result.symbols.some((s) => s.name === "a")).toBe(false)
  })

  test(".js files use the javascript parser", async () => {
    const JS_SRC = `function main() {\n  log("x")\n}\n`
    registerTree(JS_SRC, {
      type: "program",
      text: JS_SRC,
      children: [
        {
          type: "function_declaration",
          text: `function main() {\n  log("x")\n}`,
          fields: {
            name: { type: "identifier", text: "main" },
            parameters: { type: "formal_parameters", text: `()`, children: [] },
            body: {
              type: "statement_block",
              text: `{\n  log("x")\n}`,
              children: [
                {
                  type: "expression_statement",
                  text: `log("x")`,
                  children: [
                    {
                      type: "call_expression",
                      text: `log("x")`,
                      fields: {
                        function: { type: "identifier", text: "log" },
                        arguments: {
                          type: "arguments",
                          text: `("x")`,
                          children: [{ type: "string", text: `"x"` }],
                        },
                      },
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
    })
    const result = await extractFromFile("src/main.js", JS_SRC, MOCK_TIME)

    expect(result.symbols.some((s) => s.symbolType === "function" && s.name === "main")).toBe(true)
    expect(result.calls.some((c) => c.callerName === "main" && c.calleeName === "log")).toBe(true)
  })

  test("call expressions outside functions are ignored", async () => {
    const SRC2 = `format("top")\n`
    registerTree(SRC2, {
      type: "program",
      text: SRC2,
      children: [
        {
          type: "expression_statement",
          text: `format("top")`,
          children: [
            {
              type: "call_expression",
              text: `format("top")`,
              fields: {
                function: { type: "identifier", text: "format" },
                arguments: {
                  type: "arguments",
                  text: `("top")`,
                  children: [{ type: "string", text: `"top"` }],
                },
              },
            },
          ],
        },
      ],
    })
    const result = await extractFromFile("src/x.ts", SRC2, MOCK_TIME)
    expect(result.calls).toEqual([])
  })

  test("abstract classes and visibility modifiers are recorded", async () => {
    const ABS_SRC = [
      `abstract class Base {`,
      `  protected name = "x"`,
      `  static create(): Base {`,
      `    return new Base()`,
      `  }`,
      `  abstract run(): void`,
      `}`,
    ].join("\n")
    registerTree(ABS_SRC, {
      type: "program",
      text: ABS_SRC,
      children: [
        {
          type: "class_declaration",
          text: ABS_SRC.slice(9),
          children: [{ type: "abstract", text: "abstract" }],
          fields: {
            name: { type: "identifier", text: "Base" },
            body: {
              type: "class_body",
              text: ABS_SRC.slice(19),
              children: [
                {
                  type: "public_field_definition",
                  text: `protected name = "x"`,
                  children: [{ type: "accessibility_modifier", text: "protected" }],
                  fields: { name: { type: "property_identifier", text: "name" } },
                },
                {
                  type: "method_definition",
                  text: `static create(): Base {\n    return new Base()\n  }`,
                  children: [{ type: "static", text: "static" }],
                  fields: {
                    name: { type: "property_identifier", text: "create" },
                    parameters: { type: "formal_parameters", text: `()`, children: [] },
                    return_type: { type: "type_identifier", text: "Base" },
                  },
                },
                {
                  type: "abstract_method_signature",
                  text: `abstract run(): void`,
                  children: [{ type: "abstract", text: "abstract" }],
                  fields: {
                    name: { type: "property_identifier", text: "run" },
                    parameters: { type: "formal_parameters", text: `()`, children: [] },
                    return_type: { type: "type_identifier", text: "void" },
                  },
                },
              ],
            },
          },
        },
      ],
    })
    const result = await extractFromFile("src/base.ts", ABS_SRC, MOCK_TIME)

    const base = result.symbols.find((s) => s.name === "Base")!
    expect(base.metadata).toHaveProperty("isAbstract", true)

    const nameField = result.symbols.find((s) => s.name === "name" && s.symbolType === "variable")!
    expect(nameField.metadata).toHaveProperty("visibility", "protected")

    const create = result.symbols.find((s) => s.name === "create")!
    expect(create.metadata).toHaveProperty("isStatic", true)
    expect(create.metadata).toHaveProperty("visibility", undefined)

    const run = result.symbols.find((s) => s.name === "run" && s.symbolType === "method")!
    expect(run.metadata).toHaveProperty("isAbstract", true)
  })

  test("/// doc comments are extracted", async () => {
    const DOC_SRC = `/// Line doc\nfunction f() {}\n`
    registerTree(DOC_SRC, {
      type: "program",
      text: DOC_SRC,
      children: [
        { type: "comment", text: `/// Line doc` },
        {
          type: "function_declaration",
          text: `function f() {}`,
          fields: {
            name: { type: "identifier", text: "f" },
            parameters: { type: "formal_parameters", text: `()`, children: [] },
          },
        },
      ],
    })
    const result = await extractFromFile("src/f.ts", DOC_SRC, MOCK_TIME)
    expect(result.symbols[0]?.metadata).toHaveProperty("docComment", "Line doc")
  })

  test("unmatched extensions fall back to the regex parser", async () => {
    registerTree(SRC, TREE)
    const result = await extractFromFile("src/app.py", SRC, MOCK_TIME)
    // .py has no parser registered → fallback rules apply
    expect(result.symbols.some((s) => s.symbolType === "function" && s.name === "greet")).toBe(true)
    expect(result.calls).toEqual([])
  })
})
