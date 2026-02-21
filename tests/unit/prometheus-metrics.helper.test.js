import { beforeEach, describe, expect, it, vi } from "vitest";

function createMockReq({ method = "GET", path = "/", originalUrl = path, baseUrl = "", routePath } = {}) {
  const req = {
    method,
    path,
    originalUrl,
    baseUrl,
  };

  if (routePath !== undefined) {
    req.route = { path: routePath };
  }

  return req;
}

function createMockRes(statusCode = 200) {
  let finishHandler = () => {};

  return {
    statusCode,
    on(event, handler) {
      if (event === "finish") {
        finishHandler = handler;
      }
    },
    emitFinish() {
      finishHandler();
    },
  };
}

async function loadFreshMetricsModule() {
  vi.resetModules();
  return require("../../helpers/prometheus-metrics.js");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("helpers/prometheus-metrics", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("does not record request observations when metrics are disabled", async () => {
    const metrics = await loadFreshMetricsModule();
    metrics.setEnabled(false);

    const req = createMockReq({ method: "GET", path: "/disabled-observation" });
    const res = createMockRes(204);
    const next = vi.fn();

    metrics.observeRequest(req, res, next);
    expect(next).toHaveBeenCalledOnce();

    res.emitFinish();

    const output = metrics.collect();
    expect(output).not.toContain('rolnopol_http_requests_total{method="GET",route="/disabled-observation",status_code="204"}');
    expect(output).not.toContain(
      'rolnopol_http_request_duration_seconds_count{method="GET",route="/disabled-observation",status_code="204"}',
    );
  });

  it("emits histogram where +Inf bucket equals _count for a route", async () => {
    const metrics = await loadFreshMetricsModule();
    metrics.setEnabled(true);

    const hrtimeSpy = vi.spyOn(process.hrtime, "bigint");
    hrtimeSpy.mockReturnValueOnce(1_000_000_000n).mockReturnValueOnce(1_030_000_000n);

    const req = createMockReq({ method: "GET", path: "/histogram-check" });
    const res = createMockRes(200);

    metrics.observeRequest(req, res, () => {});
    res.emitFinish();

    const output = metrics.collect();
    const route = "/histogram-check";
    const escapedRoute = escapeRegExp(route);

    const infMatch = output.match(
      new RegExp(
        `rolnopol_http_request_duration_seconds_bucket\\{method="GET",route="${escapedRoute}",status_code="200",le="\\+Inf"\\}\\s+(\\d+)`,
      ),
    );

    const countMatch = output.match(
      new RegExp(`rolnopol_http_request_duration_seconds_count\\{method="GET",route="${escapedRoute}",status_code="200"\\}\\s+(\\d+)`),
    );

    expect(infMatch).not.toBeNull();
    expect(countMatch).not.toBeNull();
    expect(Number(infMatch[1])).toBe(Number(countMatch[1]));
    expect(Number(countMatch[1])).toBe(1);
  });

  it("escapes quotes, backslashes, and newlines in route labels", async () => {
    const metrics = await loadFreshMetricsModule();
    metrics.setEnabled(true);

    const routePath = '/quote"and\\slash\nline';
    const req = createMockReq({
      method: "POST",
      baseUrl: "/api/v1",
      routePath,
      path: "/fallback",
      originalUrl: "/fallback",
    });
    const res = createMockRes(201);

    metrics.observeRequest(req, res, () => {});
    res.emitFinish();

    const output = metrics.collect();
    const expectedEscapedRoute = '/api/v1/quote\\"and\\\\slash\\nline';

    const counterLine = output
      .split("\n")
      .find((line) => line.startsWith('rolnopol_http_requests_total{method="POST",route="') && line.includes('status_code="201"'));

    expect(counterLine).toBeDefined();
    expect(counterLine).toContain(`route="${expectedEscapedRoute}"`);
    expect(counterLine).not.toContain("\nline");
    expect(counterLine).toContain("\\nline");
  });
});
