/** People who can sign a post. A post without an author keeps the company byline; only
    name someone who reviewed the post and stands behind it. */
export type Author = {
  slug: string;
  name: string;
  jobTitle: string;
  bio: string;
  /** Search description for the author page; at most 160 characters. */
  summary: string;
  /** Square photo served from public/. */
  image: string;
  profiles: { label: string; url: string }[];
};

export const authors: Author[] = [
  {
    slug: 'caden-sumner',
    name: 'Caden Sumner',
    jobTitle: 'Founder, Jackalope Digital',
    bio: 'Caden Sumner is the founder of Jackalope Digital, where he builds Jackalope, a desktop workspace for running coding agents side by side. He writes about splitting work across agents, reviewing what they produce, and giving them project context they can follow.',
    summary:
      'Guides from Caden Sumner, founder of Jackalope Digital, on running coding agents in parallel, reviewing their changes and writing context they follow.',
    image: '/authors/caden-sumner.jpg',
    profiles: [
      { label: 'LinkedIn', url: 'https://www.linkedin.com/in/cadensumner/' },
      { label: 'X', url: 'https://x.com/CadenSumner' },
      { label: 'GitHub', url: 'https://github.com/Ghosts' },
    ],
  },
];

export const authorPath = (author: Author) => `/authors/${author.slug}/`;

export const findAuthor = (slug: string | undefined) =>
  authors.find((author) => author.slug === slug);
