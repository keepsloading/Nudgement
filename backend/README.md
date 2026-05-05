# Boundier Backend (Optional)

This Flask backend is optional. The extension runs local-first scoring without it.

## Purpose

- Provide a local `/analyze` endpoint for experimentation.
- Keep all processing on your own machine.
- Support opt-in local storage for history or training experiments.

## Privacy and storage

- Binds to `127.0.0.1` only.
- Storage is local under `storage/`.
- Do not store page text unless explicitly enabling storage flows.

## Run

```bash
pip install -r requirements.txt
python app.py
```
