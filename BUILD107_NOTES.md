# Build 107: catalogue search by words

Deploy after 106. Unzip into desktop\ipa (folder paths are kept), then run `supabase db push`. There is one migration: 20270112_catalog_word_search.sql. Then run git add -A, commit, push, and wait for Vercel to show "Ready".

No files to delete.

## What changed
Search now matches word by word, in any order, and partial words count:
- "blower inno" finds BLOWER MOTOR, TOYOTA INNOVA.
- "inno blower" finds the same item.
- "innova" finds every Innova item.
- "toyota denso" finds Toyota items of the Denso brand.

Every word you type must appear somewhere in the item: the name, code, generic item, brand, description or category. Upper and lower case don't matter, and commas are ignored. So each extra word narrows the list.

This applies to these screens:
- Agent app catalogue
- Storefront / product search
- PO and PR line item picker
- Procurement catalogue list
- Catalogue photos page
- Price Review

## Tested
- proof107: 7 checks
- Full replay of 78–107: 0 failures
- tsc and next build pass
