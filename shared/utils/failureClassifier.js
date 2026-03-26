/**
 * Classifies Test action failures by root cause.
 *
 * Analyses the error message (and optionally the page state too) to determine
 * whether a failure is caused by locator drift, an overlay, a timing issue,
 * element detachment, visibility, or a network/navigation problem.
 *
 * Used by the LocatorHealer as well (obviously !!) to skip healing for non-locator failures,
 * AND by the reporter to group failures by root cause.
 */

const CLASSIFICATIONS = {
    LOCATOR_DRIFT: 'locator_drift',
    OVERLAY: 'overlay',
    VISIBILITY: 'visibility',
    DETACHMENT: 'detachment',
    TIMING: 'timing',
    NAVIGATION: 'navigation',
    NETWORK: 'network',
    UNKNOWN: 'unknown',
};

const CLASSIFICATION_LABELS = {
    [CLASSIFICATIONS.LOCATOR_DRIFT]: 'Locator Drift',
    [CLASSIFICATIONS.OVERLAY]: 'Overlay / Element Intercept',
    [CLASSIFICATIONS.VISIBILITY]: 'Visibility Issue',
    [CLASSIFICATIONS.DETACHMENT]: 'Element Detached',
    [CLASSIFICATIONS.TIMING]: 'Timing / Race Condition',
    [CLASSIFICATIONS.NAVIGATION]: 'Navigation Error',
    [CLASSIFICATIONS.NETWORK]: 'Network Error',
    [CLASSIFICATIONS.UNKNOWN]: 'Unknown',
};

// Each pattern group is checked in order. The first match wins Yayyy!!!

// Oh and also, More specific patterns go before broader ones.. because Why Not !!

const PATTERN_RULES = [
    //  Overlay / intercept 
    {
        classification: CLASSIFICATIONS.OVERLAY,
        patterns: [
            'element is intercepted by another element',
            'intercept',
            'another element would receive the click',
            'pointer event at',
            'element is covered by',
        ],
        healable: false,
        hint: 'Another element (modal, toast, dropdown, cookie banner) is blocking the target element.',
    },

    //  Detachment 
    {
        classification: CLASSIFICATIONS.DETACHMENT,
        patterns: [
            'element is detached from the dom',
            'element is not attached',
            'node is detached',
            'stale element reference',
            'element handle refers to a closed',
        ],
        healable: false,
        hint: 'The element was in the DOM but got removed or re-rendered before the action could complete.',
    },

    //  Navigation 
    {
        classification: CLASSIFICATIONS.NAVIGATION,
        patterns: [
            'execution context was destroyed',
            'navigating frame was detached',
            'frame was detached',
            'page closed',
            'target closed',
            'session closed',
            'browser has been closed',
            'page.goto:',
            'net::err_aborted',
        ],
        healable: false,
        hint: 'The page navigated away, the frame was destroyed, or the browser/tab closed during the action.',
    },

    //  Network 
    {
        classification: CLASSIFICATIONS.NETWORK,
        patterns: [
            'net::err_',
            'err_connection',
            'err_name_not_resolved',
            'err_timed_out',
            'err_ssl',
            'err_cert',
            'request failed',
            'fetch failed',
            'econnrefused',
            'enotfound',
            'socket hang up',
            'network error',
        ],
        healable: false,
        hint: 'A network-level failure occurred — DNS, SSL, connection refused, or request timeout.',
    },

    //  Visibility 
    {
        classification: CLASSIFICATIONS.VISIBILITY,
        patterns: [
            'element is not visible',
            'element is hidden',
            'element is outside of the viewport',
            'element has zero size',
            'element is not displayed',
            'visibility: hidden',
            'display: none',
            'has no size',
            'is not in the viewport',
        ],
        healable: false,
        hint: 'The element exists in the DOM but is not visible — hidden, off-screen, or has zero dimensions.',
    },

    //  Timing / race condition 
    {
        classification: CLASSIFICATIONS.TIMING,
        patterns: [
            'timeout exceeded',
            'test timeout of',
            'waiting for condition',
            'waiting for event',
            'page.waitfor',
            'locator.waitfor',
            'expect.tobehidden exceeded timeout',
            'expect.tobevisible exceeded timeout',
            'expect.tohavetext exceeded timeout',
            'expect.tohavevalue exceeded timeout',
        ],
        // Timing failures MIGHT be locator drift (element never appeared because the name changed)
        // so we mark these as conditionally healable — the classifier will check further.
        healable: 'conditional',
        hint: 'The action timed out waiting for a condition. Could be slow page load or a locator that no longer matches.',
    },

    //  Locator drift (catch-all for "not found" patterns) 
    {
        classification: CLASSIFICATIONS.LOCATOR_DRIFT,
        patterns: [
            'waiting for locator',
            'no element matches locator',
            'locator resolved to',
            'expected to find element',
            'unable to find',
            'could not find',
            'no matching element',
            'strict mode violation',
            'resolved to 0 elements',
        ],
        healable: true,
        hint: 'The locator no longer matches any element on the page — likely a text, role, or attribute change.',
    },
];


/**
 * Classify a Playwright error by its root cause.
 *
 * @param {string} errorMessage - The error message from the failed action
 * @returns {{ classification: string, label: string, healable: boolean|'conditional', hint: string }}
 */
function classifyFailure(errorMessage) {
    if (!errorMessage) {
        return {
            classification: CLASSIFICATIONS.UNKNOWN,
            label: CLASSIFICATION_LABELS[CLASSIFICATIONS.UNKNOWN],
            healable: true, // unknown errors should still attempt healing as a fallback
            hint: 'No error message available for classification.',
        };
    }

    const lowerMessage = errorMessage.toLowerCase();

    for (const rule of PATTERN_RULES) {
        for (const pattern of rule.patterns) {
            if (lowerMessage.includes(pattern)) {
                return {
                    classification: rule.classification,
                    label: CLASSIFICATION_LABELS[rule.classification],
                    healable: rule.healable,
                    hint: rule.hint,
                };
            }
        }
    }

    // No pattern matched — default to unknown, allow healing as fallback
    return {
        classification: CLASSIFICATIONS.UNKNOWN,
        label: CLASSIFICATION_LABELS[CLASSIFICATIONS.UNKNOWN],
        healable: true,
        hint: 'Error did not match any known failure pattern.',
    };
}


/**
 * Check if a timing failure is actually locator drift by inspecting the full error.
 * Timing errors that mention locators waiting for elements are likely locator drift.
 *
 * @param {string} errorMessage
 * @returns {boolean} true if the timing failure looks like locator drift
 */
function isTimingFailureLikelyLocatorDrift(errorMessage) {
    if (!errorMessage) return false;
    const lower = errorMessage.toLowerCase();
    return (
        lower.includes('waiting for locator') ||
        lower.includes('locator resolved to') ||
        lower.includes('no element matches') ||
        lower.includes('resolved to 0 elements')
    );
}


module.exports = {
    classifyFailure,
    isTimingFailureLikelyLocatorDrift,
    CLASSIFICATIONS,
    CLASSIFICATION_LABELS,
};
