import "dotenv/config";
import path from "node:path";
import express from "express";
import { listRepos, upsertRepo, updateManualFields, getRepo, markNoteSent } from "./db.js";
import { syncRepos, sendNoteToClaude } from "./github.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.resolve("public")));

app.get("/api/repos", (req, res) => {
  res.json(listRepos());
});

app.post("/api/sync", async (req, res) => {
  try {
    const rows = await syncRepos({
      token: process.env.GITHUB_TOKEN,
      affiliation: process.env.GITHUB_AFFILIATION || "owner",
    });
    for (const row of rows) upsertRepo(row);
    res.json({ synced: rows.length, repos: listRepos() });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.patch("/api/repos/:id", (req, res) => {
  const id = Number(req.params.id);
  const { status, progress_note, goals, next_steps } = req.body ?? {};
  const updated = updateManualFields(id, { status, progress_note, goals, next_steps });
  if (!updated) return res.status(404).json({ error: "Repo not found" });
  res.json(updated);
});

app.post("/api/repos/:id/send-to-claude", async (req, res) => {
  const id = Number(req.params.id);
  const note = (req.body?.note ?? "").trim();
  if (!note) return res.status(400).json({ error: "Note is required" });

  const repo = getRepo(id);
  if (!repo) return res.status(404).json({ error: "Repo not found" });

  try {
    await sendNoteToClaude({
      token: process.env.GITHUB_TOKEN,
      fullName: repo.full_name,
      branch: repo.default_branch || "main",
      note,
    });
    res.json(markNoteSent(id));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Trackerator running at http://localhost:${PORT}`);
});
