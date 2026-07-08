/**
 * Config for the review-desk REST service (:4312).
 */
const path = require("path");

const HOST = process.env.REVIEW_DESK_HOST || "0.0.0.0";
const PORT = process.env.REVIEW_DESK_PORT != null && process.env.REVIEW_DESK_PORT !== "" ? Number(process.env.REVIEW_DESK_PORT) : 4312;

const DB_PATH = process.env.REVIEWS_DB_PATH ? path.resolve(process.env.REVIEWS_DB_PATH) : path.join(__dirname, "data", "reviews.json");

module.exports = { HOST, PORT, DB_PATH };
