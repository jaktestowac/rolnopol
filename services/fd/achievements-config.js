/**
 * Farm Defence — Achievements & Leaderboard configuration.
 *
 * Achievement definitions are evaluated against LIFETIME, server‑authoritative
 * counters (see achievements.service.js). The score formula is intentionally the
 * single source of truth for leaderboard ranking — it is computed from the game
 * state the server owns, never from anything the client submits.
 */

// Lifetime stat keys tracked per player. These are accumulated from positive
// deltas observed on the authoritative game state, so a "reset" never reduces them.
const TRACKED_STATS = ["towersPlaced", "enemiesKilled", "enemiesLeaked", "wavesCompleted", "totalDamageDealt"];

/**
 * Achievement catalogue. Each achievement unlocks once `stat >= threshold`.
 * `stat: "victories"` / `"gamesPlayed"` are profile‑level counters maintained by
 * the service (incremented on victory / game‑over events respectively).
 */
const ACHIEVEMENTS = [
  // Tower building milestones
  {
    id: "towers-10",
    stat: "towersPlaced",
    threshold: 10,
    label: "Apprentice Builder",
    icon: "fa-chess-rook",
    description: "Place 10 towers.",
  },
  { id: "towers-50", stat: "towersPlaced", threshold: 50, label: "Master Builder", icon: "fa-chess-rook", description: "Place 50 towers." },
  {
    id: "towers-100",
    stat: "towersPlaced",
    threshold: 100,
    label: "Tower Tycoon",
    icon: "fa-chess-rook",
    description: "Place 100 towers.",
  },

  // Combat milestones
  {
    id: "kills-100",
    stat: "enemiesKilled",
    threshold: 100,
    label: "Pest Control",
    icon: "fa-bug-slash",
    description: "Defeat 100 enemies.",
  },
  {
    id: "kills-500",
    stat: "enemiesKilled",
    threshold: 500,
    label: "Exterminator",
    icon: "fa-bug-slash",
    description: "Defeat 500 enemies.",
  },
  {
    id: "kills-1000",
    stat: "enemiesKilled",
    threshold: 1000,
    label: "Swarm Crusher",
    icon: "fa-bug-slash",
    description: "Defeat 1000 enemies.",
  },
  {
    id: "kills-5000",
    stat: "enemiesKilled",
    threshold: 5000,
    label: "Hive Breaker",
    icon: "fa-bug-slash",
    description: "Defeat 5000 enemies.",
  },
  {
    id: "kills-10000",
    stat: "enemiesKilled",
    threshold: 10000,
    label: "Insect Annihilator",
    icon: "fa-bug-slash",
    description: "Defeat 10,000 enemies.",
  },
  {
    id: "kills-50000",
    stat: "enemiesKilled",
    threshold: 50000,
    label: "Bug Obliterator",
    icon: "fa-bug-slash",
    description: "Defeat 50,000 enemies.",
  },
  {
    id: "kills-100000",
    stat: "enemiesKilled",
    threshold: 100000,
    label: "Pestilence Incarnate",
    icon: "fa-bug-slash",
    description: "Defeat 100,000 enemies.",
  },
  {
    id: "kills-500000",
    stat: "enemiesKilled",
    threshold: 500000,
    label: "Plague Bringer",
    icon: "fa-bug-slash",
    description: "Defeat 500,000 enemies.",
  },
  {
    id: "kills-1000000",
    stat: "enemiesKilled",
    threshold: 1000000,
    label: "Insect God",
    icon: "fa-bug-slash",
    description: "Defeat 1,000,000 enemies.",
  },
  {
    id: "kills-5000000",
    stat: "enemiesKilled",
    threshold: 5000000,
    label: "Bug Demiurge",
    icon: "fa-bug-slash",
    description: "Defeat 5,000,000 enemies.",
  },
  {
    id: "kills-10000000",
    stat: "enemiesKilled",
    threshold: 10000000,
    label: "Master of the Swarm",
    icon: "fa-bug-slash",
    description: "Defeat 10,000,000 enemies.",
  },
  {
    id: "kills-50000000",
    stat: "enemiesKilled",
    threshold: 50000000,
    label: "Lord of Vermin",
    icon: "fa-bug-slash",
    description: "Defeat 50,000,000 enemies.",
  },
  {
    id: "kills-100000000",
    stat: "enemiesKilled",
    threshold: 100000000,
    label: "Emperor of Insects",
    icon: "fa-bug-slash",
    description: "Defeat 100,000,000 enemies.",
  },

  // Wave milestones
  { id: "waves-10", stat: "wavesCompleted", threshold: 10, label: "Wave Rider", icon: "fa-water", description: "Complete 10 waves." },
  { id: "waves-50", stat: "wavesCompleted", threshold: 50, label: "Tide Turner", icon: "fa-water", description: "Complete 50 waves." },
  { id: "waves-100", stat: "wavesCompleted", threshold: 100, label: "Surge Surfer", icon: "fa-water", description: "Complete 100 waves." },
  {
    id: "waves-500",
    stat: "wavesCompleted",
    threshold: 500,
    label: "Endless Conqueror",
    icon: "fa-water",
    description: "Complete 500 waves.",
  },
  {
    id: "waves-1000",
    stat: "wavesCompleted",
    threshold: 1000,
    label: "Immortal Farmer",
    icon: "fa-water",
    description: "Complete 1000 waves.",
  },
  {
    id: "waves-5000",
    stat: "wavesCompleted",
    threshold: 5000,
    label: "Eternal Guardian",
    icon: "fa-water",
    description: "Complete 5000 waves.",
  },
  {
    id: "waves-10000",
    stat: "wavesCompleted",
    threshold: 10000,
    label: "Mythic Protector",
    icon: "fa-water",
    description: "Complete 10,000 waves.",
  },
  {
    id: "waves-50000",
    stat: "wavesCompleted",
    threshold: 50000,
    label: "Legendary Sentinel",
    icon: "fa-water",
    description: "Complete 50,000 waves.",
  },
  {
    id: "waves-100000",
    stat: "wavesCompleted",
    threshold: 100000,
    label: "Farm Defence Deity",
    icon: "fa-water",
    description: "Complete 100,000 waves.",
  },
  {
    id: "waves-500000",
    stat: "wavesCompleted",
    threshold: 500000,
    label: "Cosmic Protector",
    icon: "fa-water",
    description: "Complete 500,000 waves.",
  },
  {
    id: "waves-1000000",
    stat: "wavesCompleted",
    threshold: 1000000,
    label: "Universal Guardian",
    icon: "fa-water",
    description: "Complete 1,000,000 waves.",
  },
  {
    id: "waves-5000000",
    stat: "wavesCompleted",
    threshold: 5000000,
    label: "Omniversal Sentinel",
    icon: "fa-water",
    description: "Complete 5,000,000 waves.",
  },
  {
    id: "waves-10000000",
    stat: "wavesCompleted",
    threshold: 10000000,
    label: "Farm Defence Omnipotent",
    icon: "fa-water",
    description: "Complete 10,000,000 waves.",
  },
  {
    id: "waves-50000000",
    stat: "wavesCompleted",
    threshold: 50000000,
    label: "Farm Defence Almighty",
    icon: "fa-water",
    description: "Complete 50,000,000 waves.",
  },
  {
    id: "waves-100000000",
    stat: "wavesCompleted",
    threshold: 100000000,
    label: "Farm Defence Supreme",
    icon: "fa-water",
    description: "Complete 100,000,000 waves.",
  },

  // Damage milestone
  {
    id: "damage-10000",
    stat: "totalDamageDealt",
    threshold: 10000,
    label: "Heavy Hitter",
    icon: "fa-burst",
    description: "Deal 10,000 total damage.",
  },
  {
    id: "damage-100000",
    stat: "totalDamageDealt",
    threshold: 100000,
    label: "Damage Dealer",
    icon: "fa-burst",
    description: "Deal 100,000 total damage.",
  },
  {
    id: "damage-1000000",
    stat: "totalDamageDealt",
    threshold: 1000000,
    label: "Destructive Force",
    icon: "fa-burst",
    description: "Deal 1,000,000 total damage.",
  },
  {
    id: "damage-10000000",
    stat: "totalDamageDealt",
    threshold: 10000000,
    label: "Cataclysmic Power",
    icon: "fa-burst",
    description: "Deal 10,000,000 total damage.",
  },
  {
    id: "damage-100000000",
    stat: "totalDamageDealt",
    threshold: 100000000,
    label: "Apocalyptic Destruction",
    icon: "fa-burst",
    description: "Deal 100,000,000 total damage.",
  },
  {
    id: "damage-500000000",
    stat: "totalDamageDealt",
    threshold: 500000000,
    label: "Armageddon Incarnate",
    icon: "fa-burst",
    description: "Deal 500,000,000 total damage.",
  },
  {
    id: "damage-1000000000",
    stat: "totalDamageDealt",
    threshold: 1000000000,
    label: "Farm Defence Annihilator",
    icon: "fa-burst",
    description: "Deal 1,000,000,000 total damage.",
  },

  // Game outcome milestones
  { id: "first-win", stat: "victories", threshold: 1, label: "Field Defender", icon: "fa-trophy", description: "Win your first game." },
  { id: "wins-10", stat: "victories", threshold: 10, label: "Undefeated Farmer", icon: "fa-trophy", description: "Win 10 games." },
  { id: "games-25", stat: "gamesPlayed", threshold: 25, label: "Veteran", icon: "fa-medal", description: "Play 25 games." },
  { id: "games-100", stat: "gamesPlayed", threshold: 100, label: "Seasoned Veteran", icon: "fa-medal", description: "Play 100 games." },
  { id: "games-500", stat: "gamesPlayed", threshold: 500, label: "Farm Defence Regular", icon: "fa-medal", description: "Play 500 games." },
  {
    id: "games-1000",
    stat: "gamesPlayed",
    threshold: 1000,
    label: "Farm Defence Enthusiast",
    icon: "fa-medal",
    description: "Play 1000 games.",
  },
  {
    id: "games-5000",
    stat: "gamesPlayed",
    threshold: 5000,
    label: "Farm Defence Addict",
    icon: "fa-medal",
    description: "Play 5000 games.",
  },
  {
    id: "games-10000",
    stat: "gamesPlayed",
    threshold: 10000,
    label: "Farm Defence Maniac",
    icon: "fa-medal",
    description: "Play 10,000 games.",
  },
  {
    id: "games-50000",
    stat: "gamesPlayed",
    threshold: 50000,
    label: "Farm Defence Zealot",
    icon: "fa-medal",
    description: "Play 50,000 games.",
  },
  {
    id: "games-100000",
    stat: "gamesPlayed",
    threshold: 100000,
    label: "Farm Defence Fanatic",
    icon: "fa-medal",
    description: "Play 100,000 games.",
  },
  {
    id: "games-500000",
    stat: "gamesPlayed",
    threshold: 500000,
    label: "Farm Defence Fiend",
    icon: "fa-medal",
    description: "Play 500,000 games.",
  },
  {
    id: "games-1000000",
    stat: "gamesPlayed",
    threshold: 1000000,
    label: "Farm Defence Junkie",
    icon: "fa-medal",
    description: "Play 1,000,000 games.",
  },
  {
    id: "games-5000000",
    stat: "gamesPlayed",
    threshold: 5000000,
    label: "Farm Defence Maniac",
    icon: "fa-medal",
    description: "Play 5,000,000 games.",
  },
  {
    id: "games-10000000",
    stat: "gamesPlayed",
    threshold: 10000000,
    label: "Farm Defence Overlord",
    icon: "fa-medal",
    description: "Play 10,000,000 games.",
  },
  {
    id: "games-50000000",
    stat: "gamesPlayed",
    threshold: 50000000,
    label: "Farm Defence Emperor",
    icon: "fa-medal",
    description: "Play 50,000,000 games.",
  },
  {
    id: "games-100000000",
    stat: "gamesPlayed",
    threshold: 100000000,
    label: "Farm Defence Immortal",
    icon: "fa-medal",
    description: "Play 100,000,000 games.",
  },
];

/**
 * Server‑authoritative score formula. Computed from the game state the server
 * owns; the client cannot influence it except by actually playing well.
 * @param {object} stats game state `stats` block
 * @param {boolean} victory whether this run ended in victory
 * @returns {number}
 */
function computeScore(stats = {}, victory = false) {
  const kills = stats.enemiesKilled || 0;
  const waves = stats.wavesCompleted || 0;
  const damage = stats.totalDamageDealt || 0;
  const leaked = stats.enemiesLeaked || 0;

  const score =
    kills * 10 + // each kill
    waves * 100 + // surviving a wave is worth a lot
    Math.floor(damage / 10) - // damage contributes modestly
    leaked * 5 + // penalty for letting enemies through
    (victory ? 1000 : 0); // victory bonus

  return Math.max(0, score);
}

module.exports = {
  TRACKED_STATS,
  ACHIEVEMENTS,
  computeScore,
};
