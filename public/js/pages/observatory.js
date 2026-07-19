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
    ["antares", "shaula"],
    ["shaula", "lesath"],
    ["antares", "sargas"],
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
    ["dschubba", "antares"],
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
    ["sadalmelik", "skaat"],
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

  function projectAltAzToCanvas(altitudeDeg, azimuthDeg, radius) {
    const altitude = clamp(toNumber(altitudeDeg), -90, 90);
    const azimuth = normalizeDegrees(azimuthDeg);
    const horizonDistance = clamp((90 - altitude) / 90, 0, 1.2) * toNumber(radius, 0);
    const azimuthRad = degreesToRadians(azimuth);

    return {
      x: Math.sin(azimuthRad) * horizonDistance,
      y: -Math.cos(azimuthRad) * horizonDistance,
      distance: horizonDistance,
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

  function getConstellationLabels(objects, constellations) {
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
    const labelGroups = new Map();

    (constellations || []).forEach((segment) => {
      const from = starMap.get(segment?.fromId || segment?.[0]);
      const to = starMap.get(segment?.toId || segment?.[1]);
      if (!from || !to || from.constellation !== to.constellation) {
        return;
      }

      const groupKey = from.constellation;
      let group = labelGroups.get(groupKey);
      if (!group) {
        group = {
          name: groupKey,
          stars: new Map(),
        };
        labelGroups.set(groupKey, group);
      }

      group.stars.set(from.id, from);
      group.stars.set(to.id, to);
    });

    return Array.from(labelGroups.values())
      .map((group) => {
        const stars = Array.from(group.stars.values());
        const averageX = stars.reduce((sum, star) => sum + star.canvasX, 0) / stars.length;
        const averageY = stars.reduce((sum, star) => sum + star.canvasY, 0) / stars.length;
        const topY = stars.reduce((minY, star) => Math.min(minY, star.canvasY), Number.POSITIVE_INFINITY);

        return {
          name: group.name,
          x: Number(averageX.toFixed(2)),
          y: Number(Math.min(averageY - 14, topY - 10).toFixed(2)),
          starCount: stars.length,
        };
      })
      .filter((label) => label.starCount >= 2)
      .sort((left, right) => left.y - right.y || left.name.localeCompare(right.name));
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
        snapshot: null,
      };
      this.clock = {
        timeScale: 1,
        simulatedTimeMs: Date.now(),
        lastFrameMs: null,
      };
      this.controls = {};
      this.canvasMetrics = {
        width: 0,
        height: 0,
        centerX: 0,
        centerY: 0,
        radius: 0,
        dpr: 1,
      };
      this.visibleObjects = [];
      this.animationFrameId = null;
      this.lastDrawAt = 0;
      this.eventSource = null;
      this.handleAnimationFrame = this.handleAnimationFrame.bind(this);
    }

    init() {
      this._cacheDom();
      if (!this.controls.canvas || !this.documentRef) {
        return;
      }

      this._populatePresetOptions();
      this._bindEvents();
      this._applyCoordinates(this.location, { preserveLabel: true, updatePreset: true });
      this.syncClockToNow({ quiet: true });
      this._resizeCanvas();
      this._refreshSnapshot({ quiet: true });
      this._startLoop();
      this.render();
    }

    _cacheDom() {
      const doc = this.documentRef;
      this.controls = {
        shell: doc.getElementById("observatoryShell"),
        status: doc.getElementById("observatoryStatus"),
        timeBadge: doc.getElementById("observatoryTimeBadge"),
        liveBadge: doc.getElementById("observatoryLiveBadge"),
        canvas: doc.getElementById("observatoryCanvas"),
        hint: doc.getElementById("observatoryHint"),
        labelsToggle: doc.getElementById("observatoryLabelsToggle"),
        constellationsToggle: doc.getElementById("observatoryConstellationsToggle"),
        magnitudeRange: doc.getElementById("observatoryMagnitudeRange"),
        magnitudeValue: doc.getElementById("observatoryMagnitudeValue"),
        objectTypeFilter: doc.getElementById("observatoryObjectTypeFilter"),
        constellationFilter: doc.getElementById("observatoryConstellationFilter"),
        searchInput: doc.getElementById("observatorySearchInput"),
        clearFiltersBtn: doc.getElementById("observatoryClearFiltersBtn"),
        timeScaleSelect: doc.getElementById("observatoryTimeScaleSelect"),
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
        this.state.magnitudeLimit = toNumber(this.controls.magnitudeRange.value, 4.2);
        this._updateMagnitudeBadge();
        this._refreshSnapshot({ quiet: true });
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

      this.controls.timeScaleSelect?.addEventListener("change", () => {
        this.setTimeScale(toNumber(this.controls.timeScaleSelect.value, 1));
      });

      this.controls.syncNowBtn?.addEventListener("click", () => {
        this.syncClockToNow();
      });

      this.controls.presetSelect?.addEventListener("change", () => {
        const selectedPreset = findPresetById(this.controls.presetSelect.value);
        if (!selectedPreset) {
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

        this.state.selectedObjectId = button.getAttribute("data-object-id");
        this.render();
      });

      this.controls.canvas?.addEventListener("click", (event) => {
        this._selectObjectFromCanvas(event);
      });

      this.windowRef?.addEventListener("resize", () => {
        this._resizeCanvas();
        this.render();
      });

      this.windowRef?.addEventListener("beforeunload", () => {
        this._closeStream();
      });
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
      this.clock.simulatedTimeMs = this.nowProvider().getTime();
      this.clock.lastFrameMs = null;
      this._updateLiveBadge();
      if (options.quiet !== true) {
        this._setStatus("Simulation clock synchronized with the real sky.", "success");
      }
      this._refreshSnapshot({ quiet: options.quiet === true });
    }

    setTimeScale(nextScale) {
      this.clock.timeScale = Math.max(0, toNumber(nextScale, 1));
      this.clock.lastFrameMs = null;
      this._updateLiveBadge();
      this._setStatus(
        this.clock.timeScale === 0
          ? "Time flow paused. The sky freezes in place."
          : this.clock.timeScale === 1
            ? "Real-time mode restored."
            : `Time flow accelerated to ×${this.clock.timeScale}.`,
        "success",
      );
      this._refreshSnapshot({ quiet: true });
    }

    _refreshSnapshot(options = {}) {
      this._openStream(options);
    }

    _updateMagnitudeBadge() {
      if (this.controls.magnitudeValue) {
        this.controls.magnitudeValue.textContent = this.state.magnitudeLimit.toFixed(1);
      }
    }

    _updateLiveBadge() {
      if (!this.controls.liveBadge) {
        return;
      }

      this.controls.liveBadge.textContent = this.clock.timeScale === 0 ? "Paused" : `Live ×${this.clock.timeScale}`;
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

      if (this.location.id && this.location.id !== "custom") {
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
      if (snapshot?.observer) {
        this._applyCoordinates(snapshot.observer, { preserveLabel: true, updatePreset: true });
      }

      const objectMap = this._getObjectMap(snapshot);
      if (!objectMap.has(this.state.selectedObjectId)) {
        this.state.selectedObjectId = snapshot?.sky?.featuredObjectId || snapshot?.sky?.moon?.id || this.visibleObjects[0]?.id || null;
      }

      this.render();
    }

    _resizeCanvas() {
      const canvas = this.controls.canvas;
      if (!canvas) {
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const width = Math.max(320, Math.round(rect.width || 820));
      const height = Math.max(320, Math.round(rect.height || width));
      const dpr = this.windowRef?.devicePixelRatio || 1;

      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);

      this.canvasMetrics = {
        width: canvas.width,
        height: canvas.height,
        centerX: canvas.width / 2,
        centerY: canvas.height / 2,
        radius: Math.max(120, Math.min(canvas.width, canvas.height) / 2 - 42 * dpr),
        dpr,
      };
    }

    _setStatus(message, tone = "idle") {
      if (!this.controls.status) {
        return;
      }

      this.controls.status.textContent = message;
      this.controls.status.dataset.tone = tone;
    }

    _selectObjectFromCanvas(event) {
      if (!this.controls.canvas || this.visibleObjects.length === 0) {
        return;
      }

      const rect = this.controls.canvas.getBoundingClientRect();
      const scaleX = this.controls.canvas.width / rect.width;
      const scaleY = this.controls.canvas.height / rect.height;
      const pointX = (event.clientX - rect.left) * scaleX;
      const pointY = (event.clientY - rect.top) * scaleY;
      const threshold = 18 * this.canvasMetrics.dpr;

      let bestObject = null;
      let bestDistance = Number.POSITIVE_INFINITY;

      this.visibleObjects.forEach((object) => {
        const distance = Math.hypot(object.canvasX - pointX, object.canvasY - pointY);
        if (distance <= threshold && distance < bestDistance) {
          bestDistance = distance;
          bestObject = object;
        }
      });

      if (bestObject) {
        this.state.selectedObjectId = bestObject.id;
        this._setStatus(`Locked on ${bestObject.name}.`, "success");
        this.render();
      }
    }

    render() {
      if (!this.controls.canvas) {
        return;
      }

      this._updateMagnitudeBadge();
      this._updateLiveBadge();

      const currentDate = this.getCurrentSimulationDate();
      const snapshot = this.state.snapshot;
      const projectedObjects = this._getRenderableObjects(snapshot).map((object, index) => {
        const point = projectAltAzToCanvas(object.altitudeDeg, object.azimuthDeg, this.canvasMetrics.radius);
        return {
          ...object,
          canvasX: this.canvasMetrics.centerX + point.x,
          canvasY: this.canvasMetrics.centerY + point.y,
          distance: point.distance,
          renderRadius: computeObjectRenderRadius(object),
          twinklePhase: index * 0.73,
        };
      });

      this.visibleObjects = projectedObjects;
      const objectMap = this._getObjectMap(snapshot);
      const selectedObject = objectMap.get(this.state.selectedObjectId) || snapshot?.sky?.moon || projectedObjects[0] || null;
      const totalVisibleObjects = this._getAllVisibleObjects(snapshot).length;

      this._drawSky(currentDate, projectedObjects, selectedObject, snapshot?.sky?.constellations || []);
      this._renderSelectedObject(selectedObject);
      this._renderVisibleObjects(projectedObjects, selectedObject, totalVisibleObjects);
      this._renderTimeBadge(currentDate);
      this._renderHint(selectedObject, projectedObjects.length, totalVisibleObjects);
    }

    _renderTimeBadge(currentDate) {
      if (this.controls.timeBadge) {
        this.controls.timeBadge.textContent = currentDate.toLocaleString();
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

      this._drawSkyGrid(ctx, centerX, centerY, radius, dpr);
      if (this.state.showConstellations) {
        this._drawConstellationLines(ctx, objects, constellations, dpr);
      }
      this._drawObjects(ctx, objects, selectedObject, currentDate, dpr);
      if (this.state.showConstellations) {
        this._drawConstellationLabels(ctx, objects, constellations, dpr);
      }
      this._drawLabels(ctx, objects, selectedObject, dpr);
      ctx.restore();

      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.lineWidth = 2 * dpr;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(centerX, centerY, radius * 0.004, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.78)";
      ctx.fill();

      this._drawCardinals(ctx, centerX, centerY, radius, dpr);
    }

    _drawSkyGrid(ctx, centerX, centerY, radius, dpr) {
      ctx.save();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
      ctx.lineWidth = 1 * dpr;

      [30, 60].forEach((altitude) => {
        const gridRadius = radius * ((90 - altitude) / 90);
        ctx.beginPath();
        ctx.arc(centerX, centerY, gridRadius, 0, Math.PI * 2);
        ctx.stroke();
      });

      [0, 45, 90, 135].forEach((azimuth) => {
        const angle = degreesToRadians(azimuth);
        const dx = Math.sin(angle) * radius;
        const dy = -Math.cos(angle) * radius;
        ctx.beginPath();
        ctx.moveTo(centerX - dx, centerY - dy);
        ctx.lineTo(centerX + dx, centerY + dy);
        ctx.stroke();
      });

      ctx.restore();
    }

    _drawCardinals(ctx, centerX, centerY, radius, dpr) {
      const labels = [
        ["N", 0],
        ["E", 90],
        ["S", 180],
        ["W", 270],
      ];

      ctx.save();
      ctx.font = `${12 * dpr}px Inter, Arial, sans-serif`;
      ctx.fillStyle = "rgba(237, 242, 255, 0.74)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      labels.forEach(([label, azimuth]) => {
        const angle = degreesToRadians(azimuth);
        const x = centerX + Math.sin(angle) * (radius + 20 * dpr);
        const y = centerY - Math.cos(angle) * (radius + 20 * dpr);
        ctx.fillText(label, x, y);
      });

      ctx.restore();
    }

    _drawConstellationLines(ctx, objects, constellations, dpr) {
      const starMap = new Map(objects.filter((object) => object.type === "star").map((object) => [object.id, object]));
      ctx.save();
      ctx.strokeStyle = "rgba(136, 167, 255, 0.22)";
      ctx.lineWidth = 1.1 * dpr;

      (constellations || []).forEach((segment) => {
        const from = starMap.get(segment.fromId || segment[0]);
        const to = starMap.get(segment.toId || segment[1]);
        if (!from || !to) {
          return;
        }

        ctx.beginPath();
        ctx.moveTo(from.canvasX, from.canvasY);
        ctx.lineTo(to.canvasX, to.canvasY);
        ctx.stroke();
      });

      ctx.restore();
    }

    _drawConstellationLabels(ctx, objects, constellations, dpr) {
      const labels = getConstellationLabels(objects, constellations);
      if (labels.length === 0) {
        return;
      }

      ctx.save();
      ctx.font = `${12 * dpr}px Inter, Arial, sans-serif`;
      ctx.fillStyle = "rgba(173, 196, 255, 0.74)";
      ctx.strokeStyle = "rgba(3, 8, 20, 0.88)";
      ctx.lineWidth = 3 * dpr;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      labels.forEach((label) => {
        const x = clamp(label.x, 44 * dpr, this.canvasMetrics.width - 44 * dpr);
        const y = clamp(label.y, 18 * dpr, this.canvasMetrics.height - 18 * dpr);
        ctx.strokeText(label.name, x, y);
        ctx.fillText(label.name, x, y);
      });

      ctx.restore();
    }

    _drawObjects(ctx, objects, selectedObject, currentDate, dpr) {
      const timeFactor = currentDate.getTime() / 1000;
      objects.forEach((object) => {
        const twinkle =
          object.type === "moon"
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
    ObservatoryPage,
    buildConstellationFilterOptions,
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
