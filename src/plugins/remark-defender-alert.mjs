import { visit } from 'unist-util-visit';

/**
 * Adds a `> [!DEFENDER]` callout alongside remark-github-blockquote-alert's
 * NOTE / TIP / IMPORTANT / WARNING / CAUTION. Output uses the same markup
 * (div.markdown-alert > p.markdown-alert-title) so one stylesheet covers all.
 * Must run before remark-github-blockquote-alert.
 */
const MARKER = /^\[!DEFENDER\][ \t]*\n?/i;

// Shield with a check mark, 16x16 (matches the octicon size used by the other alerts).
const SHIELD =
  'M7.47.22a.75.75 0 0 1 1.06 0c1.33 1.3 3.39 2.03 5.72 2.03a.75.75 0 0 1 .75.75v4.5c0 4.05-2.42 6.88-6.72 8.45a.75.75 0 0 1-.56 0C3.42 14.38 1 11.55 1 7.5V3a.75.75 0 0 1 .75-.75c2.33 0 4.39-.73 5.72-2.03ZM2.5 3.73V7.5c0 3.3 1.86 5.65 5.5 7.05 3.64-1.4 5.5-3.75 5.5-7.05V3.73c-2.08-.12-3.98-.75-5.5-1.95-1.52 1.2-3.42 1.83-5.5 1.95Zm8.28 2.04a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0l-1.5-1.5a.75.75 0 1 1 1.06-1.06L7 8.49l2.72-2.72a.75.75 0 0 1 1.06 0Z';

export default function remarkDefenderAlert() {
  return (tree) => {
    visit(tree, 'blockquote', (node) => {
      const first = node.children[0];
      if (!first || first.type !== 'paragraph') return;
      const text = first.children[0];
      if (!text || text.type !== 'text' || !MARKER.test(text.value)) return;

      const rest = text.value.replace(MARKER, '').replace(/^[ \t]+/, '');
      if (rest) {
        first.children[0] = { type: 'text', value: rest };
      } else {
        first.children.shift();
        if (first.children[0]?.type === 'break') first.children.shift();
      }
      if (first.children.length === 0) node.children.shift();

      node.data = {
        hName: 'div',
        hProperties: { className: ['markdown-alert', 'markdown-alert-defender'], dir: 'auto' },
      };
      node.children.unshift({
        type: 'paragraph',
        data: { hProperties: { className: ['markdown-alert-title'], dir: 'auto' } },
        children: [
          {
            type: 'emphasis',
            data: {
              hName: 'svg',
              hProperties: { className: ['octicon'], viewBox: '0 0 16 16', width: '16', height: '16', ariaHidden: 'true' },
            },
            children: [{ type: 'emphasis', data: { hName: 'path', hProperties: { d: SHIELD } }, children: [] }],
          },
          { type: 'text', value: 'Defender view' },
        ],
      });
    });
  };
}
