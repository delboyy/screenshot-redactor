import { classifyPii, sanitize } from "@/lib/pii";

export type WordToken = {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  confidence: number;
};

export type JoinedPhrase = WordToken & { type: ReturnType<typeof classifyPii> };

// Try joining adjacent tokens into likely emails, URLs, phones, IPv4, and CC
export function joinTokens(tokens: WordToken[]): JoinedPhrase[] {
  const result: JoinedPhrase[] = [];
  let i = 0;
  const maxGapPx = 28; // slightly more tolerant for split emails/URLs

  while (i < tokens.length) {
    let j = i;
    let phrase = tokens[i].text;
    let bbox = { ...tokens[i].bbox };
    let maxConfidence = tokens[i].confidence;

    const tryClassify = () => classifyPii(sanitize(phrase));
    let t = tryClassify();

    // Expand forward while joining improves or might form a valid pattern
    while (j + 1 < tokens.length) {
      const a = tokens[j];
      const b = tokens[j + 1];
      const gap = b.bbox.x0 - a.bbox.x1;
      if (gap > maxGapPx) break;
      // Treat connector words as hard boundaries (e.g., phone A or phone B)
      const bw = b.text.toLowerCase();
      if (bw === "or" || bw === "and") {
        j = j + 1; // skip the connector so next phrase starts after it
        break;
      }
      const candidateJoin = phrase + (gap <= 5 ? "" : " ") + b.text;
      const candidateAt = phrase + "@" + b.text; // recover dropped '@'
      const candidateDot = phrase + "." + b.text; // recover dropped '.'

      const typeJoin = classifyPii(sanitize(candidateJoin));
      const typeAt = classifyPii(sanitize(candidateAt));
      const typeDot = classifyPii(sanitize(candidateDot));

      let acceptedCandidate = candidateJoin;
      let acceptedType = typeJoin;
      if (typeAt !== "other") {
        acceptedCandidate = candidateAt;
        acceptedType = typeAt;
      } else if (typeDot !== "other") {
        acceptedCandidate = candidateDot;
        acceptedType = typeDot;
      }

      if (
        acceptedType !== "other" ||
        looksLikeGrowingPhrase(candidateJoin)
      ) {
        // accept join
        phrase = acceptedCandidate;
        bbox = {
          x0: Math.min(bbox.x0, b.bbox.x0),
          y0: Math.min(bbox.y0, b.bbox.y0),
          x1: Math.max(bbox.x1, b.bbox.x1),
          y1: Math.max(bbox.y1, b.bbox.y1),
        };
        if (b.confidence > maxConfidence) maxConfidence = b.confidence;
        j++;
        t = acceptedType;
      } else {
        break;
      }
    }

    result.push({ text: phrase, bbox, confidence: maxConfidence, type: t });
    i = j + 1;
  }

  return result;
}

function looksLikeGrowingPhrase(s: string): boolean {
  // Encourage joining while building recognizable structures
  if (/https?:\/\//i.test(s)) return true;
  if (s.includes("@")) return true;
  if (/\d[\s-]*\d[\s-]*\d/.test(s)) return true;
  if (/\d+\.\d+\.\d+/.test(s)) return true;
  return false;
}


