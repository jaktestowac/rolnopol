const { formatResponseBody } = require("../helpers/response-helper");
const { logError } = require("../helpers/logger-api");
const webMcpDemoService = require("../services/practice/webmcp-demo.service");
const { PracticeError } = require("../services/practice/webmcp-demo.service");
const practiceCatalog = require("../services/practice/practice-catalog");

const SESSION_HEADER = "x-practice-session-id";

/**
 * Practice endpoints back the hidden /practice/* pages. They need no
 * login and no feature flag, and keep their state in memory per session.
 */
class PracticeController {
  _sessionId(req) {
    return req.get(SESSION_HEADER);
  }

  _handle(res, action, work) {
    try {
      const data = work();
      return res.status(200).json(formatResponseBody({ data }));
    } catch (error) {
      if (error instanceof PracticeError) {
        return res.status(error.status).json(formatResponseBody({ error: error.message, details: { code: error.code } }));
      }
      logError(`Practice WebMCP demo: ${action} failed`, error);
      return res.status(500).json(formatResponseBody({ error: `Failed to ${action}` }));
    }
  }

  getCatalog(req, res) {
    return this._handle(res, "read the practice catalog", () => practiceCatalog.getCatalog());
  }

  getWebMcpDemoState(req, res) {
    return this._handle(res, "read the sandbox", () => webMcpDemoService.getState(this._sessionId(req)));
  }

  waterWebMcpDemoBed(req, res) {
    return this._handle(res, "water the bed", () =>
      webMcpDemoService.waterBed(this._sessionId(req), req.params.bedId, req.body?.liters),
    );
  }

  harvestWebMcpDemoBed(req, res) {
    return this._handle(res, "harvest the bed", () => webMcpDemoService.harvestBed(this._sessionId(req), req.params.bedId));
  }

  resetWebMcpDemo(req, res) {
    return this._handle(res, "reset the sandbox", () => webMcpDemoService.reset(this._sessionId(req)));
  }
}

module.exports = new PracticeController();
module.exports.SESSION_HEADER = SESSION_HEADER;
