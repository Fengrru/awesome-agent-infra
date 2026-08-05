# @fengrru/hallucination-detector

[![npm version](https://img.shields.io/npm/v/@fengrru/hallucination-detector)](https://www.npmjs.com/package/@fengrru/hallucination-detector) [![npm downloads](https://img.shields.io/npm/dm/@fengrru/hallucination-detector)](https://www.npmjs.com/package/@fengrru/hallucination-detector) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)

> **Experimental** — API may break in minor versions. See [STABILITY.md](../../STABILITY.md).

Zero-dependency spectral clustering hallucination detection with self-consistency verification.

## Quick Start

```ts
import { HallucinationDetector } from "@fengrru/hallucination-detector"

const detector = new HallucinationDetector({
  hallucinationThreshold: 0.4,
})

const report = detector.detect(
  "The moon is made of green cheese and was created by aliens in 1950.",
  {
    referenceFacts: [
      "The moon is a natural satellite of Earth.",
      "The moon formed approximately 4.5 billion years ago.",
    ],
  },
)

console.log(`Overall score: ${report.overallScore}`)
console.log(`Hallucinations: ${report.hallucinations.length}`)
console.log(report.details)
```

## Features

- Extract factual claims from text using regex patterns
- Spectral clustering on TF-IDF embeddings
- Self-consistency verification across claims
- Knowledge base cross-referencing
- Configurable detection thresholds

## API

### HallucinationDetector

```ts
const detector = new HallucinationDetector(config?)
```

#### Config

| Option                  | Default | Description                          |
|-------------------------|---------|--------------------------------------|
| minClusterSize          | 2       | Minimum claims per cluster           |
| similarityThreshold     | 0.7     | Minimum cosine sim for same cluster  |
| maxClusters             | 5       | Maximum number of clusters           |
| selfConsistencySamples  | 3       | Samples for self-consistency check   |
| hallucinationThreshold  | 0.3     | Score below this = hallucination     |

#### Methods

- `extractClaims(text: string, source?: string): FactClaim[]`
- `computeSimilarity(a: string, b: string): number`
- `checkSelfConsistency(claims, referenceFacts?): { consistent, inconsistent, rate }`
- `detect(text, options?): HallucinationReport`

### SpectralHallucinationDetector

Extended version with pre-clustering optimization via random projection and Laplacian eigen-decomposition.

```ts
const detector = new SpectralHallucinationDetector()
```


## Documentation

- [API Reference](https://fengrru.github.io/awesome-agent-infra/api/) — TypeDoc-generated API docs
- [Source Code](https://github.com/Fengrru/awesome-agent-infra/tree/main/packages/hallucination-detector)
- [Examples](https://github.com/Fengrru/awesome-agent-infra/tree/main/examples)

## License

MIT
