import { useMemo } from 'react';

/**
 * Simple Markdown to HTML converter
 * Supports: headers, bold, italic, code, links, lists, blockquotes, horizontal rules
 */
function parseMarkdown(text) {
  if (!text) return '';

  let html = text
    // Escape HTML
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

    // Code blocks (``` ... ```)
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre class="code-block${lang ? ` language-${lang}` : ''}"><code>${code.trim()}</code></pre>`;
    })

    // Inline code (`code`)
    .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')

    // Headers
    .replace(/^######\s+(.*)$/gm, '<h6>$1</h6>')
    .replace(/^#####\s+(.*)$/gm, '<h5>$1</h5>')
    .replace(/^####\s+(.*)$/gm, '<h4>$1</h4>')
    .replace(/^###\s+(.*)$/gm, '<h3>$1</h3>')
    .replace(/^##\s+(.*)$/gm, '<h2>$1</h2>')
    .replace(/^#\s+(.*)$/gm, '<h1>$1</h1>')

    // Bold and italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/___(.+?)___/g, '<strong><em>$1</em></strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/_(.+?)_/g, '<em>$1</em>')

    // Strikethrough
    .replace(/~~(.+?)~~/g, '<del>$1</del>')

    // Links [text](url)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')

    // Images ![alt](url)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="md-image" />')

    // Blockquotes
    .replace(/^>\s+(.*)$/gm, '<blockquote>$1</blockquote>')

    // Horizontal rules
    .replace(/^(-{3,}|_{3,}|\*{3,})$/gm, '<hr />')

    // Unordered lists
    .replace(/^[\*\-]\s+(.*)$/gm, '<li class="ul-item">$1</li>')

    // Ordered lists
    .replace(/^\d+\.\s+(.*)$/gm, '<li class="ol-item">$1</li>')

    // Line breaks (two spaces + newline or double newline)
    .replace(/  \n/g, '<br />')

    // Paragraphs (wrap remaining text blocks)
    .replace(/\n\n+/g, '</p><p>')

  // Wrap in paragraph if not already wrapped
  if (!html.startsWith('<')) {
    html = '<p>' + html + '</p>';
  }

  // Clean up consecutive list items into proper lists
  html = html
    .replace(/(<li class="ul-item">.*?<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`)
    .replace(/(<li class="ol-item">.*?<\/li>\n?)+/g, (match) => `<ol>${match}</ol>`)
    .replace(/<\/blockquote>\n?<blockquote>/g, '\n');

  return html;
}

/**
 * MarkdownRenderer Component
 * Renders Markdown content as styled HTML
 */
export function MarkdownRenderer({ content, className = '' }) {
  const html = useMemo(() => parseMarkdown(content), [content]);

  return (
    <div
      className={`markdown-content ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// CSS styles for the markdown content (to be added to index.css or as a style tag)
export const markdownStyles = `
.markdown-content {
  color: #e2e8f0;
  line-height: 1.7;
  font-size: 0.95rem;
}

.markdown-content h1,
.markdown-content h2,
.markdown-content h3,
.markdown-content h4,
.markdown-content h5,
.markdown-content h6 {
  color: #f1f5f9;
  font-weight: 600;
  margin-top: 1.5em;
  margin-bottom: 0.5em;
  line-height: 1.3;
}

.markdown-content h1 {
  font-size: 2em;
  border-bottom: 1px solid #334155;
  padding-bottom: 0.3em;
}

.markdown-content h2 {
  font-size: 1.5em;
  border-bottom: 1px solid #334155;
  padding-bottom: 0.3em;
}

.markdown-content h3 { font-size: 1.25em; }
.markdown-content h4 { font-size: 1.1em; }
.markdown-content h5 { font-size: 1em; }
.markdown-content h6 { font-size: 0.9em; color: #94a3b8; }

.markdown-content p {
  margin: 1em 0;
}

.markdown-content a {
  color: #4ade80;
  text-decoration: none;
}

.markdown-content a:hover {
  text-decoration: underline;
}

.markdown-content strong {
  color: #f1f5f9;
  font-weight: 600;
}

.markdown-content em {
  font-style: italic;
}

.markdown-content del {
  text-decoration: line-through;
  opacity: 0.7;
}

.markdown-content code.inline-code {
  background: #1e293b;
  color: #f472b6;
  padding: 0.2em 0.4em;
  border-radius: 4px;
  font-family: ui-monospace, monospace;
  font-size: 0.9em;
}

.markdown-content pre.code-block {
  background: #0f172a;
  border: 1px solid #334155;
  border-radius: 8px;
  padding: 1em;
  overflow-x: auto;
  margin: 1em 0;
}

.markdown-content pre.code-block code {
  font-family: ui-monospace, monospace;
  font-size: 0.9em;
  color: #e2e8f0;
}

.markdown-content blockquote {
  border-left: 4px solid #4ade80;
  margin: 1em 0;
  padding: 0.5em 1em;
  background: #1e293b;
  border-radius: 0 4px 4px 0;
  color: #94a3b8;
}

.markdown-content ul,
.markdown-content ol {
  margin: 1em 0;
  padding-left: 2em;
}

.markdown-content li {
  margin: 0.5em 0;
}

.markdown-content ul li {
  list-style-type: disc;
}

.markdown-content ol li {
  list-style-type: decimal;
}

.markdown-content hr {
  border: none;
  border-top: 1px solid #334155;
  margin: 2em 0;
}

.markdown-content img.md-image {
  max-width: 100%;
  border-radius: 8px;
  margin: 1em 0;
}
`;
