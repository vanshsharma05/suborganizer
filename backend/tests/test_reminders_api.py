"""Reminders feature backend tests for SubOrganizer.

Covers:
- GET /api/reminders (window, days_left, urgency, count, ordering)
- POST /api/subscriptions/{id}/snooze
- POST /api/subscriptions/{id}/keep (billing cycle advance, snooze clear)
- POST /api/subscriptions/{id}/cancel (removed from reminders)
- PUT /api/subscriptions/{id} reminder_days_before persistence + effect
- Signup auto-seeds subs with reminder_days_before=3 and snoozed_until=null
"""
import os
import uuid
import pytest
import requests
from datetime import datetime, timezone, timedelta, date

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback to the env used by frontend (public URL). Fail fast if missing.
    import subprocess
    out = subprocess.run(
        ["grep", "-E", "^EXPO_PUBLIC_BACKEND_URL", "/app/frontend/.env"],
        capture_output=True, text=True,
    )
    if out.returncode == 0 and out.stdout:
        BASE_URL = out.stdout.strip().split("=", 1)[1].strip().rstrip("/")

assert BASE_URL, "Backend URL not configured"


# ------- Shared fixtures -------

@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def user_token(api):
    """Create a fresh signed-up user with auto-seeded subs."""
    email = f"TEST_rem_{uuid.uuid4().hex[:10]}@example.com"
    r = api.post(f"{BASE_URL}/api/auth/signup", json={
        "email": email, "password": "TestPass123!", "name": "Rem Tester",
    })
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def auth_headers(user_token):
    return {"Authorization": f"Bearer {user_token}"}


def _iso(d: date) -> str:
    return d.isoformat()


# ------- Auto-seed defaults -------

class TestAutoSeed:
    def test_seed_has_reminder_defaults(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/subscriptions", headers=auth_headers)
        assert r.status_code == 200
        subs = r.json()
        assert len(subs) >= 11
        for s in subs:
            assert s["reminder_days_before"] == 3, s
            assert s.get("snoozed_until") in (None, ""), s


# ------- GET /api/reminders window + shape -------

class TestGetReminders:
    def test_reminders_shape_and_window(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/reminders", headers=auth_headers)
        assert r.status_code == 200
        body = r.json()
        assert "items" in body and "count" in body
        assert body["count"] == len(body["items"])
        today = datetime.now(timezone.utc).date()
        for it in body["items"]:
            assert "days_left" in it and "urgency" in it
            renew = datetime.fromisoformat(it["next_renewal"]).date()
            assert (renew - today).days == it["days_left"]
            assert it["days_left"] <= (it.get("reminder_days_before") or 3)
            assert it["urgency"] in {"overdue", "today", "soon", "upcoming"}
            assert it["status"] == "active"

    def test_reminders_default_window_includes_youtube_and_spotify(self, api, auth_headers):
        """Fresh signup: YouTube Premium (offset 2), Spotify (offset 3) fall in window <=3."""
        r = api.get(f"{BASE_URL}/api/reminders", headers=auth_headers)
        assert r.status_code == 200
        names = [it["name"] for it in r.json()["items"]]
        assert "YouTube Premium" in names
        assert "Spotify" in names

    def test_reminders_sorted_by_days_left(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/reminders", headers=auth_headers)
        items = r.json()["items"]
        assert items == sorted(items, key=lambda x: x["days_left"])


# ------- Snooze -------

class TestSnooze:
    def test_snooze_removes_from_reminders_until_date(self, api, auth_headers):
        # Pick YouTube (2d out)
        r = api.get(f"{BASE_URL}/api/reminders", headers=auth_headers).json()
        yt = next(it for it in r["items"] if it["name"] == "YouTube Premium")
        sub_id = yt["id"]
        # Snooze 3 days
        s = api.post(
            f"{BASE_URL}/api/subscriptions/{sub_id}/snooze",
            headers=auth_headers, json={"days": 3},
        )
        assert s.status_code == 200
        body = s.json()
        assert body["snoozed_until"] is not None
        expected = (datetime.now(timezone.utc).date() + timedelta(days=3)).isoformat()
        assert body["snoozed_until"] == expected

        # Verify not in reminders anymore
        r2 = api.get(f"{BASE_URL}/api/reminders", headers=auth_headers).json()
        names = [it["name"] for it in r2["items"]]
        assert "YouTube Premium" not in names


# ------- Keep (advance renewal) -------

class TestKeep:
    def test_keep_advances_monthly_and_clears_snooze(self, api, auth_headers):
        # Spotify is monthly, 3d out
        r = api.get(f"{BASE_URL}/api/subscriptions", headers=auth_headers).json()
        spot = next(s for s in r if s["name"] == "Spotify")
        old_date = datetime.fromisoformat(spot["next_renewal"]).date()

        # Snooze first, then Keep — should clear snooze
        api.post(f"{BASE_URL}/api/subscriptions/{spot['id']}/snooze",
                 headers=auth_headers, json={"days": 5})

        k = api.post(f"{BASE_URL}/api/subscriptions/{spot['id']}/keep",
                     headers=auth_headers)
        assert k.status_code == 200
        body = k.json()
        assert body["snoozed_until"] in (None, ""), body
        new_date = datetime.fromisoformat(body["next_renewal"]).date()
        # +1 month with day-clamp
        m = old_date.month + 1
        y = old_date.year + (1 if m > 12 else 0)
        m = ((m - 1) % 12) + 1
        import calendar as _cal
        last = _cal.monthrange(y, m)[1]
        expected = old_date.replace(year=y, month=m, day=min(old_date.day, last))
        assert new_date == expected, f"{new_date} != {expected}"

    def test_keep_weekly_advances_seven_days(self, api, auth_headers):
        # Create a weekly sub 1 day out
        today = datetime.now(timezone.utc).date()
        payload = {
            "name": "TEST_Weekly", "amount": 4.99, "billing_cycle": "weekly",
            "category": "Music", "next_renewal": _iso(today + timedelta(days=1)),
        }
        c = api.post(f"{BASE_URL}/api/subscriptions", headers=auth_headers, json=payload)
        assert c.status_code == 200
        sid = c.json()["id"]
        k = api.post(f"{BASE_URL}/api/subscriptions/{sid}/keep", headers=auth_headers).json()
        assert datetime.fromisoformat(k["next_renewal"]).date() == today + timedelta(days=8)

    def test_keep_yearly_advances_one_year(self, api, auth_headers):
        today = datetime.now(timezone.utc).date()
        payload = {
            "name": "TEST_Yearly", "amount": 99.0, "billing_cycle": "yearly",
            "category": "Productivity", "next_renewal": _iso(today + timedelta(days=1)),
        }
        c = api.post(f"{BASE_URL}/api/subscriptions", headers=auth_headers, json=payload)
        sid = c.json()["id"]
        k = api.post(f"{BASE_URL}/api/subscriptions/{sid}/keep", headers=auth_headers).json()
        expected_year = today.year + 1
        new = datetime.fromisoformat(k["next_renewal"]).date()
        # +1 year keeping month/day (with feb-29 leap handling)
        assert new.year == expected_year
        assert new.month == (today + timedelta(days=1)).month


# ------- Cancel -------

class TestCancel:
    def test_cancel_removes_from_reminders(self, api, auth_headers):
        # Create a sub 1 day out then cancel
        today = datetime.now(timezone.utc).date()
        c = api.post(f"{BASE_URL}/api/subscriptions", headers=auth_headers, json={
            "name": "TEST_CancelMe", "amount": 5.0, "billing_cycle": "monthly",
            "category": "Music", "next_renewal": _iso(today + timedelta(days=1)),
        }).json()
        sid = c["id"]
        # Verify present in reminders
        rems = api.get(f"{BASE_URL}/api/reminders", headers=auth_headers).json()
        assert any(it["id"] == sid for it in rems["items"])
        # Cancel
        x = api.post(f"{BASE_URL}/api/subscriptions/{sid}/cancel", headers=auth_headers)
        assert x.status_code == 200
        assert x.json()["status"] == "cancelled"
        # No longer in reminders
        rems2 = api.get(f"{BASE_URL}/api/reminders", headers=auth_headers).json()
        assert not any(it["id"] == sid for it in rems2["items"])


# ------- reminder_days_before via PUT -------

class TestReminderDaysBeforeUpdate:
    def test_put_changes_reminder_window(self, api, auth_headers):
        # Amazon Prime is 14d out; default window 3 → not in reminders.
        r = api.get(f"{BASE_URL}/api/subscriptions", headers=auth_headers).json()
        amz = next(s for s in r if s["name"] == "Amazon Prime")
        # Confirm not in reminders
        rems = api.get(f"{BASE_URL}/api/reminders", headers=auth_headers).json()
        assert not any(it["id"] == amz["id"] for it in rems["items"])
        # PUT with window 7 — 14d still not in window, need larger. Use 20.
        payload = {**amz, "reminder_days_before": 20}
        # remove server-only keys
        payload.pop("id", None); payload.pop("created_at", None)
        u = api.put(f"{BASE_URL}/api/subscriptions/{amz['id']}",
                    headers=auth_headers, json=payload)
        assert u.status_code == 200, u.text
        assert u.json()["reminder_days_before"] == 20
        # Now should surface in reminders
        rems2 = api.get(f"{BASE_URL}/api/reminders", headers=auth_headers).json()
        assert any(it["id"] == amz["id"] for it in rems2["items"])

    def test_put_window_7_surfaces_iCloud(self, api, auth_headers):
        # iCloud+ is 5d out; window 7 should include it.
        r = api.get(f"{BASE_URL}/api/subscriptions", headers=auth_headers).json()
        ic = next(s for s in r if s["name"] == "iCloud+")
        payload = {**ic, "reminder_days_before": 7}
        payload.pop("id", None); payload.pop("created_at", None)
        u = api.put(f"{BASE_URL}/api/subscriptions/{ic['id']}",
                    headers=auth_headers, json=payload)
        assert u.status_code == 200
        rems = api.get(f"{BASE_URL}/api/reminders", headers=auth_headers).json()
        assert any(it["name"] == "iCloud+" for it in rems["items"])
