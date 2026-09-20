/**
 * Read-only view of `assignments.json` (PRD §12.2, §17 Q5).
 *
 * Crew Office may SHOW which fields a member is assigned to. It never creates,
 * edits or removes an assignment — changing assignments stays the staff/fields
 * page's job. As with the staff gateway, the guarantee is structural: there is no
 * write function here to call, and `assignStaffToField` / `removeAssignment` are
 * never imported.
 */
const dbManager = require("../../data/database-manager");

function createAssignmentReader({ onStoreRead } = {}) {
  const db = dbManager.getAssignmentsDatabase();

  return {
    /**
     * Field ids per staff id, for this user's assignments only.
     *
     * Returns a Map so a roster query resolves every member's fields from one
     * read instead of one read per member.
     *
     * @returns {Promise<Map<number, number[]>>}
     */
    async fieldIdsByStaffId(userId) {
      if (typeof onStoreRead === "function") onStoreRead("assignments");
      const numericUserId = Number(userId);
      const all = await db.getAll();
      const rows = Array.isArray(all) ? all : [];

      const byStaffId = new Map();
      for (const row of rows) {
        if (Number(row.userId) !== numericUserId) continue;
        const staffId = Number(row.staffId);
        if (!Number.isInteger(staffId)) continue;
        const list = byStaffId.get(staffId) || [];
        list.push(Number(row.fieldId));
        byStaffId.set(staffId, list);
      }
      return byStaffId;
    },
  };
}

module.exports = { createAssignmentReader };
