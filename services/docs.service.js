const fs = require("fs");
const path = require("path");

class DocsService {
  constructor() {
    this.docsPath = path.join(__dirname, "../data/docs.json");
    this.cache = null;
    this.stopWords = new Set([
      "a",
      "an",
      "and",
      "are",
      "can",
      "do",
      "does",
      "for",
      "get",
      "how",
      "i",
      "is",
      "it",
      "me",
      "of",
      "on",
      "or",
      "please",
      "show",
      "tell",
      "the",
      "to",
      "what",
      "when",
      "where",
      "who",
      "why",
      "with",
      "would",
      "you",
    ]);
  }

  async _loadDocs() {
    if (this.cache) {
      return this.cache;
    }

    try {
      const content = fs.readFileSync(this.docsPath, "utf-8");
      this.cache = JSON.parse(content);
      return this.cache;
    } catch (error) {
      throw new Error("Failed to load documentation data");
    }
  }

  async getAll() {
    return this._loadDocs();
  }

  // Flatten doc node to searchable text
  _extractTextFromSection(section) {
    const chunks = [];

    if (section.section) chunks.push(section.section);
    if (section.title) chunks.push(section.title);

    const appendText = (value) => {
      if (typeof value === "string") {
        chunks.push(value);
      } else if (Array.isArray(value)) {
        value.forEach((item) => appendText(item));
      } else if (typeof value === "object" && value !== null) {
        Object.values(value).forEach((inner) => appendText(inner));
      }
    };

    appendText(section.content);

    return chunks.join(" ");
  }

  _normalizeQueryTerms(query) {
    const normalized = String(query || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ");

    return [
      ...new Set(
        normalized
          .split(/\s+/)
          .map((term) => term.trim())
          .filter(Boolean)
          .flatMap((term) => term.split("-"))
          .map((term) => term.trim())
          .filter(Boolean)
          .filter((term) => !this.stopWords.has(term)),
      ),
    ];
  }

  _scoreTermMatches(text, terms, { titleBoost = 0, sectionBoost = 0, contentBoost = 0 } = {}) {
    const lowerText = String(text || "").toLowerCase();
    let score = 0;

    for (const term of terms) {
      if (!term) continue;
      if (lowerText.includes(term)) {
        score += contentBoost;
      }
    }

    if (terms.length > 0 && terms.every((term) => lowerText.includes(term))) {
      score += titleBoost + sectionBoost;
    }

    return score;
  }

  async search(query, maxResults = 3) {
    const normalized = String(query || "").trim();
    if (!normalized) {
      throw new Error("Query required for docs search");
    }

    const docs = await this._loadDocs();
    const queryLower = normalized.toLowerCase();
    const queryTerms = this._normalizeQueryTerms(normalized);
    const exactSearchTerms = queryTerms.length > 0 ? queryTerms : [queryLower];

    const items = docs.map((section) => {
      const sectionText = this._extractTextFromSection(section);
      const lowerText = sectionText.toLowerCase();

      let score = 0;
      if (section.section && section.section.toLowerCase().includes(queryLower)) {
        score += 20;
      }
      if (section.title && section.title.toLowerCase().includes(queryLower)) {
        score += 40;
      }

      if (queryTerms.length > 0) {
        const titleText = `${section.section || ""} ${section.title || ""}`.toLowerCase();

        if (queryTerms.every((term) => titleText.includes(term))) {
          score += 35;
        }

        score += this._scoreTermMatches(section.section || "", queryTerms, { sectionBoost: 8 });
        score += this._scoreTermMatches(section.title || "", queryTerms, { titleBoost: 12 });
        score += this._scoreTermMatches(sectionText, queryTerms, { contentBoost: 4 });
      }

      const exactPattern = queryLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const hits = [...lowerText.matchAll(new RegExp(exactPattern, "g"))].length;
      score += hits * 5;

      // fallback: match synonyms with words
      if (score === 0) {
        const keyword = exactSearchTerms.find((term) => term && term.length > 1);
        if (keyword && sectionText.toLowerCase().includes(keyword)) {
          score += 2;
        }
      }

      return {
        section: section.section || "",
        title: section.title || "",
        content: section.content,
        score,
      };
    });

    const sorted = items
      .filter((it) => it.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);

    const result = {
      query: normalized,
      matches: sorted,
      totalMatches: sorted.length,
    };

    if (result.totalMatches === 0) {
      return {
        ...result,
        answer: `No direct documentation hits found for "${normalized}". Try using a broader query (e.g. "user roles", "marketplace", "entity") or check /docs with a different phrase.`,
      };
    }

    const formatted = sorted
      .map((item, idx) => {
        const extractedText = typeof item.content === "string" ? item.content : JSON.stringify(item.content, null, 2);
        const snippet = extractedText.length > 550 ? `${extractedText.slice(0, 540)}...` : extractedText;
        return `(${idx + 1}) ${item.title || item.section}: ${snippet}`;
      })
      .join("\n\n");

    return {
      ...result,
      answer: `Documentation search results for "${normalized}":\n\n${formatted}`,
    };
  }
}

module.exports = new DocsService();
