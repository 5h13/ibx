# Build 102c: share the photo on screen, and the 5H13 launch screen

Deploy this after 102b.

## How to deploy
1. Unzip into desktop\ipa. The folder paths are kept.
2. Run `git add -A`.
3. Commit and push.
4. Wait for Vercel to show "Ready".

There is no database change and no files to delete. Two icon files are replaced.

## What changed

### Share as image uses the photo on screen
- Swipe to the photo you want, then tap Share as image. The card uses that photo.
- Dots under the photos show which one is selected.
- On a computer, click a photo to pick it.

### Launch screen
- The phone's own start screen is now the 5H13 blue instead of white. The phone draws this screen and can only use one colour.
- The app then shows the 5H13 logo on the blue-to-red background for about one second, and it fades out.
- This only happens when the app is opened from the home screen.
- The white corners were removed from the app icons, so the logo sits cleanly on the blue.

## To see the launch screen
An installed app picks up the new start colour by itself within about a day. To see it straight away, remove the app from the home screen and install it again.
