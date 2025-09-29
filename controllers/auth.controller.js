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
      const { email, password } = req.body;

      const result = await authService.loginUser({ email, password });

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
        error.message.includes("deactivated")
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
    // Clear authentication cookies with standardized naming
    res.clearCookie("rolnopolToken");
    res.clearCookie("rolnopolLoginTime");

    res.status(200).json(
      formatResponseBody({
        message: "Logout successful",
      }),
    );
  }
}

module.exports = new AuthController();
