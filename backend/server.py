from fastapi import FastAPI, APIRouter, HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import json
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional
import uuid
from datetime import datetime, timedelta, timezone
import bcrypt
import jwt as pyjwt

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGO = "HS256"
JWT_EXP_DAYS = 30
EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY')

app = FastAPI()
api_router = APIRouter(prefix="/api")
security = HTTPBearer()

# ---------------- Models ----------------
class SignupIn(BaseModel):
    email: EmailStr
    password: str
    name: str

class LoginIn(BaseModel):
    email: EmailStr
    password: str

class AuthOut(BaseModel):
    token: str
    user: dict

class PreferencesIn(BaseModel):
    primary_currency: Optional[str] = None

class SubscriptionIn(BaseModel):
    name: str
    amount: float
    billing_cycle: str  # "monthly" | "yearly" | "weekly"
    category: str
    next_renewal: str  # ISO date
    currency: Optional[str] = "INR"
    domain: Optional[str] = None
    brand_color: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = "active"  # active | paused | cancelled
    reminder_days_before: Optional[int] = 3
    snoozed_until: Optional[str] = None  # ISO date; hide reminder until this date

# ---------------- FX rates (approx, fixed table for MVP) ----------------
# Rates are "1 X = R INR" — i.e. INR value = amount * RATES[currency]
RATES = {"INR": 1.0, "USD": 83.0, "EUR": 90.0, "GBP": 105.0, "JPY": 0.56, "AED": 22.6, "CAD": 61.0, "AUD": 55.0, "SGD": 62.0}
def to_inr(amount: float, cur: str) -> float:
    return amount * RATES.get((cur or "INR").upper(), 1.0)

class SubscriptionOut(SubscriptionIn):
    id: str
    created_at: str

# ---------------- Helpers ----------------
def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False

def create_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=JWT_EXP_DAYS),
        "iat": datetime.now(timezone.utc),
    }
    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)

async def get_current_user(cred: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    try:
        payload = pyjwt.decode(cred.credentials, JWT_SECRET, algorithms=[JWT_ALGO])
        user_id = payload.get("sub")
    except pyjwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user

# ---------------- Seed data ----------------
DEFAULT_SEED = [
    # INR — India-first defaults
    {"name": "Netflix", "amount": 649, "currency": "INR", "billing_cycle": "monthly", "category": "Entertainment", "domain": "netflix.com", "brand_color": "#E50914", "offset_days": 8},
    {"name": "Spotify Premium", "amount": 119, "currency": "INR", "billing_cycle": "monthly", "category": "Music", "domain": "spotify.com", "brand_color": "#1DB954", "offset_days": 3},
    {"name": "Disney+ Hotstar", "amount": 1499, "currency": "INR", "billing_cycle": "yearly", "category": "Entertainment", "domain": "hotstar.com", "brand_color": "#0F1E3D", "offset_days": 42},
    {"name": "JioSaavn Pro", "amount": 99, "currency": "INR", "billing_cycle": "monthly", "category": "Music", "domain": "jiosaavn.com", "brand_color": "#2BC5B4", "offset_days": 11},
    {"name": "Swiggy One", "amount": 149, "currency": "INR", "billing_cycle": "monthly", "category": "Shopping", "domain": "swiggy.com", "brand_color": "#FC8019", "offset_days": 5},
    {"name": "Zomato Gold", "amount": 199, "currency": "INR", "billing_cycle": "monthly", "category": "Shopping", "domain": "zomato.com", "brand_color": "#E23744", "offset_days": 19},
    {"name": "Amazon Prime", "amount": 1499, "currency": "INR", "billing_cycle": "yearly", "category": "Shopping", "domain": "amazon.in", "brand_color": "#FF9900", "offset_days": 60},
    {"name": "The Ken", "amount": 2750, "currency": "INR", "billing_cycle": "yearly", "category": "News", "domain": "the-ken.com", "brand_color": "#F35D2C", "offset_days": 27},
    # USD — international
    {"name": "ChatGPT Plus", "amount": 20.00, "currency": "USD", "billing_cycle": "monthly", "category": "Productivity", "domain": "openai.com", "brand_color": "#10A37F", "offset_days": 2},
    {"name": "iCloud+ 50GB", "amount": 0.99, "currency": "USD", "billing_cycle": "monthly", "category": "Storage", "domain": "apple.com", "brand_color": "#0A0A0A", "offset_days": 14},
    {"name": "Notion Personal Pro", "amount": 8.00, "currency": "USD", "billing_cycle": "monthly", "category": "Productivity", "domain": "notion.so", "brand_color": "#0A0A0A", "offset_days": 22},
    {"name": "Adobe Creative Cloud", "amount": 54.99, "currency": "USD", "billing_cycle": "monthly", "category": "Productivity", "domain": "adobe.com", "brand_color": "#FA0F00", "offset_days": 25},
]

async def seed_subscriptions(user_id: str):
    today = datetime.now(timezone.utc).date()
    docs = []
    for s in DEFAULT_SEED:
        renewal = today + timedelta(days=s["offset_days"])
        docs.append({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "name": s["name"],
            "amount": s["amount"],
            "currency": s.get("currency", "INR"),
            "billing_cycle": s["billing_cycle"],
            "category": s["category"],
            "next_renewal": renewal.isoformat(),
            "domain": s["domain"],
            "brand_color": s["brand_color"],
            "notes": None,
            "status": "active",
            "reminder_days_before": 3,
            "snoozed_until": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    if docs:
        await db.subscriptions.insert_many(docs)

def serialize_sub(doc: dict) -> dict:
    return {
        "id": doc["id"],
        "name": doc["name"],
        "amount": doc["amount"],
        "currency": doc.get("currency", "INR"),
        "billing_cycle": doc["billing_cycle"],
        "category": doc["category"],
        "next_renewal": doc["next_renewal"],
        "domain": doc.get("domain"),
        "brand_color": doc.get("brand_color"),
        "notes": doc.get("notes"),
        "status": doc.get("status", "active"),
        "reminder_days_before": doc.get("reminder_days_before", 3),
        "snoozed_until": doc.get("snoozed_until"),
        "created_at": doc.get("created_at"),
    }

def advance_renewal(next_renewal_iso: str, cycle: str) -> str:
    d = datetime.fromisoformat(next_renewal_iso).date()
    if cycle == "yearly":
        try:
            d = d.replace(year=d.year + 1)
        except ValueError:
            d = d.replace(month=2, day=28, year=d.year + 1)
    elif cycle == "weekly":
        d = d + timedelta(days=7)
    else:  # monthly
        m = d.month + 1
        y = d.year + (1 if m > 12 else 0)
        m = ((m - 1) % 12) + 1
        # clamp day for months with fewer days
        import calendar as _cal
        last = _cal.monthrange(y, m)[1]
        d = d.replace(year=y, month=m, day=min(d.day, last))
    return d.isoformat()

# ---------------- Auth Routes ----------------
@api_router.post("/auth/signup", response_model=AuthOut)
async def signup(data: SignupIn):
    existing = await db.users.find_one({"email": data.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = str(uuid.uuid4())
    user_doc = {
        "id": user_id,
        "email": data.email.lower(),
        "name": data.name,
        "password": hash_password(data.password),
        "is_pro": False,
        "primary_currency": "INR",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(user_doc)
    await seed_subscriptions(user_id)
    token = create_token(user_id)
    return {"token": token, "user": {"id": user_id, "email": user_doc["email"], "name": user_doc["name"], "is_pro": False, "primary_currency": "INR"}}

@api_router.post("/auth/login", response_model=AuthOut)
async def login(data: LoginIn):
    user = await db.users.find_one({"email": data.email.lower()})
    if not user or not verify_password(data.password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_token(user["id"])
    return {"token": token, "user": {"id": user["id"], "email": user["email"], "name": user["name"], "is_pro": user.get("is_pro", False), "primary_currency": user.get("primary_currency", "INR")}}

@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return {"id": user["id"], "email": user["email"], "name": user["name"], "is_pro": user.get("is_pro", False), "primary_currency": user.get("primary_currency", "INR")}

@api_router.post("/auth/upgrade")
async def upgrade(user: dict = Depends(get_current_user)):
    await db.users.update_one({"id": user["id"]}, {"$set": {"is_pro": True}})
    return {"ok": True, "is_pro": True}

@api_router.post("/auth/preferences")
async def update_prefs(data: PreferencesIn, user: dict = Depends(get_current_user)):
    updates = {}
    if data.primary_currency and data.primary_currency.upper() in RATES:
        updates["primary_currency"] = data.primary_currency.upper()
    if updates:
        await db.users.update_one({"id": user["id"]}, {"$set": updates})
    return {"ok": True, **updates}

@api_router.post("/subscriptions/reset")
async def reset_seed(user: dict = Depends(get_current_user)):
    """Wipe user's subs and re-seed with the default demo dataset (INR + USD mix)."""
    await db.subscriptions.delete_many({"user_id": user["id"]})
    await seed_subscriptions(user["id"])
    return {"ok": True, "count": len(DEFAULT_SEED)}

# ---------------- Subscription Routes ----------------
@api_router.get("/subscriptions", response_model=List[SubscriptionOut])
async def list_subs(user: dict = Depends(get_current_user)):
    cursor = db.subscriptions.find({"user_id": user["id"]}, {"_id": 0})
    docs = await cursor.to_list(500)
    docs.sort(key=lambda d: d["next_renewal"])
    return [serialize_sub(d) for d in docs]

@api_router.post("/subscriptions", response_model=SubscriptionOut)
async def create_sub(data: SubscriptionIn, user: dict = Depends(get_current_user)):
    doc = data.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["user_id"] = user["id"]
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    await db.subscriptions.insert_one(doc.copy())
    return serialize_sub(doc)

@api_router.put("/subscriptions/{sub_id}", response_model=SubscriptionOut)
async def update_sub(sub_id: str, data: SubscriptionIn, user: dict = Depends(get_current_user)):
    result = await db.subscriptions.find_one_and_update(
        {"id": sub_id, "user_id": user["id"]},
        {"$set": data.model_dump()},
        projection={"_id": 0},
        return_document=True,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Not found")
    return serialize_sub(result)

@api_router.delete("/subscriptions/{sub_id}")
async def delete_sub(sub_id: str, user: dict = Depends(get_current_user)):
    result = await db.subscriptions.delete_one({"id": sub_id, "user_id": user["id"]})
    if not result.deleted_count:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}

@api_router.post("/subscriptions/{sub_id}/toggle")
async def toggle_status(sub_id: str, user: dict = Depends(get_current_user)):
    doc = await db.subscriptions.find_one({"id": sub_id, "user_id": user["id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    new_status = "paused" if doc.get("status") == "active" else "active"
    await db.subscriptions.update_one({"id": sub_id, "user_id": user["id"]}, {"$set": {"status": new_status}})
    doc["status"] = new_status
    return serialize_sub(doc)

# ---------------- Gmail Scan (mock) ----------------
GMAIL_SCAN_POOL = [
    {"name": "Hulu", "amount": 7.99, "currency": "USD", "billing_cycle": "monthly", "category": "Entertainment", "domain": "hulu.com", "brand_color": "#1CE783"},
    {"name": "Cult.fit Live", "amount": 999, "currency": "INR", "billing_cycle": "monthly", "category": "Fitness", "domain": "cult.fit", "brand_color": "#B6151C"},
    {"name": "Figma Pro", "amount": 12.00, "currency": "USD", "billing_cycle": "monthly", "category": "Productivity", "domain": "figma.com", "brand_color": "#F24E1E"},
    {"name": "BluSmart Prime", "amount": 199, "currency": "INR", "billing_cycle": "monthly", "category": "Utilities", "domain": "blu-smart.com", "brand_color": "#26FFCF"},
    {"name": "Times Prime", "amount": 1199, "currency": "INR", "billing_cycle": "yearly", "category": "News", "domain": "timesprime.com", "brand_color": "#F70000"},
    {"name": "Rapido Club", "amount": 79, "currency": "INR", "billing_cycle": "monthly", "category": "Utilities", "domain": "rapido.bike", "brand_color": "#FCCB07"},
]

@api_router.post("/subscriptions/scan-mail")
async def scan_mail(user: dict = Depends(get_current_user)):
    """Mock Gmail scan — returns candidate subscriptions discovered in inbox."""
    import random
    picks = random.sample(GMAIL_SCAN_POOL, k=3)
    return {"discovered": picks}

# ---------------- Reminders ----------------
class SnoozeIn(BaseModel):
    days: int = 1

@api_router.get("/reminders")
async def get_reminders(user: dict = Depends(get_current_user)):
    """Return active subs whose renewal is within their `reminder_days_before` window,
    ordered by soonest first. Excludes snoozed reminders."""
    docs = await db.subscriptions.find(
        {"user_id": user["id"], "status": "active"}, {"_id": 0}
    ).to_list(500)
    today = datetime.now(timezone.utc).date()
    items = []
    for d in docs:
        renew = datetime.fromisoformat(d["next_renewal"]).date()
        days_left = (renew - today).days
        window = d.get("reminder_days_before", 3) or 3
        snoozed_until = d.get("snoozed_until")
        if snoozed_until:
            try:
                snz = datetime.fromisoformat(snoozed_until).date()
                if snz > today:
                    continue
            except Exception:
                pass
        if days_left <= window:
            items.append({
                **serialize_sub(d),
                "days_left": days_left,
                "urgency": "overdue" if days_left < 0 else ("today" if days_left == 0 else ("soon" if days_left <= 2 else "upcoming")),
            })
    items.sort(key=lambda x: x["days_left"])
    return {"items": items, "count": len(items)}

@api_router.post("/subscriptions/{sub_id}/keep")
async def keep_sub(sub_id: str, user: dict = Depends(get_current_user)):
    """User confirmed they want to keep it — advance renewal by one cycle and clear snooze."""
    doc = await db.subscriptions.find_one({"id": sub_id, "user_id": user["id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    new_renew = advance_renewal(doc["next_renewal"], doc["billing_cycle"])
    await db.subscriptions.update_one(
        {"id": sub_id, "user_id": user["id"]},
        {"$set": {"next_renewal": new_renew, "snoozed_until": None}},
    )
    doc["next_renewal"] = new_renew
    doc["snoozed_until"] = None
    return serialize_sub(doc)

@api_router.post("/subscriptions/{sub_id}/cancel")
async def cancel_sub(sub_id: str, user: dict = Depends(get_current_user)):
    doc = await db.subscriptions.find_one_and_update(
        {"id": sub_id, "user_id": user["id"]},
        {"$set": {"status": "cancelled"}},
        projection={"_id": 0},
        return_document=True,
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    return serialize_sub(doc)

@api_router.post("/subscriptions/{sub_id}/snooze")
async def snooze_sub(sub_id: str, data: SnoozeIn, user: dict = Depends(get_current_user)):
    doc = await db.subscriptions.find_one({"id": sub_id, "user_id": user["id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    until = (datetime.now(timezone.utc).date() + timedelta(days=max(1, data.days))).isoformat()
    await db.subscriptions.update_one(
        {"id": sub_id, "user_id": user["id"]},
        {"$set": {"snoozed_until": until}},
    )
    doc["snoozed_until"] = until
    return serialize_sub(doc)

# ---------------- AI Insights ----------------
class InsightsOut(BaseModel):
    monthly_total: float
    yearly_projected: float
    top_category: str
    basic_summary: str
    pro_savings_tip: str
    pro_unused_alert: str

def _to_monthly(amount: float, cycle: str) -> float:
    if cycle == "yearly":
        return amount / 12.0
    if cycle == "weekly":
        return amount * 4.33
    return amount

def _monthly_in_currency(sub: dict, target_currency: str) -> float:
    m = _to_monthly(sub["amount"], sub["billing_cycle"])
    inr = to_inr(m, sub.get("currency", "INR"))
    target_rate = RATES.get(target_currency.upper(), 1.0)
    return inr / target_rate  # convert INR back into target currency

@api_router.get("/insights")
async def insights(user: dict = Depends(get_current_user)):
    target = (user.get("primary_currency") or "INR").upper()
    docs = await db.subscriptions.find({"user_id": user["id"], "status": "active"}, {"_id": 0}).to_list(500)
    if not docs:
        return {
            "primary_currency": target,
            "monthly_total": 0, "yearly_projected": 0, "top_category": "—",
            "basic_summary": "You have no active subscriptions yet. Add one to see insights.",
            "pro_savings_tip": "Add subscriptions to unlock personalized savings tips.",
            "pro_unused_alert": "No subscriptions to analyze.",
            "is_pro": user.get("is_pro", False),
        }
    monthly = sum(_monthly_in_currency(d, target) for d in docs)
    yearly = monthly * 12.0
    cat_totals: dict = {}
    for d in docs:
        cat_totals[d["category"]] = cat_totals.get(d["category"], 0) + _monthly_in_currency(d, target)
    top_cat = max(cat_totals.items(), key=lambda kv: kv[1])[0]

    sym = {"INR": "₹", "USD": "$", "EUR": "€", "GBP": "£", "JPY": "¥"}.get(target, target + " ")
    basic_summary = (
        f"You're spending {sym}{monthly:,.0f}/month across {len(docs)} active subscriptions. "
        f"Your top category is {top_cat} ({sym}{cat_totals[top_cat]:,.0f}/mo)."
    )

    pro_savings_tip = "Consider bundling entertainment services or downgrading rarely-used plans."
    pro_unused_alert = "Review subscriptions you haven't opened this month."

    if EMERGENT_LLM_KEY:
        try:
            from emergentintegrations.llm.chat import LlmChat, UserMessage
            summary_data = {
                "primary_currency": target,
                "monthly_total": round(monthly, 2),
                "yearly_projected": round(yearly, 2),
                "by_category": {k: round(v, 2) for k, v in cat_totals.items()},
                "subscriptions": [
                    {
                        "name": d["name"],
                        "cost_monthly_in_" + target.lower(): round(_monthly_in_currency(d, target), 2),
                        "original_amount": d["amount"],
                        "original_currency": d.get("currency", "INR"),
                        "billing_cycle": d["billing_cycle"],
                        "category": d["category"],
                    } for d in docs
                ],
            }
            chat = LlmChat(
                api_key=EMERGENT_LLM_KEY,
                session_id=f"insights-{user['id']}",
                system_message=(
                    f"You are a warm, savvy personal-finance coach for a subscription tracker. "
                    f"The user's primary currency is {target}. Use its symbol ({sym}) for numbers. "
                    "Reply STRICTLY in compact JSON with keys 'savings_tip' and 'unused_alert'. "
                    "Each value must be a single vivid sentence (max 22 words), plain text (no markdown, no emoji), and personalized to the user's data."
                ),
            ).with_model("anthropic", "claude-sonnet-4-6")
            msg = UserMessage(text=f"User subscription data:\n{json.dumps(summary_data)}\n\nReturn JSON only.")
            resp = await chat.send_message(msg)
            text = resp if isinstance(resp, str) else str(resp)
            start = text.find("{")
            end = text.rfind("}")
            if start != -1 and end != -1:
                parsed = json.loads(text[start:end+1])
                pro_savings_tip = parsed.get("savings_tip", pro_savings_tip)
                pro_unused_alert = parsed.get("unused_alert", pro_unused_alert)
        except Exception as e:
            logging.warning(f"LLM insights failed: {e}")

    return {
        "primary_currency": target,
        "monthly_total": round(monthly, 2),
        "yearly_projected": round(yearly, 2),
        "top_category": top_cat,
        "by_category": {k: round(v, 2) for k, v in cat_totals.items()},
        "basic_summary": basic_summary,
        "pro_savings_tip": pro_savings_tip,
        "pro_unused_alert": pro_unused_alert,
        "is_pro": user.get("is_pro", False),
    }

@api_router.get("/")
async def root():
    return {"app": "SubOrganizer", "status": "ok"}

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
