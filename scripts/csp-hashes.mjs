// CSP hashes of a page's inline <script> and <style> elements, exactly as they appear in the HTML.
import { createHash } from 'node:crypto';

export const sha = (s) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;

export function inlineHashes(html) {
  const scripts = [...html.matchAll(/<script\b(?![^>]*\ssrc=)([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((m) => !/type=["']?application\/(ld\+)?json/i.test(m[1])) // data, not executed
    .map((m) => sha(m[2]));
  const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => sha(m[1]));
  return { scripts, styles };
}
