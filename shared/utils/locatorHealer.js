const fs = require('fs');
const path = require('path');
const { classifyFailure, isTimingFailureLikelyLocatorDrift } = require('./failureClassifier');

// Default project root — can be overridden via wrapPage(page, { projectRoot })
let _projectRoot = path.join(__dirname, '..');

function _getHealingLogPath() {
    return path.join(_projectRoot, '.healingLog.json');
}
function _getHealingCachePath() {
    return path.join(_projectRoot, '.healingCache.json');
}

class LocatorHealer {
    constructor(page) {
        this.page = page;
        const OpenAI = require(require.resolve('openai', { paths: [_projectRoot] }));
        this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        this.healingLog = [];
        this._healingCache = LocatorHealer._loadHealingCache();
    }


    //  Levenshtein distance for fuzzy string matching... basically its a complicated way of saying check for 'Word Similarity' ...

    static _levenshtein(a, b) {
        const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
            Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
        );
        for (let i = 1; i <= a.length; i++) {
            for (let j = 1; j <= b.length; j++) {
                matrix[i][j] = a[i - 1] === b[j - 1]
                    ? matrix[i - 1][j - 1]
                    : 1 + Math.min(matrix[i - 1][j], matrix[i][j - 1], matrix[i - 1][j - 1]);
            }
        }
        return matrix[a.length][b.length];
    }

    static _similarity(a, b) {
        if (!a || !b) return 0;
        const maxLen = Math.max(a.length, b.length);
        if (maxLen === 0) return 1;
        return 1 - LocatorHealer._levenshtein(a.toLowerCase(), b.toLowerCase()) / maxLen;
    }


    //  Healing cache: persist successful healings so we skip AI next time 

    static _loadHealingCache() {
        try {
            if (fs.existsSync(_getHealingCachePath())) {
                return JSON.parse(fs.readFileSync(_getHealingCachePath(), 'utf8'));
            }
        } catch { /* ignore corrupt cache */ }
        return {};
    }

    static _saveHealingCache(cache) {
        try {
            fs.writeFileSync(_getHealingCachePath(), JSON.stringify(cache, null, 2), 'utf8');
        } catch (err) {
            console.warn(`   ⚠️  Could not persist healing cache: ${err.message}`);
        }
    }

    /**
     * Build a deterministic cache key from the locator type and params.
     */
    static _cacheKey(type, params) {
        if (type === 'role') return `role::${params.role}::${params.name}`;
        if (type === 'text') return `text::${params.text}::${params.exact}`;
        if (type === 'label') return `label::${params.label}::${params.exact}`;
        if (type === 'placeholder') return `placeholder::${params.placeholder}::${params.exact}`;
        if (type === 'title') return `title::${params.title}::${params.exact}`;
        return `unknown::${JSON.stringify(params)}`;
    }

    /**
     * Try the cached healing for this locator. Returns a Playwright locator or null.
     */
    _tryHealingCache(type, params) {
        const key = LocatorHealer._cacheKey(type, params);
        const cached = this._healingCache[key];
        if (!cached) return null;

        console.log(`   📦 [Cache] Found cached healing: ${cached.strategy}`);
        try {
            if (cached.type === 'role') {
                return {
                    locator: (this._originalGetByRole || this.page.getByRole.bind(this.page))(cached.healedRole, { name: cached.healedName, exact: true }),
                    strategy: cached.strategy,
                    healedRole: cached.healedRole,
                    healedName: cached.healedName,
                    confidence: cached.confidence,
                    reasoning: `Cached healing from ${cached.timestamp}`,
                    fromCache: true,
                };
            } else {
                const methodMap = {
                    text: this._originalGetByText || this.page.getByText.bind(this.page),
                    label: this._originalGetByLabel || this.page.getByLabel.bind(this.page),
                    placeholder: this._originalGetByPlaceholder || this.page.getByPlaceholder.bind(this.page),
                    title: this._originalGetByTitle || this.page.getByTitle.bind(this.page),
                };
                const method = methodMap[cached.type];
                if (!method) return null;
                return {
                    locator: method(cached.healedText, { exact: true }),
                    strategy: cached.strategy,
                    healedText: cached.healedText,
                    confidence: cached.confidence,
                    reasoning: `Cached healing from ${cached.timestamp}`,
                    fromCache: true,
                };
            }
        } catch {
            return null;
        }
    }

    /**
     * Save a successful healing to the cache.
     */
    _addToHealingCache(type, params, healedResult) {
        const key = LocatorHealer._cacheKey(type, params);
        this._healingCache[key] = {
            type,
            strategy: healedResult.strategy,
            healedRole: healedResult.healedRole || null,
            healedName: healedResult.healedName || null,
            healedText: healedResult.healedText || null,
            confidence: healedResult.confidence,
            timestamp: new Date().toISOString(),
        };
        LocatorHealer._saveHealingCache(this._healingCache);
    }


    //  Fuzzy pre-check: try deterministic matching before calling AI 

    /**
     * Search the accessibility tree for a fuzzy role+name match.
     * Returns a healed result if similarity ≥ 90%, else null.
     */
    _fuzzyMatchRole(candidates, role, name) {
        if (!name) return null;
        let bestMatch = null;
        let bestScore = 0;

        for (const el of candidates) {
            // Score: 60% name similarity + 40% role match
            const nameSim = LocatorHealer._similarity(name, el.name);
            const roleBonus = el.role === role ? 1 : 0.5;
            const score = nameSim * 0.6 + roleBonus * 0.4;

            if (nameSim >= 0.9 && score > bestScore) {
                bestScore = score;
                bestMatch = el;
            }
        }

        if (!bestMatch) return null;

        const nameSim = LocatorHealer._similarity(name, bestMatch.name);
        console.log(`   ⚡ [Fuzzy] Deterministic match: role="${bestMatch.role}" name="${bestMatch.name}" (similarity: ${(nameSim * 100).toFixed(0)}%)`);

        const locator = (this._originalGetByRole || this.page.getByRole.bind(this.page))(bestMatch.role, { name: bestMatch.name, exact: true });
        return {
            locator,
            strategy: `getByRole('${bestMatch.role}', { name: '${bestMatch.name}', exact: true })`,
            healedRole: bestMatch.role,
            healedName: bestMatch.name,
            confidence: Math.round(nameSim * 100),
            reasoning: `Fuzzy match — name similarity ${(nameSim * 100).toFixed(0)}%${bestMatch.role !== role ? `, role changed from "${role}" to "${bestMatch.role}"` : ''}`,
        };
    }

    /**
     * Search for a fuzzy text match among candidates.
     * Returns a healed result if similarity ≥ 90%, else null.
     */
    _fuzzyMatchText(candidates, searchText) {
        if (!searchText) return null;
        let bestMatch = null;
        let bestScore = 0;

        for (const el of candidates) {
            const sim = LocatorHealer._similarity(searchText, el.name || el.value);
            if (sim >= 0.9 && sim > bestScore) {
                bestScore = sim;
                bestMatch = el;
            }
        }

        if (!bestMatch) return null;

        const matchedValue = bestMatch.name || bestMatch.value;
        console.log(`   ⚡ [Fuzzy] Deterministic match: "${matchedValue}" (similarity: ${(bestScore * 100).toFixed(0)}%)`);
        return { matchedValue, confidence: Math.round(bestScore * 100) };
    }

    // Extract the caller file path and line number from the stack trace.

    _getCallerLocation() {
        const stack = new Error().stack || '';
        const lines = stack.split('\n');
        for (const line of lines) {
            // Skip frames from this file and internal node/playwright frames
            if (line.includes('locatorHealer.js')) continue;
            if (!line.includes('/pages/') && !line.includes('/tests/') && !line.includes('/utils/')) continue;
            const match = line.match(/\((.+):(\d+):\d+\)/) || line.match(/at\s+(.+):(\d+):\d+/);
            if (match) {
                return { file: match[1], line: parseInt(match[2], 10) };
            }
        }
        return { file: 'unknown', line: 0 };
    }

    async _aiHealRole({ role, name, action, desc }) {
        try {
            const accessibilityTree = await this.page.accessibility.snapshot();
            if (!accessibilityTree) {
                console.log(`   ⚠️  Could not retrieve accessibility tree`);
                return null;
            }

            const elements = this._flattenAccessibilityTree(accessibilityTree);

            // Include all interactive roles so the AI can heal across role mismatches
            const interactiveRoles = new Set([
                'button', 'link', 'textbox', 'checkbox', 'radio',
                'combobox', 'menuitem', 'tab', 'switch', 'option',
            ]);
            const candidates = elements.filter(el =>
                interactiveRoles.has(el.role) || el.role === role
            );

            // ── Fuzzy pre-check: try deterministic match before calling AI ──
            const fuzzyResult = this._fuzzyMatchRole(candidates, role, name);
            if (fuzzyResult) return fuzzyResult;

            const candidateSummary = candidates.map((el, i) =>
                `[${i}] role="${el.role}" name="${el.name || ''}" description="${el.description || ''}"`
            ).join('\n');

            const prompt = `You are a test automation locator healer. A Playwright locator failed to find an element on the page.

FAILED LOCATOR:
- Method: page.getByRole('${role}', { name: '${name}', exact: true })
- Intended action: ${action}
- Description: ${desc}

AVAILABLE ELEMENTS ON PAGE (from accessibility tree):
${candidateSummary}

TASK: Identify which element (by index number) is the most likely match for the failed locator.

The failure could be caused by:
1. A typo in the name (e.g. "Editss" instead of "Edit")
2. A wrong ARIA role (e.g. role="link" when the actual element is role="button")
3. Both the role and name could be slightly off
4. The element text may have changed since the test was written

Consider ALL elements regardless of their role. The correct element might have a DIFFERENT role than what was specified.

Respond with ONLY a JSON object in this exact format (no markdown, no explanation):
{"index": <number>, "confidence": <0-100>, "reasoning": "<brief explanation>"}

If no element is a reasonable match, respond with:
{"index": -1, "confidence": 0, "reasoning": "<why no match>"}`;

            const response = await this.openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0,
                max_tokens: 200,
            });

            const content = response.choices[0].message.content.trim();
            console.log(`   🤖 AI response: ${content}`);

            const result = JSON.parse(content);

            if (result.index === -1 || result.confidence < 40) {
                console.log(`   ⚠️  AI confidence too low (${result.confidence}%): ${result.reasoning}`);
                return null;
            }

            const matchedElement = candidates[result.index];
            if (!matchedElement) {
                console.log(`   ⚠️  AI returned invalid index: ${result.index}`);
                return null;
            }

            console.log(`   🎯 AI suggests: role="${matchedElement.role}" name="${matchedElement.name}" (confidence: ${result.confidence}%)`);
            console.log(`   💡 Reasoning: ${result.reasoning}`);

            const getByRole = this._originalGetByRole || this.page.getByRole.bind(this.page);
            const healedLocator = getByRole(matchedElement.role, {
                name: matchedElement.name,
                exact: true,
            });

            return {
                locator: healedLocator,
                strategy: `getByRole('${matchedElement.role}', { name: '${matchedElement.name}', exact: true })`,
                healedRole: matchedElement.role,
                healedName: matchedElement.name,
                confidence: result.confidence,
                reasoning: result.reasoning,
            };
        } catch (error) {
            console.log(`   ⚠️  AI healing error: ${error.message}`);
            return null;
        }
    }


    async _aiHealText({ text, exact, action, desc }) {
        try {
            const accessibilityTree = await this.page.accessibility.snapshot();
            if (!accessibilityTree) {
                console.log(`   ⚠️  Could not retrieve accessibility tree`);
                return null;
            }

            const elements = this._flattenAccessibilityTree(accessibilityTree);
            const candidates = elements.filter(el => el.name && el.name.trim().length > 0);

            // ── Fuzzy pre-check: try deterministic match before calling AI ──
            const fuzzyResult = this._fuzzyMatchText(candidates, text);
            if (fuzzyResult) {
                const getByText = this._originalGetByText || this.page.getByText.bind(this.page);
                const healedLocator = getByText(fuzzyResult.matchedValue, { exact: true });
                return {
                    locator: healedLocator,
                    strategy: `getByText('${fuzzyResult.matchedValue}', { exact: true })`,
                    healedText: fuzzyResult.matchedValue,
                    confidence: fuzzyResult.confidence,
                    reasoning: `Fuzzy match — text similarity ${fuzzyResult.confidence}%`,
                };
            }

            const candidateSummary = candidates.map((el, i) =>
                `[${i}] role="${el.role}" text="${el.name}"`
            ).join('\n');

            const prompt = `You are a test automation locator healer. A Playwright getByText locator failed to find text on the page.

FAILED LOCATOR:
- Method: page.getByText('${text}'${exact ? ', { exact: true }' : ''})
- Intended action: ${action}
- Description: ${desc}

AVAILABLE TEXT CONTENT ON PAGE (from accessibility tree):
${candidateSummary}

TASK: Identify which element (by index number) contains text that is the most likely match for the failed locator.

The failure could be caused by:
1. A typo in the search text (e.g. "Submitt" instead of "Submit")
2. The text may have changed slightly since the test was written (e.g. "Save Changes" became "Save")
3. Extra whitespace or case differences
4. The text may now be part of a longer string

Respond with ONLY a JSON object in this exact format (no markdown, no explanation):
{"index": <number>, "confidence": <0-100>, "reasoning": "<brief explanation>"}

If no element is a reasonable match, respond with:
{"index": -1, "confidence": 0, "reasoning": "<why no match>"}`;

            const response = await this.openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0,
                max_tokens: 200,
            });

            const content = response.choices[0].message.content.trim();
            console.log(`   🤖 AI response: ${content}`);

            const result = JSON.parse(content);

            if (result.index === -1 || result.confidence < 40) {
                console.log(`   ⚠️  AI confidence too low (${result.confidence}%): ${result.reasoning}`);
                return null;
            }

            const matchedElement = candidates[result.index];
            if (!matchedElement) {
                console.log(`   ⚠️  AI returned invalid index: ${result.index}`);
                return null;
            }

            console.log(`   🎯 AI suggests text: "${matchedElement.name}" (confidence: ${result.confidence}%)`);
            console.log(`   💡 Reasoning: ${result.reasoning}`);

            const getByText = this._originalGetByText || this.page.getByText.bind(this.page);
            const healedLocator = getByText(matchedElement.name, { exact: true });

            return {
                locator: healedLocator,
                strategy: `getByText('${matchedElement.name}', { exact: true })`,
                healedText: matchedElement.name,
                confidence: result.confidence,
                reasoning: result.reasoning,
            };
        } catch (error) {
            console.log(`   ⚠️  AI healing error: ${error.message}`);
            return null;
        }
    }


    /**
     * AI healing for getByLabel, getByPlaceholder, and getByTitle locators.
     * Reads actual DOM attributes (title, placeholder, label text) instead of the
     * accessibility tree, since those attributes don't always map to accessible names.
     */
    async _aiHealGeneric({ strategy, searchText, exact, action, desc }) {
        try {
            // Collect candidates directly from the DOM based on strategy
            const candidates = await this.page.evaluate((strat) => {
                const results = [];
                if (strat === 'title') {
                    document.querySelectorAll('[title]').forEach(el => {
                        results.push({
                            value: el.getAttribute('title'),
                            tag: el.tagName.toLowerCase(),
                            role: el.getAttribute('role') || '',
                        });
                    });
                } else if (strat === 'placeholder') {
                    document.querySelectorAll('[placeholder]').forEach(el => {
                        results.push({
                            value: el.getAttribute('placeholder'),
                            tag: el.tagName.toLowerCase(),
                            role: el.getAttribute('role') || '',
                        });
                    });
                } else if (strat === 'label') {
                    document.querySelectorAll('label').forEach(el => {
                        const text = el.textContent?.trim();
                        if (text) {
                            results.push({
                                value: text,
                                tag: 'label',
                                forAttr: el.getAttribute('for') || '',
                            });
                        }
                    });
                    // Also include aria-label attributes
                    document.querySelectorAll('[aria-label]').forEach(el => {
                        results.push({
                            value: el.getAttribute('aria-label'),
                            tag: el.tagName.toLowerCase(),
                            role: el.getAttribute('role') || '',
                        });
                    });
                }
                return results;
            }, strategy);

            if (!candidates || candidates.length === 0) {
                console.log(`   ⚠️  No ${strategy} attributes found on the page`);
                return null;
            }

            const strategyLabels = {
                label: { method: 'getByLabel', noun: 'label', hint: 'form control label text or aria-label', attr: 'label/aria-label' },
                placeholder: { method: 'getByPlaceholder', noun: 'placeholder', hint: 'input placeholder attribute', attr: 'placeholder' },
                title: { method: 'getByTitle', noun: 'title', hint: 'element title attribute', attr: 'title' },
            };
            const info = strategyLabels[strategy];

            // ── Fuzzy pre-check: try deterministic match before calling AI ──
            const fuzzyResult = this._fuzzyMatchText(candidates, searchText);
            if (fuzzyResult) {
                const methodMap = {
                    label: this._originalGetByLabel || this.page.getByLabel.bind(this.page),
                    placeholder: this._originalGetByPlaceholder || this.page.getByPlaceholder.bind(this.page),
                    title: this._originalGetByTitle || this.page.getByTitle.bind(this.page),
                };
                const method = methodMap[strategy];
                const healedLocator = method(fuzzyResult.matchedValue, { exact: true });
                return {
                    locator: healedLocator,
                    strategy: `${info.method}('${fuzzyResult.matchedValue}', { exact: true })`,
                    healedText: fuzzyResult.matchedValue,
                    confidence: fuzzyResult.confidence,
                    reasoning: `Fuzzy match — ${strategy} similarity ${fuzzyResult.confidence}%`,
                };
            }

            const candidateSummary = candidates.map((el, i) =>
                `[${i}] ${info.attr}="${el.value}" tag=${el.tag}${el.role ? ` role="${el.role}"` : ''}`
            ).join('\n');

            const prompt = `You are a test automation locator healer. A Playwright ${info.method} locator failed to find an element on the page.

FAILED LOCATOR:
- Method: page.${info.method}('${searchText}'${exact ? ', { exact: true }' : ''})
- Intended action: ${action}
- Description: ${desc}

AVAILABLE ${info.attr.toUpperCase()} ATTRIBUTES ON PAGE (from DOM):
${candidateSummary}

TASK: Identify which element (by index number) has the ${info.noun} attribute value that best matches the failed locator's search text "${searchText}".

The failure could be caused by:
1. A typo in the ${info.noun} text (e.g. "Remmove" instead of "Remove" or "Delete")
2. The ${info.noun} text may have changed since the test was written
3. Extra whitespace or case differences

IMPORTANT: The matched value must be the FULL ${info.attr} attribute value, not a partial match.

Respond with ONLY a JSON object in this exact format (no markdown, no explanation):
{"index": <number>, "confidence": <0-100>, "reasoning": "<brief explanation>"}

If no element is a reasonable match, respond with:
{"index": -1, "confidence": 0, "reasoning": "<why no match>"}`;

            const response = await this.openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0,
                max_tokens: 200,
            });

            const content = response.choices[0].message.content.trim();
            console.log(`   🤖 AI response: ${content}`);

            const result = JSON.parse(content);

            if (result.index === -1 || result.confidence < 40) {
                console.log(`   ⚠️  AI confidence too low (${result.confidence}%): ${result.reasoning}`);
                return null;
            }

            const matchedElement = candidates[result.index];
            if (!matchedElement) {
                console.log(`   ⚠️  AI returned invalid index: ${result.index}`);
                return null;
            }

            const matchedValue = matchedElement.value;
            console.log(`   🎯 AI suggests: "${matchedValue}" (confidence: ${result.confidence}%)`);
            console.log(`   💡 Reasoning: ${result.reasoning}`);

            // Build the healed locator using the actual DOM attribute value
            let healedLocator;
            if (strategy === 'label') {
                healedLocator = (this._originalGetByLabel || this.page.getByLabel.bind(this.page))(matchedValue, { exact: true });
            } else if (strategy === 'placeholder') {
                healedLocator = (this._originalGetByPlaceholder || this.page.getByPlaceholder.bind(this.page))(matchedValue, { exact: true });
            } else {
                healedLocator = (this._originalGetByTitle || this.page.getByTitle.bind(this.page))(matchedValue, { exact: true });
            }

            return {
                locator: healedLocator,
                strategy: `${info.method}('${matchedValue}', { exact: true })`,
                healedText: matchedValue,
                confidence: result.confidence,
                reasoning: result.reasoning,
            };
        } catch (error) {
            console.log(`   ⚠️  AI healing error: ${error.message}`);
            return null;
        }
    }


    _flattenAccessibilityTree(node, result = []) {
        if (node.name || node.role !== 'generic') {
            result.push({
                role: node.role,
                name: node.name || '',
                description: node.description || '',
            });
        }
        if (node.children) {
            for (const child of node.children) {
                this._flattenAccessibilityTree(child, result);
            }
        }
        return result;
    }


    /**
     * Persist each healing event to a shared JSON file so the reporter can pick it up.
     */
    _persistHealingLog(entry) {
        try {
            let existing = [];
            if (fs.existsSync(_getHealingLogPath())) {
                existing = JSON.parse(fs.readFileSync(_getHealingLogPath(), 'utf8'));
            }
            existing.push(entry);
            fs.writeFileSync(_getHealingLogPath(), JSON.stringify(existing, null, 2), 'utf8');
        } catch (err) {
            console.warn(`   ⚠️  Could not persist healing log: ${err.message}`);
        }
    }


    /**
     * Read all persisted healing logs (used by the reporter).
     */
    static readPersistedLogs() {
        try {
            if (fs.existsSync(_getHealingLogPath())) {
                return JSON.parse(fs.readFileSync(_getHealingLogPath(), 'utf8'));
            }
        } catch { /* ignore */ }
        return [];
    }


    /**
     * Set the project root directory for healing log and cache files.
     */
    static setProjectRoot(root) {
        _projectRoot = root;
    }

    /**
     * Clear the persisted log file (call at the start of a run).
     */
    static clearPersistedLogs() {
        try {
            if (fs.existsSync(_getHealingLogPath())) {
                fs.unlinkSync(_getHealingLogPath());
            }
        } catch { /* ignore */ }
    }


    /**
     * Wrap page.getByRole and page.getByText so that ANY action (click, fill, type, etc.)
     * automatically triggers AI healing when the locator fails.
     *
     * Usage:
     *   const healer = LocatorHealer.wrapPage(page);
     *   // or with a custom project root (for shared usage across projects):
     *   const healer = LocatorHealer.wrapPage(page, { projectRoot: '/path/to/project' });
     *
     * After calling this, every page.getByRole(...).click() / .fill() / etc. will
     * auto-heal on failure — no manual healer.heal() wrapping needed.
     */
    static wrapPage(page, options = {}) {
        if (options.projectRoot) {
            _projectRoot = options.projectRoot;
        }
        const healer = new LocatorHealer(page);

        // Store original methods so the AI healing internals don't go through the wrapped versions
        healer._originalGetByRole = page.getByRole.bind(page);
        healer._originalGetByText = page.getByText.bind(page);
        healer._originalGetByLabel = page.getByLabel.bind(page);
        healer._originalGetByPlaceholder = page.getByPlaceholder.bind(page);
        healer._originalGetByTitle = page.getByTitle.bind(page);
        healer._originalLocator = page.locator.bind(page);

        // Wrap getByRole
        page.getByRole = (role, options = {}) => {
            const locator = healer._originalGetByRole(role, options);
            const callerLocation = healer._getCallerLocation();
            return healer._createHealingLocator(locator, 'role', {
                role,
                name: options.name,
                exact: options.exact !== undefined ? options.exact : true,
            }, callerLocation);
        };

        // Wrap getByText
        page.getByText = (text, options = {}) => {
            const locator = healer._originalGetByText(text, options);
            const callerLocation = healer._getCallerLocation();
            return healer._createHealingLocator(locator, 'text', {
                text,
                exact: options.exact || false,
            }, callerLocation);
        };

        // Wrap getByLabel
        page.getByLabel = (label, options = {}) => {
            const locator = healer._originalGetByLabel(label, options);
            const callerLocation = healer._getCallerLocation();
            return healer._createHealingLocator(locator, 'label', {
                label,
                exact: options.exact || false,
            }, callerLocation);
        };

        // Wrap getByPlaceholder
        page.getByPlaceholder = (placeholder, options = {}) => {
            const locator = healer._originalGetByPlaceholder(placeholder, options);
            const callerLocation = healer._getCallerLocation();
            return healer._createHealingLocator(locator, 'placeholder', {
                placeholder,
                exact: options.exact || false,
            }, callerLocation);
        };

        // Wrap getByTitle
        page.getByTitle = (title, options = {}) => {
            const locator = healer._originalGetByTitle(title, options);
            const callerLocation = healer._getCallerLocation();
            return healer._createHealingLocator(locator, 'title', {
                title,
                exact: options.exact || false,
            }, callerLocation);
        };

        // Wrap page.locator() so chained .getByRole(), .getByText() etc. also auto-heal
        page.locator = (selector, options) => {
            const locator = healer._originalLocator(selector, options);
            return healer._patchChildGetByMethods(locator);
        };

        return healer;
    }


    /**
     * Patch getBy* methods on a child locator (e.g. from page.locator('#column1'))
     * so that chained calls like .getByRole('link', { name: 'Foo' }).click() auto-heal.
     */
    _patchChildGetByMethods(locator) {
        const healer = this;

        const origGetByRole = locator.getByRole.bind(locator);
        locator.getByRole = (role, options = {}) => {
            const child = origGetByRole(role, options);
            const callerLocation = healer._getCallerLocation();
            return healer._createHealingLocator(child, 'role', {
                role,
                name: options.name,
                exact: options.exact !== undefined ? options.exact : true,
            }, callerLocation);
        };

        const origGetByText = locator.getByText.bind(locator);
        locator.getByText = (text, options = {}) => {
            const child = origGetByText(text, options);
            const callerLocation = healer._getCallerLocation();
            return healer._createHealingLocator(child, 'text', {
                text,
                exact: options.exact || false,
            }, callerLocation);
        };

        const origGetByLabel = locator.getByLabel.bind(locator);
        locator.getByLabel = (label, options = {}) => {
            const child = origGetByLabel(label, options);
            const callerLocation = healer._getCallerLocation();
            return healer._createHealingLocator(child, 'label', {
                label,
                exact: options.exact || false,
            }, callerLocation);
        };

        const origGetByPlaceholder = locator.getByPlaceholder.bind(locator);
        locator.getByPlaceholder = (placeholder, options = {}) => {
            const child = origGetByPlaceholder(placeholder, options);
            const callerLocation = healer._getCallerLocation();
            return healer._createHealingLocator(child, 'placeholder', {
                placeholder,
                exact: options.exact || false,
            }, callerLocation);
        };

        const origGetByTitle = locator.getByTitle.bind(locator);
        locator.getByTitle = (title, options = {}) => {
            const child = origGetByTitle(title, options);
            const callerLocation = healer._getCallerLocation();
            return healer._createHealingLocator(child, 'title', {
                title,
                exact: options.exact || false,
            }, callerLocation);
        };

        // Also patch .locator() on children so nested chains work:
        // page.locator('#a').locator('#b').getByRole(...)
        const origLocator = locator.locator.bind(locator);
        locator.locator = (selector, options) => {
            const child = origLocator(selector, options);
            return healer._patchChildGetByMethods(child);
        };

        return locator;
    }


    /**
     * Clone the args array and inject a timeout into the options object if one isn't
     * already provided. This ensures the first attempt fails quickly so healing has
     * time to run, even when actionTimeout is 0 (infinite).
     */
    _injectTimeout(args, method, valueFirstMethods, timeout) {
        const cloned = [...args];
        // Determine which arg index holds the options object
        const optsIndex = valueFirstMethods.has(method) ? 1 : 0;

        if (cloned.length > optsIndex && typeof cloned[optsIndex] === 'object' && cloned[optsIndex] !== null) {
            // Options object exists — only inject if no timeout is set
            if (cloned[optsIndex].timeout === undefined) {
                cloned[optsIndex] = { ...cloned[optsIndex], timeout };
            }
        } else if (cloned.length <= optsIndex) {
            // No options object — add one with the timeout
            while (cloned.length < optsIndex) cloned.push(undefined);
            cloned.push({ timeout });
        }
        // If the arg at optsIndex is not an object (e.g. no args for click()), wrap it
        else if (typeof cloned[optsIndex] !== 'object') {
            // This shouldn't happen for standard Playwright APIs, but be safe
        }

        return cloned;
    }

    /**
     * Patch action methods directly on a Playwright locator instance so that failures
     * trigger AI healing automatically. The locator remains a real Locator object,
     * so expect(locator).toBeVisible() and all other Playwright APIs work normally.
     */
    _createHealingLocator(locator, type, params, callerLocation) {
        const healer = this;
        const actionMethods = [
            'click', 'dblclick', 'fill', 'type', 'press',
            'check', 'uncheck', 'selectOption', 'hover',
            'focus', 'tap', 'scrollIntoViewIfNeeded', 'setChecked',
        ];
        // Methods where the first arg is a value (not options), so options is the second arg
        const valueFirstMethods = new Set(['fill', 'type', 'press', 'selectOption', 'setChecked']);
        const chainMethods = ['first', 'last', 'nth', 'filter', 'locator', 'and', 'or'];

        // Default timeout for the initial attempt — ensures the action fails fast enough
        // for healing to kick in, even when actionTimeout is 0 (infinite).
        const HEALER_INITIAL_TIMEOUT = 30_000;

        // Patch action methods: try original, on failure auto-heal and retry
        for (const method of actionMethods) {
            const original = locator[method].bind(locator);
            locator[method] = async (...args) => {
                // Inject a timeout on the first attempt if none was provided,
                // so we fail fast and leave time for healing + retry.
                const firstAttemptArgs = healer._injectTimeout(args, method, valueFirstMethods, HEALER_INITIAL_TIMEOUT);
                try {
                    return await original(...firstAttemptArgs);
                } catch (originalError) {
                    // Pass the original user args (without injected timeout) to autoHeal
                    // so the healed retry respects whatever timeout the caller intended.
                    return healer._autoHeal(locator, method, args, type, params, callerLocation, originalError);
                }
            };
        }

        // Patch chain methods so .first().click() etc. also get healing
        for (const method of chainMethods) {
            if (typeof locator[method] !== 'function') continue;
            const original = locator[method].bind(locator);
            locator[method] = (...args) => {
                const newLocator = original(...args);
                return healer._createHealingLocator(newLocator, type, params, callerLocation);
            };
        }

        // Patch getBy* methods on this locator so chained lookups also auto-heal
        // e.g. page.getByRole('row', { name: 'Foo' }).getByRole('button', { name: 'Edit' })
        healer._patchChildGetByMethods(locator);

        return locator;
    }


    /**
     * Internal: called by the healing proxy when an action method fails.
     */
    async _autoHeal(originalLocator, methodName, methodArgs, type, params, callerLocation, originalError) {
        const descMap = {
            role: () => `${params.role} named "${params.name}"`,
            text: () => `text "${params.text}"`,
            label: () => `label "${params.label}"`,
            placeholder: () => `placeholder "${params.placeholder}"`,
            title: () => `title "${params.title}"`,
        };
        const locatorStrMap = {
            role: () => `getByRole('${params.role}', { name: '${params.name}', exact: ${params.exact} })`,
            text: () => `getByText('${params.text}'${params.exact ? ', { exact: true }' : ''})`,
            label: () => `getByLabel('${params.label}'${params.exact ? ', { exact: true }' : ''})`,
            placeholder: () => `getByPlaceholder('${params.placeholder}'${params.exact ? ', { exact: true }' : ''})`,
            title: () => `getByTitle('${params.title}'${params.exact ? ', { exact: true }' : ''})`,
        };
        const desc = (descMap[type] || descMap.text)();
        const locatorStr = (locatorStrMap[type] || locatorStrMap.text)();

        console.log(`\n🔧 [AutoHeal] ${methodName}() failed for: ${desc}`);
        console.log(`   ↳ Attempted: ${locatorStr}`);
        console.log(`   ↳ Error: ${originalError.message.split('\n')[0]}`);

        // ── Step 0: Classify the failure before attempting healing ──
        const classification = classifyFailure(originalError.message);
        console.log(`   🏷️  [Classifier] ${classification.label}${classification.healable === false ? ' (not healable)' : ''}`);

        if (classification.healable === false) {
            console.log(`   ↳ ${classification.hint}`);
            console.log(`   ❌ [AutoHeal] Skipping healing — this is not a locator issue.`);
            // Enrich the error with classification data for the reporter
            originalError.failureClassification = classification;
            throw originalError;
        }

        if (classification.healable === 'conditional') {
            // Timing failures — check if the error also mentions locator issues
            if (!isTimingFailureLikelyLocatorDrift(originalError.message)) {
                console.log(`   ↳ ${classification.hint}`);
                console.log(`   ❌ [AutoHeal] Skipping healing — timing issue does not appear locator-related.`);
                originalError.failureClassification = classification;
                throw originalError;
            }
            console.log(`   ↳ Timing failure appears locator-related — proceeding with healing.`);
        }

        // ── Step 1: Try healing cache first (instant, no API call) ──
        const cachedResult = this._tryHealingCache(type, params);
        if (cachedResult) {
            try {
                const result = await cachedResult.locator[methodName](...methodArgs);
                console.log(`   ✅ [Cache] HEALED from cache! Used: ${cachedResult.strategy}`);

                let original;
                if (type === 'role') original = { role: params.role, name: params.name };
                else if (type === 'text') original = { text: params.text, exact: params.exact };
                else if (type === 'label') original = { label: params.label, exact: params.exact };
                else if (type === 'placeholder') original = { placeholder: params.placeholder, exact: params.exact };
                else original = { title: params.title, exact: params.exact };

                const entry = {
                    timestamp: new Date().toISOString(),
                    type,
                    original,
                    healed: cachedResult.strategy,
                    ...(type === 'role'
                        ? { healedRole: cachedResult.healedRole, healedName: cachedResult.healedName }
                        : { healedText: cachedResult.healedText }),
                    confidence: cachedResult.confidence,
                    reasoning: cachedResult.reasoning,
                    description: desc,
                    sourceFile: callerLocation.file,
                    sourceLine: callerLocation.line,
                    fromCache: true,
                };
                this.healingLog.push(entry);
                this._persistHealingLog(entry);

                return result;
            } catch {
                console.log(`   ⚠️  [Cache] Cached healing no longer works, falling through...`);
            }
        }

        // ── Step 2: Try fuzzy match + AI healing ──
        console.log(`   ↳ Attempting healing (fuzzy pre-check → AI fallback)...`);

        let healedResult;
        if (type === 'role') {
            healedResult = await this._aiHealRole({ role: params.role, name: params.name, action: methodName, desc });
        } else if (type === 'text') {
            healedResult = await this._aiHealText({ text: params.text, exact: params.exact, action: methodName, desc });
        } else {
            // label, placeholder, title
            const searchText = params.label || params.placeholder || params.title;
            healedResult = await this._aiHealGeneric({ strategy: type, searchText, exact: params.exact, action: methodName, desc });
        }

        if (healedResult) {
            try {
                const result = await healedResult.locator[methodName](...methodArgs);
                console.log(`   ✅ [AutoHeal] HEALED! Used: ${healedResult.strategy}`);

                // Save to cache for next time
                this._addToHealingCache(type, params, healedResult);

                // Build original field based on type
                let original;
                if (type === 'role') original = { role: params.role, name: params.name };
                else if (type === 'text') original = { text: params.text, exact: params.exact };
                else if (type === 'label') original = { label: params.label, exact: params.exact };
                else if (type === 'placeholder') original = { placeholder: params.placeholder, exact: params.exact };
                else original = { title: params.title, exact: params.exact };

                const entry = {
                    timestamp: new Date().toISOString(),
                    type,
                    original,
                    healed: healedResult.strategy,
                    ...(type === 'role'
                        ? { healedRole: healedResult.healedRole, healedName: healedResult.healedName }
                        : { healedText: healedResult.healedText }),
                    confidence: healedResult.confidence,
                    reasoning: healedResult.reasoning,
                    description: desc,
                    sourceFile: callerLocation.file,
                    sourceLine: callerLocation.line,
                };
                this.healingLog.push(entry);
                this._persistHealingLog(entry);

                return result;
            } catch (healedError) {
                console.log(`   ❌ [AutoHeal] Healed locator also failed: ${healedError.message.split('\n')[0]}`);
            }
        }

        console.log(`   ❌ [AutoHeal] Healing failed. Throwing original error.`);
        throw originalError;
    }


    getHealingReport() {
        if (this.healingLog.length === 0) return null;
        console.log('\n📋 ========== LOCATOR HEALING REPORT ==========');
        for (const entry of this.healingLog) {
            console.log(`\n  🔧 Healed: ${entry.description}`);
            const origStr = entry.type === 'role'
                ? `getByRole('${entry.original.role}', { name: '${entry.original.name}' })`
                : entry.type === 'label' ? `getByLabel('${entry.original.label}')`
                : entry.type === 'placeholder' ? `getByPlaceholder('${entry.original.placeholder}')`
                : entry.type === 'title' ? `getByTitle('${entry.original.title}')`
                : `getByText('${entry.original.text}'${entry.original.exact ? ', { exact: true }' : ''})`;
            console.log(`     Original: ${origStr}`);
            console.log(`     Healed to: ${entry.healed}`);
            if (entry.sourceFile) {
                const shortFile = path.basename(entry.sourceFile);
                console.log(`     Fix at: ${shortFile}:${entry.sourceLine}`);
            }
            console.log(`     Time: ${entry.timestamp}`);
        }
        console.log('\n📋 =============================================\n');
        return this.healingLog;
    }
}

module.exports = LocatorHealer;
