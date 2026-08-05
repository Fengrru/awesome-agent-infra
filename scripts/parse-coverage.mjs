import fs from "node:fs"

const lines = fs.readFileSync(".coverage-report.txt", "utf8").split(/\r?\n/)
const result = []
for (const line of lines) {
  const m = line.match(/^\s*([^|]+?)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*(.*)$/)
  if (!m) continue
  const file = m[1].trim()
  if (!file.includes("\\src\\") && !file.includes("/src/")) continue
  if (file.includes("__tests__") || file.includes("\\dist\\") || file.includes("/dist/")) continue
  const funcs = Number.parseFloat(m[2])
  const linesPct = Number.parseFloat(m[3])
  if (funcs < 100 || linesPct < 100) result.push({ file, funcs, linesPct, missed: m[4].trim() })
}
result.sort((a, b) => a.funcs - b.funcs || a.linesPct - b.linesPct)
for (const r of result) {
  console.log(
    `F${r.funcs.toFixed(2).padStart(6)} L${r.linesPct.toFixed(2).padStart(6)} |`,
    r.file.replace(/^.*?agent-kit\\/, ""),
    "|",
    r.missed,
  )
}
console.log("TOTAL:", result.length)
