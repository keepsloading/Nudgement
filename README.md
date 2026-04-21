# Boundier

Boundier is a local-first browser extension for detecting clickbait, emotional pressure, and manipulative framing on webpages.

It analyzes page text, headlines, social posts, and video-page metadata with a deterministic scoring engine. The extension gives an AIM score, a clickbait score, category breakdowns, and the phrases that triggered concern.

## Project Note

Boundier began as a Gen AI TechGyan hackathon project at IIT Bombay, built in under 30 minutes in March 2025, where it won first prize. I added it to GitHub later because I was not on GitHub during that period; this repository includes the original project with a few cleanup and scoring changes.

## Features

- Local AIM scoring in the extension background worker
- Clickbait, urgency, fear, outrage, polarization, manipulation, certainty, credibility, and engagement-bait signals
- Works across articles, social pages, video pages, and generic webpages
- Popup report with score breakdowns and flagged phrases
- Optional Flask backend for local scoring and future transformer enrichment
- No external LLM or hosted AI API required

## Extension Setup

1. Open `chrome://extensions/`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select the `boundier-extension` folder.
5. Open a normal webpage and click the Boundier icon.

If the extension was just reloaded, refresh any already-open webpage once or use the popup reload button. Browser pages such as `chrome://extensions` cannot be analyzed.

## Optional Backend

The extension scores locally by default. The backend is optional and currently provides a local Flask scoring endpoint that can be extended with transformer-based enrichment.

```bat
cd backend
start_backend.bat
```

Or run directly:

```bash
cd backend
pip install -r requirements.txt
python app.py
```

## Project Structure

```text
boundier-extension/
  manifest.json
  background.js
  content.js
  popup.html
  popup.js
  popup.css
backend/
  app.py
  requirements.txt
  start_backend.bat
LICENSE
README.md
```

## License

Boundier is open source under the MIT License. See `LICENSE`.
