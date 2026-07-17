/**
 * POST /api/analyze
 * Server-side scoring using the same NudgementScorer used inside the extension.
 * The scorer.js file is loaded directly — no duplication, always in sync.
 */
import { Router, type Request, type Response } from "express";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";
import { randomUUID } from "crypto";

// Load the UMD/CJS scorer from the extension directory.
// Use process.cwd() (which is artifacts/api-server/ at runtime) rather than __dirname
// (which points to dist/ after compilation, not the source tree).
const _require = createRequire(import.meta.url);
const scorerPath = path.resolve(process.cwd(), "../../nudgement-extension/scorer.js");

let scoreContent: (content: Record<string, unknown>, id: string) => Record<string, unknown>;
let ENGINE_VERSION: string;

try {
  const scorer = _require(scorerPath) as {
    scoreContent: typeof scoreContent;
    ENGINE_VERSION: string;
  };
  scoreContent = scorer.scoreContent;
  ENGINE_VERSION = scorer.ENGINE_VERSION;
} catch (err) {
  // Fail fast at startup if scorer can't be loaded
  throw new Error(`NudgementScorer failed to load from ${scorerPath}: ${err}`);
}

const router = Router();

/**
 * POST /api/analyze
 * Body: { headline?, snippet?, byline?, surface?, url?, host?, site_name?, page_title?, word_count?, hash? }
 * Returns: nudgemeter_score, nudge_profile, top_signals, explanations, ...
 */
router.post("/analyze", (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const headline = String(body.headline ?? "").trim();
  const snippet = String(body.snippet ?? "").trim();

  if (!headline && !snippet) {
    res.status(400).json({ error: "Missing required fields: headline or snippet" });
    return;
  }

  const content = {
    headline,
    byline:     String(body.byline     ?? "").trim(),
    snippet,
    surface:    String(body.surface    ?? "page"),
    url:        String(body.url        ?? ""),
    host:       String(body.host       ?? ""),
    site_name:  String(body.site_name  ?? ""),
    page_title: String(body.page_title ?? ""),
    word_count: Number(body.word_count) || 0,
    hash:       String(body.hash       ?? ""),
  };

  try {
    const result = scoreContent(content, randomUUID());
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Scoring failed", detail: String(err) });
  }
});

export { ENGINE_VERSION };
export default router;
