/**
 * Rolnopol Survival — hex geometry (PRD 6.7 and WP-03).
 *
 * Two coordinate systems live side by side on purpose:
 *   axial (q, r)   — neighbours and distances are trivial
 *   offset (col,row) — the map is a rectangle, and "west edge" only means
 *                      something in offset coordinates
 *
 * The conversion is odd-r: odd rows are shifted half a hex to the right.
 * Every tile carries both pairs, so no part of the game has to convert.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Survival = root.Survival || {};
    root.Survival.hex = factory();
  }
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  // Axial directions, clockwise from east. The order is the keyboard order:
  // key 1 is east, key 6 is south-east.
  const DIRECTIONS = [
    { q: 1, r: 0 }, // E
    { q: 1, r: -1 }, // NE
    { q: 0, r: -1 }, // NW
    { q: -1, r: 0 }, // W
    { q: -1, r: 1 }, // SW
    { q: 0, r: 1 }, // SE
  ];

  function offsetToAxial(col, row) {
    return { q: col - (row - (row & 1)) / 2, r: row };
  }

  function axialToOffset(q, r) {
    return { col: q + (r - (r & 1)) / 2, row: r };
  }

  function key(q, r) {
    return q + "," + r;
  }

  function neighbors(q, r) {
    return DIRECTIONS.map((dir) => ({ q: q + dir.q, r: r + dir.r }));
  }

  function areNeighbors(a, b) {
    return DIRECTIONS.some((dir) => a.q + dir.q === b.q && a.r + dir.r === b.r);
  }

  /** Hex distance in axial coordinates. */
  function distance(a, b) {
    const dq = a.q - b.q;
    const dr = a.r - b.r;
    return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
  }

  /**
   * Which borders of a width x height rectangle a tile sits on.
   * Corners belong to two sides, which is what makes "reach two different
   * edges" (PRD 6.11) checkable.
   */
  function edgeSides(tile, width, height) {
    const sides = [];
    if (tile.row === 0) sides.push("north");
    if (tile.row === height - 1) sides.push("south");
    if (tile.col === 0) sides.push("west");
    if (tile.col === width - 1) sides.push("east");
    return sides;
  }

  function isEdge(tile, width, height) {
    return edgeSides(tile, width, height).length > 0;
  }

  return {
    DIRECTIONS,
    offsetToAxial,
    axialToOffset,
    key,
    neighbors,
    areNeighbors,
    distance,
    edgeSides,
    isEdge,
  };
});
