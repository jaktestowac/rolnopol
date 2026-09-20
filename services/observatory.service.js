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
  { id: "iota-cancri", name: "Iota Cancri", constellation: "Cancer", raHours: 8.7784, decDeg: 28.7599, magnitude: 4.02, color: "#fff0cf" },
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
  { id: "mothallah", name: "Mothallah", constellation: "Triangulum", raHours: 1.8846, decDeg: 29.5793, magnitude: 3.42, color: "#fff6e4" },
  {
    id: "gamma-trianguli",
    name: "Gamma Trianguli",
    constellation: "Triangulum",
    raHours: 2.2891,
    decDeg: 33.8473,
    magnitude: 4.03,
    color: "#eef5ff",
  },
  { id: "alpha-lyncis", name: "Alpha Lyncis", constellation: "Lynx", raHours: 9.3508, decDeg: 34.3925, magnitude: 3.14, color: "#ffbf94" },
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
  { id: "alpha-hydri", name: "Alpha Hydri", constellation: "Hydrus", raHours: 1.9799, decDeg: -61.5697, magnitude: 2.86, color: "#f4f7ff" },
  { id: "gamma-hydri", name: "Gamma Hydri", constellation: "Hydrus", raHours: 3.7876, decDeg: -74.2393, magnitude: 3.24, color: "#ffbf94" },
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
  { id: "beta-muscae", name: "Beta Muscae", constellation: "Musca", raHours: 12.7706, decDeg: -68.1082, magnitude: 3.05, color: "#d0e7ff" },
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
  { id: "nu-octantis", name: "Nu Octantis", constellation: "Octans", raHours: 21.691, decDeg: -77.3903, magnitude: 3.73, color: "#ffdcb0" },
  {
    id: "beta-octantis",
    name: "Beta Octantis",
    constellation: "Octans",
    raHours: 22.7669,
    decDeg: -81.3819,
    magnitude: 4.13,
    color: "#eef5ff",
  },
  { id: "alpha-mensae", name: "Alpha Mensae", constellation: "Mensa", raHours: 6.169, decDeg: -74.7531, magnitude: 5.09, color: "#fff6e4" },
  {
    id: "alpha-horologii",
    name: "Alpha Horologii",
    constellation: "Horologium",
    raHours: 4.2325,
    decDeg: -42.2942,
    magnitude: 3.85,
    color: "#ffdcb0",
  },
  { id: "alpha-caeli", name: "Alpha Caeli", constellation: "Caelum", raHours: 4.6761, decDeg: -41.8636, magnitude: 4.44, color: "#fff6e4" },
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
  { id: "alpha-scuti", name: "Alpha Scuti", constellation: "Scutum", raHours: 18.5865, decDeg: -8.2443, magnitude: 3.85, color: "#ffcfa2" },
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
  { id: "nu-eridani", name: "Nu Eridani", constellation: "Eridanus", raHours: 4.6035, decDeg: -3.3524, magnitude: 3.93, color: "#d0e7ff" },
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
  { id: "delta-hydrae", name: "Delta Hydrae", constellation: "Hydra", raHours: 8.6273, decDeg: 5.7038, magnitude: 4.14, color: "#eef5ff" },
  { id: "eta-hydrae", name: "Eta Hydrae", constellation: "Hydra", raHours: 8.7202, decDeg: 3.3993, magnitude: 4.3, color: "#d5e8ff" },
  { id: "sigma-hydrae", name: "Sigma Hydrae", constellation: "Hydra", raHours: 8.6446, decDeg: 3.3413, magnitude: 4.44, color: "#ffcfa2" },
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
  { id: "delta-gruis", name: "Delta Gruis", constellation: "Grus", raHours: 22.4874, decDeg: -43.4958, magnitude: 3.97, color: "#fff0cf" },
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
  { id: "kaffaljidhma", name: "Kaffaljidhma", constellation: "Cetus", raHours: 2.7217, decDeg: 3.2359, magnitude: 3.47, color: "#f4f7ff" },
  { id: "tau-ceti", name: "Tau Ceti", constellation: "Cetus", raHours: 1.7345, decDeg: -15.9375, magnitude: 3.5, color: "#fff6e4" },
  { id: "iota-ceti", name: "Iota Ceti", constellation: "Cetus", raHours: 0.3234, decDeg: -8.8235, magnitude: 3.56, color: "#ffcfa2" },
  { id: "theta-ceti", name: "Theta Ceti", constellation: "Cetus", raHours: 1.16, decDeg: -8.1836, magnitude: 3.6, color: "#ffcfa2" },
  { id: "baten-kaitos", name: "Baten Kaitos", constellation: "Cetus", raHours: 1.8574, decDeg: -10.335, magnitude: 3.73, color: "#ffdcb0" },
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
  { id: "pi-scorpii", name: "Pi Scorpii", constellation: "Scorpius", raHours: 15.981, decDeg: -26.114, magnitude: 2.89, color: "#d0e7ff" },
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

  // Fictional entries — Rolnopol's own sky, not real astronomy. Flagged
  // `fictional: true` so the rest of the catalog stays a truthful record.
  {
    id: "nullframe-7",
    name: "NULLFRAME-7",
    constellation: "Rolnopol",
    raHours: 7,
    decDeg: -7.7,
    magnitude: 4.9,
    color: "#ffb15c",
    fictional: true,
    lore: "Industrial memory held in light. Catalogued by NULLFRAME Heavy Industries; the period never repeats the same way twice.",
  },
  {
    id: "pluvia-rubra",
    name: "Pluvia Rubra",
    constellation: "Rolnopol",
    raHours: 7.07,
    decDeg: -7.07,
    magnitude: 5.3,
    color: "#c2453a",
    fictional: true,
    lore: "The red rain star. Weather stations logged it on the nights the ditch stayed warm.",
  },
  {
    id: "speculum-cinereum",
    name: "Speculum Cinereum",
    constellation: "Rolnopol",
    raHours: 6.93,
    decDeg: -8.14,
    magnitude: 5.6,
    color: "#b9bec7",
    fictional: true,
    lore: "The ash mirror. Every measurement taken of it arrives; none of them return.",
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

  // Rolnopol (fictional)
  ["nullframe-7", "pluvia-rubra"],
  ["pluvia-rubra", "speculum-cinereum"],
  ["speculum-cinereum", "nullframe-7"],
];

const SYNODIC_MONTH_DAYS = 29.530588853;
const DEFAULT_MAGNITUDE_LIMIT = 4.2;
const DEFAULT_TIMESTAMP = () => new Date();

// Sky-dome viewport geometry. These constants are mirrored verbatim in
// public/js/pages/observatory.js so the browser and this endpoint answer the
// same question the same way — that equality is the point of the endpoint.
const DOME_HORIZON_OVERSHOOT = 1.2;
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const MIN_CANVAS_SIZE_PX = 320;
const MAX_CANVAS_SIZE_PX = 4096;
const DEFAULT_CANVAS_SIZE_PX = 820;
const CANVAS_INSET_PX = 42;
const MIN_CANVAS_RADIUS_PX = 120;
const OBJECT_TYPE_FILTERS = ["all", "star", "planet", "moon", "solar-system"];

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(toNumber(value) * factor) / factor;
}

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

/**
 * Alt/az -> dome coordinates. The dome is a unit disc seen from above: the
 * zenith is the origin, the horizon is radius 1, and north is -y. Everything the
 * canvas draws is this projection scaled by the aperture radius, so dome units
 * are the resolution-independent language the viewport state speaks.
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
    // At the exact zenith there is no bearing; report north rather than the
    // atan2(0, -0) artefact.
    azimuthDeg: domeRadius === 0 ? 0 : normalizeDegrees(radiansToDegrees(Math.atan2(domeX, -domeY))),
  };
}

/**
 * Canvas geometry for a square-ish dome. Kept identical to the client's
 * _resizeCanvas so a caller can pass the page's CSS pixel size and get the same
 * numbers back.
 */
function resolveCanvasMetrics(width, height) {
  const canvasWidth = clamp(Math.round(toNumber(width, DEFAULT_CANVAS_SIZE_PX)), MIN_CANVAS_SIZE_PX, MAX_CANVAS_SIZE_PX);
  const canvasHeight = clamp(Math.round(toNumber(height, canvasWidth)), MIN_CANVAS_SIZE_PX, MAX_CANVAS_SIZE_PX);

  return {
    width: canvasWidth,
    height: canvasHeight,
    centerX: canvasWidth / 2,
    centerY: canvasHeight / 2,
    radius: Math.max(MIN_CANVAS_RADIUS_PX, Math.min(canvasWidth, canvasHeight) / 2 - CANVAS_INSET_PX),
  };
}

/**
 * Normalizes a requested viewport. Zoom is clamped to [1, 8]; the pan target is
 * clamped into the unit disc, so the centre of the aperture can never leave the
 * dome no matter how far a drag goes.
 */
function resolveViewport(options = {}) {
  const zoom = clamp(toNumber(options.zoom, MIN_ZOOM), MIN_ZOOM, MAX_ZOOM);
  const requestedX = clamp(toNumber(options.panX, 0), -1, 1);
  const requestedY = clamp(toNumber(options.panY, 0), -1, 1);
  const panRadius = Math.hypot(requestedX, requestedY);
  const scale = panRadius > 1 ? 1 / panRadius : 1;
  const panX = roundTo(requestedX * scale, 4);
  const panY = roundTo(requestedY * scale, 4);
  const center = unprojectDomeToAltAz(panX, panY);

  return {
    zoom: roundTo(zoom, 3),
    panX,
    panY,
    center: {
      domeX: panX,
      domeY: panY,
      altitudeDeg: roundTo(center.altitudeDeg, 2),
      azimuthDeg: roundTo(center.azimuthDeg, 2),
    },
  };
}

/** Dome point -> canvas pixel, given a viewport and the canvas geometry. */
function projectDomeToCanvas(dome, viewport, canvas) {
  return {
    x: canvas.centerX + (toNumber(dome?.x) - toNumber(viewport?.panX)) * canvas.radius * toNumber(viewport?.zoom, 1),
    y: canvas.centerY + (toNumber(dome?.y) - toNumber(viewport?.panY)) * canvas.radius * toNumber(viewport?.zoom, 1),
  };
}

/**
 * True when a canvas point falls inside the circular aperture the dome is
 * clipped to. The aperture does not grow with zoom — that is exactly why
 * zooming in pushes objects out of view.
 */
function isInsideAperture(point, canvas) {
  return Math.hypot(toNumber(point?.x) - canvas.centerX, toNumber(point?.y) - canvas.centerY) <= canvas.radius;
}

function resolveFilters(options = {}) {
  const objectType = String(options.objectType || "all")
    .trim()
    .toLowerCase();
  const constellation = String(options.constellation || "all").trim();

  return {
    objectType: OBJECT_TYPE_FILTERS.includes(objectType) ? objectType : "all",
    constellation: constellation || "all",
    search: String(options.search || "").trim(),
  };
}

function matchesObjectFilters(object, filters = {}) {
  const objectType = String(filters.objectType || "all").toLowerCase();
  const constellation = String(filters.constellation || "all");
  const search = String(filters.search || "")
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

  if (!search) {
    return true;
  }

  return [object?.name, object?.constellation, object?.type]
    .filter((value) => typeof value === "string" && value.trim())
    .some((value) => value.toLowerCase().includes(search));
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
  const requestedPresetId = String(options.presetId || "").trim();
  const preset = findPresetById(requestedPresetId);
  const fallback = preset || findPresetById("warsaw");
  const latitudeDeg = clamp(toNumber(options.latitudeDeg, fallback.latitudeDeg), -90, 90);
  const longitudeDeg = clamp(toNumber(options.longitudeDeg, fallback.longitudeDeg), -180, 180);
  // `presetId=custom` is the caller saying "these are my coordinates, do not
  // relabel them". Without it, coordinates that happen to sit on a preset are
  // reverse-matched back to that preset — and the page's location control snaps
  // back to the preset the moment the next snapshot arrives.
  const pinnedToCustom = requestedPresetId.toLowerCase() === "custom";
  const matchedPreset = preset || (pinnedToCustom ? null : findPresetByCoordinates(latitudeDeg, longitudeDeg));

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

/**
 * Groups the drawn segments into figures a viewer could point at.
 *
 * A segment whose two stars belong to different constellations is an asterism —
 * the Summer Triangle, the Winter Triangle — and belongs to neither figure. It
 * is still drawn, but it is not part of anything clickable, which is the same
 * rule the page's labels and hit-testing use.
 */
function buildConstellationFigures(objects, canvas) {
  const starMap = new Map(
    (objects || []).filter((object) => object?.type === "star" && object.constellation).map((object) => [object.id, object]),
  );
  const figures = new Map();

  CONSTELLATION_SEGMENTS.forEach(([fromId, toId]) => {
    const from = starMap.get(fromId);
    const to = starMap.get(toId);
    if (!from || !to || from.constellation !== to.constellation) {
      return;
    }

    let figure = figures.get(from.constellation);
    if (!figure) {
      figure = { name: from.constellation, segmentCount: 0, stars: new Map() };
      figures.set(from.constellation, figure);
    }
    figure.segmentCount += 1;
    figure.stars.set(from.id, from);
    figure.stars.set(to.id, to);
  });

  return Array.from(figures.values())
    .map((figure) => {
      const stars = Array.from(figure.stars.values());
      const centerDomeX = stars.reduce((sum, star) => sum + star.domeX, 0) / stars.length;
      const centerDomeY = stars.reduce((sum, star) => sum + star.domeY, 0) / stars.length;
      const centerCanvasX = stars.reduce((sum, star) => sum + star.canvasX, 0) / stars.length;
      const centerCanvasY = stars.reduce((sum, star) => sum + star.canvasY, 0) / stars.length;
      const brightest = stars.reduce((best, star) => (best === null || star.magnitude < best.magnitude ? star : best), null);

      return {
        name: figure.name,
        starCount: stars.length,
        segmentCount: figure.segmentCount,
        inViewCount: stars.filter((star) => star.inView).length,
        brightestObjectId: brightest?.id || null,
        starIds: stars.map((star) => star.id).sort(),
        centerDomeX: roundTo(centerDomeX, 4),
        centerDomeY: roundTo(centerDomeY, 4),
        centerCanvasX: roundTo(centerCanvasX, 2),
        centerCanvasY: roundTo(centerCanvasY, 2),
        inView: isInsideAperture({ x: centerCanvasX, y: centerCanvasY }, canvas),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * The sky dome, answered as data instead of pixels.
 *
 * Given the same observer/time/magnitude inputs as `getSnapshot` plus the
 * viewport the page is currently showing (zoom, pan, canvas size) and the
 * frontend filters, this returns every object on the dome with both its dome
 * coordinates and its canvas pixel position, each flagged with whether the
 * current aperture actually shows it.
 *
 * `dome.objects` is deliberately the FULL dome, not the visible slice: a test
 * that zooms in needs to assert what left the view as much as what stayed, and
 * an out-of-view object is a fact about the viewport, not an absence of data.
 */
function getViewport(options = {}) {
  const timestamp = parseTimestamp(options.timestamp);
  const magnitudeLimit = clamp(toNumber(options.magnitudeLimit, DEFAULT_MAGNITUDE_LIMIT), 1, 6);
  const observer = resolveObserver({
    presetId: options.presetId,
    latitudeDeg: options.latitudeDeg,
    longitudeDeg: options.longitudeDeg,
  });
  const filters = resolveFilters(options);
  const canvas = resolveCanvasMetrics(options.width, options.height);
  const viewport = resolveViewport(options);
  const sky = getVisibleObjects({ date: timestamp, observer, magnitudeLimit });

  const objects = sky.visibleObjects
    .filter((object) => matchesObjectFilters(object, filters))
    .map((object) => {
      const dome = projectAltAzToDome(object.altitudeDeg, object.azimuthDeg);
      const point = projectDomeToCanvas(dome, viewport, canvas);

      return {
        id: object.id,
        name: object.name,
        type: object.type,
        magnitude: object.magnitude,
        constellation: object.constellation,
        altitudeDeg: roundTo(object.altitudeDeg, 2),
        azimuthDeg: roundTo(object.azimuthDeg, 2),
        domeX: roundTo(dome.x, 4),
        domeY: roundTo(dome.y, 4),
        canvasX: roundTo(point.x, 2),
        canvasY: roundTo(point.y, 2),
        inView: isInsideAperture(point, canvas),
      };
    });

  const inViewObjects = objects.filter((object) => object.inView);
  const constellations = buildConstellationFigures(objects, canvas);

  return {
    page: {
      title: "Operator Observatory",
      subtitle: "Sky-dome viewport state, answerable without reading a single pixel.",
      pageUrl: "/operator/observatory.html",
    },
    observer,
    simulation: {
      requestedTimestamp: timestamp.toISOString(),
      serverTimestamp: new Date().toISOString(),
    },
    viewport: {
      ...viewport,
      magnitudeLimit,
      filters,
      canvas,
    },
    dome: {
      objectCount: objects.length,
      inViewCount: inViewObjects.length,
      outOfViewCount: objects.length - inViewObjects.length,
      constellationCount: constellations.length,
      objects,
      constellations,
    },
    inView: {
      objectCount: inViewObjects.length,
      objectIds: inViewObjects.map((object) => object.id),
      constellationNames: constellations.filter((figure) => figure.inView).map((figure) => figure.name),
    },
  };
}

module.exports = {
  LOCATION_PRESETS,
  STAR_CATALOG,
  PLANET_CATALOG,
  CONSTELLATION_SEGMENTS,
  buildConstellationFigures,
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
  getViewport,
  isInsideAperture,
  matchesObjectFilters,
  normalizeDegrees,
  normalizeHours,
  projectAltAzToDome,
  projectDomeToCanvas,
  resolveCanvasMetrics,
  resolveObserver,
  resolveViewport,
  unprojectDomeToAltAz,
};
