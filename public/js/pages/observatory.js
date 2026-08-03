(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.ObservatoryPage = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";

  const API_ROOT = "/api/v1/observatory";

  const LOCATION_PRESETS = [
    { id: "warsaw", label: "Warsaw, Poland", latitudeDeg: 52.2297, longitudeDeg: 21.0122 },
    { id: "greenwich", label: "Greenwich, UK", latitudeDeg: 51.4769, longitudeDeg: 0.0 },
    { id: "tenerife", label: "Tenerife, Spain", latitudeDeg: 28.2916, longitudeDeg: -16.6291 },
    { id: "new-york", label: "New York, USA", latitudeDeg: 40.7128, longitudeDeg: -74.006 },
    { id: "tokyo", label: "Tokyo, Japan", latitudeDeg: 35.6762, longitudeDeg: 139.6503 },
    { id: "sydney", label: "Sydney, Australia", latitudeDeg: -33.8688, longitudeDeg: 151.2093 },
    { id: "cape-town", label: "Cape Town, South Africa", latitudeDeg: -33.9249, longitudeDeg: 18.4241 },
  ];

  const STAR_CATALOG = [
    { id: "sirius", name: "Sirius", constellation: "Canis Major", raHours: 6.7525, decDeg: -16.7161, magnitude: -1.46, color: "#cfe6ff" },
    { id: "canopus", name: "Canopus", constellation: "Carina", raHours: 6.3992, decDeg: -52.6957, magnitude: -0.74, color: "#fff0d3" },
    { id: "arcturus", name: "Arcturus", constellation: "Boötes", raHours: 14.261, decDeg: 19.1824, magnitude: -0.05, color: "#ffd29c" },
    { id: "vega", name: "Vega", constellation: "Lyra", raHours: 18.6156, decDeg: 38.7837, magnitude: 0.03, color: "#c9e2ff" },
    { id: "capella", name: "Capella", constellation: "Auriga", raHours: 5.2782, decDeg: 45.998, magnitude: 0.08, color: "#fff1bf" },
    { id: "rigel", name: "Rigel", constellation: "Orion", raHours: 5.2423, decDeg: -8.2016, magnitude: 0.13, color: "#c6e0ff" },
    { id: "procyon", name: "Procyon", constellation: "Canis Minor", raHours: 7.655, decDeg: 5.225, magnitude: 0.34, color: "#fff2d7" },
    { id: "achernar", name: "Achernar", constellation: "Eridanus", raHours: 1.6286, decDeg: -57.2368, magnitude: 0.46, color: "#d0e7ff" },
    { id: "betelgeuse", name: "Betelgeuse", constellation: "Orion", raHours: 5.9195, decDeg: 7.4071, magnitude: 0.5, color: "#ffbe8f" },
    { id: "hadar", name: "Hadar", constellation: "Centaurus", raHours: 14.0637, decDeg: -60.373, magnitude: 0.61, color: "#d5e9ff" },
    { id: "acrux", name: "Acrux", constellation: "Crux", raHours: 12.4433, decDeg: -63.0991, magnitude: 0.76, color: "#d3e7ff" },
    { id: "altair", name: "Altair", constellation: "Aquila", raHours: 19.8464, decDeg: 8.8683, magnitude: 0.77, color: "#edf5ff" },
    { id: "aldebaran", name: "Aldebaran", constellation: "Taurus", raHours: 4.5987, decDeg: 16.5093, magnitude: 0.85, color: "#ffb587" },
    { id: "spica", name: "Spica", constellation: "Virgo", raHours: 13.4199, decDeg: -11.1613, magnitude: 0.98, color: "#dcecff" },
    { id: "antares", name: "Antares", constellation: "Scorpius", raHours: 16.4901, decDeg: -26.4319, magnitude: 1.06, color: "#ff9f87" },
    { id: "pollux", name: "Pollux", constellation: "Gemini", raHours: 7.7553, decDeg: 28.0262, magnitude: 1.14, color: "#ffc995" },
    {
      id: "fomalhaut",
      name: "Fomalhaut",
      constellation: "Piscis Austrinus",
      raHours: 22.9608,
      decDeg: -29.6222,
      magnitude: 1.16,
      color: "#f4f7ff",
    },
    { id: "deneb", name: "Deneb", constellation: "Cygnus", raHours: 20.6905, decDeg: 45.2803, magnitude: 1.25, color: "#edf5ff" },
    { id: "mimosa", name: "Mimosa", constellation: "Crux", raHours: 12.7953, decDeg: -59.6888, magnitude: 1.25, color: "#bedeff" },
    { id: "regulus", name: "Regulus", constellation: "Leo", raHours: 10.1395, decDeg: 11.9672, magnitude: 1.35, color: "#d8ebff" },
    { id: "adhara", name: "Adhara", constellation: "Canis Major", raHours: 6.9771, decDeg: -28.9721, magnitude: 1.5, color: "#d8ebff" },
    { id: "castor", name: "Castor", constellation: "Gemini", raHours: 7.5766, decDeg: 31.8883, magnitude: 1.58, color: "#eef5ff" },
    { id: "gacrux", name: "Gacrux", constellation: "Crux", raHours: 12.5194, decDeg: -57.1132, magnitude: 1.63, color: "#ffbc9f" },
    { id: "bellatrix", name: "Bellatrix", constellation: "Orion", raHours: 5.4189, decDeg: 6.3497, magnitude: 1.64, color: "#d9ebff" },
    { id: "elnath", name: "Elnath", constellation: "Taurus", raHours: 5.4382, decDeg: 28.6075, magnitude: 1.65, color: "#cfe6ff" },
    {
      id: "miaplacidus",
      name: "Miaplacidus",
      constellation: "Carina",
      raHours: 9.2201,
      decDeg: -69.7172,
      magnitude: 1.67,
      color: "#f5f7ff",
    },
    { id: "alnilam", name: "Alnilam", constellation: "Orion", raHours: 5.6036, decDeg: -1.2019, magnitude: 1.69, color: "#d5e8ff" },
    { id: "alnair", name: "Alnair", constellation: "Grus", raHours: 22.1372, decDeg: -46.9609, magnitude: 1.73, color: "#eef5ff" },
    { id: "alioth", name: "Alioth", constellation: "Ursa Major", raHours: 12.9004, decDeg: 55.9598, magnitude: 1.76, color: "#eef5ff" },
    { id: "dubhe", name: "Dubhe", constellation: "Ursa Major", raHours: 11.0621, decDeg: 61.7508, magnitude: 1.79, color: "#fff0c9" },
    { id: "mirfak", name: "Mirfak", constellation: "Perseus", raHours: 3.4054, decDeg: 49.8612, magnitude: 1.79, color: "#fff0cf" },
    {
      id: "kaus-australis",
      name: "Kaus Australis",
      constellation: "Sagittarius",
      raHours: 18.4029,
      decDeg: -34.3846,
      magnitude: 1.79,
      color: "#e8f3ff",
    },
    { id: "wezen", name: "Wezen", constellation: "Canis Major", raHours: 7.1399, decDeg: -26.3932, magnitude: 1.83, color: "#fff0cf" },
    { id: "alkaid", name: "Alkaid", constellation: "Ursa Major", raHours: 13.7923, decDeg: 49.3133, magnitude: 1.85, color: "#d5e8ff" },
    { id: "sargas", name: "Sargas", constellation: "Scorpius", raHours: 17.6219, decDeg: -42.9978, magnitude: 1.86, color: "#fff0d9" },
    { id: "avior", name: "Avior", constellation: "Carina", raHours: 8.3752, decDeg: -59.5095, magnitude: 1.86, color: "#ffe9bf" },
    {
      id: "atria",
      name: "Atria",
      constellation: "Triangulum Australe",
      raHours: 16.8111,
      decDeg: -69.0278,
      magnitude: 1.91,
      color: "#ffd9bb",
    },
    { id: "peacock", name: "Peacock", constellation: "Pavo", raHours: 20.4275, decDeg: -56.7351, magnitude: 1.94, color: "#d8ecff" },
    { id: "alphard", name: "Alphard", constellation: "Hydra", raHours: 9.4598, decDeg: -8.6586, magnitude: 1.98, color: "#ffbb95" },
    { id: "polaris", name: "Polaris", constellation: "Ursa Minor", raHours: 2.5303, decDeg: 89.2641, magnitude: 1.98, color: "#fff1d8" },
    { id: "hamal", name: "Hamal", constellation: "Aries", raHours: 2.1196, decDeg: 23.4624, magnitude: 2.0, color: "#ffca9d" },
    { id: "nunki", name: "Nunki", constellation: "Sagittarius", raHours: 18.9211, decDeg: -26.2967, magnitude: 2.05, color: "#d7ebff" },
    { id: "mirach", name: "Mirach", constellation: "Andromeda", raHours: 1.1622, decDeg: 35.6206, magnitude: 2.05, color: "#ffceac" },
    { id: "alpheratz", name: "Alpheratz", constellation: "Andromeda", raHours: 0.1398, decDeg: 29.0904, magnitude: 2.06, color: "#d4e9ff" },
    { id: "kochab", name: "Kochab", constellation: "Ursa Minor", raHours: 14.8451, decDeg: 74.1555, magnitude: 2.07, color: "#ffcb9e" },
    {
      id: "rasalhague",
      name: "Rasalhague",
      constellation: "Ophiuchus",
      raHours: 17.5822,
      decDeg: 12.56,
      magnitude: 2.08,
      color: "#e2efff",
    },
    { id: "algol", name: "Algol", constellation: "Perseus", raHours: 3.1361, decDeg: 40.9556, magnitude: 2.12, color: "#d5e9ff" },
    { id: "denebola", name: "Denebola", constellation: "Leo", raHours: 11.8177, decDeg: 14.5721, magnitude: 2.14, color: "#edf5ff" },
    { id: "mizar", name: "Mizar", constellation: "Ursa Major", raHours: 13.3987, decDeg: 54.9254, magnitude: 2.23, color: "#d5e8ff" },
    { id: "schedar", name: "Schedar", constellation: "Cassiopeia", raHours: 0.6751, decDeg: 56.5373, magnitude: 2.24, color: "#ffca9a" },
    { id: "caph", name: "Caph", constellation: "Cassiopeia", raHours: 0.1529, decDeg: 59.1498, magnitude: 2.28, color: "#fff0d0" },
    { id: "merak", name: "Merak", constellation: "Ursa Major", raHours: 11.0307, decDeg: 56.3824, magnitude: 2.37, color: "#f1f6ff" },
    { id: "phecda", name: "Phecda", constellation: "Ursa Major", raHours: 11.8972, decDeg: 53.6948, magnitude: 2.43, color: "#e2efff" },
    { id: "markab", name: "Markab", constellation: "Pegasus", raHours: 23.0794, decDeg: 15.2053, magnitude: 2.49, color: "#e6f1ff" },
    { id: "ruchbah", name: "Ruchbah", constellation: "Cassiopeia", raHours: 1.4303, decDeg: 60.2353, magnitude: 2.68, color: "#d8ebff" },
    { id: "algenib", name: "Algenib", constellation: "Pegasus", raHours: 0.2206, decDeg: 15.1836, magnitude: 2.83, color: "#d8ebff" },
    { id: "imai", name: "Imai", constellation: "Crux", raHours: 12.2524, decDeg: -58.7489, magnitude: 2.79, color: "#d2e8ff" },
    { id: "scheat", name: "Scheat", constellation: "Pegasus", raHours: 23.0629, decDeg: 28.0828, magnitude: 2.42, color: "#ffcead" },
    { id: "megrez", name: "Megrez", constellation: "Ursa Major", raHours: 12.2571, decDeg: 57.0326, magnitude: 3.32, color: "#edf5ff" },
    { id: "segin", name: "Segin", constellation: "Cassiopeia", raHours: 2.2937, decDeg: 63.67, magnitude: 3.35, color: "#eef5ff" },
    { id: "alnitak", name: "Alnitak", constellation: "Orion", raHours: 5.6793, decDeg: -1.9426, magnitude: 1.74, color: "#d7ebff" },
    { id: "mintaka", name: "Mintaka", constellation: "Orion", raHours: 5.5334, decDeg: -0.2991, magnitude: 2.23, color: "#dcecff" },
    { id: "saiph", name: "Saiph", constellation: "Orion", raHours: 5.7959, decDeg: -9.6696, magnitude: 2.07, color: "#d8ebff" },
    { id: "meissa", name: "Meissa", constellation: "Orion", raHours: 5.5856, decDeg: 9.9342, magnitude: 3.33, color: "#eef5ff" },
    { id: "mirzam", name: "Mirzam", constellation: "Canis Major", raHours: 6.3783, decDeg: -17.9559, magnitude: 1.98, color: "#d8ebff" },
    { id: "alhena", name: "Alhena", constellation: "Gemini", raHours: 6.6285, decDeg: 16.3993, magnitude: 1.93, color: "#ddeeff" },
    { id: "algieba", name: "Algieba", constellation: "Leo", raHours: 10.3329, decDeg: 19.8415, magnitude: 2.08, color: "#ffcfa8" },
    { id: "shaula", name: "Shaula", constellation: "Scorpius", raHours: 17.5601, decDeg: -37.1038, magnitude: 1.62, color: "#d5e8ff" },
    { id: "lesath", name: "Lesath", constellation: "Scorpius", raHours: 17.5127, decDeg: -37.2958, magnitude: 2.7, color: "#dcecff" },
    { id: "sadr", name: "Sadr", constellation: "Cygnus", raHours: 20.3705, decDeg: 40.2567, magnitude: 2.23, color: "#eef5ff" },
    { id: "albireo", name: "Albireo", constellation: "Cygnus", raHours: 19.512, decDeg: 27.9597, magnitude: 3.05, color: "#ffd8ab" },
    { id: "tarazed", name: "Tarazed", constellation: "Aquila", raHours: 19.7709, decDeg: 10.6133, magnitude: 2.72, color: "#ffc79f" },
    { id: "menkalinan", name: "Menkalinan", constellation: "Auriga", raHours: 5.9921, decDeg: 44.9474, magnitude: 1.9, color: "#eef5ff" },
    { id: "sheliak", name: "Sheliak", constellation: "Lyra", raHours: 18.8347, decDeg: 33.3627, magnitude: 3.52, color: "#f1f6ff" },
    { id: "sulafat", name: "Sulafat", constellation: "Lyra", raHours: 18.9824, decDeg: 32.6896, magnitude: 3.25, color: "#f3f7ff" },
    { id: "almaak", name: "Almaak", constellation: "Andromeda", raHours: 2.0649, decDeg: 42.3297, magnitude: 2.26, color: "#ffcfab" },
    { id: "enif", name: "Enif", constellation: "Pegasus", raHours: 21.7364, decDeg: 9.875, magnitude: 2.39, color: "#ffd0aa" },
    { id: "sheratan", name: "Sheratan", constellation: "Aries", raHours: 1.9107, decDeg: 20.808, magnitude: 2.64, color: "#f4f7ff" },
    { id: "mesarthim", name: "Mesarthim", constellation: "Aries", raHours: 1.8926, decDeg: 19.2938, magnitude: 3.88, color: "#eef5ff" },
    { id: "pherkad", name: "Pherkad", constellation: "Ursa Minor", raHours: 15.3455, decDeg: 71.834, magnitude: 3.05, color: "#fff0cf" },
    { id: "zosma", name: "Zosma", constellation: "Leo", raHours: 11.2351, decDeg: 20.5237, magnitude: 2.56, color: "#dcecff" },
    { id: "adhafera", name: "Adhafera", constellation: "Leo", raHours: 10.2782, decDeg: 23.4173, magnitude: 3.33, color: "#ffe1bb" },
    { id: "rasalas", name: "Rasalas", constellation: "Leo", raHours: 9.8794, decDeg: 26.0069, magnitude: 3.88, color: "#fff0cf" },
    { id: "dschubba", name: "Dschubba", constellation: "Scorpius", raHours: 16.0056, decDeg: -22.6217, magnitude: 2.29, color: "#d8ebff" },
    { id: "ascella", name: "Ascella", constellation: "Sagittarius", raHours: 19.0435, decDeg: -29.8801, magnitude: 2.6, color: "#eef5ff" },
    {
      id: "kaus-media",
      name: "Kaus Media",
      constellation: "Sagittarius",
      raHours: 18.3499,
      decDeg: -29.8281,
      magnitude: 2.72,
      color: "#e7f2ff",
    },
    {
      id: "kaus-borealis",
      name: "Kaus Borealis",
      constellation: "Sagittarius",
      raHours: 18.4662,
      decDeg: -25.4217,
      magnitude: 2.82,
      color: "#eef5ff",
    },
    { id: "alshain", name: "Alshain", constellation: "Aquila", raHours: 19.9219, decDeg: 6.4068, magnitude: 3.71, color: "#f3f7ff" },
    { id: "izar", name: "Izar", constellation: "Boötes", raHours: 14.7498, decDeg: 27.0742, magnitude: 2.35, color: "#ffd7b1" },
    { id: "nekkar", name: "Nekkar", constellation: "Boötes", raHours: 15.0324, decDeg: 40.3906, magnitude: 3.49, color: "#fff0cf" },
    { id: "seginus", name: "Seginus", constellation: "Boötes", raHours: 14.5346, decDeg: 38.3083, magnitude: 3.04, color: "#d7ebff" },
    { id: "eltanin", name: "Eltanin", constellation: "Draco", raHours: 17.9434, decDeg: 51.4889, magnitude: 2.24, color: "#ffcfab" },
    { id: "rastaban", name: "Rastaban", constellation: "Draco", raHours: 17.5072, decDeg: 52.3014, magnitude: 2.79, color: "#fff0d8" },
    { id: "cebalrai", name: "Cebalrai", constellation: "Ophiuchus", raHours: 17.7245, decDeg: 4.5673, magnitude: 2.76, color: "#ffcfa7" },
    { id: "sabik", name: "Sabik", constellation: "Ophiuchus", raHours: 17.1729, decDeg: -15.7249, magnitude: 2.43, color: "#d9ebff" },
    {
      id: "yed-prior",
      name: "Yed Prior",
      constellation: "Ophiuchus",
      raHours: 16.2391,
      decDeg: -3.6943,
      magnitude: 2.75,
      color: "#ffcea9",
    },
    {
      id: "yed-posterior",
      name: "Yed Posterior",
      constellation: "Ophiuchus",
      raHours: 16.3053,
      decDeg: -4.6925,
      magnitude: 3.23,
      color: "#fff0d6",
    },
    { id: "aludra", name: "Aludra", constellation: "Canis Major", raHours: 7.4016, decDeg: -29.3031, magnitude: 2.45, color: "#dcecff" },
    { id: "furud", name: "Furud", constellation: "Canis Major", raHours: 6.3386, decDeg: -30.0634, magnitude: 3.02, color: "#fff0d0" },
    { id: "wasat", name: "Wasat", constellation: "Gemini", raHours: 7.3354, decDeg: 21.9823, magnitude: 3.53, color: "#eef5ff" },
    { id: "tejat", name: "Tejat", constellation: "Gemini", raHours: 6.3827, decDeg: 22.5136, magnitude: 2.87, color: "#ffcfab" },
    { id: "mebsuta", name: "Mebsuta", constellation: "Gemini", raHours: 6.7322, decDeg: 25.1311, magnitude: 3.06, color: "#fff0cf" },
    { id: "porrima", name: "Porrima", constellation: "Virgo", raHours: 12.6943, decDeg: -1.4494, magnitude: 2.74, color: "#eef5ff" },
    {
      id: "vindemiatrix",
      name: "Vindemiatrix",
      constellation: "Virgo",
      raHours: 13.0363,
      decDeg: 10.9592,
      magnitude: 2.83,
      color: "#fff0cf",
    },
    { id: "syrma", name: "Syrma", constellation: "Virgo", raHours: 14.2669, decDeg: -6.0006, magnitude: 4.08, color: "#eaf3ff" },
    { id: "atik", name: "Atik", constellation: "Perseus", raHours: 3.9022, decDeg: 31.8836, magnitude: 2.85, color: "#d9ebff" },
    { id: "menkib", name: "Menkib", constellation: "Perseus", raHours: 3.9642, decDeg: 35.7911, magnitude: 4.04, color: "#d7ebff" },
    {
      id: "sadalmelik",
      name: "Sadalmelik",
      constellation: "Aquarius",
      raHours: 22.0964,
      decDeg: -0.3198,
      magnitude: 2.95,
      color: "#fff0cf",
    },
    { id: "sadalsuud", name: "Sadalsuud", constellation: "Aquarius", raHours: 21.5259, decDeg: -5.5712, magnitude: 2.87, color: "#fff0d0" },
    { id: "skaat", name: "Skat", constellation: "Aquarius", raHours: 22.9108, decDeg: -15.8208, magnitude: 3.27, color: "#eef5ff" },
    {
      id: "zubenelgenubi",
      name: "Zubenelgenubi",
      constellation: "Libra",
      raHours: 14.848,
      decDeg: -16.0418,
      magnitude: 2.75,
      color: "#fff0cf",
    },
    {
      id: "zubeneschamali",
      name: "Zubeneschamali",
      constellation: "Libra",
      raHours: 15.2834,
      decDeg: -9.3829,
      magnitude: 2.61,
      color: "#d7ebff",
    },
    { id: "unukalhai", name: "Unukalhai", constellation: "Serpens", raHours: 15.7378, decDeg: 6.4256, magnitude: 2.63, color: "#ffcfac" },
    {
      id: "rasalgethi",
      name: "Rasalgethi",
      constellation: "Hercules",
      raHours: 17.2441,
      decDeg: 14.3903,
      magnitude: 3.48,
      color: "#ffbe93",
    },
    { id: "navi", name: "Navi", constellation: "Cassiopeia", raHours: 0.9451, decDeg: 60.7167, magnitude: 2.15, color: "#d9ebff" },
    { id: "alderamin", name: "Alderamin", constellation: "Cepheus", raHours: 21.3097, decDeg: 62.5856, magnitude: 2.45, color: "#edf5ff" },
    { id: "alfirk", name: "Alfirk", constellation: "Cepheus", raHours: 21.4777, decDeg: 70.5607, magnitude: 3.21, color: "#d8ebff" },
    { id: "errai", name: "Errai", constellation: "Cepheus", raHours: 23.6558, decDeg: 77.6324, magnitude: 3.22, color: "#fff0cf" },
    { id: "thuban", name: "Thuban", constellation: "Draco", raHours: 14.0732, decDeg: 64.3758, magnitude: 3.65, color: "#d7ebff" },
    {
      id: "kornephoros",
      name: "Kornephoros",
      constellation: "Hercules",
      raHours: 16.5037,
      decDeg: 21.4896,
      magnitude: 2.78,
      color: "#fff0cf",
    },
    { id: "sarin", name: "Sarin", constellation: "Hercules", raHours: 17.2505, decDeg: 24.8392, magnitude: 3.45, color: "#eef5ff" },
    { id: "marfik", name: "Marfik", constellation: "Hercules", raHours: 16.5684, decDeg: 42.437, magnitude: 3.84, color: "#dcecff" },
    { id: "gienah-cygni", name: "Gienah", constellation: "Cygnus", raHours: 20.7702, decDeg: 33.9703, magnitude: 2.46, color: "#fff0cf" },
    {
      id: "delta-cygni",
      name: "Delta Cygni",
      constellation: "Cygnus",
      raHours: 19.7496,
      decDeg: 45.1308,
      magnitude: 2.87,
      color: "#eef5ff",
    },
    { id: "homam", name: "Homam", constellation: "Pegasus", raHours: 22.691, decDeg: 10.8314, magnitude: 3.41, color: "#eef5ff" },
    { id: "matar", name: "Matar", constellation: "Pegasus", raHours: 22.7167, decDeg: 30.2212, magnitude: 2.93, color: "#ffcfac" },
    { id: "hyadum-i", name: "Hyadum I", constellation: "Taurus", raHours: 4.3299, decDeg: 15.6277, magnitude: 3.65, color: "#fff0cf" },
    { id: "ain", name: "Ain", constellation: "Taurus", raHours: 4.4769, decDeg: 19.1804, magnitude: 3.53, color: "#ffceab" },
    { id: "almaaz", name: "Almaaz", constellation: "Auriga", raHours: 5.0328, decDeg: 43.8233, magnitude: 2.69, color: "#ffe1b5" },
    { id: "muphrid", name: "Muphrid", constellation: "Boötes", raHours: 13.9114, decDeg: 18.3986, magnitude: 2.68, color: "#fff0cf" },
    { id: "alnasl", name: "Alnasl", constellation: "Sagittarius", raHours: 18.0968, decDeg: -30.4241, magnitude: 2.98, color: "#fff0cf" },
    { id: "yildun", name: "Yildun", constellation: "Ursa Minor", raHours: 17.5369, decDeg: 86.5865, magnitude: 4.35, color: "#eef5ff" },
    { id: "nashira", name: "Nashira", constellation: "Capricornus", raHours: 21.6682, decDeg: -16.6623, magnitude: 3.69, color: "#fff0cf" },
    {
      id: "deneb-algedi",
      name: "Deneb Algedi",
      constellation: "Capricornus",
      raHours: 21.784,
      decDeg: -16.1273,
      magnitude: 2.81,
      color: "#eef5ff",
    },
    { id: "gomeisa", name: "Gomeisa", constellation: "Canis Minor", raHours: 7.4525, decDeg: 8.2893, magnitude: 2.89, color: "#d7ebff" },
    { id: "alcyone", name: "Alcyone", constellation: "Taurus", raHours: 3.7914, decDeg: 24.1051, magnitude: 2.85, color: "#d7ebff" },
    { id: "menkar", name: "Menkar", constellation: "Cetus", raHours: 3.0379, decDeg: 4.0897, magnitude: 2.54, color: "#ffcfab" },
    { id: "diphda", name: "Diphda", constellation: "Cetus", raHours: 0.7265, decDeg: -17.9866, magnitude: 2.04, color: "#ffcfa8" },
    { id: "alrescha", name: "Alrescha", constellation: "Pisces", raHours: 2.0341, decDeg: 2.7638, magnitude: 3.82, color: "#eef5ff" },
    { id: "ankaa", name: "Ankaa", constellation: "Phoenix", raHours: 0.438, decDeg: -42.3061, magnitude: 2.37, color: "#ffcfac" },
    { id: "miram", name: "Miram", constellation: "Perseus", raHours: 3.8194, decDeg: 39.6116, magnitude: 3.77, color: "#fff0cf" },
    {
      id: "gienah-corvi",
      name: "Gienah Corvi",
      constellation: "Corvus",
      raHours: 12.2634,
      decDeg: -17.5419,
      magnitude: 2.59,
      color: "#eef5ff",
    },
    { id: "algorab", name: "Algorab", constellation: "Corvus", raHours: 12.4977, decDeg: -16.5154, magnitude: 2.94, color: "#d7ebff" },
    { id: "zaniah", name: "Zaniah", constellation: "Virgo", raHours: 11.8449, decDeg: -0.6668, magnitude: 3.89, color: "#eef5ff" },
    { id: "heze", name: "Heze", constellation: "Virgo", raHours: 13.5782, decDeg: -0.5958, magnitude: 3.38, color: "#fff0cf" },
    { id: "auva", name: "Auva", constellation: "Virgo", raHours: 12.9267, decDeg: 3.3975, magnitude: 2.74, color: "#ffd8b0" },
    {
      id: "zubenelhakrabi",
      name: "Zuben Elhakrabi",
      constellation: "Libra",
      raHours: 15.0678,
      decDeg: -25.2819,
      magnitude: 3.91,
      color: "#eef5ff",
    },
    { id: "naos", name: "Naos", constellation: "Puppis", raHours: 8.0597, decDeg: -40.0032, magnitude: 2.25, color: "#d7ebff" },
    { id: "suhail", name: "Suhail", constellation: "Vela", raHours: 9.1333, decDeg: -43.4326, magnitude: 2.23, color: "#fff0cf" },

    // --- Catalog expansion: fainter stars and 30 more constellations ---------
    { id: "altarf", name: "Al Tarf", constellation: "Cancer", raHours: 8.2751, decDeg: 9.1856, magnitude: 3.53, color: "#ffcfa2" },
    {
      id: "asellus-australis",
      name: "Asellus Australis",
      constellation: "Cancer",
      raHours: 8.7449,
      decDeg: 18.1543,
      magnitude: 3.94,
      color: "#ffdcb0",
    },
    {
      id: "iota-cancri",
      name: "Iota Cancri",
      constellation: "Cancer",
      raHours: 8.7784,
      decDeg: 28.7599,
      magnitude: 4.02,
      color: "#fff0cf",
    },
    { id: "acubens", name: "Acubens", constellation: "Cancer", raHours: 8.9747, decDeg: 11.8577, magnitude: 4.25, color: "#eef5ff" },
    {
      id: "asellus-borealis",
      name: "Asellus Borealis",
      constellation: "Cancer",
      raHours: 8.7215,
      decDeg: 21.4685,
      magnitude: 4.66,
      color: "#fff0d6",
    },
    {
      id: "beta-monocerotis",
      name: "Beta Monocerotis",
      constellation: "Monoceros",
      raHours: 6.4796,
      decDeg: -7.033,
      magnitude: 3.76,
      color: "#d5e8ff",
    },
    {
      id: "alpha-monocerotis",
      name: "Alpha Monocerotis",
      constellation: "Monoceros",
      raHours: 7.6857,
      decDeg: -9.5511,
      magnitude: 3.93,
      color: "#ffd8ac",
    },
    {
      id: "gamma-monocerotis",
      name: "Gamma Monocerotis",
      constellation: "Monoceros",
      raHours: 6.2479,
      decDeg: -6.2748,
      magnitude: 3.98,
      color: "#ffcfa5",
    },
    {
      id: "delta-monocerotis",
      name: "Delta Monocerotis",
      constellation: "Monoceros",
      raHours: 7.1976,
      decDeg: -0.4939,
      magnitude: 4.15,
      color: "#eef5ff",
    },
    { id: "arneb", name: "Arneb", constellation: "Lepus", raHours: 5.5455, decDeg: -17.8223, magnitude: 2.58, color: "#fff3dc" },
    { id: "nihal", name: "Nihal", constellation: "Lepus", raHours: 5.4707, decDeg: -20.7594, magnitude: 2.84, color: "#ffe9bb" },
    {
      id: "epsilon-leporis",
      name: "Epsilon Leporis",
      constellation: "Lepus",
      raHours: 5.0913,
      decDeg: -22.3714,
      magnitude: 3.19,
      color: "#ffcda3",
    },
    { id: "mu-leporis", name: "Mu Leporis", constellation: "Lepus", raHours: 5.2129, decDeg: -16.2054, magnitude: 3.29, color: "#dcecff" },
    {
      id: "zeta-leporis",
      name: "Zeta Leporis",
      constellation: "Lepus",
      raHours: 5.7822,
      decDeg: -14.8221,
      magnitude: 3.55,
      color: "#eef5ff",
    },
    {
      id: "gamma-leporis",
      name: "Gamma Leporis",
      constellation: "Lepus",
      raHours: 5.744,
      decDeg: -22.4481,
      magnitude: 3.59,
      color: "#fff6e4",
    },
    {
      id: "delta-leporis",
      name: "Delta Leporis",
      constellation: "Lepus",
      raHours: 5.8557,
      decDeg: -20.8794,
      magnitude: 3.81,
      color: "#ffe4bb",
    },
    { id: "phact", name: "Phact", constellation: "Columba", raHours: 5.66, decDeg: -34.0741, magnitude: 2.65, color: "#d5e8ff" },
    { id: "wazn", name: "Wazn", constellation: "Columba", raHours: 5.8493, decDeg: -35.7683, magnitude: 3.12, color: "#ffcfa2" },
    {
      id: "delta-columbae",
      name: "Delta Columbae",
      constellation: "Columba",
      raHours: 6.3714,
      decDeg: -33.4362,
      magnitude: 3.85,
      color: "#fff0cf",
    },
    {
      id: "epsilon-columbae",
      name: "Epsilon Columbae",
      constellation: "Columba",
      raHours: 5.522,
      decDeg: -35.4704,
      magnitude: 3.87,
      color: "#ffcfa8",
    },
    { id: "rotanev", name: "Rotanev", constellation: "Delphinus", raHours: 20.6255, decDeg: 14.5953, magnitude: 3.63, color: "#fff3de" },
    { id: "sualocin", name: "Sualocin", constellation: "Delphinus", raHours: 20.6607, decDeg: 15.9121, magnitude: 3.77, color: "#dcecff" },
    {
      id: "epsilon-delphini",
      name: "Epsilon Delphini",
      constellation: "Delphinus",
      raHours: 20.5555,
      decDeg: 11.3033,
      magnitude: 4.03,
      color: "#d8ebff",
    },
    {
      id: "gamma-delphini",
      name: "Gamma Delphini",
      constellation: "Delphinus",
      raHours: 20.7746,
      decDeg: 16.1244,
      magnitude: 4.27,
      color: "#ffe1bb",
    },
    {
      id: "delta-delphini",
      name: "Delta Delphini",
      constellation: "Delphinus",
      raHours: 20.7284,
      decDeg: 15.0747,
      magnitude: 4.43,
      color: "#f4f7ff",
    },
    {
      id: "gamma-sagittae",
      name: "Gamma Sagittae",
      constellation: "Sagitta",
      raHours: 19.979,
      decDeg: 19.4923,
      magnitude: 3.47,
      color: "#ffcb9a",
    },
    {
      id: "delta-sagittae",
      name: "Delta Sagittae",
      constellation: "Sagitta",
      raHours: 19.7899,
      decDeg: 18.5341,
      magnitude: 3.82,
      color: "#ffd6ad",
    },
    { id: "sham", name: "Sham", constellation: "Sagitta", raHours: 19.6685, decDeg: 18.0139, magnitude: 4.37, color: "#fff0cf" },
    {
      id: "beta-sagittae",
      name: "Beta Sagittae",
      constellation: "Sagitta",
      raHours: 19.6816,
      decDeg: 17.4761,
      magnitude: 4.37,
      color: "#fff0cf",
    },
    { id: "anser", name: "Anser", constellation: "Vulpecula", raHours: 19.4784, decDeg: 24.665, magnitude: 4.44, color: "#ffcfa5" },
    {
      id: "alpha-lacertae",
      name: "Alpha Lacertae",
      constellation: "Lacerta",
      raHours: 22.521,
      decDeg: 50.2825,
      magnitude: 3.77,
      color: "#eef5ff",
    },
    {
      id: "beta-lacertae",
      name: "Beta Lacertae",
      constellation: "Lacerta",
      raHours: 22.3924,
      decDeg: 52.2291,
      magnitude: 4.42,
      color: "#ffe1bb",
    },
    {
      id: "beta-trianguli",
      name: "Beta Trianguli",
      constellation: "Triangulum",
      raHours: 2.1591,
      decDeg: 34.9873,
      magnitude: 3,
      color: "#f4f7ff",
    },
    {
      id: "mothallah",
      name: "Mothallah",
      constellation: "Triangulum",
      raHours: 1.8846,
      decDeg: 29.5793,
      magnitude: 3.42,
      color: "#fff6e4",
    },
    {
      id: "gamma-trianguli",
      name: "Gamma Trianguli",
      constellation: "Triangulum",
      raHours: 2.2891,
      decDeg: 33.8473,
      magnitude: 4.03,
      color: "#eef5ff",
    },
    {
      id: "alpha-lyncis",
      name: "Alpha Lyncis",
      constellation: "Lynx",
      raHours: 9.3508,
      decDeg: 34.3925,
      magnitude: 3.14,
      color: "#ffbf94",
    },
    { id: "38-lyncis", name: "38 Lyncis", constellation: "Lynx", raHours: 9.3092, decDeg: 36.8025, magnitude: 3.82, color: "#eef5ff" },
    {
      id: "beta-camelopardalis",
      name: "Beta Camelopardalis",
      constellation: "Camelopardalis",
      raHours: 5.057,
      decDeg: 60.4423,
      magnitude: 4.03,
      color: "#fff0cf",
    },
    {
      id: "alpha-camelopardalis",
      name: "Alpha Camelopardalis",
      constellation: "Camelopardalis",
      raHours: 4.9022,
      decDeg: 66.3427,
      magnitude: 4.29,
      color: "#cfe6ff",
    },
    {
      id: "cor-caroli",
      name: "Cor Caroli",
      constellation: "Canes Venatici",
      raHours: 12.9338,
      decDeg: 38.3187,
      magnitude: 2.89,
      color: "#eef5ff",
    },
    { id: "chara", name: "Chara", constellation: "Canes Venatici", raHours: 12.5622, decDeg: 41.3576, magnitude: 4.24, color: "#fff6e4" },
    {
      id: "beta-comae",
      name: "Beta Comae Berenices",
      constellation: "Coma Berenices",
      raHours: 13.1979,
      decDeg: 27.8781,
      magnitude: 4.26,
      color: "#fff6e4",
    },
    { id: "diadem", name: "Diadem", constellation: "Coma Berenices", raHours: 13.1663, decDeg: 17.5292, magnitude: 4.32, color: "#fff6e4" },
    {
      id: "gamma-comae",
      name: "Gamma Comae Berenices",
      constellation: "Coma Berenices",
      raHours: 12.4392,
      decDeg: 28.2681,
      magnitude: 4.35,
      color: "#ffd8ac",
    },
    {
      id: "delta-crateris",
      name: "Delta Crateris",
      constellation: "Crater",
      raHours: 11.3222,
      decDeg: -14.7789,
      magnitude: 3.56,
      color: "#ffcfa2",
    },
    {
      id: "gamma-crateris",
      name: "Gamma Crateris",
      constellation: "Crater",
      raHours: 11.4147,
      decDeg: -17.6841,
      magnitude: 4.06,
      color: "#eef5ff",
    },
    { id: "alkes", name: "Alkes", constellation: "Crater", raHours: 10.9962, decDeg: -18.2988, magnitude: 4.07, color: "#ffd8ac" },
    {
      id: "beta-crateris",
      name: "Beta Crateris",
      constellation: "Crater",
      raHours: 11.1946,
      decDeg: -22.8261,
      magnitude: 4.46,
      color: "#eef5ff",
    },
    {
      id: "alpha-sextantis",
      name: "Alpha Sextantis",
      constellation: "Sextans",
      raHours: 10.1324,
      decDeg: -0.3719,
      magnitude: 4.48,
      color: "#eef5ff",
    },
    {
      id: "alpha-antliae",
      name: "Alpha Antliae",
      constellation: "Antlia",
      raHours: 10.4523,
      decDeg: -31.0678,
      magnitude: 4.25,
      color: "#ffcfa2",
    },
    {
      id: "alpha-pyxidis",
      name: "Alpha Pyxidis",
      constellation: "Pyxis",
      raHours: 8.7264,
      decDeg: -33.1864,
      magnitude: 3.68,
      color: "#d5e8ff",
    },
    {
      id: "beta-pyxidis",
      name: "Beta Pyxidis",
      constellation: "Pyxis",
      raHours: 8.6698,
      decDeg: -35.3083,
      magnitude: 3.97,
      color: "#fff0cf",
    },
    { id: "alpha-lupi", name: "Alpha Lupi", constellation: "Lupus", raHours: 14.6989, decDeg: -47.3882, magnitude: 2.3, color: "#cfe6ff" },
    { id: "beta-lupi", name: "Beta Lupi", constellation: "Lupus", raHours: 14.9758, decDeg: -43.1339, magnitude: 2.68, color: "#d5e8ff" },
    { id: "gamma-lupi", name: "Gamma Lupi", constellation: "Lupus", raHours: 15.5852, decDeg: -41.1666, magnitude: 2.78, color: "#d8ebff" },
    { id: "delta-lupi", name: "Delta Lupi", constellation: "Lupus", raHours: 15.3565, decDeg: -40.6475, magnitude: 3.22, color: "#d5e8ff" },
    {
      id: "epsilon-lupi",
      name: "Epsilon Lupi",
      constellation: "Lupus",
      raHours: 15.3799,
      decDeg: -44.6896,
      magnitude: 3.37,
      color: "#d5e8ff",
    },
    { id: "zeta-lupi", name: "Zeta Lupi", constellation: "Lupus", raHours: 15.2118, decDeg: -52.099, magnitude: 3.41, color: "#fff0cf" },
    {
      id: "gamma-normae",
      name: "Gamma Normae",
      constellation: "Norma",
      raHours: 16.3272,
      decDeg: -50.1556,
      magnitude: 4.02,
      color: "#fff0cf",
    },
    { id: "beta-arae", name: "Beta Arae", constellation: "Ara", raHours: 17.4218, decDeg: -55.5299, magnitude: 2.85, color: "#ffcb9a" },
    { id: "alpha-arae", name: "Alpha Arae", constellation: "Ara", raHours: 17.5311, decDeg: -49.8761, magnitude: 2.95, color: "#d5e8ff" },
    { id: "zeta-arae", name: "Zeta Arae", constellation: "Ara", raHours: 16.9772, decDeg: -55.9902, magnitude: 3.13, color: "#ffbf94" },
    { id: "gamma-arae", name: "Gamma Arae", constellation: "Ara", raHours: 17.4218, decDeg: -56.3777, magnitude: 3.34, color: "#d5e8ff" },
    { id: "delta-arae", name: "Delta Arae", constellation: "Ara", raHours: 17.5188, decDeg: -60.6836, magnitude: 3.62, color: "#dcecff" },
    {
      id: "alpha-circini",
      name: "Alpha Circini",
      constellation: "Circinus",
      raHours: 14.7085,
      decDeg: -64.9754,
      magnitude: 3.19,
      color: "#f4f7ff",
    },
    {
      id: "alphecca",
      name: "Alphecca",
      constellation: "Corona Borealis",
      raHours: 15.5781,
      decDeg: 26.7147,
      magnitude: 2.23,
      color: "#eef5ff",
    },
    {
      id: "nusakan",
      name: "Nusakan",
      constellation: "Corona Borealis",
      raHours: 15.4638,
      decDeg: 29.1058,
      magnitude: 3.66,
      color: "#fff6e4",
    },
    {
      id: "gamma-coronae-borealis",
      name: "Gamma Coronae Borealis",
      constellation: "Corona Borealis",
      raHours: 15.7101,
      decDeg: 26.2957,
      magnitude: 3.81,
      color: "#eef5ff",
    },
    {
      id: "theta-coronae-borealis",
      name: "Theta Coronae Borealis",
      constellation: "Corona Borealis",
      raHours: 15.5588,
      decDeg: 31.3593,
      magnitude: 4.14,
      color: "#d5e8ff",
    },
    {
      id: "epsilon-coronae-borealis",
      name: "Epsilon Coronae Borealis",
      constellation: "Corona Borealis",
      raHours: 15.96,
      decDeg: 26.8776,
      magnitude: 4.14,
      color: "#ffcfa2",
    },
    {
      id: "delta-coronae-borealis",
      name: "Delta Coronae Borealis",
      constellation: "Corona Borealis",
      raHours: 15.8228,
      decDeg: 26.0682,
      magnitude: 4.59,
      color: "#fff6e4",
    },
    {
      id: "meridiana",
      name: "Meridiana",
      constellation: "Corona Australis",
      raHours: 19.158,
      decDeg: -37.9045,
      magnitude: 4.1,
      color: "#eef5ff",
    },
    {
      id: "beta-coronae-australis",
      name: "Beta Coronae Australis",
      constellation: "Corona Australis",
      raHours: 19.1673,
      decDeg: -39.3407,
      magnitude: 4.11,
      color: "#ffd8ac",
    },
    {
      id: "alpha-telescopii",
      name: "Alpha Telescopii",
      constellation: "Telescopium",
      raHours: 18.4497,
      decDeg: -45.9683,
      magnitude: 3.49,
      color: "#d5e8ff",
    },
    { id: "alpha-indi", name: "Alpha Indi", constellation: "Indus", raHours: 20.6259, decDeg: -47.2915, magnitude: 3.11, color: "#ffcfa2" },
    { id: "beta-indi", name: "Beta Indi", constellation: "Indus", raHours: 20.9128, decDeg: -58.4541, magnitude: 3.65, color: "#ffcb9a" },
    {
      id: "alpha-tucanae",
      name: "Alpha Tucanae",
      constellation: "Tucana",
      raHours: 22.3084,
      decDeg: -60.2597,
      magnitude: 2.86,
      color: "#ffcb9a",
    },
    {
      id: "gamma-tucanae",
      name: "Gamma Tucanae",
      constellation: "Tucana",
      raHours: 23.2929,
      decDeg: -58.2359,
      magnitude: 3.99,
      color: "#fff6e4",
    },
    { id: "beta-hydri", name: "Beta Hydri", constellation: "Hydrus", raHours: 0.4293, decDeg: -77.2544, magnitude: 2.8, color: "#fff6e4" },
    {
      id: "alpha-hydri",
      name: "Alpha Hydri",
      constellation: "Hydrus",
      raHours: 1.9799,
      decDeg: -61.5697,
      magnitude: 2.86,
      color: "#f4f7ff",
    },
    {
      id: "gamma-hydri",
      name: "Gamma Hydri",
      constellation: "Hydrus",
      raHours: 3.7876,
      decDeg: -74.2393,
      magnitude: 3.24,
      color: "#ffbf94",
    },
    {
      id: "alpha-reticuli",
      name: "Alpha Reticuli",
      constellation: "Reticulum",
      raHours: 4.2404,
      decDeg: -62.4739,
      magnitude: 3.35,
      color: "#fff0cf",
    },
    {
      id: "beta-reticuli",
      name: "Beta Reticuli",
      constellation: "Reticulum",
      raHours: 3.7381,
      decDeg: -64.8071,
      magnitude: 3.85,
      color: "#ffcfa2",
    },
    {
      id: "alpha-doradus",
      name: "Alpha Doradus",
      constellation: "Dorado",
      raHours: 4.567,
      decDeg: -55.045,
      magnitude: 3.27,
      color: "#eef5ff",
    },
    {
      id: "beta-doradus",
      name: "Beta Doradus",
      constellation: "Dorado",
      raHours: 5.5578,
      decDeg: -62.4899,
      magnitude: 3.76,
      color: "#fff6e4",
    },
    {
      id: "alpha-pictoris",
      name: "Alpha Pictoris",
      constellation: "Pictor",
      raHours: 6.8032,
      decDeg: -61.9414,
      magnitude: 3.27,
      color: "#eef5ff",
    },
    {
      id: "beta-pictoris",
      name: "Beta Pictoris",
      constellation: "Pictor",
      raHours: 5.788,
      decDeg: -51.0665,
      magnitude: 3.86,
      color: "#eef5ff",
    },
    {
      id: "beta-volantis",
      name: "Beta Volantis",
      constellation: "Volans",
      raHours: 8.426,
      decDeg: -66.1369,
      magnitude: 3.77,
      color: "#ffcb9a",
    },
    {
      id: "gamma-volantis",
      name: "Gamma Volantis",
      constellation: "Volans",
      raHours: 7.1456,
      decDeg: -70.499,
      magnitude: 3.78,
      color: "#ffcfa2",
    },
    {
      id: "alpha-muscae",
      name: "Alpha Muscae",
      constellation: "Musca",
      raHours: 12.6194,
      decDeg: -69.1355,
      magnitude: 2.69,
      color: "#cfe6ff",
    },
    {
      id: "beta-muscae",
      name: "Beta Muscae",
      constellation: "Musca",
      raHours: 12.7706,
      decDeg: -68.1082,
      magnitude: 3.05,
      color: "#d0e7ff",
    },
    {
      id: "delta-muscae",
      name: "Delta Muscae",
      constellation: "Musca",
      raHours: 13.0272,
      decDeg: -71.5488,
      magnitude: 3.62,
      color: "#ffcfa2",
    },
    {
      id: "alpha-chamaeleontis",
      name: "Alpha Chamaeleontis",
      constellation: "Chamaeleon",
      raHours: 8.3088,
      decDeg: -76.9198,
      magnitude: 4.06,
      color: "#fff6e4",
    },
    {
      id: "gamma-chamaeleontis",
      name: "Gamma Chamaeleontis",
      constellation: "Chamaeleon",
      raHours: 10.5926,
      decDeg: -78.6077,
      magnitude: 4.11,
      color: "#ffbf94",
    },
    {
      id: "alpha-apodis",
      name: "Alpha Apodis",
      constellation: "Apus",
      raHours: 14.7978,
      decDeg: -79.0447,
      magnitude: 3.83,
      color: "#ffcb9a",
    },
    {
      id: "nu-octantis",
      name: "Nu Octantis",
      constellation: "Octans",
      raHours: 21.691,
      decDeg: -77.3903,
      magnitude: 3.73,
      color: "#ffdcb0",
    },
    {
      id: "beta-octantis",
      name: "Beta Octantis",
      constellation: "Octans",
      raHours: 22.7669,
      decDeg: -81.3819,
      magnitude: 4.13,
      color: "#eef5ff",
    },
    {
      id: "alpha-mensae",
      name: "Alpha Mensae",
      constellation: "Mensa",
      raHours: 6.169,
      decDeg: -74.7531,
      magnitude: 5.09,
      color: "#fff6e4",
    },
    {
      id: "alpha-horologii",
      name: "Alpha Horologii",
      constellation: "Horologium",
      raHours: 4.2325,
      decDeg: -42.2942,
      magnitude: 3.85,
      color: "#ffdcb0",
    },
    {
      id: "alpha-caeli",
      name: "Alpha Caeli",
      constellation: "Caelum",
      raHours: 4.6761,
      decDeg: -41.8636,
      magnitude: 4.44,
      color: "#fff6e4",
    },
    {
      id: "alpha-fornacis",
      name: "Alpha Fornacis",
      constellation: "Fornax",
      raHours: 3.2013,
      decDeg: -28.9877,
      magnitude: 3.87,
      color: "#fff6e4",
    },
    {
      id: "alpha-sculptoris",
      name: "Alpha Sculptoris",
      constellation: "Sculptor",
      raHours: 0.9769,
      decDeg: -29.3572,
      magnitude: 4.3,
      color: "#d5e8ff",
    },
    {
      id: "beta-sculptoris",
      name: "Beta Sculptoris",
      constellation: "Sculptor",
      raHours: 23.8168,
      decDeg: -37.8183,
      magnitude: 4.37,
      color: "#eef5ff",
    },
    {
      id: "gamma-microscopii",
      name: "Gamma Microscopii",
      constellation: "Microscopium",
      raHours: 21.0175,
      decDeg: -32.2525,
      magnitude: 4.67,
      color: "#fff0cf",
    },
    { id: "kitalpha", name: "Kitalpha", constellation: "Equuleus", raHours: 21.2621, decDeg: 5.2478, magnitude: 3.92, color: "#fff6e4" },
    {
      id: "alpha-scuti",
      name: "Alpha Scuti",
      constellation: "Scutum",
      raHours: 18.5865,
      decDeg: -8.2443,
      magnitude: 3.85,
      color: "#ffcfa2",
    },
    { id: "beta-scuti", name: "Beta Scuti", constellation: "Scutum", raHours: 18.7864, decDeg: -4.7478, magnitude: 4.22, color: "#fff0cf" },
    { id: "cursa", name: "Cursa", constellation: "Eridanus", raHours: 5.1305, decDeg: -5.0864, magnitude: 2.79, color: "#eef5ff" },
    { id: "acamar", name: "Acamar", constellation: "Eridanus", raHours: 2.971, decDeg: -40.3047, magnitude: 2.88, color: "#eef5ff" },
    { id: "zaurak", name: "Zaurak", constellation: "Eridanus", raHours: 3.9679, decDeg: -13.5085, magnitude: 2.95, color: "#ffbb95" },
    { id: "rana", name: "Rana", constellation: "Eridanus", raHours: 3.7208, decDeg: -9.7653, magnitude: 3.54, color: "#ffd8ac" },
    {
      id: "phi-eridani",
      name: "Phi Eridani",
      constellation: "Eridanus",
      raHours: 2.2818,
      decDeg: -51.5121,
      magnitude: 3.55,
      color: "#d0e7ff",
    },
    {
      id: "chi-eridani",
      name: "Chi Eridani",
      constellation: "Eridanus",
      raHours: 1.9308,
      decDeg: -51.6091,
      magnitude: 3.7,
      color: "#fff6e4",
    },
    {
      id: "epsilon-eridani",
      name: "Epsilon Eridani",
      constellation: "Eridanus",
      raHours: 3.5493,
      decDeg: -9.4581,
      magnitude: 3.73,
      color: "#ffcb9a",
    },
    {
      id: "upsilon2-eridani",
      name: "Upsilon2 Eridani",
      constellation: "Eridanus",
      raHours: 4.5875,
      decDeg: -30.5623,
      magnitude: 3.82,
      color: "#ffdcb0",
    },
    { id: "azha", name: "Azha", constellation: "Eridanus", raHours: 2.7906, decDeg: -8.8981, magnitude: 3.89, color: "#ffdcb0" },
    {
      id: "nu-eridani",
      name: "Nu Eridani",
      constellation: "Eridanus",
      raHours: 4.6035,
      decDeg: -3.3524,
      magnitude: 3.93,
      color: "#d0e7ff",
    },
    {
      id: "iota-eridani",
      name: "Iota Eridani",
      constellation: "Eridanus",
      raHours: 2.7455,
      decDeg: -39.8554,
      magnitude: 4.11,
      color: "#ffdcb0",
    },
    {
      id: "kappa-eridani",
      name: "Kappa Eridani",
      constellation: "Eridanus",
      raHours: 2.4457,
      decDeg: -47.7038,
      magnitude: 4.25,
      color: "#d0e7ff",
    },
    {
      id: "gamma-hydrae",
      name: "Gamma Hydrae",
      constellation: "Hydra",
      raHours: 13.3157,
      decDeg: -23.1717,
      magnitude: 2.99,
      color: "#fff6e4",
    },
    { id: "zeta-hydrae", name: "Zeta Hydrae", constellation: "Hydra", raHours: 8.9231, decDeg: 5.9455, magnitude: 3.11, color: "#ffdcb0" },
    { id: "nu-hydrae", name: "Nu Hydrae", constellation: "Hydra", raHours: 10.8298, decDeg: -16.1936, magnitude: 3.11, color: "#ffcfa2" },
    { id: "pi-hydrae", name: "Pi Hydrae", constellation: "Hydra", raHours: 14.1062, decDeg: -26.682, magnitude: 3.25, color: "#ffcfa2" },
    {
      id: "epsilon-hydrae",
      name: "Epsilon Hydrae",
      constellation: "Hydra",
      raHours: 8.7794,
      decDeg: 6.4189,
      magnitude: 3.38,
      color: "#fff6e4",
    },
    { id: "xi-hydrae", name: "Xi Hydrae", constellation: "Hydra", raHours: 11.5527, decDeg: -31.8577, magnitude: 3.54, color: "#fff6e4" },
    {
      id: "lambda-hydrae",
      name: "Lambda Hydrae",
      constellation: "Hydra",
      raHours: 10.1094,
      decDeg: -12.3541,
      magnitude: 3.61,
      color: "#ffdcb0",
    },
    { id: "mu-hydrae", name: "Mu Hydrae", constellation: "Hydra", raHours: 10.4359, decDeg: -16.836, magnitude: 3.81, color: "#ffcfa2" },
    { id: "theta-hydrae", name: "Theta Hydrae", constellation: "Hydra", raHours: 9.2409, decDeg: 2.314, magnitude: 3.88, color: "#d8ebff" },
    { id: "iota-hydrae", name: "Iota Hydrae", constellation: "Hydra", raHours: 9.6634, decDeg: -1.1428, magnitude: 3.9, color: "#ffcb9a" },
    {
      id: "delta-hydrae",
      name: "Delta Hydrae",
      constellation: "Hydra",
      raHours: 8.6273,
      decDeg: 5.7038,
      magnitude: 4.14,
      color: "#eef5ff",
    },
    { id: "eta-hydrae", name: "Eta Hydrae", constellation: "Hydra", raHours: 8.7202, decDeg: 3.3993, magnitude: 4.3, color: "#d5e8ff" },
    {
      id: "sigma-hydrae",
      name: "Sigma Hydrae",
      constellation: "Hydra",
      raHours: 8.6446,
      decDeg: 3.3413,
      magnitude: 4.44,
      color: "#ffcfa2",
    },
    {
      id: "rigil-kentaurus",
      name: "Rigil Kentaurus",
      constellation: "Centaurus",
      raHours: 14.6601,
      decDeg: -60.834,
      magnitude: -0.27,
      color: "#fff6e4",
    },
    { id: "menkent", name: "Menkent", constellation: "Centaurus", raHours: 14.1114, decDeg: -36.37, magnitude: 2.06, color: "#ffcfa2" },
    {
      id: "gamma-centauri",
      name: "Gamma Centauri",
      constellation: "Centaurus",
      raHours: 12.6919,
      decDeg: -48.9599,
      magnitude: 2.17,
      color: "#eef5ff",
    },
    {
      id: "epsilon-centauri",
      name: "Epsilon Centauri",
      constellation: "Centaurus",
      raHours: 13.6647,
      decDeg: -53.4664,
      magnitude: 2.3,
      color: "#cfe6ff",
    },
    {
      id: "eta-centauri",
      name: "Eta Centauri",
      constellation: "Centaurus",
      raHours: 14.5947,
      decDeg: -42.1578,
      magnitude: 2.31,
      color: "#d0e7ff",
    },
    {
      id: "zeta-centauri",
      name: "Zeta Centauri",
      constellation: "Centaurus",
      raHours: 13.9126,
      decDeg: -47.2882,
      magnitude: 2.55,
      color: "#cfe6ff",
    },
    {
      id: "delta-centauri",
      name: "Delta Centauri",
      constellation: "Centaurus",
      raHours: 12.1399,
      decDeg: -50.7226,
      magnitude: 2.58,
      color: "#d0e7ff",
    },
    {
      id: "iota-centauri",
      name: "Iota Centauri",
      constellation: "Centaurus",
      raHours: 13.3436,
      decDeg: -36.7123,
      magnitude: 2.75,
      color: "#eef5ff",
    },
    {
      id: "kappa-centauri",
      name: "Kappa Centauri",
      constellation: "Centaurus",
      raHours: 14.9899,
      decDeg: -42.1042,
      magnitude: 3.13,
      color: "#d0e7ff",
    },
    {
      id: "lambda-centauri",
      name: "Lambda Centauri",
      constellation: "Centaurus",
      raHours: 11.596,
      decDeg: -63.0195,
      magnitude: 3.13,
      color: "#d8ebff",
    },
    { id: "regor", name: "Regor", constellation: "Vela", raHours: 8.1584, decDeg: -47.3367, magnitude: 1.78, color: "#cfe6ff" },
    { id: "alsephina", name: "Alsephina", constellation: "Vela", raHours: 8.745, decDeg: -54.7086, magnitude: 1.96, color: "#eef5ff" },
    { id: "markeb", name: "Markeb", constellation: "Vela", raHours: 9.368, decDeg: -55.0107, magnitude: 2.47, color: "#d0e7ff" },
    { id: "mu-velorum", name: "Mu Velorum", constellation: "Vela", raHours: 10.7772, decDeg: -49.4201, magnitude: 2.69, color: "#fff0cf" },
    { id: "phi-velorum", name: "Phi Velorum", constellation: "Vela", raHours: 9.9569, decDeg: -54.5677, magnitude: 3.52, color: "#d5e8ff" },
    { id: "psi-velorum", name: "Psi Velorum", constellation: "Vela", raHours: 9.5108, decDeg: -40.4667, magnitude: 3.6, color: "#f4f7ff" },
    { id: "pi-puppis", name: "Pi Puppis", constellation: "Puppis", raHours: 7.2846, decDeg: -37.0975, magnitude: 2.71, color: "#ffcb9a" },
    { id: "rho-puppis", name: "Rho Puppis", constellation: "Puppis", raHours: 8.1258, decDeg: -24.3042, magnitude: 2.83, color: "#fff6e4" },
    { id: "tau-puppis", name: "Tau Puppis", constellation: "Puppis", raHours: 6.832, decDeg: -50.6144, magnitude: 2.94, color: "#ffdcb0" },
    { id: "nu-puppis", name: "Nu Puppis", constellation: "Puppis", raHours: 6.6377, decDeg: -43.1957, magnitude: 3.17, color: "#d5e8ff" },
    {
      id: "sigma-puppis",
      name: "Sigma Puppis",
      constellation: "Puppis",
      raHours: 7.4531,
      decDeg: -43.3011,
      magnitude: 3.25,
      color: "#ffcb9a",
    },
    { id: "xi-puppis", name: "Xi Puppis", constellation: "Puppis", raHours: 7.8221, decDeg: -24.8597, magnitude: 3.34, color: "#fff0cf" },
    { id: "aspidiske", name: "Aspidiske", constellation: "Carina", raHours: 9.285, decDeg: -59.2753, magnitude: 2.21, color: "#fff6e4" },
    {
      id: "theta-carinae",
      name: "Theta Carinae",
      constellation: "Carina",
      raHours: 10.715,
      decDeg: -64.3945,
      magnitude: 2.74,
      color: "#cfe6ff",
    },
    {
      id: "upsilon-carinae",
      name: "Upsilon Carinae",
      constellation: "Carina",
      raHours: 9.785,
      decDeg: -65.072,
      magnitude: 2.92,
      color: "#f4f7ff",
    },
    {
      id: "omega-carinae",
      name: "Omega Carinae",
      constellation: "Carina",
      raHours: 10.2288,
      decDeg: -70.0381,
      magnitude: 3.29,
      color: "#d0e7ff",
    },
    { id: "p-carinae", name: "p Carinae", constellation: "Carina", raHours: 10.532, decDeg: -61.6853, magnitude: 3.32, color: "#d0e7ff" },
    { id: "tiaki", name: "Tiaki", constellation: "Grus", raHours: 22.7113, decDeg: -46.8846, magnitude: 2.07, color: "#ffbb95" },
    { id: "aldhanab", name: "Aldhanab", constellation: "Grus", raHours: 21.8987, decDeg: -37.3648, magnitude: 3, color: "#d5e8ff" },
    {
      id: "epsilon-gruis",
      name: "Epsilon Gruis",
      constellation: "Grus",
      raHours: 22.8091,
      decDeg: -51.3167,
      magnitude: 3.49,
      color: "#f4f7ff",
    },
    { id: "iota-gruis", name: "Iota Gruis", constellation: "Grus", raHours: 23.1727, decDeg: -45.2469, magnitude: 3.9, color: "#ffcfa2" },
    {
      id: "delta-gruis",
      name: "Delta Gruis",
      constellation: "Grus",
      raHours: 22.4874,
      decDeg: -43.4958,
      magnitude: 3.97,
      color: "#fff0cf",
    },
    { id: "zeta-gruis", name: "Zeta Gruis", constellation: "Grus", raHours: 23.1691, decDeg: -52.7539, magnitude: 4.11, color: "#fff6e4" },
    {
      id: "beta-phoenicis",
      name: "Beta Phoenicis",
      constellation: "Phoenix",
      raHours: 1.101,
      decDeg: -46.7185,
      magnitude: 3.31,
      color: "#fff6e4",
    },
    {
      id: "gamma-phoenicis",
      name: "Gamma Phoenicis",
      constellation: "Phoenix",
      raHours: 1.4728,
      decDeg: -43.3182,
      magnitude: 3.41,
      color: "#ffbb95",
    },
    {
      id: "epsilon-phoenicis",
      name: "Epsilon Phoenicis",
      constellation: "Phoenix",
      raHours: 0.1573,
      decDeg: -45.7473,
      magnitude: 3.88,
      color: "#ffcfa2",
    },
    {
      id: "zeta-phoenicis",
      name: "Zeta Phoenicis",
      constellation: "Phoenix",
      raHours: 1.1391,
      decDeg: -55.2456,
      magnitude: 3.92,
      color: "#d5e8ff",
    },
    {
      id: "delta-phoenicis",
      name: "Delta Phoenicis",
      constellation: "Phoenix",
      raHours: 1.5218,
      decDeg: -49.0731,
      magnitude: 3.93,
      color: "#fff0cf",
    },
    {
      id: "kappa-phoenicis",
      name: "Kappa Phoenicis",
      constellation: "Phoenix",
      raHours: 0.4359,
      decDeg: -43.6797,
      magnitude: 3.94,
      color: "#f4f7ff",
    },
    {
      id: "deneb-algenubi",
      name: "Deneb Algenubi",
      constellation: "Cetus",
      raHours: 1.1423,
      decDeg: -10.182,
      magnitude: 3.45,
      color: "#ffcfa2",
    },
    {
      id: "kaffaljidhma",
      name: "Kaffaljidhma",
      constellation: "Cetus",
      raHours: 2.7217,
      decDeg: 3.2359,
      magnitude: 3.47,
      color: "#f4f7ff",
    },
    { id: "tau-ceti", name: "Tau Ceti", constellation: "Cetus", raHours: 1.7345, decDeg: -15.9375, magnitude: 3.5, color: "#fff6e4" },
    { id: "iota-ceti", name: "Iota Ceti", constellation: "Cetus", raHours: 0.3234, decDeg: -8.8235, magnitude: 3.56, color: "#ffcfa2" },
    { id: "theta-ceti", name: "Theta Ceti", constellation: "Cetus", raHours: 1.16, decDeg: -8.1836, magnitude: 3.6, color: "#ffcfa2" },
    {
      id: "baten-kaitos",
      name: "Baten Kaitos",
      constellation: "Cetus",
      raHours: 1.8574,
      decDeg: -10.335,
      magnitude: 3.73,
      color: "#ffdcb0",
    },
    {
      id: "upsilon-ceti",
      name: "Upsilon Ceti",
      constellation: "Cetus",
      raHours: 2.3446,
      decDeg: -21.0778,
      magnitude: 3.99,
      color: "#ffbb95",
    },
    { id: "delta-ceti", name: "Delta Ceti", constellation: "Cetus", raHours: 2.6564, decDeg: 0.3285, magnitude: 4.07, color: "#d5e8ff" },
    { id: "alpherg", name: "Alpherg", constellation: "Pisces", raHours: 1.5249, decDeg: 15.3459, magnitude: 3.62, color: "#fff6e4" },
    {
      id: "gamma-piscium",
      name: "Gamma Piscium",
      constellation: "Pisces",
      raHours: 23.286,
      decDeg: 3.2822,
      magnitude: 3.7,
      color: "#fff0cf",
    },
    {
      id: "omega-piscium",
      name: "Omega Piscium",
      constellation: "Pisces",
      raHours: 23.9924,
      decDeg: 6.8637,
      magnitude: 4.01,
      color: "#f4f7ff",
    },
    {
      id: "iota-piscium",
      name: "Iota Piscium",
      constellation: "Pisces",
      raHours: 23.6604,
      decDeg: 5.6265,
      magnitude: 4.13,
      color: "#f4f7ff",
    },
    {
      id: "omicron-piscium",
      name: "Omicron Piscium",
      constellation: "Pisces",
      raHours: 1.7736,
      decDeg: 9.1578,
      magnitude: 4.26,
      color: "#fff0cf",
    },
    {
      id: "epsilon-piscium",
      name: "Epsilon Piscium",
      constellation: "Pisces",
      raHours: 1.0577,
      decDeg: 7.8901,
      magnitude: 4.27,
      color: "#fff0cf",
    },
    {
      id: "theta-piscium",
      name: "Theta Piscium",
      constellation: "Pisces",
      raHours: 23.4661,
      decDeg: 6.379,
      magnitude: 4.27,
      color: "#ffcfa2",
    },
    {
      id: "delta-piscium",
      name: "Delta Piscium",
      constellation: "Pisces",
      raHours: 0.8143,
      decDeg: 7.585,
      magnitude: 4.43,
      color: "#ffcfa2",
    },
    {
      id: "beta-piscium",
      name: "Beta Piscium",
      constellation: "Pisces",
      raHours: 23.0396,
      decDeg: 3.8203,
      magnitude: 4.48,
      color: "#d5e8ff",
    },
    {
      id: "zeta-aquarii",
      name: "Zeta Aquarii",
      constellation: "Aquarius",
      raHours: 22.4807,
      decDeg: -0.0201,
      magnitude: 3.65,
      color: "#f4f7ff",
    },
    {
      id: "lambda-aquarii",
      name: "Lambda Aquarii",
      constellation: "Aquarius",
      raHours: 22.8763,
      decDeg: -7.5794,
      magnitude: 3.73,
      color: "#ffbb95",
    },
    { id: "albali", name: "Albali", constellation: "Aquarius", raHours: 20.7947, decDeg: -9.4958, magnitude: 3.77, color: "#d5e8ff" },
    { id: "sadachbia", name: "Sadachbia", constellation: "Aquarius", raHours: 22.3606, decDeg: -1.3873, magnitude: 3.84, color: "#eef5ff" },
    {
      id: "tau-aquarii",
      name: "Tau Aquarii",
      constellation: "Aquarius",
      raHours: 22.8778,
      decDeg: -13.5926,
      magnitude: 4.01,
      color: "#ffcfa2",
    },
    {
      id: "eta-aquarii",
      name: "Eta Aquarii",
      constellation: "Aquarius",
      raHours: 22.5877,
      decDeg: -0.1178,
      magnitude: 4.02,
      color: "#d5e8ff",
    },
    {
      id: "phi-aquarii",
      name: "Phi Aquarii",
      constellation: "Aquarius",
      raHours: 23.2295,
      decDeg: -6.049,
      magnitude: 4.22,
      color: "#ffcfa2",
    },
    { id: "dabih", name: "Dabih", constellation: "Capricornus", raHours: 20.35, decDeg: -14.7813, magnitude: 3.05, color: "#ffdcb0" },
    { id: "algedi", name: "Algedi", constellation: "Capricornus", raHours: 20.3002, decDeg: -12.5083, magnitude: 3.57, color: "#fff6e4" },
    {
      id: "zeta-capricorni",
      name: "Zeta Capricorni",
      constellation: "Capricornus",
      raHours: 21.4447,
      decDeg: -22.4113,
      magnitude: 3.74,
      color: "#fff6e4",
    },
    {
      id: "theta-capricorni",
      name: "Theta Capricorni",
      constellation: "Capricornus",
      raHours: 21.0983,
      decDeg: -17.2327,
      magnitude: 4.07,
      color: "#eef5ff",
    },
    {
      id: "omega-capricorni",
      name: "Omega Capricorni",
      constellation: "Capricornus",
      raHours: 20.8617,
      decDeg: -26.9192,
      magnitude: 4.11,
      color: "#ffbb95",
    },
    {
      id: "psi-capricorni",
      name: "Psi Capricorni",
      constellation: "Capricornus",
      raHours: 20.7692,
      decDeg: -25.2705,
      magnitude: 4.13,
      color: "#fff6e4",
    },
    {
      id: "iota-capricorni",
      name: "Iota Capricorni",
      constellation: "Capricornus",
      raHours: 21.3712,
      decDeg: -16.8348,
      magnitude: 4.27,
      color: "#fff0cf",
    },
    {
      id: "epsilon-scorpii",
      name: "Epsilon Scorpii",
      constellation: "Scorpius",
      raHours: 16.8361,
      decDeg: -34.2933,
      magnitude: 2.29,
      color: "#ffcb9a",
    },
    {
      id: "kappa-scorpii",
      name: "Kappa Scorpii",
      constellation: "Scorpius",
      raHours: 17.7083,
      decDeg: -39.0299,
      magnitude: 2.39,
      color: "#d0e7ff",
    },
    {
      id: "zeta-ophiuchi",
      name: "Zeta Ophiuchi",
      constellation: "Ophiuchus",
      raHours: 16.6191,
      decDeg: -10.5671,
      magnitude: 2.56,
      color: "#cfe6ff",
    },
    { id: "acrab", name: "Acrab", constellation: "Scorpius", raHours: 16.0906, decDeg: -19.8055, magnitude: 2.62, color: "#d0e7ff" },
    {
      id: "tau-scorpii",
      name: "Tau Scorpii",
      constellation: "Scorpius",
      raHours: 16.5983,
      decDeg: -28.216,
      magnitude: 2.82,
      color: "#d0e7ff",
    },
    {
      id: "pi-scorpii",
      name: "Pi Scorpii",
      constellation: "Scorpius",
      raHours: 15.981,
      decDeg: -26.114,
      magnitude: 2.89,
      color: "#d0e7ff",
    },
    {
      id: "sigma-scorpii",
      name: "Sigma Scorpii",
      constellation: "Scorpius",
      raHours: 16.3536,
      decDeg: -25.5928,
      magnitude: 2.89,
      color: "#d5e8ff",
    },
    { id: "mu-scorpii", name: "Mu Scorpii", constellation: "Scorpius", raHours: 16.8622, decDeg: -38.0475, magnitude: 3, color: "#d0e7ff" },
    {
      id: "iota-scorpii",
      name: "Iota Scorpii",
      constellation: "Scorpius",
      raHours: 17.793,
      decDeg: -40.127,
      magnitude: 3.03,
      color: "#fff6e4",
    },
    {
      id: "eta-scorpii",
      name: "Eta Scorpii",
      constellation: "Scorpius",
      raHours: 17.2027,
      decDeg: -43.2392,
      magnitude: 3.32,
      color: "#fff6e4",
    },
    {
      id: "zeta-scorpii",
      name: "Zeta Scorpii",
      constellation: "Scorpius",
      raHours: 16.907,
      decDeg: -42.3612,
      magnitude: 3.62,
      color: "#ffbb95",
    },
    {
      id: "rho-scorpii",
      name: "Rho Scorpii",
      constellation: "Scorpius",
      raHours: 15.9564,
      decDeg: -29.2141,
      magnitude: 3.87,
      color: "#d5e8ff",
    },
    {
      id: "pi-sagittarii",
      name: "Pi Sagittarii",
      constellation: "Sagittarius",
      raHours: 19.1625,
      decDeg: -21.0235,
      magnitude: 2.89,
      color: "#fff6e4",
    },
    {
      id: "eta-sagittarii",
      name: "Eta Sagittarii",
      constellation: "Sagittarius",
      raHours: 18.2939,
      decDeg: -36.7616,
      magnitude: 3.11,
      color: "#ffbb95",
    },
    {
      id: "phi-sagittarii",
      name: "Phi Sagittarii",
      constellation: "Sagittarius",
      raHours: 18.746,
      decDeg: -26.9907,
      magnitude: 3.17,
      color: "#d8ebff",
    },
    {
      id: "tau-sagittarii",
      name: "Tau Sagittarii",
      constellation: "Sagittarius",
      raHours: 19.1153,
      decDeg: -27.6705,
      magnitude: 3.32,
      color: "#ffcfa2",
    },
    {
      id: "xi2-sagittarii",
      name: "Xi2 Sagittarii",
      constellation: "Sagittarius",
      raHours: 18.9587,
      decDeg: -21.1067,
      magnitude: 3.51,
      color: "#ffcfa2",
    },
    {
      id: "omicron-sagittarii",
      name: "Omicron Sagittarii",
      constellation: "Sagittarius",
      raHours: 19.0774,
      decDeg: -21.7415,
      magnitude: 3.77,
      color: "#ffdcb0",
    },
    {
      id: "kappa-ophiuchi",
      name: "Kappa Ophiuchi",
      constellation: "Ophiuchus",
      raHours: 16.9611,
      decDeg: 9.375,
      magnitude: 3.2,
      color: "#ffcfa2",
    },
    {
      id: "theta-ophiuchi",
      name: "Theta Ophiuchi",
      constellation: "Ophiuchus",
      raHours: 17.369,
      decDeg: -24.9995,
      magnitude: 3.27,
      color: "#d0e7ff",
    },
    {
      id: "nu-ophiuchi",
      name: "Nu Ophiuchi",
      constellation: "Ophiuchus",
      raHours: 17.9843,
      decDeg: -9.7735,
      magnitude: 3.32,
      color: "#ffdcb0",
    },
    {
      id: "gamma-ophiuchi",
      name: "Gamma Ophiuchi",
      constellation: "Ophiuchus",
      raHours: 17.7978,
      decDeg: 2.7073,
      magnitude: 3.75,
      color: "#eef5ff",
    },
    {
      id: "zeta-herculis",
      name: "Zeta Herculis",
      constellation: "Hercules",
      raHours: 16.6882,
      decDeg: 31.6019,
      magnitude: 2.81,
      color: "#fff6e4",
    },
    {
      id: "pi-herculis",
      name: "Pi Herculis",
      constellation: "Hercules",
      raHours: 17.2506,
      decDeg: 36.8092,
      magnitude: 3.16,
      color: "#ffcfa2",
    },
    {
      id: "mu-herculis",
      name: "Mu Herculis",
      constellation: "Hercules",
      raHours: 17.7746,
      decDeg: 27.7204,
      magnitude: 3.42,
      color: "#fff6e4",
    },
    {
      id: "eta-herculis",
      name: "Eta Herculis",
      constellation: "Hercules",
      raHours: 16.7146,
      decDeg: 38.9224,
      magnitude: 3.53,
      color: "#ffdcb0",
    },
    {
      id: "xi-herculis",
      name: "Xi Herculis",
      constellation: "Hercules",
      raHours: 17.9633,
      decDeg: 29.2478,
      magnitude: 3.7,
      color: "#ffdcb0",
    },
    {
      id: "iota-herculis",
      name: "Iota Herculis",
      constellation: "Hercules",
      raHours: 17.6606,
      decDeg: 46.0064,
      magnitude: 3.8,
      color: "#d5e8ff",
    },
    {
      id: "tau-herculis",
      name: "Tau Herculis",
      constellation: "Hercules",
      raHours: 16.3323,
      decDeg: 46.3132,
      magnitude: 3.89,
      color: "#d5e8ff",
    },
    {
      id: "epsilon-herculis",
      name: "Epsilon Herculis",
      constellation: "Hercules",
      raHours: 17.0049,
      decDeg: 30.9263,
      magnitude: 3.92,
      color: "#dcecff",
    },
    {
      id: "beta-serpentis",
      name: "Beta Serpentis",
      constellation: "Serpens",
      raHours: 15.7696,
      decDeg: 15.4218,
      magnitude: 3.65,
      color: "#eef5ff",
    },
    {
      id: "mu-serpentis",
      name: "Mu Serpentis",
      constellation: "Serpens",
      raHours: 15.8265,
      decDeg: -3.4303,
      magnitude: 3.53,
      color: "#eef5ff",
    },
    {
      id: "eta-serpentis",
      name: "Eta Serpentis",
      constellation: "Serpens",
      raHours: 18.3552,
      decDeg: -2.8987,
      magnitude: 3.26,
      color: "#ffdcb0",
    },
    {
      id: "xi-serpentis",
      name: "Xi Serpentis",
      constellation: "Serpens",
      raHours: 17.6259,
      decDeg: -15.3985,
      magnitude: 3.54,
      color: "#fff6e4",
    },
    {
      id: "epsilon-serpentis",
      name: "Epsilon Serpentis",
      constellation: "Serpens",
      raHours: 15.8467,
      decDeg: 4.4777,
      magnitude: 3.71,
      color: "#f4f7ff",
    },
    {
      id: "delta-serpentis",
      name: "Delta Serpentis",
      constellation: "Serpens",
      raHours: 15.5799,
      decDeg: 10.5389,
      magnitude: 3.8,
      color: "#f4f7ff",
    },
    {
      id: "gamma-serpentis",
      name: "Gamma Serpentis",
      constellation: "Serpens",
      raHours: 15.9407,
      decDeg: 15.6618,
      magnitude: 3.85,
      color: "#fff6e4",
    },
  ];

  const PLANET_CATALOG = [
    {
      id: "mercury",
      name: "Mercury",
      magnitude: -0.6,
      color: "#c7cdd6",
      orbit: {
        ascendingNodeDeg: { base: 48.3313, rate: 0.0000324587 },
        inclinationDeg: { base: 7.0047, rate: 0.00000005 },
        argumentOfPerihelionDeg: { base: 29.1241, rate: 0.0000101444 },
        semiMajorAxisAu: { base: 0.387098, rate: 0 },
        eccentricity: { base: 0.205635, rate: 0.000000000559 },
        meanAnomalyDeg: { base: 168.6562, rate: 4.0923344368 },
      },
    },
    {
      id: "venus",
      name: "Venus",
      magnitude: -4.2,
      color: "#f7e7c3",
      orbit: {
        ascendingNodeDeg: { base: 76.6799, rate: 0.000024659 },
        inclinationDeg: { base: 3.3946, rate: 0.0000000275 },
        argumentOfPerihelionDeg: { base: 54.891, rate: 0.0000138374 },
        semiMajorAxisAu: { base: 0.72333, rate: 0 },
        eccentricity: { base: 0.006773, rate: -0.000000001302 },
        meanAnomalyDeg: { base: 48.0052, rate: 1.6021302244 },
      },
    },
    {
      id: "mars",
      name: "Mars",
      magnitude: -1.1,
      color: "#ff8f70",
      orbit: {
        ascendingNodeDeg: { base: 49.5574, rate: 0.0000211081 },
        inclinationDeg: { base: 1.8497, rate: -0.0000000178 },
        argumentOfPerihelionDeg: { base: 286.5016, rate: 0.0000292961 },
        semiMajorAxisAu: { base: 1.523688, rate: 0 },
        eccentricity: { base: 0.093405, rate: 0.000000002516 },
        meanAnomalyDeg: { base: 18.6021, rate: 0.5240207766 },
      },
    },
    {
      id: "jupiter",
      name: "Jupiter",
      magnitude: -2.7,
      color: "#f0d2ab",
      orbit: {
        ascendingNodeDeg: { base: 100.4542, rate: 0.0000276854 },
        inclinationDeg: { base: 1.303, rate: -0.0000001557 },
        argumentOfPerihelionDeg: { base: 273.8777, rate: 0.0000164505 },
        semiMajorAxisAu: { base: 5.20256, rate: 0 },
        eccentricity: { base: 0.048498, rate: 0.000000004469 },
        meanAnomalyDeg: { base: 19.895, rate: 0.0830853001 },
      },
    },
    {
      id: "saturn",
      name: "Saturn",
      magnitude: 0.7,
      color: "#ecd39a",
      orbit: {
        ascendingNodeDeg: { base: 113.6634, rate: 0.000023898 },
        inclinationDeg: { base: 2.4886, rate: -0.0000001081 },
        argumentOfPerihelionDeg: { base: 339.3939, rate: 0.0000297661 },
        semiMajorAxisAu: { base: 9.55475, rate: 0 },
        eccentricity: { base: 0.055546, rate: -0.000000009499 },
        meanAnomalyDeg: { base: 316.967, rate: 0.0334442282 },
      },
    },
    {
      id: "uranus",
      name: "Uranus",
      magnitude: 5.68,
      color: "#b9f0ef",
      orbit: {
        ascendingNodeDeg: { base: 74.0005, rate: 0.000013978 },
        inclinationDeg: { base: 0.7733, rate: 0.000000019 },
        argumentOfPerihelionDeg: { base: 96.6612, rate: 0.000030565 },
        semiMajorAxisAu: { base: 19.18171, rate: -0.0000000155 },
        eccentricity: { base: 0.047318, rate: 0.00000000745 },
        meanAnomalyDeg: { base: 142.5905, rate: 0.011725806 },
      },
    },
    {
      id: "neptune",
      name: "Neptune",
      magnitude: 7.78,
      color: "#7fa8ff",
      orbit: {
        ascendingNodeDeg: { base: 131.7806, rate: 0.000030173 },
        inclinationDeg: { base: 1.77, rate: -0.000000255 },
        argumentOfPerihelionDeg: { base: 272.8461, rate: -0.000006027 },
        semiMajorAxisAu: { base: 30.05826, rate: 0.00000003313 },
        eccentricity: { base: 0.008606, rate: 0.00000000215 },
        meanAnomalyDeg: { base: 260.2471, rate: 0.005995147 },
      },
    },
    {
      id: "pluto",
      name: "Pluto",
      magnitude: 14.0,
      color: "#cbb9d6",
      orbit: {
        ascendingNodeDeg: { base: 110.30347, rate: 0 },
        inclinationDeg: { base: 17.14175, rate: 0 },
        argumentOfPerihelionDeg: { base: 113.76329, rate: 0 },
        semiMajorAxisAu: { base: 39.48168677, rate: 0 },
        eccentricity: { base: 0.24880766, rate: 0 },
        meanAnomalyDeg: { base: 14.53, rate: 0.003975709 },
      },
    },
  ];

  const CONSTELLATION_SEGMENTS = [
    ["betelgeuse", "bellatrix"],
    ["betelgeuse", "alnilam"],
    ["bellatrix", "alnilam"],
    ["alnilam", "rigel"],
    ["bellatrix", "mintaka"],
    ["mintaka", "alnilam"],
    ["alnilam", "alnitak"],
    ["alnitak", "saiph"],
    ["saiph", "rigel"],
    ["meissa", "betelgeuse"],
    ["meissa", "bellatrix"],
    ["sirius", "procyon"],
    ["procyon", "betelgeuse"],
    ["betelgeuse", "sirius"],
    ["sirius", "mirzam"],
    ["mirzam", "adhara"],
    ["adhara", "wezen"],
    ["vega", "deneb"],
    ["vega", "sheliak"],
    ["sheliak", "sulafat"],
    ["deneb", "altair"],
    ["deneb", "sadr"],
    ["sadr", "albireo"],
    ["altair", "vega"],
    ["altair", "tarazed"],
    ["capella", "menkalinan"],
    ["dubhe", "merak"],
    ["merak", "phecda"],
    ["phecda", "megrez"],
    ["megrez", "alioth"],
    ["alioth", "mizar"],
    ["mizar", "alkaid"],
    ["caph", "schedar"],
    ["schedar", "ruchbah"],
    ["ruchbah", "segin"],
    ["pollux", "castor"],
    ["castor", "alhena"],
    ["pollux", "alhena"],
    ["gacrux", "mimosa"],
    ["mimosa", "acrux"],
    ["mimosa", "imai"],
    ["regulus", "algieba"],
    ["algieba", "denebola"],
    ["regulus", "denebola"],
    ["shaula", "lesath"],
    ["markab", "scheat"],
    ["markab", "enif"],
    ["enif", "scheat"],
    ["scheat", "alpheratz"],
    ["alpheratz", "mirach"],
    ["mirach", "almaak"],
    ["alpheratz", "algenib"],
    ["algenib", "markab"],
    ["hamal", "sheratan"],
    ["sheratan", "mesarthim"],
    ["polaris", "kochab"],
    ["kochab", "pherkad"],
    ["pherkad", "polaris"],
    ["regulus", "adhafera"],
    ["adhafera", "rasalas"],
    ["rasalas", "zosma"],
    ["zosma", "denebola"],
    ["kaus-borealis", "nunki"],
    ["nunki", "kaus-media"],
    ["kaus-media", "kaus-australis"],
    ["kaus-media", "ascella"],
    ["ascella", "kaus-australis"],
    ["altair", "alshain"],
    ["alshain", "tarazed"],
    ["arcturus", "izar"],
    ["izar", "seginus"],
    ["seginus", "nekkar"],
    ["arcturus", "nekkar"],
    ["eltanin", "rastaban"],
    ["rasalhague", "cebalrai"],
    ["cebalrai", "yed-prior"],
    ["yed-prior", "yed-posterior"],
    ["yed-posterior", "sabik"],
    ["mirzam", "furud"],
    ["furud", "adhara"],
    ["wezen", "aludra"],
    ["pollux", "wasat"],
    ["wasat", "castor"],
    ["pollux", "tejat"],
    ["tejat", "alhena"],
    ["wasat", "mebsuta"],
    ["spica", "porrima"],
    ["porrima", "vindemiatrix"],
    ["vindemiatrix", "syrma"],
    ["mirfak", "atik"],
    ["atik", "menkib"],
    ["sadalmelik", "sadalsuud"],
    ["zubenelgenubi", "zubeneschamali"],
    ["ruchbah", "navi"],
    ["navi", "segin"],
    ["alderamin", "alfirk"],
    ["alfirk", "errai"],
    ["errai", "alderamin"],
    ["rastaban", "thuban"],
    ["thuban", "eltanin"],
    ["rasalgethi", "kornephoros"],
    ["kornephoros", "sarin"],
    ["sarin", "marfik"],
    ["deneb", "delta-cygni"],
    ["delta-cygni", "sadr"],
    ["sadr", "gienah-cygni"],
    ["gienah-cygni", "albireo"],
    ["enif", "homam"],
    ["homam", "matar"],
    ["matar", "scheat"],
    ["aldebaran", "ain"],
    ["ain", "hyadum-i"],
    ["hyadum-i", "elnath"],
    ["capella", "almaaz"],
    ["almaaz", "menkalinan"],
    ["arcturus", "muphrid"],
    ["muphrid", "izar"],
    ["nunki", "alnasl"],
    ["alnasl", "kaus-australis"],
    ["polaris", "yildun"],
    ["nashira", "deneb-algedi"],
    ["procyon", "gomeisa"],
    ["mirfak", "miram"],
    ["miram", "algol"],
    ["algol", "atik"],
    ["aldebaran", "alcyone"],
    ["alcyone", "elnath"],
    ["diphda", "menkar"],
    ["markab", "alrescha"],
    ["ankaa", "fomalhaut"],
    ["gienah-corvi", "algorab"],
    ["algorab", "spica"],
    ["porrima", "zaniah"],
    ["zaniah", "heze"],
    ["heze", "spica"],
    ["heze", "auva"],
    ["zubenelgenubi", "zubenelhakrabi"],
    ["zubenelhakrabi", "zubeneschamali"],
    ["naos", "suhail"],

    // --- Catalog expansion: figures for the stars added above ----------------
    ["altarf", "asellus-australis"],
    ["asellus-australis", "asellus-borealis"],
    ["asellus-australis", "acubens"],
    ["asellus-borealis", "iota-cancri"],
    ["gamma-monocerotis", "beta-monocerotis"],
    ["beta-monocerotis", "delta-monocerotis"],
    ["delta-monocerotis", "alpha-monocerotis"],
    ["arneb", "nihal"],
    ["nihal", "epsilon-leporis"],
    ["epsilon-leporis", "mu-leporis"],
    ["mu-leporis", "arneb"],
    ["nihal", "gamma-leporis"],
    ["gamma-leporis", "delta-leporis"],
    ["delta-leporis", "zeta-leporis"],
    ["zeta-leporis", "arneb"],
    ["epsilon-columbae", "phact"],
    ["phact", "wazn"],
    ["wazn", "delta-columbae"],
    ["sualocin", "rotanev"],
    ["rotanev", "delta-delphini"],
    ["delta-delphini", "gamma-delphini"],
    ["gamma-delphini", "sualocin"],
    ["delta-delphini", "epsilon-delphini"],
    ["sham", "delta-sagittae"],
    ["beta-sagittae", "delta-sagittae"],
    ["delta-sagittae", "gamma-sagittae"],
    ["alpha-lacertae", "beta-lacertae"],
    ["mothallah", "beta-trianguli"],
    ["beta-trianguli", "gamma-trianguli"],
    ["gamma-trianguli", "mothallah"],
    ["alpha-lyncis", "38-lyncis"],
    ["alpha-camelopardalis", "beta-camelopardalis"],
    ["cor-caroli", "chara"],
    ["gamma-comae", "beta-comae"],
    ["beta-comae", "diadem"],
    ["alkes", "beta-crateris"],
    ["beta-crateris", "gamma-crateris"],
    ["gamma-crateris", "delta-crateris"],
    ["delta-crateris", "alkes"],
    ["alpha-pyxidis", "beta-pyxidis"],
    ["alpha-lupi", "beta-lupi"],
    ["beta-lupi", "delta-lupi"],
    ["delta-lupi", "gamma-lupi"],
    ["delta-lupi", "epsilon-lupi"],
    ["epsilon-lupi", "zeta-lupi"],
    ["zeta-lupi", "alpha-lupi"],
    ["alpha-arae", "beta-arae"],
    ["beta-arae", "gamma-arae"],
    ["gamma-arae", "delta-arae"],
    ["gamma-arae", "zeta-arae"],
    ["theta-coronae-borealis", "nusakan"],
    ["nusakan", "alphecca"],
    ["alphecca", "gamma-coronae-borealis"],
    ["gamma-coronae-borealis", "delta-coronae-borealis"],
    ["delta-coronae-borealis", "epsilon-coronae-borealis"],
    ["meridiana", "beta-coronae-australis"],
    ["alpha-indi", "beta-indi"],
    ["alpha-tucanae", "gamma-tucanae"],
    ["beta-hydri", "alpha-hydri"],
    ["alpha-hydri", "gamma-hydri"],
    ["gamma-hydri", "beta-hydri"],
    ["alpha-reticuli", "beta-reticuli"],
    ["alpha-doradus", "beta-doradus"],
    ["alpha-pictoris", "beta-pictoris"],
    ["beta-volantis", "gamma-volantis"],
    ["alpha-muscae", "beta-muscae"],
    ["alpha-muscae", "delta-muscae"],
    ["alpha-chamaeleontis", "gamma-chamaeleontis"],
    ["nu-octantis", "beta-octantis"],
    ["alpha-sculptoris", "beta-sculptoris"],
    ["alpha-scuti", "beta-scuti"],
    ["cursa", "nu-eridani"],
    ["nu-eridani", "zaurak"],
    ["zaurak", "rana"],
    ["rana", "epsilon-eridani"],
    ["epsilon-eridani", "azha"],
    ["azha", "upsilon2-eridani"],
    ["upsilon2-eridani", "acamar"],
    ["acamar", "iota-eridani"],
    ["iota-eridani", "kappa-eridani"],
    ["kappa-eridani", "phi-eridani"],
    ["phi-eridani", "chi-eridani"],
    ["chi-eridani", "achernar"],
    ["eta-hydrae", "sigma-hydrae"],
    ["sigma-hydrae", "delta-hydrae"],
    ["delta-hydrae", "epsilon-hydrae"],
    ["epsilon-hydrae", "zeta-hydrae"],
    ["zeta-hydrae", "eta-hydrae"],
    ["zeta-hydrae", "theta-hydrae"],
    ["theta-hydrae", "iota-hydrae"],
    ["iota-hydrae", "alphard"],
    ["alphard", "lambda-hydrae"],
    ["lambda-hydrae", "mu-hydrae"],
    ["mu-hydrae", "nu-hydrae"],
    ["nu-hydrae", "xi-hydrae"],
    ["xi-hydrae", "gamma-hydrae"],
    ["gamma-hydrae", "pi-hydrae"],
    ["rigil-kentaurus", "hadar"],
    ["hadar", "epsilon-centauri"],
    ["epsilon-centauri", "zeta-centauri"],
    ["zeta-centauri", "gamma-centauri"],
    ["gamma-centauri", "delta-centauri"],
    ["zeta-centauri", "eta-centauri"],
    ["eta-centauri", "kappa-centauri"],
    ["gamma-centauri", "iota-centauri"],
    ["iota-centauri", "menkent"],
    ["menkent", "eta-centauri"],
    ["delta-centauri", "lambda-centauri"],
    ["regor", "alsephina"],
    ["alsephina", "markeb"],
    ["markeb", "phi-velorum"],
    ["phi-velorum", "mu-velorum"],
    ["mu-velorum", "psi-velorum"],
    ["psi-velorum", "suhail"],
    ["suhail", "regor"],
    ["tau-puppis", "nu-puppis"],
    ["nu-puppis", "pi-puppis"],
    ["pi-puppis", "sigma-puppis"],
    ["sigma-puppis", "naos"],
    ["naos", "xi-puppis"],
    ["xi-puppis", "rho-puppis"],
    ["canopus", "avior"],
    ["avior", "aspidiske"],
    ["aspidiske", "upsilon-carinae"],
    ["upsilon-carinae", "omega-carinae"],
    ["omega-carinae", "theta-carinae"],
    ["theta-carinae", "p-carinae"],
    ["p-carinae", "miaplacidus"],
    ["miaplacidus", "omega-carinae"],
    ["aldhanab", "delta-gruis"],
    ["delta-gruis", "alnair"],
    ["alnair", "tiaki"],
    ["tiaki", "epsilon-gruis"],
    ["epsilon-gruis", "zeta-gruis"],
    ["tiaki", "iota-gruis"],
    ["ankaa", "beta-phoenicis"],
    ["beta-phoenicis", "gamma-phoenicis"],
    ["gamma-phoenicis", "delta-phoenicis"],
    ["delta-phoenicis", "beta-phoenicis"],
    ["beta-phoenicis", "zeta-phoenicis"],
    ["ankaa", "epsilon-phoenicis"],
    ["epsilon-phoenicis", "kappa-phoenicis"],
    ["menkar", "kaffaljidhma"],
    ["kaffaljidhma", "delta-ceti"],
    ["delta-ceti", "baten-kaitos"],
    ["baten-kaitos", "tau-ceti"],
    ["tau-ceti", "upsilon-ceti"],
    ["upsilon-ceti", "diphda"],
    ["diphda", "iota-ceti"],
    ["iota-ceti", "deneb-algenubi"],
    ["deneb-algenubi", "theta-ceti"],
    ["theta-ceti", "baten-kaitos"],
    ["beta-piscium", "gamma-piscium"],
    ["gamma-piscium", "theta-piscium"],
    ["theta-piscium", "iota-piscium"],
    ["iota-piscium", "omega-piscium"],
    ["omega-piscium", "delta-piscium"],
    ["delta-piscium", "epsilon-piscium"],
    ["epsilon-piscium", "alrescha"],
    ["alrescha", "omicron-piscium"],
    ["omicron-piscium", "alpherg"],
    ["albali", "sadalsuud"],
    ["sadalmelik", "sadachbia"],
    ["sadachbia", "zeta-aquarii"],
    ["zeta-aquarii", "eta-aquarii"],
    ["zeta-aquarii", "lambda-aquarii"],
    ["lambda-aquarii", "tau-aquarii"],
    ["tau-aquarii", "skaat"],
    ["lambda-aquarii", "phi-aquarii"],
    ["algedi", "dabih"],
    ["dabih", "psi-capricorni"],
    ["psi-capricorni", "omega-capricorni"],
    ["omega-capricorni", "zeta-capricorni"],
    ["zeta-capricorni", "deneb-algedi"],
    ["deneb-algedi", "iota-capricorni"],
    ["iota-capricorni", "theta-capricorni"],
    ["theta-capricorni", "algedi"],
    ["acrab", "dschubba"],
    ["dschubba", "pi-scorpii"],
    ["pi-scorpii", "rho-scorpii"],
    ["dschubba", "sigma-scorpii"],
    ["sigma-scorpii", "antares"],
    ["antares", "tau-scorpii"],
    ["tau-scorpii", "epsilon-scorpii"],
    ["epsilon-scorpii", "mu-scorpii"],
    ["mu-scorpii", "zeta-scorpii"],
    ["zeta-scorpii", "eta-scorpii"],
    ["eta-scorpii", "sargas"],
    ["sargas", "iota-scorpii"],
    ["iota-scorpii", "kappa-scorpii"],
    ["kappa-scorpii", "shaula"],
    ["kaus-borealis", "phi-sagittarii"],
    ["phi-sagittarii", "nunki"],
    ["phi-sagittarii", "kaus-media"],
    ["nunki", "tau-sagittarii"],
    ["tau-sagittarii", "ascella"],
    ["kaus-australis", "eta-sagittarii"],
    ["nunki", "xi2-sagittarii"],
    ["xi2-sagittarii", "omicron-sagittarii"],
    ["omicron-sagittarii", "pi-sagittarii"],
    ["rasalhague", "kappa-ophiuchi"],
    ["kappa-ophiuchi", "zeta-ophiuchi"],
    ["zeta-ophiuchi", "sabik"],
    ["zeta-ophiuchi", "yed-posterior"],
    ["sabik", "theta-ophiuchi"],
    ["cebalrai", "gamma-ophiuchi"],
    ["gamma-ophiuchi", "nu-ophiuchi"],
    ["zeta-herculis", "epsilon-herculis"],
    ["epsilon-herculis", "pi-herculis"],
    ["pi-herculis", "eta-herculis"],
    ["eta-herculis", "zeta-herculis"],
    ["zeta-herculis", "kornephoros"],
    ["pi-herculis", "mu-herculis"],
    ["mu-herculis", "xi-herculis"],
    ["pi-herculis", "iota-herculis"],
    ["eta-herculis", "tau-herculis"],
    ["sarin", "epsilon-herculis"],
    ["beta-serpentis", "gamma-serpentis"],
    ["beta-serpentis", "delta-serpentis"],
    ["delta-serpentis", "unukalhai"],
    ["unukalhai", "epsilon-serpentis"],
    ["epsilon-serpentis", "mu-serpentis"],
    ["xi-serpentis", "eta-serpentis"],
  ];

  function toNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function normalizeDegrees(value) {
    const normalized = toNumber(value) % 360;
    return normalized < 0 ? normalized + 360 : normalized;
  }

  function normalizeHours(value) {
    const normalized = toNumber(value) % 24;
    return normalized < 0 ? normalized + 24 : normalized;
  }

  function degreesToRadians(value) {
    return (toNumber(value) * Math.PI) / 180;
  }

  function radiansToDegrees(value) {
    return (toNumber(value) * 180) / Math.PI;
  }

  function calculateJulianDate(date) {
    const sourceDate = date instanceof Date ? date : new Date(date);
    return sourceDate.getTime() / 86400000 + 2440587.5;
  }

  function calculateGreenwichSiderealTime(date) {
    const julianDate = calculateJulianDate(date);
    const centuries = (julianDate - 2451545.0) / 36525.0;
    const degrees =
      280.46061837 +
      360.98564736629 * (julianDate - 2451545.0) +
      0.000387933 * centuries * centuries -
      (centuries * centuries * centuries) / 38710000;

    return normalizeHours(degrees / 15);
  }

  function calculateLocalSiderealTime(date, longitudeDeg) {
    return normalizeHours(calculateGreenwichSiderealTime(date) + toNumber(longitudeDeg) / 15);
  }

  function solveKeplerEquationDegrees(meanAnomalyDeg, eccentricity, iterations = 6) {
    const meanAnomalyRad = degreesToRadians(meanAnomalyDeg);
    let eccentricAnomaly = meanAnomalyRad;

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      eccentricAnomaly -=
        (eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - meanAnomalyRad) / (1 - eccentricity * Math.cos(eccentricAnomaly));
    }

    return radiansToDegrees(eccentricAnomaly);
  }

  function calculateSunEclipticLongitude(date) {
    const daysSinceEpoch = calculateJulianDate(date) - 2451543.5;
    const argumentOfPerihelionDeg = normalizeDegrees(282.9404 + 0.0000470935 * daysSinceEpoch);
    const eccentricity = 0.016709 - 0.000000001151 * daysSinceEpoch;
    const meanAnomalyDeg = normalizeDegrees(356.047 + 0.9856002585 * daysSinceEpoch);
    const eccentricAnomalyDeg = solveKeplerEquationDegrees(meanAnomalyDeg, eccentricity);
    const eccentricAnomalyRad = degreesToRadians(eccentricAnomalyDeg);

    const x = Math.cos(eccentricAnomalyRad) - eccentricity;
    const y = Math.sqrt(1 - eccentricity * eccentricity) * Math.sin(eccentricAnomalyRad);
    const trueAnomalyDeg = radiansToDegrees(Math.atan2(y, x));
    const longitudeDeg = normalizeDegrees(trueAnomalyDeg + argumentOfPerihelionDeg);
    const distanceAu = Math.sqrt(x * x + y * y);

    return {
      longitudeDeg,
      distanceAu,
    };
  }

  function resolveLinearTerm(term, daysSinceEpoch) {
    if (typeof term === "number") {
      return term;
    }

    return toNumber(term?.base) + toNumber(term?.rate) * daysSinceEpoch;
  }

  function getMeanObliquityDeg(daysSinceEpoch) {
    return 23.4393 - 0.0000003563 * daysSinceEpoch;
  }

  function getZodiacConstellationName(longitudeDeg) {
    const names = [
      "Aries",
      "Taurus",
      "Gemini",
      "Cancer",
      "Leo",
      "Virgo",
      "Libra",
      "Scorpius",
      "Sagittarius",
      "Capricornus",
      "Aquarius",
      "Pisces",
    ];
    const normalized = normalizeDegrees(longitudeDeg);
    return names[Math.floor(normalized / 30) % names.length];
  }

  function calculatePlanetEquatorialPosition(planet, date) {
    const daysSinceEpoch = calculateJulianDate(date) - 2451543.5;
    const ascendingNodeDeg = normalizeDegrees(resolveLinearTerm(planet.orbit.ascendingNodeDeg, daysSinceEpoch));
    const inclinationDeg = resolveLinearTerm(planet.orbit.inclinationDeg, daysSinceEpoch);
    const argumentOfPerihelionDeg = normalizeDegrees(resolveLinearTerm(planet.orbit.argumentOfPerihelionDeg, daysSinceEpoch));
    const semiMajorAxisAu = resolveLinearTerm(planet.orbit.semiMajorAxisAu, daysSinceEpoch);
    const eccentricity = resolveLinearTerm(planet.orbit.eccentricity, daysSinceEpoch);
    const meanAnomalyDeg = normalizeDegrees(resolveLinearTerm(planet.orbit.meanAnomalyDeg, daysSinceEpoch));
    const eccentricAnomalyDeg = solveKeplerEquationDegrees(meanAnomalyDeg, eccentricity);
    const eccentricAnomalyRad = degreesToRadians(eccentricAnomalyDeg);

    const orbitalX = semiMajorAxisAu * (Math.cos(eccentricAnomalyRad) - eccentricity);
    const orbitalY = semiMajorAxisAu * Math.sqrt(1 - eccentricity * eccentricity) * Math.sin(eccentricAnomalyRad);
    const trueAnomalyDeg = radiansToDegrees(Math.atan2(orbitalY, orbitalX));
    const heliocentricDistanceAu = Math.sqrt(orbitalX * orbitalX + orbitalY * orbitalY);

    const ascendingNodeRad = degreesToRadians(ascendingNodeDeg);
    const inclinationRad = degreesToRadians(inclinationDeg);
    const argumentLatitudeRad = degreesToRadians(trueAnomalyDeg + argumentOfPerihelionDeg);

    const heliocentricX =
      heliocentricDistanceAu *
      (Math.cos(ascendingNodeRad) * Math.cos(argumentLatitudeRad) -
        Math.sin(ascendingNodeRad) * Math.sin(argumentLatitudeRad) * Math.cos(inclinationRad));
    const heliocentricY =
      heliocentricDistanceAu *
      (Math.sin(ascendingNodeRad) * Math.cos(argumentLatitudeRad) +
        Math.cos(ascendingNodeRad) * Math.sin(argumentLatitudeRad) * Math.cos(inclinationRad));
    const heliocentricZ = heliocentricDistanceAu * Math.sin(argumentLatitudeRad) * Math.sin(inclinationRad);

    const sun = calculateSunEclipticLongitude(date);
    const sunLongitudeRad = degreesToRadians(sun.longitudeDeg);
    const sunX = sun.distanceAu * Math.cos(sunLongitudeRad);
    const sunY = sun.distanceAu * Math.sin(sunLongitudeRad);

    const geocentricX = heliocentricX + sunX;
    const geocentricY = heliocentricY + sunY;
    const geocentricZ = heliocentricZ;
    const geocentricDistanceAu = Math.sqrt(geocentricX * geocentricX + geocentricY * geocentricY + geocentricZ * geocentricZ);
    const eclipticLongitudeDeg = normalizeDegrees(radiansToDegrees(Math.atan2(geocentricY, geocentricX)));
    const eclipticLatitudeDeg = radiansToDegrees(Math.atan2(geocentricZ, Math.sqrt(geocentricX * geocentricX + geocentricY * geocentricY)));

    const obliquityRad = degreesToRadians(getMeanObliquityDeg(daysSinceEpoch));
    const equatorialX = geocentricX;
    const equatorialY = geocentricY * Math.cos(obliquityRad) - geocentricZ * Math.sin(obliquityRad);
    const equatorialZ = geocentricY * Math.sin(obliquityRad) + geocentricZ * Math.cos(obliquityRad);

    return {
      raHours: normalizeHours(radiansToDegrees(Math.atan2(equatorialY, equatorialX)) / 15),
      decDeg: radiansToDegrees(Math.atan2(equatorialZ, Math.sqrt(equatorialX * equatorialX + equatorialY * equatorialY))),
      heliocentricDistanceAu,
      distanceAu: geocentricDistanceAu,
      eclipticLongitudeDeg,
      eclipticLatitudeDeg,
      constellation: getZodiacConstellationName(eclipticLongitudeDeg),
    };
  }

  function equatorialToHorizontal(star, date, latitudeDeg, longitudeDeg) {
    const latitude = clamp(toNumber(latitudeDeg), -90, 90);
    const declination = clamp(toNumber(star?.decDeg), -90, 90);
    const rightAscension = normalizeHours(toNumber(star?.raHours));
    const localSiderealTimeHours = calculateLocalSiderealTime(date, longitudeDeg);

    let hourAngleHours = normalizeHours(localSiderealTimeHours - rightAscension);
    if (hourAngleHours > 12) {
      hourAngleHours -= 24;
    }

    const latitudeRad = degreesToRadians(latitude);
    const declinationRad = degreesToRadians(declination);
    const hourAngleRad = degreesToRadians(hourAngleHours * 15);

    const sinAltitude =
      Math.sin(declinationRad) * Math.sin(latitudeRad) + Math.cos(declinationRad) * Math.cos(latitudeRad) * Math.cos(hourAngleRad);
    const altitudeRad = Math.asin(clamp(sinAltitude, -1, 1));

    const azimuthRad = Math.atan2(
      -Math.sin(hourAngleRad),
      Math.tan(declinationRad) * Math.cos(latitudeRad) - Math.sin(latitudeRad) * Math.cos(hourAngleRad),
    );

    return {
      altitudeDeg: radiansToDegrees(altitudeRad),
      azimuthDeg: normalizeDegrees(radiansToDegrees(azimuthRad)),
      localSiderealTimeHours,
      hourAngleHours,
    };
  }

  // Sky-dome viewport geometry. Mirrored verbatim from
  // services/observatory.service.js — GET /api/v1/observatory/viewport must be
  // able to answer exactly what this page draws, or the state mirror is a lie.
  const DOME_HORIZON_OVERSHOOT = 1.2;
  const MIN_ZOOM = 1;
  const MAX_ZOOM = 8;
  const MIN_CANVAS_SIZE_PX = 320;
  const DEFAULT_CANVAS_SIZE_PX = 820;
  const CANVAS_INSET_PX = 42;
  const MIN_CANVAS_RADIUS_PX = 120;

  // Time flow is a continuous log ramp rather than the old five-value select.
  // Position 0 is paused, position 1 is real time, position 100 is ×3600 — the
  // two ends of the old select land exactly, everything between is reachable.
  const TIME_SCALE_SLIDER_MAX = 100;
  const MAX_TIME_SCALE = 3600;

  const DEFAULT_MAGNITUDE_LIMIT = 4.2;

  // A gesture that stayed inside this radius was a click, not a pan.
  const DRAG_CLICK_THRESHOLD_PX = 4;
  const MIRROR_REFRESH_MS = 250;

  function roundTo(value, decimals) {
    const factor = 10 ** decimals;
    return Math.round(toNumber(value) * factor) / factor;
  }

  /**
   * Alt/az -> dome coordinates: a unit disc seen from above, zenith at the
   * origin, horizon at radius 1, north at -y.
   */
  function projectAltAzToDome(altitudeDeg, azimuthDeg) {
    const altitude = clamp(toNumber(altitudeDeg), -90, 90);
    const azimuthRad = degreesToRadians(normalizeDegrees(azimuthDeg));
    const domeRadius = clamp((90 - altitude) / 90, 0, DOME_HORIZON_OVERSHOOT);

    return {
      x: Math.sin(azimuthRad) * domeRadius,
      y: -Math.cos(azimuthRad) * domeRadius,
      radius: domeRadius,
    };
  }

  /** Inverse of projectAltAzToDome — turns a dome point back into alt/az. */
  function unprojectDomeToAltAz(x, y) {
    const domeX = toNumber(x);
    const domeY = toNumber(y);
    const domeRadius = Math.hypot(domeX, domeY);

    return {
      altitudeDeg: 90 - clamp(domeRadius, 0, DOME_HORIZON_OVERSHOOT) * 90,
      azimuthDeg: domeRadius === 0 ? 0 : normalizeDegrees(radiansToDegrees(Math.atan2(domeX, -domeY))),
    };
  }

  /** Zoom clamped to [1, 8]; the pan target clamped into the unit disc. */
  function clampViewport(viewport = {}) {
    const zoom = clamp(toNumber(viewport.zoom, MIN_ZOOM), MIN_ZOOM, MAX_ZOOM);
    const requestedX = clamp(toNumber(viewport.panX, 0), -1, 1);
    const requestedY = clamp(toNumber(viewport.panY, 0), -1, 1);
    const panRadius = Math.hypot(requestedX, requestedY);
    const scale = panRadius > 1 ? 1 / panRadius : 1;

    return {
      zoom: roundTo(zoom, 3),
      panX: roundTo(requestedX * scale, 4),
      panY: roundTo(requestedY * scale, 4),
    };
  }

  function computeCanvasMetrics(cssWidth, cssHeight) {
    const width = Math.max(MIN_CANVAS_SIZE_PX, Math.round(toNumber(cssWidth, DEFAULT_CANVAS_SIZE_PX)));
    const height = Math.max(MIN_CANVAS_SIZE_PX, Math.round(toNumber(cssHeight, width)));

    return {
      width,
      height,
      centerX: width / 2,
      centerY: height / 2,
      radius: Math.max(MIN_CANVAS_RADIUS_PX, Math.min(width, height) / 2 - CANVAS_INSET_PX),
    };
  }

  function projectDomeToCanvas(dome, viewport, canvas) {
    const zoom = toNumber(viewport?.zoom, 1);
    return {
      x: canvas.centerX + (toNumber(dome?.x) - toNumber(viewport?.panX)) * canvas.radius * zoom,
      y: canvas.centerY + (toNumber(dome?.y) - toNumber(viewport?.panY)) * canvas.radius * zoom,
    };
  }

  /**
   * The dome is clipped to a circular aperture that does NOT grow with zoom —
   * which is exactly why zooming in pushes objects out of view.
   */
  function isInsideAperture(point, canvas) {
    return Math.hypot(toNumber(point?.x) - canvas.centerX, toNumber(point?.y) - canvas.centerY) <= canvas.radius;
  }

  function timeScaleFromSliderPosition(position) {
    const slider = clamp(Math.round(toNumber(position, 1)), 0, TIME_SCALE_SLIDER_MAX);
    if (slider <= 0) {
      return 0;
    }

    const exponent = ((slider - 1) / (TIME_SCALE_SLIDER_MAX - 1)) * Math.log10(MAX_TIME_SCALE);
    return Math.round(10 ** exponent);
  }

  function sliderPositionFromTimeScale(timeScale) {
    const scale = clamp(toNumber(timeScale, 1), 0, MAX_TIME_SCALE);
    if (scale <= 0) {
      return 0;
    }

    const exponent = Math.log10(Math.max(1, scale)) / Math.log10(MAX_TIME_SCALE);
    return clamp(Math.round(1 + exponent * (TIME_SCALE_SLIDER_MAX - 1)), 1, TIME_SCALE_SLIDER_MAX);
  }

  function pluralize(count, noun) {
    return `${count} ${noun}${count === 1 ? "" : "s"}`;
  }

  function formatTimeScaleLabel(timeScale) {
    return toNumber(timeScale) <= 0 ? "Paused" : `×${toNumber(timeScale)}`;
  }

  // Legacy signature kept for the existing helper tests and for anything reading
  // the dome at zoom 1 with no pan: dome units scaled straight to pixels.
  function projectAltAzToCanvas(altitudeDeg, azimuthDeg, radius) {
    const dome = projectAltAzToDome(altitudeDeg, azimuthDeg);
    const scaledRadius = toNumber(radius, 0);

    return {
      x: dome.x * scaledRadius,
      y: dome.y * scaledRadius,
      distance: dome.radius * scaledRadius,
    };
  }

  function computeStarRadius(magnitude) {
    return clamp(5.1 - (toNumber(magnitude) + 1.4) * 0.72, 1.2, 4.9);
  }

  function formatRightAscension(hours) {
    const totalMinutes = Math.round(normalizeHours(hours) * 60);
    const hrs = Math.floor(totalMinutes / 60) % 24;
    const minutes = totalMinutes % 60;
    return `${String(hrs).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m`;
  }

  function formatSignedAngle(value, positiveLabel, negativeLabel) {
    const numericValue = toNumber(value);
    const label = numericValue >= 0 ? positiveLabel : negativeLabel;
    return `${Math.abs(numericValue).toFixed(2)}° ${label}`;
  }

  function formatAzimuth(value) {
    const azimuth = normalizeDegrees(value);
    const cardinal = ["N", "NE", "E", "SE", "S", "SW", "W", "NW", "N"];
    const index = Math.round(azimuth / 45);
    return `${azimuth.toFixed(1)}° ${cardinal[index]}`;
  }

  function describeSkyRegion(azimuthDeg) {
    const azimuth = normalizeDegrees(azimuthDeg);
    if (azimuth >= 337.5 || azimuth < 22.5) return "northern";
    if (azimuth < 67.5) return "north-eastern";
    if (azimuth < 112.5) return "eastern";
    if (azimuth < 157.5) return "south-eastern";
    if (azimuth < 202.5) return "southern";
    if (azimuth < 247.5) return "south-western";
    if (azimuth < 292.5) return "western";
    return "north-western";
  }

  function getVisibleStars({ date, latitudeDeg, longitudeDeg, magnitudeLimit = 4.2 } = {}) {
    return STAR_CATALOG.map((star) => {
      const horizontal = equatorialToHorizontal(star, date, latitudeDeg, longitudeDeg);
      return {
        ...star,
        ...horizontal,
      };
    })
      .filter((star) => star.altitudeDeg > 0 && star.magnitude <= toNumber(magnitudeLimit, 4.2))
      .sort(
        (left, right) => left.magnitude - right.magnitude || right.altitudeDeg - left.altitudeDeg || left.name.localeCompare(right.name),
      );
  }

  function getPlanetObjects({ date, latitudeDeg, longitudeDeg } = {}) {
    return PLANET_CATALOG.map((planet) => {
      const equatorial = calculatePlanetEquatorialPosition(planet, date);
      const horizontal = equatorialToHorizontal(equatorial, date, latitudeDeg, longitudeDeg);
      return {
        id: planet.id,
        name: planet.name,
        type: "planet",
        category: "planet",
        visible: horizontal.altitudeDeg > 0,
        color: planet.color,
        strokeColor: planet.color,
        magnitude: planet.magnitude,
        constellation: equatorial.constellation,
        raHours: equatorial.raHours,
        decDeg: equatorial.decDeg,
        altitudeDeg: horizontal.altitudeDeg,
        azimuthDeg: horizontal.azimuthDeg,
        localSiderealTimeHours: horizontal.localSiderealTimeHours,
        hourAngleHours: horizontal.hourAngleHours,
        distanceAu: Number(equatorial.distanceAu.toFixed(3)),
        heliocentricDistanceAu: Number(equatorial.heliocentricDistanceAu.toFixed(3)),
        eclipticLongitudeDeg: Number(equatorial.eclipticLongitudeDeg.toFixed(2)),
        eclipticLatitudeDeg: Number(equatorial.eclipticLatitudeDeg.toFixed(2)),
      };
    });
  }

  function getVisiblePlanets({ date, latitudeDeg, longitudeDeg, magnitudeLimit = 4.2 } = {}) {
    return getPlanetObjects({ date, latitudeDeg, longitudeDeg })
      .filter((planet) => planet.visible && planet.magnitude <= toNumber(magnitudeLimit, 4.2))
      .sort(
        (left, right) => left.magnitude - right.magnitude || right.altitudeDeg - left.altitudeDeg || left.name.localeCompare(right.name),
      );
  }

  function matchesObjectFilters(object, filters = {}) {
    const objectType = String(filters.objectType || "all")
      .trim()
      .toLowerCase();
    const constellation = String(filters.constellation || "all").trim();
    const searchQuery = String(filters.searchQuery || "")
      .trim()
      .toLowerCase();

    const matchesType =
      objectType === "all"
        ? true
        : objectType === "solar-system"
          ? object?.type === "moon" || object?.type === "planet"
          : object?.type === objectType;
    if (!matchesType) {
      return false;
    }

    if (constellation !== "all" && String(object?.constellation || "") !== constellation) {
      return false;
    }

    if (!searchQuery) {
      return true;
    }

    return [object?.name, object?.constellation, object?.type]
      .filter((value) => typeof value === "string" && value.trim())
      .some((value) => value.toLowerCase().includes(searchQuery));
  }

  function filterVisibleObjects(objects, filters = {}) {
    return (Array.isArray(objects) ? objects : []).filter((object) => matchesObjectFilters(object, filters));
  }

  function buildConstellationFilterOptions(objects, filters = {}) {
    const unique = new Set();

    (Array.isArray(objects) ? objects : []).forEach((object) => {
      if (!object?.constellation || object.type === "moon") {
        return;
      }

      if (!matchesObjectFilters(object, { ...filters, constellation: "all", searchQuery: "" })) {
        return;
      }

      unique.add(object.constellation);
    });

    return ["all", ...Array.from(unique).sort((left, right) => left.localeCompare(right))];
  }

  function findPresetById(id) {
    return LOCATION_PRESETS.find((preset) => preset.id === id) || null;
  }

  function computeObjectRenderRadius(object) {
    if (object?.type === "moon") {
      return 7.4;
    }

    if (object?.type === "planet") {
      return clamp(computeStarRadius(object?.magnitude) + 0.35, 1.5, 5.4);
    }

    return computeStarRadius(object?.magnitude);
  }

  function formatDistanceEarthRadii(value) {
    const numericValue = toNumber(value, NaN);
    if (!Number.isFinite(numericValue)) {
      return "Unknown";
    }

    return `${numericValue.toFixed(1)} Earth radii`;
  }

  /**
   * Groups the drawn segments into figures a viewer can point at: the stars each
   * constellation contributes, the lines between them, and where its name goes.
   *
   * A segment joining two constellations is an asterism — the Summer Triangle,
   * the Winter Triangle — and belongs to neither figure. It is still drawn, but
   * it is not part of anything clickable or labelled.
   */
  function buildConstellationFigures(objects, constellations) {
    const starMap = new Map(
      (Array.isArray(objects) ? objects : [])
        .filter(
          (object) =>
            object?.type === "star" &&
            typeof object.constellation === "string" &&
            object.constellation.trim() &&
            Number.isFinite(object.canvasX) &&
            Number.isFinite(object.canvasY),
        )
        .map((object) => [object.id, object]),
    );
    const groups = new Map();

    (constellations || []).forEach((segment) => {
      const from = starMap.get(segment?.fromId || segment?.[0]);
      const to = starMap.get(segment?.toId || segment?.[1]);
      if (!from || !to || from.constellation !== to.constellation) {
        return;
      }

      let group = groups.get(from.constellation);
      if (!group) {
        group = { name: from.constellation, segments: [], stars: new Map() };
        groups.set(from.constellation, group);
      }

      group.segments.push([from, to]);
      group.stars.set(from.id, from);
      group.stars.set(to.id, to);
    });

    return Array.from(groups.values())
      .map((group) => {
        const stars = Array.from(group.stars.values());
        const averageX = stars.reduce((sum, star) => sum + star.canvasX, 0) / stars.length;
        const averageY = stars.reduce((sum, star) => sum + star.canvasY, 0) / stars.length;
        const topY = stars.reduce((minY, star) => Math.min(minY, star.canvasY), Number.POSITIVE_INFINITY);
        const brightest = stars.reduce((best, star) => (best === null || star.magnitude < best.magnitude ? star : best), null);

        return {
          name: group.name,
          stars,
          segments: group.segments,
          starCount: stars.length,
          segmentCount: group.segments.length,
          inViewCount: stars.filter((star) => star.inView).length,
          brightestStar: brightest,
          centerX: averageX,
          centerY: averageY,
          // The name is nudged clear of the topmost star so it does not sit on
          // the figure it names.
          labelX: averageX,
          labelY: Math.min(averageY - 14, topY - 10),
        };
      })
      .filter((figure) => figure.starCount >= 2);
  }

  function getConstellationLabels(objects, constellations) {
    return buildConstellationFigures(objects, constellations)
      .map((figure) => ({
        name: figure.name,
        x: Number(figure.labelX.toFixed(2)),
        y: Number(figure.labelY.toFixed(2)),
        starCount: figure.starCount,
      }))
      .sort((left, right) => left.y - right.y || left.name.localeCompare(right.name));
  }

  /** Shortest distance from a point to a line segment — the constellation hit test. */
  function distanceToSegment(pointX, pointY, fromX, fromY, toX, toY) {
    const deltaX = toX - fromX;
    const deltaY = toY - fromY;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    if (lengthSquared === 0) {
      return Math.hypot(pointX - fromX, pointY - fromY);
    }

    const t = clamp(((pointX - fromX) * deltaX + (pointY - fromY) * deltaY) / lengthSquared, 0, 1);
    return Math.hypot(pointX - (fromX + t * deltaX), pointY - (fromY + t * deltaY));
  }

  class ObservatoryPage {
    constructor(options = {}) {
      this.documentRef = options.documentRef || (typeof document !== "undefined" ? document : null);
      this.windowRef = options.windowRef || (typeof window !== "undefined" ? window : null);
      this.nowProvider = typeof options.nowProvider === "function" ? options.nowProvider : () => new Date();
      this.location = {
        id: "warsaw",
        label: "Warsaw, Poland",
        latitudeDeg: 52.2297,
        longitudeDeg: 21.0122,
        source: "preset",
      };
      this.state = {
        showLabels: true,
        showConstellations: true,
        magnitudeLimit: 4.2,
        filters: {
          objectType: "all",
          constellation: "all",
          searchQuery: "",
        },
        selectedObjectId: "moon",
        // A figure, not an object: the highlight follows the lines between
        // stars, which is a different thing to select than any one star.
        selectedConstellation: null,
        snapshot: null,
      };
      this.constellationFigures = [];
      this.clock = {
        timeScale: 1,
        simulatedTimeMs: Date.now(),
        lastFrameMs: null,
      };
      // Where the aperture is pointed. Dome units, so it survives a resize and
      // means the same thing to GET /api/v1/observatory/viewport.
      this.viewport = { zoom: MIN_ZOOM, panX: 0, panY: 0 };
      // `?animate=0` freezes the dome: no clock advance, no twinkle, no redraw
      // loop — the prerequisite for a screenshot of a canvas.
      this.animate = true;
      this.controls = {};
      this.canvasMetrics = {
        width: 0,
        height: 0,
        centerX: 0,
        centerY: 0,
        radius: 0,
        dpr: 1,
        cssWidth: 0,
        cssHeight: 0,
        cssRadius: 0,
      };
      this.visibleObjects = [];
      this.animationFrameId = null;
      this.lastDrawAt = 0;
      this.eventSource = null;
      this.pointers = new Map();
      this.dragState = null;
      this.pinchState = null;
      this.suppressNextClick = false;
      this.mirrorNodes = new Map();
      this.presetOptionsSignature = null;
      this.lastMirrorAt = 0;
      this.forceMirrorUpdate = true;
      // Every setter below refreshes the stream. During init that would open and
      // discard four connections, so the stream stays shut until init says so.
      this.ready = false;
      this.handleAnimationFrame = this.handleAnimationFrame.bind(this);
    }

    init() {
      this._cacheDom();
      if (!this.controls.canvas || !this.documentRef) {
        return;
      }

      const bootstrap = this._readBootstrapParams();
      this._applyMotionMode();
      this._populatePresetOptions();
      this._bindEvents();
      this._applyCoordinates(bootstrap.location || this.location, { preserveLabel: true, updatePreset: true });
      this.syncClockToNow({ quiet: true, timestamp: bootstrap.timestamp });
      if (bootstrap.magnitudeLimit != null) {
        this.setMagnitudeLimit(bootstrap.magnitudeLimit, { quiet: true });
      }
      this.setViewport(bootstrap.viewport || this.viewport, { quiet: true });
      this.setTimeScale(bootstrap.timeScale != null ? bootstrap.timeScale : this.clock.timeScale, { quiet: true });
      this._resizeCanvas();
      this.ready = true;
      this._refreshSnapshot({ quiet: true });
      if (this.animate) {
        this._startLoop();
      }
      this.render();
    }

    /**
     * Frozen mode is a page-wide state, not a canvas one: CSS animations, the
     * time-flow control and the redraw loop all have to agree, or "frozen" only
     * means "the stars stopped".
     */
    _applyMotionMode() {
      const body = this.documentRef?.body;
      if (body?.classList) {
        body.classList.toggle("is-frozen", this.animate === false);
      }

      if (this.controls.shell?.setAttribute) {
        this.controls.shell.setAttribute("data-animate", this.animate ? "1" : "0");
      }

      if (this.controls.timeScaleRange) {
        this.controls.timeScaleRange.disabled = this.animate === false;
      }
    }

    /**
     * Reads the deterministic-run query params. `?animate=0` is the headline —
     * it pins the clock and kills every source of per-frame motion — but the
     * viewport, magnitude limit, timestamp and location can all be pinned too,
     * so a screenshot names the whole sky it expects.
     */
    _readBootstrapParams() {
      const search = this.windowRef?.location?.search;
      if (typeof search !== "string" || !search) {
        return {};
      }

      let params;
      try {
        params = new URLSearchParams(search);
      } catch (error) {
        return {};
      }

      const bootstrap = {};
      const readNumber = (key) => {
        const raw = params.get(key);
        if (raw == null || raw.trim() === "") {
          return null;
        }
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : null;
      };

      if (params.get("animate") === "0" || params.get("animate") === "false") {
        this.animate = false;
      }

      const zoom = readNumber("zoom");
      const panX = readNumber("panX");
      const panY = readNumber("panY");
      if (zoom != null || panX != null || panY != null) {
        bootstrap.viewport = {
          zoom: zoom != null ? zoom : MIN_ZOOM,
          panX: panX != null ? panX : 0,
          panY: panY != null ? panY : 0,
        };
      }

      const magnitudeLimit = readNumber("magnitudeLimit");
      if (magnitudeLimit != null) {
        bootstrap.magnitudeLimit = magnitudeLimit;
      }

      // A frozen dome still needs a frozen clock, so animate=0 pins time flow
      // even when no explicit timeScale is given.
      const timeScale = readNumber("timeScale");
      if (!this.animate) {
        bootstrap.timeScale = 0;
      } else if (timeScale != null) {
        bootstrap.timeScale = timeScale;
      }

      const timestamp = params.get("timestamp");
      if (timestamp) {
        const parsed = new Date(timestamp);
        if (!Number.isNaN(parsed.getTime())) {
          bootstrap.timestamp = parsed;
        }
      }

      const presetId = params.get("presetId");
      const latitude = readNumber("latitude");
      const longitude = readNumber("longitude");
      const preset = presetId ? findPresetById(presetId) : null;
      if (preset) {
        bootstrap.location = { ...preset, source: "preset" };
      } else if (latitude != null || longitude != null) {
        bootstrap.location = {
          id: "custom",
          label: "Custom coordinates",
          latitudeDeg: latitude != null ? latitude : this.location.latitudeDeg,
          longitudeDeg: longitude != null ? longitude : this.location.longitudeDeg,
          source: "manual",
        };
      }

      return bootstrap;
    }

    _cacheDom() {
      const doc = this.documentRef;
      this.controls = {
        shell: doc.getElementById("observatoryShell"),
        status: doc.getElementById("observatoryStatus"),
        timeBadge: doc.getElementById("observatoryTimeBadge"),
        liveBadge: doc.getElementById("observatoryLiveBadge"),
        canvas: doc.getElementById("observatoryCanvas"),
        canvasHost: doc.getElementById("observatoryCanvasHost"),
        domeMirror: doc.getElementById("observatoryDomeMirror"),
        viewportReadout: doc.getElementById("observatoryViewportReadout"),
        zoomInBtn: doc.getElementById("observatoryZoomInBtn"),
        zoomOutBtn: doc.getElementById("observatoryZoomOutBtn"),
        resetViewBtn: doc.getElementById("observatoryResetViewBtn"),
        hint: doc.getElementById("observatoryHint"),
        labelsToggle: doc.getElementById("observatoryLabelsToggle"),
        constellationsToggle: doc.getElementById("observatoryConstellationsToggle"),
        magnitudeRange: doc.getElementById("observatoryMagnitudeRange"),
        magnitudeValue: doc.getElementById("observatoryMagnitudeValue"),
        objectTypeFilter: doc.getElementById("observatoryObjectTypeFilter"),
        constellationFilter: doc.getElementById("observatoryConstellationFilter"),
        searchInput: doc.getElementById("observatorySearchInput"),
        clearFiltersBtn: doc.getElementById("observatoryClearFiltersBtn"),
        timeScaleRange: doc.getElementById("observatoryTimeScaleRange"),
        timeScaleValue: doc.getElementById("observatoryTimeScaleValue"),
        syncNowBtn: doc.getElementById("observatorySyncNowBtn"),
        presetSelect: doc.getElementById("observatoryPresetSelect"),
        geolocateBtn: doc.getElementById("observatoryGeolocateBtn"),
        latitudeInput: doc.getElementById("observatoryLatitudeInput"),
        longitudeInput: doc.getElementById("observatoryLongitudeInput"),
        locationSummary: doc.getElementById("observatoryLocationSummary"),
        objectName: doc.getElementById("observatoryObjectName"),
        objectBadge: doc.getElementById("observatoryObjectBadge"),
        objectSummary: doc.getElementById("observatoryObjectSummary"),
        objectMeta: doc.getElementById("observatoryObjectMeta"),
        visibleCount: doc.getElementById("observatoryVisibleCount"),
        visibleList: doc.getElementById("observatoryVisibleList"),
        constellationList: doc.getElementById("observatoryConstellationList"),
        constellationCount: doc.getElementById("observatoryConstellationCount"),
        constellationSummary: doc.getElementById("observatoryConstellationSummary"),
      };
    }

    _populatePresetOptions(presets = null) {
      const sourcePresets =
        Array.isArray(presets) && presets.length > 0
          ? presets
          : Array.isArray(this.state?.snapshot?.presets)
            ? this.state.snapshot.presets
            : LOCATION_PRESETS;
      const select = this.controls.presetSelect;
      if (!select) {
        return;
      }

      // Every snapshot carries the preset list, but emptying a <select> resets
      // its value — so rebuilding on each tick silently threw away whatever the
      // user had selected a moment earlier. The list only changes when the
      // backend's does.
      const signature = sourcePresets.map((preset) => `${preset.id}:${preset.label}`).join("|");
      if (this.presetOptionsSignature === signature) {
        return;
      }

      select.innerHTML = "";
      sourcePresets.forEach((preset) => {
        const option = this.documentRef.createElement("option");
        option.value = preset.id;
        option.textContent = preset.label;
        select.appendChild(option);
      });

      const customOption = this.documentRef.createElement("option");
      customOption.value = "custom";
      customOption.textContent = "Custom coordinates";
      select.appendChild(customOption);

      this.presetOptionsSignature = signature;
      // The page owns the observer, so the rebuilt list re-selects what the page
      // says it is looking at — never whichever option happens to come first.
      select.value = this.location.id;
    }

    _populateConstellationFilterOptions(objects = null) {
      const select = this.controls.constellationFilter;
      if (!select) {
        return;
      }

      const sourceObjects = Array.isArray(objects) ? objects : this._getAllVisibleObjects();
      const previousValue = this.state.filters.constellation;
      const options = buildConstellationFilterOptions(sourceObjects, {
        objectType: this.state.filters.objectType,
      });

      select.innerHTML = "";
      options.forEach((value) => {
        const option = this.documentRef.createElement("option");
        option.value = value;
        option.textContent = value === "all" ? "All constellations / regions" : value;
        select.appendChild(option);
      });

      const nextValue = options.includes(previousValue) ? previousValue : "all";
      this.state.filters.constellation = nextValue;
      select.value = nextValue;
    }

    _bindEvents() {
      this.controls.labelsToggle?.addEventListener("change", () => {
        this.state.showLabels = this.controls.labelsToggle.checked === true;
        this.render();
      });

      this.controls.constellationsToggle?.addEventListener("change", () => {
        this.state.showConstellations = this.controls.constellationsToggle.checked === true;
        this.render();
      });

      this.controls.magnitudeRange?.addEventListener("input", () => {
        this.setMagnitudeLimit(this.controls.magnitudeRange.value, { quiet: true, skipControl: true });
      });

      this.controls.objectTypeFilter?.addEventListener("change", () => {
        this.state.filters.objectType = this.controls.objectTypeFilter.value;
        this._populateConstellationFilterOptions();
        this.render();
      });

      this.controls.constellationFilter?.addEventListener("change", () => {
        this.state.filters.constellation = this.controls.constellationFilter.value;
        this.render();
      });

      this.controls.searchInput?.addEventListener("input", () => {
        this.state.filters.searchQuery = this.controls.searchInput.value;
        this.render();
      });

      this.controls.clearFiltersBtn?.addEventListener("click", () => {
        this.state.filters = {
          objectType: "all",
          constellation: "all",
          searchQuery: "",
        };

        if (this.controls.objectTypeFilter) {
          this.controls.objectTypeFilter.value = "all";
        }
        if (this.controls.searchInput) {
          this.controls.searchInput.value = "";
        }

        this._populateConstellationFilterOptions();
        this.render();
      });

      this.controls.timeScaleRange?.addEventListener("input", () => {
        this.setTimeScale(timeScaleFromSliderPosition(this.controls.timeScaleRange.value), { skipControl: true });
      });

      this.controls.syncNowBtn?.addEventListener("click", () => {
        this.syncClockToNow();
      });

      this.controls.zoomInBtn?.addEventListener("click", () => {
        this.zoomBy(1.35);
      });

      this.controls.zoomOutBtn?.addEventListener("click", () => {
        this.zoomBy(1 / 1.35);
      });

      this.controls.resetViewBtn?.addEventListener("click", () => {
        this.resetView();
      });

      this.controls.presetSelect?.addEventListener("change", () => {
        const selectedPreset = findPresetById(this.controls.presetSelect.value);
        if (!selectedPreset) {
          // "Custom coordinates" is a real choice, not a no-op. It has to pin the
          // location id, otherwise the next snapshot reverse-matches the current
          // coordinates back to whichever preset sits on them and the dropdown
          // snaps to that preset a tick later.
          this._applyCoordinates(
            {
              id: "custom",
              label: "Custom coordinates",
              latitudeDeg: this.location.latitudeDeg,
              longitudeDeg: this.location.longitudeDeg,
              source: "manual",
            },
            { preserveLabel: true, updatePreset: true },
          );
          this._setStatus("Custom coordinates active. Adjust latitude and longitude manually.", "success");
          this._refreshSnapshot({ quiet: true });
          return;
        }

        this._applyCoordinates({ ...selectedPreset, source: "preset" }, { preserveLabel: true, updatePreset: true });
        this._setStatus(`Observing the sky above ${selectedPreset.label}.`, "success");
        this._refreshSnapshot({ quiet: true });
      });

      const coordinateHandler = () => {
        const latitudeDeg = clamp(toNumber(this.controls.latitudeInput?.value, this.location.latitudeDeg), -90, 90);
        const longitudeDeg = clamp(toNumber(this.controls.longitudeInput?.value, this.location.longitudeDeg), -180, 180);
        this._applyCoordinates(
          {
            id: "custom",
            label: "Custom coordinates",
            latitudeDeg,
            longitudeDeg,
            source: "manual",
          },
          { preserveLabel: false, updatePreset: true },
        );
        this._setStatus("Manual coordinates applied. The sky map is recalculating.", "success");
        this._refreshSnapshot({ quiet: true });
      };

      this.controls.latitudeInput?.addEventListener("change", coordinateHandler);
      this.controls.longitudeInput?.addEventListener("change", coordinateHandler);

      this.controls.geolocateBtn?.addEventListener("click", () => {
        this._useBrowserGeolocation();
      });

      this.controls.visibleList?.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-object-id]");
        if (!button) {
          return;
        }

        this.selectObject(button.getAttribute("data-object-id"));
      });

      this.controls.constellationList?.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-constellation-name]");
        if (!button) {
          return;
        }

        this.selectConstellation(button.getAttribute("data-constellation-name"));
      });

      this.controls.canvas?.addEventListener("click", (event) => {
        // A drag ends with a click too. Only the gesture that stayed put is a
        // selection.
        if (this.suppressNextClick) {
          this.suppressNextClick = false;
          return;
        }
        this._selectObjectFromCanvas(event);
      });

      this._bindDomeGestures();

      this.windowRef?.addEventListener("resize", () => {
        this._resizeCanvas();
        this.render();
      });

      this.windowRef?.addEventListener("beforeunload", () => {
        this._closeStream();
      });
    }

    /**
     * Drag to pan, wheel or pinch to zoom, and a keyboard path for all of it.
     * Pointer events cover mouse, touch and pen with one code path; the keyboard
     * and the toolbar buttons exist because a dome that only answers to a drag
     * is one some people cannot use and some suites cannot drive.
     */
    _bindDomeGestures() {
      const canvas = this.controls.canvas;
      if (!canvas || typeof canvas.addEventListener !== "function") {
        return;
      }

      const capture = (pointerId) => {
        if (typeof canvas.setPointerCapture !== "function") {
          return;
        }
        try {
          canvas.setPointerCapture(pointerId);
        } catch (error) {
          // Nothing to capture (synthetic pointer, or already released).
        }
      };

      canvas.addEventListener("pointerdown", (event) => {
        this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        capture(event.pointerId);

        if (this.pointers.size >= 2) {
          this.dragState = null;
          this.pinchState = this._readPinchGesture();
          return;
        }

        this.dragState = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          startPanX: this.viewport.panX,
          startPanY: this.viewport.panY,
          moved: false,
        };
      });

      canvas.addEventListener("pointermove", (event) => {
        if (!this.pointers.has(event.pointerId)) {
          return;
        }
        this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

        if (this.pinchState && this.pointers.size >= 2) {
          const pinch = this._readPinchGesture();
          if (!pinch || !(this.pinchState.distance > 0)) {
            return;
          }
          this.suppressNextClick = true;
          this.setViewport(
            {
              zoom: this.pinchState.zoom * (pinch.distance / this.pinchState.distance),
              panX: this.viewport.panX,
              panY: this.viewport.panY,
            },
            { anchor: pinch.center },
          );
          return;
        }

        const drag = this.dragState;
        if (!drag || drag.pointerId !== event.pointerId) {
          return;
        }

        const pixelsPerDomeUnit = this._pixelsPerDomeUnit();
        if (!(pixelsPerDomeUnit > 0)) {
          return;
        }

        const deltaX = event.clientX - drag.startX;
        const deltaY = event.clientY - drag.startY;
        if (!drag.moved && Math.hypot(deltaX, deltaY) < DRAG_CLICK_THRESHOLD_PX) {
          return;
        }

        drag.moved = true;
        this.suppressNextClick = true;
        // Dragging the sky right moves the aperture centre left.
        this.setViewport({
          zoom: this.viewport.zoom,
          panX: drag.startPanX - deltaX / pixelsPerDomeUnit,
          panY: drag.startPanY - deltaY / pixelsPerDomeUnit,
        });
      });

      const endPointer = (event) => {
        this.pointers.delete(event.pointerId);
        if (typeof canvas.releasePointerCapture === "function") {
          try {
            canvas.releasePointerCapture(event.pointerId);
          } catch (error) {
            // Already released.
          }
        }
        if (this.pointers.size < 2) {
          this.pinchState = null;
        }
        if (this.dragState?.pointerId === event.pointerId) {
          this.dragState = null;
        }
      };

      canvas.addEventListener("pointerup", endPointer);
      canvas.addEventListener("pointercancel", endPointer);
      canvas.addEventListener("pointerleave", endPointer);

      canvas.addEventListener(
        "wheel",
        (event) => {
          if (typeof event.preventDefault === "function") {
            event.preventDefault();
          }
          this.zoomBy(toNumber(event.deltaY, 0) < 0 ? 1.12 : 1 / 1.12, { anchor: { x: event.clientX, y: event.clientY } });
        },
        { passive: false },
      );

      canvas.addEventListener("keydown", (event) => {
        const step = event.shiftKey === true ? 0.2 : 0.05;
        const pan = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, -step],
          ArrowDown: [0, step],
        }[event.key];

        if (pan) {
          event.preventDefault?.();
          this.panBy(pan[0], pan[1]);
          return;
        }

        if (event.key === "+" || event.key === "=") {
          event.preventDefault?.();
          this.zoomBy(1.35);
          return;
        }

        if (event.key === "-" || event.key === "_") {
          event.preventDefault?.();
          this.zoomBy(1 / 1.35);
          return;
        }

        if (event.key === "0") {
          event.preventDefault?.();
          this.resetView();
          return;
        }

        if (event.key === "Escape") {
          event.preventDefault?.();
          this.selectConstellation(null);
        }
      });
    }

    _readPinchGesture() {
      const points = Array.from(this.pointers.values()).slice(0, 2);
      if (points.length < 2) {
        return null;
      }

      return {
        distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y),
        center: { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 },
        zoom: this.viewport.zoom,
      };
    }

    /** CSS pixels covered by one dome unit at the current zoom. */
    _pixelsPerDomeUnit(zoom = this.viewport.zoom) {
      return this.canvasMetrics.cssRadius * toNumber(zoom, 1);
    }

    _canvasOffsetFromCenter(clientPoint) {
      const rect = this.controls.canvas?.getBoundingClientRect?.() || {
        left: 0,
        top: 0,
        width: this.canvasMetrics.cssWidth,
        height: this.canvasMetrics.cssHeight,
      };

      return {
        x: toNumber(clientPoint?.x) - toNumber(rect.left) - toNumber(rect.width) / 2,
        y: toNumber(clientPoint?.y) - toNumber(rect.top) - toNumber(rect.height) / 2,
      };
    }

    _clientPointToDome(clientPoint, viewport = this.viewport) {
      const pixelsPerDomeUnit = this._pixelsPerDomeUnit(viewport.zoom);
      if (!(pixelsPerDomeUnit > 0)) {
        return null;
      }

      const offset = this._canvasOffsetFromCenter(clientPoint);
      return {
        x: toNumber(viewport.panX) + offset.x / pixelsPerDomeUnit,
        y: toNumber(viewport.panY) + offset.y / pixelsPerDomeUnit,
      };
    }

    /**
     * The one place the viewport changes. Everything else — drag, wheel, pinch,
     * keyboard, buttons, query params — routes through here, so the clamping
     * rules and the state mirror can never disagree with what is drawn.
     */
    setViewport(nextViewport, options = {}) {
      const previous = this.viewport;
      const clamped = clampViewport(nextViewport);

      // Zooming about a point keeps whatever sits under that point where it is.
      if (options.anchor) {
        const anchorDome = this._clientPointToDome(options.anchor, previous);
        const pixelsPerDomeUnit = this._pixelsPerDomeUnit(clamped.zoom);
        if (anchorDome && pixelsPerDomeUnit > 0) {
          const offset = this._canvasOffsetFromCenter(options.anchor);
          const rebased = clampViewport({
            zoom: clamped.zoom,
            panX: anchorDome.x - offset.x / pixelsPerDomeUnit,
            panY: anchorDome.y - offset.y / pixelsPerDomeUnit,
          });
          clamped.panX = rebased.panX;
          clamped.panY = rebased.panY;
        }
      }

      this.viewport = clamped;
      this.forceMirrorUpdate = true;
      this.render();
      return this.viewport;
    }

    zoomBy(factor, options = {}) {
      return this.setViewport({ ...this.viewport, zoom: this.viewport.zoom * toNumber(factor, 1) }, options);
    }

    panBy(deltaDomeX, deltaDomeY) {
      return this.setViewport({
        zoom: this.viewport.zoom,
        panX: this.viewport.panX + toNumber(deltaDomeX),
        panY: this.viewport.panY + toNumber(deltaDomeY),
      });
    }

    resetView() {
      return this.setViewport({ zoom: MIN_ZOOM, panX: 0, panY: 0 });
    }

    /** The state mirror, as a plain object. The DOM attributes are this, stringified. */
    getViewportState() {
      const center = unprojectDomeToAltAz(this.viewport.panX, this.viewport.panY);
      const inViewCount = this.visibleObjects.filter((object) => object.inView).length;

      return {
        zoom: this.viewport.zoom,
        panX: this.viewport.panX,
        panY: this.viewport.panY,
        center: {
          domeX: this.viewport.panX,
          domeY: this.viewport.panY,
          altitudeDeg: roundTo(center.altitudeDeg, 2),
          azimuthDeg: roundTo(center.azimuthDeg, 2),
        },
        magnitudeLimit: roundTo(this.state.magnitudeLimit, 2),
        timeScale: this.clock.timeScale,
        animate: this.animate,
        timestamp: this.getCurrentSimulationDate().toISOString(),
        observer: { ...this.location },
        canvas: {
          width: this.canvasMetrics.cssWidth,
          height: this.canvasMetrics.cssHeight,
          radius: roundTo(this.canvasMetrics.cssRadius, 2),
        },
        selectedObjectId: this.state.selectedObjectId,
        selectedConstellation: this.state.selectedConstellation,
        domeObjectCount: this.visibleObjects.length,
        inViewCount,
        skyObjectCount: this._getAllVisibleObjects().length,
        constellationCount: this.constellationFigures.length,
      };
    }

    _startLoop() {
      if (!this.windowRef || typeof this.windowRef.requestAnimationFrame !== "function") {
        return;
      }

      if (this.animationFrameId != null) {
        this.windowRef.cancelAnimationFrame(this.animationFrameId);
      }

      this.animationFrameId = this.windowRef.requestAnimationFrame(this.handleAnimationFrame);
    }

    handleAnimationFrame(frameMs) {
      if (this.clock.lastFrameMs == null) {
        this.clock.lastFrameMs = frameMs;
      }

      const deltaMs = frameMs - this.clock.lastFrameMs;
      this.clock.lastFrameMs = frameMs;
      this.clock.simulatedTimeMs += deltaMs * this.clock.timeScale;

      // Sky data no longer needs to be re-polled here — the observatory backend
      // pushes fresh snapshots over the live stream (see _openStream). This loop
      // only advances the cosmetic clock badge and redraws the canvas.
      if (frameMs - this.lastDrawAt >= 150) {
        this.render();
        this.lastDrawAt = frameMs;
      }

      this.animationFrameId = this.windowRef.requestAnimationFrame(this.handleAnimationFrame);
    }

    getCurrentSimulationDate() {
      return new Date(this.clock.simulatedTimeMs);
    }

    syncClockToNow(options = {}) {
      const pinned = options.timestamp instanceof Date && !Number.isNaN(options.timestamp.getTime());
      this.clock.simulatedTimeMs = pinned ? options.timestamp.getTime() : this.nowProvider().getTime();
      this.clock.lastFrameMs = null;
      this._updateLiveBadge();
      if (options.quiet !== true) {
        this._setStatus("Simulation clock synchronized with the real sky.", "success");
      }
      this._refreshSnapshot({ quiet: options.quiet === true });
    }

    setTimeScale(nextScale, options = {}) {
      this.clock.timeScale = clamp(Math.round(toNumber(nextScale, 1)), 0, MAX_TIME_SCALE);
      this.clock.lastFrameMs = null;

      if (this.controls.timeScaleRange && options.skipControl !== true) {
        this.controls.timeScaleRange.value = String(sliderPositionFromTimeScale(this.clock.timeScale));
      }

      this._updateLiveBadge();
      if (options.quiet !== true) {
        this._setStatus(
          this.clock.timeScale === 0
            ? "Time flow paused. The sky freezes in place."
            : this.clock.timeScale === 1
              ? "Real-time mode restored."
              : `Time flow accelerated to ×${this.clock.timeScale}.`,
          "success",
        );
      }
      this._refreshSnapshot({ quiet: true });
      this.render();
      return this.clock.timeScale;
    }

    setMagnitudeLimit(nextLimit, options = {}) {
      this.state.magnitudeLimit = clamp(toNumber(nextLimit, DEFAULT_MAGNITUDE_LIMIT), 1, 6);

      if (this.controls.magnitudeRange && options.skipControl !== true) {
        this.controls.magnitudeRange.value = String(this.state.magnitudeLimit);
      }

      this._updateMagnitudeBadge();
      this._refreshSnapshot({ quiet: options.quiet !== false });
      return this.state.magnitudeLimit;
    }

    _refreshSnapshot(options = {}) {
      if (!this.ready) {
        return;
      }
      this._openStream(options);
    }

    _updateMagnitudeBadge() {
      if (this.controls.magnitudeValue) {
        this.controls.magnitudeValue.textContent = this.state.magnitudeLimit.toFixed(1);
      }
    }

    _updateLiveBadge() {
      if (this.controls.timeScaleValue) {
        this.controls.timeScaleValue.textContent = formatTimeScaleLabel(this.clock.timeScale);
      }

      if (!this.controls.liveBadge) {
        return;
      }

      this.controls.liveBadge.textContent = !this.animate
        ? "Frozen"
        : this.clock.timeScale === 0
          ? "Paused"
          : `Live ×${this.clock.timeScale}`;
    }

    _applyCoordinates(nextLocation, options = {}) {
      this.location = {
        id: nextLocation.id || "custom",
        label: options.preserveLabel === true ? nextLocation.label : nextLocation.label || "Custom coordinates",
        latitudeDeg: clamp(toNumber(nextLocation.latitudeDeg, this.location.latitudeDeg), -90, 90),
        longitudeDeg: clamp(toNumber(nextLocation.longitudeDeg, this.location.longitudeDeg), -180, 180),
        source: nextLocation.source || "manual",
      };

      if (this.controls.latitudeInput) {
        this.controls.latitudeInput.value = this.location.latitudeDeg.toFixed(4);
      }
      if (this.controls.longitudeInput) {
        this.controls.longitudeInput.value = this.location.longitudeDeg.toFixed(4);
      }
      if (this.controls.presetSelect && options.updatePreset === true) {
        this.controls.presetSelect.value = this.location.id;
      }
      if (this.controls.locationSummary) {
        this.controls.locationSummary.textContent = `${this.location.label}: ${formatSignedAngle(this.location.latitudeDeg, "N", "S")} • ${formatSignedAngle(this.location.longitudeDeg, "E", "W")}.`;
      }
    }

    _useBrowserGeolocation() {
      const navigatorRef = this.windowRef?.navigator;
      if (!navigatorRef?.geolocation || typeof navigatorRef.geolocation.getCurrentPosition !== "function") {
        this._setStatus("Browser geolocation is unavailable here, so the observatory stays on manual coordinates.", "error");
        return;
      }

      if (this.controls.geolocateBtn) {
        this.controls.geolocateBtn.disabled = true;
      }

      this._setStatus("Requesting browser geolocation…", "success");
      navigatorRef.geolocation.getCurrentPosition(
        (position) => {
          this._applyCoordinates(
            {
              id: "custom",
              label: "Current location",
              latitudeDeg: position.coords.latitude,
              longitudeDeg: position.coords.longitude,
              source: "geolocation",
            },
            { preserveLabel: true, updatePreset: true },
          );
          this._setStatus("Geolocation acquired. Rendering your local sky.", "success");
          if (this.controls.geolocateBtn) {
            this.controls.geolocateBtn.disabled = false;
          }
          this._refreshSnapshot({ quiet: true });
        },
        () => {
          this._setStatus("Geolocation request failed or was denied. Manual coordinates still work just fine.", "error");
          if (this.controls.geolocateBtn) {
            this.controls.geolocateBtn.disabled = false;
          }
        },
        {
          enableHighAccuracy: false,
          maximumAge: 120000,
          timeout: 10000,
        },
      );
    }

    _buildStreamParams() {
      const params = new URLSearchParams({
        latitude: this.location.latitudeDeg.toFixed(4),
        longitude: this.location.longitudeDeg.toFixed(4),
        magnitudeLimit: this.state.magnitudeLimit.toFixed(1),
        timestamp: this.getCurrentSimulationDate().toISOString(),
        timeScale: String(this.clock.timeScale),
      });

      // `custom` is sent too, and deliberately: it tells the backend not to
      // relabel these coordinates as whichever preset happens to sit on them.
      if (this.location.id) {
        params.set("presetId", this.location.id);
      }

      return params;
    }

    _closeStream() {
      if (this.eventSource) {
        this.eventSource.close();
        this.eventSource = null;
      }
    }

    // Opens (or reopens) the live sky stream. The sky no longer needs to be
    // re-fetched on a client-side timer: the server owns the simulated clock for
    // this connection and pushes a `snapshot` event as it advances, honouring the
    // requested `timeScale`. Any setting that affects what the stream should show
    // (location, magnitude limit, time scale/sync) closes the old connection and
    // opens a fresh one with updated query params, exactly like changing a
    // subscription.
    _openStream(options = {}) {
      this._closeStream();

      if (typeof EventSource === "undefined") {
        this._setStatus("Live sky streaming is unavailable in this browser.", "error");
        return;
      }

      const params = this._buildStreamParams();

      if (options.quiet !== true) {
        this._setStatus("Pulling fresh sky data from the observatory backend…", "success");
      }

      let source;
      try {
        source = new EventSource(`${API_ROOT}/stream?${params.toString()}`);
      } catch (error) {
        this._setStatus("Failed to open the live sky stream.", "error");
        return;
      }
      this.eventSource = source;

      let announced = false;
      source.addEventListener("snapshot", (event) => {
        let data;
        try {
          data = JSON.parse(event.data);
        } catch (error) {
          return;
        }

        this.applySnapshot(data);

        if (!announced) {
          announced = true;
          if (options.quiet !== true) {
            this._setStatus(data?.page?.subtitle || "Observatory snapshot refreshed.", "success");
          }
        }
      });

      source.addEventListener("error", () => {
        if (source.readyState === 2) {
          this._setStatus("Live sky stream disconnected. Adjust a setting to reconnect.", "error");
        }
        // Otherwise EventSource retries the connection automatically.
      });
    }

    _getAllVisibleObjects(snapshot = this.state.snapshot) {
      return Array.isArray(snapshot?.sky?.visibleObjects) ? snapshot.sky.visibleObjects : [];
    }

    _getRenderableObjects(snapshot = this.state.snapshot) {
      return filterVisibleObjects(this._getAllVisibleObjects(snapshot), this.state.filters);
    }

    _getObjectMap(snapshot = this.state.snapshot) {
      const objectMap = new Map();
      this._getRenderableObjects(snapshot).forEach((object) => objectMap.set(object.id, object));
      if (snapshot?.sky?.moon && matchesObjectFilters(snapshot.sky.moon, this.state.filters)) {
        objectMap.set(snapshot.sky.moon.id, snapshot.sky.moon);
      }
      return objectMap;
    }

    applySnapshot(snapshot) {
      if (!snapshot) {
        return;
      }

      this.state.snapshot = snapshot;
      this.visibleObjects = this._getRenderableObjects(snapshot);
      this._populatePresetOptions(snapshot.presets);
      this._populateConstellationFilterOptions(this._getAllVisibleObjects(snapshot));
      this._adoptObserverFromSnapshot(snapshot?.observer);

      const objectMap = this._getObjectMap(snapshot);
      if (!objectMap.has(this.state.selectedObjectId)) {
        this.state.selectedObjectId = snapshot?.sky?.featuredObjectId || snapshot?.sky?.moon?.id || this.visibleObjects[0]?.id || null;
      }

      this.render();
    }

    /**
     * The page owns the observer. A snapshot may relabel the spot the user
     * picked; it may never move it.
     *
     * Adopting the echoed observer wholesale is what used to drag the location
     * control back to the default: the page clamps coordinates before it sends
     * them, so the backend can only ever echo what it was asked for — which
     * means an observer that names a *different* spot is a stale answer from the
     * connection that has just been replaced, and following it is always wrong.
     */
    _adoptObserverFromSnapshot(observer) {
      if (!observer) {
        return;
      }

      const answersTheCurrentSpot =
        Math.abs(toNumber(observer.latitudeDeg, NaN) - this.location.latitudeDeg) < 1e-4 &&
        Math.abs(toNumber(observer.longitudeDeg, NaN) - this.location.longitudeDeg) < 1e-4;
      if (!answersTheCurrentSpot) {
        return;
      }

      // Same spot, so there is nothing to move — only the backend's name for it
      // is worth taking, and not when the page has pinned custom coordinates.
      if (this.location.id === "custom" || !observer.label || observer.label === this.location.label) {
        return;
      }

      this._applyCoordinates(
        { ...this.location, id: observer.id || this.location.id, label: observer.label },
        { preserveLabel: true, updatePreset: true },
      );
    }

    _resizeCanvas() {
      const canvas = this.controls.canvas;
      if (!canvas) {
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const dpr = this.windowRef?.devicePixelRatio || 1;
      // Geometry is decided in CSS pixels and then scaled, so the numbers the
      // state mirror reports are the numbers GET /observatory/viewport answers
      // for the same width/height — no device-pixel-ratio in the contract.
      const cssMetrics = computeCanvasMetrics(rect.width || DEFAULT_CANVAS_SIZE_PX, rect.height || rect.width || DEFAULT_CANVAS_SIZE_PX);

      canvas.width = Math.round(cssMetrics.width * dpr);
      canvas.height = Math.round(cssMetrics.height * dpr);

      this.canvasMetrics = {
        width: canvas.width,
        height: canvas.height,
        centerX: canvas.width / 2,
        centerY: canvas.height / 2,
        radius: cssMetrics.radius * dpr,
        dpr,
        cssWidth: cssMetrics.width,
        cssHeight: cssMetrics.height,
        cssRadius: cssMetrics.radius,
      };
    }

    _setStatus(message, tone = "idle") {
      if (!this.controls.status) {
        return;
      }

      this.controls.status.textContent = message;
      this.controls.status.dataset.tone = tone;
    }

    _canvasPointFromEvent(event) {
      const canvas = this.controls.canvas;
      if (!canvas) {
        return null;
      }

      const rect = canvas.getBoundingClientRect();
      if (!(rect.width > 0) || !(rect.height > 0)) {
        return null;
      }

      return {
        x: (toNumber(event?.clientX) - toNumber(rect.left)) * (canvas.width / rect.width),
        y: (toNumber(event?.clientY) - toNumber(rect.top)) * (canvas.height / rect.height),
      };
    }

    /**
     * A click on the dome means one of two things. A star, planet or the Moon
     * wins if the click landed on one; otherwise the click is offered to the
     * constellation figures, so the lines between the stars are a target too.
     */
    _selectObjectFromCanvas(event) {
      const point = this._canvasPointFromEvent(event);
      if (!point) {
        return;
      }

      const object = this._findObjectAtPoint(point.x, point.y);
      if (object) {
        this.selectObject(object.id);
        return;
      }

      const figure = this._findConstellationAtPoint(point.x, point.y);
      if (figure) {
        this.selectConstellation(figure.name);
      }
    }

    _findObjectAtPoint(pointX, pointY) {
      const threshold = 18 * this.canvasMetrics.dpr;
      let bestObject = null;
      let bestDistance = Number.POSITIVE_INFINITY;

      this.visibleObjects.forEach((object) => {
        // Only what the aperture is actually showing can be clicked; a panned-off
        // object still has coordinates, but they are behind the rim.
        if (object.inView !== true) {
          return;
        }

        const distance = Math.hypot(object.canvasX - pointX, object.canvasY - pointY);
        if (distance <= threshold && distance < bestDistance) {
          bestDistance = distance;
          bestObject = object;
        }
      });

      return bestObject;
    }

    /**
     * Nearest figure whose drawn line (or name) passes within a few pixels of
     * the click. Hidden constellations are not clickable — if the lines are not
     * on screen, there is nothing there to have hit.
     */
    _findConstellationAtPoint(pointX, pointY) {
      if (this.state.showConstellations !== true) {
        return null;
      }

      const threshold = 12 * this.canvasMetrics.dpr;
      let bestFigure = null;
      let bestDistance = Number.POSITIVE_INFINITY;

      this.constellationFigures.forEach((figure) => {
        const box = figure.labelBox;
        if (box && pointX >= box.left && pointX <= box.right && pointY >= box.top && pointY <= box.bottom) {
          bestFigure = figure;
          bestDistance = -1;
          return;
        }

        if (bestDistance < 0) {
          return;
        }

        figure.segments.forEach(([from, to]) => {
          if (from.inView !== true && to.inView !== true) {
            return;
          }

          const distance = distanceToSegment(pointX, pointY, from.canvasX, from.canvasY, to.canvasX, to.canvasY);
          if (distance <= threshold && distance < bestDistance) {
            bestDistance = distance;
            bestFigure = figure;
          }
        });
      });

      return bestFigure;
    }

    selectObject(objectId) {
      const object = this._getObjectMap().get(objectId) || this.visibleObjects.find((candidate) => candidate.id === objectId) || null;
      this.state.selectedObjectId = objectId;

      // Selecting a star lights up the figure it belongs to: clicking a star in
      // Orion's belt and having Orion stay dark reads as a bug, not a nuance.
      if (object?.type === "star" && this.constellationFigures.some((figure) => figure.name === object.constellation)) {
        this.state.selectedConstellation = object.constellation;
      }

      if (object) {
        this._setStatus(`Locked on ${object.name}.`, "success");
      }
      this.forceMirrorUpdate = true;
      this.render();
      return this.state.selectedObjectId;
    }

    /** Selecting the figure that is already selected clears the highlight. */
    selectConstellation(name, options = {}) {
      const requested = typeof name === "string" && name.trim() ? name : null;
      const toggledOff = options.toggle !== false && requested !== null && requested === this.state.selectedConstellation;
      this.state.selectedConstellation = toggledOff ? null : requested;

      if (this.state.selectedConstellation) {
        this._setStatus(`Highlighting ${this.state.selectedConstellation}.`, "success");
      }
      this.forceMirrorUpdate = true;
      this.render();
      return this.state.selectedConstellation;
    }

    render() {
      if (!this.controls.canvas) {
        return;
      }

      this._updateMagnitudeBadge();
      this._updateLiveBadge();

      const currentDate = this.getCurrentSimulationDate();
      const snapshot = this.state.snapshot;
      const deviceMetrics = {
        centerX: this.canvasMetrics.centerX,
        centerY: this.canvasMetrics.centerY,
        radius: this.canvasMetrics.radius,
      };
      const cssMetrics = {
        centerX: this.canvasMetrics.cssWidth / 2,
        centerY: this.canvasMetrics.cssHeight / 2,
        radius: this.canvasMetrics.cssRadius,
      };

      const projectedObjects = this._getRenderableObjects(snapshot).map((object, index) => {
        const dome = projectAltAzToDome(object.altitudeDeg, object.azimuthDeg);
        const devicePoint = projectDomeToCanvas(dome, this.viewport, deviceMetrics);
        const cssPoint = projectDomeToCanvas(dome, this.viewport, cssMetrics);

        return {
          ...object,
          domeX: dome.x,
          domeY: dome.y,
          canvasX: devicePoint.x,
          canvasY: devicePoint.y,
          // CSS-pixel coordinates are what the state mirror publishes, because
          // they are what the viewport endpoint can be asked to confirm.
          cssX: cssPoint.x,
          cssY: cssPoint.y,
          inView: isInsideAperture(cssPoint, cssMetrics),
          distance: Math.hypot(devicePoint.x - deviceMetrics.centerX, devicePoint.y - deviceMetrics.centerY),
          renderRadius: computeObjectRenderRadius(object),
          twinklePhase: index * 0.73,
        };
      });

      this.visibleObjects = projectedObjects;
      const segments = snapshot?.sky?.constellations || [];
      this.constellationFigures = buildConstellationFigures(projectedObjects, segments);
      // A figure whose stars have set (or been filtered away) cannot stay
      // selected — the highlight would name something that is no longer drawn.
      if (
        this.state.selectedConstellation &&
        !this.constellationFigures.some((figure) => figure.name === this.state.selectedConstellation)
      ) {
        this.state.selectedConstellation = null;
      }

      const objectMap = this._getObjectMap(snapshot);
      const selectedObject = objectMap.get(this.state.selectedObjectId) || snapshot?.sky?.moon || projectedObjects[0] || null;
      const totalVisibleObjects = this._getAllVisibleObjects(snapshot).length;

      this._drawSky(currentDate, projectedObjects, selectedObject, segments);
      this._renderSelectedObject(selectedObject);
      this._renderVisibleObjects(projectedObjects, selectedObject, totalVisibleObjects);
      this._renderConstellations();
      this._renderTimeBadge(currentDate);
      this._renderHint(selectedObject, projectedObjects.length, totalVisibleObjects);
      this._renderViewportState(projectedObjects, selectedObject);
    }

    /**
     * The canvas, answered without pixels. Scalars land as `data-*` on the dome
     * host; every plotted object gets a node in a visually hidden mirror list
     * carrying its alt/az, dome coordinates, canvas position and whether the
     * aperture is currently showing it.
     */
    _renderViewportState(objects, selectedObject) {
      const host = this.controls.canvasHost;
      const state = this.getViewportState();

      if (host?.setAttribute) {
        const attributes = {
          "data-zoom": state.zoom.toFixed(2),
          "data-pan-x": state.panX.toFixed(4),
          "data-pan-y": state.panY.toFixed(4),
          "data-center-altitude": state.center.altitudeDeg.toFixed(2),
          "data-center-azimuth": state.center.azimuthDeg.toFixed(2),
          "data-magnitude-limit": state.magnitudeLimit.toFixed(1),
          "data-time-scale": String(state.timeScale),
          "data-animate": state.animate ? "1" : "0",
          "data-timestamp": state.timestamp,
          "data-observer-id": String(state.observer.id || ""),
          "data-observer-latitude": toNumber(state.observer.latitudeDeg).toFixed(4),
          "data-observer-longitude": toNumber(state.observer.longitudeDeg).toFixed(4),
          "data-canvas-width": String(state.canvas.width),
          "data-canvas-height": String(state.canvas.height),
          "data-canvas-radius": String(state.canvas.radius),
          "data-dome-count": String(state.domeObjectCount),
          "data-in-view-count": String(state.inViewCount),
          "data-sky-count": String(state.skyObjectCount),
          "data-constellation-count": String(state.constellationCount),
          "data-selected-object": String(state.selectedObjectId || ""),
          "data-selected-constellation": String(state.selectedConstellation || ""),
        };

        Object.entries(attributes).forEach(([name, value]) => {
          if (host.getAttribute(name) !== value) {
            host.setAttribute(name, value);
          }
        });
      }

      if (this.controls.viewportReadout) {
        this.controls.viewportReadout.textContent =
          `Zoom ×${state.zoom.toFixed(2)} • centre ${state.center.altitudeDeg.toFixed(1)}° alt / ` +
          `${state.center.azimuthDeg.toFixed(1)}° az • ${state.inViewCount} of ${state.domeObjectCount} in view`;
      }

      this._renderDomeMirror(objects, selectedObject);
    }

    _renderDomeMirror(objects, selectedObject) {
      const mirror = this.controls.domeMirror;
      if (!mirror) {
        return;
      }

      // A frozen dome mirrors on every render; a live one at 4 Hz, which is far
      // more often than any assertion needs and cheap enough not to matter.
      const now = this.animate && typeof this.windowRef?.performance?.now === "function" ? this.windowRef.performance.now() : null;
      if (!this.forceMirrorUpdate && now != null && now - this.lastMirrorAt < MIRROR_REFRESH_MS) {
        return;
      }
      this.forceMirrorUpdate = false;
      if (now != null) {
        this.lastMirrorAt = now;
      }

      const seen = new Set();
      objects.forEach((object) => {
        seen.add(object.id);
        let node = this.mirrorNodes.get(object.id);
        if (!node) {
          node = this.documentRef.createElement("li");
          node.setAttribute("data-testid", "dome-object");
          node.textContent = object.name;
          this.mirrorNodes.set(object.id, node);
          mirror.appendChild(node);
        }

        const attributes = {
          "data-object-id": String(object.id),
          "data-object-name": String(object.name),
          "data-object-type": String(object.type),
          "data-magnitude": toNumber(object.magnitude).toFixed(2),
          "data-constellation": String(object.constellation || ""),
          "data-altitude": toNumber(object.altitudeDeg).toFixed(2),
          "data-azimuth": toNumber(object.azimuthDeg).toFixed(2),
          "data-dome-x": toNumber(object.domeX).toFixed(4),
          "data-dome-y": toNumber(object.domeY).toFixed(4),
          "data-canvas-x": toNumber(object.cssX).toFixed(2),
          "data-canvas-y": toNumber(object.cssY).toFixed(2),
          "data-in-view": object.inView === true ? "true" : "false",
          "data-selected": selectedObject?.id === object.id ? "true" : "false",
        };

        Object.entries(attributes).forEach(([name, value]) => {
          if (node.getAttribute(name) !== value) {
            node.setAttribute(name, value);
          }
        });
      });

      this.mirrorNodes.forEach((node, id) => {
        if (seen.has(id)) {
          return;
        }
        node.remove();
        this.mirrorNodes.delete(id);
      });
    }

    _renderTimeBadge(currentDate) {
      if (this.controls.timeBadge) {
        // A frozen dome reports an ISO instant: a locale string is one more
        // thing that differs between a laptop and CI.
        this.controls.timeBadge.textContent = this.animate ? currentDate.toLocaleString() : currentDate.toISOString();
      }
    }

    _renderHint(selectedObject, visibleCount, totalVisibleCount = visibleCount) {
      if (!this.controls.hint) {
        return;
      }

      if (!selectedObject) {
        this.controls.hint.textContent =
          visibleCount > 0
            ? "Sky objects are visible above the horizon. Click any plotted body to inspect it."
            : totalVisibleCount > 0
              ? "No visible objects match the current frontend filters. Broaden the search or switch object filters to reveal more of the sky."
              : "No objects match the current brightness filter. Lower the threshold to reveal more of the sky.";
        return;
      }

      if (selectedObject.type === "moon" && selectedObject.visible !== true) {
        this.controls.hint.textContent = `The Moon is currently ${Math.abs(selectedObject.altitudeDeg).toFixed(1)}° below the ${describeSkyRegion(selectedObject.azimuthDeg)} horizon.`;
        return;
      }

      if (selectedObject.type === "planet") {
        this.controls.hint.textContent = `${selectedObject.name} is ${selectedObject.altitudeDeg.toFixed(1)}° above the ${describeSkyRegion(selectedObject.azimuthDeg)} horizon in ${selectedObject.constellation}.`;
        return;
      }

      this.controls.hint.textContent = `${selectedObject.name} is ${selectedObject.altitudeDeg.toFixed(1)}° above the ${describeSkyRegion(selectedObject.azimuthDeg)} horizon${selectedObject.type === "moon" ? "" : ` in ${selectedObject.constellation}`}.`;
    }

    _renderSelectedObject(object) {
      if (!this.controls.objectName || !this.controls.objectBadge || !this.controls.objectSummary || !this.controls.objectMeta) {
        return;
      }

      if (!object) {
        this.controls.objectName.textContent = "No object selected";
        this.controls.objectBadge.textContent = "Awaiting target";
        this.controls.objectSummary.textContent = "Pick any plotted object to inspect its altitude, azimuth, and brightness details.";
        this.controls.objectMeta.innerHTML = "";
        return;
      }

      this.controls.objectName.textContent = object.name;
      this.controls.objectBadge.textContent =
        object.type === "moon"
          ? `${object.phaseLabel} • ${object.illuminationPct.toFixed(1)}% lit`
          : object.type === "planet"
            ? `Planet • Mag ${object.magnitude.toFixed(2)} • ${object.constellation}`
            : `Mag ${object.magnitude.toFixed(2)} • ${object.constellation}`;
      this.controls.objectSummary.textContent =
        object.type === "moon"
          ? object.visible
            ? `The Moon is ${object.altitudeDeg.toFixed(1)}° above the ${describeSkyRegion(object.azimuthDeg)} horizon in a ${object.phaseLabel.toLowerCase()} phase.`
            : `The Moon is ${Math.abs(object.altitudeDeg).toFixed(1)}° below the ${describeSkyRegion(object.azimuthDeg)} horizon right now.`
          : object.type === "planet"
            ? `${object.name} is currently ${object.altitudeDeg.toFixed(1)}° above the ${describeSkyRegion(object.azimuthDeg)} horizon along the ecliptic in ${object.constellation}.`
            : `${object.name} is currently ${object.altitudeDeg.toFixed(1)}° above the ${describeSkyRegion(object.azimuthDeg)} horizon and rotating in real time with the rest of the sky.`;

      const items =
        object.type === "moon"
          ? [
              ["Altitude", `${object.altitudeDeg.toFixed(1)}°`],
              ["Azimuth", formatAzimuth(object.azimuthDeg)],
              ["Phase", object.phaseLabel],
              ["Illumination", `${object.illuminationPct.toFixed(1)}%`],
              ["Distance", formatDistanceEarthRadii(object.distanceEarthRadii)],
              ["Right ascension", formatRightAscension(object.raHours)],
            ]
          : object.type === "planet"
            ? [
                ["Altitude", `${object.altitudeDeg.toFixed(1)}°`],
                ["Azimuth", formatAzimuth(object.azimuthDeg)],
                ["Right ascension", formatRightAscension(object.raHours)],
                ["Declination", formatSignedAngle(object.decDeg, "N", "S")],
                ["Magnitude", object.magnitude.toFixed(2)],
                ["Region", object.constellation],
                ["Distance", `${object.distanceAu.toFixed(3)} AU`],
              ]
            : [
                ["Altitude", `${object.altitudeDeg.toFixed(1)}°`],
                ["Azimuth", formatAzimuth(object.azimuthDeg)],
                ["Right ascension", formatRightAscension(object.raHours)],
                ["Declination", formatSignedAngle(object.decDeg, "N", "S")],
                ["Magnitude", object.magnitude.toFixed(2)],
                ["Constellation", object.constellation],
              ];

      this.controls.objectMeta.innerHTML = "";
      items.forEach(([term, description]) => {
        const wrapper = this.documentRef.createElement("div");
        const dt = this.documentRef.createElement("dt");
        const dd = this.documentRef.createElement("dd");
        dt.textContent = term;
        dd.textContent = description;
        wrapper.appendChild(dt);
        wrapper.appendChild(dd);
        this.controls.objectMeta.appendChild(wrapper);
      });
    }

    /**
     * The figures, as a list. Clicking a constellation on the canvas needs pixel
     * coordinates; this is the same selection reachable by name, by keyboard and
     * by an ordinary locator — and it carries each figure's canvas geometry, so
     * it doubles as the state mirror for constellations.
     */
    _renderConstellations() {
      const list = this.controls.constellationList;
      if (!list) {
        return;
      }

      const figures = this.constellationFigures.slice().sort((left, right) => left.name.localeCompare(right.name));
      const selected = this.state.selectedConstellation;
      const dpr = this.canvasMetrics.dpr || 1;

      if (this.controls.constellationCount) {
        const inView = figures.filter((figure) => figure.inViewCount > 0).length;
        this.controls.constellationCount.textContent = `${inView} of ${figures.length} in view`;
      }

      if (this.controls.constellationSummary) {
        const figure = figures.find((candidate) => candidate.name === selected);
        this.controls.constellationSummary.textContent = figure
          ? `${figure.name}: ${pluralize(figure.starCount, "star")} joined by ${pluralize(figure.segmentCount, "line")},` +
            ` brightest ${figure.brightestStar?.name || "unknown"} at magnitude ${toNumber(figure.brightestStar?.magnitude).toFixed(2)}.` +
            " Select it again to clear the highlight."
          : "Click a constellation line or its name on the dome — or pick one here — to highlight the figure.";
      }

      list.innerHTML = "";
      if (figures.length === 0) {
        const empty = this.documentRef.createElement("li");
        empty.className = "observatory-visible-item";
        empty.textContent = "No complete constellation figures are above the horizon right now.";
        list.appendChild(empty);
        return;
      }

      figures.forEach((figure) => {
        const item = this.documentRef.createElement("li");
        item.className = `observatory-visible-item ${selected === figure.name ? "is-active" : ""}`.trim();

        const button = this.documentRef.createElement("button");
        button.type = "button";
        button.setAttribute("data-testid", "constellation-row");
        button.setAttribute("data-constellation-name", figure.name);
        button.setAttribute("data-star-count", String(figure.starCount));
        button.setAttribute("data-segment-count", String(figure.segmentCount));
        button.setAttribute("data-in-view-count", String(figure.inViewCount));
        // CSS pixels, so these compare directly with what
        // GET /api/v1/observatory/viewport reports for the same figure.
        button.setAttribute("data-center-x", (figure.centerX / dpr).toFixed(2));
        button.setAttribute("data-center-y", (figure.centerY / dpr).toFixed(2));
        button.setAttribute("data-selected", selected === figure.name ? "true" : "false");
        button.setAttribute("aria-pressed", selected === figure.name ? "true" : "false");

        const top = this.documentRef.createElement("div");
        top.className = "observatory-visible-item__top";

        const titleWrap = this.documentRef.createElement("div");
        const title = this.documentRef.createElement("h3");
        title.className = "observatory-visible-item__title";
        title.textContent = figure.name;

        const meta = this.documentRef.createElement("p");
        meta.className = "observatory-visible-item__meta";
        meta.textContent =
          `${pluralize(figure.starCount, "star")} • ${pluralize(figure.segmentCount, "line")}` +
          ` • brightest ${figure.brightestStar?.name || "unknown"}`;

        titleWrap.appendChild(title);
        titleWrap.appendChild(meta);

        const chip = this.documentRef.createElement("span");
        chip.className = "observatory-visible-item__chip";
        chip.textContent = figure.inViewCount === figure.starCount ? "In view" : `${figure.inViewCount}/${figure.starCount} in view`;

        top.appendChild(titleWrap);
        top.appendChild(chip);
        button.appendChild(top);
        item.appendChild(button);
        list.appendChild(item);
      });
    }

    _renderVisibleObjects(objects, selectedObject, totalVisibleCount = objects.length) {
      if (!this.controls.visibleList || !this.controls.visibleCount) {
        return;
      }

      this.controls.visibleCount.textContent = `${objects.length} shown • ${totalVisibleCount} visible`;
      this.controls.visibleList.innerHTML = "";

      if (objects.length === 0) {
        const item = this.documentRef.createElement("li");
        item.className = "observatory-visible-item";
        item.textContent =
          totalVisibleCount > 0 ? "Nothing matches the current frontend filters." : "Nothing visible at the current brightness threshold.";
        this.controls.visibleList.appendChild(item);
        return;
      }

      objects.slice(0, 18).forEach((object) => {
        const item = this.documentRef.createElement("li");
        item.className = `observatory-visible-item ${selectedObject?.id === object.id ? "is-active" : ""}`.trim();

        const button = this.documentRef.createElement("button");
        button.type = "button";
        button.setAttribute("data-object-id", object.id);

        const top = this.documentRef.createElement("div");
        top.className = "observatory-visible-item__top";

        const titleWrap = this.documentRef.createElement("div");
        const title = this.documentRef.createElement("h3");
        title.className = "observatory-visible-item__title";
        title.textContent = object.name;

        const meta = this.documentRef.createElement("p");
        meta.className = "observatory-visible-item__meta";
        meta.textContent =
          object.type === "moon"
            ? `${object.phaseLabel} • Alt ${object.altitudeDeg.toFixed(1)}° • Az ${formatAzimuth(object.azimuthDeg)}`
            : object.type === "planet"
              ? `Planet • Alt ${object.altitudeDeg.toFixed(1)}° • Az ${formatAzimuth(object.azimuthDeg)}`
              : `${object.constellation} • Alt ${object.altitudeDeg.toFixed(1)}° • Az ${formatAzimuth(object.azimuthDeg)}`;

        titleWrap.appendChild(title);
        titleWrap.appendChild(meta);

        const chip = this.documentRef.createElement("span");
        chip.className = "observatory-visible-item__chip";
        chip.textContent =
          object.type === "moon"
            ? `${object.illuminationPct.toFixed(0)}% lit`
            : object.type === "planet"
              ? `Planet • Mag ${object.magnitude.toFixed(2)}`
              : `Mag ${object.magnitude.toFixed(2)}`;

        const summary = this.documentRef.createElement("p");
        summary.className = "observatory-visible-item__summary";
        summary.textContent =
          object.type === "moon"
            ? `The Moon hangs in the ${describeSkyRegion(object.azimuthDeg)} sky as a ${object.phaseLabel.toLowerCase()}.`
            : object.type === "planet"
              ? `${object.name} cruises through the ${describeSkyRegion(object.azimuthDeg)} sky as a bright planet.`
              : `${object.name} glows in the ${describeSkyRegion(object.azimuthDeg)} sky.`;

        top.appendChild(titleWrap);
        top.appendChild(chip);
        button.appendChild(top);
        button.appendChild(summary);
        item.appendChild(button);
        this.controls.visibleList.appendChild(item);
      });
    }

    _drawSky(currentDate, objects, selectedObject, constellations) {
      const canvas = this.controls.canvas;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return;
      }

      const { width, height, centerX, centerY, radius, dpr } = this.canvasMetrics;
      // Where the dome's own centre — the zenith — has moved to, and how big the
      // dome is now. Everything the sky owns (grid, horizon, cardinals) hangs off
      // these; only the aperture itself stays pinned to the canvas.
      const domeOrigin = projectDomeToCanvas({ x: 0, y: 0 }, this.viewport, { centerX, centerY, radius });
      const domeRadius = radius * this.viewport.zoom;
      ctx.clearRect(0, 0, width, height);

      const background = ctx.createRadialGradient(centerX, centerY, radius * 0.2, centerX, centerY, radius * 1.15);
      background.addColorStop(0, "rgba(13, 19, 38, 0.98)");
      background.addColorStop(0.65, "rgba(4, 8, 20, 1)");
      background.addColorStop(1, "rgba(1, 3, 8, 1)");
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.clip();

      const glow = ctx.createRadialGradient(centerX, centerY, radius * 0.05, centerX, centerY, radius);
      glow.addColorStop(0, "rgba(136, 167, 255, 0.08)");
      glow.addColorStop(0.45, "rgba(68, 108, 212, 0.05)");
      glow.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);

      this._drawSkyGrid(ctx, domeOrigin, domeRadius, dpr);
      if (this.state.showConstellations) {
        this._drawConstellationLines(ctx, objects, constellations, dpr);
      }
      this._drawObjects(ctx, objects, selectedObject, currentDate, dpr);
      if (this.state.showConstellations) {
        this._drawConstellationLabels(ctx, dpr);
      } else {
        // No lines on screen means no label boxes to have clicked.
        this.constellationFigures.forEach((figure) => {
          figure.labelBox = null;
        });
      }
      this._drawLabels(ctx, objects, selectedObject, dpr);
      // The zenith marker belongs to the sky, so it travels with it.
      ctx.beginPath();
      ctx.arc(domeOrigin.x, domeOrigin.y, Math.max(1.2 * dpr, radius * 0.004), 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.78)";
      ctx.fill();
      ctx.restore();

      // The aperture, by contrast, is a property of the canvas and stays put.
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.lineWidth = 2 * dpr;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
      ctx.stroke();

      this._drawCardinals(ctx, domeOrigin, domeRadius, dpr);
    }

    _drawSkyGrid(ctx, domeOrigin, domeRadius, dpr) {
      ctx.save();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
      ctx.lineWidth = 1 * dpr;

      // The horizon ring is only drawn as a line of its own once the view can
      // actually be somewhere other than centred on it.
      [0, 30, 60].forEach((altitude) => {
        ctx.beginPath();
        ctx.arc(domeOrigin.x, domeOrigin.y, domeRadius * ((90 - altitude) / 90), 0, Math.PI * 2);
        ctx.stroke();
      });

      [0, 45, 90, 135].forEach((azimuth) => {
        const angle = degreesToRadians(azimuth);
        const dx = Math.sin(angle) * domeRadius;
        const dy = -Math.cos(angle) * domeRadius;
        ctx.beginPath();
        ctx.moveTo(domeOrigin.x - dx, domeOrigin.y - dy);
        ctx.lineTo(domeOrigin.x + dx, domeOrigin.y + dy);
        ctx.stroke();
      });

      ctx.restore();
    }

    /**
     * Cardinal points sit on the horizon of the dome, not on the rim of the
     * canvas — pan the sky east and "E" has to travel with it, or the dome is
     * lying about which way the observer is facing.
     */
    _drawCardinals(ctx, domeOrigin, domeRadius, dpr) {
      const labels = [
        ["N", 0],
        ["E", 90],
        ["S", 180],
        ["W", 270],
      ];
      const { width, height } = this.canvasMetrics;

      ctx.save();
      ctx.font = `${12 * dpr}px Inter, Arial, sans-serif`;
      ctx.fillStyle = "rgba(237, 242, 255, 0.74)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      labels.forEach(([label, azimuth]) => {
        const angle = degreesToRadians(azimuth);
        const x = domeOrigin.x + Math.sin(angle) * (domeRadius + 20 * dpr);
        const y = domeOrigin.y - Math.cos(angle) * (domeRadius + 20 * dpr);
        if (x < 0 || y < 0 || x > width || y > height) {
          return;
        }
        ctx.fillText(label, x, y);
      });

      ctx.restore();
    }

    _drawConstellationLines(ctx, objects, constellations, dpr) {
      const starMap = new Map(objects.filter((object) => object.type === "star").map((object) => [object.id, object]));
      const selected = this.state.selectedConstellation;
      ctx.save();

      (constellations || []).forEach((segment) => {
        const from = starMap.get(segment.fromId || segment[0]);
        const to = starMap.get(segment.toId || segment[1]);
        if (!from || !to) {
          return;
        }

        const highlighted = selected !== null && from.constellation === selected && to.constellation === selected;
        ctx.strokeStyle = highlighted ? "rgba(255, 210, 124, 0.85)" : "rgba(136, 167, 255, 0.22)";
        ctx.lineWidth = (highlighted ? 2.2 : 1.1) * dpr;
        ctx.beginPath();
        ctx.moveTo(from.canvasX, from.canvasY);
        ctx.lineTo(to.canvasX, to.canvasY);
        ctx.stroke();
      });

      ctx.restore();
    }

    /**
     * Draws each figure's name and records the box it occupies, because the name
     * is a click target too — and on a canvas the only way to know where a piece
     * of text ended up is to remember where you put it.
     */
    _drawConstellationLabels(ctx, dpr) {
      ctx.save();
      ctx.font = `${12 * dpr}px Inter, Arial, sans-serif`;
      ctx.strokeStyle = "rgba(3, 8, 20, 0.88)";
      ctx.lineWidth = 3 * dpr;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      this.constellationFigures.forEach((figure) => {
        const highlighted = figure.name === this.state.selectedConstellation;
        const x = clamp(figure.labelX, 44 * dpr, this.canvasMetrics.width - 44 * dpr);
        const y = clamp(figure.labelY, 18 * dpr, this.canvasMetrics.height - 18 * dpr);
        const halfWidth = Math.max(ctx.measureText(figure.name).width, 24 * dpr) / 2 + 4 * dpr;
        const halfHeight = 9 * dpr;

        ctx.fillStyle = highlighted ? "rgba(255, 210, 124, 0.95)" : "rgba(173, 196, 255, 0.74)";
        ctx.strokeText(figure.name, x, y);
        ctx.fillText(figure.name, x, y);

        figure.labelBox = { left: x - halfWidth, right: x + halfWidth, top: y - halfHeight, bottom: y + halfHeight };
      });

      ctx.restore();
    }

    _drawObjects(ctx, objects, selectedObject, currentDate, dpr) {
      const timeFactor = currentDate.getTime() / 1000;
      objects.forEach((object) => {
        // Twinkle is the last per-frame motion on the dome, so a frozen render
        // drops it entirely rather than sampling it at some arbitrary instant.
        const twinkle =
          !this.animate || object.type === "moon"
            ? 1
            : object.type === "planet"
              ? 0.98 + (Math.sin(timeFactor * 0.35 + object.twinklePhase) + 1) * 0.02
              : 0.86 + (Math.sin(timeFactor * 2.1 + object.twinklePhase) + 1) * 0.12;
        const radius = object.renderRadius * twinkle * dpr;

        ctx.beginPath();
        ctx.arc(object.canvasX, object.canvasY, radius, 0, Math.PI * 2);
        ctx.fillStyle = object.color;
        ctx.shadowColor = object.color;
        ctx.shadowBlur = object.type === "moon" ? radius * 2.4 : radius * 4;
        ctx.fill();
        ctx.shadowBlur = 0;

        if (selectedObject?.id === object.id) {
          ctx.beginPath();
          ctx.arc(object.canvasX, object.canvasY, radius + 5 * dpr, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(255, 210, 124, 0.9)";
          ctx.lineWidth = 1.4 * dpr;
          ctx.stroke();
        }
      });
    }

    _drawLabels(ctx, objects, selectedObject, dpr) {
      if (!this.state.showLabels) {
        return;
      }

      ctx.save();
      ctx.font = `${11 * dpr}px Inter, Arial, sans-serif`;
      ctx.fillStyle = "rgba(237, 242, 255, 0.82)";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";

      objects.forEach((object) => {
        if (object.type === "star" && object.magnitude > 1.85 && selectedObject?.id !== object.id) {
          return;
        }

        if (object.type === "planet" && object.magnitude > 4.5 && selectedObject?.id !== object.id) {
          return;
        }

        ctx.fillText(object.name, object.canvasX + 8 * dpr, object.canvasY - 8 * dpr);
      });

      ctx.restore();
    }
  }

  if (typeof document !== "undefined") {
    const page = new ObservatoryPage();
    // Published so the dome can also be interrogated as an object
    // (`observatoryPage.getViewportState()`), not only through its DOM mirror.
    if (typeof window !== "undefined") {
      window.observatoryPage = page;
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => page.init());
    } else {
      page.init();
    }
  }

  return {
    LOCATION_PRESETS,
    STAR_CATALOG,
    PLANET_CATALOG,
    CONSTELLATION_SEGMENTS,
    MAX_TIME_SCALE,
    MAX_ZOOM,
    MIN_ZOOM,
    TIME_SCALE_SLIDER_MAX,
    ObservatoryPage,
    buildConstellationFigures,
    buildConstellationFilterOptions,
    clampViewport,
    distanceToSegment,
    computeCanvasMetrics,
    isInsideAperture,
    projectAltAzToDome,
    projectDomeToCanvas,
    sliderPositionFromTimeScale,
    timeScaleFromSliderPosition,
    unprojectDomeToAltAz,
    calculateJulianDate,
    calculateGreenwichSiderealTime,
    calculateLocalSiderealTime,
    calculatePlanetEquatorialPosition,
    equatorialToHorizontal,
    filterVisibleObjects,
    getConstellationLabels,
    getPlanetObjects,
    getVisibleStars,
    getVisiblePlanets,
    matchesObjectFilters,
    normalizeDegrees,
    normalizeHours,
    projectAltAzToCanvas,
  };
});
