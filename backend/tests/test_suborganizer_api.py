"""Backend API test suite for SubOrganizer.
Covers auth, subscriptions CRUD, gmail scan (mock), insights (LLM)."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://subscription-hub-313.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

DEMO_EMAIL = "demo@suborganizer.app"
DEMO_PASSWORD = "demo1234"


@pytest.fixture(scope="session")
def demo_token():
    # Try login; if 401 create the demo user
    r = requests.post(f"{API}/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD}, timeout=15)
    if r.status_code == 401:
        rs = requests.post(f"{API}/auth/signup", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD, "name": "Demo User"}, timeout=15)
        assert rs.status_code == 200, f"Signup failed: {rs.text}"
        return rs.json()["token"]
    assert r.status_code == 200, f"Login failed: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def new_user_token():
    email = f"TEST_{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(f"{API}/auth/signup", json={"email": email, "password": "Passw0rd!", "name": "Test User"}, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "token" in data and "user" in data
    return {"token": data["token"], "user": data["user"], "email": email}


def h(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---------------- Auth ----------------
class TestAuth:
    def test_signup_seeds_11_subs(self, new_user_token):
        r = requests.get(f"{API}/subscriptions", headers=h(new_user_token["token"]), timeout=15)
        assert r.status_code == 200
        assert len(r.json()) == 11

    def test_signup_duplicate_email(self, new_user_token):
        r = requests.post(f"{API}/auth/signup", json={"email": new_user_token["email"], "password": "x", "name": "Y"}, timeout=15)
        assert r.status_code == 400

    def test_login_demo(self, demo_token):
        assert isinstance(demo_token, str) and len(demo_token) > 20

    def test_login_wrong_password(self):
        r = requests.post(f"{API}/auth/login", json={"email": DEMO_EMAIL, "password": "wrong"}, timeout=15)
        assert r.status_code == 401

    def test_me_returns_profile(self, demo_token):
        r = requests.get(f"{API}/auth/me", headers=h(demo_token), timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data["email"] == DEMO_EMAIL
        assert "is_pro" in data

    def test_me_unauthorized(self):
        r = requests.get(f"{API}/auth/me", timeout=15)
        assert r.status_code in (401, 403)


# ---------------- Subscriptions ----------------
class TestSubscriptions:
    def test_list_demo_has_11(self, demo_token):
        r = requests.get(f"{API}/subscriptions", headers=h(demo_token), timeout=15)
        assert r.status_code == 200
        subs = r.json()
        assert len(subs) >= 11
        names = [s["name"] for s in subs]
        assert "Netflix" in names and "Spotify" in names

    def test_crud_flow(self, new_user_token):
        tok = new_user_token["token"]
        payload = {
            "name": "TEST_Sub", "amount": 4.99, "billing_cycle": "monthly",
            "category": "Music", "next_renewal": "2026-06-01",
            "domain": "example.com", "brand_color": "#123456", "status": "active",
        }
        # Create
        rc = requests.post(f"{API}/subscriptions", headers=h(tok), json=payload, timeout=15)
        assert rc.status_code == 200, rc.text
        sub_id = rc.json()["id"]

        # Verify via GET
        rl = requests.get(f"{API}/subscriptions", headers=h(tok), timeout=15)
        assert any(s["id"] == sub_id for s in rl.json())

        # Update
        payload["amount"] = 7.99
        ru = requests.put(f"{API}/subscriptions/{sub_id}", headers=h(tok), json=payload, timeout=15)
        assert ru.status_code == 200
        assert ru.json()["amount"] == 7.99

        # Toggle
        rt = requests.post(f"{API}/subscriptions/{sub_id}/toggle", headers=h(tok), timeout=15)
        assert rt.status_code == 200
        assert rt.json()["status"] == "paused"

        # Toggle back
        rt2 = requests.post(f"{API}/subscriptions/{sub_id}/toggle", headers=h(tok), timeout=15)
        assert rt2.json()["status"] == "active"

        # Delete
        rd = requests.delete(f"{API}/subscriptions/{sub_id}", headers=h(tok), timeout=15)
        assert rd.status_code == 200

        # Verify gone
        rd2 = requests.delete(f"{API}/subscriptions/{sub_id}", headers=h(tok), timeout=15)
        assert rd2.status_code == 404

    def test_update_not_found(self, demo_token):
        payload = {
            "name": "X", "amount": 1.0, "billing_cycle": "monthly",
            "category": "X", "next_renewal": "2026-06-01",
        }
        r = requests.put(f"{API}/subscriptions/does-not-exist", headers=h(demo_token), json=payload, timeout=15)
        assert r.status_code == 404


# ---------------- Gmail scan (mock) ----------------
class TestScan:
    def test_scan_returns_three(self, demo_token):
        r = requests.post(f"{API}/subscriptions/scan-mail", headers=h(demo_token), timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "discovered" in data
        assert len(data["discovered"]) == 3


# ---------------- Insights ----------------
class TestInsights:
    def test_insights_shape(self, demo_token):
        r = requests.get(f"{API}/insights", headers=h(demo_token), timeout=60)
        assert r.status_code == 200
        d = r.json()
        for k in ["monthly_total", "yearly_projected", "top_category", "basic_summary", "pro_savings_tip", "pro_unused_alert"]:
            assert k in d, f"missing {k}"
        assert d["monthly_total"] > 0
        assert d["yearly_projected"] == pytest.approx(d["monthly_total"] * 12.0, rel=0.01)
        assert "by_category" in d


# ---------------- Upgrade ----------------
class TestUpgrade:
    def test_upgrade_flips_flag(self, new_user_token):
        tok = new_user_token["token"]
        r = requests.post(f"{API}/auth/upgrade", headers=h(tok), timeout=15)
        assert r.status_code == 200
        assert r.json()["is_pro"] is True
        # confirm via me
        me = requests.get(f"{API}/auth/me", headers=h(tok), timeout=15)
        assert me.json()["is_pro"] is True
