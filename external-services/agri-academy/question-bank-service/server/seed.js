/**
 * Self-seed content for the question bank.
 *
 * Two demo pools of real, hand-written farm-safety questions (a mix of `single`
 * and `multi`) keyed by the same exam ids the authoring service self-seeds
 * ("pesticide-basics", "tractor-safety"), so a freshly booted ecosystem is
 * immediately takeable end to end. Real certification units add their own
 * questions via UpsertQuestion. Question text never names the exam, and no option
 * telegraphs the answer — the exam center shuffles options per draw regardless.
 */
function opt(id, text) {
  return { id, text };
}
function single(id, text, options, correctId, weight = 1) {
  return { id, type: "single", text, options, correct: [correctId], weight };
}
function multi(id, text, options, correctIds, weight = 1) {
  return { id, type: "multi", text, options, correct: correctIds, weight };
}

function buildPesticidePool() {
  return [
    single(
      "pb-q1",
      "Which item is essential personal protective equipment when handling pesticides?",
      [opt("a", "Chemical-resistant gloves"), opt("b", "Open sandals"), opt("c", "Sunglasses"), opt("d", "Shorts")],
      "a",
    ),
    multi(
      "pb-q2",
      "Which of the following are safe pesticide-handling practices? (select all that apply)",
      [
        opt("a", "Read the product label before use"),
        opt("b", "Mix indoors with no ventilation"),
        opt("c", "Wear an approved respirator when required"),
        opt("d", "Eat or drink while spraying"),
      ],
      ["a", "c"],
    ),
    single(
      "pb-q3",
      "Where should pesticides be stored?",
      [
        opt("a", "In a locked, ventilated cabinet away from food and feed"),
        opt("b", "In the kitchen"),
        opt("c", "In a child's bedroom"),
        opt("d", "Loose in a car boot"),
      ],
      "a",
    ),
    multi(
      "pb-q4",
      "What should you do with empty pesticide containers? (select all that apply)",
      [
        opt("a", "Triple-rinse them"),
        opt("b", "Reuse them for drinking water"),
        opt("c", "Dispose of them per local regulations"),
        opt("d", "Burn them in an open pile"),
      ],
      ["a", "c"],
    ),
    single(
      "pb-q5",
      "When should you read the product label?",
      [
        opt("a", "Before buying, mixing, and applying the product"),
        opt("b", "Only if you start to feel unwell"),
        opt("c", "After the job is finished"),
        opt("d", "Never — labels are optional"),
      ],
      "a",
    ),
    single(
      "pb-q6",
      'What does a label\'s "re-entry interval" tell you?',
      [
        opt("a", "How long to wait before re-entering a treated area"),
        opt("b", "The product's shelf life"),
        opt("c", "The dilution ratio"),
        opt("d", "The container size"),
      ],
      "a",
    ),
    multi(
      "pb-q7",
      "Which conditions increase spray drift? (select all that apply)",
      [
        opt("a", "Strong wind"),
        opt("b", "Very fine droplet size"),
        opt("c", "Nozzle held at the correct low height"),
        opt("d", "High temperature with low humidity"),
      ],
      ["a", "b", "d"],
    ),
    single(
      "pb-q8",
      "Pesticide is splashed into someone's eye. What is the correct first response?",
      [
        opt("a", "Rinse with clean water for at least 15 minutes and seek medical help"),
        opt("b", "Rub the eye vigorously"),
        opt("c", "Wait to see if it clears on its own"),
        opt("d", "Apply more product to neutralise it"),
      ],
      "a",
    ),
    multi(
      "pb-q9",
      "Good personal hygiene after handling pesticides includes: (select all that apply)",
      [
        opt("a", "Washing hands and face before eating"),
        opt("b", "Changing out of contaminated clothing"),
        opt("c", "Eating immediately without washing"),
        opt("d", "Showering at the end of the day"),
      ],
      ["a", "b", "d"],
    ),
    single(
      "pb-q10",
      "Where should you mix and load to limit point-source contamination?",
      [
        opt("a", "On an impermeable, bunded area away from water sources"),
        opt("b", "Next to an open stream"),
        opt("c", "Directly over a storm drain"),
        opt("d", "In the middle of the crop"),
      ],
      "a",
    ),
    multi(
      "pb-q11",
      "A pesticide application record should include: (select all that apply)",
      [
        opt("a", "Product name and application rate"),
        opt("b", "Date and location"),
        opt("c", "Weather conditions at the time"),
        opt("d", "The operator's favourite colour"),
      ],
      ["a", "b", "c"],
    ),
    single(
      "pb-q12",
      'The signal word "DANGER" on a pesticide label means the product is:',
      [
        opt("a", "Highly toxic — requires the greatest caution"),
        opt("b", "Completely harmless"),
        opt("c", "Exempt from PPE requirements"),
        opt("d", "Past its expiry date"),
      ],
      "a",
    ),
    single(
      "pb-q13",
      "Why is it important to calibrate a sprayer?",
      [
        opt("a", "To apply the correct rate — not too much or too little"),
        opt("b", "To make the tractor go faster"),
        opt("c", "So the tank never needs cleaning"),
        opt("d", "To avoid reading the label"),
      ],
      "a",
    ),
    multi(
      "pb-q14",
      "Which can be early signs of pesticide poisoning? (select all that apply)",
      [opt("a", "Headache and nausea"), opt("b", "Excessive sweating"), opt("c", "Improved eyesight"), opt("d", "Dizziness")],
      ["a", "b", "d"],
    ),
    single(
      "pb-q15",
      "A no-spray buffer zone next to a watercourse exists mainly to:",
      [
        opt("a", "Protect water from contamination"),
        opt("b", "Mark where to park"),
        opt("c", "Allow a higher dose"),
        opt("d", "Speed up drying"),
      ],
      "a",
    ),
    single(
      "pb-q16",
      "Checking tank-mix compatibility before combining products helps to:",
      [
        opt("a", "Avoid mixtures that clog nozzles or react badly"),
        opt("b", "Create more foam"),
        opt("c", "Change the spray colour"),
        opt("d", "Make PPE unnecessary"),
      ],
      "a",
    ),
  ];
}

function buildTractorPool() {
  return [
    single(
      "ts-q1",
      "Before starting a tractor you should first:",
      [
        opt("a", "Walk around it and check for hazards and bystanders"),
        opt("b", "Rev the engine to maximum"),
        opt("c", "Remove the seatbelt"),
        opt("d", "Disable the brakes"),
      ],
      "a",
    ),
    multi(
      "ts-q2",
      "Which are recommended safety measures? (select all that apply)",
      [
        opt("a", "Use the roll-over protection structure (ROPS)"),
        opt("b", "Fasten the seatbelt when ROPS is fitted"),
        opt("c", "Carry extra riders on the drawbar"),
        opt("d", "Keep bystanders clear of the working area"),
      ],
      ["a", "b", "d"],
    ),
    single(
      "ts-q3",
      "On a steep slope you should:",
      [
        opt("a", "Drive straight up or down rather than across where possible"),
        opt("b", "Turn sharply at speed"),
        opt("c", "Raise heavy implements as high as possible"),
        opt("d", "Disengage the handbrake and coast"),
      ],
      "a",
    ),
    multi(
      "ts-q4",
      "Which pre-operation checks are important? (select all that apply)",
      [
        opt("a", "Tyre pressure and condition"),
        opt("b", "Brake and steering function"),
        opt("c", "Whether the radio works"),
        opt("d", "Guards and PTO shields in place"),
      ],
      ["a", "b", "d"],
    ),
    single(
      "ts-q5",
      "What is the safest way to mount or dismount a tractor?",
      [
        opt("a", "Maintain three points of contact, facing the machine"),
        opt("b", "Jump off while it is still moving"),
        opt("c", "Step down onto the rear tyre only"),
        opt("d", "Climb out over the rear linkage"),
      ],
      "a",
    ),
    multi(
      "ts-q6",
      "Which are correct power take-off (PTO) safety rules? (select all that apply)",
      [
        opt("a", "Keep the PTO shields in place"),
        opt("b", "Stop the PTO before dismounting"),
        opt("c", "Wear loose clothing near the shaft"),
        opt("d", "Never step over a rotating shaft"),
      ],
      ["a", "b", "d"],
    ),
    single(
      "ts-q7",
      "Carrying an extra rider on a tractor is:",
      [
        opt("a", "Not allowed unless a proper instructor/passenger seat is fitted"),
        opt("b", "Fine on the drawbar"),
        opt("c", "Fine on the mudguard"),
        opt("d", "Encouraged for company"),
      ],
      "a",
    ),
    single(
      "ts-q8",
      "If a tractor fitted with ROPS begins to roll over, you should:",
      [
        opt("a", "Stay in the seat with the seatbelt fastened"),
        opt("b", "Jump clear immediately"),
        opt("c", "Stand up and grip the wheel harder"),
        opt("d", "Turn sharply downhill"),
      ],
      "a",
    ),
    multi(
      "ts-q9",
      "Which are correct hitching practices? (select all that apply)",
      [
        opt("a", "Hitch towed loads only to the drawbar"),
        opt("b", "Hitch high onto the axle for heavy pulls"),
        opt("c", "Use the correct pins and safety chains"),
        opt("d", "Keep others clear while hitching"),
      ],
      ["a", "c", "d"],
    ),
    single(
      "ts-q10",
      "Before leaving the tractor you should:",
      [
        opt("a", "Lower implements, apply the park brake, stop the engine, and remove the key"),
        opt("b", "Leave it idling in gear"),
        opt("c", "Leave raised implements up"),
        opt("d", "Leave the key in for the next person"),
      ],
      "a",
    ),
    multi(
      "ts-q11",
      "Which apply when travelling on a public road? (select all that apply)",
      [
        opt("a", "Use lights and a slow-moving-vehicle emblem"),
        opt("b", "Secure or lock mounted implements"),
        opt("c", "Travel at full speed regardless of the load"),
        opt("d", "Ensure the brakes are balanced"),
      ],
      ["a", "b", "d"],
    ),
    single(
      "ts-q12",
      "Correct ballast and tyre pressure matter mainly because they affect:",
      [opt("a", "Stability and traction"), opt("b", "Only fuel economy"), opt("c", "Nothing important"), opt("d", "Only the paintwork")],
      "a",
    ),
    single(
      "ts-q13",
      "A slow-moving-vehicle (SMV) emblem warns other road users that the vehicle:",
      [
        opt("a", "Travels well below normal traffic speed"),
        opt("b", "Is for sale"),
        opt("c", "Always has right of way"),
        opt("d", "Is about to stop permanently"),
      ],
      "a",
    ),
    multi(
      "ts-q14",
      "To reduce run-over risk when children may be nearby: (select all that apply)",
      [
        opt("a", "Know where everyone is before moving off"),
        opt("b", "Keep children out of the work area"),
        opt("c", "Let them ride in the loader bucket"),
        opt("d", "Use a spotter when reversing"),
      ],
      ["a", "b", "d"],
    ),
    single(
      "ts-q15",
      "The differential lock is best used when:",
      [
        opt("a", "One wheel loses traction, at low speed in a straight line"),
        opt("b", "Cornering fast on the road"),
        opt("c", "Left engaged at all times"),
        opt("d", "Parking on a slope"),
      ],
      "a",
    ),
    single(
      "ts-q16",
      "Refuelling a tractor should be done:",
      [
        opt("a", "With the engine off and away from ignition sources"),
        opt("b", "While smoking"),
        opt("c", "With the engine running to save time"),
        opt("d", "In a sealed shed with no ventilation"),
      ],
      "a",
    ),
  ];
}

// A tiny 2-question demo pool for the built-in "Farm Safety Quick Check" (exam id
// "demo-quiz"), owned by the Rolnopol Demo Certification Unit. One single + one
// multi, so a fresh ecosystem has a minimal takeable quiz alongside the two
// larger demo exams.
function buildDemoQuizPool() {
  return [
    single(
      "dq-q1",
      "What should you always do before operating farm machinery?",
      [
        opt("a", "Read the operator's manual and check the controls"),
        opt("b", "Remove all the safety guards"),
        opt("c", "Skip the pre-start checks to save time"),
        opt("d", "Disable the brakes"),
      ],
      "a",
    ),
    multi(
      "dq-q2",
      "Which are good general farm-safety habits? (select all that apply)",
      [
        opt("a", "Wear appropriate protective equipment"),
        opt("b", "Keep bystanders clear of moving equipment"),
        opt("c", "Store chemicals together with food"),
        opt("d", "Report and fix hazards promptly"),
      ],
      ["a", "b", "d"],
    ),
  ];
}

// ── Catalogue pools (match authoring's seeded exams "exam-5" … "exam-12") ──────
// Kept in sync with the `agriAcademyQuestionBank` snapshot in
// data/database-base-state.json — the restore endpoint and the test bootstrap
// restore from that file, so the seed and the snapshot describe one initial state.

function buildSoilHealthPool() {
  return [
    single("e5-q1", "What does a standard soil test most commonly measure?", [opt("a", "pH and available nutrients"), opt("b", "The colour of the sky"), opt("c", "Ambient noise"), opt("d", "Wind speed")], "a"),
    single("e5-q2", "Why is soil organic matter valuable?", [opt("a", "It improves structure, water-holding, and nutrient supply"), opt("b", "It makes soil heavier for no reason"), opt("c", "It repels all earthworms"), opt("d", "It has no effect")], "a"),
    multi("e5-q3", "Which practices help build organic matter? (select all that apply)", [opt("a", "Adding compost or manure"), opt("b", "Growing cover crops"), opt("c", "Continuous bare fallow"), opt("d", "Returning crop residues")], ["a", "b", "d"]),
    single("e5-q4", "A soil pH of 4.5 is best described as:", [opt("a", "Strongly acidic"), opt("b", "Neutral"), opt("c", "Strongly alkaline"), opt("d", "Not measurable")], "a"),
    multi("e5-q5", "Which are macronutrients essential for crops? (select all that apply)", [opt("a", "Nitrogen"), opt("b", "Phosphorus"), opt("c", "Potassium"), opt("d", "Neon")], ["a", "b", "c"]),
    single("e5-q6", "Applying nutrients based on a soil test rather than a fixed recipe helps to:", [opt("a", "Match supply to crop need and reduce waste"), opt("b", "Guarantee lodging"), opt("c", "Increase runoff on purpose"), opt("d", "Skip the growing season")], "a"),
    single("e5-q7", "Compaction in soil primarily reduces:", [opt("a", "Root growth and water infiltration"), opt("b", "The price of grain"), opt("c", "Daylight hours"), opt("d", "Seed colour")], "a"),
    multi("e5-q8", "Which reduce nutrient loss to water? (select all that apply)", [opt("a", "Buffer strips near watercourses"), opt("b", "Applying fertiliser before heavy rain"), opt("c", "Incorporating fertiliser into the soil"), opt("d", "Matching rate to crop demand")], ["a", "c", "d"]),
  ];
}

function buildOrganicPool() {
  return [
    single("e6-q1", "In certified organic systems, synthetic nitrogen fertiliser is:", [opt("a", "Prohibited"), opt("b", "Required"), opt("c", "Unlimited"), opt("d", "Only used indoors")], "a"),
    single("e6-q2", "The main purpose of the organic conversion period is to:", [opt("a", "Allow soil and system to meet organic standards before certified sale"), opt("b", "Increase pesticide use"), opt("c", "Skip inspections"), opt("d", "Raise prices instantly")], "a"),
    multi("e6-q3", "Which records are typically required for organic certification? (select all that apply)", [opt("a", "Input purchases and use"), opt("b", "Field and crop histories"), opt("c", "Harvest and sales records"), opt("d", "Staff lunch preferences")], ["a", "b", "c"]),
    single("e6-q4", "For organic weed control a grower would prefer:", [opt("a", "Cultivation, mulching, and rotation"), opt("b", "Broad-spectrum synthetic herbicide"), opt("c", "Ignoring weeds entirely"), opt("d", "Salting the whole field")], "a"),
    multi("e6-q5", "Acceptable organic soil-fertility inputs often include: (select all that apply)", [opt("a", "Well-rotted compost"), opt("b", "Approved animal manures"), opt("c", "Green manures / legumes"), opt("d", "Untested industrial sludge")], ["a", "b", "c"]),
    single("e6-q6", "Buffer zones between organic and conventional land exist to:", [opt("a", "Prevent contamination and spray drift onto organic crops"), opt("b", "Mark parking"), opt("c", "Store fuel"), opt("d", "Grow more weeds")], "a"),
    single("e6-q7", "An organic inspection is usually carried out:", [opt("a", "At least annually by an approved certifier"), opt("b", "Never"), opt("c", "Only by the farmer themselves"), opt("d", "Once a decade")], "a"),
    multi("e6-q8", "Crop rotation in organic systems helps to: (select all that apply)", [opt("a", "Break pest and disease cycles"), opt("b", "Manage soil fertility"), opt("c", "Reduce weed pressure"), opt("d", "Eliminate the need for any planning")], ["a", "b", "c"]),
    single("e6-q9", "GMO seed in a certified organic crop is:", [opt("a", "Not permitted"), opt("b", "Encouraged"), opt("c", "Mandatory"), opt("d", "Only allowed at night")], "a"),
    single("e6-q10", "Split, non-organic parallel production must be:", [opt("a", "Clearly separated and documented"), opt("b", "Hidden from the certifier"), opt("c", "Mixed freely"), opt("d", "Ignored")], "a"),
  ];
}

function buildCombinePool() {
  return [
    single("e7-q1", "Before harvesting, the combine header height should be set to:", [opt("a", "Suit the crop and cut cleanly without picking up soil"), opt("b", "The maximum at all times"), opt("c", "Below ground level"), opt("d", "Whatever is fastest")], "a"),
    multi("e7-q2", "Pre-harvest combine checks include: (select all that apply)", [opt("a", "Fire extinguisher present and charged"), opt("b", "Belts, chains, and bearings inspected"), opt("c", "Grain tank and unloading auger clear"), opt("d", "Radio station tuned")], ["a", "b", "c"]),
    single("e7-q3", "Excessive grain loss out the back of the combine often indicates:", [opt("a", "Incorrect fan speed or concave settings"), opt("b", "The paint is wrong"), opt("c", "Too much daylight"), opt("d", "Nothing adjustable")], "a"),
    single("e7-q4", "Combine fires are most commonly caused by:", [opt("a", "Chaff build-up near hot engine and bearing surfaces"), opt("b", "Cold weather only"), opt("c", "Clean machines"), opt("d", "Low fuel exclusively")], "a"),
    multi("e7-q5", "Safe unblocking of a plugged combine requires: (select all that apply)", [opt("a", "Engine off and key removed"), opt("b", "Moving parts fully stopped"), opt("c", "Reaching in while it runs"), opt("d", "Following lockout procedure")], ["a", "b", "d"]),
    single("e7-q6", "Higher drum/rotor speed than needed tends to:", [opt("a", "Increase grain damage and cracking"), opt("b", "Improve germination"), opt("c", "Reduce fuel use to zero"), opt("d", "Have no effect")], "a"),
    single("e7-q7", "When moving a combine on a public road you should:", [opt("a", "Fit lights/markers and remove or secure the header per rules"), opt("b", "Drive on the header"), opt("c", "Travel at full field speed"), opt("d", "Ignore other traffic")], "a"),
    multi("e7-q8", "Signs the concave clearance is too tight include: (select all that apply)", [opt("a", "Cracked or broken grain"), opt("b", "High power demand and slugging"), opt("c", "Perfectly clean sample with no losses"), opt("d", "Excess straw breakup")], ["a", "b", "d"]),
  ];
}

function buildMachineryPool() {
  return [
    single("e8-q1", "Engine oil should be checked:", [opt("a", "Regularly, with the machine level and engine off"), opt("b", "Only when it seizes"), opt("c", "Never"), opt("d", "While driving")], "a"),
    multi("e8-q2", "A good pre-season service includes: (select all that apply)", [opt("a", "Changing filters and fluids"), opt("b", "Greasing points per the manual"), opt("c", "Checking tyres and lights"), opt("d", "Repainting the seat")], ["a", "b", "c"]),
    single("e8-q3", "Grease points should be lubricated:", [opt("a", "At the intervals in the operator's manual"), opt("b", "Once in the machine's lifetime"), opt("c", "Only if they squeak loudly"), opt("d", "Never, to save grease")], "a"),
    single("e8-q4", "A slack drive belt will typically cause:", [opt("a", "Slipping and poor power transfer"), opt("b", "More horsepower"), opt("c", "Better fuel economy"), opt("d", "Nothing")], "a"),
    multi("e8-q5", "Before working under a raised implement you should: (select all that apply)", [opt("a", "Use proper stands or locks"), opt("b", "Rely only on hydraulics"), opt("c", "Stop the engine and remove the key"), opt("d", "Chock the wheels")], ["a", "c", "d"]),
    single("e8-q6", "Checking tyre pressures matters because it affects:", [opt("a", "Traction, wear, and fuel use"), opt("b", "Only the colour"), opt("c", "The radio signal"), opt("d", "Nothing measurable")], "a"),
    single("e8-q7", "Old or contaminated hydraulic fluid can lead to:", [opt("a", "Component wear and poor performance"), opt("b", "Improved lifespan"), opt("c", "Faster ploughing guaranteed"), opt("d", "No change at all")], "a"),
    multi("e8-q8", "Keeping a maintenance log helps to: (select all that apply)", [opt("a", "Track service intervals"), opt("b", "Spot recurring faults"), opt("c", "Support resale value"), opt("d", "Predict the weather")], ["a", "b", "c"]),
  ];
}

function buildLivestockPool() {
  return [
    single("e9-q1", "Low-stress stock handling relies mainly on:", [opt("a", "Understanding the animal's flight zone and point of balance"), opt("b", "Shouting and hitting"), opt("c", "Sudden loud noises"), opt("d", "Chasing at speed")], "a"),
    multi("e9-q2", "The 'five freedoms' of animal welfare include: (select all that apply)", [opt("a", "Freedom from hunger and thirst"), opt("b", "Freedom from discomfort"), opt("c", "Freedom to express normal behaviour"), opt("d", "Freedom from ever being weighed")], ["a", "b", "c"]),
    single("e9-q3", "A sick animal is often best managed by:", [opt("a", "Isolating and observing it, and seeking veterinary advice"), opt("b", "Mixing it with the whole herd"), opt("c", "Ignoring it"), opt("d", "Releasing it to roam")], "a"),
    multi("e9-q4", "Signs of ill health in livestock include: (select all that apply)", [opt("a", "Off feed / not ruminating"), opt("b", "Isolation from the group"), opt("c", "Lameness"), opt("d", "A shiny ear tag")], ["a", "b", "c"]),
    single("e9-q5", "Good race and yard design should:", [opt("a", "Use curves and solid sides to encourage smooth flow"), opt("b", "Have sharp blind corners"), opt("c", "Be as slippery as possible"), opt("d", "Face directly into the sun")], "a"),
    single("e9-q6", "Clean, fresh water for livestock should be:", [opt("a", "Available at all times"), opt("b", "Offered once a week"), opt("c", "Only after work"), opt("d", "Optional")], "a"),
    multi("e9-q7", "Before transporting animals you should check: (select all that apply)", [opt("a", "They are fit to travel"), opt("b", "The vehicle is clean and safe"), opt("c", "Stocking density is appropriate"), opt("d", "The colour of the driver's hat")], ["a", "b", "c"]),
  ];
}

function buildDairyPool() {
  return [
    single("e10-q1", "Before attaching the cluster, teats should be:", [opt("a", "Cleaned and, where used, fore-milked and pre-dipped"), opt("b", "Left muddy"), opt("c", "Painted"), opt("d", "Ignored")], "a"),
    multi("e10-q2", "Good milking hygiene includes: (select all that apply)", [opt("a", "Clean hands and gloves"), opt("b", "Clean, dry teats before attaching"), opt("c", "Post-milking teat disinfection"), opt("d", "Skipping all cleaning to save time")], ["a", "b", "c"]),
    single("e10-q3", "Rapid cooling of milk after collection is important to:", [opt("a", "Limit bacterial growth and protect quality"), opt("b", "Change its colour"), opt("c", "Increase somatic cells"), opt("d", "Warm the parlour")], "a"),
    single("e10-q4", "A high somatic cell count in milk often indicates:", [opt("a", "Udder infection such as mastitis"), opt("b", "Excellent udder health"), opt("c", "Cold weather only"), opt("d", "Nothing at all")], "a"),
    multi("e10-q5", "Cleaning-in-place (CIP) of milking equipment typically uses: (select all that apply)", [opt("a", "A warm detergent wash"), opt("b", "An acid rinse cycle"), opt("c", "Adequate water temperature and flow"), opt("d", "Milk as the only cleaner")], ["a", "b", "c"]),
    single("e10-q6", "Bulk tank milk temperature should generally be held:", [opt("a", "Chilled to the required storage temperature"), opt("b", "At room temperature"), opt("c", "Near boiling"), opt("d", "However is convenient")], "a"),
  ];
}

function buildPruningPool() {
  return [
    single("e11-q1", "The main goal of pruning a fruit tree is to:", [opt("a", "Improve structure, light, and fruiting"), opt("b", "Remove as much wood as possible"), opt("c", "Make it as tall as possible"), opt("d", "Damage the tree")], "a"),
    multi("e11-q2", "Which cuts/removals are commonly made? (select all that apply)", [opt("a", "Dead, diseased, or damaged wood"), opt("b", "Crossing or rubbing branches"), opt("c", "Strong healthy scaffold limbs at random"), opt("d", "Water shoots and suckers")], ["a", "b", "d"]),
    single("e11-q3", "Most pip fruit (apples/pears) are best pruned:", [opt("a", "In the dormant season"), opt("b", "At peak flowering only"), opt("c", "During a storm"), opt("d", "Never")], "a"),
    single("e11-q4", "A pruning cut should be made:", [opt("a", "Just above an outward-facing bud or at the branch collar"), opt("b", "In the middle of an internode leaving a long stub"), opt("c", "Flush, cutting into the trunk"), opt("d", "Anywhere at random")], "a"),
    multi("e11-q5", "Good pruning hygiene includes: (select all that apply)", [opt("a", "Using sharp, clean tools"), opt("b", "Disinfecting tools between diseased trees"), opt("c", "Removing prunings from around the tree"), opt("d", "Tearing branches by hand")], ["a", "b", "c"]),
  ];
}

function buildVineyardPool() {
  return [
    single("e12-q1", "Integrated Pest Management (IPM) prioritises:", [opt("a", "Monitoring and combining methods, using chemicals as a last resort"), opt("b", "Spraying on a fixed calendar regardless of pests"), opt("c", "Never inspecting the crop"), opt("d", "Only chemical control")], "a"),
    single("e12-q2", "Powdery mildew on grapevines typically appears as:", [opt("a", "A white-grey powdery coating on leaves and berries"), opt("b", "Bright red spots only"), opt("c", "Blue fuzzy cubes"), opt("d", "No visible sign")], "a"),
    multi("e12-q3", "Cultural controls that reduce vine disease include: (select all that apply)", [opt("a", "Canopy management for airflow"), opt("b", "Removing infected material"), opt("c", "Appropriate row orientation and spacing"), opt("d", "Leaving the canopy as dense as possible")], ["a", "b", "c"]),
    single("e12-q4", "Scouting the vineyard regularly allows you to:", [opt("a", "Detect pests and disease early and act in time"), opt("b", "Waste time"), opt("c", "Guarantee no pests ever appear"), opt("d", "Avoid all decisions")], "a"),
    multi("e12-q5", "When applying an approved plant-protection product you should: (select all that apply)", [opt("a", "Follow the label rate and interval"), opt("b", "Wear the specified PPE"), opt("c", "Observe the pre-harvest interval"), opt("d", "Spray in strong wind for wider coverage")], ["a", "b", "c"]),
    single("e12-q6", "Rotating chemical mode-of-action groups helps to:", [opt("a", "Slow the development of resistance"), opt("b", "Speed up resistance"), opt("c", "Change berry colour"), opt("d", "Do nothing useful")], "a"),
  ];
}

function buildSeed() {
  return {
    version: 1,
    pools: {
      "pesticide-basics": buildPesticidePool(),
      "tractor-safety": buildTractorPool(),
      "demo-quiz": buildDemoQuizPool(),
      "exam-5": buildSoilHealthPool(),
      "exam-6": buildOrganicPool(),
      "exam-7": buildCombinePool(),
      "exam-8": buildMachineryPool(),
      "exam-9": buildLivestockPool(),
      "exam-10": buildDairyPool(),
      "exam-11": buildPruningPool(),
      "exam-12": buildVineyardPool(),
    },
  };
}

module.exports = { buildSeed };
