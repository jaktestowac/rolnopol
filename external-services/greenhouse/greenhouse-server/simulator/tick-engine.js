/**
 * Plant growth simulator.
 *
 * Advances one plant by a single tick: a watered plant grows toward ripeness at
 * a crop-specific rate; water drains each tick, and a thirsty plant (water 0)
 * stalls until watered again. Pure and synchronous — the service calls it on an
 * interval per session. Deterministic, so tests can rely on exact progression.
 */

const WATER_DECAY_PER_TICK = 5;

const STAGES = ["seed", "sprout", "growing", "budding", "ripe"];

function stageFor(growth) {
  if (growth <= 0) return "seed";
  if (growth < 30) return "sprout";
  if (growth < 70) return "growing";
  if (growth < 100) return "budding";
  return "ripe";
}

/**
 * Advance one plant in place by a single tick.
 * @param {object} plant - { growth:number, water:number, stage, ripe }
 * @param {object} crop - { ripeTicks:number }
 * @returns {object} the same plant (mutated)
 */
function advancePlant(plant, crop) {
  if (!plant) return plant;
  const perTick = crop && crop.ripeTicks ? 100 / crop.ripeTicks : 5;
  const thirsty = (plant.water ?? 0) <= 0;

  if (!thirsty && plant.growth < 100) {
    plant.growth = Math.min(100, plant.growth + perTick);
  }
  plant.water = Math.max(0, (plant.water ?? 0) - WATER_DECAY_PER_TICK);

  plant.stage = stageFor(plant.growth);
  plant.ripe = plant.growth >= 100;
  plant.thirsty = plant.water <= 0;
  return plant;
}

module.exports = { advancePlant, stageFor, STAGES, WATER_DECAY_PER_TICK };
