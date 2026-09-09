# Website search and discovery

The route registry in `apps/website/src/content.ts` supplies prerendering,
canonical URLs, the sitemap, discovery text and deployment verification. Register
new public pages there, including articles supplied by the content collections.
Private access, waitlist status and feedback routes carry `noindex: true`; they
are rendered but omitted from the sitemap. Missing pages are also noindex.

Use unique, descriptive titles of at most 60 characters, including the Jackalope
suffix, and descriptions of at most 160 characters. These are editorial budgets:
Google has no fixed character limit and may truncate or rewrite previews based on
device width and the query. Do not pad concise legal or utility descriptions to
reach a minimum. Posts can set `seoTitle` independently of their editorial heading;
knowledge articles use their concise `shortTitle`.

| Page family | Search intent |
| --- | --- |
| Home | Run AI coding agents in parallel in a desktop workspace |
| Product pages | Parallel coding agents and Git worktrees for AI agents |
| Agent pages | Run Codex, Claude Code, Grok or OpenCode with project context and review |
| Feature pages | Browser automation, project context and recurring coding-agent tasks |
| Workflow guides | Run Codex and Claude Code together; review AI-generated code |
| Knowledgebase | Agent setup, troubleshooting, MCP, Git locks, quotas and schedules |
| Comparisons | Choose a coding-agent workspace for a specific workflow |
| Field notes | Practical coding-agent workflows and product development notes |

Keep the title, description and visible content aligned with the page's topic.
Use meaningful internal link labels and link each article from a discoverable hub.
The footer groups product, resources, agents and account/community links; article
hubs expose deeper pages. Do not add keyword lists or unsupported product claims.

JSON-LD describes the organization, website and current page. Blog posts use
`BlogPosting`, technical guides use `TechArticle`, hubs use `CollectionPage` and
the tour uses `VideoObject`. The homepage identifies the software without invented
prices, reviews, ratings or launch availability. The knowledgebase lists articles;
answers that only appear on those articles do not belong in FAQ markup on the hub.
Breadcrumbs use real ancestor URLs. Only content with an explicit maintained date
emits sitemap `lastmod`; do not stamp every URL with the build date.

Competitor comparisons live in `apps/website/src/comparison-content.ts`. Each has
official sources, a reviewed date, workflow rows and visible questions and answers.
The shared marketing renderer and full LLM text consume that content; the hub links
every comparison. These pages use `Article` metadata with citations and the reviewed
date. Update the sources and date together when revising claims; documented features
do not establish hands-on performance or a guarantee of current availability.

`pnpm build:website` prerenders and then checks sitemap coverage, unique metadata
and length budgets, canonicals, robots, social metadata/assets, JSON-LD, one H1 per
page, internal page/fragment links and reachability from the homepage. This also
runs inside `pnpm build` and `pnpm verify`. After publication, run
`node apps/website/scripts/verify-deployment.mjs https://jackalope.dev` to check all
registered routes, headers, the canonical redirect and the real 404 response.
Search Console indexing and rich-result eligibility require a deployed site;
local checks do not establish either.

References: Google's [title guidance](https://developers.google.com/search/docs/appearance/title-link),
[descriptions](https://developers.google.com/search/docs/appearance/snippet),
[sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap),
and [software structured data](https://developers.google.com/search/docs/appearance/structured-data/software-app).
