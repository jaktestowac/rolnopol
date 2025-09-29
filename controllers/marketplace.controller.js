const { sendSuccess, sendError } = require("../helpers/response-helper");
const logger = require("../helpers/logger-api");
const marketplaceService = require("../services/marketplace.service");

class MarketplaceController {
  /**
   * Get all marketplace offers
   */
  async getOffers(req, res) {
    try {
      const offers = await marketplaceService.getOffers(req.user.userId);
      return sendSuccess(req, res, {
        offers: offers.filteredOffers,
        total: offers.filteredOffers.length,
      });
    } catch (error) {
      logger.logError("Error getting marketplace offers:", error);
      return sendError(req, res, 500, "Failed to get marketplace offers");
    }
  }

  /**
   * Get user's own offers
   */
  async getMyOffers(req, res) {
    try {
      const offers = await marketplaceService.getMyOffers(req.user.userId);
      return sendSuccess(req, res, {
        offers: offers.enrichedMyOffers,
        total: offers.enrichedMyOffers.length,
      });
    } catch (error) {
      logger.logError("Error getting user offers:", error);
      return sendError(req, res, 500, "Failed to get user offers");
    }
  }

  /**
   * Create a new marketplace offer
   */
  async createOffer(req, res) {
    try {
      const { itemType, itemId, price, description } = req.body;
      const userId = req.user.userId;
      const result = await marketplaceService.createOffer(userId, {
        itemType,
        itemId,
        price,
        description,
      });
      return sendSuccess(
        req,
        res,
        {
          offer: result.newOffer,
          message: "Offer created successfully",
        },
        201,
      );
    } catch (error) {
      logger.logError("Error creating marketplace offer:", error);
      return sendError(
        req,
        res,
        error.statusCode || 500,
        error.message || "Failed to create offer",
      );
    }
  }

  /**
   * Buy an item from marketplace
   */
  async buyItem(req, res) {
    try {
      const { offerId } = req.body;
      const buyerId = req.user.userId;
      const transaction = await marketplaceService.buyItem(buyerId, offerId);
      return sendSuccess(req, res, {
        transaction,
        message: "Purchase completed successfully",
      });
    } catch (error) {
      logger.logError("Error buying item from marketplace:", error);
      return sendError(
        req,
        res,
        error.statusCode || 500,
        error.message || "Failed to complete purchase",
      );
    }
  }

  /**
   * Cancel an offer
   */
  async cancelOffer(req, res) {
    try {
      const { offerId } = req.params;
      const userId = req.user.userId;
      await marketplaceService.cancelOffer(userId, offerId);
      return sendSuccess(req, res, {
        message: "Offer cancelled successfully",
      });
    } catch (error) {
      logger.logError("Error cancelling offer:", error);
      return sendError(
        req,
        res,
        error.statusCode || 500,
        error.message || "Failed to cancel offer",
      );
    }
  }

  /**
   * Get marketplace transaction history
   */
  async getTransactionHistory(req, res) {
    try {
      const userId = req.user.userId;
      const transactions =
        await marketplaceService.getTransactionHistory(userId);
      return sendSuccess(req, res, {
        transactions: transactions.userTransactions,
        total: transactions.userTransactions.length,
      });
    } catch (error) {
      logger.logError("Error getting transaction history:", error);
      return sendError(req, res, 500, "Failed to get transaction history");
    }
  }

  /**
   * Admin: Get all marketplace offers (with filtering)
   */
  async getAllOffersAdmin(req, res) {
    try {
      if (!req.user.isAdmin) {
        return sendError(req, res, 403, "Forbidden: Admin access required");
      }
      const offers = await marketplaceService.getAllOffersAdmin(req.query);
      return sendSuccess(req, res, {
        offers: offers.enrichedOffers,
        total: offers.enrichedOffers.length,
      });
    } catch (error) {
      logger.logError("Error getting all marketplace offers (admin):", error);
      return sendError(req, res, 500, "Failed to get all marketplace offers");
    }
  }

  /**
   * Admin: Get all marketplace transactions (with filtering)
   */
  async getAllTransactionsAdmin(req, res) {
    try {
      if (!req.user.isAdmin) {
        return sendError(req, res, 403, "Forbidden: Admin access required");
      }
      const transactions = await marketplaceService.getAllTransactionsAdmin(
        req.query,
      );
      return sendSuccess(req, res, {
        transactions: transactions.transactions,
        total: transactions.transactions.length,
      });
    } catch (error) {
      logger.logError(
        "Error getting all marketplace transactions (admin):",
        error,
      );
      return sendError(
        req,
        res,
        500,
        "Failed to get all marketplace transactions",
      );
    }
  }
}

module.exports = new MarketplaceController();
