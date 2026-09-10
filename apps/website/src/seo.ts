import { guideMarkdown, knowledgeFiles } from '@jackalope/knowledge';
import { serializeBlogPost } from './blog-types.ts';
import { company, normalizePath, pages, posts, siteOrigin, tour, updates } from './content.ts';
import { knowledgeGuides } from './knowledge-content.ts';
import { type MarketingPage, marketingPages } from './marketing-content.ts';

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ||
      character,
  );
export const routes = pages.map((page) => page.path);
export const indexablePages = pages.filter((page) => !page.noindex);

function lastModified(path: string) {
  const comparison = marketingPages.find((page) => page.path === path)?.comparison;
  if (comparison) return comparison.reviewed;
  if (path === '/compare/') return '2026-09-09';
  if (path === '/tour/') return tour.published;
  if (path === '/changelog/') return updates[0]?.date;
  if (path === '/blog/') return posts[0]?.date;
  return posts.find((post) => path === `/blog/${post.slug}/`)?.date;
}

export function pageHtml(html: string, path: string, origin = siteOrigin) {
  const normalized = normalizePath(path);
  const page = pages.find((item) => item.path === normalized);
  const post = posts.find((item) => normalized === `/blog/${item.slug}/`);
  const marketingPage = marketingPages.find((item) => item.path === normalized);
  const comparison = marketingPage?.comparison;
  const guide = knowledgeGuides.find((item) => normalized === `/knowledge/${item.slug}/`);
  const title = page?.title || 'Page not found | Jackalope';
  const description = page?.description || 'Find your way back to Jackalope.';
  const url = `${origin}${normalized}`;
  const isArticle = Boolean(post || guide || comparison || normalized.startsWith('/guides/'));
  const graph: Record<string, unknown>[] = [
    {
      '@type': 'Organization',
      '@id': `${origin}/#organization`,
      name: 'Jackalope',
      url: origin,
      description: pages[0].description,
      logo: `${origin}/icon-256.png`,
      sameAs: ['https://x.com/JackalopeDotDev'],
      parentOrganization: { '@type': 'Organization', name: company.name, url: company.url },
    },
    {
      '@type': 'WebSite',
      '@id': `${origin}/#website`,
      name: 'Jackalope',
      url: origin,
      publisher: { '@id': `${origin}/#organization` },
    },
    {
      '@type': post
        ? 'BlogPosting'
        : comparison
          ? 'Article'
          : isArticle
            ? 'TechArticle'
            : normalized === '/blog/' ||
                normalized === '/changelog/' ||
                normalized === '/agents/' ||
                normalized === '/knowledge/' ||
                normalized === '/compare/'
              ? 'CollectionPage'
              : 'WebPage',
      '@id': url,
      url,
      name: title,
      headline: post?.title || guide?.title || marketingPage?.headline || title,
      description,
      inLanguage: 'en',
      isPartOf: { '@id': `${origin}/#website` },
      ...(comparison
        ? {
            datePublished: comparison.reviewed,
            dateModified: comparison.reviewed,
            author: { '@id': `${origin}/#organization` },
            publisher: { '@id': `${origin}/#organization` },
            image: `${origin}/social-preview.png`,
            mainEntityOfPage: url,
            citation: comparison.sources.map((source) => source.href),
            about: [
              { '@type': 'SoftwareApplication', name: 'Jackalope', url: origin },
              {
                '@type': 'SoftwareApplication',
                name: comparison.name,
                url: comparison.sources[0].href,
              },
            ],
          }
        : post
          ? {
              datePublished: post.date,
              dateModified: post.date,
              author: { '@type': 'Organization', name: company.name, url: company.url },
              publisher: { '@id': `${origin}/#organization` },
              image: `${origin}/social-preview.png`,
              mainEntityOfPage: url,
            }
          : isArticle
            ? {
                author: { '@type': 'Organization', name: company.name, url: company.url },
                publisher: { '@id': `${origin}/#organization` },
                image: `${origin}/social-preview.png`,
                mainEntityOfPage: url,
              }
            : {}),
    },
  ];
  if (normalized === '/') {
    graph.push({
      '@type': 'SoftwareApplication',
      '@id': `${origin}/#application`,
      name: 'Jackalope',
      url: origin,
      applicationCategory: 'DeveloperApplication',
      description,
      image: `${origin}/social-preview.png`,
      featureList: [
        'Parallel coding-agent tasks',
        'Isolated Git worktrees',
        'Project context and MCP connections',
        'Snapshot-bound code review evidence',
        'Recurring tasks and reusable workflows',
        'Agent account profiles and reported usage',
        'Automatic task guidance and agent selection',
        'Local change monitors without model calls',
        'Interactive codebase map and change impact',
        'Built-in browser automation and accessibility audits',
      ],
      publisher: { '@id': `${origin}/#organization` },
    });
    graph[2].mainEntity = { '@id': `${origin}/#application` };
  }
  if (page && normalized !== '/') {
    const ancestors = [
      { name: 'Jackalope', item: `${origin}/` },
      ...(post ? [{ name: 'Field notes', item: `${origin}/blog/` }] : []),
      ...(guide ? [{ name: 'Knowledgebase', item: `${origin}/knowledge/` }] : []),
      ...(normalized.startsWith('/agents/') && normalized !== '/agents/'
        ? [{ name: 'Agents', item: `${origin}/agents/` }]
        : []),
      ...(normalized.startsWith('/compare/') && normalized !== '/compare/'
        ? [{ name: 'Compare workflows', item: `${origin}/compare/` }]
        : []),
      {
        name: post?.title || guide?.shortTitle || title.replace(/ [|:] Jackalope$/, ''),
        item: url,
      },
    ];
    graph[2].breadcrumb = { '@id': `${url}#breadcrumbs` };
    graph.push({
      '@type': 'BreadcrumbList',
      '@id': `${url}#breadcrumbs`,
      itemListElement: ancestors.map((entry, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        ...entry,
      })),
    });
  }
  if (normalized === '/blog/') {
    graph.push({
      '@type': 'ItemList',
      itemListElement: posts.map((entry, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        url: `${origin}/blog/${entry.slug}/`,
        name: entry.title,
      })),
    });
  }
  if (normalized === '/tour/') {
    graph.push({
      '@type': 'VideoObject',
      '@id': `${url}#video`,
      name: tour.title,
      description: tour.description,
      thumbnailUrl: `${origin}${tour.poster}`,
      uploadDate: tour.published,
      duration: `PT${tour.durationSeconds}S`,
      contentUrl: `${origin}${tour.video}`,
      transcript: tour.transcript,
      inLanguage: 'en',
      publisher: { '@id': `${origin}/#organization` },
    });
    graph[2].mainEntity = { '@id': `${url}#video` };
  }
  if (normalized === '/knowledge/') {
    graph[2].mainEntity = {
      '@type': 'ItemList',
      itemListElement: knowledgeGuides.map((entry, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: entry.title,
        url: `${origin}/knowledge/${entry.slug}/`,
      })),
    };
  }
  const head = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}" />`,
    `<meta name="robots" content="${page && !page.noindex ? 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1' : 'noindex,follow'}" />`,
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
    `<meta property="og:type" content="${isArticle ? 'article' : 'website'}" />`,
    `<meta property="og:site_name" content="Jackalope" />`,
    `<meta property="og:locale" content="en_US" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    `<meta property="og:image" content="${origin}/social-preview.png" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="Jackalope: Many agents. One workspace. Run coding agents in parallel, keep project context, and review changes." />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:site" content="@JackalopeDotDev" />`,
    `<meta name="twitter:image:alt" content="Jackalope: A desktop workspace for parallel coding agents and code review." />`,
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
    `<meta name="twitter:image" content="${origin}/social-preview.png" />`,
    ...(post
      ? [
          `<meta property="article:published_time" content="${post.date}T12:00:00Z" />`,
          `<meta property="article:modified_time" content="${post.date}T12:00:00Z" />`,
        ]
      : []),
    `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c')}</script>`,
    `<link rel="alternate" type="application/rss+xml" title="Jackalope field notes" href="${origin}/feed.xml" />`,
    `<link rel="alternate" type="text/plain" title="About Jackalope for language models" href="${origin}/llms.txt" />`,
    `<link rel="describedby" href="${origin}/llms.txt" />`,
    `<link rel="sitemap" type="application/xml" href="${origin}/sitemap.xml" />`,
  ].join('\n');
  return html
    .replace(/<title>[\s\S]*?<\/title>/g, '')
    .replace(
      /<meta\s+(?:name="(?:description|robots|twitter:[^"]+)"|property="(?:og:[^"]+|article:[^"]+)")[^>]*>/g,
      '',
    )
    .replace(/<link rel="(?:canonical|alternate|sitemap)"[^>]*>/g, '')
    .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '')
    .replace('</head>', `${head}\n</head>`);
}

function marketingPageText(page: MarketingPage, origin: string) {
  const comparison = page.comparison;
  const body = page.sections
    .map((section) =>
      [
        `## ${section.title}`,
        ...section.paragraphs,
        ...(section.table?.rows.map((row) =>
          row.map((cell, index) => `${section.table?.columns[index]}: ${cell}`).join('\n'),
        ) || []),
        ...(section.bullets?.map((item) => `- ${item}`) || []),
        ...(section.links?.map((link) => `[${link.label}](${link.href})`) || []),
      ].join('\n\n'),
    )
    .join('\n\n');
  const details = comparison
    ? [
        `Sources reviewed ${comparison.reviewed}. Editorial comparison by Jackalope, based on official documentation, not hands-on performance rankings.`,
        ...comparison.rows.map(
          (row) =>
            `## ${row.topic}\n\nJackalope: ${row.jackalope}\n${comparison.name}: ${row.competitor}`,
        ),
        ...comparison.faqs.map((faq) => `## ${faq.question}\n\n${faq.answer}`),
        '## Official sources',
        ...comparison.sources.map((source) => `- [${source.label}](${source.href})`),
      ].join('\n\n')
    : '';
  return `# ${page.headline}\n${origin}${page.path}\n\n${page.lede}\n\n${body}\n\n${details}`;
}

export function discoveryFiles(origin = siteOrigin, releaseVersion?: string) {
  const availability = releaseVersion
    ? `Windows x64 version ${releaseVersion} is available at ${origin}/#download. See ${origin}/roadmap/ for platform plans.`
    : 'Public downloads are not open yet. Join the waitlist for early-access news. See the roadmap for platform plans.';
  const intro = `# Jackalope\n\n> A desktop workspace for coding agents, local Git projects, tasks, worktrees, and review.\n\nJackalope is a product of Jackalope Digital LLC (${company.url}). The canonical product website is ${origin}.\n\n## Availability\n\n${availability} Users bring their own locally installed agents and provider accounts; an AI subscription is not included.\n\n## Product\n\nTasks keep ideas, attempts, results, and review together. Isolated Git worktrees separate working directories. Users inspect patches and run project checks before deciding what to integrate. Website screenshots and the recorded tour use Atlas sample project data.\n\n`;
  const publicPages = indexablePages;
  const links = publicPages
    .map((page) => `- [${page.title}](${origin}${page.path}): ${page.description}`)
    .join('\n');
  return {
    ...knowledgeFiles(origin),
    'knowledge/llms.txt': `# Jackalope knowledgebase\n\n> Official help for Jackalope and its local agent tools.\n\n## Guides\n\n${knowledgeGuides.map((guide) => `- [${guide.title}](${origin}/knowledge/${guide.slug}/index.md): ${guide.description}`).join('\n')}\n`,
    'robots.txt': `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`,
    'sitemap.xml': `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${publicPages.map((page) => `<url><loc>${escapeHtml(origin + page.path)}</loc>${lastModified(page.path) ? `<lastmod>${lastModified(page.path)}</lastmod>` : ''}</url>`).join('')}</urlset>`,
    'llms.txt': `${intro}## Agent support\n\nNative task adapters: Codex, Claude Code, Grok Build, OpenCode, Kimi Code, and Antigravity. Direct project MCP connections support Codex, Claude Code, OpenCode, and Kimi Code; all six adapters support on-demand discovery. Kimi supports named accounts, model selection, structured questions, task tokens, membership quota, routing, and Ask Jackalope. Antigravity is worker-only; its current model and subscription quota use read-only CLI commands. Named profiles use Gemini API keys with separate billing, while subscription login is shared. Gemini CLI, Aider, and Goose offer account setup but not task execution. Provider access and reported usage vary by adapter. See ${origin}/agents/ for coverage and limits and ${origin}/agents/kimi-code/ for Kimi setup.\n\n## Knowledgebase & Diagnostics\n\n- [Agent-readable documentation index](${origin}/knowledge/llms.txt)\n- [Ask Jackalope and local MCP tools](${origin}/knowledge/ask-jackalope/index.md)\n\nOfficial documentation, architecture guides, and troubleshooting recipes are available at ${origin}/knowledge/:\n- Isolated Git Worktree Architecture: Preventing checkout collisions across parallel agents\n- Task Routing & Quota Handoff: Reported quota windows, preflight headroom estimates, and up to three handoffs\n- Multi-Account Profiles: Segregating Work and Personal agent provider sign-ins\n- MCP Tools & Built-In Browser Automation: Central Model Context Protocol management\n- Diagnostic Playbook: Resolving missing CLI PATH, expired tokens, and worktree lock errors\n\n## Pages\n\n${links}\n\n## Optional\n\n- [Full text](${origin}/llms-full.txt)\n- [RSS feed](${origin}/feed.xml)\n`,
    'llms-full.txt': `${intro}${marketingPages.map((page) => marketingPageText(page, origin)).join('\n\n')}\n\n# Jackalope Knowledgebase & Documentation\n${origin}/knowledge/\n\n${knowledgeGuides.map((guide) => guideMarkdown(guide, origin)).join('\n\n')}\n\n${posts.map((post) => `# ${post.title}\n${origin}/blog/${post.slug}/\nPublished ${post.date} by ${company.name}.\n\n${serializeBlogPost(post)}`).join('\n\n')}\n\n# Changelog\n\n${updates.map((update) => `## ${update.date}: ${update.title} (${update.status})\n\n${update.description}\n${update.items.map((item) => `- ${item}`).join('\n')}\n\n${update.note ?? ''}`).join('\n\n')}\n`,
    'feed.xml': `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>Jackalope field notes</title><link>${origin}/blog/</link><description>Notes from the Jackalope studio.</description><language>en</language><atom:link href="${origin}/feed.xml" rel="self" type="application/rss+xml"/>${posts.map((post) => `<item><title>${escapeHtml(post.title)}</title><link>${origin}/blog/${post.slug}/</link><guid isPermaLink="true">${origin}/blog/${post.slug}/</guid><pubDate>${new Date(`${post.date}T12:00:00Z`).toUTCString()}</pubDate><description>${escapeHtml(post.description)}</description></item>`).join('')}</channel></rss>`,
    'site.webmanifest': JSON.stringify({
      name: 'Jackalope',
      short_name: 'Jackalope',
      description: pages[0].description,
      id: '/',
      start_url: '/',
      display: 'browser',
      icons: [
        { src: '/icon-128.png?v=2', sizes: '128x128', type: 'image/png' },
        { src: '/icon-256.png?v=2', sizes: '256x256', type: 'image/png' },
      ],
    }),
  };
}
