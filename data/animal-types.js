// Allowed animal types for farm management
const ALLOWED_ANIMAL_TYPES = {
  chicken: {
    key: "chicken",
    fullName: "Chicken",
    description: "Domestic fowl raised for meat and eggs",
    icon: "🐔",
  },
  cow: {
    key: "cow",
    fullName: "Cow",
    description: "Domestic cattle raised for milk and meat",
    icon: "🐄",
  },
  pig: {
    key: "pig",
    fullName: "Pig",
    description: "Domestic swine - best known for involvement in the invention of bacon",
    icon: "🐖",
  },
  sheep: {
    key: "sheep",
    fullName: "Sheep",
    description: "Domestic sheep raised for wool and meat",
    icon: "🐑",
  },
  goat: {
    key: "goat",
    fullName: "Goat",
    description: "Domestic goat raised for milk and meat",
    icon: "🐐",
  },
  duck: {
    key: "duck",
    fullName: "Duck",
    description: "Domestic duck raised for meat and eggs",
    icon: "🦆",
  },
  turkey: {
    key: "turkey",
    fullName: "Turkey",
    description: "Domestic turkey raised for meat",
    icon: "🦃",
  },
  rabbit: {
    key: "rabbit",
    fullName: "Rabbit",
    description: "Domestic rabbit raised for meat and fur",
    icon: "🐇",
  },
  fish: {
    key: "fish",
    fullName: "Fish",
    description: "Aquatic animals raised for food",
    icon: "🐟",
  },
  shrimp: {
    key: "shrimp",
    fullName: "Shrimp",
    description: "Crustaceans raised for aquaculture",
    icon: "🦐",
  },
  oyster: {
    key: "oyster",
    fullName: "Oyster",
    description: "Bivalve mollusks raised for food",
    icon: "🦪",
  },
  squid: {
    key: "squid",
    fullName: "Squid",
    description: "Marine cephalopod for aquaculture",
    icon: "🦑",
  },
  kraken: {
    key: "kraken",
    fullName: "Kraken",
    description: "Giant sea monster of the deep",
    icon: "🐙",
    hidden: true,
  },
  wyvern: {
    key: "wyvern",
    fullName: "Wyvern",
    description: "Two-legged dragon with venomous tail",
    icon: "🐉",
    hidden: true,
  },
  moth: {
    key: "moth",
    fullName: "Moth",
    description: "Winged insect known for its nocturnal habits",
    icon: "🦋",
    hidden: true,
  },
  aiHarvester: {
    key: "aiHarvester",
    fullName: "AI Harvester",
    description: "Machine for harvesting crops",
    icon: "🤖",
    hidden: true,
  },
  aiDrone: {
    key: "aiDrone",
    fullName: "AI Drone",
    description: "Autonomous aerial vehicle for farm monitoring",
    icon: "🛸",
    hidden: true,
  },
  aiAssistant: {
    key: "aiAssistant",
    fullName: "AI Assistant",
    description: "Advanced AI Assistant for farm tasks",
    icon: "🤖",
    hidden: true,
  },
  aiRobot: {
    key: "aiRobot",
    fullName: "AI Robot",
    description: "Advanced AI Robot for farm automation",
    icon: "🦾",
    hidden: true,
  },
  dinosaur: {
    key: "dinosaur",
    fullName: "Dinosaur T-Rex",
    description:
      "AI_Testers mascot and farm guardian for brave farmers... Not recommended for small farms or those with delicate crops or livestock. Use with caution!",
    icon: "🦖",
  },
  diplodocus: {
    key: "diplodocus",
    fullName: "Diplodocus",
    description: "Long-necked herbivorous dinosaur. A gentle giant of the Mesozoic era. Perfect for farm work and companionship.",
    icon: "🦕",
  },
  unicorn: {
    key: "unicorn",
    fullName: "Unicorn",
    description:
      "Mythical horse with a single horn. Symbol of purity and grace. A magical addition to any farm, bringing good fortune and beauty.",
    icon: "🦄",
    hidden: true,
  },
  ent: {
    key: "ent",
    fullName: "Ent",
    description:
      "Sentient tree-like creature from fantasy lore. Guardians of the forest and nature. A wise and powerful ally for sustainable farming and environmental stewardship.",
    icon: "🌳",
  },
  voidBeast: {
    key: "voidBeast",
    fullName: "Void Beast",
    description:
      "Mysterious creature from the void. Shrouded in darkness and enigma. A formidable presence on the farm, with unknown abilities and potential.",
    icon: "👾",
    hidden: true,
  },
};

module.exports = {
  ALLOWED_ANIMAL_TYPES,
};
