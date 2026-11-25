import { visit, SKIP } from 'unist-util-visit';
import svgToDataUri from 'mini-svg-data-uri';

/**
 * Shrink and size a Mermaid SVG data URI: give the <svg> real pixel dimensions (Mermaid emits
 * width="100%", which <img> treats as 300 px wide), round coordinates to 2 decimals, and drop
 * data-points attributes. Typically cuts the file by half or more.
 */
function tidyMermaidSvg(uri, width, height) {
  const svg = decodeURIComponent(String(uri).slice(String(uri).indexOf(',') + 1))
    .replace(/<svg([^>]*?)\swidth=(['"])100%\2/, `<svg$1 width='${width}' height='${height}'`)
    .replace(/\sdata-points=(['"])[^'"]*\1/g, '')
    .replace(/-?\d+\.\d{3,}/g, (n) => String(Math.round(Number(n) * 100) / 100));
  return svgToDataUri(svg);
}

const REDACTED = '[REDACTED]';

/**
 * `[REDACTED]` in prose becomes an inline black bar that keeps the word visible,
 * so readers know something was removed on purpose. Code blocks are left alone.
 */
export function rehypeRedact() {
  return (tree) => {
    visit(tree, (node, index, parent) => {
      if (node.type === 'element' && (node.tagName === 'pre' || node.tagName === 'code')) return SKIP;
      if (node.type !== 'text' || !parent || index === undefined || !node.value.includes(REDACTED)) return;

      const parts = node.value.split(REDACTED);
      const out = [];
      parts.forEach((part, i) => {
        if (part) out.push({ type: 'text', value: part });
        if (i < parts.length - 1) {
          out.push({
            type: 'element',
            tagName: 'span',
            properties: { className: ['redacted'], title: 'Redacted on purpose' },
            children: [{ type: 'text', value: 'REDACTED' }],
          });
        }
      });
      parent.children.splice(index, 1, ...out);
      return [SKIP, index + out.length];
    });
  };
}

/**
 * A paragraph holding only an image becomes <figure> with a <figcaption> taken
 * from the image's Markdown title: ![alt](./01-nmap.png "Caption").
 */
export function rehypeFigure() {
  return (tree) => {
    visit(tree, 'element', (node, index, parent) => {
      if (node.tagName !== 'p' || !parent || index === undefined) return;
      const kids = node.children.filter((c) => !(c.type === 'text' && !c.value.trim()));
      if (kids.length !== 1 || kids[0].type !== 'element' || kids[0].tagName !== 'img') return;

      const img = kids[0];
      const caption = typeof img.properties?.title === 'string' ? img.properties.title.trim() : '';
      if (img.properties) {
        delete img.properties.title;
        // Images never exceed the ~70ch text column, so tell the browser that.
        img.properties.sizes = '(min-width: 48rem) 44rem, calc(100vw - 2rem)';
      }

      const figure = {
        type: 'element',
        tagName: 'figure',
        properties: { className: ['post-figure'] },
        children: [img],
      };
      if (caption) {
        figure.children.push({
          type: 'element',
          tagName: 'figcaption',
          properties: {},
          children: [{ type: 'text', value: caption }],
        });
      }
      parent.children[index] = figure;
      return SKIP;
    });
  };
}

/**
 * Wrap tables in a focusable, labelled scroll region so wide tables scroll
 * sideways on phones (and can be scrolled with the keyboard).
 */
export function rehypeTableWrap() {
  return (tree) => {
    visit(tree, 'element', (node, index, parent) => {
      if (node.tagName !== 'table' || !parent || index === undefined) return;
      if (parent.type === 'element' && parent.properties?.className?.includes?.('table-wrap')) return;
      parent.children[index] = {
        type: 'element',
        tagName: 'div',
        properties: { className: ['table-wrap'], tabIndex: 0, role: 'region', ariaLabel: 'Table (scrolls sideways)' },
        children: [node],
      };
      return SKIP;
    });
  };
}

/**
 * rehype-mermaid (with `dark`) emits <picture><source media="(prefers-color-scheme: dark)"><img></picture>.
 * That follows the OS setting, not the site's theme toggle, and its alt text is only accDescr.
 * Turn each diagram into a figure holding a light and a dark <img>, shown by [data-theme] in CSS:
 *   alt        = accDescr (or accTitle when there's no description)
 *   figcaption = accTitle
 */
export function rehypeMermaidFigure() {
  return (tree) => {
    visit(tree, 'element', (node, index, parent) => {
      if (node.tagName !== 'picture' || !parent || index === undefined) return;
      const img = node.children.find((c) => c.type === 'element' && c.tagName === 'img');
      const source = node.children.find((c) => c.type === 'element' && c.tagName === 'source');
      if (!img || !String(img.properties?.id ?? '').startsWith('mermaid')) return;

      const title = String(img.properties.title ?? '').trim();
      const desc = String(img.properties.alt ?? '').trim();
      const alt = desc || title;
      const mk = (src, w, h, cls) => {
        const width = Math.ceil(Number(w));
        const height = Math.ceil(Number(h));
        return {
          type: 'element',
          tagName: 'img',
          properties: { src: tidyMermaidSvg(src, width, height), alt, width, height, className: ['mermaid-img', cls], decoding: 'async', loading: 'lazy' },
          children: [],
        };
      };
      const images = [mk(img.properties.src, img.properties.width, img.properties.height, 'mermaid-light')];
      if (source) images.push(mk(source.properties.srcSet ?? source.properties.srcset, source.properties.width, source.properties.height, 'mermaid-dark'));

      const figure = {
        type: 'element',
        tagName: 'figure',
        properties: { className: ['post-figure', 'mermaid-figure'] },
        children: [{ type: 'element', tagName: 'span', properties: { className: ['mermaid-images'] }, children: images }],
      };
      if (title) figure.children.push({ type: 'element', tagName: 'figcaption', properties: {}, children: [{ type: 'text', value: title }] });
      parent.children[index] = figure;
      return SKIP;
    });
  };
}
