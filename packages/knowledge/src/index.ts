export * from './content.ts';

import { type KnowledgeGuide, knowledgeGuides } from './content.ts';

export function guideMarkdown(guide: KnowledgeGuide, origin: string) {
  return `# ${guide.title}\n\n${origin}/knowledge/${guide.slug}/\n\n${guide.description}\n\n${guide.sections
    .map((section) =>
      [
        `## ${section.question}`,
        ...section.paragraphs,
        section.bullets?.map((item) => `- ${item}`).join('\n'),
        section.steps?.map((item, index) => `${index + 1}. ${item}`).join('\n'),
        section.codeBox && `${section.codeBox.title}\n\n\`\`\`\n${section.codeBox.code}\n\`\`\``,
        section.callout && `> ${section.callout.text}`,
        section.links
          ?.map((link) => `[${link.label}](${new URL(link.href, origin).href})`)
          .join('\n\n'),
      ]
        .filter(Boolean)
        .join('\n\n'),
    )
    .join('\n\n')}\n`;
}

export function knowledgeFiles(origin: string) {
  return Object.fromEntries(
    knowledgeGuides.map((guide) => [
      `knowledge/${guide.slug}/index.md`,
      guideMarkdown(guide, origin),
    ]),
  );
}
