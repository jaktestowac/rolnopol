// Allowed animal types for farm management
const ALLOWED_ANIMAL_TYPES = {
  chicken: {
    key: "chicken",
    fullName: "Chicken",
    description:
      "Feathered alarm system with legs. Lays eggs, questions reality, and reminds farmers that panic is also a survival strategy.",
    icon: "🐔",
  },

  chick: {
    key: "chick",
    fullName: "Chick",
    description:
      "Tiny feathered bundle of potential. Chirps with optimism, pecks at the world, and serves as a reminder that even the smallest employees can have big dreams.",
    icon: "🐣",
  },

  cow: {
    key: "cow",
    fullName: "Cow",
    description: "Gentle milk philosopher with four stomachs and one eternal thought: chew first, understand later.",
    icon: "🐄",
  },

  pig: {
    key: "pig",
    fullName: "Pig",
    description: "Domestic swine - best known for involvement in the invention of bacon",
    icon: "🐖",
  },

  majesticHog: {
    key: "majesticHog",
    fullName: "Majestic Hog",
    description: "Legendary pig with a crown of flowers. Known for its regal presence and the ability to turn mud into a throne.",
    icon: "🐷",
  },

  piglet: {
    key: "piglet",
    fullName: "Piglet",
    description: "Tiny swine with big dreams. Known for its playful nature and ability to find joy in mud puddles.",
    icon: "🐖",
  },

  sheep: {
    key: "sheep",
    fullName: "Sheep",
    description: "Woolly cloud with legs. Follows the herd until the herd gets lost, then calls it collective wisdom.",
    icon: "🐑",
  },

  lamb: {
    key: "lamb",
    fullName: "Lamb",
    description: "Young woolly cloud with legs. Innocent, curious, and a reminder that even the smallest members of the herd have a voice.",
    icon: "🐑",
  },

  goat: {
    key: "goat",
    fullName: "Goat",
    description:
      "Mountain goblin disguised as livestock. Eats cans, climbs problems, and teaches that chaos is just ambition without a chair.",
    icon: "🐐",
  },

  duck: {
    key: "duck",
    fullName: "Duck",
    description: "Waterproof philosopher of the pond. Calm above the water, furious little engine of nonsense underneath.",
    icon: "🦆",
  },

  turkey: {
    key: "turkey",
    fullName: "Turkey",
    description: "Dramatic feather committee with seasonal anxiety. Gobbles like it knows a prophecy and refuses to explain it.",
    icon: "🦃",
  },

  rabbit: {
    key: "rabbit",
    fullName: "Rabbit",
    description: "Soft little multiplication wizard. Appears harmless, then suddenly the farm has seventeen more problems with ears.",
    icon: "🐇",
  },

  fish: {
    key: "fish",
    fullName: "Fish",
    description: "Silent aquatic minimalist. Says nothing, knows everything, and judges land animals for needing so much gravity.",
    icon: "🐟",
  },

  shrimp: {
    key: "shrimp",
    fullName: "Shrimp",
    description: "Tiny sea comma with big existential energy. Small enough to ignore, wise enough to survive the soup of history.",
    icon: "🦐",
  },

  oyster: {
    key: "oyster",
    fullName: "Oyster",
    description: "Closed-shell introvert hiding treasure and opinions. Teaches that pressure creates pearls, but also social avoidance.",
    icon: "🦪",
  },

  squid: {
    key: "squid",
    fullName: "Squid",
    description: "Ink-powered escape artist with too many arms and not enough accountability. When clarity fails, deploy darkness.",
    icon: "🦑",
  },

  kraken: {
    key: "kraken",
    fullName: "Kraken",
    description:
      "Ancient underwater project manager. Has many arms, endless scope, and a habit of emerging only when deadlines are already doomed.",
    icon: "🐙",
    hidden: true,
  },

  wyvern: {
    key: "wyvern",
    fullName: "Wyvern",
    description:
      "Two-legged dragon with airborne confidence and a venomous exit strategy. A reminder that not every risk comes with four feet.",
    icon: "🐉",
    hidden: true,
  },

  moth: {
    key: "moth",
    fullName: "Moth",
    description:
      "Nocturnal truth-seeker cursed by every lamp. Teaches that desire for light is noble, but sometimes the light is just a bug zapper.",
    icon: "🦋",
    hidden: true,
  },

  aiHarvester: {
    key: "aiHarvester",
    fullName: "AI Harvester",
    description:
      "Autonomous crop collector with suspicious optimism. Harvests wheat, patterns, and occasionally the farmer's sense of control.",
    icon: "🤖",
    hidden: true,
  },

  aiDrone: {
    key: "aiDrone",
    fullName: "AI Drone",
    description: "Flying metal gossip with cameras. Watches the farm from above and calls it monitoring, not judgment.",
    icon: "🛸",
    hidden: true,
  },

  aiAssistant: {
    key: "aiAssistant",
    fullName: "AI Assistant",
    description:
      "Polite digital oracle for farm tasks. Answers quickly, sometimes wisely, and occasionally invents a barn that never existed.",
    icon: "🤖",
    hidden: true,
  },

  aiRobot: {
    key: "aiRobot",
    fullName: "AI Robot",
    description:
      "Steel worker with perfect posture and no childhood memories. Automates the farm while quietly learning why humans name tractors.",
    icon: "🦾",
    hidden: true,
  },

  dinosaur: {
    key: "dinosaur",
    fullName: "Dinosaur T-Rex",
    description:
      "Ancient farm guardian with tiny arms and enormous opinions. Excellent for security, terrible for delicate crops and emotional nuance.",
    icon: "🦖",
  },

  diplodocus: {
    key: "diplodocus",
    fullName: "Diplodocus",
    description:
      "Long-necked gentle giant who sees problems before anyone else. Slow to anger, quick to snack on treetops and unrealistic plans.",
    icon: "🦕",
  },

  unicorn: {
    key: "unicorn",
    fullName: "Unicorn",
    description:
      "Mythical horse with luxury forehead hardware. Brings magic, beauty, and the uncomfortable question of why the budget suddenly sparkles.",
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

  rat: {
    key: "rat",
    fullName: "Rat",
    description:
      "Small rodent known for adaptability and resourcefulness. Can be a pest or a pet, depending on the context. Sometimes can deliver You a surprise - a Plague!",
    icon: "🐀",
  },

  goose: {
    key: "goose",
    fullName: "Goose",
    description:
      "Waterfowl known for its honking and aggressive behavior. Honk honk! Honk lauder! A noisy but loyal companion for farm life, always ready to defend its territory.",
    icon: "🦢",
  },
  snail: {
    key: "snail",
    fullName: "Snail",
    description: "Ultra-slow productivity consultant. Will reach the barn eventually, probably after the next software release.",
    icon: "🐌",
  },
  bee: {
    key: "bee",
    fullName: "Bee",
    description:
      "Small flying employee with excellent teamwork skills. Produces honey, pollinates crops, and has a strict no-nonsense attitude.",
    icon: "🐝",
  },
  hedgehog: {
    key: "hedgehog",
    fullName: "Hedgehog",
    description: "Small defensive potato with legs. Excellent at looking cute while being emotionally unavailable.",
    icon: "🦔",
  },
  owl: {
    key: "owl",
    fullName: "Owl",
    description:
      "Night-shift supervisor with silent wings and strong code review energy. The owls are not what they seem, especially near the Red Room.",
    icon: "🦉",
  },
  lobster: {
    key: "lobster",
    fullName: "Lobster",
    description: "Armored sea aristocrat with built-in scissors. Useful for underwater farm politics and aggressively opening packages.",
    icon: "🦞",
  },
  yak: {
    key: "yak",
    fullName: "Yak",
    description:
      "Mountain-grade cow alternative with premium fluff. Perfect for cold farms, dramatic weather, and looking like it knows ancient secrets.",
    icon: "🐂",
  },
  boar: {
    key: "boar",
    fullName: "Boar",
    description:
      "Wild pig with unstoppable delivery energy. Proves that moving fast can solve problems, create problems, and destroy the fence between them.",
    icon: "🐗",
  },

  ant: {
    key: "ant",
    fullName: "Ant",
    description:
      "Tiny logistics engineer with terrifying team alignment. Proves that big systems are built by small creatures who never skip standup.",
    icon: "🐜",
  },

  tardigrade: {
    key: "tardigrade",
    fullName: "Tardigrade",
    description:
      "Microscopic survival legend. Laughs at drought, frost, chaos, and release deadlines, then asks whether that was supposed to be difficult.",
    icon: "🦠",
  },

  tortoise: {
    key: "tortoise",
    fullName: "Tortoise",
    description: "Ancient walking helmet with premium patience. Wins by arriving late enough for everyone else to make the mistakes first.",
    icon: "🐢",
  },
};

module.exports = {
  ALLOWED_ANIMAL_TYPES,
};
