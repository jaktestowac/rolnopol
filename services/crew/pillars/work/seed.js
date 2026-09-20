/**
 * Idempotent demo seed for the work pillar (PRD §11).
 *
 * Gives a fresh install a believable week: four duty types, and a few shifts for
 * whoever is on the roster. Same two rules as the profiles seed —
 *
 *   - **idempotent**: it only ever adds duty types whose code is absent, and only
 *     plans shifts when the store has none, so running it twice changes nothing;
 *   - **crew stores only**: it never touches `staff.json`, it rosters the people
 *     who are already there (§12.2).
 */
const { getStore, read, transact } = require("./store");
const { addDays } = require("../../clock");

const DUTY_TYPES = [
  { code: "milking_early", name: "Early milking", startTime: "05:00", endTime: "08:00", requiredRole: "DAIRY_HAND", colour: "#22c55e" },
  { code: "feeding", name: "Feeding round", startTime: "09:00", endTime: "12:00", requiredRole: null, colour: "#84cc16" },
  {
    code: "harvest_long_day",
    name: "Harvest long day",
    startTime: "07:00",
    endTime: "19:00",
    requiredRole: "TRACTOR_DRIVER",
    colour: "#f59e0b",
  },
  // Deliberately crosses midnight: the roster has to handle it, so the demo data
  // contains one from the start rather than leaving it to be discovered later.
  { code: "night_watch", name: "Night watch", startTime: "22:00", endTime: "06:00", requiredRole: null, colour: "#6366f1" },
];

async function seedWork({ staffRecords, today, nowIso }) {
  const store = getStore();
  const existing = await read(store);

  return transact(store, (document) => {
    let lastDutyTypeId = document.counters.lastDutyTypeId;
    let lastShiftId = document.counters.lastShiftId;

    const addedDutyTypes = [];
    const byUser = new Map();
    for (const staff of staffRecords) {
      const list = byUser.get(Number(staff.userId)) || [];
      list.push(staff);
      byUser.set(Number(staff.userId), list);
    }

    for (const [userId, staff] of byUser.entries()) {
      const codesPresent = new Set(document.dutyTypes.filter((row) => Number(row.userId) === userId).map((row) => row.code));

      for (const template of DUTY_TYPES) {
        if (codesPresent.has(template.code)) continue;
        lastDutyTypeId += 1;
        addedDutyTypes.push({ id: lastDutyTypeId, userId, ...template, createdAt: nowIso });
      }
    }

    const dutyTypes = [...document.dutyTypes, ...addedDutyTypes];
    const addedShifts = [];

    // Only roster when the store has no shifts at all for that user, so a seed can
    // never scribble over a roster somebody built.
    for (const [userId, staff] of byUser.entries()) {
      const hasShifts = document.shifts.some((row) => Number(row.userId) === userId);
      if (hasShifts) continue;

      const usersDutyTypes = dutyTypes.filter((row) => Number(row.userId) === userId);
      if (usersDutyTypes.length === 0) continue;

      staff.slice(0, 4).forEach((member, index) => {
        // One shift each over the coming days, cycling duty types so the demo week
        // shows more than one kind of work.
        const dutyType = usersDutyTypes[index % usersDutyTypes.length];
        lastShiftId += 1;
        addedShifts.push({
          id: lastShiftId,
          userId,
          staffId: Number(member.id),
          dutyTypeId: dutyType.id,
          date: addDays(today, index + 1),
          status: index === 0 ? "CONFIRMED" : "PLANNED",
          fieldId: null,
          note: "Seeded demo shift.",
          cancelReason: null,
          createdAt: nowIso,
          updatedAt: nowIso,
          version: 1,
        });
      });
    }

    return {
      document: {
        ...document,
        dutyTypes,
        shifts: [...document.shifts, ...addedShifts],
        counters: { ...document.counters, lastDutyTypeId, lastShiftId },
      },
      result: { dutyTypesCreated: addedDutyTypes.length, shiftsCreated: addedShifts.length, dutyTypesBefore: existing.dutyTypes.length },
    };
  });
}

module.exports = { seedWork, DUTY_TYPES };
