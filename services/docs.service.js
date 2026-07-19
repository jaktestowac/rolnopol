const fs = require("fs");
const path = require("path");
const featureDocSections = require("../data/docs-feature-sections");

class DocsService {
  constructor() {
    this.docsPath = path.join(__dirname, "../data/docs.json");
    this.cache = null;
    this.featureDocSections = featureDocSections;
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

  // Resolve the current feature flags. Accepts an explicit map (handy for tests
  // and callers that already have request-scoped flags) or, when omitted, reads
  // the live flags from the feature-flags service. Best-effort: any failure
  // falls back to "no flags enabled" so the base docs are always served.
  async _resolveEnabledFlags(flagsOverride) {
    if (flagsOverride && typeof flagsOverride === "object" && !Array.isArray(flagsOverride)) {
      return flagsOverride;
    }

    try {
      const featureFlagsService = require("./feature-flags.service");
      const data = await featureFlagsService.getFeatureFlags();
      return data && data.flags && typeof data.flags === "object" ? data.flags : {};
    } catch (error) {
      return {};
    }
  }

  // Build the documentation sections contributed by enabled feature flags.
  //
  // An entry is included when EVERY flag in `flags` is enabled (AND) AND, if
  // `anyFlags` is provided, at least ONE of those is enabled (OR). This lets a
  // section belong to a single feature (e.g. "twoFactorAuthEnabled") or to a
  // family of related flags (e.g. the homepage or promo-advert groups).
  _buildFeatureSections(flags) {
    const enabled = flags && typeof flags === "object" ? flags : {};
    const sections = [];

    for (const entry of this.featureDocSections) {
      if (!entry || !entry.section) {
        continue;
      }

      const allFlags = Array.isArray(entry.flags) ? entry.flags : entry.flag ? [entry.flag] : [];
      const anyFlags = Array.isArray(entry.anyFlags) ? entry.anyFlags : [];
      if (allFlags.length === 0 && anyFlags.length === 0) {
        continue;
      }

      const allEnabled = allFlags.every((key) => enabled[key] === true);
      const anyEnabled = anyFlags.length === 0 || anyFlags.some((key) => enabled[key] === true);
      if (!allEnabled || !anyEnabled) {
        continue;
      }

      // Report the flags that actually caused this section to appear.
      const candidateFlags = [...allFlags, ...anyFlags];
      const activeFlags = candidateFlags.filter((key) => enabled[key] === true);

      sections.push({
        ...entry.section,
        isFeatureFlagged: true,
        featureFlags: activeFlags.length > 0 ? activeFlags : candidateFlags,
      });
    }

    return sections;
  }

  // Return the base docs plus any sections whose feature flags are enabled.
  async getAll(flagsOverride) {
    const baseDocs = await this._loadDocs();
    const flags = await this._resolveEnabledFlags(flagsOverride);
    const featureSections = this._buildFeatureSections(flags);

    return featureSections.length > 0 ? [...baseDocs, ...featureSections] : [...baseDocs];
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

  async search(query, maxResults = 3, flagsOverride) {
    const normalized = String(query || "").trim();
    if (!normalized) {
      throw new Error("Query required for docs search");
    }

    const docs = await this.getAll(flagsOverride);
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
