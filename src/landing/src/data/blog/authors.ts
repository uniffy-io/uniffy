export interface Author {
  name: string;
  role: string;
  initials: string;
  url?: string;
  schemaType: "Person" | "Organization";
}

export const authors = {
  team: {
    name: "Uniffy team",
    role: "The people building Uniffy",
    initials: "U",
    url: "https://github.com/uniffy-io",
    schemaType: "Organization",
  },
} satisfies Record<string, Author>;

export type AuthorId = keyof typeof authors;

export const authorIds = Object.keys(authors) as [AuthorId, ...AuthorId[]];
