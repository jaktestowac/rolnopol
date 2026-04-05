/**
 * Pet ASCII Renderer Service
 * Handles ASCII art generation with customizable eyes
 */

const { getAscii } = require("../config/pet-ascii");

/**
 * Render ASCII pet with customization
 */
function renderPet(species, customization = {}) {
  if (!species || typeof species !== "string") {
    throw new Error("renderPet: species is required and must be a string");
  }

  const eyeChar = customization.eyes || "◉";

  // Get base ASCII art
  let ascii = getAscii(species, eyeChar);


  return ascii;
}

/**
 * Get available eyes
 */
function getAvailableEyes() {
  return ["·", "✦", "×", "◉", "@", "°"];
}

/**
 * Validate eye character
 */
function isValidEye(eyeChar) {
  return getAvailableEyes().includes(eyeChar);
}

module.exports = {
  renderPet,
  getAvailableEyes,
  isValidEye,
};
