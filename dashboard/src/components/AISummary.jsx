import React from 'react'

function parseMarkdown(text) {
  if (!text) return null;

  const lines = text.split('\n');
  const sections = [];
  let currentSection = null;

  // Stack of nested list contexts: each entry is an array of items
  // Items can be { text, children: [] }
  let listStack = [];
  let listBaseIndent = 0; // indent level of the first bullet in the current list

  const inlineFormat = (str) => {
    return str
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>');
  };

  // Measure the indent level of a line (number of leading spaces / 2)
  const indentLevel = (raw) => {
    const match = raw.match(/^(\s*)/);
    return Math.floor((match ? match[1].length : 0) / 2);
  };

  // Check if a line is a bullet (after trimming)
  const isBullet = (trimmed) => /^[-*]\s/.test(trimmed);
  const bulletText = (trimmed) => trimmed.replace(/^[-*]\s/, '');

  // Flush accumulated list stack into current section
  const flushLists = () => {
    if (listStack.length > 0 && currentSection) {
      currentSection.children.push({ type: 'nestedList', root: listStack[0] });
      listStack = [];
    }
  };

  const pushSection = () => {
    flushLists();
    if (currentSection) {
      sections.push(currentSection);
    }
  };

  // Is this a top-level heading?
  // Matches: "1. Overall Health", "1. **Overall Health**", "## Heading"
  const isTopHeading = (trimmed) =>
    /^\d+\.\s+\S/.test(trimmed) || /^#{1,3}\s/.test(trimmed);

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    if (!trimmed) continue;

    // Top-level heading
    if (isTopHeading(trimmed)) {
      pushSection();
      let heading = '';
      let trailingText = '';

      if (/^\d+\.\s/.test(trimmed)) {
        // "1. **Overall Health** — desc" or "1. Overall Health"
        const boldMatch = trimmed.match(/^\d+\.\s*\*\*(.+?)\*\*\s*(.*)/);
        if (boldMatch) {
          heading = boldMatch[1];
          trailingText = boldMatch[2]?.replace(/^[—–-]\s*/, '').trim() || '';
        } else {
          heading = trimmed.replace(/^\d+\.\s*/, '').replace(/\*\*/g, '');
        }
      } else {
        heading = trimmed.replace(/^#+\s*/, '').replace(/\*\*/g, '');
      }

      currentSection = { heading, children: [] };
      if (trailingText) {
        currentSection.children.push({ type: 'p', text: trailingText });
      }
      continue;
    }

    // Ensure we have a section
    if (!currentSection) {
      currentSection = { heading: null, children: [] };
    }

    // Bullet line
    if (isBullet(trimmed)) {
      const level = indentLevel(rawLine);
      const text = bulletText(trimmed);

      const item = { text, children: [] };

      if (listStack.length === 0) {
        // First bullet — start a new root list and record its base indent
        listBaseIndent = level;
        listStack = [{ text: null, children: [item] }];
      } else {
        // Normalize indent relative to the first bullet in this list
        const relLevel = level - listBaseIndent;

        if (relLevel <= 0) {
          // Same level (or less) as the first bullet — add as sibling
          listStack[0].children.push(item);
        } else {
          // Deeper indent — nest under the last item at the appropriate depth
          const parentList = listStack[0];
          let parent = parentList;
          for (let d = 0; d < relLevel && parent.children.length > 0; d++) {
            parent = parent.children[parent.children.length - 1];
          }
          parent.children.push(item);
        }
      }
      continue;
    }

    // Regular paragraph
    flushLists();
    currentSection.children.push({ type: 'p', text: trimmed });
  }

  pushSection();

  // Recursive renderer for nested lists
  const renderList = (node, depth = 0) => {
    if (!node.children || node.children.length === 0) return null;
    return (
      <ul className={depth > 0 ? 'nested-list' : undefined}>
        {node.children.map((item, i) => (
          <li key={i}>
            <span dangerouslySetInnerHTML={{ __html: inlineFormat(item.text) }} />
            {item.children.length > 0 && renderList(item, depth + 1)}
          </li>
        ))}
      </ul>
    );
  };

  return sections.map((section, si) => (
    <div key={`section-${si}`} className="summary-section">
      {section.heading && <h3>{section.heading}</h3>}
      <div className="summary-section-body">
        {section.children.map((child, ci) => {
          if (child.type === 'p') {
            return (
              <p
                key={`p-${si}-${ci}`}
                dangerouslySetInnerHTML={{ __html: inlineFormat(child.text) }}
              />
            );
          }
          if (child.type === 'nestedList') {
            return (
              <div key={`nl-${si}-${ci}`}>
                {renderList(child.root)}
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  ));
}

export default function AISummary({ summary }) {
  return (
    <div className="summary-card">
      <h2>
        Test Execution Summary <span className="ai-badge">AI</span>
      </h2>
      {summary ? (
        <div className="summary-content">{parseMarkdown(summary)}</div>
      ) : (
        <p className="no-summary">
          No AI summary available. Ensure OPENAI_API_KEY is set when running tests.
        </p>
      )}
    </div>
  );
}
