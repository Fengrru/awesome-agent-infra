/**
 * Linear algebra primitives used by the calibrator transformer.
 * @module agent-metacog/linalg
 */

export function matMul(a: number[][], b: number[][]): number[][] {
  const m = a.length
  const n = a[0]!.length
  const p = b[0]!.length
  const result: number[][] = Array.from({ length: m }, () => new Array(p).fill(0))
  for (let i = 0; i < m; i++) {
    for (let k = 0; k < n; k++) {
      const aik = a[i]![k]!
      if (aik === 0) continue
      const rowR = result[i]!
      const rowB = b[k]!
      for (let j = 0; j < p; j++) {
        rowR[j] += aik * rowB[j]!
      }
    }
  }
  return result
}

export function matMulVec(M: number[][], v: number[]): number[] {
  const m = M.length
  const n = M[0]!.length
  const result: number[] = new Array(m).fill(0)
  for (let i = 0; i < m; i++) {
    let sum = 0
    const row = M[i]!
    for (let j = 0; j < n; j++) {
      sum += row[j]! * v[j]!
    }
    result[i] = sum
  }
  return result
}

export function transpose(M: number[][]): number[][] {
  const rows = M.length
  const cols = M[0]!.length
  const result: number[][] = Array.from({ length: cols }, () => new Array(rows))
  for (let i = 0; i < rows; i++) {
    const row = M[i]!
    for (let j = 0; j < cols; j++) {
      result[j]![i] = row[j]!
    }
  }
  return result
}

export function addVectors(a: number[], b: number[]): number[] {
  const n = a.length
  const result: number[] = new Array(n)
  for (let i = 0; i < n; i++) result[i] = a[i]! + b[i]!
  return result
}

export function subVectors(a: number[], b: number[]): number[] {
  const n = a.length
  const result: number[] = new Array(n)
  for (let i = 0; i < n; i++) result[i] = a[i]! - b[i]!
  return result
}

export function scaleVector(v: number[], s: number): number[] {
  const n = v.length
  const result: number[] = new Array(n)
  for (let i = 0; i < n; i++) result[i] = v[i]! * s
  return result
}

export function dotProduct(a: number[], b: number[]): number {
  const n = a.length
  let sum = 0
  for (let i = 0; i < n; i++) sum += a[i]! * b[i]!
  return sum
}

export function vectorNorm(v: number[]): number {
  let sum = 0
  for (let i = 0; i < v.length; i++) sum += v[i]! * v[i]!
  return Math.sqrt(sum)
}

export function randomMatrix(rows: number, cols: number, scale?: number): number[][] {
  const limit = scale ?? Math.sqrt(6 / (rows + cols))
  const result: number[][] = Array.from({ length: rows }, () => new Array(cols))
  for (let i = 0; i < rows; i++) {
    const row = result[i]!
    for (let j = 0; j < cols; j++) row[j] = (Math.random() * 2 - 1) * limit
  }
  return result
}

export function zeros(rows: number, cols: number): number[][] {
  return Array.from({ length: rows }, () => new Array(cols).fill(0))
}

export function softmax(logits: number[]): number[] {
  const maxVal = Math.max(...logits)
  const exps = logits.map((x) => Math.exp(x - maxVal))
  const sumExps = exps.reduce((a, b) => a + b, 0)
  return exps.map((e) => e / sumExps)
}

export function softmax2D(x: number[][]): number[][] {
  return x.map((row) => softmax(row))
}

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

export function gelu(x: number): number {
  return 0.5 * x * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (x + 0.044715 * x * x * x)))
}

export function mean(v: number[]): number {
  let sum = 0
  for (let i = 0; i < v.length; i++) sum += v[i]!
  return sum / v.length
}

export function addMatrices(a: number[][], b: number[][]): number[][] {
  const rows = a.length
  const cols = a[0]!.length
  const result: number[][] = Array.from({ length: rows }, () => new Array(cols))
  for (let i = 0; i < rows; i++) {
    const rowA = a[i]!
    const rowB = b[i]!
    const rowR = result[i]!
    for (let j = 0; j < cols; j++) rowR[j] = rowA[j]! + rowB[j]!
  }
  return result
}

export function subMatrices(a: number[][], b: number[][]): number[][] {
  const rows = a.length
  const cols = a[0]!.length
  const result: number[][] = Array.from({ length: rows }, () => new Array(cols))
  for (let i = 0; i < rows; i++) {
    const rowA = a[i]!
    const rowB = b[i]!
    const rowR = result[i]!
    for (let j = 0; j < cols; j++) rowR[j] = rowA[j]! - rowB[j]!
  }
  return result
}

export function scaleMatrix(M: number[][], s: number): number[][] {
  const rows = M.length
  const cols = M[0]!.length
  const result: number[][] = Array.from({ length: rows }, () => new Array(cols))
  for (let i = 0; i < rows; i++) {
    const rowM = M[i]!
    const rowR = result[i]!
    for (let j = 0; j < cols; j++) rowR[j] = rowM[j]! * s
  }
  return result
}

export function matrixL2Norm(M: number[][]): number {
  let sum = 0
  for (let i = 0; i < M.length; i++) {
    const row = M[i]!
    for (let j = 0; j < row.length; j++) sum += row[j]! * row[j]!
  }
  return Math.sqrt(sum)
}

export function dropMask(rows: number, cols: number, rate: number): number[][] {
  const mask: number[][] = Array.from({ length: rows }, () => new Array(cols))
  const scale = 1 / (1 - rate)
  for (let i = 0; i < rows; i++) {
    const row = mask[i]!
    for (let j = 0; j < cols; j++) row[j] = Math.random() < rate ? 0 : scale
  }
  return mask
}
