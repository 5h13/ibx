# Build 104a: launch screen with full-bleed logo, Roboto Condensed and the gold → red → blue shimmer

Deploy after 104:
1. Unzip into desktop\ipa. Folder paths are kept.
2. Run `git add -A`. The new font and icon files must be included.
3. Commit, push, and wait for Vercel "Ready".

There is no database change. No files need deleting; the icon files are replaced.

## What changed
- **Logo:** the colours now run to the edges, with no white border. The "5H13" letters stay inside the area that phones never crop.
  - The same logo is used for the home-screen icon, which loses its white frame too.
  - It is also the icon the phone puts on its own start screen.
- **Layout:** the app's launch screen now matches the phone's own start screen:
  - the logo is in the middle at the same size;
  - "5H13 Business Solutions" is near the bottom in Roboto Condensed, which is included with the app;
  - the top half has the same blue, so when the app takes over, only the bottom half changes to the blue-to-red gradient.
- **Animation:** while the app loads, light sweeps across the name and a soft glow pulses around the logo. Both go gold, then red, then blue, and loop until loading finishes (at least about one second, at most eight). Then the screen fades into the app.
- **Reduced motion:** phones set to "reduce motion" show it still, without the animation.

## To see it
The phone keeps its own start screen and icon from when the app was installed. Remove the app from the home screen and install it again once to get the new icon, with no white border.
