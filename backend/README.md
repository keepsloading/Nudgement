# Boundier Backend (Optional)

This Flask backend is optional. The extension runs local-first scoring without it.

## Purpose

- Expose a local `/analyze` endpoint for experimentation
- Keep scoring and data handling on your own machine
- Allow opt-in storage for local history/training records

## Privacy and storage

- Host binds to `127.0.0.1` only
- Analysis history/training data are local files under `storage/`
- If you do not want history, do not run backend endpoints that write it (or disable writes in code)

## Run

```bash
pip install -r requirements.txt
python app.py
```
