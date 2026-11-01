# Gloam

A small survivors-like you can play in the browser. Move through a dark field, let your bolt fire on its own, pick up the gems enemies drop, and choose an upgrade each time you level. The run ends when your health reaches zero.

Everything on screen is drawn with canvas shapes and CSS. There are no image assets and no third-party libraries.

## Run

Open `index.html` in a browser.

Or serve the folder and open the printed address:

```bash
python3 -m http.server 8080
```

No install step and no build.

## Controls

- **Move:** `W` `A` `S` `D` or the arrow keys
- **Touch:** press and drag anywhere on the field. A stick appears under your finger. A mouse drag does the same.
- **Attack:** automatic, toward the nearest enemy
- **Level up:** the run pauses. Click one of up to three arts, or press `1` `2` `3`
- **Sound:** the button in the corner, or `M`
- **After you fall:** `Face the night again`, or press `Enter` or `R`

Health, experience, level, time survived, and kills stay along the top of the screen.

## What a run is

Shamblers arrive first. Skitters show up soon after and can catch you. Brutes are slow, large, and drop three gems. Standing in a crowd blocks your path and chips your health. Gems fly to you only from a short distance, so curve back through the trail you leave behind. Magnetism makes that reach longer. Each level offers a random handful of upgrades: damage, attack speed, extra bolts, move speed, pickup range, health, pierce, bolt size, or regeneration.
