import { runEvaluationSuite } from './eval-suite.js';

const result = await runEvaluationSuite();
console.log(`evals: ${result.passed}/${result.total} passed (${(result.passRate * 100).toFixed(1)}%) in ${result.durationMs}ms`);
for (const failure of result.failures) console.error(`FAIL ${failure.name}: ${failure.error}`);
if (result.failed > 0) process.exit(1);
