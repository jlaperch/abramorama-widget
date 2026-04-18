# Abramorama Widget — Setup

How to get this repo running locally and connected to a Claude Project for ongoing iteration.

---

## Prerequisites

- Mac or Windows with Git installed (Mac: Xcode Command Line Tools, Windows: Git for Windows)
- Node.js 18+ and npm
- Access to this GitHub repo: https://github.com/jlaperch/abramorama-widget
- Claude desktop app (for full Project + Cowork/Code integration)

---

## 1. Clone the Repo Locally

Pick where you want the repo to live. If you're using it with a Claude Project, put it in a predictable spot like `~/Documents/Claude/Projects/Abramorama Widget`.

```bash
cd ~/Documents/Claude/Projects
git clone https://github.com/jlaperch/abramorama-widget.git "Abramorama Widget"
cd "Abramorama Widget"
```

---

## 2. Install Dependencies (Only Needed for Local Dev)

If you want to run the widget locally to test before pushing:

```bash
npm install
npm run dev
```

That spins up a Vite dev server at http://localhost:5173. Changes hot-reload.

You don't need to do this step just to edit code and push. Vercel builds from GitHub on every push to main, so for most edits you can just change, commit, and push.

---

## 3. Connect to a Claude Project

1. In Claude desktop app, create a new Project named "Abramorama Widget"
2. In the Project's **Context** panel, click **+** and add the local folder `~/Documents/Claude/Projects/Abramorama Widget`
3. In the **Instructions** panel, paste the contents of `abramorama-widget-project-context.md` (in the repo root). This gives every chat baseline context on version, architecture, gotchas, and current backlog.
4. Start a new chat inside the Project to confirm Claude can read the repo files

---

## 4. Daily Workflow

**Pull latest before starting work:**
```bash
cd ~/Documents/Claude/Projects/Abramorama\ Widget
git pull
```

**After making changes, ship to production:**
```bash
git add .
git commit -m "short description of change"
git push
```

Vercel auto-deploys on push to `main`. The live widget updates within a minute or two.

**Hard refresh to see changes:**
- Mac: Cmd+Shift+R
- Windows: Ctrl+Shift+R

Refresh both the direct Vercel URL and any Squarespace page embedding the widget.

---

## 5. Key URLs

- **Live app:** https://abramorama-widget.vercel.app
- **Admin (Sterling):** https://abramorama-widget.vercel.app?mode=admin
- **Widget by film ID:** https://abramorama-widget.vercel.app?film=film_1&mode=widget
- **Debug mode:** append `&debug=1` to any widget URL for a live diagnostics panel

---

## 6. Editing Approaches

Pick based on the size of the change:

**Small edit (one line, one block, one function):**
Open the file in any editor, make the change, commit and push. Or ask Claude in a Project chat for the diff and paste it in.

**Medium change (new feature, refactor of one component):**
Ask Claude to produce the full updated file as an artifact. Download, replace locally, test with `npm run dev` if needed, commit and push.

**Large change (multi-file refactor, repo-wide updates):**
Use Claude Code in the desktop app. It can read, edit, and commit directly. Found by hovering the "Chat" icon in the top-left of the Claude desktop app.

---

## 7. Common Gotchas

- **Squarespace embeds:** use a Code Block (`</>`), not an Embed Block (`<>`). Embed strips scripts.
- **Geolocation:** iframe must include `allow="geolocation"` or Near Me silently fails.
- **API keys:** Maps key is referrer-locked to the Vercel domain. Sheets key is unrestricted but scoped to Sheets API only. Don't combine them into one key.
- **Sheet schema changes:** `parseRow()` handles 5, 8, and 10-column formats. Any new schema change must add another branch to that function for backwards compat.

See `abramorama-widget-project-context.md` in the repo root for the full gotchas list and architecture reference.

---

## 8. Troubleshooting

**`git clone` asks for credentials:**
Set up a GitHub Personal Access Token (Settings → Developer settings → Personal access tokens on GitHub), or use GitHub Desktop as a GUI alternative.

**`rmdir` says "Directory not empty":**
Hidden files (like `.DS_Store`) are in there. Run `ls -la` to see them, then `rm -rf "folder name"` if you're sure it's safe to wipe.

**Widget shows "Demo mode" banner in production:**
Someone committed placeholder API key values. Check the top of `src/abramorama-maps.jsx` — real keys should be in place, not `"YOUR_..."`.

**Changes aren't showing on the live widget:**
Hard refresh (Cmd+Shift+R). If still stale, check Vercel dashboard to confirm the deployment succeeded.
