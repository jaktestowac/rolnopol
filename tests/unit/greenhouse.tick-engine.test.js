import { describe, it, expect } from "vitest";
const tickEngine = require("../../external-services/greenhouse/greenhouse-server/simulator/tick-engine.js");

const TOMATO = { id: "tomato", ripeTicks: 20 }; // 5% growth per watered tick

function freshPlant() {
  return { crop: "tomato", growth: 0, water: 100, stage: "seed", ripe: false, thirsty: false };
}

describe("tick-engine — stageFor", () => {
  it("maps growth to stages", () => {
    expect(tickEngine.stageFor(0)).toBe("seed");
    expect(tickEngine.stageFor(10)).toBe("sprout");
    expect(tickEngine.stageFor(50)).toBe("growing");
    expect(tickEngine.stageFor(85)).toBe("budding");
    expect(tickEngine.stageFor(100)).toBe("ripe");
  });
});

describe("tick-engine — advancePlant", () => {
  it("grows a watered plant toward ripeness", () => {
    const p = freshPlant();
    tickEngine.advancePlant(p, TOMATO);
    expect(p.growth).toBeCloseTo(5, 5);
    expect(p.water).toBe(95);
    expect(p.stage).toBe("sprout");
    expect(p.ripe).toBe(false);
  });

  it("reaches ripe after ripeTicks watered ticks (re-watering as needed)", () => {
    const p = freshPlant();
    for (let i = 0; i < 20; i++) {
      p.water = 100; // keep it watered each tick
      tickEngine.advancePlant(p, TOMATO);
    }
    expect(p.growth).toBe(100);
    expect(p.stage).toBe("ripe");
    expect(p.ripe).toBe(true);
  });

  it("stalls growth when thirsty (water 0)", () => {
    const p = freshPlant();
    p.water = 0;
    tickEngine.advancePlant(p, TOMATO);
    expect(p.growth).toBe(0);
    expect(p.thirsty).toBe(true);
  });

  it("drains water by the decay rate and never below 0", () => {
    const p = freshPlant();
    p.water = 3;
    tickEngine.advancePlant(p, TOMATO);
    expect(p.water).toBe(0);
  });

  it("does not grow past 100", () => {
    const p = freshPlant();
    p.growth = 99;
    p.water = 100;
    tickEngine.advancePlant(p, TOMATO);
    expect(p.growth).toBe(100);
  });
});
