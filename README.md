# Placement Console

A personal tracker for upcoming placement tests: company, round, date, time, platform and notes.

- **Live countdown** to the next test
- **Auto status**: tests turn *Today* → *In progress* → *Completed* (greyed out) on their own
- **Edit**: change any detail of a test; the update simply replaces the old entry
- **Awaiting dates**: companies you've applied to that haven't announced a test date sit in a separate
  pop-up (toolbar button), off the main schedule. Press **Add date** once it's announced and the test moves
  onto the main page with its countdown. You can also tick *Test date not announced yet* when adding a test.
- **Laptop ↔ phone sync** through a private Gist on your own GitHub account
- Search and filter (Upcoming / Completed / All); press `N` to add a test

## Turning on sync

1. Open the site on your laptop and click **Sync off** (top right).
2. Follow the link to create a GitHub key with only the **gist** permission, paste it, press **Connect**.
3. Scan the QR code that appears with your phone. Done — both devices now share one schedule.

Every device keeps a full local copy, so the site still works offline. When devices sync, the newest edit to
each test wins and deletions carry across. The key is stored only in your browser; "Turn off sync" removes it.

Static site (`index.html`, `styles.css`, `app.js`), hosted on GitHub Pages.
