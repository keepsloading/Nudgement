import json
import logging
import math
import os
import re
import uuid
from collections import OrderedDict

from flask import Flask, jsonify, request


ENGINE_VERSION = "local-rules-transformers-1.1"
STORAGE_DIR = "storage"
STORAGE_PATH = os.path.join(STORAGE_DIR, "analysis.json")
TRAINING_DATA_PATH = os.path.join(STORAGE_DIR, "training_data.json")
MAX_ENTRIES = 1000

logging.basicConfig(
    level=logging.INFO,
    filename="backend.log",
    filemode="w",
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
os.makedirs(STORAGE_DIR, exist_ok=True)


SIGNALS = [
    {
        "category": "clickbait",
        "weight": 18,
        "reason": "Curiosity-gap phrasing withholds the key information.",
        "pattern": r"\b(you won't believe|you will not believe|what happens next|what happened next|this is why|the reason why|the truth about|things you need to know|before you|everyone is talking about)\b",
    },
    {
        "category": "clickbait",
        "weight": 15,
        "reason": "Reveal-style wording pushes curiosity before substance.",
        "pattern": r"\b(shocking|shocked|revealed|exposed|secret|hidden|jaw-dropping|mind-blowing|finally discovered|went viral)\b",
    },
    {
        "category": "urgency",
        "weight": 14,
        "reason": "Urgency language pressures quick reaction.",
        "pattern": r"\b(breaking|urgent|act now|right now|immediately|before it's too late|before it is too late|last chance|don't miss|do not miss|must see)\b",
    },
    {
        "category": "fear",
        "weight": 13,
        "reason": "Fear framing emphasizes threat or danger.",
        "pattern": r"\b(warning|dangerous|threat|crisis|disaster|nightmare|collapse|chaos|catastrophe|deadly|risk|panic)\b",
    },
    {
        "category": "outrage",
        "weight": 13,
        "reason": "Outrage framing primes anger before evidence.",
        "pattern": r"\b(furious|outraged|rage|backlash|slammed|blasted|destroyed|humiliated|meltdown|scandal|betrayed)\b",
    },
    {
        "category": "polarization",
        "weight": 14,
        "reason": "Us-vs-them wording increases tribal framing.",
        "pattern": r"\b(us vs them|real americans|anti-national|traitors|enemies of the people|the elites|mainstream media|corrupt media|woke mob|leftists|right-wingers)\b",
    },
    {
        "category": "manipulation",
        "weight": 12,
        "reason": "Coercive wording pushes guilt, shame, or forced agreement.",
        "pattern": r"\b(if you care|share this if|only idiots|wake up|open your eyes|they don't want you to know|they do not want you to know|you are being lied to)\b",
    },
    {
        "category": "certainty",
        "weight": 10,
        "reason": "Absolute certainty can flatten nuance.",
        "pattern": r"\b(always|never|everyone knows|nobody talks about|proves|proof that|undeniable|guaranteed|without question|no doubt)\b",
    },
    {
        "category": "credibility",
        "weight": 9,
        "reason": "Vague attribution weakens verifiability.",
        "pattern": r"\b(experts say|sources say|people are saying|some say|many believe|it is believed|reportedly|allegedly|rumor has it)\b",
    },
    {
        "category": "attention",
        "weight": 10,
        "reason": "Engagement bait asks for interaction instead of understanding.",
        "pattern": r"\b(like and share|share before|comment below|tag someone|subscribe now|watch till the end|watch until the end)\b",
    },
]


def build_sentiment_pipeline():
    try:
        from transformers import pipeline as transformer_pipeline
    except Exception:
        logger.warning("transformers is unavailable; sentiment enrichment disabled")
        return None

    try:
        logger.info("Loading local transformer sentiment model")
        return transformer_pipeline(
            "sentiment-analysis",
            model="distilbert-base-uncased-finetuned-sst-2-english",
        )
    except Exception as exc:
        logger.warning("Transformer sentiment model unavailable: %s", exc)
        return None


sentiment_pipeline = None
sentiment_attempted = False


def clean_text(value):
    return re.sub(r"\s+", " ", value or "").strip()


def clamp(value, low=0, high=100):
    return max(low, min(high, value))


def tokenize(text):
    return re.findall(r"\b[\w'-]+\b", clean_text(text))


def load_analyses():
    try:
        with open(STORAGE_PATH, "r", encoding="utf-8") as file:
            return OrderedDict(json.load(file))
    except FileNotFoundError:
        return OrderedDict()
    except Exception as exc:
        logger.error("Failed to read analysis cache: %s", exc)
        raise


def save_analyses(analyses):
    if len(analyses) > MAX_ENTRIES:
        analyses = OrderedDict(list(analyses.items())[-MAX_ENTRIES:])

    with open(STORAGE_PATH, "w", encoding="utf-8") as file:
        json.dump(analyses, file, indent=2)


def append_training_data(entry):
    try:
        data = []
        if os.path.exists(TRAINING_DATA_PATH):
            with open(TRAINING_DATA_PATH, "r", encoding="utf-8") as file:
                data = json.load(file)

        data.append(entry)
        data = data[-MAX_ENTRIES:]

        with open(TRAINING_DATA_PATH, "w", encoding="utf-8") as file:
            json.dump(data, file, indent=2)
    except Exception as exc:
        logger.warning("Failed to append analysis history: %s", exc)


def detect_content_type(headline, snippet, url):
    url = (url or "").lower()
    text = f"{headline} {snippet}".lower()

    if "youtube.com" in url or "youtu.be" in url:
        return "video"
    if any(host in url for host in ["reddit.com", "twitter.com", "x.com", "instagram.com", "threads.net"]):
        return "social"
    if any(part in url for part in ["/news", "/article", "/story", "/blog"]):
        return "article"
    if re.search(r"\b(breaking|reported|according to|published|updated)\b", text):
        return "article"
    return "page"


def format_host(url):
    match = re.search(r"https?://([^/]+)", url or "")
    if not match:
        return "This page"
    return re.sub(r"^www\.", "", match.group(1))


def collect_matches(headline, byline, snippet):
    headline = clean_text(headline)
    body = clean_text(" ".join(part for part in [byline, snippet] if part))
    all_text = clean_text(" ".join(part for part in [headline, body] if part))
    scores = {
        "clickbait": 0,
        "urgency": 0,
        "fear": 0,
        "outrage": 0,
        "polarization": 0,
        "manipulation": 0,
        "certainty": 0,
        "credibility": 0,
        "attention": 0,
    }
    evidence = []

    for signal in SIGNALS:
        for scope_name, scope_text, multiplier in [
            ("headline", headline, 1.45),
            ("body", body, 1.0),
        ]:
            for match in re.finditer(signal["pattern"], scope_text, flags=re.IGNORECASE):
                phrase = clean_text(match.group(0))
                amount = signal["weight"] * multiplier
                scores[signal["category"]] += amount
                evidence.append(
                    {
                        "phrase": phrase,
                        "reason": signal["reason"],
                        "category": signal["category"],
                        "weight": amount,
                        "location": scope_name,
                    }
                )

    exclamation_count = all_text.count("!")
    question_count = all_text.count("?")
    caps_words = len(re.findall(r"\b[A-Z]{3,}\b", all_text))
    punctuation_pressure = min(18, exclamation_count * 4 + max(0, question_count - 1) * 2)
    caps_pressure = min(16, caps_words * 3)

    if punctuation_pressure:
        scores["clickbait"] += punctuation_pressure
        scores["urgency"] += punctuation_pressure * 0.6
        evidence.append(
            {
                "phrase": "Exclamation-heavy phrasing" if exclamation_count else "Question-heavy phrasing",
                "reason": "Punctuation increases emotional pressure.",
                "category": "clickbait",
                "weight": punctuation_pressure,
                "location": "style",
            }
        )

    if caps_pressure:
        scores["urgency"] += caps_pressure
        scores["manipulation"] += caps_pressure * 0.5
        evidence.append(
            {
                "phrase": "All-caps emphasis",
                "reason": "Capitalized words can simulate shouting or urgency.",
                "category": "urgency",
                "weight": caps_pressure,
                "location": "style",
            }
        )

    return scores, evidence, all_text


def normalize_bucket(raw, word_count):
    length_factor = max(1.15, math.log10(max(word_count, 15)))
    return clamp(round((raw * 5.8) / length_factor))


def transformer_enrichment(text, enabled=False):
    global sentiment_attempted
    global sentiment_pipeline

    if not enabled:
        return {
            "sentiment_label": "unavailable",
            "sentiment_score": 0,
            "emotion_pressure": 0,
            "transformer_status": "disabled",
        }

    if sentiment_pipeline is None and not sentiment_attempted:
        sentiment_attempted = True
        sentiment_pipeline = build_sentiment_pipeline()

    if not sentiment_pipeline or not text:
        return {
            "sentiment_label": "unavailable",
            "sentiment_score": 0,
            "transformer_status": "disabled",
        }

    try:
        result = sentiment_pipeline(text[:512])[0]
        label = result.get("label", "UNKNOWN")
        score = float(result.get("score", 0))
        pressure = round(score * 18) if label == "NEGATIVE" else 0
        return {
            "sentiment_label": label,
            "sentiment_score": round(score, 3),
            "emotion_pressure": pressure,
            "transformer_status": "ok",
        }
    except Exception as exc:
        logger.warning("Transformer sentiment failed: %s", exc)
        return {
            "sentiment_label": "unavailable",
            "sentiment_score": 0,
            "emotion_pressure": 0,
            "transformer_status": "failed",
        }


def build_explanations(aim_score, tactics, content_type, word_count, transformer_status):
    severity = "High" if aim_score >= 70 else "Moderate" if aim_score >= 40 else "Low"
    primary = ", ".join(tactics[:3]) if tactics else "few clear pressure tactics"
    return [
        f"{severity} AIM risk based on deterministic scoring of {content_type} content.",
        f"Primary signals: {primary}.",
        f"Analyzed {word_count} words locally; transformer status: {transformer_status}.",
    ]


def score_content(data, request_id):
    headline = clean_text(data.get("headline", ""))
    byline = clean_text(data.get("byline", ""))
    snippet = clean_text(data.get("snippet", ""))
    url = data.get("url", "")
    content_type = data.get("surface") or detect_content_type(headline, snippet, url)

    scores, evidence, all_text = collect_matches(headline, byline, snippet)
    word_count = max(int(data.get("word_count") or len(tokenize(all_text)) or 1), 1)
    use_transformer = bool(data.get("use_transformer")) and not bool(data.get("fast"))
    enrichment = transformer_enrichment(all_text, enabled=use_transformer)

    if enrichment.get("emotion_pressure"):
        scores["fear"] += enrichment["emotion_pressure"] * 0.45
        scores["outrage"] += enrichment["emotion_pressure"] * 0.35

    normalized = {
        category: normalize_bucket(raw, word_count)
        for category, raw in scores.items()
    }

    affect_score = clamp(round(
        normalized["fear"] * 0.32
        + normalized["outrage"] * 0.30
        + normalized["urgency"] * 0.22
        + normalized["clickbait"] * 0.16
    ))
    intent_score = clamp(round(
        normalized["clickbait"] * 0.34
        + normalized["attention"] * 0.20
        + normalized["urgency"] * 0.18
        + normalized["credibility"] * 0.16
        + normalized["certainty"] * 0.12
    ))
    manipulation_score = clamp(round(
        normalized["manipulation"] * 0.28
        + normalized["polarization"] * 0.24
        + normalized["fear"] * 0.18
        + normalized["outrage"] * 0.14
        + normalized["certainty"] * 0.10
        + normalized["credibility"] * 0.06
    ))
    clickbait_score = clamp(round(
        normalized["clickbait"] * 0.56
        + normalized["urgency"] * 0.18
        + normalized["attention"] * 0.14
        + normalized["certainty"] * 0.12
    ))
    aim_score = clamp(round(
        affect_score * 0.26
        + intent_score * 0.24
        + manipulation_score * 0.30
        + clickbait_score * 0.20
    ))

    deduped = []
    seen = set()
    for item in sorted(evidence, key=lambda entry: entry["weight"], reverse=True):
        phrase_key = item["phrase"].lower()
        if phrase_key in seen:
            continue
        seen.add(phrase_key)
        deduped.append(item)

    top_phrases = [
        {
            "phrase": item["phrase"],
            "reason": item["reason"],
            "category": item["category"],
        }
        for item in deduped[:5]
    ]

    while len(top_phrases) < 3:
        top_phrases.append(
            {
                "phrase": "No strong manipulative phrase found",
                "reason": "The local scorer did not find enough high-confidence signals.",
                "category": "baseline",
            }
        )

    tactics = [
        category
        for category, value in sorted(normalized.items(), key=lambda item: item[1], reverse=True)
        if value >= 28
    ]
    uncertainty = clamp(18 - min(10, len(deduped) * 2) + (5 if word_count < 40 else 0), 6, 22)

    return {
        "affect_score": affect_score,
        "intent_score": intent_score,
        "manipulation_score": manipulation_score,
        "clickbait_score": clickbait_score,
        "aim_score": aim_score,
        "confidence_interval": f"{clamp(aim_score - uncertainty)}-{clamp(aim_score + uncertainty)}",
        "top_phrases": top_phrases,
        "explanations": build_explanations(
            aim_score,
            tactics,
            content_type,
            word_count,
            enrichment.get("transformer_status", "disabled"),
        ),
        "category_scores": normalized,
        "tactics": tactics,
        "content_type": content_type,
        "site_name": clean_text(data.get("site_name", "")) or format_host(url),
        "page_title": clean_text(data.get("page_title", "")) or headline,
        "host": clean_text(data.get("host", "")) or format_host(url),
        "word_count": word_count,
        "source": "local_rules_with_optional_transformer",
        "engine_version": ENGINE_VERSION,
        "transformer": enrichment,
        "request_id": request_id,
    }


@app.route("/is_news", methods=["POST"])
def is_news():
    data = request.json or {}
    headline = clean_text(data.get("headline", ""))
    snippet = clean_text(data.get("snippet", ""))
    url = data.get("url", "")

    if not headline and not snippet:
        return jsonify({"error": "Missing headline or snippet"}), 400

    content_type = detect_content_type(headline, snippet, url)
    return jsonify(
        {
            "is_news": content_type == "article",
            "content_type": content_type,
            "source": "local_heuristic",
        }
    )


@app.route("/analyze", methods=["POST"])
def analyze():
    request_id = str(uuid.uuid4())

    try:
        data = request.json or {}
        request_id = data.get("request_id", request_id)
        headline = clean_text(data.get("headline", ""))
        snippet = clean_text(data.get("snippet", ""))
        hash_ = data.get("hash", "")

        if not hash_ or not (headline or snippet):
            return jsonify({"error": "Missing required fields: hash and text", "request_id": request_id}), 400

        analyses = load_analyses()
        cached = analyses.get(hash_)
        if cached and cached.get("engine_version") == ENGINE_VERSION:
            cached["request_id"] = request_id
            return jsonify(cached)

        result = score_content(data, request_id)
        analyses[hash_] = result
        save_analyses(analyses)
        append_training_data(
            {
                "input": {
                    "headline": headline,
                    "byline": data.get("byline", ""),
                    "snippet": snippet,
                    "url": data.get("url", ""),
                    "surface": data.get("surface", ""),
                },
                "output": result,
            }
        )
        return jsonify(result)

    except Exception as exc:
        logger.exception("Unexpected error in /analyze")
        return jsonify({"error": f"Server error: {exc}", "request_id": request_id}), 500


if __name__ == "__main__":
    logger.info("Starting Boundier local scoring backend")
    app.run(host="127.0.0.1", port=5000, debug=False)
