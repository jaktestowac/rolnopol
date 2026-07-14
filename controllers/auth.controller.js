const { formatResponseBody } = require("../helpers/response-helper");
const { logError, logWarning } = require("../helpers/logger-api");
const authService = require("../services/auth.service");

class AuthController {
  /**
   * Register a new user
   */
  async register(req, res) {
    try {
      const { email, displayedName, password } = req.body;

      const result = await authService.registerUser({
        email,
        displayedName,
        password,
      });

      // Set authentication cookies with standardized naming
      res.cookie("rolnopolToken", result.token, {
        maxAge: result.cookieMaxAge,
        httpOnly: false, // Allow client-side access
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
      });

      res.cookie("rolnopolLoginTime", result.loginTime, {
        maxAge: result.cookieMaxAge,
        httpOnly: false, // Allow client-side access
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
      });

      res.status(201).json(
        formatResponseBody(
          {
            message: "User registered successfully",
            data: {
              user: result.user,
              token: result.token,
              expiration: result.expiration,
              loginTime: result.loginTime,
            },
          },
          false,
        ),
      );
    } catch (error) {
      logWarning("Error during user registration:", error);

      let statusCode = 500;
      if (error.message.includes("Validation failed")) statusCode = 400;
      else if (error.message.includes("already exists")) statusCode = 409;

      res.status(statusCode).json(
        formatResponseBody({
          error: error.message,
        }),
      );
    }
  }

  /**
   * Login user
   */
  async login(req, res) {
    try {
      const { email, password, twoFactorCode } = req.body;

      const result = await authService.loginUser({ email, password, twoFactorCode });

      if (result?.twoFactorRequired) {
        return res.status(202).json(
          formatResponseBody(
            {
              message: "Two-factor authentication required",
              data: result,
            },
            false,
          ),
        );
      }

      // Set authentication cookies with standardized naming
      res.cookie("rolnopolToken", result.token, {
        maxAge: result.cookieMaxAge,
        httpOnly: false, // Allow client-side access
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
      });

      res.cookie("rolnopolLoginTime", result.loginTime, {
        maxAge: result.cookieMaxAge,
        httpOnly: false, // Allow client-side access
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
      });

      res.status(200).json(
        formatResponseBody(
          {
            message: "Login successful",
            data: {
              user: result.user,
              token: result.token,
              expiration: result.expiration,
              loginTime: result.loginTime,
            },
          },
          false,
        ),
      );
    } catch (error) {
      logWarning("Error during user login:", error);

      let statusCode = 500;
      if (error.message.includes("Validation failed")) statusCode = 400;
      else if (
        error.message.includes("Invalid credentials") ||
        error.message.includes("deactivated") ||
        error.message.includes("two-factor")
      )
        statusCode = 401;

      res.status(statusCode).json(
        formatResponseBody({
          error: error.message,
        }),
      );
    }
  }

  /**
   * Logout user
   */
  async logout(req, res) {
    try {
      const authHeader = req.headers.authorization;
      const tokenFromHeader = req.headers.token;
      const tokenFromBody = req.body?.token;
      const tokenFromCookie = req.cookies?.rolnopolToken;

      let token = null;

      if (typeof tokenFromHeader === "string" && tokenFromHeader.trim().length > 0) {
        token = tokenFromHeader.trim();
      } else if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
        token = authHeader.slice("Bearer ".length).trim();
      } else if (typeof tokenFromBody === "string" && tokenFromBody.trim().length > 0) {
        token = tokenFromBody.trim();
      } else if (typeof tokenFromCookie === "string" && tokenFromCookie.trim().length > 0) {
        token = tokenFromCookie.trim();
      }

      await authService.logoutUser(token);

      // Clear authentication cookies with standardized naming
      res.clearCookie("rolnopolToken");
      res.clearCookie("rolnopolLoginTime");

      res.status(200).json(
        formatResponseBody({
          message: "Logout successful",
        }),
      );
    } catch (error) {
      logError("Error during user logout:", error);
      res.status(500).json(
        formatResponseBody({
          error: "Logout failed",
        }),
      );
    }
  }
}

module.exports = new AuthController();
