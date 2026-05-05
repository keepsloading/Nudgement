import json

import backend.app as backend_app


def test_score_schema():
    result = backend_app.score_content({"headline": "You won't believe this", "snippet": "Act now"}, "r1")
    assert "rustmeter_score" in result
    assert "aim_score" not in result
    for key in backend_app.CATEGORIES:
        assert key in result["category_scores"]


def test_analyze_endpoint_and_optin_storage(tmp_path, monkeypatch):
    monkeypatch.setattr(backend_app, "STORAGE_DIR", str(tmp_path))
    monkeypatch.setattr(backend_app, "STORAGE_PATH", str(tmp_path / "analysis.json"))
    monkeypatch.setattr(backend_app, "TRAINING_DATA_PATH", str(tmp_path / "training_data.json"))

    client = backend_app.app.test_client()

    no_store_payload = {
        "hash": "no-store",
        "headline": "Experts say",
        "snippet": "many believe",
        "store_training_data": False,
    }
    no_store_resp = client.post('/analyze', json=no_store_payload)
    assert no_store_resp.status_code == 200
    no_store_data = no_store_resp.get_json()
    assert "rustmeter_score" in no_store_data
    assert not (tmp_path / "training_data.json").exists()

    with_store_payload = {
        "hash": "with-store",
        "headline": "Experts say",
        "snippet": "many believe",
        "store_training_data": True,
    }
    with_store_resp = client.post('/analyze', json=with_store_payload)
    assert with_store_resp.status_code == 200
    with_store_data = with_store_resp.get_json()
    assert "rustmeter_score" in with_store_data

    training_path = tmp_path / "training_data.json"
    assert training_path.exists()

    saved = json.loads(training_path.read_text(encoding="utf-8"))
    assert len(saved) == 1
    assert "input" in saved[0]
    assert "output" in saved[0]
    assert "rustmeter_score" in saved[0]["output"]
