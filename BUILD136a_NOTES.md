# Build 136a — shop Messenger button on computers

Deploy: commit and push (no database change). Checks: TypeScript clean, `next build` passes.

On computers Facebook now forwards `m.me/<page>` links to the Messenger home page (checked: `m.me/Pili.Aire` lands on messenger.com), so the chat with the page does not open.
- Phones: unchanged — the m.me link opens a chat with the page in the Messenger app, message filled in.
- Computers: the Messenger buttons open the Facebook page (`facebook.com/Pili.Aire`), whose **Message** button starts the chat; on an item page the prepared message (item, price, link) is copied and a note says to paste it.
