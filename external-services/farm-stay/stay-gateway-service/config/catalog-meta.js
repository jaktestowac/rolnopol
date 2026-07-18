/**
 * FarmStay presentation catalog — the single source of truth for the option
 * lists the web UI renders: stay types, cancellation policies, amenities, and
 * card-photo themes, each with its Font Awesome icon and (where visual) a CSS
 * gradient. The page fetches this via GET /v1/catalog instead of hardcoding it,
 * so adding an amenity or a photo theme is a backend-only change.
 *
 * `types`/`policies` keys mirror the inventory service's validation enums
 * (VALID_TYPES / VALID_POLICIES) — keep them in sync.
 */
module.exports = {
  types: [
    { key: "room", label: "Room", icon: "fa-bed", gradient: "linear-gradient(135deg, #4dabf7, #1971c2)" },
    { key: "cottage", label: "Cottage", icon: "fa-house-chimney", gradient: "linear-gradient(135deg, #51cf66, #2b8a3e)" },
    { key: "camping", label: "Camping", icon: "fa-tent", gradient: "linear-gradient(135deg, #ffd43b, #e67700)" },
  ],

  policies: [
    { key: "flexible", label: "Flexible" },
    { key: "moderate", label: "Moderate" },
    { key: "strict", label: "Strict" },
  ],

  amenities: [
    { key: "kitchen", label: "Kitchen", icon: "fa-kitchen-set" },
    { key: "wifi", label: "Wi-Fi", icon: "fa-wifi" },
    { key: "fireplace", label: "Fireplace", icon: "fa-fire" },
    { key: "parking", label: "Parking", icon: "fa-square-parking" },
    { key: "breakfast", label: "Breakfast", icon: "fa-mug-hot" },
    { key: "animals", label: "Animals OK", icon: "fa-paw" },
    { key: "firepit", label: "Fire pit", icon: "fa-fire-flame-curved" },
    { key: "water", label: "Water", icon: "fa-droplet" },
    { key: "garden", label: "Garden", icon: "fa-seedling" },
    { key: "spa", label: "Spa", icon: "fa-spa" },
    { key: "gym", label: "Gym", icon: "fa-dumbbell" },
    { key: "beach-access", label: "Beach access", icon: "fa-umbrella-beach" },
    { key: "shower", label: "Shower", icon: "fa-shower" },
    { key: "wine-cellar", label: "Wine cellar", icon: "fa-wine-glass" },
    { key: "fishing", label: "Fishing", icon: "fa-fish" },
    { key: "mountain-views", label: "Mountain views", icon: "fa-mountain" },
    { key: "kayaks", label: "Kayaks", icon: "fa-anchor" },
    { key: "terrace", label: "Terrace", icon: "fa-sun" },
  ],

  photoThemes: [
    { key: "hayloft", label: "Hayloft", icon: "fa-wheat-awn", gradient: "linear-gradient(135deg, #94d82d, #e9c46a)" },
    { key: "lakeside", label: "Lakeside", icon: "fa-water", gradient: "linear-gradient(135deg, #4dabf7, #1971c2)" },
    { key: "orchard", label: "Orchard", icon: "fa-apple-whole", gradient: "linear-gradient(135deg, #ffa94d, #e8590c)" },
    { key: "mountain", label: "Mountain", icon: "fa-mountain-sun", gradient: "linear-gradient(135deg, #748ffc, #5f3dc4)" },
    { key: "meadow", label: "Meadow", icon: "fa-sun", gradient: "linear-gradient(135deg, #8ce99a, #66a80f)" },
    { key: "forest", label: "Forest", icon: "fa-tree", gradient: "linear-gradient(135deg, #40c057, #187037)" },
    { key: "barn", label: "Barn", icon: "fa-warehouse", gradient: "linear-gradient(135deg, #e8663d, #9c3517)" },
    { key: "vineyard", label: "Vineyard", icon: "fa-wine-glass", gradient: "linear-gradient(135deg, #da77f2, #9c36b5)" },
  ],
};
