# jimit.site

Astro static site. Node 22+. `npm install`, then `npm run dev` (drafts show with a DRAFT banner).

1. Start a post: `npm run new -- writeup "HTB Reactor"` (types: writeup, methodology, project, blog), or import one from the drafts doc with `npm run import-draft -- post.md`.
2. Write in `src/content/posts/<slug>/index.md`. Put screenshots beside it as `01-what-it-shows.png`, embedded with `![alt text](./01-what-it-shows.png "Caption")`.
3. Replace every `[VERIFY]`, `[SCREENSHOT]` and `[YOUR WORDS]`. `npm run check:posts -- --all` lists what's left.
4. Publish: set `draft: false`, run `npm run build`, then commit and push to `main`. The build fails if the post is unfinished.

Post format and block types: see `src/content/posts/kitchen-sink/index.md`.
