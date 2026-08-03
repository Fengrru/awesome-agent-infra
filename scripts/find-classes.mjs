import fs from "node:fs"
import path from "node:path"

function findClasses(code) {
  const classes = []
  const re = /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)[^{]*\{/g
  let m
  while ((m = re.exec(code)) !== null) {
    const name = m[1]
    const bodyStart = m.index + m[0].length - 1
    let depth = 1
    let i = bodyStart + 1
    while (i < code.length && depth > 0) {
      if (code[i] === "{") depth++
      else if (code[i] === "}") depth--
      i++
    }
    const body = code.slice(bodyStart, i)
    classes.push({ name, bodyStart, bodyEnd: i, hasCtor: /\bconstructor\s*\(/.test(body), body })
  }
  return classes
}

const packages = fs.readdirSync("packages").filter((p) => fs.existsSync(`packages/${p}/src`))
let total = 0
for (const pkg of packages) {
  const srcDir = `packages/${pkg}/src`
  const files = []
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, f.name)
      if (f.isDirectory()) walk(full)
      else if (f.name.endsWith(".ts") && !f.name.endsWith(".d.ts")) files.push(full)
    }
  }
  walk(srcDir)
  for (const file of files) {
    const code = fs.readFileSync(file, "utf8")
    for (const cls of findClasses(code)) {
      if (!cls.hasCtor) {
        total++
        console.log(`${file} :: class ${cls.name}`)
      }
    }
  }
}
console.log("TOTAL classes without explicit constructor:", total)
