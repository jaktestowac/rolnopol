/**
 * Rolnopol Survival — every player-facing string (PRD WP-48).
 *
 * The game is played in English and documented in Polish. No string shown to a
 * player may live anywhere but this file, so the journal keeps one voice and a
 * second language later is a second dictionary rather than a hunt through the
 * logic.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Survival = root.Survival || {};
    root.Survival.strings = factory();
  }
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const EN = {
    "game.title": "Rolnopol Survival",

    "scenario.lost.name": "Lost",
    "scenario.lost.description": "Walk out of the wild before the wild finishes you. Any border will do.",
    "scenario.survival.name": "Survival",
    "scenario.survival.description": "Only the western border leads anywhere. Hold the route.",
    "scenario.search.name": "Search",
    "scenario.search.description": "Someone is out there. Three of the four signs are wrong.",
    "scenario.rescue.name": "Rescue",
    "scenario.rescue.description": "Find them, carry them out. They slow you down by a point a day.",

    "difficulty.easy": "Easy",
    "difficulty.normal": "Normal",
    "difficulty.hard": "Hard",

    "terrain.open": "open ground",
    "terrain.forest": "forest",
    "terrain.mountain": "mountains",
    "terrain.river": "river",
    "terrain.swamp": "swamp",
    "terrain.trail": "trail",
    "terrain.ford": "ford",
    "terrain.cabin": "cabin",
    "terrain.waterSource": "spring",
    "terrain.foodSource": "forage",

    "resource.health": "Health",
    "resource.water": "Water",
    "resource.food": "Food",
    "resource.fatigue": "Fatigue",
    "resource.orientation": "Bearings",

    "hud.day": "Day",
    "hud.movement": "Movement",
    "hud.seed": "Seed",
    "hud.journal": "Journal",
    "hud.terrain": "Terrain",
    "hud.cost": "Cost",
    "hud.features": "Features",
    "hud.none": "none",
    "hud.hexInfo": "Hover a hex",
    "hud.difficulty": "Difficulty",
    "hud.mapSize": "Map",
    "mapSize.small": "Small (16x16)",
    "mapSize.standard": "Standard (24x24)",
    "mapSize.large": "Large (32x32)",
    "mapSize.vast": "Vast (40x40)",
    "mapSize.immense": "Immense (48x48)",
    "mapSize.colossal": "Colossal (64x64)",
    "mapSize.endless": "Endless (128x128)",
    "hud.panHint": "Drag with the right mouse button to move the map.",
    "hud.scenario": "Expedition",
    "hud.carrying": "Carrying the survivor",
    "hud.marker": "an unexplored sign",
    "hud.weather": "Weather",
    "hud.conditions": "Condition",
    "hud.fullJournal": "Expedition journal",

    "history.title": "Past expeditions",
    "history.empty": "No expeditions recorded yet.",
    "history.unavailable": "Past expeditions could not be loaded.",
    "history.days": "days",
    "history.status.in_progress": "In progress",
    "history.status.won": "Escaped",
    "history.status.lost": "Lost",
    "history.status.abandoned": "Abandoned",
    "history.noRoute": "This expedition predates the route trace.",

    "action.returnToMenu": "Return to the menu",
    "action.endDay": "End day",
    "action.rest": "Rest",
    "action.searchWater": "Search for water",
    "action.searchFood": "Forage",
    "action.history": "Past expeditions",
    "action.checkMap": "Study the map",
    "action.investigate": "Take a closer look",
    "action.investigate.marker": "Check the sign",
    "action.investigate.cabin": "Enter the cabin",
    "action.investigate.spring": "Drink and fill up",
    "action.investigate.forage": "Pick the patch",
    "action.camp": "Make camp",
    "action.resume": "Resume expedition",
    "action.daily": "Daily challenge",
    "action.scoreboard": "Scoreboard",

    "scoreboard.title": "Scoreboard",
    "scoreboard.rank": "#",
    "scoreboard.player": "Player",
    "scoreboard.wins": "Escaped",
    "scoreboard.losses": "Lost",
    "scoreboard.empty": "Nobody has finished an expedition yet.",
    "scoreboard.unavailable": "The scoreboard could not be loaded.",
    "scoreboard.note": "Expeditions that used the cheat console are not counted.",

    "cheat.title": "Cheat console",
    "cheat.hint": "Tilde (~) opens and closes this.",
    "cheat.actions": "Do something",
    "cheat.dials": "Set something",
    "cheat.noRun": "Start an expedition first.",
    "cheat.used": "Cheats used",

    "cheat.revealMap": "Reveal map",
    "cheat.revealMap.tip": "Uncovers every hex, fog of war included. Bearings still decide what you see from here on.",
    "cheat.fillStores": "Fill stores",
    "cheat.fillStores.tip": "Health, water and food to full, fatigue to zero. Wounds and illnesses are untouched.",
    "cheat.heal": "Treat everything",
    "cheat.heal.tip": "Clears every wound and illness, the way a cabin or a fire would.",
    "cheat.refillMovement": "Refill movement",
    "cheat.refillMovement.tip": "Puts today's movement points back to what the day started with.",
    "cheat.skipDay": "Skip the day",
    "cheat.skipDay.tip": "Runs the end of day at once: rations, wounds, weather and the nightly roll.",
    "cheat.winNow": "Win now",
    "cheat.winNow.tip": "Ends the expedition as a win, whatever the scenario wanted.",
    "cheat.loseNow": "Lose now",
    "cheat.loseNow.tip": "Ends the expedition as a loss.",
    "cheat.fireEvent": "Fire an event",
    "cheat.fireEvent.tip": "Triggers any event by name, follow-ups included. One with a choice will still ask.",
    "cheat.setWeather": "Set the weather",
    "cheat.setWeather.tip": "Pins the sky. It stays pinned until a new expedition starts.",
    "cheat.setResource.tip": "Sets the value straight away. It is still clamped to the range the game allows.",
    "cheat.setMovement.tip": "Sets the movement points left today.",

    "cheat.log.win": "[cheat] The expedition is called a success.",
    "cheat.log.lose": "[cheat] The expedition is called off.",
    "cheat.log.used": "[cheat] {name}.",
    "action.start": "Set out",
    "action.instructions": "How to play",
    "action.backToMenu": "Main menu",
    "action.replay": "Replay this seed",
    "action.forcedMarch": "Force the march",
    "action.cancel": "Cancel",
    "action.close": "Close",
    "action.copySeed": "Copy seed",
    "action.seedCopied": "Seed copied",

    "prompt.choice.body": "Whatever you decide, the day ends with it.",
    "prompt.abandon.title": "Leave the expedition?",
    "prompt.abandon.body": "The run ends here and goes into the record as abandoned.",

    "menu.title": "Rolnopol Survival",
    "menu.tagline": "A hex away from anywhere, with six days of water.",
    "menu.chooseScenario": "Choose an expedition",
    "menu.instructions.title": "How to play",

    "guide.goal.title": "What you are doing",
    "guide.goal.body":
      "You are somewhere in the wild with no map worth the name. One turn is one day, and the expedition tells you which border counts as out. Get there before the wild finishes you.",
    "guide.goal.day":
      "A day gives you {movement} movement points. Walking spends them, so does searching, and resting spends whatever is left.",
    "guide.goal.you": "you",

    "guide.controls.title": "Getting about",
    "guide.controls.body":
      "Left click walks onto a neighbouring hex. Drag with the right mouse button to move the map, which is larger than the window on every size above the smallest.",
    "guide.controls.walk": "Step in the six directions",

    "guide.resources.title": "What keeps you alive",
    "guide.resources.body":
      "Water and food drop by one every day. An empty canteen costs {noWater} health a night and an empty stomach {noFood}, and they stack.",
    "guide.resources.health": "Zero ends the expedition",
    "guide.resources.water": "Drains daily, twice as fast in the heat",
    "guide.resources.food": "Drains daily, slower to hurt than thirst",
    "guide.resources.fatigue": "Rises with rough going, cuts your movement",
    "guide.resources.orientation": "How far you can see, and how lost you get",
    "guide.resources.terrain": "What the ground costs to enter:",

    "eventCategory.weather": "Weather",
    "eventCategory.animals": "Animals",
    "eventCategory.personal": "Your own body",
    "eventCategory.discovery": "Discoveries",
    "eventCategory.tracks": "Tracks and signs",

    "guide.events.title": "What happens to you",
    "guide.events.body":
      "Something happens most nights: weather, animals, a find, a sign that somebody was here. Some of it helps and some of it does not.",
    "guide.events.choices":
      "A few events ask you to decide. Closing the window without choosing takes the careful option, so walking away is never free.",
    "guide.events.wounds":
      "Some of them do more than hurt. A wound listed here changes what a day of walking is worth, so it belongs in the route you pick, not only in the tally at nightfall.",
    "guide.events.conditions":
      "Wounds and illnesses have a clock on them and bite every night until they run out. A cabin or a camp fire treats them; lying down only shortens them.",

    "guide.scenarios.title": "The expeditions",
    "guide.scenarios.body": "Six of them, and the one you pick decides what winning means.",

    "guide.tips.title": "Worth knowing",
    "guide.tips.trails":
      "A trail costs one movement whatever it crosses, and a day spent on one costs no fatigue. On the large maps a road runs right across the country.",
    "guide.tips.landmarks":
      "Water, forage and cabins can be picked out from further off than ordinary ground. If you see a river, it is worth the detour.",
    "guide.tips.searchOnce": "Each hex gives up its water once and its food once. Standing still and searching again will not work.",
    "guide.tips.cabin": "A cabin is worth walking to: it empties your fatigue, fills the canteen and treats what ails you. Once.",
    "guide.tips.forcedMarch": "Boxed in by ground you cannot afford? Forcing the march always works, and always costs health.",
    "guide.tips.seed": "Every expedition has a seed. The same seed is the same map, so a run you liked can be played again.",

    "menu.instructions.body":
      "One turn is one day. Movement points are the day: walking costs them, so does searching, and resting spends what is left. Water drains every day and runs out faster than food; an empty canteen costs two health a night. Rough ground tires you, and fatigue takes movement away. You only see as far as your bearings allow, so study the map when you lose them. Reach the border your expedition asks for before the wild finishes you.",
    "menu.controls":
      "Left click walks. Right-drag moves the map. Keys 1 to 6 step in the six directions, E looks at whatever is on your hex, W searches for water, F forages, M studies the map, R rests, space ends the day.",

    "prompt.longMove.title": "Commit to that ground?",
    "prompt.longMove.body": "Entering {terrain} costs {cost} of your {total} movement points today.",
    "prompt.forcedMarch.title": "No ground you can afford",
    "prompt.forcedMarch.body":
      "Nothing around you is within today's movement. You can force your way onto {terrain} for {health} health and {fatigue} fatigue.",

    "banner.offline": "Backend unreachable. You can play, but this expedition will not be recorded.",
    "banner.notRecorded": "This expedition was not recorded.",

    "log.start": "You wake beside a dead fire, with no idea which way is out.",
    "log.move": [
      "You move onto {terrain}.",
      "You push on into {terrain}.",
      "The ground turns to {terrain} under your boots.",
      "Another hour of walking, and {terrain} takes over.",
    ],
    "log.move.thirsty": [
      "You cross into {terrain} with an empty canteen and a thick tongue.",
      "{terrain}, and still no water. You keep walking because stopping is worse.",
    ],
    "log.move.spent": [
      "You drag yourself into {terrain}. Every step is a decision.",
      "{terrain}. You stop counting steps and start counting breaths.",
    ],
    "log.moveNotNeighbour": "You can only move to an adjacent hex.",
    "log.moveTooExpensive": "{terrain} costs {cost} movement and you have {left} left.",
    "log.moveNoPoints": "There is no daylight left for that.",
    "log.forcedMarch": "You force your way onto {terrain}. It costs blood and strength.",
    "log.forcedMarchRefused": "You can still afford ground nearby. Save your strength.",
    "log.dayBreaks": ["Day {day} breaks.", "Grey light, and the day {day} begins.", "Day {day}. The cold wakes you before the sun does."],
    "log.dayBreaks.thirst": "Day {day}. Your mouth is dry before you have taken a step.",
    "log.dayBreaks.hunger": "Day {day}. Hunger is the first thing you notice.",
    "log.dayBreaks.spent": "Day {day}. Everything hurts, and none of it will get better by walking.",
    "log.noWater": "The canteen is empty. Your tongue sticks to the roof of your mouth.",
    "log.noFood": "Hunger dulls your thinking.",
    "log.exhausted": "Exhaustion wears the body down.",
    "log.marchTold": "The day's march leaves its mark. Fatigue {fatigue}.",
    "log.win": "Lights on the horizon. You walk out of the wild.",
    "log.loss": "The last entry in the journal stops before dawn.",
    "log.gameOver": "The expedition is over.",
    "log.noTimeForAction": "There is not enough daylight left for that.",

    "log.restFed": [
      "You make camp, eat, and let the fire do the rest.",
      "A meal, a lie down, and the day written off on purpose.",
      "You sleep badly, but you sleep, and it counts for something.",
    ],
    "log.restHungry": [
      "You lie down with nothing in your stomach. Sleep is not enough.",
      "Rest on an empty stomach is just lying still and waiting.",
    ],

    "log.searchFound.water": "You find water. +{amount} to the canteen.",
    "log.searchFound.food": "You come back with something to eat. +{amount} rations.",
    "log.searchFailed.water": [
      "You dig and listen, and find nothing worth drinking.",
      "Dry sand, dry roots, dry hours.",
      "Whatever water was here left before you did.",
    ],
    "log.searchFailed.food": [
      "Nothing here is worth the chewing.",
      "You turn over half an acre and come back with nothing.",
      "Two hours of looking. Nothing that will not make you sicker.",
    ],
    "log.searchExhausted.water": "You have already taken what water this ground had.",
    "log.searchExhausted.food": "This ground has already been picked clean.",
    "log.swampIllness": "The swamp water was a mistake. Your stomach turns.",

    "log.investigate.nothing": "There is nothing here worth a closer look.",
    "log.investigate.spring": "Cold, clear water. You drink until it hurts and fill the canteen.",
    "log.investigate.springTainted": "The water is flat and metallic. You drink it anyway, and pay for it.",
    "log.investigate.forage": "Roots and green shoots. +{amount} rations.",
    "log.investigate.forageGood": "The patch is bigger than it looked. +{amount} rations.",
    "log.investigate.cabin": "An abandoned cabin. A dry floor, a full barrel, one good night.",
    "log.investigate.cabinSupplies": "Under the bunk, a tin of stores nobody came back for. +{amount} rations.",
    "log.investigate.cabinChart": "A hand-drawn chart is pinned above the stove. The country makes sense again.",
    "log.investigate.cabinBare": "Four walls, and whoever left took everything with them.",

    "log.checkMap": "You sit down with the map and the ridgeline until they agree. Bearings {orientation}.",
    "log.marker.decoy": "A scrap of cloth on a branch. Nobody has been here in weeks.",
    "log.marker.npc": "You find them, alive, under a lean-to of branches.",
    "log.marker.carrying": "They cannot walk on their own. You take the weight.",

    "terrainEffect.mountain": "From the ridge you can see further, but the climb takes it out of you.",
    "terrainEffect.swamp": "Every step sinks into black water.",
    "terrainEffect.desert": "The dry flats drink from your canteen all day.",
    "terrainEffect.forest": "The forest closes in and the horizon disappears.",

    "event.storm.text": "A storm rolls in. Rain fills the canteen and ruins the map.",
    "event.bite.text": "Something bit you in the night. The arm is swelling.",
    "event.fog.text": "Fog settles in the valley. You cannot tell one ridge from another.",
    "event.berries.text": "A patch of berries, heavy and dark.",
    "event.shelter.text": "An overhang, dry wood, and someone else's forgotten supplies.",
    "event.tracks.text": "Animal tracks in wet ground, running along an old path.",
    "event.coldSnap.text": "The cold comes down hard after dark. You burn food just staying warm.",
    "event.clearNight.text": "A clear night, and stars you recognise. You know which way is north again.",
    "event.fish.text": "Slow water, and fish stupid enough to stay in it.",
    "event.swarm.text": "Insects find you at dusk and do not leave until dawn.",
    "event.sprain.text": "Your ankle turns on a loose stone. It holds, but only just.",
    "event.badWater.text": "The water you drank this morning is having its say.",
    "event.secondWind.text": "Something loosens in your chest and the walking gets easier.",
    "event.resolve.text": "You sit down, work out where you are, and decide you are not dying here.",
    "event.oldBlaze.text": "An axe blaze on a trunk, weathered grey. Someone marked this route once.",
    "event.lostHours.text": "You follow a line of ground that goes nowhere and lose half a day to it.",
    "event.fever.text": "The bite has gone bad. By evening you are shaking.",
    "event.mirage.text": "Water, a mile off, flat and silver. It is not there when you arrive.",
    "event.dustStorm.text": "Dust comes across the flats in a wall. You sit it out with your back to it.",
    "event.dryWash.text": "You dig into the bend of a dry wash and hit damp sand, then water.",

    "terrain.desert": "dry flats",

    "scenario.deadline.name": "Deadline",
    "scenario.deadline.description": "The pickup leaves the western ridge on day {days}. Be on it.",
    "scenario.chase.name": "The Chase",
    "scenario.chase.description": "Someone is following your trail. Reach any border before they reach you.",

    "log.deadline.missed": "You reach the ridge on the wrong day. The tracks in the mud are already cold.",
    "log.chase.caught": "They come out of the treeline behind you, and there is nowhere left to go.",
    "log.chase.near": "Voices, closer than yesterday.",
    "log.chase.far": "Whoever is behind you has lost the trail, for now.",
    "log.chase.sighted": "You see them now. A figure on the ridge, walking your line.",
    "hud.pursuit.sighted": "In sight",
    "hud.daysLeft": "Days left",
    "hud.pursuit": "Pursuit",
    "hud.pursuit.near": "Close",
    "hud.pursuit.far": "Distant",

    "event.wolves.text": "Wolves. Four of them, keeping pace at the edge of the trees.",
    "event.wolves.stand": "Stand your ground",
    "event.wolves.retreat": "Back away slowly",
    "event.wolves.standGood": "You shout, you look big, and they lose interest.",
    "event.wolves.standBad": "One of them tests you, and finds you soft.",
    "event.wolves.retreatDone": "You give up the ground and half your bearings with it.",

    "event.berries.eat": "Eat your fill",
    "event.berries.pocket": "Pocket a handful",
    "event.berries.good": "They are sweet, and they are the right ones.",
    "event.berries.bad": "They were the wrong berries.",
    "event.berries.pocketed": "You take what you can carry and leave the rest.",

    "event.abandonedPack.text": "A pack propped against a rock, still buckled.",
    "event.abandonedPack.take": "Take everything",
    "event.abandonedPack.leave": "Leave it where it is",
    "event.abandonedPack.taken": "Food, water, and the weight of both.",
    "event.abandonedPack.left": "You leave it alone. Whoever set it down may still be walking.",

    "event.deadTraveller.text": "Someone else did not make it out. The boots are still on.",
    "event.deadTraveller.search": "Search the body",
    "event.deadTraveller.walkOn": "Walk on",
    "event.deadTraveller.searchGood": "A notebook with a route in it, and rations nobody will miss.",
    "event.deadTraveller.searchBad": "You take the food. You should not have touched anything else.",
    "event.deadTraveller.walkedOn": "You walk on, and it costs you an hour of not thinking about it.",

    "event.smoke.text": "Smoke, thin and steady, two ridges over.",
    "event.smoke.follow": "Go and see",
    "event.smoke.hold": "Hold your route",
    "event.smoke.followGood": "A hunter's camp, long cold, but the cache is still there.",
    "event.smoke.followBad": "You lose the smoke, and the day with it.",
    "event.smoke.held": "You mark the direction and keep walking.",

    "condition.bitten.starts": "The bite is deep and it will not close on its own.",
    "condition.bitten.tick": "The bite throbs all night.",
    "condition.bitten.ends": "The bite finally scabs over.",
    "condition.fever.starts": "The fever takes hold.",
    "condition.fever.tick": "You sweat through another night.",
    "condition.fever.ends": "The fever breaks.",
    "condition.dysentery.starts": "Your gut turns on you.",
    "condition.dysentery.tick": "You lose more water than you can afford.",
    "condition.dysentery.ends": "Your stomach settles.",
    "condition.sprain.starts": "The ankle swells. Every step costs more than it should.",
    "condition.sprain.tick": "The ankle is worse in the morning.",
    "condition.sprain.ends": "The ankle takes your weight again.",

    "condition.bitten.name": "Bite",
    "condition.fever.name": "Fever",
    "condition.dysentery.name": "Dysentery",
    "condition.sprain.name": "Sprained ankle",

    "weather.clear": "Clear skies.",
    "weather.heat": "The heat is brutal today. The canteen empties twice as fast.",
    "weather.rain": "Rain all day. It fills the canteen and hides the horizon.",
    "weather.fog": "Fog to the knees. You cannot see past the next rise.",

    "weather.clear.name": "Clear",
    "weather.heat.name": "Heat",
    "weather.rain.name": "Rain",
    "weather.fog.name": "Fog",

    "log.camp": [
      "You build a windbreak, light a fire, and let it burn down slowly.",
      "Wood, a windbreak, and a fire you keep small on purpose.",
      "You make camp properly for once, and the night is easier for it.",
    ],

    "ambient.general": [
      "Somewhere behind you a bird gives up and goes quiet.",
      "The wind changes direction and brings nothing with it.",
      "You stop, listen for a while, and hear only your own blood.",
      "A distant howl, too far off to matter tonight.",
      "Clouds move across the sun and the country changes colour.",
      "You find a stone in your boot and lose ten minutes to it.",
      "The light goes flat and everything looks the same distance away.",
    ],

    "ambient.terrain.forest": [
      "Something moves in the undergrowth and does not move again.",
      "The pines close overhead and the sound goes out of the world.",
      "Deer tracks, a day old, running the other way.",
    ],
    "ambient.terrain.swamp": [
      "Gas breaks the surface somewhere off to your left.",
      "The water here has not moved in a long time and smells of it.",
      "Frogs stop when you step, and start again behind you.",
    ],
    "ambient.terrain.mountain": [
      "Rock ticks as it cools in the shade.",
      "From up here the country goes on further than you would like.",
      "A stone comes loose and you listen to it all the way down.",
    ],
    "ambient.terrain.river": [
      "The water runs loud enough that you keep checking behind you.",
      "Something rises, takes an insect, and is gone.",
      "The far bank looks easier. It always does.",
    ],
    "ambient.terrain.desert": [
      "Heat comes off the ground in sheets and the horizon moves.",
      "Your own tracks are gone within the hour.",
      "Nothing here has needed a name in a long time.",
    ],
    "ambient.terrain.open": [
      "Grass to the knee, and nothing in it.",
      "You can see a long way and there is nothing to see.",
      "The ground rises so gently that you only notice on the way down.",
    ],

    "ambient.weather.heat": [
      "The air over the ground bends and will not hold still.",
      "You ration the sweat as much as the water, and lose both.",
    ],
    "ambient.weather.rain": ["Rain finds the gap at your collar and stays there.", "Everything smells of wet stone and cold ash."],
    "ambient.weather.fog": [
      "The fog takes the sound out of your own footsteps.",
      "Shapes at the edge of sight resolve into nothing, twice.",
    ],

    "log.campImpossible": "There is nothing here to build a camp with.",
    "log.treated": "You clean up what needed cleaning up.",

    "end.win.title": "You made it out",
    "end.loss.title": "The wild kept you",
    "end.days": "Days survived",
    "end.hexes": "Hexes travelled",
    "end.forcedMarches": "Forced marches",
    "end.health": "Health left",
    "end.water": "Water left",
    "end.food": "Food left",
    "end.seed": "Seed",
    "end.recorded": "Recorded",
    "end.notRecorded": "Not recorded",
    "end.cheated": "Cheats were used on this expedition.",
    "end.route": "The way you went",
    "end.moments": "What happened",
    "end.achievements": "Earned on this expedition",
    "end.journal": "The full journal",

    "chronicle.outcome": "Outcome",
    "chronicle.date": "Date",
    "chronicle.map": "The way you went",
    "chronicle.moments": "What happened",
    "chronicle.achievements": "Earned",
    "chronicle.difficulty": "Difficulty",
    "chronicle.mapSize": "Map",
    "chronicle.legend.start": "where you started",
    "chronicle.legend.route": "where you walked",
    "chronicle.legend.end": "where it ended",
    "chronicle.legend.unseen": "never seen",

    "achievement.firstExpedition.name": "Out the door",
    "achievement.firstExpedition.description": "Finish an expedition, either way.",
    "achievement.wayOut.name": "Way out",
    "achievement.wayOut.description": "Walk out of the wild alive.",
    "achievement.tenDays.name": "Ten days",
    "achievement.tenDays.description": "Stay out there for ten days.",
    "achievement.swift.name": "Straight line",
    "achievement.swift.description": "Get out in five days or fewer.",
    "achievement.parched.name": "Last mouthful",
    "achievement.parched.description": "Get out with an empty canteen.",
    "achievement.unscathed.name": "Not a scratch",
    "achievement.unscathed.description": "Get out at full health, without forcing a single march.",
    "achievement.roadWise.name": "Road wise",
    "achievement.roadWise.description": "Get out with a third of the journey spent on trails.",
    "achievement.walkItOff.name": "Walk it off",
    "achievement.walkItOff.description": "Get out carrying a wound, without sleeping in a cabin.",
    "achievement.straightToIt.name": "Straight to it",
    "achievement.straightToIt.description": "Find who you are looking for without checking a single false sign.",
    "achievement.stretcherBearer.name": "Stretcher bearer",
    "achievement.stretcherBearer.description": "Carry somebody out on your back.",
    "achievement.outran.name": "Outran them",
    "achievement.outran.description": "Reach a border ahead of whoever is following you.",
    "achievement.longHaul.name": "Long haul",
    "achievement.longHaul.description": "Get out of a map larger than the standard one.",

    "progress.title": "Your record",
    "progress.unavailable": "Your record could not be loaded.",
    "progress.records": "Personal bests",
    "progress.records.empty": "Finish an expedition and it shows up here.",
    "progress.records.scenario": "Expedition",
    "progress.records.mapSize": "Map",
    "progress.records.attempts": "Runs",
    "progress.records.wins": "Escaped",
    "progress.records.best": "Fastest",
    "progress.records.longest": "Longest",
    "progress.streak": "Daily challenge",
    "progress.streak.current": "Current streak",
    "progress.streak.longest": "Longest streak",
    "progress.streak.days": "{days} days",
    "progress.streak.today": "Today is in it.",
    "progress.streak.notToday": "Today is still open.",
    "progress.streak.none": "You have not taken the daily challenge yet.",
    "progress.achievements": "Marks",
    "progress.achievements.count": "{earned} of {total}",
    "progress.locked": "Locked",
    "progress.unlock.finished": "Finish {count} expeditions",
    "progress.unlock.wins": "Escape {count} times",
    "progress.unlock.both": "Finish {count} expeditions, {wins} of them alive",
    "progress.unlock.refused": "That expedition is not unlocked yet.",

    "action.progress": "Your record",
    "action.copyReport": "Copy the report",
    "action.reportCopied": "Report copied",
    "action.details": "Details",

    "condition.effect.movement": "one movement point fewer",
    "condition.effect.rough": "rough ground costs more",
    "condition.effect.vision": "you see less of the map",
    "condition.effect.forcedMarch": "forcing a march costs more health",
  };

  /**
   * Every variant a key has (WP-52). A plain string is a pool of one, so callers
   * never have to care which kind of entry they are looking at.
   */
  function variants(key) {
    if (!Object.prototype.hasOwnProperty.call(EN, key)) return [key];
    const entry = EN[key];
    return Array.isArray(entry) ? entry : [entry];
  }

  function count(key) {
    return variants(key).length;
  }

  /**
   * Look up a string and fill in {placeholders}. An unknown key returns itself,
   * loudly enough to spot on screen and harmless enough not to crash the run.
   *
   * `index` picks a variant; without it the first one is used, so anything that
   * has to stay put — a button label — stays put.
   */
  function t(key, params, index) {
    const pool = variants(key);
    let text = pool[(((index || 0) % pool.length) + pool.length) % pool.length];

    if (params) {
      text = text.replace(/\{(\w+)\}/g, (match, name) =>
        Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
      );
    }
    return text;
  }

  function has(key) {
    return Object.prototype.hasOwnProperty.call(EN, key);
  }

  return { EN, t, has, variants, count };
});
