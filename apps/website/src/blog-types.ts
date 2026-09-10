export type BlogLink = { label: string; href: string };

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

export type BlogSection = {
  id?: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
  code?: { label: string; language: string; value: string };
  table?: { caption: string; headers: string[]; rows: string[][] };
  links?: BlogLink[];
};

export type BlogPost = {
  slug: string;
  title: string;
  seoTitle?: string;
  category: string;
  date: string;
  readingTime: string;
  description: string;
  cover?: EditorialCover;
  sections: BlogSection[];
  related?: BlogLink[];
};

export function serializeBlogPost(post: BlogPost): string {
  return post.sections
    .map((section) =>
      [
        `## ${section.title}`,
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
    )
    .concat(
      post.related?.length
        ? [
            `## Further reading\n\n${post.related.map((link) => `[${link.label}](${link.href})`).join('\n')}`,
          ]
        : [],
    )
    .join('\n\n');
}
