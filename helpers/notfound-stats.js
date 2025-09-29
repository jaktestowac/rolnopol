// helpers/notfound-stats.js
// Singleton for tracking 404 stats (html and api)

const notFoundStats = {
  html: { total: 0, paths: {} },
  api: { total: 0, paths: {} },
  timeHits: {
    html: {}, // { path: [timestamp1, timestamp2, ...] }
    api: {},
  },
};

module.exports = {
  getStats: () => notFoundStats,
  incrementHtml: (path) => {
    notFoundStats.html.total++;
    notFoundStats.html.paths[path] = (notFoundStats.html.paths[path] || 0) + 1;
    if (!notFoundStats.timeHits.html[path]) {
      notFoundStats.timeHits.html[path] = [];
    }
    notFoundStats.timeHits.html[path].push(Date.now());
  },
  incrementApi: (path) => {
    notFoundStats.api.total++;
    notFoundStats.api.paths[path] = (notFoundStats.api.paths[path] || 0) + 1;
    if (!notFoundStats.timeHits.api[path]) {
      notFoundStats.timeHits.api[path] = [];
    }
    notFoundStats.timeHits.api[path].push(Date.now());
  },
  shouldServeCustom404: (url, phrase) => {
    if (!url || !phrase) return false;
    const stats = notFoundStats;
    return url.includes(phrase) && stats.html.paths[url] >= 10;
  },
  shouldServeCustom404ForTimeFrame: (url, phrase, timeFrame = 10000) => {
    if (!url || !phrase) return false;
    const timeHits = notFoundStats.timeHits.html;
    if (!timeHits[url]) return false;
    const now = Date.now();
    const recentRequests = timeHits[url].filter((timestamp) => now - timestamp <= timeFrame);
    return url.includes(phrase) && recentRequests.length >= 10;
  },
};
