// @ts-check
import { defineConfig } from 'astro/config';
import { unified, rehypeHeadingIds } from '@astrojs/markdown-remark';
import expressiveCode from 'astro-expressive-code';
import sitemap from '@astrojs/sitemap';
import remarkAlert from 'remark-github-blockquote-alert';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import remarkDefenderAlert from './src/plugins/remark-defender-alert.mjs';
import rehypeMermaid from 'rehype-mermaid';
import { rehypeRedact, rehypeFigure, rehypeTableWrap, rehypeMermaidFigure } from './src/plugins/rehype-post-blocks.mjs';

// Mermaid diagrams become SVG images at build time (headless Chromium via Playwright).
// SVG-in-<img> can't load web fonts, so use fonts every OS has; text labels avoid foreignObject.
const mermaidFont = "Helvetica, Arial, 'Liberation Sans', sans-serif";
const mermaidBase = { fontFamily: mermaidFont, htmlLabels: false, flowchart: { htmlLabels: false }, theme: 'base' };
const mermaidLight = {
  ...mermaidBase,
  themeVariables: {
    fontFamily: mermaidFont, fontSize: '15px', background: '#ffffff',
    primaryColor: '#e6f2ea', primaryBorderColor: '#157a3c', primaryTextColor: '#1b1f23',
    secondaryColor: '#efefe8', tertiaryColor: '#ffffff', lineColor: '#555e68', textColor: '#1b1f23',
    edgeLabelBackground: '#ffffff', clusterBkg: '#f7f7f2', clusterBorder: '#dcdcd2',
  },
};
const mermaidDark = {
  ...mermaidBase,
  themeVariables: {
    darkMode: true, fontFamily: mermaidFont, fontSize: '15px', background: '#10161d',
    primaryColor: '#13261b', primaryBorderColor: '#4ade80', primaryTextColor: '#e6edf3',
    secondaryColor: '#17202b', tertiaryColor: '#111821', lineColor: '#8b98a8', textColor: '#e6edf3',
    edgeLabelBackground: '#10161d', clusterBkg: '#0d131a', clusterBorder: '#233040',
  },
};

// https://astro.build/config
export default defineConfig({
  site: 'https://jimit.site',
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'file' },
  devToolbar: { enabled: false },
  // Vite would inline small font subsets as data: URIs, which font-src 'self' blocks.
  // Fonts always become files; everything else keeps Vite's default (inline under 4 KB).
  vite: { build: { assetsInlineLimit: (file) => (/\.woff2?$/.test(file) ? false : undefined) } },

  // Content Security Policy, delivered as a <meta> tag with hashes of every inline script and
  // <style> Astro emits. No 'unsafe-inline' and no 'unsafe-eval'. Inline style="" attributes are
  // moved into a stylesheet after the build (scripts/csp-postbuild.mjs). frame-ancestors can't be set from a <meta> tag; netlify.toml sends it as a header.
  // The search page adds 'wasm-unsafe-eval' for Pagefind's WebAssembly (src/pages/search.astro).
  security: {
    csp: {
      algorithm: 'SHA-256',
      directives: [
        "default-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'none'",
        "manifest-src 'self'",
        "worker-src 'self'", // Pagefind searches in a Web Worker
        "frame-src 'none'",
      ],
      // No 'unsafe-inline' or 'unsafe-hashes', so inline event handlers and style="" are blocked too.
      scriptDirective: { resources: ["'self'"] },
      styleDirective: { resources: ["'self'"] },
    },
  },

  // Markdown images get srcset/sizes so phones download smaller files.
  image: { layout: 'constrained', responsiveStyles: false },

  markdown: {
    // Expressive Code highlights code; Astro's own Shiki pass (inline styles) is off.
    syntaxHighlight: false,
    // Astro 7 defaults to Sätteri; the spec's remark/rehype plugins need the unified processor.
    processor: unified({
      remarkPlugins: [remarkDefenderAlert, remarkAlert],
      rehypePlugins: [
        [rehypeMermaid, { strategy: 'img-svg', colorScheme: 'light', mermaidConfig: mermaidLight, dark: mermaidDark }],
        rehypeMermaidFigure,
        rehypeHeadingIds,
        [
          rehypeAutolinkHeadings,
          {
            behavior: 'append',
            test: ['h2', 'h3', 'h4'],
            properties: { className: ['heading-anchor'], dataPagefindIgnore: '' },
            content: [
              { type: 'element', tagName: 'span', properties: { ariaHidden: 'true' }, children: [{ type: 'text', value: '#' }] },
              { type: 'element', tagName: 'span', properties: { className: ['visually-hidden'] }, children: [{ type: 'text', value: 'Link to this section' }] },
            ],
          },
        ],
        rehypeRedact,
        rehypeFigure,
        rehypeTableWrap,
      ],
    }),
  },

  integrations: [
    // Only pages that exist in the build are listed, so drafts never appear here.
    sitemap({ filter: (page) => !/\/(search|404)$/.test(new URL(page).pathname) }),
    expressiveCode({
      themes: ['github-light', 'github-dark'],
      // The page theme lives on <html data-theme>; code blocks follow it.
      useDarkModeMediaQuery: false,
      themeCssSelector: (theme) => `[data-theme='${theme.type}']`,
      minSyntaxHighlightingColorContrast: 5.5,
      styleOverrides: {
        codeFontFamily: 'var(--font-mono)',
        uiFontFamily: 'var(--font-mono)',
        codeFontSize: '0.84rem',
        codeLineHeight: '1.65',
        borderRadius: '10px',
        borderColor: 'var(--border)',
        codeBackground: 'var(--code-bg)',
        frames: {
          shadowColor: 'transparent',
          editorBackground: 'var(--code-bg)',
          terminalBackground: 'var(--code-bg)',
          editorTabBarBackground: 'var(--surface-2)',
          editorActiveTabBackground: 'var(--code-bg)',
          editorActiveTabIndicatorBottomColor: 'transparent',
          editorActiveTabIndicatorTopColor: 'var(--accent)',
          terminalTitlebarBackground: 'var(--surface-2)',
          terminalTitlebarBorderBottomColor: 'var(--border)',
          editorTabBarBorderBottomColor: 'var(--border)',
        },
      },
      defaultProps: {
        wrap: false,
      },
    }),
  ],
});
