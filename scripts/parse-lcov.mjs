import fs from "node:fs"

const txt = fs.readFileSync("coverage/lcov.info", "utf8")
const recs = txt.split("end_of_record").filter((s) => s.trim())
let count = 0
for (const rec of recs) {
  const sf = rec.match(/SF:(.+)/)?.[1]
  if (!sf) continue
  if (!sf.includes("src")) continue
  if (sf.includes("__tests__") || sf.includes("dist")) continue
  const fnRe = /FN:(\d+),(\d+),(.+)/g
  const fns = [...rec.matchAll(fnRe)].map((m) => ({
    start: Number(m[1]),
    end: Number(m[2]),
    name: m[3].trim(),
  }))
  const fndaRe = /FNDA:(\d+),(\d+)/g
  const covered = new Set([...rec.matchAll(fndaRe)].map((m) => m[1]))
  const missing = fns.filter((f) => !covered.has(String(f.start)))
  if (missing.length > 0) {
    count++
    console.log("FILE:", sf)
    for (const f of missing) console.log("   MISS FN:", f.name, `[${f.start}-${f.end}]`)
  }
}
console.log("TOTAL files with missing functions:", count)
