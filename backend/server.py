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

class SubscriptionIn(BaseModel):
    name: str
    amount: float
    billing_cycle: str  # "monthly" | "yearly" | "weekly"
    category: str
    next_renewal: str  # ISO date
    domain: Optional[str] = None
    brand_color: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = "active"  # active | paused | cancelled

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
    {"name": "Netflix", "amount": 15.49, "billing_cycle": "monthly", "category": "Entertainment", "domain": "netflix.com", "brand_color": "#E50914", "offset_days": 8},
    {"name": "Spotify", "amount": 9.99, "billing_cycle": "monthly", "category": "Music", "domain": "spotify.com", "brand_color": "#1DB954", "offset_days": 3},
    {"name": "Amazon Prime", "amount": 14.99, "billing_cycle": "monthly", "category": "Shopping", "domain": "amazon.com", "brand_color": "#FF9900", "offset_days": 14},
    {"name": "Adobe Creative Cloud", "amount": 54.99, "billing_cycle": "monthly", "category": "Productivity", "domain": "adobe.com", "brand_color": "#FA0F00", "offset_days": 21},
    {"name": "iCloud+", "amount": 2.99, "billing_cycle": "monthly", "category": "Storage", "domain": "apple.com", "brand_color": "#0A0A0A", "offset_days": 5},
    {"name": "ChatGPT Plus", "amount": 20.00, "billing_cycle": "monthly", "category": "Productivity", "domain": "openai.com", "brand_color": "#10A37F", "offset_days": 11},
    {"name": "Notion", "amount": 8.00, "billing_cycle": "monthly", "category": "Productivity", "domain": "notion.so", "brand_color": "#0A0A0A", "offset_days": 18},
    {"name": "New York Times", "amount": 17.00, "billing_cycle": "monthly", "category": "News", "domain": "nytimes.com", "brand_color": "#1A1C1E", "offset_days": 26},
    {"name": "YouTube Premium", "amount": 13.99, "billing_cycle": "monthly", "category": "Entertainment", "domain": "youtube.com", "brand_color": "#FF0000", "offset_days": 2},
    {"name": "Duolingo Super", "amount": 6.99, "billing_cycle": "monthly", "category": "Education", "domain": "duolingo.com", "brand_color": "#58CC02", "offset_days": 15},
    {"name": "Dropbox Plus", "amount": 11.99, "billing_cycle": "monthly", "category": "Storage", "domain": "dropbox.com", "brand_color": "#0061FF", "offset_days": 22},
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
            "billing_cycle": s["billing_cycle"],
            "category": s["category"],
            "next_renewal": renewal.isoformat(),
            "domain": s["domain"],
            "brand_color": s["brand_color"],
            "notes": None,
            "status": "active",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    if docs:
        await db.subscriptions.insert_many(docs)

def serialize_sub(doc: dict) -> dict:
    return {
        "id": doc["id"],
        "name": doc["name"],
        "amount": doc["amount"],
        "billing_cycle": doc["billing_cycle"],
        "category": doc["category"],
        "next_renewal": doc["next_renewal"],
        "domain": doc.get("domain"),
        "brand_color": doc.get("brand_color"),
        "notes": doc.get("notes"),
        "status": doc.get("status", "active"),
        "created_at": doc.get("created_at"),
    }

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
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(user_doc)
    await seed_subscriptions(user_id)
    token = create_token(user_id)
    return {"token": token, "user": {"id": user_id, "email": user_doc["email"], "name": user_doc["name"], "is_pro": False}}

@api_router.post("/auth/login", response_model=AuthOut)
async def login(data: LoginIn):
    user = await db.users.find_one({"email": data.email.lower()})
    if not user or not verify_password(data.password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_token(user["id"])
    return {"token": token, "user": {"id": user["id"], "email": user["email"], "name": user["name"], "is_pro": user.get("is_pro", False)}}

@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return {"id": user["id"], "email": user["email"], "name": user["name"], "is_pro": user.get("is_pro", False)}

@api_router.post("/auth/upgrade")
async def upgrade(user: dict = Depends(get_current_user)):
    await db.users.update_one({"id": user["id"]}, {"$set": {"is_pro": True}})
    return {"ok": True, "is_pro": True}

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
    {"name": "Hulu", "amount": 7.99, "billing_cycle": "monthly", "category": "Entertainment", "domain": "hulu.com", "brand_color": "#1CE783"},
    {"name": "Disney+", "amount": 10.99, "billing_cycle": "monthly", "category": "Entertainment", "domain": "disneyplus.com", "brand_color": "#113CCF"},
    {"name": "Figma Pro", "amount": 12.00, "billing_cycle": "monthly", "category": "Productivity", "domain": "figma.com", "brand_color": "#F24E1E"},
    {"name": "The Athletic", "amount": 5.99, "billing_cycle": "monthly", "category": "News", "domain": "theathletic.com", "brand_color": "#E4022B"},
    {"name": "Peloton App", "amount": 12.99, "billing_cycle": "monthly", "category": "Fitness", "domain": "onepeloton.com", "brand_color": "#181A1D"},
]

@api_router.post("/subscriptions/scan-mail")
async def scan_mail(user: dict = Depends(get_current_user)):
    """Mock Gmail scan — returns candidate subscriptions discovered in inbox."""
    import random
    picks = random.sample(GMAIL_SCAN_POOL, k=3)
    return {"discovered": picks}

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

@api_router.get("/insights")
async def insights(user: dict = Depends(get_current_user)):
    docs = await db.subscriptions.find({"user_id": user["id"], "status": "active"}, {"_id": 0}).to_list(500)
    if not docs:
        return {
            "monthly_total": 0, "yearly_projected": 0, "top_category": "—",
            "basic_summary": "You have no active subscriptions yet. Add one to see insights.",
            "pro_savings_tip": "Add subscriptions to unlock personalized savings tips.",
            "pro_unused_alert": "No subscriptions to analyze.",
            "is_pro": user.get("is_pro", False),
        }
    monthly = sum(_to_monthly(d["amount"], d["billing_cycle"]) for d in docs)
    yearly = monthly * 12.0
    cat_totals: dict = {}
    for d in docs:
        cat_totals[d["category"]] = cat_totals.get(d["category"], 0) + _to_monthly(d["amount"], d["billing_cycle"])
    top_cat = max(cat_totals.items(), key=lambda kv: kv[1])[0]

    # Basic summary — non-LLM, always shown
    basic_summary = (
        f"You're spending ${monthly:.2f}/month across {len(docs)} active subscriptions. "
        f"Your top category is {top_cat} (${cat_totals[top_cat]:.2f}/mo)."
    )

    # LLM-powered PRO insights
    pro_savings_tip = "Consider bundling entertainment services or downgrading rarely-used plans."
    pro_unused_alert = "Review subscriptions you haven't opened this month."

    if EMERGENT_LLM_KEY:
        try:
            from emergentintegrations.llm.chat import LlmChat, UserMessage
            summary_data = {
                "monthly_total_usd": round(monthly, 2),
                "yearly_projected_usd": round(yearly, 2),
                "by_category": {k: round(v, 2) for k, v in cat_totals.items()},
                "subscriptions": [{"name": d["name"], "cost_monthly": round(_to_monthly(d["amount"], d["billing_cycle"]), 2), "category": d["category"]} for d in docs],
            }
            chat = LlmChat(
                api_key=EMERGENT_LLM_KEY,
                session_id=f"insights-{user['id']}",
                system_message=(
                    "You are a warm, savvy personal-finance coach for a subscription tracker. "
                    "Reply STRICTLY in compact JSON with keys 'savings_tip' and 'unused_alert'. "
                    "Each value must be a single vivid sentence (max 22 words), plain text (no markdown, no emoji), and personalized to the user's data."
                ),
            ).with_model("anthropic", "claude-sonnet-4-6")
            msg = UserMessage(text=f"User subscription data:\n{json.dumps(summary_data)}\n\nReturn JSON only.")
            resp = await chat.send_message(msg)
            text = resp if isinstance(resp, str) else str(resp)
            # Extract JSON
            start = text.find("{")
            end = text.rfind("}")
            if start != -1 and end != -1:
                parsed = json.loads(text[start:end+1])
                pro_savings_tip = parsed.get("savings_tip", pro_savings_tip)
                pro_unused_alert = parsed.get("unused_alert", pro_unused_alert)
        except Exception as e:
            logging.warning(f"LLM insights failed: {e}")

    return {
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
