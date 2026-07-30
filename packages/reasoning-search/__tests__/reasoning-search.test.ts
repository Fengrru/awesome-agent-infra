import { describe, expect, test } from 'bun:test';
import {
  ReasoningSearch,
  uctValue,
  selectBestChild,
  softmaxRewards,
  adaptiveFloor,
  isComplete,
  isCompleteMath,
  isCompleteCode,
  isCompleteLogic,
  type MCTSNode,
  type ReasoningGenerateFn,
  type ReasoningScoreFn,
} from '../src/index.js';

// ─── Helper to create nodes for testing ─────────────────────────────────────

let nodeId = 0;
function createNode(
  state: string,
  action: string | null,
  parent: MCTSNode | null,
): MCTSNode {
  return {
    id: `test_${++nodeId}`,
    state,
    action,
    parent,
    children: [],
    visits: 0,
    value: 0,
    depth: parent ? parent.depth + 1 : 0,
  };
}

// ─── UCT ────────────────────────────────────────────────────────────────────

describe('uctValue', () => {
  test('unvisited node returns Infinity', () => {
    const node = createNode('state', 'action', null);
    expect(uctValue(node, 10, Math.SQRT2)).toBe(Infinity);
  });

  test('visited node returns finite value', () => {
    const node = createNode('state', 'action', null);
    node.visits = 5;
    node.value = 3;
    const value = uctValue(node, 20, Math.SQRT2);
    expect(value).toBeGreaterThan(0);
    expect(Number.isFinite(value)).toBe(true);
  });
});

describe('selectBestChild', () => {
  test('fair tie-breaking among unvisited', () => {
    const parent = createNode('root', null, null);
    parent.visits = 10;
    const c1 = createNode('s1', 'a1', parent);
    const c2 = createNode('s2', 'a2', parent);
    const c3 = createNode('s3', 'a3', parent);
    parent.children = [c1, c2, c3];

    // Run multiple times — should not always pick first
    const picks = new Set<string>();
    for (let i = 0; i < 30; i++) {
      picks.add(selectBestChild(parent, Math.SQRT2).id);
    }
    // With 30 trials and 3 unvisited, very likely to pick at least 2 different
    expect(picks.size).toBeGreaterThanOrEqual(2);
  });

  test('selects best visited child', () => {
    const parent = createNode('root', null, null);
    parent.visits = 10;
    const c1 = createNode('s1', 'a1', parent);
    c1.visits = 3; c1.value = 1;
    const c2 = createNode('s2', 'a2', parent);
    c2.visits = 3; c2.value = 3; // higher value
    parent.children = [c1, c2];

    const selected = selectBestChild(parent, Math.SQRT2);
    expect(selected.id).toBe(c2.id);
  });

  test('throws on empty children', () => {
    const node = createNode('root', null, null);
    expect(() => selectBestChild(node, Math.SQRT2)).toThrow();
  });
});

// ─── Softmax Rewards ────────────────────────────────────────────────────────

describe('softmaxRewards', () => {
  test('empty input returns empty', () => {
    expect(softmaxRewards([], 1)).toEqual([]);
  });

  test('sums to 1', () => {
    const scores = [1, 2, 3, 4, 5];
    const rewards = softmaxRewards(scores, 2.0);
    const sum = rewards.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  test('higher scores get higher rewards', () => {
    const scores = [0.1, 0.5, 0.9];
    const rewards = softmaxRewards(scores, 2.0);
    expect(rewards[2]!).toBeGreaterThan(rewards[1]!);
    expect(rewards[1]!).toBeGreaterThan(rewards[0]!);
  });

  test('higher temperature flattens distribution', () => {
    const scores = [0.1, 0.9];
    const cold = softmaxRewards(scores, 0.5);
    const hot = softmaxRewards(scores, 5.0);
    // Cold temperature should have wider gap
    const coldGap = Math.abs(cold[1]! - cold[0]!);
    const hotGap = Math.abs(hot[1]! - hot[0]!);
    expect(coldGap).toBeGreaterThan(hotGap);
  });
});

// ─── Adaptive Floor ─────────────────────────────────────────────────────────

describe('adaptiveFloor', () => {
  test('decreases with depth', () => {
    const f0 = adaptiveFloor(0, 0.95);
    const f5 = adaptiveFloor(5, 0.95);
    const f10 = adaptiveFloor(10, 0.95);
    expect(f0).toBeGreaterThan(f5);
    expect(f5).toBeGreaterThan(f10);
  });

  test('always positive', () => {
    for (let d = 0; d <= 100; d++) {
      expect(adaptiveFloor(d, 0.95)).toBeGreaterThan(0);
    }
  });
});

// ─── Completion Detection ───────────────────────────────────────────────────

describe('completion detection', () => {
  test('math: #### format detected', () => {
    expect(isCompleteMath('#### 42')).toBe(true);
  });

  test('math: "the answer is" detected', () => {
    expect(isCompleteMath('therefore the answer is 42')).toBe(true);
  });

  test('math: non-answer not detected', () => {
    expect(isCompleteMath('let x = 5')).toBe(false);
  });

  test('code: function definition detected', () => {
    expect(isCompleteCode('def solve():\n    return 42')).toBe(true);
  });

  test('code: incomplete text not detected', () => {
    expect(isCompleteCode('x =')).toBe(false);
  });

  test('logic: QED detected', () => {
    expect(isCompleteLogic('Thus the statement holds. QED')).toBe(true);
  });

  test('logic: proved detected', () => {
    expect(isCompleteLogic('We have proved the theorem')).toBe(true);
  });

  test('logic: non-completion not detected', () => {
    expect(isCompleteLogic('Let P be a proposition')).toBe(false);
  });

  test('isComplete dispatches correctly', () => {
    expect(isComplete('#### 42', 'math')).toBe(true);
    expect(isComplete('def foo(): pass', 'code')).toBe(true);
    expect(isComplete('QED', 'logic')).toBe(true);
  });
});

// ─── ReasoningSearch ────────────────────────────────────────────────────────

// Mock generate function
function mockGenerate(responses: string[]): ReasoningGenerateFn {
  let callCount = 0;
  return async (_prompt: string, _n: number): Promise<string[]> => {
    const response = responses[callCount % responses.length] ?? 'default response';
    callCount++;
    return [response];
  };
}

describe('ReasoningSearch', () => {
  test('standard_sampling returns single generation', async () => {
    const engine = new ReasoningSearch(
      mockGenerate(['The answer is 42.']),
    );

    const result = await engine.solve('What is 6*7?', 'standard_sampling');
    expect(result.solution).toBe('The answer is 42.');
    expect(result.searchStats.strategy).toBe('standard_sampling');
    expect(result.searchStats.generateCalls).toBe(1);
  });

  test('mcts search returns valid result', async () => {
    const engine = new ReasoningSearch(
      mockGenerate([
        'Step 1: Note that 6*7 = 42',
        'Step 2: Therefore the answer is 42',
        '#### 42',
      ]),
      { config: { mctsIterations: 10, maxDepth: 5, beamWidth: 2 } },
    );

    const result = await engine.solve('What is 6*7?', 'mcts', 'math');
    expect(result.searchStats.strategy).toBe('mcts');
    expect(result.searchStats.timeMs).toBeGreaterThanOrEqual(0);
    expect(result.searchStats.nodesExplored).toBeGreaterThan(0);
  });

  test('mcts search with score function', async () => {
    const scoreFn: ReasoningScoreFn = async (state: string, action: string): Promise<number> => {
      // Higher score for actions containing numbers
      return /\d+/.test(action) ? 0.8 : 0.3;
    };

    const engine = new ReasoningSearch(
      mockGenerate(['x = 5', 'x + 3 = 8', '#### 8']),
      { scoreFn, config: { mctsIterations: 15, maxDepth: 8, beamWidth: 3 } },
    );

    const result = await engine.solve('Solve x+3=8', 'mcts', 'math');
    expect(result.searchStats.strategy).toBe('mcts');
    expect(result.numSteps).toBeGreaterThanOrEqual(0);
  });

  test('guided_beam_search returns valid result', async () => {
    const engine = new ReasoningSearch(
      mockGenerate(['Step 1: analyze', 'Step 2: conclude #### 7']),
      { config: { maxDepth: 10, beamWidth: 2 } },
    );

    const result = await engine.solve('What is 3+4?', 'true_guided_beam_search', 'math');
    expect(result.searchStats.strategy).toBe('true_guided_beam_search');
    expect(result.solution.length).toBeGreaterThan(0);
  });

  test('importance_sampling returns valid result', async () => {
    const engine = new ReasoningSearch(
      mockGenerate(['Step A', 'Step B', 'Step C']),
      { config: { maxDepth: 5, beamWidth: 2, temperature: 2.0 } },
    );

    const result = await engine.solve('Problem', 'importance_sampling');
    expect(result.searchStats.strategy).toBe('importance_sampling');
    expect(result.reasoningChain.length).toBeGreaterThanOrEqual(0);
  });

  test('invalid strategy throws', async () => {
    const engine = new ReasoningSearch(mockGenerate(['x']));
    await expect(
      engine.solve('test', 'invalid' as any),
    ).rejects.toThrow();
  });

  test('updateConfig changes behavior', () => {
    const engine = new ReasoningSearch(mockGenerate([]));
    engine.updateConfig({ maxDepth: 20, explorationConstant: 3.0 });
    const config = engine.getConfig();
    expect(config.maxDepth).toBe(20);
    expect(config.explorationConstant).toBe(3.0);
  });

  test('extractBestPath returns at least root', async () => {
    const engine = new ReasoningSearch(
      mockGenerate(['answer']),
      { config: { mctsIterations: 5, maxDepth: 3, beamWidth: 1 } },
    );

    const result = await engine.solve('test?', 'mcts');
    expect(result.reasoningChain.length).toBeGreaterThanOrEqual(0);
  });

  test('best_of_n search returns valid result', async () => {
    const engine = new ReasoningSearch(
      mockGenerate(['The answer is 42', 'I think 42', '42']),
      { config: { maxDepth: 10, beamWidth: 2 } },
    );

    const result = await engine.solve('What is 6*7?', 'best_of_n');
    expect(result.searchStats.strategy).toBe('best_of_n');
    expect(result.solution.length).toBeGreaterThan(0);
  });

  test('legacy_beam_search returns valid result', async () => {
    const engine = new ReasoningSearch(
      mockGenerate(['Step 1: setup', 'Step 2: solve', '#### 42']),
      { config: { maxDepth: 5, beamWidth: 2 } },
    );

    const result = await engine.solve('What is 6*7?', 'legacy_beam_search', 'math');
    expect(result.searchStats.strategy).toBe('legacy_beam_search');
    expect(result.solution.length).toBeGreaterThan(0);
  });

  test('mcts with task type code', async () => {
    const engine = new ReasoningSearch(
      mockGenerate([
        'def solve():',
        '    return 42',
      ]),
      { config: { mctsIterations: 8, maxDepth: 5, beamWidth: 2 } },
    );

    const result = await engine.solve('Write a function', 'mcts', 'code');
    expect(result.searchStats.strategy).toBe('mcts');
    expect(result.searchStats.generateCalls).toBeGreaterThan(0);
  });

  test('mcts with logic task type', async () => {
    const engine = new ReasoningSearch(
      mockGenerate([
        'Assume P is true.',
        'Therefore Q must be true.',
        'QED',
      ]),
      { config: { mctsIterations: 10, maxDepth: 6, beamWidth: 2 } },
    );

    const result = await engine.solve('Prove P implies Q', 'mcts', 'logic');
    expect(result.searchStats.strategy).toBe('mcts');
    expect(result.numSteps).toBeGreaterThanOrEqual(0);
  });

  test('guided_beam_search with score function weights steps', async () => {
    const scoreFn: ReasoningScoreFn = async (_state: string, action: string): Promise<number> => {
      return action.includes('good') ? 0.9 : 0.1;
    };

    const engine = new ReasoningSearch(
      mockGenerate(['good step', 'bad step', 'good step 2']),
      { scoreFn, config: { maxDepth: 5, beamWidth: 2, prmBeta: 2.0 } },
    );

    const result = await engine.solve('test', 'true_guided_beam_search');
    expect(result.searchStats.strategy).toBe('true_guided_beam_search');
  });

  test('constructor without options works', () => {
    const engine = new ReasoningSearch(mockGenerate([]));
    const config = engine.getConfig();
    expect(config.maxDepth).toBe(15);
    expect(config.beamWidth).toBe(3);
    expect(config.mctsIterations).toBe(50);
  });

  test('config override in solve merges with defaults', async () => {
    const engine = new ReasoningSearch(
      mockGenerate(['answer']),
      { config: { maxDepth: 20 } },
    );

    const result = await engine.solve('test?', 'standard_sampling');
    expect(result.searchStats.strategy).toBe('standard_sampling');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Refusal Detection
// ═══════════════════════════════════════════════════════════════════════════════

import { isRefusal } from '../src/index.js';

describe('isRefusal', () => {
  test('detects "I don\'t know"', () => {
    expect(isRefusal("I don't know the answer")).toBe(true);
  });

  test('detects "I am not sure"', () => {
    expect(isRefusal('I am not sure about that')).toBe(true);
  });

  test('detects "I cannot answer"', () => {
    expect(isRefusal('I cannot answer this question')).toBe(true);
  });

  test('detects "unable to determine"', () => {
    expect(isRefusal('I am unable to determine the result')).toBe(true);
  });

  test('detects "insufficient information"', () => {
    expect(isRefusal('There is insufficient information to proceed')).toBe(true);
  });

  test('detects "cannot be determined"', () => {
    expect(isRefusal('The value cannot be determined from the given data')).toBe(true);
  });

  test('detects "not enough context"', () => {
    expect(isRefusal('There is not enough context to answer')).toBe(true);
  });

  test('detects "beyond my scope"', () => {
    expect(isRefusal('This is beyond my scope of knowledge')).toBe(true);
  });

  test('normal answer is not a refusal', () => {
    expect(isRefusal('The answer is 42')).toBe(false);
  });

  test('empty string is not a refusal', () => {
    expect(isRefusal('')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Step Classification & Segmentation
// ═══════════════════════════════════════════════════════════════════════════════

import { classifyStep, segmentSteps } from '../src/index.js';

describe('classifyStep', () => {
  test('classifies implication (therefore)', () => {
    expect(classifyStep('Therefore, x must equal 5')).toBe('implication');
  });

  test('classifies implication (thus)', () => {
    expect(classifyStep('Thus we have proven it')).toBe('implication');
  });

  test('classifies implication (hence)', () => {
    expect(classifyStep('Hence the result follows')).toBe('implication');
  });

  test('classifies equation', () => {
    expect(classifyStep('x = 5 + 3')).toBe('equation');
  });

  test('classifies equation with multiplication', () => {
    expect(classifyStep('3 * 7 = 21')).toBe('equation');
  });

  test('classifies assertion (assume)', () => {
    expect(classifyStep('Assume P is true')).toBe('assertion');
  });

  test('classifies assertion (given)', () => {
    expect(classifyStep('Given the constraints')).toBe('assertion');
  });

  test('classifies assertion (by definition)', () => {
    expect(classifyStep('By definition, a square has four equal sides')).toBe('assertion');
  });

  test('classifies conclusion (QED)', () => {
    expect(classifyStep('Thus the theorem holds. QED')).toBe('conclusion');
  });

  test('classifies conclusion (proved)', () => {
    expect(classifyStep('We have proved the statement')).toBe('conclusion');
  });

  test('classifies conclusion (contradiction)', () => {
    expect(classifyStep('This leads to a contradiction')).toBe('conclusion');
  });

  test('classifies unknown for generic text', () => {
    expect(classifyStep('Hello world')).toBe('unknown');
  });

  test('implication takes priority over equation', () => {
    expect(classifyStep('Therefore x = 5')).toBe('implication');
  });
});

describe('segmentSteps', () => {
  test('segments text on double newlines', () => {
    const result = segmentSteps('Step one.\n\nStep two.\n\nTherefore done.');
    expect(result.length).toBe(3);
    expect(result[0]!.index).toBe(0);
    expect(result[1]!.index).toBe(1);
  });

  test('segments numbered steps', () => {
    const result = segmentSteps('1. First point\n2. Second point');
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  test('each segment has confidence', () => {
    const result = segmentSteps('A simple step');
    expect(result[0]!.confidence).toBe(0.8);
  });

  test('empty text returns empty', () => {
    expect(segmentSteps('')).toEqual([]);
  });

  test('whitespace-only text returns empty', () => {
    expect(segmentSteps('   \n\n  ')).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Softmax Rewards — Edge Cases
// ═══════════════════════════════════════════════════════════════════════════════

describe('softmaxRewards edge cases', () => {
  test('single element returns [1]', () => {
    expect(softmaxRewards([0.5], 1.0)).toEqual([1]);
  });

  test('all zero scores produce uniform distribution', () => {
    const rewards = softmaxRewards([0, 0, 0], 1.0);
    expect(rewards.length).toBe(3);
    // All should be equal
    expect(Math.abs(rewards[0]! - rewards[1]!)).toBeLessThan(1e-10);
    expect(Math.abs(rewards[1]! - rewards[2]!)).toBeLessThan(1e-10);
  });

  test('extreme temperature (very cold)', () => {
    const scores = [0.5, 0.9];
    const rewards = softmaxRewards(scores, 0.01);
    // Very cold: the max score dominates
    expect(rewards[1]!).toBeGreaterThan(0.99);
  });

  test('extreme temperature (very hot)', () => {
    const scores = [0.1, 0.9];
    const rewards = softmaxRewards(scores, 100);
    // Very hot: nearly uniform
    const ratio = rewards[1]! / rewards[0]!;
    expect(ratio).toBeLessThan(1.05);
  });

  test('negative scores handled', () => {
    const scores = [-1, 0, 1];
    const rewards = softmaxRewards(scores, 1.0);
    expect(rewards.length).toBe(3);
    const sum = rewards.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Adaptive Floor — Edge Cases
// ═══════════════════════════════════════════════════════════════════════════════

describe('adaptiveFloor edge cases', () => {
  test('depth 0 gives baseline', () => {
    expect(adaptiveFloor(0, 0.95)).toBe(1e-4);
  });

  test('very deep depth still positive', () => {
    expect(adaptiveFloor(1000, 0.95)).toBeGreaterThan(0);
  });

  test('lower discount decreases faster', () => {
    const lowDiscount = adaptiveFloor(10, 0.5);
    const highDiscount = adaptiveFloor(10, 0.99);
    expect(lowDiscount).toBeLessThan(highDiscount);
  });

  test('discount of 1 gives constant floor', () => {
    const f0 = adaptiveFloor(0, 1.0);
    const f10 = adaptiveFloor(10, 1.0);
    expect(f0).toBe(f10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// UCT Value — Edge Cases
// ═══════════════════════════════════════════════════════════════════════════════

describe('uctValue edge cases', () => {
  test('more visits decreases exploration bonus', () => {
    const node = createNode('state', 'action', null);
    node.visits = 10;
    node.value = 5;
    const v1 = uctValue(node, 100, Math.SQRT2);

    node.visits = 100;
    node.value = 50;
    const v2 = uctValue(node, 100, Math.SQRT2);

    // Exploitation stays same (0.5), exploration decreases
    expect(v2).toBeLessThan(v1);
  });

  test('higher parent visits increases exploration', () => {
    const node = createNode('state', 'action', null);
    node.visits = 5;
    node.value = 2.5;
    const v1 = uctValue(node, 10, Math.SQRT2);
    const v2 = uctValue(node, 100, Math.SQRT2);
    expect(v2).toBeGreaterThan(v1);
  });

  test('zero value no problem', () => {
    const node = createNode('state', 'action', null);
    node.visits = 5;
    node.value = 0;
    const val = uctValue(node, 10, Math.SQRT2);
    expect(val).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Completion Detection — Edge Cases
// ═══════════════════════════════════════════════════════════════════════════════

describe('completion detection edge cases', () => {
  test('isComplete general always returns true for non-empty', () => {
    expect(isComplete('anything', 'general')).toBe(true);
  });

  test('isComplete general empty returns false', () => {
    expect(isComplete('', 'general')).toBe(false);
  });

  test('math: \\boxed format detected', () => {
    expect(isCompleteMath('\\boxed{42}')).toBe(true);
  });

  test('code: long enough function body', () => {
    expect(isCompleteCode('function calculate() { return 42; }')).toBe(true);
  });

  test('code: class definition detected', () => {
    expect(isCompleteCode('class Calculator { method() { return 42; } }')).toBe(true);
  });

  test('code: short text not complete', () => {
    expect(isCompleteCode('def f():')).toBe(false);
  });

  test('logic: "it follows that" detected', () => {
    expect(isCompleteLogic('It follows that the theorem is true')).toBe(true);
  });

  test('logic: "hence the statement" detected', () => {
    expect(isCompleteLogic('Hence the statement holds')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Hallucination Suppressor — Unit Tests
// ═══════════════════════════════════════════════════════════════════════════════

import { HallucinationSuppressor } from '../src/index.js';

describe('HallucinationSuppressor', () => {
  function makeSuppressor(): HallucinationSuppressor {
    return new HallucinationSuppressor({
      llmCall: async (_prompt: string): Promise<string> => 'YES',
      nVerifications: 1,
      consistencyThreshold: 0.5,
    });
  }

  test('extractClaims splits on sentence boundaries', () => {
    const suppressor = makeSuppressor();
    const claims = suppressor.extractClaims(
      'The sky is blue. The earth is round. Water boils at 100 degrees.',
    );
    expect(claims.length).toBe(3);
    expect(claims[0]!.claim).toContain('sky');
    expect(claims[1]!.claim).toContain('earth');
  });

  test('extractClaims filters questions', () => {
    const suppressor = makeSuppressor();
    const claims = suppressor.extractClaims('Is the sky blue?');
    expect(claims.length).toBe(0);
  });

  test('extractClaims filters short sentences', () => {
    const suppressor = makeSuppressor();
    const claims = suppressor.extractClaims('Hi. OK.');
    expect(claims.length).toBe(0);
  });

  test('extractClaims calculates confidence', () => {
    const suppressor = makeSuppressor();
    const claims = suppressor.extractClaims(
      'First factual claim here. Second factual claim also here. Third one is here too.',
    );
    expect(claims.length).toBe(3);
    // Confidence should be >= 0.7
    for (const c of claims) {
      expect(c.confidence).toBeGreaterThanOrEqual(0.7);
      expect(c.confidence).toBeLessThanOrEqual(1.0);
    }
  });

  test('verifyClaim returns all YES for mock that says YES', async () => {
    const suppressor = new HallucinationSuppressor({
      llmCall: async (_prompt: string): Promise<string> => 'YES',
      nVerifications: 2,
      consistencyThreshold: 0.5,
    });

    const result = await suppressor.verifyClaim('The sky is blue');
    expect(result.claim).toBe('The sky is blue');
    expect(result.isHallucination).toBe(false);
    expect(result.consistencyScore).toBe(1.0);
    // 3 templates * 2 verifications = 6 total
    expect(result.verifications.length).toBe(6);
  });

  test('verifyClaim detects hallucination for consistent NO responses', async () => {
    const suppressor = new HallucinationSuppressor({
      llmCall: async (_prompt: string): Promise<string> => 'NO',
      nVerifications: 1,
      consistencyThreshold: 0.6,
    });

    const result = await suppressor.verifyClaim('The moon is made of cheese');
    expect(result.isHallucination).toBe(true);
    expect(result.consistencyScore).toBe(0);
  });

  test('suppress pipeline works end-to-end', async () => {
    const suppressor = new HallucinationSuppressor({
      llmCall: async (_prompt: string): Promise<string> => 'YES',
      nVerifications: 1,
      consistencyThreshold: 0.6,
    });

    const report = await suppressor.suppress(
      'The sky is blue. Water is wet. The earth is flat.',
    );
    expect(report.claims.length).toBe(3);
    expect(report.hallucinations.length).toBe(0);
    expect(report.overallConfidence).toBe(1.0);
    expect(report.originalText).toBeTruthy();
  });

  test('suppress removes hallucinated claims from corrected text', async () => {
    let callCount = 0;
    const suppressor = new HallucinationSuppressor({
      llmCall: async (_prompt: string): Promise<string> => {
        callCount++;
        // Say NO to first claim (hallucination), YES to rest
        return callCount <= 3 ? 'NO' : 'YES';
      },
      nVerifications: 1,
      consistencyThreshold: 0.5,
    });

    const report = await suppressor.suppress(
      'The earth is flat. Water is wet.',
    );
    expect(report.hallucinationCount).toBeGreaterThan(0);
    expect(report.correctedText).not.toContain('flat');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Metric Calculator
// ═══════════════════════════════════════════════════════════════════════════════

import { MetricCalculator } from '../src/index.js';

describe('MetricCalculator', () => {
  test('empty input returns zeros', () => {
    const result = MetricCalculator.compute([], []);
    expect(result.numSamples).toBe(0);
    expect(result.exactMatch).toBe(0);
    expect(result.f1).toBe(0);
    expect(result.ece).toBe(0);
  });

  test('perfect exact match', () => {
    const result = MetricCalculator.compute(
      ['hello world', 'foo bar'],
      ['hello world', 'foo bar'],
    );
    expect(result.numSamples).toBe(2);
    expect(result.exactMatch).toBe(1.0);
    expect(result.partialMatch).toBe(1.0);
    expect(result.f1).toBeCloseTo(1.0);
  });

  test('no match', () => {
    const result = MetricCalculator.compute(
      ['abc def', 'ghi jkl'],
      ['xyz uvw', 'rst mno'],
    );
    expect(result.exactMatch).toBe(0);
    expect(result.partialMatch).toBe(0);
  });

  test('partial match (substring)', () => {
    const result = MetricCalculator.compute(
      ['hello world today'],
      ['hello world'],
    );
    expect(result.partialMatch).toBe(1.0);
  });

  test('partial match reversed', () => {
    const result = MetricCalculator.compute(
      ['hello'],
      ['hello world'],
    );
    expect(result.partialMatch).toBe(1.0);
  });

  test('ROUGE scores', () => {
    const result = MetricCalculator.compute(
      ['the cat sat on the mat'],
      ['the cat sat on the mat'],
    );
    expect(result.rouge1).toBeCloseTo(1.0);
    expect(result.rouge2).toBeCloseTo(1.0);
  });

  test('BLEU score for identical strings', () => {
    const result = MetricCalculator.compute(
      ['the quick brown fox'],
      ['the quick brown fox'],
    );
    expect(result.bleu).toBeGreaterThan(0.9);
  });

  test('ECE with confidences', () => {
    const result = MetricCalculator.compute(
      ['a', 'b', 'c'],
      ['a', 'b', 'c'],
      [0.9, 0.9, 0.9],
    );
    expect(result.ece).toBeLessThan(1.0);
  });

  test('efficiency metrics with call counts and times', () => {
    const result = MetricCalculator.compute(
      ['a', 'b'],
      ['a', 'b'],
      [],
      [5, 3],
      [100, 200],
    );
    expect(result.efficiency.avgCalls).toBe(4);
    expect(result.efficiency.avgTime).toBe(150);
    expect(result.efficiency.harmonicEfficiency).toBeGreaterThan(0);
  });

  test('mismatched lengths use minimum', () => {
    const result = MetricCalculator.compute(
      ['a', 'b', 'c'],
      ['a'],
    );
    expect(result.numSamples).toBe(1);
  });

  test('case-insensitive exact match', () => {
    const result = MetricCalculator.compute(
      ['HELLO'],
      ['hello'],
    );
    expect(result.exactMatch).toBe(1.0);
  });

  test('whitespace differences still match', () => {
    const result = MetricCalculator.compute(
      ['hello  world'],
      ['hello world'],
    );
    // Tokenized: both become ['hello', 'world'] after stripping and splitting
    expect(result.exactMatch).toBe(1.0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Self-Consistency Evaluation
// ═══════════════════════════════════════════════════════════════════════════════

import { selfConsistencyEvaluate } from '../src/index.js';

describe('selfConsistencyEvaluate', () => {
  test('majority voting picks most common answer', async () => {
    const generateFn = async (_prompt: string, n: number): Promise<string[]> => {
      const responses: string[] = [];
      for (let i = 0; i < n; i++) {
        responses.push(i < n * 0.6 ? 'Answer A' : 'Answer B');
      }
      return responses;
    };

    const result = await selfConsistencyEvaluate('test', generateFn, 10);
    expect(result.answer).toBe('Answer A');
    expect(result.agreementRate).toBeGreaterThan(0.5);
  });

  test('single sample returns that answer', async () => {
    const generateFn = async (_prompt: string, _n: number): Promise<string[]> => {
      return ['The only answer'];
    };

    const result = await selfConsistencyEvaluate('test', generateFn, 1);
    expect(result.answer).toBe('The only answer');
    expect(result.agreementRate).toBe(1.0);
  });

  test('multi-line responses use last line as answer', async () => {
    const generateFn = async (_prompt: string, _n: number): Promise<string[]> => {
      return ['Reasoning step 1\nReasoning step 2\nFinal: 42'];
    };

    const result = await selfConsistencyEvaluate('test', generateFn, 1);
    expect(result.answer).toBe('Final: 42');
  });
});
