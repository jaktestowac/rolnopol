const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const { authenticateUser } = require("../../middleware/auth.middleware");
const {
  validateIdParam,
} = require("../../middleware/id-validation.middleware");
const marketplaceController = require("../../controllers/marketplace.controller");

const marketplaceRoute = express.Router();
const apiLimiter = createRateLimiter("api");

/**
 * Get all marketplace offers (excluding user's own)
 * GET /api/marketplace/offers
 */
marketplaceRoute.get(
  "/marketplace/offers",
  apiLimiter,
  authenticateUser,
  marketplaceController.getOffers.bind(marketplaceController),
);

/**
 * Get user's own offers
 * GET /api/marketplace/my-offers
 */
marketplaceRoute.get(
  "/marketplace/my-offers",
  apiLimiter,
  authenticateUser,
  marketplaceController.getMyOffers.bind(marketplaceController),
);

/**
 * Create a new marketplace offer
 * POST /api/marketplace/offers
 */
marketplaceRoute.post(
  "/marketplace/offers",
  apiLimiter,
  authenticateUser,
  marketplaceController.createOffer.bind(marketplaceController),
);

/**
 * Buy an item from marketplace
 * POST /api/marketplace/buy
 */
marketplaceRoute.post(
  "/marketplace/buy",
  apiLimiter,
  authenticateUser,
  marketplaceController.buyItem.bind(marketplaceController),
);

/**
 * Cancel an offer
 * DELETE /api/marketplace/offers/:offerId
 */
marketplaceRoute.delete(
  "/marketplace/offers/:offerId",
  apiLimiter,
  authenticateUser,
  validateIdParam("offerId"),
  marketplaceController.cancelOffer.bind(marketplaceController),
);

/**
 * Get marketplace transaction history
 * GET /api/marketplace/transactions
 */
marketplaceRoute.get(
  "/marketplace/transactions",
  apiLimiter,
  authenticateUser,
  marketplaceController.getTransactionHistory.bind(marketplaceController),
);

module.exports = marketplaceRoute;
