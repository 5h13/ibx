# Build 136d — shop: the item message is copied for Messenger and Viber

Deploy: commit and push (no database change). Checks: TypeScript clean, `next build` passes.

Messenger (for pages) and Viber do not reliably fill in a message from a link. Tapping **Messenger** or **Viber** on an
item page now copies the prepared message (item, price, availability question, link) in the same tap, then opens
the chat; a note says to press and hold the message box and choose Paste. The links still carry the message where
an app supports it. Text (SMS) keeps filling the message in as before.
