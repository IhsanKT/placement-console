# Placement Console

A personal tracker for upcoming placement tests: company, round, date, time, platform and notes.

- **Live countdown** to the next test
- **Auto status**: tests turn *Today* → *In progress* → *Completed* (greyed out) on their own
- **Edit / reschedule**: changing the date or time keeps the old slot and tags the test as *Rescheduled*
- **Laptop ↔ phone sync** through a private Gist on your own GitHub account
- Search and filter (Upcoming / Completed / All); press `N` to add a test

## Turning on sync

1. Open the site on your laptop and click **Sync off** (top right).
2. Follow the link to create a GitHub key with only the **gist** permission, paste it, press **Connect**.
3. Scan the QR code that appears with your phone. Done — both devices now share one schedule.

Every device keeps a full local copy, so the site still works offline. When devices sync, the newest edit to
each test wins and deletions carry across. The key is stored only in your browser; "Turn off sync" removes it.

Single static `index.html`, hosted on GitHub Pages.
