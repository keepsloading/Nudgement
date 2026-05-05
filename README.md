# Boundier

Boundier is a local-first influence-pressure analysis tool for webpages, social feeds, and video page metadata.

It analyzes language-pattern signals with deterministic Rustmeter scoring and provides transparent signal-level explanations.

## What Boundier does

- Scores visible page text locally by default.
- Reports Rustmeter score and category subscores.
- Highlights propaganda-like patterns in wording pressure.
- Supports article, social, video, and general webpage surfaces.

## What Boundier does not do

- It does not judge objective truth.
- It does not classify misinformation or disinformation.
- It does not infer author intent.
- It does not classify people.
- It does not analyze full video or audio unless transcript or visible text is present on the page.

## Extraction and limitations

- Extraction is local and uses targeted selectors, Mozilla Readability (bundled locally), and adaptive readable-block fallback.
- Extraction depends on visible text and can still fail on blocked pages, heavy script rendering, paywalls, or image-only pages.
- Video support analyzes page title, metadata, description, visible text, and available transcript/page text when present.

## Privacy and local-first behavior

- Primary scoring runs locally in the extension.
- No hosted AI API is required.
- No telemetry or analytics is added.
- Optional backend is for localhost experiments only.

## Permissions

- `activeTab`: allows analysis of the current tab when the user clicks the extension.
- `scripting`: allows attaching content scripts when needed for analysis.
- `storage`: stores local analysis cache and settings.

## Optional backend

The backend is separate and optional for local experiments.

```bash
cd backend
pip install -r requirements.txt
python app.py
```

## Testing

```bash
npm test
python -m pytest backend/tests/test_scoring.py
```
