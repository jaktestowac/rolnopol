/**
 * HTTP client → review-desk-service (gateway side).
 */
const { request } = require("./http");
const { REVIEW_DESK_URL, HTTP_TIMEOUT_MS, HEALTH_TIMEOUT_MS } = require("../config");

module.exports = {
  url: REVIEW_DESK_URL,
  health: () => request(`${REVIEW_DESK_URL}/health`, { timeoutMs: HEALTH_TIMEOUT_MS }),
  submitReview: ({ propertyId, bookingId, author, rating, text }) =>
    request(`${REVIEW_DESK_URL}/v1/reviews`, {
      method: "POST",
      body: { propertyId, bookingId, author, rating, text },
      timeoutMs: HTTP_TIMEOUT_MS,
    }),
  listReviews: (propertyId, page) =>
    request(`${REVIEW_DESK_URL}/v1/reviews?propertyId=${encodeURIComponent(propertyId)}&page=${page || 1}`, {
      timeoutMs: HTTP_TIMEOUT_MS,
    }),
  scores: (propertyIds) => request(`${REVIEW_DESK_URL}/v1/scores`, { method: "POST", body: { propertyIds }, timeoutMs: HTTP_TIMEOUT_MS }),
};
