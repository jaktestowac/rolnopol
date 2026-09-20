/**
 * Location catalog — Polish voivodeships → cities. `district` on a property holds
 * the city; the voivodeship is only the grouping the UI renders its pickers by.
 * This is the ONE source of truth for those option lists (the web page fetches it
 * instead of hardcoding a copy), so adding a region or a city is a backend-only
 * change.
 *
 * REGIONS is fixed. Custom locations are user-added and live in the inventory DB
 * next to the properties, which makes them GLOBAL: whoever adds one, everybody
 * sees it and can list/search in it. SAMPLE_CUSTOM is seeded on first boot (and
 * backfilled into older stores) so the shared list is never empty in a demo.
 */
const REGIONS = {
  Dolnośląskie: ["Wrocław", "Karpacz", "Wałbrzych"],
  "Kujawsko-Pomorskie": ["Bydgoszcz", "Toruń"],
  Lubelskie: ["Lublin", "Kazimierz Dolny"],
  Lubuskie: ["Zielona Góra"],
  Łódzkie: ["Łódź"],
  Małopolskie: ["Kraków", "Zakopane", "Tarnów"],
  Mazowieckie: ["Warszawa", "Płock", "Radom"],
  Opolskie: ["Opole"],
  Podkarpackie: ["Rzeszów", "Ustrzyki Dolne"],
  Podlaskie: ["Białystok", "Augustów"],
  Pomorskie: ["Gdańsk", "Sopot", "Gdynia"],
  Śląskie: ["Katowice", "Wisła"],
  Świętokrzyskie: ["Kielce"],
  "Warmińsko-Mazurskie": ["Olsztyn", "Giżycko"],
  Wielkopolskie: ["Poznań"],
  Zachodniopomorskie: ["Szczecin", "Kołobrzeg"],
};

// Owned by the synthetic seed host, like the demo listings — so it reads as a
// fixture and no real user can remove it.
const SAMPLE_CUSTOM = [{ voivodeship: "Podlaskie", city: "Supraśl", addedBy: "seed-host", addedAt: "2026-01-01T00:00:00.000Z" }];

module.exports = { REGIONS, SAMPLE_CUSTOM };
