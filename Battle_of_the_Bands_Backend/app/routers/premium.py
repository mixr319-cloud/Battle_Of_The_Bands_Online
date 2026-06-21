"""
BOTB Premium subscription router.

Endpoints:
  POST /premium/create-checkout   → create a Stripe Checkout session ($4.30/mo)
  POST /premium/webhook           → Stripe webhook to activate/cancel subscriptions
  GET  /premium/status/{user_id}  → check if user is premium
  POST /premium/cancel/{user_id}  → cancel subscription at period end

Environment variables required:
  STRIPE_SECRET_KEY        - your Stripe secret key (sk_live_... or sk_test_...)
  STRIPE_WEBHOOK_SECRET    - from Stripe dashboard webhook settings (whsec_...)
  STRIPE_PRICE_ID          - Price ID for $4.30/mo recurring product (price_...)
  FRONTEND_URL             - e.g. https://yourdomain.com (for redirect URLs)
"""

import os
import stripe
from fastapi import APIRouter, Depends, HTTPException, Request, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from app.database import get_db
from app.models import User
from datetime import datetime, timezone

router = APIRouter(prefix="/premium", tags=["premium"])

stripe.api_key = os.getenv("STRIPE_SECRET_KEY", "")
WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")
PRICE_ID = os.getenv("STRIPE_PRICE_ID", "")          # $4.30/mo recurring price
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")


class CheckoutRequest(BaseModel):
    user_id: str


def premium_status(u: User) -> dict:
    return {
        "isPremium": u.is_premium,
        "stripeCustomerId": u.stripe_customer_id,
        "premiumExpiresAt": u.premium_expires_at.isoformat() if u.premium_expires_at else None,
    }


# ──────────────────────────────────────────────────────────────────────────────
# Create Stripe Checkout Session
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/create-checkout")
async def create_checkout(body: CheckoutRequest, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, body.user_id)
    if not user:
        raise HTTPException(404, "User not found")
    if user.is_premium:
        raise HTTPException(400, "User is already a premium member")
    if not stripe.api_key:
        raise HTTPException(500, "Stripe not configured — set STRIPE_SECRET_KEY")
    if not PRICE_ID:
        raise HTTPException(500, "Stripe price not configured — set STRIPE_PRICE_ID")

    # Reuse existing customer or create a new one
    customer_id = user.stripe_customer_id
    if not customer_id:
        customer = stripe.Customer.create(
            metadata={"botb_user_id": user.id, "username": user.username}
        )
        customer_id = customer.id
        user.stripe_customer_id = customer_id
        await db.commit()

    session = stripe.checkout.Session.create(
        customer=customer_id,
        payment_method_types=["card"],
        line_items=[{"price": PRICE_ID, "quantity": 1}],
        mode="subscription",
        allow_promotion_codes=True,
        success_url=f"{FRONTEND_URL}?premium=success",
        cancel_url=f"{FRONTEND_URL}?premium=cancelled",
        metadata={"botb_user_id": user.id},
    )
    return {"checkoutUrl": session.url}


# ──────────────────────────────────────────────────────────────────────────────
# Stripe Webhook — activates / deactivates premium
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/webhook")
async def stripe_webhook(
    request: Request,
    stripe_signature: str = Header(None, alias="stripe-signature"),
    db: AsyncSession = Depends(get_db),
):
    payload = await request.body()
    if not WEBHOOK_SECRET:
        raise HTTPException(500, "Stripe webhook secret not configured")
    try:
        event = stripe.Webhook.construct_event(payload, stripe_signature, WEBHOOK_SECRET)
    except stripe.error.SignatureVerificationError:
        raise HTTPException(400, "Invalid Stripe signature")

    event_type = event["type"]
    data = event["data"]["object"]

    # ── Subscription activated / renewed ──────────────────────────────────────
    if event_type in ("customer.subscription.created", "customer.subscription.updated"):
        sub = data
        customer_id = sub["customer"]
        result = await db.execute(select(User).where(User.stripe_customer_id == customer_id))
        user = result.scalar_one_or_none()
        if user:
            is_active = sub["status"] in ("active", "trialing")
            user.is_premium = is_active
            user.stripe_subscription_id = sub["id"]
            period_end = sub.get("current_period_end")
            if period_end:
                user.premium_expires_at = datetime.fromtimestamp(period_end, tz=timezone.utc)
            await db.commit()

    # ── Subscription cancelled / expired ─────────────────────────────────────
    elif event_type == "customer.subscription.deleted":
        sub = data
        customer_id = sub["customer"]
        result = await db.execute(select(User).where(User.stripe_customer_id == customer_id))
        user = result.scalar_one_or_none()
        if user:
            user.is_premium = False
            user.stripe_subscription_id = None
            user.premium_expires_at = None
            await db.commit()

    # ── Invoice payment failed ────────────────────────────────────────────────
    elif event_type == "invoice.payment_failed":
        customer_id = data.get("customer")
        if customer_id:
            result = await db.execute(select(User).where(User.stripe_customer_id == customer_id))
            user = result.scalar_one_or_none()
            if user:
                user.is_premium = False
                await db.commit()

    return {"received": True}


# ──────────────────────────────────────────────────────────────────────────────
# Get premium status
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/status/{user_id}")
async def get_premium_status(user_id: str, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    return premium_status(user)


# ──────────────────────────────────────────────────────────────────────────────
# Cancel subscription (at period end — user keeps access until expiry)
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/cancel/{user_id}")
async def cancel_subscription(user_id: str, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    if not user.stripe_subscription_id:
        raise HTTPException(400, "No active subscription found")

    stripe.Subscription.modify(user.stripe_subscription_id, cancel_at_period_end=True)
    return {"message": "Subscription will cancel at end of billing period", "expiresAt": user.premium_expires_at}
