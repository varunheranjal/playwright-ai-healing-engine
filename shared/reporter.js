const fs = require('fs');
const path = require('path');
const LocatorHealer = require('./utils/locatorHealer');
const { classifyFailure } = require('./utils/failureClassifier');

class MyReporter {
  constructor(options) {
    this.options = options;
    this.failedTests = []; // { title, suite, error, status }
    this.testResults = []; // all test results for the dashboard
    // projectRoot controls where output files (.testResultsEnv, ai-summary.txt, dashboard data) are written
    this.projectRoot = (options && options.projectRoot) || __dirname;
    // Tell the LocatorHealer where to read/write its logs
    LocatorHealer.setProjectRoot(this.projectRoot);
    console.log(`AI Healing Engine — ${options && options.customOption ? options.customOption : 'N/A'}`);
  }

  onBegin(_config, suite) {
    this.suite = suite;
    this.startTime = Date.now();
    LocatorHealer.clearPersistedLogs();
    console.log(`Starting the run with ${suite.allTests().length} tests`);
  }

  onTestBegin(test) {
    console.log(`Starting test ${test.title}`);
  }

  onTestEnd(test, result) {
    console.log(`Test Case Run for "${test.title}" (Attempt: ${result.retry + 1}/${test.retries + 1}) with Status: ${result.status}`);

    const isFinalAttempt = result.retry >= test.retries;
    if (isFinalAttempt && (result.status === 'failed' || result.status === 'timedOut')) {
      const rawError = result.error?.message || result.error?.toString() || 'No error message captured';
      const classification = classifyFailure(rawError);
      this.failedTests.push({
        title: test.title,
        suite: test.parent?.title || '',
        error: rawError.slice(0, 400),
        status: result.status,
        classification: classification.classification,
        classificationLabel: classification.label,
        classificationHint: classification.hint,
      });
    }
  }

  async onEnd(result) {
    console.log(`Finished the Test Suite Run with Overall Status: ${result.status}`);

    let passedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    const flakyTests = [];

    const allTests = this.suite.allTests();
    allTests.forEach((test) => {
      const finalOutcome = test.outcome();
      const duration = test.results.reduce((sum, r) => sum + r.duration, 0);

      this.testResults.push({
        title: test.title,
        suite: test.parent?.title || '',
        outcome: finalOutcome,
        duration,
        retries: test.results.length - 1,
      });

      switch (finalOutcome) {
        case 'expected':
          passedCount++;
          break;
        case 'flaky':
          passedCount++;
          flakyTests.push(test.title);
          break;
        case 'unexpected':
        case 'timedOut':
          failedCount++;
          break;
        case 'skipped':
          skippedCount++;
          break;
        default:
          console.warn(`Unknown test outcome for "${test.title}": ${finalOutcome}`);
          break;
      }
    });

    const totalDefinedTests = allTests.length;
    const passRate = totalDefinedTests > 0 ? ((passedCount / totalDefinedTests) * 100).toFixed(1) : '0.0';
    const totalDuration = Date.now() - this.startTime;

    console.log(
      `Final Summary: Total Defined: ${totalDefinedTests}, Passed: ${passedCount}, Failed: ${failedCount}, Skipped: ${skippedCount}, Flaky: ${flakyTests.length}`
    );

    // Log failure classification breakdown
    if (this.failedTests.length > 0) {
      const classificationCounts = {};
      for (const t of this.failedTests) {
        const label = t.classificationLabel || 'Unknown';
        classificationCounts[label] = (classificationCounts[label] || 0) + 1;
      }
      const breakdown = Object.entries(classificationCounts).map(([label, count]) => `${count} ${label}`).join(', ');
      console.log(`[Failure Classification] ${breakdown}`);
    }

    // Write .testResultsEnv (existing behaviour)
    const envFilePath = path.join(this.projectRoot, '.testResultsEnv');
    const envContent = `TOTAL=${totalDefinedTests}
PASSED=${passedCount}
FAILED=${failedCount}
SKIPPED=${skippedCount}`.trim();

    fs.writeFileSync(envFilePath, envContent, { encoding: 'utf8', flag: 'w' });
    console.log(`Test results written to ${envFilePath}`);

    // Read any locator healing events that occurred during the run
    const healingLogs = LocatorHealer.readPersistedLogs();
    if (healingLogs.length > 0) {
      const fromCache = healingLogs.filter(h => h.fromCache).length;
      const fromFuzzy = healingLogs.filter(h => !h.fromCache && h.reasoning?.startsWith('Fuzzy match')).length;
      const fromAI = healingLogs.length - fromCache - fromFuzzy;
      console.log(`[Locator Healer] ${healingLogs.length} locator(s) healed — ${fromCache} from cache, ${fromFuzzy} fuzzy, ${fromAI} AI`);
    }

    // Generate AI summary and write dashboard JSON
    const aiSummary = await this._generateAISummary({
      total: totalDefinedTests,
      passed: passedCount,
      failed: failedCount,
      skipped: skippedCount,
      passRate,
      flaky: flakyTests,
      failedTests: this.failedTests,
      overallStatus: result.status,
      healingLogs,
    });

    // Write the text summary
    if (aiSummary) {
      const date = new Date().toISOString();
      let fileContent = `AI Test Run Summary — ${date}\n${'='.repeat(60)}\n\n${aiSummary}\n`;

      // Append locator healing section if any healings occurred
      if (healingLogs.length > 0) {
        fileContent += `\n${'='.repeat(60)}\n`;
        fileContent += `Locator Healing Report — ${healingLogs.length} locator(s) healed during this run\n`;
        fileContent += `${'='.repeat(60)}\n\n`;
        for (const entry of healingLogs) {
          const originalStr = this._formatOriginalLocator(entry);
          const sourceLocation = entry.sourceFile
            ? `${path.basename(entry.sourceFile)}:${entry.sourceLine}`
            : 'unknown';

          const healMethod = entry.fromCache ? 'Cache' : entry.reasoning?.startsWith('Fuzzy match') ? 'Fuzzy' : 'AI';
          fileContent += `  Healed: ${entry.description}\n`;
          fileContent += `     Original:  ${originalStr}\n`;
          fileContent += `     Healed to: ${entry.healed}\n`;
          fileContent += `     Method:    ${healMethod}\n`;
          fileContent += `     Fix at:    ${sourceLocation}\n`;
          fileContent += `     Confidence: ${entry.confidence}%\n`;
          fileContent += `     Reasoning:  ${entry.reasoning}\n`;
          fileContent += `     Time: ${entry.timestamp}\n\n`;
        }
      }

      fileContent += `${'='.repeat(60)}\nRun Stats: ${passedCount}/${totalDefinedTests} passed | ${failedCount} failed | ${skippedCount} skipped | ${flakyTests.length} flaky\n`;
      const summaryPath = path.join(this.projectRoot, 'ai-summary.txt');
      fs.writeFileSync(summaryPath, fileContent, { encoding: 'utf8', flag: 'w' });
      console.log(`[AI Summary] Written to ${summaryPath}`);
    }

    // Extract distinct site names from suite titles (e.g. "Regression Site - Mini Regression Tests" → "Regression Site")
    const siteNames = [...new Set(
      this.testResults
        .map(t => t.suite?.replace(/\s*-\s*Demo Tests$/i, '').trim())
        .filter(Boolean)
    )];

    // Write structured JSON for the dashboard
    const dashboardData = {
      timestamp: new Date().toISOString(),
      overallStatus: result.status,
      durationMs: totalDuration,
      sites: siteNames,
      stats: {
        total: totalDefinedTests,
        passed: passedCount,
        failed: failedCount,
        skipped: skippedCount,
        flaky: flakyTests.length,
        passRate,
      },
      failedTests: this.failedTests,
      flakyTests,
      testResults: this.testResults,
      aiSummary: aiSummary || null,
      healingLogs,
    };

    const dashboardPublicDir = path.join(this.projectRoot, 'dashboard', 'public');
    if (!fs.existsSync(dashboardPublicDir)) {
      fs.mkdirSync(dashboardPublicDir, { recursive: true });
    }
    const jsonPath = path.join(dashboardPublicDir, 'test-run-data.json');
    fs.writeFileSync(jsonPath, JSON.stringify(dashboardData, null, 2), { encoding: 'utf8', flag: 'w' });
    console.log(`[Dashboard] Data written to ${jsonPath}`);
  }

  async _generateAISummary({ total, passed, failed, skipped, passRate, flaky, failedTests, overallStatus, healingLogs = [] }) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.warn('[AI Summary] OPENAI_API_KEY not set — skipping AI summary generation.');
      return null;
    }

    const failureLines =
      failedTests.length > 0
        ? failedTests
            .map((t, i) => `${i + 1}. [${t.status.toUpperCase()}] "${t.title}" (Suite: ${t.suite})\n   Classification: ${t.classificationLabel || 'Unknown'}\n   Error: ${t.error}`)
            .join('\n\n')
        : 'None';

    const flakyLines = flaky.length > 0 ? flaky.map((t, i) => `${i + 1}. "${t}"`).join('\n') : 'None';

    const healingLines = healingLogs.length > 0
      ? healingLogs.map((h, i) => {
          const originalStr = this._formatOriginalLocator(h);
          const sourceLocation = h.sourceFile
            ? `${path.basename(h.sourceFile)}:${h.sourceLine}`
            : 'unknown';
          const healMethod = h.fromCache ? 'Cache' : h.reasoning?.startsWith('Fuzzy match') ? 'Fuzzy' : 'AI';
          return `${i + 1}. "${h.description}"\n   Original: ${originalStr}\n   Healed to: ${h.healed}\n   Method: ${healMethod}\n   Fix at: ${sourceLocation}\n   Confidence: ${h.confidence}% — ${h.reasoning}`;
        }).join('\n\n')
      : 'None';

    const prompt = `You are a QA automation analyst reviewing a Playwright test run for a web application.

Test Run Stats:
- Overall status: ${overallStatus}
- Total tests: ${total}
- Passed: ${passed} (${passRate}%)
- Failed: ${failed}
- Skipped: ${skipped}
- Flaky (passed after retry): ${flaky.length}
- Locators healed at runtime: ${healingLogs.length}

Failed Tests:
${failureLines}

Flaky Tests:
${flakyLines}

Self-Healed Locators (locators that failed but were automatically corrected by AI during the run):
${healingLines}

Please provide a concise, structured AI-generated test run summary with the following sections:

1. **Overall Health** — One sentence on the health of this run (pass rate, severity).
2. **Failure Analysis** — Group failures by their Classification field (e.g. Locator Drift, Overlay / Element Intercept, Visibility Issue, Element Detached, Timing / Race Condition, Navigation Error, Network Error). For each group list the affected tests and a brief diagnosis. Use the classification to drive your grouping rather than guessing from the error text.
3. **Flaky Tests** — Note any flaky tests and what they might indicate.
4. **Self-Healed Locators** — If any locators were healed, summarise what changed. For each healed locator, include the exact file and line number (from the "Fix at" field) where the code needs to be updated. Note whether the healing was due to a typo, role mismatch, or a genuine UI change.

Keep the tone professional and concise. Avoid restating the raw error messages verbatim. Do NOT include a "Recommended Actions" section.`;

    try {
      console.log('[AI Summary] Generating AI test run summary via OpenAI...');
      const openaiPath = require.resolve('openai', { paths: [this.projectRoot] });
      const OpenAI = require(openaiPath).default;
      const client = new OpenAI({ apiKey });
      const response = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_completion_tokens: 10000,
        temperature: 1,
      });

      const choice = response.choices?.[0];
      const summary = choice?.message?.content?.trim() || null;

      if (!summary) {
        console.warn('[AI Summary] Empty response from model. Finish reason:', choice?.finish_reason);
        return null;
      }

      console.log('[AI Summary] Summary generated successfully.');
      return summary;
    } catch (err) {
      console.warn(`[AI Summary] Failed to generate summary: ${err?.message || err}`);
      return null;
    }
  }
  _formatOriginalLocator(entry) {
    switch (entry.type) {
      case 'role':
        return `getByRole('${entry.original.role}', { name: '${entry.original.name}' })`;
      case 'text':
        return `getByText('${entry.original.text}'${entry.original.exact ? ', { exact: true }' : ''})`;
      case 'label':
        return `getByLabel('${entry.original.label}'${entry.original.exact ? ', { exact: true }' : ''})`;
      case 'placeholder':
        return `getByPlaceholder('${entry.original.placeholder}'${entry.original.exact ? ', { exact: true }' : ''})`;
      case 'title':
        return `getByTitle('${entry.original.title}'${entry.original.exact ? ', { exact: true }' : ''})`;
      default:
        return entry.healed || 'unknown locator';
    }
  }
}

module.exports = MyReporter;
