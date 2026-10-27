import type { SourceDeps } from "./deps";

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

// Structured abstracts come as several sections (Background, Methods, Results),
// each with its own label. Keeping only the first section truncated them.
// OtherAbstract holds translations and is not an `Abstract` child.
function joinSections(xml: Document): string | null {
  const sections = [...xml.querySelectorAll("Abstract > AbstractText")]
    .map((node) => {
      const text = node.textContent?.trim() ?? "";
      const label = node.getAttribute("Label");
      return label && text ? `${label}: ${text}` : text;
    })
    .filter(Boolean);
  return sections.length > 0 ? sections.join("\n") : null;
}

export async function findAbstract(
  { http, parseXml }: SourceDeps,
  doi: string,
): Promise<string | null> {
  const search = await http.getJson(
    `${EUTILS}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(doi)}&retmode=json`,
  );
  const ids: string[] | undefined = search.esearchresult?.idlist;
  if (!ids?.length) return null;

  const fetched = await http.get(
    `${EUTILS}/efetch.fcgi?db=pubmed&id=${ids[0]}&retmode=xml`,
  );
  return joinSections(parseXml(fetched.responseText));
}
