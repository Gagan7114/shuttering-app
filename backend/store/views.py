import io
import re
import secrets
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation

from django.contrib.auth import authenticate, get_user_model, login, logout
from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.db import transaction
from django.db.models import Case, F, IntegerField, Max, Sum, When
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.exceptions import APIException
from rest_framework.permissions import AllowAny
from rest_framework.throttling import AnonRateThrottle
from rest_framework.response import Response

from .billing import (
    GST_TYPES,
    LedgerError,
    build_ledger,
    default_gst_type,
    gst_amounts,
    holdings_from,
    human_at,
    last_bill,
    q2,
    rent_preview,
)
from .models import Bill, BillLine, Challan, ChallanLine, Customer, Item, Payment, RecoveryKey, ShopSettings, Site
from .serializers import CustomerSerializer, ItemSerializer, PaymentSerializer, ShopSettingsSerializer, SiteSerializer


# --------------------------------------------------------------------------- helpers


class ApiError(APIException):
    status_code = 400
    default_detail = "Invalid request."

    def __init__(self, detail, status=400):
        super().__init__(detail)
        self.status_code = status


def parse_at(value, field="Date & time"):
    """'YYYY-MM-DDTHH:MM' in shop local time -> aware datetime."""
    if not value:
        raise ApiError(f"{field} is required.")
    try:
        dt = datetime.fromisoformat(str(value).strip().replace(" ", "T"))
    except ValueError:
        raise ApiError(f"{field} is not a valid date/time.")
    if timezone.is_naive(dt):
        dt = timezone.make_aware(dt)
    return dt.replace(second=0, microsecond=0)


def parse_day(value, field="Date"):
    """'YYYY-MM-DD' -> date, or None when empty."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).strip()[:10]).date()
    except ValueError:
        raise ApiError(f"{field} is not a valid date.")


def day_start(d):
    """Start of a local calendar day as an aware datetime."""
    return timezone.make_aware(datetime(d.year, d.month, d.day))


def at_str(dt):
    return timezone.localtime(dt).strftime("%Y-%m-%dT%H:%M") if dt else None


def to_int(value, field, minimum=None):
    if value in (None, ""):
        raise ApiError(f"{field} is required.")
    try:
        number = Decimal(str(value))
    except InvalidOperation:
        raise ApiError(f"{field} must be a number.")
    if number != number.to_integral_value():
        raise ApiError(f"{field} must be a whole number.")
    number = int(number)
    if minimum is not None and number < minimum:
        raise ApiError(f"{field} must be at least {minimum}.")
    return number


def to_money(value, field, minimum=Decimal("0")):
    if value in (None, ""):
        return Decimal("0")
    try:
        number = Decimal(str(value))
    except InvalidOperation:
        raise ApiError(f"{field} must be a number.")
    if not number.is_finite() or number < minimum:
        raise ApiError(f"{field} cannot be less than {minimum}.")
    return q2(number)


def out_qty_by_item(item_ids=None):
    """Pieces currently with customers, per item id."""
    qs = ChallanLine.objects.all()
    if item_ids is not None:
        qs = qs.filter(item_id__in=list(item_ids))
    rows = qs.values("item_id").annotate(
        out=Sum(Case(When(direction="out", then=F("qty")), default=-F("qty"), output_field=IntegerField()))
    )
    return {r["item_id"]: r["out"] or 0 for r in rows}


def lost_qty_by_item():
    rows = ChallanLine.objects.filter(lost=True).values("item_id").annotate(n=Sum("qty"))
    return {r["item_id"]: r["n"] or 0 for r in rows}


def item_json(item, out_qty=0, used=False, lost_qty=0):
    return {
        "id": item.id,
        "name": item.name,
        "unit": item.unit,
        "total_qty": item.total_qty,
        "rate": item.rate,
        "basis": item.basis,
        "category": item.category,
        "lost_rate": item.lost_rate,
        "note": item.note,
        "out_qty": out_qty,
        "available": item.total_qty - out_qty,
        "lost_qty": lost_qty,
        "used": used,
    }


def challan_json(ch, locked_upto=None):
    lines = [
        {
            "id": l.id,
            "item_id": l.item_id,
            "item_name": l.item.name,
            "unit": l.item.unit,
            "direction": l.direction,
            "qty": l.qty,
            "rate": l.rate,
            "basis": l.basis,
            "lost": l.lost,
            "replaces_name": l.replaces.name if l.replaces_id else None,
        }
        for l in ch.lines.all()
    ]
    return {
        "id": ch.id,
        "customer_id": ch.customer_id,
        "customer_name": ch.customer.name,
        "site_id": ch.site_id,
        "site_name": ch.site.name if ch.site_id else "",
        "site_address": ch.site.address if ch.site_id else "",
        "kind": ch.kind,
        "at": at_str(ch.at),
        "vehicle": ch.vehicle,
        "note": ch.note,
        "lines": lines,
        "locked": bool(locked_upto and ch.at <= locked_upto),
    }


def challan_queryset():
    return Challan.objects.select_related("customer", "site").prefetch_related("lines__item", "lines__replaces")


def last_upto_by_customer():
    return {r["customer_id"]: r["m"] for r in Bill.objects.values("customer_id").annotate(m=Max("upto_at"))}


def preview_json(pv):
    return {
        **pv,
        "from_at": at_str(pv["from_at"]),
        "upto_at": at_str(pv["upto_at"]),
        "lines": [{**l, "from_at": at_str(l["from_at"]), "to_at": at_str(l["to_at"])} for l in pv["lines"]],
        "lost_lines": [{**l, "at": at_str(l["at"])} for l in pv["lost_lines"]],
    }


def bill_line_json(l):
    return {
        "id": l.id,
        "kind": l.kind,
        "description": l.description,
        "item_name": l.item_name,
        "site_name": l.site_name,
        "unit": l.unit,
        "qty": l.qty,
        "from_at": at_str(l.from_at),
        "to_at": at_str(l.to_at),
        "status": l.status,
        "units": l.units,
        "prev_units": l.prev_units,
        "basis": l.basis,
        "rate": l.rate,
        "amount": l.amount,
    }


def bill_summary_json(b):
    return {
        "id": b.id,
        "bill_no": b.bill_no,
        "customer_id": b.customer_id,
        "customer_name": b.customer.name,
        "from_at": at_str(b.from_at),
        "upto_at": at_str(b.upto_at),
        "rent_total": b.rent_total,
        "lost_total": b.lost_total,
        "extras_total": b.extras_total,
        "discount": b.discount,
        "gst_type": b.gst_type,
        "gst_rate": b.gst_rate,
        "taxable": b.taxable,
        "cgst": b.cgst,
        "sgst": b.sgst,
        "igst": b.igst,
        "total": b.total,
    }


def shop_json():
    return ShopSettingsSerializer(ShopSettings.load()).data


def customer_money(customer_ids=None):
    """Billed and paid per customer. Paid includes TDS the customer deducted."""
    bills = Bill.objects.values("customer_id").annotate(s=Sum("total"))
    pays = Payment.objects.values("customer_id").annotate(s=Sum(F("amount") + F("tds")))
    if customer_ids is not None:
        bills = bills.filter(customer_id__in=customer_ids)
        pays = pays.filter(customer_id__in=customer_ids)
    return {r["customer_id"]: r["s"] for r in bills}, {r["customer_id"]: r["s"] for r in pays}


# --------------------------------------------------------------------------- auth


@ensure_csrf_cookie
@api_view(["GET"])
@permission_classes([AllowAny])
def me_view(request):
    if not request.user.is_authenticated:
        return Response({"user": None})
    return Response({"user": {"username": request.user.username, "is_staff": request.user.is_staff}, "shop": shop_json()})


@api_view(["POST"])
@permission_classes([AllowAny])
def login_view(request):
    user = authenticate(
        request, username=str(request.data.get("username", "")).strip(), password=request.data.get("password", "")
    )
    if user is None:
        raise ApiError("Wrong username or password.")
    login(request, user)
    return Response({"user": {"username": user.username, "is_staff": user.is_staff}, "shop": shop_json()})


@api_view(["POST"])
def logout_view(request):
    logout(request)
    return Response({"ok": True})


# --------------------------------------------------------------------------- forgot password

# 16 characters from 32 easy-to-read ones (no I, O, 0, 1): about 80 bits, can't be guessed.
KEY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def new_recovery_key(user):
    """Make (or replace) the user's recovery key. Returns it as XXXX-XXXX-XXXX-XXXX."""
    raw = "".join(secrets.choice(KEY_ALPHABET) for _ in range(16))
    RecoveryKey.objects.update_or_create(
        user=user, defaults={"key_hash": make_password(raw), "created_at": timezone.now()}
    )
    return "-".join(raw[i : i + 4] for i in range(0, 16, 4))


class ResetThrottle(AnonRateThrottle):
    """At most 10 reset tries an hour from one address."""

    scope = "password_reset"
    rate = "10/hour"


@api_view(["GET", "POST"])
def recovery_key_view(request):
    """GET: is there a key? POST: make a new one (the old one stops working)."""
    if request.method == "POST":
        return Response({"key": new_recovery_key(request.user)}, status=201)
    rk = RecoveryKey.objects.filter(user=request.user).first()
    return Response({"has_key": rk is not None, "created_at": at_str(rk.created_at) if rk else None})


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([ResetThrottle])
def reset_password_view(request):
    """Forgot password: username + recovery key -> new password. The key is used up
    and a new one is made and shown, so the user always has one."""
    username = str(request.data.get("username", "")).strip()
    key = re.sub(r"[^A-Za-z0-9]", "", str(request.data.get("key", ""))).upper()
    password = str(request.data.get("new_password") or "")

    user = get_user_model().objects.filter(username=username, is_active=True).first() if username else None
    rk = RecoveryKey.objects.filter(user=user).first() if user else None
    if rk is None:
        make_password(key)  # same work as a real check, so wrong usernames aren't faster
        raise ApiError("Username or recovery key is wrong.")
    if not check_password(key, rk.key_hash):
        raise ApiError("Username or recovery key is wrong.")
    try:
        validate_password(password, user)
    except ValidationError as e:
        raise ApiError(" ".join(e.messages))

    user.set_password(password)
    user.save(update_fields=["password"])
    fresh_key = new_recovery_key(user)
    login(request, user, backend="django.contrib.auth.backends.ModelBackend")
    return Response(
        {"user": {"username": user.username, "is_staff": user.is_staff}, "shop": shop_json(), "recovery_key": fresh_key}
    )


# --------------------------------------------------------------------------- settings


@api_view(["GET", "PUT"])
def settings_view(request):
    shop = ShopSettings.load()
    if request.method == "PUT":
        ser = ShopSettingsSerializer(shop, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
    return Response(ShopSettingsSerializer(shop).data)


# --------------------------------------------------------------------------- items


@api_view(["GET", "POST"])
def items_view(request):
    if request.method == "POST":
        ser = ItemSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        return Response(item_json(ser.save()), status=201)

    out = out_qty_by_item()
    lost = lost_qty_by_item()
    used = set(ChallanLine.objects.order_by().values_list("item_id", flat=True).distinct())
    return Response([item_json(i, out.get(i.id, 0), i.id in used, lost.get(i.id, 0)) for i in Item.objects.all()])


@api_view(["PUT", "DELETE"])
def item_detail_view(request, pk):
    with transaction.atomic():
        item = get_object_or_404(Item.objects.select_for_update(), pk=pk)
        if request.method == "DELETE":
            if ChallanLine.objects.filter(item=item).exists() or ChallanLine.objects.filter(replaces=item).exists():
                raise ApiError("This item is used in challans, so it can't be deleted. Set its stock to 0 instead.")
            item.delete()
            return Response(status=204)

        ser = ItemSerializer(item, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        out = out_qty_by_item([item.id]).get(item.id, 0)
        new_total = ser.validated_data.get("total_qty", item.total_qty)
        if new_total < out:
            raise ApiError(f"{out} {item.unit} of {item.name} are with customers right now, so total stock can't be less than {out}.")
        item = ser.save()
        return Response(item_json(item, out, True))


# --------------------------------------------------------------------------- customers


@api_view(["GET", "POST"])
def customers_view(request):
    if request.method == "POST":
        ser = CustomerSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data, status=201)

    out_rows = ChallanLine.objects.values("challan__customer_id").annotate(
        out=Sum(Case(When(direction="out", then=F("qty")), default=-F("qty"), output_field=IntegerField()))
    )
    out = {r["challan__customer_id"]: r["out"] or 0 for r in out_rows}
    billed, paid = customer_money()
    result = []
    for c in Customer.objects.prefetch_related("sites"):
        b, p = billed.get(c.id) or Decimal(0), paid.get(c.id) or Decimal(0)
        result.append(
            {
                **CustomerSerializer(c).data,
                "sites": [s.name for s in c.sites.all()],
                "pcs_out": out.get(c.id, 0),
                "billed": b,
                "paid": p,
                "balance": b - p,
            }
        )
    return Response(result)


@api_view(["GET", "PUT", "DELETE"])
def customer_detail_view(request, pk):
    customer = get_object_or_404(Customer, pk=pk)

    if request.method == "PUT":
        ser = CustomerSerializer(customer, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)

    if request.method == "DELETE":
        if customer.challans.exists() or customer.bills.exists() or customer.payments.exists():
            raise ApiError("This customer has challans, bills or payments, so they can't be deleted.")
        customer.delete()
        return Response(status=204)

    pieces = build_ledger(customer.id, strict=False)
    holdings = [
        {**h, "lots": [{**lot, "at": at_str(lot["at"])} for lot in h["lots"]]} for h in holdings_from(pieces)
    ]
    last = last_bill(customer.id)
    locked_upto = last.upto_at if last else None
    challans = [challan_json(ch, locked_upto) for ch in challan_queryset().filter(customer=customer)]
    bills = [bill_summary_json(b) for b in customer.bills.select_related("customer")]
    payments = [
        {"id": p.id, "date": p.date.isoformat(), "amount": p.amount, "tds": p.tds, "mode": p.mode, "note": p.note}
        for p in customer.payments.all()
    ]
    billed = sum((b["total"] for b in bills), Decimal(0))
    paid = sum((p["amount"] + p["tds"] for p in payments), Decimal(0))
    pcs_at = {}
    for h in holdings:
        pcs_at[h["site_id"]] = pcs_at.get(h["site_id"], 0) + h["qty"]
    used_sites = set(customer.challans.exclude(site=None).values_list("site_id", flat=True))
    sites = [
        {**SiteSerializer(s).data, "pcs_out": pcs_at.get(s.id, 0), "used": s.id in used_sites}
        for s in customer.sites.all()
    ]
    return Response(
        {
            "customer": CustomerSerializer(customer).data,
            "sites": sites,
            "pcs_no_site": pcs_at.get(None, 0),
            "holdings": holdings,
            "pcs_out": sum(h["qty"] for h in holdings),
            "challans": challans,
            "bills": bills,
            "payments": payments,
            "billed": billed,
            "paid": paid,
            "balance": billed - paid,
            "last_bill": {"bill_no": last.bill_no, "upto_at": at_str(last.upto_at)} if last else None,
        }
    )


@api_view(["GET", "POST"])
def customer_sites_view(request, pk):
    customer = get_object_or_404(Customer, pk=pk)
    if request.method == "POST":
        ser = SiteSerializer(data=request.data, context={"customer": customer})
        ser.is_valid(raise_exception=True)
        ser.save(customer=customer)
        return Response(ser.data, status=201)
    return Response(SiteSerializer(customer.sites.all(), many=True).data)


@api_view(["PUT", "DELETE"])
def site_detail_view(request, pk):
    site = get_object_or_404(Site, pk=pk)
    if request.method == "DELETE":
        if site.challans.exists():
            raise ApiError("This site has challans, so it can't be deleted.")
        site.delete()
        return Response(status=204)
    ser = SiteSerializer(site, data=request.data, partial=True)
    ser.is_valid(raise_exception=True)
    ser.save()
    return Response(ser.data)


@api_view(["GET"])
def customer_preview_view(request, pk):
    customer = get_object_or_404(Customer, pk=pk)
    upto = parse_at(request.query_params.get("at") or at_str(timezone.now()), "Bill up to")
    return Response(preview_json(rent_preview(customer.id, upto)))


# --------------------------------------------------------------------------- challans


@api_view(["GET", "POST"])
def challans_view(request):
    if request.method == "POST":
        return create_challan(request)

    qs = challan_queryset()
    params = request.query_params
    if params.get("customer"):
        qs = qs.filter(customer_id=to_int(params["customer"], "Customer", 1))
    if params.get("site"):
        qs = qs.filter(site_id=to_int(params["site"], "Site", 1))
    if params.get("kind") in ("issue", "return", "swap"):
        qs = qs.filter(kind=params["kind"])
    start, end = parse_day(params.get("from"), "From date"), parse_day(params.get("to"), "To date")
    if start:
        qs = qs.filter(at__gte=day_start(start))
    if end:
        qs = qs.filter(at__lt=day_start(end + timedelta(days=1)))
    limit = min(to_int(params.get("limit") or 300, "Limit", 1), 2000)
    locks = last_upto_by_customer()
    return Response([challan_json(ch, locks.get(ch.customer_id)) for ch in qs[:limit]])


def create_challan(request):
    data = request.data
    customer_id = to_int(data.get("customer_id"), "Customer", 1)
    at = parse_at(data.get("at"))
    if at > timezone.now() + timedelta(days=1):
        raise ApiError("Date & time is in the future.")
    note = str(data.get("note") or "").strip()[:300]
    vehicle = str(data.get("vehicle") or "").strip().upper()[:30]
    raw_lines = data.get("lines")
    if not isinstance(raw_lines, list) or not raw_lines:
        raise ApiError("Add at least one item.")

    with transaction.atomic():
        # Lock the customer row so two people can't edit the same account at once.
        customer = Customer.objects.select_for_update().filter(pk=customer_id).first()
        if customer is None:
            raise ApiError("Customer not found.", 404)
        site = None
        if data.get("site_id"):
            site = Site.objects.filter(pk=to_int(data["site_id"], "Site", 1), customer=customer).first()
            if site is None:
                raise ApiError("That site does not belong to this customer. Reload the page and try again.")
        prev = last_bill(customer.id)
        if prev and at <= prev.upto_at:
            raise ApiError(
                f"{customer.name} already has Bill #{prev.bill_no} made up to {human_at(prev.upto_at)}. "
                "New entries must be after that time (or delete that bill first)."
            )

        wanted_ids = set()
        for r in raw_lines:
            wanted_ids.add(to_int(r.get("item_id"), "Item", 1))
            if r.get("replaces_item_id"):
                wanted_ids.add(to_int(r.get("replaces_item_id"), "Replaced item", 1))
        items = {i.id: i for i in Item.objects.select_for_update().filter(id__in=sorted(wanted_ids)).order_by("id")}
        if len(items) != len(wanted_ids):
            raise ApiError("One of the items was not found. Reload the page and try again.")

        lines = []
        net_out = {}
        for r in raw_lines:
            item = items[int(r["item_id"])]
            direction = r.get("direction")
            if direction not in ("out", "in"):
                raise ApiError("Each line must be 'out' (given) or 'in' (returned).")
            qty = to_int(r.get("qty"), f"Quantity of {item.name}", 1)
            line = ChallanLine(item=item, direction=direction, qty=qty)
            if direction == "in" and r.get("lost"):
                line.lost = True
                line.rate = (
                    item.lost_rate
                    if r.get("rate") in (None, "")
                    else to_money(r.get("rate"), f"Price of lost {item.name}")
                )
            if direction == "out":
                line.rate = item.rate if r.get("rate") in (None, "") else to_money(r.get("rate"), f"Rent of {item.name}")
                line.basis = r.get("basis") or item.basis
                if line.basis not in ("day", "hour"):
                    raise ApiError("Rent must be per day or per hour.")
                if r.get("replaces_item_id"):
                    line.replaces = items[int(r["replaces_item_id"])]
            lines.append(line)
            # Lost pieces leave the customer but don't come back to the store
            # (total stock goes down by the same amount), so free stock stays the same.
            if not line.lost:
                net_out[item.id] = net_out.get(item.id, 0) + (qty if direction == "out" else -qty)

        out_now = out_qty_by_item(net_out.keys())
        for item_id, n in net_out.items():
            item = items[item_id]
            available = item.total_qty - out_now.get(item_id, 0)
            if n > available:
                raise ApiError(f"Only {available} {item.unit} of {item.name} left in store, you entered {n}.")

        directions = {l.direction for l in lines}
        kind = "swap" if len(directions) == 2 else ("issue" if "out" in directions else "return")
        challan = Challan.objects.create(
            customer=customer, site=site, kind=kind, at=at, vehicle=vehicle, note=note, created_by=request.user
        )
        for line in lines:
            line.challan = challan
        ChallanLine.objects.bulk_create(lines)

        try:
            build_ledger(customer.id, strict=True)  # no return may exceed what the customer had
        except LedgerError as e:
            raise ApiError(str(e))

        # Lost pieces are gone for good: the shop now owns fewer.
        for line in lines:
            if line.lost:
                Item.objects.filter(pk=line.item_id).update(total_qty=F("total_qty") - line.qty)

    return Response({"id": challan.id, "kind": kind}, status=201)


@api_view(["GET", "DELETE"])
def challan_detail_view(request, pk):
    if request.method == "GET":
        ch = get_object_or_404(challan_queryset(), pk=pk)
        prev = last_bill(ch.customer_id)
        data = challan_json(ch, prev.upto_at if prev else None)
        data["customer"] = CustomerSerializer(ch.customer).data
        data["shop"] = shop_json()
        if data["locked"]:
            data["locked_by_bill"] = prev.bill_no
        return Response(data)

    with transaction.atomic():
        ch = get_object_or_404(Challan.objects.select_for_update(), pk=pk)
        Customer.objects.select_for_update().get(pk=ch.customer_id)
        prev = last_bill(ch.customer_id)
        if prev and ch.at <= prev.upto_at:
            raise ApiError(f"This challan is included in Bill #{prev.bill_no}. Delete that bill first to change it.")
        item_ids = sorted(set(ch.lines.values_list("item_id", flat=True)))
        items = {i.id: i for i in Item.objects.select_for_update().filter(id__in=item_ids).order_by("id")}
        lost_back = {}
        for line in ch.lines.filter(lost=True):
            lost_back[line.item_id] = lost_back.get(line.item_id, 0) + line.qty
        ch.delete()
        for item_id, n in lost_back.items():
            items[item_id].total_qty += n
            items[item_id].save(update_fields=["total_qty"])
        try:
            build_ledger(ch.customer_id, strict=True)
        except LedgerError as e:
            raise ApiError(f"Can't delete this challan, later returns depend on it. {e}")
        out_now = out_qty_by_item(item_ids)
        for item_id, item in items.items():
            if out_now.get(item_id, 0) > item.total_qty:
                raise ApiError(
                    f"Can't delete: those {item.name} pieces have already been given to other customers."
                )
    return Response(status=204)


# --------------------------------------------------------------------------- bills


@api_view(["GET", "POST"])
def bills_view(request):
    if request.method == "POST":
        return create_bill(request)
    qs = Bill.objects.select_related("customer")
    customer_id = request.query_params.get("customer")
    if customer_id:
        qs = qs.filter(customer_id=customer_id)
    return Response([bill_summary_json(b) for b in qs[:1000]])


def create_bill(request):
    data = request.data
    customer_id = to_int(data.get("customer_id"), "Customer", 1)
    upto = parse_at(data.get("upto"), "Bill up to")
    if upto > timezone.now() + timedelta(minutes=10):
        raise ApiError("Bill time cannot be in the future.")

    extras = []
    for r in data.get("extras") or []:
        desc = str(r.get("description") or "").strip()[:200]
        amount_raw = r.get("amount")
        if not desc and amount_raw in (None, ""):
            continue
        amount = to_money(amount_raw, f"Amount for '{desc or 'other charge'}'", Decimal("0.01"))
        if not desc:
            raise ApiError("Write a description for every other charge.")
        extras.append((desc, amount))
    discount = to_money(data.get("discount"), "Discount")
    note = str(data.get("note") or "").strip()[:300]
    gst_type = data.get("gst_type")
    if gst_type not in (None, "") and gst_type not in GST_TYPES:
        raise ApiError("GST must be none, intra (CGST + SGST) or inter (IGST).")

    ShopSettings.load()
    with transaction.atomic():
        shop = ShopSettings.objects.select_for_update().get(pk=1)  # also serialises bill numbers
        customer = Customer.objects.select_for_update().filter(pk=customer_id).first()
        if customer is None:
            raise ApiError("Customer not found.", 404)
        prev = last_bill(customer.id)
        if prev and upto <= prev.upto_at:
            raise ApiError(f"Bill must be after the previous Bill #{prev.bill_no} ({human_at(prev.upto_at)}).")

        pv = rent_preview(customer.id, upto, shop)
        if not pv["lines"] and not pv["lost_lines"] and not extras:
            raise ApiError("Nothing to bill: no rent and no other charges for this period.")
        extras_total = q2(sum((a for _, a in extras), Decimal(0)))
        taxable = pv["rent_total"] + pv["lost_total"] + extras_total - discount
        if taxable < 0:
            raise ApiError("Discount is more than the bill amount.")
        if gst_type in (None, ""):
            gst_type = default_gst_type(shop, customer)
        gst_rate = shop.gst_rate if gst_type != "none" else Decimal(0)
        cgst, sgst, igst = gst_amounts(taxable, gst_type, gst_rate)
        total = taxable + cgst + sgst + igst

        bill = Bill.objects.create(
            bill_no=(Bill.objects.aggregate(m=Max("bill_no"))["m"] or 0) + 1,
            customer=customer,
            from_at=pv["from_at"],
            upto_at=upto,
            day_mode=shop.day_mode,
            grace_hours=shop.grace_hours,
            rent_total=pv["rent_total"],
            lost_total=pv["lost_total"],
            extras_total=extras_total,
            discount=discount,
            gst_type=gst_type,
            gst_rate=gst_rate,
            taxable=taxable,
            cgst=cgst,
            sgst=sgst,
            igst=igst,
            customer_gstin=customer.gstin if gst_type != "none" else "",
            total=total,
            note=note,
            created_by=request.user,
        )
        BillLine.objects.bulk_create(
            [
                BillLine(
                    bill=bill,
                    kind="rent",
                    item_id=l["item_id"],
                    item_name=l["item_name"],
                    site_name=l["site_name"],
                    unit=l["unit"],
                    qty=l["qty"],
                    from_at=l["from_at"],
                    to_at=l["to_at"],
                    status=l["status"],
                    units=l["units"],
                    prev_units=l["prev_units"],
                    basis=l["basis"],
                    rate=l["rate"],
                    amount=l["amount"],
                )
                for l in pv["lines"]
            ]
            + [
                BillLine(
                    bill=bill,
                    kind="lost",
                    description=f"Lost on {human_at(l['at'])} (challan #{l['challan_id']})",
                    item_id=l["item_id"],
                    item_name=l["item_name"],
                    site_name=l["site_name"],
                    unit=l["unit"],
                    qty=l["qty"],
                    from_at=l["at"],
                    rate=l["rate"],
                    amount=l["amount"],
                )
                for l in pv["lost_lines"]
            ]
            + [BillLine(bill=bill, kind="extra", description=d, amount=a) for d, a in extras]
        )
    return Response({"id": bill.id, "bill_no": bill.bill_no}, status=201)


@api_view(["GET", "DELETE"])
def bill_detail_view(request, pk):
    if request.method == "GET":
        bill = get_object_or_404(Bill.objects.select_related("customer"), pk=pk)
        latest = last_bill(bill.customer_id)
        return Response(
            {
                **bill_summary_json(bill),
                "note": bill.note,
                "customer_gstin": bill.customer_gstin,
                "day_mode": bill.day_mode,
                "created_at": at_str(bill.created_at),
                "customer": CustomerSerializer(bill.customer).data,
                "lines": [bill_line_json(l) for l in bill.lines.all()],
                "can_delete": latest is not None and latest.id == bill.id,
                "shop": shop_json(),
            }
        )

    with transaction.atomic():
        bill = get_object_or_404(Bill.objects.select_for_update(), pk=pk)
        Customer.objects.select_for_update().get(pk=bill.customer_id)
        latest = last_bill(bill.customer_id)
        if latest.id != bill.id:
            raise ApiError(f"Only the latest bill of this customer (Bill #{latest.bill_no}) can be deleted.")
        bill.delete()
    return Response(status=204)


# --------------------------------------------------------------------------- payments


@api_view(["POST"])
def payments_view(request):
    ser = PaymentSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    ser.save(created_by=request.user)
    return Response(ser.data, status=201)


@api_view(["DELETE"])
def payment_detail_view(request, pk):
    get_object_or_404(Payment, pk=pk).delete()
    return Response(status=204)


# --------------------------------------------------------------------------- dashboard & backup


@api_view(["GET"])
def dashboard_view(request):
    at = parse_at(request.query_params.get("at") or at_str(timezone.now()))
    out = out_qty_by_item()
    items = [item_json(i, out.get(i.id, 0)) for i in Item.objects.all()]

    shop = ShopSettings.load()
    running_rent = Decimal(0)
    active = 0
    # order_by() clears Challan.Meta.ordering, otherwise DISTINCT repeats customers
    for customer_id in Challan.objects.order_by().values_list("customer_id", flat=True).distinct():
        pieces = build_ledger(customer_id, strict=False)
        if any(p["end"] is None for p in pieces):
            active += 1
        running_rent += rent_preview(customer_id, at, shop, pieces)["rent_total"]

    billed = Bill.objects.aggregate(s=Sum("total"))["s"] or Decimal(0)
    paid = Payment.objects.aggregate(s=Sum(F("amount") + F("tds")))["s"] or Decimal(0)
    locks = last_upto_by_customer()
    recent = [challan_json(ch, locks.get(ch.customer_id)) for ch in challan_queryset()[:8]]
    return Response(
        {
            "items": items,
            "pcs_out": sum(i["out_qty"] for i in items),
            "active_customers": active,
            "customers": Customer.objects.count(),
            "running_rent": q2(running_rent),
            "total_due": billed - paid,
            "recent": recent,
        }
    )


@api_view(["GET"])
def export_view(request):
    """Full backup of shop data as JSON (restore with: manage.py loaddata <file>)."""
    buf = io.StringIO()
    call_command("dumpdata", "store", indent=1, stdout=buf)
    stamp = timezone.localtime().strftime("%Y%m%d-%H%M")
    resp = HttpResponse(buf.getvalue(), content_type="application/json")
    resp["Content-Disposition"] = f'attachment; filename="shuttering-backup-{stamp}.json"'
    return resp
