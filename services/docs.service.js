const fs = require("fs");
const path = require("path");

class DocsService {
  constructor() {
    this.docsPath = path.join(__dirname, "../data/docs.json");
    this.cache = null;
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

  async search(query, maxResults = 3) {
    const normalized = String(query || "").trim();
    if (!normalized) {
      throw new Error("Query required for docs search");
    }

    const docs = await this._loadDocs();
    const queryLower = normalized.toLowerCase();

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

      const hits = [...lowerText.matchAll(new RegExp(queryLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))].length;
      score += hits * 5;

      // fallback: match synonyms with words
      if (score === 0) {
        const keyword = queryLower.split(" ")[0];
        if (sectionText.toLowerCase().includes(keyword)) {
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
