/**
 * Crop catalog + greenhouse layout for the "Grow-a-Plant" greenhouse.
 *
 * Each crop reaches ripeness after `ripeTicks` watered ticks. Every caller owns
 * SLOT_COUNT greenhouse slots, each empty or holding one plant.
 */

const SLOT_COUNT = 3;

const CROPS = [
  { id: "tomato", name: "Tomato", emoji: "🍅", ripeTicks: 20 },
  { id: "carrot", name: "Carrot", emoji: "🥕", ripeTicks: 16 },
  { id: "sunflower", name: "Sunflower", emoji: "🌻", ripeTicks: 26 },
  { id: "strawberry", name: "Strawberry", emoji: "🍓", ripeTicks: 22 },
  { id: "pepper", name: "Pepper", emoji: "🌶️", ripeTicks: 24 },
];

const CROPS_BY_ID = new Map(CROPS.map((crop) => [crop.id, crop]));

function getCrop(id) {
  return CROPS_BY_ID.get(id) || null;
}

module.exports = { SLOT_COUNT, CROPS, getCrop };
