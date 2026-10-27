import type { Http } from "../net/http";

export function reconstructAbstract(
  invertedIndex: Record<string, number[]>,
): string {
  const words: string[] = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const position of positions) words[position] = word;
  }
  return words.join(" ");
}

export async function findAbstract(
  http: Http,
  doi: string,
): Promise<string | null> {
  const data = await http.getOptionalJson(
    `https://api.openalex.org/works/doi:${doi}`,
  );
  return data?.abstract_inverted_index
    ? reconstructAbstract(data.abstract_inverted_index)
    : null;
}
