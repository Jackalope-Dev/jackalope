type BlogLink = { label: string; href: string };

export type EditorialCover = {
  kind:
    | 'map'
    | 'parallel'
    | 'context'
    | 'quality'
    | 'review'
    | 'performance'
    | 'accounts'
    | 'agents'
    | 'browser'
    | 'schedule'
    | 'studio';
  tone: 'indigo' | 'mint' | 'honey' | 'rose';
  label: string;
};

export const blogImageKinds = ['title_card', 'artwork'] as const;

/**
 * A cover LopeBase publishes with a post. A title card draws the post title on the
 * brand colors; artwork sets the title beside generated art. Both are 1200x630.
 * An image without a kind has an unknown size.
 */
export type BlogImage = {
  url: string;
  alt: string;
  kind?: (typeof blogImageKinds)[number];
};

export const blogImageSize = (image: BlogImage) =>
  image.kind ? { width: 1200, height: 630 } : undefined;

/** The image shown at the top of the post. A title card repeats the H1, so it only serves link previews. */
export const postPageImage = (post: BlogPost) =>
  post.image?.kind === 'title_card' ? undefined : post.image;

export type BlogSection = {
  id?: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
  code?: { label: string; language: string; value: string };
  table?: { caption: string; headers: string[]; rows: string[][] };
  links?: BlogLink[];
  /** Markdown body after the heading, for posts published from Markdown files. */
  markdown?: string;
};

export type BlogPost = {
  slug: string;
  title: string;
  seoTitle?: string;
  category: string;
  /** Slug from authors.ts; omit for the company byline. */
  author?: string;
  date: string;
  updated?: string;
  readingTime: string;
  description: string;
  cover?: EditorialCover;
  /** Link-preview image, and the page cover unless it is a title card. */
  image?: BlogImage;
  /** Markdown before the first section. */
  intro?: string;
  sections: BlogSection[];
  related?: BlogLink[];
  /** Questions answered in the post, for FAQPage structured data. */
  faq?: { question: string; answer: string }[];
};

export function serializeBlogPost(post: BlogPost): string {
  const sections = post.sections.map((section) =>
    [
      `## ${section.title}`,
      section.markdown,
      ...section.paragraphs,
      section.bullets?.map((item) => `- ${item}`).join('\n'),
      section.code &&
        `${section.code.label}\n\`\`\`${section.code.language}\n${section.code.value}\n\`\`\``,
      section.table &&
        `${section.table.caption}\n${[section.table.headers, section.table.headers.map(() => '---'), ...section.table.rows].map((row) => `| ${row.join(' | ')} |`).join('\n')}`,
      section.links?.map((link) => `[${link.label}](${link.href})`).join('\n'),
    ]
      .filter(Boolean)
      .join('\n\n'),
  );
  return [
    ...(post.intro ? [post.intro] : []),
    ...sections,
    ...(post.related?.length
      ? [
          `## Further reading\n\n${post.related.map((link) => `[${link.label}](${link.href})`).join('\n')}`,
        ]
      : []),
  ].join('\n\n');
}
