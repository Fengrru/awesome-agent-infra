import type { CodeGraphNode, SymbolType, SymbolMetadata } from "./types"

export interface TreeSitterNode {
  type: string
  childCount: number
  namedChildCount: number
  child(index: number): TreeSitterNode | null
  namedChild(index: number): TreeSitterNode | null
  childForFieldName(name: string): TreeSitterNode | null
  startPosition: { row: number; column: number }
  endPosition: { row: number; column: number }
  startIndex: number
  endIndex: number
  parent: TreeSitterNode | null
  previousSibling: TreeSitterNode | null
}

export interface TreeSitterParser {
  parse(source: string): { rootNode: TreeSitterNode }
}

export interface TreeSitterLanguage {
  load(path: string): Promise<TreeSitterLanguage>
}

export interface ExtractorDependencies {
  Parser?: any
  Language?: any
}

export interface LanguageParser {
  parser: unknown
  languageId: string
  filePatterns: string[]
}

export interface ExtractResult {
  symbols: CodeGraphNode[]
  imports: Array<{ source: string; names: string[] }>
  exports: string[]
  durationMs: number
}

let _parserInit: Promise<LanguageParser[]> | null = null
let _deps: ExtractorDependencies = {}

function resolveWasmPath(asset: string): string {
  if (asset.startsWith("file://")) {
    try {
      const { fileURLToPath } = require("node:url") as typeof import("node:url")
      return fileURLToPath(asset)
    } catch {
      return asset.replace(/^file:\/\//, "")
    }
  }
  if (asset.startsWith("/") || /^[a-z]:/i.test(asset)) return asset
  try {
    const url = new URL(asset, import.meta.url)
    try {
      const { fileURLToPath } = require("node:url") as typeof import("node:url")
      return fileURLToPath(url)
    } catch {
      return url.href
    }
  } catch {
    return asset
  }
}

export function setExtractorDependencies(deps: ExtractorDependencies): void {
  _deps = { ..._deps, ...deps }
  _parserInit = null
}

async function getParsers(deps?: ExtractorDependencies): Promise<LanguageParser[]> {
  if (_parserInit) return _parserInit
  _parserInit = (async () => {
    const effectiveDeps = { ..._deps, ...deps }
    const ParserCtor = effectiveDeps.Parser
    const LangCtor = effectiveDeps.Language

    if (!ParserCtor) return []

    try {
      const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, {
        with: { type: "wasm" },
      })
      const wasmBuffer: ArrayBuffer = treeWasm instanceof ArrayBuffer
        ? treeWasm
        : (treeWasm as { default: ArrayBuffer }).default
      const treePath = resolveWasmPath(
        URL.createObjectURL(new Blob([wasmBuffer], { type: "application/wasm" })),
      )
      await ParserCtor.init({ locateFile() { return treePath } })
    } catch { return [] }

    const parsers: LanguageParser[] = []
    if (LangCtor) {
      try {
        const tsMod = await import("tree-sitter-typescript/typescript.wasm" as string, {
          with: { type: "wasm" },
        })
        const tsBuf: ArrayBuffer = tsMod instanceof ArrayBuffer ? tsMod : (tsMod as { default: ArrayBuffer }).default
        const tsPath = resolveWasmPath(URL.createObjectURL(new Blob([tsBuf], { type: "application/wasm" })))
        const tsLang = await LangCtor.load(tsPath)
        const p = new ParserCtor()
        p.setLanguage(tsLang)
        parsers.push({ parser: p, languageId: "typescript", filePatterns: [".ts", ".tsx"] })
      } catch (e) { console.warn("[CodeGraph] TypeScript parser unavailable:", e) }
      try {
        const jsMod = await import("tree-sitter-javascript/tree-sitter-javascript.wasm" as string, {
          with: { type: "wasm" },
        })
        const jsBuf: ArrayBuffer = jsMod instanceof ArrayBuffer ? jsMod : (jsMod as { default: ArrayBuffer }).default
        const jsPath = resolveWasmPath(URL.createObjectURL(new Blob([jsBuf], { type: "application/wasm" })))
        const jsLang = await LangCtor.load(jsPath)
        const p = new ParserCtor()
        p.setLanguage(jsLang)
        parsers.push({ parser: p, languageId: "javascript", filePatterns: [".js", ".jsx", ".mjs", ".cjs"] })
      } catch (e) { console.warn("[CodeGraph] JavaScript parser unavailable:", e) }
    }
    return parsers
  })()
  return _parserInit
}

function parserForFile(parsers: LanguageParser[], filePath: string): LanguageParser | null {
  const ext = filePath.toLowerCase().replace(/.*\.(\w+)$/, ".$1")
  return parsers.find((p) => p.filePatterns.includes(`.${ext}`)) ?? null
}

export async function extractFromFile(filePath: string, source: string, mtime: number, deps?: ExtractorDependencies): Promise<ExtractResult> {
  const startTime = Date.now()
  try {
    const parsers = await getParsers(deps)
    const langParser = parserForFile(parsers, filePath)
    if (langParser) return treeSitterExtract(langParser, filePath, source, mtime)
  } catch { /* Fall through to fallback */ }
  return fallbackExtract(filePath, source, mtime)
}

function treeSitterExtract(langParser: LanguageParser, filePath: string, source: string, mtime: number): ExtractResult {
  const startMs = Date.now()
  const parser = langParser.parser as TreeSitterParser
  const tree = parser.parse(source)
  const root = tree.rootNode
  const imports: Array<{ source: string; names: string[] }> = []
  const exports: string[] = []
  const extracted: ExtractedSymbol[] = []
  walkTree(root, source, extracted, imports, exports)
  const symbols = flattenSymbols(extracted, filePath, mtime)
  return { symbols, imports, exports, durationMs: Date.now() - startMs }
}

interface ExtractedSymbol {
  name: string
  symbolType: SymbolType
  startLine: number
  endLine: number
  metadata: SymbolMetadata
  children?: ExtractedSymbol[]
}

function walkTree(node: TreeSitterNode, source: string, results: ExtractedSymbol[], imports: Array<{ source: string; names: string[] }>, exports: string[]): void {
  const type = node.type
  switch (type) {
    case "import_statement":
    case "import_declaration":
      parseImport(node, source, imports)
      break
    case "export_statement":
    case "export_assignment":
      parseExport(node, source, exports)
      break
    case "function_declaration":
    case "function": {
      const sym = parseFunctionDeclaration(node, source)
      if (sym) results.push(sym)
      break
    }
    case "class_declaration":
    case "class": {
      const sym = parseClassDeclaration(node, source)
      if (sym) results.push(sym)
      break
    }
    case "interface_declaration": {
      const sym = parseInterfaceDeclaration(node, source)
      if (sym) results.push(sym)
      break
    }
    case "method_definition":
    case "method":
    case "public_field_definition": {
      const sym = parseMethodDeclaration(node, source)
      if (sym) results.push(sym)
      break
    }
    case "lexical_declaration":
    case "variable_declaration": {
      const syms = parseVariableDeclaration(node, source)
      results.push(...syms)
      break
    }
    case "type_alias_declaration": {
      const sym = parseTypeAlias(node, source)
      if (sym) results.push(sym)
      break
    }
    case "enum_declaration": {
      const sym = parseEnumDeclaration(node, source)
      if (sym) results.push(sym)
      break
    }
    case "module_declaration":
    case "namespace_declaration": {
      const sym = parseNamespaceDeclaration(node, source)
      if (sym) results.push(sym)
      break
    }
    default:
      if (node.childCount > 0 && shouldRecurseInto(type)) {
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)
          if (child) walkTree(child, source, results, imports, exports)
        }
      }
  }
}

function shouldRecurseInto(nodeType: string): boolean {
  const containerTypes = new Set([
    "program", "module", "statement_block", "body", "declaration_list",
    "export_statement", "export_clause", "named_imports",
    "enum_body", "interface_body", "object_type",
    "expression_statement", "return_statement", "class_body",
    "formal_parameters", "arrow_function",
  ])
  return containerTypes.has(nodeType)
}

function getNodeText(node: TreeSitterNode, source: string): string {
  return source.slice(node.startIndex, node.endIndex)
}

function extractModifierTexts(node: TreeSitterNode, source: string): string[] {
  const texts: string[] = []
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)
    if (!child) continue
    const type = child.type
    if (type === "accessibility_modifier" || type === "static" || type === "abstract"
        || type === "readonly" || type === "async" || type === "override" || type === "decorator") {
      texts.push(type === "accessibility_modifier" ? getNodeText(child, source) : type)
    }
  }
  return texts
}

function hasModifierText(modifiers: string[], text: string): boolean {
  return modifiers.some((m) => m === text)
}

function getVisibility(modifiers: string[]): "public" | "private" | "protected" | undefined {
  if (modifiers.includes("public")) return "public"
  if (modifiers.includes("private")) return "private"
  if (modifiers.includes("protected")) return "protected"
  return undefined
}

function isNodeExported(node: TreeSitterNode, source: string): boolean {
  let current: TreeSitterNode | null = node.parent
  while (current) {
    if (current.type === "export_statement" || current.type === "export_clause") return true
    current = current.parent
  }
  return false
}

function extractDocComment(node: TreeSitterNode, source: string): string | undefined {
  let current: TreeSitterNode | null = node.previousSibling
  while (current) {
    const text = getNodeText(current, source)
    if (text.startsWith("/**") || text.startsWith("///")) {
      return text.replace(/^\/\*\*/, "").replace(/\*\/$/, "").replace(/^\s*\*[ \t]?/gm, "").replace(/^\/\/\/? ?/gm, "").trim()
    }
    if (text.startsWith("//") || text.startsWith("/*")) { current = current.previousSibling; continue }
    break
  }
  return undefined
}

function parseImport(node: TreeSitterNode, source: string, imports: Array<{ source: string; names: string[] }>): void {
  let importSource = ""
  const importedNames: string[] = []
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (!child) continue
    if (child.type === "string" || child.type === "string_literal") {
      importSource = getNodeText(child, source).replace(/['"]/g, "")
    }
    if (child.type === "import_clause" || child.type === "named_imports") {
      for (let j = 0; j < child.childCount; j++) {
        const spec = child.child(j)
        if (!spec) continue
        if (spec.type === "import_specifier" || spec.type === "import_default_specifier") {
          importedNames.push(getNodeText(spec, source))
        }
        if (spec.type === "namespace_import") importedNames.push("*")
      }
    }
  }
  if (importSource) imports.push({ source: importSource, names: importedNames })
}

function parseExport(node: TreeSitterNode, source: string, exports: string[]): void {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (!child) continue
    if (child.type === "declaration" || child.type === "function_declaration"
        || child.type === "class_declaration" || child.type === "variable_declaration"
        || child.type === "lexical_declaration") {
      walkTree(child, source, [], [], exports)
      return
    }
    if (child.type === "export_clause") {
      for (let j = 0; j < child.childCount; j++) {
        const spec = child.child(j)
        if (spec && (spec.type === "export_specifier" || spec.type === "shorthand_property_identifier")) {
          exports.push(getNodeText(spec, source))
        }
      }
    }
    if (child.type === "default" || getNodeText(child, source) === "default") exports.push("default")
    if (child.type === "wildcard_import") exports.push("*")
  }
}

function parseFunctionDeclaration(node: TreeSitterNode, source: string): ExtractedSymbol | null {
  const nameNode = node.childForFieldName("name")
  if (!nameNode) return null
  const modifiers = extractModifierTexts(node, source)
  return {
    name: getNodeText(nameNode, source),
    symbolType: "function",
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    metadata: {
      isAsync: hasModifierText(modifiers, "async"),
      isStatic: hasModifierText(modifiers, "static"),
      isExported: isNodeExported(node, source),
      returnType: resolveReturnType(node, source),
      parameters: resolveParameters(node, source),
      docComment: extractDocComment(node, source),
    },
  }
}

function parseClassDeclaration(node: TreeSitterNode, source: string): ExtractedSymbol | null {
  const nameNode = node.childForFieldName("name")
  if (!nameNode) return null
  const bodyNode = node.childForFieldName("body")
  const children: ExtractedSymbol[] = []
  if (bodyNode) {
    for (let i = 0; i < bodyNode.namedChildCount; i++) {
      const child = bodyNode.namedChild(i)
      if (!child) continue
      if (child.type === "method_definition" || child.type === "method"
          || child.type === "public_field_definition" || child.type === "abstract_method_signature") {
        const m = parseMethodDeclaration(child, source, getNodeText(nameNode, source))
        if (m) children.push(m)
      }
    }
  }
  const modifiers = extractModifierTexts(node, source)
  return {
    name: getNodeText(nameNode, source),
    symbolType: "class",
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    metadata: {
      isExported: isNodeExported(node, source),
      isAbstract: hasModifierText(modifiers, "abstract"),
      typeParams: resolveTypeParameters(node, source),
      docComment: extractDocComment(node, source),
    },
    children,
  }
}

function parseInterfaceDeclaration(node: TreeSitterNode, source: string): ExtractedSymbol | null {
  const nameNode = node.childForFieldName("name")
  if (!nameNode) return null
  const bodyNode = node.childForFieldName("body")
  const children: ExtractedSymbol[] = []
  if (bodyNode) {
    for (let i = 0; i < bodyNode.namedChildCount; i++) {
      const child = bodyNode.namedChild(i)
      if (!child) continue
      if (child.type === "method_signature") {
        const name = child.childForFieldName("name")
        if (!name) continue
        children.push({
          name: getNodeText(name, source),
          symbolType: "method",
          startLine: child.startPosition.row + 1,
          endLine: child.endPosition.row + 1,
          metadata: {
            parameters: resolveParameters(child, source),
            returnType: resolveReturnType(child, source),
            parentId: `symbol:interface:${getNodeText(nameNode, source)}`,
          },
        })
      }
    }
  }
  return {
    name: getNodeText(nameNode, source),
    symbolType: "interface",
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    metadata: {
      isExported: isNodeExported(node, source),
      typeParams: resolveTypeParameters(node, source),
      docComment: extractDocComment(node, source),
    },
    children,
  }
}

function parseMethodDeclaration(node: TreeSitterNode, source: string, parentName?: string): ExtractedSymbol | null {
  const nameNode = node.childForFieldName("name")
  if (!nameNode) return null
  const modifiers = extractModifierTexts(node, source)
  const isField = node.type === "public_field_definition"
  return {
    name: getNodeText(nameNode, source),
    symbolType: isField ? "variable" : "method",
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    metadata: {
      visibility: getVisibility(modifiers),
      isAsync: hasModifierText(modifiers, "async"),
      isStatic: hasModifierText(modifiers, "static"),
      isAbstract: hasModifierText(modifiers, "abstract") || node.type === "abstract_method_signature",
      returnType: isField ? undefined : resolveReturnType(node, source),
      parameters: isField ? undefined : resolveParameters(node, source),
      docComment: extractDocComment(node, source),
      parentId: parentName ? `symbol:class:${parentName}` : undefined,
    },
  }
}

function parseVariableDeclaration(node: TreeSitterNode, source: string): ExtractedSymbol[] {
  const results: ExtractedSymbol[] = []
  const isExported = isNodeExported(node, source)
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (!child || child.type !== "variable_declarator") continue
    const nameNode = child.childForFieldName("name")
    if (!nameNode) continue
    const type = nameNode.type
    if (type === "object_destructuring_pattern" || type === "array_destructuring_pattern") continue
    results.push({
      name: getNodeText(nameNode, source),
      symbolType: "variable",
      startLine: nameNode.startPosition.row + 1,
      endLine: child.endPosition.row + 1,
      metadata: { isExported, docComment: extractDocComment(node, source) },
    })
  }
  return results
}

function parseTypeAlias(node: TreeSitterNode, source: string): ExtractedSymbol | null {
  const nameNode = node.childForFieldName("name")
  if (!nameNode) return null
  return {
    name: getNodeText(nameNode, source),
    symbolType: "type",
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    metadata: {
      typeParams: resolveTypeParameters(node, source),
      isExported: isNodeExported(node, source),
      docComment: extractDocComment(node, source),
    },
  }
}

function parseEnumDeclaration(node: TreeSitterNode, source: string): ExtractedSymbol | null {
  const nameNode = node.childForFieldName("name")
  if (!nameNode) return null
  return {
    name: getNodeText(nameNode, source),
    symbolType: "enum",
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    metadata: { isExported: isNodeExported(node, source), docComment: extractDocComment(node, source) },
  }
}

function parseNamespaceDeclaration(node: TreeSitterNode, source: string): ExtractedSymbol | null {
  const nameNode = node.childForFieldName("name")
  if (!nameNode) return null
  return {
    name: getNodeText(nameNode, source),
    symbolType: "namespace",
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    metadata: { isExported: isNodeExported(node, source), docComment: extractDocComment(node, source) },
  }
}

function resolveParameters(node: TreeSitterNode, source: string): Array<{ name: string; type: string; optional?: boolean }> {
  const params: Array<{ name: string; type: string; optional?: boolean }> = []
  const paramNode = node.childForFieldName("parameters") ?? node.childForFieldName("formal_parameters")
  if (!paramNode) return params
  for (let i = 0; i < paramNode.childCount; i++) {
    const child = paramNode.child(i)
    if (!child) continue
    if (child.type === "parameter" || child.type === "required_parameter" || child.type === "optional_parameter") {
      const nameNode = child.childForFieldName("name") ?? child.childForFieldName("pattern")
      const typeNode = child.childForFieldName("type")
      if (!nameNode) continue
      params.push({
        name: getNodeText(nameNode, source),
        type: typeNode ? getNodeText(typeNode, source) : "any",
        optional: child.type === "optional_parameter",
      })
    }
  }
  return params
}

function resolveReturnType(node: TreeSitterNode, source: string): string | undefined {
  const typeNode = node.childForFieldName("return_type")
  if (!typeNode) return undefined
  let text = getNodeText(typeNode, source).trim()
  if (text.startsWith(":")) text = text.slice(1).trim()
  if (text.startsWith("=>")) text = text.slice(2).trim()
  return text || undefined
}

function resolveTypeParameters(node: TreeSitterNode, source: string): string[] | undefined {
  const tpNode = node.childForFieldName("type_parameters")
  if (!tpNode) return undefined
  const params: string[] = []
  for (let i = 0; i < tpNode.childCount; i++) {
    const child = tpNode.child(i)
    if (child && child.type === "type_parameter") {
      const nameNode = child.childForFieldName("name")
      if (nameNode) params.push(getNodeText(nameNode, source))
    }
  }
  return params.length > 0 ? params : undefined
}

function flattenSymbols(extracted: ExtractedSymbol[], filePath: string, mtime: number): CodeGraphNode[] {
  const results: CodeGraphNode[] = []
  function flatten(sym: ExtractedSymbol, parentId?: string) {
    const nodeId = makeSymbolId(sym.symbolType, sym.name, parentId)
    results.push({
      id: nodeId, type: "symbol", symbolType: sym.symbolType, name: sym.name,
      filePath, startLine: sym.startLine, endLine: sym.endLine,
      metadata: { ...sym.metadata }, mtime,
    })
    if (sym.children) {
      for (const child of sym.children) flatten(child, nodeId)
    }
  }
  for (const sym of extracted) flatten(sym)
  return results
}

function makeSymbolId(symbolType: SymbolType, name: string, parentId?: string): string {
  if (parentId) return `${parentId}.${name}`
  return `symbol:${symbolType}:${name}`
}

function fallbackExtract(filePath: string, source: string, mtime: number): ExtractResult {
  const startMs = Date.now()
  const symbols: CodeGraphNode[] = []
  const imports: Array<{ source: string; names: string[] }> = []
  const exports: string[] = []

  const importRe = /import\s+(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = importRe.exec(source)) !== null) {
    if (m[1]) imports.push({ source: m[1], names: [] })
  }

  const funcRe = /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/gm
  while ((m = funcRe.exec(source)) !== null) {
    const lineNum = source.slice(0, m.index).split("\n").length
    symbols.push({
      id: makeSymbolId("function", m[1]), type: "symbol", symbolType: "function", name: m[1],
      filePath, startLine: lineNum, endLine: lineNum,
      metadata: { isExported: m[0].includes("export") }, mtime,
    })
  }

  const classRe = /^\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/gm
  while ((m = classRe.exec(source)) !== null) {
    const lineNum = source.slice(0, m.index).split("\n").length
    symbols.push({
      id: makeSymbolId("class", m[1]), type: "symbol", symbolType: "class", name: m[1],
      filePath, startLine: lineNum, endLine: lineNum,
      metadata: { isExported: m[0].includes("export") }, mtime,
    })
  }

  const ifaceRe = /^\s*(?:export\s+)?interface\s+(\w+)/gm
  while ((m = ifaceRe.exec(source)) !== null) {
    const lineNum = source.slice(0, m.index).split("\n").length
    symbols.push({
      id: makeSymbolId("interface", m[1]), type: "symbol", symbolType: "interface", name: m[1],
      filePath, startLine: lineNum, endLine: lineNum,
      metadata: { isExported: m[0].includes("export") }, mtime,
    })
  }

  const varRe = /^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::|=)/gm
  while ((m = varRe.exec(source)) !== null) {
    const lineNum = source.slice(0, m.index).split("\n").length
    symbols.push({
      id: makeSymbolId("variable", m[1]), type: "symbol", symbolType: "variable", name: m[1],
      filePath, startLine: lineNum, endLine: lineNum,
      metadata: { isExported: m[0].includes("export") }, mtime,
    })
  }

  const exportRe = /export\s+\{([^}]+)\}/g
  while ((m = exportRe.exec(source)) !== null) {
    const names = m[1].split(",").map((s) => s.trim()).filter(Boolean)
    exports.push(...names)
  }

  return { symbols, imports, exports, durationMs: Date.now() - startMs }
}
