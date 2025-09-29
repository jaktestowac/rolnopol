/**
 * Performance Monitor Utility
 * Tracks page load times and performance metrics
 */
class PerformanceMonitor {
  constructor() {
    this.metrics = {
      pageLoadStart: performance.now(),
      scriptLoadTimes: {},
      apiCallTimes: {},
      domReadyTime: null,
      pageReadyTime: null,
    };

    this.init();
  }

  init() {
    // Track DOM ready time
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        this.metrics.domReadyTime = performance.now();
      });
    } else {
      this.metrics.domReadyTime = performance.now();
    }

    // Track page load time
    window.addEventListener("load", () => {
      this.metrics.pageReadyTime = performance.now();
      this.logMetrics();
    });

    // Track API calls
    this.interceptApiCalls();
  }

  /**
   * Track script loading time
   * @param {string} scriptName - Name of the script
   * @param {number} startTime - Start time
   */
  trackScriptLoad(scriptName, startTime) {
    const loadTime = performance.now() - startTime;
    this.metrics.scriptLoadTimes[scriptName] = loadTime;
  }

  /**
   * Track API call time
   * @param {string} endpoint - API endpoint
   * @param {number} startTime - Start time
   */
  trackApiCall(endpoint, startTime) {
    const callTime = performance.now() - startTime;
    if (!this.metrics.apiCallTimes[endpoint]) {
      this.metrics.apiCallTimes[endpoint] = [];
    }
    this.metrics.apiCallTimes[endpoint].push(callTime);
  }

  /**
   * Intercept API calls to track performance
   */
  interceptApiCalls() {
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const startTime = performance.now();
      const url = args[0];

      try {
        const response = await originalFetch(...args);
        this.trackApiCall(url, startTime);
        return response;
      } catch (error) {
        this.trackApiCall(url, startTime);
        throw error;
      }
    };
  }

  /**
   * Log performance metrics
   */
  logMetrics() {
    const totalLoadTime =
      this.metrics.pageReadyTime - this.metrics.pageLoadStart;
    const domLoadTime = this.metrics.domReadyTime - this.metrics.pageLoadStart;

    console.group("🚀 Performance Metrics");
    console.log(`Total Page Load Time: ${totalLoadTime.toFixed(2)}ms`);
    console.log(`DOM Ready Time: ${domLoadTime.toFixed(2)}ms`);

    if (Object.keys(this.metrics.scriptLoadTimes).length > 0) {
      console.group("Script Load Times:");
      Object.entries(this.metrics.scriptLoadTimes).forEach(([script, time]) => {
        console.log(`${script}: ${time.toFixed(2)}ms`);
      });
      console.groupEnd();
    }

    if (Object.keys(this.metrics.apiCallTimes).length > 0) {
      console.group("API Call Times:");
      Object.entries(this.metrics.apiCallTimes).forEach(([endpoint, times]) => {
        const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
        console.log(
          `${endpoint}: ${avgTime.toFixed(2)}ms (${times.length} calls)`,
        );
      });
      console.groupEnd();
    }

    console.groupEnd();

    // Send metrics to analytics if available
    this.sendMetricsToAnalytics();
  }

  /**
   * Send metrics to analytics (placeholder)
   */
  sendMetricsToAnalytics() {
    // This could send metrics to Google Analytics, custom analytics, etc.
    if (window.gtag) {
      window.gtag("event", "page_performance", {
        page_load_time: this.metrics.pageReadyTime - this.metrics.pageLoadStart,
        dom_ready_time: this.metrics.domReadyTime - this.metrics.pageLoadStart,
        page_name: window.location.pathname,
      });
    }
  }

  /**
   * Get performance summary
   * @returns {Object} Performance summary
   */
  getSummary() {
    return {
      totalLoadTime: this.metrics.pageReadyTime - this.metrics.pageLoadStart,
      domReadyTime: this.metrics.domReadyTime - this.metrics.pageLoadStart,
      scriptCount: Object.keys(this.metrics.scriptLoadTimes).length,
      apiCallCount: Object.values(this.metrics.apiCallTimes).reduce(
        (sum, calls) => sum + calls.length,
        0,
      ),
    };
  }

  /**
   * Check if performance is acceptable
   * @returns {boolean} Whether performance is acceptable
   */
  isPerformanceAcceptable() {
    const summary = this.getSummary();
    return summary.totalLoadTime < 3000; // 3 seconds threshold
  }
}

// Create global instance
window.PerformanceMonitor = new PerformanceMonitor();
