import httpx

from app.adapters.models.openai_compat import OpenAICompatClient, _http_error_summary


def test_http_error_summary_names_empty_read_timeout():
    assert _http_error_summary(httpx.ReadTimeout("")) == "ReadTimeout"


def test_http_error_summary_keeps_non_empty_message_with_type():
    assert _http_error_summary(httpx.ConnectError("server disconnected")) == (
        "ConnectError: server disconnected"
    )


def test_direct_network_mode_ignores_environment_proxy(monkeypatch):
    calls = []

    class DummyAsyncClient:
        def __init__(self, **kwargs):
            calls.append(kwargs)

    monkeypatch.setattr("app.adapters.models.openai_compat.httpx.AsyncClient", DummyAsyncClient)
    client = _client(network_mode="direct")

    client._http_client()

    assert calls[-1]["trust_env"] is False
    assert "proxy" not in calls[-1]


def test_environment_network_mode_uses_environment_proxy(monkeypatch):
    calls = []

    class DummyAsyncClient:
        def __init__(self, **kwargs):
            calls.append(kwargs)

    monkeypatch.setattr("app.adapters.models.openai_compat.httpx.AsyncClient", DummyAsyncClient)
    client = _client(network_mode="system")

    client._http_client()

    assert client.network_mode == "environment"
    assert calls[-1]["trust_env"] is True
    assert "proxy" not in calls[-1]


def test_proxy_network_mode_uses_only_configured_proxy(monkeypatch):
    calls = []

    class DummyAsyncClient:
        def __init__(self, **kwargs):
            calls.append(kwargs)

    monkeypatch.setattr("app.adapters.models.openai_compat.httpx.AsyncClient", DummyAsyncClient)
    client = _client(network_mode="proxy", proxy_url=" http://127.0.0.1:7890 ")

    client._http_client()

    assert client.proxy_url == "http://127.0.0.1:7890"
    assert calls[-1]["trust_env"] is False
    assert calls[-1]["proxy"] == "http://127.0.0.1:7890"


def _client(*, network_mode: str, proxy_url: str = "") -> OpenAICompatClient:
    return OpenAICompatClient(
        api_key="sk-test",
        base_url="https://example.com",
        chat_model="chat",
        vision_model="vision",
        network_mode=network_mode,
        proxy_url=proxy_url,
    )
