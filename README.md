# Gloam

A small survivors-like you can play in the browser. Move through a dark field, let your bolt fire on its own, pick up the gems enemies drop, and choose an upgrade each time you level. The run ends when your health reaches zero.

Everything on screen is drawn with canvas shapes and CSS. There are no image assets and no third-party libraries.

## Play on your phone

After this is merged to `main` and GitHub Pages is pointed at Actions, the game is served over HTTPS at:

**https://devyeonhoju-tech.github.io/codex/**

That address stays put. It updates a minute or two after each push to `main`. On a phone, drag anywhere on the field to move. The page does not scroll or pinch-zoom while you play, and turning the phone refits the field.

This pull request cannot flip the repository setting. Pages is not enabled yet. Do this once, as the repo owner:

1. Merge the pull request into `main`.
2. On GitHub, open **Settings → Pages** for `devyeonhoju-tech/codex`.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. Open the **Actions** tab. The workflow **Deploy Gloam to GitHub Pages** starts on the merge. If it does not, choose that workflow and press **Run workflow**. If GitHub asks you to approve the `github-pages` environment, approve it.
5. When the run is green, open https://devyeonhoju-tech.github.io/codex/ on your phone.

The first visit can take a minute while the certificate is issued. A 404 right after the run finishes usually means the site is still propagating. Reload once.

## Run locally

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
