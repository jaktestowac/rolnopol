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
  { id: "miaplacidus", name: "Miaplacidus", constellation: "Carina", raHours: 9.2201, decDeg: -69.7172, magnitude: 1.67, color: "#f5f7ff" },
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
  { id: "rasalhague", name: "Rasalhague", constellation: "Ophiuchus", raHours: 17.5822, decDeg: 12.56, magnitude: 2.08, color: "#e2efff" },
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
  { id: "yed-prior", name: "Yed Prior", constellation: "Ophiuchus", raHours: 16.2391, decDeg: -3.6943, magnitude: 2.75, color: "#ffcea9" },
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
  { id: "sadalmelik", name: "Sadalmelik", constellation: "Aquarius", raHours: 22.0964, decDeg: -0.3198, magnitude: 2.95, color: "#fff0cf" },
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
  { id: "rasalgethi", name: "Rasalgethi", constellation: "Hercules", raHours: 17.2441, decDeg: 14.3903, magnitude: 3.48, color: "#ffbe93" },
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
  { id: "delta-cygni", name: "Delta Cygni", constellation: "Cygnus", raHours: 19.7496, decDeg: 45.1308, magnitude: 2.87, color: "#eef5ff" },
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

const SYNODIC_MONTH_DAYS = 29.530588853;
const DEFAULT_MAGNITUDE_LIMIT = 4.2;
const DEFAULT_TIMESTAMP = () => new Date();

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

function equatorialToHorizontal(body, date, latitudeDeg, longitudeDeg) {
  const latitude = clamp(toNumber(latitudeDeg), -90, 90);
  const declination = clamp(toNumber(body?.decDeg), -90, 90);
  const rightAscension = normalizeHours(toNumber(body?.raHours));
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

function calculateMoonEquatorialPosition(date) {
  const daysSinceEpoch = calculateJulianDate(date) - 2451543.5;
  const ascendingNodeDeg = normalizeDegrees(125.1228 - 0.0529538083 * daysSinceEpoch);
  const inclinationDeg = 5.1454;
  const argumentOfPerigeeDeg = normalizeDegrees(318.0634 + 0.1643573223 * daysSinceEpoch);
  const semiMajorAxisEarthRadii = 60.2666;
  const eccentricity = 0.0549;
  const meanAnomalyDeg = normalizeDegrees(115.3654 + 13.0649929509 * daysSinceEpoch);
  const eccentricAnomalyDeg = solveKeplerEquationDegrees(meanAnomalyDeg, eccentricity);
  const eccentricAnomalyRad = degreesToRadians(eccentricAnomalyDeg);

  const orbitalX = semiMajorAxisEarthRadii * (Math.cos(eccentricAnomalyRad) - eccentricity);
  const orbitalY = semiMajorAxisEarthRadii * Math.sqrt(1 - eccentricity * eccentricity) * Math.sin(eccentricAnomalyRad);

  const trueAnomalyDeg = radiansToDegrees(Math.atan2(orbitalY, orbitalX));
  const distanceEarthRadii = Math.sqrt(orbitalX * orbitalX + orbitalY * orbitalY);
  const argumentLatitudeDeg = normalizeDegrees(trueAnomalyDeg + argumentOfPerigeeDeg);

  const ascendingNodeRad = degreesToRadians(ascendingNodeDeg);
  const inclinationRad = degreesToRadians(inclinationDeg);
  const argumentLatitudeRad = degreesToRadians(argumentLatitudeDeg);

  const eclipticX =
    distanceEarthRadii *
    (Math.cos(ascendingNodeRad) * Math.cos(argumentLatitudeRad) -
      Math.sin(ascendingNodeRad) * Math.sin(argumentLatitudeRad) * Math.cos(inclinationRad));
  const eclipticY =
    distanceEarthRadii *
    (Math.sin(ascendingNodeRad) * Math.cos(argumentLatitudeRad) +
      Math.cos(ascendingNodeRad) * Math.sin(argumentLatitudeRad) * Math.cos(inclinationRad));
  const eclipticZ = distanceEarthRadii * Math.sin(argumentLatitudeRad) * Math.sin(inclinationRad);

  const eclipticLongitudeDeg = normalizeDegrees(radiansToDegrees(Math.atan2(eclipticY, eclipticX)));
  const eclipticLatitudeDeg = radiansToDegrees(Math.atan2(eclipticZ, Math.sqrt(eclipticX * eclipticX + eclipticY * eclipticY)));
  const obliquityDeg = 23.4393 - 0.0000003563 * daysSinceEpoch;
  const obliquityRad = degreesToRadians(obliquityDeg);

  const equatorialX = eclipticX;
  const equatorialY = eclipticY * Math.cos(obliquityRad) - eclipticZ * Math.sin(obliquityRad);
  const equatorialZ = eclipticY * Math.sin(obliquityRad) + eclipticZ * Math.cos(obliquityRad);

  const rightAscensionHours = normalizeHours(radiansToDegrees(Math.atan2(equatorialY, equatorialX)) / 15);
  const declinationDeg = radiansToDegrees(Math.atan2(equatorialZ, Math.sqrt(equatorialX * equatorialX + equatorialY * equatorialY)));

  return {
    raHours: rightAscensionHours,
    decDeg: declinationDeg,
    eclipticLongitudeDeg,
    eclipticLatitudeDeg,
    distanceEarthRadii,
  };
}

function getMoonPhaseInfo(date) {
  const moon = calculateMoonEquatorialPosition(date);
  const sun = calculateSunEclipticLongitude(date);
  const phaseAngleDeg = normalizeDegrees(moon.eclipticLongitudeDeg - sun.longitudeDeg);
  const phaseAngleRad = degreesToRadians(phaseAngleDeg);
  const illuminationFraction = (1 - Math.cos(phaseAngleRad)) / 2;
  const ageDays = (phaseAngleDeg / 360) * SYNODIC_MONTH_DAYS;

  let phaseLabel = "New Moon";
  if (ageDays >= 1.84566 && ageDays < 5.53699) phaseLabel = "Waxing Crescent";
  else if (ageDays < 9.22831) phaseLabel = "First Quarter";
  else if (ageDays < 12.91963) phaseLabel = "Waxing Gibbous";
  else if (ageDays < 16.61096) phaseLabel = "Full Moon";
  else if (ageDays < 20.30228) phaseLabel = "Waning Gibbous";
  else if (ageDays < 23.99361) phaseLabel = "Last Quarter";
  else if (ageDays < 27.68493) phaseLabel = "Waning Crescent";

  return {
    ...moon,
    phaseAngleDeg,
    illuminationFraction,
    illuminationPct: Number((illuminationFraction * 100).toFixed(1)),
    ageDays: Number(ageDays.toFixed(2)),
    phaseLabel,
  };
}

function computeMoonMagnitude(illuminationFraction) {
  return Number((-12.7 + (1 - illuminationFraction) * 3.4).toFixed(2));
}

function findPresetById(id) {
  return LOCATION_PRESETS.find((preset) => preset.id === id) || null;
}

function findPresetByCoordinates(latitudeDeg, longitudeDeg) {
  return (
    LOCATION_PRESETS.find(
      (preset) => Math.abs(preset.latitudeDeg - latitudeDeg) < 0.0001 && Math.abs(preset.longitudeDeg - longitudeDeg) < 0.0001,
    ) || null
  );
}

function resolveObserver(options = {}) {
  const preset = findPresetById(String(options.presetId || "").trim());
  const fallback = preset || findPresetById("warsaw");
  const latitudeDeg = clamp(toNumber(options.latitudeDeg, fallback.latitudeDeg), -90, 90);
  const longitudeDeg = clamp(toNumber(options.longitudeDeg, fallback.longitudeDeg), -180, 180);
  const matchedPreset = preset || findPresetByCoordinates(latitudeDeg, longitudeDeg);

  return {
    id: matchedPreset?.id || "custom",
    label: matchedPreset?.label || "Custom coordinates",
    latitudeDeg,
    longitudeDeg,
  };
}

function createStarObject(star, date, observer) {
  const horizontal = equatorialToHorizontal(star, date, observer.latitudeDeg, observer.longitudeDeg);
  return {
    ...star,
    type: "star",
    visible: horizontal.altitudeDeg > 0,
    ...horizontal,
  };
}

function createPlanetObject(planet, date, observer) {
  const equatorial = calculatePlanetEquatorialPosition(planet, date);
  const horizontal = equatorialToHorizontal(equatorial, date, observer.latitudeDeg, observer.longitudeDeg);

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
}

function getPlanetObjects({ date, observer } = {}) {
  return PLANET_CATALOG.map((planet) => createPlanetObject(planet, date, observer));
}

function getVisiblePlanets({ date, observer, magnitudeLimit = DEFAULT_MAGNITUDE_LIMIT } = {}) {
  return getPlanetObjects({ date, observer })
    .filter((planet) => planet.visible && planet.magnitude <= magnitudeLimit)
    .sort((left, right) => left.magnitude - right.magnitude || right.altitudeDeg - left.altitudeDeg || left.name.localeCompare(right.name));
}

function createMoonObject(date, observer) {
  const moonPhase = getMoonPhaseInfo(date);
  const horizontal = equatorialToHorizontal(moonPhase, date, observer.latitudeDeg, observer.longitudeDeg);
  const visible = horizontal.altitudeDeg > 0;

  return {
    id: "moon",
    name: "Moon",
    type: "moon",
    constellation: "Lunar orbit",
    color: "#f6f2d1",
    strokeColor: "#fff7cf",
    visible,
    raHours: moonPhase.raHours,
    decDeg: moonPhase.decDeg,
    magnitude: computeMoonMagnitude(moonPhase.illuminationFraction),
    altitudeDeg: horizontal.altitudeDeg,
    azimuthDeg: horizontal.azimuthDeg,
    localSiderealTimeHours: horizontal.localSiderealTimeHours,
    hourAngleHours: horizontal.hourAngleHours,
    phaseLabel: moonPhase.phaseLabel,
    illuminationPct: moonPhase.illuminationPct,
    ageDays: moonPhase.ageDays,
    distanceEarthRadii: Number(moonPhase.distanceEarthRadii.toFixed(2)),
    eclipticLongitudeDeg: Number(moonPhase.eclipticLongitudeDeg.toFixed(2)),
    eclipticLatitudeDeg: Number(moonPhase.eclipticLatitudeDeg.toFixed(2)),
  };
}

function getVisibleObjects({ date, observer, magnitudeLimit = DEFAULT_MAGNITUDE_LIMIT } = {}) {
  const starObjects = STAR_CATALOG.map((star) => createStarObject(star, date, observer))
    .filter((star) => star.visible && star.magnitude <= magnitudeLimit)
    .sort((left, right) => left.magnitude - right.magnitude || right.altitudeDeg - left.altitudeDeg || left.name.localeCompare(right.name));
  const planetObjects = getVisiblePlanets({
    date,
    observer,
    magnitudeLimit,
  });

  const moon = createMoonObject(date, observer);
  const visibleSkyObjects = [...planetObjects, ...starObjects].sort(
    (left, right) => left.magnitude - right.magnitude || right.altitudeDeg - left.altitudeDeg || left.name.localeCompare(right.name),
  );
  const visibleObjects = moon.visible ? [moon, ...visibleSkyObjects] : visibleSkyObjects;

  return {
    moon,
    planets: getPlanetObjects({ date, observer }),
    visibleObjects,
  };
}

function parseTimestamp(value) {
  if (!value) {
    return DEFAULT_TIMESTAMP();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    const error = new Error("Invalid observatory timestamp");
    error.statusCode = 400;
    throw error;
  }

  return parsed;
}

function getSnapshot(options = {}) {
  const timestamp = parseTimestamp(options.timestamp);
  const magnitudeLimit = clamp(toNumber(options.magnitudeLimit, DEFAULT_MAGNITUDE_LIMIT), 1, 6);
  const observer = resolveObserver({
    presetId: options.presetId,
    latitudeDeg: options.latitudeDeg,
    longitudeDeg: options.longitudeDeg,
  });
  const sky = getVisibleObjects({
    date: timestamp,
    observer,
    magnitudeLimit,
  });

  return {
    page: {
      title: "Operator Observatory",
      subtitle: "Live sky data sourced from the backend observatory endpoint.",
      pageUrl: "/operator/observatory.html",
    },
    observer,
    presets: LOCATION_PRESETS.map((preset) => ({ ...preset })),
    simulation: {
      requestedTimestamp: timestamp.toISOString(),
      serverTimestamp: new Date().toISOString(),
    },
    sky: {
      magnitudeLimit,
      moon: sky.moon,
      planets: sky.planets,
      planetCount: sky.planets.filter((planet) => planet.visible && planet.magnitude <= magnitudeLimit).length,
      visibleObjects: sky.visibleObjects,
      visibleCount: sky.visibleObjects.length,
      featuredObjectId: "moon",
      constellations: CONSTELLATION_SEGMENTS.map(([fromId, toId]) => ({ fromId, toId })),
    },
  };
}

module.exports = {
  LOCATION_PRESETS,
  STAR_CATALOG,
  PLANET_CATALOG,
  CONSTELLATION_SEGMENTS,
  calculateJulianDate,
  calculateGreenwichSiderealTime,
  calculateLocalSiderealTime,
  calculatePlanetEquatorialPosition,
  equatorialToHorizontal,
  getMoonPhaseInfo,
  getPlanetObjects,
  getVisibleObjects,
  getVisiblePlanets,
  getSnapshot,
  normalizeDegrees,
  normalizeHours,
};
