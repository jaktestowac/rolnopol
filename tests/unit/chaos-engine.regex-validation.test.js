import { describe, it, expect } from "vitest";
const chaosEngineService = require("../../services/chaos-engine.service");

describe("ChaosEngineService - Regex Validation (ReDoS Prevention)", () => {
  describe("_validateRegexPattern()", () => {
    it("should reject Nested quantifier patterns: (a+)+", () => {
      expect(() => {
        chaosEngineService._validateRegexPattern("/(a+)+b/");
      }).toThrow("ReDoS");
    });

    it("should reject (a*)+pattern", () => {
      expect(() => {
        chaosEngineService._validateRegexPattern("/(a*)+/");
      }).toThrow("ReDoS");
    });

    it("should reject multiple quantifiers: a+b+", () => {
      expect(() => {
        chaosEngineService._validateRegexPattern("/a+b+c+/");
      }).toThrow("ReDoS");
    });

    it("should reject overly long patterns (>500 chars)", () => {
      const longPattern = "a".repeat(501);
      expect(() => {
        chaosEngineService._validateRegexPattern(longPattern);
      }).toThrow("too long");
    });

    it("should allow safe patterns", () => {
      expect(() => {
        chaosEngineService._validateRegexPattern("/api/*/v1");
      }).not.toThrow();
    });

    it("should allow simple path patterns", () => {
      expect(() => {
        chaosEngineService._validateRegexPattern("/v1/users");
      }).not.toThrow();
    });

    it("should allow wildcard patterns", () => {
      expect(() => {
        chaosEngineService._validateRegexPattern("/api/test*");
      }).not.toThrow();
    });

    it("should allow patterns with regex literal notation", () => {
      expect(() => {
        chaosEngineService._validateRegexPattern("/^\/api\/v1/");
      }).not.toThrow();
    });

    it("should reject null patterns safely", () => {
      expect(() => {
        chaosEngineService._validateRegexPattern(null);
      }).not.toThrow();
    });

    it("should handle empty string patterns", () => {
      expect(() => {
        chaosEngineService._validateRegexPattern("");
      }).not.toThrow();
    });
  });

  describe("Integration with _sanitizePaths()", () => {
    it("should validate paths during sanitization", () => {
      expect(() => {
        chaosEngineService._sanitizePaths(
          ["/api/test", "/(a+)+b/"],  // One bad pattern
          []
        );
      }).toThrow("ReDoS");
    });

    it("should accept valid paths in sanitization", () => {
      const result = chaosEngineService._sanitizePaths(
        ["/api/test", "/v1/users*", "/health"],
        []
      );
      expect(result).toHaveLength(3);
      expect(result).toContain("/api/test");
    });

    it("should enforce max length in _sanitizePaths", () => {
      const longPath = "/" + "a".repeat(501);
      expect(() => {
        chaosEngineService._sanitizePaths([longPath], []);
      }).toThrow("too long");
    });
  });

  describe("Integration with _sanitizeStringArray()", () => {
    it("should validate string array patterns", () => {
      expect(() => {
        chaosEngineService._sanitizeStringArray(
          ["valid-pattern", "/(a+)+/"],  // One bad pattern
          []
        );
      }).toThrow("ReDoS");
    });

    it("should accept valid string array patterns", () => {
      const result = chaosEngineService._sanitizeStringArray(
        ["example.com", "test.local", "*.api.com"],
        []
      );
      expect(result).toHaveLength(3);
    });

    it("should validate IP ranges in string array", () => {
      const result = chaosEngineService._sanitizeStringArray(
        ["127.0.0.1", "192.168.*"],
        []
      );
      expect(result).toHaveLength(2);
    });
  });

  describe("Regex validation with config", () => {
    it("should reject config with bad includePaths", async () => {
      const badConfig = {
        mode: "custom",
        customConfig: {
          scope: {
            includePaths: ["/(a+)+b/"],
          },
        },
      };
      
      await expect(chaosEngineService.patchChaosEngineConfig(badConfig)).rejects.toThrow("ReDoS");
    });

    it("should reject config with bad ipRanges", async () => {
      const badConfig = {
        mode: "custom",
        customConfig: {
          scope: {
            ipRanges: ["/(a+)+b/"],
          },
        },
      };
      
      await expect(chaosEngineService.patchChaosEngineConfig(badConfig)).rejects.toThrow("ReDoS");
    });

    it("should reject config with bad geolocation patterns", async () => {
      const badConfig = {
        mode: "custom",
        customConfig: {
          scope: {
            geolocation: ["/(a+)+b/"],
          },
        },
      };
      
      await expect(chaosEngineService.patchChaosEngineConfig(badConfig)).rejects.toThrow("ReDoS");
    });

    it("should accept valid scope patterns", async () => {
      const goodConfig = {
        mode: "custom",
        customConfig: {
          scope: {
            includePaths: ["/api/test*"],
            ipRanges: ["192.168.*"],
            geolocation: ["us", "eu"],
          },
        },
      };
      
      await expect(chaosEngineService.patchChaosEngineConfig(goodConfig)).resolves.toBeDefined();
    });
  });
});
