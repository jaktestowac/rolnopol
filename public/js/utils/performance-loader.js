/**
 * Performance Loader Utility
 * Optimizes script loading and reduces page load times
 */
class PerformanceLoader {
  constructor() {
    this.loadedScripts = new Set();
    this.loadingPromises = new Map();
    this.preloadCache = new Map();
  }

  /**
   * Load script with caching and deduplication
   * @param {string} src - Script source
   * @param {Object} options - Loading options
   * @returns {Promise} Loading promise
   */
  async loadScript(src, options = {}) {
    const { async = true, defer = true, cache = true } = options;

    // Return cached promise if already loading
    if (this.loadingPromises.has(src)) {
      return this.loadingPromises.get(src);
    }

    // Return immediately if already loaded
    if (this.loadedScripts.has(src)) {
      return Promise.resolve();
    }

    const loadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = async;
      script.defer = defer;

      script.onload = () => {
        this.loadedScripts.add(src);
        this.loadingPromises.delete(src);
        resolve();
      };

      script.onerror = () => {
        this.loadingPromises.delete(src);
        reject(new Error(`Failed to load script: ${src}`));
      };

      document.head.appendChild(script);
    });

    this.loadingPromises.set(src, loadPromise);
    return loadPromise;
  }

  /**
   * Load multiple scripts in parallel
   * @param {Array} scripts - Array of script sources
   * @param {Object} options - Loading options
   * @returns {Promise} Loading promise
   */
  async loadScripts(scripts, options = {}) {
    const promises = scripts.map((src) => this.loadScript(src, options));
    return Promise.all(promises);
  }

  /**
   * Preload critical resources
   * @param {Array} resources - Array of resource URLs
   */
  preloadResources(resources) {
    resources.forEach((resource) => {
      if (!this.preloadCache.has(resource)) {
        const link = document.createElement("link");
        link.rel = "preload";
        link.href = resource;
        link.as = this._getResourceType(resource);
        document.head.appendChild(link);
        this.preloadCache.add(resource);
      }
    });
  }

  /**
   * Get resource type for preloading
   * @param {string} url - Resource URL
   * @returns {string} Resource type
   */
  _getResourceType(url) {
    if (url.endsWith(".js")) return "script";
    if (url.endsWith(".css")) return "style";
    if (
      url.endsWith(".png") ||
      url.endsWith(".jpg") ||
      url.endsWith(".jpeg") ||
      url.endsWith(".gif")
    )
      return "image";
    if (url.endsWith(".woff") || url.endsWith(".woff2") || url.endsWith(".ttf"))
      return "font";
    return "fetch";
  }

  /**
   * Optimize page load by deferring non-critical scripts
   * @param {Array} criticalScripts - Critical scripts to load immediately
   * @param {Array} deferredScripts - Scripts to load after page load
   */
  async optimizePageLoad(criticalScripts, deferredScripts = []) {
    // Load critical scripts immediately
    await this.loadScripts(criticalScripts, { async: false, defer: false });

    // Load deferred scripts after page load
    if (deferredScripts.length > 0) {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
          this.loadScripts(deferredScripts, { async: true, defer: true });
        });
      } else {
        // Page already loaded, load immediately
        this.loadScripts(deferredScripts, { async: true, defer: true });
      }
    }
  }

  /**
   * Clear cache for specific scripts
   * @param {Array} scripts - Scripts to clear from cache
   */
  clearCache(scripts = null) {
    if (scripts) {
      scripts.forEach((src) => {
        this.loadedScripts.delete(src);
        this.loadingPromises.delete(src);
      });
    } else {
      this.loadedScripts.clear();
      this.loadingPromises.clear();
    }
  }
}

// Create global instance
window.PerformanceLoader = new PerformanceLoader();
