# Daily Expenses Tracker (PHP ₱)

**Live:** https://expense-tracker-ba77f451.deed.page/

**Repo:** https://github.com/MAYZRAVIZ/expense-tracker

Mobile-first offline expense tracker for the Philippines.

- English UI · Asia/Manila dates · PHP peso formatting
- Quick add expense / income · categories · Cash/GCash/Maya/Card/Bank
- Today totals · daily/weekly/monthly stats (inline SVG charts)
- Monthly budget · search/filter · edit/delete
- Export CSV · Export/Import JSON · Load sample data
- PWA (Add to Home Screen) + service worker cache-first offline

## Run locally

Open `index.html` in a browser, or:

```bash
python3 -m http.server 8765
```

Data stays in **localStorage** on that browser only.

## Folder

```
expense-tracker/
  index.html
  sw.js
  manifest.webmanifest
  css/styles.css
  js/app.js
  icons/
  screenshots/
```
