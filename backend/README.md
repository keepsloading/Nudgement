Technical Specifications: Boundier Browser Extension
1. Overview
Boundier is an ambient AI browser extension that analyzes social media feeds, reels, and news articles in real-time to detect manipulative tactics (e.g., outrage hooks, FOMO bait, pity traps, fake urgency, dopamine spikes) using the AIM (Artificial Influence Mapping) framework. It provides live AIM scores, notification bar cues, and post-session Watch Summaries with emotional balance charts, cognitive value breakdowns, and content quality reports. The extension supports content fingerprinting, caching, and a creator dashboard for AIM self-checks and score disputes. Designed for battery efficiency and privacy, it operates in the background with plug-in and mobile support.
2. Requirements
2.1 Functional Requirements

Content Analysis:
Multimodal analysis (text, audio, video) for social feeds, reels, and news.
Calculate AIM Score (0-100) based on Affect, Intent, and Manipulation.
Flag manipulative tactics: outrage hooks, FOMO bait, pity traps, fake urgency, dopamine spikes.


User Feedback:
Display live AIM scores and flags via notification bar cues (non-intrusive).
Award ARC (Attention Resilience Credits) for avoiding high-AIM content.
Provide Watch Summary post-session with:
Emotional balance charts (e.g., arousal vs. valence).
Cognitive value breakdowns (e.g., informational vs. manipulative).
Content quality reports (e.g., credibility, bias).




Content Fingerprinting:
Identify reposted content using SHA256 hashing of text, audio spectrograms, and video keyframes.
Cache scores for instant alerts on revisited content.


Creator Tools:
AIM self-check dashboard for creators to evaluate content before posting.
Dispute portal for challenging flagged AIM scores.


SIR Development:
Train users’ Subconscious Influence Reflex (SIR) through consistent feedback.



2.2 Non-Functional Requirements

Performance:
Real-time analysis: <100ms for headline/text, <500ms for multimodal (text + audio/video).
Battery-efficient: Minimal CPU/memory usage (<5% CPU on average).


Privacy: No storage of personal content; only metadata and hashes persisted.
Scalability: Support caching of 10,000 content fingerprints.
Reliability: Handle API rate limits and network failures with retries and fallbacks.
Compatibility: Support Chrome, Firefox, Edge; mobile via WebView.

3. System Architecture
3.1 Components

Client-Side (Browser Extension):
content.js: Extracts content (text, audio, video metadata) from DOM and triggers analysis.
background.js: Manages API requests, caching, ARC tracking, and notification bar updates.
popup.js/html/css: Renders Watch Summary, creator dashboard, and dispute portal.


Server-Side (Flask Backend):
app.py: Processes /analyze and /is_social endpoints, integrating multimodal AI models.


External Services:
OpenRouter API: Text and multimodal analysis (DeepSeek, Qwen models).
WebAssembly (WASM) Module: Lightweight on-device audio/video feature extraction.
Redis: In-memory cache for fingerprint-to-score mappings.



3.2 Data Flow

content.js detects feed/reel/news content via DOM changes and extracts text, audio metadata (e.g., spectrograms), and video keyframes.
Content is fingerprinted (SHA256 hash) and sent to background.js.
background.js checks Redis cache for existing scores; if absent, queues request to /analyze.
app.py processes requests:
Validates content type via /is_social.
Performs multimodal AIM analysis (text via OpenRouter, audio/video via WASM).
Caches results in Redis and analysis.json.
Appends to training_data.json for model context.


background.js updates notification bar with AIM score/flags and awards ARC.
popup.js retrieves cached Watch Summary data for visualization.
Creator dashboard and dispute portal interact with app.py via dedicated endpoints.

4. Implementation Details
4.1 Client-Side (Extension)

Language: JavaScript (ES6+), WebAssembly (Rust for audio/video processing)
Environment: Chrome Extension API, WebExtensions API
Key Functions (content.js):
extractContent(): Parses DOM for text (<p>, <h1>, <title>), audio (<audio> src or Web Audio API), and video (<video> keyframes via canvas).
fingerprintContent(): Computes SHA256 hash of text + audio spectrogram + video keyframe features.
triggerAnalysis(full=false): Debounces requests (2000ms), validates data, and sends to background.js.
monitorDOM(): Uses MutationObserver to detect dynamic content (e.g., infinite scroll).


Key Functions (background.js):
requestQueue: Serializes API calls to prevent rate limits.
updateNotificationBar(score, flags): Displays AIM score and flags (e.g., “FOMO bait detected”).
trackARC(): Increments ARC for low-AIM content (<40) based on user dwell time.
cacheResult(hash, result): Stores results in chrome.storage.local and Redis.


Key Functions (popup.js):
renderWatchSummary(): Visualizes emotional balance (D3.js charts), cognitive value, and quality reports.
renderCreatorDashboard(): Displays AIM self-check results and dispute form.


Error Handling:
Validates headline and hash before requests.
Falls back to neutral score (50) on API failure.
Logs errors to console with requestId.



4.2 Server-Side

Language: Python 3.8+
Framework: Flask
Dependencies:
requests: OpenRouter API integration.
transformers: DistilBERT for text sentiment analysis.
redis-py: Redis cache client.
python-dotenv: API key management.
librosa (optional): Audio feature extraction for local processing.


Endpoints:
/is_social: Classifies content as social media/reel/news using OpenRouter.
/analyze: Computes AIM scores, processes multimodal inputs, and caches results.
/creator_check: Analyzes draft content for creators.
/dispute: Handles score dispute submissions.


Storage:
analysis.json: Stores up to 10,000 analysis results (FIFO).
training_data.json: Stores input/output pairs (max 3 examples in prompt).
Redis: In-memory cache for fingerprint-to-score mappings (TTL: 7 days).


Multimodal Processing:
Text: OpenRouter API (DeepSeek model) for lexical, syntactic, and framing analysis.
Audio: WASM module extracts spectrogram features (e.g., pitch, intensity) for emotional cues.
Video: WASM module extracts keyframe features (e.g., color histograms, motion vectors) for visual manipulation cues.


Error Handling:
Retries API calls (4 attempts, backoff: 1s, 2s, 4s).
Returns neutral score (50) with placeholder phrases on failure.
Deduplicates top_phrases to ensure semantic diversity.



4.3 External Services

OpenRouter API:
Models: deepseek/deepseek-r1-0528:free (primary), qwen/qwen-2.5-72b-instruct:free (fallback).
Parameters: temperature=0.0, seed=42.
Timeout: 2s (text), 5s (multimodal).


WASM Module:
Rust-based for audio spectrogram and video keyframe extraction.
Runs in browser to minimize server load.


Redis:
Stores fingerprint-to-score mappings (key: hash, value: JSON result).
Configuration: 10,000 entry limit, 7-day TTL.



5. Performance Optimizations

Client-Side:
Debounce analysis requests (2000ms) to handle dynamic feeds.
Use WASM for on-device audio/video processing (<100ms).
Cache results in chrome.storage.local and Redis for instant retrieval.
Lazy-load popup data to reduce memory usage.


Server-Side:
Skip sentiment analysis in fast mode (text-only).
Cache multimodal features in Redis to avoid redundant processing.
Serialize API requests to prevent rate limits (429 errors).


Battery Efficiency:
Throttle MutationObserver to 2000ms intervals.
Limit WASM processing to key moments (e.g., scroll pause).
Use lightweight DistilBERT model for sentiment.



6. Security and Privacy

API Key: Stored in .env, loaded via python-dotenv.
Data Privacy:
No personal content stored; only hashes and metadata persisted.
Anonymized dispute submissions.


Content Fingerprinting: SHA256 ensures unique, non-reversible identifiers.
Rate Limiting: Client-side queue and server-side retries mitigate API abuse.

7. Testing Plan

Unit Tests:
content.js: Validate content extraction, fingerprinting, and request validation.
background.js: Test queue, caching, ARC tracking, and notification updates.
app.py: Test endpoint logic, multimodal processing, and Redis integration.


Integration Tests:
End-to-end flow: content detection → fingerprinting → analysis → notification/Watch Summary.
Test on social platforms (e.g., X, Instagram reels) and news sites.


Performance Tests:
Measure latency: <100ms (text), <500ms (multimodal).
Monitor CPU/memory usage (<5% CPU).
Validate cache hit rate (>80% for reposts).


Stress Tests:
Simulate rapid scrolling on infinite feeds.
Test API rate limit handling (429 errors).

