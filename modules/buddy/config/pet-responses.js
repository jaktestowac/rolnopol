/**
 * Pet Response Templates
 * Personality-based response generation for different interactions
 */

const INTERACTION_TEMPLATES = {
  // PET interaction responses
  pet: {
    high_patience: [
      "{name} purrs contentedly.",
      "{name} nuzzles your hand gently.",
      "{name} wags happily.",
      "{name} settles into your lap.",
      "{name} closes eyes peacefully.",
    ],
    mid_patience: [
      "{name} seems to enjoy that.",
      "{name} tilts head in acknowledgment.",
      "{name} offers a casual pat back.",
      "{name} appreciates the attention.",
    ],
    low_patience: [
      "{name} barely acknowledges you.",
      "{name} seems unimpressed.",
      "{name} moves away slightly.",
      "{name} grunts dismissively.",
    ],
  },

  // TALK interaction responses
  talk: {
    high_wisdom: [
      "{name} listens intently and nods thoughtfully.",
      "{name} seems to understand your words deeply.",
      "{name} regards you with knowing eyes.",
    ],
    mid_wisdom: [
      "{name} responds with casual interest.",
      "{name} makes a thoughtful sound.",
      "{name} seems engaged with what you're saying.",
    ],
    low_wisdom: ["{name} doesn't quite grasp what you meant.", "{name} tilts head confusedly.", "{name} responds with confusion."],
  },

  // ASK-HELP interaction responses
  ask_help: {
    high_farming: [
      "{name} taps thoughtfully on the glass.",
      "{name}'s eyes light up with understanding.",
      "{name} settles down to think carefully.",
    ],
    mid_farming: ["{name} seems to consider your question.", "{name} perks up at your question.", "{name} readies to help."],
    low_farming: [
      "{name} looks confused by your question.",
      "{name} scratches their head uncertainly.",
      "{name} seems out of their depth.",
    ],
  },
};

const PERSONALITY_RESPONSES = {
  // High wisdom quotes
  wisdom_quotes: [
    "Remember, the best code is code that can be understood by others.",
    "Simplicity is the ultimate sophistication in programming.",
    "Every bug is a lesson waiting to be learned.",
    "The most important skill is knowing when to ask for help.",
    "Good design is invisible - you don't notice it, you just use it.",
  ],

  // High farming tips
  farming_tips: [
    "Have you tried breaking it down into smaller functions?",
    "Test each piece independently - it'll save you hours.",
    "Comments explain 'why,' code explains 'what.'",
    "Refactoring is not a luxury, it's a necessity.",
    "Keep functions small and focused - do one thing well.",
  ],

  // High chaos quips
  chaos_quips: [
    "Oops! Did you expect that?",
    "That's one way to solve it!",
    "Interesting approach you've got there.",
    "Well, that's not what I expected!",
    "Surprise! That works too, somehow.",
  ],

  // High patience reactions
  patience_reactions: [
    "Take your time, I'm here for you.",
    "Don't worry, we'll figure this out together.",
    "You've got this!",
    "No rush, I'm always here.",
    "Tell me more, I'm listening.",
  ],

  // Low patience reactions
  impatient_reactions: [
    "Can we speed this up?",
    "I'm getting tired...",
    "This is taking forever.",
    "Hurry up a bit, will you?",
    "Seriously, how long is this gonna take?",
  ],
};

/**
 * Get a random item from an array
 */
function getRandomItem(array) {
  if (!Array.isArray(array) || array.length === 0) {
    throw new Error("getRandomItem: array must be non-empty");
  }
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * Format a message template with pet name
 */
function formatMessage(template, petName) {
  if (typeof template !== "string") {
    throw new Error("formatMessage: template must be a string");
  }
  return template.replace(/{name}/g, petName);
}

/**
 * Get response based on interaction type and personality
 */
function getInteractionResponse(interactionType, personality, petName) {
  if (!INTERACTION_TEMPLATES[interactionType]) {
    throw new Error(`getInteractionResponse: unknown interaction type '${interactionType}'`);
  }

  let responses = [];
  const templates = INTERACTION_TEMPLATES[interactionType];

  // Route based on interaction type
  switch (interactionType) {
    case "pet": {
      const patienceLevel = personality.patience >= 66 ? "high_patience" : personality.patience >= 33 ? "mid_patience" : "low_patience";
      responses = templates[patienceLevel];
      break;
    }
    case "talk": {
      const wisdomLevel = personality.wisdom >= 66 ? "high_wisdom" : personality.wisdom >= 33 ? "mid_wisdom" : "low_wisdom";
      responses = templates[wisdomLevel];
      break;
    }
    case "ask_help": {
      const farmingLevel = personality.farming >= 66 ? "high_farming" : personality.farming >= 33 ? "mid_farming" : "low_farming";
      responses = templates[farmingLevel];
      break;
    }
  }

  const template = getRandomItem(responses);
  return formatMessage(template, petName);
}

/**
 * Get contextual help response based on farming + wisdom stats
 */
function getHelpResponse(personality, petName) {
  const farmingScore = personality.farming;
  const wisdomScore = personality.wisdom;

  if (farmingScore >= 70 && wisdomScore >= 70) {
    return `${petName} provides clear, well-organized guidance with practical examples.`;
  } else if (farmingScore >= 50 && wisdomScore >= 50) {
    return `${petName} offers decent advice with reasonable explanations.`;
  } else if (farmingScore >= 50) {
    return `${petName} gives you code-based solutions, though the reasoning could be clearer.`;
  } else if (wisdomScore >= 50) {
    return `${petName} explains the concept well, but relies more on theory than practical examples.`;
  } else {
    return `${petName} tries to help, but seems uncertain about the answer.`;
  }
}

/**
 * Get personality-influenced reaction to user message
 */
function getPersonalityQuip(personality) {
  const stats = personality;

  // High wisdom gets wisdom quotes
  if (stats.wisdom >= 70) {
    return getRandomItem(PERSONALITY_RESPONSES.wisdom_quotes);
  }

  // High farming gets tips
  if (stats.farming >= 70) {
    return getRandomItem(PERSONALITY_RESPONSES.farming_tips);
  }

  // High chaos gets quips
  if (stats.chaos >= 70) {
    return getRandomItem(PERSONALITY_RESPONSES.chaos_quips);
  }

  // High patience gets supportive reactions
  if (stats.patience >= 70) {
    return getRandomItem(PERSONALITY_RESPONSES.patience_reactions);
  }

  // Low patience gets impatient reactions
  if (stats.patience <= 30) {
    return getRandomItem(PERSONALITY_RESPONSES.impatient_reactions);
  }

  return null;
}

module.exports = {
  INTERACTION_TEMPLATES,
  PERSONALITY_RESPONSES,
  getRandomItem,
  formatMessage,
  getInteractionResponse,
  getHelpResponse,
  getPersonalityQuip,
};
