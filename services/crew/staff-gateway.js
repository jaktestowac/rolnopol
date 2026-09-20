/**
 * The ONLY code in this module that touches `staff.json` (PRD §12.2, §8.1.1).
 *
 * Read, and create-by-hiring. That is the entire surface, and the absence of the
 * rest is the design:
 *
 *   - there is **no update path**. Not a disabled one, not a guarded one — the
 *     function does not exist, so a future "edit member" feature cannot quietly
 *     extend it;
 *   - there is **no delete path**, and `ResourceService.cascadeDelete` is never
 *     imported here. Crew Office cannot fire anyone. Ending employment is an
 *     overlay write (see the profiles pillar), and removing a person stays the
 *     existing staff page's job;
 *   - hiring goes through `ResourceService("staff").create()` rather than the
 *     store, so id allocation, `userId` coercion and the `STAFF_CREATED`
 *     notification event are byte-identical to a hire through
 *     `POST /api/v1/staff`. A Crew Office hire is indistinguishable downstream.
 *
 * If you are reviewing a change to this file: the write-permission matrix in
 * §12.2 and `crew-write-permissions.test.js` are the contract. A new exported
 * function that mutates an existing staff record breaks both.
 */
const ResourceService = require("../resource.service");
const dbManager = require("../../data/database-manager");

/**
 * @param {object} [options]
 * @param {object} [options.onStoreRead] - called per store read, for extensions.storeReads
 */
function createStaffGateway({ onStoreRead } = {}) {
  const service = new ResourceService("staff");
  const db = dbManager.getStaffDatabase();
  const countRead = () => {
    if (typeof onStoreRead === "function") onStoreRead("staff");
  };

  return {
    /**
     * Every staff record owned by this user.
     *
     * One read for the whole roster — the loaders layer builds its maps from
     * this, which is why a roster query's store reads do not grow with crew size.
     */
    async listOwned(userId) {
      countRead();
      const numericUserId = Number(userId);
      const all = await db.getAll();
      return (Array.isArray(all) ? all : []).filter((record) => Number(record.userId) === numericUserId);
    },

    /** One owned staff record, or null. Not-owned and not-existing are both null. */
    async findOwned(userId, staffId) {
      const numericStaffId = Number(staffId);
      if (!Number.isInteger(numericStaffId)) return null;
      const owned = await this.listOwned(userId);
      return owned.find((record) => Number(record.id) === numericStaffId) || null;
    },

    /**
     * Hire: create a staff record for this user.
     *
     * `userId` is always the caller's — it is a parameter of this function, never
     * a field read from input (§9). Only the three base fields are written; the
     * employment attributes live in the crew overlay.
     */
    async hire(userId, { name, surname, age }) {
      const created = await service.create(userId, { name, surname, age });
      return created;
    },
  };
}

module.exports = { createStaffGateway };
