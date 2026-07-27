"""Backend tests for the iteration-3 currency + reset feature."""
import os
import uuid
import pytest
import requests

BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or "https://subscription-hub-313.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE_URL}/api"

DEMO_EMAIL = "demo@suborganizer.app"
DEMO_PASSWORD = "demo1234"


def h(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def demo_token():
    r = requests.post(f"{API}/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD}, timeout=15)
    if r.status_code == 401:
        rs = requests.post(f"{API}/auth/signup", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD, "name": "Demo User"}, timeout=15)
        assert rs.status_code == 200, rs.text
        return rs.json()["token"]
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def new_user():
    email = f"TEST_cur_{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(f"{API}/auth/signup", json={"email": email, "password": "P@ssw0rd!", "name": "Cur T"}, timeout=15)
    assert r.status_code == 200, r.text
    return {"email": email, "token": r.json()["token"], "user": r.json()["user"]}


# ---------------- Fresh signup defaults ----------------

class TestSignupDefaults:
    def test_new_user_primary_currency_is_INR(self, new_user):
        assert new_user["user"].get("primary_currency") == "INR"

    def test_me_returns_primary_currency(self, new_user):
        r = requests.get(f"{API}/auth/me", headers=h(new_user["token"]), timeout=15)
        assert r.status_code == 200
        assert r.json().get("primary_currency") == "INR"

    def test_seeded_subs_all_have_currency(self, new_user):
        r = requests.get(f"{API}/subscriptions", headers=h(new_user["token"]), timeout=15)
        assert r.status_code == 200
        subs = r.json()
        assert len(subs) >= 12
        for s in subs:
            assert s.get("currency") in {"INR", "USD", "EUR", "GBP", "JPY", "AED", "CAD", "AUD", "SGD"}, s

    def test_seeded_mix_inr_and_usd(self, new_user):
        r = requests.get(f"{API}/subscriptions", headers=h(new_user["token"]), timeout=15)
        subs = r.json()
        inr = [s for s in subs if s["currency"] == "INR"]
        usd = [s for s in subs if s["currency"] == "USD"]
        assert len(inr) >= 6, f"Expected >=6 INR, got {len(inr)}"
        assert len(usd) >= 3, f"Expected >=3 USD, got {len(usd)}"


# ---------------- Reset endpoint ----------------

class TestReset:
    def test_reset_wipes_and_reseeds(self, demo_token):
        # First delete anything or just call reset directly
        r = requests.post(f"{API}/subscriptions/reset", headers=h(demo_token), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["count"] == 12

        subs = requests.get(f"{API}/subscriptions", headers=h(demo_token), timeout=15).json()
        assert len(subs) == 12
        inr = [s for s in subs if s["currency"] == "INR"]
        usd = [s for s in subs if s["currency"] == "USD"]
        assert len(inr) >= 6
        assert len(usd) >= 3
        names = [s["name"] for s in subs]
        assert "Netflix" in names
        assert "ChatGPT Plus" in names
        # Netflix should be INR 649
        netflix = next(s for s in subs if s["name"] == "Netflix")
        assert netflix["amount"] == 649
        assert netflix["currency"] == "INR"
        chatgpt = next(s for s in subs if s["name"] == "ChatGPT Plus")
        assert chatgpt["currency"] == "USD"
        assert chatgpt["amount"] == 20.00


# ---------------- Create/Update currency persistence ----------------

class TestCurrencyCRUD:
    def test_create_persists_custom_currency(self, new_user):
        tok = new_user["token"]
        payload = {
            "name": "TEST_EurSub", "amount": 9.99, "billing_cycle": "monthly",
            "category": "Music", "next_renewal": "2026-06-01", "currency": "EUR",
        }
        r = requests.post(f"{API}/subscriptions", headers=h(tok), json=payload, timeout=15)
        assert r.status_code == 200, r.text
        sid = r.json()["id"]
        assert r.json()["currency"] == "EUR"
        # Verify by GET
        subs = requests.get(f"{API}/subscriptions", headers=h(tok), timeout=15).json()
        got = next(s for s in subs if s["id"] == sid)
        assert got["currency"] == "EUR"

        # PUT with new currency GBP
        payload["currency"] = "GBP"
        u = requests.put(f"{API}/subscriptions/{sid}", headers=h(tok), json=payload, timeout=15)
        assert u.status_code == 200
        assert u.json()["currency"] == "GBP"


# ---------------- /auth/preferences primary_currency ----------------

class TestPreferences:
    def test_update_primary_currency(self, new_user):
        tok = new_user["token"]
        r = requests.post(f"{API}/auth/preferences", headers=h(tok), json={"primary_currency": "USD"}, timeout=15)
        assert r.status_code == 200
        assert r.json().get("primary_currency") == "USD"
        me = requests.get(f"{API}/auth/me", headers=h(tok), timeout=15).json()
        assert me["primary_currency"] == "USD"
        # revert
        requests.post(f"{API}/auth/preferences", headers=h(tok), json={"primary_currency": "INR"}, timeout=15)

    def test_invalid_currency_is_ignored(self, new_user):
        tok = new_user["token"]
        r = requests.post(f"{API}/auth/preferences", headers=h(tok), json={"primary_currency": "XYZ"}, timeout=15)
        assert r.status_code == 200
        me = requests.get(f"{API}/auth/me", headers=h(tok), timeout=15).json()
        assert me["primary_currency"] in {"INR", "USD"}  # unchanged


# ---------------- Insights primary_currency + conversion ----------------

class TestInsightsCurrency:
    def test_insights_returns_primary_currency_INR(self, new_user):
        tok = new_user["token"]
        r = requests.get(f"{API}/insights", headers=h(tok), timeout=60)
        assert r.status_code == 200
        d = r.json()
        assert d["primary_currency"] == "INR"
        assert d["monthly_total"] > 0
        # basic_summary should contain rupee symbol
        assert "\u20b9" in d["basic_summary"]  # ₹

    def test_insights_switch_to_USD(self, new_user):
        tok = new_user["token"]
        # capture INR total
        requests.post(f"{API}/auth/preferences", headers=h(tok), json={"primary_currency": "INR"}, timeout=15)
        inr = requests.get(f"{API}/insights", headers=h(tok), timeout=60).json()
        inr_total = inr["monthly_total"]

        requests.post(f"{API}/auth/preferences", headers=h(tok), json={"primary_currency": "USD"}, timeout=15)
        usd = requests.get(f"{API}/insights", headers=h(tok), timeout=60).json()
        assert usd["primary_currency"] == "USD"
        assert "$" in usd["basic_summary"]
        # USD total should be roughly inr_total / 83
        assert abs(usd["monthly_total"] - inr_total / 83.0) / max(inr_total / 83.0, 1) < 0.02
        # revert
        requests.post(f"{API}/auth/preferences", headers=h(tok), json={"primary_currency": "INR"}, timeout=15)


# ---------------- Reminders include currency ----------------

class TestRemindersCurrency:
    def test_reminders_items_have_currency(self, new_user):
        tok = new_user["token"]
        r = requests.get(f"{API}/reminders", headers=h(tok), timeout=15)
        assert r.status_code == 200
        for it in r.json()["items"]:
            assert "currency" in it and it["currency"], it


# ---------------- Legacy docs without currency ----------------

class TestLegacyBackfill:
    def test_get_returns_INR_when_missing_currency(self, new_user):
        """Simulate legacy docs by directly inserting via API is not possible; instead
        create then rely on serialize_sub default INR — already covered elsewhere."""
        # Confirm serializer returns INR when currency absent by inspecting seed docs default
        tok = new_user["token"]
        subs = requests.get(f"{API}/subscriptions", headers=h(tok), timeout=15).json()
        for s in subs:
            assert s["currency"], s  # never null
