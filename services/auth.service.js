const UserDataSingleton = require("../data/user-data-singleton");
const { generateToken } = require("../helpers/token.helpers");
const {
  validateRegistrationData,
  validateLoginData,
} = require("../helpers/validators");
const { validatePassword } = require("../middleware/auth.middleware");
const { loginExpiration } = require("../data/settings");
const { logDebug, logError } = require("../helpers/logger-api");
const financialService = require("./financial.service");

class AuthService {
  constructor() {
    this.userDataInstance = UserDataSingleton.getInstance();
  }

  /**
   * Register a new user (email-based)
   */
  async registerUser(userData) {
    const { email, displayedName, password } = userData;

    // Trim displayedName before validation
    const trimmedDisplayedName = displayedName
      ? displayedName.trim()
      : displayedName;

    // Validate input data (email-based)
    const validation = validateRegistrationData({
      email,
      displayedName: trimmedDisplayedName,
      password,
    });
    if (!validation.isValid) {
      throw new Error(`Validation failed: ${validation.errors.join(", ")}`);
    }

    // Check if user already exists by email
    const existingUserByEmail = await this.userDataInstance.findUserByEmail(email);
    if (existingUserByEmail) {
      logError("User registration failed", {
        email,
        reason: "User already exists",
      });
      throw new Error("User with this email already exists");
    }

    // Create user (password stored as plain text )
    const newUser = await this.userDataInstance.createUser({
      // username is no longer used
      displayedName: trimmedDisplayedName,
      email,
      password: password, // Plain text password
    });

    // Initialize financial account for the new user
    try {
      await financialService.initializeAccount(newUser.id.toString());
      logDebug("Financial account initialized for new user", {
        userId: newUser.id,
      });
    } catch (error) {
      logError("Failed to initialize financial account for new user", {
        userId: newUser.id,
        error: error.message,
      });
      // Don't fail registration if financial account initialization fails
    }

    // Generate token
    const token = generateToken(newUser.id.toString(), loginExpiration);

    // Calculate cookie expiration time in milliseconds
    const cookieMaxAge = loginExpiration.hours
      ? loginExpiration.hours * 60 * 60 * 1000
      : loginExpiration.minutes * 60 * 1000;

    // Remove password from response
    const { password: _, ...userResponse } = newUser;

    logDebug("User registered successfully", {
      userId: newUser.id,
      email: newUser.email,
    });

    return {
      user: userResponse,
      token,
      expiration: loginExpiration,
      loginTime: new Date().toISOString(),
      cookieMaxAge,
    };
  }

  /**
   * Login user (email-based)
   */
  async loginUser(credentials) {
    const { email, password } = credentials;

    // Validate input data
    const validation = validateLoginData({ email, password });
    if (!validation.isValid) {
      throw new Error(`Validation failed: ${validation.errors.join(", ")}`);
    }

    // Find user by email
    const user = await this.userDataInstance.findUserByEmail(email);
    if (!user) {
      throw new Error("Invalid credentials");
    }

    // Check if user is active
    if (!user.isActive) {
      throw new Error("Account is deactivated");
    }

    // Verify password (plain text comparison )
    if (!validatePassword(password, user.password)) {
      throw new Error("Invalid credentials");
    }

    // Update last login
    await this.userDataInstance.updateUserLastLogin(user.id.toString());

    // Generate token
    const token = generateToken(user.id.toString(), loginExpiration);

    // Calculate cookie expiration time in milliseconds
    const cookieMaxAge = loginExpiration.hours
      ? loginExpiration.hours * 60 * 60 * 1000
      : loginExpiration.minutes * 60 * 1000;

    // Remove password from response
    const { password: _, ...userResponse } = user;

    logDebug("User logged in successfully", {
      userId: user.id,
      email: user.email,
    });

    return {
      user: userResponse,
      token,
      expiration: loginExpiration,
      loginTime: new Date().toISOString(),
      cookieMaxAge,
    };
  }

  /**
   * Validate user token and get user data
   */
  async validateUserToken(userId) {
    const user = await this.userDataInstance.findUser(userId);

    if (!user) {
      throw new Error("User not found");
    }

    if (!user.isActive) {
      throw new Error("Account is deactivated");
    }

    // Remove password from response
    const { password, ...userResponse } = user;

    return userResponse;
  }
}

module.exports = new AuthService();
