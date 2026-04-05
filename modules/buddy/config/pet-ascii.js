/**
 * ASCII Art Templates for all pet species
 * Pre-defined ASCII art that can be customized with different eyes
 */

const PETS_ASCII = {
  swan: `
      (o)_
     /  |
    (   |
     \  \
      )  )
     /  /
    /  /
  `,

  flamingo: `
      /¯¯\\
     /  o  \\
    |   |   |
     \\  |  /
      \\___/
        |
       / \\
      /   \\
  `,

  cat: `
     /\\_/\\
    ( o.o )
     > ^ <
    /  |  \\
   (___|___)
  `,

  penguin: `
     .--.
    /  o \\
   |  o  |
    \`--'/
    /|  |\\
     /  \\
  `,

  hedgehog: `
     / o \\
    ( o_o )
     \\ * /
      \\_/
  `,

  otter: `
      /o o\
     (  ~  )
      \   /
       | |
      /| |\
     (_|_|_)
  `,

  squirrel: `
      |\
     /|\
    / o o\
   (  ^  )
    \   /
     \_/
  `,

  slime: `
     .''''.
   /  o o  \\
  |    ^    |
   \\  ~~~  /
    '......'
  `,

  raven: `
      .-.
     /o o \
    (  >  )
     \   /
      {-}
     /   \
    /     \
  `,

  koi: `
      ~~~
     ( o o )
    /   >   \
   /  ~~~   \
  |_________|
  `,

  fox: `
     /\\_/\\
    ( o.o )
     > ^ <
    /| | |\\
   (_|_|_|_)
  `,

  panda: `
     /\\ /\\
    ( o.o )
     > ω <
    \\  |  /
     \\ | /
      ( )
  `,

  bee: `
      /\\
     /  \\
    ( o  o )
     \\  /
      \\/
  `,

  jellyfish: `
       ( )
      ( o )
       ) (
      /   \
     |  ~  |
      \ ~ /
       | |
  `,

  phoenix: `
        /\\
       /  \\
      / oo  \\
     (   ~~   )
      \\  \/  /
       |/__\\|
       |  ||
  `,

  alien: `
      .--.
     /  o  \\
    |  (o)  |
     \\  u  /
      '--'
     /|   |\\
    (_|_ _|_)
  `,

  dragon: `
      /\\___/\\
     ( o   o )
    /|  ^ ^  |\\
   /_|  -_-  |_\\
      /   \\
     /_/ \\_\\
  `,

  chonk: `
     /^ ^\\
    / o o \\
   /   ▽   \\
   |  ---  |
    \\_____/
  `,
};

/**
 * Apply custom eyes to ASCII art
 * Replaces generic eye character with the chosen eye style
 */
function applyEyesToAscii(ascii, eyeChar = "o") {
  return ascii.replace(/o/g, eyeChar);
}

/**
 * Get ASCII art for a species with custom eyes
 */
function getAscii(species, eyeChar = "◉") {
  if (!PETS_ASCII[species]) {
    throw new Error(`getAscii: unknown species '${species}'`);
  }
  return applyEyesToAscii(PETS_ASCII[species], eyeChar);
}

module.exports = {
  PETS_ASCII,
  applyEyesToAscii,
  getAscii,
};
