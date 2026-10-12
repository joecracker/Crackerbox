import { getGithubUser } from "../handlers/github_handlers";

export interface GitAuthor {
  name: string;
  email: string;
}

export async function getGitAuthor(): Promise<GitAuthor> {
  const user = await getGithubUser();
  const author = user
    ? {
        name: "Crackerbox",
        email: user.email,
      }
    : {
        name: "Crackerbox",
        email: "git@crackerbox.app",
      };
  return author;
}
