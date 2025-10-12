# Implement bcrypt Password Hashing and Standard JWT Authentication

## Overview

Replace the current plain text password storage with bcrypt hashing and implement standard JWT tokens instead of the custom base64 encoding system.

## Implementation Steps

### 1. Install Dependencies

- Add `bcrypt` for password hashing
- Add `jsonwebtoken` for standard JWT implementation

### 2. Update Password Handling

- Modify `middleware/auth.middleware.js` to use bcrypt for password comparison
- Update `services/auth.service.js` to hash passwords during registration and validate with bcrypt during login
- Add password migration utility to hash existing plain text passwords

### 3. Replace Custom Token System with JWT

- Replace custom base64 token generation in `helpers/token.helpers.js` with standard JWT
- Update token validation functions to use JWT verification
- Maintain token storage for revocation capabilities
- Add JWT secret management in settings

### 4. Update Authentication Flow

- Modify login/register endpoints to work with new JWT tokens
- Update middleware to validate JWT tokens
- Ensure admin token system also uses JWT

### 5. Data Migration

- Create migration script to hash existing passwords in `data/users.json`
- Ensure backward compatibility during transition

## Key Files to Modify

- `package.json` - Add bcrypt and jsonwebtoken dependencies
- `helpers/token.helpers.js` - Replace custom token system with JWT
- `middleware/auth.middleware.js` - Update password validation
- `services/auth.service.js` - Add password hashing for registration/login
- `data/settings.js` - Add JWT secret configuration
- `data/users.json` - Migrate existing passwords to bcrypt hashes

## Technical Decisions

- Use `jsonwebtoken` library (industry standard)
- Keep in-memory token storage for revocation capabilities
- Hash existing passwords on first startup (automatic migration)
- Store JWT secret in environment variable with fallback to settings.js